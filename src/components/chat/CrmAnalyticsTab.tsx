import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Briefcase,
  DollarSign,
  TrendingUp,
  TrendingDown,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Layers,
  Filter,
  Search,
  ArrowUpDown,
  ArrowUpRight,
  ArrowDownRight,
  Star,
  Sparkles,
  FileText,
  Package,
  Target,
  PauseCircle,
  XCircle,
  Award,
  MessageSquare,
  Calendar,
  ListTodo,
  RefreshCw,
  Info,
  Building2,
  UserCheck,
  Flame,
  Snowflake,
} from "lucide-react";
import { SystemTooltip } from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { enhanceLegacyAvatarSrc } from "@/lib/avatar-image";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  BarChart,
  Bar,
  Cell,
} from "recharts";

export type CrmPeriodKey = "7d" | "15d" | "30d" | "month" | "90d" | "all";

export interface CrmAnalyticsPayload {
  filters: {
    pipelines: {
      id: string;
      name: string;
      orderIndex: number;
      dealsCount: number;
      openCount: number;
      openValue: number;
    }[];
    operators: {
      id: string;
      name: string;
      role: string;
      dealsCount: number;
    }[];
    sources: {
      key: string;
      label: string;
      count: number;
    }[];
    selected: {
      period: CrmPeriodKey;
      periodLabel: string;
      pipelineId: string;
      operatorId: string;
      source: string;
    };
  };
  summaryKpis: {
    activePipeline: {
      openValue: number;
      openCount: number;
      avgOpenTicket: number;
      pausedCount: number;
      pausedValue: number;
      openWithExpectedCloseCount: number;
      expectedCloseThisMonthValue: number;
    };
    wonPeriod: {
      wonValue: number;
      wonCount: number;
      prevWonValue: number;
      prevWonCount: number;
      wonValueDeltaPct: number | null;
      winRate: number;
      avgWonTicket: number;
    };
    lostPeriod: {
      lostValue: number;
      lostCount: number;
      prevLostValue: number;
      prevLostCount: number;
      lostCountDeltaPct: number | null;
      lossRate: number;
      topLossReason: string;
      topLossReasonPct: number;
    };
    velocity: {
      avgCycleDaysWon: number;
      avgCycleDaysLost: number;
      avgOpenAgeDays: number;
      newDealsCount: number;
      newDealsValue: number;
      prevNewDealsCount: number;
      newDealsDeltaPct: number | null;
      netFlowCount: number;
    };
    kanbanHealth: {
      coolingCount: number;
      coolingValue: number;
      coolingPct: number;
      overdueExpectedCloseCount: number;
      overdueExpectedCloseValue: number;
    };
    discipline: {
      openWithPendingTaskCount: number;
      openWithPendingTaskPct: number;
      openWithoutTaskCount: number;
      openWithOverdueTaskCount: number;
      proposalsCount: number;
      proposalsValue: number;
      proposalsAcceptedCount: number;
      proposalsAcceptedValue: number;
    };
  };
  pipelinesBreakdown: {
    id: string;
    name: string;
    orderIndex: number;
    coolingDays: number;
    totalDeals: number;
    openCount: number;
    openValue: number;
    pausedCount: number;
    pausedValue: number;
    wonCount: number;
    wonValue: number;
    lostCount: number;
    lostValue: number;
    winRate: number;
    avgTicketOpen: number;
    avgTicketWon: number;
    avgCycleDaysWon: number;
    coolingCount: number;
    coolingValue: number;
    withoutTaskCount: number;
    overdueTaskCount: number;
    shareOfOpenValuePct: number;
  }[];
  stagesBreakdown: {
    id: string;
    pipelineId: string;
    pipelineName: string;
    name: string;
    abbreviation: string;
    objective: string;
    orderIndex: number;
    isWinStage: boolean;
    isLossStage: boolean;
    coolingEnabled: boolean;
    coolingDays: number;
    openCount: number;
    openValue: number;
    pausedCount: number;
    wonCount: number;
    lostCount: number;
    historicalEnteredCount: number;
    historicalAdvancedCount: number;
    stageAdvanceRatePct: number;
    avgStageAgeDays: number;
    coolingCount: number;
    coolingValue: number;
    withoutTaskCount: number;
    overdueTaskCount: number;
    shareOfPipelineCountPct: number;
    shareOfPipelineValuePct: number;
  }[];
  timeline: {
    label: string;
    dateKey: string;
    createdCount: number;
    wonCount: number;
    lostCount: number;
    createdValue: number;
    wonValue: number;
    lostValue: number;
  }[];
  lossesAndPauses: {
    lossReasons: {
      reason: string;
      count: number;
      value: number;
      shareCountPct: number;
      shareValuePct: number;
      avgDaysBeforeLoss: number;
      topStageName: string;
    }[];
    lossByStage: {
      stageId: string;
      stageName: string;
      pipelineName: string;
      count: number;
      value: number;
      sharePct: number;
    }[];
    pausedReasons: {
      reason: string;
      count: number;
      value: number;
      sharePct: number;
      avgPausedDays: number;
    }[];
  };
  productsAndQualification: {
    topProducts: {
      productId: string;
      name: string;
      dealsCount: number;
      wonDealsCount: number;
      totalQuantity: number;
      totalValue: number;
      wonValue: number;
      winRate: number;
    }[];
    proposalsSummary: {
      totalCount: number;
      totalValue: number;
      draftCount: number;
      sentCount: number;
      acceptedCount: number;
      acceptedValue: number;
      rejectedCount: number;
      conversionRatePct: number;
    };
    ratingBreakdown: {
      rating: number;
      label: string;
      count: number;
      openCount: number;
      wonCount: number;
      lostCount: number;
      value: number;
      winRate: number;
    }[];
    aiPriorityBreakdown: {
      level: string;
      label: string;
      count: number;
      openValue: number;
      winRate: number;
    }[];
    sourcesBreakdown: {
      source: string;
      totalDeals: number;
      openCount: number;
      wonCount: number;
      lostCount: number;
      openValue: number;
      wonValue: number;
      winRate: number;
      avgTicketWon: number;
    }[];
    campaignsBreakdown: {
      campaign: string;
      totalDeals: number;
      openCount: number;
      wonCount: number;
      wonValue: number;
      winRate: number;
    }[];
  };
  consultantsBreakdown: {
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
    winRate: number;
    avgTicketWon: number;
    avgCycleDaysWon: number;
    coolingCount: number;
    withoutTaskCount: number;
    overdueTaskCount: number;
    activitiesCompletedPeriod: number;
  }[];
  radarDeals: {
    id: string;
    title: string;
    accountName: string | null;
    contactId: string | null;
    contactName: string | null;
    contactPhone: string | null;
    pipelineId: string;
    pipelineName: string;
    stageId: string;
    stageName: string;
    operatorId: string | null;
    operatorName: string;
    status: string;
    value: number;
    rating: number;
    aiPriorityLevel: string | null;
    daysInFunnel: number;
    daysInStage: number;
    daysSinceLastActivity: number;
    coolingDaysThreshold: number;
    isCooling: boolean;
    hasPendingTask: boolean;
    hasOverdueTask: boolean;
    pendingTasksCount: number;
    overdueTasksCount: number;
    expectedCloseDate: string | null;
    isExpectedCloseOverdue: boolean;
    conversationId: string | null;
    urgencyScore: number;
  }[];
}

const PERIOD_OPTIONS: { id: CrmPeriodKey; label: string }[] = [
  { id: "7d", label: "7 dias" },
  { id: "15d", label: "15 dias" },
  { id: "30d", label: "30 dias" },
  { id: "month", label: "Este mês" },
  { id: "90d", label: "90 dias" },
  { id: "all", label: "Todo o histórico" },
];

function formatBrlCompact(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "R$ 0";
  if (Math.abs(value) >= 1_000_000) {
    return `R$ ${(value / 1_000_000).toLocaleString("pt-BR", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 2,
    })}M`;
  }
  if (Math.abs(value) >= 10_000) {
    return `R$ ${(value / 1_000).toLocaleString("pt-BR", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 1,
    })}k`;
  }
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  });
}

function formatBrlFull(value: number): string {
  if (!Number.isFinite(value)) return "R$ 0";
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  });
}

function DeltaPill({
  delta,
  inverse = false,
}: {
  delta: number | null | undefined;
  inverse?: boolean;
}) {
  if (delta === null || delta === undefined) return null;
  const isPositive = delta > 0;
  const isZero = delta === 0;
  if (isZero) {
    return (
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-muted/60 text-muted-foreground border border-border/60">
        0%
      </span>
    );
  }
  const isGood = inverse ? !isPositive : isPositive;
  return (
    <span
      className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-extrabold border ${
        isGood
          ? "bg-primary/12 text-primary border-primary/25"
          : "bg-muted/70 text-muted-foreground border-border"
      }`}
    >
      {isPositive ? (
        <ArrowUpRight className="h-2.5 w-2.5 shrink-0" />
      ) : (
        <ArrowDownRight className="h-2.5 w-2.5 shrink-0" />
      )}
      {isPositive ? `+${delta}%` : `${delta}%`}
    </span>
  );
}

interface CrmAnalyticsTabProps {
  tenant: string | null;
  refreshTrigger?: number;
}

export function CrmAnalyticsTab({ tenant, refreshTrigger }: CrmAnalyticsTabProps) {
  const [data, setData] = useState<CrmAnalyticsPayload | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [period, setPeriod] = useState<CrmPeriodKey>("30d");
  const [pipelineId, setPipelineId] = useState<string>("all");
  const [operatorId, setOperatorId] = useState<string>("all");
  const [source, setSource] = useState<string>("all");

  const [timelineMetricMode, setTimelineMetricMode] = useState<"count" | "value">("count");
  const [stageViewMode, setStageViewMode] = useState<"funnel" | "table">("funnel");
  const [consultantSortBy, setConsultantSortBy] = useState<
    "wonValue" | "openValue" | "winRate" | "coolingCount" | "withoutTaskCount"
  >("wonValue");
  const [consultantSearch, setConsultantSearch] = useState<string>("");
  const [radarFilter, setRadarFilter] = useState<
    "all" | "cooling" | "no_task" | "overdue_task" | "overdue_close"
  >("all");
  const [radarSearch, setRadarSearch] = useState<string>("");

  const fetchCrmAnalytics = useCallback(
    async (
      nextPeriod: CrmPeriodKey,
      nextPipelineId: string,
      nextOperatorId: string,
      nextSource: string
    ) => {
      if (!tenant) return;
      setLoading(true);
      setError(null);
      try {
        const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "";
        const params = new URLSearchParams({
          tenantId: tenant,
          period: nextPeriod,
          pipelineId: nextPipelineId,
          operatorId: nextOperatorId,
          source: nextSource,
        });
        const res = await fetch(`${BACKEND_URL}/api/gestao/crm-analytics?${params.toString()}`);
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const json = (await res.json()) as CrmAnalyticsPayload;
        setData(json);
      } catch (err) {
        console.error("[CrmAnalyticsTab] Falha ao carregar métricas de CRM:", err);
        setError("Não foi possível carregar os indicadores de CRM & Funis.");
      } finally {
        setLoading(false);
      }
    },
    [tenant]
  );

  useEffect(() => {
    fetchCrmAnalytics(period, pipelineId, operatorId, source);
  }, [fetchCrmAnalytics, period, pipelineId, operatorId, source, refreshTrigger]);

  const filteredConsultants = useMemo(() => {
    if (!data?.consultantsBreakdown) return [];
    const q = consultantSearch.trim().toLowerCase();
    return data.consultantsBreakdown
      .filter((c) => !q || c.name.toLowerCase().includes(q))
      .sort((a, b) => {
        if (consultantSortBy === "wonValue") return b.wonValue - a.wonValue || b.openValue - a.openValue;
        if (consultantSortBy === "openValue") return b.openValue - a.openValue || b.openCount - a.openCount;
        if (consultantSortBy === "winRate") return b.winRate - a.winRate || b.wonCount - a.wonCount;
        if (consultantSortBy === "coolingCount") return b.coolingCount - a.coolingCount || b.openValue - a.openValue;
        return b.withoutTaskCount - a.withoutTaskCount || b.openCount - a.openCount;
      });
  }, [data?.consultantsBreakdown, consultantSearch, consultantSortBy]);

  const filteredRadarDeals = useMemo(() => {
    if (!data?.radarDeals) return [];
    const q = radarSearch.trim().toLowerCase();
    return data.radarDeals.filter((d) => {
      if (radarFilter === "cooling" && !d.isCooling) return false;
      if (radarFilter === "no_task" && d.hasPendingTask) return false;
      if (radarFilter === "overdue_task" && !d.hasOverdueTask) return false;
      if (radarFilter === "overdue_close" && !d.isExpectedCloseOverdue) return false;
      if (q) {
        const hay = `${d.title} ${d.accountName || ""} ${d.contactName || ""} ${d.operatorName} ${d.pipelineName} ${d.stageName}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [data?.radarDeals, radarFilter, radarSearch]);

  if (loading && !data) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground">
        <RefreshCw className="h-6 w-6 animate-spin text-primary" />
        <p className="text-xs font-semibold">Consolidando funis, etapas, propostas e carteira do CRM...</p>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6 text-center space-y-3">
        <AlertTriangle className="h-6 w-6 text-primary mx-auto" />
        <p className="text-sm font-bold text-foreground">{error}</p>
        <button
          type="button"
          onClick={() => fetchCrmAnalytics(period, pipelineId, operatorId, source)}
          className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-bold hover:opacity-90 transition cursor-pointer"
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  if (!data) return null;

  const {
    filters,
    summaryKpis,
    pipelinesBreakdown,
    stagesBreakdown,
    timeline,
    lossesAndPauses,
    productsAndQualification,
  } = data;

  const maxStageOpenValue = Math.max(
    1,
    ...stagesBreakdown.map((s) => s.openValue)
  );
  const maxStageOpenCount = Math.max(
    1,
    ...stagesBreakdown.map((s) => s.openCount)
  );

  return (
    <div className="flex-1 overflow-y-auto space-y-5 pr-1 pb-6">
      {/* ─── BARRA DE FILTROS EXECUTIVOS DO CRM ─────────────────────────────── */}
      <div className="rounded-2xl bg-card border border-border p-3.5 md:p-4 shadow-soft flex flex-col xl:flex-row xl:items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-xl bg-primary/10 border border-primary/20 text-primary grid place-items-center shrink-0">
            <Briefcase className="h-4.5 w-4.5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-extrabold text-foreground">
                Inteligência de CRM, Kanban & Funis
              </h2>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-primary/10 text-primary border border-primary/20">
                {filters.selected.periodLabel}
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Análise ponta a ponta de conversão por funil, retenção em etapas, motivos de perda, esfriamento e disciplina comercial
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Seletor de Período */}
          <div className="flex items-center bg-muted/40 p-1 rounded-xl border border-border/60">
            {PERIOD_OPTIONS.map((opt) => {
              const active = period === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setPeriod(opt.id)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                    active
                      ? "bg-primary text-primary-foreground shadow-soft"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          {/* Seletor de Funil */}
          <div className="w-[190px]">
            <Select value={pipelineId} onValueChange={setPipelineId}>
              <SelectTrigger className="h-8 text-xs bg-muted/30 border-border rounded-xl">
                <SelectValue placeholder="Todos os Funis" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os Funis ({filters.pipelines.length})</SelectItem>
                {filters.pipelines.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} ({p.openCount} abertas)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Seletor de Consultor */}
          <div className="w-[185px]">
            <Select value={operatorId} onValueChange={setOperatorId}>
              <SelectTrigger className="h-8 text-xs bg-muted/30 border-border rounded-xl">
                <SelectValue placeholder="Todos os Consultores" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os Consultores</SelectItem>
                <SelectItem value="unassigned">Sem Responsável</SelectItem>
                {filters.operators.map((op) => (
                  <SelectItem key={op.id} value={op.id}>
                    {op.name} ({op.dealsCount})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Seletor de Origem */}
          {filters.sources.length > 0 && (
            <div className="w-[165px]">
              <Select value={source} onValueChange={setSource}>
                <SelectTrigger className="h-8 text-xs bg-muted/30 border-border rounded-xl">
                  <SelectValue placeholder="Todas as Origens" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as Origens</SelectItem>
                  {filters.sources.map((src) => (
                    <SelectItem key={src.key} value={src.key}>
                      {src.label} ({src.count})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {(pipelineId !== "all" || operatorId !== "all" || source !== "all") && (
            <SystemTooltip content="Limpar filtros de funil, consultor e origem">
              <button
                type="button"
                onClick={() => {
                  setPipelineId("all");
                  setOperatorId("all");
                  setSource("all");
                }}
                className="px-2.5 py-1.5 rounded-xl border border-primary/30 bg-primary/10 text-primary text-[11px] font-bold hover:bg-primary/15 transition cursor-pointer"
              >
                Limpar filtros
              </button>
            </SystemTooltip>
          )}
        </div>
      </div>

      {/* ─── 6 KPIS EXECUTIVOS DE TOPO ──────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-6 gap-3.5">
        {/* KPI 1: Pipeline Ativo */}
        <div className="rounded-2xl bg-card border border-border p-4 shadow-soft flex flex-col justify-between">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">
              Pipeline em Aberto
            </span>
            <SystemTooltip content="Soma financeira e volume de negociações com status Em Aberto nos funis selecionados">
              <div className="h-7 w-7 rounded-lg bg-primary/10 text-primary grid place-items-center">
                <Briefcase className="h-3.5 w-3.5" />
              </div>
            </SystemTooltip>
          </div>
          <div className="my-2">
            <div className="flex items-baseline gap-2">
              <span className="text-xl font-black text-foreground tracking-tight">
                {formatBrlCompact(summaryKpis.activePipeline.openValue)}
              </span>
              <span className="text-xs font-bold text-primary">
                {summaryKpis.activePipeline.openCount} cards
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Ticket médio:{" "}
              <strong className="text-foreground">
                {formatBrlCompact(summaryKpis.activePipeline.avgOpenTicket)}
              </strong>
            </p>
          </div>
          <div className="pt-2 border-t border-border/60 flex items-center justify-between text-[10px] text-muted-foreground">
            <span>Pausadas: {summaryKpis.activePipeline.pausedCount}</span>
            <span className="font-semibold text-foreground">
              {formatBrlCompact(summaryKpis.activePipeline.pausedValue)}
            </span>
          </div>
        </div>

        {/* KPI 2: Receita Ganha */}
        <div className="rounded-2xl bg-card border border-border p-4 shadow-soft flex flex-col justify-between">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">
              Receita Ganha (Won)
            </span>
            <div className="flex items-center gap-1.5">
              <DeltaPill delta={summaryKpis.wonPeriod.wonValueDeltaPct} />
              <div className="h-7 w-7 rounded-lg bg-primary/10 text-primary grid place-items-center">
                <Award className="h-3.5 w-3.5" />
              </div>
            </div>
          </div>
          <div className="my-2">
            <div className="flex items-baseline gap-2">
              <span className="text-xl font-black text-primary tracking-tight">
                {formatBrlCompact(summaryKpis.wonPeriod.wonValue)}
              </span>
              <span className="text-xs font-bold text-foreground">
                {summaryKpis.wonPeriod.wonCount} vendas
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Ticket ganho:{" "}
              <strong className="text-foreground">
                {formatBrlCompact(summaryKpis.wonPeriod.avgWonTicket)}
              </strong>
            </p>
          </div>
          <div className="pt-2 border-t border-border/60 flex items-center justify-between text-[10px]">
            <span className="text-muted-foreground">Taxa de Conversão (Win Rate)</span>
            <span className="font-extrabold text-primary">{summaryKpis.wonPeriod.winRate}%</span>
          </div>
        </div>

        {/* KPI 3: Receita Perdida */}
        <div className="rounded-2xl bg-card border border-border p-4 shadow-soft flex flex-col justify-between">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">
              Negociações Perdidas
            </span>
            <div className="flex items-center gap-1.5">
              <DeltaPill delta={summaryKpis.lostPeriod.lostCountDeltaPct} inverse />
              <div className="h-7 w-7 rounded-lg bg-muted/60 text-muted-foreground grid place-items-center">
                <XCircle className="h-3.5 w-3.5" />
              </div>
            </div>
          </div>
          <div className="my-2">
            <div className="flex items-baseline gap-2">
              <span className="text-xl font-black text-foreground tracking-tight">
                {formatBrlCompact(summaryKpis.lostPeriod.lostValue)}
              </span>
              <span className="text-xs font-bold text-muted-foreground">
                {summaryKpis.lostPeriod.lostCount} perdas
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
              1º Motivo:{" "}
              <strong className="text-foreground">{summaryKpis.lostPeriod.topLossReason}</strong>
            </p>
          </div>
          <div className="pt-2 border-t border-border/60 flex items-center justify-between text-[10px] text-muted-foreground">
            <span>Taxa de Perda</span>
            <span className="font-bold text-foreground">{summaryKpis.lostPeriod.lossRate}%</span>
          </div>
        </div>

        {/* KPI 4: Velocidade & Ciclo Comercial */}
        <div className="rounded-2xl bg-card border border-border p-4 shadow-soft flex flex-col justify-between">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">
              Ciclo & Vazão
            </span>
            <div className="flex items-center gap-1.5">
              <DeltaPill delta={summaryKpis.velocity.newDealsDeltaPct} />
              <div className="h-7 w-7 rounded-lg bg-primary/10 text-primary grid place-items-center">
                <Clock className="h-3.5 w-3.5" />
              </div>
            </div>
          </div>
          <div className="my-2">
            <div className="flex items-baseline gap-2">
              <span className="text-xl font-black text-foreground tracking-tight">
                {summaryKpis.velocity.avgCycleDaysWon}d
              </span>
              <span className="text-[11px] font-semibold text-muted-foreground">
                ciclo até venda
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Novas no período:{" "}
              <strong className="text-foreground">{summaryKpis.velocity.newDealsCount}</strong> (
              {formatBrlCompact(summaryKpis.velocity.newDealsValue)})
            </p>
          </div>
          <div className="pt-2 border-t border-border/60 flex items-center justify-between text-[10px] text-muted-foreground">
            <span>Idade média abertas</span>
            <span className="font-bold text-foreground">
              {summaryKpis.velocity.avgOpenAgeDays} dias
            </span>
          </div>
        </div>

        {/* KPI 5: Saúde do Kanban & Esfriamento */}
        <div className="rounded-2xl bg-card border border-border p-4 shadow-soft flex flex-col justify-between">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">
              Esfriamento Kanban
            </span>
            <SystemTooltip content="Negociações abertas sem interação além do limite de dias configurado na etapa ou no funil">
              <div
                className={`h-7 w-7 rounded-lg grid place-items-center ${
                  summaryKpis.kanbanHealth.coolingCount > 0
                    ? "bg-primary/15 text-primary"
                    : "bg-muted/60 text-muted-foreground"
                }`}
              >
                <Snowflake className="h-3.5 w-3.5" />
              </div>
            </SystemTooltip>
          </div>
          <div className="my-2">
            <div className="flex items-baseline gap-2">
              <span
                className={`text-xl font-black tracking-tight ${
                  summaryKpis.kanbanHealth.coolingCount > 0 ? "text-primary" : "text-foreground"
                }`}
              >
                {summaryKpis.kanbanHealth.coolingCount}
              </span>
              <span className="text-xs font-bold text-muted-foreground">
                ({summaryKpis.kanbanHealth.coolingPct}% da carteira)
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Em risco:{" "}
              <strong className="text-foreground">
                {formatBrlCompact(summaryKpis.kanbanHealth.coolingValue)}
              </strong>
            </p>
          </div>
          <div className="pt-2 border-t border-border/60 flex items-center justify-between text-[10px] text-muted-foreground">
            <span>Fechamento vencido</span>
            <span className="font-bold text-foreground">
              {summaryKpis.kanbanHealth.overdueExpectedCloseCount} cards
            </span>
          </div>
        </div>

        {/* KPI 6: Disciplina de Follow-up & Propostas */}
        <div className="rounded-2xl bg-card border border-border p-4 shadow-soft flex flex-col justify-between">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">
              Disciplina & Propostas
            </span>
            <div className="h-7 w-7 rounded-lg bg-primary/10 text-primary grid place-items-center">
              <ListTodo className="h-3.5 w-3.5" />
            </div>
          </div>
          <div className="my-2">
            <div className="flex items-baseline gap-2">
              <span className="text-xl font-black text-foreground tracking-tight">
                {summaryKpis.discipline.openWithPendingTaskPct}%
              </span>
              <span className="text-[11px] font-semibold text-muted-foreground">
                com tarefa futura
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Sem tarefa:{" "}
              <strong className="text-primary">
                {summaryKpis.discipline.openWithoutTaskCount}
              </strong>{" "}
              · Atrasadas:{" "}
              <strong className="text-foreground">
                {summaryKpis.discipline.openWithOverdueTaskCount}
              </strong>
            </p>
          </div>
          <div className="pt-2 border-t border-border/60 flex items-center justify-between text-[10px] text-muted-foreground">
            <span>Propostas ({summaryKpis.discipline.proposalsCount})</span>
            <span className="font-bold text-foreground">
              {formatBrlCompact(summaryKpis.discipline.proposalsValue)}
            </span>
          </div>
        </div>
      </div>

      {/* ─── BLOCO 1: COMPARATIVO MULTI-FUNIL (TODOS OS FUNIS DO KANBAN) ────── */}
      <div className="rounded-2xl bg-card border border-border p-5 shadow-soft">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-xl bg-primary/10 text-primary grid place-items-center">
              <Layers className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-extrabold text-foreground">
                Desempenho Comparativo por Funil (Pipelines)
              </h3>
              <p className="text-[11px] text-muted-foreground">
                Clique em qualquer funil para isolar suas etapas, motivos de perda e métricas
              </p>
            </div>
          </div>
          {pipelineId !== "all" && (
            <button
              type="button"
              onClick={() => setPipelineId("all")}
              className="text-xs font-bold text-primary hover:underline cursor-pointer"
            >
              Ver todos os funis ({pipelinesBreakdown.length})
            </button>
          )}
        </div>

        {pipelinesBreakdown.length === 0 ? (
          <p className="text-xs text-muted-foreground py-6 text-center">
            Nenhum funil configurado ou visível para o seu perfil.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-border text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">
                  <th className="py-2.5 px-3">Funil (Pipeline)</th>
                  <th className="py-2.5 px-3 text-right">Em Aberto</th>
                  <th className="py-2.5 px-3 text-right">Volume Aberto (R$)</th>
                  <th className="py-2.5 px-3 text-right">Ganhas (Período)</th>
                  <th className="py-2.5 px-3 text-right">Perdidas</th>
                  <th className="py-2.5 px-3 text-right">Win Rate</th>
                  <th className="py-2.5 px-3 text-right">Ciclo Médio</th>
                  <th className="py-2.5 px-3 text-right">Esfriando</th>
                  <th className="py-2.5 px-3 text-right">Sem Tarefa</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50 text-xs">
                {pipelinesBreakdown.map((p) => {
                  const isSelected = pipelineId === p.id;
                  return (
                    <tr
                      key={p.id}
                      onClick={() => setPipelineId(isSelected ? "all" : p.id)}
                      className={`transition cursor-pointer ${
                        isSelected
                          ? "bg-primary/10 hover:bg-primary/15"
                          : "hover:bg-muted/30"
                      }`}
                    >
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-2">
                          <span
                            className={`h-2.5 w-2.5 rounded-full shrink-0 ${
                              isSelected ? "bg-primary" : "bg-muted-foreground/50"
                            }`}
                          />
                          <div>
                            <p className="font-extrabold text-foreground">{p.name}</p>
                            <p className="text-[10px] text-muted-foreground">
                              {p.shareOfOpenValuePct}% do pipeline aberto · Esfria em {p.coolingDays}d
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-3 text-right font-bold text-foreground">
                        {p.openCount}
                        {p.pausedCount > 0 && (
                          <span className="block text-[10px] text-muted-foreground font-normal">
                            +{p.pausedCount} pausadas
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-right">
                        <span className="font-extrabold text-foreground">
                          {formatBrlCompact(p.openValue)}
                        </span>
                        <span className="block text-[10px] text-muted-foreground">
                          TM: {formatBrlCompact(p.avgTicketOpen)}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right">
                        <span className="font-extrabold text-primary">
                          {formatBrlCompact(p.wonValue)}
                        </span>
                        <span className="block text-[10px] text-muted-foreground">
                          {p.wonCount} vendas
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right">
                        <span className="font-bold text-foreground">{p.lostCount}</span>
                        <span className="block text-[10px] text-muted-foreground">
                          {formatBrlCompact(p.lostValue)}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-lg text-[11px] font-extrabold border ${
                            p.winRate >= 30
                              ? "bg-primary/15 text-primary border-primary/30"
                              : "bg-muted/50 text-foreground border-border"
                          }`}
                        >
                          {p.winRate}%
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right font-semibold text-foreground">
                        {p.avgCycleDaysWon > 0 ? `${p.avgCycleDaysWon}d` : "—"}
                      </td>
                      <td className="py-3 px-3 text-right">
                        {p.coolingCount > 0 ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-extrabold bg-primary/12 text-primary border border-primary/25">
                            <Snowflake className="h-3 w-3" />
                            {p.coolingCount}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-right">
                        {p.withoutTaskCount > 0 ? (
                          <span className="font-bold text-foreground">
                            {p.withoutTaskCount}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ─── BLOCO 2: ARQUITETURA DE ETAPAS DO KANBAN, RETENÇÃO & GARGALOS ───── */}
      <div className="rounded-2xl bg-card border border-border p-5 shadow-soft">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-xl bg-primary/10 text-primary grid place-items-center">
              <Target className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-extrabold text-foreground">
                Raio-X de Etapas do Kanban, Avanço Passo a Passo & Gargalos
              </h3>
              <p className="text-[11px] text-muted-foreground">
                Volume estacionado por coluna, taxa histórica de avanço entre etapas, tempo médio parado e alertas de esfriamento
              </p>
            </div>
          </div>

          <div className="flex items-center bg-muted/40 p-1 rounded-xl border border-border/60 self-start sm:self-auto">
            <button
              type="button"
              onClick={() => setStageViewMode("funnel")}
              className={`px-3 py-1 rounded-lg text-[11px] font-bold transition cursor-pointer ${
                stageViewMode === "funnel"
                  ? "bg-primary text-primary-foreground shadow-soft"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Barras do Kanban
            </button>
            <button
              type="button"
              onClick={() => setStageViewMode("table")}
              className={`px-3 py-1 rounded-lg text-[11px] font-bold transition cursor-pointer ${
                stageViewMode === "table"
                  ? "bg-primary text-primary-foreground shadow-soft"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Matriz de Gargalos
            </button>
          </div>
        </div>

        {stagesBreakdown.length === 0 ? (
          <p className="text-xs text-muted-foreground py-6 text-center">
            Nenhuma etapa encontrada para o filtro selecionado.
          </p>
        ) : stageViewMode === "funnel" ? (
          <div className="space-y-2.5">
            {stagesBreakdown.map((st, idx) => {
              const barPct = Math.max(
                4,
                Math.round(
                  ((st.openValue > 0 ? st.openValue : st.openCount) /
                    (st.openValue > 0 ? maxStageOpenValue : maxStageOpenCount)) *
                    100
                )
              );
              const isOverCoolingAvg =
                st.coolingEnabled && st.avgStageAgeDays >= st.coolingDays && st.openCount > 0;

              return (
                <div
                  key={st.id}
                  className="rounded-xl bg-muted/25 border border-border/60 p-3 hover:border-border transition"
                >
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="h-6 min-w-6 px-1.5 rounded-lg bg-primary/12 border border-primary/25 text-primary text-[10px] font-black grid place-items-center shrink-0">
                        {st.abbreviation || idx + 1}
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-extrabold text-foreground truncate">
                            {st.name}
                          </span>
                          {pipelineId === "all" && (
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-muted text-muted-foreground border border-border">
                              {st.pipelineName}
                            </span>
                          )}
                          {st.isWinStage && (
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-primary/15 text-primary border border-primary/30">
                              Etapa de Ganho
                            </span>
                          )}
                          {st.isLossStage && (
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-muted text-muted-foreground border border-border">
                              Etapa de Perda
                            </span>
                          )}
                        </div>
                        {st.objective && (
                          <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                            {st.objective}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 text-xs shrink-0">
                      <div className="text-right">
                        <span className="font-extrabold text-foreground">
                          {st.openCount} abertas
                        </span>
                        <span className="text-muted-foreground mx-1">·</span>
                        <span className="font-extrabold text-primary">
                          {formatBrlCompact(st.openValue)}
                        </span>
                      </div>

                      <SystemTooltip content="Percentual histórico de negociações que entraram nesta etapa e avançaram para etapas seguintes">
                        <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-muted/60 text-foreground border border-border">
                          Avanço: {st.stageAdvanceRatePct}%
                        </span>
                      </SystemTooltip>

                      <SystemTooltip
                        content={`Idade média na etapa: ${st.avgStageAgeDays}d (Meta de esfriamento: ${st.coolingDays}d)`}
                      >
                        <span
                          className={`px-2 py-0.5 rounded-lg text-[10px] font-bold border ${
                            isOverCoolingAvg
                              ? "bg-primary/15 text-primary border-primary/30"
                              : "bg-muted/40 text-muted-foreground border-border/60"
                          }`}
                        >
                          Retenção: {st.avgStageAgeDays}d
                        </span>
                      </SystemTooltip>

                      {st.coolingCount > 0 && (
                        <SystemTooltip
                          content={`${st.coolingCount} cards esfriando nesta etapa (${formatBrlFull(st.coolingValue)})`}
                        >
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-extrabold bg-primary/15 text-primary border border-primary/30">
                            <Snowflake className="h-3 w-3" />
                            {st.coolingCount} esfriando
                          </span>
                        </SystemTooltip>
                      )}
                    </div>
                  </div>

                  {/* Barra de preenchimento proporcional na paleta oficial */}
                  <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary transition-all duration-500"
                      style={{ width: `${barPct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-border text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">
                  <th className="py-2.5 px-3">Etapa do Kanban</th>
                  {pipelineId === "all" && <th className="py-2.5 px-3">Funil</th>}
                  <th className="py-2.5 px-3 text-right">Abertas</th>
                  <th className="py-2.5 px-3 text-right">Valor Parado (R$)</th>
                  <th className="py-2.5 px-3 text-right">Passaram / Avançaram</th>
                  <th className="py-2.5 px-3 text-right">Taxa de Avanço</th>
                  <th className="py-2.5 px-3 text-right">Idade Média vs Meta</th>
                  <th className="py-2.5 px-3 text-right">Esfriando</th>
                  <th className="py-2.5 px-3 text-right">Sem Tarefa</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50 text-xs">
                {stagesBreakdown.map((st) => (
                  <tr key={st.id} className="hover:bg-muted/30 transition">
                    <td className="py-2.5 px-3 font-bold text-foreground">
                      <span className="inline-block w-6 text-[10px] font-extrabold text-primary">
                        {st.abbreviation}
                      </span>
                      {st.name}
                    </td>
                    {pipelineId === "all" && (
                      <td className="py-2.5 px-3 text-muted-foreground">{st.pipelineName}</td>
                    )}
                    <td className="py-2.5 px-3 text-right font-bold text-foreground">
                      {st.openCount} ({st.shareOfPipelineCountPct}%)
                    </td>
                    <td className="py-2.5 px-3 text-right font-extrabold text-primary">
                      {formatBrlCompact(st.openValue)}
                    </td>
                    <td className="py-2.5 px-3 text-right text-muted-foreground">
                      {st.historicalEnteredCount} → {st.historicalAdvancedCount}
                    </td>
                    <td className="py-2.5 px-3 text-right font-bold text-foreground">
                      {st.stageAdvanceRatePct}%
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <span
                        className={
                          st.avgStageAgeDays >= st.coolingDays && st.openCount > 0
                            ? "font-extrabold text-primary"
                            : "text-foreground"
                        }
                      >
                        {st.avgStageAgeDays}d
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {" "}
                        / {st.coolingDays}d
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right font-bold text-primary">
                      {st.coolingCount > 0
                        ? `${st.coolingCount} (${formatBrlCompact(st.coolingValue)})`
                        : "0"}
                    </td>
                    <td className="py-2.5 px-3 text-right font-semibold text-foreground">
                      {st.withoutTaskCount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ─── BLOCO 3: EVOLUÇÃO TEMPORAL DE VAZÃO (CRIADAS VS GANHAS VS PERDIDAS) ─ */}
      <div className="rounded-2xl bg-card border border-border p-5 shadow-soft">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-xl bg-primary/10 text-primary grid place-items-center">
              <TrendingUp className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-extrabold text-foreground">
                Evolução Diária de Vazão Comercial (Entradas vs. Fechamentos)
              </h3>
              <p className="text-[11px] text-muted-foreground">
                Comparativo diário entre novas oportunidades geradas, vendas ganhas e negociações perdidas
              </p>
            </div>
          </div>

          <div className="flex items-center bg-muted/40 p-1 rounded-xl border border-border/60 self-start sm:self-auto">
            <button
              type="button"
              onClick={() => setTimelineMetricMode("count")}
              className={`px-3 py-1 rounded-lg text-[11px] font-bold transition cursor-pointer ${
                timelineMetricMode === "count"
                  ? "bg-primary text-primary-foreground shadow-soft"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Quantidade de Cards
            </button>
            <button
              type="button"
              onClick={() => setTimelineMetricMode("value")}
              className={`px-3 py-1 rounded-lg text-[11px] font-bold transition cursor-pointer ${
                timelineMetricMode === "value"
                  ? "bg-primary text-primary-foreground shadow-soft"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Volume Financeiro (R$)
            </button>
          </div>
        </div>

        <div className="h-[260px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={timeline} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="crmPrimaryGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="var(--primary)" stopOpacity={0.0} />
                </linearGradient>
                <linearGradient id="crmMutedGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--muted-foreground)" stopOpacity={0.22} />
                  <stop offset="95%" stopColor="var(--muted-foreground)" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: "var(--muted-foreground)", fontSize: 11, fontWeight: 600 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: "var(--muted-foreground)", fontSize: 11, fontWeight: 600 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) =>
                  timelineMetricMode === "value" ? formatBrlCompact(Number(v)) : String(v)
                }
              />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload || payload.length === 0) return null;
                  return (
                    <div className="rounded-xl bg-card border border-border p-3 shadow-soft text-xs space-y-1.5">
                      <p className="font-extrabold text-foreground border-b border-border/60 pb-1">
                        Dia {label}
                      </p>
                      {payload.map((entry: any) => (
                        <div
                          key={entry.dataKey}
                          className="flex items-center justify-between gap-4"
                        >
                          <span className="text-muted-foreground font-semibold">
                            {entry.name}:
                          </span>
                          <span className="font-extrabold text-foreground">
                            {timelineMetricMode === "value"
                              ? formatBrlFull(Number(entry.value || 0))
                              : `${entry.value || 0} negociações`}
                          </span>
                        </div>
                      ))}
                    </div>
                  );
                }}
              />
              <Area
                type="monotone"
                dataKey={timelineMetricMode === "value" ? "createdValue" : "createdCount"}
                name="Criadas"
                stroke="var(--muted-foreground)"
                strokeWidth={2}
                fill="url(#crmMutedGrad)"
              />
              <Area
                type="monotone"
                dataKey={timelineMetricMode === "value" ? "wonValue" : "wonCount"}
                name="Ganhas (Won)"
                stroke="var(--primary)"
                strokeWidth={2.5}
                fill="url(#crmPrimaryGrad)"
              />
              <Area
                type="monotone"
                dataKey={timelineMetricMode === "value" ? "lostValue" : "lostCount"}
                name="Perdidas (Lost)"
                stroke="var(--foreground)"
                strokeWidth={1.5}
                strokeDasharray="4 4"
                fill="none"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ─── BLOCO 4: DIAGNÓSTICO DE PERDAS, VAZAMENTO POR ETAPA & PAUSADAS ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Painel 4.1: Motivos de Perda */}
        <div className="rounded-2xl bg-card border border-border p-5 shadow-soft flex flex-col">
          <div className="flex items-center justify-between gap-2 mb-3.5">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-xl bg-primary/10 text-primary grid place-items-center">
                <XCircle className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-sm font-extrabold text-foreground">
                  Motivos de Perda (Loss Reasons)
                </h3>
                <p className="text-[11px] text-muted-foreground">
                  Impacto financeiro e etapa onde a perda mais ocorre
                </p>
              </div>
            </div>
          </div>

          {lossesAndPauses.lossReasons.length === 0 ? (
            <p className="text-xs text-muted-foreground py-8 text-center my-auto">
              Nenhuma negociação perdida registrada no período selecionado.
            </p>
          ) : (
            <div className="space-y-2.5 overflow-y-auto max-h-[290px] pr-1">
              {lossesAndPauses.lossReasons.map((item) => (
                <div
                  key={item.reason}
                  className="rounded-xl bg-muted/25 border border-border/60 p-3 space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-extrabold text-foreground truncate">
                      {item.reason}
                    </span>
                    <span className="text-xs font-black text-primary shrink-0">
                      {item.count} ({item.shareCountPct}%)
                    </span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${Math.max(4, item.shareCountPct)}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                    <span>Valor perdido: {formatBrlCompact(item.value)}</span>
                    <span>
                      Etapa crítica: <strong className="text-foreground">{item.topStageName}</strong> ·{" "}
                      {item.avgDaysBeforeLoss}d
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Painel 4.2: Etapas com Maior Vazamento */}
        <div className="rounded-2xl bg-card border border-border p-5 shadow-soft flex flex-col">
          <div className="flex items-center gap-2 mb-3.5">
            <div className="h-8 w-8 rounded-xl bg-primary/10 text-primary grid place-items-center">
              <TrendingDown className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-extrabold text-foreground">
                Vazamento por Etapa do Kanban
              </h3>
              <p className="text-[11px] text-muted-foreground">
                Colunas onde as negociações são marcadas como perdidas
              </p>
            </div>
          </div>

          {lossesAndPauses.lossByStage.length === 0 ? (
            <p className="text-xs text-muted-foreground py-8 text-center my-auto">
              Sem perdas por etapa no período.
            </p>
          ) : (
            <div className="space-y-2.5 overflow-y-auto max-h-[290px] pr-1">
              {lossesAndPauses.lossByStage.map((st) => (
                <div
                  key={st.stageId}
                  className="rounded-xl bg-muted/25 border border-border/60 p-3 space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-extrabold text-foreground truncate">
                        {st.stageName}
                      </p>
                      <p className="text-[10px] text-muted-foreground truncate">
                        {st.pipelineName}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-xs font-black text-foreground">
                        {st.count} perdas ({st.sharePct}%)
                      </span>
                      <span className="block text-[10px] font-bold text-primary">
                        {formatBrlCompact(st.value)}
                      </span>
                    </div>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-muted-foreground"
                      style={{ width: `${Math.max(4, st.sharePct)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Painel 4.3: Negociações Pausadas / Congeladas */}
        <div className="rounded-2xl bg-card border border-border p-5 shadow-soft flex flex-col">
          <div className="flex items-center gap-2 mb-3.5">
            <div className="h-8 w-8 rounded-xl bg-primary/10 text-primary grid place-items-center">
              <PauseCircle className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-extrabold text-foreground">
                Negociações Pausadas (Em Espera)
              </h3>
              <p className="text-[11px] text-muted-foreground">
                Motivos de congelamento e tempo médio pausado
              </p>
            </div>
          </div>

          {lossesAndPauses.pausedReasons.length === 0 ? (
            <p className="text-xs text-muted-foreground py-8 text-center my-auto">
              Nenhuma negociação pausada neste momento.
            </p>
          ) : (
            <div className="space-y-2.5 overflow-y-auto max-h-[290px] pr-1">
              {lossesAndPauses.pausedReasons.map((item) => (
                <div
                  key={item.reason}
                  className="rounded-xl bg-muted/25 border border-border/60 p-3 space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-extrabold text-foreground truncate">
                      {item.reason}
                    </span>
                    <span className="text-xs font-bold text-foreground shrink-0">
                      {item.count} ({item.sharePct}%)
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                    <span>Valor congelado: {formatBrlCompact(item.value)}</span>
                    <span>Média pausada: {item.avgPausedDays} dias</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ─── BLOCO 5: PRODUTOS/PROPOSTAS, QUALIFICAÇÃO (★ / IA) & ORIGENS ───── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Painel 5.1: Top Produtos / Máquinas & Propostas */}
        <div className="rounded-2xl bg-card border border-border p-5 shadow-soft flex flex-col">
          <div className="flex items-center gap-2 mb-3.5">
            <div className="h-8 w-8 rounded-xl bg-primary/10 text-primary grid place-items-center">
              <Package className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-extrabold text-foreground">
                Produtos Cotados & Propostas Comerciais
              </h3>
              <p className="text-[11px] text-muted-foreground">
                Itens mais vinculados às negociações e taxa de aceite
              </p>
            </div>
          </div>

          {/* Mini-resumo de Propostas */}
          <div className="grid grid-cols-3 gap-2 mb-3.5 p-2.5 rounded-xl bg-muted/30 border border-border/60 text-center">
            <div>
              <p className="text-[10px] font-bold text-muted-foreground uppercase">Geradas</p>
              <p className="text-sm font-black text-foreground">
                {productsAndQualification.proposalsSummary.totalCount}
              </p>
              <p className="text-[10px] text-muted-foreground">
                {formatBrlCompact(productsAndQualification.proposalsSummary.totalValue)}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-bold text-muted-foreground uppercase">Enviadas</p>
              <p className="text-sm font-black text-foreground">
                {productsAndQualification.proposalsSummary.sentCount}
              </p>
              <p className="text-[10px] text-muted-foreground">
                Rascunhos: {productsAndQualification.proposalsSummary.draftCount}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-bold text-muted-foreground uppercase">Aceitas</p>
              <p className="text-sm font-black text-primary">
                {productsAndQualification.proposalsSummary.acceptedCount} (
                {productsAndQualification.proposalsSummary.conversionRatePct}%)
              </p>
              <p className="text-[10px] text-primary font-bold">
                {formatBrlCompact(productsAndQualification.proposalsSummary.acceptedValue)}
              </p>
            </div>
          </div>

          {productsAndQualification.topProducts.length === 0 ? (
            <p className="text-xs text-muted-foreground py-6 text-center my-auto">
              Nenhum produto ou equipamento vinculado às negociações do filtro atual.
            </p>
          ) : (
            <div className="space-y-2 overflow-y-auto max-h-[220px] pr-1">
              {productsAndQualification.topProducts.map((prod) => (
                <div
                  key={prod.productId}
                  className="rounded-xl bg-muted/20 border border-border/50 p-2.5 flex items-center justify-between gap-2 text-xs"
                >
                  <div className="min-w-0">
                    <p className="font-extrabold text-foreground truncate">{prod.name}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {prod.dealsCount} cards · Qtd: {prod.totalQuantity} · Win Rate:{" "}
                      <strong className="text-foreground">{prod.winRate}%</strong>
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-extrabold text-foreground">
                      {formatBrlCompact(prod.totalValue)}
                    </p>
                    <p className="text-[10px] font-bold text-primary">
                      Ganho: {formatBrlCompact(prod.wonValue)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Painel 5.2: Qualificação (Estrelas 1-5★ & Prioridade IA) */}
        <div className="rounded-2xl bg-card border border-border p-5 shadow-soft flex flex-col">
          <div className="flex items-center gap-2 mb-3.5">
            <div className="h-8 w-8 rounded-xl bg-primary/10 text-primary grid place-items-center">
              <Star className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-extrabold text-foreground">
                Qualificação de Leads (Rating ★ & Prioridade IA)
              </h3>
              <p className="text-[11px] text-muted-foreground">
                Conversão por temperatura comercial atribuída aos cards
              </p>
            </div>
          </div>

          <div className="space-y-2 mb-4">
            {productsAndQualification.ratingBreakdown.map((r) => (
              <div
                key={r.rating}
                className="flex items-center justify-between gap-2 rounded-xl bg-muted/20 border border-border/50 px-3 py-2 text-xs"
              >
                <div className="flex items-center gap-2">
                  <span className="font-extrabold text-foreground">{r.label}</span>
                  <span className="text-[10px] text-muted-foreground">({r.count} cards)</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[11px] font-semibold text-muted-foreground">
                    {formatBrlCompact(r.value)}
                  </span>
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-extrabold bg-primary/12 text-primary border border-primary/25">
                    Win {r.winRate}%
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="pt-3 border-t border-border/60">
            <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground mb-2">
              Prioridade Calculada por IA
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {productsAndQualification.aiPriorityBreakdown
                .filter((p) => p.count > 0)
                .map((p) => (
                  <div
                    key={p.level}
                    className="rounded-xl bg-muted/30 border border-border/60 p-2 text-center"
                  >
                    <p className="text-[10px] font-bold text-muted-foreground">{p.label}</p>
                    <p className="text-xs font-black text-foreground">{p.count} cards</p>
                    <p className="text-[10px] text-primary font-bold">
                      {formatBrlCompact(p.openValue)}
                    </p>
                  </div>
                ))}
            </div>
          </div>
        </div>

        {/* Painel 5.3: Aquisição por Origem & Campanha */}
        <div className="rounded-2xl bg-card border border-border p-5 shadow-soft flex flex-col">
          <div className="flex items-center gap-2 mb-3.5">
            <div className="h-8 w-8 rounded-xl bg-primary/10 text-primary grid place-items-center">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-extrabold text-foreground">
                Conversão por Origem & Campanha
              </h3>
              <p className="text-[11px] text-muted-foreground">
                Fontes que geram maior volume de fechamento real no CRM
              </p>
            </div>
          </div>

          <div className="space-y-2 overflow-y-auto max-h-[290px] pr-1">
            {productsAndQualification.sourcesBreakdown.map((s) => (
              <div
                key={s.source}
                className="rounded-xl bg-muted/25 border border-border/60 p-2.5 flex items-center justify-between gap-2 text-xs"
              >
                <div className="min-w-0">
                  <p className="font-extrabold text-foreground truncate">{s.source}</p>
                  <p className="text-[10px] text-muted-foreground">
                    Total: {s.totalDeals} · Abertas: {s.openCount} · Ganhas: {s.wonCount}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <span className="font-extrabold text-primary">
                    {formatBrlCompact(s.wonValue)}
                  </span>
                  <span className="block text-[10px] text-muted-foreground">
                    Win Rate: <strong className="text-foreground">{s.winRate}%</strong>
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ─── BLOCO 6: MATRIZ DE EXECUÇÃO NO CRM POR CONSULTOR ───────────────── */}
      <div className="rounded-2xl bg-card border border-border p-5 shadow-soft">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-xl bg-primary/10 text-primary grid place-items-center">
              <UserCheck className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-extrabold text-foreground">
                Matriz de Execução & Higiene do Kanban por Consultor
              </h3>
              <p className="text-[11px] text-muted-foreground">
                Carteira ativa, vendas ganhas, ciclo médio, negociações esfriando e disciplina de follow-up por responsável
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="h-3.5 w-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={consultantSearch}
                onChange={(e) => setConsultantSearch(e.target.value)}
                placeholder="Buscar consultor..."
                className="h-8 pl-8 pr-3 rounded-xl bg-muted/30 border border-border text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
              />
            </div>

            <div className="w-[180px]">
              <Select
                value={consultantSortBy}
                onValueChange={(v) => setConsultantSortBy(v as typeof consultantSortBy)}
              >
                <SelectTrigger className="h-8 text-xs bg-muted/30 border-border rounded-xl">
                  <SelectValue placeholder="Ordenar por" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="wonValue">Maior Receita Ganha</SelectItem>
                  <SelectItem value="openValue">Maior Pipeline Aberto</SelectItem>
                  <SelectItem value="winRate">Maior Win Rate (%)</SelectItem>
                  <SelectItem value="coolingCount">Mais Cards Esfriando</SelectItem>
                  <SelectItem value="withoutTaskCount">Mais Cards Sem Tarefa</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-border text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">
                <th className="py-2.5 px-3">Consultor</th>
                <th className="py-2.5 px-3 text-right">Abertas (R$)</th>
                <th className="py-2.5 px-3 text-right">Ganhas (Período)</th>
                <th className="py-2.5 px-3 text-right">Perdidas</th>
                <th className="py-2.5 px-3 text-right">Win Rate</th>
                <th className="py-2.5 px-3 text-right">Ticket Médio</th>
                <th className="py-2.5 px-3 text-right">Ciclo Médio</th>
                <th className="py-2.5 px-3 text-right">Esfriando</th>
                <th className="py-2.5 px-3 text-right">Sem Tarefa / Atrasadas</th>
                <th className="py-2.5 px-3 text-right">Atividades Concluídas</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50 text-xs">
              {filteredConsultants.map((c) => {
                const isImageAvatar =
                  c.avatar.startsWith("http") ||
                  c.avatar.startsWith("/") ||
                  c.avatar.startsWith("data:");
                return (
                  <tr
                    key={c.operatorId}
                    onClick={() =>
                      setOperatorId(operatorId === c.operatorId ? "all" : c.operatorId)
                    }
                    className={`transition cursor-pointer ${
                      operatorId === c.operatorId
                        ? "bg-primary/10 hover:bg-primary/15"
                        : "hover:bg-muted/30"
                    }`}
                  >
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-2.5">
                        {isImageAvatar ? (
                          <img
                            src={enhanceLegacyAvatarSrc(c.avatar)}
                            alt={c.name}
                            className="h-7 w-7 rounded-full object-cover border border-border shrink-0"
                          />
                        ) : (
                          <div className="h-7 w-7 rounded-full bg-primary/15 border border-primary/30 text-primary text-[10px] font-black grid place-items-center shrink-0">
                            {c.avatar.slice(0, 2).toUpperCase()}
                          </div>
                        )}
                        <div>
                          <p className="font-extrabold text-foreground">{c.name}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {c.totalDeals} cards totais
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <span className="font-extrabold text-foreground">
                        {formatBrlCompact(c.openValue)}
                      </span>
                      <span className="block text-[10px] text-muted-foreground">
                        {c.openCount} abertas
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <span className="font-extrabold text-primary">
                        {formatBrlCompact(c.wonValue)}
                      </span>
                      <span className="block text-[10px] text-muted-foreground">
                        {c.wonCount} vendas
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right font-semibold text-foreground">
                      {c.lostCount}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <span
                        className={`px-2 py-0.5 rounded-lg text-[11px] font-extrabold border ${
                          c.winRate >= 30
                            ? "bg-primary/15 text-primary border-primary/30"
                            : "bg-muted/50 text-foreground border-border"
                        }`}
                      >
                        {c.winRate}%
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right font-semibold text-foreground">
                      {c.avgTicketWon > 0 ? formatBrlCompact(c.avgTicketWon) : "—"}
                    </td>
                    <td className="py-2.5 px-3 text-right font-semibold text-foreground">
                      {c.avgCycleDaysWon > 0 ? `${c.avgCycleDaysWon}d` : "—"}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      {c.coolingCount > 0 ? (
                        <span className="px-2 py-0.5 rounded-lg text-[11px] font-extrabold bg-primary/15 text-primary border border-primary/30">
                          {c.coolingCount}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <span className="font-bold text-foreground">{c.withoutTaskCount}</span>
                      <span className="text-muted-foreground"> / </span>
                      <span
                        className={
                          c.overdueTaskCount > 0
                            ? "font-extrabold text-primary"
                            : "text-muted-foreground"
                        }
                      >
                        {c.overdueTaskCount}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right font-bold text-foreground">
                      {c.activitiesCompletedPeriod}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ─── BLOCO 7: RADAR ACIONÁVEL DE NEGOCIAÇÕES CRÍTICAS NO KANBAN ─────── */}
      <div className="rounded-2xl bg-card border border-border p-5 shadow-soft">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-xl bg-primary/10 text-primary grid place-items-center">
              <Flame className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-extrabold text-foreground">
                Radar de Intervenção Imediata (Negociações Críticas em Aberto)
              </h3>
              <p className="text-[11px] text-muted-foreground">
                Cards de alto valor, esfriando no Kanban, sem próxima tarefa ou com data de fechamento vencida
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {(
              [
                { id: "all", label: "Todas Críticas" },
                { id: "cooling", label: "Esfriando" },
                { id: "no_task", label: "Sem Tarefa" },
                { id: "overdue_task", label: "Tarefa Atrasada" },
                { id: "overdue_close", label: "Fechamento Vencido" },
              ] as const
            ).map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setRadarFilter(f.id)}
                className={`px-2.5 py-1 rounded-xl text-[11px] font-bold border transition cursor-pointer ${
                  radarFilter === f.id
                    ? "bg-primary text-primary-foreground border-primary shadow-soft"
                    : "bg-muted/30 text-muted-foreground border-border hover:text-foreground"
                }`}
              >
                {f.label}
              </button>
            ))}

            <div className="relative">
              <Search className="h-3.5 w-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={radarSearch}
                onChange={(e) => setRadarSearch(e.target.value)}
                placeholder="Filtrar card ou cliente..."
                className="h-8 pl-8 pr-3 rounded-xl bg-muted/30 border border-border text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
              />
            </div>
          </div>
        </div>

        {filteredRadarDeals.length === 0 ? (
          <p className="text-xs text-muted-foreground py-8 text-center">
            Nenhuma negociação crítica encontrada para o filtro selecionado.
          </p>
        ) : (
          <div className="overflow-x-auto max-h-[380px]">
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 bg-card z-10">
                <tr className="border-b border-border text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">
                  <th className="py-2.5 px-3">Negociação / Cliente</th>
                  <th className="py-2.5 px-3">Funil & Etapa</th>
                  <th className="py-2.5 px-3">Consultor</th>
                  <th className="py-2.5 px-3 text-right">Valor (R$)</th>
                  <th className="py-2.5 px-3 text-right">Inatividade / Etapa</th>
                  <th className="py-2.5 px-3">Alertas de Governança</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50 text-xs">
                {filteredRadarDeals.map((d) => (
                  <tr key={d.id} className="hover:bg-muted/30 transition">
                    <td className="py-2.5 px-3">
                      <p className="font-extrabold text-foreground">{d.title}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {d.accountName || d.contactName || "Sem empresa vinculada"}
                        {d.rating > 0 ? ` · ${d.rating}★` : ""}
                      </p>
                    </td>
                    <td className="py-2.5 px-3">
                      <p className="font-bold text-foreground">{d.stageName}</p>
                      <p className="text-[10px] text-muted-foreground">{d.pipelineName}</p>
                    </td>
                    <td className="py-2.5 px-3 font-semibold text-foreground">
                      {d.operatorName}
                    </td>
                    <td className="py-2.5 px-3 text-right font-extrabold text-primary">
                      {formatBrlFull(d.value)}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <span
                        className={
                          d.isCooling ? "font-extrabold text-primary" : "text-foreground"
                        }
                      >
                        {d.daysSinceLastActivity}d sem ação
                      </span>
                      <span className="block text-[10px] text-muted-foreground">
                        {d.daysInStage}d na etapa · {d.daysInFunnel}d no funil
                      </span>
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {d.isCooling && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-extrabold bg-primary/15 text-primary border border-primary/30">
                            <Snowflake className="h-2.5 w-2.5" />
                            Esfriando (&gt;{d.coolingDaysThreshold}d)
                          </span>
                        )}
                        {!d.hasPendingTask && d.status === "open" && (
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-muted text-foreground border border-border">
                            Sem próxima tarefa
                          </span>
                        )}
                        {d.hasOverdueTask && (
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-extrabold bg-primary/15 text-primary border border-primary/30">
                            {d.overdueTasksCount} tarefa(s) atrasada(s)
                          </span>
                        )}
                        {d.isExpectedCloseOverdue && (
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-muted text-muted-foreground border border-border">
                            Previsão vencida
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
