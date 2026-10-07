import { and, count, eq, gte, inArray, lt, or } from "drizzle-orm";
import { db } from "../../db";
import {
  commercialCalendarDays,
  commercialConsultantProfiles,
  commercialGoals,
  commercialSettings,
  commercialTransferResponseEvents,
  crmDeals,
  crmStages,
  operators,
} from "../../db/schema";
import {
  calculateBusinessPacing,
  classifyMaturity,
  DEFAULT_MATURITY_RULES,
  saoPauloDay,
  type CommercialCalendarDay,
  type MaturityRule,
} from "./metrics";

type Division = "personnalite" | "maquinas" | null;
type OperatorRow = { id: string; name: string; division: string | null; activeOnTv: boolean };

export async function getCommercialBi(tenantId: string, division: Division, now = new Date()) {
  const today = saoPauloDay(now);
  const month = today.slice(0, 7);
  const [year, monthNumber] = month.split("-").map(Number);
  const monthStart = `${month}-01`;
  const nextMonthStart = `${monthNumber === 12 ? year + 1 : year}-${String(monthNumber === 12 ? 1 : monthNumber + 1).padStart(2, "0")}-01`;
  const previousMonth = `${monthNumber === 1 ? year - 1 : year}-${String(monthNumber === 1 ? 12 : monthNumber - 1).padStart(2, "0")}`;

  const [
    operatorsRows,
    stageRows,
    deals,
    goalRows,
    calendarRows,
    settingsRows,
    tmaRows,
    historicalLossRows,
  ] = await Promise.all([
    db
      .select({
        id: operators.id,
        name: operators.name,
        division: commercialConsultantProfiles.division,
        activeOnTv: commercialConsultantProfiles.activeOnTv,
      })
      .from(commercialConsultantProfiles)
      .innerJoin(
        operators,
        and(
          eq(operators.id, commercialConsultantProfiles.operatorId),
          eq(operators.tenantId, tenantId),
        ),
      )
      .where(eq(commercialConsultantProfiles.tenantId, tenantId)),
    db
      .select({ id: crmStages.id, name: crmStages.name, orderIndex: crmStages.orderIndex })
      .from(crmStages)
      .where(eq(crmStages.tenantId, tenantId))
      .orderBy(crmStages.orderIndex),
    db
      .select({
        id: crmDeals.id,
        title: crmDeals.title,
        value: crmDeals.value,
        status: crmDeals.status,
        stageId: crmDeals.stageId,
        operatorId: crmDeals.operatorId,
        createdAt: crmDeals.createdAt,
        closedAt: crmDeals.closedAt,
        lossReason: crmDeals.lossReason,
      })
      .from(crmDeals)
      .where(
        and(
          eq(crmDeals.tenantId, tenantId),
          or(
            eq(crmDeals.status, "open"),
            and(
              inArray(crmDeals.status, ["won", "lost"]),
              gte(crmDeals.closedAt, new Date(`${previousMonth}-01T00:00:00Z`)),
            ),
          ),
        ),
      ),
    db
      .select({
        operatorId: commercialGoals.operatorId,
        targetValue: commercialGoals.targetValue,
        conversionRate: commercialGoals.conversionRate,
      })
      .from(commercialGoals)
      .where(and(eq(commercialGoals.tenantId, tenantId), eq(commercialGoals.month, month))),
    db
      .select({
        date: commercialCalendarDays.date,
        type: commercialCalendarDays.type,
        affectsGoal: commercialCalendarDays.affectsGoal,
      })
      .from(commercialCalendarDays)
      .where(
        and(
          eq(commercialCalendarDays.tenantId, tenantId),
          gte(commercialCalendarDays.date, monthStart),
          lt(commercialCalendarDays.date, nextMonthStart),
        ),
      ),
    db.select().from(commercialSettings).where(eq(commercialSettings.tenantId, tenantId)).limit(1),
    db
      .select({
        operatorId: commercialTransferResponseEvents.operatorId,
        status: commercialTransferResponseEvents.status,
        transferredAt: commercialTransferResponseEvents.transferredAt,
        durationSeconds: commercialTransferResponseEvents.durationSeconds,
      })
      .from(commercialTransferResponseEvents)
      .where(
        and(
          eq(commercialTransferResponseEvents.tenantId, tenantId),
          gte(commercialTransferResponseEvents.transferredAt, new Date(`${monthStart}T00:00:00Z`)),
        ),
      ),
    db
      .select({ count: count() })
      .from(crmDeals)
      .innerJoin(
        commercialConsultantProfiles,
        and(
          eq(commercialConsultantProfiles.operatorId, crmDeals.operatorId),
          eq(commercialConsultantProfiles.tenantId, tenantId),
        ),
      )
      .where(
        and(
          eq(crmDeals.tenantId, tenantId),
          eq(crmDeals.status, "lost"),
          eq(commercialConsultantProfiles.activeOnTv, true),
          division ? eq(commercialConsultantProfiles.division, division) : undefined,
        ),
      ),
  ]);

  const scopedOperators = (operatorsRows as OperatorRow[]).filter(
    (item) => item.activeOnTv && (!division || item.division === division),
  );
  const operatorMap = new Map(scopedOperators.map((item) => [item.id, item]));
  const goals = new Map(goalRows.map((goal) => [goal.operatorId, goal]));
  const stageMap = new Map(stageRows.map((stage) => [stage.id, stage]));
  const settings = settingsRows[0];
  const excludedStageIds = new Set(settings?.excludedStageIds || []);
  const rules: MaturityRule[] =
    settings?.maturityRules?.length === 5 ? settings.maturityRules : DEFAULT_MATURITY_RULES;
  const slaLimitMinutes = settings?.slaLimitMinutes || 15;
  const scopedDeals = deals.filter((deal) => deal.operatorId && operatorMap.has(deal.operatorId));
  const openDeals = scopedDeals.filter(
    (deal) => deal.status === "open" && !excludedStageIds.has(deal.stageId),
  );
  const wonDeals = scopedDeals.filter(
    (deal) =>
      deal.status === "won" && deal.closedAt && saoPauloDay(deal.closedAt).slice(0, 7) === month,
  );
  const lostDeals = scopedDeals.filter((deal) => deal.status === "lost" && deal.closedAt);
  const sum = (items: typeof scopedDeals) =>
    items.reduce((total, item) => total + Number(item.value || 0), 0);

  const pipeline = stageRows
    .filter((stage) => !excludedStageIds.has(stage.id))
    .map((stage) => {
      const items = openDeals.filter((deal) => deal.stageId === stage.id);
      return {
        stageId: stage.id,
        name: stage.name,
        orderIndex: stage.orderIndex,
        count: items.length,
        value: sum(items),
      };
    })
    .filter((item) => item.count > 0);

  const matureTiers = rules.map((rule, index) => ({
    tier: index + 1,
    days: rule.days,
    maxValue: rule.maxValue,
    readyCount: 0,
    readyValue: 0,
    pendingCount: 0,
    pendingValue: 0,
    expectedValue: 0,
  }));
  const cohorts: Array<{
    dealId: string;
    title: string;
    operatorId: string;
    operatorName: string;
    stageName: string;
    value: number;
    tier: number;
    ageDays: number;
    daysRemaining: number;
    expectedValue: number;
  }> = [];
  for (const deal of openDeals) {
    const value = Number(deal.value || 0);
    const maturity = classifyMaturity(value, deal.createdAt, now, rules);
    if (!maturity) continue;
    const rate = Number(goals.get(deal.operatorId!)?.conversionRate ?? 10) / 100;
    const expectedValue = value * rate;
    const tier = matureTiers[maturity.tierIndex - 1];
    if (maturity.isMature) {
      tier.readyCount += 1;
      tier.readyValue += value;
    } else {
      tier.pendingCount += 1;
      tier.pendingValue += value;
      tier.expectedValue += expectedValue;
    }
    cohorts.push({
      dealId: deal.id,
      title: deal.title,
      operatorId: deal.operatorId!,
      operatorName: operatorMap.get(deal.operatorId!)?.name || "Consultor",
      stageName: stageMap.get(deal.stageId)?.name || "Etapa",
      value,
      tier: maturity.tierIndex,
      ageDays: maturity.ageDays,
      daysRemaining: maturity.daysRemaining,
      expectedValue,
    });
  }
  cohorts.sort((a, b) => a.daysRemaining - b.daysRemaining || b.value - a.value);

  const consultants = scopedOperators.map((operator) => {
    const won = wonDeals.filter((deal) => deal.operatorId === operator.id);
    const goal = goals.get(operator.id);
    const targetValue = Number(goal?.targetValue || 0);
    const realizedValue = sum(won);
    const pacing = calculateBusinessPacing(
      month,
      today,
      targetValue,
      realizedValue,
      calendarRows as CommercialCalendarDay[],
    );
    return {
      operatorId: operator.id,
      name: operator.name,
      division: operator.division,
      activeOnTv: operator.activeOnTv,
      targetValue,
      realizedValue,
      conversionRate: Number(goal?.conversionRate ?? 10),
      wonCount: won.length,
      ...pacing,
    };
  });
  const totalTarget = consultants.reduce((total, item) => total + item.targetValue, 0);
  const totalRealized = consultants.reduce((total, item) => total + item.realizedValue, 0);

  const lossesByReason = new Map<string, { count: number; value: number }>();
  for (const deal of lostDeals.filter(
    (item) => saoPauloDay(item.closedAt!).slice(0, 7) === month,
  )) {
    const reason = deal.lossReason?.trim() || "Motivo não informado";
    const current = lossesByReason.get(reason) || { count: 0, value: 0 };
    current.count += 1;
    current.value += Number(deal.value || 0);
    lossesByReason.set(reason, current);
  }
  const currentLosses = lostDeals.filter(
    (item) => saoPauloDay(item.closedAt!).slice(0, 7) === month,
  );
  const previousLosses = lostDeals.filter(
    (item) => saoPauloDay(item.closedAt!).slice(0, 7) === previousMonth,
  );

  const scopedTma = tmaRows.filter(
    (item) =>
      item.operatorId &&
      operatorMap.has(item.operatorId) &&
      saoPauloDay(item.transferredAt).slice(0, 7) === month,
  );
  const answered = scopedTma.filter(
    (item) => item.status === "responded" && item.durationSeconds !== null,
  );
  const pending = scopedTma.filter((item) => item.status === "pending");
  const averageSeconds = answered.length
    ? answered.reduce((total, item) => total + Number(item.durationSeconds), 0) / answered.length
    : null;
  const withinSla = answered.filter(
    (item) => Number(item.durationSeconds) <= slaLimitMinutes * 60,
  ).length;
  const tmaByOperator = scopedOperators
    .map((operator) => {
      const events = answered.filter((item) => item.operatorId === operator.id);
      const totalSeconds = events.reduce((total, item) => total + Number(item.durationSeconds), 0);
      return {
        operatorId: operator.id,
        name: operator.name,
        count: events.length,
        averageSeconds: events.length ? totalSeconds / events.length : null,
        pending: pending.filter((item) => item.operatorId === operator.id).length,
      };
    })
    .sort((a, b) => (a.averageSeconds ?? Infinity) - (b.averageSeconds ?? Infinity));

  return {
    asOf: now.toISOString(),
    today,
    month,
    division,
    settings: {
      slaLimitMinutes,
      tvSettings: settings?.tvSettings || {
        rotationSeconds: 30,
        activeModules: [0, 1, 2, 3, 4, 5],
      },
      excludedStageIds: [...excludedStageIds],
    },
    summary: {
      openCount: openDeals.length,
      openValue: sum(openDeals),
      wonCount: wonDeals.length,
      faturado: totalRealized,
      targetValue: totalTarget,
      coveragePercent: totalTarget > 0 ? (totalRealized / totalTarget) * 100 : 0,
    },
    pipeline,
    maturity: { tiers: matureTiers, cohorts },
    goals: consultants,
    losses: {
      currentCount: currentLosses.length,
      currentValue: sum(currentLosses),
      previousCount: previousLosses.length,
      previousValue: sum(previousLosses),
      historicalCount: Number(historicalLossRows[0]?.count || 0),
      reasons: [...lossesByReason]
        .map(([reason, values]) => ({ reason, ...values }))
        .sort((a, b) => b.count - a.count),
    },
    tma: {
      answeredCount: answered.length,
      pendingCount: pending.length,
      averageSeconds,
      slaPercent: answered.length ? (withinSla / answered.length) * 100 : null,
      byOperator: tmaByOperator,
    },
  };
}
