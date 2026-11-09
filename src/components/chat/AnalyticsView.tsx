import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useChat } from "@/hooks/useChatState";
import { useTabNavigation } from "@/hooks/useTabNavigation";
import {
  BarChart2, Clock, Users, ArrowUpRight, ArrowDownRight,
  MessageSquare, RefreshCw, Percent, FileText, CheckCircle2,
  AlertTriangle, Info, Shield, HelpCircle, Activity, Star,
  TrendingUp, TrendingDown, Eye, Coins, Globe, Phone, Zap,
  Search, ArrowUpDown, Filter, Award, Briefcase, DollarSign,
  Bot, Layers, PhoneCall, Building2, UserCheck, ListTodo,
  Sparkles, Calendar, Mail, Smartphone, ArrowRight
} from "lucide-react";
// Componentes migrados do Monitoramento
import { OverviewTab, CostsTab } from "@/components/chat/MonitorView";
import { WhatsappLogo } from "@/components/chat/ChatList";
import { SystemTooltip } from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ReportsIATab } from "@/components/reports/ReportsIATab";
import {
  ContactsAnalyticsTab,
  type ContactsAnalyticsPayload,
} from "@/components/chat/ContactsAnalyticsTab";
import { usePermissions } from "@/hooks/usePermissions";
import { getInitialTabFromUrl, useSyncModuleTabWithUrl } from "@/lib/app-routes";
import { enhanceLegacyAvatarSrc } from "@/lib/avatar-image";
import { getAiPersona } from "@/lib/ai-persona";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, BarChart, Bar, Cell, PieChart, Pie
} from "recharts";

// ── Tipos ───────────────────────────────────────────────────────────────────
type AnalyticsTab = "overview" | "performance" | "sla" | "contacts" | "reports" | "costs";

type PerformancePeriod = "today" | "7d" | "15d" | "30d" | "month";
type PerformanceChannelFilter = "all" | "meta_official" | "baileys_linked";

type HistoricalVolume = {
  name: string;
  dateKey?: string;
  chats: number;
  novas?: number;
  recorrentes?: number;
  atendidos: number;
  respondidas?: number;
  concluidas?: number;
  mensagensRecebidas?: number;
  mensagensEnviadas?: number;
  sla: number;
};

type ChannelVolume = {
  key?: string;
  name: string;
  value: number;
  activeNow?: number;
  completed?: number;
  color: string;
  subtitle?: string;
  connectedCount?: number;
  totalConnections?: number;
  status?: "online" | "warning" | "offline" | "idle";
};

type SectorPerformance = {
  name: string;
  avgResponse: number | null;
  completed: number;
  slaPct: number | null;
};

type SectorDetailPerformance = {
  id: string;
  name: string;
  category?: "sector" | "division" | "unassigned";
  operatorsTotal: number;
  operatorsOnline: number;
  inQueue: number;
  inAttendance: number;
  completed: number;
  activeInPeriod: number;
  messagesSent: number;
  avgResponse: number | null;
  slaPct: number | null;
  withinSla: number;
  overdueSla: number;
  avgQaScore: number | null;
  dealsOpen: number;
  dealsWon: number;
  wonValue: number;
  pipelineValue: number;
};

type PerformanceKpis = {
  activeConversationsInPeriod: number;
  activeConversationsDeltaPct: number | null;
  newConversationsInPeriod: number;
  newConversationsDeltaPct: number | null;
  recurringConversationsInPeriod: number;
  attendedInPeriod: number;
  completedInPeriod: number;
  completedDeltaPct: number | null;
  resolutionRatePct: number;
  inQueueNow: number;
  inAttendanceNow: number;
  inAutomationNow: number;
  unansweredOver15mCount: number;
  inboundMessagesInPeriod: number;
  outboundMessagesInPeriod: number;
  totalMessagesInPeriod: number;
  messagesDeltaPct: number | null;
  avgResponseSeconds: number;
  overallSlaPct: number;
  withinSlaCount: number;
  overdueSlaCount: number;
  avgFirstPickupAfterTriageSeconds: number | null;
  avgQaScore: number | null;
  qaAuditedCount: number;
  totalCallsInPeriod: number;
  answeredCallsInPeriod: number;
  missedCallsInPeriod: number;
  totalCallDurationSeconds: number;
  crmDealsCreatedInPeriod: number;
  crmDealsCreatedDeltaPct: number | null;
  openDealsCount: number;
  openPipelineValue: number;
  wonDealsInPeriod: number;
  wonValueInPeriod: number;
  wonValueDeltaPct: number | null;
  lostDealsInPeriod: number;
  lostValueInPeriod: number;
  winRatePct: number;
  avgTicketWon: number;
};

type OperationalFunnel = {
  inAutomation: number;
  inQueue: number;
  inAttendance: number;
  withOpenDeal: number;
  completedInPeriod: number;
  totalActiveNow: number;
};

type HourlyDemandPoint = {
  hour: string;
  hourNum: number;
  recebidas: number;
  respondidas: number;
  slaOverdue: number;
};

type ConsultantProductivityItem = {
  id: string;
  name: string;
  role: string;
  avatar: string | null;
  online: boolean;
  sectorName: string;
  divisionLabel: string;
  activeChatsNow: number;
  handledInPeriod: number;
  completedInPeriod: number;
  messagesSent: number;
  messagesReceived: number;
  callsTotal: number;
  callsAnswered: number;
  callSeconds: number;
  tasksCompleted: number;
  tasksOpen: number;
  avgResponseSeconds: number;
  slaPct: number | null;
  overdueSlaCount: number;
  avgQaScore: number | null;
  dealsOpen: number;
  pipelineValue: number;
  dealsWon: number;
  wonValue: number;
  dealsLost: number;
  conversionRatePct: number;
};

type TriageSummaryData = {
  totalTriagedInPeriod: number;
  inProgressNow: number;
  completedTriageCount: number;
  transferredToHuman: number;
  qualificationRatePct: number;
  avgPickupSeconds: number | null;
  topFunnels: { name: string; count: number }[];
};

type PerformanceFilterOptions = {
  sectors: { id: string; name: string }[];
  divisions: { id: string; name: string }[];
  channels: { id: string; name: string }[];
};

type PerformancePayload = {
  period?: PerformancePeriod;
  periodDays?: number;
  volumes: HistoricalVolume[];
  channels: ChannelVolume[];
  sectors: SectorPerformance[];
  sectorDetails?: SectorDetailPerformance[];
  kpis?: PerformanceKpis;
  operationalFunnel?: OperationalFunnel;
  hourlyDemand?: HourlyDemandPoint[];
  consultantProductivity?: ConsultantProductivityItem[];
  triageSummary?: TriageSummaryData;
  filterOptions?: PerformanceFilterOptions;
};

type OperatorPerformance = {
  id?: string;
  name: string;
  avatar?: string | null;
  chats: number;
  avgResponseSeconds: number;
  slaPct: number;
  slaSampleCount?: number;
  overdueCount?: number;
  withinSlaCount?: number;
};

type ClientMetric = {
  name: string;
  novos: number;
  recorrentes: number;
};

type AiReportData = {
  id: string;
  type: "daily" | "weekly";
  period: string;
  reportMarkdown: string;
  generatedAt: string;
};

// ── Helpers Visuais & Formatação ─────────────────────────────────────────────

function formatDurationHuman(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || seconds <= 0) return "–";
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const totalMinutes = Math.floor(s / 60);
  const remSeconds = s % 60;
  if (totalMinutes < 60) {
    return remSeconds > 0 ? `${totalMinutes}min ${remSeconds}s` : `${totalMinutes}min`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const remMinutes = totalMinutes % 60;
  return remMinutes > 0 ? `${hours}h ${remMinutes}min` : `${hours}h`;
}

function getOperatorInitials(name: string): string {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "OP";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function OperatorAvatarBadge({
  name,
  avatar,
  highlight = false,
}: {
  name: string;
  avatar?: string | null;
  highlight?: boolean;
}) {
  const resolvedAvatar = avatar ? enhanceLegacyAvatarSrc(avatar) : null;
  if (resolvedAvatar) {
    return (
      <img
        src={resolvedAvatar}
        alt={name}
        className={`h-7 w-7 rounded-full object-cover shrink-0 border ${
          highlight ? "border-primary/40" : "border-border"
        }`}
      />
    );
  }
  return (
    <div
      className={`h-7 w-7 rounded-full shrink-0 flex items-center justify-center text-[10px] font-extrabold border ${
        highlight
          ? "bg-primary/15 text-primary border-primary/30"
          : "bg-muted text-muted-foreground border-border"
      }`}
    >
      {getOperatorInitials(name)}
    </div>
  );
}

function SystemChartTooltip({
  active,
  payload,
  label,
  valueSuffix = "",
}: {
  active?: boolean;
  payload?: any[];
  label?: string;
  valueSuffix?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="bg-card/95 backdrop-blur-md border border-border rounded-xl p-3 shadow-card min-w-[150px]">
      {label && (
        <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground border-b border-line pb-1.5 mb-2">
          {label}
        </p>
      )}
      <div className="space-y-1.5">
        {payload.map((entry: any, idx: number) => (
          <div key={idx} className="flex items-center justify-between gap-4 text-xs">
            <div className="flex items-center gap-1.5">
              <span
                className="h-2 w-2 rounded-full shrink-0"
                style={{ background: entry.color || entry.fill || "var(--primary)" }}
              />
              <span className="text-muted-foreground font-medium">{entry.name}:</span>
            </div>
            <span className="font-extrabold text-foreground tabular-nums">
              {entry.value}
              {valueSuffix}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SlaPrecisionGauge({
  pct,
  targetPct = 90,
}: {
  pct: number;
  targetPct?: number;
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  const size = 188;
  const cx = size / 2;
  const cy = size / 2;
  const r = 70;
  const strokeWidth = 12;
  const circumference = 2 * Math.PI * r;
  const dashOffset = circumference * (1 - clamped / 100);

  // Ângulo da meta (ex: 90% partindo do topo -90deg)
  const targetAngleRad = ((targetPct / 100) * 360 - 90) * (Math.PI / 180);
  const targetInnerX = cx + (r - strokeWidth / 2 - 3) * Math.cos(targetAngleRad);
  const targetInnerY = cy + (r - strokeWidth / 2 - 3) * Math.sin(targetAngleRad);
  const targetOuterX = cx + (r + strokeWidth / 2 + 3) * Math.cos(targetAngleRad);
  const targetOuterY = cy + (r + strokeWidth / 2 + 3) * Math.sin(targetAngleRad);

  // Ponto final do arco atual
  const endAngleRad = ((clamped / 100) * 360 - 90) * (Math.PI / 180);
  const endDotX = cx + r * Math.cos(endAngleRad);
  const endDotY = cy + r * Math.sin(endAngleRad);

  const isOnTarget = clamped >= targetPct;
  const diffFromTarget = clamped - targetPct;

  return (
    <div className="relative flex flex-col items-center justify-center my-2">
      <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
        <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-full overflow-visible">
          <defs>
            <linearGradient id="slaRingGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="var(--primary)" />
              <stop offset="100%" stopColor="color-mix(in srgb, var(--primary) 75%, var(--foreground))" />
            </linearGradient>
            <filter id="slaRingGlow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="2" stdDeviation="4" floodColor="var(--primary)" floodOpacity="0.28" />
            </filter>
          </defs>

          {/* Anel externo sutil de referência */}
          <circle
            cx={cx}
            cy={cy}
            r={r + 12}
            fill="none"
            stroke="var(--border)"
            strokeWidth="1"
            strokeDasharray="2 4"
            opacity="0.6"
          />

          {/* Trilha de fundo (0 a 100% real) */}
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke="var(--muted)"
            strokeWidth={strokeWidth}
          />

          {/* Arco de preenchimento proporcional real (0 a 100%) */}
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke="url(#slaRingGrad)"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            transform={`rotate(-90 ${cx} ${cy})`}
            filter="url(#slaRingGlow)"
            style={{ transition: "stroke-dashoffset 700ms cubic-bezier(0.16, 1, 0.3, 1)" }}
          />

          {/* Marcador da Meta de 90% na trilha */}
          <line
            x1={targetInnerX}
            y1={targetInnerY}
            x2={targetOuterX}
            y2={targetOuterY}
            stroke="var(--foreground)"
            strokeWidth="2"
            strokeLinecap="round"
            opacity="0.75"
          />

          {/* Indicador na ponta do progresso */}
          {clamped > 0 && (
            <circle
              cx={endDotX}
              cy={endDotY}
              r={4.5}
              fill="var(--card)"
              stroke="var(--primary)"
              strokeWidth={2.5}
            />
          )}
        </svg>

        {/* Conteúdo Central do Anel */}
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-4">
          <span className="text-3xl font-black text-foreground tracking-tight tabular-nums leading-none">
            {clamped}%
          </span>
          <span
            className={`mt-1.5 text-[9px] font-extrabold uppercase tracking-wider px-2.5 py-0.5 rounded-full border ${
              isOnTarget
                ? "text-primary bg-primary/10 border-primary/25"
                : "text-foreground bg-muted border-border"
            }`}
          >
            {isOnTarget ? "DENTRO DA META" : "ATENÇÃO"}
          </span>
          <span className="mt-1 text-[10px] font-semibold text-muted-foreground tabular-nums">
            Meta {targetPct}% ({diffFromTarget >= 0 ? `+${diffFromTarget}%` : `${diffFromTarget}%`})
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Helpers de Renderização de Markdown Simples ──────────────────────────────
function parseMarkdown(md: string) {
  if (!md) return null;
  const lines = md.split("\n");
  
  return lines.map((line, idx) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("## ")) {
      return (
        <h2 key={idx} className="text-sm font-extrabold text-foreground mt-4 mb-2 border-b border-line pb-1.5 flex items-center gap-1.5">
          <Activity className="h-4 w-4 text-primary" />
          {trimmed.slice(3)}
        </h2>
      );
    }
    if (trimmed.startsWith("### ")) {
      return (
        <h3 key={idx} className="text-xs font-bold text-foreground mt-3 mb-1.5">
          {trimmed.slice(4)}
        </h3>
      );
    }
    if (trimmed.startsWith("* ") || trimmed.startsWith("- ")) {
      return (
        <li key={idx} className="text-xs text-muted-foreground list-disc list-inside ml-3 py-0.5">
          {trimmed.slice(2)}
        </li>
      );
    }
    if (trimmed.startsWith("> [!NOTE]")) {
      return null;
    }
    if (line.startsWith("> ")) {
      return (
        <div key={idx} className="my-3 p-3 bg-primary-soft/50 border border-primary/20 text-foreground rounded-xl text-xs flex gap-2">
          <Info className="h-4.5 w-4.5 text-primary shrink-0 mt-0.5" />
          <div className="font-medium">{line.replace(/^>\s*(\[!NOTE\])?\s*/i, "").trim()}</div>
        </div>
      );
    }
    if (!trimmed) {
      return <div key={idx} className="h-2" />;
    }
    return (
      <p key={idx} className="text-xs text-muted-foreground leading-relaxed py-0.5">
        {trimmed}
      </p>
    );
  });
}

// ── Sub-Views ────────────────────────────────────────────────────────────────

// 1. Aba: Desempenho Executivo & Visão da Diretoria
function formatCurrencyBRL(value: number | null | undefined, compact = false): string {
  const num = Number(value || 0);
  if (!Number.isFinite(num) || num === 0) return "R$ 0";
  if (compact && Math.abs(num) >= 1_000_000) {
    return `R$ ${(num / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}M`;
  }
  if (compact && Math.abs(num) >= 10_000) {
    return `R$ ${(num / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}k`;
  }
  return num.toLocaleString("pt-BR", {
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
  if (delta === null || delta === undefined) {
    return (
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground text-[9px] font-bold border border-line">
        Estável
      </span>
    );
  }
  if (delta === 0) {
    return (
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground text-[9px] font-bold border border-line tabular-nums">
        0%
      </span>
    );
  }
  const isPositiveGood = inverse ? delta < 0 : delta > 0;
  const Icon = delta > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <SystemTooltip
      content={`Variação de ${delta > 0 ? `+${delta}%` : `${delta}%`} em comparação com a janela equivalente anterior`}
      side="top"
    >
      <span
        className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[9px] font-extrabold border tabular-nums ${
          isPositiveGood
            ? "bg-primary/10 text-primary border-primary/25"
            : "bg-muted text-muted-foreground border-border"
        }`}
      >
        <Icon className="h-2.5 w-2.5" />
        {delta > 0 ? `+${delta}%` : `${delta}%`}
      </span>
    </SystemTooltip>
  );
}

function PerformanceTab({
  tenant,
  data,
  period,
  onChangePeriod,
  sectorFilter,
  onChangeSectorFilter,
  channelFilter,
  onChangeChannelFilter,
  loading,
}: {
  tenant: string;
  data: PerformancePayload;
  period: PerformancePeriod;
  onChangePeriod: (p: PerformancePeriod) => void;
  sectorFilter: string;
  onChangeSectorFilter: (s: string) => void;
  channelFilter: PerformanceChannelFilter;
  onChangeChannelFilter: (c: PerformanceChannelFilter) => void;
  loading?: boolean;
}) {
  const {
    volumes = [],
    channels = [],
    sectors = [],
    sectorDetails = [],
    kpis,
    operationalFunnel,
    hourlyDemand = [],
    consultantProductivity = [],
    triageSummary,
    filterOptions,
  } = data;

  const persona = useMemo(() => getAiPersona(tenant), [tenant]);

  const [volumeChartMode, setVolumeChartMode] = useState<"chats" | "messages">("chats");
  const [consultantSearch, setConsultantSearch] = useState("");
  const [consultantFilterMode, setConsultantFilterMode] = useState<"active" | "all">("active");
  const [consultantSortBy, setConsultantSortBy] = useState<
    "handled" | "messages" | "tme" | "sla" | "qa" | "won"
  >("handled");

  // Totais derivados para fallback se kpis não vier preenchido
  const totalVolumeChannels = useMemo(
    () => channels.reduce((sum, c) => sum + (c.value || 0), 0),
    [channels]
  );
  const totalRecebidasPeriodo =
    kpis?.activeConversationsInPeriod ??
    volumes.reduce((sum, v) => sum + (v.chats || 0), 0);
  const totalAtendidasPeriodo =
    kpis?.attendedInPeriod ??
    volumes.reduce((sum, v) => sum + (v.atendidos || 0), 0);
  const totalConcluidasPeriodo =
    kpis?.completedInPeriod ??
    volumes.reduce((sum, v) => sum + (v.concluidas ?? v.atendidos ?? 0), 0);
  const resolutionRatePct =
    kpis?.resolutionRatePct ??
    (totalRecebidasPeriodo > 0
      ? Math.min(100, Math.round((totalAtendidasPeriodo / totalRecebidasPeriodo) * 100))
      : 0);

  const totalMsgsIn =
    kpis?.inboundMessagesInPeriod ??
    volumes.reduce((sum, v) => sum + (v.mensagensRecebidas || 0), 0);
  const totalMsgsOut =
    kpis?.outboundMessagesInPeriod ??
    volumes.reduce((sum, v) => sum + (v.mensagensEnviadas || 0), 0);

  // Horário de pico comercial detectado
  const peakHourInfo = useMemo(() => {
    if (!hourlyDemand || hourlyDemand.length === 0) return null;
    let best = hourlyDemand[0];
    for (const h of hourlyDemand) {
      if ((h.recebidas || 0) > (best.recebidas || 0)) {
        best = h;
      }
    }
    return best && best.recebidas > 0 ? best : null;
  }, [hourlyDemand]);

  // Setores detalhados ou fallback para formato básico
  const effectiveSectorDetails: SectorDetailPerformance[] = useMemo(() => {
    if (sectorDetails && sectorDetails.length > 0) {
      return [...sectorDetails].sort((a, b) => {
        if (b.activeInPeriod !== a.activeInPeriod) return b.activeInPeriod - a.activeInPeriod;
        if (b.completed !== a.completed) return b.completed - a.completed;
        return (b.slaPct ?? -1) - (a.slaPct ?? -1);
      });
    }
    return [...sectors]
      .sort((a, b) => {
        if (b.completed !== a.completed) return b.completed - a.completed;
        return (b.slaPct ?? -1) - (a.slaPct ?? -1);
      })
      .map((s, idx) => ({
        id: `sec-${idx}`,
        name: s.name,
        category: "sector",
        operatorsTotal: 0,
        operatorsOnline: 0,
        inQueue: 0,
        inAttendance: 0,
        completed: s.completed,
        activeInPeriod: s.completed,
        messagesSent: 0,
        avgResponse: s.avgResponse,
        slaPct: s.slaPct,
        withinSla: 0,
        overdueSla: 0,
        avgQaScore: null,
        dealsOpen: 0,
        dealsWon: 0,
        wonValue: 0,
        pipelineValue: 0,
      }));
  }, [sectorDetails, sectors]);

  const maxSectorActive = useMemo(
    () =>
      Math.max(
        1,
        ...effectiveSectorDetails.map((s) => Math.max(s.activeInPeriod || 0, s.completed || 0))
      ),
    [effectiveSectorDetails]
  );

  // Produtividade por consultor filtrada e ordenada
  const filteredConsultants = useMemo(() => {
    const q = consultantSearch.trim().toLowerCase();
    return consultantProductivity
      .filter((c) => {
        if (consultantFilterMode === "active") {
          const hasActivity =
            c.handledInPeriod > 0 ||
            c.activeChatsNow > 0 ||
            c.messagesSent > 0 ||
            c.callsTotal > 0 ||
            c.dealsOpen > 0 ||
            c.dealsWon > 0;
          if (!hasActivity) return false;
        }
        if (!q) return true;
        return (
          c.name.toLowerCase().includes(q) ||
          c.sectorName.toLowerCase().includes(q) ||
          c.divisionLabel.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        if (consultantSortBy === "won") {
          if (b.wonValue !== a.wonValue) return b.wonValue - a.wonValue;
          return b.dealsWon - a.dealsWon;
        }
        if (consultantSortBy === "messages") {
          return b.messagesSent - a.messagesSent;
        }
        if (consultantSortBy === "tme") {
          const aTme = a.avgResponseSeconds > 0 ? a.avgResponseSeconds : 999999;
          const bTme = b.avgResponseSeconds > 0 ? b.avgResponseSeconds : 999999;
          return aTme - bTme;
        }
        if (consultantSortBy === "sla") {
          return (b.slaPct ?? -1) - (a.slaPct ?? -1);
        }
        if (consultantSortBy === "qa") {
          return (b.avgQaScore ?? -1) - (a.avgQaScore ?? -1);
        }
        if (b.handledInPeriod !== a.handledInPeriod) return b.handledInPeriod - a.handledInPeriod;
        return b.messagesSent - a.messagesSent;
      });
  }, [consultantProductivity, consultantSearch, consultantFilterMode, consultantSortBy]);

  const channelPalette = [
    "var(--primary)",
    "color-mix(in srgb, var(--primary) 65%, var(--muted-foreground))",
    "var(--muted-foreground)",
    "color-mix(in srgb, var(--primary) 35%, var(--muted-foreground))",
    "color-mix(in srgb, var(--muted-foreground) 65%, var(--border))",
  ];

  const periodOptions: { id: PerformancePeriod; label: string; tip: string }[] = [
    { id: "today", label: "Hoje", tip: "Indicadores consolidados de hoje (fuso de Brasília)" },
    { id: "7d", label: "7 dias", tip: "Últimos 7 dias corridos comparado aos 7 dias anteriores" },
    { id: "15d", label: "15 dias", tip: "Últimos 15 dias corridos comparado aos 15 dias anteriores" },
    { id: "30d", label: "30 dias", tip: "Últimos 30 dias corridos comparado aos 30 dias anteriores" },
    { id: "month", label: "Este Mês", tip: "Acumulado do mês vigente desde o dia 01" },
  ];

  const channelOptions: { id: PerformanceChannelFilter; label: string; tip: string }[] = [
    { id: "all", label: "Todos os Canais", tip: "Consolidar todos os canais de comunicação" },
    {
      id: "meta_official",
      label: "WhatsApp Oficial",
      tip: "Filtrar apenas conversas do WhatsApp Oficial Corporativo (Meta Cloud API)",
    },
    {
      id: "baileys_linked",
      label: "Celulares Vinculados",
      tip: "Filtrar apenas conversas de aparelhos celulares vinculados via QR Code (Baileys)",
    },
  ];

  const funnelStages = useMemo(() => {
    const f = operationalFunnel || {
      inAutomation: kpis?.inAutomationNow ?? 0,
      inQueue: kpis?.inQueueNow ?? 0,
      inAttendance: kpis?.inAttendanceNow ?? 0,
      withOpenDeal: kpis?.openDealsCount ?? 0,
      completedInPeriod: totalConcluidasPeriodo,
      totalActiveNow: 0,
    };
    const maxStage = Math.max(
      1,
      f.inAutomation,
      f.inQueue,
      f.inAttendance,
      f.withOpenDeal,
      f.completedInPeriod
    );
    return [
      {
        key: "automation",
        label: `Triagem IA (${persona.name})`,
        sub: "Recepção e qualificação ativa",
        value: f.inAutomation,
        pct: Math.round((f.inAutomation / maxStage) * 100),
        icon: Bot,
        highlight: false,
      },
      {
        key: "queue",
        label: "Na Fila de Espera",
        sub: "Aguardando consultor assumir",
        value: f.inQueue,
        pct: Math.round((f.inQueue / maxStage) * 100),
        icon: Clock,
        highlight: f.inQueue > 5,
      },
      {
        key: "attendance",
        label: "Em Atendimento",
        sub: "Carteira ativa com consultores",
        value: f.inAttendance,
        pct: Math.round((f.inAttendance / maxStage) * 100),
        icon: MessageSquare,
        highlight: false,
      },
      {
        key: "crm",
        label: "Com Negociação CRM",
        sub: "Oportunidade comercial aberta",
        value: f.withOpenDeal,
        pct: Math.round((f.withOpenDeal / maxStage) * 100),
        icon: Briefcase,
        highlight: false,
      },
      {
        key: "completed",
        label: "Concluídos no Período",
        sub: "Ciclo finalizado no período",
        value: f.completedInPeriod,
        pct: Math.round((f.completedInPeriod / maxStage) * 100),
        icon: CheckCircle2,
        highlight: false,
      },
    ];
  }, [operationalFunnel, kpis, totalConcluidasPeriodo, persona.name]);

  return (
    <div className="flex flex-col gap-5 overflow-y-auto scrollbar-thin pr-1 pb-4">
      {/* ── 1. BARRA EXECUTIVA DE FILTROS DA DIRETORIA ─────────────────────────── */}
      <div className="bg-card rounded-2xl p-3.5 border border-border shadow-soft flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-xl bg-primary/10 border border-primary/20 text-primary flex items-center justify-center shrink-0">
            <Layers className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xs font-extrabold text-foreground">
                Painel Executivo de Desempenho & Conversão
              </h2>
              {loading && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[9px] font-bold">
                  <RefreshCw className="h-2.5 w-2.5 animate-spin" />
                  Atualizando
                </span>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground">
              Visão consolidada para a Diretoria: atendimento, produtividade, SLA, triagem IA e resultado comercial no CRM
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Seletor de Período */}
          <div className="flex items-center bg-muted/40 p-1 rounded-xl border border-line">
            <Calendar className="h-3.5 w-3.5 text-muted-foreground ml-2 mr-1.5 shrink-0" />
            {periodOptions.map((opt) => {
              const active = period === opt.id;
              return (
                <SystemTooltip key={opt.id} content={opt.tip} side="bottom">
                  <button
                    type="button"
                    onClick={() => onChangePeriod(opt.id)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                      active
                        ? "bg-primary text-primary-foreground shadow-soft"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                    }`}
                  >
                    {opt.label}
                  </button>
                </SystemTooltip>
              );
            })}
          </div>

          {/* Seletor de Setor / Divisão */}
          <div className="w-[215px]">
            <Select value={sectorFilter} onValueChange={onChangeSectorFilter}>
              <SystemTooltip content="Filtrar indicadores por Divisão Comercial ou Setor" side="bottom">
                <SelectTrigger className="h-8 text-[11px] font-bold rounded-xl bg-muted/40 border-line px-2.5">
                  <div className="flex items-center gap-1.5 truncate">
                    <Building2 className="h-3.5 w-3.5 text-primary shrink-0" />
                    <SelectValue placeholder="Todos os Setores" />
                  </div>
                </SelectTrigger>
              </SystemTooltip>
              <SelectContent>
                <SelectItem value="all" className="text-xs font-bold">
                  Todos os Setores & Divisões
                </SelectItem>
                {(filterOptions?.divisions || [
                  { id: "division:maquinas", name: "Divisão Máquinas" },
                  { id: "division:personnalite", name: "Divisão Personnalité" },
                ]).map((div) => (
                  <SelectItem key={div.id} value={div.id} className="text-xs font-semibold">
                    {div.name}
                  </SelectItem>
                ))}
                {(filterOptions?.sectors || []).map((sec) => (
                  <SelectItem key={sec.id} value={sec.id} className="text-xs">
                    Setor: {sec.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Seletor de Canal */}
          <div className="flex items-center bg-muted/40 p-1 rounded-xl border border-line">
            {channelOptions.map((ch) => {
              const active = channelFilter === ch.id;
              return (
                <SystemTooltip key={ch.id} content={ch.tip} side="bottom">
                  <button
                    type="button"
                    onClick={() => onChangeChannelFilter(ch.id)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                      active
                        ? "bg-primary text-primary-foreground shadow-soft"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                    }`}
                  >
                    {ch.label}
                  </button>
                </SystemTooltip>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── 2. FAIXA EXECUTIVA DE 6 KPIs COM COMPARATIVO DE PERÍODO ────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-6 gap-3.5">
        {/* KPI 1: Atendimentos Movimentados */}
        <div className="bg-card rounded-2xl p-4 border border-border shadow-soft flex flex-col justify-between">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">
                Atendimentos Ativos
              </p>
              <p className="text-2xl font-black text-foreground tabular-nums mt-1 leading-none">
                {totalRecebidasPeriodo.toLocaleString("pt-BR")}
              </p>
            </div>
            <div className="flex flex-col items-end gap-1">
              <div className="h-8 w-8 rounded-xl bg-primary/10 border border-primary/20 text-primary flex items-center justify-center">
                <MessageSquare className="h-4 w-4" />
              </div>
              <DeltaPill delta={kpis?.activeConversationsDeltaPct} />
            </div>
          </div>
          <div className="mt-3 pt-2.5 border-t border-line flex items-center justify-between text-[10px] text-muted-foreground">
            <span>
              Novos:{" "}
              <strong className="text-foreground tabular-nums">
                {kpis?.newConversationsInPeriod ?? 0}
              </strong>
            </span>
            <span>
              Recorrentes:{" "}
              <strong className="text-foreground tabular-nums">
                {kpis?.recurringConversationsInPeriod ?? 0}
              </strong>
            </span>
          </div>
        </div>

        {/* KPI 2: Taxa de Vazão & Fila */}
        <div className="bg-card rounded-2xl p-4 border border-border shadow-soft flex flex-col justify-between">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">
                Taxa de Vazão
              </p>
              <div className="flex items-baseline gap-1.5 mt-1">
                <p className="text-2xl font-black text-foreground tabular-nums leading-none">
                  {resolutionRatePct}%
                </p>
                <span className="text-[10px] font-bold text-muted-foreground tabular-nums">
                  ({totalConcluidasPeriodo} concl.)
                </span>
              </div>
            </div>
            <div className="flex flex-col items-end gap-1">
              <div className="h-8 w-8 rounded-xl bg-primary/10 border border-primary/20 text-primary flex items-center justify-center">
                <CheckCircle2 className="h-4 w-4" />
              </div>
              <DeltaPill delta={kpis?.completedDeltaPct} />
            </div>
          </div>
          <div className="mt-3 pt-2.5 border-t border-line flex items-center justify-between text-[10px] text-muted-foreground">
            <span>
              Na fila:{" "}
              <strong className="text-foreground tabular-nums">
                {kpis?.inQueueNow ?? 0}
              </strong>
            </span>
            <span>
              Espera &gt;15m:{" "}
              <strong
                className={`tabular-nums ${
                  (kpis?.unansweredOver15mCount ?? 0) > 0 ? "text-primary font-extrabold" : "text-foreground"
                }`}
              >
                {kpis?.unansweredOver15mCount ?? 0}
              </strong>
            </span>
          </div>
        </div>

        {/* KPI 3: Volume de Interações & Ligações */}
        <div className="bg-card rounded-2xl p-4 border border-border shadow-soft flex flex-col justify-between">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">
                Interações Totais
              </p>
              <p className="text-2xl font-black text-foreground tabular-nums mt-1 leading-none">
                {(kpis?.totalMessagesInPeriod ?? totalMsgsIn + totalMsgsOut).toLocaleString("pt-BR")}
              </p>
            </div>
            <div className="flex flex-col items-end gap-1">
              <div className="h-8 w-8 rounded-xl bg-primary/10 border border-primary/20 text-primary flex items-center justify-center">
                <Activity className="h-4 w-4" />
              </div>
              <DeltaPill delta={kpis?.messagesDeltaPct} />
            </div>
          </div>
          <div className="mt-3 pt-2.5 border-t border-line flex items-center justify-between text-[10px] text-muted-foreground">
            <span>
              In/Out:{" "}
              <strong className="text-foreground tabular-nums">
                {totalMsgsIn}/{totalMsgsOut}
              </strong>
            </span>
            <span>
              Voz:{" "}
              <strong className="text-foreground tabular-nums">
                {kpis?.totalCallsInPeriod ?? 0} lig.
              </strong>
            </span>
          </div>
        </div>

        {/* KPI 4: TME & Assunção Pós-Triagem */}
        <div className="bg-card rounded-2xl p-4 border border-border shadow-soft flex flex-col justify-between">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">
                TME de Resposta
              </p>
              <p className="text-2xl font-black text-foreground tabular-nums mt-1 leading-none">
                {formatDurationHuman(kpis?.avgResponseSeconds)}
              </p>
            </div>
            <div className="flex flex-col items-end gap-1">
              <div className="h-8 w-8 rounded-xl bg-primary/10 border border-primary/20 text-primary flex items-center justify-center">
                <Clock className="h-4 w-4" />
              </div>
              <span
                className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[9px] font-extrabold border tabular-nums ${
                  (kpis?.overallSlaPct ?? 100) >= 90
                    ? "bg-primary/10 text-primary border-primary/25"
                    : "bg-muted text-muted-foreground border-border"
                }`}
              >
                SLA {kpis?.overallSlaPct ?? 100}%
              </span>
            </div>
          </div>
          <div className="mt-3 pt-2.5 border-t border-line flex items-center justify-between text-[10px] text-muted-foreground">
            <span>
              Assunção pós-IA:{" "}
              <strong className="text-foreground tabular-nums">
                {formatDurationHuman(kpis?.avgFirstPickupAfterTriageSeconds)}
              </strong>
            </span>
            <span>
              QA:{" "}
              <strong className="text-foreground tabular-nums">
                {kpis?.avgQaScore !== null && kpis?.avgQaScore !== undefined
                  ? `${kpis.avgQaScore} pts`
                  : "–"}
              </strong>
            </span>
          </div>
        </div>

        {/* KPI 5: Geração de Negócios CRM */}
        <div className="bg-card rounded-2xl p-4 border border-border shadow-soft flex flex-col justify-between">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">
                Negócios no Período
              </p>
              <div className="flex items-baseline gap-1.5 mt-1">
                <p className="text-2xl font-black text-foreground tabular-nums leading-none">
                  {kpis?.crmDealsCreatedInPeriod ?? 0}
                </p>
                <span className="text-[10px] font-bold text-muted-foreground tabular-nums">
                  ({kpis?.openDealsCount ?? 0} abertos)
                </span>
              </div>
            </div>
            <div className="flex flex-col items-end gap-1">
              <div className="h-8 w-8 rounded-xl bg-primary/10 border border-primary/20 text-primary flex items-center justify-center">
                <Briefcase className="h-4 w-4" />
              </div>
              <DeltaPill delta={kpis?.crmDealsCreatedDeltaPct} />
            </div>
          </div>
          <div className="mt-3 pt-2.5 border-t border-line flex items-center justify-between text-[10px] text-muted-foreground">
            <span>Pipeline aberto:</span>
            <strong className="text-foreground font-extrabold tabular-nums">
              {formatCurrencyBRL(kpis?.openPipelineValue, true)}
            </strong>
          </div>
        </div>

        {/* KPI 6: Receita Ganha vs. Perdida */}
        <div className="bg-card rounded-2xl p-4 border border-border shadow-soft flex flex-col justify-between">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">
                Receita Ganha (CRM)
              </p>
              <p className="text-xl font-black text-primary tabular-nums mt-1 leading-none">
                {formatCurrencyBRL(kpis?.wonValueInPeriod, true)}
              </p>
            </div>
            <div className="flex flex-col items-end gap-1">
              <div className="h-8 w-8 rounded-xl bg-primary/10 border border-primary/20 text-primary flex items-center justify-center">
                <DollarSign className="h-4 w-4" />
              </div>
              <DeltaPill delta={kpis?.wonValueDeltaPct} />
            </div>
          </div>
          <div className="mt-3 pt-2.5 border-t border-line flex items-center justify-between text-[10px] text-muted-foreground">
            <span>
              Ganhas:{" "}
              <strong className="text-foreground tabular-nums">
                {kpis?.wonDealsInPeriod ?? 0} ({kpis?.winRatePct ?? 0}%)
              </strong>
            </span>
            <SystemTooltip
              content={`Perdidas no período: ${kpis?.lostDealsInPeriod ?? 0} (${formatCurrencyBRL(kpis?.lostValueInPeriod)}) | Ticket Médio Ganho: ${formatCurrencyBRL(kpis?.avgTicketWon)}`}
              side="top"
            >
              <span className="cursor-help underline decoration-dotted">
                Perd.: <strong className="text-foreground tabular-nums">{kpis?.lostDealsInPeriod ?? 0}</strong>
              </span>
            </SystemTooltip>
          </div>
        </div>
      </div>

      {/* ── 3. RAIO-X DO FUNIL OPERACIONAL DE CARGA (5 ETAPAS) ─────────────────── */}
      <div className="bg-card rounded-2xl p-5 border border-border shadow-soft">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-xl bg-primary/10 border border-primary/20 text-primary flex items-center justify-center shrink-0">
              <Filter className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-xs font-extrabold text-foreground">
                Fluxo Operacional de Carga & Conversão
              </h3>
              <p className="text-[10px] text-muted-foreground">
                Distribuição em tempo real das conversas desde a recepção automática até o fechamento
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {(kpis?.unansweredOver15mCount ?? 0) > 0 && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-primary/10 border border-primary/25 text-primary text-[10px] font-extrabold">
                <AlertTriangle className="h-3.5 w-3.5" />
                {kpis?.unansweredOver15mCount} aguardando resposta há +15 min
              </span>
            )}
            <span className="text-[10px] font-bold text-muted-foreground bg-muted/40 px-2.5 py-1 rounded-xl border border-line tabular-nums">
              Carga ativa agora:{" "}
              <strong className="text-foreground">
                {operationalFunnel?.totalActiveNow ??
                  (kpis?.inAutomationNow ?? 0) +
                    (kpis?.inQueueNow ?? 0) +
                    (kpis?.inAttendanceNow ?? 0)}
              </strong>{" "}
              conversas
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          {funnelStages.map((stage, idx) => {
            const StageIcon = stage.icon;
            return (
              <div
                key={stage.key}
                className={`relative rounded-xl p-3.5 border transition-all ${
                  stage.highlight
                    ? "bg-primary/5 border-primary/35"
                    : "bg-muted/25 border-line"
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <div
                      className={`h-7 w-7 rounded-lg flex items-center justify-center shrink-0 border ${
                        stage.highlight
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-card text-primary border-border"
                      }`}
                    >
                      <StageIcon className="h-3.5 w-3.5" />
                    </div>
                    <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">
                      Etapa {idx + 1}
                    </span>
                  </div>
                  {idx < funnelStages.length - 1 && (
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/50 hidden md:block" />
                  )}
                </div>

                <p className="text-xl font-black text-foreground tabular-nums leading-none">
                  {stage.value.toLocaleString("pt-BR")}
                </p>
                <p className="text-[11px] font-bold text-foreground mt-1.5">{stage.label}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{stage.sub}</p>

                <div className="mt-3 h-1.5 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-500"
                    style={{ width: `${stage.value > 0 ? Math.max(stage.pct, 6) : 0}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── 4. VOLUMETRIA DIÁRIA + MAPA HORÁRIO DE DEMANDA VS CAPACIDADE ──────── */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        {/* Gráfico de Volumetria Diária (7 colunas) */}
        <div className="xl:col-span-7 bg-card rounded-2xl p-5 border border-border shadow-soft flex flex-col min-h-[345px]">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-xl bg-primary/10 border border-primary/20 text-primary flex items-center justify-center shrink-0">
                <TrendingUp className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-xs font-extrabold text-foreground">
                  Evolução Diária de Volumetria (Horário de Brasília)
                </h3>
                <p className="text-[10px] text-muted-foreground">
                  {volumeChartMode === "chats"
                    ? "Conversas movimentadas no dia (novas + recorrentes) vs. atendidas pela equipe"
                    : "Volume diário de mensagens recebidas de clientes vs. enviadas pelos consultores"}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center bg-muted/40 p-0.5 rounded-xl border border-line">
                <button
                  type="button"
                  onClick={() => setVolumeChartMode("chats")}
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition cursor-pointer ${
                    volumeChartMode === "chats"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Conversas
                </button>
                <button
                  type="button"
                  onClick={() => setVolumeChartMode("messages")}
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition cursor-pointer ${
                    volumeChartMode === "messages"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Mensagens
                </button>
              </div>

              <span className="text-[10px] font-bold text-primary bg-primary/10 px-2.5 py-1 rounded-xl border border-primary/20 flex items-center gap-1 tabular-nums">
                <CheckCircle2 className="h-3 w-3" />
                {resolutionRatePct}% vazão
              </span>
            </div>
          </div>

          <div className="flex-1 w-full h-[240px]">
            {volumes.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={volumes} margin={{ top: 10, right: 12, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorPrimaryMetric" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.28} />
                      <stop offset="95%" stopColor="var(--primary)" stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="colorSecondaryMetric" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--muted-foreground)" stopOpacity={0.22} />
                      <stop offset="95%" stopColor="var(--muted-foreground)" stopOpacity={0.01} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--line)" />
                  <XAxis
                    dataKey="name"
                    stroke="var(--muted-foreground)"
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    stroke="var(--muted-foreground)"
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip content={<SystemChartTooltip />} />
                  <Legend
                    verticalAlign="top"
                    height={32}
                    iconType="circle"
                    wrapperStyle={{ fontSize: 11, fontWeight: 600 }}
                  />
                  {volumeChartMode === "chats" ? (
                    <>
                      <Area
                        type="monotone"
                        dataKey="chats"
                        name="Conversas Ativas"
                        stroke="var(--primary)"
                        strokeWidth={2.5}
                        dot={{ r: 3, fill: "var(--primary)", strokeWidth: 0 }}
                        activeDot={{ r: 5, fill: "var(--primary)", stroke: "var(--card)", strokeWidth: 2 }}
                        fillOpacity={1}
                        fill="url(#colorPrimaryMetric)"
                        isAnimationActive={false}
                      />
                      <Area
                        type="monotone"
                        dataKey="atendidos"
                        name="Atendidas / Concluídas"
                        stroke="var(--muted-foreground)"
                        strokeWidth={2}
                        dot={{ r: 2.5, fill: "var(--muted-foreground)", strokeWidth: 0 }}
                        activeDot={{
                          r: 4.5,
                          fill: "var(--muted-foreground)",
                          stroke: "var(--card)",
                          strokeWidth: 2,
                        }}
                        fillOpacity={1}
                        fill="url(#colorSecondaryMetric)"
                        isAnimationActive={false}
                      />
                    </>
                  ) : (
                    <>
                      <Area
                        type="monotone"
                        dataKey="mensagensRecebidas"
                        name="Msgs Recebidas (Clientes)"
                        stroke="var(--primary)"
                        strokeWidth={2.5}
                        dot={{ r: 3, fill: "var(--primary)", strokeWidth: 0 }}
                        activeDot={{ r: 5, fill: "var(--primary)", stroke: "var(--card)", strokeWidth: 2 }}
                        fillOpacity={1}
                        fill="url(#colorPrimaryMetric)"
                        isAnimationActive={false}
                      />
                      <Area
                        type="monotone"
                        dataKey="mensagensEnviadas"
                        name="Msgs Enviadas (Equipe)"
                        stroke="var(--muted-foreground)"
                        strokeWidth={2}
                        dot={{ r: 2.5, fill: "var(--muted-foreground)", strokeWidth: 0 }}
                        activeDot={{
                          r: 4.5,
                          fill: "var(--muted-foreground)",
                          stroke: "var(--card)",
                          strokeWidth: 2,
                        }}
                        fillOpacity={1}
                        fill="url(#colorSecondaryMetric)"
                        isAnimationActive={false}
                      />
                    </>
                  )}
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
                Sem dados de volumetria registrados para os filtros selecionados.
              </div>
            )}
          </div>
        </div>

        {/* Mapa Horário de Demanda vs. Capacidade (5 colunas) */}
        <div className="xl:col-span-5 bg-card rounded-2xl p-5 border border-border shadow-soft flex flex-col min-h-[345px]">
          <div className="flex flex-wrap items-start justify-between gap-2 mb-4">
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-xl bg-primary/10 border border-primary/20 text-primary flex items-center justify-center shrink-0">
                <Clock className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-xs font-extrabold text-foreground">
                  Demanda por Faixa Horária (07h–22h)
                </h3>
                <p className="text-[10px] text-muted-foreground">
                  Mensagens recebidas vs. respostas da equipe por hora do dia
                </p>
              </div>
            </div>

            {peakHourInfo && (
              <SystemTooltip
                content={`Maior concentração de mensagens recebidas às ${peakHourInfo.hour} (${peakHourInfo.recebidas} msgs)`}
                side="top"
              >
                <span className="text-[10px] font-bold text-primary bg-primary/10 px-2.5 py-1 rounded-xl border border-primary/20 tabular-nums">
                  Pico: {peakHourInfo.hour}
                </span>
              </SystemTooltip>
            )}
          </div>

          <div className="flex-1 w-full h-[240px]">
            {hourlyDemand.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={hourlyDemand} margin={{ top: 10, right: 8, left: -24, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--line)" />
                  <XAxis
                    dataKey="hour"
                    stroke="var(--muted-foreground)"
                    fontSize={9}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    stroke="var(--muted-foreground)"
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip content={<SystemChartTooltip />} />
                  <Legend
                    verticalAlign="top"
                    height={32}
                    iconType="circle"
                    wrapperStyle={{ fontSize: 11, fontWeight: 600 }}
                  />
                  <Bar
                    dataKey="recebidas"
                    name="Recebidas (Clientes)"
                    fill="var(--primary)"
                    radius={[4, 4, 0, 0]}
                    isAnimationActive={false}
                  />
                  <Bar
                    dataKey="respondidas"
                    name="Respostas (Equipe)"
                    fill="var(--muted-foreground)"
                    radius={[4, 4, 0, 0]}
                    isAnimationActive={false}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
                Sem tráfego horário registrado no período.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── 5. CANAIS & SAÚDE DAS CONEXÕES + EFICIÊNCIA DA TRIAGEM IA ─────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        {/* Canais Reais & Conexões (7 colunas) */}
        <div className="xl:col-span-7 bg-card rounded-2xl p-5 border border-border shadow-soft flex flex-col justify-between">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-xl bg-primary/10 border border-primary/20 text-primary flex items-center justify-center shrink-0">
                <Smartphone className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-xs font-extrabold text-foreground">
                  Canais de Comunicação & Saúde das Conexões
                </h3>
                <p className="text-[10px] text-muted-foreground">
                  Volume real por meio de entrada (WhatsApp Oficial, Celulares Baileys, Site, Voz e E-mail)
                </p>
              </div>
            </div>
            <span className="text-[10px] font-bold text-muted-foreground bg-muted/40 px-2.5 py-1 rounded-xl border border-line tabular-nums">
              Total movimentado: <strong className="text-foreground">{totalVolumeChannels}</strong>
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
            <div className="md:col-span-4 h-[170px] flex items-center justify-center relative">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={channels.filter((c) => c.value > 0).length > 0 ? channels : [{ name: "Sem tráfego", value: 1 }]}
                    cx="50%"
                    cy="50%"
                    innerRadius={46}
                    outerRadius={66}
                    paddingAngle={3}
                    cornerRadius={4}
                    dataKey="value"
                    stroke="var(--card)"
                    strokeWidth={2}
                    isAnimationActive={false}
                  >
                    {(channels.filter((c) => c.value > 0).length > 0 ? channels : [{ name: "Sem tráfego", value: 1 }]).map(
                      (_, index) => (
                        <Cell key={`cell-${index}`} fill={channelPalette[index % channelPalette.length]} />
                      )
                    )}
                  </Pie>
                  <Tooltip content={<SystemChartTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute text-center pointer-events-none">
                <p className="text-xl font-black text-foreground tabular-nums leading-none">
                  {totalVolumeChannels}
                </p>
                <p className="text-[9px] text-muted-foreground uppercase font-bold tracking-wider mt-1">
                  Interações
                </p>
              </div>
            </div>

            <div className="md:col-span-8 space-y-2.5">
              {channels.map((chan, index) => {
                const dotColor = channelPalette[index % channelPalette.length];
                const sharePct =
                  totalVolumeChannels > 0 ? Math.round((chan.value / totalVolumeChannels) * 100) : 0;
                return (
                  <div
                    key={chan.name}
                    className="p-2.5 rounded-xl bg-muted/25 border border-line space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2 text-[11px]">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="h-2.5 w-2.5 rounded-full shrink-0"
                          style={{ background: dotColor }}
                        />
                        <span className="text-foreground font-extrabold truncate">{chan.name}</span>
                        {chan.totalConnections !== undefined && chan.totalConnections > 0 && (
                          <span
                            className={`px-1.5 py-0.5 rounded-md text-[9px] font-bold border tabular-nums ${
                              (chan.connectedCount ?? 0) > 0
                                ? "bg-primary/10 text-primary border-primary/25"
                                : "bg-muted text-muted-foreground border-border"
                            }`}
                          >
                            {chan.connectedCount}/{chan.totalConnections} online
                          </span>
                        )}
                      </div>
                      <span className="text-muted-foreground tabular-nums shrink-0">
                        <strong className="text-foreground font-extrabold">{chan.value}</strong> ({sharePct}%)
                      </span>
                    </div>

                    {chan.subtitle && (
                      <p className="text-[10px] text-muted-foreground truncate">{chan.subtitle}</p>
                    )}

                    <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${chan.value > 0 ? Math.max(sharePct, 3) : 0}%`, background: dotColor }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Eficiência da Triagem IA — Fagner / Valentina (5 colunas) */}
        <div className="xl:col-span-5 bg-card rounded-2xl p-5 border border-border shadow-soft flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-2 mb-4">
              <div className="flex items-center gap-2.5">
                <div className="h-8 w-8 rounded-xl bg-primary/10 border border-primary/20 text-primary flex items-center justify-center shrink-0">
                  <Bot className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-xs font-extrabold text-foreground">
                    Eficiência da Triagem IA ({persona.name})
                  </h3>
                  <p className="text-[10px] text-muted-foreground">
                    Qualificação automática e repasse para os consultores
                  </p>
                </div>
              </div>
              <span className="text-[10px] font-extrabold text-primary bg-primary/10 px-2.5 py-1 rounded-xl border border-primary/20 tabular-nums">
                {triageSummary?.qualificationRatePct ?? 0}% qualificados
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2.5 mb-4">
              <div className="p-3 rounded-xl bg-muted/30 border border-line">
                <p className="text-[10px] font-bold text-muted-foreground uppercase">
                  Acionados no Período
                </p>
                <p className="text-lg font-black text-foreground tabular-nums mt-0.5">
                  {triageSummary?.totalTriagedInPeriod ?? 0}
                </p>
              </div>
              <div className="p-3 rounded-xl bg-muted/30 border border-line">
                <p className="text-[10px] font-bold text-muted-foreground uppercase">
                  Repassados p/ Equipe
                </p>
                <p className="text-lg font-black text-foreground tabular-nums mt-0.5">
                  {triageSummary?.transferredToHuman ?? 0}
                </p>
              </div>
              <div className="p-3 rounded-xl bg-muted/30 border border-line">
                <p className="text-[10px] font-bold text-muted-foreground uppercase">
                  Em Triagem Agora
                </p>
                <p className="text-lg font-black text-foreground tabular-nums mt-0.5">
                  {triageSummary?.inProgressNow ?? 0}
                </p>
              </div>
              <div className="p-3 rounded-xl bg-muted/30 border border-line">
                <p className="text-[10px] font-bold text-muted-foreground uppercase">
                  Assunção Humana
                </p>
                <p className="text-lg font-black text-foreground tabular-nums mt-0.5">
                  {formatDurationHuman(triageSummary?.avgPickupSeconds)}
                </p>
              </div>
            </div>
          </div>

          <div className="pt-3 border-t border-line">
            <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground mb-2">
              Principais Destinos / Funis Identificados
            </p>
            {(triageSummary?.topFunnels || []).length > 0 ? (
              <div className="space-y-1.5">
                {triageSummary!.topFunnels.slice(0, 3).map((tf) => (
                  <div
                    key={tf.name}
                    className="flex items-center justify-between text-[11px] px-2.5 py-1.5 rounded-lg bg-muted/25 border border-line"
                  >
                    <span className="font-bold text-foreground truncate">{tf.name}</span>
                    <span className="font-extrabold text-primary tabular-nums">{tf.count} leads</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-muted-foreground py-2">
                Sem roteamentos de funil registrados no período selecionado.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ── 6. TABELA EXECUTIVA POR SETOR & DIVISÃO COMERCIAL ─────────────────── */}
      <div className="bg-card rounded-2xl border border-border shadow-soft overflow-hidden">
        <div className="px-5 py-4 border-b border-line flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-xl bg-primary/10 border border-primary/20 text-primary flex items-center justify-center shrink-0">
              <Building2 className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-xs font-extrabold text-foreground">
                Desempenho Consolidado por Setor & Divisão
              </h3>
              <p className="text-[10px] text-muted-foreground">
                Capacidade da equipe, fila em tempo real, volume atendido, TME, SLA, nota QA e geração de receita
              </p>
            </div>
          </div>
          <span className="text-[10px] font-bold text-muted-foreground bg-muted/50 px-2.5 py-1 rounded-xl border border-line tabular-nums">
            {effectiveSectorDetails.length}{" "}
            {effectiveSectorDetails.length === 1 ? "unidade" : "unidades"}
          </span>
        </div>

        <div className="overflow-x-auto">
          {effectiveSectorDetails.length === 0 ? (
            <div className="p-8 text-center text-xs text-muted-foreground">
              Nenhum setor cadastrado ou com atendimentos registrados.
            </div>
          ) : (
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-muted/40 text-muted-foreground font-semibold border-b border-line">
                  <th className="px-4 py-3">Setor / Divisão</th>
                  <th className="px-3 py-3 text-center">Equipe</th>
                  <th className="px-3 py-3 text-center">Na Fila</th>
                  <th className="px-3 py-3 text-center">Em Carteira</th>
                  <th className="px-4 py-3">Ativos / Concluídos</th>
                  <th className="px-3 py-3 text-right">Msgs Env.</th>
                  <th className="px-3 py-3">TME Resposta</th>
                  <th className="px-4 py-3">SLA Cumprido</th>
                  <th className="px-3 py-3 text-center">Score QA</th>
                  <th className="px-4 py-3 text-right">Pipeline / Ganho (CRM)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {effectiveSectorDetails.map((sec) => {
                  const volPct = Math.round(
                    (Math.max(sec.activeInPeriod || 0, sec.completed || 0) / maxSectorActive) * 100
                  );
                  const isDivision = sec.category === "division";
                  return (
                    <tr
                      key={sec.id || sec.name}
                      className={`hover:bg-muted/30 transition font-medium ${
                        isDivision ? "bg-primary/[0.03]" : ""
                      }`}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="text-foreground font-extrabold">{sec.name}</span>
                          {isDivision && (
                            <span className="px-1.5 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/20 text-[9px] font-bold">
                              Divisão
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="px-3 py-3 text-center tabular-nums">
                        {sec.operatorsTotal > 0 ? (
                          <SystemTooltip
                            content={`${sec.operatorsOnline} online de ${sec.operatorsTotal} vinculados`}
                            side="top"
                          >
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted/60 border border-line text-[10px] font-bold">
                              <span
                                className={`h-1.5 w-1.5 rounded-full ${
                                  sec.operatorsOnline > 0 ? "bg-primary" : "bg-muted-foreground"
                                }`}
                              />
                              {sec.operatorsOnline}/{sec.operatorsTotal}
                            </span>
                          </SystemTooltip>
                        ) : (
                          <span className="text-muted-foreground">–</span>
                        )}
                      </td>

                      <td className="px-3 py-3 text-center tabular-nums">
                        <span
                          className={`font-bold ${
                            sec.inQueue > 0 ? "text-primary font-extrabold" : "text-muted-foreground"
                          }`}
                        >
                          {sec.inQueue}
                        </span>
                      </td>

                      <td className="px-3 py-3 text-center tabular-nums font-bold text-foreground">
                        {sec.inAttendance}
                      </td>

                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-16 tabular-nums">
                            <span className="text-foreground font-extrabold">
                              {sec.activeInPeriod}
                            </span>
                            <span className="text-muted-foreground text-[10px]">
                              {" "}
                              / {sec.completed}
                            </span>
                          </div>
                          <div className="h-1.5 w-20 rounded-full bg-muted overflow-hidden hidden sm:block">
                            <div
                              className="h-full rounded-full bg-primary/80"
                              style={{
                                width: `${
                                  sec.activeInPeriod > 0 || sec.completed > 0
                                    ? Math.max(volPct, 5)
                                    : 0
                                }%`,
                              }}
                            />
                          </div>
                        </div>
                      </td>

                      <td className="px-3 py-3 text-right tabular-nums font-semibold text-foreground">
                        {(sec.messagesSent || 0).toLocaleString("pt-BR")}
                      </td>

                      <td className="px-3 py-3 text-foreground tabular-nums">
                        {sec.avgResponse === null ? (
                          <span className="text-muted-foreground">Sem amostra</span>
                        ) : (
                          formatDurationHuman(sec.avgResponse)
                        )}
                      </td>

                      <td className="px-4 py-3">
                        {sec.slaPct === null ? (
                          <span className="text-muted-foreground">Sem amostra</span>
                        ) : (
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-16 rounded-full bg-muted overflow-hidden hidden sm:block">
                              <div
                                className={`h-full rounded-full ${
                                  sec.slaPct >= 90 ? "bg-primary" : "bg-muted-foreground"
                                }`}
                                style={{ width: `${Math.max(sec.slaPct, 4)}%` }}
                              />
                            </div>
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border tabular-nums ${
                                sec.slaPct >= 90
                                  ? "bg-primary/10 text-primary border-primary/20"
                                  : "bg-muted text-muted-foreground border-border"
                              }`}
                            >
                              {sec.slaPct}%
                            </span>
                          </div>
                        )}
                      </td>

                      <td className="px-3 py-3 text-center tabular-nums">
                        {sec.avgQaScore !== null ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-primary/10 text-primary border border-primary/20 text-[10px] font-extrabold">
                            <Award className="h-3 w-3" />
                            {sec.avgQaScore}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">–</span>
                        )}
                      </td>

                      <td className="px-4 py-3 text-right tabular-nums">
                        {sec.wonValue > 0 || sec.pipelineValue > 0 ? (
                          <div>
                            <p className="font-extrabold text-primary">
                              {formatCurrencyBRL(sec.wonValue, true)}{" "}
                              <span className="text-[10px] font-normal text-muted-foreground">
                                ({sec.dealsWon} ganhas)
                              </span>
                            </p>
                            <p className="text-[10px] text-muted-foreground">
                              Pipeline: {formatCurrencyBRL(sec.pipelineValue, true)} ({sec.dealsOpen})
                            </p>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">R$ 0</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ── 7. MATRIZ DE PRODUTIVIDADE & CONVERSÃO POR CONSULTOR ──────────────── */}
      <div className="bg-card rounded-2xl border border-border shadow-soft overflow-hidden">
        <div className="px-5 py-4 border-b border-line flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-xl bg-primary/10 border border-primary/20 text-primary flex items-center justify-center shrink-0">
              <UserCheck className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-xs font-extrabold text-foreground">
                Matriz Individual de Produtividade & Conversão Comercial
              </h3>
              <p className="text-[10px] text-muted-foreground">
                Cruzamento por consultor: conversas atendidas, mensagens, ligações, tarefas, TME, SLA, nota QA e vendas ganhas
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Busca por consultor */}
            <div className="relative">
              <Search className="h-3.5 w-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={consultantSearch}
                onChange={(e) => setConsultantSearch(e.target.value)}
                placeholder="Buscar consultor ou setor..."
                className="h-8 pl-8 pr-3 rounded-xl bg-muted/40 border border-line text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/40 w-48"
              />
            </div>

            {/* Filtro Ativos vs Todos */}
            <div className="flex items-center bg-muted/40 p-0.5 rounded-xl border border-line">
              <button
                type="button"
                onClick={() => setConsultantFilterMode("active")}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition cursor-pointer ${
                  consultantFilterMode === "active"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Com Atividade
              </button>
              <button
                type="button"
                onClick={() => setConsultantFilterMode("all")}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition cursor-pointer ${
                  consultantFilterMode === "all"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Todos ({consultantProductivity.length})
              </button>
            </div>

            {/* Ordenação */}
            <div className="w-[175px]">
              <Select
                value={consultantSortBy}
                onValueChange={(v) => setConsultantSortBy(v as any)}
              >
                <SystemTooltip content="Ordenar ranking de consultores por critério" side="top">
                  <SelectTrigger className="h-8 text-[11px] font-bold rounded-xl bg-muted/40 border-line px-2.5">
                    <div className="flex items-center gap-1.5 truncate">
                      <ArrowUpDown className="h-3 w-3 text-primary shrink-0" />
                      <SelectValue placeholder="Ordenar por" />
                    </div>
                  </SelectTrigger>
                </SystemTooltip>
                <SelectContent>
                  <SelectItem value="handled" className="text-xs">
                    Maior Volume Atendido
                  </SelectItem>
                  <SelectItem value="won" className="text-xs">
                    Maior Receita Ganha (R$)
                  </SelectItem>
                  <SelectItem value="messages" className="text-xs">
                    Mais Mensagens Enviadas
                  </SelectItem>
                  <SelectItem value="tme" className="text-xs">
                    Menor TME de Resposta
                  </SelectItem>
                  <SelectItem value="sla" className="text-xs">
                    Maior SLA Cumprido (%)
                  </SelectItem>
                  <SelectItem value="qa" className="text-xs">
                    Maior Nota QA (IA)
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          {filteredConsultants.length === 0 ? (
            <div className="p-8 text-center text-xs text-muted-foreground">
              Nenhum consultor encontrado para os critérios selecionados.
            </div>
          ) : (
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-muted/40 text-muted-foreground font-semibold border-b border-line">
                  <th className="px-4 py-3">Consultor / Setor</th>
                  <th className="px-3 py-3 text-center">Carteira / Período</th>
                  <th className="px-3 py-3 text-center">Esforço (Msgs / Voz / Tarefas)</th>
                  <th className="px-3 py-3">TME Resposta</th>
                  <th className="px-3 py-3">SLA Cumprido</th>
                  <th className="px-3 py-3 text-center">Nota QA</th>
                  <th className="px-3 py-3 text-right">Pipeline Aberto</th>
                  <th className="px-4 py-3 text-right">Vendas Ganhas & Conversão</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filteredConsultants.map((op, index) => (
                  <tr key={op.id} className="hover:bg-muted/30 transition font-medium">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="relative shrink-0">
                          <OperatorAvatarBadge
                            name={op.name}
                            avatar={op.avatar}
                            highlight={index < 3}
                          />
                          <span
                            className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card ${
                              op.online ? "bg-primary" : "bg-muted-foreground/50"
                            }`}
                          />
                        </div>
                        <div className="min-w-0">
                          <p className="text-foreground font-extrabold truncate">{op.name}</p>
                          <p className="text-[10px] text-muted-foreground truncate">
                            {op.sectorName} • {op.divisionLabel}
                          </p>
                        </div>
                      </div>
                    </td>

                    <td className="px-3 py-3 text-center tabular-nums">
                      <span className="font-extrabold text-foreground">{op.handledInPeriod}</span>
                      <span className="text-muted-foreground text-[10px]">
                        {" "}
                        atend. ({op.completedInPeriod} concl.)
                      </span>
                      <p className="text-[10px] text-muted-foreground">
                        Ativos agora: <strong className="text-foreground">{op.activeChatsNow}</strong>
                      </p>
                    </td>

                    <td className="px-3 py-3 text-center tabular-nums">
                      <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-lg bg-muted/35 border border-line text-[10px]">
                        <SystemTooltip content={`${op.messagesSent} mensagens enviadas | ${op.messagesReceived} recebidas`} side="top">
                          <span className="font-bold text-foreground">
                            {op.messagesSent} msgs
                          </span>
                        </SystemTooltip>
                        <span className="text-muted-foreground">•</span>
                        <SystemTooltip
                          content={`${op.callsAnswered}/${op.callsTotal} ligações atendidas (${formatDurationHuman(op.callSeconds)})`}
                          side="top"
                        >
                          <span className="font-semibold text-muted-foreground">
                            {op.callsTotal} lig.
                          </span>
                        </SystemTooltip>
                        <span className="text-muted-foreground">•</span>
                        <SystemTooltip
                          content={`${op.tasksCompleted} tarefas concluídas | ${op.tasksOpen} abertas`}
                          side="top"
                        >
                          <span className="font-semibold text-muted-foreground">
                            {op.tasksCompleted} tar.
                          </span>
                        </SystemTooltip>
                      </div>
                    </td>

                    <td className="px-3 py-3 tabular-nums text-foreground font-semibold">
                      {op.avgResponseSeconds > 0 ? (
                        formatDurationHuman(op.avgResponseSeconds)
                      ) : (
                        <span className="text-muted-foreground">–</span>
                      )}
                    </td>

                    <td className="px-3 py-3 tabular-nums">
                      {op.slaPct === null ? (
                        <span className="text-muted-foreground">–</span>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                              op.slaPct >= 90
                                ? "bg-primary/10 text-primary border-primary/20"
                                : "bg-muted text-muted-foreground border-border"
                            }`}
                          >
                            {op.slaPct}%
                          </span>
                          {op.overdueSlaCount > 0 && (
                            <span className="text-[10px] text-muted-foreground">
                              ({op.overdueSlaCount} est.)
                            </span>
                          )}
                        </div>
                      )}
                    </td>

                    <td className="px-3 py-3 text-center tabular-nums">
                      {op.avgQaScore !== null ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-primary/10 text-primary border border-primary/20 text-[10px] font-extrabold">
                          <Star className="h-2.5 w-2.5" />
                          {op.avgQaScore}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">–</span>
                      )}
                    </td>

                    <td className="px-3 py-3 text-right tabular-nums">
                      {op.dealsOpen > 0 ? (
                        <div>
                          <p className="font-bold text-foreground">
                            {formatCurrencyBRL(op.pipelineValue, true)}
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            {op.dealsOpen} {op.dealsOpen === 1 ? "negócio" : "negócios"}
                          </p>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">–</span>
                      )}
                    </td>

                    <td className="px-4 py-3 text-right tabular-nums">
                      {op.dealsWon > 0 || op.wonValue > 0 ? (
                        <div>
                          <p className="font-extrabold text-primary">
                            {formatCurrencyBRL(op.wonValue, true)}
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            {op.dealsWon} ganhas •{" "}
                            <strong className="text-foreground">{op.conversionRatePct}% conv.</strong>
                          </p>
                        </div>
                      ) : (
                        <div>
                          <span className="text-muted-foreground font-semibold">R$ 0</span>
                          {op.dealsLost > 0 && (
                            <p className="text-[10px] text-muted-foreground">
                              {op.dealsLost} perd.
                            </p>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// 2. Aba: SLA e Tempos
function SlaTab({
  overallSlaPct,
  overdueCount,
  totalSlaCount,
  withinSlaCount,
  overallAvgResponseSeconds,
  operators,
}: {
  overallSlaPct: number;
  overdueCount: number;
  totalSlaCount?: number;
  withinSlaCount?: number;
  overallAvgResponseSeconds?: number;
  operators: OperatorPerformance[];
}) {
  const avgSla = overallSlaPct;
  const [chartSortBy, setChartSortBy] = useState<"sla" | "volume">("sla");
  const [tableFilter, setTableFilter] = useState<"active" | "all">("active");
  const [tableSearch, setTableSearch] = useState("");
  const [tableSortField, setTableSortField] = useState<"chats" | "slaPct" | "avgResponseSeconds" | "name">("chats");
  const [tableSortDir, setTableSortDir] = useState<"asc" | "desc">("desc");

  // Operadores com atividade real (atendimentos ou amostra de SLA)
  const activeOperators = useMemo(
    () => operators.filter((op) => op.chats > 0 || (op.slaSampleCount ?? 0) > 0),
    [operators]
  );

  const inactiveCount = Math.max(0, operators.length - activeOperators.length);

  // Lista para o gráfico de ranking horizontal (apenas ativos se houver; senão todos)
  const chartOperators = useMemo(() => {
    const base = activeOperators.length > 0 ? [...activeOperators] : [...operators];
    return base.sort((a, b) => {
      if (chartSortBy === "sla") {
        if (b.slaPct !== a.slaPct) return b.slaPct - a.slaPct;
        return b.chats - a.chats;
      }
      if (b.chats !== a.chats) return b.chats - a.chats;
      return b.slaPct - a.slaPct;
    });
  }, [activeOperators, operators, chartSortBy]);

  // Cálculos consolidados para os mini-cards do Gauge
  const totalChatsAll = useMemo(
    () => operators.reduce((sum, op) => sum + (op.chats || 0), 0),
    [operators]
  );

  const computedWithinSla = useMemo(() => {
    if (typeof withinSlaCount === "number" && withinSlaCount > 0) return withinSlaCount;
    if (typeof totalSlaCount === "number" && totalSlaCount > 0) {
      return Math.max(0, totalSlaCount - overdueCount);
    }
    if (avgSla > 0 && overdueCount > 0 && avgSla < 100) {
      return Math.max(0, Math.round((overdueCount * avgSla) / (100 - avgSla)));
    }
    return totalChatsAll;
  }, [withinSlaCount, totalSlaCount, overdueCount, avgSla, totalChatsAll]);

  const computedOverallTme = useMemo(() => {
    if (typeof overallAvgResponseSeconds === "number" && overallAvgResponseSeconds > 0) {
      return overallAvgResponseSeconds;
    }
    const withTime = activeOperators.filter((op) => op.avgResponseSeconds > 0);
    if (withTime.length === 0) return 0;
    const weightedSum = withTime.reduce(
      (acc, op) => acc + op.avgResponseSeconds * Math.max(1, op.chats),
      0
    );
    const totalWeight = withTime.reduce((acc, op) => acc + Math.max(1, op.chats), 0);
    return totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 0;
  }, [overallAvgResponseSeconds, activeOperators]);

  const onTargetOperatorsCount = useMemo(
    () => activeOperators.filter((op) => op.slaPct >= 90).length,
    [activeOperators]
  );
  const belowTargetOperatorsCount = Math.max(0, activeOperators.length - onTargetOperatorsCount);

  // Ordenação e filtro da tabela inferior
  const filteredTableOperators = useMemo(() => {
    const base =
      tableFilter === "active" && activeOperators.length > 0 ? [...activeOperators] : [...operators];
    const query = tableSearch.trim().toLowerCase();
    const searched = query ? base.filter((op) => op.name.toLowerCase().includes(query)) : base;

    return searched.sort((a, b) => {
      const dir = tableSortDir === "asc" ? 1 : -1;
      if (tableSortField === "name") {
        return a.name.localeCompare(b.name, "pt-BR") * dir;
      }
      // Manter quem tem 0 chats no final quando ordenando por métricas
      const aActive = a.chats > 0 ? 1 : 0;
      const bActive = b.chats > 0 ? 1 : 0;
      if (aActive !== bActive) return bActive - aActive;

      const valA = a[tableSortField] ?? 0;
      const valB = b[tableSortField] ?? 0;
      if (valA !== valB) return (valA - valB) * dir;
      return b.chats - a.chats;
    });
  }, [tableFilter, activeOperators, operators, tableSearch, tableSortField, tableSortDir]);

  const maxOperatorChats = useMemo(
    () => Math.max(1, ...operators.map((op) => op.chats || 0)),
    [operators]
  );

  const handleToggleSort = (field: "chats" | "slaPct" | "avgResponseSeconds" | "name") => {
    if (tableSortField === field) {
      setTableSortDir((prev) => (prev === "desc" ? "asc" : "desc"));
    } else {
      setTableSortField(field);
      setTableSortDir(field === "name" ? "asc" : "desc");
    }
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 overflow-y-auto scrollbar-thin pr-1 pb-2">
      {/* 1. Card Esquerdo: Gauge Circular SLA Geral da Operação */}
      <div className="bg-card rounded-2xl p-5 border border-border shadow-soft flex flex-col justify-between">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-xl bg-primary/10 border border-primary/20 text-primary flex items-center justify-center shrink-0">
              <Shield className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-xs font-extrabold text-foreground">SLA Geral da Operação</h3>
              <p className="text-[10px] text-muted-foreground">Chamados respondidos em até 15 minutos</p>
            </div>
          </div>

          <SystemTooltip content="Meta corporativa: mínimo de 90% dos ciclos respondidos dentro de 15 minutos.">
            <span className="text-[10px] font-bold text-muted-foreground bg-muted/50 px-2 py-1 rounded-lg border border-line shrink-0 cursor-default">
              Alvo ≥ 90%
            </span>
          </SystemTooltip>
        </div>

        {/* Medidor Circular Proporcional (0 a 100% real com marcador em 90%) */}
        <SlaPrecisionGauge pct={avgSla} targetPct={90} />

        {/* Grade 2x2 de Mini-KPIs de Contexto */}
        <div className="grid grid-cols-2 gap-2.5 pt-3 border-t border-line w-full">
          <div className="rounded-xl bg-muted/35 border border-line px-3 py-2 text-left">
            <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider block">
              Meta SLA
            </span>
            <span className="text-foreground font-black text-xs tabular-nums mt-0.5 block">
              15 min
            </span>
          </div>

          <div className="rounded-xl bg-muted/35 border border-line px-3 py-2 text-left">
            <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider block">
              TME Geral
            </span>
            <span className="text-foreground font-black text-xs tabular-nums mt-0.5 block">
              {formatDurationHuman(computedOverallTme)}
            </span>
          </div>

          <div className="rounded-xl bg-muted/35 border border-line px-3 py-2 text-left">
            <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider block">
              Dentro do Prazo
            </span>
            <span className="text-foreground font-black text-xs tabular-nums mt-0.5 block">
              {computedWithinSla} ciclos
            </span>
          </div>

          <div className="rounded-xl bg-primary/5 border border-primary/20 px-3 py-2 text-left">
            <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider block">
              Excedidos (&gt;15m)
            </span>
            <span className={`font-black text-xs tabular-nums mt-0.5 block ${overdueCount > 0 ? "text-primary" : "text-foreground"}`}>
              {overdueCount} chats
            </span>
          </div>
        </div>
      </div>

      {/* 2. Card Direito: Ranking Visual de Cumprimento de SLA por Operador */}
      <div className="xl:col-span-2 bg-card rounded-2xl p-5 border border-border shadow-soft flex flex-col min-h-[340px]">
        <div className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-line">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-xl bg-primary/10 border border-primary/20 text-primary flex items-center justify-center shrink-0">
              <Award className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-xs font-extrabold text-foreground">Cumprimento de SLA por Operador</h3>
              <p className="text-[10px] text-muted-foreground">
                Ranking de conformidade por agente ativo · Linha tracejada indica a meta de 90%
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {activeOperators.length > 0 && (
              <div className="hidden sm:flex items-center gap-1.5">
                <span className="text-[10px] font-bold px-2 py-1 rounded-lg bg-primary/10 text-primary border border-primary/20 tabular-nums">
                  {onTargetOperatorsCount} na meta
                </span>
                <span className="text-[10px] font-semibold px-2 py-1 rounded-lg bg-muted text-muted-foreground border border-border tabular-nums">
                  {belowTargetOperatorsCount} em atenção
                </span>
              </div>
            )}

            {/* Alternador de Ordenação do Gráfico */}
            <div className="flex items-center bg-muted/40 p-0.5 rounded-xl border border-line">
              <button
                type="button"
                onClick={() => setChartSortBy("sla")}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition cursor-pointer ${
                  chartSortBy === "sla"
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Por SLA %
              </button>
              <button
                type="button"
                onClick={() => setChartSortBy("volume")}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition cursor-pointer ${
                  chartSortBy === "volume"
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Por Volume
              </button>
            </div>
          </div>
        </div>

        {/* Régua de Escala Superior (0% — 25% — 50% — 75% — Meta 90% — 100%) */}
        {chartOperators.length > 0 ? (
          <div className="flex-1 flex flex-col justify-between mt-3">
            <div>
              <div className="flex items-center gap-3 px-2 pb-2 text-[9px] font-bold text-muted-foreground uppercase tracking-wider">
                <div className="w-44 sm:w-52 shrink-0">Operador / Volume</div>
                <div className="flex-1 relative h-4 hidden sm:block">
                  <span className="absolute left-0 -translate-x-0">0%</span>
                  <span className="absolute left-1/4 -translate-x-1/2">25%</span>
                  <span className="absolute left-1/2 -translate-x-1/2">50%</span>
                  <span className="absolute left-3/4 -translate-x-1/2">75%</span>
                  <span className="absolute left-[90%] -translate-x-1/2 text-primary font-extrabold">
                    Meta 90%
                  </span>
                  <span className="absolute right-0">100%</span>
                </div>
                <div className="w-20 shrink-0 text-right">SLA %</div>
              </div>

              {/* Lista de Barras Horizontais com Scroll Suave */}
              <div className="space-y-1.5 max-h-[245px] overflow-y-auto scrollbar-thin pr-1">
                {chartOperators.map((op, index) => {
                  const isGoalMet = op.slaPct >= 90;
                  const isModerate = op.slaPct >= 70 && op.slaPct < 90;
                  const fillWidth = op.chats > 0 ? Math.max(op.slaPct, 3) : 0;

                  const barColorStyle = isGoalMet
                    ? "var(--primary)"
                    : isModerate
                    ? "color-mix(in srgb, var(--primary) 62%, var(--muted-foreground))"
                    : "var(--muted-foreground)";

                  const tooltipText = `${op.name} • SLA: ${op.slaPct}% • ${op.chats} atendimentos • TME: ${formatDurationHuman(
                    op.avgResponseSeconds
                  )}`;

                  return (
                    <SystemTooltip key={op.id || op.name} content={tooltipText} side="top">
                      <div className="flex items-center gap-3 px-2.5 py-2 rounded-xl bg-muted/20 hover:bg-muted/45 border border-transparent hover:border-line transition group">
                        {/* Identificação do Agente */}
                        <div className="w-44 sm:w-52 shrink-0 flex items-center gap-2.5 min-w-0">
                          <span
                            className={`h-5 w-5 rounded-md text-[10px] font-extrabold flex items-center justify-center shrink-0 border tabular-nums ${
                              isGoalMet
                                ? "bg-primary/15 text-primary border-primary/30"
                                : "bg-muted text-muted-foreground border-border"
                            }`}
                          >
                            {index + 1}
                          </span>
                          <OperatorAvatarBadge
                            name={op.name}
                            avatar={op.avatar}
                            highlight={isGoalMet}
                          />
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-bold text-foreground truncate leading-tight">
                              {op.name}
                            </p>
                            <p className="text-[10px] text-muted-foreground truncate tabular-nums mt-0.5">
                              {op.chats} {op.chats === 1 ? "chat" : "chats"} · TME{" "}
                              {formatDurationHuman(op.avgResponseSeconds)}
                            </p>
                          </div>
                        </div>

                        {/* Trilha da Barra Horizontal + Linha de Meta 90% */}
                        <div className="flex-1 relative h-3.5 rounded-lg bg-muted/70 border border-border/60 overflow-hidden">
                          {/* Grades verticais discretas */}
                          <div className="absolute inset-y-0 left-1/4 border-l border-line/50 pointer-events-none" />
                          <div className="absolute inset-y-0 left-1/2 border-l border-line/50 pointer-events-none" />
                          <div className="absolute inset-y-0 left-3/4 border-l border-line/50 pointer-events-none" />

                          {/* Linha de Meta 90% */}
                          <div className="absolute inset-y-0 left-[90%] border-l-2 border-dashed border-primary/60 z-10 pointer-events-none" />

                          {/* Preenchimento da Barra */}
                          <div
                            className="h-full rounded-lg transition-all duration-500"
                            style={{
                              width: `${fillWidth}%`,
                              background: barColorStyle,
                            }}
                          />
                        </div>

                        {/* Percentual à Direita */}
                        <div className="w-20 shrink-0 flex items-center justify-end">
                          <span
                            className={`inline-flex items-center justify-center min-w-[48px] px-2 py-0.5 rounded-lg text-[11px] font-extrabold border tabular-nums ${
                              isGoalMet
                                ? "bg-primary/10 text-primary border-primary/25"
                                : isModerate
                                ? "bg-muted text-foreground border-border"
                                : "bg-muted/60 text-muted-foreground border-border"
                            }`}
                          >
                            {op.slaPct}%
                          </span>
                        </div>
                      </div>
                    </SystemTooltip>
                  );
                })}
              </div>
            </div>

            {/* Nota de Rodapé do Gráfico */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-3 mt-3 border-t border-line text-[10px] text-muted-foreground">
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-primary" />
                  Dentro da Meta (≥ 90%)
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: "color-mix(in srgb, var(--primary) 62%, var(--muted-foreground))" }}
                  />
                  Atenção (70% – 89%)
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-muted-foreground" />
                  Abaixo de 70%
                </span>
              </div>

              {inactiveCount > 0 && (
                <span>
                  Exibindo <strong>{activeOperators.length}</strong> operadores com atendimentos ({inactiveCount} sem volume ocultos)
                </span>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center flex-1 text-xs text-muted-foreground">
            Nenhum operador com métricas de SLA registradas.
          </div>
        )}
      </div>

      {/* 3. Card Inferior: Tabela Executiva de Métricas de Tempo e SLA por Operador */}
      <div className="xl:col-span-3 bg-card rounded-2xl border border-border shadow-soft overflow-hidden">
        <div className="px-5 py-4 border-b border-line flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-xs font-extrabold text-foreground">Métricas de Tempo e SLA por Operador</h3>
            <p className="text-[10px] text-muted-foreground">
              Visão detalhada e desagregada da performance operacional por consultor
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Busca Rápida de Operador */}
            <div className="relative">
              <Search className="h-3.5 w-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={tableSearch}
                onChange={(e) => setTableSearch(e.target.value)}
                placeholder="Buscar agente..."
                className="h-8 pl-8 pr-3 rounded-xl bg-muted/40 border border-line text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/40 w-40 sm:w-48"
              />
            </div>

            {/* Filtro: Com Atendimentos vs. Todos */}
            <div className="flex items-center bg-muted/40 p-0.5 rounded-xl border border-line">
              <button
                type="button"
                onClick={() => setTableFilter("active")}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition cursor-pointer ${
                  tableFilter === "active"
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Com atendimentos ({activeOperators.length})
              </button>
              <button
                type="button"
                onClick={() => setTableFilter("all")}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition cursor-pointer ${
                  tableFilter === "all"
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Todos ({operators.length})
              </button>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          {filteredTableOperators.length === 0 ? (
            <div className="p-8 text-center text-xs text-muted-foreground">
              Nenhum operador encontrado para o filtro selecionado.
            </div>
          ) : (
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-muted/40 text-muted-foreground font-semibold border-b border-line">
                  <th className="px-5 py-3">
                    <button
                      type="button"
                      onClick={() => handleToggleSort("name")}
                      className="inline-flex items-center gap-1 hover:text-foreground transition cursor-pointer font-semibold"
                    >
                      Agente
                      <ArrowUpDown className="h-3 w-3 opacity-60" />
                    </button>
                  </th>
                  <th className="px-5 py-3">
                    <button
                      type="button"
                      onClick={() => handleToggleSort("chats")}
                      className="inline-flex items-center gap-1 hover:text-foreground transition cursor-pointer font-semibold"
                    >
                      Atendimentos
                      <ArrowUpDown className="h-3 w-3 opacity-60" />
                    </button>
                  </th>
                  <th className="px-5 py-3">
                    <button
                      type="button"
                      onClick={() => handleToggleSort("avgResponseSeconds")}
                      className="inline-flex items-center gap-1 hover:text-foreground transition cursor-pointer font-semibold"
                    >
                      Tempo Médio de Resposta
                      <ArrowUpDown className="h-3 w-3 opacity-60" />
                    </button>
                  </th>
                  <th className="px-5 py-3">
                    <button
                      type="button"
                      onClick={() => handleToggleSort("slaPct")}
                      className="inline-flex items-center gap-1 hover:text-foreground transition cursor-pointer font-semibold"
                    >
                      SLA Cumprido
                      <ArrowUpDown className="h-3 w-3 opacity-60" />
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filteredTableOperators.map((op) => {
                  const hasActivity = op.chats > 0 || (op.slaSampleCount ?? 0) > 0;
                  const volumeSharePct =
                    totalChatsAll > 0 ? Math.round((op.chats / totalChatsAll) * 100) : 0;
                  const volumeBarPct = Math.round((op.chats / maxOperatorChats) * 100);
                  const isFastResponse =
                    op.avgResponseSeconds > 0 && op.avgResponseSeconds <= 15 * 60;
                  const isGoalMet = hasActivity && op.slaPct >= 90;

                  return (
                    <tr key={op.id || op.name} className="hover:bg-muted/30 transition font-medium">
                      {/* Coluna 1: Agente */}
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2.5">
                          <OperatorAvatarBadge
                            name={op.name}
                            avatar={op.avatar}
                            highlight={isGoalMet}
                          />
                          <div>
                            <span className="text-foreground font-bold block leading-tight">
                              {op.name}
                            </span>
                            {!hasActivity && (
                              <span className="text-[10px] text-muted-foreground">
                                Sem atendimentos no período
                              </span>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Coluna 2: Atendimentos + Barra Proporcional */}
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <span className="text-foreground font-extrabold tabular-nums w-10">
                            {op.chats}
                          </span>
                          <div className="h-1.5 w-24 rounded-full bg-muted overflow-hidden hidden sm:block">
                            <div
                              className="h-full rounded-full bg-primary/75 transition-all duration-500"
                              style={{ width: `${op.chats > 0 ? Math.max(volumeBarPct, 4) : 0}%` }}
                            />
                          </div>
                          {op.chats > 0 && totalChatsAll > 0 && (
                            <span className="text-[10px] text-muted-foreground tabular-nums hidden md:inline">
                              ({volumeSharePct}%)
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Coluna 3: Tempo Médio de Resposta Formatado */}
                      <td className="px-5 py-3">
                        {hasActivity && op.avgResponseSeconds > 0 ? (
                          <div className="flex items-center gap-2">
                            <span className="text-foreground font-bold tabular-nums">
                              {formatDurationHuman(op.avgResponseSeconds)}
                            </span>
                            <span
                              className={`text-[9px] font-bold px-2 py-0.5 rounded-md border ${
                                isFastResponse
                                  ? "bg-primary/10 text-primary border-primary/20"
                                  : "bg-muted text-muted-foreground border-border"
                              }`}
                            >
                              {isFastResponse ? "≤ 15m" : "> 15m"}
                            </span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground font-mono text-xs">–</span>
                        )}
                      </td>

                      {/* Coluna 4: SLA Cumprido + Mini-Barra */}
                      <td className="px-5 py-3">
                        {hasActivity ? (
                          <div className="flex items-center gap-2.5">
                            <div className="h-1.5 w-20 rounded-full bg-muted overflow-hidden hidden sm:block">
                              <div
                                className="h-full rounded-full transition-all duration-500"
                                style={{
                                  width: `${Math.max(op.slaPct, 3)}%`,
                                  background: isGoalMet
                                    ? "var(--primary)"
                                    : op.slaPct >= 70
                                    ? "color-mix(in srgb, var(--primary) 62%, var(--muted-foreground))"
                                    : "var(--muted-foreground)",
                                }}
                              />
                            </div>
                            <span
                              className={`inline-flex items-center justify-center min-w-[46px] px-2.5 py-0.5 rounded-full text-[10px] font-extrabold border tabular-nums ${
                                isGoalMet
                                  ? "bg-primary/10 text-primary border-primary/25"
                                  : op.slaPct >= 70
                                  ? "bg-muted text-foreground border-border"
                                  : "bg-muted/60 text-muted-foreground border-border"
                              }`}
                            >
                              {op.slaPct}%
                            </span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground font-mono text-xs">–</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// 3. Aba: Clientes e Frequência
function ContactsTab({
  clientMetrics,
  avgDaysWithoutService,
  avgFrequency,
  ragConversionPct,
}: {
  clientMetrics: ClientMetric[];
  avgDaysWithoutService: number;
  avgFrequency: number;
  ragConversionPct: number;
}) {
  const totalNovos = useMemo(
    () => clientMetrics.reduce((sum, c) => sum + (c.novos || 0), 0),
    [clientMetrics]
  );
  const totalRecorrentes = useMemo(
    () => clientMetrics.reduce((sum, c) => sum + (c.recorrentes || 0), 0),
    [clientMetrics]
  );
  const totalClientesPeriodo = totalNovos + totalRecorrentes;
  const recorrenciaPct =
    totalClientesPeriodo > 0 ? Math.round((totalRecorrentes / totalClientesPeriodo) * 100) : 0;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 overflow-y-auto scrollbar-thin pr-1 pb-2">
      {/* Novos vs Recorrentes */}
      <div className="xl:col-span-2 bg-card rounded-2xl p-5 border border-border shadow-soft flex flex-col min-h-[320px]">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-xl bg-primary/10 border border-primary/20 text-primary flex items-center justify-center shrink-0">
              <Users className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-xs font-extrabold text-foreground">Novos Clientes vs. Recorrentes</h3>
              <p className="text-[10px] text-muted-foreground">Aquisição de novos leads vs. retenção de contatos ativos</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="px-2.5 py-1 rounded-xl bg-muted/40 border border-line text-[10px] font-semibold text-muted-foreground">
              Novos: <span className="font-extrabold text-foreground tabular-nums">{totalNovos}</span>
            </div>
            <div className="px-2.5 py-1 rounded-xl bg-muted/40 border border-line text-[10px] font-semibold text-muted-foreground">
              Recorrentes: <span className="font-extrabold text-foreground tabular-nums">{totalRecorrentes}</span>
            </div>
            <span className="text-[10px] font-bold text-primary bg-primary/10 px-2.5 py-1 rounded-xl border border-primary/20 tabular-nums">
              {recorrenciaPct}% retenção
            </span>
          </div>
        </div>

        <div className="flex-1 w-full h-[220px] mt-2">
          {clientMetrics.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={clientMetrics} margin={{ top: 10, right: 12, left: -20, bottom: 0 }} barGap={6}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--line)" />
                <XAxis dataKey="name" stroke="var(--muted-foreground)" fontSize={10} tickLine={false} axisLine={false} />
                <YAxis stroke="var(--muted-foreground)" fontSize={10} tickLine={false} axisLine={false} />
                <Tooltip content={<SystemChartTooltip />} />
                <Legend verticalAlign="top" height={32} wrapperStyle={{ fontSize: 11, fontWeight: 600 }} iconType="circle" />
                <Bar dataKey="novos" name="Novos Clientes" fill="var(--primary)" radius={[6, 6, 0, 0]} maxBarSize={28} isAnimationActive={false} />
                <Bar dataKey="recorrentes" name="Recorrentes" fill="var(--muted-foreground)" radius={[6, 6, 0, 0]} maxBarSize={28} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
              Sem dados de aquisição de contatos nas últimas semanas.
            </div>
          )}
        </div>
      </div>

      {/* Cartões Estatísticos de Contato */}
      <div className="space-y-4 flex flex-col justify-between">
        <div className="bg-card rounded-2xl p-5 border border-border shadow-soft flex items-start gap-3.5">
          <div className="h-9 w-9 rounded-xl bg-primary/10 border border-primary/20 text-primary flex items-center justify-center shrink-0">
            <Clock className="h-4.5 w-4.5" />
          </div>
          <div>
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
              Tempo Médio Sem Atendimento
            </span>
            <p className="text-2xl font-black text-foreground mt-0.5 tabular-nums">
              {avgDaysWithoutService > 0 ? `${avgDaysWithoutService} dias` : "–"}
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Média desde o último atendimento finalizado
            </p>
          </div>
        </div>

        <div className="bg-card rounded-2xl p-5 border border-border shadow-soft flex items-start gap-3.5">
          <div className="h-9 w-9 rounded-xl bg-primary/10 border border-primary/20 text-primary flex items-center justify-center shrink-0">
            <RefreshCw className="h-4.5 w-4.5" />
          </div>
          <div>
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
              Frequência Média
            </span>
            <p className="text-2xl font-black text-foreground mt-0.5 tabular-nums">
              {avgFrequency > 0 ? `${avgFrequency} vezes/mês` : "–"}
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Contatos recorrentes que reabrem conversas
            </p>
          </div>
        </div>

        <div className="bg-card rounded-2xl p-5 border border-border shadow-soft">
          <div className="flex items-start gap-3.5">
            <div className="h-9 w-9 rounded-xl bg-primary/10 border border-primary/20 text-primary flex items-center justify-center shrink-0">
              <Star className="h-4.5 w-4.5" />
            </div>
            <div className="flex-1">
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                Taxa de Conversão RAG / CSAT
              </span>
              <p className="text-2xl font-black text-foreground mt-0.5 tabular-nums">
                {ragConversionPct}%
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Satisfação estimada em auditorias de contatos recorrentes
              </p>
              <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden mt-2.5">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-500"
                  style={{ width: `${Math.max(0, Math.min(100, ragConversionPct))}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// 4. Aba: Relatórios Automáticos de IA
function ReportsTab({ reports, loading }: { reports: AiReportData[]; loading: boolean }) {
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);

  useEffect(() => {
    if (reports.length > 0 && !selectedReportId) {
      setSelectedReportId(reports[0].id);
    }
  }, [reports, selectedReportId]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground/40" />
      </div>
    );
  }

  const selectedReport = reports.find((r) => r.id === selectedReportId) || reports[0];

  return (
    <div className="flex gap-5 h-full overflow-hidden">
      {/* Lateral: Lista de Relatórios */}
      <div className="w-60 shrink-0 flex flex-col gap-2 overflow-y-auto scrollbar-thin pr-1">
        <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider px-2 block mb-1">
          Histórico de Relatórios
        </span>
        {reports.length === 0 ? (
          <div className="p-4 text-xs text-muted-foreground border border-dashed border-border rounded-xl text-center">
            Nenhum relatório de IA gerado ainda. Os relatórios são compilados diariamente às 18h.
          </div>
        ) : (
          reports.map((rep) => (
            <button
              key={rep.id}
              onClick={() => setSelectedReportId(rep.id)}
              className={`w-full text-left p-3 rounded-xl border transition-all cursor-pointer ${
                selectedReportId === rep.id
                  ? "border-primary bg-primary-soft/50 text-primary font-bold shadow-soft"
                  : "border-border bg-card text-foreground hover:bg-muted/40"
              }`}
            >
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="capitalize">{rep.type === "weekly" ? "Semanal" : "Diário"}</span>
                <span className="text-[9px] text-muted-foreground font-mono">
                  {rep.period}
                </span>
              </div>
              <p className="text-[9px] text-muted-foreground/80">
                Gerado em: {new Date(rep.generatedAt).toLocaleDateString("pt-BR")}
              </p>
            </button>
          ))
        )}
      </div>

      {/* Principal: Visualizador Markdown */}
      <div className="flex-1 bg-card rounded-2xl border border-border shadow-soft p-6 overflow-y-auto scrollbar-thin">
        {selectedReport ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-line pb-4">
              <div>
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase ${
                  selectedReport.type === "weekly" ? "bg-primary/10 text-primary border border-primary/20" : "bg-muted text-foreground border border-border"
                }`}>
                  Relatório {selectedReport.type === "weekly" ? "Semanal" : "Diário"}
                </span>
                <span className="text-[10px] text-muted-foreground ml-2">Período: {selectedReport.period}</span>
              </div>
              
              <span className="text-[9px] text-muted-foreground font-medium">
                Sincronizado via IA em {new Date(selectedReport.generatedAt).toLocaleString("pt-BR")}
              </span>
            </div>

            {/* Renderizador de Markdown */}
            <div className="space-y-3 font-sans">
              {parseMarkdown(selectedReport.reportMarkdown)}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground text-xs">
            Selecione um relatório para visualizar.
          </div>
        )}
      </div>
    </div>
  );
}

// ── Componente Principal ─────────────────────────────────────────────────────
export function AnalyticsView() {
  const { tenant } = useChat();
  const { canAccessAnalyticsTab } = usePermissions();
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [performanceError, setPerformanceError] = useState<string | null>(null);

  // Estados para dados reais das abas
  const [overview, setOverview] = useState<any | null>(null);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [audits, setAudits] = useState<any[]>([]);

  // Filtros executivos da aba Desempenho
  const [perfPeriod, setPerfPeriod] = useState<PerformancePeriod>("7d");
  const [perfSectorFilter, setPerfSectorFilter] = useState<string>("all");
  const [perfChannelFilter, setPerfChannelFilter] = useState<PerformanceChannelFilter>("all");
  const [perfLoading, setPerfLoading] = useState(false);

  const [performanceData, setPerformanceData] = useState<PerformancePayload>({
    volumes: [],
    channels: [],
    sectors: [],
    sectorDetails: [],
    hourlyDemand: [],
    consultantProductivity: [],
  });

  const [slaData, setSlaData] = useState<{
    overallSlaPct: number;
    overdueCount: number;
    totalSlaCount?: number;
    withinSlaCount?: number;
    overallAvgResponseSeconds?: number;
    operators: OperatorPerformance[];
  }>({
    overallSlaPct: 100,
    overdueCount: 0,
    totalSlaCount: 0,
    withinSlaCount: 0,
    overallAvgResponseSeconds: 0,
    operators: [],
  });

  const [contactsData, setContactsData] = useState<ContactsAnalyticsPayload>({
    clientMetrics: [],
    avgDaysWithoutService: 0,
    avgFrequency: 0,
    ragConversionPct: 0,
  });

  const [reports, setReports] = useState<AiReportData[]>([]);

  const [lcMetrics, setLcMetrics] = useState<{
    totalChats: number;
    activeSessions: number;
    bridgesWhatsapp: number;
    avgScore: number;
    conversionRate: number;
  } | null>(null);

  const fetchPerformanceOnly = useCallback(
    async (
      periodArg: PerformancePeriod,
      sectorArg: string,
      channelArg: PerformanceChannelFilter
    ) => {
      setPerfLoading(true);
      setPerformanceError(null);
      try {
        const params = new URLSearchParams({
          tenantId: String(tenant || ""),
          period: periodArg,
          sectorId: sectorArg,
          channel: channelArg,
        });
        const perfRes = await fetch(`/api/gestao/performance?${params.toString()}`);
        if (perfRes.ok) {
          const pData = await perfRes.json();
          setPerformanceData({
            ...pData,
            volumes: pData.volumes || [],
            channels: pData.channels || [],
            sectors: pData.sectors || [],
            sectorDetails: pData.sectorDetails || [],
            hourlyDemand: pData.hourlyDemand || [],
            consultantProductivity: pData.consultantProductivity || [],
          });
        } else {
          setPerformanceData({ volumes: [], channels: [], sectors: [] });
          setPerformanceError("Indicadores de desempenho indisponíveis. Tente atualizar novamente.");
        }
      } catch (e) {
        console.error("[AnalyticsView] Erro ao atualizar aba Desempenho:", e);
        setPerformanceError("Não foi possível atualizar os indicadores de desempenho.");
      } finally {
        setPerfLoading(false);
      }
    },
    [tenant]
  );

  const fetchData = useCallback(async () => {
    setLoading(true);
    setPerformanceError(null);
    try {
      const perfParams = new URLSearchParams({
        tenantId: String(tenant || ""),
        period: perfPeriod,
        sectorId: perfSectorFilter,
        channel: perfChannelFilter,
      });

      // Buscar dados reais de todas as APIs do módulo de estatísticas em paralelo
      const [ovRes, alRes, auRes, perfRes, slaRes, contRes, repRes] = await Promise.all([
        fetch(`/api/gestao/overview?tenantId=${tenant}`),
        fetch(`/api/gestao/alerts?tenantId=${tenant}`),
        fetch(`/api/gestao/audits?tenantId=${tenant}&limit=50`),
        fetch(`/api/gestao/performance?${perfParams.toString()}`),
        fetch(`/api/gestao/sla?tenantId=${tenant}`),
        fetch(`/api/gestao/contacts-analytics?tenantId=${tenant}`),
        fetch(`/api/gestao/reports?tenantId=${tenant}`),
      ]);

      if (ovRes.ok) setOverview(await ovRes.json());
      if (alRes.ok) setAlerts(await alRes.json());
      if (auRes.ok) setAudits(await auRes.json());

      if (perfRes.ok) {
        const pData = await perfRes.json();
        setPerformanceData({
          ...pData,
          volumes: pData.volumes || [],
          channels: pData.channels || [],
          sectors: pData.sectors || [],
          sectorDetails: pData.sectorDetails || [],
          hourlyDemand: pData.hourlyDemand || [],
          consultantProductivity: pData.consultantProductivity || [],
        });
      } else {
        setPerformanceData({ volumes: [], channels: [], sectors: [] });
        setPerformanceError("Indicadores de desempenho indisponíveis. Tente atualizar novamente.");
      }

      if (slaRes.ok) {
        const sData = await slaRes.json();
        setSlaData({
          overallSlaPct: sData.overallSlaPct ?? 100,
          overdueCount: sData.overdueCount ?? 0,
          totalSlaCount: sData.totalSlaCount,
          withinSlaCount: sData.withinSlaCount,
          overallAvgResponseSeconds: sData.overallAvgResponseSeconds,
          operators: sData.operators || [],
        });
      }

      if (contRes.ok) {
        const cData = await contRes.json();
        setContactsData({
          ...cData,
          clientMetrics: cData.clientMetrics || [],
          avgDaysWithoutService: cData.avgDaysWithoutService ?? 0,
          avgFrequency: cData.avgFrequency ?? 0,
          ragConversionPct: cData.ragConversionPct ?? 0,
        });
      }

      if (repRes.ok) {
        const rData = await repRes.json();
        if (Array.isArray(rData)) setReports(rData);
      }

      setLastRefresh(new Date());
    } catch (e) {
      console.error("[AnalyticsView] Erro ao carregar dados reais de BI:", e);
      setPerformanceData({ volumes: [], channels: [], sectors: [] });
      setPerformanceError("Não foi possível atualizar os indicadores de desempenho.");
    } finally {
      setLoading(false);
    }
  }, [tenant, perfPeriod, perfSectorFilter, perfChannelFilter]);

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant]);

  useEffect(() => {
    const load = async () => {
      try {
        const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "";
        const res = await fetch(`${BACKEND_URL}/api/livechat/metrics?tenantId=${tenant}&hours=24`);
        if (res.ok) setLcMetrics(await res.json());
      } catch {}
    };
    load();
  }, [tenant]);

  const allTabs: { id: AnalyticsTab; label: string; icon: React.ElementType }[] = [
    { id: "overview",     label: "Visão Geral",   icon: Eye },
    { id: "performance",  label: "Desempenho",     icon: BarChart2 },
    { id: "sla",          label: "SLA & Tempos",   icon: Clock },
    { id: "contacts",     label: "Clientes",       icon: Users },
    { id: "reports",      label: "Relatórios IA",  icon: FileText },
    { id: "costs",        label: "Custos",         icon: Coins },
  ];

  const allowedTabs = allTabs.filter(t => canAccessAnalyticsTab(t.id));
  const allowedTabIds = useMemo(() => allowedTabs.map((t) => t.id), [allowedTabs]);
  const [activeTab, setActiveTab] = useState<AnalyticsTab>(() =>
    getInitialTabFromUrl("analytics", allowedTabs[0]?.id || "overview", allowedTabIds),
  );

  useTabNavigation({
    tabs: allowedTabIds,
    activeTab,
    onChange: setActiveTab,
  });

  useSyncModuleTabWithUrl({
    viewId: "analytics",
    activeTab,
    setActiveTab,
    allowedTabs: allowedTabIds,
  });

  const [costViewMode, setCostViewMode] = useState<"ai" | "meta">("ai");

  useEffect(() => {
    if (!allowedTabs.some(t => t.id === activeTab)) {
      if (allowedTabs.length > 0) {
        setActiveTab(allowedTabs[0].id);
      }
    }
  }, [allowedTabs, activeTab]);

  return (
    <div className="flex flex-col h-full bg-card rounded-3xl border border-border shadow-soft overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 md:px-6 py-3.5 md:py-4 border-b border-line shrink-0">
        <div>
          <h1 className="text-base font-extrabold text-foreground flex items-center gap-2">
            <BarChart2 className="h-4.5 w-4.5 text-primary" />
            Estatísticas da Operação
          </h1>
          <p className="text-[11px] text-muted-foreground mt-0.5">Análise e BI de performance histórica consolidada</p>
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          {activeTab === "costs" && (
            <SystemTooltip
              content={
                costViewMode === "meta"
                  ? "Alternar para Custos de I.A. (Vertex AI)"
                  : "Custos WhatsApp (Meta Oficial API)"
              }
              side="bottom"
            >
              <button
                type="button"
                onClick={() => setCostViewMode((prev) => (prev === "ai" ? "meta" : "ai"))}
                aria-label={
                  costViewMode === "meta"
                    ? "Alternar para Custos de I.A. (Vertex AI)"
                    : "Ver Custos WhatsApp (Meta Oficial API)"
                }
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                  costViewMode === "meta"
                    ? "bg-primary text-primary-foreground border-primary shadow-soft"
                    : "bg-muted/40 border-line text-muted-foreground hover:text-primary hover:border-primary/40 hover:bg-primary/5"
                }`}
              >
                <WhatsappLogo className="h-3.5 w-3.5 shrink-0" />
                <span className="hidden sm:inline text-[11px]">
                  {costViewMode === "meta" ? "Meta Oficial API" : "Custos Meta API"}
                </span>
              </button>
            </SystemTooltip>
          )}
          <SystemTooltip content="Atualizar agora" side="bottom">
            <button
              type="button"
              onClick={fetchData}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition cursor-pointer shrink-0"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin text-primary" : ""}`} />
              {lastRefresh.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
            </button>
          </SystemTooltip>
        </div>
      </div>

      {/* Interna Tab Bar */}
      <div className="flex items-center gap-1 px-3 md:px-5 py-2.5 border-b border-line bg-muted/30 shrink-0 overflow-x-auto scrollbar-none">
        {allowedTabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`shrink-0 whitespace-nowrap relative flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                isActive
                  ? "bg-primary text-primary-foreground shadow-soft"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      {activeTab === "reports" ? (
        <ReportsIATab tenant={tenant} refreshTrigger={lastRefresh.getTime()} />
      ) : (
        <div className="flex-1 overflow-y-auto md:overflow-hidden px-3 md:px-5 py-4 flex flex-col">
          {activeTab === "overview" && (
            <>
              <OverviewTab
                overview={overview}
                alerts={alerts}
                audits={audits}
                onSwitchTab={() => {}}
              />

              {/* ─── SEÇÃO LIVE CHAT ────────────────────────────────────────────────── */}
              {lcMetrics !== null && (
                <div className="rounded-2xl bg-card border border-border p-6 shadow-soft mt-5">
                  <div className="flex items-center gap-3 mb-5">
                    <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary grid place-items-center">
                      <Globe className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="text-sm font-extrabold text-foreground">Live Chat (Site)</h3>
                      <p className="text-xs text-muted-foreground">Atendimentos via widget — últimas 24h</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                    {([
                      { label: "Sessões",        value: lcMetrics.totalChats,      icon: MessageSquare },
                      { label: "Ativas agora",   value: lcMetrics.activeSessions,  icon: Activity },
                      { label: "Bridges WA",     value: lcMetrics.bridgesWhatsapp, icon: Phone },
                      { label: "Score médio",    value: lcMetrics.avgScore,        icon: TrendingUp },
                      { label: "Conversão",      value: `${lcMetrics.conversionRate}%`, icon: Zap },
                    ] as const).map(({ label, value, icon: Icon }) => (
                      <div key={label} className="rounded-xl bg-muted/40 p-4 border border-border/50">
                        <div className="flex items-center gap-2 mb-2">
                          <Icon className="h-3.5 w-3.5 text-primary" />
                          <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">{label}</span>
                        </div>
                        <p className="text-2xl font-extrabold text-foreground">{value}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {activeTab === "performance" && (
            performanceError ? (
              <div role="alert" className="rounded-xl border border-border bg-muted/40 p-4 text-sm text-foreground">
                {performanceError}
              </div>
            ) : (
              <PerformanceTab
                tenant={String(tenant || "tecfag")}
                data={performanceData}
                period={perfPeriod}
                onChangePeriod={(nextPeriod) => {
                  setPerfPeriod(nextPeriod);
                  fetchPerformanceOnly(nextPeriod, perfSectorFilter, perfChannelFilter);
                }}
                sectorFilter={perfSectorFilter}
                onChangeSectorFilter={(nextSector) => {
                  setPerfSectorFilter(nextSector);
                  fetchPerformanceOnly(perfPeriod, nextSector, perfChannelFilter);
                }}
                channelFilter={perfChannelFilter}
                onChangeChannelFilter={(nextChannel) => {
                  setPerfChannelFilter(nextChannel);
                  fetchPerformanceOnly(perfPeriod, perfSectorFilter, nextChannel);
                }}
                loading={loading || perfLoading}
              />
            )
          )}
          {activeTab === "sla" && (
            <SlaTab
              overallSlaPct={slaData.overallSlaPct}
              overdueCount={slaData.overdueCount}
              totalSlaCount={slaData.totalSlaCount}
              withinSlaCount={slaData.withinSlaCount}
              overallAvgResponseSeconds={slaData.overallAvgResponseSeconds}
              operators={slaData.operators}
            />
          )}
          {activeTab === "contacts" && (
            <ContactsAnalyticsTab
              initialData={contactsData}
              tenant={tenant}
              refreshTrigger={lastRefresh.getTime()}
            />
          )}
          {activeTab === "costs" && (
            <CostsTab
              tenant={tenant}
              costViewMode={costViewMode}
              onChangeCostViewMode={setCostViewMode}
            />
          )}
        </div>
      )}
    </div>
  );
}
