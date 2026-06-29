import { createFileRoute } from "@tanstack/react-router";
import { SessionManager } from "../../../lib/baileys/session-manager";
import { db } from "../../../db";
import { messages, conversations } from "../../../db/schema";
import { eq } from "drizzle-orm";

export const Route = createFileRoute("/api/baileys/send")({
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
      POST: async ({ request }) => {
        const corsHeaders = {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        };

        try {
          const body = await request.json();
          const { tenantId, phone, text, conversationId } = body;

          if (!tenantId || !phone || !text) {
            return new Response(JSON.stringify({ error: "tenantId, phone e text são obrigatórios" }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          const sessionManager = SessionManager.getInstance();
          const sock = sessionManager.getSession(tenantId);

          if (!sock || sessionManager.getStatus(tenantId) !== "connected") {
            return new Response(JSON.stringify({ error: "WhatsApp não conectado para este tenant" }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          const cleanPhone = phone.replace(/\D/g, "");
          const jid = `${cleanPhone}@s.whatsapp.net`;

          // Enviar mensagem pelo Baileys
          const sentMsg = await sock.sendMessage(jid, { text });

          // Se temos conversationId, salvar no DB
          if (conversationId) {
            const messageId = sentMsg?.key.id || `msg-sent-${Date.now()}`;
            
            await db.insert(messages).values({
              id: messageId,
              tenantId,
              conversationId,
              senderType: "agent",
              senderName: "Operador",
              content: text,
              isInternalNote: false,
              sentAt: new Date(),
            });

            // Atualizar última mensagem na conversa
            await db.update(conversations)
              .set({
                lastMessageText: text,
                lastMessageTime: new Date(),
              })
              .where(eq(conversations.id, conversationId));
          }

          return new Response(JSON.stringify({ success: true, messageId: sentMsg?.key.id }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          console.error("Erro ao enviar mensagem pelo Baileys:", e);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
