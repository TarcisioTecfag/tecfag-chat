import { createFileRoute } from "@tanstack/react-router";
import { requireSession } from "../../lib/auth-session";
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

            // Listener de eventos do tenant
            const onEvent = (data: any) => {
              try {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
              } catch (e) {
                // Stream possivelmente fechado pelo cliente
              }
            };

            const sessionManager = SessionManager.getInstance();
            sessionManager.registerListener(tenantId, onEvent);

            // Heartbeat a cada 15 segundos para evitar encerramento por proxies intermediários
            const heartbeatTimer = setInterval(() => {
              try {
                controller.enqueue(encoder.encode(`: ping\n\n`));
              } catch {
                clearInterval(heartbeatTimer);
              }
            }, 15000);

            // Cleanup ao encerrar ou cancelar conexão
            request.signal.addEventListener("abort", () => {
              clearInterval(heartbeatTimer);
              sessionManager.unregisterListener(tenantId, onEvent);
              try {
                controller.close();
              } catch {}
            });
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
