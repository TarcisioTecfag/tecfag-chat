// ══════════════════════════════════════════════════════════════════════════════
// SUPERVISOR TAB — Central Executiva de Supervisão IA (SLA, Capacidade & Dúvidas)
// 100% Harmonizado com o Design System (Paleta Oficial, SystemTooltip, Popover)
// Inclui: Filtro por Usuário/Consultor, Período Customizado sem input nativo,
// Resumo de Alertas por Operador, Timeline Interativa e Perguntas Recentes.
// ══════════════════════════════════════════════════════════════════════════════

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bell,
  MessageSquare,
  AlertTriangle,
  ArrowRight,
  Clock,
  Eye,
  BarChart2,
  Send as SendIcon,
  Zap,
  Users,
  User,
  Loader2,
  Inbox,
  MessageCircleQuestion,
  Filter,
  Calendar,
  CalendarRange,
  ExternalLink,
  Star,
  X,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Repeat2,
  Check,
  Search,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import { useChat } from "@/hooks/useChatState";
import { getAiPersona } from "@/lib/ai-persona";
import { SystemTooltip } from "@/components/ui/tooltip";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import {
  cleanPlainNotificationText,
  renderFormattedNotificationText,
} from "@/lib/format-notification-text";

// ── Tipos ───────────────────────────────────────────────────────────────────

interface Notification {
  id: string;
  type: string;
  title: string;
  description: string;
  operatorName: string;
  operatorAvatar?: string | null;
  operatorId: string | null;
  timestamp: string;
  priority: string;
  conversationId: string | null;
  contactName: string | null;
  waitMinutes?: number | null;
  repeatCount?: number;
  lastFiredAt?: string;
}

interface RecentQuestion {
  id: string;
  question: string;
  operatorId: string;
  operatorName: string;
  operatorAvatar: string | null;
  timestamp: string;
}

interface SupervisorOperatorItem {
  id: string;
  name: string;
  avatar: string | null;
  role: string;
  status?: string;
  sectorTag?: string | null;
}

interface SupervisorApiData {
  kpis: {
    notificationsSent: number;
    questionsAnswered: number;
    slaAlerts: number;
    leadsTransferred: number;
  };
  notifications: Notification[];
  recentQuestions: RecentQuestion[];
  operators?: SupervisorOperatorItem[];
}

// ── Constantes Harmonizadas com a Paleta do Sistema ──────────────────────────

const ALERT_TYPES = [
  { value: "all", label: "Todos" },
  { value: "sla_alert", label: "SLA em Risco" },
  { value: "no_response", label: "Sem Resposta" },
  { value: "operator_overload", label: "Sobrecarga" },
  { value: "lead_transfer", label: "Leads Transferidos" },
  { value: "sentiment_alert", label: "Sentimento" },
  { value: "rating_received", label: "Avaliações" },
  { value: "daily_summary", label: "Resumo Diário" },
] as const;

type QuickPeriod = "today" | "yesterday" | "7d" | "30d" | "custom";

const QUICK_PERIODS: { value: QuickPeriod; label: string }[] = [
  { value: "today", label: "Hoje" },
  { value: "yesterday", label: "Ontem" },
  { value: "7d", label: "7 dias" },
  { value: "30d", label: "30 dias" },
];

const MONTH_NAMES_PT = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];
const WEEK_DAYS_PT = ["D", "S", "T", "Q", "Q", "S", "S"];

// ── Helpers ──────────────────────────────────────────────────────────────────

function toLocalYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatYmdShort(ymd: string): string {
  if (!ymd) return "";
  const parts = ymd.split("-");
  if (parts.length !== 3) return ymd;
  return `${parts[2]}/${parts[1]}`;
}

function formatYmdFull(ymd: string): string {
  if (!ymd) return "—";
  const parts = ymd.split("-");
  if (parts.length !== 3) return ymd;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function buildMonthGrid(viewDate: Date) {
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const totalDays = new Date(year, month + 1, 0).getDate();
  const startDay = new Date(year, month, 1).getDay();

  const cells: Array<{ day: number | null; ymd: string | null }> = [];
  for (let i = 0; i < startDay; i++) {
    cells.push({ day: null, ymd: null });
  }
  for (let d = 1; d <= totalDays; d++) {
    const mStr = String(month + 1).padStart(2, "0");
    const dStr = String(d).padStart(2, "0");
    cells.push({ day: d, ymd: `${year}-${mStr}-${dStr}` });
  }
  return cells;
}

function getDateRange(
  period: QuickPeriod,
  customFrom?: string,
  customTo?: string,
): { from: Date; to: Date } {
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);

  switch (period) {
    case "today":
      return { from: startOfToday, to: endOfToday };
    case "yesterday": {
      const y = new Date(startOfToday);
      y.setDate(y.getDate() - 1);
      const ye = new Date(y);
      ye.setHours(23, 59, 59, 999);
      return { from: y, to: ye };
    }
    case "7d":
      return { from: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), to: now };
    case "30d":
      return { from: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), to: now };
    case "custom":
      return {
        from: customFrom
          ? new Date(customFrom + "T00:00:00")
          : new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
        to: customTo ? new Date(customTo + "T23:59:59") : now,
      };
  }
}

function formatRelativeTime(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "agora";
  if (mins < 60) return `${mins}min atrás`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h atrás`;
  return `${Math.floor(hrs / 24)}d atrás`;
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

// ── Avatar Harmonizado do Operador ───────────────────────────────────────────

function SupervisorOperatorAvatar({
  name,
  avatar,
  size = "h-6 w-6",
  textSize = "text-[9px]",
}: {
  name: string;
  avatar?: string | null;
  size?: string;
  textSize?: string;
}) {
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setImgError(false);
  }, [avatar]);

  if (avatar && avatar.trim() !== "" && !imgError) {
    return (
      <img
        src={avatar}
        alt={name}
        onError={() => setImgError(true)}
        className={`${size} rounded-full object-cover shrink-0 border border-border shadow-2xs`}
      />
    );
  }

  return (
    <div
      className={`${size} ${textSize} rounded-full grid place-items-center font-extrabold shrink-0 bg-primary-soft text-primary border border-primary/25`}
    >
      {getInitials(name)}
    </div>
  );
}

// ── Ícone e Estilo Harmonizado de Notificação ────────────────────────────────

function getNotifVisual(type: string, priority: string) {
  switch (type) {
    case "sla_alert":
    case "no_response":
      return {
        icon: AlertTriangle,
        label: type === "no_response" ? "SLA +24h" : "SLA",
        boxClass:
          priority === "high"
            ? "bg-primary/15 text-primary border border-primary/35"
            : "bg-amber-500/12 text-amber-600 dark:text-amber-400 border border-amber-500/25",
        badgeClass:
          priority === "high"
            ? "bg-primary/15 text-primary border-primary/30"
            : "bg-amber-500/12 text-amber-600 dark:text-amber-400 border-amber-500/25",
      };
    case "operator_overload":
      return {
        icon: Users,
        label: "Sobrecarga",
        boxClass: "bg-primary-soft text-primary border border-primary/25",
        badgeClass: "bg-primary-soft text-primary border-primary/25",
      };
    case "lead_transfer":
      return {
        icon: ArrowRight,
        label: "Transferência",
        boxClass: "bg-primary-soft text-primary border border-primary/25",
        badgeClass: "bg-primary-soft text-primary border-primary/25",
      };
    case "sentiment_alert":
      return {
        icon: Zap,
        label: "Sentimento",
        boxClass: "bg-primary/15 text-primary border border-primary/30",
        badgeClass: "bg-primary/15 text-primary border-primary/30",
      };
    case "rating_received":
      return {
        icon: Star,
        label: "Avaliação",
        boxClass: "bg-muted text-foreground border border-border",
        badgeClass: "bg-muted text-foreground border-border",
      };
    case "daily_summary":
      return {
        icon: BarChart2,
        label: "Resumo",
        boxClass: "bg-muted text-muted-foreground border border-border",
        badgeClass: "bg-muted text-muted-foreground border-border",
      };
    default:
      return {
        icon: Bell,
        label: "Notificação",
        boxClass: "bg-muted text-muted-foreground border border-border",
        badgeClass: "bg-muted text-muted-foreground border-border",
      };
  }
}

function PriorityDot({ priority }: { priority: string }) {
  const c =
    priority === "high"
      ? "bg-primary animate-pulse"
      : priority === "medium"
      ? "bg-amber-500"
      : "bg-muted-foreground/40";
  return <span className={`inline-block h-2 w-2 rounded-full shrink-0 ${c}`} />;
}

// ── Card de KPI Harmonizado com o Design System ──────────────────────────────

function KpiCard({
  icon: Icon,
  label,
  sub,
  value,
  loading,
  active,
  highlightWarning,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  sub: string;
  value: string | number;
  loading?: boolean;
  active?: boolean;
  highlightWarning?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative bg-card rounded-2xl border p-4 flex items-center gap-3.5 text-left w-full transition-all shadow-soft overflow-hidden ${
        active
          ? "border-primary bg-primary-soft/30 ring-1 ring-primary/25"
          : onClick
          ? "border-border hover:border-primary/35 hover:bg-muted/20 cursor-pointer"
          : "border-border cursor-default"
      }`}
    >
      <div
        className={`absolute top-0 left-0 right-0 h-0.5 ${
          active || highlightWarning ? "bg-primary" : "bg-border/60"
        }`}
      />
      <div
        className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl border transition-colors ${
          active
            ? "bg-primary text-primary-foreground border-primary shadow-xs"
            : highlightWarning && Number(value) > 0
            ? "bg-primary/15 text-primary border-primary/30"
            : "bg-primary-soft text-primary border-primary/20"
        }`}
      >
        <Icon className="h-4.5 w-4.5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] text-muted-foreground font-extrabold uppercase tracking-wider truncate">
          {label}
        </p>
        {loading ? (
          <div className="h-6 w-12 bg-muted rounded animate-pulse mt-1" />
        ) : (
          <div className="flex items-baseline gap-2 mt-0.5">
            <p className={`text-xl font-black tracking-tight ${active ? "text-primary" : "text-foreground"}`}>
              {value}
            </p>
            <span className="text-[10px] text-muted-foreground truncate">{sub}</span>
          </div>
        )}
      </div>
      {active && onClick && (
        <div className="ml-auto shrink-0">
          <X className="h-3.5 w-3.5 text-primary opacity-75" />
        </div>
      )}
    </button>
  );
}

// ── Seletor de Operador/Consultor (Padrão Executivo de Referência) ───────────

function OperatorFilterPopover({
  operators,
  selectedOperatorId,
  onSelectOperator,
}: {
  operators: SupervisorOperatorItem[];
  selectedOperatorId: string;
  onSelectOperator: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const selectedOp = useMemo(
    () => operators.find((op) => op.id === selectedOperatorId) || null,
    [operators, selectedOperatorId]
  );

  const filteredOps = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return operators;
    return operators.filter(
      (op) =>
        op.name.toLowerCase().includes(q) ||
        (op.sectorTag && op.sectorTag.toLowerCase().includes(q))
    );
  }, [operators, search]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <SystemTooltip content="Filtrar supervisão por usuário / consultor">
        <PopoverTrigger asChild>
          <button
            type="button"
            className={`h-9 px-3 rounded-xl border text-xs font-extrabold transition flex items-center gap-2 cursor-pointer shadow-2xs min-w-[195px] justify-between ${
              selectedOperatorId !== "all"
                ? "bg-primary-soft/60 border-primary/40 text-foreground"
                : "bg-card border-border text-foreground hover:border-primary/30"
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              {selectedOp ? (
                <SupervisorOperatorAvatar
                  name={selectedOp.name}
                  avatar={selectedOp.avatar}
                  size="h-5 w-5"
                  textSize="text-[8px]"
                />
              ) : (
                <User className="h-3.5 w-3.5 text-primary shrink-0" />
              )}
              <span className="truncate max-w-[135px]">
                {selectedOp ? selectedOp.name : "Todos os Usuários"}
              </span>
            </div>
            <ChevronDown
              className={`h-3.5 w-3.5 text-muted-foreground transition-transform duration-150 shrink-0 ${
                open ? "rotate-180" : ""
              }`}
            />
          </button>
        </PopoverTrigger>
      </SystemTooltip>

      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-64 p-2 rounded-2xl border border-border bg-popover text-popover-foreground shadow-2xl"
      >
        {/* Busca rápida quando há muitos operadores */}
        {operators.length > 5 && (
          <div className="relative mb-2">
            <Search className="h-3 w-3 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar usuário..."
              className="w-full pl-7 pr-2.5 py-1.5 rounded-xl text-[11px] bg-muted/50 border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
            />
          </div>
        )}

        {/* Opção "Todos os Usuários" destacada na paleta do sistema */}
        <button
          type="button"
          onClick={() => {
            onSelectOperator("all");
            setOpen(false);
          }}
          className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-extrabold transition cursor-pointer mb-1 ${
            selectedOperatorId === "all"
              ? "bg-primary text-primary-foreground shadow-xs"
              : "text-foreground hover:bg-muted"
          }`}
        >
          <span>Todos os Usuários</span>
          {selectedOperatorId === "all" && <Check className="h-3.5 w-3.5 shrink-0" />}
        </button>

        {/* Lista de Operadores com Avatar e Tag */}
        <div className="max-h-64 overflow-y-auto space-y-0.5 pr-0.5 scrollbar-thin">
          {filteredOps.map((op) => {
            const isSelected = selectedOperatorId === op.id;
            return (
              <button
                key={op.id}
                type="button"
                onClick={() => {
                  onSelectOperator(op.id);
                  setOpen(false);
                }}
                className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
                  isSelected
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "text-foreground hover:bg-muted/70"
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <SupervisorOperatorAvatar
                    name={op.name}
                    avatar={op.avatar}
                    size="h-6 w-6"
                    textSize="text-[9px]"
                  />
                  <span className="truncate text-left">{op.name}</span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {op.sectorTag && (
                    <span
                      className={`px-1.5 py-0.5 rounded text-[9px] font-extrabold uppercase tracking-wider ${
                        isSelected
                          ? "bg-white/20 text-white"
                          : "bg-muted text-muted-foreground border border-border/80"
                      }`}
                    >
                      {op.sectorTag}
                    </span>
                  )}
                  {isSelected && <Check className="h-3.5 w-3.5 shrink-0" />}
                </div>
              </button>
            );
          })}

          {filteredOps.length === 0 && (
            <p className="text-[11px] text-muted-foreground text-center py-4 italic">
              Nenhum usuário encontrado
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ── Popover de Período Customizado (Sem Input Nativo) ────────────────────────

function SupervisorDateRangePopover({
  isActive,
  dateFrom,
  dateTo,
  onApplyRange,
  onClear,
}: {
  isActive: boolean;
  dateFrom: string;
  dateTo: string;
  onApplyRange: (from: string, to: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const todayYmd = toLocalYmd(new Date());
  const [draftFrom, setDraftFrom] = useState(dateFrom || "");
  const [draftTo, setDraftTo] = useState(dateTo || "");
  const [selectingStep, setSelectingStep] = useState<"from" | "to">("from");
  const [viewMonth, setViewMonth] = useState<Date>(() => {
    const base = dateTo || dateFrom;
    if (base) {
      const [y, m] = base.split("-").map(Number);
      if (y && m) return new Date(y, m - 1, 1);
    }
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  useEffect(() => {
    if (open) {
      setDraftFrom(dateFrom || "");
      setDraftTo(dateTo || "");
      setSelectingStep("from");
    }
  }, [open, dateFrom, dateTo]);

  const cells = buildMonthGrid(viewMonth);

  const handleDayClick = (ymd: string) => {
    if (selectingStep === "from" || !draftFrom || (draftFrom && draftTo)) {
      setDraftFrom(ymd);
      setDraftTo("");
      setSelectingStep("to");
    } else {
      if (ymd < draftFrom) {
        setDraftTo(draftFrom);
        setDraftFrom(ymd);
      } else {
        setDraftTo(ymd);
      }
      setSelectingStep("from");
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <SystemTooltip
        content={
          isActive && dateFrom && dateTo
            ? `Período: ${formatYmdFull(dateFrom)} até ${formatYmdFull(dateTo)}`
            : "Escolher período personalizado"
        }
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition flex items-center gap-1.5 cursor-pointer ${
              isActive
                ? "bg-primary text-primary-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <CalendarRange className="h-3.5 w-3.5" />
            <span>
              {isActive && dateFrom && dateTo
                ? `${formatYmdShort(dateFrom)} - ${formatYmdShort(dateTo)}`
                : "Período"}
            </span>
          </button>
        </PopoverTrigger>
      </SystemTooltip>

      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-80 p-3.5 rounded-2xl border border-border bg-popover text-popover-foreground shadow-2xl"
      >
        <div className="flex items-center justify-between pb-2.5 mb-2.5 border-b border-border/70">
          <div className="flex items-center gap-1.5">
            <div className="h-6 w-6 rounded-lg bg-primary-soft text-primary flex items-center justify-center">
              <CalendarRange size={12} />
            </div>
            <div>
              <p className="text-[11px] font-extrabold text-foreground leading-none">
                Período Personalizado
              </p>
              <p className="text-[9px] text-muted-foreground mt-0.5">
                Selecione início e fim para filtrar a supervisão
              </p>
            </div>
          </div>
          {(isActive || draftFrom || draftTo) && (
            <button
              type="button"
              onClick={() => {
                setDraftFrom("");
                setDraftTo("");
                onClear();
                setOpen(false);
              }}
              className="text-[10px] font-bold text-muted-foreground hover:text-primary px-1.5 py-0.5 rounded-md hover:bg-muted transition cursor-pointer"
            >
              Limpar
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2 mb-2.5">
          <button
            type="button"
            onClick={() => setSelectingStep("from")}
            className={`p-2 rounded-xl border text-left transition cursor-pointer ${
              selectingStep === "from"
                ? "border-primary bg-primary-soft/40"
                : "border-border bg-muted/30"
            }`}
          >
            <span className="block text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
              Data Inicial
            </span>
            <span className="text-[11px] font-extrabold text-foreground">
              {draftFrom ? formatYmdFull(draftFrom) : "Selecionar..."}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setSelectingStep("to")}
            className={`p-2 rounded-xl border text-left transition cursor-pointer ${
              selectingStep === "to"
                ? "border-primary bg-primary-soft/40"
                : "border-border bg-muted/30"
            }`}
          >
            <span className="block text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
              Data Final
            </span>
            <span className="text-[11px] font-extrabold text-foreground">
              {draftTo ? formatYmdFull(draftTo) : "Selecionar..."}
            </span>
          </button>
        </div>

        <div className="flex items-center justify-between mb-2 px-1">
          <button
            type="button"
            onClick={() =>
              setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1))
            }
            className="h-6 w-6 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition cursor-pointer"
          >
            <ChevronLeft size={14} />
          </button>
          <span className="text-[11px] font-extrabold text-foreground">
            {MONTH_NAMES_PT[viewMonth.getMonth()]} {viewMonth.getFullYear()}
          </span>
          <button
            type="button"
            onClick={() =>
              setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1))
            }
            className="h-6 w-6 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition cursor-pointer"
          >
            <ChevronRight size={14} />
          </button>
        </div>

        <div className="grid grid-cols-7 gap-0.5 text-center mb-1">
          {WEEK_DAYS_PT.map((w, i) => (
            <span key={i} className="text-[9px] font-extrabold text-muted-foreground py-0.5">
              {w}
            </span>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-0.5">
          {cells.map((cell, idx) => {
            if (!cell.day || !cell.ymd) {
              return <div key={`empty-${idx}`} className="h-7" />;
            }
            const isFuture = cell.ymd > todayYmd;
            const isStart = draftFrom === cell.ymd;
            const isEnd = draftTo === cell.ymd;
            const isInRange =
              Boolean(draftFrom && draftTo) && cell.ymd > draftFrom && cell.ymd < draftTo;

            return (
              <button
                key={cell.ymd}
                type="button"
                disabled={isFuture}
                onClick={() => handleDayClick(cell.ymd!)}
                className={`h-7 w-full rounded-lg text-[10px] font-bold transition flex items-center justify-center ${
                  isFuture
                    ? "text-muted-foreground/30 cursor-not-allowed"
                    : isStart || isEnd
                    ? "bg-primary text-primary-foreground font-extrabold shadow-xs cursor-pointer"
                    : isInRange
                    ? "bg-primary/15 text-primary font-bold cursor-pointer"
                    : "text-foreground hover:bg-muted cursor-pointer"
                }`}
              >
                {cell.day}
              </button>
            );
          })}
        </div>

        <div className="mt-3 pt-2.5 border-t border-border/70 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="px-2.5 py-1.5 rounded-xl text-[10px] font-bold text-muted-foreground hover:text-foreground hover:bg-muted transition cursor-pointer"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={!draftFrom || !draftTo}
            onClick={() => {
              if (!draftFrom || !draftTo) return;
              onApplyRange(draftFrom, draftTo);
              setOpen(false);
            }}
            className="px-3.5 py-1.5 rounded-xl bg-primary text-primary-foreground text-[10px] font-extrabold hover:bg-primary-hover transition cursor-pointer disabled:opacity-40 shadow-xs"
          >
            Aplicar Período
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ── Componente Principal ─────────────────────────────────────────────────────

export function SupervisorTab() {
  const { setSelectedChatId, setActiveView, tenant, operators: globalOperators } = useChat();
  const persona = getAiPersona(tenant || "valem");

  const [data, setData] = useState<SupervisorApiData | null>(null);
  const [loading, setLoading] = useState(true);

  // Filtros
  const [period, setPeriod] = useState<QuickPeriod>("7d");
  const [customFrom, setCustomFrom] = useState<string>("");
  const [customTo, setCustomTo] = useState<string>("");
  const [activeType, setActiveType] = useState<string>("all");
  const [selectedOperatorId, setSelectedOperatorId] = useState<string>("all");

  // IDs de notificações com accordion aberto
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const toggleExpand = (id: string) =>
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const { from, to } = useMemo(
    () => getDateRange(period, customFrom, customTo),
    [period, customFrom, customTo]
  );

  const fetchData = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const params = new URLSearchParams({
          dateFrom: from.toISOString(),
          dateTo: to.toISOString(),
        });
        if (activeType !== "all") params.set("types", activeType);
        if (selectedOperatorId !== "all") params.set("operatorId", selectedOperatorId);

        const res = await fetch(`/api/valentina/supervisor?${params}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        setData(json);
      } catch (err: any) {
        console.error("[SupervisorTab] Erro:", err);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [from, to, activeType, selectedOperatorId]
  );

  useEffect(() => {
    fetchData(false);
    const iv = setInterval(() => fetchData(true), 30_000);
    return () => clearInterval(iv);
  }, [fetchData]);

  const kpis = data?.kpis || {
    notificationsSent: 0,
    questionsAnswered: 0,
    slaAlerts: 0,
    leadsTransferred: 0,
  };
  const notifications = data?.notifications || [];
  const recentQuestions = data?.recentQuestions || [];

  // Lista de operadores (API + fallback do contexto global)
  const operatorOptions: SupervisorOperatorItem[] = useMemo(() => {
    if (Array.isArray(data?.operators) && data.operators.length > 0) {
      return data.operators;
    }
    return (globalOperators || [])
      .filter((op: any) => !String(op.id).startsWith("bot-"))
      .map((op: any) => ({
        id: op.id,
        name: op.name,
        avatar: op.avatar || null,
        role: op.role || "operator",
        sectorTag: op.role === "admin" ? "ADM" : null,
      }));
  }, [data?.operators, globalOperators]);

  // Ranking rápido de alertas por operador no período
  const operatorAlertSummary = useMemo(() => {
    const counts = new Map<
      string,
      { id: string; name: string; avatar: string | null; total: number; slaCount: number }
    >();
    for (const n of notifications) {
      const key = n.operatorId || n.operatorName || "unknown";
      const current = counts.get(key) || {
        id: n.operatorId || key,
        name: n.operatorName || "Operador",
        avatar: n.operatorAvatar || null,
        total: 0,
        slaCount: 0,
      };
      current.total += 1;
      if (n.type === "sla_alert" || n.type === "no_response") {
        current.slaCount += 1;
      }
      counts.set(key, current);
    }
    return Array.from(counts.values())
      .sort((a, b) => b.slaCount - a.slaCount || b.total - a.total)
      .slice(0, 5);
  }, [notifications]);

  const handleOpenConversation = (conversationId: string) => {
    setSelectedChatId(conversationId);
    setActiveView("chat");
  };

  return (
    <div className="flex flex-col gap-4 h-full overflow-y-auto pr-0.5 scrollbar-thin">
      {/* ── BARRA EXECUTIVA SUPERIOR (FILTRO POR USUÁRIO + PERÍODO) ────────── */}
      <div className="bg-card rounded-2xl border border-border px-4 py-3 shadow-soft flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-9 w-9 rounded-xl bg-primary-soft text-primary border border-primary/20 grid place-items-center shrink-0">
            <ShieldAlert className="h-4.5 w-4.5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-extrabold text-foreground truncate">
                Supervisão Operacional · {persona.name}
              </h2>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-extrabold bg-primary-soft text-primary border border-primary/25">
                <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                Monitoramento SLA Ativo
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground truncate mt-0.5">
              Acompanhamento de tempo de resposta (8m / 15m / 24h), sobrecarga de carteira e dúvidas da equipe
            </p>
          </div>
        </div>

        {/* Controles Direitos: Filtro de Usuário + Período + Refresh */}
        <div className="flex items-center gap-2 flex-wrap justify-end shrink-0">
          {/* Filtro por Usuário / Consultor */}
          <OperatorFilterPopover
            operators={operatorOptions}
            selectedOperatorId={selectedOperatorId}
            onSelectOperator={setSelectedOperatorId}
          />

          {/* Seletor de Período Rápido + Custom Popover */}
          <div className="flex items-center gap-0.5 bg-muted/60 rounded-xl p-1 border border-border">
            {QUICK_PERIODS.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => setPeriod(p.value)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                  period === p.value
                    ? "bg-card text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {p.label}
              </button>
            ))}

            <SupervisorDateRangePopover
              isActive={period === "custom"}
              dateFrom={customFrom}
              dateTo={customTo}
              onApplyRange={(fromYmd, toYmd) => {
                setCustomFrom(fromYmd);
                setCustomTo(toYmd);
                setPeriod("custom");
              }}
              onClear={() => {
                setCustomFrom("");
                setCustomTo("");
                setPeriod("7d");
              }}
            />
          </div>

          <SystemTooltip content="Atualizar dados de supervisão">
            <button
              type="button"
              onClick={() => fetchData(false)}
              className="h-9 w-9 rounded-xl bg-card border border-border text-muted-foreground hover:text-foreground hover:border-primary/30 grid place-items-center transition cursor-pointer shadow-2xs"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin text-primary" : ""}`} />
            </button>
          </SystemTooltip>
        </div>
      </div>

      {/* ── KPI CARDS HARMONIZADOS COM A PALETA DO SISTEMA ──────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 shrink-0">
        <KpiCard
          icon={Bell}
          label="Notificações Emitidas"
          sub="no período selecionado"
          value={kpis.notificationsSent}
          loading={loading}
          active={activeType === "all" && false}
          onClick={() => setActiveType("all")}
        />
        <KpiCard
          icon={MessageSquare}
          label="Dúvidas Respondidas"
          sub={`pelo chat ${persona.name}`}
          value={kpis.questionsAnswered}
          loading={loading}
        />
        <KpiCard
          icon={AlertTriangle}
          label="Alertas de SLA"
          sub="atrasos > 8m / 15m / 24h"
          value={kpis.slaAlerts}
          loading={loading}
          highlightWarning
          active={activeType === "sla_alert"}
          onClick={() => setActiveType((prev) => (prev === "sla_alert" ? "all" : "sla_alert"))}
        />
        <KpiCard
          icon={SendIcon}
          label="Leads Transferidos"
          sub="alocados via rodízio"
          value={kpis.leadsTransferred}
          loading={loading}
          active={activeType === "lead_transfer"}
          onClick={() =>
            setActiveType((prev) => (prev === "lead_transfer" ? "all" : "lead_transfer"))
          }
        />
      </div>

      {/* ── CONTEÚDO PRINCIPAL: TIMELINE (62%) + PAINEL LATERAL (38%) ──────── */}
      <div className="flex flex-col lg:flex-row gap-4 flex-1 min-h-0">
        {/* Coluna Esquerda: Timeline de Atividade (62%) */}
        <div className="w-full lg:w-[62%] flex flex-col bg-card rounded-2xl border border-border shadow-soft overflow-hidden min-h-[380px]">
          {/* Header da Timeline + Chips de Tipo */}
          <div className="px-4 py-3 border-b border-line shrink-0 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-extrabold text-foreground flex items-center gap-2">
                <Eye className="h-3.5 w-3.5 text-primary" />
                Timeline de Supervisão
                {selectedOperatorId !== "all" && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-primary-soft text-primary text-[10px] font-bold border border-primary/20">
                    Filtrado por usuário
                    <button
                      type="button"
                      onClick={() => setSelectedOperatorId("all")}
                      className="hover:text-foreground cursor-pointer"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </span>
                )}
              </h3>
              <span className="text-[10px] text-muted-foreground font-semibold">
                {notifications.length} registro{notifications.length !== 1 ? "s" : ""}
              </span>
            </div>

            {/* Pílulas de Filtro de Tipo Harmonizadas */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <Filter className="h-3 w-3 text-muted-foreground shrink-0 mr-0.5" />
              {ALERT_TYPES.map((t) => {
                const isSelected = activeType === t.value;
                return (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setActiveType(t.value)}
                    className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border transition cursor-pointer ${
                      isSelected
                        ? "bg-primary text-primary-foreground border-primary shadow-2xs"
                        : "bg-muted/40 border-border text-muted-foreground hover:text-foreground hover:border-primary/30"
                    }`}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Lista da Timeline */}
          <div className="flex-1 overflow-y-auto px-4 py-3 scrollbar-thin">
            {loading ? (
              <div className="flex items-center justify-center py-14">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                <span className="ml-2 text-xs text-muted-foreground">
                  Carregando eventos de supervisão...
                </span>
              </div>
            ) : notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-14 text-muted-foreground text-center px-4">
                <div className="h-11 w-11 rounded-2xl bg-muted/60 border border-border grid place-items-center mb-2.5">
                  <Inbox className="h-5 w-5 opacity-50" />
                </div>
                <p className="text-xs font-extrabold text-foreground">
                  Nenhuma ocorrência registrada neste filtro
                </p>
                <p className="text-[11px] text-muted-foreground mt-1 max-w-sm">
                  Quando houver alertas de SLA, sobrecarga de atendimento ou transferências para o
                  usuário/período selecionado, eles aparecerão aqui em tempo real.
                </p>
              </div>
            ) : (
              <div className="relative">
                <div className="absolute left-[13px] top-3 bottom-3 w-px bg-border" />
                <div className="space-y-2">
                  {notifications.map((notif, idx) => {
                    const { icon: NotifIcon, label, boxClass, badgeClass } = getNotifVisual(
                      notif.type,
                      notif.priority
                    );
                    const isSla = notif.type === "sla_alert" || notif.type === "no_response";
                    const isGrouped = (notif.repeatCount ?? 1) > 1;
                    const isExpanded = expandedIds.has(notif.id);

                    return (
                      <motion.div
                        key={notif.id}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.16, delay: Math.min(idx * 0.02, 0.25) }}
                        className="flex gap-3 p-2.5 rounded-xl border border-transparent hover:border-border hover:bg-muted/20 transition relative"
                      >
                        {/* Ícone */}
                        <div
                          className={`grid h-7 w-7 shrink-0 place-items-center rounded-xl ${boxClass} z-10 relative`}
                        >
                          <NotifIcon className="h-3.5 w-3.5" />
                          {isGrouped && (
                            <span className="absolute -top-1.5 -right-1.5 min-w-[15px] h-[15px] px-0.5 rounded-full bg-primary text-primary-foreground text-[8px] font-extrabold flex items-center justify-center leading-none shadow-2xs">
                              {notif.repeatCount}
                            </span>
                          )}
                        </div>

                        {/* Conteúdo */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                            <PriorityDot priority={notif.priority} />
                            <span
                              className={`px-1.5 py-0.2 rounded text-[9px] font-extrabold uppercase tracking-wider border ${badgeClass}`}
                            >
                              {label}
                            </span>
                            <span className="text-xs font-extrabold text-foreground truncate flex-1">
                              {cleanPlainNotificationText(notif.title)}
                            </span>

                            {/* Badge de agrupamento */}
                            {isGrouped && (
                              <SystemTooltip
                                content={
                                  isExpanded
                                    ? "Recolher detalhes de agrupamento"
                                    : `${notif.repeatCount} disparos agrupados — clique para detalhes`
                                }
                              >
                                <button
                                  type="button"
                                  onClick={() => toggleExpand(notif.id)}
                                  className="shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-lg bg-primary-soft hover:bg-primary/20 text-primary border border-primary/25 text-[9px] font-extrabold transition cursor-pointer"
                                >
                                  <Repeat2 className="h-2.5 w-2.5" />
                                  ×{notif.repeatCount}
                                  {isExpanded ? (
                                    <ChevronUp className="h-2.5 w-2.5" />
                                  ) : (
                                    <ChevronDown className="h-2.5 w-2.5" />
                                  )}
                                </button>
                              </SystemTooltip>
                            )}

                            {/* Botão "Abrir Conversa" */}
                            {notif.conversationId && (
                              <SystemTooltip content="Abrir esta conversa diretamente no módulo de Chat">
                                <button
                                  type="button"
                                  onClick={() => handleOpenConversation(notif.conversationId!)}
                                  className="shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-lg bg-card hover:bg-primary hover:text-primary-foreground text-primary border border-primary/30 text-[9px] font-extrabold transition cursor-pointer shadow-2xs"
                                >
                                  <ExternalLink className="h-2.5 w-2.5" />
                                  Abrir Chat
                                </button>
                              </SystemTooltip>
                            )}
                          </div>

                          <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-2">
                            {renderFormattedNotificationText(notif.description, {
                              stripEmojis: true,
                              stripRedundantPrefix: isSla,
                            })}
                          </p>

                          {/* Rodapé do Item: Operador + Horário + Cliente */}
                          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                            <button
                              type="button"
                              onClick={() => {
                                if (notif.operatorId) {
                                  setSelectedOperatorId((prev) =>
                                    prev === notif.operatorId ? "all" : notif.operatorId!
                                  );
                                }
                              }}
                              className="inline-flex items-center gap-1.5 text-[10px] font-bold text-foreground hover:text-primary transition cursor-pointer"
                            >
                              <SupervisorOperatorAvatar
                                name={notif.operatorName}
                                avatar={notif.operatorAvatar}
                                size="h-4 w-4"
                                textSize="text-[7px]"
                              />
                              <span>{notif.operatorName}</span>
                            </button>

                            <span className="text-[9px] text-muted-foreground/50">·</span>

                            {isGrouped ? (
                              <>
                                <SystemTooltip content={`Primeiro disparo: ${formatDateTime(notif.timestamp)}`}>
                                  <span className="text-[9px] text-muted-foreground cursor-default">
                                    início: {formatRelativeTime(notif.timestamp)}
                                  </span>
                                </SystemTooltip>
                                <span className="text-[9px] text-muted-foreground/50">·</span>
                                <SystemTooltip
                                  content={`Último disparo: ${formatDateTime(
                                    notif.lastFiredAt ?? notif.timestamp
                                  )}`}
                                >
                                  <span className="text-[9px] text-primary font-bold cursor-default">
                                    última: {formatRelativeTime(notif.lastFiredAt ?? notif.timestamp)}
                                  </span>
                                </SystemTooltip>
                              </>
                            ) : (
                              <SystemTooltip content={formatDateTime(notif.timestamp)}>
                                <span className="text-[9px] text-muted-foreground cursor-default">
                                  {formatRelativeTime(notif.timestamp)}
                                </span>
                              </SystemTooltip>
                            )}

                            {notif.contactName && (
                              <>
                                <span className="text-[9px] text-muted-foreground/50">·</span>
                                <span className="text-[9px] text-muted-foreground font-medium">
                                  Cliente: <strong className="text-foreground">{notif.contactName}</strong>
                                </span>
                              </>
                            )}
                          </div>

                          {/* Accordion — histórico de ocorrências agrupadas */}
                          <AnimatePresence>
                            {isGrouped && isExpanded && (
                              <motion.div
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: "auto" }}
                                exit={{ opacity: 0, height: 0 }}
                                className="mt-2 overflow-hidden"
                              >
                                <div className="rounded-xl border border-primary/20 bg-primary-soft/30 px-3 py-2 space-y-1">
                                  <p className="text-[9px] text-primary font-extrabold uppercase tracking-wider mb-1 flex items-center gap-1">
                                    <Repeat2 className="h-2.5 w-2.5" />
                                    {notif.repeatCount} disparos agrupados (janela de 4h)
                                  </p>
                                  <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                                    <span>Primeiro alerta registrado</span>
                                    <span className="font-bold text-foreground">
                                      {formatDateTime(notif.timestamp)}
                                    </span>
                                  </div>
                                  <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                                    <span>Última atualização</span>
                                    <span className="font-bold text-primary">
                                      {formatDateTime(notif.lastFiredAt ?? notif.timestamp)}
                                    </span>
                                  </div>
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Coluna Direita: Resumo por Operador + Perguntas Recentes (38%) */}
        <div className="w-full lg:w-[38%] flex flex-col gap-4 min-h-0">
          {/* Card 1: Concentração de Alertas por Operador (Clicável para filtrar) */}
          {operatorAlertSummary.length > 0 && (
            <div className="bg-card rounded-2xl border border-border shadow-soft p-3.5 shrink-0">
              <div className="flex items-center justify-between mb-2.5">
                <h3 className="text-xs font-extrabold text-foreground flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5 text-primary" />
                  Alertas por Operador
                </h3>
                <span className="text-[9px] text-muted-foreground">Clique para filtrar</span>
              </div>
              <div className="space-y-1.5">
                {operatorAlertSummary.map((item) => {
                  const isSelected = selectedOperatorId === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() =>
                        setSelectedOperatorId((prev) => (prev === item.id ? "all" : item.id))
                      }
                      className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl border text-left transition cursor-pointer ${
                        isSelected
                          ? "bg-primary-soft border-primary/35 text-foreground"
                          : "bg-muted/25 border-border/70 hover:bg-muted/50 text-foreground"
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <SupervisorOperatorAvatar
                          name={item.name}
                          avatar={item.avatar}
                          size="h-6 w-6"
                          textSize="text-[9px]"
                        />
                        <span className="text-[11px] font-bold truncate">{item.name}</span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {item.slaCount > 0 && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-extrabold bg-primary/15 text-primary border border-primary/25">
                            {item.slaCount} SLA
                          </span>
                        )}
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-muted text-muted-foreground border border-border">
                          {item.total} total
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Card 2: Perguntas Recentes feitas pelos Operadores à IA */}
          <div className="flex-1 flex flex-col bg-card rounded-2xl border border-border shadow-soft overflow-hidden min-h-[240px]">
            <div className="px-4 py-3 border-b border-line shrink-0">
              <h3 className="text-xs font-extrabold text-foreground flex items-center gap-2">
                <MessageCircleQuestion className="h-3.5 w-3.5 text-primary" />
                Perguntas Recentes da Equipe
              </h3>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Consultas feitas {persona.gender === "female" ? "à" : "ao"} {persona.name} pelos operadores
              </p>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2 scrollbar-thin">
              {loading ? (
                <div className="space-y-2.5">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="rounded-xl border border-border p-3 flex gap-3">
                      <div className="h-7 w-7 rounded-full bg-muted animate-pulse shrink-0" />
                      <div className="flex-1">
                        <div className="h-3 bg-muted rounded w-3/4 mb-2 animate-pulse" />
                        <div className="h-2 bg-muted rounded w-1/2 animate-pulse" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : recentQuestions.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-muted-foreground text-center px-4">
                  <MessageCircleQuestion className="h-6 w-6 mb-2 opacity-40" />
                  <p className="text-xs font-bold text-foreground">Nenhuma pergunta no período</p>
                  <p className="text-[10px] mt-1">
                    As dúvidas enviadas pelos operadores no chat {persona.gender === "female" ? "da" : "do"}{" "}
                    {persona.name} aparecerão listadas aqui.
                  </p>
                </div>
              ) : (
                recentQuestions.map((q, idx) => (
                  <motion.div
                    key={q.id}
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.14, delay: Math.min(idx * 0.03, 0.25) }}
                    className="rounded-xl border border-border p-3 hover:border-primary/30 hover:bg-muted/20 transition-colors"
                  >
                    <div className="flex items-start gap-2.5">
                      <SupervisorOperatorAvatar
                        name={q.operatorName}
                        avatar={q.operatorAvatar}
                        size="h-7 w-7"
                        textSize="text-[10px]"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1 gap-2">
                          <span className="text-[11px] font-extrabold text-foreground truncate">
                            {q.operatorName}
                          </span>
                          <SystemTooltip content={formatDateTime(q.timestamp)}>
                            <span className="text-[9px] text-muted-foreground shrink-0 cursor-default">
                              {formatRelativeTime(q.timestamp)}
                            </span>
                          </SystemTooltip>
                        </div>
                        <p className="text-[11px] text-muted-foreground leading-snug line-clamp-3">
                          {q.question}
                        </p>
                      </div>
                    </div>
                  </motion.div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
