import { syncConversationDeals, DEAL_REQUIRED_MESSAGE } from "../../../lib/crm/deal-associations";
import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import { conversations, contacts, messages, operators, sectors, agentFlowStates } from "../../../db/schema";
import { eq, and, sql, isNull } from "drizzle-orm";
import { SessionManager } from "../../../lib/baileys/session-manager";
import { auditService } from "../../../lib/audit-service";
import { requireSession } from "../../../lib/auth-session";
import { getAiPersona } from "../../../lib/ai-persona";
import { recordCommercialTransfer } from "../../../lib/commercial/tma";
import { SdrDebouncer } from "../../../lib/valentina/sdr-debouncer";
import { requireConversationAccess } from "../../../lib/access-control/conversation-access";
import { getDealContext, recordConversationAction, endDealContext, selectDealContext, assertDealContextVersion, DealContextError } from "../../../lib/crm/conversation-deal-context";
import { requireCrmDealAccess } from "../../../lib/access-control/crm-record-access";

export const Route = createFileRoute("/api/chats/update-queue")({
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
          const { conversationId, queueState, operatorId, sectorId, expectedVersion } = body;

          if (!conversationId || !queueState) {
            return new Response(
              JSON.stringify({ error: "conversationId e queueState são obrigatórios" }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          if (!["meus", "fila", "finalizados", "automacao"].includes(queueState) ||
              (operatorId !== undefined && operatorId !== null && typeof operatorId !== "string") ||
              (sectorId !== undefined && sectorId !== null && typeof sectorId !== "string")) {
            return Response.json({ error: "Estado ou operador inválido." }, { status: 400 });
          }

          if (expectedVersion === undefined || expectedVersion === null || isNaN(Number(expectedVersion))) {
            return new Response(
              JSON.stringify({ error: "expectedVersion é obrigatório para controle de concorrência otimista" }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          // 1. Verificar conversa existente dentro do tenant da sessão
          const denied = await requireConversationAccess(session, conversationId);
          if (denied) return denied;
          if (body.nextDealId !== undefined) {
            if (typeof body.nextDealId !== "string" || !body.nextDealId || queueState === "finalizados") return Response.json({ error: "Negociação de destino inválida." }, { status: 400 });
            const deniedDeal = await requireCrmDealAccess(session, body.nextDealId);
            if (deniedDeal) return deniedDeal;
          }
          const [conv] = await db
            .select()
            .from(conversations)
            .where(
              and(
                eq(conversations.id, conversationId),
                eq(conversations.tenantId, session.tenantId)
              )
            );

          if (!conv) {
            return new Response(
              JSON.stringify({ error: "Conversa não encontrada para este tenant" }),
              { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          const permissions = session.permissions.chat;
          const isOwner = conv.operatorId === session.operator.id;
          const isOverride = permissions.canOverrideChat === true;
          const can = (permission: boolean) => permission === true;
          const forbidden = () => Response.json({ error: "Permissão insuficiente para alterar este atendimento.", code: "FORBIDDEN" }, { status: 403 });

          // Captura, tomada de controle e transferência são ações distintas. O operador
          // de destino só pode ser escolhido quando há permissão de transferência.
          if (queueState === "meus") {
            if (!operatorId) return Response.json({ error: "Informe o responsável pelo atendimento." }, { status: 400 });
            if (operatorId === session.operator.id) {
              if (conv.operatorId && !isOwner) {
                if (!can(isOverride)) return forbidden();
              } else if (!isOwner && !can(permissions.canCaptureChat === true)) {
                return forbidden();
              }
            } else if (!can(permissions.canTransferChat === true) ||
                       (conv.operatorId && !isOwner && !can(isOverride))) {
              return forbidden();
            }
          } else if (queueState === "finalizados") {
            if (!can(permissions.canFinishChat === true) || !isOwner) return forbidden();
          } else if (!can(permissions.canTransferChat === true) ||
                     (conv.operatorId && !isOwner && !can(isOverride))) {
            return forbidden();
          }

          if (queueState === "meus") {
            const [target] = await db.select({ id: operators.id }).from(operators).where(and(
              eq(operators.id, operatorId), eq(operators.tenantId, session.tenantId)
            ));
            if (!target) return Response.json({ error: "Operador não encontrado neste tenant." }, { status: 400 });
          }
          let targetSectorName: string | null = null;
          if (sectorId) {
            const [sector] = await db.select({ id: sectors.id, name: sectors.name }).from(sectors).where(and(
              eq(sectors.id, sectorId), eq(sectors.tenantId, session.tenantId)
            ));
            if (!sector) return Response.json({ error: "Setor não encontrado neste tenant." }, { status: 400 });
            targetSectorName = sector.name;
          }
          if (sectorId !== undefined && sectorId !== conv.sectorId && !can(permissions.canTransferChat === true)) {
            return forbidden();
          }

          if (queueState === "meus") {
            const hasDeal = await db.transaction((tx) => syncConversationDeals(tx, session.tenantId, conv.id, conv.contactId, session.operator.id));
            if (!hasDeal) return Response.json({ error: DEAL_REQUIRED_MESSAGE, code: "DEAL_REQUIRED", conversationId: conv.id }, { status: 409 });
          }
          // 2. Determinar responsável e persona dinamicamente
          const aiPersona = getAiPersona(session.tenantId);
          const aiName = `${aiPersona.name} IA`;
          const targetOpId = queueState === "meus" ? operatorId : null;

          let respName = "Na Fila";
          let systemMessageText = "";

          if (queueState === "meus" && targetOpId) {
            const [op] = await db
              .select({ name: operators.name })
              .from(operators)
              .where(
                and(
                  eq(operators.id, targetOpId),
                  eq(operators.tenantId, session.tenantId)
                )
              );
            const opName = op?.name || "Operador";
            respName = opName;
            systemMessageText = conv.operatorId !== targetOpId && conv.queueState === "meus"
              ? `Atendimento transferido para ${opName} por ${session.operator.name}.`
              : `Atendimento assumido por ${opName}.`;
            if (targetSectorName) systemMessageText += ` Setor: ${targetSectorName}.`;
          } else if (queueState === "fila") {
            respName = "Na Fila";
            systemMessageText = targetSectorName ? `Atendimento transferido para a fila de ${targetSectorName} por ${session.operator.name}.` : `Atendimento devolvido para a Fila de Espera.`;
          } else if (queueState === "finalizados") {
            respName = "Finalizado";
            systemMessageText = `Atendimento encerrado e encaminhado para os Finalizados.`;
          } else if (queueState === "automacao") {
            respName = aiName;
            systemMessageText = `Atendimento direcionado para a Automação (${aiName}).`;
          }

          // 3. Concorrência Atômica com incremento de version dentro de db.transaction
          const updateData: Record<string, any> = {
            queueState,
            version: sql`${conversations.version} + 1`,
            updatedAt: new Date(),
          };

          if (queueState !== "finalizados") updateData.operatorId = targetOpId;
          if (sectorId !== undefined) {
            updateData.sectorId = sectorId || null;
          }

          class ConcurrencyConflictError extends Error {
            currentConv: any;
            constructor(currentConv: any) {
              super("Conflito de concorrência detectado");
              this.name = "ConcurrencyConflictError";
              this.currentConv = currentConv;
            }
          }

          let updatedConv: any;
          try {
            updatedConv = await db.transaction(async (tx) => {
              const state = await getDealContext(tx, session.tenantId, conversationId, session.operator.id);
              // Captura inicial continua possível para o operador escolher o contexto na tela.
              if (body.expectedContextVersion !== undefined) assertDealContextVersion(state.context, body.expectedContextVersion);
              const isCapture = queueState === "meus" && operatorId === session.operator.id &&
                (state.conversation.operatorId !== session.operator.id || state.conversation.queueState !== "meus");
              if (!isCapture) assertDealContextVersion(state.context, body.expectedContextVersion);
              if (body.nextDealId && !state.deals.some(d => d.id === body.nextDealId && d.status === "open")) throw new DealContextError("A negociação de destino deve estar vinculada e em andamento.", "INVALID_DEAL_CONTEXT", 400);
              if (!isCapture && !state.context.currentDealId && !body.nextDealId && state.deals.some(d => d.status === "open")) {
                throw new DealContextError("Selecione a negociação deste atendimento antes de transferir ou encerrar.", "DEAL_CONTEXT_REQUIRED");
              }
              const updatedRows = await tx
                .update(conversations)
                .set(updateData)
                .where(
                  and(
                    eq(conversations.id, conversationId),
                    eq(conversations.tenantId, session.tenantId),
                    eq(conversations.version, Number(expectedVersion))
                  )
                )
                .returning();

              if (updatedRows.length === 0) {
                const [current] = await tx
                  .select()
                  .from(conversations)
                  .where(
                    and(
                      eq(conversations.id, conversationId),
                      eq(conversations.tenantId, session.tenantId)
                    )
                  );
                throw new ConcurrencyConflictError(current);
              }

              const convResult = updatedRows[0];

              // Atualizar responsável no contato atomicamente
              if (convResult.contactId) {
                await tx
                  .update(contacts)
                  .set({ responsibleName: respName })
                  .where(
                    and(
                      eq(contacts.id, convResult.contactId),
                      eq(contacts.tenantId, session.tenantId)
                    )
                  );
              }

              // Gravar mensagem de sistema atômica no histórico
              if (systemMessageText) {
                const messageId = `sys-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
                await tx.insert(messages).values({
                  id: messageId,
                  tenantId: session.tenantId,
                  conversationId,
                  senderType: "system",
                  senderName: "Sistema",
                  content: systemMessageText,
                  isInternalNote: true,
                  direction: "outbound",
                  status: "accepted",
                  sentAt: new Date(),
                  updatedAt: new Date(),
                });
                await recordConversationAction(tx, {
                  tenantId: session.tenantId, conversationId, dealId: state.context.currentDealId || body.nextDealId || null,
                  operatorId: session.operator.id, messageId, content: systemMessageText, type: "system_event",
                  metadata: { fromQueueState: state.conversation.queueState, toQueueState: queueState,
                    fromOperatorId: state.conversation.operatorId, toOperatorId: convResult.operatorId,
                    fromSectorId: state.conversation.sectorId, toSectorId: convResult.sectorId },
                });
              }
              if (body.nextDealId) await selectDealContext(tx, session.tenantId, conversationId, body.nextDealId, session.operator.id, state.context.version);
              if (queueState === "finalizados") await endDealContext(tx, session.tenantId, conversationId);

              // Se saiu da automação em tenant industrial, encerrar/cancelar ciclo de silêncio da IA
              if (aiPersona.triagePolicy === "industrial" && queueState !== "automacao") {
                const now = new Date();
                await tx
                  .update(agentFlowStates)
                  .set({
                    metadata: sql`${agentFlowStates.metadata} || '{"followUpStage":0}'::jsonb`,
                    ...(queueState === "meus" || queueState === "finalizados"
                      ? {
                          outcome: queueState === "meus" ? "transferred" : "abandoned",
                          completedAt: now,
                        }
                      : {}),
                    lastInteractionAt: now,
                  })
                  .where(
                    and(
                      eq(agentFlowStates.tenantId, session.tenantId),
                      eq(agentFlowStates.conversationId, conversationId),
                      isNull(agentFlowStates.completedAt),
                    ),
                  );
              }

              return convResult;
            });
          } catch (err: any) {
            if (err instanceof ConcurrencyConflictError || err?.name === "ConcurrencyConflictError") {
              console.warn(
                `[update-queue] Conflito de concorrência detectado na conversa ${conversationId}. Versão esperada: ${expectedVersion}, atual: ${err.currentConv?.version}`
              );

              return new Response(
                JSON.stringify({
                  error: "Conflito de concorrência: a conversa foi modificada ou capturada por outro atendente.",
                  code: "CONCURRENCY_CONFLICT",
                  current: err.currentConv,
                }),
                { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
              );
            }
            throw err;
          }

          if (queueState !== "automacao") {
            SdrDebouncer.getInstance().clearSession(conversationId);
          }

          if (conv.operatorId !== targetOpId || conv.queueState !== queueState) {
            try {
              await recordCommercialTransfer(session.tenantId, conversationId, queueState === "meus" ? targetOpId : null, updatedConv.version, updatedConv.updatedAt);
            } catch (tmaError) {
              console.error("[update-queue] Falha ao registrar transferência comercial:", tmaError);
            }
          }

          // 7. Notificar SSE em tempo real para os atendentes conectados deste tenant
          const finalOperatorId = operatorId !== undefined ? operatorId : updatedConv.operatorId ?? null;
          const finalSectorId = sectorId !== undefined ? sectorId : updatedConv.sectorId ?? null;

          SessionManager.getInstance().notifyPublic(session.tenantId, {
            type: "queue_update",
            conversationId,
            queueState,
            operatorId: finalOperatorId,
            sectorId: finalSectorId,
            responsibleName: respName,
            version: updatedConv.version,
          });

          // 7b. Se foi uma transferência para outro operador em "Meus Atendimentos", avisa no chat do Fagner/Valentina do operador!
          if (
            queueState === "meus" &&
            finalOperatorId &&
            conv.operatorId !== finalOperatorId &&
            session.operator.id !== finalOperatorId
          ) {
            import("../../../lib/valentina/operator-notifications")
              .then(({ notifyOperatorLeadTransferred }) =>
                notifyOperatorLeadTransferred({
                  tenantId: session.tenantId,
                  operatorId: finalOperatorId,
                  operatorName: respName,
                  conversationId,
                  temperature: "quente",
                  transferSource: "manual_transfer",
                  transferredBy: session.operator.name || "Colega",
                }),
              )
              .catch((err) => console.warn("[update-queue] Falha ao enviar aviso IA de transferência:", err));
          }

          // 8. Se a conversa foi finalizada, enfileira auditoria de IA (apenas Valem no MVP)
          if (queueState === "finalizados" && session.tenantId === "valem") {
            auditService.enqueueAudit({
              tenantId: session.tenantId,
              conversationId,
              operatorId: finalOperatorId,
              contactName: null,
            }).catch((err) =>
              console.error("[update-queue] Erro ao enfileirar auditoria:", err)
            );
          }

          return new Response(
            JSON.stringify({
              success: true,
              conversationId,
              queueState,
              operatorId: finalOperatorId,
              sectorId: finalSectorId,
              responsibleName: respName,
              version: updatedConv.version,
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );

        } catch (e: any) {
          if (e instanceof DealContextError) return Response.json({ error: e.message, code: e.code }, { status: e.statusCode });
          console.error("[api/chats/update-queue] Erro ao atualizar fila da conversa:", e);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
