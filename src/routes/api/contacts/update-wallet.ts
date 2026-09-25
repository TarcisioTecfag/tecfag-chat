import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import { contacts, conversations, agentFlowStates, operators } from "../../../db/schema";
import { and, eq } from "drizzle-orm";
import { SessionManager } from "../../../lib/baileys/session-manager";
import { requireSession } from "../../../lib/auth-session";
import { getAiPersona } from "../../../lib/ai-persona";

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
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const session = auth.session;

          const body = await request.json();
          const { contactId, walletOperatorId } = body;

          if (!contactId) {
            return new Response(JSON.stringify({ error: "contactId é obrigatório" }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          // Se informou um operador de carteira, valida se pertence ao mesmo tenant
          if (walletOperatorId) {
            const [op] = await db
              .select({ id: operators.id })
              .from(operators)
              .where(and(eq(operators.id, walletOperatorId), eq(operators.tenantId, session.tenantId)));
            if (!op) {
              return new Response(JSON.stringify({ error: "Operador não encontrado para este tenant" }), {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              });
            }
          }

          const isRemovingFromWallet = !walletOperatorId;

          // 1. Atualizar o contato no banco com filtro obrigatório por tenant
          await db
            .update(contacts)
            .set({
              walletOperatorId: walletOperatorId || null,
              responsibleName: isRemovingFromWallet ? "Na Fila" : undefined,
            })
            .where(and(eq(contacts.id, contactId), eq(contacts.tenantId, session.tenantId)));

          // 2. Se for remoção de carteira, devolver a conversa para a IA do tenant (automacao) e resetar a triagem
          if (isRemovingFromWallet) {
            const clientConvs = await db
              .select()
              .from(conversations)
              .where(and(eq(conversations.contactId, contactId), eq(conversations.tenantId, session.tenantId)));

            const aiPersona = getAiPersona(session.tenantId);
            const aiName = `${aiPersona.name} IA`;

            for (const conv of clientConvs) {
              // Redireciona a fila para 'automacao' e zera o operador responsável
              await db
                .update(conversations)
                .set({
                  operatorId: null,
                  queueState: "automacao",
                  lastMessageTime: new Date(),
                  updatedAt: new Date(),
                })
                .where(and(eq(conversations.id, conv.id), eq(conversations.tenantId, session.tenantId)));

              // Reseta o estado do fluxo SDR para que a IA realize novo atendimento quando o cliente falar
              await db
                .delete(agentFlowStates)
                .where(eq(agentFlowStates.conversationId, conv.id));

              // Notifica SSE em tempo real para o painel atualizar a fila do atendimento
              SessionManager.getInstance().notifyPublic(session.tenantId, {
                type: "queue_update",
                conversationId: conv.id,
                queueState: "automacao",
                operatorId: null,
                sectorId: conv.sectorId,
                responsibleName: aiName,
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
