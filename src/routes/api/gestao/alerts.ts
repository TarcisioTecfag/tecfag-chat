import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import {
  responseTimeLogs,
  conversations,
  contacts,
  crmAccounts,
  operators,
} from "../../../db/schema";
import { eq, isNull, and, ne, desc, sql } from "drizzle-orm";
import { getComercialOperatorIds } from "../../../lib/gestao-filter";
import { SlaEngine } from "../../../lib/sla-engine";
import { AuditService } from "../../../lib/audit-service";
import { SupervisorEngine } from "../../../lib/valentina/supervisor-engine";
import { requireSession } from "../../../lib/auth-session";
import { conversationReadCondition } from "../../../lib/access-control/conversation-access";
import { computeOperatorPresenceSnapshot, getBrtDateKey } from "../../../lib/operator-presence";
import type {
  AlertCategoryTag,
  AlertItem,
  AlertOperatorBottleneck,
  AlertPrimaryType,
  AlertsExecutiveSummary,
  LiveDealSummary,
  LiveMessage,
} from "../../../lib/monitor-mock-data";

// Inicializa os engines na primeira request desta rota (lazy init)
SlaEngine.getInstance().start();
AuditService.getInstance().start();
SupervisorEngine.getInstance().start();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const BOILERPLATE_SYSTEM_RE =
  /^(Contato criado\.?|Contato criado\.\s*Aguardando captura do atendimento\.?|Atendimento iniciado\.?|Conversa iniciada\.?|Aguardando captura do atendimento\.?)$/i;

const CONFLICT_KEYWORDS = [
  "horrivel",
  "horrível",
  "pessimo",
  "péssimo",
  "atendimento ruim",
  "atendimento horrivel",
  "atendimento horrível",
  "descaso",
  "absurdo",
  "palhaçada",
  "palhacada",
  "cancelar",
  "cancelamento",
  "devolver",
  "devolução",
  "devolucao",
  "estorno",
  "reembolso",
  "procon",
  "reclame aqui",
  "advogado",
  "processo judicial",
  "vou processar",
  "atraso",
  "atrasado",
  "não entregou",
  "nao entregou",
  "máquina parada",
  "maquina parada",
  "produção parada",
  "producao parada",
  "veio com defeito",
  "veio errado",
  "ninguém responde",
  "ninguem responde",
  "ninguém atende",
  "ninguem atende",
  "falta de respeito",
  "insatisfeito",
  "insatisfeita",
  "desistir da compra",
];

function extractRows<T = any>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && Array.isArray((result as any).rows)) {
    return (result as any).rows as T[];
  }
  return [];
}

function parseMediaContent(
  content: string | null | undefined,
  transcription?: string | null
): {
  preview: string;
  mediaType: string | null;
  mediaId: string | null;
} {
  const raw = (content || "").trim();
  if (!raw) {
    return { preview: "Aguardando retorno do atendimento...", mediaType: null, mediaId: null };
  }

  const match = raw.match(/^\[MEDIA:(image|video|audio|document|sticker|contact|location)\]([^\n]*)(?:\n([\s\S]*))?$/i);
  if (!match) {
    return { preview: raw, mediaType: null, mediaId: null };
  }

  const mediaType = match[1].toLowerCase();
  const mediaId = (match[2] || "").trim() || null;
  const caption = (match[3] || "").trim();

  if (mediaType === "audio") {
    const cleanTranscript = (transcription || "").trim();
    if (cleanTranscript) {
      return {
        preview: `🎤 Áudio: "${cleanTranscript}"`,
        mediaType: "audio",
        mediaId,
      };
    }
    return {
      preview: caption ? `🎤 Áudio · ${caption}` : "🎤 Mensagem de áudio enviada pelo cliente",
      mediaType: "audio",
      mediaId,
    };
  }

  const labelMap: Record<string, string> = {
    image: "📷 Imagem",
    video: "🎥 Vídeo",
    document: "📄 Documento",
    sticker: "🏷️ Figurinha",
    contact: "👤 Contato compartilhado",
    location: "📍 Localização compartilhada",
  };
  const baseLabel = labelMap[mediaType] || "📎 Anexo";
  return {
    preview: caption ? `${baseLabel}: ${caption}` : `${baseLabel} enviado na conversa`,
    mediaType,
    mediaId,
  };
}

function detectConflictKeyword(text: string | null | undefined): string | null {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const kw of CONFLICT_KEYWORDS) {
    if (lower.includes(kw)) {
      return kw;
    }
  }
  return null;
}

export const Route = createFileRoute("/api/gestao/alerts")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      GET: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;

        const canViewAlerts =
          (session.permissions?.views?.monitor === true &&
            session.permissions?.monitor?.canAccessAlerts === true) ||
          (session.permissions?.views?.analytics === true &&
            session.permissions?.analytics?.canAccessOverview === true);
        if (!canViewAlerts) {
          return new Response(
            JSON.stringify({
              error: "Permissão insuficiente para acessar alertas.",
              code: "FORBIDDEN",
            }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const url = new URL(request.url);
        const queryTenantId = url.searchParams.get("tenantId");
        if (queryTenantId && queryTenantId !== tenantId) {
          return new Response(
            JSON.stringify({
              error: "Acesso negado ao tenant especificado.",
              code: "FORBIDDEN",
            }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const includeSummary = url.searchParams.get("summary") === "1";

        try {
          const now = new Date();
          const nowMs = now.getTime();
          const todayBrt = getBrtDateKey(now);

          // 1. Operadores do tenant + presença online em tempo real + filtro comercial
          const [opList, comercialIds] = await Promise.all([
            db.select().from(operators).where(eq(operators.tenantId, tenantId)),
            getComercialOperatorIds(tenantId),
          ]);

          const opMap = new Map(
            opList.map((op) => {
              const presence = computeOperatorPresenceSnapshot(op, now);
              return [
                op.id,
                {
                  ...op,
                  isOnline: presence.isOnline,
                  lastSeenAtIso: presence.lastSeenAtIso,
                },
              ];
            })
          );

          // 2. Buscar todas as conversas ativas (não finalizadas) do tenant respeitando RBAC
          const activeConvs = await db
            .select({
              id: conversations.id,
              operatorId: conversations.operatorId,
              contactId: conversations.contactId,
              queueState: conversations.queueState,
              lastMessageTime: conversations.lastMessageTime,
              lastMessageText: conversations.lastMessageText,
              createdAt: conversations.createdAt,
              contactName: contacts.name,
              contactPhone: contacts.phone,
              contactEmail: contacts.email,
              contactAvatar: contacts.avatar,
              crmCardUrl: contacts.rdCrmDealLink,
              accountName: crmAccounts.name,
              accountTradeName: crmAccounts.tradeName,
              accountDocument: crmAccounts.document,
            })
            .from(conversations)
            .innerJoin(
              contacts,
              and(eq(conversations.contactId, contacts.id), eq(contacts.tenantId, tenantId))
            )
            .leftJoin(
              crmAccounts,
              and(eq(contacts.accountId, crmAccounts.id), eq(crmAccounts.tenantId, tenantId))
            )
            .where(
              and(
                eq(conversations.tenantId, tenantId),
                conversationReadCondition(session),
                ne(conversations.queueState, "finalizados")
              )
            )
            .orderBy(desc(conversations.lastMessageTime));

          // Filtrar conversas elegíveis ao monitoramento comercial:
          // - Conversas na fila humana sem operador ("fila") SEMPRE entram
          // - Conversas com operador entram se comercialIds === null ou operador está em comercialIds
          const eligibleConvs = activeConvs.filter((c) => {
            if (!c.operatorId && c.queueState === "fila") return true;
            if (c.operatorId && comercialIds !== null) {
              return comercialIds.includes(c.operatorId);
            }
            return true;
          });

          const eligibleIds = eligibleConvs.map((c) => c.id);

          // 3. Buscar logs SLA pendentes abertos (para obter logId e threshold customizado se houver)
          const openSlaLogs = await db
            .select({
              id: responseTimeLogs.id,
              conversationId: responseTimeLogs.conversationId,
              clientMessageAt: responseTimeLogs.clientMessageAt,
              overdueThresholdSeconds: responseTimeLogs.overdueThresholdSeconds,
            })
            .from(responseTimeLogs)
            .where(
              and(
                eq(responseTimeLogs.tenantId, tenantId),
                isNull(responseTimeLogs.agentResponseId)
              )
            )
            .orderBy(desc(responseTimeLogs.clientMessageAt));

          const openLogByConv = new Map<
            string,
            { id: string; clientMessageAt: Date; overdueThresholdSeconds: number }
          >();
          for (const log of openSlaLogs) {
            if (!openLogByConv.has(log.conversationId)) {
              openLogByConv.set(log.conversationId, log);
            }
          }

          // 4. Buscar últimas 18 mensagens por conversa ativa via Window Function (zero N+1)
          const messagesByConv = new Map<string, LiveMessage[]>();
          const dealByConvMap = new Map<string, LiveDealSummary>();
          const tasksByConvMap = new Map<
            string,
            { openCount: number; overdueCount: number; nextTitle: string | null }
          >();
          const sentimentByConvMap = new Map<string, string>();

          if (eligibleIds.length > 0) {
            const idParams = sql.join(
              eligibleIds.map((id) => sql`${id}`),
              sql`, `
            );

            const [rawMsgsResult, dealRowsResult, taskRowsResult, auditRowsResult] =
              await Promise.all([
                db.execute(sql`
                  SELECT
                    id,
                    conversation_id AS "conversationId",
                    sender_type AS "senderType",
                    sender_name AS "senderName",
                    content,
                    sent_at AS "sentAt",
                    is_internal_note AS "isInternalNote",
                    media_interpretation AS "mediaInterpretation",
                    status,
                    error_message AS "errorMessage",
                    quoted_message_id AS "quotedMessageId",
                    quoted_message_sender AS "quotedMessageSender",
                    quoted_message_content AS "quotedMessageContent",
                    meta_details AS "metaDetails"
                  FROM (
                    SELECT
                      m.*,
                      ROW_NUMBER() OVER (PARTITION BY m.conversation_id ORDER BY m.sent_at DESC) AS rn
                    FROM messages m
                    WHERE m.tenant_id = ${tenantId}
                      AND m.conversation_id IN (${idParams})
                  ) ranked
                  WHERE ranked.rn <= 18
                  ORDER BY ranked.conversation_id, ranked.sent_at ASC
                `),

                db
                  .execute(sql`
                    SELECT DISTINCT ON (conv_id)
                      conv_id AS "conversationId",
                      d.id AS "dealId",
                      d.title AS "title",
                      d.value AS "value",
                      d.status AS "status",
                      d.rating AS "rating",
                      p.name AS "pipelineName",
                      s.name AS "stageName"
                    FROM (
                      SELECT c.id AS conv_id, cdc.current_deal_id AS deal_id, 1 AS priority
                      FROM conversations c
                      INNER JOIN conversation_deal_contexts cdc
                        ON cdc.conversation_id = c.id AND cdc.tenant_id = ${tenantId}
                      WHERE c.tenant_id = ${tenantId}
                        AND c.id IN (${idParams})
                        AND cdc.current_deal_id IS NOT NULL

                      UNION ALL

                      SELECT ccd.conversation_id AS conv_id, ccd.deal_id AS deal_id, 2 AS priority
                      FROM crm_conversation_deals ccd
                      WHERE ccd.tenant_id = ${tenantId}
                        AND ccd.conversation_id IN (${idParams})
                        AND ccd.is_active = true

                      UNION ALL

                      SELECT c.id AS conv_id, dc.deal_id AS deal_id, 3 AS priority
                      FROM conversations c
                      INNER JOIN crm_deal_contacts dc
                        ON dc.contact_id = c.contact_id AND dc.tenant_id = ${tenantId}
                      WHERE c.tenant_id = ${tenantId}
                        AND c.id IN (${idParams})
                    ) links
                    INNER JOIN crm_deals d
                      ON d.id = links.deal_id AND d.tenant_id = ${tenantId}
                    LEFT JOIN crm_pipelines p
                      ON p.id = d.pipeline_id AND p.tenant_id = ${tenantId}
                    LEFT JOIN crm_stages s
                      ON s.id = d.stage_id AND s.tenant_id = ${tenantId}
                    ORDER BY
                      conv_id,
                      CASE WHEN d.status = 'open' THEN 0 ELSE 1 END ASC,
                      links.priority ASC,
                      d.updated_at DESC
                  `)
                  .catch(() => []),

                db
                  .execute(sql`
                    SELECT
                      t.chat_conversation_id AS "conversationId",
                      COUNT(*)::int AS "openCount",
                      COUNT(*) FILTER (WHERE t.due_date IS NOT NULL AND t.due_date < NOW())::int AS "overdueCount",
                      (ARRAY_AGG(t.name ORDER BY t.due_date ASC NULLS LAST))[1] AS "nextTitle"
                    FROM tasks t
                    WHERE t.tenant_id = ${tenantId}
                      AND t.chat_conversation_id IN (${idParams})
                      AND t.status NOT IN ('done', 'completed', 'cancelled')
                    GROUP BY t.chat_conversation_id
                  `)
                  .catch(() => []),

                db
                  .execute(sql`
                    SELECT DISTINCT ON (conversation_id)
                      conversation_id AS "conversationId",
                      client_sentiment AS "clientSentiment",
                      had_rude_language AS "hadRudeLanguage"
                    FROM ai_conversation_audits
                    WHERE tenant_id = ${tenantId}
                      AND conversation_id IN (${idParams})
                    ORDER BY conversation_id, audited_at DESC
                  `)
                  .catch(() => []),
              ]);

            for (const msg of extractRows(rawMsgsResult)) {
              const cid = msg.conversationId;
              const list = messagesByConv.get(cid) || [];
              list.push({
                id: msg.id,
                conversationId: cid,
                senderType: msg.senderType,
                senderName: msg.senderName,
                content: msg.content,
                sentAt:
                  msg.sentAt instanceof Date
                    ? msg.sentAt.toISOString()
                    : String(msg.sentAt),
                isInternalNote: Boolean(msg.isInternalNote),
                mediaInterpretation: msg.mediaInterpretation ?? null,
                status: msg.status ?? "accepted",
                errorMessage: msg.errorMessage ?? null,
                quotedMessageId: msg.quotedMessageId ?? null,
                quotedMessageSender: msg.quotedMessageSender ?? null,
                quotedMessageContent: msg.quotedMessageContent ?? null,
                metaDetails: msg.metaDetails ?? null,
              });
              messagesByConv.set(cid, list);
            }

            for (const row of extractRows(dealRowsResult)) {
              dealByConvMap.set(row.conversationId, {
                id: row.dealId,
                title: row.title,
                value:
                  row.value !== null && row.value !== undefined ? Number(row.value) : null,
                status: row.status || "open",
                pipelineName: row.pipelineName || null,
                stageName: row.stageName || null,
                rating: Number(row.rating || 0),
              });
            }

            for (const row of extractRows(taskRowsResult)) {
              tasksByConvMap.set(row.conversationId, {
                openCount: Number(row.openCount || 0),
                overdueCount: Number(row.overdueCount || 0),
                nextTitle: row.nextTitle || null,
              });
            }

            for (const row of extractRows(auditRowsResult)) {
              if (row.clientSentiment) {
                sentimentByConvMap.set(row.conversationId, String(row.clientSentiment));
              } else if (row.hadRudeLanguage) {
                sentimentByConvMap.set(row.conversationId, "frustrado");
              }
            }
          }

          // 5. Construir lista unificada de Alertas Reais da Operação
          const alerts: AlertItem[] = [];
          const staleLogConvIdsToClose: { convId: string; agentMsgId: string; sentAt: Date; opId: string | null }[] = [];

          for (const conv of eligibleConvs) {
            const msgs = messagesByConv.get(conv.id) || [];
            const realMsgs = msgs.filter(
              (m) => !m.isInternalNote && m.senderType !== "system"
            );
            const lastRealMsg = realMsgs[realMsgs.length - 1];
            const lastAnyMsg = msgs[msgs.length - 1];

            const rawLastText = (conv.lastMessageText || lastAnyMsg?.content || "").trim();
            const hasRealInteraction =
              realMsgs.length > 0 ||
              (Boolean(rawLastText) && !BOILERPLATE_SYSTEM_RE.test(rawLastText));

            if (!hasRealInteraction) continue;

            const openLog = openLogByConv.get(conv.id);
            const thresholdSeconds = openLog?.overdueThresholdSeconds || 900; // 15 min padrão

            // Auto-cura: se existe log aberto no banco, mas o operador já respondeu por último, fecha o log órfão!
            if (
              openLog &&
              lastRealMsg &&
              (lastRealMsg.senderType === "agent" || lastRealMsg.senderType === "bot") &&
              lastRealMsg.sentAt
            ) {
              staleLogConvIdsToClose.push({
                convId: conv.id,
                agentMsgId: lastRealMsg.id,
                sentAt: new Date(lastRealMsg.sentAt),
                opId: conv.operatorId ?? null,
              });
            }

            // Cálculo real do tempo de espera sem resposta
            let isUnanswered = false;
            let waitingSeconds = 0;
            let waitingMinutes = 0;
            let clientWaitStartIso: string | null = null;
            let referenceClientMsg: LiveMessage | undefined;

            if (lastRealMsg && lastRealMsg.senderType === "client") {
              isUnanswered = true;
              let firstUnanswered = lastRealMsg;
              for (let i = realMsgs.length - 2; i >= 0; i--) {
                if (realMsgs[i].senderType === "client") {
                  firstUnanswered = realMsgs[i];
                } else {
                  break;
                }
              }
              referenceClientMsg = lastRealMsg;
              const startMs = firstUnanswered.sentAt
                ? new Date(firstUnanswered.sentAt).getTime()
                : openLog
                ? new Date(openLog.clientMessageAt).getTime()
                : new Date(conv.lastMessageTime).getTime();

              if (!Number.isNaN(startMs)) {
                waitingSeconds = Math.max(0, Math.floor((nowMs - startMs) / 1000));
                waitingMinutes = Math.floor(waitingSeconds / 60);
                clientWaitStartIso = new Date(startMs).toISOString();
              }
            } else if (conv.queueState === "fila" && !conv.operatorId) {
              isUnanswered = true;
              const refMs = new Date(lastRealMsg?.sentAt || conv.lastMessageTime).getTime();
              if (!Number.isNaN(refMs)) {
                waitingSeconds = Math.max(0, Math.floor((nowMs - refMs) / 1000));
                waitingMinutes = Math.floor(waitingSeconds / 60);
                clientWaitStartIso = new Date(refMs).toISOString();
              }
            }

            // Janela de 24h da Meta
            const lastClientMsg = [...realMsgs]
              .reverse()
              .find((m) => m.senderType === "client");
            const lastClientAtMs = lastClientMsg?.sentAt
              ? new Date(lastClientMsg.sentAt).getTime()
              : null;
            const elapsedSinceLastClientMs =
              lastClientAtMs !== null ? nowMs - lastClientAtMs : null;
            const metaWindowOpen =
              elapsedSinceLastClientMs !== null &&
              elapsedSinceLastClientMs >= 0 &&
              elapsedSinceLastClientMs < 24 * 60 * 60 * 1000;
            const metaWindowRemainingMinutes = metaWindowOpen
              ? Math.max(
                  1,
                  Math.floor(
                    (24 * 60 * 60 * 1000 - (elapsedSinceLastClientMs as number)) / 60000
                  )
                )
              : null;

            // Falhas de entrega recentes (últimas 48h)
            const recentFailedMsgs = realMsgs.filter((m) => {
              if (m.status !== "failed") return false;
              const mTime = m.sentAt ? new Date(m.sentAt).getTime() : 0;
              return nowMs - mTime <= 48 * 60 * 60 * 1000;
            });
            const failedMessagesCount = recentFailedMsgs.length;
            const lastFailedMsg = recentFailedMsgs[recentFailedMsgs.length - 1];

            // Detecção de Conflito / Atrito (texto + transcrição de áudio + sentimento IA)
            let conflictTriggerText: string | null = null;
            const recentClientMsgs = realMsgs
              .filter((m) => m.senderType === "client")
              .slice(-4);

            for (const cMsg of recentClientMsgs) {
              const kwFromContent = detectConflictKeyword(cMsg.content);
              const kwFromAudio = detectConflictKeyword(cMsg.mediaInterpretation);
              const matchedKw = kwFromContent || kwFromAudio;
              if (matchedKw) {
                const msgAgeHours = cMsg.sentAt
                  ? (nowMs - new Date(cMsg.sentAt).getTime()) / 3600000
                  : 0;
                if (isUnanswered || msgAgeHours <= 36) {
                  conflictTriggerText = matchedKw;
                  break;
                }
              }
            }

            const clientSentiment = sentimentByConvMap.get(conv.id) || null;
            const hasNegativeAuditSentiment =
              (isUnanswered || (elapsedSinceLastClientMs !== null && elapsedSinceLastClientMs <= 36 * 3600 * 1000)) &&
              (clientSentiment === "frustrado" ||
                clientSentiment === "irritado" ||
                clientSentiment === "insatisfeito");

            const isConflictRisk = Boolean(conflictTriggerText) || hasNegativeAuditSentiment;

            // Contexto CRM & Tarefas
            const activeDeal = dealByConvMap.get(conv.id) || null;
            const tasksInfo = tasksByConvMap.get(conv.id) || {
              openCount: 0,
              overdueCount: 0,
              nextTitle: null,
            };

            // Classificação nas Categorias de Alerta
            const alertTags: AlertCategoryTag[] = [];

            const isInAutomation = conv.queueState === "automacao";
            const isUnassignedQueue = !conv.operatorId && conv.queueState === "fila";

            if (isUnassignedQueue && waitingMinutes >= 1) {
              alertTags.push("unassigned_queue");
            }

            if (!isInAutomation && isUnanswered) {
              if (waitingSeconds >= thresholdSeconds) {
                alertTags.push("sla_critical");
              } else if (waitingMinutes >= 5 || openLog) {
                alertTags.push("sla_warning");
              }
            }

            if (isConflictRisk) {
              alertTags.push("conflict_risk");
            }

            if (
              metaWindowOpen &&
              metaWindowRemainingMinutes !== null &&
              metaWindowRemainingMinutes <= 180 &&
              (isUnanswered || tasksInfo.openCount > 0 || activeDeal?.status === "open")
            ) {
              alertTags.push("meta_window_expiring");
            }

            if (failedMessagesCount > 0) {
              alertTags.push("delivery_failed");
            }

            if (tasksInfo.overdueCount > 0 && (isUnanswered || activeDeal?.status === "open")) {
              alertTags.push("overdue_task");
            }

            // Se a conversa não tem nenhuma tag de risco e não está aguardando resposta humana, não é um alerta
            if (alertTags.length === 0 && !(isUnanswered && !isInAutomation && waitingMinutes >= 2)) {
              continue;
            }

            // Se entrou por espera recente (2-4 min) sem outra tag, marca como sla_warning
            if (alertTags.length === 0 && isUnanswered && !isInAutomation) {
              alertTags.push("sla_warning");
            }

            // Determinar tipo primário do alerta por prioridade executiva
            let alertType: AlertPrimaryType = "sla";
            if (alertTags.includes("conflict_risk")) {
              alertType = "conflict";
            } else if (alertTags.includes("delivery_failed")) {
              alertType = "delivery_failure";
            } else if (alertTags.includes("unassigned_queue")) {
              alertType = "queue";
            } else if (
              alertTags.includes("sla_critical") ||
              alertTags.includes("sla_warning")
            ) {
              alertType = "sla";
            } else if (alertTags.includes("meta_window_expiring")) {
              alertType = "meta_window";
            } else if (alertTags.includes("overdue_task")) {
              alertType = "overdue_task";
            }

            const isOverdue =
              alertTags.includes("sla_critical") ||
              (isUnassignedQueue && waitingMinutes >= 10) ||
              alertTags.includes("conflict_risk") ||
              alertTags.includes("delivery_failed");

            const isCritical =
              waitingSeconds >= thresholdSeconds * 2 ||
              (alertTags.includes("sla_critical") &&
                (alertTags.includes("conflict_risk") ||
                  Boolean(activeDeal?.value && activeDeal.value >= 10000))) ||
              (isUnassignedQueue && waitingMinutes >= 15) ||
              (alertTags.includes("conflict_risk") && isUnanswered);

            // Dados do Operador
            const opInfo = conv.operatorId ? opMap.get(conv.operatorId) : undefined;
            const operatorName = opInfo
              ? opInfo.name
              : isUnassignedQueue
              ? "Fila Humana (Sem consultor)"
              : isInAutomation
              ? "Triagem I.A."
              : "Sem operador";

            // Mensagem de referência para exibição no card
            const displayMsg =
              alertType === "delivery_failure" && lastFailedMsg
                ? lastFailedMsg
                : referenceClientMsg || lastRealMsg;

            const parsedMedia = parseMediaContent(
              displayMsg?.content || conv.lastMessageText,
              displayMsg?.mediaInterpretation
            );

            const startedAtDate = new Date(conv.createdAt);
            const formattedStartedAt = startedAtDate.toLocaleString("pt-BR", {
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            });

            alerts.push({
              logId: openLog?.id || `alert-${conv.id}`,
              conversationId: conv.id,
              contactName: conv.contactName || "Cliente sem nome",
              contactPhone: conv.contactPhone,
              contactEmail: conv.contactEmail ?? null,
              contactAvatar: conv.contactAvatar ?? null,
              accountName: conv.accountTradeName || conv.accountName || null,
              accountDocument: conv.accountDocument ?? null,
              operatorId: conv.operatorId ?? null,
              operatorName,
              operatorAvatar: opInfo?.avatar ?? null,
              operatorIsOnline: opInfo ? Boolean(opInfo.isOnline) : false,
              operatorStatus: (opInfo?.status as "disponivel" | "ocupado" | "ausente") || "ausente",
              operatorLastSeenAt: opInfo?.lastSeenAtIso ?? null,
              queueState: conv.queueState,
              waitingSeconds,
              waitingMinutes,
              clientMessageAt: clientWaitStartIso,
              isOverdue,
              isCritical,
              isUnanswered,
              alertType,
              alertTags,
              conflictTriggerText,
              lastMessagePreview: parsedMedia.preview,
              lastMessageRaw: displayMsg?.content ?? conv.lastMessageText ?? null,
              lastMessageMediaType: parsedMedia.mediaType,
              lastMessageMediaId: parsedMedia.mediaId,
              lastMessageTranscription: displayMsg?.mediaInterpretation ?? null,
              lastMessageSenderType: displayMsg?.senderType ?? "client",
              lastMessageStatus: displayMsg?.status ?? "accepted",
              lastMessageError:
                lastFailedMsg?.errorMessage || displayMsg?.errorMessage || null,
              failedMessagesCount,
              metaWindowOpen,
              metaWindowRemainingMinutes,
              activeDeal,
              crmCardUrl: conv.crmCardUrl ?? null,
              openTasksCount: tasksInfo.openCount,
              overdueTasksCount: tasksInfo.overdueCount,
              nextTaskTitle: tasksInfo.nextTitle,
              clientSentiment:
                clientSentiment || (isConflictRisk ? "frustrado" : null),
              conversationStartedAt: formattedStartedAt,
              recentMessages: msgs.slice(-15),
            });
          }

          // Auto-fechar em background logs SLA órfãos que já foram respondidos
          if (staleLogConvIdsToClose.length > 0) {
            void Promise.all(
              staleLogConvIdsToClose.map((item) =>
                SlaEngine.getInstance().closeOpenSlaCycles({
                  tenantId,
                  conversationId: item.convId,
                  agentResponseId: item.agentMsgId,
                  agentResponseAt: item.sentAt,
                  operatorId: item.opId,
                })
              )
            ).catch(() => {});
          }

          // Ordenação executiva padrão: Críticos -> Conflito/Overdue -> Valor em risco / Espera
          alerts.sort((a, b) => {
            if (a.isCritical !== b.isCritical) return a.isCritical ? -1 : 1;
            const aConflict = a.alertTags?.includes("conflict_risk") ? 1 : 0;
            const bConflict = b.alertTags?.includes("conflict_risk") ? 1 : 0;
            if (aConflict !== bConflict) return bConflict - aConflict;
            if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
            return b.waitingSeconds - a.waitingSeconds;
          });

          if (!includeSummary) {
            return new Response(JSON.stringify(alerts), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          // 6. Calcular Conformidade SLA de Hoje no fuso de Brasília
          let slaCyclesTodayTotal = 0;
          let slaCyclesTodayWithinLimit = 0;
          try {
            const todayStartBrt = new Date(`${todayBrt}T00:00:00.000-03:00`);
            const slaStatsResult = await db.execute(sql`
              SELECT
                COUNT(*)::int AS "total",
                COUNT(*) FILTER (
                  WHERE (
                    response_time_seconds IS NOT NULL
                    AND response_time_seconds <= overdue_threshold_seconds
                  ) OR (
                    response_time_seconds IS NULL
                    AND is_overdue = false
                    AND EXTRACT(EPOCH FROM (NOW() - client_message_at)) <= overdue_threshold_seconds
                  )
                )::int AS "withinLimit"
              FROM response_time_logs
              WHERE tenant_id = ${tenantId}
                AND client_message_at >= ${todayStartBrt}
            `);
            const statRow = extractRows(slaStatsResult)[0];
            if (statRow) {
              slaCyclesTodayTotal = Number(statRow.total || 0);
              slaCyclesTodayWithinLimit = Number(statRow.withinLimit || 0);
            }
          } catch (slaStatErr: any) {
            console.warn("[gestao/alerts] Falha ao calcular conformidade SLA hoje:", slaStatErr?.message);
          }

          const slaCompliancePctToday =
            slaCyclesTodayTotal > 0
              ? Math.round((slaCyclesTodayWithinLimit / slaCyclesTodayTotal) * 100)
              : null;

          // 7. Construir Concentração de Alertas por Consultor (Operator Bottlenecks)
          const bottleneckMap = new Map<string, AlertOperatorBottleneck>();

          for (const item of alerts) {
            const key = item.operatorId || "__fila__";
            const label = item.operatorId
              ? item.operatorName
              : "Fila Humana (Sem consultor)";
            const existing = bottleneckMap.get(key) || {
              operatorId: key,
              operatorName: label,
              operatorAvatar: item.operatorAvatar ?? null,
              isOnline: item.operatorId ? Boolean(item.operatorIsOnline) : false,
              status: item.operatorStatus || "ausente",
              totalAlerts: 0,
              criticalCount: 0,
              overdueCount: 0,
              conflictCount: 0,
              maxWaitMinutes: 0,
              pipelineAtRiskValue: 0,
            };

            existing.totalAlerts += 1;
            if (item.isCritical) existing.criticalCount += 1;
            if (item.isOverdue) existing.overdueCount += 1;
            if (item.alertTags?.includes("conflict_risk")) existing.conflictCount += 1;
            if (item.waitingMinutes > existing.maxWaitMinutes) {
              existing.maxWaitMinutes = item.waitingMinutes;
            }
            if (item.activeDeal?.status === "open" && item.activeDeal.value) {
              existing.pipelineAtRiskValue += Number(item.activeDeal.value);
            }

            bottleneckMap.set(key, existing);
          }

          const operatorBottlenecks = Array.from(bottleneckMap.values()).sort((a, b) => {
            if (b.criticalCount !== a.criticalCount) return b.criticalCount - a.criticalCount;
            if (b.overdueCount !== a.overdueCount) return b.overdueCount - a.overdueCount;
            return b.totalAlerts - a.totalAlerts;
          });

          // 8. Construir Sumário Executivo para os 4 KPIs da Diretoria
          const unansweredAlerts = alerts.filter((a) => a.isUnanswered);
          const maxWaitMinutes = unansweredAlerts.reduce(
            (max, a) => (a.waitingMinutes > max ? a.waitingMinutes : max),
            0
          );
          const avgWaitMinutes =
            unansweredAlerts.length > 0
              ? Math.round(
                  unansweredAlerts.reduce((acc, a) => acc + a.waitingMinutes, 0) /
                    unansweredAlerts.length
                )
              : 0;

          const seenDeals = new Set<string>();
          let pipelineAtRiskValue = 0;
          for (const a of alerts) {
            if (
              a.activeDeal &&
              a.activeDeal.status === "open" &&
              !seenDeals.has(a.activeDeal.id)
            ) {
              seenDeals.add(a.activeDeal.id);
              pipelineAtRiskValue += Number(a.activeDeal.value || 0);
            }
          }

          const offlineOperatorsWithAlertsCount = operatorBottlenecks.filter(
            (b) => b.operatorId !== "__fila__" && !b.isOnline && b.totalAlerts > 0
          ).length;

          const summary: AlertsExecutiveSummary = {
            totalAlerts: alerts.length,
            criticalCount: alerts.filter((a) => a.isCritical).length,
            overdueCount: alerts.filter((a) => a.alertTags?.includes("sla_critical")).length,
            warningCount: alerts.filter((a) => a.alertTags?.includes("sla_warning")).length,
            unassignedQueueCount: alerts.filter((a) =>
              a.alertTags?.includes("unassigned_queue")
            ).length,
            conflictRiskCount: alerts.filter((a) =>
              a.alertTags?.includes("conflict_risk")
            ).length,
            metaWindowExpiringCount: alerts.filter((a) =>
              a.alertTags?.includes("meta_window_expiring")
            ).length,
            deliveryFailureCount: alerts.filter((a) =>
              a.alertTags?.includes("delivery_failed")
            ).length,
            overdueTasksAlertsCount: alerts.filter((a) =>
              a.alertTags?.includes("overdue_task")
            ).length,
            maxWaitMinutes,
            avgWaitMinutes,
            pipelineAtRiskValue,
            dealsAtRiskCount: seenDeals.size,
            offlineOperatorsWithAlertsCount,
            slaCompliancePctToday,
            slaCyclesTodayTotal,
            slaCyclesTodayWithinLimit,
          };

          return new Response(
            JSON.stringify({
              alerts,
              summary,
              operatorBottlenecks,
            }),
            {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        } catch (e: any) {
          const errDetail = {
            message: e?.message,
            code: e?.code,
            detail: e?.detail,
            cause: e?.cause ? { message: e.cause?.message, code: e.cause?.code } : null,
          };
          console.error("[gestao/alerts] ERRO:", JSON.stringify(errDetail));
          return new Response(
            JSON.stringify(
              includeSummary
                ? { alerts: [], summary: null, operatorBottlenecks: [] }
                : []
            ),
            {
              status: 200,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }
      },
    },
  },
});
