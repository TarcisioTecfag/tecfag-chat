import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Award,
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  Gem,
  Info,
  Loader2,
  Plus,
  RefreshCw,
  Settings,
  Sparkles,
  Target,
  Trash2,
  TrendingUp,
  User,
  Users,
  X,
} from "lucide-react";
import { motion } from "framer-motion";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  ReferenceLine,
  ReferenceDot,
} from "recharts";
import { useNavigate } from "@tanstack/react-router";
import { useChat } from "@/hooks/useChatState";
import { SystemTooltip } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { saoPauloDay } from "@/lib/commercial/metrics";
import { getDeterministicConsultantAvatar } from "@/lib/commercial/avatar-matcher";
import { cn } from "@/lib/utils";

export type CalendarDeal = {
  id: string;
  title: string;
  value: number;
  operatorId: string | null;
  operatorName: string;
  operatorAvatar: string | null;
  division: string | null;
  rdDealId: string | null;
  rdDealUrl: string | null;
};

export type CalendarClosing = {
  date: string;
  count: number;
  value: number;
  deals: CalendarDeal[];
};

export type CalendarHolidayDay = {
  id: string;
  date: string;
  type: "holiday" | "bridge" | "extra_work" | "suspension";
  description: string;
  affectsGoal: boolean;
};

export type ConsultantItem = {
  operatorId: string;
  name: string;
  email: string;
  avatar: string | null;
  division: string | null;
  activeOnTv: boolean;
};

export type GoalItem = {
  id: string;
  operatorId: string;
  targetValue: string | number;
  conversionRate: string | number;
};

export type CalendarApiResponse = {
  month: string;
  today: string;
  days: CalendarHolidayDay[];
  closings: CalendarClosing[];
  goals: GoalItem[];
  consultants: ConsultantItem[];
  summary: {
    totalTarget: number;
    totalRealized: number;
    gap: number;
    attainment: number;
    businessDays: number;
    elapsedDays: number;
    remainingDays: number;
    dailyRequired: number;
    linearDailyTarget: number;
    runRate: number;
    bestDay: {
      day: number;
      date: string;
      value: number;
      count: number;
    };
  };
};

const MONTH_NAMES = [
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

const MONTH_SHORT = [
  "Jan",
  "Fev",
  "Mar",
  "Abr",
  "Mai",
  "Jun",
  "Jul",
  "Ago",
  "Set",
  "Out",
  "Nov",
  "Dez",
];

const WEEKDAY_NAMES = [
  "Domingo",
  "Segunda-Feira",
  "Terça-Feira",
  "Quarta-Feira",
  "Quinta-Feira",
  "Sexta-Feira",
  "Sábado",
];

function formatMonthLabel(monthStr: string): string {
  const [year, m] = monthStr.split("-").map(Number);
  if (!year || !m) return monthStr;
  return `${MONTH_NAMES[m - 1]} De ${year}`;
}

function formatDateFull(dateStr: string): string {
  if (!dateStr || !dateStr.includes("-")) return dateStr;
  const [year, m, d] = dateStr.split("-").map(Number);
  const dateObj = new Date(Date.UTC(year, m - 1, d, 12, 0, 0));
  const weekday = WEEKDAY_NAMES[dateObj.getUTCDay()] || "";
  const monthName = MONTH_NAMES[m - 1] || "";
  return `${weekday}, ${String(d).padStart(2, "0")} De ${monthName} De ${year}`;
}

function formatCurrency(val: number, withCents = false): string {
  if (!Number.isFinite(val)) return "R$ 0,00";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: withCents ? 2 : 0,
    maximumFractionDigits: withCents ? 2 : 0,
  }).format(val);
}

function formatCurrencyCompact(val: number): string {
  if (!Number.isFinite(val) || val === 0) return "R$ 0";
  const abs = Math.abs(val);
  const sign = val < 0 ? "-" : "";

  if (abs >= 1_000_000) {
    const formatted = (abs / 1_000_000).toFixed(2).replace(".", ",");
    return `${sign}R$ ${formatted}M`;
  }
  if (abs >= 1_000) {
    const formatted = (abs / 1_000).toFixed(1).replace(".", ",");
    return `${sign}R$ ${formatted}k`;
  }
  return `${sign}R$ ${abs.toLocaleString("pt-BR")}`;
}

function stepMonth(current: string, delta: number): string {
  const [year, m] = current.split("-").map(Number);
  const d = new Date(Date.UTC(year, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function CommercialCalendarView({
  initialMonth,
}: {
  initialMonth?: string;
}) {
  const navigate = useNavigate();
  const { tenant } = useChat();
  const todayStr = saoPauloDay();

  const [month, setMonth] = useState(() => initialMonth || todayStr.slice(0, 7));
  const [selectedDate, setSelectedDate] = useState(() => {
    if (initialMonth && initialMonth === todayStr.slice(0, 7)) return todayStr;
    return initialMonth ? `${initialMonth}-01` : todayStr;
  });

  const [selectedTeam, setSelectedTeam] = useState<"all" | "personnalite" | "maquinas">("all");
  const [selectedConsultantId, setSelectedConsultantId] = useState<string>("all");

  const [data, setData] = useState<CalendarApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Modais e Popovers
  const [monthPickerOpen, setMonthPickerOpen] = useState(false);
  const [pickerYear, setPickerYear] = useState(() => Number(month.split("-")[0]) || 2026);
  const [consultantPopoverOpen, setConsultantPopoverOpen] = useState(false);
  const [addHolidayOpen, setAddHolidayOpen] = useState(false);
  const [manageHolidaysOpen, setManageHolidaysOpen] = useState(false);

  // Formulário de feriado
  const [holidayForm, setHolidayForm] = useState({
    date: todayStr,
    type: "holiday" as "holiday" | "bridge" | "extra_work" | "suspension",
    description: "",
    affectsGoal: true,
  });
  const [savingHoliday, setSavingHoliday] = useState(false);

  const loadCalendar = useCallback(
    async (targetMonth: string, isManualSync = false) => {
      if (isManualSync) setSyncing(true);
      else setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/commercial/calendar?month=${encodeURIComponent(targetMonth)}`, {
          credentials: "same-origin",
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Falha ao carregar calendário comercial.");
        setData(json);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Erro ao carregar dados do calendário.");
      } finally {
        setLoading(false);
        setSyncing(false);
      }
    },
    [],
  );

  useEffect(() => {
    void loadCalendar(month);
    setPickerYear(Number(month.split("-")[0]) || 2026);
  }, [month, loadCalendar]);

  // Se trocar de mês, ajusta a data selecionada para manter consistência
  useEffect(() => {
    if (!selectedDate.startsWith(month)) {
      if (month === todayStr.slice(0, 7)) {
        setSelectedDate(todayStr);
      } else {
        setSelectedDate(`${month}-01`);
      }
    }
  }, [month, selectedDate, todayStr]);

  const handleMonthStep = (delta: number) => {
    const next = stepMonth(month, delta);
    setMonth(next);
  };

  const handleSelectMonth = (mIndex: number) => {
    const next = `${pickerYear}-${String(mIndex + 1).padStart(2, "0")}`;
    setMonth(next);
    setMonthPickerOpen(false);
  };

  const handleGoCurrentMonth = () => {
    const curr = todayStr.slice(0, 7);
    setMonth(curr);
    setPickerYear(Number(curr.split("-")[0]));
    setSelectedDate(todayStr);
    setMonthPickerOpen(false);
  };

  // Salvar novo feriado / ajuste
  const handleSaveHoliday = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!holidayForm.description.trim()) return;
    setSavingHoliday(true);
    try {
      const res = await fetch("/api/commercial/calendar", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(holidayForm),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Erro ao salvar feriado.");
      setAddHolidayOpen(false);
      setHolidayForm({
        date: todayStr,
        type: "holiday",
        description: "",
        affectsGoal: true,
      });
      await loadCalendar(month, true);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erro ao salvar feriado.");
    } finally {
      setSavingHoliday(false);
    }
  };

  // Remover feriado
  const handleRemoveHoliday = async (date: string) => {
    try {
      const res = await fetch(`/api/commercial/calendar?date=${encodeURIComponent(date)}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Erro ao remover feriado.");
      await loadCalendar(month, true);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erro ao remover feriado.");
    }
  };

  // Filtragem Reativa de Dados com base no Escopo (Equipe e Consultor)
  const filteredData = useMemo(() => {
    if (!data) return null;

    const consultants = data.consultants || [];
    const goals = data.goals || [];
    const rawClosings = data.closings || [];
    const holidays = data.days || [];

    // 1. Filtrar consultores elegíveis pelo time selecionado
    const eligibleConsultants = consultants.filter((c) => {
      if (selectedTeam === "personnalite") return c.division?.toLowerCase() === "personnalite";
      if (selectedTeam === "maquinas") return c.division?.toLowerCase() === "maquinas";
      return true;
    });

    const eligibleOperatorIds = new Set(
      selectedConsultantId !== "all"
        ? [selectedConsultantId]
        : eligibleConsultants.map((c) => c.operatorId),
    );

    // 2. Metas filtradas
    const filteredGoals = goals.filter((g) => eligibleOperatorIds.has(g.operatorId));
    const totalTarget = filteredGoals.reduce((acc, g) => acc + Number(g.targetValue || 0), 0);

    // 3. Fechamentos filtrados por negócio
    const filteredClosings: CalendarClosing[] = [];
    let totalRealized = 0;
    const closingMap = new Map<string, CalendarClosing>();

    for (const closing of rawClosings) {
      const filteredDeals = closing.deals.filter((deal) => {
        if (!deal.operatorId) return selectedTeam === "all" && selectedConsultantId === "all";
        return eligibleOperatorIds.has(deal.operatorId);
      });

      if (filteredDeals.length > 0) {
        const sumVal = filteredDeals.reduce((acc, d) => acc + d.value, 0);
        const item: CalendarClosing = {
          date: closing.date,
          count: filteredDeals.length,
          value: sumVal,
          deals: filteredDeals,
        };
        filteredClosings.push(item);
        closingMap.set(closing.date, item);
        totalRealized += sumVal;
      }
    }

    // 4. Métricas de Pacing
    const businessDays = data.summary?.businessDays || 22;
    const elapsedDays = data.summary?.elapsedDays || 5;
    const remainingDays = Math.max(0, businessDays - elapsedDays);

    const gap = Math.max(0, totalTarget - totalRealized);
    const attainment = totalTarget > 0 ? (totalRealized / totalTarget) * 100 : 0;
    const dailyRequired = remainingDays > 0 ? gap / remainingDays : 0;
    const linearDailyTarget = businessDays > 0 ? totalTarget / businessDays : 0;
    const runRate = elapsedDays > 0 ? (totalRealized / elapsedDays) * businessDays : totalRealized;

    // 5. Melhor dia filtrado
    let bestDay = { day: 0, date: "", value: 0, count: 0 };
    for (const cl of filteredClosings) {
      if (cl.value > bestDay.value) {
        const dNum = Number(cl.date.split("-")[2]);
        bestDay = { day: dNum, date: cl.date, value: cl.value, count: cl.count };
      }
    }

    return {
      totalTarget,
      totalRealized,
      gap,
      attainment,
      businessDays,
      elapsedDays,
      remainingDays,
      dailyRequired,
      linearDailyTarget,
      runRate,
      bestDay,
      closings: filteredClosings,
      closingMap,
      holidays,
      consultants: eligibleConsultants,
    };
  }, [data, selectedTeam, selectedConsultantId]);

  // Dias do Calendário no Mês
  const calendarGrid = useMemo(() => {
    const [year, monthNum] = month.split("-").map(Number);
    const lastDayOfMonth = new Date(Date.UTC(year, monthNum, 0)).getUTCDate();
    const firstDayWeekday = new Date(Date.UTC(year, monthNum - 1, 1)).getUTCDay();
    // No layout brasileiro padrão, a semana começa na Segunda (SEG).
    // Domingo = 0 -> offset 6; Segunda = 1 -> offset 0
    const offsetMonday = (firstDayWeekday + 6) % 7;

    const holidayMap = new Map(
      (filteredData?.holidays || []).map((h) => [h.date, h]),
    );

    const days = [];
    for (let d = 1; d <= lastDayOfMonth; d++) {
      const dateStr = `${month}-${String(d).padStart(2, "0")}`;
      const weekday = new Date(Date.UTC(year, monthNum - 1, d)).getUTCDay();
      const isWeekend = weekday === 0 || weekday === 6;
      const holiday = holidayMap.get(dateStr);
      const isExtraWork = holiday?.type === "extra_work";
      const isWorkingDay = (!isWeekend || isExtraWork) && (!holiday || holiday.type === "extra_work");

      const closing = filteredData?.closingMap.get(dateStr);
      const isToday = dateStr === todayStr;
      const isPast = dateStr < todayStr;
      const isFuture = dateStr > todayStr;

      // Status do Badge
      let status: "HOJE" | "BATIDA" | "PARCIAL" | "ZERADO" | "ALVO" | "FERIADO" | null = null;
      if (isToday) {
        status = "HOJE";
      } else if (holiday && holiday.type === "holiday") {
        status = "FERIADO";
      } else if (isWorkingDay) {
        if (isPast) {
          if (closing && closing.value >= (filteredData?.linearDailyTarget || 1)) {
            status = "BATIDA";
          } else if (closing && closing.value > 0) {
            status = "PARCIAL";
          } else {
            status = "ZERADO";
          }
        } else if (isFuture) {
          status = "ALVO";
        }
      }

      days.push({
        dayNumber: d,
        date: dateStr,
        isWeekend,
        isWorkingDay,
        isToday,
        isPast,
        isFuture,
        holiday,
        closing,
        status,
      });
    }

    return {
      offset: offsetMonday,
      days,
    };
  }, [month, todayStr, filteredData]);

  // Detalhamento do Dia Selecionado
  const selectedDayInfo = useMemo(() => {
    const dayItem = calendarGrid.days.find((d) => d.date === selectedDate);
    const closing = filteredData?.closingMap.get(selectedDate);
    const dayValue = closing?.value || 0;
    const targetExpected = dayItem?.isWorkingDay
      ? filteredData?.linearDailyTarget || 0
      : 0;
    const attainment = targetExpected > 0 ? (dayValue / targetExpected) * 100 : 0;

    return {
      date: selectedDate,
      dayNumber: Number(selectedDate.split("-")[2]) || 1,
      isToday: selectedDate === todayStr,
      isWorkingDay: dayItem?.isWorkingDay ?? true,
      holiday: dayItem?.holiday,
      value: dayValue,
      targetExpected,
      attainment,
      deals: closing?.deals || [],
    };
  }, [selectedDate, calendarGrid, filteredData, todayStr]);

  // Dados para a Curva S (Evolução Acumulada de Metas & Fechamentos)
  const sCurveData = useMemo(() => {
    if (!filteredData) return [];

    const [year, monthNum] = month.split("-").map(Number);
    const lastDayOfMonth = new Date(Date.UTC(year, monthNum, 0)).getUTCDate();
    const isCurrentMonth = month === todayStr.slice(0, 7);
    const todayDayNum = isCurrentMonth ? Number(todayStr.split("-")[2]) : 999;

    let accumRealized = 0;
    let accumExpected = 0;
    const result = [];

    for (let d = 1; d <= lastDayOfMonth; d++) {
      const dateStr = `${month}-${String(d).padStart(2, "0")}`;
      const dayItem = calendarGrid.days.find((item) => item.date === dateStr);

      if (dayItem?.isWorkingDay) {
        accumExpected += filteredData.linearDailyTarget;
      }

      const closing = filteredData.closingMap.get(dateStr);
      if (closing) {
        accumRealized += closing.value;
      }

      // Se estamos no mês atual e o dia é futuro, realizado não plota
      const realizedPlot = isCurrentMonth && d > todayDayNum ? null : accumRealized;

      result.push({
        day: d,
        label: `Dia ${d}`,
        expected: Math.round(accumExpected),
        realized: realizedPlot !== null ? Math.round(realizedPlot) : null,
      });
    }

    return result;
  }, [filteredData, month, todayStr, calendarGrid]);

  const selectedConsultantObj = useMemo(() => {
    if (selectedConsultantId === "all") return null;
    return data?.consultants.find((c) => c.operatorId === selectedConsultantId) || null;
  }, [selectedConsultantId, data]);

  const currentTodayNumber = month === todayStr.slice(0, 7) ? Number(todayStr.split("-")[2]) : null;

  return (
    <div className="flex flex-col gap-5 p-1 pb-10">
      {/* ──────────────────────────────────────────────────────────── */}
      {/* 1. CABEÇALHO TÁTICO & NAVEGAÇÃO                            */}
      {/* ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <span className="text-[10px] font-mono font-bold uppercase tracking-[.18em] text-primary">
            CALENDÁRIO COMERCIAL & PACING
          </span>
          <h1 className="mt-0.5 font-mono text-xl sm:text-2xl font-bold tracking-[-.04em] text-foreground dark:text-zinc-50">
            Cockpit de Metas & Fechamentos Diários
          </h1>
          <p className="mt-1 text-xs text-muted-foreground dark:text-zinc-400">
            Monitore as vendas fechadas por dia, a expectativa de metas batidas e o ritmo necessário
            para os próximos dias.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 font-mono">
          {/* Seletor de Mês Estilizado */}
          <div className="flex items-center rounded-[4px] border border-border/80 dark:border-zinc-800 bg-card dark:bg-zinc-950/70 shadow-sm">
            <SystemTooltip content="Mês anterior">
              <button
                type="button"
                onClick={() => handleMonthStep(-1)}
                className="flex h-8 w-8 items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/40 dark:hover:bg-zinc-900 rounded-l-[4px] transition-colors cursor-pointer"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            </SystemTooltip>

            <Popover open={monthPickerOpen} onOpenChange={setMonthPickerOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="flex items-center gap-2 px-3 py-1.5 text-xs font-mono font-bold text-foreground hover:text-primary transition-colors cursor-pointer"
                >
                  <CalendarDays className="h-3.5 w-3.5 text-primary" />
                  <span>{formatMonthLabel(month)}</span>
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-3 bg-card dark:bg-zinc-950 border border-border/80 dark:border-zinc-800 rounded-[4px] shadow-xl font-mono" align="center">
                <div className="flex items-center justify-between pb-2 mb-2 border-b border-border/80 dark:border-zinc-800">
                  <button
                    type="button"
                    onClick={() => setPickerYear((y) => y - 1)}
                    className="p-1 rounded-[2px] hover:bg-muted dark:hover:bg-zinc-800 text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <span className="text-xs font-bold text-foreground dark:text-zinc-100">{pickerYear}</span>
                  <button
                    type="button"
                    onClick={() => setPickerYear((y) => y + 1)}
                    className="p-1 rounded-[2px] hover:bg-muted dark:hover:bg-zinc-800 text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {MONTH_SHORT.map((mName, idx) => {
                    const isSelected =
                      month === `${pickerYear}-${String(idx + 1).padStart(2, "0")}`;
                    return (
                      <button
                        key={mName}
                        type="button"
                        onClick={() => handleSelectMonth(idx)}
                        className={cn(
                          "py-1.5 rounded-[2px] text-xs font-mono font-bold transition-all cursor-pointer",
                          isSelected
                            ? "bg-primary text-primary-foreground shadow-sm"
                            : "hover:bg-muted dark:hover:bg-zinc-800 text-foreground dark:text-zinc-200",
                        )}
                      >
                        {mName}
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={handleGoCurrentMonth}
                  className="w-full mt-2.5 py-1.5 text-center text-[10px] font-mono font-bold uppercase tracking-wider text-primary hover:underline border-t border-border/80 dark:border-zinc-800 pt-2 cursor-pointer"
                >
                  Ir para o mês atual
                </button>
              </PopoverContent>
            </Popover>

            <SystemTooltip content="Próximo mês">
              <button
                type="button"
                onClick={() => handleMonthStep(1)}
                className="flex h-8 w-8 items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/40 dark:hover:bg-zinc-900 rounded-r-[4px] transition-colors cursor-pointer"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </SystemTooltip>
          </div>

          {/* Botão de Ver Feriados */}
          <button
            type="button"
            onClick={() => setManageHolidaysOpen(true)}
            className="flex items-center gap-1.5 rounded-[4px] border border-border/80 dark:border-zinc-800 bg-card dark:bg-zinc-950/70 px-3.5 py-1.5 text-xs font-mono font-bold text-foreground hover:bg-muted/40 dark:hover:bg-zinc-900 transition-colors shadow-sm cursor-pointer"
          >
            <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
            <span>Feriados ({filteredData?.holidays.length || 0})</span>
          </button>

          {/* Botão de Adicionar Feriado */}
          <button
            type="button"
            onClick={() => setAddHolidayOpen(true)}
            className="flex items-center gap-1.5 rounded-[4px] bg-primary px-3.5 py-1.5 text-xs font-mono font-bold text-primary-foreground shadow-sm hover:brightness-110 transition-all cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Adicionar feriado</span>
          </button>
        </div>
      </div>

      {/* ──────────────────────────────────────────────────────────── */}
      {/* 2. BARRA DE FILTRO & ESCOPO                                 */}
      {/* ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[4px] border border-border/80 bg-card dark:border-zinc-800 dark:bg-zinc-950/70 px-4 py-3 shadow-sm font-mono">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase tracking-[.14em] text-muted-foreground dark:text-zinc-400">
            <span className="h-2 w-2 rounded-[1px] bg-primary" />
            <span>FILTRAR ESCOPO</span>
            <SystemTooltip content="Filtre os dados por toda a empresa, equipe comercial ou consultor específico.">
              <Info className="h-3.5 w-3.5 text-muted-foreground/70 cursor-help" />
            </SystemTooltip>
          </div>

          <div className="h-4 w-px bg-border/80 dark:bg-zinc-800 mx-1 hidden sm:block" />

          {/* Pílulas de Times */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                setSelectedTeam("all");
                setSelectedConsultantId("all");
              }}
              className={cn(
                "flex items-center gap-1.5 rounded-[2px] px-3 py-1.5 text-xs font-mono font-bold transition-all cursor-pointer border shadow-sm",
                selectedTeam === "all" && selectedConsultantId === "all"
                  ? "bg-primary border-primary text-primary-foreground"
                  : "bg-muted/20 dark:bg-zinc-900 border-border/60 dark:border-zinc-800 text-muted-foreground hover:text-foreground dark:hover:text-zinc-100",
              )}
            >
              <Building2 className="h-3.5 w-3.5" />
              <span>{tenant === "valem" ? "Toda a Valem" : "Toda a Tecfag"}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setSelectedTeam("personnalite");
                setSelectedConsultantId("all");
              }}
              className={cn(
                "flex items-center gap-1.5 rounded-[2px] px-3 py-1.5 text-xs font-mono font-bold transition-all cursor-pointer border shadow-sm",
                selectedTeam === "personnalite"
                  ? "bg-primary border-primary text-primary-foreground"
                  : "bg-muted/20 dark:bg-zinc-900 border-border/60 dark:border-zinc-800 text-muted-foreground hover:text-foreground dark:hover:text-zinc-100",
              )}
            >
              <Gem className="h-3.5 w-3.5" />
              <span>Time Personnalité</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setSelectedTeam("maquinas");
                setSelectedConsultantId("all");
              }}
              className={cn(
                "flex items-center gap-1.5 rounded-[2px] px-3 py-1.5 text-xs font-mono font-bold transition-all cursor-pointer border shadow-sm",
                selectedTeam === "maquinas"
                  ? "bg-primary border-primary text-primary-foreground"
                  : "bg-muted/20 dark:bg-zinc-900 border-border/60 dark:border-zinc-800 text-muted-foreground hover:text-foreground dark:hover:text-zinc-100",
              )}
            >
              <Settings className="h-3.5 w-3.5" />
              <span>Time Máquinas</span>
            </button>
          </div>

          {/* Dropdown Customizado de Consultor */}
          <Popover open={consultantPopoverOpen} onOpenChange={setConsultantPopoverOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-2 rounded-[2px] border border-border/80 dark:border-zinc-800 bg-background dark:bg-zinc-900 px-3 py-1.5 text-xs font-mono font-bold text-foreground hover:bg-muted/40 dark:hover:bg-zinc-800 transition-colors cursor-pointer shadow-sm"
              >
                {selectedConsultantObj ? (
                  <img
                    src={selectedConsultantObj.avatar || getDeterministicConsultantAvatar(selectedConsultantObj.name)}
                    alt=""
                    className="h-4 w-4 rounded-full object-cover shrink-0 border border-primary/30"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).src = getDeterministicConsultantAvatar(selectedConsultantObj.name);
                    }}
                  />
                ) : (
                  <User className="h-3.5 w-3.5 text-primary" />
                )}
                <span className="max-w-[130px] truncate">
                  {selectedConsultantObj ? selectedConsultantObj.name : "Todos os Consultores"}
                </span>
                <ChevronDown className="h-3 w-3 text-muted-foreground" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-56 p-2 bg-card dark:bg-zinc-950 border border-border/80 dark:border-zinc-800 rounded-[4px] shadow-xl font-mono" align="start">
              <div className="space-y-1 max-h-60 overflow-y-auto">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedConsultantId("all");
                    setConsultantPopoverOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center justify-between rounded-[2px] px-2.5 py-1.5 text-xs font-mono font-bold transition-colors text-left cursor-pointer",
                    selectedConsultantId === "all"
                      ? "bg-primary text-primary-foreground"
                      : "text-foreground dark:text-zinc-200 hover:bg-muted dark:hover:bg-zinc-900",
                  )}
                >
                  <span>Todos os Consultores</span>
                  {selectedConsultantId === "all" && <Check className="h-3.5 w-3.5" />}
                </button>
                {data?.consultants.map((c) => {
                  const isSel = selectedConsultantId === c.operatorId;
                  const cAvatar = c.avatar || getDeterministicConsultantAvatar(c.name);
                  return (
                    <button
                      key={c.operatorId}
                      type="button"
                      onClick={() => {
                        setSelectedConsultantId(c.operatorId);
                        setConsultantPopoverOpen(false);
                      }}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-[2px] px-2.5 py-1.5 text-xs font-mono font-bold transition-colors text-left cursor-pointer",
                        isSel
                          ? "bg-primary text-primary-foreground"
                          : "text-foreground dark:text-zinc-200 hover:bg-muted dark:hover:bg-zinc-900",
                      )}
                    >
                      <img
                        src={cAvatar}
                        alt={c.name}
                        className="h-5 w-5 shrink-0 rounded-[2px] object-cover border border-border/60 bg-muted"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).src = getDeterministicConsultantAvatar(c.name);
                        }}
                      />
                      <span className="truncate flex-1">{c.name}</span>
                      {c.division && (
                        <span
                          className={cn(
                            "text-[9px] px-1.5 py-0.5 rounded-[2px] font-bold uppercase",
                            isSel ? "bg-white/20 text-white" : "bg-muted dark:bg-zinc-800 text-muted-foreground",
                          )}
                        >
                          {c.division.slice(0, 4)}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover>
        </div>

        {/* Botão Sincronizar */}
        <button
          type="button"
          onClick={() => void loadCalendar(month, true)}
          disabled={syncing || loading}
          className="flex items-center gap-1.5 rounded-[4px] border border-border/80 dark:border-zinc-800 bg-background dark:bg-zinc-900 px-3 py-1.5 text-xs font-mono font-bold text-foreground hover:bg-muted/40 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50 cursor-pointer shadow-sm"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", (syncing || loading) && "animate-spin text-primary")} />
          <span>Sincronizar</span>
        </button>
      </div>

      {/* ──────────────────────────────────────────────────────────── */}
      {/* 3. OS 5 CARDS DE KPIS EXECUTIVOS                            */}
      {/* ──────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5 font-mono">
        {/* Card 1: Meta do Mês */}
        <div className="rounded-[4px] border border-border/80 bg-card dark:border-zinc-800 dark:bg-zinc-950/70 p-4 shadow-sm transition-all hover:border-zinc-700">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono font-bold uppercase tracking-[.14em] text-muted-foreground dark:text-zinc-400">
              META DO MÊS
            </span>
            <div className="flex h-7 w-7 items-center justify-center rounded-[2px] bg-sky-500/10 border border-sky-500/20 text-sky-500">
              <Target className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 text-2xl font-bold font-mono tracking-tight text-foreground dark:text-zinc-50">
            {formatCurrencyCompact(filteredData?.totalTarget || 0)}
          </div>
          <div className="mt-1 text-xs font-mono font-bold text-emerald-500 dark:text-emerald-400">
            Realizado: {formatCurrencyCompact(filteredData?.totalRealized || 0)} (
            {(filteredData?.attainment || 0).toFixed(1).replace(".", ",")}%)
          </div>
        </div>

        {/* Card 2: Falta Faturar (GAP) */}
        <div className="rounded-[4px] border border-border/80 bg-card dark:border-zinc-800 dark:bg-zinc-950/70 p-4 shadow-sm transition-all hover:border-zinc-700">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono font-bold uppercase tracking-[.14em] text-muted-foreground dark:text-zinc-400">
              FALTA FATURAR (GAP)
            </span>
            <div className="flex h-7 w-7 items-center justify-center rounded-[2px] bg-rose-500/10 border border-rose-500/20 text-rose-500">
              <Clock className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 text-2xl font-bold font-mono tracking-tight text-rose-500">
            {formatCurrencyCompact(filteredData?.gap || 0)}
          </div>
          <div className="mt-1 text-xs font-mono text-muted-foreground dark:text-zinc-400">
            Em <strong className="text-foreground dark:text-zinc-200">{filteredData?.remainingDays || 0}</strong> dias
            úteis restantes ({filteredData?.elapsedDays || 0} decorridos)
          </div>
        </div>

        {/* Card 3: Meta Diária Necessária */}
        <div className="rounded-[4px] border border-border/80 bg-card dark:border-zinc-800 dark:bg-zinc-950/70 p-4 shadow-sm transition-all hover:border-zinc-700">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono font-bold uppercase tracking-[.14em] text-muted-foreground dark:text-zinc-400">
              META DIÁRIA NECESSÁRIA
            </span>
            <div className="flex h-7 w-7 items-center justify-center rounded-[2px] bg-amber-500/10 border border-amber-500/20 text-amber-500">
              <TrendingUp className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 text-2xl font-bold font-mono tracking-tight text-amber-500">
            {formatCurrencyCompact(filteredData?.dailyRequired || 0)}{" "}
            <span className="text-xs font-semibold text-muted-foreground">/ dia</span>
          </div>
          <div className="mt-1 text-xs font-mono text-muted-foreground dark:text-zinc-400">
            Base linear: {formatCurrencyCompact(filteredData?.linearDailyTarget || 0)} / dia
          </div>
        </div>

        {/* Card 4: Projeção de Run Rate */}
        <div className="rounded-[4px] border border-border/80 bg-card dark:border-zinc-800 dark:bg-zinc-950/70 p-4 shadow-sm transition-all hover:border-zinc-700">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono font-bold uppercase tracking-[.14em] text-muted-foreground dark:text-zinc-400">
              PROJEÇÃO DE RUN RATE
            </span>
            <div className="flex h-7 w-7 items-center justify-center rounded-[2px] bg-emerald-500/10 border border-emerald-500/20 text-emerald-500">
              <Sparkles className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 text-2xl font-bold font-mono tracking-tight text-foreground dark:text-zinc-50">
            {formatCurrencyCompact(filteredData?.runRate || 0)}
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-xs font-mono">
            {(filteredData?.runRate || 0) >= (filteredData?.totalTarget || 1) ? (
              <>
                <span className="h-2 w-2 rounded-[1px] bg-emerald-500" />
                <span className="font-bold text-emerald-500">No ritmo da meta</span>
              </>
            ) : (
              <>
                <span className="h-2 w-2 rounded-[1px] bg-amber-500" />
                <span className="font-bold text-amber-500">Ritmo precisa acelerar</span>
              </>
            )}
          </div>
        </div>

        {/* Card 5: Melhor Dia do Mês */}
        <div className="rounded-[4px] border border-border/80 bg-card dark:border-zinc-800 dark:bg-zinc-950/70 p-4 shadow-sm transition-all hover:border-zinc-700">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono font-bold uppercase tracking-[.14em] text-muted-foreground dark:text-zinc-400">
              MELHOR DIA DO MÊS
            </span>
            <div className="flex h-7 w-7 items-center justify-center rounded-[2px] bg-purple-500/10 border border-purple-500/20 text-purple-500">
              <Award className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 text-2xl font-bold font-mono tracking-tight text-foreground dark:text-zinc-50 truncate">
            {filteredData?.bestDay.day ? (
              <>
                Dia {filteredData.bestDay.day} • {formatCurrencyCompact(filteredData.bestDay.value)}
              </>
            ) : (
              "—"
            )}
          </div>
          <div className="mt-1 text-xs font-mono text-muted-foreground dark:text-zinc-400">
            {filteredData?.bestDay.count
              ? `${filteredData.bestDay.count} venda(s) fechada(s)`
              : "Nenhum fechamento ainda"}
          </div>
        </div>
      </div>

      {/* ──────────────────────────────────────────────────────────── */}
      {/* 4. CALENDÁRIO COMERCIAL + DETALHAMENTO DO DIA (2 COLUNAS)    */}
      {/* ──────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        {/* Coluna Esquerda: Grade do Calendário (7 Colunas de Seg a Dom) */}
        <div className="rounded-[4px] border border-border/80 bg-card dark:border-zinc-800 dark:bg-zinc-950/70 p-5 shadow-sm lg:col-span-8 flex flex-col justify-between">
          <div>
            {/* Topo do Card de Calendário: Mês e Legendas */}
            <div className="flex flex-wrap items-center justify-between gap-3 pb-4 mb-2 border-b border-border/80 dark:border-zinc-800">
              <div>
                <h2 className="text-sm font-mono font-bold text-foreground dark:text-zinc-50">
                  {formatMonthLabel(month)}
                </h2>
                <p className="text-xs text-muted-foreground dark:text-zinc-400">
                  Clique em qualquer dia para ver o detalhamento completo dos fechamentos.
                </p>
              </div>

              {/* Legenda de Cores */}
              <div className="flex flex-wrap items-center gap-3 text-[10px] font-mono font-bold">
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-[1px] bg-emerald-500" />
                  <span className="text-muted-foreground dark:text-zinc-400">Meta Batida</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-[1px] bg-amber-500" />
                  <span className="text-muted-foreground dark:text-zinc-400">Parcial</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-[1px] bg-rose-500" />
                  <span className="text-muted-foreground dark:text-zinc-400">Zerado</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-[1px] bg-sky-500" />
                  <span className="text-muted-foreground dark:text-zinc-400">Alvo Futuro</span>
                </div>
              </div>
            </div>

            {/* Cabeçalho dos Dias da Semana (SEG a DOM) */}
            <div className="grid grid-cols-7 gap-1.5 text-center text-[10px] font-mono font-bold text-muted-foreground dark:text-zinc-400 uppercase pb-2">
              <span>SEG</span>
              <span>TER</span>
              <span>QUA</span>
              <span>QUI</span>
              <span>SEX</span>
              <span>SÁB</span>
              <span>DOM</span>
            </div>

            {/* Grid de Células dos Dias */}
            <div className="grid grid-cols-7 gap-1.5">
              {/* Espaços vazios antes do dia 1 */}
              {Array.from({ length: calendarGrid.offset }, (_, i) => (
                <div
                  key={`offset-${i}`}
                  className="min-h-[85px] rounded-[2px] border border-border/30 dark:border-zinc-800/40 bg-muted/5 dark:bg-zinc-900/20 opacity-30"
                />
              ))}

              {/* Células Reais do Mês */}
              {calendarGrid.days.map((day) => {
                const isSelected = selectedDate === day.date;
                const closing = day.closing;
                const holiday = day.holiday;

                return (
                  <motion.button
                    key={day.date}
                    type="button"
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.99 }}
                    onClick={() => setSelectedDate(day.date)}
                    className={cn(
                      "group relative flex min-h-[88px] flex-col justify-between rounded-[2px] border p-2 text-left transition-all cursor-pointer",
                      isSelected
                        ? "border-primary ring-1 ring-primary/40 bg-primary/5 dark:bg-primary/10 shadow-sm"
                        : "border-border/80 dark:border-zinc-800 hover:border-primary/50 bg-background/50 dark:bg-zinc-900/40 hover:bg-muted/30 dark:hover:bg-zinc-900/70",
                      day.isWeekend && !holiday?.type && "bg-muted/15 dark:bg-zinc-950/40 opacity-70",
                    )}
                  >
                    {/* Topo da Célula: Número do Dia + Badge de Status */}
                    <div className="flex items-start justify-between gap-1 font-mono">
                      <span
                        className={cn(
                          "text-xs font-bold",
                          day.isToday ? "text-primary" : "text-foreground dark:text-zinc-100",
                        )}
                      >
                        {day.dayNumber}
                      </span>

                      {/* Badges Féis ao Layout */}
                      {day.status === "HOJE" && (
                        <span className="rounded-[2px] bg-primary px-1.5 py-0.5 text-[9px] font-mono font-bold text-primary-foreground uppercase tracking-wider">
                          Hoje
                        </span>
                      )}
                      {day.status === "BATIDA" && (
                        <span className="rounded-[2px] bg-emerald-500/20 text-emerald-500 dark:text-emerald-400 border border-emerald-500/30 px-1.5 py-0.5 text-[9px] font-mono font-bold uppercase tracking-wider">
                          Batida
                        </span>
                      )}
                      {day.status === "PARCIAL" && (
                        <span className="rounded-[2px] bg-amber-500/20 text-amber-500 dark:text-amber-400 border border-amber-500/30 px-1.5 py-0.5 text-[9px] font-mono font-bold uppercase tracking-wider">
                          Parcial
                        </span>
                      )}
                      {day.status === "ZERADO" && (
                        <span className="rounded-[2px] bg-rose-500/20 text-rose-500 dark:text-rose-400 border border-rose-500/30 px-1.5 py-0.5 text-[9px] font-mono font-bold uppercase tracking-wider">
                          Zerado
                        </span>
                      )}
                      {day.status === "ALVO" && (
                        <span className="rounded-[2px] bg-sky-500/20 text-sky-500 dark:text-sky-400 border border-sky-500/30 px-1.5 py-0.5 text-[9px] font-mono font-bold uppercase tracking-wider">
                          Alvo
                        </span>
                      )}
                      {day.status === "FERIADO" && (
                        <span className="rounded-[2px] bg-purple-500/20 text-purple-500 dark:text-purple-400 border border-purple-500/30 px-1.5 py-0.5 text-[9px] font-mono font-bold uppercase tracking-wider">
                          Feriado
                        </span>
                      )}
                    </div>

                    {/* Conteúdo Central e Rodapé da Célula */}
                    <div className="mt-1 font-mono">
                      {/* Caso 1: Dia útil com fechamento realizado */}
                      {closing && closing.value > 0 ? (
                        <div>
                          <span className="block text-[11px] font-bold text-emerald-500 dark:text-emerald-400 leading-tight">
                            +{formatCurrencyCompact(closing.value)}
                          </span>
                          <span className="block text-[9px] font-medium text-muted-foreground dark:text-zinc-400">
                            {closing.count} venda{closing.count === 1 ? "" : "s"}
                          </span>
                          <span className="block text-[8px] text-muted-foreground/70 dark:text-zinc-500 mt-0.5">
                            Meta: {formatCurrencyCompact(filteredData?.linearDailyTarget || 0)}
                          </span>
                        </div>
                      ) : day.isWorkingDay && (day.isPast || day.isToday) ? (
                        /* Caso 2: Dia útil passado ou hoje zerado */
                        <div>
                          <span className="block text-[11px] font-medium text-muted-foreground dark:text-zinc-500 leading-tight">
                            R$ 0,0
                          </span>
                          <span className="block text-[9px] text-muted-foreground/80 dark:text-zinc-500">
                            0 vendas
                          </span>
                          <span className="block text-[8px] text-muted-foreground/70 dark:text-zinc-600 mt-0.5">
                            Meta: {formatCurrencyCompact(filteredData?.linearDailyTarget || 0)}
                          </span>
                        </div>
                      ) : day.isWorkingDay && day.isFuture ? (
                        /* Caso 3: Alvo futuro */
                        <div>
                          <span className="block text-[11px] font-bold text-sky-500 dark:text-sky-400 leading-tight">
                            {formatCurrencyCompact(filteredData?.dailyRequired || 0)}
                          </span>
                          <span className="block text-[9px] font-medium text-muted-foreground dark:text-zinc-400">
                            alvo diário
                          </span>
                          <span className="block text-[8px] text-muted-foreground/70 dark:text-zinc-500 mt-0.5">
                            Meta: {formatCurrencyCompact(filteredData?.linearDailyTarget || 0)}
                          </span>
                        </div>
                      ) : day.isWeekend ? (
                        /* Caso 4: Fim de semana */
                        <div className="text-[9px] text-muted-foreground/80 dark:text-zinc-500">
                          <span className="block font-medium">Fim de semana</span>
                          <span className="block text-[8px]">Sem cota útil</span>
                        </div>
                      ) : holiday ? (
                        /* Caso 5: Feriado cadastrado */
                        <div className="text-[9px] text-purple-400">
                          <span className="block font-bold">Feriado</span>
                          <span className="block truncate text-[8px] text-muted-foreground dark:text-zinc-400">
                            {holiday.description}
                          </span>
                        </div>
                      ) : null}
                    </div>
                  </motion.button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Coluna Direita: Detalhamento do Dia Selecionado */}
        <div className="flex flex-col justify-between rounded-[4px] border border-border/80 bg-card dark:border-zinc-800 dark:bg-zinc-950/70 p-5 shadow-sm lg:col-span-4">
          <div>
            {/* Header do Detalhamento */}
            <div className="flex items-center justify-between pb-2 border-b border-border/80 dark:border-zinc-800">
              <span className="text-[10px] font-mono font-bold uppercase tracking-[.18em] text-primary">
                DETALHAMENTO DO DIA {selectedDayInfo.dayNumber}
              </span>

              <div className="flex items-center gap-1.5 font-mono">
                {selectedDayInfo.isToday && (
                  <span className="rounded-[2px] bg-primary/20 text-primary text-[10px] font-bold px-2 py-0.5 uppercase border border-primary/30">
                    Hoje
                  </span>
                )}
                <span className="rounded-[2px] bg-muted dark:bg-zinc-800 text-muted-foreground dark:text-zinc-300 text-[10px] font-bold px-2 py-0.5 border border-border/60 dark:border-zinc-700">
                  {selectedDayInfo.holiday
                    ? "Feriado"
                    : selectedDayInfo.isWorkingDay
                      ? "Dia Útil"
                      : "Fim de Semana"}
                </span>
              </div>
            </div>

            {/* Título com a data por extenso */}
            <h3 className="mt-2.5 font-mono text-sm sm:text-base font-bold text-foreground dark:text-zinc-50">
              {formatDateFull(selectedDayInfo.date)}
            </h3>
            <p className="text-xs text-muted-foreground dark:text-zinc-400 mt-0.5">
              Acompanhe as vendas fechadas hoje em tempo real pelo CRM.
            </p>

            {/* 3 Mini KPIs do Dia */}
            <div className="mt-4 grid grid-cols-3 gap-2 font-mono">
              <div className="rounded-[2px] border border-border/80 dark:border-zinc-800 bg-muted/20 dark:bg-zinc-900/40 p-2.5 text-center">
                <div className="text-xs font-bold text-emerald-500 dark:text-emerald-400 truncate">
                  {formatCurrency(selectedDayInfo.value, true)}
                </div>
                <div className="mt-0.5 text-[8px] font-bold uppercase tracking-wider text-muted-foreground dark:text-zinc-400">
                  FATURADO NO DIA
                </div>
              </div>

              <div className="rounded-[2px] border border-border/80 dark:border-zinc-800 bg-muted/20 dark:bg-zinc-900/40 p-2.5 text-center">
                <div className="text-xs font-bold text-foreground dark:text-zinc-200 truncate">
                  {formatCurrency(selectedDayInfo.targetExpected, true)}
                </div>
                <div className="mt-0.5 text-[8px] font-bold uppercase tracking-wider text-muted-foreground dark:text-zinc-400">
                  META ESPERADA
                </div>
              </div>

              <div className="rounded-[2px] border border-border/80 dark:border-zinc-800 bg-muted/20 dark:bg-zinc-900/40 p-2.5 text-center">
                <div className="text-xs font-bold text-amber-500 truncate">
                  {selectedDayInfo.attainment.toFixed(0)}%
                </div>
                <div className="mt-0.5 text-[8px] font-bold uppercase tracking-wider text-muted-foreground dark:text-zinc-400">
                  ATINGIMENTO
                </div>
              </div>
            </div>

            {/* Lista de Negócios Fechados */}
            <div className="mt-5">
              <div className="flex items-center justify-between pb-2 border-b border-border/80 dark:border-zinc-800 font-mono">
                <span className="text-[10px] font-bold uppercase tracking-wider text-foreground dark:text-zinc-200">
                  NEGÓCIOS FECHADOS ({selectedDayInfo.deals.length})
                </span>
                <span className="text-xs font-bold text-emerald-500 dark:text-emerald-400">
                  Total: {formatCurrency(selectedDayInfo.value, true)}
                </span>
              </div>

              <div className="mt-3 space-y-2 max-h-[300px] overflow-y-auto pr-1">
                {selectedDayInfo.deals.length === 0 ? (
                  <div className="rounded-[2px] border border-dashed border-border/80 dark:border-zinc-800 p-6 text-center text-xs font-mono text-muted-foreground dark:text-zinc-400">
                    Nenhum negócio fechado nesta data.
                  </div>
                ) : (
                  selectedDayInfo.deals.map((deal) => (
                    <div
                      key={deal.id}
                      className="flex items-center justify-between gap-2 rounded-[2px] border border-border/80 dark:border-zinc-800 bg-background dark:bg-zinc-900/50 p-3 transition-colors hover:border-primary/40 shadow-xs"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <img
                          src={deal.operatorAvatar || getDeterministicConsultantAvatar(deal.operatorName)}
                          alt={deal.operatorName || ""}
                          className="h-8 w-8 rounded-[2px] object-cover shrink-0 border border-border/80 dark:border-zinc-800 bg-muted"
                          onError={(e) => {
                            (e.currentTarget as HTMLImageElement).src = getDeterministicConsultantAvatar(deal.operatorName);
                          }}
                        />
                        <div className="min-w-0">
                          <p className="truncate text-xs font-bold text-foreground dark:text-zinc-100">
                            {deal.title}
                          </p>
                          <p className="text-[10px] font-mono text-muted-foreground dark:text-zinc-400">
                            {deal.operatorName} •{" "}
                            <span className="uppercase font-bold text-foreground/80 dark:text-zinc-300">
                              {deal.division || "Comercial"}
                            </span>
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-col items-end shrink-0 font-mono">
                        <span className="text-xs font-bold text-emerald-500 dark:text-emerald-400">
                          {formatCurrency(deal.value, true)}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            if (deal.rdDealUrl) {
                              window.open(deal.rdDealUrl, "_blank", "noopener,noreferrer");
                            } else {
                              void navigate({
                                to: "/crm/deals/$dealId",
                                params: { dealId: deal.id },
                                search: { from: "crm" },
                              });
                            }
                          }}
                          className="mt-1 flex items-center gap-1 rounded-[2px] border border-border/80 dark:border-zinc-800 bg-card dark:bg-zinc-900 px-2 py-0.5 text-[10px] font-mono font-bold text-foreground hover:bg-muted dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                        >
                          <ExternalLink className="h-2.5 w-2.5 text-primary" />
                          <span>Card no CRM</span>
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Rodapé da Coluna Direita: Ações de Feriados e Recálculo */}
          <div className="mt-5 flex items-center justify-between border-t border-border/80 dark:border-zinc-800 pt-3 text-xs font-mono">
            <button
              type="button"
              onClick={() => setManageHolidaysOpen(true)}
              className="flex items-center gap-1.5 font-bold text-muted-foreground hover:text-foreground dark:hover:text-zinc-200 transition-colors cursor-pointer"
            >
              <CalendarDays className="h-3.5 w-3.5" />
              <span>Feriados ({filteredData?.holidays.length || 0})</span>
            </button>

            <button
              type="button"
              onClick={() => void loadCalendar(month, true)}
              className="flex items-center gap-1.5 font-bold text-primary hover:underline transition-colors cursor-pointer"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span>Recalcular dias</span>
            </button>
          </div>
        </div>
      </div>

      {/* ──────────────────────────────────────────────────────────── */}
      {/* 5. EVOLUÇÃO ACUMULADA DE METAS & FECHAMENTOS (CURVA S)       */}
      {/* ──────────────────────────────────────────────────────────── */}
      <div className="rounded-[4px] border border-border/80 bg-card dark:border-zinc-800 dark:bg-zinc-950/70 p-5 shadow-sm font-mono">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-border/80 dark:border-zinc-800">
          <div>
            <h2 className="flex items-center gap-2 text-sm sm:text-base font-bold text-foreground dark:text-zinc-50">
              <span>Evolução Acumulada de Metas & Fechamentos (Curva S)</span>
            </h2>
            <p className="text-xs text-muted-foreground dark:text-zinc-400 mt-0.5">
              Comparativo dia a dia entre a Meta Linear Acumulada (esperada) e o Faturamento
              Realizado acumulado.
            </p>
          </div>

          {/* Legenda do Gráfico */}
          <div className="flex items-center gap-4 text-xs font-mono font-bold">
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-4 border-b-2 border-dashed border-zinc-400" />
              <span className="text-muted-foreground dark:text-zinc-400">Meta Esperada</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-4 h-0.5 bg-emerald-500" />
              <span className="text-emerald-500 font-bold">Realizado Acumulado</span>
            </div>
          </div>
        </div>

        {/* Container do Gráfico Recharts */}
        <div className="mt-4 h-72 w-full font-mono">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={sCurveData} margin={{ top: 25, right: 30, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.6} />
              <XAxis
                dataKey="label"
                stroke="var(--muted-foreground)"
                fontSize={11}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                stroke="var(--muted-foreground)"
                fontSize={11}
                tickLine={false}
                tickFormatter={(val: number) => formatCurrencyCompact(val)}
                domain={[0, "auto"]}
              />
              <RechartsTooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload || !payload.length) return null;
                  const item = payload[0].payload as {
                    day: number;
                    label: string;
                    expected: number;
                    realized: number | null;
                  };
                  return (
                    <div className="rounded-[4px] border border-border/80 dark:border-zinc-800 bg-card dark:bg-zinc-950 p-3 shadow-xl text-xs font-mono space-y-1">
                      <p className="font-bold text-foreground dark:text-zinc-100 border-b border-border/80 dark:border-zinc-800 pb-1">
                        {label}
                      </p>
                      <p className="text-muted-foreground dark:text-zinc-400">
                        Meta Esperada:{" "}
                        <strong className="text-foreground dark:text-zinc-100">
                          {formatCurrency(item.expected, true)}
                        </strong>
                      </p>
                      {item.realized !== null ? (
                        <p className="text-emerald-500 font-bold">
                          Realizado Acumulado: {formatCurrency(item.realized, true)}
                        </p>
                      ) : (
                        <p className="text-muted-foreground dark:text-zinc-500 italic">Dia futuro (sem fechamento)</p>
                      )}
                    </div>
                  );
                }}
              />

              {/* Linha Tracejada da Meta Linear Acumulada */}
              <Line
                type="monotone"
                dataKey="expected"
                stroke="#a1a1aa"
                strokeWidth={2}
                strokeDasharray="5 5"
                dot={false}
                name="Meta Esperada Acumulada"
                isAnimationActive={false}
              />

              {/* Linha Sólida do Realizado Acumulado */}
              <Line
                type="monotone"
                dataKey="realized"
                stroke="#10b981"
                strokeWidth={3}
                dot={{ r: 3, fill: "#10b981", strokeWidth: 0 }}
                activeDot={{ r: 6, fill: "#10b981", stroke: "#ffffff", strokeWidth: 2 }}
                name="Realizado Acumulado"
                connectNulls={false}
                isAnimationActive={false}
              />

              {/* Marcador Vertical de Hoje */}
              {currentTodayNumber && (
                <ReferenceLine
                  x={`Dia ${currentTodayNumber}`}
                  stroke="var(--primary)"
                  strokeDasharray="4 4"
                  strokeWidth={2}
                  label={{
                    value: `Hoje (Dia ${currentTodayNumber})`,
                    position: "top",
                    fill: "var(--primary)",
                    fontSize: 11,
                    fontWeight: "bold",
                  }}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ──────────────────────────────────────────────────────────── */}
      {/* 6. MODAL DE ADICIONAR FERIADO / AJUSTE DE EXPEDIENTE         */}
      {/* ──────────────────────────────────────────────────────────── */}
      <Dialog open={addHolidayOpen} onOpenChange={setAddHolidayOpen}>
        <DialogContent className="max-w-md rounded-[4px] bg-card dark:bg-zinc-950 border border-border/80 dark:border-zinc-800 p-6 shadow-2xl font-sans">
          <DialogHeader>
            <DialogTitle className="text-base font-mono font-bold text-foreground dark:text-zinc-50">
              Adicionar Feriado ou Ajuste de Expediente
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground dark:text-zinc-400">
              Cadastre feriados nacionais, pontes ou sábados de expediente extra para ajustar o
              pacing diário.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={(e) => void handleSaveHoliday(e)} className="mt-4 space-y-4">
            <div>
              <label className="text-[10px] font-mono font-bold uppercase tracking-[.14em] text-muted-foreground dark:text-zinc-400 block mb-1.5">
                Data do Ajuste
              </label>
              <input
                type="date"
                required
                value={holidayForm.date}
                onChange={(e) => setHolidayForm((f) => ({ ...f, date: e.target.value }))}
                className="w-full rounded-[4px] border border-border/80 dark:border-zinc-800 bg-background dark:bg-zinc-900/80 px-3 py-2 text-xs font-mono text-foreground outline-none focus:border-primary"
              />
            </div>

            <div>
              <label className="text-[10px] font-mono font-bold uppercase tracking-[.14em] text-muted-foreground dark:text-zinc-400 block mb-1.5">
                Tipo de Expediente
              </label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { id: "holiday", label: "Feriado" },
                  { id: "bridge", label: "Ponte" },
                  { id: "extra_work", label: "Expediente Extra" },
                  { id: "suspension", label: "Suspensão" },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() =>
                      setHolidayForm((f) => ({
                        ...f,
                        type: opt.id as "holiday" | "bridge" | "extra_work" | "suspension",
                      }))
                    }
                    className={cn(
                      "rounded-[2px] border px-3 py-2 text-xs font-mono font-bold transition-all text-center cursor-pointer",
                      holidayForm.type === opt.id
                        ? "border-primary bg-primary text-primary-foreground shadow-sm"
                        : "border-border/80 dark:border-zinc-800 bg-background dark:bg-zinc-900 text-foreground hover:bg-muted dark:hover:bg-zinc-800",
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-[10px] font-mono font-bold uppercase tracking-[.14em] text-muted-foreground dark:text-zinc-400 block mb-1.5">
                Descrição do Ajuste
              </label>
              <input
                type="text"
                required
                placeholder="Ex: Nossa Sra. Aparecida / Sábado de Vendas"
                value={holidayForm.description}
                onChange={(e) => setHolidayForm((f) => ({ ...f, description: e.target.value }))}
                className="w-full rounded-[4px] border border-border/80 dark:border-zinc-800 bg-background dark:bg-zinc-900/80 px-3 py-2 text-xs font-mono text-foreground outline-none focus:border-primary"
              />
            </div>

            {/* Custom Checkbox sem padrão do navegador */}
            <div className="flex items-center gap-2.5 pt-1">
              <button
                type="button"
                role="checkbox"
                aria-checked={holidayForm.affectsGoal}
                onClick={() => setHolidayForm((f) => ({ ...f, affectsGoal: !f.affectsGoal }))}
                className={cn(
                  "flex h-4 w-4 items-center justify-center rounded-[2px] border transition-colors cursor-pointer",
                  holidayForm.affectsGoal
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border/80 dark:border-zinc-700 bg-background dark:bg-zinc-900",
                )}
              >
                {holidayForm.affectsGoal && <Check className="h-3 w-3 stroke-[3]" />}
              </button>
              <span
                onClick={() => setHolidayForm((f) => ({ ...f, affectsGoal: !f.affectsGoal }))}
                className="text-xs font-mono font-medium text-foreground dark:text-zinc-200 cursor-pointer select-none"
              >
                Afeta a meta de dias úteis e o ritmo diário
              </span>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-border/80 dark:border-zinc-800 font-mono">
              <button
                type="button"
                onClick={() => setAddHolidayOpen(false)}
                className="rounded-[4px] border border-border/80 dark:border-zinc-800 px-4 py-2 text-xs font-bold text-foreground hover:bg-muted dark:hover:bg-zinc-900 transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={savingHoliday}
                className="flex items-center gap-1.5 rounded-[4px] bg-primary px-4 py-2 text-xs font-bold text-primary-foreground shadow-sm hover:brightness-110 transition-all disabled:opacity-50 cursor-pointer"
              >
                {savingHoliday && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                <span>Salvar Feriado</span>
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ──────────────────────────────────────────────────────────── */}
      {/* 7. MODAL DE GERENCIAR FERIADOS DO MÊS                        */}
      {/* ──────────────────────────────────────────────────────────── */}
      <Dialog open={manageHolidaysOpen} onOpenChange={setManageHolidaysOpen}>
        <DialogContent className="max-w-lg rounded-[4px] bg-card dark:bg-zinc-950 border border-border/80 dark:border-zinc-800 p-6 shadow-2xl font-sans">
          <DialogHeader>
            <DialogTitle className="text-base font-mono font-bold text-foreground dark:text-zinc-50">
              Feriados & Ajustes de Expediente — {formatMonthLabel(month)}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground dark:text-zinc-400">
              Consulte e remova feriados ou exceções cadastradas neste mês.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-2 max-h-80 overflow-y-auto pr-1 font-mono">
            {filteredData?.holidays.length === 0 ? (
              <div className="rounded-[2px] border border-dashed border-border/80 dark:border-zinc-800 p-8 text-center text-xs text-muted-foreground dark:text-zinc-400">
                Nenhum feriado ou ajuste de expediente cadastrado para este mês.
              </div>
            ) : (
              filteredData?.holidays.map((h) => (
                <div
                  key={h.id}
                  className="flex items-center justify-between gap-3 rounded-[2px] border border-border/80 dark:border-zinc-800 bg-background dark:bg-zinc-900/50 p-3 shadow-xs"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <strong className="text-xs font-bold text-foreground dark:text-zinc-100">{h.date}</strong>
                      <span className="rounded-[2px] bg-muted dark:bg-zinc-800 px-2 py-0.5 text-[9px] font-bold text-muted-foreground dark:text-zinc-300 uppercase border border-border/60 dark:border-zinc-700">
                        {h.type === "extra_work"
                          ? "Expediente Extra"
                          : h.type === "holiday"
                            ? "Feriado"
                            : h.type === "bridge"
                              ? "Ponte"
                              : "Suspensão"}
                      </span>
                      {h.affectsGoal && (
                        <span className="rounded-[2px] bg-amber-500/10 border border-amber-500/20 text-amber-500 text-[9px] font-bold px-1.5 py-0.5">
                          Afeta meta
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground dark:text-zinc-400">{h.description}</p>
                  </div>

                  <SystemTooltip content="Remover este dia">
                    <button
                      type="button"
                      onClick={() => void handleRemoveHoliday(h.date)}
                      className="p-1.5 text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10 rounded-[2px] transition-colors cursor-pointer"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </SystemTooltip>
                </div>
              ))
            )}
          </div>

          <div className="flex items-center justify-between pt-3 border-t border-border/80 dark:border-zinc-800 font-mono">
            <button
              type="button"
              onClick={() => {
                setManageHolidaysOpen(false);
                setAddHolidayOpen(true);
              }}
              className="flex items-center gap-1.5 text-xs font-bold text-primary hover:underline cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Adicionar novo ajuste</span>
            </button>

            <button
              type="button"
              onClick={() => setManageHolidaysOpen(false)}
              className="rounded-[4px] border border-border/80 dark:border-zinc-800 px-4 py-1.5 text-xs font-bold text-foreground hover:bg-muted dark:hover:bg-zinc-900 cursor-pointer"
            >
              Fechar
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
