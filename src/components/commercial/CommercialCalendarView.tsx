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
          <span className="text-[11px] font-extrabold uppercase tracking-widest text-primary">
            CALENDÁRIO COMERCIAL & PACING
          </span>
          <h1 className="mt-0.5 text-2xl font-black tracking-tight text-foreground sm:text-3xl">
            Cockpit de Metas & Fechamentos Diários
          </h1>
          <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
            Monitore as vendas fechadas por dia, a expectativa de metas batidas e o ritmo necessário
            para os próximos dias.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Seletor de Mês Estilizado */}
          <div className="flex items-center rounded-xl border border-border bg-card shadow-xs">
            <SystemTooltip content="Mês anterior">
              <button
                type="button"
                onClick={() => handleMonthStep(-1)}
                className="flex h-9 w-9 items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/40 rounded-l-xl transition-colors"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            </SystemTooltip>

            <Popover open={monthPickerOpen} onOpenChange={setMonthPickerOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="flex items-center gap-2 px-3 py-1.5 text-xs font-bold text-foreground hover:text-primary transition-colors"
                >
                  <CalendarDays className="h-3.5 w-3.5 text-primary" />
                  <span>{formatMonthLabel(month)}</span>
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-3 bg-card border border-border rounded-2xl shadow-xl" align="center">
                <div className="flex items-center justify-between pb-2 mb-2 border-b border-border">
                  <button
                    type="button"
                    onClick={() => setPickerYear((y) => y - 1)}
                    className="p-1 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <span className="text-xs font-black text-foreground">{pickerYear}</span>
                  <button
                    type="button"
                    onClick={() => setPickerYear((y) => y + 1)}
                    className="p-1 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground"
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
                          "py-2 rounded-xl text-xs font-bold transition-all",
                          isSelected
                            ? "bg-primary text-primary-foreground shadow-sm"
                            : "hover:bg-muted text-foreground",
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
                  className="w-full mt-2.5 py-1.5 text-center text-[11px] font-bold text-primary hover:underline border-t border-border pt-2"
                >
                  Ir para o mês atual
                </button>
              </PopoverContent>
            </Popover>

            <SystemTooltip content="Próximo mês">
              <button
                type="button"
                onClick={() => handleMonthStep(1)}
                className="flex h-9 w-9 items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/40 rounded-r-xl transition-colors"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </SystemTooltip>
          </div>

          {/* Botão de Ver Feriados */}
          <button
            type="button"
            onClick={() => setManageHolidaysOpen(true)}
            className="flex items-center gap-1.5 rounded-xl border border-border bg-card px-3.5 py-2 text-xs font-bold text-foreground hover:bg-muted/40 transition-colors shadow-xs"
          >
            <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
            <span>Feriados ({filteredData?.holidays.length || 0})</span>
          </button>

          {/* Botão de Adicionar Feriado */}
          <button
            type="button"
            onClick={() => setAddHolidayOpen(true)}
            className="flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-primary-foreground shadow-xs hover:bg-primary/90 transition-all active:scale-95"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Adicionar feriado</span>
          </button>
        </div>
      </div>

      {/* ──────────────────────────────────────────────────────────── */}
      {/* 2. BARRA DE FILTRO & ESCOPO                                 */}
      {/* ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3 shadow-xs">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            <span className="h-2 w-2 rounded-full bg-primary" />
            <span>FILTRAR ESCOPO</span>
            <SystemTooltip content="Filtre os dados por toda a empresa, equipe comercial ou consultor específico.">
              <Info className="h-3.5 w-3.5 text-muted-foreground/70 cursor-help" />
            </SystemTooltip>
          </div>

          <div className="h-4 w-px bg-border mx-1 hidden sm:block" />

          {/* Pílulas de Times */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                setSelectedTeam("all");
                setSelectedConsultantId("all");
              }}
              className={cn(
                "flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition-all",
                selectedTeam === "all" && selectedConsultantId === "all"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-muted/40 text-muted-foreground hover:text-foreground hover:bg-muted/70",
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
                "flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition-all",
                selectedTeam === "personnalite"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-muted/40 text-muted-foreground hover:text-foreground hover:bg-muted/70",
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
                "flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition-all",
                selectedTeam === "maquinas"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-muted/40 text-muted-foreground hover:text-foreground hover:bg-muted/70",
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
                className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-1.5 text-xs font-bold text-foreground hover:bg-muted/40 transition-colors"
              >
                <User className="h-3.5 w-3.5 text-primary" />
                <span className="max-w-[130px] truncate">
                  {selectedConsultantObj ? selectedConsultantObj.name : "Todos os Consultores"}
                </span>
                <ChevronDown className="h-3 w-3 text-muted-foreground" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-56 p-2 bg-card border border-border rounded-2xl shadow-xl" align="start">
              <div className="space-y-1 max-h-60 overflow-y-auto">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedConsultantId("all");
                    setConsultantPopoverOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center justify-between rounded-xl px-2.5 py-1.5 text-xs font-bold transition-colors text-left",
                    selectedConsultantId === "all"
                      ? "bg-primary text-primary-foreground"
                      : "text-foreground hover:bg-muted",
                  )}
                >
                  <span>Todos os Consultores</span>
                  {selectedConsultantId === "all" && <Check className="h-3.5 w-3.5" />}
                </button>
                {data?.consultants.map((c) => {
                  const isSel = selectedConsultantId === c.operatorId;
                  return (
                    <button
                      key={c.operatorId}
                      type="button"
                      onClick={() => {
                        setSelectedConsultantId(c.operatorId);
                        setConsultantPopoverOpen(false);
                      }}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-xs font-bold transition-colors text-left",
                        isSel
                          ? "bg-primary text-primary-foreground"
                          : "text-foreground hover:bg-muted",
                      )}
                    >
                      <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[9px] font-bold">
                        {getInitials(c.name)}
                      </div>
                      <span className="truncate flex-1">{c.name}</span>
                      {c.division && (
                        <span
                          className={cn(
                            "text-[9px] px-1.5 py-0.5 rounded font-bold uppercase",
                            isSel ? "bg-white/20 text-white" : "bg-muted text-muted-foreground",
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
          className="flex items-center gap-1.5 rounded-xl border border-border bg-background px-3 py-1.5 text-xs font-bold text-foreground hover:bg-muted/40 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", (syncing || loading) && "animate-spin text-primary")} />
          <span>Sincronizar</span>
        </button>
      </div>

      {/* ──────────────────────────────────────────────────────────── */}
      {/* 3. OS 5 CARDS DE KPIS EXECUTIVOS                            */}
      {/* ──────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {/* Card 1: Meta do Mês */}
        <div className="rounded-2xl border border-border bg-card p-4 shadow-xs transition-all hover:border-primary/30">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">
              META DO MÊS
            </span>
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-sky-500/10 text-sky-500">
              <Target className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 text-2xl font-black tracking-tight text-foreground">
            {formatCurrencyCompact(filteredData?.totalTarget || 0)}
          </div>
          <div className="mt-1 text-xs font-bold text-emerald-500 dark:text-emerald-400">
            Realizado: {formatCurrencyCompact(filteredData?.totalRealized || 0)} (
            {(filteredData?.attainment || 0).toFixed(1).replace(".", ",")}%)
          </div>
        </div>

        {/* Card 2: Falta Faturar (GAP) */}
        <div className="rounded-2xl border border-border bg-card p-4 shadow-xs transition-all hover:border-primary/30">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">
              FALTA FATURAR (GAP)
            </span>
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-rose-500/10 text-rose-500">
              <Clock className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 text-2xl font-black tracking-tight text-rose-500">
            {formatCurrencyCompact(filteredData?.gap || 0)}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            Em <strong className="text-foreground">{filteredData?.remainingDays || 0}</strong> dias
            úteis restantes ({filteredData?.elapsedDays || 0} já decorridos)
          </div>
        </div>

        {/* Card 3: Meta Diária Necessária */}
        <div className="rounded-2xl border border-border bg-card p-4 shadow-xs transition-all hover:border-primary/30">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">
              META DIÁRIA NECESSÁRIA
            </span>
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-500/10 text-amber-500">
              <TrendingUp className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 text-2xl font-black tracking-tight text-amber-500">
            {formatCurrencyCompact(filteredData?.dailyRequired || 0)}{" "}
            <span className="text-xs font-semibold text-muted-foreground">/ dia útil</span>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            Base linear: {formatCurrencyCompact(filteredData?.linearDailyTarget || 0)} / dia
          </div>
        </div>

        {/* Card 4: Projeção de Run Rate */}
        <div className="rounded-2xl border border-border bg-card p-4 shadow-xs transition-all hover:border-primary/30">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">
              PROJEÇÃO DE RUN RATE
            </span>
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500">
              <Sparkles className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 text-2xl font-black tracking-tight text-foreground">
            {formatCurrencyCompact(filteredData?.runRate || 0)}
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-xs">
            {(filteredData?.runRate || 0) >= (filteredData?.totalTarget || 1) ? (
              <>
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                <span className="font-bold text-emerald-500">No ritmo da meta</span>
              </>
            ) : (
              <>
                <span className="h-2 w-2 rounded-full bg-amber-500" />
                <span className="font-bold text-amber-500">Ritmo precisa acelerar</span>
              </>
            )}
          </div>
        </div>

        {/* Card 5: Melhor Dia do Mês */}
        <div className="rounded-2xl border border-border bg-card p-4 shadow-xs transition-all hover:border-primary/30">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">
              MELHOR DIA DO MÊS
            </span>
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-purple-500/10 text-purple-500">
              <Award className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 text-2xl font-black tracking-tight text-foreground truncate">
            {filteredData?.bestDay.day ? (
              <>
                Dia {filteredData.bestDay.day} • {formatCurrencyCompact(filteredData.bestDay.value)}
              </>
            ) : (
              "—"
            )}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
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
        <div className="rounded-2xl border border-border bg-card p-5 shadow-xs lg:col-span-8 flex flex-col justify-between">
          <div>
            {/* Topo do Card de Calendário: Mês e Legendas */}
            <div className="flex flex-wrap items-center justify-between gap-3 pb-4 mb-2 border-b border-border/60">
              <div>
                <h2 className="text-base font-black text-foreground">
                  {formatMonthLabel(month)}
                </h2>
                <p className="text-xs text-muted-foreground">
                  Clique em qualquer dia para ver o detalhamento completo dos fechamentos.
                </p>
              </div>

              {/* Legenda de Cores */}
              <div className="flex flex-wrap items-center gap-3 text-[11px] font-bold">
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  <span className="text-muted-foreground">Meta Batida</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-amber-500" />
                  <span className="text-muted-foreground">Parcial</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-rose-500" />
                  <span className="text-muted-foreground">Zerado</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-sky-500" />
                  <span className="text-muted-foreground">Alvo Futuro</span>
                </div>
              </div>
            </div>

            {/* Cabeçalho dos Dias da Semana (SEG a DOM) */}
            <div className="grid grid-cols-7 gap-1.5 text-center text-[11px] font-extrabold text-muted-foreground uppercase pb-2">
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
                  className="min-h-[85px] rounded-xl border border-border/30 bg-muted/5 opacity-30"
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
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => setSelectedDate(day.date)}
                    className={cn(
                      "group relative flex min-h-[88px] flex-col justify-between rounded-xl border p-2 text-left transition-all",
                      isSelected
                        ? "border-primary ring-2 ring-primary/30 bg-primary/5 shadow-sm"
                        : "border-border hover:border-primary/40 bg-background/50 hover:bg-muted/30",
                      day.isWeekend && !holiday?.type && "bg-muted/15 opacity-70",
                    )}
                  >
                    {/* Topo da Célula: Número do Dia + Badge de Status */}
                    <div className="flex items-start justify-between gap-1">
                      <span
                        className={cn(
                          "text-xs font-black",
                          day.isToday ? "text-primary" : "text-foreground",
                        )}
                      >
                        {day.dayNumber}
                      </span>

                      {/* Badges Féis ao Layout da Foto */}
                      {day.status === "HOJE" && (
                        <span className="rounded bg-primary px-1.5 py-0.5 text-[9px] font-black text-primary-foreground shadow-xs uppercase">
                          Hoje
                        </span>
                      )}
                      {day.status === "BATIDA" && (
                        <span className="rounded bg-emerald-500/20 text-emerald-500 dark:text-emerald-400 px-1.5 py-0.5 text-[9px] font-black uppercase">
                          Batida
                        </span>
                      )}
                      {day.status === "PARCIAL" && (
                        <span className="rounded bg-amber-500/20 text-amber-500 dark:text-amber-400 px-1.5 py-0.5 text-[9px] font-black uppercase">
                          Parcial
                        </span>
                      )}
                      {day.status === "ZERADO" && (
                        <span className="rounded bg-rose-500/20 text-rose-500 dark:text-rose-400 px-1.5 py-0.5 text-[9px] font-black uppercase">
                          Zerado
                        </span>
                      )}
                      {day.status === "ALVO" && (
                        <span className="rounded bg-sky-500/20 text-sky-500 dark:text-sky-400 px-1.5 py-0.5 text-[9px] font-black uppercase">
                          Alvo
                        </span>
                      )}
                      {day.status === "FERIADO" && (
                        <span className="rounded bg-purple-500/20 text-purple-500 dark:text-purple-400 px-1.5 py-0.5 text-[9px] font-black uppercase">
                          Feriado
                        </span>
                      )}
                    </div>

                    {/* Conteúdo Central e Rodapé da Célula */}
                    <div className="mt-1">
                      {/* Caso 1: Dia útil com fechamento realizado */}
                      {closing && closing.value > 0 ? (
                        <div>
                          <span className="block text-[11px] font-black text-emerald-500 dark:text-emerald-400 leading-tight">
                            +{formatCurrencyCompact(closing.value)}
                          </span>
                          <span className="block text-[9px] font-bold text-muted-foreground">
                            {closing.count} venda{closing.count === 1 ? "" : "s"}
                          </span>
                          <span className="block text-[8px] text-muted-foreground/80 mt-0.5">
                            Meta: {formatCurrencyCompact(filteredData?.linearDailyTarget || 0)}
                          </span>
                        </div>
                      ) : day.isWorkingDay && (day.isPast || day.isToday) ? (
                        /* Caso 2: Dia útil passado ou hoje zerado */
                        <div>
                          <span className="block text-[11px] font-bold text-muted-foreground leading-tight">
                            R$ 0,0
                          </span>
                          <span className="block text-[9px] text-muted-foreground">
                            0 vendas
                          </span>
                          <span className="block text-[8px] text-muted-foreground/80 mt-0.5">
                            Meta: {formatCurrencyCompact(filteredData?.linearDailyTarget || 0)}
                          </span>
                        </div>
                      ) : day.isWorkingDay && day.isFuture ? (
                        /* Caso 3: Alvo futuro */
                        <div>
                          <span className="block text-[11px] font-bold text-sky-500 dark:text-sky-400 leading-tight">
                            {formatCurrencyCompact(filteredData?.dailyRequired || 0)}
                          </span>
                          <span className="block text-[9px] font-semibold text-muted-foreground">
                            alvo diário
                          </span>
                          <span className="block text-[8px] text-muted-foreground/80 mt-0.5">
                            Meta: {formatCurrencyCompact(filteredData?.linearDailyTarget || 0)}
                          </span>
                        </div>
                      ) : day.isWeekend ? (
                        /* Caso 4: Fim de semana */
                        <div className="text-[9px] text-muted-foreground/80">
                          <span className="block font-semibold">Fim de semana</span>
                          <span className="block text-[8px]">Sem cota útil</span>
                        </div>
                      ) : holiday ? (
                        /* Caso 5: Feriado cadastrado */
                        <div className="text-[9px] text-purple-400">
                          <span className="block font-bold">Feriado</span>
                          <span className="block truncate text-[8px] text-muted-foreground">
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
        <div className="flex flex-col justify-between rounded-2xl border border-border bg-card p-5 shadow-xs lg:col-span-4">
          <div>
            {/* Header do Detalhamento */}
            <div className="flex items-center justify-between pb-2 border-b border-border/60">
              <span className="text-[11px] font-extrabold uppercase tracking-widest text-primary">
                DETALHAMENTO DO DIA {selectedDayInfo.dayNumber}
              </span>

              <div className="flex items-center gap-1.5">
                {selectedDayInfo.isToday && (
                  <span className="rounded-full bg-primary/20 text-primary text-[10px] font-black px-2 py-0.5 uppercase">
                    Hoje
                  </span>
                )}
                <span className="rounded-full bg-muted text-muted-foreground text-[10px] font-bold px-2 py-0.5">
                  {selectedDayInfo.holiday
                    ? "Feriado"
                    : selectedDayInfo.isWorkingDay
                      ? "Dia Útil"
                      : "Fim de Semana"}
                </span>
              </div>
            </div>

            {/* Título com a data por extenso */}
            <h3 className="mt-2.5 text-base font-black text-foreground">
              {formatDateFull(selectedDayInfo.date)}
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Acompanhe as vendas fechadas hoje em tempo real pelo RD Station CRM.
            </p>

            {/* 3 Mini KPIs do Dia */}
            <div className="mt-4 grid grid-cols-3 gap-2">
              <div className="rounded-xl border border-border bg-muted/20 p-2.5 text-center">
                <div className="text-xs font-black text-emerald-500 dark:text-emerald-400 truncate">
                  {formatCurrency(selectedDayInfo.value, true)}
                </div>
                <div className="mt-0.5 text-[8px] font-extrabold uppercase tracking-wider text-muted-foreground">
                  FATURADO NO DIA
                </div>
              </div>

              <div className="rounded-xl border border-border bg-muted/20 p-2.5 text-center">
                <div className="text-xs font-black text-foreground truncate">
                  {formatCurrency(selectedDayInfo.targetExpected, true)}
                </div>
                <div className="mt-0.5 text-[8px] font-extrabold uppercase tracking-wider text-muted-foreground">
                  META ESPERADA
                </div>
              </div>

              <div className="rounded-xl border border-border bg-muted/20 p-2.5 text-center">
                <div className="text-xs font-black text-amber-500 truncate">
                  {selectedDayInfo.attainment.toFixed(0)}%
                </div>
                <div className="mt-0.5 text-[8px] font-extrabold uppercase tracking-wider text-muted-foreground">
                  ATINGIMENTO
                </div>
              </div>
            </div>

            {/* Lista de Negócios Fechados */}
            <div className="mt-5">
              <div className="flex items-center justify-between pb-2 border-b border-border/60">
                <span className="text-xs font-extrabold uppercase tracking-wider text-foreground">
                  NEGÓCIOS FECHADOS ({selectedDayInfo.deals.length})
                </span>
                <span className="text-xs font-black text-emerald-500 dark:text-emerald-400">
                  Total: {formatCurrency(selectedDayInfo.value, true)}
                </span>
              </div>

              <div className="mt-3 space-y-2 max-h-[300px] overflow-y-auto pr-1">
                {selectedDayInfo.deals.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
                    Nenhum negócio fechado nesta data.
                  </div>
                ) : (
                  selectedDayInfo.deals.map((deal) => (
                    <div
                      key={deal.id}
                      className="flex items-center justify-between gap-2 rounded-xl border border-border bg-background p-3 transition-colors hover:border-primary/40 shadow-2xs"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        {deal.operatorAvatar ? (
                          <img
                            src={deal.operatorAvatar}
                            alt=""
                            className="h-8 w-8 rounded-full object-cover shrink-0"
                          />
                        ) : (
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-black">
                            {getInitials(deal.operatorName || "ND")}
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="truncate text-xs font-black text-foreground">
                            {deal.title}
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            {deal.operatorName} •{" "}
                            <span className="uppercase font-bold">
                              {deal.division || "Comercial"}
                            </span>
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-col items-end shrink-0">
                        <span className="text-xs font-black text-emerald-500 dark:text-emerald-400">
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
                          className="mt-1 flex items-center gap-1 rounded-md border border-border bg-card px-2 py-0.5 text-[10px] font-bold text-foreground hover:bg-muted transition-colors"
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
          <div className="mt-5 flex items-center justify-between border-t border-border/60 pt-3 text-xs">
            <button
              type="button"
              onClick={() => setManageHolidaysOpen(true)}
              className="flex items-center gap-1.5 font-bold text-muted-foreground hover:text-foreground transition-colors"
            >
              <CalendarDays className="h-3.5 w-3.5" />
              <span>Gerenciar feriados do mês ({filteredData?.holidays.length || 0})</span>
            </button>

            <button
              type="button"
              onClick={() => void loadCalendar(month, true)}
              className="flex items-center gap-1.5 font-bold text-primary hover:underline transition-colors"
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
      <div className="rounded-2xl border border-border bg-card p-5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-border/60">
          <div>
            <h2 className="flex items-center gap-2 text-base font-black text-foreground">
              <span>📈 Evolução Acumulada de Metas & Fechamentos (Curva S)</span>
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Comparativo dia a dia entre a Meta Linear Acumulada (esperada) e o Faturamento
              Realizado acumulado.
            </p>
          </div>

          {/* Legenda do Gráfico */}
          <div className="flex items-center gap-4 text-xs font-bold">
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-4 border-b-2 border-dashed border-zinc-400" />
              <span className="text-muted-foreground">Meta Esperada Acumulada</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-4 h-0.5 bg-emerald-500" />
              <span className="text-emerald-500 font-black">Realizado Acumulado</span>
            </div>
          </div>
        </div>

        {/* Container do Gráfico Recharts */}
        <div className="mt-4 h-72 w-full">
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
                    <div className="rounded-xl border border-border bg-card p-3 shadow-xl text-xs space-y-1">
                      <p className="font-black text-foreground border-b border-border pb-1">
                        {label}
                      </p>
                      <p className="text-muted-foreground">
                        Meta Esperada:{" "}
                        <strong className="text-foreground">
                          {formatCurrency(item.expected, true)}
                        </strong>
                      </p>
                      {item.realized !== null ? (
                        <p className="text-emerald-500 font-bold">
                          Realizado Acumulado: {formatCurrency(item.realized, true)}
                        </p>
                      ) : (
                        <p className="text-muted-foreground italic">Dia futuro (sem fechamento)</p>
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
                    fontSize: 12,
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
        <DialogContent className="max-w-md rounded-2xl bg-card border border-border p-6 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-black text-foreground">
              Adicionar Feriado ou Ajuste de Expediente
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Cadastre feriados nacionais, pontes ou sábados de expediente extra para ajustar o
              pacing diário.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={(e) => void handleSaveHoliday(e)} className="mt-4 space-y-4">
            <div>
              <label className="text-xs font-bold text-foreground block mb-1.5">
                Data do Ajuste
              </label>
              <input
                type="date"
                required
                value={holidayForm.date}
                onChange={(e) => setHolidayForm((f) => ({ ...f, date: e.target.value }))}
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground outline-none focus:border-primary"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-foreground block mb-1.5">
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
                      "rounded-xl border px-3 py-2 text-xs font-bold transition-all text-center",
                      holidayForm.type === opt.id
                        ? "border-primary bg-primary text-primary-foreground shadow-sm"
                        : "border-border bg-background text-foreground hover:bg-muted",
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-foreground block mb-1.5">
                Descrição do Ajuste
              </label>
              <input
                type="text"
                required
                placeholder="Ex: Nossa Sra. Aparecida / Sábado de Vendas"
                value={holidayForm.description}
                onChange={(e) => setHolidayForm((f) => ({ ...f, description: e.target.value }))}
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground outline-none focus:border-primary"
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
                  "flex h-5 w-5 items-center justify-center rounded-lg border transition-colors",
                  holidayForm.affectsGoal
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background",
                )}
              >
                {holidayForm.affectsGoal && <Check className="h-3.5 w-3.5 stroke-[3]" />}
              </button>
              <span
                onClick={() => setHolidayForm((f) => ({ ...f, affectsGoal: !f.affectsGoal }))}
                className="text-xs font-bold text-foreground cursor-pointer select-none"
              >
                Afeta a meta de dias úteis e o ritmo diário
              </span>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
              <button
                type="button"
                onClick={() => setAddHolidayOpen(false)}
                className="rounded-xl border border-border px-4 py-2 text-xs font-bold text-foreground hover:bg-muted transition-colors"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={savingHoliday}
                className="flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-primary-foreground shadow-sm hover:bg-primary/90 transition-all disabled:opacity-50"
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
        <DialogContent className="max-w-lg rounded-2xl bg-card border border-border p-6 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-black text-foreground">
              Feriados & Ajustes de Expediente — {formatMonthLabel(month)}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Consulte e remova feriados ou exceções cadastradas neste mês.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-2 max-h-80 overflow-y-auto pr-1">
            {filteredData?.holidays.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-8 text-center text-xs text-muted-foreground">
                Nenhum feriado ou ajuste de expediente cadastrado para este mês.
              </div>
            ) : (
              filteredData?.holidays.map((h) => (
                <div
                  key={h.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background p-3 shadow-2xs"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <strong className="text-xs font-bold text-foreground">{h.date}</strong>
                      <span className="rounded bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground uppercase">
                        {h.type === "extra_work"
                          ? "Expediente Extra"
                          : h.type === "holiday"
                            ? "Feriado"
                            : h.type === "bridge"
                              ? "Ponte"
                              : "Suspensão"}
                      </span>
                      {h.affectsGoal && (
                        <span className="rounded bg-amber-500/10 text-amber-500 text-[10px] font-bold px-1.5 py-0.5">
                          Afeta meta
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{h.description}</p>
                  </div>

                  <SystemTooltip content="Remover este dia">
                    <button
                      type="button"
                      onClick={() => void handleRemoveHoliday(h.date)}
                      className="p-1.5 text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10 rounded-lg transition-colors"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </SystemTooltip>
                </div>
              ))
            )}
          </div>

          <div className="flex items-center justify-between pt-3 border-t border-border">
            <button
              type="button"
              onClick={() => {
                setManageHolidaysOpen(false);
                setAddHolidayOpen(true);
              }}
              className="flex items-center gap-1.5 text-xs font-bold text-primary hover:underline"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Adicionar novo ajuste</span>
            </button>

            <button
              type="button"
              onClick={() => setManageHolidaysOpen(false)}
              className="rounded-xl border border-border px-4 py-1.5 text-xs font-bold text-foreground hover:bg-muted"
            >
              Fechar
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
