import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import {
  aiConversationAudits,
  conversations,
  operators,
} from "../../../db/schema";
import {
  eq,
  and,
  desc,
  exists,
  inArray,
  or,
  sql,
} from "drizzle-orm";
import {
  AuditService,
  computeFallbackPillarScores,
} from "../../../lib/audit-service";
import { requireSession } from "../../../lib/auth-session";
import { conversationReadCondition } from "../../../lib/access-control/conversation-access";
import {
  computeOperatorPresenceSnapshot,
  getBrtDateKey,
} from "../../../lib/operator-presence";
import type {
  AuditItem,
  AuditOperatorRankingItem,
  AuditStatusCounts,
  AuditsApiResponse,
  AuditsExecutiveSummary,
  LiveDealSummary,
  LiveMessage,
} from "../../../lib/monitor-mock-data";

// Inicia o serviço de auditoria ao carregar esta rota
AuditService.getInstance().start();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function extractRows<T = any>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && Array.isArray((result as any).rows)) {
    return (result as any).rows as T[];
  }
  return [];
}

function parseMediaPreview(
  content: string | null | undefined,
  transcription?: string | null,
): {
  text: string;
  mediaType: string | null;
  mediaId: string | null;
} {
  const raw = (content || "").trim();
  if (!raw) {
    return { text: "", mediaType: null, mediaId: null };
  }
  const match = raw.match(
    /^\[MEDIA:(image|video|audio|document|sticker|contact|location)\]([^\n]*)(?:\n([\s\S]*))?$/i,
  );
  if (!match) {
    return { text: raw, mediaType: null, mediaId: null };
  }
  const mediaType = match[1].toLowerCase();
  const mediaId = (match[2] || "").trim() || null;
  const caption = (match[3] || "").trim();

  if (mediaType === "audio") {
    const cleanTranscript = (transcription || "").trim();
    return {
      text: caption || (cleanTranscript ? `Áudio: "${cleanTranscript}"` : "Mensagem de áudio"),
      mediaType: "audio",
      mediaId,
    };
  }

  const labelMap: Record<string, string> = {
    image: "Imagem",
    video: "Vídeo",
    document: "Documento",
    sticker: "Figurinha",
    contact: "Contato",
    location: "Localização",
  };
  return {
    text: caption || labelMap[mediaType] || "Anexo",
    mediaType,
    mediaId,
  };
}

export const Route = createFileRoute("/api/gestao/audits")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      GET: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;

        const canViewAudits =
          session.operator.role === "admin" ||
          (session.permissions?.views?.monitor === true &&
            session.permissions?.monitor?.canAccessAudits === true) ||
          (session.permissions?.views?.analytics === true &&
            session.permissions?.analytics?.canAccessOverview === true);
        if (!canViewAudits) {
          return new Response(
            JSON.stringify({
              error: "Permissão insuficiente para visualizar auditorias.",
              code: "FORBIDDEN",
            }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        const url = new URL(request.url);
        const queryTenantId = url.searchParams.get("tenantId");
        if (queryTenantId && queryTenantId !== tenantId) {
          return new Response(
            JSON.stringify({ error: "Acesso negado ao tenant especificado.", code: "FORBIDDEN" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        const date = url.searchParams.get("date"); // 'YYYY-MM-DD', opcional
        const period = url.searchParams.get("period") ?? "all"; // 'today' | '7d' | '30d' | 'all'
        const operatorId = url.searchParams.get("operatorId"); // opcional
        const statusParam = url.searchParams.get("status") ?? "done"; // 'done' | 'pending' | 'processing' | 'error' | 'all'
        const wantSummary =
          url.searchParams.get("summary") === "1" ||
          url.searchParams.get("summary") === "true";
        const limitParam = url.searchParams.get("limit") ?? "60";
        const limit = Math.min(Math.max(parseInt(limitParam) || 60, 1), 150);

        try {
          // Auto-descoberta inicial se o tenant ainda não tiver auditorias enfileiradas
          await AuditService.getInstance().ensureInitialTenantScan(tenantId);

          const visibleConvFilter = exists(
            db
              .select({ id: conversations.id })
              .from(conversations)
              .where(
                and(
                  eq(conversations.id, aiConversationAudits.conversationId),
                  eq(conversations.tenantId, tenantId),
                  conversationReadCondition(session),
                ),
              ),
          );

          // Filtro temporal em fuso BRT (-03:00) usando COALESCE(audited_at, created_at)
          const timeFilters: any[] = [];
          if (date) {
            const dayStartIso = new Date(`${date}T00:00:00.000-03:00`).toISOString();
            const dayEndIso = new Date(`${date}T23:59:59.999-03:00`).toISOString();
            timeFilters.push(
              sql`COALESCE(${aiConversationAudits.auditedAt}, ${aiConversationAudits.createdAt}) >= ${dayStartIso}::timestamptz`,
              sql`COALESCE(${aiConversationAudits.auditedAt}, ${aiConversationAudits.createdAt}) <= ${dayEndIso}::timestamptz`,
            );
          } else if (period === "today") {
            const todayBrt = getBrtDateKey(new Date());
            const dayStartIso = new Date(`${todayBrt}T00:00:00.000-03:00`).toISOString();
            timeFilters.push(
              sql`COALESCE(${aiConversationAudits.auditedAt}, ${aiConversationAudits.createdAt}) >= ${dayStartIso}::timestamptz`,
            );
          } else if (period === "7d") {
            const sinceIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
            timeFilters.push(
              sql`COALESCE(${aiConversationAudits.auditedAt}, ${aiConversationAudits.createdAt}) >= ${sinceIso}::timestamptz`,
            );
          } else if (period === "30d") {
            const sinceIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
            timeFilters.push(
              sql`COALESCE(${aiConversationAudits.auditedAt}, ${aiConversationAudits.createdAt}) >= ${sinceIso}::timestamptz`,
            );
          }

          const baseScopeFilters: any[] = [
            eq(aiConversationAudits.tenantId, tenantId),
            visibleConvFilter,
            ...timeFilters,
          ];

          const listFilters: any[] = [...baseScopeFilters];
          if (operatorId) {
            listFilters.push(eq(aiConversationAudits.operatorId, operatorId));
          }

          if (statusParam === "pending") {
            // Mostra tanto 'pending' quanto 'processing' na aba de fila/pendentes
            listFilters.push(
              or(
                eq(aiConversationAudits.status, "pending"),
                eq(aiConversationAudits.status, "processing"),
              ),
            );
          } else if (statusParam !== "all") {
            listFilters.push(eq(aiConversationAudits.status, statusParam));
          }

          // Busca tanto as auditorias filtradas quanto todas as auditorias do escopo (para contadores e ranking)
          const [audits, allScopeAudits] = await Promise.all([
            db
              .select({
                id: aiConversationAudits.id,
                conversationId: aiConversationAudits.conversationId,
                operatorId: aiConversationAudits.operatorId,
                contactName: aiConversationAudits.contactName,
                performanceScore: aiConversationAudits.performanceScore,
                clientSentiment: aiConversationAudits.clientSentiment,
                hadLongResponseGap: aiConversationAudits.hadLongResponseGap,
                hadMissedObjection: aiConversationAudits.hadMissedObjection,
                hadRudeLanguage: aiConversationAudits.hadRudeLanguage,
                hadNoFollowUp: aiConversationAudits.hadNoFollowUp,
                summary: aiConversationAudits.summary,
                strengths: aiConversationAudits.strengths,
                weaknesses: aiConversationAudits.weaknesses,
                actionableInsight: aiConversationAudits.actionableInsight,
                rawAiResponse: aiConversationAudits.rawAiResponse,
                status: aiConversationAudits.status,
                errorMessage: aiConversationAudits.errorMessage,
                auditedAt: aiConversationAudits.auditedAt,
                createdAt: aiConversationAudits.createdAt,
              })
              .from(aiConversationAudits)
              .where(and(...listFilters))
              .orderBy(
                desc(
                  statusParam === "done"
                    ? aiConversationAudits.auditedAt
                    : aiConversationAudits.createdAt,
                ),
              )
              .limit(limit),

            wantSummary
              ? db
                  .select({
                    id: aiConversationAudits.id,
                    conversationId: aiConversationAudits.conversationId,
                    operatorId: aiConversationAudits.operatorId,
                    contactName: aiConversationAudits.contactName,
                    performanceScore: aiConversationAudits.performanceScore,
                    clientSentiment: aiConversationAudits.clientSentiment,
                    hadLongResponseGap: aiConversationAudits.hadLongResponseGap,
                    hadMissedObjection: aiConversationAudits.hadMissedObjection,
                    hadRudeLanguage: aiConversationAudits.hadRudeLanguage,
                    hadNoFollowUp: aiConversationAudits.hadNoFollowUp,
                    rawAiResponse: aiConversationAudits.rawAiResponse,
                    status: aiConversationAudits.status,
                    auditedAt: aiConversationAudits.auditedAt,
                  })
                  .from(aiConversationAudits)
                  .where(and(...baseScopeFilters))
                  .limit(300)
              : Promise.resolve([]),
          ]);

          const allConvIds = [
            ...new Set([
              ...audits.map((a) => a.conversationId),
              ...allScopeAudits.map((a) => a.conversationId),
            ]),
          ].filter(Boolean);

          // Hidrata metadados de conversas, contatos e empresas em lote
          const convMetaMap = new Map<
            string,
            {
              contactId: string | null;
              contactName: string | null;
              contactPhone: string | null;
              contactAvatar: string | null;
              accountId: string | null;
              accountName: string | null;
              queueState: string;
              convOperatorId: string | null;
              walletOperatorId: string | null;
            }
          >();

          if (allConvIds.length > 0) {
            const convRowsRes = await db.execute(sql`
              SELECT
                c.id AS conversation_id,
                c.contact_id,
                c.queue_state,
                c.operator_id AS conv_operator_id,
                ct.name AS contact_name,
                ct.phone AS contact_phone,
                ct.avatar AS contact_avatar,
                ct.account_id,
                ct.wallet_operator_id,
                acc.name AS account_name
              FROM conversations c
              LEFT JOIN contacts ct
                ON ct.id = c.contact_id AND ct.tenant_id = c.tenant_id
              LEFT JOIN crm_accounts acc
                ON acc.id = ct.account_id AND acc.tenant_id = c.tenant_id
              WHERE c.tenant_id = ${tenantId}
                AND c.id IN (${sql.join(
                  allConvIds.map((id) => sql`${id}`),
                  sql`, `,
                )})
            `);

            for (const r of extractRows<any>(convRowsRes)) {
              convMetaMap.set(r.conversation_id, {
                contactId: r.contact_id ?? null,
                contactName: r.contact_name ?? null,
                contactPhone: r.contact_phone ?? null,
                contactAvatar: r.contact_avatar ?? null,
                accountId: r.account_id ?? null,
                accountName: r.account_name ?? null,
                queueState: r.queue_state ?? "finalizados",
                convOperatorId: r.conv_operator_id ?? null,
                walletOperatorId: r.wallet_operator_id ?? null,
              });
            }
          }

          // Hidrata operadores e presença em lote
          const allOps = await db
            .select({
              id: operators.id,
              name: operators.name,
              avatar: operators.avatar,
              status: operators.status,
              isOnline: operators.isOnline,
              lastSeenAt: operators.lastSeenAt,
              usageDate: operators.usageDate,
              usageSecondsToday: operators.usageSecondsToday,
            })
            .from(operators)
            .where(eq(operators.tenantId, tenantId));

          const operatorMap = new Map<
            string,
            { name: string; avatar: string | null; isOnline: boolean }
          >();
          for (const op of allOps) {
            const pres = computeOperatorPresenceSnapshot(op, tenantId, session.operator.id);
            operatorMap.set(op.id, {
              name: op.name,
              avatar: op.avatar ?? null,
              isOnline: pres.isOnline,
            });
          }

          // Hidrata negociações (CRM deals) vinculadas às conversas ou contatos em lote
          const dealByConvMap = new Map<
            string,
            LiveDealSummary & { lossReason?: string | null; winReason?: string | null }
          >();
          const dealByContactMap = new Map<
            string,
            LiveDealSummary & { lossReason?: string | null; winReason?: string | null }
          >();

          if (allConvIds.length > 0) {
            const convIdSqlList = sql.join(
              allConvIds.map((id) => sql`${id}`),
              sql`, `,
            );

            const dealsRes = await db
              .execute(sql`
                SELECT DISTINCT ON (conv_id)
                  conv_id AS conversation_id,
                  d.id,
                  d.title,
                  d.value,
                  d.status,
                  d.loss_reason,
                  p.name AS pipeline_name,
                  s.name AS stage_name
                FROM (
                  SELECT c.id AS conv_id, cdc.current_deal_id AS deal_id, 1 AS priority
                  FROM conversations c
                  INNER JOIN conversation_deal_contexts cdc
                    ON cdc.conversation_id = c.id AND cdc.tenant_id = ${tenantId}
                  WHERE c.tenant_id = ${tenantId}
                    AND c.id IN (${convIdSqlList})
                    AND cdc.current_deal_id IS NOT NULL

                  UNION ALL

                  SELECT ccd.conversation_id AS conv_id, ccd.deal_id AS deal_id, 2 AS priority
                  FROM crm_conversation_deals ccd
                  WHERE ccd.tenant_id = ${tenantId}
                    AND ccd.conversation_id IN (${convIdSqlList})
                    AND ccd.is_active = true

                  UNION ALL

                  SELECT c.id AS conv_id, dc.deal_id AS deal_id, 3 AS priority
                  FROM conversations c
                  INNER JOIN crm_deal_contacts dc
                    ON dc.contact_id = c.contact_id AND dc.tenant_id = ${tenantId}
                  WHERE c.tenant_id = ${tenantId}
                    AND c.id IN (${convIdSqlList})
                ) links
                INNER JOIN crm_deals d
                  ON d.id = links.deal_id AND d.tenant_id = ${tenantId}
                LEFT JOIN crm_pipelines p
                  ON p.id = d.pipeline_id AND p.tenant_id = ${tenantId}
                LEFT JOIN crm_stages s
                  ON s.id = d.stage_id AND s.tenant_id = ${tenantId}
                ORDER BY
                  conv_id,
                  CASE d.status WHEN 'open' THEN 0 WHEN 'won' THEN 1 WHEN 'lost' THEN 2 ELSE 3 END ASC,
                  links.priority ASC,
                  d.updated_at DESC
              `)
              .catch((err) => {
                console.warn("[gestao/audits] Aviso ao hidratar deals:", err?.message);
                return [];
              });

            for (const row of extractRows<any>(dealsRes)) {
              const summaryObj: LiveDealSummary & {
                lossReason?: string | null;
                winReason?: string | null;
              } = {
                id: row.id,
                title: row.title || "Negociação",
                value: row.value !== null && row.value !== undefined ? Number(row.value) : null,
                status: row.status || "open",
                pipelineName: row.pipeline_name ?? null,
                stageName: row.stage_name ?? null,
                lossReason: row.loss_reason ?? null,
                winReason: null,
              };
              if (row.conversation_id && !dealByConvMap.has(row.conversation_id)) {
                dealByConvMap.set(row.conversation_id, summaryObj);
              }
            }
          }

          // Hidrata métricas de SLA e últimas mensagens para os itens retornados na lista
          const listConvIds = [...new Set(audits.map((a) => a.conversationId))].filter(Boolean);
          const slaMetricsMap = new Map<
            string,
            {
              avgResponseSeconds: number | null;
              maxResponseSeconds: number | null;
              overdueCyclesCount: number;
              messageCount: number;
              clientMessageCount: number;
              agentMessageCount: number;
            }
          >();
          const recentMessagesMap = new Map<string, LiveMessage[]>();

          if (listConvIds.length > 0) {
            const listConvSql = sql.join(
              listConvIds.map((id) => sql`${id}`),
              sql`, `,
            );

            const [slaAggRes, msgAggRes, recentMsgsRes] = await Promise.all([
              db.execute(sql`
                SELECT
                  conversation_id,
                  ROUND(AVG(response_time_seconds) FILTER (WHERE response_time_seconds > 0))::int AS avg_sec,
                  MAX(response_time_seconds) FILTER (WHERE response_time_seconds > 0)::int AS max_sec,
                  COUNT(*) FILTER (WHERE is_overdue = true OR response_time_seconds > 900)::int AS overdue_cnt
                FROM response_time_logs
                WHERE tenant_id = ${tenantId}
                  AND conversation_id IN (${listConvSql})
                GROUP BY conversation_id
              `),
              db.execute(sql`
                SELECT
                  conversation_id,
                  COUNT(*) FILTER (WHERE is_internal_note = false AND sender_type IN ('client', 'agent'))::int AS total_cnt,
                  COUNT(*) FILTER (WHERE is_internal_note = false AND sender_type = 'client')::int AS client_cnt,
                  COUNT(*) FILTER (WHERE is_internal_note = false AND sender_type = 'agent')::int AS agent_cnt
                FROM messages
                WHERE tenant_id = ${tenantId}
                  AND conversation_id IN (${listConvSql})
                GROUP BY conversation_id
              `),
              db.execute(sql`
                WITH ranked_msgs AS (
                  SELECT
                    m.id,
                    m.conversation_id,
                    m.sender_type,
                    m.sender_name,
                    m.content,
                    m.media_interpretation,
                    m.is_internal_note,
                    m.status,
                    m.error_message,
                    m.meta_details,
                    m.sent_at,
                    ROW_NUMBER() OVER (PARTITION BY m.conversation_id ORDER BY m.sent_at DESC) AS rn
                  FROM messages m
                  WHERE m.tenant_id = ${tenantId}
                    AND m.conversation_id IN (${listConvSql})
                )
                SELECT *
                FROM ranked_msgs
                WHERE rn <= 18
                ORDER BY conversation_id, sent_at ASC
              `),
            ]);

            const slaTemp = new Map<
              string,
              { avg: number | null; max: number | null; overdue: number }
            >();
            for (const r of extractRows<any>(slaAggRes)) {
              slaTemp.set(r.conversation_id, {
                avg: r.avg_sec !== null ? Number(r.avg_sec) : null,
                max: r.max_sec !== null ? Number(r.max_sec) : null,
                overdue: Number(r.overdue_cnt ?? 0),
              });
            }

            const msgTemp = new Map<
              string,
              { total: number; client: number; agent: number }
            >();
            for (const r of extractRows<any>(msgAggRes)) {
              msgTemp.set(r.conversation_id, {
                total: Number(r.total_cnt ?? 0),
                client: Number(r.client_cnt ?? 0),
                agent: Number(r.agent_cnt ?? 0),
              });
            }

            for (const cid of listConvIds) {
              const s = slaTemp.get(cid);
              const m = msgTemp.get(cid);
              slaMetricsMap.set(cid, {
                avgResponseSeconds: s?.avg ?? null,
                maxResponseSeconds: s?.max ?? null,
                overdueCyclesCount: s?.overdue ?? 0,
                messageCount: m?.total ?? 0,
                clientMessageCount: m?.client ?? 0,
                agentMessageCount: m?.agent ?? 0,
              });
            }

            for (const m of extractRows<any>(recentMsgsRes)) {
              const parsed = parseMediaPreview(m.content, m.media_interpretation);
              const isWhisper = Boolean(m.meta_details?.supervisorWhisper);
              const senderType: "client" | "agent" | "bot" | "system" =
                m.sender_type === "client"
                  ? "client"
                  : m.sender_type === "system" && !isWhisper
                  ? "system"
                  : m.sender_type === "bot"
                  ? "bot"
                  : "agent";
              const msgItem: LiveMessage = {
                id: m.id,
                conversationId: m.conversation_id,
                senderType,
                sender: senderType === "client" ? "client" : "agent",
                senderName: m.sender_name || (senderType === "client" ? "Cliente" : "Consultor"),
                content: m.content || "",
                text: parsed.text,
                time: new Date(m.sent_at).toLocaleTimeString("pt-BR", {
                  timeZone: "America/Sao_Paulo",
                  hour: "2-digit",
                  minute: "2-digit",
                }),
                sentAt: new Date(m.sent_at).toISOString(),
                mediaInterpretation: m.media_interpretation ?? null,
                status: m.status ?? undefined,
                errorMessage: m.error_message ?? null,
                isInternalNote: Boolean(m.is_internal_note),
                metaDetails: m.meta_details ?? null,
              };
              const list = recentMessagesMap.get(m.conversation_id) ?? [];
              list.push(msgItem);
              recentMessagesMap.set(m.conversation_id, list);
            }
          }

          const buildEnrichedAudit = (a: (typeof audits)[number]): AuditItem => {
            const convMeta = convMetaMap.get(a.conversationId);
            const effectiveOpId =
              a.operatorId || convMeta?.convOperatorId || convMeta?.walletOperatorId || null;
            const opInfo = effectiveOpId ? operatorMap.get(effectiveOpId) : undefined;
            const rawName =
              a.contactName && a.contactName.trim() !== "" && a.contactName !== "Desconhecido"
                ? a.contactName.trim()
                : convMeta?.contactName || "Cliente sem nome";

            const deal =
              dealByConvMap.get(a.conversationId) ||
              (convMeta?.contactId ? dealByContactMap.get(convMeta.contactId) : null) ||
              null;

            const flagCount = [
              a.hadLongResponseGap,
              a.hadMissedObjection,
              a.hadRudeLanguage,
              a.hadNoFollowUp,
            ].filter(Boolean).length;

            const rawJson = (a.rawAiResponse as any) || {};
            const pillarScores = computeFallbackPillarScores({
              performanceScore: a.performanceScore,
              hadLongResponseGap: a.hadLongResponseGap,
              hadMissedObjection: a.hadMissedObjection,
              hadRudeLanguage: a.hadRudeLanguage,
              hadNoFollowUp: a.hadNoFollowUp,
              rawAiResponse: rawJson,
            });

            const score = a.performanceScore ?? 75;
            const defaultRisk: "baixo" | "medio" | "alto" | "critico" =
              score < 50 || a.clientSentiment === "frustrado"
                ? "critico"
                : score < 65 || flagCount >= 2
                ? "alto"
                : score < 80 || flagCount === 1
                ? "medio"
                : "baixo";

            const coachingSuggestion =
              rawJson?.coachingMessageSuggestion ||
              (a.actionableInsight
                ? `Orientação de Auditoria IA (${rawName}): ${a.actionableInsight}`
                : null);

            return {
              id: a.id,
              conversationId: a.conversationId,
              operatorId: effectiveOpId,
              operatorName: opInfo?.name ?? (effectiveOpId ? "Consultor" : "Sem consultor"),
              operatorAvatar: opInfo?.avatar ?? null,
              contactId: convMeta?.contactId ?? null,
              contactName: rawName,
              contactPhone: convMeta?.contactPhone ?? null,
              contactAvatar: convMeta?.contactAvatar ?? null,
              accountId: convMeta?.accountId ?? null,
              accountName: convMeta?.accountName ?? null,
              queueState: convMeta?.queueState ?? "finalizados",
              performanceScore: a.performanceScore,
              clientSentiment: a.clientSentiment,
              hadLongResponseGap: a.hadLongResponseGap,
              hadMissedObjection: a.hadMissedObjection,
              hadRudeLanguage: a.hadRudeLanguage,
              hadNoFollowUp: a.hadNoFollowUp,
              summary: a.summary,
              strengths: a.strengths,
              weaknesses: a.weaknesses,
              actionableInsight: a.actionableInsight,
              coachingMessageSuggestion: coachingSuggestion,
              pillarScores,
              detectedStage: rawJson?.detectedStage ?? null,
              commercialRiskLevel: rawJson?.commercialRiskLevel ?? defaultRisk,
              deal,
              slaMetrics: slaMetricsMap.get(a.conversationId) ?? {
                avgResponseSeconds: null,
                maxResponseSeconds: null,
                overdueCyclesCount: 0,
                messageCount: 0,
                clientMessageCount: 0,
                agentMessageCount: 0,
              },
              recentMessages: recentMessagesMap.get(a.conversationId) ?? [],
              flagCount,
              status: a.status,
              errorMessage: a.errorMessage,
              auditedAt: a.auditedAt ? a.auditedAt.toISOString() : null,
              createdAt: a.createdAt ? a.createdAt.toISOString() : null,
            };
          };

          const result = audits.map(buildEnrichedAudit);

          if (!wantSummary) {
            return new Response(JSON.stringify(result), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          // Conta quantos atendimentos com diálogo real ainda não possuem auditoria concluída
          const eligibleRes = await db.execute(sql`
            WITH conv_msg_stats AS (
              SELECT
                m.conversation_id,
                MAX(m.sent_at) FILTER (WHERE m.is_internal_note = false AND m.sender_type IN ('client', 'agent')) AS last_msg_at
              FROM messages m
              WHERE m.tenant_id = ${tenantId}
              GROUP BY m.conversation_id
              HAVING COUNT(*) FILTER (WHERE m.is_internal_note = false AND m.sender_type IN ('client', 'agent')) >= 3
                 AND COUNT(*) FILTER (WHERE m.is_internal_note = false AND m.sender_type = 'client') >= 1
                 AND COUNT(*) FILTER (WHERE m.is_internal_note = false AND m.sender_type = 'agent') >= 1
            )
            SELECT COUNT(*)::int AS cnt
            FROM conv_msg_stats cms
            JOIN conversations c
              ON c.id = cms.conversation_id AND c.tenant_id = ${tenantId}
            LEFT JOIN ai_conversation_audits a
              ON a.conversation_id = c.id AND a.tenant_id = c.tenant_id
            WHERE a.id IS NULL
               OR a.status = 'error'
               OR (a.status = 'done' AND a.audited_at IS NOT NULL AND cms.last_msg_at > a.audited_at + INTERVAL '10 minutes')
          `);
          const eligibleUnauditedCount = Number(
            extractRows<{ cnt: number }>(eligibleRes)[0]?.cnt ?? 0,
          );

          // Calcula contadores de status e sumário executivo sobre allScopeAudits
          const statusCounts: AuditStatusCounts = {
            done: allScopeAudits.filter((a) => a.status === "done").length,
            pending: allScopeAudits.filter(
              (a) => a.status === "pending" || a.status === "processing",
            ).length,
            processing: allScopeAudits.filter((a) => a.status === "processing").length,
            error: allScopeAudits.filter((a) => a.status === "error").length,
            eligibleUnauditedCount,
          };

          const doneAudits = allScopeAudits.filter(
            (a) => a.status === "done" && a.performanceScore !== null,
          );

          let scoreSum = 0;
          let excellentCount = 0;
          let attentionCount = 0;
          let criticalCount = 0;
          let satisfiedCount = 0;
          let neutralCount = 0;
          let frustratedCount = 0;
          let longGapCount = 0;
          let missedObjectionCount = 0;
          let noFollowUpCount = 0;
          let rudeLanguageCount = 0;
          let totalFlagsCount = 0;

          let auditedPipelineValue = 0;
          let atRiskPipelineValue = 0;
          let atRiskDealsCount = 0;
          let wonDealsAuditedCount = 0;
          let lostDealsAuditedCount = 0;
          const seenDealIds = new Set<string>();
          const seenAtRiskDealIds = new Set<string>();

          let agilitySum = 0;
          let qualSum = 0;
          let objSum = 0;
          let closeSum = 0;

          const opAggMap = new Map<
            string,
            {
              operatorId: string;
              operatorName: string;
              operatorAvatar: string | null;
              isOnline: boolean;
              auditedCount: number;
              scoreSum: number;
              criticalCount: number;
              excellentCount: number;
              satisfiedCount: number;
              frustratedCount: number;
              flagCount: number;
              longGapCount: number;
              missedObjectionCount: number;
              noFollowUpCount: number;
              rudeLanguageCount: number;
              pipelineValue: number;
              atRiskValue: number;
              seenDeals: Set<string>;
            }
          >();

          for (const a of doneAudits) {
            const sc = a.performanceScore ?? 0;
            scoreSum += sc;
            if (sc >= 80) excellentCount++;
            else if (sc >= 60) attentionCount++;
            else criticalCount++;

            if (a.clientSentiment === "satisfeito") satisfiedCount++;
            else if (a.clientSentiment === "frustrado") frustratedCount++;
            else neutralCount++;

            if (a.hadLongResponseGap) longGapCount++;
            if (a.hadMissedObjection) missedObjectionCount++;
            if (a.hadNoFollowUp) noFollowUpCount++;
            if (a.hadRudeLanguage) rudeLanguageCount++;

            const fc = [
              a.hadLongResponseGap,
              a.hadMissedObjection,
              a.hadRudeLanguage,
              a.hadNoFollowUp,
            ].filter(Boolean).length;
            totalFlagsCount += fc;

            const pillars = computeFallbackPillarScores({
              performanceScore: sc,
              hadLongResponseGap: a.hadLongResponseGap,
              hadMissedObjection: a.hadMissedObjection,
              hadRudeLanguage: a.hadRudeLanguage,
              hadNoFollowUp: a.hadNoFollowUp,
              rawAiResponse: a.rawAiResponse,
            });
            agilitySum += pillars.agility;
            qualSum += pillars.qualification;
            objSum += pillars.objectionHandling;
            closeSum += pillars.closingNextStep;

            const convMeta = convMetaMap.get(a.conversationId);
            const deal =
              dealByConvMap.get(a.conversationId) ||
              (convMeta?.contactId ? dealByContactMap.get(convMeta.contactId) : null) ||
              null;

            const isAtRisk = sc < 65 || a.clientSentiment === "frustrado" || fc >= 2;

            if (deal) {
              const dealAmt = Number(deal.value ?? 0);
              if (!seenDealIds.has(deal.id)) {
                seenDealIds.add(deal.id);
                auditedPipelineValue += dealAmt;
                if (deal.status === "won") wonDealsAuditedCount++;
                else if (deal.status === "lost") lostDealsAuditedCount++;
              }
              if (isAtRisk && !seenAtRiskDealIds.has(deal.id)) {
                seenAtRiskDealIds.add(deal.id);
                atRiskPipelineValue += dealAmt;
                atRiskDealsCount++;
              }
            }

            const effectiveOpId =
              a.operatorId ||
              convMeta?.convOperatorId ||
              convMeta?.walletOperatorId ||
              "__sem_operador__";
            const opInfo =
              effectiveOpId !== "__sem_operador__" ? operatorMap.get(effectiveOpId) : undefined;
            const opName =
              opInfo?.name ??
              (effectiveOpId === "__sem_operador__" ? "Sem Consultor" : "Consultor");

            const currOp = opAggMap.get(effectiveOpId) ?? {
              operatorId: effectiveOpId,
              operatorName: opName,
              operatorAvatar: opInfo?.avatar ?? null,
              isOnline: opInfo?.isOnline ?? false,
              auditedCount: 0,
              scoreSum: 0,
              criticalCount: 0,
              excellentCount: 0,
              satisfiedCount: 0,
              frustratedCount: 0,
              flagCount: 0,
              longGapCount: 0,
              missedObjectionCount: 0,
              noFollowUpCount: 0,
              rudeLanguageCount: 0,
              pipelineValue: 0,
              atRiskValue: 0,
              seenDeals: new Set<string>(),
            };

            currOp.auditedCount++;
            currOp.scoreSum += sc;
            if (sc < 60) currOp.criticalCount++;
            if (sc >= 80) currOp.excellentCount++;
            if (a.clientSentiment === "satisfeito") currOp.satisfiedCount++;
            if (a.clientSentiment === "frustrado") currOp.frustratedCount++;
            currOp.flagCount += fc;
            if (a.hadLongResponseGap) currOp.longGapCount++;
            if (a.hadMissedObjection) currOp.missedObjectionCount++;
            if (a.hadNoFollowUp) currOp.noFollowUpCount++;
            if (a.hadRudeLanguage) currOp.rudeLanguageCount++;

            if (deal && !currOp.seenDeals.has(deal.id)) {
              currOp.seenDeals.add(deal.id);
              const amt = Number(deal.value ?? 0);
              currOp.pipelineValue += amt;
              if (isAtRisk) currOp.atRiskValue += amt;
            }

            opAggMap.set(effectiveOpId, currOp);
          }

          const totalAudited = doneAudits.length;
          const failureEntries = [
            { label: "Sem próximo passo (Follow-up)", count: noFollowUpCount },
            { label: "Demora excessiva (>15m)", count: longGapCount },
            { label: "Objeção ignorada", count: missedObjectionCount },
            { label: "Postura / linguagem inadequada", count: rudeLanguageCount },
          ].sort((a, b) => b.count - a.count);

          const topFailureLabel =
            failureEntries[0].count > 0
              ? `${failureEntries[0].label} (${failureEntries[0].count})`
              : "Nenhuma falha crítica recorrente";

          const summary: AuditsExecutiveSummary = {
            totalAudited,
            avgScore: totalAudited > 0 ? Math.round(scoreSum / totalAudited) : null,
            excellentCount,
            attentionCount,
            criticalCount,
            satisfiedCount,
            neutralCount,
            frustratedCount,
            satisfactionPct:
              totalAudited > 0 ? Math.round((satisfiedCount / totalAudited) * 100) : null,
            totalFlagsCount,
            longGapCount,
            missedObjectionCount,
            noFollowUpCount,
            rudeLanguageCount,
            topFailureLabel,
            auditedPipelineValue,
            atRiskPipelineValue,
            atRiskDealsCount,
            wonDealsAuditedCount,
            lostDealsAuditedCount,
            avgPillarScores: {
              agility: totalAudited > 0 ? Math.round(agilitySum / totalAudited) : 0,
              qualification: totalAudited > 0 ? Math.round(qualSum / totalAudited) : 0,
              objectionHandling: totalAudited > 0 ? Math.round(objSum / totalAudited) : 0,
              closingNextStep: totalAudited > 0 ? Math.round(closeSum / totalAudited) : 0,
            },
          };

          const operatorRanking: AuditOperatorRankingItem[] = Array.from(opAggMap.values())
            .map((op) => ({
              operatorId: op.operatorId,
              operatorName: op.operatorName,
              operatorAvatar: op.operatorAvatar,
              isOnline: op.isOnline,
              auditedCount: op.auditedCount,
              avgScore: op.auditedCount > 0 ? Math.round(op.scoreSum / op.auditedCount) : 0,
              criticalCount: op.criticalCount,
              excellentCount: op.excellentCount,
              satisfiedCount: op.satisfiedCount,
              frustratedCount: op.frustratedCount,
              flagCount: op.flagCount,
              longGapCount: op.longGapCount,
              missedObjectionCount: op.missedObjectionCount,
              noFollowUpCount: op.noFollowUpCount,
              rudeLanguageCount: op.rudeLanguageCount,
              pipelineValue: op.pipelineValue,
              atRiskValue: op.atRiskValue,
            }))
            .sort((a, b) => a.avgScore - b.avgScore || b.flagCount - a.flagCount);

          const payload: AuditsApiResponse = {
            audits: result,
            statusCounts,
            summary,
            operatorRanking,
          };

          return new Response(JSON.stringify(payload), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          const errDetail = {
            message: e?.message,
            code: e?.code,
            detail: e?.detail,
          };
          console.error("[gestao/audits GET] ERRO:", JSON.stringify(errDetail));
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },

      POST: async ({ request }) => {
        /**
         * Dispara varredura e enfileiramento sob demanda de conversas elegíveis
         * ou enfileira uma conversa específica para auditoria imediata.
         */
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;

        const canTriggerAudits =
          session.operator.role === "admin" ||
          session.permissions?.monitor?.canManageAudits === true ||
          session.permissions?.monitor?.canAccessAudits === true;

        if (!canTriggerAudits) {
          return new Response(
            JSON.stringify({
              error: "Permissão insuficiente para disparar auditorias.",
              code: "FORBIDDEN",
            }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        try {
          const body = (await request.json().catch(() => ({}))) as {
            action?: string;
            conversationId?: string;
            operatorId?: string;
            limit?: number;
            force?: boolean;
            tenantId?: string;
          };

          if (body.tenantId && body.tenantId !== tenantId) {
            return new Response(
              JSON.stringify({ error: "Acesso negado ao tenant especificado.", code: "FORBIDDEN" }),
              { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }

          if (body.action === "audit_conversation" && body.conversationId) {
            const res = await AuditService.getInstance().enqueueAudit({
              tenantId,
              conversationId: body.conversationId,
              operatorId: body.operatorId ?? null,
              force: body.force ?? true,
            });
            return new Response(
              JSON.stringify({
                success: true,
                action: "audit_conversation",
                enqueued: res.enqueued,
                auditId: res.auditId,
              }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }

          const scanRes = await AuditService.getInstance().scanAndEnqueueEligibleConversations(
            tenantId,
            {
              limit: body.limit ?? 15,
              operatorId: body.operatorId ?? null,
              force: Boolean(body.force),
            },
          );

          return new Response(
            JSON.stringify({
              success: true,
              action: "scan_and_audit",
              enqueuedCount: scanRes.enqueuedCount,
              pendingTotal: scanRes.pendingTotal,
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        } catch (e: any) {
          console.error("[gestao/audits POST] Erro:", e?.message);
          return new Response(
            JSON.stringify({ error: e?.message || "Erro interno ao enfileirar auditorias." }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
      },

      PATCH: async ({ request }) => {
        /**
         * Reseta auditorias (com erro ou re-auditoria forçada) de volta para 'pending'
         * e dispara processamento imediato.
         */
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;

        const canManage =
          session.operator.role === "admin" ||
          session.permissions?.monitor?.canManageAudits === true ||
          session.permissions?.monitor?.canAccessAudits === true;

        if (!canManage) {
          return new Response(
            JSON.stringify({
              error: "Permissão insuficiente para reprocessar auditorias.",
              code: "FORBIDDEN",
            }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        try {
          const body = (await request.json()) as {
            auditId?: string;
            action?: string;
            force?: boolean;
            tenantId?: string;
          };
          const { auditId, action, force, tenantId: bodyTenantId } = body;

          if (bodyTenantId && bodyTenantId !== tenantId) {
            return new Response(
              JSON.stringify({ error: "Acesso negado ao tenant especificado.", code: "FORBIDDEN" }),
              { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }

          const visibleAuditConversation = exists(
            db
              .select({ id: conversations.id })
              .from(conversations)
              .where(
                and(
                  eq(conversations.id, aiConversationAudits.conversationId),
                  eq(conversations.tenantId, tenantId),
                  conversationReadCondition(session),
                ),
              ),
          );

          if (action === "retry_all") {
            await db
              .update(aiConversationAudits)
              .set({
                status: "pending",
                errorMessage: null,
                auditedAt: null,
                leaseToken: null,
                leaseUntil: null,
              })
              .where(
                and(
                  eq(aiConversationAudits.tenantId, tenantId),
                  eq(aiConversationAudits.status, "error"),
                  visibleAuditConversation,
                ),
              );

            console.log(
              `[gestao/audits PATCH] retry_all: auditorias resetadas para pending no tenant ${tenantId}`,
            );

            AuditService.getInstance().triggerImmediateRun();

            return new Response(JSON.stringify({ success: true, action: "retry_all" }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          if (auditId) {
            const statusCond = force
              ? inArray(aiConversationAudits.status, ["error", "done", "pending"])
              : eq(aiConversationAudits.status, "error");

            await db
              .update(aiConversationAudits)
              .set({
                status: "pending",
                errorMessage: null,
                auditedAt: null,
                leaseToken: null,
                leaseUntil: null,
              })
              .where(
                and(
                  eq(aiConversationAudits.id, auditId),
                  eq(aiConversationAudits.tenantId, tenantId),
                  statusCond,
                  visibleAuditConversation,
                ),
              );

            console.log(`[gestao/audits PATCH] Auditoria ${auditId} resetada para pending.`);

            AuditService.getInstance().triggerImmediateRun();

            return new Response(JSON.stringify({ success: true, auditId }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          return new Response(
            JSON.stringify({ error: "Forneça auditId ou action='retry_all'" }),
            {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            },
          );
        } catch (e: any) {
          console.error("[gestao/audits PATCH] Erro:", e?.message);
          return new Response(JSON.stringify({ error: e?.message || "Erro interno" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
