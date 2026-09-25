import { createFileRoute } from "@tanstack/react-router";
import { SessionManager } from "../../../lib/baileys/session-manager";
import { requireSession } from "../../../lib/auth-session";

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

        const url = new URL(request.url);
        const requestedTenant = url.searchParams.get("tenantId");

        if (requestedTenant && requestedTenant !== session.tenantId) {
          return new Response(
            JSON.stringify({ error: "Acesso negado ao tenant especificado", code: "FORBIDDEN" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const tenantId = session.tenantId;
        const force = url.searchParams.get("force") === "true";

        const sessionManager = SessionManager.getInstance();

        const stream = new ReadableStream({
          start(controller) {
            const listener = (event: any) => {
              try {
                controller.enqueue(`data: ${JSON.stringify(event)}\n\n`);
              } catch (e) {
                console.error("Erro ao enfileirar dados no stream SSE:", e);
              }
            };

            sessionManager.registerListener(tenantId, listener);

            // Notificar status inicial se a sessão já estiver ativa
            const currentStatus = sessionManager.getStatus(tenantId);
            const currentQr = sessionManager.getQr(tenantId);
            const sock = sessionManager.getSession(tenantId);
            if (currentStatus !== "disconnected") {
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

            request.signal.addEventListener("abort", () => {
              console.log(`Cliente fechou conexão SSE para o tenant ${tenantId}`);
              sessionManager.unregisterListener(tenantId, listener);
            });
          },
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
