import { createFileRoute } from "@tanstack/react-router";
import { requireSession } from "../../../lib/auth-session";
import { outboundQueue } from "../../../lib/whatsapp/outbound";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const Route = createFileRoute("/api/baileys/send")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      POST: async ({ request }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const session = auth.session;

          const body = await request.json();
          const { phone, text, conversationId, quotedMessageId, clientMessageId } = body;

          if (!phone || !text || !text.trim()) {
            return new Response(
              JSON.stringify({ error: "phone e text são obrigatórios" }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          // Roteia SEMPRE pelo tenant da sessão através da OutboundQueue unificada
          const result = await outboundQueue.enqueueAndSend({
            tenantId: session.tenantId,
            conversationId: conversationId || undefined,
            recipientPhone: phone.replace(/\D/g, ""),
            text: text.trim(),
            senderName: session.operator.name,
            senderId: session.operator.id,
            quotedMessageId: quotedMessageId || undefined,
            idempotencyKey: clientMessageId || body.idempotencyKey || undefined,
          });

          return new Response(JSON.stringify(result), {
            status: result.success ? 200 : 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (err: any) {
          console.error("[Baileys Send Protected] Erro:", err);
          return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
