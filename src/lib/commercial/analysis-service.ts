import { and, count, desc, eq, gt, gte, ilike, inArray, lt, lte, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../../db";
import {
  commercialCalendarDays,
  commercialConsultantProfiles,
  commercialDirectives,
  commercialGoals,
  commercialSettings,
  commercialTransferResponseEvents,
  contacts,
  conversations,
  crmAccounts,
  crmDealContacts,
  crmDealEvents,
  crmDeals,
  crmPipelines,
  crmStages,
  operators,
} from "../../db/schema";
import {
  buildGoalCurve,
  directiveState,
  forecastTier,
  lastSixMonths,
  monthWindow,
  tmaBucket,
  type CommercialDivision,
} from "./analysis-core";
import {
  classifyMaturity,
  DEFAULT_MATURITY_RULES,
  saoPauloDay,
  type CommercialCalendarDay,
} from "./metrics";
import {
  belongsToTeamPipeline,
  configuredPipelineId,
  type PipelineByDivision,
} from "./pipeline-scope";

type AnalysisOptions = {
  tenantId: string;
  division: CommercialDivision;
  includeHidden?: boolean;
  now?: Date;
};

async function getScope({ tenantId, division, includeHidden }: AnalysisOptions) {
  const [consultants, settingsRows, stages] = await Promise.all([
    db
      .select({
        operatorId: operators.id,
        name: operators.name,
        avatar: operators.avatar,
        division: commercialConsultantProfiles.division,
      })
      .from(commercialConsultantProfiles)
      .innerJoin(
        operators,
        and(
          eq(operators.id, commercialConsultantProfiles.operatorId),
          eq(operators.tenantId, tenantId),
        ),
      )
      .where(
        and(
          eq(commercialConsultantProfiles.tenantId, tenantId),
          includeHidden ? undefined : eq(commercialConsultantProfiles.activeOnTv, true),
          division ? eq(commercialConsultantProfiles.division, division) : undefined,
        ),
      ),
    db.select().from(commercialSettings).where(eq(commercialSettings.tenantId, tenantId)).limit(1),
    db
      .select({
        id: crmStages.id,
        name: crmStages.name,
        orderIndex: crmStages.orderIndex,
        pipelineId: crmStages.pipelineId,
        pipelineName: crmPipelines.name,
        pipelineOrder: crmPipelines.orderIndex,
      })
      .from(crmStages)
      .innerJoin(
        crmPipelines,
        and(eq(crmPipelines.id, crmStages.pipelineId), eq(crmPipelines.tenantId, tenantId)),
      )
      .where(eq(crmStages.tenantId, tenantId))
      .orderBy(crmPipelines.orderIndex, crmStages.orderIndex),
  ]);
  const settings = settingsRows[0];
  return {
    consultants,
    stages,
    stageMap: new Map(stages.map((stage) => [stage.id, stage])),
    excludedStageIds: new Set(settings?.excludedStageIds || []),
    pipelineByDivision: (settings?.pipelineByDivision || {}) as PipelineByDivision,
    rules: settings?.maturityRules?.length === 5 ? settings.maturityRules : DEFAULT_MATURITY_RULES,
    slaLimitMinutes: settings?.slaLimitMinutes || 15,
    slaBuckets: settings?.slaBuckets?.length === 3 ? settings.slaBuckets : [5, 15, 30],
    lossReasonCategories: settings?.lossReasonCategories || [],
  };
}

async function getOpenDeals(tenantId: string, operatorIds: string[]) {
  if (!operatorIds.length) return [];
  return db
    .select({
      id: crmDeals.id,
      title: crmDeals.title,
      value: crmDeals.value,
      operatorId: crmDeals.operatorId,
      pipelineId: crmDeals.pipelineId,
      stageId: crmDeals.stageId,
      accountId: crmDeals.accountId,
      createdAt: crmDeals.createdAt,
      expectedCloseDate: crmDeals.expectedCloseDate,
    })
    .from(crmDeals)
    .where(
      and(
        eq(crmDeals.tenantId, tenantId),
        eq(crmDeals.status, "open"),
        inArray(crmDeals.operatorId, operatorIds),
      ),
    );
}

export async function getPipelineAnalysis(options: AnalysisOptions) {
  const scope = await getScope(options);
  const [deals, pipelineOptions] = await Promise.all([
    getOpenDeals(
      options.tenantId,
      scope.consultants.map((item) => item.operatorId),
    ),
    db
      .select({ id: crmPipelines.id, name: crmPipelines.name })
      .from(crmPipelines)
      .where(eq(crmPipelines.tenantId, options.tenantId))
      .orderBy(crmPipelines.orderIndex, crmPipelines.name),
  ]);
  const consultantById = new Map(scope.consultants.map((item) => [item.operatorId, item]));
  const cells = new Map<string, { count: number; value: number }>();
  for (const deal of deals) {
    if (!deal.operatorId) continue;
    const consultant = consultantById.get(deal.operatorId);
    if (!belongsToTeamPipeline(scope.pipelineByDivision, consultant?.division, deal.pipelineId))
      continue;
    const key = `${deal.operatorId}:${deal.stageId}`;
    const cell = cells.get(key) || { count: 0, value: 0 };
    cell.count += 1;
    cell.value += Number(deal.value || 0);
    cells.set(key, cell);
  }
  const selectedPipelineIds = new Set(Object.values(scope.pipelineByDivision));
  const stages = scope.stages
    .filter((stage) => selectedPipelineIds.has(stage.pipelineId))
    .map((stage) => ({ ...stage, excluded: scope.excludedStageIds.has(stage.id) }));
  const rows = scope.consultants.map((consultant) => {
    const teamStages = stages.filter(
      (stage) =>
        configuredPipelineId(scope.pipelineByDivision, consultant.division) === stage.pipelineId &&
        !stage.excluded,
    );
    const byStage = teamStages.map((stage) => ({
      stageId: stage.id,
      ...(cells.get(`${consultant.operatorId}:${stage.id}`) || { count: 0, value: 0 }),
    }));
    return {
      ...consultant,
      byStage,
      total: byStage.reduce(
        (total, cell) => {
          if (!scope.excludedStageIds.has(cell.stageId)) {
            total.count += cell.count;
            total.value += cell.value;
          }
          return total;
        },
        { count: 0, value: 0 },
      ),
    };
  });
  const totals = stages.map((stage) => ({
    stageId: stage.id,
    count: rows.reduce(
      (sum, row) => sum + (row.byStage.find((cell) => cell.stageId === stage.id)?.count || 0),
      0,
    ),
    value: rows.reduce(
      (sum, row) => sum + (row.byStage.find((cell) => cell.stageId === stage.id)?.value || 0),
      0,
    ),
  }));
  const activeValue = rows.reduce((sum, row) => sum + row.total.value, 0);
  return {
    pipelineByDivision: scope.pipelineByDivision,
    pipelineOptions,
    stages,
    rows: rows.map((row) => ({
      ...row,
      shareOfActivePercent: activeValue > 0 ? (row.total.value / activeValue) * 100 : 0,
      byStage: row.byStage.map((cell) => ({
        ...cell,
        shareOfConsultantPercent: row.total.value > 0 ? (cell.value / row.total.value) * 100 : 0,
      })),
    })),
    totals,
    activeTotal: {
      count: rows.reduce((sum, row) => sum + row.total.count, 0),
      value: activeValue,
    },
    asOf: (options.now || new Date()).toISOString(),
  };
}

export type RecentCrmEventItem = {
  id: string;
  createdAt: string;
  eventType: string;
  dealId: string;
  dealTitle: string;
  dealValue: number | null;
  accountName: string | null;
  operatorId: string | null;
  operatorName: string;
  operatorAvatar: string | null;
  actionTitle: string;
  actionDescription: string | null;
  badgeLabel: string;
  badgeVariant: "default" | "stage" | "pipeline" | "note" | "activity" | "won" | "lost" | "created" | "deal";
};

export async function getOperationalAnalysis(options: AnalysisOptions) {
  const now = options.now || new Date();
  const today = saoPauloDay(now);
  const profiles = await db
    .select({
      operatorId: operators.id,
      name: operators.name,
      avatar: operators.avatar,
      division: commercialConsultantProfiles.division,
      activeOnTv: commercialConsultantProfiles.activeOnTv,
      isOnline: operators.isOnline,
    })
    .from(commercialConsultantProfiles)
    .innerJoin(
      operators,
      and(
        eq(operators.id, commercialConsultantProfiles.operatorId),
        eq(operators.tenantId, options.tenantId),
      ),
    )
    .where(
      and(
        eq(commercialConsultantProfiles.tenantId, options.tenantId),
        options.division ? eq(commercialConsultantProfiles.division, options.division) : undefined,
      ),
    );
  const ids = profiles.map((profile) => profile.operatorId);

  const eventOperators = alias(operators, "event_operators");
  const dealOperators = alias(operators, "deal_operators");

  const [openRows, pendingRows, overdueRows, rawEvents, stagesList, pipelinesList] = await Promise.all([
    ids.length
      ? db
          .select({ total: count() })
          .from(crmDeals)
          .where(
            and(
              eq(crmDeals.tenantId, options.tenantId),
              eq(crmDeals.status, "open"),
              inArray(crmDeals.operatorId, ids),
            ),
          )
      : Promise.resolve([{ total: 0 }]),
    ids.length
      ? db
          .select({ total: count() })
          .from(commercialTransferResponseEvents)
          .where(
            and(
              eq(commercialTransferResponseEvents.tenantId, options.tenantId),
              eq(commercialTransferResponseEvents.status, "pending"),
              inArray(commercialTransferResponseEvents.operatorId, ids),
            ),
          )
      : Promise.resolve([{ total: 0 }]),
    ids.length
      ? db
          .select({ total: count() })
          .from(commercialDirectives)
          .where(
            and(
              eq(commercialDirectives.tenantId, options.tenantId),
              eq(commercialDirectives.status, "pending"),
              lt(commercialDirectives.assignedDate, today),
              inArray(commercialDirectives.assignedToOperatorId, ids),
            ),
          )
      : Promise.resolve([{ total: 0 }]),
    db
      .select({
        id: crmDealEvents.id,
        createdAt: crmDealEvents.createdAt,
        eventType: crmDealEvents.eventType,
        dealId: crmDealEvents.dealId,
        fromStageId: crmDealEvents.fromStageId,
        toStageId: crmDealEvents.toStageId,
        fromStatus: crmDealEvents.fromStatus,
        toStatus: crmDealEvents.toStatus,
        metadata: crmDealEvents.metadata,
        dealTitle: crmDeals.title,
        dealValue: crmDeals.value,
        accountName: crmAccounts.name,
        operatorId: crmDealEvents.operatorId,
        eventOpName: eventOperators.name,
        eventOpAvatar: eventOperators.avatar,
        dealOpName: dealOperators.name,
        dealOpAvatar: dealOperators.avatar,
      })
      .from(crmDealEvents)
      .innerJoin(
        crmDeals,
        and(eq(crmDeals.id, crmDealEvents.dealId), eq(crmDeals.tenantId, options.tenantId)),
      )
      .leftJoin(
        eventOperators,
        and(eq(eventOperators.id, crmDealEvents.operatorId), eq(eventOperators.tenantId, options.tenantId)),
      )
      .leftJoin(
        dealOperators,
        and(eq(dealOperators.id, crmDeals.operatorId), eq(dealOperators.tenantId, options.tenantId)),
      )
      .leftJoin(
        crmAccounts,
        and(eq(crmAccounts.id, crmDeals.accountId), eq(crmAccounts.tenantId, options.tenantId)),
      )
      .where(
        and(
          eq(crmDealEvents.tenantId, options.tenantId),
          options.division && ids.length ? inArray(crmDeals.operatorId, ids) : undefined,
        ),
      )
      .orderBy(desc(crmDealEvents.createdAt))
      .limit(20),
    db
      .select({ id: crmStages.id, name: crmStages.name })
      .from(crmStages)
      .where(eq(crmStages.tenantId, options.tenantId)),
    db
      .select({ id: crmPipelines.id, name: crmPipelines.name })
      .from(crmPipelines)
      .where(eq(crmPipelines.tenantId, options.tenantId)),
  ]);

  const stageMap = new Map(stagesList.map((s) => [s.id, s.name]));
  const pipelineMap = new Map(pipelinesList.map((p) => [p.id, p.name]));

  const formatBrl = (val: unknown) => {
    const num = Number(val);
    return Number.isFinite(num)
      ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(num)
      : null;
  };

  const enrichedEvents: RecentCrmEventItem[] = rawEvents.map((row) => {
    const meta = (row.metadata && typeof row.metadata === "object" ? row.metadata : {}) as Record<string, any>;
    const operatorName = row.eventOpName || row.dealOpName || "Sistema";
    const operatorAvatar = row.eventOpAvatar || row.dealOpAvatar || null;
    const dealTitle = row.dealTitle || "Negociação sem título";
    const accountName = row.accountName || null;
    const dealValue = row.dealValue ? Number(row.dealValue) : null;

    let actionTitle = "Alteração registrada";
    let actionDescription: string | null = null;
    let badgeLabel = "Evento";
    let badgeVariant: RecentCrmEventItem["badgeVariant"] = "default";

    switch (row.eventType) {
      case "created":
        badgeLabel = "Criado";
        badgeVariant = "created";
        actionTitle = "Negociação criada";
        break;

      case "stage_changed":
      case "stage_change": {
        badgeLabel = "Etapa";
        badgeVariant = "stage";
        const toStage =
          (row.toStageId ? stageMap.get(row.toStageId) : null) ||
          meta.stageName ||
          meta.toStageName ||
          null;
        const fromStage =
          (row.fromStageId ? stageMap.get(row.fromStageId) : null) ||
          meta.fromStageName ||
          meta.oldStageName ||
          null;
        actionTitle = toStage ? `Etapa alterada para "${toStage}"` : "Etapa da negociação alterada";
        actionDescription = fromStage ? `Etapa anterior: ${fromStage}` : null;
        break;
      }

      case "pipeline_changed":
      case "pipeline_change": {
        badgeLabel = "Funil";
        badgeVariant = "pipeline";
        const toPipeline =
          (meta.toPipelineId ? pipelineMap.get(meta.toPipelineId) : null) ||
          meta.pipelineName ||
          null;
        const fromPipeline =
          (meta.fromPipelineId ? pipelineMap.get(meta.fromPipelineId) : null) ||
          null;
        actionTitle = toPipeline ? `Funil alterado para "${toPipeline}"` : "Funil da negociação alterado";
        actionDescription = fromPipeline ? `Funil anterior: ${fromPipeline}` : null;
        break;
      }

      case "note_created":
        badgeLabel = "Nota";
        badgeVariant = "note";
        actionTitle = "Anotação comercial registrada";
        if (meta.content || meta.preview || meta.note) {
          const noteText = String(meta.content || meta.preview || meta.note).trim();
          actionDescription = noteText.length > 90 ? noteText.slice(0, 90) + "..." : noteText;
        }
        break;

      case "activity_completed":
        badgeLabel = "Concluída";
        badgeVariant = "activity";
        actionTitle = meta.activityTitle
          ? `Tarefa concluída: "${meta.activityTitle}"`
          : "Tarefa comercial concluída";
        if (meta.notes) {
          actionDescription = String(meta.notes).trim();
        }
        break;

      case "activity_created":
        badgeLabel = "Tarefa";
        badgeVariant = "activity";
        actionTitle = meta.activityTitle
          ? `Tarefa agendada: "${meta.activityTitle}"`
          : "Tarefa agendada na negociação";
        break;

      case "status_changed":
      case "status_change": {
        const toSt = row.toStatus || meta.toStatus || meta.status;
        if (toSt === "won") {
          badgeLabel = "Ganho";
          badgeVariant = "won";
          actionTitle = "Negociação marcada como Ganha";
        } else if (toSt === "lost") {
          badgeLabel = "Perdido";
          badgeVariant = "lost";
          actionTitle = "Negociação marcada como Perdida";
          if (meta.lossReason || meta.reason) {
            actionDescription = `Motivo: ${meta.lossReason || meta.reason}`;
          }
        } else if (toSt === "paused") {
          badgeLabel = "Pausada";
          badgeVariant = "default";
          actionTitle = "Negociação pausada";
          if (meta.pausedReason) {
            actionDescription = `Motivo: ${meta.pausedReason}`;
          }
        } else {
          badgeLabel = "Status";
          badgeVariant = "default";
          actionTitle = `Status alterado para "${toSt || "novo status"}"`;
        }
        break;
      }

      case "value_changed":
      case "value_change": {
        badgeLabel = "Valor";
        badgeVariant = "deal";
        const formatted = formatBrl(meta.newValue);
        actionTitle = formatted ? `Valor alterado para ${formatted}` : "Valor da negociação alterado";
        break;
      }

      case "product_added":
        badgeLabel = "Produto";
        badgeVariant = "deal";
        actionTitle = `Produto adicionado: ${meta.name || "Item"}`;
        break;

      case "product_removed":
        badgeLabel = "Produto";
        badgeVariant = "deal";
        actionTitle = `Produto removido: ${meta.name || "Item"}`;
        break;

      case "proposal_created":
        badgeLabel = "Proposta";
        badgeVariant = "deal";
        actionTitle = `Proposta criada: ${meta.proposalNumber || "Nº —"}`;
        break;

      default: {
        const cleanType = (row.eventType || "evento").replace(/_/g, " ");
        badgeLabel = cleanType.charAt(0).toUpperCase() + cleanType.slice(1);
        actionTitle = `Ação registrada: ${cleanType}`;
        break;
      }
    }

    return {
      id: row.id,
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : new Date(row.createdAt).toISOString(),
      eventType: row.eventType,
      dealId: row.dealId,
      dealTitle,
      dealValue,
      accountName,
      operatorId: row.operatorId,
      operatorName,
      operatorAvatar,
      actionTitle,
      actionDescription,
      badgeLabel,
      badgeVariant,
    };
  });

  return {
    asOf: now.toISOString(),
    consultants: {
      configured: profiles.length,
      activeOnTv: profiles.filter((profile) => profile.activeOnTv).length,
      online: profiles.filter((profile) => profile.isOnline).length,
      rows: profiles,
    },
    alerts: {
      pendingTransferResponses: pendingRows[0]?.total || 0,
      overdueResponsibilities: overdueRows[0]?.total || 0,
      openDeals: openRows[0]?.total || 0,
    },
    recentCrmEvents: enrichedEvents,
    source: "local_crm",
  };
}

export async function getMaturityAnalysis(options: AnalysisOptions) {
  const now = options.now || new Date();
  const scope = await getScope(options);
  const deals = await getOpenDeals(
    options.tenantId,
    scope.consultants.map((item) => item.operatorId),
  );
  const goals = await db
    .select({
      operatorId: commercialGoals.operatorId,
      targetValue: commercialGoals.targetValue,
      conversionRate: commercialGoals.conversionRate,
    })
    .from(commercialGoals)
    .where(
      and(
        eq(commercialGoals.tenantId, options.tenantId),
        eq(commercialGoals.month, saoPauloDay(now).slice(0, 7)),
      ),
    );
  const goalMap = new Map(goals.map((goal) => [goal.operatorId, goal]));
  const rows = scope.consultants.map((consultant) => {
    const own = deals.filter(
      (deal) =>
        deal.operatorId === consultant.operatorId && !scope.excludedStageIds.has(deal.stageId),
    );
    const maturity = scope.rules.map((rule, index) => ({
      tier: index + 1,
      days: rule.days,
      maxValue: rule.maxValue,
      count: 0,
      value: 0,
    }));
    const forecast = scope.rules.map((rule, index) => ({
      tier: index + 1,
      days: rule.days,
      count: 0,
      value: 0,
    }));
    const immature = { count: 0, value: 0 };
    const unclassified = { count: 0, value: 0 };
    for (const deal of own) {
      const value = Number(deal.value || 0);
      const result = classifyMaturity(value, deal.createdAt, now, scope.rules);
      if (!result) {
        unclassified.count += 1;
        unclassified.value += value;
        continue;
      }
      const forecastIndex =
        forecastTier(
          result.daysRemaining,
          scope.rules.map((rule) => rule.days),
        ) - 1;
      forecast[forecastIndex].count += 1;
      forecast[forecastIndex].value += value;
      if (result.isMature) {
        maturity[result.tierIndex - 1].count += 1;
        maturity[result.tierIndex - 1].value += value;
      } else {
        immature.count += 1;
        immature.value += value;
      }
    }
    const targetValue = Number(goalMap.get(consultant.operatorId)?.targetValue || 0);
    const conversionRate = Number(goalMap.get(consultant.operatorId)?.conversionRate ?? 10);
    const matureValue = maturity.reduce((sum, tier) => sum + tier.value, 0);
    const forecastValue = forecast.reduce((sum, tier) => sum + tier.value, 0);
    return {
      ...consultant,
      targetValue,
      conversionRate,
      maturity,
      forecast,
      immature,
      unclassified,
      matureValue,
      forecastValue,
      maturePromisedValue: (matureValue * conversionRate) / 100,
      forecastPromisedValue: (forecastValue * conversionRate) / 100,
      maturityCoveragePercent: targetValue > 0 ? (matureValue / targetValue) * 100 : null,
      forecastCoveragePercent: targetValue > 0 ? (forecastValue / targetValue) * 100 : null,
    };
  });
  return { rules: scope.rules, rows, asOf: now.toISOString() };
}

export async function getResponsibilityAnalysis(options: AnalysisOptions & { month: string }) {
  const today = saoPauloDay(options.now || new Date());
  const { start, nextStart } = monthWindow(options.month);
  const consultants = await db
    .select({
      operatorId: operators.id,
      name: operators.name,
      avatar: operators.avatar,
      division: commercialConsultantProfiles.division,
    })
    .from(commercialConsultantProfiles)
    .innerJoin(
      operators,
      and(
        eq(operators.id, commercialConsultantProfiles.operatorId),
        eq(operators.tenantId, options.tenantId),
      ),
    )
    .where(
      and(
        eq(commercialConsultantProfiles.tenantId, options.tenantId),
        options.division ? eq(commercialConsultantProfiles.division, options.division) : undefined,
      ),
    );
  const consultantMap = new Map(consultants.map((item) => [item.operatorId, item]));
  const rows = await db
    .select({
      id: commercialDirectives.id,
      dealId: commercialDirectives.dealId,
      operatorId: commercialDirectives.assignedToOperatorId,
      assignedDate: commercialDirectives.assignedDate,
      status: commercialDirectives.status,
      instruction: commercialDirectives.instruction,
      completionNote: commercialDirectives.completionNote,
      snapshot: commercialDirectives.snapshot,
      completedAt: commercialDirectives.completedAt,
      dealTitle: crmDeals.title,
      dealValue: crmDeals.value,
      dealStatus: crmDeals.status,
      accountName: crmAccounts.name,
      accountPhone: crmAccounts.phone,
    })
    .from(commercialDirectives)
    .innerJoin(
      crmDeals,
      and(eq(crmDeals.id, commercialDirectives.dealId), eq(crmDeals.tenantId, options.tenantId)),
    )
    .leftJoin(
      crmAccounts,
      and(eq(crmAccounts.id, crmDeals.accountId), eq(crmAccounts.tenantId, options.tenantId)),
    )
    .where(
      and(
        eq(commercialDirectives.tenantId, options.tenantId),
        gte(commercialDirectives.assignedDate, start),
        lt(commercialDirectives.assignedDate, nextStart),
      ),
    )
    .orderBy(desc(commercialDirectives.assignedDate), desc(commercialDirectives.createdAt));
  const actions = rows
    .filter((row) => row.operatorId && consultantMap.has(row.operatorId))
    .map((row) => {
      const consultant = consultantMap.get(row.operatorId!)!;
      const state = directiveState(row.status, row.assignedDate, today);
      const value = row.snapshot?.dealValue ?? Number(row.dealValue || 0);
      return {
        id: row.id,
        dealId: row.dealId,
        dealTitle: row.snapshot?.dealTitle || row.dealTitle,
        dealValue: value,
        stageName: row.snapshot?.stageName || null,
        accountName: row.accountName,
        accountPhone: row.accountPhone,
        operatorId: consultant.operatorId,
        operatorName: consultant.name,
        division: consultant.division,
        assignedDate: row.assignedDate,
        status: row.status,
        state,
        instruction: row.instruction,
        completionNote: row.completionNote,
        completedAt: row.completedAt,
        dealStatus: row.dealStatus,
        daysOverdue:
          state === "overdue"
            ? Math.max(
                0,
                Math.round(
                  (Date.parse(`${today}T12:00:00Z`) - Date.parse(`${row.assignedDate}T12:00:00Z`)) /
                    86_400_000,
                ),
              )
            : 0,
      };
    });
  const summarize = (items: typeof actions) => ({
    totalCount: items.length,
    totalValue: items.reduce((sum, item) => sum + item.dealValue, 0),
    completedCount: items.filter((item) => item.state === "completed").length,
    pendingTodayCount: items.filter((item) => item.state === "pending_today").length,
    overdueCount: items.filter((item) => item.state === "overdue").length,
    executionRatePercent: items.length
      ? (items.filter((item) => item.state === "completed").length / items.length) * 100
      : 0,
  });
  return {
    month: options.month,
    today,
    summary: summarize(actions),
    consultants: consultants.map((consultant) => ({
      ...consultant,
      ...summarize(actions.filter((item) => item.operatorId === consultant.operatorId)),
    })),
    overdueQueue: actions
      .filter((item) => item.state === "overdue")
      .sort((a, b) => b.daysOverdue - a.daysOverdue || b.dealValue - a.dealValue),
    actions,
  };
}

export async function getTmaAnalysis(options: AnalysisOptions & { month: string }) {
  const now = options.now || new Date();
  const today = saoPauloDay(now);
  const { start } = monthWindow(options.month);
  const scope = await getScope(options);
  const ids = scope.consultants.map((item) => item.operatorId);
  if (!ids.length)
    return {
      month: options.month,
      today,
      bucketsMinutes: scope.slaBuckets,
      slaLimitMinutes: scope.slaLimitMinutes,
      summary: {
        answeredCount: 0,
        pendingCount: 0,
        averageSeconds: null,
        withinSlaPercent: null,
        buckets: [0, 0, 0, 0],
      },
      todaySummary: {
        answeredCount: 0,
        averageSeconds: null,
        withinSlaPercent: null,
        buckets: [0, 0, 0, 0],
      },
      consultants: [],
      waitingQueue: [],
    };
  const events = await db
    .select({
      id: commercialTransferResponseEvents.id,
      conversationId: commercialTransferResponseEvents.conversationId,
      operatorId: commercialTransferResponseEvents.operatorId,
      transferredAt: commercialTransferResponseEvents.transferredAt,
      firstRespondedAt: commercialTransferResponseEvents.firstRespondedAt,
      durationSeconds: commercialTransferResponseEvents.durationSeconds,
      status: commercialTransferResponseEvents.status,
      contactName: contacts.name,
      contactPhone: contacts.phone,
    })
    .from(commercialTransferResponseEvents)
    .innerJoin(
      conversations,
      and(
        eq(conversations.id, commercialTransferResponseEvents.conversationId),
        eq(conversations.tenantId, options.tenantId),
      ),
    )
    .innerJoin(
      contacts,
      and(eq(contacts.id, conversations.contactId), eq(contacts.tenantId, options.tenantId)),
    )
    .where(
      and(
        eq(commercialTransferResponseEvents.tenantId, options.tenantId),
        inArray(commercialTransferResponseEvents.operatorId, ids),
        or(
          eq(commercialTransferResponseEvents.status, "pending"),
          gte(commercialTransferResponseEvents.transferredAt, new Date(`${start}T00:00:00Z`)),
        ),
      ),
    );
  const answered = events.filter(
    (event) =>
      event.status === "responded" &&
      event.durationSeconds !== null &&
      saoPauloDay(event.transferredAt).slice(0, 7) === options.month,
  );
  const answeredToday = answered.filter((event) => saoPauloDay(event.transferredAt) === today);
  const pending = events.filter((event) => event.status === "pending");
  const buckets = (items: typeof answered) => {
    const counts = Array.from({ length: scope.slaBuckets.length + 1 }, () => 0);
    for (const event of items)
      counts[tmaBucket(Number(event.durationSeconds), scope.slaBuckets)] += 1;
    return counts;
  };
  const summary = {
    answeredCount: answered.length,
    pendingCount: pending.length,
    averageSeconds: answered.length
      ? answered.reduce((sum, event) => sum + Number(event.durationSeconds), 0) / answered.length
      : null,
    withinSlaPercent: answered.length
      ? (answered.filter((event) => Number(event.durationSeconds) <= scope.slaLimitMinutes * 60)
          .length /
          answered.length) *
        100
      : null,
    buckets: buckets(answered),
  };
  const todaySummary = {
    answeredCount: answeredToday.length,
    averageSeconds: answeredToday.length
      ? answeredToday.reduce((sum, event) => sum + Number(event.durationSeconds), 0) /
        answeredToday.length
      : null,
    withinSlaPercent: answeredToday.length
      ? (answeredToday.filter(
          (event) => Number(event.durationSeconds) <= scope.slaLimitMinutes * 60,
        ).length /
          answeredToday.length) *
        100
      : null,
    buckets: buckets(answeredToday),
  };
  const consultants = scope.consultants
    .map((consultant) => {
      const own = answered.filter((event) => event.operatorId === consultant.operatorId);
      const fastest = [...own].sort(
        (a, b) => Number(a.durationSeconds) - Number(b.durationSeconds),
      )[0];
      const slowest = [...own].sort(
        (a, b) => Number(b.durationSeconds) - Number(a.durationSeconds),
      )[0];
      return {
        ...consultant,
        answeredCount: own.length,
        pendingCount: pending.filter((event) => event.operatorId === consultant.operatorId).length,
        averageSeconds: own.length
          ? own.reduce((sum, event) => sum + Number(event.durationSeconds), 0) / own.length
          : null,
        withinSlaPercent: own.length
          ? (own.filter((event) => Number(event.durationSeconds) <= scope.slaLimitMinutes * 60)
              .length /
              own.length) *
            100
          : null,
        buckets: buckets(own),
        bestSeconds: fastest?.durationSeconds ?? null,
        bestContactName: fastest?.contactName || fastest?.contactPhone || null,
        worstSeconds: slowest?.durationSeconds ?? null,
        worstContactName: slowest?.contactName || slowest?.contactPhone || null,
      };
    })
    .sort((a, b) => (a.averageSeconds ?? Infinity) - (b.averageSeconds ?? Infinity));
  const waitingQueue = pending
    .map((event) => ({
      id: event.id,
      conversationId: event.conversationId,
      operatorId: event.operatorId,
      contactName: event.contactName,
      contactPhone: event.contactPhone,
      transferredAt: event.transferredAt,
      waitingSeconds: Math.max(
        0,
        Math.floor((now.getTime() - event.transferredAt.getTime()) / 1000),
      ),
    }))
    .sort((a, b) => b.waitingSeconds - a.waitingSeconds);
  return {
    month: options.month,
    today,
    bucketsMinutes: scope.slaBuckets,
    slaLimitMinutes: scope.slaLimitMinutes,
    summary,
    todaySummary,
    consultants,
    waitingQueue,
  };
}

export async function getLossAnalysis(options: AnalysisOptions & { month: string }) {
  const scope = await getScope(options);
  const ids = scope.consultants.map((item) => item.operatorId);
  const { previousMonth } = monthWindow(options.month);
  if (!ids.length)
    return {
      month: options.month,
      periods: [options.month, previousMonth, "all"].map((period) => ({
        period,
        count: 0,
        value: 0,
        reasons: [],
        categories: [],
      })),
      monthlyTrend: [],
      firstMonth: null,
      monthsCount: 0,
      monthlyAverageCount: 0,
    };
  const monthExpr = sql<string>`to_char((${crmDeals.closedAt} AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM')`;
  const rows = await db
    .select({
      month: monthExpr,
      reason: crmDeals.lossReason,
      count: count(),
      value: sql<number>`coalesce(sum(${crmDeals.value}), 0)::float`,
    })
    .from(crmDeals)
    .where(
      and(
        eq(crmDeals.tenantId, options.tenantId),
        eq(crmDeals.status, "lost"),
        sql`${crmDeals.closedAt} IS NOT NULL`,
        inArray(crmDeals.operatorId, ids),
      ),
    )
    .groupBy(monthExpr, crmDeals.lossReason);
  const categoryByReason = new Map<string, string>();
  for (const category of scope.lossReasonCategories) {
    for (const reason of category.reasons)
      categoryByReason.set(reason.trim().toLocaleLowerCase("pt-BR"), category.name);
  }
  const periods = [options.month, previousMonth, "all"].map((period) => {
    const selected = period === "all" ? rows : rows.filter((row) => row.month === period);
    const countTotal = selected.reduce((sum, item) => sum + Number(item.count), 0);
    const valueTotal = selected.reduce((sum, item) => sum + Number(item.value), 0);
    const reasons = new Map<string, { count: number; value: number }>();
    const categories = new Map<
      string,
      { count: number; value: number; subreasons: Map<string, { count: number; value: number }> }
    >();
    for (const row of selected) {
      const name = row.reason?.trim() || "Motivo não informado";
      const categoryName = categoryByReason.get(name.toLocaleLowerCase("pt-BR")) || "Sem categoria";
      const item = reasons.get(name) || { count: 0, value: 0 };
      item.count += Number(row.count);
      item.value += Number(row.value);
      reasons.set(name, item);
      const category = categories.get(categoryName) || {
        count: 0,
        value: 0,
        subreasons: new Map(),
      };
      category.count += Number(row.count);
      category.value += Number(row.value);
      const subreason = category.subreasons.get(name) || { count: 0, value: 0 };
      subreason.count += Number(row.count);
      subreason.value += Number(row.value);
      category.subreasons.set(name, subreason);
      categories.set(categoryName, category);
    }
    return {
      period,
      count: countTotal,
      value: valueTotal,
      reasons: [...reasons]
        .map(([name, values]) => ({
          name,
          ...values,
          percent: countTotal ? (values.count / countTotal) * 100 : 0,
        }))
        .sort((a, b) => b.count - a.count),
      categories: [...categories]
        .map(([name, values]) => ({
          name,
          count: values.count,
          value: values.value,
          percent: countTotal ? (values.count / countTotal) * 100 : 0,
          subreasons: [...values.subreasons]
            .map(([reason, sub]) => ({ reason, ...sub }))
            .sort((a, b) => b.count - a.count),
        }))
        .sort((a, b) => b.count - a.count),
    };
  });
  const trend = new Map<string, { count: number; value: number }>();
  for (const row of rows) {
    const item = trend.get(row.month) || { count: 0, value: 0 };
    item.count += Number(row.count);
    item.value += Number(row.value);
    trend.set(row.month, item);
  }
  const monthlyTrend = [...trend]
    .map(([month, values]) => ({ month, ...values }))
    .sort((a, b) => a.month.localeCompare(b.month));
  return {
    month: options.month,
    periods,
    monthlyTrend,
    firstMonth: monthlyTrend[0]?.month || null,
    monthsCount: monthlyTrend.length,
    monthlyAverageCount: monthlyTrend.length ? periods[2].count / monthlyTrend.length : 0,
  };
}

export async function getCohortAnalysis(options: AnalysisOptions) {
  const now = options.now || new Date();
  const currentMonth = saoPauloDay(now).slice(0, 7);
  const months = lastSixMonths(currentMonth);
  const scope = await getScope(options);
  const ids = scope.consultants.map((item) => item.operatorId);
  if (!ids.length)
    return {
      months: months.map((month) => ({
        month,
        classifiedCount: 0,
        unclassifiedCount: 0,
        totalValue: 0,
        tiers: scope.rules.map((rule, index) => ({
          tier: index + 1,
          days: rule.days,
          count: 0,
          value: 0,
        })),
      })),
      rules: scope.rules,
    };
  const deals = await db
    .select({
      id: crmDeals.id,
      value: crmDeals.value,
      createdAt: crmDeals.createdAt,
      operatorId: crmDeals.operatorId,
    })
    .from(crmDeals)
    .where(
      and(
        eq(crmDeals.tenantId, options.tenantId),
        inArray(crmDeals.operatorId, ids),
        gte(crmDeals.createdAt, new Date(`${months[0]}-01T00:00:00Z`)),
      ),
    );
  const series = months.map((month) => ({
    month,
    classifiedCount: 0,
    unclassifiedCount: 0,
    totalValue: 0,
    tiers: scope.rules.map((rule, index) => ({
      tier: index + 1,
      days: rule.days,
      count: 0,
      value: 0,
    })),
  }));
  const byMonth = new Map(series.map((item) => [item.month, item]));
  for (const deal of deals) {
    const row = byMonth.get(saoPauloDay(deal.createdAt).slice(0, 7));
    if (!row) continue;
    const value = Number(deal.value || 0);
    const result = classifyMaturity(value, deal.createdAt, now, scope.rules);
    if (!result) {
      row.unclassifiedCount += 1;
      continue;
    }
    row.classifiedCount += 1;
    row.totalValue += value;
    row.tiers[result.tierIndex - 1].count += 1;
    row.tiers[result.tierIndex - 1].value += value;
  }
  return { months: series, rules: scope.rules };
}

export async function getGoalAnalysis(options: AnalysisOptions & { month: string }) {
  const now = options.now || new Date();
  const today = saoPauloDay(now);
  const { start, nextStart } = monthWindow(options.month);
  const scope = await getScope(options);
  const ids = scope.consultants.map((item) => item.operatorId);
  const [goals, days, won] = await Promise.all([
    db
      .select({
        operatorId: commercialGoals.operatorId,
        targetValue: commercialGoals.targetValue,
        conversionRate: commercialGoals.conversionRate,
      })
      .from(commercialGoals)
      .where(
        and(
          eq(commercialGoals.tenantId, options.tenantId),
          eq(commercialGoals.month, options.month),
        ),
      ),
    db
      .select({
        date: commercialCalendarDays.date,
        type: commercialCalendarDays.type,
        affectsGoal: commercialCalendarDays.affectsGoal,
      })
      .from(commercialCalendarDays)
      .where(
        and(
          eq(commercialCalendarDays.tenantId, options.tenantId),
          gte(commercialCalendarDays.date, start),
          lt(commercialCalendarDays.date, nextStart),
        ),
      ),
    ids.length
      ? db
          .select({
            id: crmDeals.id,
            value: crmDeals.value,
            closedAt: crmDeals.closedAt,
            operatorId: crmDeals.operatorId,
          })
          .from(crmDeals)
          .where(
            and(
              eq(crmDeals.tenantId, options.tenantId),
              eq(crmDeals.status, "won"),
              inArray(crmDeals.operatorId, ids),
              gte(crmDeals.closedAt, new Date(`${start}T00:00:00Z`)),
              lt(crmDeals.closedAt, new Date(`${nextStart}T03:00:00Z`)),
            ),
          )
      : Promise.resolve([]),
  ]);
  const goalMap = new Map(goals.map((item) => [item.operatorId, item]));
  const byOperator = new Map<string, Map<string, { count: number; value: number }>>();
  const allDays = new Map<string, { count: number; value: number }>();
  for (const deal of won) {
    if (!deal.operatorId || !deal.closedAt) continue;
    const date = saoPauloDay(deal.closedAt);
    if (!date.startsWith(options.month)) continue;
    const own = byOperator.get(deal.operatorId) || new Map();
    const value = Number(deal.value || 0);
    const current = own.get(date) || { count: 0, value: 0 };
    own.set(date, { count: current.count + 1, value: current.value + value });
    byOperator.set(deal.operatorId, own);
    const total = allDays.get(date) || { count: 0, value: 0 };
    allDays.set(date, { count: total.count + 1, value: total.value + value });
  }
  const calendar = days as CommercialCalendarDay[];
  const consultants = scope.consultants.map((consultant) => {
    const goal = goalMap.get(consultant.operatorId);
    return {
      ...consultant,
      targetValue: Number(goal?.targetValue || 0),
      conversionRate: Number(goal?.conversionRate ?? 10),
      ...buildGoalCurve(
        options.month,
        today,
        Number(goal?.targetValue || 0),
        byOperator.get(consultant.operatorId) || new Map(),
        calendar,
      ),
    };
  });
  const targetValue = consultants.reduce((sum, consultant) => sum + consultant.targetValue, 0);
  return {
    month: options.month,
    today,
    total: { targetValue, ...buildGoalCurve(options.month, today, targetValue, allDays, calendar) },
    consultants,
  };
}

export async function getDealDrilldown(
  options: AnalysisOptions & {
    mode: "pipeline" | "maturity" | "forecast";
    operatorId?: string;
    stageId?: string;
    tier?: number;
    search?: string;
    page: number;
    limit: number;
  },
) {
  const now = options.now || new Date();
  const today = saoPauloDay(now);
  const scope = await getScope(options);
  const ids = scope.consultants.map((item) => item.operatorId);
  const consultantById = new Map(scope.consultants.map((item) => [item.operatorId, item]));
  if (options.operatorId && !ids.includes(options.operatorId))
    return { error: "Consultor fora do escopo comercial.", status: 404 };
  if (options.mode !== "pipeline" && !options.operatorId)
    return { error: "Selecione um consultor para este detalhamento.", status: 400 };
  const deals = await getOpenDeals(
    options.tenantId,
    options.operatorId ? [options.operatorId] : ids,
  );
  const accountIds = [
    ...new Set(deals.map((deal) => deal.accountId).filter((id): id is string => !!id)),
  ];
  const accounts = accountIds.length
    ? await db
        .select({ id: crmAccounts.id, name: crmAccounts.name, phone: crmAccounts.phone })
        .from(crmAccounts)
        .where(and(eq(crmAccounts.tenantId, options.tenantId), inArray(crmAccounts.id, accountIds)))
    : [];
  const accountMap = new Map(accounts.map((account) => [account.id, account]));
  const search = options.search?.trim().toLocaleLowerCase("pt-BR") || "";
  const contactMatches = new Set<string>();
  if (search && deals.length) {
    const matches = await db
      .selectDistinct({ dealId: crmDealContacts.dealId })
      .from(crmDealContacts)
      .innerJoin(
        contacts,
        and(eq(contacts.id, crmDealContacts.contactId), eq(contacts.tenantId, options.tenantId)),
      )
      .where(
        and(
          eq(crmDealContacts.tenantId, options.tenantId),
          inArray(
            crmDealContacts.dealId,
            deals.map((deal) => deal.id),
          ),
          or(ilike(contacts.name, `%${search}%`), ilike(contacts.phone, `%${search}%`)),
        ),
      );
    for (const match of matches) contactMatches.add(match.dealId);
  }
  const filtered = deals
    .flatMap((deal) => {
      if (options.stageId && deal.stageId !== options.stageId) return [];
      if (
        options.mode === "pipeline" &&
        !options.includeHidden &&
        !belongsToTeamPipeline(
          scope.pipelineByDivision,
          consultantById.get(deal.operatorId || "")?.division,
          deal.pipelineId,
        )
      )
        return [];
      if (scope.excludedStageIds.has(deal.stageId)) return [];
      const maturity = classifyMaturity(Number(deal.value || 0), deal.createdAt, now, scope.rules);
      if (options.mode === "maturity") {
        if (!maturity) return [];
        if (options.tier === -1 ? maturity.isMature : !maturity.isMature) return [];
        if (options.tier && options.tier > 0 && maturity?.tierIndex !== options.tier) return [];
      }
      if (options.mode === "forecast") {
        if (!maturity) return [];
        if (
          options.tier &&
          forecastTier(
            maturity.daysRemaining,
            scope.rules.map((rule) => rule.days),
          ) !== options.tier
        )
          return [];
      }
      const account = deal.accountId ? accountMap.get(deal.accountId) : null;
      const stage = scope.stageMap.get(deal.stageId);
      if (
        search &&
        !contactMatches.has(deal.id) &&
        ![deal.title, deal.id, account?.name, account?.phone, stage?.name].some((text) =>
          text?.toLocaleLowerCase("pt-BR").includes(search),
        )
      )
        return [];
      return [
        {
          id: deal.id,
          title: deal.title,
          value: Number(deal.value || 0),
          operatorId: deal.operatorId,
          accountName: account?.name || null,
          accountPhone: account?.phone || null,
          stageId: deal.stageId,
          stageName: stage?.name || "Etapa",
          pipelineId: deal.pipelineId,
          createdAt: deal.createdAt,
          expectedCloseDate: deal.expectedCloseDate,
          ageDays: maturity?.ageDays ?? null,
          maturityTier: maturity?.tierIndex ?? null,
          maturityDays: maturity?.tierDays ?? null,
          daysRemaining: maturity?.daysRemaining ?? null,
          forecastTier: maturity
            ? forecastTier(
                maturity.daysRemaining,
                scope.rules.map((rule) => rule.days),
              )
            : null,
        },
      ];
    })
    .sort((a, b) => b.value - a.value || a.id.localeCompare(b.id));
  const total = filtered.length;
  const page = filtered.slice((options.page - 1) * options.limit, options.page * options.limit);
  const pageIds = page.map((deal) => deal.id);
  const [directiveRows, contactRows] = await Promise.all([
    pageIds.length
      ? db
          .select({
            dealId: commercialDirectives.dealId,
            id: commercialDirectives.id,
            assignedDate: commercialDirectives.assignedDate,
            status: commercialDirectives.status,
          })
          .from(commercialDirectives)
          .where(
            and(
              eq(commercialDirectives.tenantId, options.tenantId),
              inArray(commercialDirectives.dealId, pageIds),
            ),
          )
          .orderBy(desc(commercialDirectives.assignedDate), desc(commercialDirectives.createdAt))
      : Promise.resolve([]),
    pageIds.length
      ? db
          .select({
            dealId: crmDealContacts.dealId,
            name: contacts.name,
            phone: contacts.phone,
            isPrimary: crmDealContacts.isPrimary,
          })
          .from(crmDealContacts)
          .innerJoin(
            contacts,
            and(
              eq(contacts.id, crmDealContacts.contactId),
              eq(contacts.tenantId, options.tenantId),
            ),
          )
          .where(
            and(
              eq(crmDealContacts.tenantId, options.tenantId),
              inArray(crmDealContacts.dealId, pageIds),
            ),
          )
      : Promise.resolve([]),
  ]);
  const latestDirective = new Map<string, (typeof directiveRows)[number]>();
  for (const directive of directiveRows)
    if (!latestDirective.has(directive.dealId)) latestDirective.set(directive.dealId, directive);
  const contactMap = new Map<string, (typeof contactRows)[number]>();
  for (const contact of contactRows)
    if (!contactMap.has(contact.dealId) || contact.isPrimary)
      contactMap.set(contact.dealId, contact);
  return {
    mode: options.mode,
    today,
    total,
    page: options.page,
    limit: options.limit,
    deals: page.map((deal) => {
      const directive = latestDirective.get(deal.id);
      const state = directive
        ? directiveState(directive.status, directive.assignedDate, today)
        : null;
      const contact = contactMap.get(deal.id);
      return {
        ...deal,
        contactName: contact?.name || null,
        contactPhone: contact?.phone || null,
        directive: directive
          ? {
              id: directive.id,
              assignedDate: directive.assignedDate,
              status: directive.status,
              state,
            }
          : null,
        canPointToday:
          deal.value > 0 &&
          !scope.excludedStageIds.has(deal.stageId) &&
          directive?.assignedDate !== today,
      };
    }),
  };
}

export async function getLossDealDrilldown(
  options: AnalysisOptions & {
    month: string;
    period: "current" | "previous" | "all";
    reason?: string;
    page: number;
    limit: number;
  },
) {
  const scope = await getScope(options);
  const ids = scope.consultants.map((item) => item.operatorId);
  if (!ids.length) return { total: 0, page: options.page, limit: options.limit, deals: [] };
  const periodMonth =
    options.period === "previous" ? monthWindow(options.month).previousMonth : options.month;
  const { start, nextStart } = monthWindow(periodMonth);
  const filter = and(
    eq(crmDeals.tenantId, options.tenantId),
    eq(crmDeals.status, "lost"),
    sql`${crmDeals.closedAt} IS NOT NULL`,
    inArray(crmDeals.operatorId, ids),
    options.period === "all" ? undefined : gte(crmDeals.closedAt, new Date(`${start}T03:00:00Z`)),
    options.period === "all"
      ? undefined
      : lt(crmDeals.closedAt, new Date(`${nextStart}T03:00:00Z`)),
    options.reason === "Motivo não informado"
      ? sql`(${crmDeals.lossReason} IS NULL OR trim(${crmDeals.lossReason}) = '')`
      : options.reason
        ? eq(crmDeals.lossReason, options.reason)
        : undefined,
  );
  const [totalRows, deals] = await Promise.all([
    db.select({ total: count() }).from(crmDeals).where(filter),
    db
      .select({
        id: crmDeals.id,
        title: crmDeals.title,
        value: crmDeals.value,
        reason: crmDeals.lossReason,
        closedAt: crmDeals.closedAt,
        operatorId: crmDeals.operatorId,
        accountName: crmAccounts.name,
      })
      .from(crmDeals)
      .leftJoin(
        crmAccounts,
        and(eq(crmAccounts.id, crmDeals.accountId), eq(crmAccounts.tenantId, options.tenantId)),
      )
      .where(filter)
      .orderBy(desc(crmDeals.closedAt), desc(crmDeals.id))
      .limit(options.limit)
      .offset((options.page - 1) * options.limit),
  ]);
  return {
    total: totalRows[0]?.total || 0,
    page: options.page,
    limit: options.limit,
    deals: deals.map((deal) => ({ ...deal, value: Number(deal.value || 0) })),
  };
}

export async function getCohortDealDrilldown(
  options: AnalysisOptions & {
    month: string;
    unclassifiedOnly: boolean;
    search?: string;
    page: number;
    limit: number;
  },
) {
  const scope = await getScope(options);
  const ids = scope.consultants.map((item) => item.operatorId);
  if (!ids.length) return { total: 0, page: options.page, limit: options.limit, deals: [] };
  const { start, nextStart } = monthWindow(options.month);
  const filter = and(
    eq(crmDeals.tenantId, options.tenantId),
    inArray(crmDeals.operatorId, ids),
    gte(crmDeals.createdAt, new Date(`${start}T03:00:00Z`)),
    lt(crmDeals.createdAt, new Date(`${nextStart}T03:00:00Z`)),
    options.unclassifiedOnly
      ? or(sql`${crmDeals.value} IS NULL`, lte(crmDeals.value, "0"))
      : undefined,
    options.search ? ilike(crmDeals.title, `%${options.search}%`) : undefined,
  );
  const [totalRows, deals] = await Promise.all([
    db.select({ total: count() }).from(crmDeals).where(filter),
    db
      .select({
        id: crmDeals.id,
        title: crmDeals.title,
        value: crmDeals.value,
        createdAt: crmDeals.createdAt,
        status: crmDeals.status,
        operatorId: crmDeals.operatorId,
        stageId: crmDeals.stageId,
        accountName: crmAccounts.name,
        operatorName: operators.name,
        operatorAvatar: operators.avatar,
        stageName: crmStages.name,
        pipelineName: crmPipelines.name,
        division: commercialConsultantProfiles.division,
      })
      .from(crmDeals)
      .leftJoin(
        crmAccounts,
        and(eq(crmAccounts.id, crmDeals.accountId), eq(crmAccounts.tenantId, options.tenantId)),
      )
      .leftJoin(
        operators,
        and(eq(operators.id, crmDeals.operatorId), eq(operators.tenantId, options.tenantId)),
      )
      .leftJoin(
        commercialConsultantProfiles,
        and(
          eq(commercialConsultantProfiles.operatorId, crmDeals.operatorId),
          eq(commercialConsultantProfiles.tenantId, options.tenantId),
        ),
      )
      .innerJoin(
        crmStages,
        and(eq(crmStages.id, crmDeals.stageId), eq(crmStages.tenantId, options.tenantId)),
      )
      .innerJoin(
        crmPipelines,
        and(eq(crmPipelines.id, crmDeals.pipelineId), eq(crmPipelines.tenantId, options.tenantId)),
      )
      .where(filter)
      .orderBy(desc(crmDeals.createdAt), desc(crmDeals.id))
      .limit(options.limit)
      .offset((options.page - 1) * options.limit),
  ]);
  return {
    total: totalRows[0]?.total || 0,
    page: options.page,
    limit: options.limit,
    deals: deals.map((deal) => ({ ...deal, value: Number(deal.value || 0) })),
  };
}

export async function getTmaEventDrilldown(
  options: AnalysisOptions & {
    month: string;
    operatorId?: string;
    bucket?: number;
    page: number;
    limit: number;
  },
) {
  const scope = await getScope(options);
  const ids = scope.consultants.map((item) => item.operatorId);
  if (options.operatorId && !ids.includes(options.operatorId))
    return { error: "Consultor fora do escopo comercial.", status: 404 };
  if (!ids.length) return { total: 0, page: options.page, limit: options.limit, events: [] };
  const { start, nextStart } = monthWindow(options.month);
  const boundaries = scope.slaBuckets.map((minute) => minute * 60);
  const bucketFilter =
    options.bucket === undefined
      ? undefined
      : options.bucket === 0
        ? lte(commercialTransferResponseEvents.durationSeconds, boundaries[0])
        : options.bucket === boundaries.length
          ? gt(commercialTransferResponseEvents.durationSeconds, boundaries[boundaries.length - 1])
          : and(
              gt(commercialTransferResponseEvents.durationSeconds, boundaries[options.bucket - 1]),
              lte(commercialTransferResponseEvents.durationSeconds, boundaries[options.bucket]),
            );
  const filter = and(
    eq(commercialTransferResponseEvents.tenantId, options.tenantId),
    eq(commercialTransferResponseEvents.status, "responded"),
    inArray(
      commercialTransferResponseEvents.operatorId,
      options.operatorId ? [options.operatorId] : ids,
    ),
    gte(commercialTransferResponseEvents.transferredAt, new Date(`${start}T03:00:00Z`)),
    lt(commercialTransferResponseEvents.transferredAt, new Date(`${nextStart}T03:00:00Z`)),
    bucketFilter,
  );
  const [totalRows, events] = await Promise.all([
    db.select({ total: count() }).from(commercialTransferResponseEvents).where(filter),
    db
      .select({
        id: commercialTransferResponseEvents.id,
        conversationId: commercialTransferResponseEvents.conversationId,
        operatorId: commercialTransferResponseEvents.operatorId,
        transferredAt: commercialTransferResponseEvents.transferredAt,
        firstRespondedAt: commercialTransferResponseEvents.firstRespondedAt,
        durationSeconds: commercialTransferResponseEvents.durationSeconds,
        contactName: contacts.name,
        contactPhone: contacts.phone,
      })
      .from(commercialTransferResponseEvents)
      .innerJoin(
        conversations,
        and(
          eq(conversations.id, commercialTransferResponseEvents.conversationId),
          eq(conversations.tenantId, options.tenantId),
        ),
      )
      .innerJoin(
        contacts,
        and(eq(contacts.id, conversations.contactId), eq(contacts.tenantId, options.tenantId)),
      )
      .where(filter)
      .orderBy(
        desc(commercialTransferResponseEvents.transferredAt),
        desc(commercialTransferResponseEvents.id),
      )
      .limit(options.limit)
      .offset((options.page - 1) * options.limit),
  ]);
  return {
    total: totalRows[0]?.total || 0,
    page: options.page,
    limit: options.limit,
    bucketsMinutes: scope.slaBuckets,
    events,
  };
}
