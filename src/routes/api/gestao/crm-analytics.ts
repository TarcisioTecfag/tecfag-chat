import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import {
  contacts,
  crmAccounts,
  crmConversationDeals,
  crmDealActivities,
  crmDealContacts,
  crmDealEvents,
  crmDealProducts,
  crmDeals,
  crmPipelines,
  crmProposals,
  crmStageSettings,
  crmStages,
  operators,
} from "../../../db/schema";
import { and, asc, eq } from "drizzle-orm";
import { requireSession } from "../../../lib/auth-session";
import {
  getAllowedPipelineIds,
  isStageVisibleToSession,
} from "../../../lib/access-control/crm-record-access";
import { buildConsultantAvatarResolver } from "../../../lib/commercial/avatar-matcher";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

type PeriodKey = "7d" | "15d" | "30d" | "month" | "90d" | "all";

function resolvePeriodRange(period: PeriodKey, now: Date): {
  start: Date;
  prevStart: Date;
  prevEnd: Date;
  days: number;
  label: string;
} {
  const dayMs = 24 * 60 * 60 * 1000;
  if (period === "7d") {
    const start = new Date(now.getTime() - 7 * dayMs);
    const prevStart = new Date(now.getTime() - 14 * dayMs);
    return { start, prevStart, prevEnd: start, days: 7, label: "Últimos 7 dias" };
  }
  if (period === "15d") {
    const start = new Date(now.getTime() - 15 * dayMs);
    const prevStart = new Date(now.getTime() - 30 * dayMs);
    return { start, prevStart, prevEnd: start, days: 15, label: "Últimos 15 dias" };
  }
  if (period === "90d") {
    const start = new Date(now.getTime() - 90 * dayMs);
    const prevStart = new Date(now.getTime() - 180 * dayMs);
    return { start, prevStart, prevEnd: start, days: 90, label: "Últimos 90 dias" };
  }
  if (period === "month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
    const days = Math.max(1, Math.ceil((now.getTime() - start.getTime()) / dayMs));
    return { start, prevStart, prevEnd: start, days, label: "Este mês" };
  }
  if (period === "all") {
    const start = new Date(2020, 0, 1);
    const prevStart = new Date(2019, 0, 1);
    return { start, prevStart, prevEnd: start, days: 365, label: "Todo o histórico" };
  }
  // Default: 30d
  const start = new Date(now.getTime() - 30 * dayMs);
  const prevStart = new Date(now.getTime() - 60 * dayMs);
  return { start, prevStart, prevEnd: start, days: 30, label: "Últimos 30 dias" };
}

function getBrtDateKey(date: Date): string {
  const brt = new Date(date.getTime() - 3 * 60 * 60 * 1000);
  const y = brt.getUTCFullYear();
  const m = String(brt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(brt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatDayMonthFromKey(dateKey: string): string {
  const parts = dateKey.split("-");
  if (parts.length !== 3) return dateKey;
  return `${parts[2]}/${parts[1]}`;
}

function calcDeltaPct(current: number, previous: number): number | null {
  if (previous <= 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}

function parseDealValue(val: string | number | null | undefined): number {
  if (typeof val === "number") return Number.isFinite(val) ? val : 0;
  if (!val) return 0;
  const parsed = Number(val);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function safeQuery<T>(label: string, fn: () => Promise<T[]>): Promise<T[]> {
  try {
    return await fn();
  } catch (err) {
    console.warn(`[CRM Analytics] Falha parcial em query (${label}):`, err);
    return [];
  }
}

export const Route = createFileRoute("/api/gestao/crm-analytics")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      GET: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;

        if (
          session.permissions?.views?.analytics !== true ||
          session.permissions?.analytics?.canAccessCrm === false
        ) {
          return new Response(
            JSON.stringify({
              error: "Permissão insuficiente para acessar métricas de CRM & Funis.",
              code: "FORBIDDEN",
            }),
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

        const rawPeriod = (url.searchParams.get("period") || "30d") as PeriodKey;
        const periodKey: PeriodKey = ["7d", "15d", "30d", "month", "90d", "all"].includes(rawPeriod)
          ? rawPeriod
          : "30d";
        const filterPipelineId = (url.searchParams.get("pipelineId") || "all").trim();
        const filterOperatorId = (url.searchParams.get("operatorId") || "all").trim();
        const filterSource = (url.searchParams.get("source") || "all").trim();

        try {
          const now = new Date();
          const dayMs = 24 * 60 * 60 * 1000;
          const periodRange = resolvePeriodRange(periodKey, now);

          const allowedPipelines = getAllowedPipelineIds(session);
          const restrictDealsToOwnOperator =
            session.operator.role !== "admin" &&
            session.permissions?.crm?.canViewAllDeals !== true &&
            session.permissions?.analytics?.canAccessOverview !== true;

          // 1. Load all tenant-isolated CRM & Operator entities in parallel
          const [
            rawPipelines,
            rawStages,
            rawStageSettings,
            rawDeals,
            rawAccounts,
            rawDealContacts,
            rawContacts,
            rawConvDeals,
            rawActivities,
            rawEvents,
            rawDealProducts,
            rawProposals,
            rawOperators,
          ] = await Promise.all([
            safeQuery("crmPipelines", () =>
              db
                .select({
                  id: crmPipelines.id,
                  name: crmPipelines.name,
                  orderIndex: crmPipelines.orderIndex,
                  coolingDays: crmPipelines.coolingDays,
                })
                .from(crmPipelines)
                .where(eq(crmPipelines.tenantId, tenantId))
                .orderBy(asc(crmPipelines.orderIndex))
            ),
            safeQuery("crmStages", () =>
              db
                .select({
                  id: crmStages.id,
                  pipelineId: crmStages.pipelineId,
                  name: crmStages.name,
                  orderIndex: crmStages.orderIndex,
                  isWinStage: crmStages.isWinStage,
                  isLossStage: crmStages.isLossStage,
                })
                .from(crmStages)
                .where(eq(crmStages.tenantId, tenantId))
                .orderBy(asc(crmStages.orderIndex))
            ),
            safeQuery("crmStageSettings", () =>
              db
                .select({
                  stageId: crmStageSettings.stageId,
                  abbreviation: crmStageSettings.abbreviation,
                  objective: crmStageSettings.objective,
                  coolingEnabled: crmStageSettings.coolingEnabled,
                  coolingDays: crmStageSettings.coolingDays,
                })
                .from(crmStageSettings)
                .where(eq(crmStageSettings.tenantId, tenantId))
            ),
            safeQuery("crmDeals", () =>
              db
                .select({
                  id: crmDeals.id,
                  title: crmDeals.title,
                  accountId: crmDeals.accountId,
                  pipelineId: crmDeals.pipelineId,
                  stageId: crmDeals.stageId,
                  status: crmDeals.status,
                  value: crmDeals.value,
                  expectedCloseDate: crmDeals.expectedCloseDate,
                  operatorId: crmDeals.operatorId,
                  source: crmDeals.source,
                  campaign: crmDeals.campaign,
                  rating: crmDeals.rating,
                  lossReason: crmDeals.lossReason,
                  pausedReason: crmDeals.pausedReason,
                  aiPriorityLevel: crmDeals.aiPriorityLevel,
                  lastActivityAt: crmDeals.lastActivityAt,
                  closedAt: crmDeals.closedAt,
                  createdAt: crmDeals.createdAt,
                  updatedAt: crmDeals.updatedAt,
                })
                .from(crmDeals)
                .where(eq(crmDeals.tenantId, tenantId))
            ),
            safeQuery("crmAccounts", () =>
              db
                .select({
                  id: crmAccounts.id,
                  name: crmAccounts.name,
                  segment: crmAccounts.segment,
                })
                .from(crmAccounts)
                .where(eq(crmAccounts.tenantId, tenantId))
            ),
            safeQuery("crmDealContacts", () =>
              db
                .select({
                  dealId: crmDealContacts.dealId,
                  contactId: crmDealContacts.contactId,
                  isPrimary: crmDealContacts.isPrimary,
                })
                .from(crmDealContacts)
                .where(eq(crmDealContacts.tenantId, tenantId))
            ),
            safeQuery("contacts", () =>
              db
                .select({
                  id: contacts.id,
                  name: contacts.name,
                  phone: contacts.phone,
                })
                .from(contacts)
                .where(eq(contacts.tenantId, tenantId))
            ),
            safeQuery("crmConversationDeals", () =>
              db
                .select({
                  dealId: crmConversationDeals.dealId,
                  conversationId: crmConversationDeals.conversationId,
                  isActive: crmConversationDeals.isActive,
                })
                .from(crmConversationDeals)
                .where(eq(crmConversationDeals.tenantId, tenantId))
            ),
            safeQuery("crmDealActivities", () =>
              db
                .select({
                  id: crmDealActivities.id,
                  dealId: crmDealActivities.dealId,
                  type: crmDealActivities.type,
                  status: crmDealActivities.status,
                  dueDate: crmDealActivities.dueDate,
                  completedAt: crmDealActivities.completedAt,
                  assignedToOperatorId: crmDealActivities.assignedToOperatorId,
                  operatorId: crmDealActivities.operatorId,
                  createdAt: crmDealActivities.createdAt,
                })
                .from(crmDealActivities)
                .where(eq(crmDealActivities.tenantId, tenantId))
            ),
            safeQuery("crmDealEvents", () =>
              db
                .select({
                  id: crmDealEvents.id,
                  dealId: crmDealEvents.dealId,
                  eventType: crmDealEvents.eventType,
                  fromStageId: crmDealEvents.fromStageId,
                  toStageId: crmDealEvents.toStageId,
                  fromStatus: crmDealEvents.fromStatus,
                  toStatus: crmDealEvents.toStatus,
                  createdAt: crmDealEvents.createdAt,
                })
                .from(crmDealEvents)
                .where(eq(crmDealEvents.tenantId, tenantId))
            ),
            safeQuery("crmDealProducts", () =>
              db
                .select({
                  id: crmDealProducts.id,
                  dealId: crmDealProducts.dealId,
                  productId: crmDealProducts.productId,
                  name: crmDealProducts.name,
                  quantity: crmDealProducts.quantity,
                  totalPrice: crmDealProducts.totalPrice,
                })
                .from(crmDealProducts)
                .where(eq(crmDealProducts.tenantId, tenantId))
            ),
            safeQuery("crmProposals", () =>
              db
                .select({
                  id: crmProposals.id,
                  dealId: crmProposals.dealId,
                  status: crmProposals.status,
                  total: crmProposals.total,
                  createdAt: crmProposals.createdAt,
                })
                .from(crmProposals)
                .where(eq(crmProposals.tenantId, tenantId))
            ),
            safeQuery("operators", () =>
              db
                .select({
                  id: operators.id,
                  name: operators.name,
                  avatar: operators.avatar,
                  role: operators.role,
                })
                .from(operators)
                .where(eq(operators.tenantId, tenantId))
            ),
          ]);

          // 2. Apply RBAC visibility filters on pipelines, stages, and deals
          const visiblePipelines = rawPipelines.filter(
            (p) => allowedPipelines === null || allowedPipelines.includes(p.id)
          );
          const visiblePipelineIds = new Set(visiblePipelines.map((p) => p.id));

          const visibleStages = rawStages.filter(
            (s) =>
              visiblePipelineIds.has(s.pipelineId) &&
              isStageVisibleToSession(session, s.pipelineId, s.id)
          );
          const visibleStageIds = new Set(visibleStages.map((s) => s.id));

          const stageSettingsByStageId = new Map(
            rawStageSettings.map((ss) => [ss.stageId, ss])
          );
          const pipelineById = new Map(visiblePipelines.map((p) => [p.id, p]));
          const stageById = new Map(visibleStages.map((s) => [s.id, s]));
          const operatorById = new Map(rawOperators.map((o) => [o.id, o]));
          const accountById = new Map(rawAccounts.map((a) => [a.id, a]));
          const contactById = new Map(rawContacts.map((c) => [c.id, c]));

          // Primary contact per deal & active conversation per deal
          const dealPrimaryContactMap = new Map<string, { id: string; name: string; phone: string }>();
          for (const dc of rawDealContacts) {
            const c = contactById.get(dc.contactId);
            if (!c) continue;
            if (!dealPrimaryContactMap.has(dc.dealId) || dc.isPrimary) {
              dealPrimaryContactMap.set(dc.dealId, c);
            }
          }

          const dealConversationMap = new Map<string, string>();
          for (const cd of rawConvDeals) {
            if (!dealConversationMap.has(cd.dealId) || cd.isActive) {
              dealConversationMap.set(cd.dealId, cd.conversationId);
            }
          }

          // All deals accessible by this session
          const accessibleDeals = rawDeals.filter((d) => {
            if (!visiblePipelineIds.has(d.pipelineId)) return false;
            if (d.stageId && !visibleStageIds.has(d.stageId)) return false;
            if (restrictDealsToOwnOperator && d.operatorId !== session.operator.id) return false;
            return true;
          });

          // Build filter option catalogs from accessible deals
          const sourceCountsMap = new Map<string, number>();
          const operatorDealCountsMap = new Map<string, number>();
          const pipelineStatsForFilter = new Map<
            string,
            { total: number; openCount: number; openValue: number }
          >();

          for (const p of visiblePipelines) {
            pipelineStatsForFilter.set(p.id, { total: 0, openCount: 0, openValue: 0 });
          }

          for (const d of accessibleDeals) {
            const src = (d.source || "").trim();
            if (src) {
              sourceCountsMap.set(src, (sourceCountsMap.get(src) || 0) + 1);
            }
            if (d.operatorId) {
              operatorDealCountsMap.set(
                d.operatorId,
                (operatorDealCountsMap.get(d.operatorId) || 0) + 1
              );
            }
            const pStat = pipelineStatsForFilter.get(d.pipelineId);
            if (pStat) {
              pStat.total += 1;
              if (d.status === "open") {
                pStat.openCount += 1;
                pStat.openValue += parseDealValue(d.value);
              }
            }
          }

          // Apply user-selected filters (pipelineId, operatorId, source)
          const scopedDeals = accessibleDeals.filter((d) => {
            if (filterPipelineId !== "all" && d.pipelineId !== filterPipelineId) return false;
            if (filterOperatorId !== "all") {
              if (filterOperatorId === "unassigned") {
                if (d.operatorId) return false;
              } else if (d.operatorId !== filterOperatorId) {
                return false;
              }
            }
            if (filterSource !== "all") {
              const dealSource = (d.source || "Sem origem").trim();
              if (dealSource.toLowerCase() !== filterSource.toLowerCase()) return false;
            }
            return true;
          });

          const scopedDealIds = new Set(scopedDeals.map((d) => d.id));

          // Index activities, events, products, proposals for scoped deals
          const dealPendingTasksMap = new Map<string, number>();
          const dealOverdueTasksMap = new Map<string, number>();
          const operatorCompletedActivitiesPeriod = new Map<string, number>();

          for (const act of rawActivities) {
            if (!scopedDealIds.has(act.dealId)) continue;
            if (act.status === "pending") {
              dealPendingTasksMap.set(act.dealId, (dealPendingTasksMap.get(act.dealId) || 0) + 1);
              if (act.dueDate && new Date(act.dueDate).getTime() < now.getTime()) {
                dealOverdueTasksMap.set(act.dealId, (dealOverdueTasksMap.get(act.dealId) || 0) + 1);
              }
            } else if (act.status === "completed") {
              const compAt = act.completedAt ? new Date(act.completedAt) : new Date(act.createdAt);
              if (compAt >= periodRange.start) {
                const opId = act.assignedToOperatorId || act.operatorId;
                if (opId) {
                  operatorCompletedActivitiesPeriod.set(
                    opId,
                    (operatorCompletedActivitiesPeriod.get(opId) || 0) + 1
                  );
                }
              }
            }
          }

          // Index last stage change timestamp per deal from crmDealEvents
          const lastStageChangedAtMap = new Map<string, Date>();
          const stageEnteredHistoricalMap = new Map<string, Set<string>>();
          const stageAdvancedHistoricalMap = new Map<string, Set<string>>();

          for (const ev of rawEvents) {
            if (!scopedDealIds.has(ev.dealId)) continue;
            const evDate = new Date(ev.createdAt);
            if (ev.eventType === "stage_changed") {
              const prev = lastStageChangedAtMap.get(ev.dealId);
              if (!prev || evDate > prev) {
                lastStageChangedAtMap.set(ev.dealId, evDate);
              }
              if (ev.toStageId) {
                if (!stageEnteredHistoricalMap.has(ev.toStageId)) {
                  stageEnteredHistoricalMap.set(ev.toStageId, new Set());
                }
                stageEnteredHistoricalMap.get(ev.toStageId)!.add(ev.dealId);
              }
              if (ev.fromStageId) {
                if (!stageAdvancedHistoricalMap.has(ev.fromStageId)) {
                  stageAdvancedHistoricalMap.set(ev.fromStageId, new Set());
                }
                stageAdvancedHistoricalMap.get(ev.fromStageId)!.add(ev.dealId);
              }
            }
          }

          // Helper to determine cooling threshold & cooling state for an open deal
          function getDealCoolingInfo(deal: typeof scopedDeals[number]) {
            const stageSetting = stageSettingsByStageId.get(deal.stageId);
            const pipeline = pipelineById.get(deal.pipelineId);
            const coolingEnabled = stageSetting ? stageSetting.coolingEnabled !== false : true;
            const coolingDays = Math.max(
              1,
              stageSetting?.coolingDays ?? pipeline?.coolingDays ?? 10
            );
            const refDate = deal.lastActivityAt
              ? new Date(deal.lastActivityAt)
              : deal.updatedAt
                ? new Date(deal.updatedAt)
                : new Date(deal.createdAt);
            const daysSinceLastActivity = Math.max(
              0,
              Math.floor((now.getTime() - refDate.getTime()) / dayMs)
            );
            const stageRefDate =
              lastStageChangedAtMap.get(deal.id) || new Date(deal.createdAt);
            const daysInStage = Math.max(
              0,
              Math.floor((now.getTime() - stageRefDate.getTime()) / dayMs)
            );
            const daysInFunnel = Math.max(
              0,
              Math.floor((now.getTime() - new Date(deal.createdAt).getTime()) / dayMs)
            );
            const isCooling =
              deal.status === "open" &&
              coolingEnabled &&
              daysSinceLastActivity >= coolingDays;

            return {
              coolingEnabled,
              coolingDays,
              daysSinceLastActivity,
              daysInStage,
              daysInFunnel,
              isCooling,
            };
          }

          // Helper to check if a closed deal falls inside a window
          function getClosedDate(deal: typeof scopedDeals[number]): Date {
            return deal.closedAt
              ? new Date(deal.closedAt)
              : deal.updatedAt
                ? new Date(deal.updatedAt)
                : new Date(deal.createdAt);
          }

          const isPeriodAll = periodKey === "all";
          const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
          const currentMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

          // 3. Compute Summary KPIs
          let openCount = 0;
          let openValue = 0;
          let pausedCount = 0;
          let pausedValue = 0;
          let openWithExpectedCloseCount = 0;
          let expectedCloseThisMonthValue = 0;
          let overdueExpectedCloseCount = 0;
          let overdueExpectedCloseValue = 0;

          let coolingCount = 0;
          let coolingValue = 0;
          let totalOpenAgeDays = 0;
          let openWithPendingTaskCount = 0;
          let openWithoutTaskCount = 0;
          let openWithOverdueTaskCount = 0;

          let wonCountPeriod = 0;
          let wonValuePeriod = 0;
          let prevWonCount = 0;
          let prevWonValue = 0;
          let wonCycleDaysSum = 0;
          let wonCycleSampleCount = 0;

          let lostCountPeriod = 0;
          let lostValuePeriod = 0;
          let prevLostCount = 0;
          let prevLostValue = 0;
          let lostCycleDaysSum = 0;
          let lostCycleSampleCount = 0;

          let newDealsCountPeriod = 0;
          let newDealsValuePeriod = 0;
          let prevNewDealsCount = 0;

          for (const d of scopedDeals) {
            const val = parseDealValue(d.value);
            const createdAt = new Date(d.createdAt);
            const cooling = getDealCoolingInfo(d);
            const pendingTasks = dealPendingTasksMap.get(d.id) || 0;
            const overdueTasks = dealOverdueTasksMap.get(d.id) || 0;

            if (isPeriodAll || createdAt >= periodRange.start) {
              newDealsCountPeriod += 1;
              newDealsValuePeriod += val;
            } else if (createdAt >= periodRange.prevStart && createdAt < periodRange.prevEnd) {
              prevNewDealsCount += 1;
            }

            if (d.status === "open") {
              openCount += 1;
              openValue += val;
              totalOpenAgeDays += cooling.daysInFunnel;

              if (cooling.isCooling) {
                coolingCount += 1;
                coolingValue += val;
              }

              if (pendingTasks > 0) {
                openWithPendingTaskCount += 1;
              } else {
                openWithoutTaskCount += 1;
              }
              if (overdueTasks > 0) {
                openWithOverdueTaskCount += 1;
              }

              if (d.expectedCloseDate) {
                openWithExpectedCloseCount += 1;
                const expDate = new Date(d.expectedCloseDate);
                if (expDate >= currentMonthStart && expDate <= currentMonthEnd) {
                  expectedCloseThisMonthValue += val;
                }
                if (expDate.getTime() < now.getTime()) {
                  overdueExpectedCloseCount += 1;
                  overdueExpectedCloseValue += val;
                }
              }
            } else if (d.status === "paused") {
              pausedCount += 1;
              pausedValue += val;
            } else if (d.status === "won") {
              const closedAt = getClosedDate(d);
              const cycleDays = Math.max(
                0,
                Math.round(((closedAt.getTime() - createdAt.getTime()) / dayMs) * 10) / 10
              );
              if (isPeriodAll || closedAt >= periodRange.start) {
                wonCountPeriod += 1;
                wonValuePeriod += val;
                wonCycleDaysSum += cycleDays;
                wonCycleSampleCount += 1;
              } else if (closedAt >= periodRange.prevStart && closedAt < periodRange.prevEnd) {
                prevWonCount += 1;
                prevWonValue += val;
              }
            } else if (d.status === "lost") {
              const closedAt = getClosedDate(d);
              const cycleDays = Math.max(
                0,
                Math.round(((closedAt.getTime() - createdAt.getTime()) / dayMs) * 10) / 10
              );
              if (isPeriodAll || closedAt >= periodRange.start) {
                lostCountPeriod += 1;
                lostValuePeriod += val;
                lostCycleDaysSum += cycleDays;
                lostCycleSampleCount += 1;
              } else if (closedAt >= periodRange.prevStart && closedAt < periodRange.prevEnd) {
                prevLostCount += 1;
                prevLostValue += val;
              }
            }
          }

          const closedTotalPeriod = wonCountPeriod + lostCountPeriod;
          const winRate =
            closedTotalPeriod > 0 ? Math.round((wonCountPeriod / closedTotalPeriod) * 100) : 0;
          const lossRate =
            closedTotalPeriod > 0 ? Math.round((lostCountPeriod / closedTotalPeriod) * 100) : 0;
          const avgOpenTicket = openCount > 0 ? Math.round(openValue / openCount) : 0;
          const avgWonTicket = wonCountPeriod > 0 ? Math.round(wonValuePeriod / wonCountPeriod) : 0;
          const avgCycleDaysWon =
            wonCycleSampleCount > 0
              ? Math.round((wonCycleDaysSum / wonCycleSampleCount) * 10) / 10
              : 0;
          const avgCycleDaysLost =
            lostCycleSampleCount > 0
              ? Math.round((lostCycleDaysSum / lostCycleSampleCount) * 10) / 10
              : 0;
          const avgOpenAgeDays =
            openCount > 0 ? Math.round((totalOpenAgeDays / openCount) * 10) / 10 : 0;
          const coolingPct = openCount > 0 ? Math.round((coolingCount / openCount) * 100) : 0;
          const openWithPendingTaskPct =
            openCount > 0 ? Math.round((openWithPendingTaskCount / openCount) * 100) : 0;

          // 4. Loss Reasons, Loss Stages & Paused Reasons
          const lossReasonsMap = new Map<
            string,
            {
              reason: string;
              count: number;
              value: number;
              daysSum: number;
              stageCounts: Map<string, number>;
            }
          >();
          const lossStageMap = new Map<
            string,
            { stageId: string; stageName: string; pipelineName: string; count: number; value: number }
          >();
          const pausedReasonsMap = new Map<
            string,
            { reason: string; count: number; value: number; daysSum: number }
          >();

          for (const d of scopedDeals) {
            const val = parseDealValue(d.value);
            if (d.status === "lost") {
              const closedAt = getClosedDate(d);
              if (!isPeriodAll && closedAt < periodRange.start) continue;

              const reason = (d.lossReason || "Motivo não informado").trim();
              const stage = stageById.get(d.stageId);
              const pipeline = pipelineById.get(d.pipelineId);
              const stageName = stage?.name || "Etapa removida";
              const pipelineName = pipeline?.name || "Funil";
              const cycleDays = Math.max(
                0,
                Math.floor((closedAt.getTime() - new Date(d.createdAt).getTime()) / dayMs)
              );

              if (!lossReasonsMap.has(reason)) {
                lossReasonsMap.set(reason, {
                  reason,
                  count: 0,
                  value: 0,
                  daysSum: 0,
                  stageCounts: new Map(),
                });
              }
              const rEntry = lossReasonsMap.get(reason)!;
              rEntry.count += 1;
              rEntry.value += val;
              rEntry.daysSum += cycleDays;
              rEntry.stageCounts.set(stageName, (rEntry.stageCounts.get(stageName) || 0) + 1);

              if (!lossStageMap.has(d.stageId)) {
                lossStageMap.set(d.stageId, {
                  stageId: d.stageId,
                  stageName,
                  pipelineName,
                  count: 0,
                  value: 0,
                });
              }
              const sEntry = lossStageMap.get(d.stageId)!;
              sEntry.count += 1;
              sEntry.value += val;
            } else if (d.status === "paused") {
              const reason = (d.pausedReason || "Pausa sem motivo detalhado").trim();
              const pausedDays = Math.max(
                0,
                Math.floor((now.getTime() - new Date(d.updatedAt).getTime()) / dayMs)
              );
              if (!pausedReasonsMap.has(reason)) {
                pausedReasonsMap.set(reason, { reason, count: 0, value: 0, daysSum: 0 });
              }
              const pEntry = pausedReasonsMap.get(reason)!;
              pEntry.count += 1;
              pEntry.value += val;
              pEntry.daysSum += pausedDays;
            }
          }

          const lossReasons = Array.from(lossReasonsMap.values())
            .sort((a, b) => b.count - a.count || b.value - a.value)
            .map((r) => {
              let topStageName = "—";
              let topStageCount = 0;
              for (const [sName, cnt] of r.stageCounts.entries()) {
                if (cnt > topStageCount) {
                  topStageCount = cnt;
                  topStageName = sName;
                }
              }
              return {
                reason: r.reason,
                count: r.count,
                value: Math.round(r.value),
                shareCountPct:
                  lostCountPeriod > 0 ? Math.round((r.count / lostCountPeriod) * 100) : 0,
                shareValuePct:
                  lostValuePeriod > 0 ? Math.round((r.value / lostValuePeriod) * 100) : 0,
                avgDaysBeforeLoss:
                  r.count > 0 ? Math.round((r.daysSum / r.count) * 10) / 10 : 0,
                topStageName,
              };
            });

          const lossByStage = Array.from(lossStageMap.values())
            .sort((a, b) => b.count - a.count || b.value - a.value)
            .map((s) => ({
              ...s,
              value: Math.round(s.value),
              sharePct: lostCountPeriod > 0 ? Math.round((s.count / lostCountPeriod) * 100) : 0,
            }));

          const pausedReasons = Array.from(pausedReasonsMap.values())
            .sort((a, b) => b.count - a.count || b.value - a.value)
            .map((p) => ({
              reason: p.reason,
              count: p.count,
              value: Math.round(p.value),
              sharePct: pausedCount > 0 ? Math.round((p.count / pausedCount) * 100) : 0,
              avgPausedDays: p.count > 0 ? Math.round((p.daysSum / p.count) * 10) / 10 : 0,
            }));

          const topLossReason = lossReasons[0]?.reason || "Sem perdas no período";
          const topLossReasonPct = lossReasons[0]?.shareCountPct || 0;

          // 5. Proposals & Products Intelligence
          let proposalsCount = 0;
          let proposalsValue = 0;
          let proposalsDraftCount = 0;
          let proposalsSentCount = 0;
          let proposalsAcceptedCount = 0;
          let proposalsAcceptedValue = 0;
          let proposalsRejectedCount = 0;

          for (const prop of rawProposals) {
            if (!scopedDealIds.has(prop.dealId)) continue;
            const createdAt = new Date(prop.createdAt);
            if (!isPeriodAll && createdAt < periodRange.start) continue;
            const val = parseDealValue(prop.total);
            proposalsCount += 1;
            proposalsValue += val;
            if (prop.status === "draft") proposalsDraftCount += 1;
            else if (prop.status === "sent" || prop.status === "copied") proposalsSentCount += 1;
            else if (prop.status === "accepted") {
              proposalsAcceptedCount += 1;
              proposalsAcceptedValue += val;
            } else if (prop.status === "rejected" || prop.status === "expired") {
              proposalsRejectedCount += 1;
            }
          }

          const dealById = new Map(scopedDeals.map((d) => [d.id, d]));
          const productsMap = new Map<
            string,
            {
              productId: string;
              name: string;
              dealIds: Set<string>;
              wonDealIds: Set<string>;
              closedDealIds: Set<string>;
              totalQuantity: number;
              totalValue: number;
              wonValue: number;
            }
          >();

          for (const dp of rawDealProducts) {
            const deal = dealById.get(dp.dealId);
            if (!deal) continue;
            const pKey = dp.productId || dp.name.trim().toLowerCase();
            if (!productsMap.has(pKey)) {
              productsMap.set(pKey, {
                productId: dp.productId || pKey,
                name: dp.name,
                dealIds: new Set(),
                wonDealIds: new Set(),
                closedDealIds: new Set(),
                totalQuantity: 0,
                totalValue: 0,
                wonValue: 0,
              });
            }
            const entry = productsMap.get(pKey)!;
            const itemTotal = parseDealValue(dp.totalPrice);
            entry.dealIds.add(deal.id);
            entry.totalQuantity += Number(dp.quantity || 1);
            entry.totalValue += itemTotal;
            if (deal.status === "won") {
              entry.wonDealIds.add(deal.id);
              entry.closedDealIds.add(deal.id);
              entry.wonValue += itemTotal;
            } else if (deal.status === "lost") {
              entry.closedDealIds.add(deal.id);
            }
          }

          const topProducts = Array.from(productsMap.values())
            .map((p) => ({
              productId: p.productId,
              name: p.name,
              dealsCount: p.dealIds.size,
              wonDealsCount: p.wonDealIds.size,
              totalQuantity: Math.round(p.totalQuantity * 10) / 10,
              totalValue: Math.round(p.totalValue),
              wonValue: Math.round(p.wonValue),
              winRate:
                p.closedDealIds.size > 0
                  ? Math.round((p.wonDealIds.size / p.closedDealIds.size) * 100)
                  : 0,
            }))
            .sort((a, b) => b.totalValue - a.totalValue || b.dealsCount - a.dealsCount)
            .slice(0, 10);

          // 6. Multi-Pipeline Comparative Breakdown (`pipelinesBreakdown`)
          const pipelinesBreakdown = visiblePipelines.map((p) => {
            const pDeals = accessibleDeals.filter((d) => {
              if (d.pipelineId !== p.id) return false;
              if (filterOperatorId !== "all") {
                if (filterOperatorId === "unassigned" && d.operatorId) return false;
                if (filterOperatorId !== "unassigned" && d.operatorId !== filterOperatorId) return false;
              }
              if (filterSource !== "all") {
                const dealSource = (d.source || "Sem origem").trim();
                if (dealSource.toLowerCase() !== filterSource.toLowerCase()) return false;
              }
              return true;
            });

            let pOpenCount = 0;
            let pOpenValue = 0;
            let pPausedCount = 0;
            let pPausedValue = 0;
            let pWonCount = 0;
            let pWonValue = 0;
            let pLostCount = 0;
            let pLostValue = 0;
            let pCoolingCount = 0;
            let pCoolingValue = 0;
            let pWithoutTaskCount = 0;
            let pOverdueTaskCount = 0;
            let pCycleDaysWonSum = 0;
            let pCycleDaysWonSample = 0;

            for (const d of pDeals) {
              const val = parseDealValue(d.value);
              if (d.status === "open") {
                pOpenCount += 1;
                pOpenValue += val;
                const cooling = getDealCoolingInfo(d);
                if (cooling.isCooling) {
                  pCoolingCount += 1;
                  pCoolingValue += val;
                }
                const pending = dealPendingTasksMap.get(d.id) || 0;
                const overdue = dealOverdueTasksMap.get(d.id) || 0;
                if (pending === 0) pWithoutTaskCount += 1;
                if (overdue > 0) pOverdueTaskCount += 1;
              } else if (d.status === "paused") {
                pPausedCount += 1;
                pPausedValue += val;
              } else if (d.status === "won") {
                const closedAt = getClosedDate(d);
                if (isPeriodAll || closedAt >= periodRange.start) {
                  pWonCount += 1;
                  pWonValue += val;
                  const cDays = Math.max(
                    0,
                    (closedAt.getTime() - new Date(d.createdAt).getTime()) / dayMs
                  );
                  pCycleDaysWonSum += cDays;
                  pCycleDaysWonSample += 1;
                }
              } else if (d.status === "lost") {
                const closedAt = getClosedDate(d);
                if (isPeriodAll || closedAt >= periodRange.start) {
                  pLostCount += 1;
                  pLostValue += val;
                }
              }
            }

            const pClosed = pWonCount + pLostCount;
            return {
              id: p.id,
              name: p.name,
              orderIndex: p.orderIndex,
              coolingDays: p.coolingDays ?? 10,
              totalDeals: pDeals.length,
              openCount: pOpenCount,
              openValue: Math.round(pOpenValue),
              pausedCount: pPausedCount,
              pausedValue: Math.round(pPausedValue),
              wonCount: pWonCount,
              wonValue: Math.round(pWonValue),
              lostCount: pLostCount,
              lostValue: Math.round(pLostValue),
              winRate: pClosed > 0 ? Math.round((pWonCount / pClosed) * 100) : 0,
              avgTicketOpen: pOpenCount > 0 ? Math.round(pOpenValue / pOpenCount) : 0,
              avgTicketWon: pWonCount > 0 ? Math.round(pWonValue / pWonCount) : 0,
              avgCycleDaysWon:
                pCycleDaysWonSample > 0
                  ? Math.round((pCycleDaysWonSum / pCycleDaysWonSample) * 10) / 10
                  : 0,
              coolingCount: pCoolingCount,
              coolingValue: Math.round(pCoolingValue),
              withoutTaskCount: pWithoutTaskCount,
              overdueTaskCount: pOverdueTaskCount,
              shareOfOpenValuePct: 0, // computed below
            };
          });

          const totalAllPipelinesOpenValue = pipelinesBreakdown.reduce(
            (acc, item) => acc + item.openValue,
            0
          );
          for (const item of pipelinesBreakdown) {
            item.shareOfOpenValuePct =
              totalAllPipelinesOpenValue > 0
                ? Math.round((item.openValue / totalAllPipelinesOpenValue) * 100)
                : 0;
          }

          // 7. Stage-by-Stage Kanban Breakdown (`stagesBreakdown`)
          const stagesForBreakdown = visibleStages
            .filter((s) => filterPipelineId === "all" || s.pipelineId === filterPipelineId)
            .sort((a, b) => {
              const pA = pipelineById.get(a.pipelineId)?.orderIndex ?? 0;
              const pB = pipelineById.get(b.pipelineId)?.orderIndex ?? 0;
              if (pA !== pB) return pA - pB;
              return a.orderIndex - b.orderIndex;
            });

          // Group stages by pipeline to compute cumulative reach (funnel progression)
          const stagesByPipeline = new Map<string, typeof stagesForBreakdown>();
          for (const st of stagesForBreakdown) {
            if (!stagesByPipeline.has(st.pipelineId)) {
              stagesByPipeline.set(st.pipelineId, []);
            }
            stagesByPipeline.get(st.pipelineId)!.push(st);
          }

          const stagesBreakdown = stagesForBreakdown.map((st) => {
            const p = pipelineById.get(st.pipelineId);
            const setting = stageSettingsByStageId.get(st.id);
            const coolingEnabled = setting ? setting.coolingEnabled !== false : true;
            const coolingDays = Math.max(1, setting?.coolingDays ?? p?.coolingDays ?? 10);

            const stageDeals = scopedDeals.filter((d) => d.stageId === st.id);
            let stOpenCount = 0;
            let stOpenValue = 0;
            let stPausedCount = 0;
            let stWonCount = 0;
            let stLostCount = 0;
            let stCoolingCount = 0;
            let stCoolingValue = 0;
            let stWithoutTaskCount = 0;
            let stOverdueTaskCount = 0;
            let stAgeDaysSum = 0;

            for (const d of stageDeals) {
              const val = parseDealValue(d.value);
              const cooling = getDealCoolingInfo(d);
              if (d.status === "open") {
                stOpenCount += 1;
                stOpenValue += val;
                stAgeDaysSum += cooling.daysInStage;
                if (cooling.isCooling) {
                  stCoolingCount += 1;
                  stCoolingValue += val;
                }
                const pending = dealPendingTasksMap.get(d.id) || 0;
                const overdue = dealOverdueTasksMap.get(d.id) || 0;
                if (pending === 0) stWithoutTaskCount += 1;
                if (overdue > 0) stOverdueTaskCount += 1;
              } else if (d.status === "paused") {
                stPausedCount += 1;
              } else if (d.status === "won") {
                stWonCount += 1;
              } else if (d.status === "lost") {
                stLostCount += 1;
              }
            }

            // Compute cumulative funnel progression: deals currently at or past this stage in the same pipeline + historical events
            const pStages = stagesByPipeline.get(st.pipelineId) || [];
            const laterStageIds = new Set(
              pStages.filter((x) => x.orderIndex > st.orderIndex && !x.isLossStage).map((x) => x.id)
            );
            const dealsAtOrPast = scopedDeals.filter(
              (d) =>
                d.pipelineId === st.pipelineId &&
                (d.stageId === st.id || laterStageIds.has(d.stageId) || d.status === "won")
            );
            const enteredSet = new Set<string>(dealsAtOrPast.map((d) => d.id));
            const evEntered = stageEnteredHistoricalMap.get(st.id);
            if (evEntered) {
              for (const id of evEntered) enteredSet.add(id);
            }

            const advancedSet = new Set<string>(
              scopedDeals
                .filter(
                  (d) =>
                    d.pipelineId === st.pipelineId &&
                    (laterStageIds.has(d.stageId) || (d.status === "won" && !st.isWinStage))
                )
                .map((d) => d.id)
            );
            const evAdvanced = stageAdvancedHistoricalMap.get(st.id);
            if (evAdvanced) {
              for (const id of evAdvanced) advancedSet.add(id);
            }

            const historicalEnteredCount = enteredSet.size;
            const historicalAdvancedCount = st.isWinStage
              ? stWonCount
              : advancedSet.size;
            const stageAdvanceRatePct =
              historicalEnteredCount > 0
                ? Math.min(100, Math.round((historicalAdvancedCount / historicalEnteredCount) * 100))
                : 0;

            return {
              id: st.id,
              pipelineId: st.pipelineId,
              pipelineName: p?.name || "Funil",
              name: st.name,
              abbreviation:
                setting?.abbreviation ||
                st.name
                  .split(/\s+/)
                  .slice(0, 2)
                  .map((w) => w[0] || "")
                  .join("")
                  .toUpperCase(),
              objective: setting?.objective || "",
              orderIndex: st.orderIndex,
              isWinStage: st.isWinStage,
              isLossStage: st.isLossStage,
              coolingEnabled,
              coolingDays,
              openCount: stOpenCount,
              openValue: Math.round(stOpenValue),
              pausedCount: stPausedCount,
              wonCount: stWonCount,
              lostCount: stLostCount,
              historicalEnteredCount,
              historicalAdvancedCount,
              stageAdvanceRatePct,
              avgStageAgeDays:
                stOpenCount > 0 ? Math.round((stAgeDaysSum / stOpenCount) * 10) / 10 : 0,
              coolingCount: stCoolingCount,
              coolingValue: Math.round(stCoolingValue),
              withoutTaskCount: stWithoutTaskCount,
              overdueTaskCount: stOverdueTaskCount,
              shareOfPipelineCountPct:
                openCount > 0 ? Math.round((stOpenCount / openCount) * 100) : 0,
              shareOfPipelineValuePct:
                openValue > 0 ? Math.round((stOpenValue / openValue) * 100) : 0,
            };
          });

          // 8. Timeline Series (Created vs Won vs Lost in BRT)
          const timelineDaysCount =
            periodKey === "7d"
              ? 7
              : periodKey === "15d"
                ? 15
                : periodKey === "month"
                  ? Math.min(31, Math.max(7, periodRange.days))
                  : periodKey === "90d" || periodKey === "all"
                    ? 30
                    : 30;

          const timelineBuckets = new Map<
            string,
            {
              label: string;
              dateKey: string;
              createdCount: number;
              wonCount: number;
              lostCount: number;
              createdValue: number;
              wonValue: number;
              lostValue: number;
            }
          >();

          for (let i = timelineDaysCount - 1; i >= 0; i--) {
            const d = new Date(now.getTime() - i * dayMs);
            const key = getBrtDateKey(d);
            timelineBuckets.set(key, {
              label: formatDayMonthFromKey(key),
              dateKey: key,
              createdCount: 0,
              wonCount: 0,
              lostCount: 0,
              createdValue: 0,
              wonValue: 0,
              lostValue: 0,
            });
          }

          for (const d of scopedDeals) {
            const val = parseDealValue(d.value);
            const createdKey = getBrtDateKey(new Date(d.createdAt));
            const cBucket = timelineBuckets.get(createdKey);
            if (cBucket) {
              cBucket.createdCount += 1;
              cBucket.createdValue += val;
            }
            if (d.status === "won" || d.status === "lost") {
              const closedKey = getBrtDateKey(getClosedDate(d));
              const clBucket = timelineBuckets.get(closedKey);
              if (clBucket) {
                if (d.status === "won") {
                  clBucket.wonCount += 1;
                  clBucket.wonValue += val;
                } else {
                  clBucket.lostCount += 1;
                  clBucket.lostValue += val;
                }
              }
            }
          }

          const timeline = Array.from(timelineBuckets.values()).map((b) => ({
            ...b,
            createdValue: Math.round(b.createdValue),
            wonValue: Math.round(b.wonValue),
            lostValue: Math.round(b.lostValue),
          }));

          // 9. Qualification (Rating 1-5★ & AI Priority) + Sources & Campaigns
          const ratingBuckets = new Map<
            number,
            { rating: number; label: string; count: number; openCount: number; wonCount: number; lostCount: number; value: number }
          >([
            [5, { rating: 5, label: "5 Estrelas (Quente)", count: 0, openCount: 0, wonCount: 0, lostCount: 0, value: 0 }],
            [4, { rating: 4, label: "4 Estrelas", count: 0, openCount: 0, wonCount: 0, lostCount: 0, value: 0 }],
            [3, { rating: 3, label: "3 Estrelas (Morno)", count: 0, openCount: 0, wonCount: 0, lostCount: 0, value: 0 }],
            [2, { rating: 2, label: "2 Estrelas", count: 0, openCount: 0, wonCount: 0, lostCount: 0, value: 0 }],
            [1, { rating: 1, label: "1 Estrela (Frio)", count: 0, openCount: 0, wonCount: 0, lostCount: 0, value: 0 }],
            [0, { rating: 0, label: "Sem Classificação", count: 0, openCount: 0, wonCount: 0, lostCount: 0, value: 0 }],
          ]);

          const aiPriorityBuckets = new Map<
            string,
            { level: string; label: string; count: number; openValue: number; wonCount: number; closedCount: number }
          >([
            ["critica", { level: "critica", label: "Crítica", count: 0, openValue: 0, wonCount: 0, closedCount: 0 }],
            ["alta", { level: "alta", label: "Alta", count: 0, openValue: 0, wonCount: 0, closedCount: 0 }],
            ["media", { level: "media", label: "Média", count: 0, openValue: 0, wonCount: 0, closedCount: 0 }],
            ["baixa", { level: "baixa", label: "Baixa", count: 0, openValue: 0, wonCount: 0, closedCount: 0 }],
            ["sem_classificacao", { level: "sem_classificacao", label: "Não Avaliada", count: 0, openValue: 0, wonCount: 0, closedCount: 0 }],
          ]);

          const sourcesMap = new Map<
            string,
            {
              source: string;
              totalDeals: number;
              openCount: number;
              wonCount: number;
              lostCount: number;
              openValue: number;
              wonValue: number;
            }
          >();

          const campaignsMap = new Map<
            string,
            { campaign: string; totalDeals: number; openCount: number; wonCount: number; lostCount: number; wonValue: number }
          >();

          for (const d of scopedDeals) {
            const val = parseDealValue(d.value);
            const rKey = d.rating && d.rating >= 1 && d.rating <= 5 ? d.rating : 0;
            const rBucket = ratingBuckets.get(rKey)!;
            rBucket.count += 1;
            rBucket.value += val;
            if (d.status === "open") rBucket.openCount += 1;
            else if (d.status === "won") rBucket.wonCount += 1;
            else if (d.status === "lost") rBucket.lostCount += 1;

            const pLevel =
              d.aiPriorityLevel && aiPriorityBuckets.has(d.aiPriorityLevel)
                ? d.aiPriorityLevel
                : "sem_classificacao";
            const pBucket = aiPriorityBuckets.get(pLevel)!;
            pBucket.count += 1;
            if (d.status === "open") pBucket.openValue += val;
            else if (d.status === "won") {
              pBucket.wonCount += 1;
              pBucket.closedCount += 1;
            } else if (d.status === "lost") {
              pBucket.closedCount += 1;
            }

            const src = (d.source || "Sem origem").trim();
            if (!sourcesMap.has(src)) {
              sourcesMap.set(src, {
                source: src,
                totalDeals: 0,
                openCount: 0,
                wonCount: 0,
                lostCount: 0,
                openValue: 0,
                wonValue: 0,
              });
            }
            const sEntry = sourcesMap.get(src)!;
            sEntry.totalDeals += 1;
            if (d.status === "open") {
              sEntry.openCount += 1;
              sEntry.openValue += val;
            } else if (d.status === "won") {
              sEntry.wonCount += 1;
              sEntry.wonValue += val;
            } else if (d.status === "lost") {
              sEntry.lostCount += 1;
            }

            const camp = (d.campaign || "").trim();
            if (camp) {
              if (!campaignsMap.has(camp)) {
                campaignsMap.set(camp, {
                  campaign: camp,
                  totalDeals: 0,
                  openCount: 0,
                  wonCount: 0,
                  lostCount: 0,
                  wonValue: 0,
                });
              }
              const cEntry = campaignsMap.get(camp)!;
              cEntry.totalDeals += 1;
              if (d.status === "open") cEntry.openCount += 1;
              else if (d.status === "won") {
                cEntry.wonCount += 1;
                cEntry.wonValue += val;
              } else if (d.status === "lost") {
                cEntry.lostCount += 1;
              }
            }
          }

          const ratingBreakdown = Array.from(ratingBuckets.values()).map((r) => {
            const closed = r.wonCount + r.lostCount;
            return {
              ...r,
              value: Math.round(r.value),
              winRate: closed > 0 ? Math.round((r.wonCount / closed) * 100) : 0,
            };
          });

          const aiPriorityBreakdown = Array.from(aiPriorityBuckets.values()).map((p) => ({
            level: p.level,
            label: p.label,
            count: p.count,
            openValue: Math.round(p.openValue),
            winRate: p.closedCount > 0 ? Math.round((p.wonCount / p.closedCount) * 100) : 0,
          }));

          const sourcesBreakdown = Array.from(sourcesMap.values())
            .map((s) => {
              const closed = s.wonCount + s.lostCount;
              return {
                source: s.source,
                totalDeals: s.totalDeals,
                openCount: s.openCount,
                wonCount: s.wonCount,
                lostCount: s.lostCount,
                openValue: Math.round(s.openValue),
                wonValue: Math.round(s.wonValue),
                winRate: closed > 0 ? Math.round((s.wonCount / closed) * 100) : 0,
                avgTicketWon: s.wonCount > 0 ? Math.round(s.wonValue / s.wonCount) : 0,
              };
            })
            .sort((a, b) => b.wonValue - a.wonValue || b.totalDeals - a.totalDeals)
            .slice(0, 10);

          const campaignsBreakdown = Array.from(campaignsMap.values())
            .map((c) => {
              const closed = c.wonCount + c.lostCount;
              return {
                campaign: c.campaign,
                totalDeals: c.totalDeals,
                openCount: c.openCount,
                wonCount: c.wonCount,
                wonValue: Math.round(c.wonValue),
                winRate: closed > 0 ? Math.round((c.wonCount / closed) * 100) : 0,
              };
            })
            .sort((a, b) => b.wonValue - a.wonValue || b.totalDeals - a.totalDeals)
            .slice(0, 8);

          // 10. Consultant CRM Execution Matrix (`consultantsBreakdown`)
          const consultantGroups = new Map<
            string,
            {
              operatorId: string;
              name: string;
              avatar: string;
              role: string;
              totalDeals: number;
              openCount: number;
              openValue: number;
              pausedCount: number;
              wonCount: number;
              wonValue: number;
              lostCount: number;
              lostValue: number;
              cycleDaysWonSum: number;
              cycleDaysWonSample: number;
              coolingCount: number;
              withoutTaskCount: number;
              overdueTaskCount: number;
            }
          >();

          const crmAvatarResolver = buildConsultantAvatarResolver([rawOperators]);

          for (const d of scopedDeals) {
            const opId = d.operatorId || "unassigned";
            if (!consultantGroups.has(opId)) {
              const op = d.operatorId ? operatorById.get(d.operatorId) : undefined;
              consultantGroups.set(opId, {
                operatorId: opId,
                name: op?.name || "Sem Responsável",
                avatar:
                  op?.avatar ||
                  crmAvatarResolver.getAvatar(opId, op?.name) ||
                  (op?.name
                    ? op.name
                        .split(/\s+/)
                        .slice(0, 2)
                        .map((w) => w[0] || "")
                        .join("")
                        .toUpperCase()
                    : "SR"),
                role: op?.role || "operator",
                totalDeals: 0,
                openCount: 0,
                openValue: 0,
                pausedCount: 0,
                wonCount: 0,
                wonValue: 0,
                lostCount: 0,
                lostValue: 0,
                cycleDaysWonSum: 0,
                cycleDaysWonSample: 0,
                coolingCount: 0,
                withoutTaskCount: 0,
                overdueTaskCount: 0,
              });
            }
            const cg = consultantGroups.get(opId)!;
            const val = parseDealValue(d.value);
            cg.totalDeals += 1;

            if (d.status === "open") {
              cg.openCount += 1;
              cg.openValue += val;
              const cooling = getDealCoolingInfo(d);
              if (cooling.isCooling) cg.coolingCount += 1;
              const pending = dealPendingTasksMap.get(d.id) || 0;
              const overdue = dealOverdueTasksMap.get(d.id) || 0;
              if (pending === 0) cg.withoutTaskCount += 1;
              if (overdue > 0) cg.overdueTaskCount += 1;
            } else if (d.status === "paused") {
              cg.pausedCount += 1;
            } else if (d.status === "won") {
              const closedAt = getClosedDate(d);
              if (isPeriodAll || closedAt >= periodRange.start) {
                cg.wonCount += 1;
                cg.wonValue += val;
                cg.cycleDaysWonSum += Math.max(
                  0,
                  (closedAt.getTime() - new Date(d.createdAt).getTime()) / dayMs
                );
                cg.cycleDaysWonSample += 1;
              }
            } else if (d.status === "lost") {
              const closedAt = getClosedDate(d);
              if (isPeriodAll || closedAt >= periodRange.start) {
                cg.lostCount += 1;
                cg.lostValue += val;
              }
            }
          }

          const consultantsBreakdown = Array.from(consultantGroups.values())
            .map((c) => {
              const closed = c.wonCount + c.lostCount;
              return {
                operatorId: c.operatorId,
                name: c.name,
                avatar: c.avatar,
                role: c.role,
                totalDeals: c.totalDeals,
                openCount: c.openCount,
                openValue: Math.round(c.openValue),
                pausedCount: c.pausedCount,
                wonCount: c.wonCount,
                wonValue: Math.round(c.wonValue),
                lostCount: c.lostCount,
                lostValue: Math.round(c.lostValue),
                winRate: closed > 0 ? Math.round((c.wonCount / closed) * 100) : 0,
                avgTicketWon: c.wonCount > 0 ? Math.round(c.wonValue / c.wonCount) : 0,
                avgCycleDaysWon:
                  c.cycleDaysWonSample > 0
                    ? Math.round((c.cycleDaysWonSum / c.cycleDaysWonSample) * 10) / 10
                    : 0,
                coolingCount: c.coolingCount,
                withoutTaskCount: c.withoutTaskCount,
                overdueTaskCount: c.overdueTaskCount,
                activitiesCompletedPeriod:
                  operatorCompletedActivitiesPeriod.get(c.operatorId) || 0,
              };
            })
            .sort((a, b) => b.wonValue - a.wonValue || b.openValue - a.openValue);

          // 11. Actionable Radar of Critical Deals (`radarDeals`)
          const radarDeals = scopedDeals
            .filter((d) => d.status === "open" || d.status === "paused")
            .map((d) => {
              const val = parseDealValue(d.value);
              const cooling = getDealCoolingInfo(d);
              const pendingTasksCount = dealPendingTasksMap.get(d.id) || 0;
              const overdueTasksCount = dealOverdueTasksMap.get(d.id) || 0;
              const account = d.accountId ? accountById.get(d.accountId) : undefined;
              const primaryContact = dealPrimaryContactMap.get(d.id);
              const pipeline = pipelineById.get(d.pipelineId);
              const stage = stageById.get(d.stageId);
              const operator = d.operatorId ? operatorById.get(d.operatorId) : undefined;
              const isExpectedCloseOverdue =
                d.status === "open" &&
                Boolean(d.expectedCloseDate) &&
                new Date(d.expectedCloseDate!).getTime() < now.getTime();

              // Urgency score for sorting radar
              let urgencyScore = 0;
              if (cooling.isCooling) urgencyScore += 40;
              if (overdueTasksCount > 0) urgencyScore += 30;
              if (pendingTasksCount === 0 && d.status === "open") urgencyScore += 20;
              if (isExpectedCloseOverdue) urgencyScore += 25;
              if (val >= 10000) urgencyScore += 15;

              return {
                id: d.id,
                title: d.title,
                accountName: account?.name || null,
                contactId: primaryContact?.id || null,
                contactName: primaryContact?.name || null,
                contactPhone: primaryContact?.phone || null,
                pipelineId: d.pipelineId,
                pipelineName: pipeline?.name || "Funil",
                stageId: d.stageId,
                stageName: stage?.name || "Etapa",
                operatorId: d.operatorId || null,
                operatorName: operator?.name || "Sem Responsável",
                status: d.status,
                value: Math.round(val),
                rating: d.rating || 0,
                aiPriorityLevel: d.aiPriorityLevel || null,
                daysInFunnel: cooling.daysInFunnel,
                daysInStage: cooling.daysInStage,
                daysSinceLastActivity: cooling.daysSinceLastActivity,
                coolingDaysThreshold: cooling.coolingDays,
                isCooling: cooling.isCooling,
                hasPendingTask: pendingTasksCount > 0,
                hasOverdueTask: overdueTasksCount > 0,
                pendingTasksCount,
                overdueTasksCount,
                expectedCloseDate: d.expectedCloseDate
                  ? new Date(d.expectedCloseDate).toISOString()
                  : null,
                isExpectedCloseOverdue,
                conversationId: dealConversationMap.get(d.id) || null,
                urgencyScore,
              };
            })
            .sort((a, b) => b.urgencyScore - a.urgencyScore || b.value - a.value)
            .slice(0, 35);

          return new Response(
            JSON.stringify({
              filters: {
                pipelines: visiblePipelines.map((p) => {
                  const stat = pipelineStatsForFilter.get(p.id) || {
                    total: 0,
                    openCount: 0,
                    openValue: 0,
                  };
                  return {
                    id: p.id,
                    name: p.name,
                    orderIndex: p.orderIndex,
                    dealsCount: stat.total,
                    openCount: stat.openCount,
                    openValue: Math.round(stat.openValue),
                  };
                }),
                operators: rawOperators
                  .filter((o) => (operatorDealCountsMap.get(o.id) || 0) > 0)
                  .map((o) => ({
                    id: o.id,
                    name: o.name,
                    role: o.role,
                    dealsCount: operatorDealCountsMap.get(o.id) || 0,
                  }))
                  .sort((a, b) => b.dealsCount - a.dealsCount),
                sources: Array.from(sourceCountsMap.entries())
                  .map(([key, count]) => ({ key, label: key, count }))
                  .sort((a, b) => b.count - a.count),
                selected: {
                  period: periodKey,
                  periodLabel: periodRange.label,
                  pipelineId: filterPipelineId,
                  operatorId: filterOperatorId,
                  source: filterSource,
                },
              },
              summaryKpis: {
                activePipeline: {
                  openValue: Math.round(openValue),
                  openCount,
                  avgOpenTicket,
                  pausedCount,
                  pausedValue: Math.round(pausedValue),
                  openWithExpectedCloseCount,
                  expectedCloseThisMonthValue: Math.round(expectedCloseThisMonthValue),
                },
                wonPeriod: {
                  wonValue: Math.round(wonValuePeriod),
                  wonCount: wonCountPeriod,
                  prevWonValue: Math.round(prevWonValue),
                  prevWonCount,
                  wonValueDeltaPct: calcDeltaPct(wonValuePeriod, prevWonValue),
                  winRate,
                  avgWonTicket,
                },
                lostPeriod: {
                  lostValue: Math.round(lostValuePeriod),
                  lostCount: lostCountPeriod,
                  prevLostValue: Math.round(prevLostValue),
                  prevLostCount,
                  lostCountDeltaPct: calcDeltaPct(lostCountPeriod, prevLostCount),
                  lossRate,
                  topLossReason,
                  topLossReasonPct,
                },
                velocity: {
                  avgCycleDaysWon,
                  avgCycleDaysLost,
                  avgOpenAgeDays,
                  newDealsCount: newDealsCountPeriod,
                  newDealsValue: Math.round(newDealsValuePeriod),
                  prevNewDealsCount,
                  newDealsDeltaPct: calcDeltaPct(newDealsCountPeriod, prevNewDealsCount),
                  netFlowCount: newDealsCountPeriod - (wonCountPeriod + lostCountPeriod),
                },
                kanbanHealth: {
                  coolingCount,
                  coolingValue: Math.round(coolingValue),
                  coolingPct,
                  overdueExpectedCloseCount,
                  overdueExpectedCloseValue: Math.round(overdueExpectedCloseValue),
                },
                discipline: {
                  openWithPendingTaskCount,
                  openWithPendingTaskPct,
                  openWithoutTaskCount,
                  openWithOverdueTaskCount,
                  proposalsCount,
                  proposalsValue: Math.round(proposalsValue),
                  proposalsAcceptedCount,
                  proposalsAcceptedValue: Math.round(proposalsAcceptedValue),
                },
              },
              pipelinesBreakdown,
              stagesBreakdown,
              timeline,
              lossesAndPauses: {
                lossReasons,
                lossByStage,
                pausedReasons,
              },
              productsAndQualification: {
                topProducts,
                proposalsSummary: {
                  totalCount: proposalsCount,
                  totalValue: Math.round(proposalsValue),
                  draftCount: proposalsDraftCount,
                  sentCount: proposalsSentCount,
                  acceptedCount: proposalsAcceptedCount,
                  acceptedValue: Math.round(proposalsAcceptedValue),
                  rejectedCount: proposalsRejectedCount,
                  conversionRatePct:
                    proposalsCount > 0
                      ? Math.round((proposalsAcceptedCount / proposalsCount) * 100)
                      : 0,
                },
                ratingBreakdown,
                aiPriorityBreakdown,
                sourcesBreakdown,
                campaignsBreakdown,
              },
              consultantsBreakdown,
              radarDeals,
            }),
            {
              status: 200,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        } catch (error) {
          console.error("[CRM Analytics API Error]:", error);
          return new Response(
            JSON.stringify({
              error: "Falha ao processar estatísticas de CRM & Funis.",
            }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      },
    },
  },
});
