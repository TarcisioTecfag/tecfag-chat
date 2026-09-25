import { createFileRoute } from "@tanstack/react-router";
import { outboundQueue } from "../../../lib/whatsapp/outbound";
import { requireSession } from "../../../lib/auth-session";

export const Route = createFileRoute("/api/whatsapp/send")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204 }),

      POST: async ({ request }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const session = auth.session;

          const body = await request.json();
          const {
            conversationId,
            recipientPhone,
            text,
            mediaUrl,
            mediaType,
            fileName,
            quotedMessageId,
            clientMessageId,
            isInternalNote,
          } = body;

          if (!conversationId || !recipientPhone) {
            return new Response(
              JSON.stringify({ error: "conversationId e recipientPhone são obrigatórios" }),
              { status: 400, headers: { "Content-Type": "application/json" } }
            );
          }

          const result = await outboundQueue.enqueueAndSend({
            idempotencyKey: clientMessageId,
            tenantId: session.tenantId,
            conversationId,
            recipientPhone,
            text,
            mediaUrl,
            mediaType,
            fileName,
            quotedMessageId,
            operatorId: session.operator.id,
            isInternalNote: !!isInternalNote,
          });

          return new Response(JSON.stringify(result), {
            status: result.success ? 200 : 400,
            headers: { "Content-Type": "application/json" },
          });

        } catch (err: any) {
          console.error("[WhatsApp Send Route] Erro:", err);
          return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
