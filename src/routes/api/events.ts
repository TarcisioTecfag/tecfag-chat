import { createFileRoute } from "@tanstack/react-router";
import { getAuthSession, requireSession } from "../../lib/auth-session";
import { SessionManager } from "../../lib/baileys/session-manager";
import { conversationAuthorizationRevision, filterConversationEvent } from "../../lib/access-control/conversation-events";

export const Route = createFileRoute("/api/events")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204 }),

      GET: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const session = auth.session;
        const tenantId = session.tenantId;
        const openingRevision = conversationAuthorizationRevision(session);

        // Inicia stream SSE persistente
        let cancelStream = () => {};
        const stream = new ReadableStream({
          start(controller) {
            const encoder = new TextEncoder();

            // Mensagem de boas-vindas da conexão SSE
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: "connected", tenantId, operatorId: session.operator.id })}\n\n`)
            );

            const sessionManager = SessionManager.getInstance();
            let heartbeatTimer: ReturnType<typeof setInterval>;
            let closed = false;
            const close = () => {
              if (closed) return;
              closed = true;
              clearInterval(heartbeatTimer);
              request.signal.removeEventListener("abort", close);
              sessionManager.unregisterListener(tenantId, onEvent);
              try { controller.close(); } catch {}
            };
            cancelStream = close;
            // Uma sessão revogada não recebe o próximo evento do tenant.
            const currentSession = async () => {
              const fresh = await getAuthSession(request);
              if (!fresh || fresh.tenantId !== tenantId || fresh.operator.id !== session.operator.id) { close(); return null; }
              if (conversationAuthorizationRevision(fresh) !== openingRevision) {
                if (!closed) controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "access_changed" })}\n\n`));
                close(); return null;
              }
              return fresh;
            };
            // Serialize delivery, revalidating authorization for each event. Bound backlog per connection.
            let pending = 0;
            let delivery = Promise.resolve();
            const onEvent = (data: any) => {
              if (closed) return;
              if (++pending > 200) { close(); return; }
              delivery = delivery.then(async () => {
                if (closed) return;
                const fresh = await currentSession();
                if (!fresh) return;
                const filtered = await filterConversationEvent(fresh, data);
                if (filtered && !closed) controller.enqueue(encoder.encode(`data: ${JSON.stringify(filtered)}\n\n`));
              }).catch(close).finally(() => { pending--; });
            };
            sessionManager.registerListener(tenantId, onEvent);

            // Heartbeat a cada 15 segundos para evitar encerramento por proxies intermediários
            heartbeatTimer = setInterval(async () => {
              try {
                if (!await currentSession()) return;
                if (!closed) controller.enqueue(encoder.encode(`: ping\n\n`));
              } catch { close(); }
            }, 15000);

            // Cleanup ao encerrar ou cancelar conexão
            request.signal.addEventListener("abort", close);
            if (request.signal.aborted) close();
          },
          cancel() { cancelStream(); },
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
