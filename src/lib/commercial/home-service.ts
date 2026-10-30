import { and, count, desc, eq, gte, inArray, lt, or, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  commercialCalendarDays,
  commercialConsultantProfiles,
  commercialDirectives,
  commercialEvidence,
  commercialGoals,
  contacts,
  conversations,
  crmAccounts,
  crmConversationDeals,
  crmDealActivities,
  crmDealContacts,
  crmDeals,
  crmPipelines,
  crmStages,
  operators,
} from "../../db/schema";
import {
  calculateBusinessPacing,
  isCommercialWinStage,
  saoPauloDay,
  type CommercialCalendarDay,
} from "./metrics";
import { buildConsultantOperatorAliasMap } from "./avatar-matcher";
import { ensureBrazilianHolidaysSeeded } from "./brazilian-holidays";

export async function getCommercialHome(tenantId: string, operatorId: string, now = new Date()) {
  await ensureBrazilianHolidaysSeeded(tenantId);
  const today = saoPauloDay(now);
  const month = today.slice(0, 7);
  const monthStart = `${month}-01`;
  const [year, monthNumber] = month.split("-").map(Number);
  const nextMonthStart = `${monthNumber === 12 ? year + 1 : year}-${String(monthNumber === 12 ? 1 : monthNumber + 1).padStart(2, "0")}-01`;

  const [allOperators, stageRows, pipelineRows, profile, goal, calendarRows] = await Promise.all([
    db
      .select({ id: operators.id, name: operators.name, avatar: operators.avatar })
      .from(operators)
      .where(eq(operators.tenantId, tenantId)),
    db
      .select({
        id: crmStages.id,
        name: crmStages.name,
        pipelineId: crmStages.pipelineId,
        isWinStage: crmStages.isWinStage,
      })
      .from(crmStages)
      .where(eq(crmStages.tenantId, tenantId)),
    db
      .select({ id: crmPipelines.id, name: crmPipelines.name })
      .from(crmPipelines)
      .where(eq(crmPipelines.tenantId, tenantId)),
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
  ]);

  const operatorMap = new Map(allOperators.map((o) => [o.id, o.name]));
  const stageMap = new Map(stageRows.map((s) => [s.id, s]));
  const pipelineMap = new Map(pipelineRows.map((p) => [p.id, p.name]));

  const operator = allOperators.find((o) => o.id === operatorId);
  const aliasResolution = operator
    ? buildConsultantOperatorAliasMap(
        [{ operatorId: operator.id, name: operator.name }],
        allOperators.map((o) => ({ id: o.id, name: o.name })),
      )
    : null;
  const effectiveOperatorIds = aliasResolution
    ? aliasResolution.byCanonicalId.get(operatorId) || [operatorId]
    : [operatorId];
  const winStageIdsArray = stageRows.filter((s) => isCommercialWinStage(s)).map((s) => s.id);
  const effectiveCloseDateExpr = sql`COALESCE(${crmDeals.closedAt}, ${crmDeals.createdAt})`;
  const wonCondition = and(
    eq(crmDeals.tenantId, tenantId),
    inArray(crmDeals.operatorId, effectiveOperatorIds),
    or(
      eq(crmDeals.status, "won"),
      winStageIdsArray.length
        ? and(eq(crmDeals.status, "open"), inArray(crmDeals.stageId, winStageIdsArray))
        : undefined,
    ),
    sql`((${effectiveCloseDateExpr} AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo')::date >= ${monthStart}::date`,
    sql`((${effectiveCloseDateExpr} AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo')::date < ${nextMonthStart}::date`,
  );

  const [wonRows, wonDeals, openRows, rawActivities, rawDirectives] = await Promise.all([
    db
      .select({ count: count(), value: sql<string>`COALESCE(SUM(${crmDeals.value}), 0)` })
      .from(crmDeals)
      .where(wonCondition),
    db
      .select({
        id: crmDeals.id,
        title: crmDeals.title,
        value: crmDeals.value,
        closedAt: crmDeals.closedAt,
        createdAt: crmDeals.createdAt,
      })
      .from(crmDeals)
      .where(wonCondition)
      .orderBy(sql`COALESCE(${crmDeals.closedAt}, ${crmDeals.createdAt})`),
    db
      .select({ count: count(), value: sql<string>`COALESCE(SUM(${crmDeals.value}), 0)` })
      .from(crmDeals)
      .where(
        and(
          eq(crmDeals.tenantId, tenantId),
          inArray(crmDeals.operatorId, effectiveOperatorIds),
          eq(crmDeals.status, "open"),
        ),
      ),
    db
      .select({
        id: crmDealActivities.id,
        title: crmDealActivities.title,
        type: crmDealActivities.type,
        description: crmDealActivities.description,
        status: crmDealActivities.status,
        dueDate: crmDealActivities.dueDate,
        completedAt: crmDealActivities.completedAt,
        createdAt: crmDealActivities.createdAt,
        conversationId: crmDealActivities.conversationId,
        operatorId: crmDealActivities.operatorId,
        assignedToOperatorId: crmDealActivities.assignedToOperatorId,
        dealId: crmDealActivities.dealId,
        dealTitle: crmDeals.title,
        dealValue: crmDeals.value,
        pipelineId: crmDeals.pipelineId,
        stageId: crmDeals.stageId,
        accountId: crmDeals.accountId,
        accountName: crmAccounts.name,
        accountTradeName: crmAccounts.tradeName,
        accountDocument: crmAccounts.document,
        accountPhone: crmAccounts.phone,
      })
      .from(crmDealActivities)
      .innerJoin(
        crmDeals,
        and(eq(crmDeals.id, crmDealActivities.dealId), eq(crmDeals.tenantId, tenantId)),
      )
      .leftJoin(
        crmAccounts,
        and(eq(crmAccounts.id, crmDeals.accountId), eq(crmAccounts.tenantId, tenantId)),
      )
      .where(
        and(
          eq(crmDealActivities.tenantId, tenantId),
          sql`${crmDealActivities.type} NOT IN ('note', 'system_event')`,
          or(
            inArray(crmDealActivities.assignedToOperatorId, effectiveOperatorIds),
            inArray(crmDealActivities.operatorId, effectiveOperatorIds),
            inArray(crmDeals.operatorId, effectiveOperatorIds),
          ),
          or(
            and(
              eq(crmDealActivities.status, "pending"),
              or(
                sql`((${crmDealActivities.dueDate} AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo')::date <= ${today}::date`,
                sql`${crmDealActivities.dueDate} IS NULL`,
              ),
            ),
            and(
              eq(crmDealActivities.status, "completed"),
              sql`((${crmDealActivities.completedAt} AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo')::date = ${today}::date`,
            ),
          ),
        ),
      )
      .orderBy(sql`${crmDealActivities.dueDate} ASC NULLS LAST`, desc(crmDealActivities.createdAt))
      .limit(50),
    db
      .select({
        id: commercialDirectives.id,
        dealId: commercialDirectives.dealId,
        dealTitle: crmDeals.title,
        dealValue: crmDeals.value,
        pipelineId: crmDeals.pipelineId,
        stageId: crmDeals.stageId,
        stageName: crmStages.name,
        accountId: crmDeals.accountId,
        accountName: crmAccounts.name,
        accountTradeName: crmAccounts.tradeName,
        accountDocument: crmAccounts.document,
        accountPhone: crmAccounts.phone,
        instruction: commercialDirectives.instruction,
        priority: commercialDirectives.priority,
        assignedDate: commercialDirectives.assignedDate,
        assignedByOperatorId: commercialDirectives.assignedByOperatorId,
        dueAt: commercialDirectives.dueAt,
        status: commercialDirectives.status,
        completedAt: commercialDirectives.completedAt,
        completionNote: commercialDirectives.completionNote,
        createdAt: commercialDirectives.createdAt,
        snapshot: commercialDirectives.snapshot,
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
        crmAccounts,
        and(eq(crmAccounts.id, crmDeals.accountId), eq(crmAccounts.tenantId, tenantId)),
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
          inArray(commercialDirectives.assignedToOperatorId, effectiveOperatorIds),
          or(
            eq(commercialDirectives.status, "pending"),
            and(
              eq(commercialDirectives.status, "completed"),
              sql`((${commercialDirectives.completedAt} AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo')::date = ${today}::date`,
            ),
          ),
        ),
      )
      .orderBy(desc(commercialDirectives.assignedDate), desc(commercialDirectives.createdAt))
      .limit(60),
  ]);

  // Enriquecer negociações de atividades e diretrizes com contato principal e conversa vinculada
  const allDealIds = Array.from(
    new Set([
      ...rawActivities.map((a) => a.dealId),
      ...rawDirectives.map((d) => d.dealId),
    ].filter(Boolean)),
  );

  const dealContactMap = new Map<
    string,
    { contactId: string; contactName: string | null; contactPhone: string | null }
  >();
  const dealConvMap = new Map<string, string>();
  const contactConvMap = new Map<string, string>();

  if (allDealIds.length > 0) {
    const [dealContactsRows, convDealRows] = await Promise.all([
      db
        .select({
          dealId: crmDealContacts.dealId,
          contactId: crmDealContacts.contactId,
          isPrimary: crmDealContacts.isPrimary,
          contactName: contacts.name,
          contactPhone: contacts.phone,
        })
        .from(crmDealContacts)
        .innerJoin(
          contacts,
          and(eq(contacts.id, crmDealContacts.contactId), eq(contacts.tenantId, tenantId)),
        )
        .where(
          and(
            eq(crmDealContacts.tenantId, tenantId),
            inArray(crmDealContacts.dealId, allDealIds),
          ),
        )
        .orderBy(desc(crmDealContacts.isPrimary), crmDealContacts.createdAt),
      db
        .select({
          dealId: crmConversationDeals.dealId,
          conversationId: crmConversationDeals.conversationId,
        })
        .from(crmConversationDeals)
        .where(
          and(
            eq(crmConversationDeals.tenantId, tenantId),
            inArray(crmConversationDeals.dealId, allDealIds),
            eq(crmConversationDeals.isActive, true),
          ),
        )
        .orderBy(desc(crmConversationDeals.createdAt)),
    ]);

    for (const row of dealContactsRows) {
      if (!dealContactMap.has(row.dealId)) {
        dealContactMap.set(row.dealId, {
          contactId: row.contactId,
          contactName: row.contactName,
          contactPhone: row.contactPhone,
        });
      }
    }

    for (const row of convDealRows) {
      if (!dealConvMap.has(row.dealId)) {
        dealConvMap.set(row.dealId, row.conversationId);
      }
    }

    const contactIdsToResolve = Array.from(
      new Set(Array.from(dealContactMap.values()).map((c) => c.contactId).filter(Boolean)),
    );

    if (contactIdsToResolve.length > 0) {
      const convRows = await db
        .select({
          id: conversations.id,
          contactId: conversations.contactId,
        })
        .from(conversations)
        .where(
          and(
            eq(conversations.tenantId, tenantId),
            inArray(conversations.contactId, contactIdsToResolve),
          ),
        )
        .orderBy(desc(conversations.updatedAt));

      for (const conv of convRows) {
        if (conv.contactId && !contactConvMap.has(conv.contactId)) {
          contactConvMap.set(conv.contactId, conv.id);
        }
      }
    }
  }

  const activities = rawActivities.map((act) => {
    const contactInfo = dealContactMap.get(act.dealId);
    const resolvedConvId =
      act.conversationId ||
      dealConvMap.get(act.dealId) ||
      (contactInfo?.contactId ? contactConvMap.get(contactInfo.contactId) || null : null);
    const stageInfo = stageMap.get(act.stageId);
    const dueDateIso = act.dueDate ? act.dueDate.toISOString() : null;
    const dueDayStr = act.dueDate ? saoPauloDay(act.dueDate) : null;
    const isOverdue = act.status === "pending" && Boolean(dueDayStr && dueDayStr < today);

    return {
      id: act.id,
      title: act.title,
      type: act.type || "task",
      description: act.description ?? null,
      status: act.status || "pending",
      dueDate: dueDateIso,
      completedAt: act.completedAt ? act.completedAt.toISOString() : null,
      createdAt: act.createdAt ? act.createdAt.toISOString() : null,
      overdue: isOverdue,
      dealId: act.dealId,
      dealTitle: act.dealTitle,
      dealValue: Number(act.dealValue ?? 0),
      pipelineId: act.pipelineId,
      pipelineName: pipelineMap.get(act.pipelineId) ?? null,
      stageId: act.stageId,
      stageName: stageInfo?.name ?? null,
      accountId: act.accountId ?? null,
      accountName: act.accountTradeName || act.accountName || null,
      accountDocument: act.accountDocument ?? null,
      contactId: contactInfo?.contactId ?? null,
      contactName: contactInfo?.contactName ?? null,
      contactPhone: contactInfo?.contactPhone || act.accountPhone || null,
      conversationId: resolvedConvId,
      assignedByOperatorName: act.operatorId ? operatorMap.get(act.operatorId) ?? null : null,
    };
  });

  const targetValue = Number(goal[0]?.targetValue ?? 0);
  const realizedValue = Number(wonRows[0]?.value ?? 0);
  const pacing = calculateBusinessPacing(
    month,
    today,
    targetValue,
    realizedValue,
    calendarRows as CommercialCalendarDay[],
  );

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
    wonDeals: wonDeals.map((d) => {
      const effectiveClosedAt = d.closedAt ?? d.createdAt;
      return {
        id: d.id,
        title: d.title,
        value: Number(d.value ?? 0),
        closedAt: effectiveClosedAt ? effectiveClosedAt.toISOString() : null,
      };
    }),
    calendarDays: calendarRows.map((c) => ({
      date: c.date,
      type: c.type,
      description: c.description,
      affectsGoal: c.affectsGoal,
    })),
    activities,
    directives: rawDirectives.map((directive) => {
      const contactInfo = dealContactMap.get(directive.dealId);
      const resolvedConvId =
        dealConvMap.get(directive.dealId) ||
        (contactInfo?.contactId ? contactConvMap.get(contactInfo.contactId) || null : null);
      const notificationReadAt = directive.snapshot?.notificationReadAt ?? null;

      return {
        id: directive.id,
        dealId: directive.dealId,
        dealTitle: directive.dealTitle,
        dealValue: Number(directive.dealValue ?? 0),
        pipelineId: directive.pipelineId,
        pipelineName: pipelineMap.get(directive.pipelineId) ?? null,
        stageId: directive.stageId,
        stageName: directive.stageName ?? stageMap.get(directive.stageId)?.name ?? null,
        accountId: directive.accountId ?? null,
        accountName: directive.accountTradeName || directive.accountName || null,
        accountDocument: directive.accountDocument ?? null,
        contactId: contactInfo?.contactId ?? null,
        contactName: contactInfo?.contactName ?? null,
        contactPhone: contactInfo?.contactPhone || directive.accountPhone || null,
        conversationId: resolvedConvId,
        instruction: directive.instruction,
        priority: directive.priority,
        assignedDate: directive.assignedDate,
        assignedByOperatorId: directive.assignedByOperatorId ?? null,
        assignedByOperatorName: directive.assignedByOperatorId
          ? operatorMap.get(directive.assignedByOperatorId) ?? "Gestão Comercial"
          : "Gestão Comercial",
        createdAt: directive.createdAt ? directive.createdAt.toISOString() : null,
        dueAt: directive.dueAt ? directive.dueAt.toISOString() : null,
        status: directive.status,
        completedAt: directive.completedAt ? directive.completedAt.toISOString() : null,
        completionNote: directive.completionNote ?? null,
        evidenceChannel: directive.evidenceChannel ?? null,
        notificationReadAt,
        overdue: directive.status === "pending" && directive.assignedDate < today,
      };
    }),
  };
}

export async function markCommercialDirectivesRead(
  tenantId: string,
  operatorId: string,
  options: { directiveIds?: string[]; markAll?: boolean },
) {
  const allOperators = await db
    .select({ id: operators.id, name: operators.name })
    .from(operators)
    .where(eq(operators.tenantId, tenantId));

  const operator = allOperators.find((o) => o.id === operatorId);
  const aliasResolution = operator
    ? buildConsultantOperatorAliasMap(
        [{ operatorId: operator.id, name: operator.name }],
        allOperators.map((o) => ({ id: o.id, name: o.name })),
      )
    : null;
  const effectiveOperatorIds = aliasResolution
    ? aliasResolution.byCanonicalId.get(operatorId) || [operatorId]
    : [operatorId];

  const conditions = [
    eq(commercialDirectives.tenantId, tenantId),
    inArray(commercialDirectives.assignedToOperatorId, effectiveOperatorIds),
  ];

  const cleanIds = Array.isArray(options.directiveIds)
    ? options.directiveIds.filter((id) => typeof id === "string" && id.trim().length > 0)
    : [];

  if (!options.markAll) {
    if (cleanIds.length === 0) return { updatedCount: 0 };
    conditions.push(inArray(commercialDirectives.id, cleanIds));
  }

  const nowIso = new Date().toISOString();
  const patchJson = JSON.stringify({ notificationReadAt: nowIso });

  const updated = await db
    .update(commercialDirectives)
    .set({
      snapshot: sql`COALESCE(${commercialDirectives.snapshot}, '{}'::jsonb) || ${patchJson}::jsonb`,
      updatedAt: new Date(),
    })
    .where(and(...conditions))
    .returning({ id: commercialDirectives.id });

  return { updatedCount: updated.length, notificationReadAt: nowIso };
}

