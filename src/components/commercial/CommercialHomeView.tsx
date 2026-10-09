import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { motion, AnimatePresence } from "framer-motion";
import { useChat } from "@/hooks/useChatState";
import { useTabNavigation } from "@/hooks/useTabNavigation";
import { CommercialEvidenceDialog } from "./CommercialEvidenceDialog";
import { CommercialHomeSkeleton } from "./CommercialHomeSkeleton";
import { getDeterministicConsultantAvatar } from "@/lib/commercial/avatar-matcher";
import {
  AlertTriangle,
  ArrowUpRight,
  Bell,
  BriefcaseBusiness,
  Calendar,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Flame,
  ListFilter,
  Loader2,
  Mail,
  MessageSquare,
  MessageSquareText,
  Phone,
  RefreshCw,
  Target,
  TrendingUp,
  X,
} from "lucide-react";

type CommercialHome = {
  asOf: string;
  today: string;
  month: string;
  consultant: { id: string; name: string; avatar: string | null; division: string | null };
  goal: {
    configured: boolean;
    targetValue: number;
    realizedValue: number;
    conversionRate: number;
    businessDays: number;
    elapsedDays: number;
    remainingDays: number;
    expectedPercent: number;
    coveragePercent: number;
    dailyRequired: number;
  };
  deals: { openCount: number; openValue: number; wonThisMonthCount: number };
  wonDeals?: Array<{
    id: string;
    title: string;
    value: number;
    closedAt: string | null;
  }>;
  calendarDays?: Array<{
    date: string;
    type: string;
    description: string;
    affectsGoal: boolean;
  }>;
  activities: Array<{
    id: string;
    title: string;
    dueDate: string | null;
    dealId: string;
    dealTitle: string;
  }>;
  directives: Array<{
    id: string;
    dealId: string;
    dealTitle: string;
    dealValue: number;
    stageName?: string | null;
    instruction: string;
    priority: string;
    assignedDate: string;
    dueAt: string | null;
    status: string;
    completedAt?: string | null;
    completionNote?: string | null;
    evidenceChannel?: string | null;
    overdue: boolean;
  }>;
};

type Filter = "Todas" | "Atrasadas" | "Alta" | "Hoje" | "Concluídas";

function formatBRL(val: number | string | null | undefined): string {
  const num = typeof val === "string" ? parseFloat(val) : Number(val || 0);
  if (isNaN(num)) return "R$ 0,00";
  return num.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "TF";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function ProgressBar({
  value,
  color,
  className = "",
  delay = 0,
}: {
  value: number;
  color?: string;
  className?: string;
  delay?: number;
}) {
  return (
    <div className={`h-2 overflow-hidden rounded-[2px] bg-muted dark:bg-zinc-800 ${className}`}>
      <motion.div
        initial={{ width: 0 }}
        animate={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        transition={{ duration: 0.9, delay, ease: "easeOut" }}
        className="h-full"
        style={{
          backgroundColor: color || "var(--primary)",
        }}
      />
    </div>
  );
}

function PriorityPill({ priority }: { priority: string }) {
  const norm = priority.toLowerCase();
  const isHigh = norm === "alta" || norm === "critical" || norm === "high";
  const isMed = norm === "média" || norm === "media" || norm === "medium";
  const style = isHigh
    ? "border-red-300 bg-red-50 text-red-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-400"
    : isMed
      ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-400"
      : "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-cyan-900 dark:bg-emerald-950/20 dark:text-emerald-300";
  return (
    <motion.span
      whileHover={{ scale: 1.05 }}
      className={`rounded-[2px] border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[.13em] transition-transform ${style}`}
    >
      {isHigh ? "ALTA" : isMed ? "MÉDIA" : "BAIXA"}
    </motion.span>
  );
}

function StatCard({
  label,
  value,
  meta,
  icon: Icon,
  accent,
  progress,
  delay = 0,
}: {
  label: string;
  value: string;
  meta: string;
  icon: any;
  accent: string;
  progress?: {
    valuePct: number;
    color: string;
    leftLabel?: string;
    rightLabel?: string;
  };
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay, ease: "easeOut" }}
      whileHover={{ y: -4, transition: { duration: 0.2 } }}
      className="group border border-border/80 bg-card p-4 transition-all duration-300 hover:border-primary/50 hover:shadow-lg dark:border-zinc-800 dark:bg-zinc-950/70 dark:hover:border-zinc-700 flex flex-col justify-between rounded-[4px]"
    >
      <div>
        <div className="mb-3 flex items-start justify-between">
          <span className="text-[10px] font-bold uppercase tracking-[.18em] text-muted-foreground dark:text-zinc-400 group-hover:text-foreground transition-colors">
            {label}
          </span>
          <motion.span
            whileHover={{ scale: 1.15, rotate: 6 }}
            className="border border-border bg-muted/60 p-1.5 rounded-[4px] dark:border-zinc-800 dark:bg-zinc-900 shadow-sm transition-transform"
            style={{ color: accent }}
          >
            <Icon size={15} strokeWidth={1.8} />
          </motion.span>
        </div>
        <div className="font-mono text-2xl font-semibold tracking-[-.04em] text-foreground dark:text-zinc-100 group-hover:text-primary transition-colors">
          {value}
        </div>
        <p className="mt-1 text-xs text-muted-foreground dark:text-zinc-400">{meta}</p>
      </div>

      {progress && (
        <div className="mt-3.5 pt-3 border-t border-border/80 dark:border-zinc-800/80">
          <div className="h-1.5 w-full bg-muted dark:bg-zinc-900 border border-border/60 dark:border-zinc-800/80 rounded-[2px] overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${Math.min(100, Math.max(0, progress.valuePct))}%` }}
              transition={{ duration: 0.9, delay: delay + 0.15, ease: "easeOut" }}
              className={`h-full ${progress.color}`}
            />
          </div>
          {(progress.leftLabel || progress.rightLabel) && (
            <div className="mt-1.5 flex justify-between text-[10px] font-mono text-muted-foreground dark:text-zinc-500">
              <span>{progress.leftLabel}</span>
              <span>{progress.rightLabel}</span>
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}

export interface CommercialHomeViewProps {
  operatorId?: string;
  isManagementPreview?: boolean;
  onBack?: () => void;
}

export function CommercialHomeView({
  operatorId,
  isManagementPreview = false,
  onBack,
}: CommercialHomeViewProps = {}) {
  const { tenant, setActiveView } = useChat();
  const navigate = useNavigate();
  const [data, setData] = useState<CommercialHome | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("Todas");
  const [selectedCalendarDate, setSelectedCalendarDate] = useState<string>("");
  const [selectedDirective, setSelectedDirective] = useState<
    CommercialHome["directives"][number] | null
  >(null);
  const [isAgendaModalOpen, setIsAgendaModalOpen] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const url = operatorId
        ? `/api/commercial/home?operatorId=${encodeURIComponent(operatorId)}`
        : "/api/commercial/home";
      const response = await fetch(url, { credentials: "same-origin", signal });
      if (!response.ok) {
        const errPayload = await response.json().catch(() => ({}));
        throw new Error(
          errPayload.error ||
            (response.status === 403
              ? "Você não tem acesso ao Início Comercial."
              : "Falha ao carregar seus indicadores comerciais."),
        );
      }
      const home = (await response.json()) as CommercialHome;
      if (!signal?.aborted) {
        setData(home);
        if (!selectedCalendarDate) {
          setSelectedCalendarDate(home.today);
        }
      }
    } catch (cause) {
      if (!signal?.aborted)
        setError(
          cause instanceof Error ? cause.message : "Falha ao carregar seus indicadores comerciais.",
        );
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [operatorId, selectedCalendarDate]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, tenant, operatorId]);

  const openDeal = (dealId: string) =>
    navigate({ to: "/crm/deals/$dealId", params: { dealId }, search: { from: "crm" } });

  const openCrm = () => {
    setActiveView("crm");
    navigate({ to: "/" });
  };

  // Dados calculados para exibição
  const now = useMemo(() => new Date(), []);
  const weekdayName = useMemo(
    () => now.toLocaleDateString("pt-BR", { weekday: "long" }).toUpperCase(),
    [now],
  );
  const dateLongFormatted = useMemo(() => {
    const day = now.getDate();
    const month = now.toLocaleDateString("pt-BR", { month: "long" }).toUpperCase();
    const year = now.getFullYear();
    return `${day} DE ${month} DE ${year}`;
  }, [now]);

  const hour = useMemo(() => {
    return Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Sao_Paulo",
        hour: "2-digit",
        hour12: false,
      }).format(now),
    );
  }, [now]);

  const greeting = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
  const consultantName = data?.consultant.name || "Consultor";
  const consultantFirstName = consultantName.trim().split(/\s+/)[0];

  const directives = useMemo(() => data?.directives || [], [data?.directives]);
  const completedDirectives = useMemo(
    () => directives.filter((d) => d.status === "completed"),
    [directives],
  );
  const pendingDirectives = useMemo(
    () => directives.filter((d) => d.status === "pending"),
    [directives],
  );
  const openActionsCount = pendingDirectives.length;
  const overdueActionsCount = pendingDirectives.filter((d) => d.overdue).length;

  const totalActionsCount = openActionsCount + completedDirectives.length;
  const progressRatio =
    totalActionsCount > 0 ? (completedDirectives.length / totalActionsCount) * 100 : 0;

  // Abas de diretrizes com suporte a navegação rápida por teclado
  const directiveTabs = useMemo<Filter[]>(() => {
    const tabs: Filter[] = ["Todas"];
    if (overdueActionsCount > 0) tabs.push("Atrasadas");
    tabs.push("Alta", "Hoje");
    if (completedDirectives.length > 0) tabs.push("Concluídas");
    return tabs;
  }, [completedDirectives.length, overdueActionsCount]);

  useTabNavigation({
    tabs: directiveTabs,
    activeTab: filter,
    onChange: setFilter,
  });

  // Filtragem de diretrizes
  const visibleDirectives = useMemo(() => {
    if (filter === "Atrasadas") return pendingDirectives.filter((d) => d.overdue);
    if (filter === "Alta")
      return pendingDirectives.filter(
        (d) =>
          d.priority.toLowerCase() === "alta" ||
          d.priority.toLowerCase() === "high" ||
          d.priority.toLowerCase() === "critical",
      );
    if (filter === "Hoje")
      return pendingDirectives.filter((d) => d.assignedDate === (data?.today || ""));
    if (filter === "Concluídas") return completedDirectives;
    return pendingDirectives;
  }, [completedDirectives, data?.today, filter, pendingDirectives]);

  // Cálculos do Calendário Comercial
  const calendarData = useMemo(() => {
    const monthKey = data?.month || data?.today?.slice(0, 7) || "2026-10";
    const [yearStr, monthStr] = monthKey.split("-");
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);
    const totalDays = new Date(year, month, 0).getDate();
    const firstDayWeekIndex = new Date(year, month - 1, 1).getDay(); // 0 = Dom, 1 = Seg...

    const wonMap = new Map<string, Array<NonNullable<CommercialHome["wonDeals"]>[number]>>();
    (data?.wonDeals || []).forEach((deal) => {
      if (!deal.closedAt) return;
      const dStr = deal.closedAt.slice(0, 10);
      if (!wonMap.has(dStr)) wonMap.set(dStr, []);
      wonMap.get(dStr)!.push(deal);
    });

    const holidaysMap = new Map<string, NonNullable<CommercialHome["calendarDays"]>[number]>();
    (data?.calendarDays || []).forEach((h) => {
      if (h.type === "holiday" || h.type === "bridge" || h.type === "suspension") {
        holidaysMap.set(h.date, h);
      }
    });

    const todayStr = data?.today || new Date().toISOString().slice(0, 10);

    const days: Array<{
      dayNumber: number;
      dateStr: string;
      dayOfWeek: number;
      isWeekend: boolean;
      isToday: boolean;
      deals: Array<NonNullable<CommercialHome["wonDeals"]>[number]>;
      totalSold: number;
      holiday: NonNullable<CommercialHome["calendarDays"]>[number] | null;
    }> = [];

    for (let d = 1; d <= totalDays; d++) {
      const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const dObj = new Date(year, month - 1, d);
      const dayOfWeek = dObj.getDay();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      const deals = wonMap.get(dateStr) || [];
      const totalSold = deals.reduce((acc, deal) => acc + (deal.value || 0), 0);
      const holiday = holidaysMap.get(dateStr) || null;

      days.push({
        dayNumber: d,
        dateStr,
        dayOfWeek,
        isWeekend,
        isToday: dateStr === todayStr,
        deals,
        totalSold,
        holiday,
      });
    }

    return { firstDayWeekIndex, days, year, month, totalDays, todayStr };
  }, [data?.calendarDays, data?.month, data?.today, data?.wonDeals]);

  // Informações do dia selecionado no calendário
  const selectedDayInfo = useMemo(() => {
    const targetDate = selectedCalendarDate || data?.today || "";
    return calendarData.days.find((d) => d.dateStr === targetDate) || null;
  }, [calendarData.days, data?.today, selectedCalendarDate]);

  const selectedDayFormatted = useMemo(() => {
    const targetDate = selectedCalendarDate || data?.today;
    if (!targetDate) return "";
    const [y, m, d] = targetDate.split("-").map(Number);
    const dateObj = new Date(y, m - 1, d);
    return dateObj.toLocaleDateString("pt-BR", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
  }, [data?.today, selectedCalendarDate]);

  const monthNameFormatted = useMemo(() => {
    const monthKey = data?.month || data?.today?.slice(0, 7) || "2026-10";
    const [y, m] = monthKey.split("-").map(Number);
    const dateObj = new Date(y, m - 1, 1);
    const mStr = dateObj.toLocaleDateString("pt-BR", { month: "long" });
    return `${mStr.charAt(0).toUpperCase() + mStr.slice(1)} ${y}`;
  }, [data?.month, data?.today]);

  const coveragePct = data?.goal.coveragePercent ?? 0;
  const expectedPct = data?.goal.expectedPercent ?? 23;
  const targetValueFormatted = formatBRL(data?.goal.targetValue ?? 0);
  const realizedValueFormatted = formatBRL(data?.goal.realizedValue ?? 0);
  const dailyRequiredFormatted = data?.goal.configured
    ? formatBRL(data?.goal.dailyRequired ?? 0)
    : "—";
  const wonDealsCount = data?.wonDeals?.length ?? data?.deals.wonThisMonthCount ?? 0;
  const wonDealsCountFormatted = String(wonDealsCount).padStart(2, "0");
  const conversionRate = data?.goal.conversionRate ?? 10.0;
  const remainingWorkdays = data?.goal.remainingDays ?? 17;
  const businessDays = data?.goal.businessDays ?? 22;
  const elapsedDays = data?.goal.elapsedDays ?? 5;

  const ticketMedio =
    wonDealsCount > 0 ? (data?.goal.realizedValue || 0) / wonDealsCount : 0;

  return (
    <section className="h-full min-w-0 flex-1 overflow-y-auto bg-background px-3 py-4 text-foreground sm:px-6 sm:py-6 lg:px-8">
      {/* Background aurora sutil para profundidade de cockpit */}
      <div
        className="pointer-events-none fixed inset-0 opacity-30 dark:opacity-40"
        style={{
          background:
            "radial-gradient(circle at 76% 0%, color-mix(in srgb, var(--primary) 12%, transparent), transparent 28%), radial-gradient(circle at 5% 75%, rgba(16,185,129,.05), transparent 28%)",
        }}
      />

      <div className="relative mx-auto w-full max-w-[2400px]">
        {/* HEADER EXECUTIVO IDÊNTICO À REFERÊNCIA COM ANIMAÇÃO */}
        <motion.header
          initial={{ opacity: 0, y: -14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
          className="border-b border-border/80 pb-5 dark:border-zinc-800"
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            {/* Logomarca Oficial da Empresa com Micro-animação no Hover */}
            <div className="flex items-center gap-3 group">
              <motion.div
                whileHover={{ scale: 1.08, rotate: 2 }}
                whileTap={{ scale: 0.95 }}
                transition={{ type: "spring", stiffness: 400, damping: 17 }}
                className="flex size-10 items-center justify-center border border-border bg-card p-1 rounded-[4px] dark:border-zinc-800 dark:bg-zinc-950 shadow-sm overflow-hidden cursor-pointer"
              >
                <img
                  src={tenant === "tecfag" ? "/logo_tecfag.png" : "/logo_valem.jpg"}
                  alt={tenant === "tecfag" ? "Tecfag" : "Valem"}
                  className="h-full w-full object-contain"
                />
              </motion.div>
              <div>
                <div className="font-mono text-[17px] font-bold tracking-[-.03em] text-foreground dark:text-zinc-50 flex items-center">
                  {tenant === "tecfag" ? "TECFAG" : "VALEM"}
                  <span className="text-primary animate-pulse ml-0.5">.</span>
                </div>
                <div className="mt-0.5 text-[9px] font-bold uppercase tracking-[.22em] text-muted-foreground dark:text-zinc-500">
                  PORTAL DO CONSULTOR
                </div>
              </div>
            </div>

            {/* Ações Rápidas de Topo com Animações Fluidas */}
            <div className="flex items-center gap-2">
              <motion.button
                whileHover={{ scale: 1.1, rotate: 60 }}
                whileTap={{ scale: 0.9 }}
                transition={{ duration: 0.2 }}
                onClick={() => void load()}
                disabled={loading}
                className="border border-border bg-card p-2 text-muted-foreground hover:border-border hover:text-foreground cursor-pointer rounded-[4px] dark:border-zinc-800 dark:bg-zinc-950/70 dark:text-zinc-400 dark:hover:text-zinc-50 transition-colors shadow-sm"
                title="Atualizar dados do cockpit"
              >
                <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
              </motion.button>

              <motion.button
                whileHover={{ scale: 1.1, rotate: overdueActionsCount > 0 ? [0, -8, 8, -4, 0] : 0 }}
                whileTap={{ scale: 0.9 }}
                transition={{ duration: 0.25 }}
                onClick={() => setFilter("Atrasadas")}
                className={`relative border p-2 text-muted-foreground hover:border-border hover:text-foreground cursor-pointer rounded-[4px] transition-colors dark:border-zinc-800 dark:bg-zinc-950/70 dark:text-zinc-400 dark:hover:text-zinc-50 shadow-sm ${
                  overdueActionsCount > 0
                    ? "border-red-600/80 bg-red-50 text-red-600 dark:border-red-600/80 dark:bg-red-950/40 dark:text-red-300"
                    : "border-border bg-card"
                }`}
                title={
                  overdueActionsCount > 0
                    ? `Atenção: Você possui ${overdueActionsCount} diretriz(es) em atraso!`
                    : "Notificações de atendimento"
                }
              >
                <Bell size={16} strokeWidth={1.8} className={overdueActionsCount > 0 ? "text-red-500" : ""} />
                <span
                  className={`absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full ${
                    overdueActionsCount > 0 ? "bg-red-500 animate-ping" : "bg-primary"
                  }`}
                />
                {overdueActionsCount > 0 && (
                  <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-red-500" />
                )}
              </motion.button>

              {/* Chip do Consultor */}
              <motion.div
                whileHover={{ scale: 1.03, y: -1 }}
                transition={{ duration: 0.15 }}
                className="flex items-center gap-2 border border-border bg-card px-2.5 py-1.5 text-left rounded-[4px] dark:border-zinc-800 dark:bg-zinc-950/70 shadow-sm cursor-default"
              >
                <img
                  src={data?.consultant.avatar || getDeterministicConsultantAvatar(consultantName)}
                  alt={consultantName}
                  className="size-6 rounded-[2px] object-cover border border-border dark:border-zinc-700"
                  onError={(e) => {
                    const img = e.currentTarget;
                    const fallback = getDeterministicConsultantAvatar(consultantName);
                    if (img.src !== fallback) {
                      img.src = fallback;
                    }
                  }}
                />
                <span className="hidden text-xs font-semibold text-foreground dark:text-zinc-300 sm:inline">
                  {consultantName}
                </span>
              </motion.div>

              {/* Botão Vermelho Oficial "Abrir CRM" */}
              <motion.button
                whileHover={{
                  scale: 1.04,
                  y: -1,
                  boxShadow: "0 6px 20px color-mix(in srgb, var(--primary) 40%, transparent)",
                }}
                whileTap={{ scale: 0.96 }}
                transition={{ duration: 0.15 }}
                onClick={openCrm}
                className="flex items-center gap-2 bg-primary px-3.5 py-2 text-xs font-bold text-primary-foreground hover:opacity-95 cursor-pointer rounded-[4px] shadow-sm transition-all"
              >
                <ExternalLink size={13} strokeWidth={2.4} />
                Abrir CRM
              </motion.button>
            </div>
          </div>

          {/* Subheader: Data por extenso, Saudação e Atalho de Agenda */}
          <div className="mt-7 flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.2em] text-muted-foreground dark:text-zinc-400">
                <span>{weekdayName}</span>
                <span className="h-1 w-1 rounded-full bg-primary" />
                <span>{dateLongFormatted}</span>
              </div>
              <h1 className="mt-2 font-mono text-3xl font-semibold tracking-[-.06em] text-foreground dark:text-zinc-50 sm:text-4xl">
                {greeting}, {consultantFirstName}
                <span className="text-primary">.</span>
              </h1>
              <p className="mt-2 max-w-xl text-sm text-muted-foreground dark:text-zinc-400">
                Seu foco de hoje está aqui: acompanhe o ritmo, execute as diretrizes e mova as
                oportunidades certas.
              </p>
            </div>

            <motion.button
              whileHover={{ x: 4, scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
              transition={{ duration: 0.15 }}
              onClick={() => setIsAgendaModalOpen(true)}
              className="group flex items-center gap-2 border border-border bg-card px-3.5 py-2.5 text-xs font-bold text-foreground hover:border-primary hover:text-primary cursor-pointer rounded-[4px] transition-colors dark:border-zinc-700 dark:bg-zinc-950/70 dark:text-zinc-300 dark:hover:border-rose-400 dark:hover:text-zinc-50 shadow-sm"
            >
              <CalendarDays size={15} className="text-primary group-hover:scale-110 transition-transform" />
              Ver agenda de hoje
              <ArrowUpRight size={14} className="group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
            </motion.button>
          </div>
        </motion.header>

        {loading && !data ? (
          <CommercialHomeSkeleton />
        ) : error ? (
          <div
            role="alert"
            className="mt-6 rounded-[4px] border border-red-300 bg-red-50 p-5 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200"
          >
            {error}
          </div>
        ) : data ? (
          /* GRID PRINCIPAL EM 2 COLUNAS: ESQUERDA (COCKPIT & DIRETRIZES 65%) + DIREITA (CALENDÁRIO & DOSSIÊ 35%) */
          <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(380px,1fr)] 2xl:grid-cols-[minmax(0,1.65fr)_minmax(420px,1fr)] items-start">
            {/* COLUNA ESQUERDA: COCKPIT OPERACIONAL & DIRETRIZES TÁTICAS */}
            <div className="space-y-4">
              {/* BLOCO 1: 3 CARDS DE TOPO (Ritmo de Hoje + KPIs com Barras de Progresso) */}
              <div className="grid gap-3 lg:grid-cols-[1.3fr_1fr_1fr]">
                {/* CARD 1: RITMO DE HOJE COM HOVER & ANIMAÇÃO */}
                <motion.section
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: 0.05, ease: "easeOut" }}
                  whileHover={{ y: -4, transition: { duration: 0.2 } }}
                  className="group relative overflow-hidden border border-primary/40 bg-card p-5 sm:p-6 flex flex-col justify-between dark:border-rose-800/80 dark:bg-zinc-950/70 rounded-[4px] shadow-sm hover:shadow-lg hover:border-primary/70 transition-all duration-300"
                >
                  <div className="pointer-events-none absolute -right-8 -top-14 h-48 w-48 rounded-full border-[26px] border-primary/10 group-hover:scale-110 group-hover:opacity-80 transition-all duration-500" />
                  <div className="relative">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.18em] text-primary">
                          <Flame size={14} className="group-hover:scale-125 group-hover:rotate-12 transition-transform duration-300" />
                          Ritmo de hoje
                        </div>
                        <h2 className="mt-3 max-w-[320px] font-mono text-2xl font-semibold leading-[1.08] tracking-[-.05em] text-foreground dark:text-zinc-50 group-hover:text-primary transition-colors">
                          Você precisa fechar o próximo passo.
                        </h2>
                      </div>
                      <motion.div
                        whileHover={{ scale: 1.05 }}
                        className="border border-primary/40 bg-primary/10 px-3 py-2 text-right rounded-[4px] dark:border-rose-800 dark:bg-rose-950/30 transition-transform"
                      >
                        <div className="font-mono text-xl font-bold text-primary dark:text-rose-400">
                          {openActionsCount}
                        </div>
                        <div className="text-[9px] font-bold uppercase tracking-[.15em] text-primary/90 dark:text-rose-300">
                          ações abertas
                        </div>
                        {overdueActionsCount > 0 && (
                          <div className="mt-1 font-mono text-[9px] font-bold text-red-600 dark:text-red-400 uppercase tracking-[.08em] animate-pulse">
                            {overdueActionsCount} em atraso
                          </div>
                        )}
                      </motion.div>
                    </div>
                    <div className="mt-7 flex items-end justify-between gap-5">
                      <div>
                        <div className="font-mono text-4xl font-bold tracking-[-.07em] text-primary dark:text-rose-400">
                          {completedDirectives.length} / {totalActionsCount}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground dark:text-zinc-400">
                          diretrizes já concluídas
                        </div>
                      </div>
                      <div className="min-w-[130px] flex-1 pb-2">
                        <ProgressBar value={progressRatio} delay={0.2} />
                        <div className="mt-2 flex justify-between text-[10px] font-mono text-muted-foreground dark:text-zinc-500">
                          <span>08:30</span>
                          <span>18:00</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.section>

                {/* CARD 2: FATURADO ACUMULADO */}
                <StatCard
                  label="Faturado acumulado"
                  value={realizedValueFormatted}
                  meta={`${coveragePct.toFixed(2)}% da meta mensal`}
                  icon={TrendingUp}
                  accent="#10b981"
                  delay={0.1}
                  progress={{
                    valuePct: coveragePct,
                    color: "bg-emerald-500",
                    leftLabel: `Realizado: ${coveragePct.toFixed(1)}%`,
                    rightLabel: `Meta: ${targetValueFormatted}`,
                  }}
                />

                {/* CARD 3: RITMO NECESSÁRIO / DIA */}
                <StatCard
                  label="Ritmo necessário / dia"
                  value={dailyRequiredFormatted}
                  meta={`${remainingWorkdays} dias úteis restantes`}
                  icon={Clock3}
                  accent="#f59e0b"
                  delay={0.15}
                  progress={{
                    valuePct: businessDays > 0 ? (elapsedDays / businessDays) * 100 : 0,
                    color: "bg-amber-500",
                    leftLabel: `${elapsedDays} dias decorridos`,
                    rightLabel: `${remainingWorkdays} restantes`,
                  }}
                />
              </div>

              {/* BLOCO 2: PROGRESSO DA META & AGENDA DE HOJE */}
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(280px,.7fr)]">
                {/* PROGRESSO DA META */}
                <motion.section
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: 0.2, ease: "easeOut" }}
                  whileHover={{ y: -3, transition: { duration: 0.2 } }}
                  className="group border border-border/80 bg-card p-5 sm:p-6 dark:border-zinc-800 dark:bg-zinc-950/70 rounded-[4px] shadow-sm hover:shadow-lg hover:border-primary/40 transition-all duration-300"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.18em] text-muted-foreground dark:text-zinc-400">
                        <Target size={14} className="text-primary group-hover:scale-120 group-hover:rotate-12 transition-transform duration-300" />
                        Progresso da meta
                      </div>
                      <div className="mt-3 flex items-baseline gap-2">
                        <span className="font-mono text-4xl font-bold tracking-[-.07em] text-foreground dark:text-zinc-50 group-hover:text-primary transition-colors">
                          {coveragePct.toFixed(2)}%
                        </span>
                        <span className="text-xs font-semibold text-emerald-500 dark:text-emerald-400">
                          {coveragePct >= expectedPct ? "ritmo acelerado" : "meta em curso"}
                        </span>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-muted-foreground dark:text-zinc-400">Meta mensal</div>
                      <div className="mt-1 font-mono text-lg font-semibold text-foreground dark:text-zinc-300">
                        {targetValueFormatted}
                      </div>
                    </div>
                  </div>

                  <div className="mt-6">
                    <div className="relative">
                      <ProgressBar value={coveragePct} color="#10b981" className="h-3" delay={0.3} />
                      <span
                        className="absolute -top-1.5 h-6 w-0.5 bg-primary"
                        style={{ left: `${Math.min(96, Math.max(4, expectedPct))}%` }}
                        title={`Esperado hoje: ${expectedPct.toFixed(0)}%`}
                      />
                    </div>
                    <div className="mt-3 flex justify-between text-[10px] font-semibold uppercase tracking-[.14em] text-muted-foreground dark:text-zinc-500">
                      <span>Realizado · {realizedValueFormatted}</span>
                      <span className="text-primary font-bold">Esperado hoje · {expectedPct.toFixed(0)}%</span>
                    </div>
                  </div>

                  <div className="mt-6 grid grid-cols-3 divide-x divide-border border-t border-border pt-5 dark:divide-zinc-800 dark:border-zinc-800">
                    <motion.div whileHover={{ scale: 1.04, y: -1 }} className="cursor-default">
                      <div className="text-[10px] uppercase tracking-[.13em] text-muted-foreground dark:text-zinc-400">
                        Vendas
                      </div>
                      <div className="mt-1 font-mono text-lg font-semibold text-foreground dark:text-zinc-50">
                        {wonDealsCountFormatted}
                      </div>
                    </motion.div>
                    <motion.div whileHover={{ scale: 1.04, y: -1 }} className="pl-4 cursor-default">
                      <div className="text-[10px] uppercase tracking-[.13em] text-muted-foreground dark:text-zinc-400">
                        Oportunidades
                      </div>
                      <div className="mt-1 font-mono text-lg font-semibold text-foreground dark:text-zinc-50">
                        {String(data.deals.openCount).padStart(2, "0")}
                      </div>
                    </motion.div>
                    <motion.div whileHover={{ scale: 1.04, y: -1 }} className="pl-4 cursor-default">
                      <div className="text-[10px] uppercase tracking-[.13em] text-muted-foreground dark:text-zinc-400">
                        Conversão
                      </div>
                      <div className="mt-1 font-mono text-lg font-semibold text-emerald-500 dark:text-emerald-400">
                        {conversionRate.toFixed(1)}%
                      </div>
                    </motion.div>
                  </div>
                </motion.section>

                {/* AGENDA DE HOJE */}
                <motion.section
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: 0.25, ease: "easeOut" }}
                  whileHover={{ y: -3, transition: { duration: 0.2 } }}
                  className="group border border-border/80 bg-card p-5 sm:p-6 flex flex-col justify-between dark:border-zinc-800 dark:bg-zinc-950/70 rounded-[4px] shadow-sm hover:shadow-lg hover:border-primary/40 transition-all duration-300"
                >
                  <div>
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.18em] text-muted-foreground dark:text-zinc-400">
                          <CalendarDays size={14} className="text-primary group-hover:scale-110 transition-transform" />
                          Agenda de hoje
                        </div>
                        <div className="mt-3 font-mono text-3xl font-bold tracking-[-.06em] text-foreground dark:text-zinc-50 group-hover:text-primary transition-colors">
                          {String(data.activities.length).padStart(2, "0")}{" "}
                          <span className="text-base font-medium tracking-normal text-muted-foreground dark:text-zinc-400">
                            compromissos
                          </span>
                        </div>
                      </div>
                      <motion.button
                        whileHover={{ scale: 1.15, rotate: 15 }}
                        whileTap={{ scale: 0.9 }}
                        transition={{ duration: 0.15 }}
                        onClick={() => setIsAgendaModalOpen(true)}
                        className="border border-border p-2 text-muted-foreground hover:border-primary hover:text-primary cursor-pointer rounded-[4px] dark:border-zinc-800 dark:text-zinc-400 dark:hover:border-rose-400 dark:hover:text-rose-400 shadow-sm"
                        title="Abrir agenda completa de hoje"
                      >
                        <ArrowUpRight size={15} />
                      </motion.button>
                    </div>

                    <div className="mt-5 space-y-3">
                      {data.activities.length > 0 ? (
                        data.activities.slice(0, 3).map((act) => {
                          const timeStr = act.dueDate
                            ? new Date(act.dueDate).toLocaleTimeString("pt-BR", {
                                timeZone: "America/Sao_Paulo",
                                hour: "2-digit",
                                minute: "2-digit",
                              })
                            : "—";
                          return (
                            <motion.button
                              key={act.id}
                              whileHover={{ x: 5, scale: 1.01 }}
                              whileTap={{ scale: 0.98 }}
                              transition={{ duration: 0.15 }}
                              onClick={() => openDeal(act.dealId)}
                              className="group/item flex w-full items-center gap-3 border-b border-border/80 pb-3 text-left last:border-0 last:pb-0 cursor-pointer dark:border-zinc-800 hover:bg-muted/40 p-1 rounded-[2px]"
                            >
                              <span className="w-11 font-mono text-xs font-semibold text-emerald-500 dark:text-emerald-400 group-hover/item:font-bold">
                                {timeStr}
                              </span>
                              <div className="min-w-0 border-l border-border pl-3 dark:border-zinc-700">
                                <div className="truncate text-xs font-semibold text-foreground dark:text-zinc-300 group-hover/item:text-primary transition-colors">
                                  {act.title}
                                </div>
                                <div className="truncate text-[11px] text-muted-foreground dark:text-zinc-500">
                                  {act.dealTitle}
                                </div>
                              </div>
                            </motion.button>
                          );
                        })
                      ) : (
                        <div className="py-6 text-center text-xs text-muted-foreground dark:text-zinc-500 italic">
                          Nenhum compromisso agendado para hoje.
                        </div>
                      )}
                    </div>
                  </div>
                </motion.section>
              </div>

              {/* BLOCO 3: DIRETRIZES DO GESTOR ("O que move o ponteiro hoje") */}
              <motion.section
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, delay: 0.3, ease: "easeOut" }}
                className="border border-border/80 bg-card dark:border-zinc-800 dark:bg-zinc-950/70 rounded-[4px] shadow-sm"
              >
                <div className="border-b border-border px-5 pb-4 pt-5 sm:px-6 dark:border-zinc-800">
                  <div className="flex flex-wrap items-end justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.18em] text-primary">
                        <BriefcaseBusiness size={14} />
                        Diretrizes do gestor
                      </div>
                      <h2 className="mt-2 font-mono text-2xl font-semibold tracking-[-.05em] text-foreground dark:text-zinc-50">
                        O que move o ponteiro hoje
                      </h2>
                      <p className="mt-1 text-xs text-muted-foreground dark:text-zinc-400">
                        Prioridades encaminhadas pela Gestão Comercial no Cronograma CRM.
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      <ListFilter size={15} className="text-muted-foreground dark:text-zinc-500 mr-1" />
                      {directiveTabs.map((item) => {
                        const isActive = filter === item;
                        const isAtrasadas = item === "Atrasadas";
                        const isConcluidas = item === "Concluídas";
                        return (
                          <motion.button
                            key={item}
                            whileHover={{ scale: 1.05, y: -1 }}
                            whileTap={{ scale: 0.95 }}
                            transition={{ duration: 0.15 }}
                            onClick={() => setFilter(item)}
                            className={`border px-3 py-1 text-[11px] font-bold cursor-pointer rounded-[4px] transition-all shadow-sm ${
                              isActive
                                ? isAtrasadas
                                  ? "border-red-600 bg-red-600 text-white shadow-red-600/30"
                                  : isConcluidas
                                    ? "border-emerald-600 bg-emerald-600 text-white shadow-emerald-600/30"
                                    : "border-primary bg-primary text-primary-foreground shadow-primary/30"
                                : isAtrasadas
                                  ? "border-red-300 bg-red-50 text-red-700 hover:border-red-500 dark:border-red-900/80 dark:bg-red-950/40 dark:text-red-300"
                                  : isConcluidas
                                    ? "border-emerald-300 bg-emerald-50 text-emerald-700 hover:border-emerald-500 dark:border-emerald-900/80 dark:bg-emerald-950/30 dark:text-emerald-300"
                                    : "border-border bg-card text-muted-foreground hover:border-foreground/30 hover:text-foreground dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-50"
                            }`}
                          >
                            {item}{" "}
                            {item === "Atrasadas"
                              ? `(${overdueActionsCount})`
                              : item === "Concluídas"
                                ? `(${completedDirectives.length})`
                                : ""}
                          </motion.button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="divide-y divide-border/80 dark:divide-zinc-800">
                  {visibleDirectives.length ? (
                    visibleDirectives.map((item) => {
                      const isDone = item.status === "completed";
                      return (
                        <motion.article
                          key={item.id}
                          initial={{ opacity: 0, x: -6 }}
                          animate={{ opacity: 1, x: 0 }}
                          whileHover={{ x: 4, transition: { duration: 0.15 } }}
                          className={`group px-5 py-4 transition-colors hover:bg-muted/40 sm:px-6 dark:hover:bg-zinc-900/70 ${
                            item.overdue && !isDone
                              ? "border-l-4 border-l-red-500 bg-red-50/30 dark:bg-red-950/15"
                              : ""
                          }`}
                        >
                          <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
                            <div className="flex min-w-0 flex-1 items-start gap-3">
                              {/* Caixa de Iniciais */}
                              <motion.div
                                whileHover={{ scale: 1.08 }}
                                className={`flex h-10 w-10 shrink-0 items-center justify-center border font-mono text-xs font-bold rounded-[4px] transition-transform ${
                                  item.overdue && !isDone
                                    ? "border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300"
                                    : "border-primary/40 bg-primary/10 text-primary dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-300"
                                }`}
                              >
                                {getInitials(item.dealTitle)}
                              </motion.div>

                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <h3 className="font-semibold text-foreground dark:text-zinc-50 group-hover:text-primary transition-colors">
                                    {item.dealTitle}
                                  </h3>
                                  {item.overdue && !isDone && (
                                    <span className="inline-flex items-center gap-1 rounded-[2px] border border-red-300 bg-red-100 px-2 py-0.5 text-[10px] font-bold font-mono uppercase tracking-[.12em] text-red-700 dark:border-red-700 dark:bg-red-950/80 dark:text-red-300 animate-pulse">
                                      <AlertTriangle size={10} className="stroke-[2.5]" />
                                      ATRASADA
                                    </span>
                                  )}
                                  <PriorityPill priority={item.priority} />
                                </div>
                                <p className="mt-1 text-xs font-medium text-muted-foreground dark:text-zinc-300">
                                  Executar diretriz - {item.stageName || "Leads Recebidos (Faltam 90d p/ maturar)"}
                                </p>
                                <p className="mt-1.5 max-w-2xl text-[11px] font-semibold uppercase tracking-wide text-zinc-400 bg-muted/30 dark:bg-zinc-900/40 p-2 border border-border/40 dark:border-zinc-800/60 rounded-[4px] group-hover:border-primary/30 transition-colors">
                                  {item.instruction || "GESTOR PONTUOU ATENÇÃO E EXECUÇÃO NESSA NEGOCIAÇÃO"}
                                </p>
                              </div>
                            </div>

                            {/* Informações da Direita & Ações */}
                            <div className="flex items-center justify-between gap-5 border-t border-border pt-3 lg:min-w-[380px] lg:border-t-0 lg:pt-0 dark:border-zinc-800">
                              <div>
                                <div
                                  className={`text-[10px] font-bold uppercase tracking-[.12em] font-mono ${
                                    item.overdue && !isDone
                                      ? "text-red-600 dark:text-red-400"
                                      : "text-muted-foreground dark:text-zinc-500"
                                  }`}
                                >
                                  {item.overdue && !isDone
                                    ? `ATRASADA · ${item.assignedDate ? `${item.assignedDate.slice(8, 10)}/${item.assignedDate.slice(5, 7)}` : "08/10"}`
                                    : `HOJE · ${item.assignedDate ? `${item.assignedDate.slice(8, 10)}/${item.assignedDate.slice(5, 7)}` : "08/10"}`}
                                </div>
                                <div className="mt-1 font-mono text-sm font-semibold text-foreground dark:text-zinc-50">
                                  {formatBRL(item.dealValue)}
                                </div>
                                <div className="mt-1 text-[10px] text-muted-foreground dark:text-zinc-400">
                                  {item.stageName || "Leads Recebidos (Faltam 90d p/ maturar)"}
                                </div>
                              </div>

                              <div className="flex items-center gap-2">
                                {isDone ? (
                                  <>
                                    <span className="rounded-[4px] bg-muted dark:bg-zinc-800/80 border border-border dark:border-zinc-700 px-2 py-1 text-[10px] font-bold text-foreground dark:text-zinc-300 flex items-center gap-1">
                                      {item.evidenceChannel === "whatsapp" ? (
                                        <>
                                          <MessageSquare size={12} className="text-emerald-400" />
                                          <span>WhatsApp</span>
                                        </>
                                      ) : item.evidenceChannel === "call" ? (
                                        <>
                                          <Phone size={12} className="text-emerald-400" />
                                          <span>Ligação</span>
                                        </>
                                      ) : item.evidenceChannel === "email" ? (
                                        <>
                                          <Mail size={12} className="text-emerald-400" />
                                          <span>E-mail</span>
                                        </>
                                      ) : (
                                        <>
                                          <Check size={12} className="text-emerald-400" />
                                          <span>Concluído</span>
                                        </>
                                      )}
                                    </span>
                                    <motion.button
                                      whileHover={{ scale: 1.05, y: -1 }}
                                      whileTap={{ scale: 0.95 }}
                                      onClick={() => openDeal(item.dealId)}
                                      className="flex items-center gap-1.5 border border-border bg-card px-3 py-1.5 text-xs font-bold text-foreground hover:border-primary hover:text-primary cursor-pointer rounded-[4px] dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-rose-400 dark:hover:text-zinc-50 shadow-sm"
                                    >
                                      <ExternalLink size={13} />
                                      CRM
                                    </motion.button>
                                  </>
                                ) : (
                                  <>
                                    <motion.button
                                      whileHover={{ scale: 1.06, y: -1 }}
                                      whileTap={{ scale: 0.95 }}
                                      transition={{ duration: 0.15 }}
                                      onClick={() => setSelectedDirective(item)}
                                      className="flex items-center gap-1.5 border border-emerald-600 bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500 cursor-pointer rounded-[4px] shadow-sm transition-all"
                                    >
                                      <Check size={14} strokeWidth={2.5} />
                                      Concluir
                                    </motion.button>
                                    <motion.button
                                      whileHover={{ scale: 1.06, y: -1 }}
                                      whileTap={{ scale: 0.95 }}
                                      transition={{ duration: 0.15 }}
                                      onClick={() => openDeal(item.dealId)}
                                      className="flex items-center gap-1.5 border border-border bg-card px-3 py-1.5 text-xs font-bold text-foreground hover:border-primary hover:text-primary cursor-pointer rounded-[4px] dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-rose-400 dark:hover:text-zinc-50 transition-all shadow-sm"
                                    >
                                      <ExternalLink size={13} />
                                      Abrir CRM
                                    </motion.button>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                        </motion.article>
                      );
                    })
                  ) : (
                    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
                      <div className="flex h-12 w-12 items-center justify-center border border-border bg-muted/60 text-muted-foreground rounded-[4px] dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400">
                        <CheckCircle2 size={24} />
                      </div>
                      <h3 className="mt-4 font-mono text-lg font-semibold text-foreground dark:text-zinc-100">
                        {filter === "Concluídas"
                          ? "Nenhuma diretriz concluída hoje"
                          : "Nenhuma diretriz pendente"}
                      </h3>
                      <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground dark:text-zinc-400">
                        {filter === "Concluídas"
                          ? "Assim que você concluir responsabilidades comerciais com evidência, elas aparecerão aqui."
                          : "A Gestão Comercial ainda não encaminhou diretrizes táticas para sua carteira hoje. Suas oportunidades em andamento continuam sincronizadas no CRM."}
                      </p>
                      <motion.button
                        whileHover={{ scale: 1.04, y: -1 }}
                        whileTap={{ scale: 0.96 }}
                        onClick={openCrm}
                        className="mt-4 flex items-center gap-2 bg-primary px-3.5 py-2 text-xs font-bold text-primary-foreground hover:opacity-90 cursor-pointer rounded-[4px] shadow-sm"
                      >
                        <ExternalLink size={13} />
                        Acessar Minhas Oportunidades no CRM
                      </motion.button>
                    </div>
                  )}
                </div>
              </motion.section>
            </div>

            {/* COLUNA DIREITA: CALENDÁRIO COMERCIAL DO VENDEDOR & DOSSIÊ DO DIA */}
            <div className="space-y-4">
              {/* CARD 1: CALENDÁRIO COMERCIAL INTERATIVO COM HOVER EM TODOS OS DIAS */}
              <motion.section
                initial={{ opacity: 0, x: 18 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.4, delay: 0.15, ease: "easeOut" }}
                whileHover={{ y: -2, transition: { duration: 0.2 } }}
                className="group border border-border/80 bg-card p-4 sm:p-5 dark:border-zinc-800 dark:bg-zinc-950/70 rounded-[4px] shadow-sm hover:shadow-lg hover:border-primary/40 transition-all duration-300"
              >
                <div className="flex items-center justify-between border-b border-border/80 pb-3 dark:border-zinc-800">
                  <div>
                    <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.18em] text-primary">
                      <Calendar size={13} className="group-hover:scale-115 transition-transform" />
                      Calendário Comercial
                    </div>
                    <h3 className="mt-1 font-mono text-lg font-semibold text-foreground dark:text-zinc-100">
                      {monthNameFormatted}
                    </h3>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] uppercase tracking-[.12em] text-muted-foreground dark:text-zinc-500">
                      Dias Úteis
                    </div>
                    <div className="font-mono text-xs font-semibold text-foreground dark:text-zinc-300">
                      {elapsedDays} / {businessDays} decorridos
                    </div>
                  </div>
                </div>

                {/* Dias da semana */}
                <div className="mt-3 grid grid-cols-7 gap-1 text-center font-mono text-[10px] font-bold uppercase tracking-wider text-muted-foreground dark:text-zinc-500 pb-1">
                  <span>Dom</span>
                  <span>Seg</span>
                  <span>Ter</span>
                  <span>Qua</span>
                  <span>Qui</span>
                  <span>Sex</span>
                  <span>Sáb</span>
                </div>

                {/* Grade dos Dias do Mês */}
                <div className="grid grid-cols-7 gap-1">
                  {Array.from({ length: calendarData.firstDayWeekIndex }).map((_, i) => (
                    <div
                      key={`empty-${i}`}
                      className="h-12 border border-border/30 bg-muted/20 dark:border-zinc-900/30 dark:bg-zinc-950/30 rounded-[2px]"
                    />
                  ))}
                  {calendarData.days.map((d) => {
                    const isSelected = d.dateStr === (selectedCalendarDate || data?.today);
                    const isHoliday = !!d.holiday;
                    return (
                      <motion.button
                        key={d.dateStr}
                        whileHover={{ scale: 1.14, zIndex: 30, y: -2 }}
                        whileTap={{ scale: 0.94 }}
                        transition={{ type: "spring", stiffness: 450, damping: 20 }}
                        onClick={() => setSelectedCalendarDate(d.dateStr)}
                        className={`group/day relative flex flex-col justify-between p-1.5 h-12 text-left border rounded-[2px] transition-colors cursor-pointer ${
                          isSelected
                            ? "border-primary bg-primary/10 ring-1 ring-primary dark:border-rose-500 dark:bg-rose-950/40 dark:ring-rose-500 shadow-sm"
                            : d.isToday
                              ? "border-foreground/40 bg-muted/80 dark:border-zinc-500 dark:bg-zinc-900/70"
                              : isHoliday
                                ? "border-amber-300 bg-amber-50/60 dark:border-amber-700/60 dark:bg-amber-950/20"
                                : d.isWeekend
                                  ? "border-border/40 bg-muted/20 opacity-40 dark:border-zinc-900/60 dark:bg-zinc-950/40"
                                  : "border-border/70 bg-card hover:border-primary/60 hover:bg-muted/30 dark:border-zinc-800/80 dark:bg-zinc-950/80 dark:hover:border-zinc-600 dark:hover:bg-zinc-900/40"
                        }`}
                      >
                        <div className="flex items-center justify-between w-full">
                          <span
                            className={`font-mono text-[11px] font-semibold ${
                              isSelected
                                ? "text-primary font-bold dark:text-rose-400"
                                : isHoliday
                                  ? "text-amber-600 font-bold dark:text-amber-400"
                                  : d.isToday
                                    ? "text-foreground font-bold dark:text-zinc-100"
                                    : "text-muted-foreground dark:text-zinc-400"
                            }`}
                          >
                            {d.dayNumber}
                          </span>
                          {d.isToday ? (
                            <span className="size-1.5 rounded-full bg-primary" title="Hoje" />
                          ) : isHoliday ? (
                            <span
                              className="size-1.5 rounded-full bg-amber-500"
                              title={d.holiday?.description || "Feriado"}
                            />
                          ) : null}
                        </div>

                        <div className="mt-auto flex items-center justify-between w-full gap-1">
                          {d.deals.length > 0 ? (
                            <span className="inline-flex items-center px-1 rounded-[1px] text-[9px] font-mono font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-400 dark:border-emerald-800/60 group-hover/day:scale-110 transition-transform">
                              +{d.deals.length}
                            </span>
                          ) : isHoliday ? (
                            <span
                              className="truncate text-[8px] font-mono font-bold uppercase tracking-wider text-amber-700 bg-amber-100 border border-amber-300 px-0.5 rounded-[1px] dark:text-amber-300/90 dark:bg-amber-950/60 dark:border-amber-800/50"
                              title={d.holiday?.description}
                            >
                              Feriado
                            </span>
                          ) : null}
                        </div>
                      </motion.button>
                    );
                  })}
                </div>

                {/* Legenda do Calendário */}
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border/80 pt-2 text-[10px] text-muted-foreground dark:text-zinc-500 font-mono dark:border-zinc-800/80">
                  <div className="flex items-center gap-1.5">
                    <span className="size-2 rounded-full bg-primary inline-block" />
                    <span>Hoje</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="size-2 rounded-[1px] bg-emerald-500 inline-block" />
                    <span>Venda fechada</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="size-2 rounded-[1px] bg-amber-500 inline-block" />
                    <span>Feriado</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="size-2 rounded-[1px] border border-primary inline-block" />
                    <span>Selecionado</span>
                  </div>
                </div>
              </motion.section>

              {/* CARD 2: DOSSIÊ DO DIA SELECIONADO */}
              <motion.section
                initial={{ opacity: 0, x: 18 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.4, delay: 0.25, ease: "easeOut" }}
                whileHover={{ y: -2, transition: { duration: 0.2 } }}
                className="group border border-border/80 bg-card p-4 sm:p-5 dark:border-zinc-800 dark:bg-zinc-950/70 rounded-[4px] shadow-sm hover:shadow-lg hover:border-primary/40 transition-all duration-300"
              >
                <div className="flex items-start justify-between border-b border-border/80 pb-3 dark:border-zinc-800">
                  <div>
                    <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.18em] text-muted-foreground dark:text-zinc-400">
                      <CalendarDays size={13} className="text-primary group-hover:scale-115 transition-transform" />
                      Dossiê do Dia
                      {selectedDayInfo?.holiday && (
                        <span className="ml-1 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[.12em] bg-amber-100 text-amber-800 border border-amber-300 rounded-[2px] dark:bg-amber-950/70 dark:text-amber-300 dark:border-amber-800/70">
                          Feriado
                        </span>
                      )}
                    </div>
                    <h3 className="mt-1 font-mono text-base font-semibold text-foreground dark:text-zinc-100 capitalize">
                      {selectedDayFormatted}
                    </h3>
                    {selectedDayInfo?.holiday && (
                      <p className="mt-1 text-xs text-amber-700 dark:text-amber-300/90 font-medium">
                        {selectedDayInfo.holiday.description} — descontado do cálculo de metas e
                        dias úteis.
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] uppercase tracking-[.12em] text-muted-foreground dark:text-zinc-500">
                      Vendido no Dia
                    </div>
                    <div className="font-mono text-sm font-bold text-emerald-500 dark:text-emerald-400">
                      {formatBRL(selectedDayInfo?.totalSold || 0)}
                    </div>
                  </div>
                </div>

                {/* Lista de Vendas do Dia Selecionado */}
                <div className="mt-4">
                  {selectedDayInfo && selectedDayInfo.deals.length > 0 ? (
                    <div className="space-y-2.5">
                      {selectedDayInfo.deals.map((deal) => (
                        <motion.div
                          key={deal.id}
                          whileHover={{ x: 4, scale: 1.01 }}
                          whileTap={{ scale: 0.99 }}
                          transition={{ duration: 0.15 }}
                          className="border border-border/80 bg-muted/30 p-3 hover:border-primary/50 transition-all rounded-[4px] dark:border-zinc-800 dark:bg-zinc-900/60 dark:hover:border-zinc-700 shadow-sm"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="font-semibold text-xs text-foreground dark:text-zinc-200">
                                {deal.title}
                              </div>
                              <div className="mt-0.5 text-[10px] text-muted-foreground dark:text-zinc-400">
                                Venda Concluída
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <div className="font-mono text-xs font-bold text-emerald-500 dark:text-emerald-400">
                                {formatBRL(deal.value)}
                              </div>
                            </div>
                          </div>
                          <div className="mt-2.5 flex items-center justify-between border-t border-border/60 pt-2 dark:border-zinc-800/80">
                            <span className="text-[9px] font-mono text-muted-foreground dark:text-zinc-500">
                              {deal.closedAt
                                ? new Date(deal.closedAt).toLocaleTimeString("pt-BR", {
                                    timeZone: "America/Sao_Paulo",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })
                                : ""}
                            </span>
                            <motion.button
                              whileHover={{ x: 2 }}
                              whileTap={{ scale: 0.95 }}
                              onClick={() => openDeal(deal.id)}
                              className="inline-flex items-center gap-1 text-[10px] font-bold text-primary hover:underline cursor-pointer"
                            >
                              Abrir no CRM <ExternalLink size={10} />
                            </motion.button>
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  ) : selectedDayInfo?.holiday ? (
                    <div className="py-6 text-center">
                      <CalendarDays size={22} className="mx-auto text-amber-500 mb-2" />
                      <p className="text-xs text-amber-700 dark:text-amber-300 font-semibold">
                        Feriado: {selectedDayInfo.holiday.description}
                      </p>
                      <p className="text-[11px] text-muted-foreground dark:text-zinc-500 mt-1">
                        Dia sem expediente comercial obrigatório. Descontado do ritmo de metas.
                      </p>
                    </div>
                  ) : (
                    <div className="py-6 text-center">
                      <Clock3 size={22} className="mx-auto text-muted-foreground/60 dark:text-zinc-600 mb-2" />
                      <p className="text-xs text-muted-foreground dark:text-zinc-400 font-medium">
                        Nenhum fechamento registrado nesta data.
                      </p>
                      <p className="text-[11px] text-muted-foreground/80 dark:text-zinc-500 mt-1">
                        Clique nos dias marcados em verde no calendário para inspecionar as vendas
                        ganhas.
                      </p>
                    </div>
                  )}
                </div>

                {/* CARD 3: RESUMO CONSOLIDADO DO MÊS */}
                <div className="mt-5 border-t border-border/80 pt-4 dark:border-zinc-800">
                  <div className="text-[10px] font-bold uppercase tracking-[.16em] text-muted-foreground dark:text-zinc-400 mb-3">
                    Resumo do Mês
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <motion.div
                      whileHover={{ y: -2, scale: 1.02 }}
                      transition={{ duration: 0.15 }}
                      className="border border-border/80 bg-muted/30 p-2.5 rounded-[4px] dark:border-zinc-800/80 dark:bg-zinc-900/40 hover:border-primary/40 transition-colors shadow-sm cursor-default"
                    >
                      <div className="text-[9px] uppercase tracking-[.12em] text-muted-foreground dark:text-zinc-500">
                        Vendas no Mês
                      </div>
                      <div className="mt-1 font-mono text-base font-bold text-foreground dark:text-zinc-100">
                        {wonDealsCountFormatted}
                      </div>
                    </motion.div>
                    <motion.div
                      whileHover={{ y: -2, scale: 1.02 }}
                      transition={{ duration: 0.15 }}
                      className="border border-border/80 bg-muted/30 p-2.5 rounded-[4px] dark:border-zinc-800/80 dark:bg-zinc-900/40 hover:border-emerald-500/40 transition-colors shadow-sm cursor-default"
                    >
                      <div className="text-[9px] uppercase tracking-[.12em] text-muted-foreground dark:text-zinc-500">
                        Ticket Médio
                      </div>
                      <div className="mt-1 font-mono text-xs font-bold text-emerald-500 dark:text-emerald-400 truncate">
                        {formatBRL(ticketMedio)}
                      </div>
                    </motion.div>
                  </div>
                </div>
              </motion.section>
            </div>
          </div>
        ) : null}
      </div>

      {/* MODAL DE EVIDÊNCIA AO CONCLUIR DIRETRIZ */}
      {selectedDirective && (
        <CommercialEvidenceDialog
          directive={{
            id: selectedDirective.id,
            dealId: selectedDirective.dealId,
            dealTitle: selectedDirective.dealTitle,
            dealValue: selectedDirective.dealValue,
            stageName: selectedDirective.stageName,
            instruction: selectedDirective.instruction,
            priority: selectedDirective.priority,
          }}
          onClose={() => setSelectedDirective(null)}
          onOpenDeal={() => {
            const dealId = selectedDirective.dealId;
            setSelectedDirective(null);
            void openDeal(dealId);
          }}
          onCompleted={() => {
            setSelectedDirective(null);
            void load();
          }}
        />
      )}

      {/* MODAL DE AGENDA COMPLETA DO DIA COM FRAMER-MOTION */}
      <AnimatePresence>
        {isAgendaModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.2 }}
              className="w-full max-w-lg rounded-[4px] border border-border bg-card p-6 shadow-xl dark:border-zinc-800 dark:bg-zinc-950"
            >
              <div className="flex items-center justify-between border-b border-border pb-4 dark:border-zinc-800">
                <div className="flex items-center gap-2">
                  <CalendarDays size={16} className="text-primary" />
                  <h3 className="font-mono text-lg font-bold text-foreground dark:text-zinc-50">
                    Agenda de Hoje · {data?.activities.length || 0} compromisso(s)
                  </h3>
                </div>
                <motion.button
                  whileHover={{ scale: 1.1, rotate: 90 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={() => setIsAgendaModalOpen(false)}
                  className="text-muted-foreground hover:text-foreground p-1 dark:text-zinc-400 dark:hover:text-zinc-50 cursor-pointer"
                >
                  <X size={18} />
                </motion.button>
              </div>

              <div className="mt-4 max-h-[60vh] space-y-3 overflow-y-auto pr-1">
                {data?.activities && data.activities.length > 0 ? (
                  data.activities.map((act) => {
                    const timeStr = act.dueDate
                      ? new Date(act.dueDate).toLocaleTimeString("pt-BR", {
                          timeZone: "America/Sao_Paulo",
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "—";
                    return (
                      <motion.div
                        key={act.id}
                        whileHover={{ x: 4, scale: 1.01 }}
                        transition={{ duration: 0.15 }}
                        className="flex items-center justify-between gap-3 border border-border/80 bg-muted/30 p-3 rounded-[4px] dark:border-zinc-800 dark:bg-zinc-900/50 shadow-sm"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="w-12 font-mono text-xs font-bold text-emerald-500 dark:text-emerald-400">
                            {timeStr}
                          </span>
                          <div className="min-w-0 border-l border-border pl-3 dark:border-zinc-700">
                            <strong className="block truncate text-xs text-foreground dark:text-zinc-200">
                              {act.title}
                            </strong>
                            <span className="block truncate text-[11px] text-muted-foreground dark:text-zinc-400">
                              {act.dealTitle}
                            </span>
                          </div>
                        </div>
                        <motion.button
                          whileHover={{ scale: 1.08 }}
                          whileTap={{ scale: 0.95 }}
                          onClick={() => {
                            setIsAgendaModalOpen(false);
                            openDeal(act.dealId);
                          }}
                          className="shrink-0 flex items-center gap-1 text-[11px] font-bold text-primary hover:underline cursor-pointer"
                        >
                          Abrir <ArrowUpRight size={12} />
                        </motion.button>
                      </motion.div>
                    );
                  })
                ) : (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    Nenhum compromisso agendado para hoje.
                  </p>
                )}
              </div>

              <div className="mt-6 flex justify-end border-t border-border pt-4 dark:border-zinc-800">
                <motion.button
                  whileHover={{ scale: 1.04 }}
                  whileTap={{ scale: 0.96 }}
                  onClick={() => setIsAgendaModalOpen(false)}
                  className="border border-border bg-card px-4 py-2 text-xs font-bold text-foreground hover:bg-muted dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 rounded-[4px] cursor-pointer"
                >
                  Fechar
                </motion.button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </section>
  );
}
