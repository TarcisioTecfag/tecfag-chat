import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useChat } from "@/hooks/useChatState";
import { SystemTooltip } from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useEnhancedAvatarSrc } from "@/lib/avatar-image";
import { buildPhoneQueryPlan, matchesPhoneSearchQuery } from "@/lib/utils";
import {
  Users,
  Building2,
  Briefcase,
  TrendingUp,
  TrendingDown,
  Clock,
  RefreshCw,
  Star,
  AlertTriangle,
  CheckCircle2,
  MessageSquare,
  ExternalLink,
  Search,
  ArrowUpDown,
  Filter,
  ShieldAlert,
  UserCheck,
  UserX,
  Mail,
  Phone,
  Tag,
  Layers,
  Sparkles,
  Award,
  Coins,
  Target,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";

// ── Tipos do Endpoint /api/gestao/contacts-analytics ─────────────────────────

export type ClientWeeklyMetric = {
  name: string;
  shortName?: string;
  periodLabel?: string;
  novos: number;
  novosAtendidos?: number;
  recorrentes: number;
  comNegocio?: number;
};

export type ContactsAnalyticsOperatorItem = {
  id: string;
  name: string;
  avatar: string | null;
};

export type ContactsSummaryKpis = {
  totalContacts: number;
  companiesCount: number;
  personsCount: number;
  newInPeriod: number;
  newInPrevPeriod: number;
  newDeltaPct: number;
  activeInPeriodCount: number;
  newActiveInPeriodCount: number;
  returningActiveInPeriodCount: number;
  activeRatePct: number;
  retentionRatePct: number;
  contactsWithConvCount: number;
  contactsWithAnyDealCount: number;
  contactsWithOpenDealCount: number;
  contactsChatWithoutDealCount: number;
  crmCoveragePct: number;
  wonClientsCount: number;
  totalWonDeals: number;
  totalWonRevenue: number;
  totalOpenDeals: number;
  totalOpenPipelineValue: number;
  avgTicketPerBuyer: number;
  atRiskWithOpenDealCount: number;
  atRiskOpenValue: number;
  waitingReplyCount: number;
  avgDaysWithoutService: number;
  avgFrequency: number;
  csat: {
    pct: number | null;
    sampleSize: number;
    satisfiedCount: number;
    neutralCount: number;
    frustratedCount: number;
    neutralPct: number;
    frustratedPct: number;
    avgAuditScore: number | null;
  };
};

export type ContactsDataHealth = {
  totalBase: number;
  withWalletCount: number;
  orphanContactsCount: number;
  withWalletPct: number;
  withEmailCount: number;
  withEmailPct: number;
  companiesLinkedCount: number;
  companiesLinkedPct: number;
  withMultiPhonesCount: number;
  withMultiPhonesPct: number;
  withTagsCount: number;
  withTagsPct: number;
};

export type ContactsFunnelStep = {
  id: string;
  label: string;
  sublabel: string;
  count: number;
  pctOfBase: number;
  conversionFromPrevPct: number;
};

export type ContactsInactivityBucket = {
  id: string;
  label: string;
  shortLabel: string;
  description: string;
  count: number;
  pct: number;
  openDealsCount: number;
  openPipelineValue: number;
};

export type ContactsAcquisitionItem = {
  name: string;
  clientsCount: number;
  dealsCount: number;
  wonCount: number;
  openCount?: number;
  wonValue: number;
  openValue: number;
  conversionPct: number;
};

export type ConsultantPortfolioRow = {
  operatorId: string;
  operatorName: string;
  avatar: string | null;
  walletContactsCount: number;
  activeInPeriodCount: number;
  activeSharePct: number;
  openDealsCount: number;
  openPipelineValue: number;
  wonClientsCount: number;
  wonRevenue: number;
  staleClientsCount: number;
  withoutDealCount: number;
  avgResponseSeconds: number;
};

export type PriorityClientRow = {
  contactId: string;
  name: string;
  phone: string | null;
  email: string | null;
  avatar: string | null;
  channel: string;
  companyName: string | null;
  operatorId: string | null;
  operatorName: string;
  operatorAvatar: string | null;
  conversationId: string | null;
  queueState: string | null;
  unreadCount: number;
  lastInteractionAt: string | null;
  daysSinceLastContact: number | null;
  openDealsCount: number;
  wonDealsCount: number;
  lostDealsCount: number;
  openDealValue: number;
  wonDealValue: number;
  primaryDealId: string | null;
  primaryDealTitle: string | null;
  primaryDealStatus: string | null;
  source: string | null;
  campaign: string | null;
  sentiment: "satisfeito" | "neutro" | "frustrado" | null;
  riskFlags: string[];
  priorityScore: number;
};

export type ContactsAnalyticsPayload = {
  clientMetrics: ClientWeeklyMetric[];
  avgDaysWithoutService: number;
  avgFrequency: number;
  ragConversionPct: number;
  period?: {
    key: "7d" | "30d" | "90d" | "month" | "all";
    label: string;
    startISO: string;
  };
  operatorsList?: ContactsAnalyticsOperatorItem[];
  summaryKpis?: ContactsSummaryKpis | null;
  dataHealth?: ContactsDataHealth | null;
  lifecycleFunnel?: ContactsFunnelStep[];
  inactivityBuckets?: ContactsInactivityBucket[];
  acquisitionSources?: ContactsAcquisitionItem[];
  acquisitionCampaigns?: ContactsAcquisitionItem[];
  consultantPortfolios?: ConsultantPortfolioRow[];
  priorityClients?: PriorityClientRow[];
};

// ── Formatadores Auxiliares ──────────────────────────────────────────────────

function formatCurrencyBRL(val: number | null | undefined, compact = false): string {
  const num = Number(val || 0);
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

function formatDurationShort(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return "–";
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const remS = s % 60;
  if (m < 60) return remS > 0 ? `${m}m ${remS}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return remM > 0 ? `${h}h ${remM}m` : `${h}h`;
}

function getInitials(name: string): string {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "CL";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function AvatarBadge({
  name,
  avatar,
  highlight = false,
  sizeClass = "h-7 w-7 text-[10px]",
}: {
  name: string;
  avatar?: string | null;
  highlight?: boolean;
  sizeClass?: string;
}) {
  const [imgErr, setImgErr] = useState(false);
  const resolved = useEnhancedAvatarSrc(avatar);

  useEffect(() => {
    setImgErr(false);
  }, [avatar]);

  if (resolved && !imgErr) {
    return (
      <img
        src={resolved}
        alt={name}
        decoding="async"
        onError={() => setImgErr(true)}
        className={`${sizeClass} rounded-full object-cover shrink-0 border ${
          highlight ? "border-primary/40" : "border-border"
        }`}
      />
    );
  }
  return (
    <div
      className={`${sizeClass} rounded-full shrink-0 flex items-center justify-center font-extrabold border ${
        highlight
          ? "bg-primary/15 text-primary border-primary/30"
          : "bg-muted text-muted-foreground border-border"
      }`}
    >
      {getInitials(name)}
    </div>
  );
}

function WeeklyChartTooltip({ active, payload, label }: any) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]?.payload as ClientWeeklyMetric | undefined;
  return (
    <div className="bg-card/95 backdrop-blur-md border border-border rounded-xl p-3 shadow-card min-w-[180px]">
      <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground border-b border-line pb-1.5 mb-2">
        {row?.periodLabel ? `${row.shortName || label} (${row.periodLabel})` : label}
      </p>
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
            <span className="font-extrabold text-foreground tabular-nums">{entry.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Componente Principal da Aba Clientes ─────────────────────────────────────

export function ContactsAnalyticsTab({
  initialData,
  tenant,
  refreshTrigger,
}: {
  initialData?: ContactsAnalyticsPayload;
  tenant: string | null;
  refreshTrigger?: number;
}) {
  const navigate = useNavigate();
  const { setActiveQueue, setSelectedChatId, setActiveView } = useChat();

  const [period, setPeriod] = useState<"7d" | "30d" | "90d" | "month" | "all">("30d");
  const [operatorFilter, setOperatorFilter] = useState<string>("all");
  const [channelFilter, setChannelFilter] = useState<string>("all");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ContactsAnalyticsPayload | null>(initialData || null);

  // Estados de interação das seções inferiores
  const [acqMode, setAcqMode] = useState<"sources" | "campaigns">("sources");
  const [bottomView, setBottomView] = useState<"consultants" | "clients">("consultants");
  const [clientSegment, setClientSegment] = useState<
    "all" | "risk" | "no_deal" | "vip" | "orphan"
  >("all");
  const [tableSearch, setTableSearch] = useState("");
  const [consultantSortField, setConsultantSortField] = useState<
    "walletContactsCount" | "activeInPeriodCount" | "openPipelineValue" | "wonRevenue" | "staleClientsCount"
  >("walletContactsCount");
  const [consultantSortDir, setConsultantSortDir] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    if (initialData && period === "30d" && operatorFilter === "all" && channelFilter === "all") {
      setData(initialData);
    }
  }, [initialData, period, operatorFilter, channelFilter]);

  const loadAnalytics = useCallback(async () => {
    if (!tenant) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        tenantId: tenant,
        period,
        operatorId: operatorFilter,
        channel: channelFilter,
      });
      const res = await fetch(`/api/gestao/contacts-analytics?${params.toString()}`);
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch (e) {
      console.error("[ContactsAnalyticsTab] Erro ao carregar métricas de clientes:", e);
    } finally {
      setLoading(false);
    }
  }, [tenant, period, operatorFilter, channelFilter]);

  useEffect(() => {
    void loadAnalytics();
  }, [loadAnalytics, refreshTrigger]);

  const clientMetrics = data?.clientMetrics || [];
  const kpis = data?.summaryKpis;
  const health = data?.dataHealth;
  const funnel = data?.lifecycleFunnel || [];
  const aging = data?.inactivityBuckets || [];
  const sources = data?.acquisitionSources || [];
  const campaigns = data?.acquisitionCampaigns || [];
  const portfolios = data?.consultantPortfolios || [];
  const priorityClients = data?.priorityClients || [];
  const operatorsList = data?.operatorsList || [];

  const totalNovos = useMemo(
    () => clientMetrics.reduce((sum, c) => sum + (c.novos || 0), 0),
    [clientMetrics]
  );
  const totalRecorrentes = useMemo(
    () => clientMetrics.reduce((sum, c) => sum + (c.recorrentes || 0), 0),
    [clientMetrics]
  );
  const totalComNegocioSemanal = useMemo(
    () => clientMetrics.reduce((sum, c) => sum + (c.comNegocio || 0), 0),
    [clientMetrics]
  );

  // Ordenação da tabela de Carteira por Consultor
  const sortedPortfolios = useMemo(() => {
    const q = tableSearch.trim().toLowerCase();
    const filtered = q
      ? portfolios.filter((p) => p.operatorName.toLowerCase().includes(q))
      : [...portfolios];
    const dir = consultantSortDir === "asc" ? 1 : -1;
    return filtered.sort((a, b) => {
      const valA = a[consultantSortField] ?? 0;
      const valB = b[consultantSortField] ?? 0;
      if (valA !== valB) return (valA - valB) * dir;
      return b.walletContactsCount - a.walletContactsCount;
    });
  }, [portfolios, tableSearch, consultantSortField, consultantSortDir]);

  // Filtragem da tabela de Clientes Prioritários / Em Risco
  const filteredPriorityClients = useMemo(() => {
    const q = tableSearch.trim().toLowerCase();
    const phonePlan = q ? buildPhoneQueryPlan(tableSearch) : null;
    return priorityClients.filter((c) => {
      if (clientSegment === "risk") {
        const isStaleDeal =
          c.openDealsCount > 0 && (c.daysSinceLastContact === null || c.daysSinceLastContact > 15);
        const isFrustrated = c.sentiment === "frustrado";
        const isWaiting = c.queueState === "fila" || c.unreadCount > 0;
        if (!isStaleDeal && !isFrustrated && !isWaiting) return false;
      } else if (clientSegment === "no_deal") {
        if (c.openDealsCount + c.wonDealsCount + c.lostDealsCount > 0 || !c.conversationId) {
          return false;
        }
      } else if (clientSegment === "vip") {
        if (c.openDealValue <= 0 && c.wonDealValue <= 0 && c.wonDealsCount <= 0) return false;
      } else if (clientSegment === "orphan") {
        if (c.operatorId !== null) return false;
      }

      if (q) {
        const hay = `${c.name} ${c.companyName || ""} ${c.phone || ""} ${c.email || ""} ${c.operatorName || ""} ${c.source || ""}`.toLowerCase();
        if (!hay.includes(q) && !matchesPhoneSearchQuery(c.phone, phonePlan)) return false;
      }
      return true;
    });
  }, [priorityClients, clientSegment, tableSearch]);

  const handleToggleConsultantSort = (
    field:
      | "walletContactsCount"
      | "activeInPeriodCount"
      | "openPipelineValue"
      | "wonRevenue"
      | "staleClientsCount"
  ) => {
    if (consultantSortField === field) {
      setConsultantSortDir((prev) => (prev === "desc" ? "asc" : "desc"));
    } else {
      setConsultantSortField(field);
      setConsultantSortDir("desc");
    }
  };

  const handleOpenChat = (conversationId: string | null) => {
    if (!conversationId) return;
    setActiveQueue("todos");
    setSelectedChatId(conversationId);
    setActiveView("chat");
  };

  const handleOpenDeal = (dealId: string | null) => {
    if (!dealId) return;
    navigate({ to: "/crm/deals/$dealId", params: { dealId }, search: { from: "crm" } });
  };

  const activeAcqList = acqMode === "sources" ? sources : campaigns;
  const maxAcqClients = useMemo(
    () => Math.max(1, ...activeAcqList.map((item) => item.clientsCount || 0)),
    [activeAcqList]
  );

  return (
    <div className="space-y-5 overflow-y-auto scrollbar-thin pr-1 pb-4">
      {/* ── 1. BARRA DE CONTROLE EXECUTIVA (FILTROS DE PERÍODO, CONSULTOR E CANAL) ── */}
      <div className="bg-card rounded-2xl p-3.5 border border-border shadow-soft flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-xl bg-primary/10 border border-primary/20 text-primary flex items-center justify-center shrink-0">
            <Users className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-xs font-extrabold text-foreground flex items-center gap-2">
              Inteligência da Base de Clientes & Carteira Comercial
              {loading && <RefreshCw className="h-3 w-3 animate-spin text-primary" />}
            </h2>
            <p className="text-[10px] text-muted-foreground">
              Visão executiva consolidada: aquisição, retenção, cobertura de CRM, inatividade e receita por cliente
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Seletor de Período */}
          <div className="flex items-center bg-muted/40 p-0.5 rounded-xl border border-line">
            {(
              [
                { id: "7d", label: "7 dias" },
                { id: "30d", label: "30 dias" },
                { id: "month", label: "Este Mês" },
                { id: "90d", label: "90 dias" },
                { id: "all", label: "Histórico" },
              ] as const
            ).map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPeriod(p.id)}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition cursor-pointer ${
                  period === p.id
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Seletor Customizado de Consultor */}
          <div className="w-48">
            <Select value={operatorFilter} onValueChange={setOperatorFilter}>
              <SelectTrigger className="h-8 rounded-xl text-xs px-3 bg-muted/40 border-line">
                <SelectValue placeholder="Todos os Consultores" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs font-semibold">
                  Todos os Consultores
                </SelectItem>
                <SelectItem value="unassigned" className="text-xs font-semibold">
                  Sem Consultor (Órfãos)
                </SelectItem>
                {operatorsList.map((op) => (
                  <SelectItem key={op.id} value={op.id} className="text-xs">
                    {op.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Seletor Customizado de Canal */}
          <div className="w-36">
            <Select value={channelFilter} onValueChange={setChannelFilter}>
              <SelectTrigger className="h-8 rounded-xl text-xs px-3 bg-muted/40 border-line">
                <SelectValue placeholder="Todos os Canais" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs font-semibold">
                  Todos os Canais
                </SelectItem>
                <SelectItem value="whatsapp" className="text-xs">
                  WhatsApp
                </SelectItem>
                <SelectItem value="livechat" className="text-xs">
                  Site (Live Chat)
                </SelectItem>
                <SelectItem value="instagram" className="text-xs">
                  Instagram
                </SelectItem>
                <SelectItem value="messenger" className="text-xs">
                  Messenger
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {(operatorFilter !== "all" || channelFilter !== "all" || period !== "30d") && (
            <SystemTooltip content="Restaurar filtros padrão (30 dias · Todos)">
              <button
                type="button"
                onClick={() => {
                  setPeriod("30d");
                  setOperatorFilter("all");
                  setChannelFilter("all");
                }}
                className="h-8 px-2.5 rounded-xl border border-line bg-muted/30 text-[10px] font-bold text-muted-foreground hover:text-foreground transition cursor-pointer"
              >
                Limpar
              </button>
            </SystemTooltip>
          )}
        </div>
      </div>

      {/* ── 2. FAIXA DE 6 KPIS EXECUTIVOS DE TOPO ─────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-6 gap-3.5">
        {/* KPI 1: Base Total de Clientes */}
        <SystemTooltip content="Total de contatos cadastrados no escopo selecionado, divididos entre Empresas (PJ) e Pessoas Físicas (PF), mais novos cadastros no período.">
          <div className="bg-card rounded-2xl p-4 border border-border shadow-soft flex flex-col justify-between">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-extrabold text-muted-foreground uppercase tracking-wider">
                Base Total
              </span>
              <div className="h-7 w-7 rounded-lg bg-primary/10 border border-primary/20 text-primary flex items-center justify-center shrink-0">
                <Users className="h-3.5 w-3.5" />
              </div>
            </div>
            <div className="my-2">
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-black text-foreground tabular-nums">
                  {(kpis?.totalContacts ?? 0).toLocaleString("pt-BR")}
                </span>
                {kpis && kpis.newInPeriod > 0 && (
                  <span className="inline-flex items-center gap-0.5 text-[10px] font-extrabold text-primary bg-primary/10 px-1.5 py-0.5 rounded-md border border-primary/20 tabular-nums">
                    +{kpis.newInPeriod} novos
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-2 border-t border-line tabular-nums">
              <span>
                <strong className="text-foreground">{kpis?.companiesCount ?? 0}</strong> Empresas PJ
              </span>
              <span>
                <strong className="text-foreground">{kpis?.personsCount ?? 0}</strong> PF
              </span>
            </div>
          </div>
        </SystemTooltip>

        {/* KPI 2: Clientes Ativos & Retenção */}
        <SystemTooltip content="Clientes únicos que interagiram no chat dentro do período selecionado, separando novos atendimentos de clientes recorrentes que retornaram.">
          <div className="bg-card rounded-2xl p-4 border border-border shadow-soft flex flex-col justify-between">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-extrabold text-muted-foreground uppercase tracking-wider">
                Ativos no Período
              </span>
              <div className="h-7 w-7 rounded-lg bg-primary/10 border border-primary/20 text-primary flex items-center justify-center shrink-0">
                <MessageSquare className="h-3.5 w-3.5" />
              </div>
            </div>
            <div className="my-2">
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-black text-foreground tabular-nums">
                  {(kpis?.activeInPeriodCount ?? 0).toLocaleString("pt-BR")}
                </span>
                <span className="text-[10px] font-bold text-muted-foreground tabular-nums">
                  ({kpis?.activeRatePct ?? 0}% da base)
                </span>
              </div>
            </div>
            <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-2 border-t border-line tabular-nums">
              <span>
                <strong className="text-foreground">{kpis?.newActiveInPeriodCount ?? 0}</strong> novos
              </span>
              <span>
                <strong className="text-primary">{kpis?.returningActiveInPeriodCount ?? 0}</strong> recorrentes ({kpis?.retentionRatePct ?? 0}%)
              </span>
            </div>
          </div>
        </SystemTooltip>

        {/* KPI 3: Cobertura Comercial (Chat <-> CRM) */}
        <SystemTooltip content="Proporção dos clientes atendidos no chat que possuem negociação vinculada no CRM. Destaca também clientes atendidos no WhatsApp que ainda estão sem card criado.">
          <div className="bg-card rounded-2xl p-4 border border-border shadow-soft flex flex-col justify-between">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-extrabold text-muted-foreground uppercase tracking-wider">
                Cobertura CRM
              </span>
              <div className="h-7 w-7 rounded-lg bg-primary/10 border border-primary/20 text-primary flex items-center justify-center shrink-0">
                <Briefcase className="h-3.5 w-3.5" />
              </div>
            </div>
            <div className="my-2">
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-black text-foreground tabular-nums">
                  {kpis?.crmCoveragePct ?? 0}%
                </span>
                <span className="text-[10px] font-bold text-muted-foreground tabular-nums">
                  ({kpis?.contactsWithAnyDealCount ?? 0} c/ card)
                </span>
              </div>
            </div>
            <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-2 border-t border-line tabular-nums">
              <span>
                <strong className="text-foreground">{kpis?.contactsWithOpenDealCount ?? 0}</strong> em aberto
              </span>
              <button
                type="button"
                onClick={() => {
                  setBottomView("clients");
                  setClientSegment("no_deal");
                }}
                className="text-primary font-bold hover:underline cursor-pointer"
              >
                {kpis?.contactsChatWithoutDealCount ?? 0} s/ card CRM
              </button>
            </div>
          </div>
        </SystemTooltip>

        {/* KPI 4: Clientes Compradores & Receita */}
        <SystemTooltip content="Clientes com negociações ganhas (Won), receita total fechada e ticket médio por cliente comprador.">
          <div className="bg-card rounded-2xl p-4 border border-border shadow-soft flex flex-col justify-between">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-extrabold text-muted-foreground uppercase tracking-wider">
                Compradores (Won)
              </span>
              <div className="h-7 w-7 rounded-lg bg-primary/10 border border-primary/20 text-primary flex items-center justify-center shrink-0">
                <Coins className="h-3.5 w-3.5" />
              </div>
            </div>
            <div className="my-2">
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-black text-foreground tabular-nums">
                  {kpis?.wonClientsCount ?? 0}
                </span>
                <span className="text-[10px] font-extrabold text-primary bg-primary/10 px-1.5 py-0.5 rounded-md border border-primary/20 tabular-nums">
                  {formatCurrencyBRL(kpis?.totalWonRevenue ?? 0, true)}
                </span>
              </div>
            </div>
            <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-2 border-t border-line tabular-nums">
              <span>
                Ticket:{" "}
                <strong className="text-foreground">
                  {formatCurrencyBRL(kpis?.avgTicketPerBuyer ?? 0, true)}
                </strong>
              </span>
              <span>
                Aberto:{" "}
                <strong className="text-foreground">
                  {formatCurrencyBRL(kpis?.totalOpenPipelineValue ?? 0, true)}
                </strong>
              </span>
            </div>
          </div>
        </SystemTooltip>

        {/* KPI 5: Clientes em Risco & Tempo sem Contato */}
        <SystemTooltip content="Clientes que possuem negociação aberta no CRM mas estão há mais de 15 dias sem nenhuma interação no chat. Clique para inspecionar a lista.">
          <div className="bg-card rounded-2xl p-4 border border-border shadow-soft flex flex-col justify-between">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-extrabold text-muted-foreground uppercase tracking-wider">
                Em Risco (&gt;15d)
              </span>
              <div className="h-7 w-7 rounded-lg bg-primary/10 border border-primary/20 text-primary flex items-center justify-center shrink-0">
                <AlertTriangle className="h-3.5 w-3.5" />
              </div>
            </div>
            <div className="my-2">
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-black text-foreground tabular-nums">
                  {kpis?.atRiskWithOpenDealCount ?? 0}
                </span>
                <span className="text-[10px] font-bold text-primary tabular-nums">
                  {formatCurrencyBRL(kpis?.atRiskOpenValue ?? 0, true)} parados
                </span>
              </div>
            </div>
            <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-2 border-t border-line tabular-nums">
              <span>
                Média:{" "}
                <strong className="text-foreground">
                  {(kpis?.avgDaysWithoutService ?? data?.avgDaysWithoutService ?? 0) > 0
                    ? `${kpis?.avgDaysWithoutService ?? data?.avgDaysWithoutService}d`
                    : "–"}
                </strong>{" "}
                s/ chat
              </span>
              <button
                type="button"
                onClick={() => {
                  setBottomView("clients");
                  setClientSegment("risk");
                }}
                className="text-primary font-bold hover:underline cursor-pointer"
              >
                {kpis?.waitingReplyCount ?? 0} aguardando
              </button>
            </div>
          </div>
        </SystemTooltip>

        {/* KPI 6: Índice de Satisfação Real (CSAT IA) & Frequência */}
        <SystemTooltip content="Satisfação calculada exclusivamente sobre auditorias de IA concluídas (status = done), somada à frequência média de dias ativos por cliente nos últimos 30 dias.">
          <div className="bg-card rounded-2xl p-4 border border-border shadow-soft flex flex-col justify-between">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-extrabold text-muted-foreground uppercase tracking-wider">
                Satisfação CSAT IA
              </span>
              <div className="h-7 w-7 rounded-lg bg-primary/10 border border-primary/20 text-primary flex items-center justify-center shrink-0">
                <Star className="h-3.5 w-3.5" />
              </div>
            </div>
            <div className="my-2">
              {kpis?.csat && kpis.csat.sampleSize > 0 && kpis.csat.pct !== null ? (
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-black text-foreground tabular-nums">
                    {kpis.csat.pct}%
                  </span>
                  <span className="text-[10px] font-bold text-muted-foreground tabular-nums">
                    ({kpis.csat.sampleSize} auditados)
                  </span>
                </div>
              ) : (
                <div className="flex items-baseline gap-2">
                  <span className="text-lg font-extrabold text-muted-foreground">
                    Sem amostra
                  </span>
                </div>
              )}
            </div>
            <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-2 border-t border-line tabular-nums">
              <span>
                Freq:{" "}
                <strong className="text-foreground">
                  {(kpis?.avgFrequency ?? data?.avgFrequency ?? 0) > 0
                    ? `${kpis?.avgFrequency ?? data?.avgFrequency}d/mês`
                    : "–"}
                </strong>
              </span>
              {kpis?.csat && kpis.csat.sampleSize > 0 ? (
                <span>
                  <strong className="text-primary">{kpis.csat.frustratedCount}</strong> frustrados
                </span>
              ) : (
                <span>Auditorias QA</span>
              )}
            </div>
          </div>
        </SystemTooltip>
      </div>

      {/* ── 3. FAIXA CENTRAL 1: GRÁFICO SEMANAL CORRIGIDO + FUNIL DE COBERTURA DA BASE ── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        {/* Gráfico: Aquisição de Novos vs. Retenção de Recorrentes (Com Datas Reais) */}
        <div className="xl:col-span-2 bg-card rounded-2xl p-5 border border-border shadow-soft flex flex-col min-h-[340px]">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-xl bg-primary/10 border border-primary/20 text-primary flex items-center justify-center shrink-0">
                <TrendingUp className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-xs font-extrabold text-foreground">
                  Novos Clientes vs. Recorrentes Atendidos por Semana
                </h3>
                <p className="text-[10px] text-muted-foreground">
                  Contatos cadastrados na semana vs. clientes anteriores que voltaram a interagir no chat
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="px-2.5 py-1 rounded-xl bg-muted/40 border border-line text-[10px] font-semibold text-muted-foreground">
                Novos: <span className="font-extrabold text-foreground tabular-nums">{totalNovos}</span>
              </div>
              <div className="px-2.5 py-1 rounded-xl bg-muted/40 border border-line text-[10px] font-semibold text-muted-foreground">
                Recorrentes:{" "}
                <span className="font-extrabold text-foreground tabular-nums">{totalRecorrentes}</span>
              </div>
              <span className="text-[10px] font-bold text-primary bg-primary/10 px-2.5 py-1 rounded-xl border border-primary/20 tabular-nums">
                {totalComNegocioSemanal} c/ Negócio CRM
              </span>
            </div>
          </div>

          <div className="flex-1 w-full h-[230px] mt-1">
            {clientMetrics.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={clientMetrics}
                  margin={{ top: 10, right: 12, left: -20, bottom: 0 }}
                  barGap={5}
                >
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
                  <Tooltip content={<WeeklyChartTooltip />} />
                  <Legend
                    verticalAlign="top"
                    height={32}
                    wrapperStyle={{ fontSize: 11, fontWeight: 600 }}
                    iconType="circle"
                  />
                  <Bar
                    dataKey="novos"
                    name="Novos Clientes"
                    fill="var(--primary)"
                    radius={[6, 6, 0, 0]}
                    maxBarSize={26}
                    isAnimationActive={false}
                  />
                  <Bar
                    dataKey="recorrentes"
                    name="Recorrentes Atendidos"
                    fill="color-mix(in srgb, var(--primary) 50%, var(--muted-foreground))"
                    radius={[6, 6, 0, 0]}
                    maxBarSize={26}
                    isAnimationActive={false}
                  />
                  <Bar
                    dataKey="comNegocio"
                    name="Com Negócio no CRM"
                    fill="var(--muted-foreground)"
                    radius={[6, 6, 0, 0]}
                    maxBarSize={26}
                    isAnimationActive={false}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
                Sem dados de aquisição e retenção para o filtro selecionado.
              </div>
            )}
          </div>

          {/* Rodapé Resumo de Higienização da Base */}
          {health && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-3.5 mt-3 border-t border-line">
              <div className="rounded-xl bg-muted/30 border border-line px-3 py-2 flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground font-semibold">
                  <UserCheck className="h-3.5 w-3.5 text-primary shrink-0" />
                  <span>Com Consultor</span>
                </div>
                <span className="text-xs font-extrabold text-foreground tabular-nums">
                  {health.withWalletPct}% ({health.withWalletCount})
                </span>
              </div>

              <div className="rounded-xl bg-muted/30 border border-line px-3 py-2 flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground font-semibold">
                  <Mail className="h-3.5 w-3.5 text-primary shrink-0" />
                  <span>Com E-mail</span>
                </div>
                <span className="text-xs font-extrabold text-foreground tabular-nums">
                  {health.withEmailPct}% ({health.withEmailCount})
                </span>
              </div>

              <div className="rounded-xl bg-muted/30 border border-line px-3 py-2 flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground font-semibold">
                  <Building2 className="h-3.5 w-3.5 text-primary shrink-0" />
                  <span>Empresas PJ</span>
                </div>
                <span className="text-xs font-extrabold text-foreground tabular-nums">
                  {health.companiesLinkedPct}% ({health.companiesLinkedCount})
                </span>
              </div>

              <div className="rounded-xl bg-muted/30 border border-line px-3 py-2 flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground font-semibold">
                  <Phone className="h-3.5 w-3.5 text-primary shrink-0" />
                  <span>Multi-Telefones</span>
                </div>
                <span className="text-xs font-extrabold text-foreground tabular-nums">
                  {health.withMultiPhonesCount} contatos
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Funil de Cobertura & Conversão da Base */}
        <div className="bg-card rounded-2xl p-5 border border-border shadow-soft flex flex-col justify-between">
          <div className="flex items-start justify-between gap-2 mb-3">
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-xl bg-primary/10 border border-primary/20 text-primary flex items-center justify-center shrink-0">
                <Layers className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-xs font-extrabold text-foreground">
                  Funil de Cobertura & Conversão
                </h3>
                <p className="text-[10px] text-muted-foreground">
                  Jornada da base: Cadastro → Chat → CRM → Compra
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-3 my-auto">
            {funnel.map((step, idx) => {
              const barWidth = Math.max(step.pctOfBase, step.count > 0 ? 6 : 0);
              const isHighlight = step.id === "won" || step.id === "crm";
              return (
                <div
                  key={step.id}
                  className="rounded-xl bg-muted/25 border border-line p-3 transition hover:border-primary/30"
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="h-5 w-5 rounded-md bg-primary/10 border border-primary/20 text-primary text-[10px] font-extrabold flex items-center justify-center shrink-0 tabular-nums">
                        {idx + 1}
                      </span>
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-foreground truncate">{step.label}</p>
                        <p className="text-[10px] text-muted-foreground truncate">{step.sublabel}</p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-sm font-black text-foreground tabular-nums block">
                        {step.count.toLocaleString("pt-BR")}
                      </span>
                      <span className="text-[9px] font-bold text-primary tabular-nums">
                        {idx === 0 ? "100% da base" : `${step.conversionFromPrevPct}% conv. etapa`}
                      </span>
                    </div>
                  </div>
                  <div className="h-2 w-full rounded-full bg-muted overflow-hidden mt-2">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${barWidth}%`,
                        background: isHighlight
                          ? "var(--primary)"
                          : "color-mix(in srgb, var(--primary) 68%, var(--muted-foreground))",
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Alerta Acionável de Oportunidades Sem Card no CRM */}
          {kpis && kpis.contactsChatWithoutDealCount > 0 && (
            <div className="mt-3 pt-3 border-t border-line flex items-center justify-between gap-2 text-[11px]">
              <div className="flex items-center gap-2 text-muted-foreground">
                <AlertTriangle className="h-3.5 w-3.5 text-primary shrink-0" />
                <span>
                  <strong className="text-foreground">{kpis.contactsChatWithoutDealCount}</strong>{" "}
                  clientes atendidos s/ card no CRM
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setBottomView("clients");
                  setClientSegment("no_deal");
                }}
                className="text-[10px] font-extrabold text-primary hover:underline shrink-0 cursor-pointer"
              >
                Ver clientes →
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── 4. FAIXA CENTRAL 2: AGING DE RELACIONAMENTO (INATIVIDADE) & ORIGEM/FONTES ── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        {/* Esquerda: Matriz de Inatividade / Aging da Carteira */}
        <div className="bg-card rounded-2xl p-5 border border-border shadow-soft flex flex-col justify-between">
          <div className="flex items-start justify-between gap-2 mb-3">
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-xl bg-primary/10 border border-primary/20 text-primary flex items-center justify-center shrink-0">
                <Clock className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-xs font-extrabold text-foreground">
                  Aging de Relacionamento & Inatividade
                </h3>
                <p className="text-[10px] text-muted-foreground">
                  Tempo desde a última interação + valor em aberto por faixa
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-2.5 my-auto">
            {aging.map((bucket) => {
              const isDanger = bucket.id === "cold_30d_plus" || bucket.id === "cooling_30d";
              return (
                <SystemTooltip key={bucket.id} content={bucket.description}>
                  <div className="rounded-xl bg-muted/25 border border-line px-3 py-2.5">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className={`h-2 w-2 rounded-full shrink-0 ${
                            isDanger ? "bg-primary" : "bg-muted-foreground"
                          }`}
                        />
                        <span className="font-bold text-foreground truncate">{bucket.label}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 tabular-nums">
                        <span className="font-extrabold text-foreground">{bucket.count}</span>
                        <span className="text-[10px] text-muted-foreground">({bucket.pct}%)</span>
                      </div>
                    </div>

                    <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden my-1.5">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${Math.max(bucket.pct, bucket.count > 0 ? 4 : 0)}%`,
                          background: isDanger
                            ? "var(--primary)"
                            : "color-mix(in srgb, var(--primary) 55%, var(--muted-foreground))",
                        }}
                      />
                    </div>

                    <div className="flex items-center justify-between text-[10px] text-muted-foreground tabular-nums">
                      <span>{bucket.openDealsCount} negócios em aberto</span>
                      <span className={bucket.openPipelineValue > 0 && isDanger ? "text-primary font-bold" : "font-semibold text-foreground"}>
                        {formatCurrencyBRL(bucket.openPipelineValue, true)} em pipeline
                      </span>
                    </div>
                  </div>
                </SystemTooltip>
              );
            })}
          </div>
        </div>

        {/* Direita: Top Fontes & Campanhas de Aquisição de Clientes */}
        <div className="xl:col-span-2 bg-card rounded-2xl p-5 border border-border shadow-soft flex flex-col justify-between">
          <div className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-line">
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-xl bg-primary/10 border border-primary/20 text-primary flex items-center justify-center shrink-0">
                <Target className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-xs font-extrabold text-foreground">
                  Origem & Aquisição de Clientes (Marketing / Comercial)
                </h3>
                <p className="text-[10px] text-muted-foreground">
                  Canais de aquisição, volume de clientes, conversão em vendas e receita associada
                </p>
              </div>
            </div>

            <div className="flex items-center bg-muted/40 p-0.5 rounded-xl border border-line">
              <button
                type="button"
                onClick={() => setAcqMode("sources")}
                className={`px-3 py-1 rounded-lg text-[10px] font-bold transition cursor-pointer ${
                  acqMode === "sources"
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Por Fonte ({sources.length})
              </button>
              <button
                type="button"
                onClick={() => setAcqMode("campaigns")}
                className={`px-3 py-1 rounded-lg text-[10px] font-bold transition cursor-pointer ${
                  acqMode === "campaigns"
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Por Campanha ({campaigns.length})
              </button>
            </div>
          </div>

          {activeAcqList.length > 0 ? (
            <div className="space-y-2 mt-3 max-h-[275px] overflow-y-auto scrollbar-thin pr-1">
              {activeAcqList.map((item, index) => {
                const barPct = Math.round((item.clientsCount / maxAcqClients) * 100);
                const totalValue = (item.wonValue || 0) + (item.openValue || 0);
                return (
                  <div
                    key={item.name}
                    className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-3 px-3 py-2.5 rounded-xl bg-muted/20 hover:bg-muted/40 border border-transparent hover:border-line transition"
                  >
                    <div className="w-full sm:w-64 shrink-0 flex items-center gap-2.5 min-w-0">
                      <span className="h-5 w-5 rounded-md bg-primary/10 border border-primary/20 text-primary text-[10px] font-extrabold flex items-center justify-center shrink-0 tabular-nums">
                        {index + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold text-foreground truncate">{item.name}</p>
                        <p className="text-[10px] text-muted-foreground tabular-nums">
                          {item.clientsCount} {item.clientsCount === 1 ? "cliente" : "clientes"} ·{" "}
                          {item.dealsCount} {item.dealsCount === 1 ? "negócio" : "negócios"}
                        </p>
                      </div>
                    </div>

                    <div className="flex-1 hidden md:block">
                      <div className="h-2.5 w-full rounded-lg bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-lg bg-primary/80 transition-all duration-500"
                          style={{ width: `${Math.max(barPct, 5)}%` }}
                        />
                      </div>
                    </div>

                    <div className="flex items-center gap-2.5 shrink-0 tabular-nums">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-lg bg-muted border border-border text-foreground">
                        {item.wonCount} ganhos ({item.conversionPct}%)
                      </span>
                      <span className="text-xs font-extrabold text-primary min-w-[82px] text-right">
                        {formatCurrencyBRL(totalValue, true)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex items-center justify-center flex-1 py-12 text-xs text-muted-foreground">
              Nenhuma fonte ou campanha registrada para os clientes do filtro atual.
            </div>
          )}
        </div>
      </div>

      {/* ── 5. FAIXA INFERIOR: TABELA EXECUTIVA DUPLA (CARTEIRA POR CONSULTOR vs. RADAR DE CLIENTES) ── */}
      <div className="bg-card rounded-2xl border border-border shadow-soft overflow-hidden">
        <div className="px-5 py-4 border-b border-line flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            {/* Alternador Principal da Tabela */}
            <div className="flex items-center bg-muted/40 p-0.5 rounded-xl border border-line">
              <button
                type="button"
                onClick={() => setBottomView("consultants")}
                className={`px-3 py-1.5 rounded-lg text-xs font-extrabold transition cursor-pointer flex items-center gap-1.5 ${
                  bottomView === "consultants"
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Award className="h-3.5 w-3.5" />
                Carteira por Consultor ({portfolios.length})
              </button>
              <button
                type="button"
                onClick={() => setBottomView("clients")}
                className={`px-3 py-1.5 rounded-lg text-xs font-extrabold transition cursor-pointer flex items-center gap-1.5 ${
                  bottomView === "clients"
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <ShieldAlert className="h-3.5 w-3.5" />
                Radar de Clientes & Alertas ({priorityClients.length})
              </button>
            </div>

            {/* Sub-filtros quando na aba Radar de Clientes */}
            {bottomView === "clients" && (
              <div className="flex flex-wrap items-center gap-1 bg-muted/30 p-0.5 rounded-xl border border-line">
                {(
                  [
                    { id: "all", label: "Todos" },
                    { id: "risk", label: "Em Risco / >15d" },
                    { id: "no_deal", label: "Sem Card CRM" },
                    { id: "vip", label: "Com Negócio / VIP" },
                    { id: "orphan", label: "Sem Consultor" },
                  ] as const
                ).map((seg) => (
                  <button
                    key={seg.id}
                    type="button"
                    onClick={() => setClientSegment(seg.id)}
                    className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition cursor-pointer ${
                      clientSegment === seg.id
                        ? "bg-card text-primary border border-primary/30 shadow-xs"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {seg.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Campo de Busca Rápida */}
          <div className="relative">
            <Search className="h-3.5 w-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={tableSearch}
              onChange={(e) => setTableSearch(e.target.value)}
              placeholder={
                bottomView === "consultants"
                  ? "Buscar consultor..."
                  : "Buscar cliente, empresa, fonte..."
              }
              className="h-8 pl-8 pr-3 rounded-xl bg-muted/40 border border-line text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/40 w-52 sm:w-64"
            />
          </div>
        </div>

        {/* VISÃO 1: TABELA DE CARTEIRA POR CONSULTOR */}
        {bottomView === "consultants" ? (
          <div className="overflow-x-auto">
            {sortedPortfolios.length === 0 ? (
              <div className="p-8 text-center text-xs text-muted-foreground">
                Nenhum consultor com carteira ativa para o filtro selecionado.
              </div>
            ) : (
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-muted/40 text-muted-foreground font-semibold border-b border-line">
                    <th className="px-5 py-3">Consultor</th>
                    <th className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => handleToggleConsultantSort("walletContactsCount")}
                        className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer font-semibold"
                      >
                        Clientes na Carteira
                        <ArrowUpDown className="h-3 w-3 opacity-60" />
                      </button>
                    </th>
                    <th className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => handleToggleConsultantSort("activeInPeriodCount")}
                        className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer font-semibold"
                      >
                        Atendidos no Período
                        <ArrowUpDown className="h-3 w-3 opacity-60" />
                      </button>
                    </th>
                    <th className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => handleToggleConsultantSort("openPipelineValue")}
                        className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer font-semibold"
                      >
                        Pipeline em Aberto
                        <ArrowUpDown className="h-3 w-3 opacity-60" />
                      </button>
                    </th>
                    <th className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => handleToggleConsultantSort("wonRevenue")}
                        className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer font-semibold"
                      >
                        Compradores (Won)
                        <ArrowUpDown className="h-3 w-3 opacity-60" />
                      </button>
                    </th>
                    <th className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => handleToggleConsultantSort("staleClientsCount")}
                        className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer font-semibold"
                      >
                        Sem Contato &gt;15d
                        <ArrowUpDown className="h-3 w-3 opacity-60" />
                      </button>
                    </th>
                    <th className="px-4 py-3">TME Resposta</th>
                    <th className="px-5 py-3 text-right">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {sortedPortfolios.map((row) => (
                    <tr
                      key={row.operatorId}
                      className="hover:bg-muted/30 transition font-medium"
                    >
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2.5">
                          <AvatarBadge
                            name={row.operatorName}
                            avatar={row.avatar}
                            highlight={row.wonClientsCount > 0}
                          />
                          <div>
                            <span className="font-bold text-foreground block leading-tight">
                              {row.operatorName}
                            </span>
                            {row.withoutDealCount > 0 && (
                              <span className="text-[10px] text-muted-foreground">
                                {row.withoutDealCount} atendidos s/ card CRM
                              </span>
                            )}
                          </div>
                        </div>
                      </td>

                      <td className="px-4 py-3 tabular-nums">
                        <span className="font-extrabold text-foreground">
                          {row.walletContactsCount}
                        </span>{" "}
                        <span className="text-[10px] text-muted-foreground">contatos</span>
                      </td>

                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5 tabular-nums">
                          <span className="font-bold text-foreground w-8">
                            {row.activeInPeriodCount}
                          </span>
                          <div className="h-1.5 w-20 rounded-full bg-muted overflow-hidden hidden sm:block">
                            <div
                              className="h-full rounded-full bg-primary transition-all duration-500"
                              style={{ width: `${Math.min(100, Math.max(row.activeSharePct, 4))}%` }}
                            />
                          </div>
                          <span className="text-[10px] text-muted-foreground">
                            ({row.activeSharePct}%)
                          </span>
                        </div>
                      </td>

                      <td className="px-4 py-3 tabular-nums">
                        <span className="font-bold text-foreground">
                          {formatCurrencyBRL(row.openPipelineValue, true)}
                        </span>
                        <span className="block text-[10px] text-muted-foreground">
                          {row.openDealsCount} {row.openDealsCount === 1 ? "negócio" : "negócios"}
                        </span>
                      </td>

                      <td className="px-4 py-3 tabular-nums">
                        <span className="font-extrabold text-primary">
                          {formatCurrencyBRL(row.wonRevenue, true)}
                        </span>
                        <span className="block text-[10px] text-muted-foreground">
                          {row.wonClientsCount} {row.wonClientsCount === 1 ? "comprador" : "compradores"}
                        </span>
                      </td>

                      <td className="px-4 py-3 tabular-nums">
                        {row.staleClientsCount > 0 ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-primary/10 text-primary border border-primary/20 text-[10px] font-extrabold">
                            {row.staleClientsCount} clientes
                          </span>
                        ) : (
                          <span className="text-[10px] text-muted-foreground">Em dia</span>
                        )}
                      </td>

                      <td className="px-4 py-3 tabular-nums text-foreground font-semibold">
                        {formatDurationShort(row.avgResponseSeconds)}
                      </td>

                      <td className="px-5 py-3 text-right">
                        <SystemTooltip content={`Filtrar painel para a carteira de ${row.operatorName}`}>
                          <button
                            type="button"
                            onClick={() => {
                              setOperatorFilter(row.operatorId);
                              setBottomView("clients");
                            }}
                            className="px-2.5 py-1 rounded-lg border border-border bg-card hover:border-primary/40 hover:text-primary text-[10px] font-bold text-foreground transition cursor-pointer"
                          >
                            Inspecionar
                          </button>
                        </SystemTooltip>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ) : (
          /* VISÃO 2: TABELA DE RADAR DE CLIENTES PRIORITÁRIOS & EM ALERTA */
          <div className="overflow-x-auto">
            {filteredPriorityClients.length === 0 ? (
              <div className="p-8 text-center text-xs text-muted-foreground">
                Nenhum cliente encontrado para o segmento ou busca selecionada.
              </div>
            ) : (
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-muted/40 text-muted-foreground font-semibold border-b border-line">
                    <th className="px-5 py-3">Cliente / Empresa</th>
                    <th className="px-4 py-3">Consultor</th>
                    <th className="px-4 py-3">Última Interação</th>
                    <th className="px-4 py-3">Negociações & Valor</th>
                    <th className="px-4 py-3">Fonte / Campanha</th>
                    <th className="px-4 py-3">Diagnóstico / Status</th>
                    <th className="px-5 py-3 text-right">Ações Rápidas</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {filteredPriorityClients.map((client) => (
                    <tr
                      key={client.contactId}
                      className="hover:bg-muted/30 transition font-medium"
                    >
                      {/* Cliente & Empresa */}
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2.5">
                          <AvatarBadge
                            name={client.name}
                            avatar={client.avatar}
                            highlight={client.wonDealsCount > 0}
                          />
                          <div className="min-w-0 max-w-[220px]">
                            <p className="font-bold text-foreground truncate leading-tight">
                              {client.name}
                            </p>
                            <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                              {client.companyName || client.phone || client.email || "Sem empresa vinculada"}
                            </p>
                          </div>
                        </div>
                      </td>

                      {/* Consultor */}
                      <td className="px-4 py-3">
                        <span
                          className={`text-xs font-semibold ${
                            client.operatorId ? "text-foreground" : "text-primary font-bold"
                          }`}
                        >
                          {client.operatorName}
                        </span>
                      </td>

                      {/* Última Interação */}
                      <td className="px-4 py-3 tabular-nums">
                        {client.daysSinceLastContact !== null ? (
                          <div>
                            <span
                              className={`font-bold ${
                                client.daysSinceLastContact > 15
                                  ? "text-primary"
                                  : "text-foreground"
                              }`}
                            >
                              {client.daysSinceLastContact === 0
                                ? "Hoje"
                                : `Há ${client.daysSinceLastContact} ${
                                    client.daysSinceLastContact === 1 ? "dia" : "dias"
                                  }`}
                            </span>
                            {client.lastInteractionAt && (
                              <span className="block text-[10px] text-muted-foreground">
                                {new Date(client.lastInteractionAt).toLocaleDateString("pt-BR")}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-[10px] text-muted-foreground">Sem chat</span>
                        )}
                      </td>

                      {/* Negociações & Valor */}
                      <td className="px-4 py-3 tabular-nums">
                        {client.openDealsCount + client.wonDealsCount + client.lostDealsCount > 0 ? (
                          <div>
                            <span className="font-extrabold text-foreground">
                              {formatCurrencyBRL(
                                client.openDealValue > 0 ? client.openDealValue : client.wonDealValue,
                                true
                              )}
                            </span>
                            <span className="block text-[10px] text-muted-foreground truncate max-w-[180px]">
                              {client.openDealsCount > 0
                                ? `${client.openDealsCount} aberto(s)`
                                : client.wonDealsCount > 0
                                ? `${client.wonDealsCount} ganho(s)`
                                : `${client.lostDealsCount} perdido(s)`}
                              {client.primaryDealTitle ? ` · ${client.primaryDealTitle}` : ""}
                            </span>
                          </div>
                        ) : (
                          <span className="text-[10px] text-muted-foreground">Sem card no CRM</span>
                        )}
                      </td>

                      {/* Fonte / Campanha */}
                      <td className="px-4 py-3">
                        {client.source || client.campaign ? (
                          <div className="max-w-[170px]">
                            <p className="text-xs font-semibold text-foreground truncate">
                              {client.source || "–"}
                            </p>
                            {client.campaign && (
                              <p className="text-[10px] text-muted-foreground truncate">
                                {client.campaign}
                              </p>
                            )}
                          </div>
                        ) : (
                          <span className="text-[10px] text-muted-foreground">–</span>
                        )}
                      </td>

                      {/* Alertas & Sentimento */}
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-1">
                          {client.riskFlags.length > 0 ? (
                            client.riskFlags.slice(0, 2).map((flag) => (
                              <span
                                key={flag}
                                className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold bg-primary/10 text-primary border border-primary/20"
                              >
                                {flag}
                              </span>
                            ))
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold bg-muted text-muted-foreground border border-border">
                              Regular
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Ações Diretas (Abrir Chat / Abrir CRM) */}
                      <td className="px-5 py-3 text-right">
                        <div className="inline-flex items-center justify-end gap-1.5">
                          {client.conversationId && (
                            <SystemTooltip content="Abrir conversa no módulo de Chat">
                              <button
                                type="button"
                                onClick={() => handleOpenChat(client.conversationId)}
                                className="h-7 px-2.5 rounded-lg border border-border bg-card hover:border-primary/40 hover:text-primary text-[10px] font-bold text-foreground inline-flex items-center gap-1 transition cursor-pointer"
                              >
                                <MessageSquare className="h-3 w-3" />
                                Chat
                              </button>
                            </SystemTooltip>
                          )}
                          {client.primaryDealId && (
                            <SystemTooltip content="Abrir ficha da negociação no CRM">
                              <button
                                type="button"
                                onClick={() => handleOpenDeal(client.primaryDealId)}
                                className="h-7 px-2.5 rounded-lg border border-border bg-card hover:border-primary/40 hover:text-primary text-[10px] font-bold text-foreground inline-flex items-center gap-1 transition cursor-pointer"
                              >
                                <Briefcase className="h-3 w-3" />
                                CRM
                              </button>
                            </SystemTooltip>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
