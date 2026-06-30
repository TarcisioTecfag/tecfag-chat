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
          const { tenantId, phone, text, conversationId, senderName } = body;

          console.log("[Baileys Send Route] Parâmetros recebidos no backend:", {
            tenantId,
            phone,
            text,
            conversationId,
            senderName,
          });

          if (!tenantId || !phone) {
            return new Response(JSON.stringify({ error: "tenantId e phone são obrigatórios" }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          if (!text || !text.trim()) {
            return new Response(JSON.stringify({ error: "text não pode ser vazio — use /api/baileys/send-media para enviar arquivos" }), {
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

          // Determinar o JID de destino: prioriza o whatsappJid salvo no contato
          // (evita reconstrução frágil a partir do telefone)
          let jid: string;
          if (conversationId) {
            try {
              const conv = await db.query.conversations.findFirst({
                where: (t, { eq: dEq }) => dEq(t.id, conversationId),
              });
              if (conv?.contactId) {
                const contact = await db.query.contacts.findFirst({
                  where: (t, { eq: dEq }) => dEq(t.id, conv.contactId),
                });
                if (contact?.whatsappJid) {
                  jid = contact.whatsappJid;
                  console.log(`[Baileys Send] Usando JID salvo do contato: ${jid}`);
                } else {
                  const cleanPhone = phone.replace(/\D/g, "");
                  jid = `${cleanPhone}@s.whatsapp.net`;
                  console.log(`[Baileys Send] JID não salvo no contato, usando phone: ${jid}`);
                }
              } else {
                const cleanPhone = phone.replace(/\D/g, "");
                jid = `${cleanPhone}@s.whatsapp.net`;
              }
            } catch {
              const cleanPhone = phone.replace(/\D/g, "");
              jid = `${cleanPhone}@s.whatsapp.net`;
            }
          } else {
            const cleanPhone = phone.replace(/\D/g, "");
            jid = `${cleanPhone}@s.whatsapp.net`;
          }

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
              senderName: senderName || "Operador",
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
