import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import {
  operators,
  sectors,
  conversations,
  contacts,
  crmAccounts,
  messages,
} from "../../../db/schema";
import { eq, and, ne, desc, gte, lte, asc, sql } from "drizzle-orm";
import { requireSession } from "../../../lib/auth-session";
import {
  conversationReadCondition,
  requireConversationAccess,
} from "../../../lib/access-control/conversation-access";
import { computeOperatorPresenceSnapshot, getBrtDateKey } from "../../../lib/operator-presence";
import { buildPhoneQueryPlan, matchesPhoneSearchQuery } from "../../../lib/utils";
import {
  computeLiveSummary,
  matchesLivePipeline,
  matchesLiveSector,
} from "../../../lib/monitor/live-filters";
import type {
  LiveActivityCategory,
  LiveDealSummary,
  LiveOperatorDirectoryItem,
  LivePipelineOption,
  LiveSectorOption,
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

        const dateFilter = (url.searchParams.get("date") || "").trim();          // YYYY-MM-DD opcional
        const opIdFilter = (url.searchParams.get("opId") || "").trim();          // operatorId opcional
        const sectorIdFilter = (url.searchParams.get("sectorId") || "").trim();  // sectorId opcional
        const pipelineIdFilter = (url.searchParams.get("pipelineId") || "").trim(); // "" | "__with_deal__" | pipelineId
        const search = (url.searchParams.get("search") || "").trim();            // busca por nome/telefone/empresa/card

        try {
          const now = new Date();
          const todayBrt = getBrtDateKey(now);
          // Início do dia em Brasília (-03:00) com janela de 4h anterior para cálculo correto de TMR
          const todayStartBrt = new Date(`${todayBrt}T00:00:00.000-03:00`);
          const todayLookbackStart = new Date(todayStartBrt.getTime() - 4 * 3600 * 1000);

          // 1. Buscar TODOS os operadores e TODOS os setores do tenant em paralelo
          const [opList, sectorList] = await Promise.all([
            db
              .select()
              .from(operators)
              .where(eq(operators.tenantId, tenantId)),
            db
              .select()
              .from(sectors)
              .where(eq(sectors.tenantId, tenantId))
              .orderBy(asc(sectors.name)),
          ]);

          const opMap = new Map(opList.map((o) => [o.id, o]));
          const sectorMap = new Map(sectorList.map((s) => [s.id, s]));
          const sectorOpSetMap = new Map<string, Set<string>>();
          const operatorSectorsMap = new Map<string, string[]>();

          for (const sec of sectorList) {
            const ids = Array.isArray(sec.operatorIds) ? sec.operatorIds : [];
            sectorOpSetMap.set(sec.id, new Set(ids));
            for (const oid of ids) {
              const list = operatorSectorsMap.get(oid) ?? [];
              list.push(sec.id);
              operatorSectorsMap.set(oid, list);
            }
          }

          const presenceByOpId = new Map(
            opList.map((op) => [
              op.id,
              computeOperatorPresenceSnapshot(op, tenantId, session.operator.id),
            ])
          );

          // 2. Filtro de data no fuso de Brasília (America/Sao_Paulo -03:00)
          const extraConditions = [];
          if (dateFilter && /^\d{4}-\d{2}-\d{2}$/.test(dateFilter)) {
            extraConditions.push(
              gte(conversations.lastMessageTime, new Date(`${dateFilter}T00:00:00.000-03:00`))
            );
            extraConditions.push(
              lte(conversations.lastMessageTime, new Date(`${dateFilter}T23:59:59.999-03:00`))
            );
          }

          // Quando um operador específico está filtrado, consulta apenas as conversas dele
          // diretamente no índice (tenant_id, operator_id, queue_state, last_message_time)
          if (opIdFilter) {
            extraConditions.push(eq(conversations.operatorId, opIdFilter));
            extraConditions.push(ne(conversations.queueState, "automacao"));
          }

          // 3. Buscar conversas ativas (não finalizadas) do tenant com Contato e Empresa
          const baseWhere = and(
            eq(conversations.tenantId, tenantId),
            conversationReadCondition(session),
            ne(conversations.queueState, "finalizados"),
            ...extraConditions
          );

          const allActiveConvs = await db
            .select({
              id: conversations.id,
              operatorId: conversations.operatorId,
              sectorId: conversations.sectorId,
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
            .leftJoin(
              contacts,
              and(eq(conversations.contactId, contacts.id), eq(contacts.tenantId, tenantId))
            )
            .leftJoin(
              crmAccounts,
              and(eq(contacts.accountId, crmAccounts.id), eq(crmAccounts.tenantId, tenantId))
            )
            .where(baseWhere)
            .orderBy(desc(conversations.lastMessageTime));

          // 3.5. Contagem por setor no escopo atual (antes de aplicar sectorIdFilter) para manter o dropdown completo
          const sectorOptions: LiveSectorOption[] = sectorList.map((sec) => {
            const opSet = sectorOpSetMap.get(sec.id) ?? new Set<string>();
            const count = allActiveConvs.filter((c) =>
              matchesLiveSector(c, sec.id, opSet)
            ).length;
            return {
              id: sec.id,
              name: sec.name,
              operatorIds: Array.isArray(sec.operatorIds) ? sec.operatorIds : [],
              count,
            };
          });

          // 3.6. Aplicar filtro de Setor ANTES de consultar mensagens, deals e tarefas
          const selectedSectorOpSet = sectorIdFilter
            ? (sectorOpSetMap.get(sectorIdFilter) ?? new Set<string>())
            : null;

          const sectorScopedConvs = sectorIdFilter
            ? allActiveConvs.filter((c) =>
                matchesLiveSector(c, sectorIdFilter, selectedSectorOpSet)
              )
            : allActiveConvs;

          // 4. Filtro por busca (nome, telefone, empresa OU título de card CRM)
          const searchLower = search.toLowerCase();
          const searchPhonePlan = searchLower ? buildPhoneQueryPlan(search) : null;
          const dealTitleMatchConvIds = new Set<string>();

          if (searchLower.length >= 2 && sectorScopedConvs.length > 0) {
            try {
              const likePattern = `%${searchLower}%`;
              const scopedIdParams = sql.join(
                sectorScopedConvs.map((c) => sql`${c.id}`),
                sql`, `
              );
              const titleMatchRes = await db.execute(sql`
                SELECT DISTINCT links.conv_id AS "conversationId"
                FROM (
                  SELECT c.id AS conv_id, cdc.current_deal_id AS deal_id
                  FROM conversations c
                  INNER JOIN conversation_deal_contexts cdc
                    ON cdc.conversation_id = c.id AND cdc.tenant_id = ${tenantId}
                  WHERE c.tenant_id = ${tenantId}
                    AND c.id IN (${scopedIdParams})
                    AND cdc.current_deal_id IS NOT NULL
                  UNION ALL
                  SELECT ccd.conversation_id AS conv_id, ccd.deal_id AS deal_id
                  FROM crm_conversation_deals ccd
                  WHERE ccd.tenant_id = ${tenantId}
                    AND ccd.conversation_id IN (${scopedIdParams})
                    AND ccd.is_active = true
                  UNION ALL
                  SELECT c.id AS conv_id, dc.deal_id AS deal_id
                  FROM conversations c
                  INNER JOIN crm_deal_contacts dc
                    ON dc.contact_id = c.contact_id AND dc.tenant_id = ${tenantId}
                  WHERE c.tenant_id = ${tenantId}
                    AND c.id IN (${scopedIdParams})
                ) links
                INNER JOIN crm_deals d
                  ON d.id = links.deal_id AND d.tenant_id = ${tenantId}
                WHERE LOWER(d.title) LIKE ${likePattern}
              `);
              for (const row of extractRows<{ conversationId: string }>(titleMatchRes)) {
                if (row.conversationId) dealTitleMatchConvIds.add(row.conversationId);
              }
            } catch (searchDealErr: any) {
              console.warn(
                "[gestao/live] Falha não-crítica na busca por título de negócio:",
                searchDealErr?.message
              );
            }
          }

          const filteredConvs = searchLower
            ? sectorScopedConvs.filter(
                (c) =>
                  c.contactName?.toLowerCase().includes(searchLower) ||
                  matchesPhoneSearchQuery(c.contactPhone, searchPhonePlan) ||
                  c.accountName?.toLowerCase().includes(searchLower) ||
                  c.accountTradeName?.toLowerCase().includes(searchLower) ||
                  dealTitleMatchConvIds.has(c.id)
              )
            : sectorScopedConvs;

          // 5. Separar por categoria — quando opIdFilter está ativo, fila e automação são estritamente vazias
          const operatorConvsRaw = filteredConvs.filter(
            (c) =>
              Boolean(c.operatorId) &&
              c.queueState !== "automacao" &&
              (opIdFilter ? c.operatorId === opIdFilter : true)
          );

          const unassignedConvsRaw = opIdFilter
            ? []
            : filteredConvs.filter((c) => !c.operatorId && c.queueState === "fila");

          const automationConvsRaw = opIdFilter
            ? []
            : filteredConvs.filter((c) => c.queueState === "automacao");

          const allRelevantIds = [
            ...operatorConvsRaw.map((c) => c.id),
            ...unassignedConvsRaw.map((c) => c.id),
            ...automationConvsRaw.map((c) => c.id),
          ];

          // 6. Buscar resumo leve de mensagens (1 linha por conversa em SQL), produtividade de hoje, deals e tarefas em paralelo
          type ConvMsgSummary = {
            hasRealMsg: boolean;
            lastRealSenderType: string | null;
            lastRealContent: string | null;
            lastRealSentAt: string | null;
            lastAnyContent: string | null;
            lastClientSentAt: string | null;
            firstUnansweredClientSentAt: string | null;
            failedMessagesCount: number;
          };

          const msgSummaryMap = new Map<string, ConvMsgSummary>();
          const todayStatsByConvMap = new Map<
            string,
            { sentMessagesToday: number; responseDeltasMinutes: number[] }
          >();
          const dealByConvMap = new Map<string, LiveDealSummary>();
          const linkedPipelinesByConvMap = new Map<string, string[]>();
          const hasOpenDealSet = new Set<string>();
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
            const opConvIds = operatorConvsRaw.map((c) => c.id);

            const [msgSummaryRes, todayMsgsRes, dealRowsRes, taskItemsRes] = await Promise.all([
              // 6.1. Resumo leve de mensagens por conversa (sem trafegar 35 objetos completos + JSONB)
              db.execute(sql`
                SELECT
                  c.id AS "conversationId",
                  s."hasRealMsg",
                  s."lastRealSenderType",
                  s."lastRealContent",
                  s."lastRealSentAt",
                  s."lastAnyContent",
                  s."lastClientSentAt",
                  s."firstUnansweredClientSentAt",
                  s."failedMessagesCount"
                FROM conversations c
                CROSS JOIN LATERAL (
                  WITH recent AS (
                    SELECT
                      m.id,
                      m.sender_type,
                      m.content,
                      m.sent_at,
                      m.is_internal_note,
                      m.status,
                      ROW_NUMBER() OVER (ORDER BY m.sent_at DESC, m.id DESC) AS rn_any,
                      CASE
                        WHEN NOT COALESCE(m.is_internal_note, false) AND m.sender_type <> 'system'
                        THEN ROW_NUMBER() OVER (
                          PARTITION BY (NOT COALESCE(m.is_internal_note, false) AND m.sender_type <> 'system')
                          ORDER BY m.sent_at DESC, m.id DESC
                        )
                        ELSE NULL
                      END AS rn_real
                    FROM messages m
                    WHERE m.tenant_id = ${tenantId}
                      AND m.conversation_id = c.id
                    ORDER BY m.sent_at DESC, m.id DESC
                    LIMIT 35
                  ),
                  last_non_client AS (
                    SELECT MIN(rn_real) AS non_client_rn
                    FROM recent
                    WHERE rn_real IS NOT NULL AND sender_type <> 'client'
                  )
                  SELECT
                    EXISTS(SELECT 1 FROM recent WHERE rn_real IS NOT NULL) AS "hasRealMsg",
                    MAX(sender_type) FILTER (WHERE rn_real = 1) AS "lastRealSenderType",
                    MAX(LEFT(content, 280)) FILTER (WHERE rn_real = 1) AS "lastRealContent",
                    MAX(sent_at) FILTER (WHERE rn_real = 1) AS "lastRealSentAt",
                    MAX(LEFT(content, 280)) FILTER (WHERE rn_any = 1) AS "lastAnyContent",
                    MAX(sent_at) FILTER (WHERE rn_real IS NOT NULL AND sender_type = 'client') AS "lastClientSentAt",
                    MIN(sent_at) FILTER (
                      WHERE rn_real IS NOT NULL
                        AND sender_type = 'client'
                        AND (
                          (SELECT non_client_rn FROM last_non_client) IS NULL
                          OR rn_real < (SELECT non_client_rn FROM last_non_client)
                        )
                    ) AS "firstUnansweredClientSentAt",
                    COUNT(*) FILTER (WHERE status = 'failed')::int AS "failedMessagesCount"
                  FROM recent
                ) s
                WHERE c.tenant_id = ${tenantId}
                  AND c.id IN (${idParams})
              `),

              // 6.2. Produtividade de hoje (apenas 3 colunas escalares para mensagens de hoje)
              opConvIds.length > 0
                ? db.execute(sql`
                    SELECT
                      m.conversation_id AS "conversationId",
                      m.sender_type AS "senderType",
                      m.sent_at AS "sentAt"
                    FROM messages m
                    WHERE m.tenant_id = ${tenantId}
                      AND m.conversation_id IN (${sql.join(
                        opConvIds.map((id) => sql`${id}`),
                        sql`, `
                      )})
                      AND m.sent_at >= ${todayLookbackStart}
                      AND NOT COALESCE(m.is_internal_note, false)
                      AND m.sender_type IN ('client', 'agent')
                    ORDER BY m.conversation_id, m.sent_at ASC, m.id ASC
                  `)
                : Promise.resolve([]),

              // 6.3. Deals vinculados (prioriza deal aberto, vínculo direto, mesmo operador da conversa e atualização recente)
              db
                .execute(sql`
                  SELECT
                    links.conv_id AS "conversationId",
                    d.id AS "dealId",
                    d.title AS "title",
                    d.value AS "value",
                    d.status AS "status",
                    d.rating AS "rating",
                    d.pipeline_id AS "pipelineId",
                    p.name AS "pipelineName",
                    d.stage_id AS "stageId",
                    s.name AS "stageName",
                    d.operator_id AS "dealOperatorId"
                  FROM (
                    SELECT c.id AS conv_id, c.operator_id AS conv_operator_id, cdc.current_deal_id AS deal_id, 1 AS priority
                    FROM conversations c
                    INNER JOIN conversation_deal_contexts cdc
                      ON cdc.conversation_id = c.id AND cdc.tenant_id = ${tenantId}
                    WHERE c.tenant_id = ${tenantId}
                      AND c.id IN (${idParams})
                      AND cdc.current_deal_id IS NOT NULL

                    UNION ALL

                    SELECT ccd.conversation_id AS conv_id, c.operator_id AS conv_operator_id, ccd.deal_id AS deal_id, 2 AS priority
                    FROM crm_conversation_deals ccd
                    INNER JOIN conversations c
                      ON c.id = ccd.conversation_id AND c.tenant_id = ${tenantId}
                    WHERE ccd.tenant_id = ${tenantId}
                      AND ccd.conversation_id IN (${idParams})
                      AND ccd.is_active = true

                    UNION ALL

                    SELECT c.id AS conv_id, c.operator_id AS conv_operator_id, dc.deal_id AS deal_id, 3 AS priority
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
                    links.conv_id,
                    CASE WHEN d.status = 'open' THEN 0 ELSE 1 END ASC,
                    links.priority ASC,
                    CASE WHEN links.conv_operator_id IS NOT NULL AND d.operator_id = links.conv_operator_id THEN 0 ELSE 1 END ASC,
                    d.updated_at DESC
                `)
                .catch((dealErr: any) => {
                  console.warn(
                    "[gestao/live] Falha não-crítica ao buscar deals ativos:",
                    dealErr?.message
                  );
                  return [];
                }),

              // 6.4. Tarefas abertas vinculadas
              db
                .execute(sql`
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
                `)
                .catch((taskErr: any) => {
                  console.warn(
                    "[gestao/live] Falha não-crítica ao buscar tarefas:",
                    taskErr?.message
                  );
                  return [];
                }),
            ]);

            const toIso = (val: unknown): string | null => {
              if (!val) return null;
              if (val instanceof Date) return val.toISOString();
              const d = new Date(String(val));
              return Number.isNaN(d.getTime()) ? null : d.toISOString();
            };

            for (const row of extractRows(msgSummaryRes)) {
              msgSummaryMap.set(String(row.conversationId), {
                hasRealMsg: Boolean(row.hasRealMsg),
                lastRealSenderType: row.lastRealSenderType ? String(row.lastRealSenderType) : null,
                lastRealContent: row.lastRealContent !== null && row.lastRealContent !== undefined ? String(row.lastRealContent) : null,
                lastRealSentAt: toIso(row.lastRealSentAt),
                lastAnyContent: row.lastAnyContent !== null && row.lastAnyContent !== undefined ? String(row.lastAnyContent) : null,
                lastClientSentAt: toIso(row.lastClientSentAt),
                firstUnansweredClientSentAt: toIso(row.firstUnansweredClientSentAt),
                failedMessagesCount: Number(row.failedMessagesCount || 0),
              });
            }

            // Agrupa produtividade de hoje por conversa
            const pendingClientMsByConv = new Map<string, number | null>();
            for (const row of extractRows(todayMsgsRes)) {
              const cid = String(row.conversationId);
              const sentDate = row.sentAt instanceof Date ? row.sentAt : new Date(String(row.sentAt));
              if (Number.isNaN(sentDate.getTime())) continue;

              let stats = todayStatsByConvMap.get(cid);
              if (!stats) {
                stats = { sentMessagesToday: 0, responseDeltasMinutes: [] };
                todayStatsByConvMap.set(cid, stats);
              }

              const isMsgToday = getBrtDateKey(sentDate) === todayBrt;
              const pendingClientMs = pendingClientMsByConv.get(cid) ?? null;

              if (row.senderType === "client") {
                if (pendingClientMs === null) {
                  pendingClientMsByConv.set(cid, sentDate.getTime());
                }
              } else if (row.senderType === "agent") {
                if (isMsgToday) {
                  stats.sentMessagesToday += 1;
                  if (pendingClientMs !== null && sentDate.getTime() >= pendingClientMs) {
                    const diffMin = (sentDate.getTime() - pendingClientMs) / 60000;
                    if (diffMin <= 240) {
                      stats.responseDeltasMinutes.push(diffMin);
                    }
                  }
                }
                pendingClientMsByConv.set(cid, null);
              }
            }

            // Consolida deals vinculados por conversa, preferindo o funil filtrado quando ativo
            const dealsGroupedByConv = new Map<string, LiveDealSummary[]>();
            const seenConvDeal = new Set<string>();
            for (const row of extractRows(dealRowsRes)) {
              const cid = String(row.conversationId);
              const did = String(row.dealId);
              const pairKey = `${cid}::${did}`;
              if (seenConvDeal.has(pairKey)) continue;
              seenConvDeal.add(pairKey);

              const dealOpId = row.dealOperatorId ? String(row.dealOperatorId) : null;
              const dealItem: LiveDealSummary = {
                id: did,
                title: String(row.title || "Negociação"),
                value: row.value !== null && row.value !== undefined ? Number(row.value) : null,
                status: row.status ? String(row.status) : "open",
                pipelineId: row.pipelineId ? String(row.pipelineId) : null,
                pipelineName: row.pipelineName ? String(row.pipelineName) : null,
                stageId: row.stageId ? String(row.stageId) : null,
                stageName: row.stageName ? String(row.stageName) : null,
                rating: Number(row.rating || 0),
                operatorId: dealOpId,
                operatorName: dealOpId ? (opMap.get(dealOpId)?.name ?? null) : null,
              };

              const list = dealsGroupedByConv.get(cid) ?? [];
              list.push(dealItem);
              dealsGroupedByConv.set(cid, list);
            }

            for (const [cid, dealList] of dealsGroupedByConv.entries()) {
              const openDeals = dealList.filter((d) => d.status === "open");
              if (openDeals.length > 0) {
                hasOpenDealSet.add(cid);
              }
              const pipelineSource = openDeals.length > 0 ? openDeals : dealList;
              const pipelineIds = Array.from(
                new Set(
                  pipelineSource
                    .map((d) => d.pipelineId)
                    .filter((pid): pid is string => Boolean(pid))
                )
              );
              linkedPipelinesByConvMap.set(cid, pipelineIds);

              // Se há filtro por um funil específico, destaca o deal compatível com aquele funil
              let chosenDeal = dealList[0];
              if (pipelineIdFilter && pipelineIdFilter !== "__with_deal__") {
                const matchedInPipeline = dealList.find(
                  (d) => d.pipelineId === pipelineIdFilter
                );
                if (matchedInPipeline) {
                  chosenDeal = matchedInPipeline;
                }
              }
              if (chosenDeal) {
                dealByConvMap.set(cid, chosenDeal);
              }
            }

            // Consolida tarefas
            const groupedTasks = new Map<string, Map<string, LiveTaskItem>>();
            for (const r of extractRows(taskItemsRes)) {
              const cid = r.conversationId ? String(r.conversationId) : null;
              if (!cid) continue;
              if (!groupedTasks.has(cid)) {
                groupedTasks.set(cid, new Map());
              }
              const dueIso = toIso(r.dueDate);
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
          }

          // 7. Função helper para montar LiveConversation com classificação real (sem array gigante de mensagens)
          const buildLiveConv = (c: (typeof filteredConvs)[0]) => {
            const ms = msgSummaryMap.get(c.id);
            const rawLastText = (c.lastMessageText || ms?.lastAnyContent || "").trim();
            const hasRealInteraction =
              Boolean(ms?.hasRealMsg) ||
              (Boolean(rawLastText) && !BOILERPLATE_SYSTEM_RE.test(rawLastText));

            let waitingMinutes = 0;
            let isUnanswered = false;

            if (ms?.lastRealSenderType === "client") {
              isUnanswered = true;
              const waitStartIso = ms.firstUnansweredClientSentAt || ms.lastRealSentAt;
              if (waitStartIso) {
                const msgTime = new Date(waitStartIso).getTime();
                if (!Number.isNaN(msgTime)) {
                  waitingMinutes = Math.max(0, Math.floor((now.getTime() - msgTime) / 60000));
                }
              }
            } else if (c.queueState === "fila" && !c.operatorId) {
              const refTime = new Date(ms?.lastRealSentAt || c.lastMessageTime).getTime();
              if (!Number.isNaN(refTime)) {
                waitingMinutes = Math.max(0, Math.floor((now.getTime() - refTime) / 60000));
                isUnanswered = true;
              }
            }

            // Janela de 24h da Meta baseada na última mensagem do cliente
            const lastClientMessageAt = ms?.lastClientSentAt ?? null;
            let metaWindowOpen = false;
            let metaWindowRemainingMinutes: number | null = null;
            if (lastClientMessageAt) {
              const clientMs = new Date(lastClientMessageAt).getTime();
              const elapsedMs = now.getTime() - clientMs;
              const windowMs = 24 * 60 * 60 * 1000;
              if (elapsedMs >= 0 && elapsedMs < windowMs) {
                metaWindowOpen = true;
                metaWindowRemainingMinutes = Math.max(
                  1,
                  Math.floor((windowMs - elapsedMs) / 60000)
                );
              }
            }

            const effectiveLastTime = ms?.lastRealSentAt
              ? new Date(ms.lastRealSentAt)
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

            const failedMessagesCount = ms?.failedMessagesCount ?? 0;
            const taskSummary = tasksByConvMap.get(c.id);
            const opRecord = c.operatorId ? opMap.get(c.operatorId) : null;
            const secRecord = c.sectorId ? sectorMap.get(c.sectorId) : null;
            const todayStats = todayStatsByConvMap.get(c.id);

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
              sectorId: c.sectorId || null,
              sectorName: secRecord?.name || null,
              lastMessage:
                ms?.lastRealContent ||
                c.lastMessageText ||
                ms?.lastAnyContent ||
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
              linkedPipelineIds: linkedPipelinesByConvMap.get(c.id) ?? [],
              hasOpenDeal: hasOpenDealSet.has(c.id),
              openTasksCount: taskSummary?.openCount ?? 0,
              overdueTasksCount: taskSummary?.overdueCount ?? 0,
              nextTaskTitle: taskSummary?.nextTitle ?? null,
              tasks: taskSummary?.items ?? [],
              failedMessagesCount,
              sentMessagesToday: todayStats?.sentMessagesToday ?? 0,
              responseDeltasMinutes: todayStats?.responseDeltasMinutes ?? [],
              operatorId: c.operatorId || null,
              operatorName: opRecord?.name || null,
              messages: [],
            };
          };

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

          const allBuiltOpConvsPrePipeline = operatorConvsRaw.map(buildLiveConv);
          const allBuiltUnassignedPrePipeline = unassignedConvsRaw.map(buildLiveConv);
          const allBuiltAutomationPrePipeline = automationConvsRaw.map(buildLiveConv);

          // 7.5. Consolidar opções de Funis CRM no escopo atual (ANTES de aplicar pipelineIdFilter para não sumir opções)
          const pipelineAggMap = new Map<string, LivePipelineOption>();
          const prePipelineConvs = [
            ...allBuiltOpConvsPrePipeline,
            ...allBuiltUnassignedPrePipeline,
            ...allBuiltAutomationPrePipeline,
          ];
          for (const c of prePipelineConvs) {
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
          }
          const pipelines = Array.from(pipelineAggMap.values()).sort(
            (a, b) => b.count - a.count
          );

          // 7.6. Aplicar filtro de Funil CRM no servidor sobre todas as coleções
          const builtOpConvs = pipelineIdFilter
            ? allBuiltOpConvsPrePipeline.filter((c) => matchesLivePipeline(c, pipelineIdFilter))
            : allBuiltOpConvsPrePipeline;

          const unassignedResult = (
            pipelineIdFilter
              ? allBuiltUnassignedPrePipeline.filter((c) =>
                  matchesLivePipeline(c, pipelineIdFilter)
                )
              : allBuiltUnassignedPrePipeline
          ).sort(sortConversationsByPriority);

          const automationResult = (
            pipelineIdFilter
              ? allBuiltAutomationPrePipeline.filter((c) =>
                  matchesLivePipeline(c, pipelineIdFilter)
                )
              : allBuiltAutomationPrePipeline
          ).sort(sortConversationsByPriority);

          // 8. Montar resposta por operador com métricas reais + produtividade do dia (já filtradas)
          const buildOperatorPayload = (
            opId: string,
            opName: string,
            opAvatar: string | null,
            opStatus: string,
            presence: { isOnline: boolean; lastSeenAt: string | null; usageSecondsToday: number },
            builtConvsInput: ReturnType<typeof buildLiveConv>[]
          ) => {
            const builtConvs = [...builtConvsInput].sort(sortConversationsByPriority);

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
            const seenDeals = new Set<string>();
            const activeDealsValue = builtConvs.reduce((sum, c) => {
              if (
                c.activeDeal &&
                c.activeDeal.status === "open" &&
                c.activeDeal.value &&
                !seenDeals.has(c.activeDeal.id)
              ) {
                seenDeals.add(c.activeDeal.id);
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

            const sentMessagesToday = builtConvs.reduce(
              (acc, c) => acc + (c.sentMessagesToday ?? 0),
              0
            );
            const responseDeltasMinutes = builtConvs.flatMap(
              (c) => c.responseDeltasMinutes ?? []
            );

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
              sectorIds: operatorSectorsMap.get(opId) ?? [],
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

          const builtOpConvsByOpId = new Map<string, ReturnType<typeof buildLiveConv>[]>();
          for (const conv of builtOpConvs) {
            if (!conv.operatorId) continue;
            const list = builtOpConvsByOpId.get(conv.operatorId) ?? [];
            list.push(conv);
            builtOpConvsByOpId.set(conv.operatorId, list);
          }

          const hasRestrictiveConvFilter = Boolean(pipelineIdFilter || searchLower);

          const operatorResult = opList
            .filter((op) => {
              if (opIdFilter) return op.id === opIdFilter;
              const opConvs = builtOpConvsByOpId.get(op.id) ?? [];
              if (sectorIdFilter) {
                const belongsToSector = Boolean(selectedSectorOpSet?.has(op.id));
                if (!belongsToSector && opConvs.length === 0) return false;
              }
              if (hasRestrictiveConvFilter && opConvs.length === 0) {
                return false;
              }
              return true;
            })
            .map((op) => {
              const opConvs = builtOpConvsByOpId.get(op.id) ?? [];
              const presence = presenceByOpId.get(op.id) ?? {
                isOnline: false,
                lastSeenAt: null,
                usageSecondsToday: 0,
              };
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
          for (const [opId, convs] of builtOpConvsByOpId.entries()) {
            if (knownOpIds.has(opId)) continue;
            if (opIdFilter && opId !== opIdFilter) continue;
            if (convs.length === 0) continue;
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

          // Diretório completo de operadores do tenant (nunca some dos dropdowns ao filtrar 1 operador)
          const opResultMap = new Map(operatorResult.map((o) => [o.operatorId, o]));
          const allOperatorsDirectory: LiveOperatorDirectoryItem[] = opList
            .map((op) => {
              const presence = presenceByOpId.get(op.id);
              const matched = opResultMap.get(op.id);
              return {
                operatorId: op.id,
                operatorName: op.name,
                operatorAvatar: op.avatar || null,
                status: (op.status || "disponivel") as "disponivel" | "ocupado" | "ausente",
                isOnline: Boolean(presence?.isOnline),
                lastSeenAt: presence?.lastSeenAt ?? null,
                sectorIds: operatorSectorsMap.get(op.id) ?? [],
                waitingReplyCount: matched?.waitingReplyCount ?? 0,
                activeTodayCount: matched?.activeTodayCount ?? 0,
              };
            })
            .sort((a, b) => {
              if ((b.waitingReplyCount ?? 0) !== (a.waitingReplyCount ?? 0)) {
                return (b.waitingReplyCount ?? 0) - (a.waitingReplyCount ?? 0);
              }
              if (Boolean(a.isOnline) !== Boolean(b.isOnline)) {
                return a.isOnline ? -1 : 1;
              }
              return a.operatorName.localeCompare(b.operatorName, "pt-BR");
            });

          // 9. Consolidar Summary Executivo estritamente sobre o dataset já filtrado
          const summary = computeLiveSummary(
            operatorResult,
            unassignedResult,
            automationResult
          );

          return new Response(
            JSON.stringify({
              operators: operatorResult,
              unassigned: unassignedResult,
              automation: automationResult,
              summary,
              pipelines,
              sectors: sectorOptions,
              allOperators: allOperatorsDirectory,
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
