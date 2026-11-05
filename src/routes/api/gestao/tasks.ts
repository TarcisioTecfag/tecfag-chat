import { createFileRoute } from "@tanstack/react-router";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "../../../db";
import { crmPipelines, operators } from "../../../db/schema";
import { requireSession } from "../../../lib/auth-session";
import { getComercialOperatorIds } from "../../../lib/gestao-filter";
import { computeOperatorPresenceSnapshot, getBrtDateKey } from "../../../lib/operator-presence";
import type {
  GlobalTaskItem,
  GlobalTaskOperatorBreakdown,
  GlobalTasksExecutiveSummary,
  LiveMessage,
} from "../../../lib/monitor-mock-data";
import { getNativeKanbanTasks } from "../tasks";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
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

function parseMediaPreview(
  content: string | null | undefined,
  transcription?: string | null,
): {
  preview: string;
  mediaType: string | null;
  mediaId: string | null;
} {
  const raw = (content || "").trim();
  if (!raw) {
    return { preview: "", mediaType: null, mediaId: null };
  }
  const match = raw.match(
    /^\[MEDIA:(image|video|audio|document|sticker|contact|location)\]([^\n]*)(?:\n([\s\S]*))?$/i,
  );
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
        preview: `Áudio: "${cleanTranscript}"`,
        mediaType: "audio",
        mediaId,
      };
    }
    return {
      preview: caption ? `Áudio: ${caption}` : "Mensagem de áudio",
      mediaType: "audio",
      mediaId,
    };
  }
  if (mediaType === "image") {
    return { preview: caption ? `Imagem: ${caption}` : "Imagem enviada", mediaType: "image", mediaId };
  }
  if (mediaType === "video") {
    return { preview: caption ? `Vídeo: ${caption}` : "Vídeo enviado", mediaType: "video", mediaId };
  }
  if (mediaType === "document") {
    return {
      preview: caption ? `Documento: ${caption}` : "Documento enviado",
      mediaType: "document",
      mediaId,
    };
  }
  return { preview: caption || "Mídia enviada", mediaType, mediaId };
}

export const Route = createFileRoute("/api/gestao/tasks")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      GET: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;
        if (session.operator.role !== "admin" && !session.permissions?.monitor?.canAccessTeamTasks) {
          return Response.json({ error: "Permissão insuficiente.", code: "FORBIDDEN" }, { status: 403 });
        }

        const url = new URL(request.url);
        const queryTenantId = url.searchParams.get("tenantId");
        if (queryTenantId && queryTenantId !== tenantId) {
          return new Response(
            JSON.stringify({ error: "Acesso negado ao tenant especificado.", code: "FORBIDDEN" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        try {
          const [rawTasks, tenantOperators, comercialOpIds, tenantPipelines, openDealsResult] =
            await Promise.all([
              getNativeKanbanTasks(tenantId, {
                operatorId: session.operator.id,
                email: session.operator.email,
                isAdmin: true,
                all: true,
                scope: "all",
              }),
              db
                .select({
                  id: operators.id,
                  name: operators.name,
                  email: operators.email,
                  avatar: operators.avatar,
                  status: operators.status,
                  isOnline: operators.isOnline,
                  lastSeenAt: operators.lastSeenAt,
                  usageDate: operators.usageDate,
                  usageSecondsToday: operators.usageSecondsToday,
                })
                .from(operators)
                .where(eq(operators.tenantId, tenantId)),
              getComercialOperatorIds(tenantId).catch(() => null),
              db
                .select({
                  id: crmPipelines.id,
                  name: crmPipelines.name,
                })
                .from(crmPipelines)
                .where(eq(crmPipelines.tenantId, tenantId))
                .orderBy(asc(crmPipelines.orderIndex)),
              db
                .execute(sql`
                  SELECT
                    d.id AS "dealId",
                    d.operator_id AS "operatorId",
                    COUNT(cda.id) FILTER (
                      WHERE cda.status = 'pending'
                        AND cda.type NOT IN ('note', 'system_event')
                    )::int AS "pendingTasksCount"
                  FROM crm_deals d
                  LEFT JOIN crm_deal_activities cda
                    ON cda.deal_id = d.id
                   AND cda.tenant_id = ${tenantId}
                  WHERE d.tenant_id = ${tenantId}
                    AND d.status = 'open'
                  GROUP BY d.id, d.operator_id
                `)
                .catch(() => []),
            ]);

          const now = new Date();
          const nowMs = now.getTime();
          const todayBrt = getBrtDateKey(now);
          const sevenDaysAheadMs = nowMs + 7 * 24 * 3600_000;

          // Mapa de presença por operador
          const operatorPresenceMap = new Map<
            string,
            {
              id: string;
              name: string;
              email: string | null;
              avatar: string | null;
              isOnline: boolean;
              presenceLabel: string;
            }
          >();

          for (const op of tenantOperators) {
            const snap = computeOperatorPresenceSnapshot(op, tenantId, session.operator.id);
            const presenceLabel = !snap.isOnline
              ? "OFFLINE"
              : op.status === "ausente"
              ? "EM PAUSA"
              : op.status === "ocupado"
              ? "EM ATENDIMENTO"
              : "ONLINE";
            operatorPresenceMap.set(op.id, {
              id: op.id,
              name: op.name,
              email: op.email || null,
              avatar: op.avatar || null,
              isOnline: snap.isOnline,
              presenceLabel,
            });
          }

          // Busca últimas mensagens das conversas vinculadas às tarefas (priorizando pendentes/hoje)
          const relevantConvIds = Array.from(
            new Set(
              rawTasks
                .filter((t) => Boolean(t.chatConversationId))
                .sort((a, b) => {
                  if (a.status !== b.status) return a.status === "pending" ? -1 : 1;
                  return 0;
                })
                .slice(0, 150)
                .map((t) => t.chatConversationId!),
            ),
          );

          const messagesByConv = new Map<
            string,
            Array<{
              id: string;
              senderType: string;
              senderName: string | null;
              content: string;
              sentAt: string;
              isInternalNote: boolean;
              mediaInterpretation: string | null;
              status: string;
              errorMessage: string | null;
              quotedMessageId: string | null;
              quotedMessageSender: string | null;
              quotedMessageContent: string | null;
              metaDetails: any;
            }>
          >();

          if (relevantConvIds.length > 0) {
            const idParams = sql.join(
              relevantConvIds.map((id) => sql`${id}`),
              sql`, `,
            );
            const rawMsgsResult = await db
              .execute(sql`
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
                  WHERE m.conversation_id IN (${idParams})
                ) ranked
                WHERE ranked.rn <= 12
                ORDER BY conversation_id, sent_at ASC
              `)
              .catch(() => []);

            for (const row of extractRows(rawMsgsResult)) {
              const cid = row.conversationId;
              if (!cid) continue;
              const list = messagesByConv.get(cid) || [];
              list.push({
                id: row.id,
                senderType: row.senderType,
                senderName: row.senderName || null,
                content: row.content || "",
                sentAt: row.sentAt instanceof Date ? row.sentAt.toISOString() : String(row.sentAt),
                isInternalNote: Boolean(row.isInternalNote),
                mediaInterpretation: row.mediaInterpretation ?? null,
                status: row.status ?? "accepted",
                errorMessage: row.errorMessage ?? null,
                quotedMessageId: row.quotedMessageId ?? null,
                quotedMessageSender: row.quotedMessageSender ?? null,
                quotedMessageContent: row.quotedMessageContent ?? null,
                metaDetails: row.metaDetails ?? null,
              });
              messagesByConv.set(cid, list);
            }
          }

          // Enriquecer cada tarefa com presença e histórico recente da conversa
          const enrichedTasks: GlobalTaskItem[] = rawTasks.map((t) => {
            const opPresence = t.operatorId ? operatorPresenceMap.get(t.operatorId) : undefined;
            const convMsgs = t.chatConversationId ? messagesByConv.get(t.chatConversationId) || [] : [];
            const visibleMsgs = convMsgs.filter(
              (m) => !(m.senderType === "system" && BOILERPLATE_SYSTEM_RE.test(m.content.trim())),
            );
            const lastNonInternal = [...visibleMsgs].reverse().find((m) => !m.isInternalNote);
            const parsedLast = lastNonInternal
              ? parseMediaPreview(lastNonInternal.content, lastNonInternal.mediaInterpretation)
              : null;

            const recentMessages: LiveMessage[] = visibleMsgs.slice(-10).map((m) => ({
              id: m.id,
              sender:
                m.senderType === "system"
                  ? "system"
                  : m.senderType === "agent" || m.senderType === "bot"
                  ? "agent"
                  : "client",
              senderName: m.senderName,
              text: m.content,
              time: new Date(m.sentAt).toLocaleTimeString("pt-BR", {
                timeZone: "America/Sao_Paulo",
                hour: "2-digit",
                minute: "2-digit",
              }),
              sentAt: m.sentAt,
              isInternalNote: m.isInternalNote,
              mediaInterpretation: m.mediaInterpretation,
              status: m.status,
              errorMessage: m.errorMessage,
              quotedMessageId: m.quotedMessageId,
              quotedMessageSender: m.quotedMessageSender,
              quotedMessageContent: m.quotedMessageContent,
              isSupervisorWhisper: Boolean(m.metaDetails?.supervisorWhisper),
            }));

            return {
              ...t,
              operatorIsOnline: opPresence?.isOnline ?? false,
              lastMessagePreview: parsedLast?.preview || null,
              lastMessageSenderType: (lastNonInternal?.senderType as any) || null,
              lastMessageSentAt: lastNonInternal?.sentAt || null,
              lastMessageMediaType: parsedLast?.mediaType || null,
              lastMessageMediaId: parsedLast?.mediaId || null,
              lastMessageTranscription: lastNonInternal?.mediaInterpretation || null,
              recentMessages,
            };
          });

          // Estatísticas de negociações abertas por operador (e órfãs de tarefa)
          const openDealsRows = extractRows<{
            dealId: string;
            operatorId: string | null;
            pendingTasksCount: number;
          }>(openDealsResult);

          let globalOpenDealsCount = 0;
          let globalOpenDealsWithoutTasksCount = 0;
          const openDealsByOp = new Map<string, { total: number; withoutTask: number }>();

          for (const d of openDealsRows) {
            globalOpenDealsCount++;
            const hasTask = Number(d.pendingTasksCount || 0) > 0;
            if (!hasTask) globalOpenDealsWithoutTasksCount++;
            if (d.operatorId) {
              const curr = openDealsByOp.get(d.operatorId) || { total: 0, withoutTask: 0 };
              curr.total++;
              if (!hasTask) curr.withoutTask++;
              openDealsByOp.set(d.operatorId, curr);
            }
          }

          // Cálculo do Resumo Executivo Global e Breakdown por Consultor
          const byType = {
            call: 0,
            whatsapp: 0,
            meeting: 0,
            visit: 0,
            email: 0,
            lunch: 0,
            task: 0,
          };

          let pendingTasksCount = 0;
          let completedTasksCount = 0;
          let overdueTasksCount = 0;
          let overdueOpenDealsTasksCount = 0;
          let totalOverdueHours = 0;
          const overdueOpenDealValueMap = new Map<string, number>();

          let todayTotalCount = 0;
          let todayCompletedCount = 0;
          let todayPendingCount = 0;
          let todayOverdueCount = 0;
          let upcoming7dCount = 0;

          // Acumuladores por operador
          const opStatsMap = new Map<
            string,
            {
              overdueCount: number;
              overdueDealValues: Map<string, number>;
              todayTotal: number;
              todayDone: number;
              todayPending: number;
              upcoming7dCount: number;
              totalPending: number;
              totalDone: number;
            }
          >();

          const ensureOpStats = (opId: string) => {
            let entry = opStatsMap.get(opId);
            if (!entry) {
              entry = {
                overdueCount: 0,
                overdueDealValues: new Map(),
                todayTotal: 0,
                todayDone: 0,
                todayPending: 0,
                upcoming7dCount: 0,
                totalPending: 0,
                totalDone: 0,
              };
              opStatsMap.set(opId, entry);
            }
            return entry;
          };

          for (const t of enrichedTasks) {
            const isDone = t.status === "done";
            const dueMs = t.dueDate ? new Date(t.dueDate).getTime() : NaN;
            const hasValidDue = !Number.isNaN(dueMs);
            const isOverdue = !isDone && hasValidDue && dueMs < nowMs;
            const dueBrtKey = hasValidDue ? getBrtDateKey(new Date(dueMs)) : null;
            const isDueToday = dueBrtKey === todayBrt;
            const isUpcoming7d = !isDone && hasValidDue && dueMs >= nowMs && dueMs <= sevenDaysAheadMs;

            const tType = (t.type || "task").toLowerCase();
            if (tType in byType) {
              byType[tType as keyof typeof byType]++;
            } else {
              byType.task++;
            }

            if (isDone) {
              completedTasksCount++;
            } else {
              pendingTasksCount++;
            }

            if (isOverdue) {
              overdueTasksCount++;
              const overdueHours = Math.max(0.1, (nowMs - dueMs) / 3600_000);
              totalOverdueHours += overdueHours;
              if (t.deal?.status === "open") {
                overdueOpenDealsTasksCount++;
                if (t.deal.id && t.deal.numericValue && t.deal.numericValue > 0) {
                  overdueOpenDealValueMap.set(t.deal.id, t.deal.numericValue);
                }
              }
            }

            if (isDueToday) {
              todayTotalCount++;
              if (isDone) {
                todayCompletedCount++;
              } else {
                todayPendingCount++;
                if (isOverdue) todayOverdueCount++;
              }
            }

            if (isUpcoming7d) {
              upcoming7dCount++;
            }

            const targetOpIds =
              Array.isArray(t.assignedOperatorIds) && t.assignedOperatorIds.length > 0
                ? t.assignedOperatorIds
                : t.operatorId
                ? [t.operatorId]
                : [];

            for (const opId of targetOpIds) {
              if (!opId) continue;
              const st = ensureOpStats(opId);
              if (isDone) {
                st.totalDone++;
              } else {
                st.totalPending++;
              }
              if (isOverdue) {
                st.overdueCount++;
                if (t.deal?.status === "open" && t.deal.id && t.deal.numericValue && t.deal.numericValue > 0) {
                  st.overdueDealValues.set(t.deal.id, t.deal.numericValue);
                }
              }
              if (isDueToday) {
                st.todayTotal++;
                if (isDone) st.todayDone++;
                else st.todayPending++;
              }
              if (isUpcoming7d) {
                st.upcoming7dCount++;
              }
            }
          }

          const overduePipelineValueAtRisk = Array.from(overdueOpenDealValueMap.values()).reduce(
            (acc, v) => acc + v,
            0,
          );
          const avgOverdueHours =
            overdueTasksCount > 0 ? Math.round((totalOverdueHours / overdueTasksCount) * 10) / 10 : 0;
          const todayExecutionRatePct =
            todayTotalCount > 0 ? Math.round((todayCompletedCount / todayTotalCount) * 100) : 0;

          // Montar breakdown de consultores (incluindo consultores comerciais mesmo que tenham 0 tarefas)
          const relevantOperatorIds = new Set<string>();
          if (comercialOpIds && comercialOpIds.length > 0) {
            for (const id of comercialOpIds) relevantOperatorIds.add(id);
          } else {
            for (const op of tenantOperators) relevantOperatorIds.add(op.id);
          }
          for (const opId of opStatsMap.keys()) relevantOperatorIds.add(opId);
          for (const opId of openDealsByOp.keys()) relevantOperatorIds.add(opId);

          const operatorBreakdown: GlobalTaskOperatorBreakdown[] = [];
          let consultantsWithoutFutureTasksCount = 0;

          for (const opId of relevantOperatorIds) {
            const opInfo = operatorPresenceMap.get(opId);
            if (!opInfo) continue;
            // Ignora contas genéricas ou IA se houver
            if (/^(valentina|fagner)$/i.test(opInfo.name.trim())) continue;

            const st = opStatsMap.get(opId);
            const dealsInfo = openDealsByOp.get(opId) || { total: 0, withoutTask: 0 };
            const overdueCount = st?.overdueCount ?? 0;
            const overdueValueAtRisk = st
              ? Array.from(st.overdueDealValues.values()).reduce((a, b) => a + b, 0)
              : 0;
            const todayTotal = st?.todayTotal ?? 0;
            const todayDone = st?.todayDone ?? 0;
            const todayPending = st?.todayPending ?? 0;
            const up7d = st?.upcoming7dCount ?? 0;
            const totalPending = st?.totalPending ?? 0;
            const totalDone = st?.totalDone ?? 0;
            const totalAll = totalPending + totalDone;

            // Se o consultor tem negociações abertas ou tarefas mas 0 agendadas para hoje/futuro
            if ((dealsInfo.total > 0 || totalAll > 0) && up7d === 0 && todayPending === 0) {
              consultantsWithoutFutureTasksCount++;
            }

            const executionRatePct =
              todayTotal > 0
                ? Math.round((todayDone / todayTotal) * 100)
                : totalAll > 0
                ? Math.round((totalDone / totalAll) * 100)
                : 0;

            if (totalAll === 0 && dealsInfo.total === 0 && !opInfo.isOnline) {
              continue;
            }

            operatorBreakdown.push({
              operatorId: opInfo.id,
              operatorName: opInfo.name,
              operatorEmail: opInfo.email,
              operatorAvatar: opInfo.avatar,
              isOnline: opInfo.isOnline,
              presenceLabel: opInfo.presenceLabel,
              overdueCount,
              overdueValueAtRisk,
              todayTotal,
              todayDone,
              todayPending,
              upcoming7dCount: up7d,
              totalPending,
              totalDone,
              openDealsCount: dealsInfo.total,
              openDealsWithoutTaskCount: dealsInfo.withoutTask,
              executionRatePct,
            });
          }

          operatorBreakdown.sort((a, b) => {
            if (b.overdueCount !== a.overdueCount) return b.overdueCount - a.overdueCount;
            if (b.overdueValueAtRisk !== a.overdueValueAtRisk)
              return b.overdueValueAtRisk - a.overdueValueAtRisk;
            if (b.todayPending !== a.todayPending) return b.todayPending - a.todayPending;
            if (b.openDealsWithoutTaskCount !== a.openDealsWithoutTaskCount)
              return b.openDealsWithoutTaskCount - a.openDealsWithoutTaskCount;
            return b.totalPending - a.totalPending;
          });

          const summary: GlobalTasksExecutiveSummary = {
            totalTasks: enrichedTasks.length,
            pendingTasksCount,
            completedTasksCount,
            overdueTasksCount,
            overdueOpenDealsTasksCount,
            overduePipelineValueAtRisk,
            avgOverdueHours,
            todayTotalCount,
            todayCompletedCount,
            todayPendingCount,
            todayOverdueCount,
            todayExecutionRatePct,
            upcoming7dCount,
            consultantsWithoutFutureTasksCount,
            openDealsCount: globalOpenDealsCount,
            openDealsWithoutTasksCount: globalOpenDealsWithoutTasksCount,
            byType,
          };

          const operatorsList = Array.from(operatorPresenceMap.values())
            .filter((op) => !/^(valentina|fagner)$/i.test(op.name.trim()))
            .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
            .map((op) => ({
              id: op.id,
              name: op.name,
              email: op.email,
              avatar: op.avatar,
              isOnline: op.isOnline,
            }));

          return new Response(
            JSON.stringify({
              tasks: enrichedTasks,
              summary,
              operatorBreakdown,
              pipelines: tenantPipelines,
              operators: operatorsList,
            }),
            {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            },
          );
        } catch (e: any) {
          console.error("[gestao/tasks] ERRO:", e.message);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
