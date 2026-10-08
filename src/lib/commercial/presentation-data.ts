import type {
  DiretrizesConsultantRow,
  DiretrizesKpis,
  DiretrizesTeamGroup,
  DiretrizDealDetail,
} from "./diretrizes-crm-data";
import type {
  TmaConsultantRow,
  TmaKpis,
  TmaTeamGroup,
  TmaWaitingChatItem,
} from "./tma-whatsapp-data";
import type { RankingOperatorRow } from "./ranking-data";
import type { PipelineStageDef, SellerPipelineRow, TeamPipelineData } from "./pipeline-data";
import type { DeparaDealItem, DeparaTierKey, SellerDeparaRow, TeamDeparaData } from "./depara-data";
import { formatDeparaCurrency } from "./depara-data";
import type {
  PrevistasDealItem,
  PrevistasTierKey,
  SellerPrevistasRow,
  TeamPrevistasData,
} from "./previstas-data";
import type {
  PacingDealItem,
  PacingGlobalKpis,
  PacingSellerRow,
  TeamPacingData,
} from "./pacing-data";
import type { PerdasCategory, PerdasPeriodData, PerdasPeriodKey } from "./perdas-data";
import type { TVCohortsResponse, TVCohortTierConfig } from "./safras-cohorts-data";
import type { getCohortAnalysis, getGoalAnalysis, getLossAnalysis } from "./analysis-service";
import type {
  getPipelineAnalysis,
  getResponsibilityAnalysis,
  getTmaAnalysis,
} from "./analysis-service";
import { teamStages, type PipelineDivision } from "./pipeline-scope";
import { buildConsultantAvatarResolver } from "./avatar-matcher";

type ResponsibilityAnalysis = Awaited<ReturnType<typeof getResponsibilityAnalysis>>;
type TmaAnalysis = Awaited<ReturnType<typeof getTmaAnalysis>>;
type PipelineAnalysis = Awaited<ReturnType<typeof getPipelineAnalysis>>;
type GoalAnalysis = Awaited<ReturnType<typeof getGoalAnalysis>>;
type LossAnalysis = Awaited<ReturnType<typeof getLossAnalysis>>;
type CohortAnalysis = Awaited<ReturnType<typeof getCohortAnalysis>>;
type Division = "personnalite" | "maquinas";

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const teamName = (division: Division) =>
  division === "personnalite" ? "TIME PERSONNALITÉ" : "TIME SEMI (MÁQUINAS)";

export type CommercialBiSnapshot = {
  today: string;
  maturity: {
    cohorts: Array<{
      dealId: string;
      title: string;
      operatorId: string;
      operatorName: string;
      stageName: string;
      value: number;
      tier: number;
      ageDays: number;
      daysRemaining: number;
      companyName: string | null;
      accountPhone: string | null;
      contactName: string | null;
      contactPhone: string | null;
    }>;
  };
  goals: Array<{
    operatorId: string;
    name: string;
    avatar?: string | null;
    division: string | null;
    targetValue: number;
    realizedValue: number;
    conversionRate: number;
  }>;
  pendingTasksByOperator: Array<{ operatorId: string | null; count: number }>;
};

const deparaKeys: DeparaTierKey[] = ["tier_3d", "tier_15d", "tier_30d", "tier_60d", "tier_90d"];
const forecastKeys: PrevistasTierKey[] = [
  "tier_hoje",
  "tier_15d",
  "tier_30d",
  "tier_60d",
  "tier_90d",
];
const forecastKey = (daysRemaining: number): PrevistasTierKey =>
  daysRemaining <= 0
    ? "tier_hoje"
    : daysRemaining <= 15
      ? "tier_15d"
      : daysRemaining <= 30
        ? "tier_30d"
        : daysRemaining <= 60
          ? "tier_60d"
          : "tier_90d";

export function toMaturityPresentation(
  snapshot: CommercialBiSnapshot,
  directives: ReturnType<typeof toDiretrizesPresentation> | null,
  avatarResolver?: (id?: string | null, name?: string | null) => string | undefined,
) {
  const divisionById = new Map(snapshot.goals.map((goal) => [goal.operatorId, goal.division]));
  const relevant = snapshot.maturity.cohorts.filter(
    (cohort) =>
      divisionById.get(cohort.operatorId) === "personnalite" ||
      divisionById.get(cohort.operatorId) === "maquinas",
  );
  const deparaDeals: DeparaDealItem[] = relevant.map((deal) => ({
    id: deal.dealId,
    title: deal.title,
    companyName: deal.companyName || deal.title,
    sellerId: deal.operatorId,
    sellerName: deal.operatorName,
    division: divisionById.get(deal.operatorId) as Division,
    value: deal.value,
    contactName: deal.contactName || undefined,
    phone: deal.contactPhone || deal.accountPhone || undefined,
    ageDays: deal.ageDays,
    tierKey: deparaKeys[deal.tier - 1] || "out_of_rule",
    crmStage: deal.stageName,
    isDelayed: deal.daysRemaining <= 0,
  }));
  const previstasDeals: PrevistasDealItem[] = relevant.map((deal) => {
    const key = forecastKey(deal.daysRemaining);
    return {
      id: deal.dealId,
      code: deal.dealId,
      title: deal.title,
      companyName: deal.companyName || deal.title,
      sellerId: deal.operatorId,
      sellerName: deal.operatorName,
      division: divisionById.get(deal.operatorId) as Division,
      value: deal.value,
      contactName: deal.contactName || undefined,
      phone: deal.contactPhone || deal.accountPhone || undefined,
      ageDays: deal.ageDays,
      horizonKey: key,
      faixaPrevisaoLabel:
        key === "tier_hoje" ? "HOJE" : key.replace("tier_", "").toUpperCase() + " DIAS",
      crmStage: deal.stageName,
      isDelayed: deal.daysRemaining < 0,
      hasDirectiveCompleted:
        directives?.consultants.some((c) =>
          c.deals.some((d) => d.dealId === deal.dealId && d.status === "concluida"),
        ) || false,
    };
  });
  const deparaRows: SellerDeparaRow[] = [];
  const previstasRows: SellerPrevistasRow[] = [];
  for (const goal of snapshot.goals) {
    if (goal.division !== "personnalite" && goal.division !== "maquinas") continue;
    const own = relevant.filter((deal) => deal.operatorId === goal.operatorId);
    const mature = own.filter((deal) => deal.daysRemaining <= 0);
    const matureValue = mature.reduce((sum, deal) => sum + deal.value, 0);
    const forecastValue = own.reduce((sum, deal) => sum + deal.value, 0);
    const resolvedAvatar = avatarResolver
      ? avatarResolver(goal.operatorId, goal.name)
      : goal.avatar || undefined;
    const common = {
      sellerId: goal.operatorId,
      sellerName: goal.name,
      avatarUrl: resolvedAvatar || goal.avatar || undefined,
      division: goal.division as Division,
      metaValue: goal.targetValue,
      conversionPercent: goal.conversionRate,
      realizedValue: goal.realizedValue,
      realizedPercent: goal.targetValue ? (goal.realizedValue / goal.targetValue) * 100 : 0,
    };
    deparaRows.push({
      ...common,
      tiers: Object.fromEntries(
        deparaKeys.map((key, index) => {
          const value = mature
            .filter((deal) => deal.tier === index + 1)
            .reduce((sum, deal) => sum + deal.value, 0);
          return [key, { value, formatted: formatDeparaCurrency(value) }];
        }),
      ) as SellerDeparaRow["tiers"],
      tasksCount:
        snapshot.pendingTasksByOperator.find((row) => row.operatorId === goal.operatorId)?.count ||
        0,
      totalMaduroValue: matureValue,
      totalMaduroPercent: goal.targetValue ? (matureValue / goal.targetValue) * 100 : 0,
    });
    previstasRows.push({
      ...common,
      tiers: Object.fromEntries(
        forecastKeys.map((key) => {
          const value = own
            .filter((deal) => forecastKey(deal.daysRemaining) === key)
            .reduce((sum, deal) => sum + deal.value, 0);
          return [key, { value, formatted: formatDeparaCurrency(value) }];
        }),
      ) as SellerPrevistasRow["tiers"],
      totalAFaturarValue: forecastValue,
      totalAFaturarPercent: goal.targetValue ? (forecastValue / goal.targetValue) * 100 : 0,
    });
  }
  const deparaGroup = (division: Division): TeamDeparaData => {
    const sellers = deparaRows.filter((row) => row.division === division);
    return {
      teamName: teamName(division),
      division,
      metaTotal: sellers.reduce((sum, row) => sum + row.metaValue, 0),
      maduroTotal: sellers.reduce((sum, row) => sum + row.totalMaduroValue, 0),
      promessaTotal: sellers.reduce(
        (sum, row) => sum + (row.totalMaduroValue * row.conversionPercent) / 100,
        0,
      ),
      sellers,
    };
  };
  const previstasGroup = (division: Division): TeamPrevistasData => {
    const sellers = previstasRows.filter((row) => row.division === division);
    return {
      teamName: teamName(division),
      division,
      metaTotal: sellers.reduce((sum, row) => sum + row.metaValue, 0),
      aFaturarTotal: sellers.reduce((sum, row) => sum + row.totalAFaturarValue, 0),
      promessaTotal: sellers.reduce(
        (sum, row) => sum + (row.totalAFaturarValue * row.conversionPercent) / 100,
        0,
      ),
      sellers,
    };
  };
  return {
    depara: {
      personnaliteData: deparaGroup("personnalite"),
      semiMaquinasData: deparaGroup("maquinas"),
      deals: deparaDeals,
    },
    previstas: {
      personnaliteData: previstasGroup("personnalite"),
      semiMaquinasData: previstasGroup("maquinas"),
      deals: previstasDeals,
    },
  };
}

export function toPacingPresentation(
  data: GoalAnalysis,
  snapshot: CommercialBiSnapshot,
  avatarResolver?: (id?: string | null, name?: string | null) => string | undefined,
) {
  const mature = new Map(
    snapshot.maturity.cohorts
      .filter((deal) => deal.daysRemaining <= 0)
      .reduce((map, deal) => {
        const current = map.get(deal.operatorId) || { count: 0, value: 0 };
        map.set(deal.operatorId, { count: current.count + 1, value: current.value + deal.value });
        return map;
      }, new Map<string, { count: number; value: number }>()),
  );
  const rows: PacingSellerRow[] = data.consultants
    .filter(
      (consultant): consultant is typeof consultant & { division: Division } =>
        consultant.division === "personnalite" || consultant.division === "maquinas",
    )
    .map((consultant) => {
      const realizedMonthly = consultant.points.reduce((sum, point) => sum + point.wonValue, 0);
      const realizedPercent = consultant.targetValue
        ? (realizedMonthly / consultant.targetValue) * 100
        : 0;
      const pacingStatus =
        realizedPercent + 5 < consultant.pacing.expectedPercent
          ? "recuperar"
          : realizedPercent > consultant.pacing.expectedPercent + 5
            ? "acelerado"
            : "alvo";
      return {
        sellerId: consultant.operatorId,
        sellerName: consultant.name,
        avatarUrl:
          avatarResolver?.(consultant.operatorId, consultant.name) ||
          (consultant as any).avatar ||
          (consultant as any).avatarUrl ||
          undefined,
        division: consultant.division,
        pacingStatus,
        statusLabel:
          pacingStatus === "recuperar"
            ? "Recuperar"
            : pacingStatus === "acelerado"
              ? "Acelerado"
              : "No Alvo",
        metaMonthly: consultant.targetValue,
        realizedMonthly,
        realizedPercent,
        remainingMonthly: Math.max(0, consultant.targetValue - realizedMonthly),
        dailyGoal: consultant.todayTargetValue,
        dailyRealized: consultant.todayWon.value,
        dailyRealizedPercent: consultant.todayTargetValue
          ? (consultant.todayWon.value / consultant.todayTargetValue) * 100
          : 0,
        weeklyGoal: consultant.weekTargetValue,
        weeklyRealized: consultant.weekWon.value,
        weeklyRealizedPercent: consultant.weekTargetValue
          ? (consultant.weekWon.value / consultant.weekTargetValue) * 100
          : 0,
        habeisCount: mature.get(consultant.operatorId)?.count || 0,
        habeisValue: mature.get(consultant.operatorId)?.value || 0,
      };
    });
  const group = (division: Division): TeamPacingData => {
    const sellers = rows.filter((row) => row.division === division);
    const metaTotal = sellers.reduce((sum, row) => sum + row.metaMonthly, 0);
    const fechadoTotal = sellers.reduce((sum, row) => sum + row.realizedMonthly, 0);
    return {
      teamName: teamName(division),
      division,
      metaTotal,
      fechadoTotal,
      fechadoPercent: metaTotal ? (fechadoTotal / metaTotal) * 100 : 0,
      ritmoDiarioTotal: sellers.reduce((sum, row) => sum + row.dailyGoal, 0),
      sellers,
    };
  };
  const total = data.total;
  const globalKpis: PacingGlobalKpis = {
    businessDaysRemaining: total.pacing.remainingDays,
    businessDaysTotal: total.pacing.businessDays,
    businessDaysElapsed: total.pacing.elapsedDays,
    elapsedPercent: total.pacing.expectedPercent,
    metaGlobal: total.targetValue,
    realizedGlobal: total.points.reduce((sum, point) => sum + point.wonValue, 0),
    globalPercent: total.pacing.coveragePercent,
    companyPacingDaily: total.todayTargetValue,
    companyRealizedToday: total.todayWon.value,
  };
  const pacingDeals: PacingDealItem[] = snapshot.maturity.cohorts.flatMap((deal) => {
    const consultant = rows.find((row) => row.sellerId === deal.operatorId);
    if (!consultant || deal.daysRemaining > 0) return [];
    return [
      {
        id: deal.dealId,
        code: deal.dealId,
        title: deal.title,
        companyName: deal.companyName || deal.title,
        sellerId: deal.operatorId,
        sellerName: consultant.sellerName,
        division: consultant.division,
        value: deal.value,
        ageDays: deal.ageDays,
        contactName: deal.contactName || undefined,
        phone: deal.contactPhone || deal.accountPhone || undefined,
        horizonKey: deparaKeys[deal.tier - 1] || "fora_regua",
        horizonLabel: `${deal.daysRemaining} dias`,
        crmStage: deal.stageName,
        isDelayed: deal.daysRemaining < 0,
      },
    ];
  });
  return {
    personnaliteData: group("personnalite"),
    semiMaquinasData: group("maquinas"),
    globalKpis,
    deals: pacingDeals,
  };
}

const lossColors: Array<Pick<PerdasCategory, "iconName" | "colorHex" | "colorClass" | "badgeBg">> =
  [
    {
      iconName: "users",
      colorHex: "#3b82f6",
      colorClass: "bg-blue-500 text-blue-400",
      badgeBg: "border-blue-500/40 bg-blue-950/40 text-blue-300",
    },
    {
      iconName: "zap",
      colorHex: "#f59e0b",
      colorClass: "bg-amber-500 text-amber-400",
      badgeBg: "border-amber-500/40 bg-amber-950/40 text-amber-300",
    },
    {
      iconName: "layers",
      colorHex: "#a855f7",
      colorClass: "bg-purple-500 text-purple-400",
      badgeBg: "border-purple-500/40 bg-purple-950/40 text-purple-300",
    },
    {
      iconName: "dollar",
      colorHex: "#10b981",
      colorClass: "bg-emerald-500 text-emerald-400",
      badgeBg: "border-emerald-500/40 bg-emerald-950/40 text-emerald-300",
    },
    {
      iconName: "clock",
      colorHex: "#ef4444",
      colorClass: "bg-red-500 text-red-400",
      badgeBg: "border-red-500/40 bg-red-950/40 text-red-300",
    },
  ];

export function toLossPresentation(data: LossAnalysis): Record<PerdasPeriodKey, PerdasPeriodData> {
  const keys: PerdasPeriodKey[] = ["mes_atual", "mes_passado", "geral_historico"];
  const entries = data.periods.map((period, index) => {
    const key = keys[index];
    const monthDate = period.period === "all" ? null : new Date(`${period.period}-01T12:00:00Z`);
    const periodLabel = monthDate
      ? new Intl.DateTimeFormat("pt-BR", {
          month: "long",
          year: "numeric",
          timeZone: "UTC",
        }).format(monthDate)
      : "histórico completo";
    const categories: PerdasCategory[] = period.categories.map((category, colorIndex) => ({
      key: category.name.toLocaleLowerCase("pt-BR").replace(/\s+/g, "_"),
      name: category.name,
      ...lossColors[colorIndex % lossColors.length],
      count: category.count,
      percent: category.percent,
      subReasons: category.subreasons.map((item) => ({ label: item.reason, count: item.count })),
    }));
    return [
      key,
      {
        key,
        title:
          key === "mes_atual"
            ? "MÊS ATUAL"
            : key === "mes_passado"
              ? "MÊS PASSADO"
              : "HISTÓRICO GERAL",
        totalCount: period.count,
        subtitlePeriod: periodLabel,
        subtitleMetric: money.format(period.value),
        headerFilterLabel: periodLabel,
        categories,
      } satisfies PerdasPeriodData,
    ] as const;
  });
  return Object.fromEntries(entries) as Record<PerdasPeriodKey, PerdasPeriodData>;
}

const tierColors = ["#ef4444", "#f59e0b", "#3b82f6", "#a855f7", "#10b981"];

export function toCohortPresentation(data: CohortAnalysis, today: string): TVCohortsResponse {
  const tiersConfig: TVCohortTierConfig[] = data.rules.map((rule, index) => ({
    index: index + 1,
    days: rule.days,
    maxValue: rule.maxValue,
    label: `${rule.days} DIAS`,
    valueRuleLabel:
      rule.maxValue === null ? "Acima da faixa anterior" : `Até ${money.format(rule.maxValue)}`,
    color: tierColors[index % tierColors.length],
  }));
  const months = data.months.map((month) => {
    const date = new Date(`${month.month}-01T12:00:00Z`);
    const fullLabel = new Intl.DateTimeFormat("pt-BR", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(date);
    return {
      monthKey: month.month,
      monthName: new Intl.DateTimeFormat("pt-BR", { month: "long", timeZone: "UTC" }).format(date),
      monthShort: new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: "UTC" }).format(
        date,
      ),
      year: date.getUTCFullYear(),
      fullLabel,
      isCurrentMonth: month.month === today.slice(0, 7),
      unclassifiedCount: month.unclassifiedCount,
      unclassifiedValue: 0,
      classifiedCount: month.classifiedCount,
      classifiedValue: month.totalValue,
      totalCards: month.classifiedCount + month.unclassifiedCount,
      totalValue: month.totalValue,
      tiers: month.tiers.map((tier, index) => ({
        tierIndex: tier.tier,
        days: tier.days,
        label: tiersConfig[index]?.label || `${tier.days} DIAS`,
        valueRuleLabel: tiersConfig[index]?.valueRuleLabel || "",
        color: tiersConfig[index]?.color || tierColors[index % tierColors.length],
        count: tier.count,
        totalValue: tier.value,
      })),
    };
  });
  return {
    success: true,
    updatedAt: new Date().toISOString(),
    tiersConfig,
    months,
    summary: {
      totalCardsAllMonths: months.reduce((sum, month) => sum + month.totalCards, 0),
      totalUnclassifiedAllMonths: months.reduce((sum, month) => sum + month.unclassifiedCount, 0),
      totalClassifiedAllMonths: months.reduce((sum, month) => sum + month.classifiedCount, 0),
      totalValueAllMonths: months.reduce((sum, month) => sum + month.totalValue, 0),
    },
  };
}

export function toPipelinePresentation(
  data: PipelineAnalysis,
  avatarResolver?: (id?: string | null, name?: string | null) => string | undefined,
) {
  const stageDefinitions = (division: PipelineDivision): PipelineStageDef[] =>
    teamStages(data.stages, data.pipelineByDivision, division).map((stage) => ({
      key: stage.id,
      label: stage.name,
      bracketLabel: `[${stage.name.toLocaleUpperCase("pt-BR")}]`,
      pillLabel: stage.name,
    }));
  const stagesByDivision = {
    personnalite: stageDefinitions("personnalite"),
    maquinas: stageDefinitions("maquinas"),
  };
  const stages = [...stagesByDivision.personnalite, ...stagesByDivision.maquinas];
  const rows: SellerPipelineRow[] = data.rows
    .filter(
      (row): row is typeof row & { division: Division } =>
        row.division === "personnalite" || row.division === "maquinas",
    )
    .map((row) => {
      const resolvedAvatar =
        avatarResolver?.(row.operatorId, row.name) ||
        (row as any).avatar ||
        (row as any).avatarUrl ||
        undefined;
      return {
        sellerId: row.operatorId,
        sellerName: row.name,
        avatar: resolvedAvatar,
        avatarUrl: resolvedAvatar,
        division: row.division,
        stages: Object.fromEntries(
          stagesByDivision[row.division].map((stage) => {
            const cell = row.byStage.find((entry) => entry.stageId === stage.key);
            return [
              stage.key,
              {
                count: cell?.count || 0,
                value: cell?.value || 0,
                percent: cell?.shareOfConsultantPercent || 0,
              },
            ];
          }),
        ),
        totalCards: row.total.count,
        totalValue: row.total.value,
        teamSharePercent: 0,
      };
    });
  const group = (division: Division): TeamPipelineData => {
    const sellers = rows.filter((row) => row.division === division);
    const totalValue = sellers.reduce((sum, seller) => sum + seller.totalValue, 0);
    return {
      teamId: division,
      teamName: teamName(division),
      icon: division === "personnalite" ? "star" : "flag",
      totalCards: sellers.reduce((sum, seller) => sum + seller.totalCards, 0),
      totalValue,
      sellers: sellers.map((seller) => ({
        ...seller,
        avatar: seller.avatarUrl || seller.avatar,
        avatarUrl: seller.avatarUrl || seller.avatar,
        teamSharePercent: totalValue ? Math.round((seller.totalValue / totalValue) * 100) : 0,
      })),
      stageTotals: Object.fromEntries(
        stagesByDivision[division].map((stage) => {
          const count = sellers.reduce((sum, seller) => sum + seller.stages[stage.key].count, 0);
          const value = sellers.reduce((sum, seller) => sum + seller.stages[stage.key].value, 0);
          return [
            stage.key,
            { count, value, percent: totalValue ? (value / totalValue) * 100 : 0 },
          ];
        }),
      ),
    };
  };
  return {
    stages,
    stagesByDivision,
    pipelineByDivision: data.pipelineByDivision,
    pipelineOptions: data.pipelineOptions,
    personnaliteData: group("personnalite"),
    semiMaquinasData: group("maquinas"),
  };
}

export function toDiretrizesPresentation(
  data: ResponsibilityAnalysis,
  avatarResolver?: (id?: string | null, name?: string | null) => string | undefined,
) {
  const consultants: DiretrizesConsultantRow[] = data.consultants
    .filter(
      (consultant): consultant is typeof consultant & { division: Division } =>
        consultant.division === "personnalite" || consultant.division === "maquinas",
    )
    .map((consultant) => {
      const deals: DiretrizDealDetail[] = data.actions
        .filter((action) => action.operatorId === consultant.operatorId)
        .map((action) => ({
          id: action.id,
          dealId: action.dealId,
          title: action.dealTitle,
          companyName: action.accountName || action.dealTitle,
          consultantId: consultant.operatorId,
          consultantName: consultant.name,
          division: consultant.division,
          status:
            action.state === "completed"
              ? "concluida"
              : action.state === "overdue"
                ? "atrasada"
                : "hoje",
          value: action.dealValue,
          formattedValue: money.format(action.dealValue),
          crmStage: action.stageName || "Etapa atual",
          assignedAt: action.assignedDate,
          gestorDirective: action.instruction,
          consultantResponse:
            action.completionNote ||
            (action.state === "completed" ? "Concluída" : "Aguardando execução"),
        }));
      return {
        consultantId: consultant.operatorId,
        name: consultant.name,
        avatarUrl:
          avatarResolver?.(consultant.operatorId, consultant.name) ||
          (consultant as any).avatar ||
          (consultant as any).avatarUrl ||
          undefined,
        division: consultant.division,
        totalDirectives: consultant.totalCount,
        concluidas: consultant.completedCount,
        pendenteHoje: consultant.pendingTodayCount,
        atrasadas: consultant.overdueCount,
        taxaExecucaoPercent: consultant.totalCount ? consultant.executionRatePercent : null,
        totalValue: consultant.totalValue,
        formattedValue: money.format(consultant.totalValue),
        deals,
      };
    });
  const group = (division: Division): DiretrizesTeamGroup => ({
    teamKey: division,
    teamLabel: teamName(division),
    badgeColorClass: division === "personnalite" ? "bg-red-500" : "bg-blue-500",
    consultants: consultants.filter((consultant) => consultant.division === division),
  });
  const kpis: DiretrizesKpis = {
    totalDeals: data.summary.totalCount,
    totalValue: data.summary.totalValue,
    formattedTotalValue: money.format(data.summary.totalValue),
    taxaExecucaoPercent: data.summary.executionRatePercent,
    concluidasCount: data.summary.completedCount,
    totalCount: data.summary.totalCount,
    atrasoCount: data.summary.overdueCount,
    atrasoLabel: data.summary.overdueCount
      ? `${data.summary.overdueCount} em atraso`
      : "Tudo no prazo",
  };
  return {
    kpis,
    personnaliteData: group("personnalite"),
    semiMaquinasData: group("maquinas"),
    consultants,
  };
}

function formatSeconds(seconds: number | null): string {
  if (seconds === null) return "—";
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}m ${String(whole % 60).padStart(2, "0")}s`;
}

export function toTmaPresentation(
  data: TmaAnalysis,
  avatarResolver?: (id?: string | null, name?: string | null) => string | undefined,
) {
  const consultants: TmaConsultantRow[] = data.consultants
    .filter(
      (consultant): consultant is typeof consultant & { division: Division } =>
        consultant.division === "personnalite" || consultant.division === "maquinas",
    )
    .map((consultant) => ({
      consultantId: consultant.operatorId,
      name: consultant.name,
      avatarUrl:
        avatarResolver?.(consultant.operatorId, consultant.name) ||
        (consultant as any).avatar ||
        (consultant as any).avatarUrl ||
        undefined,
      division: consultant.division,
      buckets: {
        under5m: consultant.buckets[0] || 0,
        between5and15m: consultant.buckets[1] || 0,
        between15and30m: consultant.buckets[2] || 0,
        over30m: consultant.buckets[3] || 0,
      },
      totalAnswered: consultant.answeredCount,
      averageTimeFormatted: formatSeconds(consultant.averageSeconds),
    }));
  const group = (division: Division): TmaTeamGroup => ({
    teamKey: division,
    teamLabel: teamName(division),
    badgeColorClass: division === "personnalite" ? "bg-red-500" : "bg-blue-500",
    consultants: consultants.filter((consultant) => consultant.division === division),
  });
  const kpis: TmaKpis = {
    averageMinutes:
      data.todaySummary.averageSeconds === null ? 0 : data.todaySummary.averageSeconds / 60,
    targetMinutes: data.slaLimitMinutes,
    slaPercent: data.todaySummary.withinSlaPercent ?? 0,
    totalTransfers: data.summary.answeredCount + data.summary.pendingCount,
    firstContactCount: data.todaySummary.answeredCount,
    waitingResponseCount: data.summary.pendingCount,
  };
  const byId = new Map(
    data.consultants.map((consultant) => [consultant.operatorId, consultant.name]),
  );
  const waitingChats: TmaWaitingChatItem[] = data.waitingQueue.map((item) => ({
    id: item.id,
    conversationId: item.conversationId,
    clientName: item.contactName || item.contactPhone || "Contato",
    phone: item.contactPhone || "",
    consultantName: byId.get(item.operatorId || "") || "Consultor",
    waitingSeconds: item.waitingSeconds,
    waitingFormatted: formatSeconds(item.waitingSeconds),
    transferredAt: String(item.transferredAt),
  }));
  const ranking: RankingOperatorRow[] = data.consultants.map((consultant, index) => ({
    position: index + 1,
    operatorId: consultant.operatorId,
    name: consultant.name,
    avatarUrl:
      avatarResolver?.(consultant.operatorId, consultant.name) ||
      (consultant as any).avatar ||
      (consultant as any).avatarUrl ||
      undefined,
    division: consultant.division === "maquinas" ? "Máquinas" : "Personnalité",
    averageTime: formatSeconds(consultant.averageSeconds),
    slaPercent: consultant.withinSlaPercent ?? 0,
    bestTime: formatSeconds(consultant.bestSeconds),
    bestClient: consultant.bestContactName || "—",
    worstTime: formatSeconds(consultant.worstSeconds),
    worstClient: consultant.worstContactName || "—",
    totalCalls: consultant.answeredCount,
  }));
  return {
    kpis,
    personnaliteData: group("personnalite"),
    semiMaquinasData: group("maquinas"),
    waitingChats,
    ranking,
  };
}
