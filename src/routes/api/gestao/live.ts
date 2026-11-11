import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import { operators, conversations, contacts, crmAccounts, messages } from "../../../db/schema";
import { eq, and, ne, desc, gte, lte, sql } from "drizzle-orm";
import { requireSession } from "../../../lib/auth-session";
import { conversationReadCondition, requireConversationAccess } from "../../../lib/access-control/conversation-access";
import { computeOperatorPresenceSnapshot, getBrtDateKey } from "../../../lib/operator-presence";
import { buildPhoneQueryPlan, matchesPhoneSearchQuery } from "../../../lib/utils";
import type {
  LiveActivityCategory,
  LiveDealSummary,
  LivePipelineOption,
  LiveTaskItem,
} from "../../../lib/monitor-mock-data";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PATCH, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const BOILERPLATE_SYSTEM_RE =
  /^(Contato criado\.?|Contato criado\.\s*Aguardando captura do atendimento\.?|Atendimento iniciado\.?|Conversa iniciada\.?|Aguardando captura do atendimento\.?)$/i;

function extractRows<T = any>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && Array.isArray((result as any).rows)) {
    return (result as any).rows as T[];
  }
  return [];
}

export const Route = createFileRoute("/api/gestao/live")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      GET: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;

        if (session.permissions?.views?.monitor !== true || session.permissions?.monitor?.canAccessLive !== true) {
          return new Response(
            JSON.stringify({ error: "Permissão insuficiente. Apenas administradores e supervisores podem visualizar o painel ao vivo.", code: "FORBIDDEN" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const url = new URL(request.url);
        const queryTenantId = url.searchParams.get("tenantId");
        if (queryTenantId && queryTenantId !== tenantId) {
          return new Response(
            JSON.stringify({ error: "Acesso negado ao tenant especificado.", code: "FORBIDDEN" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const dateFilter = url.searchParams.get("date");      // YYYY-MM-DD opcional
        const opIdFilter = url.searchParams.get("opId");      // operatorId opcional
        const search = url.searchParams.get("search");        // busca por nome/telefone

        try {
          const now = new Date();
          const todayBrt = getBrtDateKey(now);

          // 1. Buscar TODOS os operadores do tenant
          const opList = await db
            .select()
            .from(operators)
            .where(eq(operators.tenantId, tenantId));

          const opMap = new Map(opList.map((o) => [o.id, o]));

          // 2. Filtro de data no fuso de Brasília (America/Sao_Paulo -03:00)
          const dateConditions = [];
          if (dateFilter && /^\d{4}-\d{2}-\d{2}$/.test(dateFilter)) {
            dateConditions.push(gte(conversations.lastMessageTime, new Date(`${dateFilter}T00:00:00.000-03:00`)));
            dateConditions.push(lte(conversations.lastMessageTime, new Date(`${dateFilter}T23:59:59.999-03:00`)));
          }

          // 3. Buscar TODAS as conversas ativas (não finalizadas) do tenant com Contato e Empresa
          const baseWhere = and(
            eq(conversations.tenantId, tenantId),
            conversationReadCondition(session),
            ne(conversations.queueState, "finalizados"),
            ...dateConditions
          );

          const allActiveConvs = await db
            .select({
              id: conversations.id,
              operatorId: conversations.operatorId,
              contactId: conversations.contactId,
              queueState: conversations.queueState,
              contactName: contacts.name,
              contactPhone: contacts.phone,
              contactEmail: contacts.email,
              contactAvatar: contacts.avatar,
              accountName: crmAccounts.name,
              accountTradeName: crmAccounts.tradeName,
              accountDocument: crmAccounts.document,
              lastMessageTime: conversations.lastMessageTime,
              lastMessageText: conversations.lastMessageText,
              createdAt: conversations.createdAt,
            })
            .from(conversations)
            .leftJoin(contacts, and(eq(conversations.contactId, contacts.id), eq(contacts.tenantId, tenantId)))
            .leftJoin(crmAccounts, and(eq(contacts.accountId, crmAccounts.id), eq(crmAccounts.tenantId, tenantId)))
            .where(baseWhere)
            .orderBy(desc(conversations.lastMessageTime));

          // 4. Filtro por busca (nome, telefone ou empresa)
          const searchLower = search?.toLowerCase().trim() ?? "";
          const searchPhonePlan = searchLower ? buildPhoneQueryPlan(search) : null;
          const filteredConvs = searchLower
            ? allActiveConvs.filter(
                (c) =>
                  c.contactName?.toLowerCase().includes(searchLower) ||
                  matchesPhoneSearchQuery(c.contactPhone, searchPhonePlan) ||
                  c.accountName?.toLowerCase().includes(searchLower) ||
                  c.accountTradeName?.toLowerCase().includes(searchLower)
              )
            : allActiveConvs;

          // 5. Separar por categoria
          const operatorConvs = filteredConvs.filter(
            (c) =>
              c.operatorId &&
              c.queueState !== "automacao" &&
              (opIdFilter ? c.operatorId === opIdFilter : true)
          );

          const unassignedConvs = filteredConvs.filter(
            (c) => !c.operatorId && c.queueState === "fila"
          );

          const automationConvs = filteredConvs.filter(
            (c) => c.queueState === "automacao"
          );

          // 6. Coletar todas as conversas (incluindo automação) para buscar as últimas 35 mensagens de CADA conversa
          const allRelevantIds = [
            ...operatorConvs.map((c) => c.id),
            ...unassignedConvs.map((c) => c.id),
            ...automationConvs.map((c) => c.id),
          ];

          const allMessagesMap: Record<string, any[]> = {};

          if (allRelevantIds.length > 0) {
            const idParams = sql.join(
              allRelevantIds.map((id) => sql`${id}`),
              sql`, `
            );
            const rawResult = await db.execute(sql`
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
              WHERE ranked.rn <= 35
              ORDER BY ranked.conversation_id, ranked.sent_at ASC
            `);

            const rawMsgs = extractRows(rawResult);
            for (const msg of rawMsgs) {
              const cid = msg.conversationId;
              if (!allMessagesMap[cid]) {
                allMessagesMap[cid] = [];
              }
              allMessagesMap[cid].push({
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
            }
          }

          // 6.5. Enriquecer com Contexto Comercial (Negociação Ativa no CRM e Tarefas)
          const dealByConvMap = new Map<string, LiveDealSummary>();
          const tasksByConvMap = new Map<
            string,
            {
              openCount: number;
              overdueCount: number;
              nextTitle: string | null;
              items: LiveTaskItem[];
            }
          >();

          if (allRelevantIds.length > 0) {
            const idParams = sql.join(
              allRelevantIds.map((id) => sql`${id}`),
              sql`, `
            );

            // Busca deal vinculado via conversation_deal_contexts, crm_conversation_deals ou crm_deal_contacts
            try {
              const dealRowsResult = await db.execute(sql`
                SELECT DISTINCT ON (conv_id)
                  conv_id AS "conversationId",
                  d.id AS "dealId",
                  d.title AS "title",
                  d.value AS "value",
                  d.status AS "status",
                  d.rating AS "rating",
                  d.pipeline_id AS "pipelineId",
                  p.name AS "pipelineName",
                  d.stage_id AS "stageId",
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
              `);

              for (const row of extractRows(dealRowsResult)) {
                dealByConvMap.set(row.conversationId, {
                  id: row.dealId,
                  title: row.title,
                  value: row.value !== null && row.value !== undefined ? Number(row.value) : null,
                  status: row.status || "open",
                  pipelineId: row.pipelineId || null,
                  pipelineName: row.pipelineName || null,
                  stageId: row.stageId || null,
                  stageName: row.stageName || null,
                  rating: Number(row.rating || 0),
                });
              }
            } catch (dealErr: any) {
              console.warn("[gestao/live] Falha não-crítica ao buscar deals ativos:", dealErr?.message);
            }

            // Busca tarefas abertas vinculadas à conversa ou à negociação ativa (crm_deal_activities + tasks)
            try {
              const taskItemsResult = await db.execute(sql`
                SELECT
                  t.chat_conversation_id AS "conversationId",
                  t.id AS "id",
                  t.name AS "title",
                  t.type AS "type",
                  t.due_date AS "dueDate",
                  t.deal_name AS "dealTitle"
                FROM tasks t
                WHERE t.tenant_id = ${tenantId}
                  AND t.chat_conversation_id IN (${idParams})
                  AND t.status NOT IN ('done', 'completed', 'cancelled')

                UNION ALL

                SELECT
                  cda.conversation_id AS "conversationId",
                  cda.id AS "id",
                  cda.title AS "title",
                  cda.type AS "type",
                  cda.due_date AS "dueDate",
                  NULL AS "dealTitle"
                FROM crm_deal_activities cda
                WHERE cda.tenant_id = ${tenantId}
                  AND cda.conversation_id IN (${idParams})
                  AND cda.status = 'pending'
                  AND cda.type NOT IN ('note', 'system_event')
              `);

              const rawTaskRows = extractRows(taskItemsResult);
              const groupedTasks = new Map<string, Map<string, LiveTaskItem>>();

              for (const r of rawTaskRows) {
                const cid = r.conversationId;
                if (!cid) continue;
                if (!groupedTasks.has(cid)) {
                  groupedTasks.set(cid, new Map());
                }
                const dueIso = r.dueDate
                  ? r.dueDate instanceof Date
                    ? r.dueDate.toISOString()
                    : String(r.dueDate)
                  : null;
                const dueMs = dueIso ? new Date(dueIso).getTime() : NaN;
                const isOverdue = !Number.isNaN(dueMs) && dueMs < now.getTime();
                groupedTasks.get(cid)!.set(String(r.id), {
                  id: String(r.id),
                  title: String(r.title || "Tarefa"),
                  type: r.type ? String(r.type) : "task",
                  dueDate: dueIso,
                  isOverdue,
                  dealTitle: r.dealTitle || dealByConvMap.get(cid)?.title || null,
                });
              }

              for (const [cid, taskMap] of groupedTasks.entries()) {
                const items = Array.from(taskMap.values()).sort((a, b) => {
                  const ta = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
                  const tb = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
                  return ta - tb;
                });
                const overdueCount = items.filter((i) => i.isOverdue).length;
                tasksByConvMap.set(cid, {
                  openCount: items.length,
                  overdueCount,
                  nextTitle: items[0]?.title ?? null,
                  items: items.slice(0, 8),
                });
              }
            } catch (taskErr: any) {
              console.warn("[gestao/live] Falha não-crítica ao buscar tarefas:", taskErr?.message);
            }
          }

          // 7. Função helper para montar LiveConversation com classificação real
          const buildLiveConv = (c: typeof filteredConvs[0]) => {
            const msgs = allMessagesMap[c.id] || [];
            // Filtra apenas mensagens conversacionais externas (ignora notas internas e mensagens de sistema)
            const realMsgs = msgs.filter(
              (m) => !m.isInternalNote && m.senderType !== "system"
            );
            const lastRealMsg = realMsgs[realMsgs.length - 1];
            const lastAnyMsg = msgs[msgs.length - 1];

            // Verifica se houve interação real ou se é apenas "Contato criado. Aguardando captura..."
            const rawLastText = (c.lastMessageText || lastAnyMsg?.content || "").trim();
            const hasRealInteraction =
              realMsgs.length > 0 ||
              (Boolean(rawLastText) && !BOILERPLATE_SYSTEM_RE.test(rawLastText));

            let waitingMinutes = 0;
            let isUnanswered = false;

            if (lastRealMsg && lastRealMsg.senderType === "client") {
              isUnanswered = true;
              // Caminha para trás para achar a PRIMEIRA mensagem não respondida desta sequência do cliente
              let firstUnansweredClientMsg = lastRealMsg;
              for (let i = realMsgs.length - 2; i >= 0; i--) {
                if (realMsgs[i].senderType === "client") {
                  firstUnansweredClientMsg = realMsgs[i];
                } else {
                  break;
                }
              }
              const msgTime = new Date(firstUnansweredClientMsg.sentAt).getTime();
              if (!Number.isNaN(msgTime)) {
                waitingMinutes = Math.max(0, Math.floor((now.getTime() - msgTime) / 60000));
              }
            } else if (c.queueState === "fila" && !c.operatorId) {
              // Na fila sem operador: tempo esperando captura
              const refTime = new Date(lastRealMsg?.sentAt || c.lastMessageTime).getTime();
              if (!Number.isNaN(refTime)) {
                waitingMinutes = Math.max(0, Math.floor((now.getTime() - refTime) / 60000));
                isUnanswered = true;
              }
            }

            // Última mensagem do cliente para cálculo da janela de 24h da Meta
            let lastClientMessageAt: string | null = null;
            let metaWindowOpen = false;
            let metaWindowRemainingMinutes: number | null = null;
            for (let i = realMsgs.length - 1; i >= 0; i--) {
              if (realMsgs[i].senderType === "client") {
                lastClientMessageAt = realMsgs[i].sentAt;
                const clientMs = new Date(realMsgs[i].sentAt).getTime();
                const elapsedMs = now.getTime() - clientMs;
                const windowMs = 24 * 60 * 60 * 1000;
                if (elapsedMs >= 0 && elapsedMs < windowMs) {
                  metaWindowOpen = true;
                  metaWindowRemainingMinutes = Math.max(
                    1,
                    Math.floor((windowMs - elapsedMs) / 60000)
                  );
                }
                break;
              }
            }

            // Verifica se teve atividade real hoje (no fuso de Brasília)
            const effectiveLastTime = lastRealMsg?.sentAt
              ? new Date(lastRealMsg.sentAt)
              : c.lastMessageTime instanceof Date
              ? c.lastMessageTime
              : new Date(c.lastMessageTime);

            const isActiveToday =
              hasRealInteraction &&
              !Number.isNaN(effectiveLastTime.getTime()) &&
              getBrtDateKey(effectiveLastTime) === todayBrt;

            let activityCategory: LiveActivityCategory = "dormant";
            if (!hasRealInteraction) {
              activityCategory = "awaiting_first_contact";
            } else if (isUnanswered) {
              activityCategory = "waiting_reply";
            } else if (isActiveToday) {
              activityCategory = "active_today";
            } else if (now.getTime() - effectiveLastTime.getTime() <= 48 * 3600 * 1000) {
              activityCategory = "recent_active";
            } else {
              activityCategory = "dormant";
            }

            const failedMessagesCount = msgs.filter((m) => m.status === "failed").length;
            const taskSummary = tasksByConvMap.get(c.id);
            const opRecord = c.operatorId ? opMap.get(c.operatorId) : null;

            return {
              id: c.id,
              contactId: c.contactId || null,
              contactName: c.contactName || "Cliente sem Nome",
              contactPhone: c.contactPhone || "",
              contactEmail: c.contactEmail || null,
              contactAvatar: c.contactAvatar || null,
              accountName: c.accountTradeName || c.accountName || null,
              accountDocument: c.accountDocument || null,
              queueState: c.queueState,
              lastMessage:
                lastRealMsg?.content ||
                c.lastMessageText ||
                lastAnyMsg?.content ||
                "Nenhuma mensagem recente",
              lastMessageTime:
                c.lastMessageTime instanceof Date
                  ? c.lastMessageTime.toISOString()
                  : String(c.lastMessageTime),
              waitingMinutes,
              isUnanswered,
              hasRealInteraction,
              isActiveToday,
              activityCategory,
              lastClientMessageAt,
              metaWindowOpen,
              metaWindowRemainingMinutes,
              activeDeal: dealByConvMap.get(c.id) || null,
              openTasksCount: taskSummary?.openCount ?? 0,
              overdueTasksCount: taskSummary?.overdueCount ?? 0,
              nextTaskTitle: taskSummary?.nextTitle ?? null,
              tasks: taskSummary?.items ?? [],
              failedMessagesCount,
              operatorId: c.operatorId || null,
              operatorName: opRecord?.name || null,
              messages: msgs,
            };
          };

          // Ordenador inteligente de conversas:
          // 1º Clientes esperando resposta (do MAIOR tempo de espera para o menor)
          // 2º Conversas ativas hoje com interação real (mais recente primeiro)
          // 3º Conversas recentes com interação real
          // 4º Contatos criados aguardando 1º contato / carteira parada
          const sortConversationsByPriority = (
            a: ReturnType<typeof buildLiveConv>,
            b: ReturnType<typeof buildLiveConv>
          ) => {
            if (a.isUnanswered !== b.isUnanswered) {
              return a.isUnanswered ? -1 : 1;
            }
            if (a.isUnanswered && b.isUnanswered) {
              if (b.waitingMinutes !== a.waitingMinutes) {
                return b.waitingMinutes - a.waitingMinutes;
              }
            }
            if (a.isActiveToday !== b.isActiveToday) {
              return a.isActiveToday ? -1 : 1;
            }
            if (a.hasRealInteraction !== b.hasRealInteraction) {
              return a.hasRealInteraction ? -1 : 1;
            }
            return (
              new Date(b.lastMessageTime).getTime() -
              new Date(a.lastMessageTime).getTime()
            );
          };

          // 8. Montar resposta por operador com métricas reais + produtividade do dia
          const buildOperatorPayload = (
            opId: string,
            opName: string,
            opAvatar: string | null,
            opStatus: string,
            presence: { isOnline: boolean; lastSeenAt: string | null; usageSecondsToday: number },
            rawOpConvs: typeof filteredConvs
          ) => {
            const builtConvs = rawOpConvs
              .map(buildLiveConv)
              .sort(sortConversationsByPriority);

            const waitingReplyCount = builtConvs.filter((c) => c.isUnanswered).length;
            const criticalWaitCount = builtConvs.filter(
              (c) => c.isUnanswered && c.waitingMinutes >= 15
            ).length;
            const activeTodayCount = builtConvs.filter(
              (c) => c.isActiveToday || c.isUnanswered
            ).length;
            const awaitingFirstContactCount = builtConvs.filter(
              (c) => c.activityCategory === "awaiting_first_contact"
            ).length;
            const dormantCount = builtConvs.filter(
              (c) =>
                c.activityCategory === "dormant" ||
                c.activityCategory === "recent_active"
            ).length;
            const maxWaitMinutes = builtConvs.reduce(
              (max, c) => (c.isUnanswered && c.waitingMinutes > max ? c.waitingMinutes : max),
              0
            );
            const activeDealsValue = builtConvs.reduce((sum, c) => {
              if (c.activeDeal && c.activeDeal.status === "open" && c.activeDeal.value) {
                return sum + Number(c.activeDeal.value);
              }
              return sum;
            }, 0);

            const failedDeliveriesCount = builtConvs.filter(
              (c) => (c.failedMessagesCount ?? 0) > 0
            ).length;
            const expiringWindowCount = builtConvs.filter(
              (c) =>
                c.metaWindowOpen &&
                c.metaWindowRemainingMinutes !== null &&
                c.metaWindowRemainingMinutes !== undefined &&
                c.metaWindowRemainingMinutes <= 120
            ).length;

            // Produtividade do dia: mensagens enviadas hoje e TMR real do dia
            let sentMessagesToday = 0;
            const responseDeltasMinutes: number[] = [];

            for (const conv of builtConvs) {
              const realMsgs = conv.messages.filter(
                (m) => !m.isInternalNote && m.senderType !== "system"
              );
              let pendingClientMs: number | null = null;
              for (const m of realMsgs) {
                const sentDate = m.sentAt ? new Date(m.sentAt) : null;
                if (!sentDate || Number.isNaN(sentDate.getTime())) continue;
                const isMsgToday = getBrtDateKey(sentDate) === todayBrt;

                if (m.senderType === "client") {
                  if (pendingClientMs === null) {
                    pendingClientMs = sentDate.getTime();
                  }
                } else if (m.senderType === "agent") {
                  if (isMsgToday) {
                    sentMessagesToday += 1;
                    if (pendingClientMs !== null && sentDate.getTime() >= pendingClientMs) {
                      const diffMin = (sentDate.getTime() - pendingClientMs) / 60000;
                      if (diffMin <= 240) {
                        responseDeltasMinutes.push(diffMin);
                      }
                    }
                  }
                  pendingClientMs = null;
                }
              }
            }

            const avgResponseMinutesToday =
              responseDeltasMinutes.length > 0
                ? Math.max(
                    1,
                    Math.round(
                      responseDeltasMinutes.reduce((a, b) => a + b, 0) /
                        responseDeltasMinutes.length
                    )
                  )
                : null;

            return {
              operatorId: opId,
              operatorName: opName,
              operatorAvatar: opAvatar,
              status: (opStatus || "disponivel") as "disponivel" | "ocupado" | "ausente",
              isOnline: presence.isOnline,
              lastSeenAt: presence.lastSeenAt,
              usageSecondsToday: presence.usageSecondsToday,
              sentMessagesToday,
              avgResponseMinutesToday,
              failedDeliveriesCount,
              expiringWindowCount,
              waitingReplyCount,
              criticalWaitCount,
              activeTodayCount,
              awaitingFirstContactCount,
              dormantCount,
              maxWaitMinutes,
              activeDealsValue,
              conversations: builtConvs,
            };
          };

          const operatorResult = opList
            .filter((op) => (opIdFilter ? op.id === opIdFilter : true))
            .map((op) => {
              const opConvs = operatorConvs.filter((c) => c.operatorId === op.id);
              const presence = computeOperatorPresenceSnapshot(
                op,
                tenantId,
                session.operator.id
              );
              return buildOperatorPayload(
                op.id,
                op.name,
                op.avatar || null,
                op.status || "disponivel",
                presence,
                opConvs
              );
            });

          // Operadores "fantasmas": têm conversas mas não estão na tabela operators
          const knownOpIds = new Set(opList.map((o) => o.id));
          const ghostConvs = operatorConvs.filter(
            (c) => c.operatorId && !knownOpIds.has(c.operatorId)
          );
          const ghostGroups = new Map<string, typeof filteredConvs>();
          for (const c of ghostConvs) {
            const key = c.operatorId!;
            if (!ghostGroups.has(key)) ghostGroups.set(key, []);
            ghostGroups.get(key)!.push(c);
          }
          for (const [opId, convs] of ghostGroups) {
            if (opIdFilter && opId !== opIdFilter) continue;
            operatorResult.push(
              buildOperatorPayload(
                opId,
                `Operador (${opId})`,
                null,
                "disponivel",
                { isOnline: false, lastSeenAt: null, usageSecondsToday: 0 },
                convs
              )
            );
          }

          // Ordena operadores dando prioridade a quem tem clientes esperando / ativos hoje primeiro
          operatorResult.sort((a, b) => {
            if (b.waitingReplyCount !== a.waitingReplyCount) {
              return b.waitingReplyCount - a.waitingReplyCount;
            }
            if (b.activeTodayCount !== a.activeTodayCount) {
              return b.activeTodayCount - a.activeTodayCount;
            }
            if (a.isOnline !== b.isOnline) {
              return a.isOnline ? -1 : 1;
            }
            const convDiff = b.conversations.length - a.conversations.length;
            if (convDiff !== 0) return convDiff;
            return a.operatorName.localeCompare(b.operatorName, "pt-BR");
          });

          const unassignedResult = unassignedConvs
            .map(buildLiveConv)
            .sort(sortConversationsByPriority);

          const automationResult = automationConvs
            .map(buildLiveConv)
            .sort(sortConversationsByPriority);

          // 9. Consolidar Summary Executivo e Funis para o Cockpit da Diretoria
          const allBuiltOperatorConvs = operatorResult.flatMap((o) => o.conversations);
          const allLiveConvs = [
            ...allBuiltOperatorConvs,
            ...unassignedResult,
            ...automationResult,
          ];
          const allUnanswered = [
            ...allBuiltOperatorConvs.filter((c) => c.isUnanswered),
            ...unassignedResult,
          ];
          const maxWaitMinutes = allUnanswered.reduce(
            (max, c) => (c.waitingMinutes > max ? c.waitingMinutes : max),
            0
          );
          const avgWaitMinutes =
            allUnanswered.length > 0
              ? Math.round(
                  allUnanswered.reduce((acc, c) => acc + c.waitingMinutes, 0) /
                    allUnanswered.length
                )
              : 0;

          const seenDealIds = new Set<string>();
          let activePipelineValue = 0;
          let openDealsInLiveCount = 0;
          const pipelineAggMap = new Map<string, LivePipelineOption>();

          for (const c of allLiveConvs) {
            if (c.activeDeal && c.activeDeal.pipelineName) {
              const pKey = c.activeDeal.pipelineId || c.activeDeal.pipelineName;
              const existing = pipelineAggMap.get(pKey) || {
                id: pKey,
                name: c.activeDeal.pipelineName,
                count: 0,
                totalValue: 0,
              };
              existing.count += 1;
              if (c.activeDeal.value) {
                existing.totalValue += Number(c.activeDeal.value);
              }
              pipelineAggMap.set(pKey, existing);
            }

            if (
              c.activeDeal &&
              c.activeDeal.status === "open" &&
              !seenDealIds.has(c.activeDeal.id)
            ) {
              seenDealIds.add(c.activeDeal.id);
              openDealsInLiveCount += 1;
              if (c.activeDeal.value) {
                activePipelineValue += Number(c.activeDeal.value);
              }
            }
          }

          const pipelines = Array.from(pipelineAggMap.values()).sort(
            (a, b) => b.count - a.count
          );

          const failedDeliveriesCount = allLiveConvs.filter(
            (c) => (c.failedMessagesCount ?? 0) > 0
          ).length;
          const expiringWindowsCount = allLiveConvs.filter(
            (c) =>
              c.metaWindowOpen &&
              c.metaWindowRemainingMinutes !== null &&
              c.metaWindowRemainingMinutes !== undefined &&
              c.metaWindowRemainingMinutes <= 120
          ).length;
          const overdueTasksConversationsCount = allLiveConvs.filter(
            (c) => (c.overdueTasksCount ?? 0) > 0
          ).length;
          const totalSentMessagesToday = operatorResult.reduce(
            (acc, op) => acc + (op.sentMessagesToday ?? 0),
            0
          );

          const summary = {
            totalOperators: operatorResult.length,
            onlineOperators: operatorResult.filter((o) => o.isOnline).length,
            unassignedQueueCount: unassignedResult.length,
            automationCount: automationResult.length,
            waitingReplyCount: allBuiltOperatorConvs.filter((c) => c.isUnanswered).length,
            criticalWaitCount: allUnanswered.filter((c) => c.waitingMinutes >= 15).length,
            activeTodayCount: allBuiltOperatorConvs.filter(
              (c) => c.isActiveToday || c.isUnanswered
            ).length,
            awaitingFirstContactCount: allBuiltOperatorConvs.filter(
              (c) => c.activityCategory === "awaiting_first_contact"
            ).length,
            dormantCount: allBuiltOperatorConvs.filter(
              (c) =>
                c.activityCategory === "dormant" ||
                c.activityCategory === "recent_active"
            ).length,
            maxWaitMinutes,
            avgWaitMinutes,
            activePipelineValue,
            openDealsInLiveCount,
            failedDeliveriesCount,
            expiringWindowsCount,
            overdueTasksConversationsCount,
            totalSentMessagesToday,
          };

          return new Response(
            JSON.stringify({
              operators: operatorResult,
              unassigned: unassignedResult,
              automation: automationResult,
              summary,
              pipelines,
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        } catch (e: any) {
          console.error("[gestao/live] Erro ao buscar conversas ao vivo:", e);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },

      // PATCH /api/gestao/live — Intervenção Direta da Supervisão Ao Vivo (Transferir / Atribuir / Devolver à Fila / Finalizar)
      PATCH: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;

        if (
          session.permissions?.views?.monitor !== true ||
          session.permissions?.monitor?.canAccessLive !== true
        ) {
          return new Response(
            JSON.stringify({
              error: "Permissão insuficiente para intervir na operação ao vivo.",
              code: "FORBIDDEN",
            }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        try {
          const body = await request.json().catch(() => ({}));
          const conversationId = String(body.conversationId || "").trim();
          const action = String(body.action || "").trim() as
            | "transfer"
            | "return_to_queue"
            | "close";
          const targetOperatorId = body.targetOperatorId
            ? String(body.targetOperatorId).trim()
            : null;

          if (
            !conversationId ||
            !["transfer", "return_to_queue", "close"].includes(action)
          ) {
            return new Response(
              JSON.stringify({ error: "Parâmetros de intervenção inválidos." }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          const denied = await requireConversationAccess(session, conversationId);
          if (denied) return denied;

          const [conv] = await db
            .select()
            .from(conversations)
            .where(
              and(
                eq(conversations.id, conversationId),
                eq(conversations.tenantId, tenantId)
              )
            )
            .limit(1);

          if (!conv) {
            return new Response(
              JSON.stringify({ error: "Conversa não encontrada para este tenant." }),
              { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          const now = new Date();
          let newQueueState = conv.queueState;
          let newOperatorId: string | null = conv.operatorId;
          let targetOpName: string | null = null;
          let systemEventText = "";

          if (action === "transfer") {
            if (!targetOperatorId) {
              return new Response(
                JSON.stringify({ error: "Selecione o consultor de destino." }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
              );
            }

            const [targetOp] = await db
              .select({ id: operators.id, name: operators.name })
              .from(operators)
              .where(
                and(
                  eq(operators.id, targetOperatorId),
                  eq(operators.tenantId, tenantId)
                )
              )
              .limit(1);

            if (!targetOp) {
              return new Response(
                JSON.stringify({ error: "Consultor de destino não encontrado." }),
                { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
              );
            }

            newQueueState = "meus";
            newOperatorId = targetOp.id;
            targetOpName = targetOp.name;
            systemEventText = `Atendimento atribuído para ${targetOp.name} pela Supervisão (${session.operator.name}).`;
          } else if (action === "return_to_queue") {
            newQueueState = "fila";
            newOperatorId = null;
            systemEventText = `Atendimento devolvido para a fila pela Supervisão (${session.operator.name}).`;
          } else if (action === "close") {
            newQueueState = "finalizados";
            systemEventText = `Atendimento finalizado pela Supervisão (${session.operator.name}).`;
          }

          const sysMsgId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

          await db.transaction(async (tx) => {
            await tx
              .update(conversations)
              .set({
                queueState: newQueueState,
                operatorId: newOperatorId,
                version: sql`${conversations.version} + 1`,
                updatedAt: now,
              })
              .where(
                and(
                  eq(conversations.id, conversationId),
                  eq(conversations.tenantId, tenantId)
                )
              );

            await tx.insert(messages).values({
              id: sysMsgId,
              tenantId,
              conversationId,
              senderType: "system",
              senderName: "Sistema",
              content: systemEventText,
              isInternalNote: false,
              provider: "internal",
              direction: "outbound",
              status: "accepted",
              metaDetails: {
                supervisorIntervention: action,
                attendanceActor: {
                  name: session.operator.name,
                  operatorId: session.operator.id,
                  role: session.operator.role,
                },
              },
              sentAt: now,
              updatedAt: now,
            });
          });

          try {
            const { SessionManager } = await import("../../../lib/baileys/session-manager");
            SessionManager.getInstance().notifyPublic(tenantId, {
              type: "queue_update",
              conversationId,
              queueState: newQueueState,
              operatorId: newOperatorId,
              sectorId: conv.sectorId,
              responsibleName: targetOpName || undefined,
              version: (conv.version || 1) + 1,
            });
            SessionManager.getInstance().notifyPublic(tenantId, {
              type: "message",
              message: {
                id: sysMsgId,
                conversationId,
                senderType: "system",
                senderName: "Sistema",
                content: systemEventText,
                isInternalNote: false,
                sentAt: now.toISOString(),
                status: "accepted",
              },
            });
          } catch (sseErr: any) {
            console.warn("[gestao/live PATCH] Falha não-crítica ao emitir SSE:", sseErr?.message);
          }

          return new Response(
            JSON.stringify({
              success: true,
              action,
              conversationId,
              queueState: newQueueState,
              operatorId: newOperatorId,
              operatorName: targetOpName,
              systemMessage: {
                id: sysMsgId,
                conversationId,
                senderType: "system",
                senderName: "Sistema",
                content: systemEventText,
                sentAt: now.toISOString(),
                isInternalNote: false,
                status: "accepted",
              },
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        } catch (e: any) {
          console.error("[gestao/live PATCH] Erro na intervenção de supervisão:", e);
          return new Response(
            JSON.stringify({ error: e.message || "Erro interno ao executar ação." }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      },
    },
  },
});
