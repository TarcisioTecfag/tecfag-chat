import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import { contacts, conversations, agentFlowStates, operators } from "../../../db/schema";
import { isNull, and, eq } from "drizzle-orm";
import { SessionManager } from "../../../lib/baileys/session-manager";
import { requireSession } from "../../../lib/auth-session";
import { getAiPersona } from "../../../lib/ai-persona";
import { restartIndustrialCycle } from "../../../lib/triage/industrial-cycle-restart";

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

          const [existingContact] = await db
            .select({ id: contacts.id, walletOperatorId: contacts.walletOperatorId })
            .from(contacts)
            .where(and(eq(contacts.id, contactId), eq(contacts.tenantId, session.tenantId)))
            .limit(1);

          const isSelfWalletRelease =
            !walletOperatorId &&
            existingContact?.walletOperatorId === session.operator.id &&
            Boolean(session.permissions?.views?.wallet);

          if (
            session.operator.role !== "admin" &&
            !session.permissions?.chat?.canChangeWallet &&
            !session.permissions?.security?.canManageWallets &&
            !isSelfWalletRelease
          ) {
            return Response.json({ error: "Permissão insuficiente.", code: "FORBIDDEN" }, { status: 403 });
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
              .where(and(eq(conversations.contactId, contactId), eq(conversations.tenantId, session.tenantId), isNull(conversations.whatsappConnectionId)));

            const aiPersona = getAiPersona(session.tenantId);
            const aiName = `${aiPersona.name} IA`;

            for (const conv of clientConvs) {
              let queueSectorId = conv.sectorId;
              let queueVersion: number | undefined;
              if (aiPersona.triagePolicy === "industrial") {
                const restarted = await restartIndustrialCycle(db, session.tenantId, conv.id, { reason: "wallet_released", sourceKey: crypto.randomUUID() });
                if (!restarted) continue;
                queueSectorId = restarted.conversation.sectorId;
                queueVersion = restarted.conversation.version;
              } else {
              // Redireciona a fila para 'automacao' e zera o operador responsável
              await db
                .update(conversations)
                .set({
                  operatorId: null,
                  queueState: "automacao",
                  lastMessageTime: new Date(),
                  updatedAt: new Date(),
                })
                .where(and(eq(conversations.id, conv.id), eq(conversations.tenantId, session.tenantId), isNull(conversations.whatsappConnectionId)));

              // Reseta o estado do fluxo SDR para que a IA realize novo atendimento quando o cliente falar
              await db
                .delete(agentFlowStates)
                .where(and(eq(agentFlowStates.conversationId, conv.id), eq(agentFlowStates.tenantId, session.tenantId)));
              }

              // Notifica SSE em tempo real para o painel atualizar a fila do atendimento
              SessionManager.getInstance().notifyPublic(session.tenantId, {
                type: "queue_update",
                conversationId: conv.id,
                contactId,
                queueState: "automacao",
                operatorId: null,
                walletOperatorId: null,
                sectorId: queueSectorId,
                version: queueVersion,
                responsibleName: aiName,
              });
            }
          } else {
            const clientConvs = await db
              .select({ id: conversations.id, queueState: conversations.queueState, operatorId: conversations.operatorId, sectorId: conversations.sectorId, version: conversations.version })
              .from(conversations)
              .where(and(eq(conversations.contactId, contactId), eq(conversations.tenantId, session.tenantId)));
            for (const conv of clientConvs) {
              SessionManager.getInstance().notifyPublic(session.tenantId, {
                type: "queue_update",
                conversationId: conv.id,
                contactId,
                queueState: conv.queueState,
                operatorId: conv.operatorId,
                walletOperatorId: walletOperatorId || null,
                sectorId: conv.sectorId,
                version: conv.version,
              });
            }
          }

          return new Response(JSON.stringify({ success: true, contactId, walletOperatorId: walletOperatorId || null }), {
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
