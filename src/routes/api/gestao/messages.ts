import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import {
  agentFlowStates,
  contacts,
  conversations,
  crmAccounts,
  crmConversationDeals,
  crmDealContacts,
  crmDealProducts,
  crmDeals,
  crmPipelines,
  crmStages,
  messages,
  operators,
  sectors,
} from "../../../db/schema";
import { eq, and, asc, desc, sql } from "drizzle-orm";
import { requireSession } from "../../../lib/auth-session";
import { requireConversationAccess } from "../../../lib/access-control/conversation-access";
import { resolveLeadPopupFields } from "../../../lib/valentina/operator-notifications";
import { isSiteConversationId } from "../../../lib/livechat/site-channel-policy";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function canAccessSupervisorMessages(session: any): boolean {
  if (session?.operator?.role === "admin") return true;
  if (session?.permissions?.views?.monitor !== true) return false;
  const mon = session?.permissions?.monitor;
  return Boolean(
    mon?.canAccessLive === true ||
      mon?.canAccessAlerts === true ||
      mon?.canAccessAudits === true ||
      mon?.canAccessTasks === true
  );
}

/**
 * GET /api/gestao/messages?tenantId=&conversationId=
 * Retorna TODAS as mensagens de uma conversa específica (sem limite) com metadados completos.
 *
 * POST /api/gestao/messages
 * Permite que a diretoria/supervisão envie um "Sussurro" (Nota Interna de Supervisão)
 * diretamente na conversa monitorada sem precisar capturar o atendimento do consultor.
 */
export const Route = createFileRoute("/api/gestao/messages")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      GET: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;

        const url = new URL(request.url);
        const queryTenantId = url.searchParams.get("tenantId");
        if (queryTenantId && queryTenantId !== tenantId) {
          return new Response(
            JSON.stringify({ error: "Acesso negado ao tenant especificado.", code: "FORBIDDEN" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const conversationId = url.searchParams.get("conversationId");

        if (!conversationId) {
          return new Response(
            JSON.stringify({ error: "conversationId é obrigatório" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        try {
          if (!canAccessSupervisorMessages(session)) {
            return Response.json({ error: "Permissão insuficiente." }, { status: 403 });
          }
          const denied = await requireConversationAccess(session, conversationId);
          if (denied) return denied;

          const rows = await db
            .select({
              id: messages.id,
              conversationId: messages.conversationId,
              senderType: messages.senderType,
              senderName: messages.senderName,
              content: messages.content,
              sentAt: messages.sentAt,
              isInternalNote: messages.isInternalNote,
              mediaInterpretation: messages.mediaInterpretation,
              status: messages.status,
              errorMessage: messages.errorMessage,
              quotedMessageId: messages.quotedMessageId,
              quotedMessageSender: messages.quotedMessageSender,
              quotedMessageContent: messages.quotedMessageContent,
              metaDetails: messages.metaDetails,
            })
            .from(messages)
            .where(
              and(
                eq(messages.tenantId, tenantId),
                eq(messages.conversationId, conversationId)
              )
            )
            .orderBy(asc(messages.sentAt)); // cronológico: mais antiga → mais recente

          const result = rows.map((m) => ({
            id: m.id,
            conversationId: m.conversationId,
            senderType: m.senderType,
            senderName: m.senderName,
            content: m.content,
            sentAt: m.sentAt instanceof Date ? m.sentAt.toISOString() : String(m.sentAt),
            isInternalNote: m.isInternalNote,
            mediaInterpretation: m.mediaInterpretation ?? null,
            status: m.status ?? "accepted",
            errorMessage: m.errorMessage ?? null,
            quotedMessageId: m.quotedMessageId ?? null,
            quotedMessageSender: m.quotedMessageSender ?? null,
            quotedMessageContent: m.quotedMessageContent ?? null,
            metaDetails: m.metaDetails ?? null,
          }));

          return new Response(JSON.stringify(result), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          console.error("[gestao/messages] Erro ao buscar mensagens:", e);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },

      POST: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;

        if (!canAccessSupervisorMessages(session)) {
          return new Response(
            JSON.stringify({ error: "Permissão insuficiente para enviar orientação de supervisão.", code: "FORBIDDEN" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        try {
          const body = (await request.json().catch(() => ({}))) as {
            conversationId?: string;
            content?: string;
            targetOperatorId?: string | null;
            source?: string | null;
            alertReason?: string | null;
          };

          const conversationId = String(body.conversationId || "").trim();
          const rawContent = String(body.content || "").trim();
          const requestedTargetOpId = body.targetOperatorId
            ? String(body.targetOperatorId).trim()
            : null;
          const requestSource = body.source ? String(body.source).trim().slice(0, 64) : null;
          const alertReason = body.alertReason ? String(body.alertReason).trim().slice(0, 240) : null;

          if (!conversationId || !rawContent) {
            return new Response(
              JSON.stringify({ error: "conversationId e content são obrigatórios." }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          if (rawContent.length > 4000) {
            return new Response(
              JSON.stringify({ error: "A orientação interna não pode exceder 4000 caracteres." }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          const denied = await requireConversationAccess(session, conversationId);
          if (denied) return denied;

          const [conv] = await db
            .select({
              id: conversations.id,
              contactId: conversations.contactId,
              convContactPhone: conversations.contactPhone,
              whatsappConnectionId: conversations.whatsappConnectionId,
              operatorId: conversations.operatorId,
              queueState: conversations.queueState,
              sectorId: conversations.sectorId,
              version: conversations.version,
              contactName: contacts.name,
              contactPhone: contacts.phone,
              contactAvatar: contacts.avatar,
              contactAccountId: contacts.accountId,
              contactCnpjDetails: contacts.cnpjDetails,
              contactMainChannel: contacts.mainChannel,
              walletOperatorId: contacts.walletOperatorId,
            })
            .from(conversations)
            .leftJoin(
              contacts,
              and(
                eq(conversations.contactId, contacts.id),
                eq(contacts.tenantId, tenantId)
              )
            )
            .where(
              and(
                eq(conversations.id, conversationId),
                eq(conversations.tenantId, tenantId)
              )
            )
            .limit(1);

          if (!conv) {
            return new Response(
              JSON.stringify({ error: "Conversa não encontrada." }),
              { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          let effectiveOperatorId = conv.operatorId || null;
          let effectiveOperatorName: string | null = null;
          let effectiveQueueState = conv.queueState;
          let didAssignOperator = false;
          let systemAssignMessage: {
            id: string;
            conversationId: string;
            senderType: "system";
            senderName: string;
            content: string;
            sentAt: string;
            isInternalNote: boolean;
            status: string;
          } | null = null;

          const targetLookupId = requestedTargetOpId || conv.operatorId || conv.walletOperatorId || null;
          if (targetLookupId) {
            const [opRow] = await db
              .select({ id: operators.id, name: operators.name })
              .from(operators)
              .where(
                and(
                  eq(operators.id, targetLookupId),
                  eq(operators.tenantId, tenantId)
                )
              )
              .limit(1);
            if (opRow) {
              effectiveOperatorName = opRow.name;
              if (requestedTargetOpId) {
                if (conv.operatorId !== opRow.id || conv.queueState !== "meus") {
                  didAssignOperator = true;
                }
                effectiveOperatorId = opRow.id;
                effectiveQueueState = "meus";
              } else if (!effectiveOperatorId) {
                effectiveOperatorId = opRow.id;
              }
            }
          }

          const now = new Date();
          const msgId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          const senderLabel = `${session.operator.name} (Supervisão)`;

          const shouldEmitAttentionPopup = Boolean(
            effectiveOperatorId &&
              (effectiveOperatorId !== session.operator.id ||
                requestedTargetOpId === session.operator.id ||
                requestSource === "monitor_alerts")
          );

          const supervisorAttention = effectiveOperatorId
            ? {
                at: now.toISOString(),
                operatorId: effectiveOperatorId,
                message: rawContent.slice(0, 600),
                by: session.operator.name,
                messageId: msgId,
              }
            : null;

          const whisperMetaDetails = {
            supervisorWhisper: true,
            hasSupervisorAttentionPopup: shouldEmitAttentionPopup,
            source: requestSource || "monitor",
            ...(alertReason ? { alertReason } : {}),
            targetOperatorId: effectiveOperatorId,
            targetOperatorName: effectiveOperatorName,
            attendanceActor: {
              name: session.operator.name,
              operatorId: session.operator.id,
              role: session.operator.role,
            },
          };

          if (didAssignOperator && effectiveOperatorId && effectiveOperatorName) {
            const sysMsgId = `msg-${Date.now() - 1}-${Math.random().toString(36).slice(2, 7)}`;
            const sysText = `Atendimento atribuído para ${effectiveOperatorName} pela Supervisão (${session.operator.name}).`;
            const sysTime = new Date(now.getTime() - 50);

            await db.insert(messages).values({
              id: sysMsgId,
              tenantId,
              conversationId,
              senderType: "system",
              senderName: "Sistema",
              content: sysText,
              isInternalNote: false,
              provider: "internal",
              direction: "outbound",
              status: "accepted",
              metaDetails: {
                supervisorIntervention: "transfer",
                attendanceActor: {
                  name: session.operator.name,
                  operatorId: session.operator.id,
                  role: session.operator.role,
                },
              },
              sentAt: sysTime,
              updatedAt: sysTime,
            });

            systemAssignMessage = {
              id: sysMsgId,
              conversationId,
              senderType: "system",
              senderName: "Sistema",
              content: sysText,
              sentAt: sysTime.toISOString(),
              isInternalNote: false,
              status: "accepted",
            };
          }

          await db.insert(messages).values({
            id: msgId,
            tenantId,
            conversationId,
            senderType: "agent",
            senderName: senderLabel,
            content: rawContent,
            isInternalNote: true,
            provider: "internal",
            direction: "outbound",
            status: "accepted",
            metaDetails: whisperMetaDetails,
            sentAt: now,
            updatedAt: now,
          });

          await db
            .update(conversations)
            .set({
              ...(didAssignOperator && effectiveOperatorId
                ? {
                    operatorId: effectiveOperatorId,
                    queueState: "meus",
                    version: sql`COALESCE(${conversations.version}, 1) + 1`,
                  }
                : {}),
              ...(effectiveOperatorId
                ? {
                    supervisorAttentionAt: now,
                    supervisorAttentionOperatorId: effectiveOperatorId,
                    supervisorAttentionMessage: rawContent.slice(0, 600),
                    supervisorAttentionBy: session.operator.name,
                    supervisorAttentionMessageId: msgId,
                  }
                : {}),
              lastMessageTime: now,
              unreadCount: sql`COALESCE(${conversations.unreadCount}, 0) + 1`,
              updatedAt: now,
            })
            .where(
              and(
                eq(conversations.id, conversationId),
                eq(conversations.tenantId, tenantId)
              )
            );

          // Enriquecer contexto do cliente (empresa, máquina/produto, negociação, setor e última mensagem) para o pop-up
          let popupClientName = conv.contactName || "Cliente";
          let popupCompany: string | null = null;
          let popupMachine: string | null = null;
          let popupDealId: string | null = null;
          let popupDealTitle: string | null = null;
          let popupDealPipelineName: string | null = null;
          let popupDealStageName: string | null = null;
          let popupSectorName: string | null = null;
          let popupLastClientMessage: string | null = null;

          const effectiveClientPhone = conv.convContactPhone || conv.contactPhone || null;
          const effectiveChannel = isSiteConversationId(conv.id)
            ? "livechat"
            : conv.whatsappConnectionId
              ? "whatsapp"
              : conv.contactMainChannel === "livechat"
                ? "whatsapp"
                : conv.contactMainChannel || "whatsapp";

          if (shouldEmitAttentionPopup) {
            try {
              const [sectorRow, contactAccountRow, flowRow, lastClientMsgRow, convDealLink] =
                await Promise.all([
                  conv.sectorId
                    ? db
                        .select({ name: sectors.name })
                        .from(sectors)
                        .where(and(eq(sectors.id, conv.sectorId), eq(sectors.tenantId, tenantId)))
                        .limit(1)
                        .then((r) => r[0] || null)
                        .catch(() => null)
                    : Promise.resolve(null),
                  conv.contactAccountId
                    ? db
                        .select({ name: crmAccounts.name, tradeName: crmAccounts.tradeName })
                        .from(crmAccounts)
                        .where(
                          and(
                            eq(crmAccounts.id, conv.contactAccountId),
                            eq(crmAccounts.tenantId, tenantId)
                          )
                        )
                        .limit(1)
                        .then((r) => r[0] || null)
                        .catch(() => null)
                    : Promise.resolve(null),
                  db
                    .select({
                      collectedData: agentFlowStates.collectedData,
                      metadata: agentFlowStates.metadata,
                    })
                    .from(agentFlowStates)
                    .where(
                      and(
                        eq(agentFlowStates.tenantId, tenantId),
                        eq(agentFlowStates.conversationId, conversationId)
                      )
                    )
                    .orderBy(desc(agentFlowStates.lastInteractionAt))
                    .limit(1)
                    .then((r) => r[0] || null)
                    .catch(() => null),
                  db
                    .select({ content: messages.content })
                    .from(messages)
                    .where(
                      and(
                        eq(messages.tenantId, tenantId),
                        eq(messages.conversationId, conversationId),
                        eq(messages.senderType, "client"),
                        eq(messages.isInternalNote, false)
                      )
                    )
                    .orderBy(desc(messages.sentAt))
                    .limit(1)
                    .then((r) => r[0] || null)
                    .catch(() => null),
                  db
                    .select({
                      dealId: crmDeals.id,
                      dealTitle: crmDeals.title,
                      dealAccountId: crmDeals.accountId,
                      pipelineName: crmPipelines.name,
                      stageName: crmStages.name,
                      status: crmDeals.status,
                    })
                    .from(crmConversationDeals)
                    .innerJoin(
                      crmDeals,
                      and(
                        eq(crmDeals.id, crmConversationDeals.dealId),
                        eq(crmDeals.tenantId, tenantId)
                      )
                    )
                    .leftJoin(
                      crmPipelines,
                      and(eq(crmPipelines.id, crmDeals.pipelineId), eq(crmPipelines.tenantId, tenantId))
                    )
                    .leftJoin(
                      crmStages,
                      and(eq(crmStages.id, crmDeals.stageId), eq(crmStages.tenantId, tenantId))
                    )
                    .where(
                      and(
                        eq(crmConversationDeals.tenantId, tenantId),
                        eq(crmConversationDeals.conversationId, conversationId),
                        eq(crmConversationDeals.isActive, true)
                      )
                    )
                    .orderBy(desc(crmDeals.updatedAt))
                    .limit(1)
                    .then((r) => r[0] || null)
                    .catch(() => null),
                ]);

              popupSectorName = sectorRow?.name || null;
              popupLastClientMessage = lastClientMsgRow?.content?.trim()?.slice(0, 260) || null;

              let activeDeal = convDealLink;
              if (!activeDeal && conv.contactId) {
                activeDeal = await db
                  .select({
                    dealId: crmDeals.id,
                    dealTitle: crmDeals.title,
                    dealAccountId: crmDeals.accountId,
                    pipelineName: crmPipelines.name,
                    stageName: crmStages.name,
                    status: crmDeals.status,
                  })
                  .from(crmDealContacts)
                  .innerJoin(
                    crmDeals,
                    and(eq(crmDeals.id, crmDealContacts.dealId), eq(crmDeals.tenantId, tenantId))
                  )
                  .leftJoin(
                    crmPipelines,
                    and(eq(crmPipelines.id, crmDeals.pipelineId), eq(crmPipelines.tenantId, tenantId))
                  )
                  .leftJoin(
                    crmStages,
                    and(eq(crmStages.id, crmDeals.stageId), eq(crmStages.tenantId, tenantId))
                  )
                  .where(
                    and(
                      eq(crmDealContacts.tenantId, tenantId),
                      eq(crmDealContacts.contactId, conv.contactId)
                    )
                  )
                  .orderBy(
                    sql`CASE WHEN ${crmDeals.status} = 'open' THEN 0 ELSE 1 END`,
                    desc(crmDeals.updatedAt)
                  )
                  .limit(1)
                  .then((r) => r[0] || null)
                  .catch(() => null);
              }

              let dealAccountRow: { name: string; tradeName: string | null } | null = null;
              let dealProductNames: string[] = [];
              if (activeDeal) {
                popupDealId = activeDeal.dealId;
                popupDealTitle = activeDeal.dealTitle;
                popupDealPipelineName = activeDeal.pipelineName || null;
                popupDealStageName = activeDeal.stageName || null;

                const [accRow, prodRows] = await Promise.all([
                  activeDeal.dealAccountId
                    ? db
                        .select({ name: crmAccounts.name, tradeName: crmAccounts.tradeName })
                        .from(crmAccounts)
                        .where(
                          and(
                            eq(crmAccounts.id, activeDeal.dealAccountId),
                            eq(crmAccounts.tenantId, tenantId)
                          )
                        )
                        .limit(1)
                        .then((r) => r[0] || null)
                        .catch(() => null)
                    : Promise.resolve(null),
                  db
                    .select({ name: crmDealProducts.name })
                    .from(crmDealProducts)
                    .where(
                      and(
                        eq(crmDealProducts.tenantId, tenantId),
                        eq(crmDealProducts.dealId, activeDeal.dealId)
                      )
                    )
                    .limit(5)
                    .catch(() => []),
                ]);
                dealAccountRow = accRow;
                dealProductNames = prodRows.map((p) => p.name).filter(Boolean);
              }

              const flowMeta = (flowRow?.metadata as Record<string, any> | null) || null;
              const resolved = resolveLeadPopupFields({
                contactName: conv.contactName,
                accountTradeName: contactAccountRow?.tradeName ?? null,
                accountName: contactAccountRow?.name ?? null,
                dealAccountTradeName: dealAccountRow?.tradeName ?? null,
                dealAccountName: dealAccountRow?.name ?? null,
                cnpjDetails: (conv.contactCnpjDetails as Record<string, any> | null) ?? null,
                collectedData: (flowRow?.collectedData as Record<string, any> | null) ?? null,
                machineDecision: (flowMeta?.machineDecision as { machineId?: string | null } | null) ?? null,
                dealProductNames,
                dealTitle: popupDealTitle,
                targetFunnel: (flowMeta?.targetFunnel as string | null) ?? popupDealPipelineName,
              });

              popupClientName = resolved.clientName;
              popupCompany = resolved.company;
              popupMachine = resolved.machine;
            } catch (enrichErr: any) {
              console.warn(
                "[gestao/messages POST] Falha não-crítica ao enriquecer contexto do cliente:",
                enrichErr?.message
              );
            }
          }

          // Notificar via SSE para aparecer instantaneamente (com alerta sonoro + pop-up + tag ATENÇÃO!) na tela do consultor
          try {
            const { SessionManager } = await import("../../../lib/baileys/session-manager");
            if (didAssignOperator && effectiveOperatorId) {
              SessionManager.getInstance().notifyPublic(tenantId, {
                type: "queue_update",
                conversationId,
                queueState: "meus",
                operatorId: effectiveOperatorId,
                sectorId: conv.sectorId,
                responsibleName: effectiveOperatorName || undefined,
                version: (conv.version || 1) + 1,
                supervisorAttention,
              });
            }
            if (systemAssignMessage) {
              SessionManager.getInstance().notifyPublic(tenantId, {
                type: "message",
                message: systemAssignMessage,
              });
            }
            SessionManager.getInstance().notifyPublic(tenantId, {
              type: "message",
              message: {
                id: msgId,
                conversationId,
                senderType: "agent",
                senderName: senderLabel,
                content: rawContent,
                isInternalNote: true,
                isSupervisorWhisper: true,
                sentAt: now.toISOString(),
                status: "accepted",
                operatorId: effectiveOperatorId,
                walletOperatorId: conv.walletOperatorId ?? null,
                queue: effectiveQueueState,
                phone: effectiveClientPhone ?? undefined,
                avatar: conv.contactAvatar ?? undefined,
                contactName: conv.contactName ?? "Cliente",
                metaDetails: whisperMetaDetails,
                supervisorAttention,
              },
            });
            if (shouldEmitAttentionPopup && effectiveOperatorId) {
              SessionManager.getInstance().notifyPublic(tenantId, {
                type: "supervisor_attention_alert",
                tenantId,
                operatorId: effectiveOperatorId,
                alert: {
                  id: msgId,
                  tenantId,
                  operatorId: effectiveOperatorId,
                  conversationId,
                  supervisorName: session.operator.name,
                  supervisorRole: session.operator.role,
                  warningText: rawContent,
                  source: requestSource || "monitor",
                  alertReason,
                  didAssignOperator,
                  clientName: popupClientName,
                  clientPhone: effectiveClientPhone,
                  clientAvatar: conv.contactAvatar ?? null,
                  company: popupCompany,
                  machine: popupMachine,
                  dealId: popupDealId,
                  dealTitle: popupDealTitle,
                  dealPipelineName: popupDealPipelineName,
                  dealStageName: popupDealStageName,
                  channel: effectiveChannel,
                  sectorName: popupSectorName,
                  lastClientMessage: popupLastClientMessage,
                  receivedAt: now.toISOString(),
                },
              });
            }
          } catch (sseErr: any) {
            console.warn("[gestao/messages POST] Falha não-crítica ao emitir SSE:", sseErr?.message);
          }

          return new Response(
            JSON.stringify({
              success: true,
              assignedOperatorId: effectiveOperatorId,
              assignedOperatorName: effectiveOperatorName,
              assignedQueueState: effectiveQueueState,
              didAssignOperator,
              supervisorAttention,
              popupDispatched: shouldEmitAttentionPopup,
              message: {
                id: msgId,
                conversationId,
                senderType: "agent",
                senderName: senderLabel,
                content: rawContent,
                sentAt: now.toISOString(),
                isInternalNote: true,
                isSupervisorWhisper: true,
                status: "accepted",
                metaDetails: whisperMetaDetails,
              },
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        } catch (e: any) {
          console.error("[gestao/messages POST] Erro ao enviar sussurro de supervisão:", e);
          return new Response(
            JSON.stringify({ error: e.message || "Erro interno ao salvar orientação." }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      },
    },
  },
});
