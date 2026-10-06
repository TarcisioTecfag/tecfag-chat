import { createFileRoute } from "@tanstack/react-router";
import { getAuthSession, isSessionTokenActive, requireSession } from "../../lib/auth-session";
import { SessionManager } from "../../lib/baileys/session-manager";

export const Route = createFileRoute("/api/events")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204 }),

      GET: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const session = auth.session;
        const tenantId = session.tenantId;

        // Inicia stream SSE persistente
        const stream = new ReadableStream({
          start(controller) {
            const encoder = new TextEncoder();

            // Mensagem de boas-vindas da conexão SSE
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: "connected", tenantId, operatorId: session.operator.id })}\n\n`)
            );

            const sessionManager = SessionManager.getInstance();
            let heartbeatTimer: ReturnType<typeof setInterval>;
            let heartbeatCount = 0;
            let closed = false;
            const close = () => {
              if (closed) return;
              closed = true;
              clearInterval(heartbeatTimer);
              sessionManager.unregisterListener(tenantId, onEvent);
              try { controller.close(); } catch {}
            };
            // Uma sessão revogada não recebe o próximo evento do tenant.
            const onEvent = async (data: any) => {
              try {
                if (!await isSessionTokenActive(session)) return close();
                if (!closed) controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
              } catch { close(); }
            };
            sessionManager.registerListener(tenantId, onEvent);

            // Heartbeat a cada 15 segundos para evitar encerramento por proxies intermediários
            heartbeatTimer = setInterval(async () => {
              try {
                heartbeatCount += 1;
                const stillAuthorized = heartbeatCount % 4 === 0
                  ? await getAuthSession(request)
                  : await isSessionTokenActive(session);
                if (!stillAuthorized || (typeof stillAuthorized !== "boolean" && stillAuthorized.tenantId !== tenantId)) return close();
                if (!closed) controller.enqueue(encoder.encode(`: ping\n\n`));
              } catch { close(); }
            }, 15000);

            // Cleanup ao encerrar ou cancelar conexão
            request.signal.addEventListener("abort", close);
          },
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
          },
        });
      },
    },
  },
});
