import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Globe,
  MousePointerClick,
  Users2,
  Flame,
  RefreshCw,
  Search,
  MapPin,
  Smartphone,
  Tablet,
  Monitor,
  ExternalLink,
  Clock,
  Sparkles,
  TrendingUp,
  Snowflake,
  Bot,
  Headphones,
  MessageSquare,
  Briefcase,
  Link2,
  Package,
  ScrollText,
  Eye,
  ArrowUpDown,
  Filter,
  BarChart3,
  ChevronDown,
  ChevronUp,
  Check,
  Building2,
  X,
  ShieldAlert,
  Layers,
} from "lucide-react";
import { SystemTooltip } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CustomerJourneyModal } from "./CustomerJourneyModal";
import { useChat } from "@/hooks/useChatState";
import { getAiPersona } from "@/lib/ai-persona";
import type {
  EnrichedSiteVisitorRow,
  SiteVisitorsExecutiveSummary,
  VisitorAttendanceStatus,
} from "@/lib/livechat/livechatStorage";

interface SiteVisitorsTabProps {
  tenantId: string | null;
}

type FilterMode =
  | "all"
  | "online"
  | "hot"
  | "attending"
  | "whatsapp"
  | "crm";

type SortMode = "recent" | "score" | "time" | "crm_value";

type PeriodMode = "live" | "24h" | "7d" | "30d" | "all";

const PERIOD_OPTIONS: Array<{ id: PeriodMode; label: string; shortLabel: string }> = [
  { id: "all", label: "Histórico Recente (Todos)", shortLabel: "Recentes" },
  { id: "live", label: "Sessões Ativas (Últimas 4h)", shortLabel: "Ao Vivo (4h)" },
  { id: "24h", label: "Hoje (Últimas 24h)", shortLabel: "Últimas 24h" },
  { id: "7d", label: "Últimos 7 dias", shortLabel: "7 dias" },
  { id: "30d", label: "Últimos 30 dias", shortLabel: "30 dias" },
];

const SORT_OPTIONS: Array<{ id: SortMode; label: string }> = [
  { id: "recent", label: "Mais recentes primeiro" },
  { id: "score", label: "Maior intenção de compra (Score)" },
  { id: "time", label: "Maior tempo de leitura no site" },
  { id: "crm_value", label: "Maior valor de negócio no CRM (R$)" },
];

const CLICK_LABELS: Record<string, string> = {
  whatsapp_click: "Clicou no WhatsApp",
  phone_click: "Clicou em Telefone",
  cta_click: "Clicou em Orçamento/CTA",
  widget_open: "Abriu o Chat",
  add_to_cart: "Clicou em Comprar",
  product_view: "Consultou Equipamento",
  chat_sent: "Enviou Mensagem",
};

function formatRelativeTime(iso?: string | null): string {
  if (!iso) return "—";
  const diffSec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (diffSec < 60) return "Agora mesmo";
  const min = Math.floor(diffSec / 60);
  if (min < 60) return `há ${min}m`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `há ${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `há ${days}d`;
}

function formatDurationCompact(seconds?: number | null): string {
  const safe = Math.max(0, Math.round(Number(seconds) || 0));
  if (safe < 60) return `${safe}s`;
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  if (mins < 60) return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

function formatCurrencyBrl(value?: number | null): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);
}

function cleanPath(url?: string | null): string {
  if (!url) return "/";
  try {
    const parsed = new URL(url, "https://site.local");
    return (parsed.pathname || "/") + (parsed.search || "");
  } catch {
    return url;
  }
}

function getAttendanceBadgeConfig(
  status: VisitorAttendanceStatus,
  aiName: string,
  operatorName?: string | null,
): {
  label: string;
  className: string;
  icon: React.ReactNode;
} {
  switch (status) {
    case "whatsapp_continued":
      return {
        label: operatorName
          ? `WhatsApp · ${operatorName}`
          : "Continuou no WhatsApp",
        className:
          "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25",
        icon: <Link2 className="h-2.5 w-2.5 shrink-0" />,
      };
    case "in_service":
      return {
        label: operatorName ? `Com ${operatorName}` : "Em Atendimento Humano",
        className: "bg-primary/10 text-primary border-primary/25",
        icon: <Headphones className="h-2.5 w-2.5 shrink-0" />,
      };
    case "waiting_queue":
      return {
        label: "Aguardando na Fila",
        className:
          "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/25",
        icon: <Clock className="h-2.5 w-2.5 shrink-0" />,
      };
    case "ai_triage":
      return {
        label: `Triagem IA · ${aiName}`,
        className: "bg-primary/10 text-primary border-primary/25",
        icon: <Bot className="h-2.5 w-2.5 shrink-0" />,
      };
    case "finished":
      return {
        label: operatorName
          ? `Concluído · ${operatorName}`
          : "Atendimento Concluído",
        className: "bg-muted text-muted-foreground border-border",
        icon: <Check className="h-2.5 w-2.5 shrink-0" />,
      };
    default:
      return {
        label: "Apenas Navegando",
        className: "bg-muted/70 text-muted-foreground border-border",
        icon: <Eye className="h-2.5 w-2.5 shrink-0" />,
      };
  }
}

export function SiteVisitorsTab({ tenantId }: SiteVisitorsTabProps) {
  const { setActiveView, setActiveQueue, setSelectedChatId } = useChat();
  const aiPersona = useMemo(() => getAiPersona(tenantId), [tenantId]);

  const [visitors, setVisitors] = useState<EnrichedSiteVisitorRow[]>([]);
  const [summary, setSummary] = useState<SiteVisitorsExecutiveSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);

  const [search, setSearch] = useState("");
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [periodMode, setPeriodMode] = useState<PeriodMode>("all");
  const [sortMode, setSortMode] = useState<SortMode>("recent");
  const [selectedSourceFilter, setSelectedSourceFilter] = useState<string | null>(null);
  const [selectedPageFilter, setSelectedPageFilter] = useState<string | null>(null);
  const [showAnalyticsPanel, setShowAnalyticsPanel] = useState(true);

  const [periodPopoverOpen, setPeriodPopoverOpen] = useState(false);
  const [sortPopoverOpen, setSortPopoverOpen] = useState(false);

  const [selectedVisitor, setSelectedVisitor] = useState<{
    visitorId: string;
    contactId?: string | null;
    name?: string;
  } | null>(null);

  const fetchVisitors = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      else setRefreshing(true);
      try {
        const qs = new URLSearchParams({
          includeRecent: "1",
          period: periodMode,
          limit: "120",
        });
        const res = await fetch(`/api/livechat/visitors?${qs.toString()}`, {
          credentials: "include",
        });
        if (res.status === 403) {
          setPermissionDenied(true);
          setVisitors([]);
          setSummary(null);
          return;
        }
        setPermissionDenied(false);
        if (res.ok) {
          const data = await res.json();
          const rows: EnrichedSiteVisitorRow[] = Array.isArray(data)
            ? data
            : Array.isArray(data?.visitors)
              ? data.visitors
              : [];
          setVisitors(rows);
          if (data?.summary) {
            setSummary(data.summary);
          }
        }
      } catch {
        // ignore transient network errors on background poll
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [periodMode],
  );

  useEffect(() => {
    void fetchVisitors(false);
    const interval = setInterval(() => {
      void fetchVisitors(true);
    }, 15000);
    return () => clearInterval(interval);
  }, [fetchVisitors, tenantId]);

  // Derived fallback metrics if summary is not yet populated
  const metrics = useMemo(() => {
    if (summary) return summary;
    const onlineNow = visitors.filter((v) => Boolean(v.isOnline)).length;
    const hotVisitors = visitors.filter(
      (v) => v.temperature === "hot" || Number(v.intentScore || 0) >= 60,
    ).length;
    const warmVisitors = visitors.filter(
      (v) => v.temperature === "warm" || (Number(v.intentScore || 0) >= 30 && Number(v.intentScore || 0) < 60),
    ).length;
    const coldVisitors = Math.max(0, visitors.length - hotVisitors - warmVisitors);
    const visitorsWithChat = visitors.filter(
      (v) => (v.chatsCount || 0) > 0 || (v.attendanceStatus && v.attendanceStatus !== "browsing"),
    ).length;
    const continuedOnWhatsApp = visitors.filter((v) => Boolean(v.linkedWhatsApp)).length;
    const visitorsWithCrmDeal = visitors.filter((v) => Boolean(v.crmDeal)).length;
    const crmPipelineValue = visitors.reduce(
      (acc, v) => acc + (v.crmDeal && v.crmDeal.status !== "lost" ? v.crmDeal.value : 0),
      0,
    );
    return {
      onlineNow,
      totalVisitors: visitors.length,
      hotVisitors,
      warmVisitors,
      coldVisitors,
      avgTimeOnSiteSec:
        visitors.length > 0
          ? Math.round(
              visitors.reduce((s, v) => s + (v.totalTimeOnSite || 0), 0) / visitors.length,
            )
          : 0,
      avgScrollDepth:
        visitors.length > 0
          ? Math.round(
              visitors.reduce((s, v) => s + (v.avgScrollDepth || 0), 0) / visitors.length,
            )
          : 0,
      totalPageviews: visitors.reduce((s, v) => s + (v.pageviewsCount || 1), 0),
      totalClicks: visitors.reduce((s, v) => s + (v.clicksCount || 0), 0),
      visitorsWithChat,
      inAiTriage: visitors.filter((v) => v.attendanceStatus === "ai_triage").length,
      inHumanService: visitors.filter((v) => v.attendanceStatus === "in_service").length,
      waitingInQueue: visitors.filter((v) => v.attendanceStatus === "waiting_queue").length,
      continuedOnWhatsApp,
      visitorsWithCrmDeal,
      crmPipelineValue,
      crmWonValue: 0,
      topPages: [],
      trafficSources: [],
      conversionFunnel: {
        visitors: visitors.length,
        highIntent: hotVisitors,
        chatStarted: visitorsWithChat,
        whatsappOrDeal: visitors.filter((v) => v.linkedWhatsApp || v.crmDeal).length,
      },
    } satisfies SiteVisitorsExecutiveSummary;
  }, [summary, visitors]);

  const filteredVisitors = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = visitors.filter((v) => {
      if (filterMode === "online" && !v.isOnline) return false;
      if (
        filterMode === "hot" &&
        v.temperature !== "hot" &&
        Number(v.intentScore || 0) < 60
      ) {
        return false;
      }
      if (
        filterMode === "attending" &&
        (!v.attendanceStatus || v.attendanceStatus === "browsing")
      ) {
        return false;
      }
      if (filterMode === "whatsapp" && !v.linkedWhatsApp) {
        return false;
      }
      if (filterMode === "crm" && !v.crmDeal) {
        return false;
      }
      if (selectedSourceFilter && v.source !== selectedSourceFilter) {
        return false;
      }
      if (selectedPageFilter) {
        const cleanCurrent = cleanPath(v.currentPage).split("?")[0];
        const cleanEntry = cleanPath(v.entryPage).split("?")[0];
        if (cleanCurrent !== selectedPageFilter && cleanEntry !== selectedPageFilter) {
          return false;
        }
      }
      if (!q) return true;
      const haystack = [
        v.name,
        v.company,
        v.cnpj,
        v.email,
        v.phone,
        v.city,
        v.region,
        v.productInterest,
        v.currentPageTitle,
        v.currentPage,
        v.entryPage,
        v.source,
        v.utmSource,
        v.utmCampaign,
        v.operatorName,
        v.crmDeal?.title,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });

    return list.sort((a, b) => {
      if (sortMode === "score") {
        return (b.intentScore || 0) - (a.intentScore || 0);
      }
      if (sortMode === "time") {
        return (b.totalTimeOnSite || 0) - (a.totalTimeOnSite || 0);
      }
      if (sortMode === "crm_value") {
        return (b.crmDeal?.value || 0) - (a.crmDeal?.value || 0);
      }
      return new Date(b.lastSeenAt || 0).getTime() - new Date(a.lastSeenAt || 0).getTime();
    });
  }, [
    visitors,
    filterMode,
    selectedSourceFilter,
    selectedPageFilter,
    search,
    sortMode,
  ]);

  const currentPeriodOption =
    PERIOD_OPTIONS.find((p) => p.id === periodMode) || PERIOD_OPTIONS[0];
  const currentSortOption =
    SORT_OPTIONS.find((s) => s.id === sortMode) || SORT_OPTIONS[0];

  const handleOpenConversation = useCallback(
    (conversationId: string) => {
      setSelectedVisitor(null);
      setActiveQueue("todos");
      setSelectedChatId(conversationId);
      setActiveView("chat");
    },
    [setActiveQueue, setSelectedChatId, setActiveView],
  );

  const approachRatePct =
    metrics.totalVisitors > 0
      ? Math.round((metrics.visitorsWithChat / metrics.totalVisitors) * 100)
      : 0;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">
      {/* ── HEADER EXECUTIVO DA ABA ────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-border bg-card/60 shrink-0 flex-wrap">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="grid h-8 w-8 place-items-center rounded-xl bg-primary/10 text-primary border border-primary/20 shrink-0">
            <Globe className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-xs font-extrabold text-foreground truncate">
                Cockpit Executivo de Visitantes & Conversão do Site
              </h2>
              {metrics.onlineNow > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 border border-emerald-500/25 px-2 py-0.5 text-[9px] font-extrabold text-emerald-600 dark:text-emerald-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  {metrics.onlineNow} online
                </span>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground truncate">
              Monitoramento 360º de tráfego, intenção de compra, triagem {aiPersona.name}, continuidade WhatsApp e negócios no CRM
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Seletor Customizado de Período */}
          <Popover open={periodPopoverOpen} onOpenChange={setPeriodPopoverOpen}>
            <SystemTooltip content="Filtrar janela de tempo dos visitantes">
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 h-7 rounded-xl border border-border bg-card px-2.5 text-[11px] font-bold text-foreground hover:bg-muted transition cursor-pointer"
                >
                  <Clock className="h-3 w-3 text-primary" />
                  <span>{currentPeriodOption.shortLabel}</span>
                  <ChevronDown className="h-3 w-3 text-muted-foreground" />
                </button>
              </PopoverTrigger>
            </SystemTooltip>
            <PopoverContent align="end" className="w-56 p-1.5 rounded-2xl">
              <p className="px-2.5 py-1 text-[9px] font-extrabold uppercase tracking-wider text-muted-foreground">
                Janela de Monitoramento
              </p>
              {PERIOD_OPTIONS.map((opt) => {
                const active = opt.id === periodMode;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => {
                      setPeriodMode(opt.id);
                      setPeriodPopoverOpen(false);
                    }}
                    className={`w-full flex items-center justify-between gap-2 rounded-xl px-2.5 py-1.5 text-xs font-semibold transition cursor-pointer ${
                      active
                        ? "bg-primary/10 text-primary font-bold"
                        : "text-foreground hover:bg-muted"
                    }`}
                  >
                    <span>{opt.label}</span>
                    {active && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                  </button>
                );
              })}
            </PopoverContent>
          </Popover>

          {/* Toggle Painel Analítico (Funil / Top Páginas / UTMs) */}
          <SystemTooltip
            content={
              showAnalyticsPanel
                ? "Recolher painel de funil, páginas e origens"
                : "Expandir painel de funil, páginas e origens"
            }
          >
            <button
              type="button"
              onClick={() => setShowAnalyticsPanel((prev) => !prev)}
              className={`inline-flex items-center gap-1.5 h-7 rounded-xl border px-2.5 text-[11px] font-bold transition cursor-pointer ${
                showAnalyticsPanel
                  ? "border-primary/35 bg-primary/10 text-primary"
                  : "border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              <BarChart3 className="h-3 w-3" />
              <span className="hidden sm:inline">Inteligência</span>
              {showAnalyticsPanel ? (
                <ChevronUp className="h-3 w-3" />
              ) : (
                <ChevronDown className="h-3 w-3" />
              )}
            </button>
          </SystemTooltip>

          {/* Atualizar */}
          <SystemTooltip content="Atualizar dados de visitantes em tempo real">
            <button
              type="button"
              onClick={() => void fetchVisitors(true)}
              className="grid h-7 w-7 place-items-center rounded-xl border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted transition cursor-pointer"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${refreshing ? "animate-spin text-primary" : ""}`}
              />
            </button>
          </SystemTooltip>
        </div>
      </div>

      {/* ── CONTEÚDO ROLÁVEL DO COCKPIT ────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-5 py-3.5 space-y-3.5">
        {permissionDenied ? (
          <div className="flex flex-col items-center justify-center gap-3 py-12 px-6 text-center rounded-2xl border border-border bg-card">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/25">
              <ShieldAlert className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs font-extrabold text-foreground">
                Acesso restrito ao monitoramento global do site
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground max-w-md">
                Seu perfil atual requer a permissão de visualização global de atendimentos ou acesso ao canal Site para monitorar todos os visitantes em tempo real.
              </p>
            </div>
          </div>
        ) : (
          <>
            {/* ── CAMADA 1: 4 CARDS EXECUTIVOS DE KPIS ──────────────────────── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2.5">
              {/* KPI 1: Online Agora & Engajamento */}
              <button
                type="button"
                onClick={() =>
                  setFilterMode((prev) => (prev === "online" ? "all" : "online"))
                }
                className={`text-left rounded-2xl border p-3 transition cursor-pointer flex flex-col justify-between gap-2 ${
                  filterMode === "online"
                    ? "border-emerald-500/45 bg-emerald-500/8 shadow-sm"
                    : "border-border bg-card hover:border-primary/30 hover:bg-muted/20"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">
                    Tráfego & Leitura
                  </span>
                  <div className="grid h-6 w-6 place-items-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                    <Users2 className="h-3.5 w-3.5" />
                  </div>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-lg font-extrabold text-foreground leading-none">
                        {metrics.onlineNow}
                      </span>
                      <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                        online agora
                      </span>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      Total no período:{" "}
                      <strong className="text-foreground">{metrics.totalVisitors}</strong>
                    </p>
                  </div>
                  <div className="text-right text-[10px] text-muted-foreground space-y-0.5">
                    <div className="inline-flex items-center gap-1 font-semibold text-foreground">
                      <Clock className="h-2.5 w-2.5 text-primary" />
                      {formatDurationCompact(metrics.avgTimeOnSiteSec)} méd.
                    </div>
                    <div className="block">
                      Rolagem: <strong className="text-foreground">{metrics.avgScrollDepth}%</strong>
                    </div>
                  </div>
                </div>
              </button>

              {/* KPI 2: Intenção de Compra (Leads Quentes / Cliques) */}
              <button
                type="button"
                onClick={() => setFilterMode((prev) => (prev === "hot" ? "all" : "hot"))}
                className={`text-left rounded-2xl border p-3 transition cursor-pointer flex flex-col justify-between gap-2 ${
                  filterMode === "hot"
                    ? "border-rose-500/45 bg-rose-500/8 shadow-sm"
                    : "border-border bg-card hover:border-primary/30 hover:bg-muted/20"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">
                    Intenção de Compra
                  </span>
                  <div className="grid h-6 w-6 place-items-center rounded-lg bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20">
                    <Flame className="h-3.5 w-3.5" />
                  </div>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-lg font-extrabold text-foreground leading-none">
                        {metrics.hotVisitors}
                      </span>
                      <span className="text-[10px] font-bold text-rose-600 dark:text-rose-400">
                        alta intenção
                      </span>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      Mornos: <strong className="text-foreground">{metrics.warmVisitors}</strong> · Frios:{" "}
                      <strong className="text-foreground">{metrics.coldVisitors}</strong>
                    </p>
                  </div>
                  <div className="text-right text-[10px] text-muted-foreground space-y-0.5">
                    <div className="inline-flex items-center gap-1 font-semibold text-foreground">
                      <MousePointerClick className="h-2.5 w-2.5 text-primary" />
                      {metrics.totalClicks} cliques
                    </div>
                    <div className="block">
                      <strong className="text-foreground">{metrics.totalPageviews}</strong> págs vistas
                    </div>
                  </div>
                </div>
              </button>

              {/* KPI 3: Atendimento no Site (IA & Consultores) */}
              <button
                type="button"
                onClick={() =>
                  setFilterMode((prev) => (prev === "attending" ? "all" : "attending"))
                }
                className={`text-left rounded-2xl border p-3 transition cursor-pointer flex flex-col justify-between gap-2 ${
                  filterMode === "attending"
                    ? "border-primary/45 bg-primary/8 shadow-sm"
                    : "border-border bg-card hover:border-primary/30 hover:bg-muted/20"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">
                    Atendimento & Triagem
                  </span>
                  <div className="grid h-6 w-6 place-items-center rounded-lg bg-primary/10 text-primary border border-primary/20">
                    <Bot className="h-3.5 w-3.5" />
                  </div>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-lg font-extrabold text-foreground leading-none">
                        {metrics.visitorsWithChat}
                      </span>
                      <span className="text-[10px] font-bold text-primary">
                        abordados ({approachRatePct}%)
                      </span>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      IA ({aiPersona.name}):{" "}
                      <strong className="text-foreground">{metrics.inAiTriage}</strong> · Humano:{" "}
                      <strong className="text-foreground">{metrics.inHumanService}</strong>
                    </p>
                  </div>
                  <div className="text-right text-[10px] text-muted-foreground space-y-0.5">
                    <div className=" font-semibold text-foreground">
                      Fila: <strong>{metrics.waitingInQueue}</strong>
                    </div>
                    <div className="block">
                      Navegando:{" "}
                      <strong className="text-foreground">
                        {Math.max(0, metrics.totalVisitors - metrics.visitorsWithChat)}
                      </strong>
                    </div>
                  </div>
                </div>
              </button>

              {/* KPI 4: Conversão Comercial (WhatsApp & Pipeline CRM em R$) */}
              <button
                type="button"
                onClick={() => setFilterMode((prev) => (prev === "crm" ? "all" : "crm"))}
                className={`text-left rounded-2xl border p-3 transition cursor-pointer flex flex-col justify-between gap-2 ${
                  filterMode === "crm"
                    ? "border-emerald-500/45 bg-emerald-500/8 shadow-sm"
                    : "border-border bg-card hover:border-primary/30 hover:bg-muted/20"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">
                    Conversão & Pipeline CRM
                  </span>
                  <div className="grid h-6 w-6 place-items-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                    <Briefcase className="h-3.5 w-3.5" />
                  </div>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-extrabold text-emerald-600 dark:text-emerald-400 leading-none">
                        {formatCurrencyBrl(metrics.crmPipelineValue)}
                      </span>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      Negócios CRM:{" "}
                      <strong className="text-foreground">{metrics.visitorsWithCrmDeal}</strong>
                    </p>
                  </div>
                  <div className="text-right text-[10px] text-muted-foreground space-y-0.5">
                    <div className="inline-flex items-center gap-1 font-semibold text-emerald-600 dark:text-emerald-400">
                      <Link2 className="h-2.5 w-2.5" />
                      {metrics.continuedOnWhatsApp} no WhatsApp
                    </div>
                    {metrics.crmWonValue > 0 && (
                      <div className="block">
                        Ganhos: <strong className="text-foreground">{formatCurrencyBrl(metrics.crmWonValue)}</strong>
                      </div>
                    )}
                  </div>
                </div>
              </button>
            </div>

            {/* ── CAMADA 2: PAINEL ANALÍTICO COLAPSÁVEL (FUNIL / TOP PÁGINAS / ORIGENS) ── */}
            <AnimatePresence initial={false}>
              {showAnalyticsPanel && visitors.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-2.5">
                    {/* Bloco 1: Funil de Conversão do Site */}
                    <div className="rounded-2xl border border-border bg-card p-3.5 flex flex-col justify-between space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                          <Layers className="h-3 w-3 text-primary" />
                          Funil de Conversão do Site
                        </span>
                        <span className="text-[10px] font-bold text-muted-foreground">
                          Jornada Ponta a Ponta
                        </span>
                      </div>

                      <div className="space-y-2">
                        {[
                          {
                            label: "1. Visitantes no Site",
                            count: metrics.conversionFunnel.visitors,
                            pct: 100,
                            barClass: "bg-primary",
                            onClick: () => setFilterMode("all"),
                          },
                          {
                            label: "2. Alta Intenção (Quentes)",
                            count: metrics.conversionFunnel.highIntent,
                            pct:
                              metrics.conversionFunnel.visitors > 0
                                ? Math.round(
                                    (metrics.conversionFunnel.highIntent /
                                      metrics.conversionFunnel.visitors) *
                                      100,
                                  )
                                : 0,
                            barClass: "bg-amber-500",
                            onClick: () => setFilterMode("hot"),
                          },
                          {
                            label: "3. Iniciaram Atendimento",
                            count: metrics.conversionFunnel.chatStarted,
                            pct:
                              metrics.conversionFunnel.visitors > 0
                                ? Math.round(
                                    (metrics.conversionFunnel.chatStarted /
                                      metrics.conversionFunnel.visitors) *
                                      100,
                                  )
                                : 0,
                            barClass: "bg-primary",
                            onClick: () => setFilterMode("attending"),
                          },
                          {
                            label: "4. WhatsApp / Negócio CRM",
                            count: metrics.conversionFunnel.whatsappOrDeal,
                            pct:
                              metrics.conversionFunnel.visitors > 0
                                ? Math.round(
                                    (metrics.conversionFunnel.whatsappOrDeal /
                                      metrics.conversionFunnel.visitors) *
                                      100,
                                  )
                                : 0,
                            barClass: "bg-emerald-500",
                            onClick: () => setFilterMode("whatsapp"),
                          },
                        ].map((step) => (
                          <button
                            key={step.label}
                            type="button"
                            onClick={step.onClick}
                            className="w-full text-left group cursor-pointer"
                          >
                            <div className="flex items-center justify-between text-[11px] mb-1">
                              <span className="font-semibold text-foreground group-hover:text-primary transition">
                                {step.label}
                              </span>
                              <span className="font-extrabold text-foreground">
                                {step.count}{" "}
                                <span className="text-[10px] font-semibold text-muted-foreground">
                                  ({step.pct}%)
                                </span>
                              </span>
                            </div>
                            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all duration-300 ${step.barClass}`}
                                style={{ width: `${Math.max(4, step.pct)}%` }}
                              />
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Bloco 2: Top Páginas & Equipamentos Visitados */}
                    <div className="rounded-2xl border border-border bg-card p-3.5 flex flex-col justify-between space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                          <Package className="h-3 w-3 text-primary" />
                          Páginas & Equipamentos em Destaque
                        </span>
                        {selectedPageFilter && (
                          <button
                            type="button"
                            onClick={() => setSelectedPageFilter(null)}
                            className="text-[10px] font-bold text-primary hover:underline cursor-pointer"
                          >
                            Limpar filtro
                          </button>
                        )}
                      </div>

                      {metrics.topPages.length === 0 ? (
                        <div className="py-6 text-center text-[11px] text-muted-foreground">
                          Sem páginas tabuladas neste período.
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          {metrics.topPages.slice(0, 4).map((pg) => {
                            const isSelected = selectedPageFilter === pg.url;
                            return (
                              <button
                                key={pg.url}
                                type="button"
                                onClick={() =>
                                  setSelectedPageFilter((prev) =>
                                    prev === pg.url ? null : pg.url,
                                  )
                                }
                                className={`w-full flex items-center justify-between gap-2 rounded-xl border px-2.5 py-1.5 text-left transition cursor-pointer ${
                                  isSelected
                                    ? "border-primary bg-primary/10"
                                    : "border-border/60 bg-muted/30 hover:bg-muted/70"
                                }`}
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-[11px] font-bold text-foreground truncate">
                                      {pg.title || pg.url}
                                    </span>
                                    {pg.intent === "high" && (
                                      <span className="shrink-0 rounded-full bg-primary/12 px-1.5 py-0.2 text-[9px] font-extrabold text-primary">
                                        Alta Intenção
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-[10px] text-muted-foreground font-mono truncate">
                                    {pg.url}
                                  </p>
                                </div>
                                <div className="text-right shrink-0">
                                  <span className="text-xs font-extrabold text-foreground">
                                    {pg.views}x
                                  </span>
                                  <span className="block text-[9px] text-muted-foreground">
                                    {pg.uniqueVisitors} visit.
                                  </span>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* Bloco 3: Origem de Tráfego & Performance de Mídia (UTMs) */}
                    <div className="rounded-2xl border border-border bg-card p-3.5 flex flex-col justify-between space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                          <TrendingUp className="h-3 w-3 text-primary" />
                          Origens de Tráfego & Mídia
                        </span>
                        {selectedSourceFilter && (
                          <button
                            type="button"
                            onClick={() => setSelectedSourceFilter(null)}
                            className="text-[10px] font-bold text-primary hover:underline cursor-pointer"
                          >
                            Limpar filtro
                          </button>
                        )}
                      </div>

                      {metrics.trafficSources.length === 0 ? (
                        <div className="py-6 text-center text-[11px] text-muted-foreground">
                          Sem origens registradas neste período.
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          {metrics.trafficSources.slice(0, 4).map((src) => {
                            const isSelected = selectedSourceFilter === src.source;
                            return (
                              <button
                                key={src.source}
                                type="button"
                                onClick={() =>
                                  setSelectedSourceFilter((prev) =>
                                    prev === src.source ? null : src.source,
                                  )
                                }
                                className={`w-full flex items-center justify-between gap-2 rounded-xl border px-2.5 py-1.5 text-left transition cursor-pointer ${
                                  isSelected
                                    ? "border-primary bg-primary/10"
                                    : "border-border/60 bg-muted/30 hover:bg-muted/70"
                                }`}
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-[11px] font-bold text-foreground truncate">
                                      {src.source}
                                    </span>
                                    <span className="text-[10px] font-semibold text-muted-foreground">
                                      ({src.percentage}%)
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5">
                                    <span>
                                      Quentes: <strong className="text-foreground">{src.hotCount}</strong>
                                    </span>
                                    <span>·</span>
                                    <span>
                                      Chat: <strong className="text-foreground">{src.chatCount}</strong>
                                    </span>
                                    {src.dealCount > 0 && (
                                      <>
                                        <span>·</span>
                                        <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                                          CRM: {src.dealCount}
                                        </span>
                                      </>
                                    )}
                                  </div>
                                </div>
                                <span className="text-xs font-extrabold text-foreground shrink-0">
                                  {src.count}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* ── CAMADA 3: BARRA DE PÍLULAS DE FILTRO, BUSCA E ORDENAÇÃO ────── */}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                {/* Pílulas de Filtro Rápido */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  {(
                    [
                      { id: "all", label: "Todos", count: metrics.totalVisitors },
                      { id: "online", label: "Online Agora", count: metrics.onlineNow },
                      { id: "hot", label: "Alta Intenção", count: metrics.hotVisitors },
                      {
                        id: "attending",
                        label: "Em Atendimento / IA",
                        count: metrics.visitorsWithChat,
                      },
                      {
                        id: "whatsapp",
                        label: "Continuou no WhatsApp",
                        count: metrics.continuedOnWhatsApp,
                      },
                      {
                        id: "crm",
                        label: "Com Negócio no CRM",
                        count: metrics.visitorsWithCrmDeal,
                      },
                    ] as Array<{ id: FilterMode; label: string; count: number }>
                  ).map((pill) => {
                    const active = filterMode === pill.id;
                    return (
                      <button
                        key={pill.id}
                        type="button"
                        onClick={() => setFilterMode(pill.id)}
                        className={`inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1 text-[11px] font-bold transition cursor-pointer ${
                          active
                            ? "border-primary bg-primary text-primary-foreground shadow-xs"
                            : "border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted"
                        }`}
                      >
                        <span>{pill.label}</span>
                        <span
                          className={`rounded-full px-1.5 py-0.2 text-[9px] font-extrabold ${
                            active
                              ? "bg-primary-foreground/20 text-primary-foreground"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {pill.count}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Seletor Customizado de Ordenação */}
                <Popover open={sortPopoverOpen} onOpenChange={setSortPopoverOpen}>
                  <SystemTooltip content="Ordenar lista de visitantes">
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1.5 h-7 rounded-xl border border-border bg-card px-2.5 text-[11px] font-bold text-foreground hover:bg-muted transition cursor-pointer"
                      >
                        <ArrowUpDown className="h-3 w-3 text-primary" />
                        <span>{currentSortOption.label}</span>
                        <ChevronDown className="h-3 w-3 text-muted-foreground" />
                      </button>
                    </PopoverTrigger>
                  </SystemTooltip>
                  <PopoverContent align="end" className="w-64 p-1.5 rounded-2xl">
                    <p className="px-2.5 py-1 text-[9px] font-extrabold uppercase tracking-wider text-muted-foreground">
                      Critério de Ordenação
                    </p>
                    {SORT_OPTIONS.map((opt) => {
                      const active = opt.id === sortMode;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => {
                            setSortMode(opt.id);
                            setSortPopoverOpen(false);
                          }}
                          className={`w-full flex items-center justify-between gap-2 rounded-xl px-2.5 py-1.5 text-xs font-semibold transition cursor-pointer ${
                            active
                              ? "bg-primary/10 text-primary font-bold"
                              : "text-foreground hover:bg-muted"
                          }`}
                        >
                          <span>{opt.label}</span>
                          {active && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                        </button>
                      );
                    })}
                  </PopoverContent>
                </Popover>
              </div>

              {/* Barra de busca + Chips de subfiltros ativos */}
              <div className="flex items-center gap-2 flex-wrap">
                <div className="relative flex-1 min-w-[240px]">
                  <Search className="h-3.5 w-3.5 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Buscar por cliente, empresa, CNPJ, equipamento, página, cidade, consultor ou campanha..."
                    className="h-8 w-full rounded-xl border border-border bg-card pl-8 pr-8 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  {search && (
                    <button
                      type="button"
                      onClick={() => setSearch("")}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                {selectedSourceFilter && (
                  <span className="inline-flex items-center gap-1 rounded-xl border border-primary/30 bg-primary/10 px-2.5 py-1 text-[11px] font-bold text-primary">
                    <Filter className="h-3 w-3" />
                    Origem: {selectedSourceFilter}
                    <button
                      type="button"
                      onClick={() => setSelectedSourceFilter(null)}
                      className="ml-1 hover:opacity-75 cursor-pointer"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                )}

                {selectedPageFilter && (
                  <span className="inline-flex items-center gap-1 rounded-xl border border-primary/30 bg-primary/10 px-2.5 py-1 text-[11px] font-bold text-primary">
                    <Filter className="h-3 w-3" />
                    Página: {selectedPageFilter}
                    <button
                      type="button"
                      onClick={() => setSelectedPageFilter(null)}
                      className="ml-1 hover:opacity-75 cursor-pointer"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                )}
              </div>
            </div>

            {/* ── CAMADA 4: LISTA DE CARDS 360º DE VISITANTES ───────────────── */}
            {loading ? (
              <div className="space-y-2.5 py-2">
                {[...Array(4)].map((_, idx) => (
                  <div
                    key={idx}
                    className="h-28 rounded-2xl border border-border bg-card/60 animate-pulse"
                  />
                ))}
              </div>
            ) : filteredVisitors.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-12 px-6 text-center rounded-2xl border border-dashed border-border bg-card/50">
                <div className="grid h-12 w-12 place-items-center rounded-2xl bg-muted text-muted-foreground">
                  <Globe className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-xs font-bold text-foreground">
                    Nenhum visitante encontrado para os filtros selecionados
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground max-w-md">
                    Experimente alternar o filtro para "Todos" ou ampliar a janela de tempo para visualizar o histórico completo de visitantes e jornadas do site.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-2.5 pb-4">
                {filteredVisitors.map((v) => {
                  const displayName = v.name?.trim() || "Visitante do Site";
                  const score = Number(v.intentScore || 0);
                  const isHot = v.temperature === "hot" || score >= 60;
                  const isWarm = !isHot && (v.temperature === "warm" || score >= 30);
                  const attendanceBadge = getAttendanceBadgeConfig(
                    v.attendanceStatus || "browsing",
                    aiPersona.name,
                    v.operatorName,
                  );

                  return (
                    <motion.div
                      layout
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      key={v.id}
                      onClick={() =>
                        setSelectedVisitor({
                          visitorId: v.id,
                          contactId: v.contactId,
                          name: displayName,
                        })
                      }
                      className="group rounded-2xl border border-border bg-card p-3.5 shadow-soft hover:border-primary/40 hover:bg-muted/15 transition cursor-pointer space-y-2.5"
                    >
                      {/* Linha 1: Identidade, Temperatura/Score, Status de Atendimento e Ações */}
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="relative shrink-0">
                            <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary font-extrabold text-xs border border-primary/20">
                              {displayName.slice(0, 2).toUpperCase()}
                            </div>
                            <span
                              className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ring-2 ring-card ${
                                v.isOnline
                                  ? "bg-emerald-500 animate-pulse"
                                  : "bg-muted-foreground/40"
                              }`}
                            />
                          </div>

                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-xs font-extrabold text-foreground truncate">
                                {displayName}
                              </span>

                              {v.company && (
                                <span className="inline-flex items-center gap-1 rounded-lg bg-muted px-1.5 py-0.5 text-[10px] font-bold text-foreground border border-border truncate max-w-[180px]">
                                  <Building2 className="h-2.5 w-2.5 text-muted-foreground shrink-0" />
                                  {v.company}
                                </span>
                              )}

                              {v.isOnline && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 border border-emerald-500/25 px-1.5 py-0.5 text-[9px] font-extrabold text-emerald-600 dark:text-emerald-400">
                                  Online
                                </span>
                              )}

                              {/* Badge de Temperatura + Score (Sem emojis, apenas Lucide) */}
                              <span
                                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-extrabold border ${
                                  isHot
                                    ? "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/25"
                                    : isWarm
                                      ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/25"
                                      : "bg-muted text-muted-foreground border-border"
                                }`}
                              >
                                {isHot ? (
                                  <Flame className="h-2.5 w-2.5 shrink-0" />
                                ) : isWarm ? (
                                  <TrendingUp className="h-2.5 w-2.5 shrink-0" />
                                ) : (
                                  <Snowflake className="h-2.5 w-2.5 shrink-0" />
                                )}
                                {isHot ? "Quente" : isWarm ? "Morno" : "Frio"} · {score} pts
                              </span>

                              {/* Badge de Status de Atendimento */}
                              <span
                                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-extrabold border ${attendanceBadge.className}`}
                              >
                                {attendanceBadge.icon}
                                {attendanceBadge.label}
                              </span>
                            </div>

                            {/* Linha 2: Metadados de Localização, Dispositivo, Origem e Telemetria */}
                            <div className="flex items-center gap-2.5 text-[10px] text-muted-foreground mt-1 flex-wrap">
                              {(v.city || v.region) && (
                                <span className="inline-flex items-center gap-1 font-medium text-foreground/85">
                                  <MapPin className="h-2.5 w-2.5 text-primary" />
                                  {[v.city, v.region].filter(Boolean).join(", ")}
                                </span>
                              )}

                              <span className="inline-flex items-center gap-1">
                                {v.device === "mobile" ? (
                                  <Smartphone className="h-2.5 w-2.5" />
                                ) : v.device === "tablet" ? (
                                  <Tablet className="h-2.5 w-2.5" />
                                ) : (
                                  <Monitor className="h-2.5 w-2.5" />
                                )}
                                {[v.browser, v.os !== "Web" ? v.os : null]
                                  .filter(Boolean)
                                  .join(" · ") || "Web"}
                              </span>

                              {v.source && (
                                <span className="inline-flex items-center gap-1 font-semibold text-primary">
                                  <TrendingUp className="h-2.5 w-2.5" />
                                  {v.source}
                                  {v.utmCampaign ? ` (${v.utmCampaign})` : ""}
                                </span>
                              )}

                              <span className="inline-flex items-center gap-1">
                                <Eye className="h-2.5 w-2.5" />
                                {v.pageviewsCount || 1}{" "}
                                {(v.pageviewsCount || 1) === 1 ? "pág" : "págs"}
                              </span>

                              {(v.totalTimeOnSite || 0) > 0 && (
                                <span className="inline-flex items-center gap-1">
                                  <Clock className="h-2.5 w-2.5" />
                                  {formatDurationCompact(v.totalTimeOnSite)}
                                </span>
                              )}

                              {(v.avgScrollDepth || 0) > 0 && (
                                <span className="inline-flex items-center gap-1">
                                  <ScrollText className="h-2.5 w-2.5" />
                                  {v.avgScrollDepth}%
                                </span>
                              )}

                              {(v.clicksCount || 0) > 0 && (
                                <span className="inline-flex items-center gap-1 font-semibold text-foreground">
                                  <MousePointerClick className="h-2.5 w-2.5 text-primary" />
                                  {v.clicksCount}{" "}
                                  {v.clicksCount === 1 ? "clique" : "cliques"}
                                </span>
                              )}

                              <span className="inline-flex items-center gap-1">
                                <Clock className="h-2.5 w-2.5" />
                                {formatRelativeTime(v.lastSeenAt)}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Botões de Ação Rápida */}
                        <div className="flex items-center gap-1.5 shrink-0">
                          {v.conversationId && (
                            <SystemTooltip content="Ir diretamente para a conversa deste visitante no Chat">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleOpenConversation(v.conversationId!);
                                }}
                                className="inline-flex items-center gap-1 rounded-xl border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500 hover:text-white px-2.5 py-1.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-400 transition cursor-pointer"
                              >
                                <MessageSquare className="h-3 w-3" />
                                Abrir Conversa
                              </button>
                            </SystemTooltip>
                          )}

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedVisitor({
                                visitorId: v.id,
                                contactId: v.contactId,
                                name: displayName,
                              });
                            }}
                            className="inline-flex items-center gap-1 rounded-xl border border-primary/25 bg-primary/10 px-2.5 py-1.5 text-[10px] font-bold text-primary group-hover:bg-primary group-hover:text-primary-foreground transition cursor-pointer"
                          >
                            <Sparkles className="h-3 w-3" />
                            Jornada 360º
                          </button>
                        </div>
                      </div>

                      {/* Linha 3: Página Atual, Equipamento de Interesse e Último Clique */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        <div className="rounded-xl bg-muted/40 border border-border/60 px-3 py-2 text-[11px] flex flex-col justify-between">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[9px] font-extrabold uppercase tracking-wider text-muted-foreground">
                              Página Atual no Site
                            </span>
                            {v.utmSource && (
                              <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold text-primary">
                                UTM: {v.utmSource}
                              </span>
                            )}
                          </div>
                          <div className="font-bold text-foreground truncate mt-0.5">
                            {v.currentPageTitle || cleanPath(v.currentPage)}
                          </div>
                          {v.currentPage && (
                            <div className="text-[10px] text-muted-foreground font-mono truncate flex items-center gap-1 mt-0.5">
                              <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                              <span className="truncate">{cleanPath(v.currentPage)}</span>
                            </div>
                          )}
                        </div>

                        {/* Interesse em Produto / Última Ação ou Negócio CRM */}
                        <div className="rounded-xl bg-muted/40 border border-border/60 px-3 py-2 text-[11px] flex flex-col justify-between">
                          {v.crmDeal ? (
                            <>
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[9px] font-extrabold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                                  <Briefcase className="h-2.5 w-2.5" />
                                  Negócio Vinculado no CRM
                                </span>
                                <a
                                  href={`/crm/deals/${v.crmDeal.id}`}
                                  onClick={(e) => e.stopPropagation()}
                                  className="inline-flex items-center gap-1 text-[10px] font-extrabold text-primary hover:underline"
                                >
                                  Abrir no CRM
                                  <ExternalLink className="h-2.5 w-2.5" />
                                </a>
                              </div>
                              <div className="font-extrabold text-foreground truncate mt-0.5">
                                {v.crmDeal.title} ·{" "}
                                <span className="text-emerald-600 dark:text-emerald-400">
                                  {formatCurrencyBrl(v.crmDeal.value)}
                                </span>
                              </div>
                              <div className="text-[10px] text-muted-foreground truncate mt-0.5">
                                {[v.crmDeal.pipelineName, v.crmDeal.stageName]
                                  .filter(Boolean)
                                  .join(" → ")}
                              </div>
                            </>
                          ) : v.productInterest || v.lastClickType ? (
                            <>
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[9px] font-extrabold uppercase tracking-wider text-amber-600 dark:text-amber-400 flex items-center gap-1">
                                  <Package className="h-2.5 w-2.5" />
                                   Sinais de Interesse Comercial
                                </span>
                                {v.lastClickType && (
                                  <span className="rounded bg-amber-500/12 px-1.5 py-0.5 text-[9px] font-bold text-amber-600 dark:text-amber-400">
                                    {CLICK_LABELS[v.lastClickType] || v.lastClickType}
                                  </span>
                                )}
                              </div>
                              <div className="font-bold text-foreground truncate mt-0.5">
                                {v.productInterest ||
                                  v.lastClickText ||
                                  CLICK_LABELS[v.lastClickType || ""] ||
                                  "Interação ativa no site"}
                              </div>
                              <div className="text-[10px] text-muted-foreground truncate mt-0.5">
                                {v.highIntentPagesCount > 0
                                  ? `${v.highIntentPagesCount} ${
                                      v.highIntentPagesCount === 1
                                        ? "página comercial visitada"
                                        : "páginas comerciais visitadas"
                                    }`
                                  : "Rastreamento comportamental ativo"}
                              </div>
                            </>
                          ) : (
                            <>
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[9px] font-extrabold uppercase tracking-wider text-muted-foreground">
                                  Página de Entrada
                                </span>
                                <span className="text-[9px] font-bold text-muted-foreground">
                                  Visita #{v.visitCount || 1}
                                </span>
                              </div>
                              <div className="font-semibold text-foreground truncate mt-0.5">
                                {cleanPath(v.entryPage || v.currentPage)}
                              </div>
                              <div className="text-[10px] text-muted-foreground truncate mt-0.5">
                                Engajamento: {v.engagementScore || 0}% · Sem chat iniciado ainda
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* Modal de Jornada 360º do Visitante */}
      <CustomerJourneyModal
        open={selectedVisitor !== null}
        visitorId={selectedVisitor?.visitorId}
        contactId={selectedVisitor?.contactId}
        initialName={selectedVisitor?.name}
        onClose={() => setSelectedVisitor(null)}
        onOpenChat={(conversationId) => {
          handleOpenConversation(conversationId);
        }}
      />
    </div>
  );
}
