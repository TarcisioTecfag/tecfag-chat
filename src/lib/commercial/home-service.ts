import { and, count, eq, gte, lt, or, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  commercialCalendarDays,
  commercialConsultantProfiles,
  commercialDirectives,
  commercialEvidence,
  commercialGoals,
  crmDealActivities,
  crmDeals,
  crmStages,
  operators,
} from "../../db/schema";
import { calculateBusinessPacing, saoPauloDay, type CommercialCalendarDay } from "./metrics";

export async function getCommercialHome(tenantId: string, operatorId: string, now = new Date()) {
  const today = saoPauloDay(now);
  const month = today.slice(0, 7);
  const monthStart = `${month}-01`;
  const [year, monthNumber] = month.split("-").map(Number);
  const nextMonthStart = `${monthNumber === 12 ? year + 1 : year}-${String(monthNumber === 12 ? 1 : monthNumber + 1).padStart(2, "0")}-01`;

  const [profile, goal, calendarRows, wonRows, wonDeals, openRows, activities, directives] =
    await Promise.all([
      db
        .select({ division: commercialConsultantProfiles.division })
        .from(commercialConsultantProfiles)
        .where(
          and(
            eq(commercialConsultantProfiles.tenantId, tenantId),
            eq(commercialConsultantProfiles.operatorId, operatorId),
          ),
        )
        .limit(1),
      db
        .select({
          targetValue: commercialGoals.targetValue,
          conversionRate: commercialGoals.conversionRate,
        })
        .from(commercialGoals)
        .where(
          and(
            eq(commercialGoals.tenantId, tenantId),
            eq(commercialGoals.operatorId, operatorId),
            eq(commercialGoals.month, month),
          ),
        )
        .limit(1),
      db
        .select({
          date: commercialCalendarDays.date,
          type: commercialCalendarDays.type,
          description: commercialCalendarDays.description,
          affectsGoal: commercialCalendarDays.affectsGoal,
        })
        .from(commercialCalendarDays)
        .where(
          and(
            eq(commercialCalendarDays.tenantId, tenantId),
            gte(commercialCalendarDays.date, monthStart),
            lt(commercialCalendarDays.date, nextMonthStart),
          ),
        )
        .orderBy(commercialCalendarDays.date),
      db
        .select({ count: count(), value: sql<string>`COALESCE(SUM(${crmDeals.value}), 0)` })
        .from(crmDeals)
        .where(
          and(
            eq(crmDeals.tenantId, tenantId),
            eq(crmDeals.operatorId, operatorId),
            eq(crmDeals.status, "won"),
            sql`((${crmDeals.closedAt} AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo')::date >= ${monthStart}::date`,
            sql`((${crmDeals.closedAt} AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo')::date < ${nextMonthStart}::date`,
          ),
        ),
      db
        .select({
          id: crmDeals.id,
          title: crmDeals.title,
          value: crmDeals.value,
          closedAt: crmDeals.closedAt,
        })
        .from(crmDeals)
        .where(
          and(
            eq(crmDeals.tenantId, tenantId),
            eq(crmDeals.operatorId, operatorId),
            eq(crmDeals.status, "won"),
            sql`((${crmDeals.closedAt} AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo')::date >= ${monthStart}::date`,
            sql`((${crmDeals.closedAt} AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo')::date < ${nextMonthStart}::date`,
          ),
        )
        .orderBy(crmDeals.closedAt),
      db
        .select({ count: count(), value: sql<string>`COALESCE(SUM(${crmDeals.value}), 0)` })
        .from(crmDeals)
        .where(
          and(
            eq(crmDeals.tenantId, tenantId),
            eq(crmDeals.operatorId, operatorId),
            eq(crmDeals.status, "open"),
          ),
        ),
      db
        .select({
          id: crmDealActivities.id,
          title: crmDealActivities.title,
          dueDate: crmDealActivities.dueDate,
          dealId: crmDealActivities.dealId,
          dealTitle: crmDeals.title,
        })
        .from(crmDealActivities)
        .innerJoin(
          crmDeals,
          and(eq(crmDeals.id, crmDealActivities.dealId), eq(crmDeals.tenantId, tenantId)),
        )
        .where(
          and(
            eq(crmDealActivities.tenantId, tenantId),
            eq(crmDealActivities.assignedToOperatorId, operatorId),
            eq(crmDealActivities.status, "pending"),
            sql`((${crmDealActivities.dueDate} AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo')::date = ${today}::date`,
          ),
        )
        .orderBy(crmDealActivities.dueDate)
        .limit(20),
      db
        .select({
          id: commercialDirectives.id,
          dealId: commercialDirectives.dealId,
          dealTitle: crmDeals.title,
          dealValue: crmDeals.value,
          stageName: crmStages.name,
          instruction: commercialDirectives.instruction,
          priority: commercialDirectives.priority,
          assignedDate: commercialDirectives.assignedDate,
          dueAt: commercialDirectives.dueAt,
          status: commercialDirectives.status,
          completedAt: commercialDirectives.completedAt,
          completionNote: commercialDirectives.completionNote,
          evidenceChannel: commercialEvidence.channel,
        })
        .from(commercialDirectives)
        .innerJoin(
          crmDeals,
          and(eq(crmDeals.id, commercialDirectives.dealId), eq(crmDeals.tenantId, tenantId)),
        )
        .leftJoin(
          crmStages,
          and(eq(crmStages.id, crmDeals.stageId), eq(crmStages.tenantId, tenantId)),
        )
        .leftJoin(
          commercialEvidence,
          and(
            eq(commercialEvidence.directiveId, commercialDirectives.id),
            eq(commercialEvidence.tenantId, tenantId),
          ),
        )
        .where(
          and(
            eq(commercialDirectives.tenantId, tenantId),
            eq(commercialDirectives.assignedToOperatorId, operatorId),
            or(
              eq(commercialDirectives.status, "pending"),
              and(
                eq(commercialDirectives.status, "completed"),
                sql`((${commercialDirectives.completedAt} AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo')::date = ${today}::date`,
              ),
            ),
          ),
        )
        .orderBy(commercialDirectives.assignedDate)
        .limit(60),
    ]);

  const targetValue = Number(goal[0]?.targetValue ?? 0);
  const realizedValue = Number(wonRows[0]?.value ?? 0);
  const pacing = calculateBusinessPacing(
    month,
    today,
    targetValue,
    realizedValue,
    calendarRows as CommercialCalendarDay[],
  );

  const [operator] = await db
    .select({ name: operators.name, avatar: operators.avatar })
    .from(operators)
    .where(and(eq(operators.tenantId, tenantId), eq(operators.id, operatorId)))
    .limit(1);

  return {
    asOf: now.toISOString(),
    today,
    month,
    consultant: {
      id: operatorId,
      name: operator?.name ?? "Consultor",
      avatar: operator?.avatar ?? null,
      division: profile[0]?.division ?? null,
    },
    goal: {
      configured: goal.length > 0,
      targetValue,
      realizedValue,
      conversionRate: Number(goal[0]?.conversionRate ?? 10),
      ...pacing,
    },
    deals: {
      openCount: Number(openRows[0]?.count ?? 0),
      openValue: Number(openRows[0]?.value ?? 0),
      wonThisMonthCount: wonDeals.length,
    },
    wonDeals: wonDeals.map((d) => ({
      id: d.id,
      title: d.title,
      value: Number(d.value ?? 0),
      closedAt: d.closedAt ? d.closedAt.toISOString() : null,
    })),
    calendarDays: calendarRows.map((c) => ({
      date: c.date,
      type: c.type,
      description: c.description,
      affectsGoal: c.affectsGoal,
    })),
    activities,
    directives: directives.map((directive) => ({
      ...directive,
      dealValue: Number(directive.dealValue ?? 0),
      dueAt: directive.dueAt ? directive.dueAt.toISOString() : null,
      completedAt: directive.completedAt ? directive.completedAt.toISOString() : null,
      evidenceChannel: directive.evidenceChannel ?? null,
      overdue: directive.status === "pending" && directive.assignedDate < today,
    })),
  };
}

