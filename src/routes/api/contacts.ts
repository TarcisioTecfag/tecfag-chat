import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../db";
import { contacts, conversations } from "../../db/schema";

export const Route = createFileRoute("/api/contacts")({
  server: {
    handlers: {
      OPTIONS: async () => {
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        });
      },
      POST: async ({ request }) => {
        const corsHeaders = {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        };

        try {
          const body = await request.json();
          const { tenantId, name, phone, email, cnpj, channel, operatorId, queueState, contactId, conversationId } = body;

          if (!tenantId || !name) {
            return new Response(JSON.stringify({ error: "tenantId e name são obrigatórios" }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          const finalContactId = contactId || `cont-${Date.now()}`;
          const finalConversationId = conversationId || `conv-${Date.now()}`;

          // 1. Criar Contato no Banco
          await db.insert(contacts).values({
            id: finalContactId,
            tenantId,
            name,
            phone: phone || null,
            email: email || null,
            cnpj: cnpj || null,
            mainChannel: channel || "whatsapp",
            walletOperatorId: operatorId || null,
          });

          // 2. Criar Conversa no Banco
          await db.insert(conversations).values({
            id: finalConversationId,
            tenantId,
            contactId: finalContactId,
            operatorId: operatorId || null,
            queueState: queueState || "meus",
            lastMessageText: "Contato criado e atendimento iniciado.",
            lastMessageTime: new Date(),
          });

          return new Response(
            JSON.stringify({
              success: true,
              contactId: finalContactId,
              conversationId: finalConversationId,
            }),
            {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        } catch (e: any) {
          console.error("Erro ao criar contato e conversa no DB:", e);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
