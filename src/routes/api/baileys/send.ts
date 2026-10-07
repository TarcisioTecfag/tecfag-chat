import { createFileRoute } from "@tanstack/react-router";
import { requireSession } from "../../../lib/auth-session";
import { outboundQueue } from "../../../lib/whatsapp/outbound";
import { db } from "../../../db";
import { channelConfigs, contacts, conversations } from "../../../db/schema";
import { and, eq } from "drizzle-orm";

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
          const { text, conversationId, quotedMessageId, clientMessageId } = body;

          if (!conversationId || !text || !text.trim()) {
            return new Response(
              JSON.stringify({ error: "conversationId e text são obrigatórios" }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          const tenantId = session.tenantId;
          const [config] = await db.select({ activeProvider: channelConfigs.activeProvider, connectionStatus: channelConfigs.connectionStatus })
            .from(channelConfigs).where(eq(channelConfigs.tenantId, tenantId));
          if (config?.connectionStatus === "switching") return Response.json({ error: "Canal em transição." }, { status: 409 });

          const [conversation] = await db.select({ contactId: conversations.contactId, operatorId: conversations.operatorId, queueState: conversations.queueState })
            .from(conversations).where(and(eq(conversations.id, conversationId), eq(conversations.tenantId, tenantId)));
          if (!conversation) return Response.json({ error: "Conversa não encontrada." }, { status: 404 });
          if (conversation.queueState !== "meus" || conversation.operatorId !== session.operator.id) {
            return Response.json({ error: "Capture o atendimento antes de responder nesta conversa." }, { status: 403 });
          }
          if (!conversation.contactId) return Response.json({ error: "Conversa sem contato." }, { status: 400 });
          const [contact] = await db.select({ phone: contacts.phone }).from(contacts).where(and(
            eq(contacts.id, conversation.contactId), eq(contacts.tenantId, tenantId)
          ));
          if (!contact?.phone) return Response.json({ error: "Contato sem telefone." }, { status: 400 });

          // Mantém a rota antiga para a chamada de voz, com o mesmo destino e política do canal unificado.
          const result = await outboundQueue.enqueueAndSend({
            tenantId,
            conversationId,
            recipientPhone: contact.phone,
            text: text.trim(),
            senderName: session.operator.name,
            senderId: session.operator.id,
            operatorId: session.operator.id,
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
