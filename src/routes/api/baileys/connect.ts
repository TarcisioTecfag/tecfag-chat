import { createFileRoute } from "@tanstack/react-router";
import { SessionManager } from "../../../lib/baileys/session-manager";
import { requireSession, getAuthSession } from "../../../lib/auth-session";
import { canManageWhatsappConnection } from "../../../lib/access-control/channel-permissions";
import { getActiveProvider } from "../../../lib/whatsapp";

export const Route = createFileRoute("/api/baileys/connect")({
  server: {
    handlers: {
      OPTIONS: async () => {
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        });
      },
      GET: async ({ request }) => {
        const corsHeaders = {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        };

        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const session = auth.session;
        if (!canManageWhatsappConnection(session)) return Response.json({ error: "Permissão insuficiente.", code: "FORBIDDEN" }, { status: 403 });

        const url = new URL(request.url);
        const requestedTenant = url.searchParams.get("tenantId");

        if (requestedTenant && requestedTenant !== session.tenantId) {
          return new Response(
            JSON.stringify({ error: "Acesso negado ao tenant especificado", code: "FORBIDDEN" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const tenantId = session.tenantId;

        // Se o tenant estiver configurado para Meta, não permite conexão Baileys
        const activeProvider = await getActiveProvider(tenantId);
        if (activeProvider === "meta") {
          return new Response(
            JSON.stringify({
              error: "Este tenant está configurado para operar via Meta WhatsApp Business API. Conexão Baileys não aplicável.",
              activeProvider: "meta",
              code: "INACTIVE_PROVIDER",
            }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const force = url.searchParams.get("force") === "true";

        const sessionManager = SessionManager.getInstance();

        let cancelStream = () => {};
        const stream = new ReadableStream({
          start(controller) {
            let closed = false;
            let heartbeat: ReturnType<typeof setInterval>;
            const close = () => {
              if (closed) return;
              closed = true;
              clearInterval(heartbeat);
              request.signal.removeEventListener("abort", close);
              sessionManager.unregisterListener(tenantId, listener);
              try { controller.close(); } catch {}
            };
            cancelStream = close;
            const authorized = async () => {
              const fresh = await getAuthSession(request);
              if (!fresh || fresh.tenantId !== tenantId || fresh.operator.id !== session.operator.id || !canManageWhatsappConnection(fresh)) { close(); return false; }
              return true;
            };
            const listener = (event: any) => {
              if (closed || !["status", "qr"].includes(event.type)) return;
              void authorized().then((allowed) => {
                if (allowed && !closed) controller.enqueue(`data: ${JSON.stringify(event)}\n\n`);
              }).catch(close);
            };

            // Um reset invalida o QR anterior: nunca reenviá-lo ao novo stream.
            sessionManager.registerListener(tenantId, listener, !force);

            // Notificar status inicial se a sessão já estiver ativa
            const currentStatus = sessionManager.getStatus(tenantId);
            const currentQr = sessionManager.getQr(tenantId);
            const sock = sessionManager.getSession(tenantId);
            if (!force && currentStatus !== "disconnected") {
              const phone = sock?.user?.id ? sock.user.id.split(":")[0] : undefined;
              controller.enqueue(`data: ${JSON.stringify({ type: "status", status: currentStatus, phone })}\n\n`);
              if (currentStatus === "qr_ready" && currentQr) {
                controller.enqueue(`data: ${JSON.stringify({ type: "qr", qr: currentQr })}\n\n`);
              }
            }

            const initPromise = force
              ? sessionManager.resetAndInitSession(tenantId)
              : sessionManager.initSession(tenantId);

            initPromise.catch((err) => {
              console.error("Erro ao inicializar sessão Baileys:", err);
              try {
                controller.enqueue(`data: ${JSON.stringify({ type: "error", message: err.message })}\n\n`);
              } catch (e) {}
            });

            heartbeat = setInterval(() => { void authorized().catch(close); }, 15000);
            request.signal.addEventListener("abort", close);
            if (request.signal.aborted) close();
          },
          cancel() { cancelStream(); },
        });

        return new Response(stream, {
          headers: {
            ...corsHeaders,
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
          },
        });
      },
    },
  },
});
