import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import { contacts, conversations, agentFlowStates } from "../../../db/schema";
import { eq } from "drizzle-orm";
import { SessionManager } from "../../../lib/baileys/session-manager";

export const Route = createFileRoute("/api/contacts/update-wallet")({
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
          const { contactId, walletOperatorId } = body;

          if (!contactId) {
            return new Response(JSON.stringify({ error: "contactId é obrigatório" }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          const isRemovingFromWallet = !walletOperatorId;

          // 1. Atualizar o contato no banco
          await db
            .update(contacts)
            .set({
              walletOperatorId: walletOperatorId || null,
              responsibleName: isRemovingFromWallet ? "Na Fila" : undefined,
            })
            .where(eq(contacts.id, contactId));

          // 2. Se for remoção de carteira, devolver a conversa para a Valentina IA (automacao) e resetar a triagem
          if (isRemovingFromWallet) {
            const clientConvs = await db
              .select()
              .from(conversations)
              .where(eq(conversations.contactId, contactId));

            for (const conv of clientConvs) {
              // Redireciona a fila para 'automacao' e zera o operador responsável
              await db
                .update(conversations)
                .set({
                  operatorId: null,
                  queueState: "automacao",
                  updatedAt: new Date(),
                })
                .where(eq(conversations.id, conv.id));

              // Reseta o estado do fluxo SDR para que a Valentina realize novo atendimento quando o cliente falar
              await db
                .delete(agentFlowStates)
                .where(eq(agentFlowStates.conversationId, conv.id));

              // Notifica SSE em tempo real para o painel atualizar a fila do atendimento para Valentina IA
              SessionManager.getInstance().notifyPublic(conv.tenantId, {
                type: "queue_update",
                conversationId: conv.id,
                queueState: "automacao",
                operatorId: null,
                sectorId: conv.sectorId,
                responsibleName: "Valentina IA",
              });
            }
          }

          return new Response(JSON.stringify({ success: true }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });

        } catch (e: any) {
          console.error("Erro ao atualizar carteira do contato no DB:", e);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
