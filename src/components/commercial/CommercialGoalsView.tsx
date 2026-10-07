import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleDollarSign,
  Gauge,
  Loader2,
  Pencil,
  Target,
} from "lucide-react";
import { motion } from "framer-motion";
import { SystemTooltip } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { saoPauloDay } from "@/lib/commercial/metrics";

export type ConsultantGoalItem = {
  operatorId: string;
  name: string;
  email: string;
  avatar: string | null;
  division: string | null;
  activeOnTv: boolean;
  targetValue: number;
  conversionRate: number;
  dailyTarget: number;
  realizedValue: number;
  attainment: number;
  gap: number;
  goalId: string | null;
};

export type GoalsApiResponse = {
  month: string;
  businessDays: number;
  elapsedDays: number;
  remainingDays: number;
  consultants: ConsultantGoalItem[];
  totals: {
    targetValue: number;
    realizedValue: number;
    gap: number;
    attainment: number;
    consultantsWithGoal: number;
    dailyRequired: number;
    totalDailyTarget: number;
    avgConversionRate: number;
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

function formatMonthLabel(monthStr: string): string {
  const [year, m] = monthStr.split("-").map(Number);
  if (!year || !m) return monthStr;
  return `${MONTH_NAMES[m - 1]} De ${year}`;
}

function formatMonthLong(monthStr: string): string {
  const [year, m] = monthStr.split("-").map(Number);
  if (!year || !m) return monthStr;
  return `${MONTH_NAMES[m - 1].toLowerCase()} de ${year}`;
}

function stepMonth(current: string, delta: number): string {
  const [year, m] = current.split("-").map(Number);
  const d = new Date(Date.UTC(year, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function formatCurrency(value: number, withDecimals = false): string {
  if (!Number.isFinite(value)) return "R$ 0";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: withDecimals ? 2 : 0,
    maximumFractionDigits: withDecimals ? 2 : 0,
  }).format(value);
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function CommercialGoalsView({
  initialMonth,
}: {
  initialMonth?: string;
}) {
  const [month, setMonth] = useState(() => initialMonth || saoPauloDay().slice(0, 7));
  const [data, setData] = useState<GoalsApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [pickerYear, setPickerYear] = useState(() => Number(month.split("-")[0]) || 2026);

  // Estado de edição inline
  const [editingCell, setEditingCell] = useState<{
    operatorId: string;
    field: "targetValue" | "conversionRate";
  } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [savingInline, setSavingInline] = useState(false);

  const loadGoals = useCallback(async (selectedMonth: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/commercial/goals?month=${encodeURIComponent(selectedMonth)}`, {
        credentials: "same-origin",
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Falha ao carregar metas comerciais.");
      setData(json);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Erro ao carregar dados.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadGoals(month);
    setPickerYear(Number(month.split("-")[0]) || 2026);
  }, [month, loadGoals]);

  const handleMonthStep = (delta: number) => {
    const next = stepMonth(month, delta);
    setMonth(next);
  };

  const handleSelectMonth = (mIndex: number) => {
    const nextMonth = `${pickerYear}-${String(mIndex + 1).padStart(2, "0")}`;
    setMonth(nextMonth);
    setPopoverOpen(false);
  };

  const handleGoCurrentMonth = () => {
    const current = saoPauloDay().slice(0, 7);
    setMonth(current);
    setPickerYear(Number(current.split("-")[0]));
    setPopoverOpen(false);
  };

  // Iniciar edição inline
  const startEdit = (
    operatorId: string,
    field: "targetValue" | "conversionRate",
    currentVal: number
  ) => {
    setEditingCell({ operatorId, field });
    setEditValue(String(currentVal));
  };

  // Salvar edição inline
  const saveInlineEdit = async (operatorId: string, field: "targetValue" | "conversionRate") => {
    if (!data) return;
    const numVal = parseFloat(editValue.replace(",", "."));
    if (isNaN(numVal) || numVal < 0) {
      setEditingCell(null);
      return;
    }

    // Atualização otimista local
    const previousData = data;
    const updatedConsultants = data.consultants.map((c) => {
      if (c.operatorId !== operatorId) return c;
      const targetValue = field === "targetValue" ? numVal : c.targetValue;
      const conversionRate = field === "conversionRate" ? numVal : c.conversionRate;
      const dailyTarget = data.businessDays > 0 ? targetValue / data.businessDays : 0;
      const attainment = targetValue > 0 ? (c.realizedValue / targetValue) * 100 : 0;
      const gap = Math.max(0, targetValue - c.realizedValue);
      return {
        ...c,
        targetValue,
        conversionRate,
        dailyTarget,
        attainment,
        gap,
      };
    });

    const totalTarget = updatedConsultants.reduce((acc, c) => acc + c.targetValue, 0);
    const totalRealized = updatedConsultants.reduce((acc, c) => acc + c.realizedValue, 0);
    const totalGap = Math.max(0, totalTarget - totalRealized);
    const totalAttainment = totalTarget > 0 ? (totalRealized / totalTarget) * 100 : 0;
    const consultantsWithGoal = updatedConsultants.filter((c) => c.targetValue > 0).length;
    const dailyRequired = data.remainingDays > 0 ? totalGap / data.remainingDays : 0;
    const totalDailyTarget = data.businessDays > 0 ? totalTarget / data.businessDays : 0;
    const validRates = updatedConsultants.filter((c) => c.targetValue > 0).map((c) => c.conversionRate);
    const avgConversionRate =
      validRates.length > 0 ? validRates.reduce((a, b) => a + b, 0) / validRates.length : 10;

    setData({
      ...data,
      consultants: updatedConsultants,
      totals: {
        ...data.totals,
        targetValue: totalTarget,
        realizedValue: totalRealized,
        gap: totalGap,
        attainment: totalAttainment,
        consultantsWithGoal,
        dailyRequired,
        totalDailyTarget,
        avgConversionRate,
      },
    });

    setEditingCell(null);
    setSavingInline(true);

    try {
      const payload: Record<string, unknown> = {
        month,
        operatorId,
      };
      if (field === "targetValue") {
        payload.targetValue = numVal;
      } else {
        payload.conversionRate = numVal;
      }

      const response = await fetch("/api/commercial/goals", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const resJson = await response.json();
        throw new Error(resJson.error || "Falha ao salvar meta.");
      }
    } catch (err) {
      console.error("Erro ao salvar meta inline:", err);
      // Rollback se falhar
      setData(previousData);
      setError(err instanceof Error ? err.message : "Erro ao salvar alteração.");
    } finally {
      setSavingInline(false);
    }
  };

  const totals = data?.totals || {
    targetValue: 0,
    realizedValue: 0,
    gap: 0,
    attainment: 0,
    consultantsWithGoal: 0,
    dailyRequired: 0,
    totalDailyTarget: 0,
    avgConversionRate: 10,
  };

  const businessDays = data?.businessDays ?? 22;
  const elapsedDays = data?.elapsedDays ?? 0;
  const remainingDays = data?.remainingDays ?? 0;
  const consultants = data?.consultants ?? [];

  return (
    <div className="flex flex-col gap-6">
      {/* ─── Top Header Section ─── */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <span className="text-[10px] font-mono font-bold uppercase tracking-[.18em] text-primary block">
            PLANEJAMENTO
          </span>
          <h1 className="font-mono text-xl sm:text-2xl font-bold tracking-[-.04em] text-foreground dark:text-zinc-50 mt-0.5">
            Metas Comerciais
          </h1>
          <p className="text-xs text-muted-foreground dark:text-zinc-400 mt-1">
            Defina e edite metas mensais por consultor. Clique no valor para editar inline.
          </p>
        </div>

        {/* Month Selector / Navigator Controls */}
        <div className="flex items-center gap-1.5 self-start sm:self-auto font-mono">
          {/* Previous Month */}
          <SystemTooltip content="Mês anterior">
            <button
              onClick={() => handleMonthStep(-1)}
              className="p-2 rounded-[4px] border border-border/80 dark:border-zinc-800 bg-card dark:bg-zinc-950/70 hover:bg-muted dark:hover:bg-zinc-900 text-muted-foreground hover:text-foreground transition shadow-sm cursor-pointer flex items-center justify-center"
              aria-label="Mês anterior"
            >
              <ChevronUp className="h-4 w-4" />
            </button>
          </SystemTooltip>

          {/* Month Button with custom Popover */}
          <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
            <SystemTooltip content="Clique para selecionar outro mês">
              <PopoverTrigger asChild>
                <button className="px-3.5 py-2 rounded-[4px] border border-border/80 dark:border-zinc-800 bg-card dark:bg-zinc-950/70 hover:bg-muted dark:hover:bg-zinc-900 text-xs font-mono font-bold text-foreground transition shadow-sm flex items-center gap-2 cursor-pointer">
                  <span>{formatMonthLabel(month)}</span>
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              </PopoverTrigger>
            </SystemTooltip>

            <PopoverContent align="end" className="w-64 p-3 bg-card dark:bg-zinc-950 border border-border/80 dark:border-zinc-800 shadow-xl rounded-[4px] font-mono">
              {/* Year Navigation */}
              <div className="flex items-center justify-between mb-3 px-1">
                <SystemTooltip content="Ano anterior">
                  <button
                    onClick={() => setPickerYear((y) => y - 1)}
                    className="p-1 rounded-[2px] hover:bg-muted dark:hover:bg-zinc-800 text-muted-foreground hover:text-foreground transition cursor-pointer"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                </SystemTooltip>
                <span className="text-xs font-bold text-foreground dark:text-zinc-100 font-mono">{pickerYear}</span>
                <SystemTooltip content="Próximo ano">
                  <button
                    onClick={() => setPickerYear((y) => y + 1)}
                    className="p-1 rounded-[2px] hover:bg-muted dark:hover:bg-zinc-800 text-muted-foreground hover:text-foreground transition cursor-pointer"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </SystemTooltip>
              </div>

              {/* 12 Months Grid */}
              <div className="grid grid-cols-3 gap-1.5">
                {MONTH_SHORT.map((mName, idx) => {
                  const mStr = `${pickerYear}-${String(idx + 1).padStart(2, "0")}`;
                  const isSelected = month === mStr;
                  return (
                    <button
                      key={mName}
                      onClick={() => handleSelectMonth(idx)}
                      className={`py-1.5 text-xs font-mono font-bold rounded-[2px] transition cursor-pointer ${
                        isSelected
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "hover:bg-muted dark:hover:bg-zinc-800 text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {mName}
                    </button>
                  );
                })}
              </div>

              {/* Quick Today Button */}
              <div className="mt-3 pt-2 border-t border-border/80 dark:border-zinc-800 flex justify-end">
                <button
                  onClick={handleGoCurrentMonth}
                  className="text-[10px] font-mono font-bold uppercase tracking-wider text-primary hover:underline cursor-pointer"
                >
                  Mês atual
                </button>
              </div>
            </PopoverContent>
          </Popover>

          {/* Next Month */}
          <SystemTooltip content="Próximo mês">
            <button
              onClick={() => handleMonthStep(1)}
              className="p-2 rounded-[4px] border border-border/80 dark:border-zinc-800 bg-card dark:bg-zinc-950/70 hover:bg-muted dark:hover:bg-zinc-900 text-muted-foreground hover:text-foreground transition shadow-sm cursor-pointer flex items-center justify-center"
              aria-label="Próximo mês"
            >
              <ChevronDown className="h-4 w-4" />
            </button>
          </SystemTooltip>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="flex items-center gap-2 rounded-[4px] border border-red-500/30 bg-red-500/10 dark:bg-red-950/40 p-3.5 text-xs font-mono font-semibold text-red-600 dark:text-red-400">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* ─── 4 Metric Cards (Cockpit Metas) ─── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Meta total do mês */}
        <div className="rounded-[4px] border border-border/80 bg-card dark:border-zinc-800 dark:bg-zinc-950/70 p-5 relative overflow-hidden transition-all duration-200 hover:border-border/80 dark:hover:border-zinc-700 shadow-sm before:absolute before:top-0 before:left-0 before:right-0 before:h-[2px] before:bg-primary">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono font-bold uppercase tracking-[.14em] text-muted-foreground dark:text-zinc-400">
              Meta total do mês
            </span>
            <SystemTooltip content="Soma de todas as metas estipuladas para os consultores no mês">
              <div className="w-7 h-7 rounded-[2px] bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                <Target className="h-3.5 w-3.5" />
              </div>
            </SystemTooltip>
          </div>
          <div className="text-2xl font-bold text-foreground dark:text-zinc-50 tracking-tight font-mono mt-3">
            {formatCurrency(totals.targetValue)}
          </div>
          <div className="text-[11px] font-mono text-muted-foreground dark:text-zinc-400 mt-2">
            {totals.consultantsWithGoal} consultores com meta
          </div>
        </div>

        {/* Card 2: Realizado */}
        <div className="rounded-[4px] border border-border/80 bg-card dark:border-zinc-800 dark:bg-zinc-950/70 p-5 relative overflow-hidden transition-all duration-200 hover:border-border/80 dark:hover:border-zinc-700 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono font-bold uppercase tracking-[.14em] text-muted-foreground dark:text-zinc-400">
              Realizado
            </span>
            <SystemTooltip content="Volume financeiro total faturado em negociações ganhas no mês">
              <div className="w-7 h-7 rounded-[2px] bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                <CircleDollarSign className="h-3.5 w-3.5" />
              </div>
            </SystemTooltip>
          </div>
          <div className="text-2xl font-bold text-foreground dark:text-zinc-50 tracking-tight font-mono mt-3">
            {formatCurrency(totals.realizedValue)}
          </div>
          <div className="w-full bg-muted/40 dark:bg-zinc-800 h-1.5 rounded-[2px] overflow-hidden mt-3">
            <div
              className="bg-primary h-full transition-all duration-500 rounded-[2px]"
              style={{ width: `${Math.min(100, totals.attainment)}%` }}
            />
          </div>
          <div className="text-[11px] font-mono text-muted-foreground dark:text-zinc-400 mt-1.5">
            {totals.attainment.toFixed(1).replace(".", ",")}% da meta
          </div>
        </div>

        {/* Card 3: Dias úteis */}
        <div className="rounded-[4px] border border-border/80 bg-card dark:border-zinc-800 dark:bg-zinc-950/70 p-5 relative overflow-hidden transition-all duration-200 hover:border-border/80 dark:hover:border-zinc-700 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono font-bold uppercase tracking-[.14em] text-muted-foreground dark:text-zinc-400">
              Dias úteis
            </span>
            <SystemTooltip content="Dias úteis comerciais considerando feriados e expediente de sábado">
              <div className="w-7 h-7 rounded-[2px] bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                <CalendarDays className="h-3.5 w-3.5" />
              </div>
            </SystemTooltip>
          </div>
          <div className="text-2xl font-bold text-foreground dark:text-zinc-50 tracking-tight font-mono mt-3">
            {elapsedDays}/{businessDays}
          </div>
          <div className="text-[11px] font-mono text-muted-foreground dark:text-zinc-400 mt-2">
            {remainingDays} restantes
          </div>
        </div>

        {/* Card 4: Meta diária necessária */}
        <div className="rounded-[4px] border border-border/80 bg-card dark:border-zinc-800 dark:bg-zinc-950/70 p-5 relative overflow-hidden transition-all duration-200 hover:border-border/80 dark:hover:border-zinc-700 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono font-bold uppercase tracking-[.14em] text-muted-foreground dark:text-zinc-400">
              Meta diária necessária
            </span>
            <SystemTooltip content="Ritmo diário de vendas necessário nos dias úteis restantes para atingir a meta">
              <div className="w-7 h-7 rounded-[2px] bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                <Gauge className="h-3.5 w-3.5" />
              </div>
            </SystemTooltip>
          </div>
          <div className="text-2xl font-bold text-foreground dark:text-zinc-50 tracking-tight font-mono mt-3">
            {formatCurrency(totals.dailyRequired)}
          </div>
          <div className="text-[11px] font-mono text-muted-foreground dark:text-zinc-400 mt-2">
            para atingir a meta
          </div>
        </div>
      </div>

      {/* ─── Main Table Container: Metas por Consultor ─── */}
      <div className="rounded-[4px] border border-border/80 bg-card dark:border-zinc-800 dark:bg-zinc-950/70 p-6 shadow-sm space-y-4">
        {/* Table Title & Instructions */}
        <div>
          <h2 className="text-sm font-mono font-bold text-foreground dark:text-zinc-100">
            Metas por Consultor — {formatMonthLong(month)}
          </h2>
          <p className="text-xs text-muted-foreground dark:text-zinc-400 mt-0.5">
            Clique no valor da meta para editar inline. Pressione Enter para salvar.
          </p>
        </div>

        {loading ? (
          <div className="flex min-h-[260px] items-center justify-center text-primary">
            <Loader2 className="h-7 w-7 animate-spin" />
          </div>
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-left border-collapse font-sans">
              <thead>
                <tr className="border-b border-border/80 dark:border-zinc-800 text-[10px] font-mono font-bold uppercase tracking-[.14em] text-muted-foreground dark:text-zinc-400">
                  <th className="py-3 px-3 min-w-[200px]">Consultor</th>
                  <th className="py-3 px-3 min-w-[130px]">Equipe</th>
                  <th className="py-3 px-3 min-w-[150px]">Meta Mensal</th>
                  <th className="py-3 px-3 min-w-[130px]">Taxa Conversão</th>
                  <th className="py-3 px-3 min-w-[130px]">Meta Diária</th>
                  <th className="py-3 px-3 min-w-[130px]">Realizado</th>
                  <th className="py-3 px-3 min-w-[150px]">Atingimento</th>
                  <th className="py-3 px-3 min-w-[130px] text-right">GAP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40 dark:divide-zinc-800/60 text-xs">
                {consultants.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-muted-foreground dark:text-zinc-400 text-xs font-mono">
                      Nenhum consultor cadastrado no sistema.
                    </td>
                  </tr>
                ) : (
                  consultants.map((consultant) => {
                    const isEditingTarget =
                      editingCell?.operatorId === consultant.operatorId &&
                      editingCell?.field === "targetValue";
                    const isEditingRate =
                      editingCell?.operatorId === consultant.operatorId &&
                      editingCell?.field === "conversionRate";

                    return (
                      <tr
                        key={consultant.operatorId}
                        className="hover:bg-muted/20 dark:hover:bg-zinc-900/50 transition-colors group"
                      >
                        {/* Consultor (Avatar + Nome) */}
                        <td className="py-3 px-3">
                          <div className="flex items-center gap-2.5">
                            {consultant.avatar ? (
                              <img
                                src={consultant.avatar}
                                alt={consultant.name}
                                className="w-7 h-7 rounded-[2px] object-cover shrink-0 border border-border/80 dark:border-zinc-800"
                              />
                            ) : (
                              <div className="w-7 h-7 rounded-[2px] bg-primary/10 text-primary font-mono font-bold text-[11px] flex items-center justify-center shrink-0 border border-primary/20">
                                {getInitials(consultant.name)}
                              </div>
                            )}
                            <span className="font-semibold text-foreground dark:text-zinc-100 truncate max-w-[200px]">
                              {consultant.name}
                            </span>
                          </div>
                        </td>

                        {/* Equipe */}
                        <td className="py-3 px-3 text-[10px] font-mono font-bold uppercase tracking-wider text-muted-foreground dark:text-zinc-400">
                          {consultant.division || "—"}
                        </td>

                        {/* Meta Mensal (Inline Edit) */}
                        <td className="py-3 px-3">
                          {isEditingTarget ? (
                            <input
                              type="text"
                              autoFocus
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  void saveInlineEdit(consultant.operatorId, "targetValue");
                                } else if (e.key === "Escape") {
                                  setEditingCell(null);
                                }
                              }}
                              onBlur={() => {
                                void saveInlineEdit(consultant.operatorId, "targetValue");
                              }}
                              className="w-32 rounded-[2px] border border-primary bg-background dark:bg-zinc-900 px-2.5 py-1 text-xs font-mono font-bold text-foreground outline-none ring-1 ring-primary"
                            />
                          ) : (
                            <SystemTooltip content="Clique para editar a meta mensal">
                              <button
                                onClick={() =>
                                  startEdit(
                                    consultant.operatorId,
                                    "targetValue",
                                    consultant.targetValue
                                  )
                                }
                                className="inline-flex items-center gap-1.5 py-1 px-1.5 rounded-[2px] text-xs font-mono font-bold text-foreground hover:text-primary hover:bg-muted/40 dark:hover:bg-zinc-800 transition cursor-pointer"
                              >
                                <span>{formatCurrency(consultant.targetValue, true)}</span>
                                <Pencil className="h-3 w-3 text-muted-foreground/40 group-hover:text-primary transition" />
                              </button>
                            </SystemTooltip>
                          )}
                        </td>

                        {/* Taxa Conversão (Inline Edit) */}
                        <td className="py-3 px-3">
                          {isEditingRate ? (
                            <input
                              type="number"
                              min="0"
                              max="100"
                              step="0.1"
                              autoFocus
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  void saveInlineEdit(consultant.operatorId, "conversionRate");
                                } else if (e.key === "Escape") {
                                  setEditingCell(null);
                                }
                              }}
                              onBlur={() => {
                                void saveInlineEdit(consultant.operatorId, "conversionRate");
                              }}
                              className="w-20 rounded-[2px] border border-primary bg-background dark:bg-zinc-900 px-2.5 py-1 text-xs font-mono font-bold text-foreground outline-none ring-1 ring-primary"
                            />
                          ) : (
                            <SystemTooltip content="Clique para editar a taxa de conversão">
                              <button
                                onClick={() =>
                                  startEdit(
                                    consultant.operatorId,
                                    "conversionRate",
                                    consultant.conversionRate
                                  )
                                }
                                className="inline-flex items-center gap-1.5 py-1 px-1.5 rounded-[2px] text-xs font-mono font-bold text-foreground hover:text-primary hover:bg-muted/40 dark:hover:bg-zinc-800 transition cursor-pointer"
                              >
                                <span>{consultant.conversionRate}%</span>
                                <Pencil className="h-3 w-3 text-muted-foreground/40 group-hover:text-primary transition" />
                              </button>
                            </SystemTooltip>
                          )}
                        </td>

                        {/* Meta Diária */}
                        <td className="py-3 px-3 font-mono text-muted-foreground dark:text-zinc-400">
                          <SystemTooltip content="Meta diária proporcional (Meta Mensal / Dias Úteis)">
                            <span>{formatCurrency(consultant.dailyTarget)}</span>
                          </SystemTooltip>
                        </td>

                        {/* Realizado */}
                        <td className="py-3 px-3 font-mono font-semibold text-foreground dark:text-zinc-100">
                          <SystemTooltip content="Volume de faturamento de negociações ganhas no mês">
                            <span>{formatCurrency(consultant.realizedValue)}</span>
                          </SystemTooltip>
                        </td>

                        {/* Atingimento */}
                        <td className="py-3 px-3">
                          <SystemTooltip content="Percentual de atingimento da meta mensal">
                            <div className="flex items-center gap-2">
                              <div className="w-14 bg-muted/40 dark:bg-zinc-800 h-1.5 rounded-[2px] overflow-hidden shrink-0">
                                <div
                                  className="bg-primary h-full rounded-[2px] transition-all duration-300"
                                  style={{
                                    width: `${Math.min(100, consultant.attainment)}%`,
                                  }}
                                />
                              </div>
                              <span className="font-mono text-[11px] text-muted-foreground dark:text-zinc-400 w-12 text-right">
                                {consultant.attainment.toFixed(1)}%
                              </span>
                            </div>
                          </SystemTooltip>
                        </td>

                        {/* GAP */}
                        <td className="py-3 px-3 font-mono font-bold text-primary text-right">
                          <SystemTooltip content="Diferença pendente para atingir a meta">
                            <span>{formatCurrency(consultant.gap)}</span>
                          </SystemTooltip>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>

              {/* ─── Footer: TOTAL GERAL ─── */}
              {consultants.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-border/80 dark:border-zinc-800 text-xs font-mono font-bold">
                    <td className="py-4 px-3 uppercase tracking-wider text-foreground dark:text-zinc-100">
                      TOTAL GERAL
                    </td>
                    <td className="py-4 px-3" />
                    <td className="py-4 px-3 font-mono text-foreground dark:text-zinc-100">
                      {formatCurrency(totals.targetValue)}
                    </td>
                    <td className="py-4 px-3 font-mono text-muted-foreground dark:text-zinc-400 font-semibold">
                      {totals.avgConversionRate.toFixed(1)}% méd.
                    </td>
                    <td className="py-4 px-3 font-mono text-muted-foreground dark:text-zinc-400 font-semibold">
                      {formatCurrency(totals.totalDailyTarget)}
                    </td>
                    <td className="py-4 px-3 font-mono text-foreground dark:text-zinc-100">
                      {formatCurrency(totals.realizedValue)}
                    </td>
                    <td className="py-4 px-3">
                      <div className="flex items-center gap-2">
                        <div className="w-14 bg-muted/40 dark:bg-zinc-800 h-1.5 rounded-[2px] overflow-hidden shrink-0">
                          <div
                            className="bg-primary h-full rounded-[2px] transition-all duration-300"
                            style={{ width: `${Math.min(100, totals.attainment)}%` }}
                          />
                        </div>
                        <span className="font-mono text-[11px] text-foreground dark:text-zinc-100 font-bold w-12 text-right">
                          {totals.attainment.toFixed(1)}%
                        </span>
                      </div>
                    </td>
                    <td className="py-4 px-3 font-mono font-bold text-primary text-right">
                      {formatCurrency(totals.gap)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
