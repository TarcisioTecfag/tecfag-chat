import { createFileRoute } from "@tanstack/react-router";
import { and, asc, eq, gte, lte, or, sql } from "drizzle-orm";
import { db } from "../../../db";
import { crmDealActivities, crmDeals, crmPipelines, operators } from "../../../db/schema";
import { requireSession } from "../../../lib/auth-session";
import { getComercialOperatorIds } from "../../../lib/gestao-filter";
import { computeOperatorPresenceSnapshot, getBrtDateKey } from "../../../lib/operator-presence";
import type {
  GlobalTaskItem,
  GlobalTaskOperatorBreakdown,
  GlobalTasksExecutiveSummary,
} from "../../../lib/monitor-mock-data";
import { getNativeKanbanTasksWithMeta } from "../tasks";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const DEFAULT_GLOBAL_TASKS_LIMIT = 500;
const MAX_GLOBAL_TASKS_LIMIT = 1500;

function extractRows<T = any>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && Array.isArray((result as any).rows)) {
    return (result as any).rows as T[];
  }
  return [];
}

/**
 * Retorna limites UTC do dia corrente em America/Sao_Paulo (UTC-3 fixo no Brasil desde 2019).
 */
function getBrtTodayBoundsUtc(reference: Date): { startUtc: Date; endUtc: Date } {
  const brtKey = getBrtDateKey(reference); // YYYY-MM-DD
  const startUtc = new Date(`${brtKey}T00:00:00-03:00`);
  const endUtc = new Date(`${brtKey}T23:59:59.999-03:00`);
  return { startUtc, endUtc };
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
          return Response.json(
            { error: "Permissão insuficiente.", code: "FORBIDDEN" },
            { status: 403 },
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

        const fromRaw = url.searchParams.get("from");
        const toRaw = url.searchParams.get("to");
        const fromDate = fromRaw ? new Date(fromRaw) : null;
        const toDate = toRaw ? new Date(toRaw) : null;
        const validFromDate = fromDate && !Number.isNaN(fromDate.getTime()) ? fromDate : null;
        const validToDate = toDate && !Number.isNaN(toDate.getTime()) ? toDate : null;

        const limitParam = url.searchParams.get("limit");
        const parsedLimit = limitParam !== null ? Number(limitParam) : DEFAULT_GLOBAL_TASKS_LIMIT;
        const safeLimit =
          Number.isFinite(parsedLimit) && parsedLimit > 0
            ? Math.min(Math.floor(parsedLimit), MAX_GLOBAL_TASKS_LIMIT)
            : DEFAULT_GLOBAL_TASKS_LIMIT;

        const now = new Date();
        const nowMs = now.getTime();
        const todayBrt = getBrtDateKey(now);
        const { startUtc: todayStartUtc, endUtc: todayEndUtc } = getBrtTodayBoundsUtc(now);
        const sevenDaysAheadMs = nowMs + 7 * 24 * 3600_000;

        try {
          // Execução 100% paralela com agregações em banco (zero leitura de messages de 2,8M linhas e zero Base64 de avatares)
          const [
            tasksResult,
            tenantOperators,
            comercialOpIds,
            tenantPipelines,
            globalCountsResult,
            activeAndTodayRows,
            completedByOpResult,
            openDealsAggResult,
          ] = await Promise.all([
            // 1. Lista enxuta e priorizada de tarefas para renderização (pendentes/atrasadas primeiro, teto seguro)
            getNativeKanbanTasksWithMeta(tenantId, {
              operatorId: session.operator.id,
              email: session.operator.email,
              isAdmin: true,
              all: true,
              scope: "all",
              fromDate: validFromDate,
              toDate: validToDate,
              limit: safeLimit,
              maxLimit: MAX_GLOBAL_TASKS_LIMIT,
              orderMode: validFromDate || validToDate ? "due_asc" : "pending_priority",
            }),

            // 2. Operadores leves (SEM avatar Base64 para evitar payload de vários MB)
            db
              .select({
                id: operators.id,
                name: operators.name,
                email: operators.email,
                status: operators.status,
                isOnline: operators.isOnline,
                lastSeenAt: operators.lastSeenAt,
                usageDate: operators.usageDate,
                usageSecondsToday: operators.usageSecondsToday,
              })
              .from(operators)
              .where(eq(operators.tenantId, tenantId)),

            getComercialOperatorIds(tenantId).catch(() => null),

            // 3. Funis do tenant
            db
              .select({
                id: crmPipelines.id,
                name: crmPipelines.name,
              })
              .from(crmPipelines)
              .where(eq(crmPipelines.tenantId, tenantId))
              .orderBy(asc(crmPipelines.orderIndex)),

            // 4. Contadores globais por status e tipo direto no Postgres (1 linha)
            db
              .select({
                totalTasks: sql<number>`COUNT(*)::int`,
                pendingTasksCount: sql<number>`COUNT(*) FILTER (WHERE ${crmDealActivities.status} != 'completed')::int`,
                completedTasksCount: sql<number>`COUNT(*) FILTER (WHERE ${crmDealActivities.status} = 'completed')::int`,
                typeCall: sql<number>`COUNT(*) FILTER (WHERE LOWER(COALESCE(${crmDealActivities.type}, 'task')) = 'call')::int`,
                typeWhatsapp: sql<number>`COUNT(*) FILTER (WHERE LOWER(COALESCE(${crmDealActivities.type}, 'task')) = 'whatsapp')::int`,
                typeMeeting: sql<number>`COUNT(*) FILTER (WHERE LOWER(COALESCE(${crmDealActivities.type}, 'task')) = 'meeting')::int`,
                typeVisit: sql<number>`COUNT(*) FILTER (WHERE LOWER(COALESCE(${crmDealActivities.type}, 'task')) = 'visit')::int`,
                typeEmail: sql<number>`COUNT(*) FILTER (WHERE LOWER(COALESCE(${crmDealActivities.type}, 'task')) = 'email')::int`,
                typeLunch: sql<number>`COUNT(*) FILTER (WHERE LOWER(COALESCE(${crmDealActivities.type}, 'task')) = 'lunch')::int`,
              })
              .from(crmDealActivities)
              .innerJoin(
                crmDeals,
                and(eq(crmDealActivities.dealId, crmDeals.id), eq(crmDeals.tenantId, tenantId)),
              )
              .where(
                and(
                  eq(crmDealActivities.tenantId, tenantId),
                  sql`${crmDealActivities.type} NOT IN ('note', 'system_event')`,
                  sql`${crmDealActivities.status} != 'cancelled'`,
                ),
              ),

            // 5. Apenas tarefas pendentes OU vencendo hoje (colunas mínimas) para métricas exatas de risco R$, atraso e execução diária
            db
              .select({
                status: crmDealActivities.status,
                dueDate: crmDealActivities.dueDate,
                dealId: crmDealActivities.dealId,
                dealStatus: crmDeals.status,
                dealValue: crmDeals.value,
                dealOperatorId: crmDeals.operatorId,
                assignedOperatorId: crmDealActivities.assignedToOperatorId,
                assignedOperatorIds: crmDealActivities.assignedToOperatorIds,
                creatorOperatorId: crmDealActivities.operatorId,
              })
              .from(crmDealActivities)
              .innerJoin(
                crmDeals,
                and(eq(crmDealActivities.dealId, crmDeals.id), eq(crmDeals.tenantId, tenantId)),
              )
              .where(
                and(
                  eq(crmDealActivities.tenantId, tenantId),
                  sql`${crmDealActivities.type} NOT IN ('note', 'system_event')`,
                  sql`${crmDealActivities.status} != 'cancelled'`,
                  or(
                    sql`${crmDealActivities.status} != 'completed'`,
                    and(
                      gte(crmDealActivities.dueDate, todayStartUtc),
                      lte(crmDealActivities.dueDate, todayEndUtc),
                    ),
                  )!,
                ),
              ),

            // 6. Total histórico de tarefas concluídas por operador (agregado em SQL)
            db
              .execute(sql`
                SELECT
                  COALESCE(cda.assigned_to_operator_id, cda.operator_id, d.operator_id) AS "operatorId",
                  COUNT(*)::int AS "doneCount"
                FROM crm_deal_activities cda
                INNER JOIN crm_deals d
                  ON d.id = cda.deal_id
                 AND d.tenant_id = ${tenantId}
                WHERE cda.tenant_id = ${tenantId}
                  AND cda.type NOT IN ('note', 'system_event')
                  AND cda.status = 'completed'
                GROUP BY 1
              `)
              .catch(() => []),

            // 7. Negociações abertas com/sem tarefa pendente agrupadas direto por operador no SQL (~25 linhas em vez de 32k)
            db
              .execute(sql`
                SELECT
                  d.operator_id AS "operatorId",
                  COUNT(*)::int AS "totalOpen",
                  COUNT(*) FILTER (
                    WHERE NOT EXISTS (
                      SELECT 1
                      FROM crm_deal_activities cda
                      WHERE cda.deal_id = d.id
                        AND cda.tenant_id = ${tenantId}
                        AND cda.status = 'pending'
                        AND cda.type NOT IN ('note', 'system_event')
                    )
                  )::int AS "withoutTask"
                FROM crm_deals d
                WHERE d.tenant_id = ${tenantId}
                  AND d.status = 'open'
                GROUP BY d.operator_id
              `)
              .catch(() => []),
          ]);

          // Mapa de presença por operador (sem Base64)
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
            const snap = computeOperatorPresenceSnapshot(op as any, tenantId, session.operator.id);
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
              avatar: null,
              isOnline: snap.isOnline,
              presenceLabel,
            });
          }

          // Enriquecer cada tarefa exibida com presença (mensagens carregam sob demanda ao clicar em "Espiar Conversa")
          const enrichedTasks: GlobalTaskItem[] = tasksResult.tasks.map((t) => {
            const opPresence = t.operatorId ? operatorPresenceMap.get(t.operatorId) : undefined;
            return {
              ...t,
              operatorIsOnline: opPresence?.isOnline ?? false,
              lastMessagePreview: null,
              lastMessageSenderType: null,
              lastMessageSentAt: null,
              lastMessageMediaType: null,
              lastMessageMediaId: null,
              lastMessageTranscription: null,
              recentMessages: [],
            };
          });

          // Estatísticas agregadas de negociações abertas por operador
          const openDealsRows = extractRows<{
            operatorId: string | null;
            totalOpen: number;
            withoutTask: number;
          }>(openDealsAggResult);

          let globalOpenDealsCount = 0;
          let globalOpenDealsWithoutTasksCount = 0;
          const openDealsByOp = new Map<string, { total: number; withoutTask: number }>();

          for (const row of openDealsRows) {
            const total = Number(row.totalOpen || 0);
            const withoutTask = Number(row.withoutTask || 0);
            globalOpenDealsCount += total;
            globalOpenDealsWithoutTasksCount += withoutTask;
            if (row.operatorId) {
              openDealsByOp.set(row.operatorId, { total, withoutTask });
            }
          }

          // Contadores globais SQL
          const gRow = globalCountsResult[0];
          const totalTasks = Number(gRow?.totalTasks ?? 0);
          const pendingTasksCount = Number(gRow?.pendingTasksCount ?? 0);
          const completedTasksCount = Number(gRow?.completedTasksCount ?? 0);
          const typeCall = Number(gRow?.typeCall ?? 0);
          const typeWhatsapp = Number(gRow?.typeWhatsapp ?? 0);
          const typeMeeting = Number(gRow?.typeMeeting ?? 0);
          const typeVisit = Number(gRow?.typeVisit ?? 0);
          const typeEmail = Number(gRow?.typeEmail ?? 0);
          const typeLunch = Number(gRow?.typeLunch ?? 0);
          const typeTaskOther = Math.max(
            0,
            totalTasks - (typeCall + typeWhatsapp + typeMeeting + typeVisit + typeEmail + typeLunch),
          );

          const byType = {
            call: typeCall,
            whatsapp: typeWhatsapp,
            meeting: typeMeeting,
            visit: typeVisit,
            email: typeEmail,
            lunch: typeLunch,
            task: typeTaskOther,
          };

          // Acumuladores exatos sobre tarefas pendentes + agenda de hoje
          let overdueTasksCount = 0;
          let overdueOpenDealsTasksCount = 0;
          let totalOverdueHours = 0;
          const overdueOpenDealValueMap = new Map<string, number>();

          let todayTotalCount = 0;
          let todayCompletedCount = 0;
          let todayPendingCount = 0;
          let todayOverdueCount = 0;
          let upcoming7dCount = 0;

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

          for (const row of extractRows<{ operatorId: string | null; doneCount: number }>(
            completedByOpResult,
          )) {
            if (!row.operatorId) continue;
            ensureOpStats(row.operatorId).totalDone += Number(row.doneCount || 0);
          }

          for (const row of activeAndTodayRows) {
            const isDone = row.status === "completed";
            const dueMs = row.dueDate ? row.dueDate.getTime() : NaN;
            const hasValidDue = !Number.isNaN(dueMs);
            const isOverdue = !isDone && hasValidDue && dueMs < nowMs;
            const dueBrtKey = hasValidDue ? getBrtDateKey(row.dueDate!) : null;
            const isDueToday = dueBrtKey === todayBrt;
            const isUpcoming7d = !isDone && hasValidDue && dueMs >= nowMs && dueMs <= sevenDaysAheadMs;

            const dealNumericValue =
              row.dealValue !== null && row.dealValue !== undefined && !Number.isNaN(Number(row.dealValue))
                ? Number(row.dealValue)
                : 0;
            const isDealOpen = (row.dealStatus || "open") === "open";

            if (isOverdue) {
              overdueTasksCount++;
              totalOverdueHours += Math.max(0.1, (nowMs - dueMs) / 3600_000);
              if (isDealOpen) {
                overdueOpenDealsTasksCount++;
                if (row.dealId && dealNumericValue > 0) {
                  overdueOpenDealValueMap.set(row.dealId, dealNumericValue);
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

            const rawAssignedIds =
              Array.isArray(row.assignedOperatorIds) && row.assignedOperatorIds.length > 0
                ? row.assignedOperatorIds.filter(Boolean)
                : [];
            const effectiveOpId =
              row.assignedOperatorId || row.creatorOperatorId || row.dealOperatorId || null;
            const targetOpIds =
              rawAssignedIds.length > 0
                ? Array.from(new Set(rawAssignedIds))
                : effectiveOpId
                  ? [effectiveOpId]
                  : [];

            for (const opId of targetOpIds) {
              if (!opId) continue;
              const st = ensureOpStats(opId);
              if (!isDone) {
                st.totalPending++;
              }
              if (isOverdue) {
                st.overdueCount++;
                if (isDealOpen && row.dealId && dealNumericValue > 0) {
                  st.overdueDealValues.set(row.dealId, dealNumericValue);
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

          // Montar breakdown de consultores
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
              operatorAvatar: null,
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
            totalTasks,
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
              avatar: null as string | null,
              isOnline: op.isOnline,
            }));

          return new Response(
            JSON.stringify({
              tasks: enrichedTasks,
              totalMatching: tasksResult.totalMatching,
              hasMore: tasksResult.hasMore,
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
          console.error("[gestao/tasks] ERRO:", e?.message || e);
          return new Response(JSON.stringify({ error: e?.message || "Erro interno" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
