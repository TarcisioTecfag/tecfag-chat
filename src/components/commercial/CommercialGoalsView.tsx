import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleDollarSign,
  Gauge,
  Loader2,
  Pencil,
  Target,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { SystemTooltip } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { saoPauloDay } from "@/lib/commercial/metrics";
import { getDeterministicConsultantAvatar } from "@/lib/commercial/avatar-matcher";

export type ConsultantGoalItem = {
  operatorId: string;
  name: string;
  email: string;
  avatar: string | null;
  division: string | null;
  activeOnTv: boolean;
  targetValue: number;
  conversionRate: number;
  openPortfolioValue?: number;
  openPortfolioCount?: number;
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
    totalOpenPortfolioValue?: number;
    totalOpenPortfolioCount?: number;
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

/**
 * Converte entradas flexíveis (ex: "300000", "300.000", "300.000,00", "10,5") em número válido.
 */
function parseFlexibleNumber(raw: string, field: "targetValue" | "conversionRate"): number {
  const cleaned = raw.replace(/[R$\s%]/gi, "").trim();
  if (!cleaned) return NaN;

  if (field === "targetValue") {
    // Se tiver ponto e vírgula (ex: "300.000,50"), ponto é milhar e vírgula é decimal
    if (cleaned.includes(".") && cleaned.includes(",")) {
      return Number(cleaned.replace(/\./g, "").replace(",", "."));
    }
    // Se tiver múltiplos pontos ou ponto seguido de 3 dígitos (ex: "300.000" ou "1.000.000"), ponto é milhar
    if (/^\d{1,3}(\.\d{3})+$/.test(cleaned)) {
      return Number(cleaned.replace(/\./g, ""));
    }
    return Number(cleaned.replace(",", "."));
  }

  return Number(cleaned.replace(",", "."));
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

  // Seleção em massa de consultores
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkTargetInput, setBulkTargetInput] = useState("");
  const [bulkRateInput, setBulkRateInput] = useState("");
  const [savingBulk, setSavingBulk] = useState(false);

  // Estado de edição inline
  const [editingCell, setEditingCell] = useState<{
    operatorId: string;
    field: "targetValue" | "conversionRate";
  } | null>(null);
  const [editValue, setEditValue] = useState("");
  const committingRef = useRef(false);

  const loadGoals = useCallback(async (selectedMonth: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/commercial/goals?month=${encodeURIComponent(selectedMonth)}`,
        {
          credentials: "same-origin",
        },
      );
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

  const baseConsultants = useMemo(() => {
    return (data?.consultants ?? []).filter((c) => Boolean(c.division));
  }, [data?.consultants]);

  const businessDays = data?.businessDays ?? 22;
  const elapsedDays = data?.elapsedDays ?? 0;
  const remainingDays = data?.remainingDays ?? 0;
  const isCurrentMonth = month === saoPauloDay().slice(0, 7);
  const effectiveRemainingDays =
    remainingDays > 0 ? remainingDays : isCurrentMonth ? 1 : Math.max(1, businessDays);

  // Quais consultores são afetados pela edição inline atual (se o consultor editado estiver selecionado, reflete em todos os selecionados!)
  const affectedInlineOperatorIds = useMemo(() => {
    if (!editingCell) return new Set<string>();
    if (selectedIds.size > 1 && selectedIds.has(editingCell.operatorId)) {
      return new Set(selectedIds);
    }
    return new Set([editingCell.operatorId]);
  }, [editingCell, selectedIds]);

  // Cálculo em tempo real (live preview) das linhas da tabela enquanto o usuário digita na célula ou na barra em massa
  const liveConsultants = useMemo(() => {
    const liveInlineVal =
      editingCell && editValue.trim() !== ""
        ? parseFlexibleNumber(editValue, editingCell.field)
        : NaN;
    const validInlineVal =
      Number.isFinite(liveInlineVal) &&
      liveInlineVal >= 0 &&
      (editingCell?.field !== "conversionRate" || liveInlineVal <= 100)
        ? liveInlineVal
        : null;

    return baseConsultants.map((c) => {
      let targetValue = c.targetValue;
      let conversionRate = c.conversionRate;

      if (validInlineVal !== null && affectedInlineOperatorIds.has(c.operatorId)) {
        if (editingCell?.field === "targetValue") {
          targetValue = validInlineVal;
        } else if (editingCell?.field === "conversionRate") {
          conversionRate = validInlineVal;
        }
      }

      const dailyTarget = businessDays > 0 ? targetValue / businessDays : 0;
      const attainment = targetValue > 0 ? (c.realizedValue / targetValue) * 100 : 0;
      const gap = Math.max(0, targetValue - c.realizedValue);

      return {
        ...c,
        targetValue,
        conversionRate,
        openPortfolioValue: c.openPortfolioValue ?? 0,
        openPortfolioCount: c.openPortfolioCount ?? 0,
        dailyTarget,
        attainment,
        gap,
      };
    });
  }, [baseConsultants, editingCell, editValue, affectedInlineOperatorIds, businessDays]);

  // Totais recalculados em tempo real (sempre sincronizados com cada consultor)
  const totals = useMemo(() => {
    const targetValue = liveConsultants.reduce((acc, c) => acc + c.targetValue, 0);
    const realizedValue = liveConsultants.reduce((acc, c) => acc + c.realizedValue, 0);
    const totalOpenPortfolioValue = liveConsultants.reduce(
      (acc, c) => acc + (c.openPortfolioValue || 0),
      0,
    );
    const totalOpenPortfolioCount = liveConsultants.reduce(
      (acc, c) => acc + (c.openPortfolioCount || 0),
      0,
    );
    const gap = Math.max(0, targetValue - realizedValue);
    const attainment = targetValue > 0 ? (realizedValue / targetValue) * 100 : 0;
    const consultantsWithGoal = liveConsultants.filter((c) => c.targetValue > 0).length;
    const dailyRequired = effectiveRemainingDays > 0 ? gap / effectiveRemainingDays : 0;
    const totalDailyTarget = businessDays > 0 ? targetValue / businessDays : 0;
    const validRates = liveConsultants
      .filter((c) => c.targetValue > 0)
      .map((c) => c.conversionRate);
    const avgConversionRate =
      validRates.length > 0
        ? validRates.reduce((a, b) => a + b, 0) / validRates.length
        : liveConsultants.length > 0
          ? liveConsultants.reduce((a, b) => a + b.conversionRate, 0) / liveConsultants.length
          : 10;

    return {
      targetValue,
      realizedValue,
      totalOpenPortfolioValue,
      totalOpenPortfolioCount,
      gap,
      attainment,
      consultantsWithGoal,
      dailyRequired,
      totalDailyTarget,
      avgConversionRate,
    };
  }, [liveConsultants, effectiveRemainingDays, businessDays]);

  // Persistir alteração para 1 ou N consultores
  const persistGoalChange = useCallback(
    async (
      targetIds: string[],
      updates: { targetValue?: number; conversionRate?: number },
    ) => {
      if (!data || targetIds.length === 0) return;
      const idSet = new Set(targetIds);
      const previousData = data;

      const updatedConsultants = data.consultants.map((c) => {
        if (!idSet.has(c.operatorId)) return c;
        const targetValue =
          updates.targetValue !== undefined ? updates.targetValue : c.targetValue;
        const conversionRate =
          updates.conversionRate !== undefined ? updates.conversionRate : c.conversionRate;
        const dailyTarget = businessDays > 0 ? targetValue / businessDays : 0;
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

      setData({
        ...data,
        consultants: updatedConsultants,
      });

      try {
        const payload: Record<string, unknown> = {
          month,
          operatorIds: targetIds,
          operatorId: targetIds[0],
        };
        if (updates.targetValue !== undefined) payload.targetValue = updates.targetValue;
        if (updates.conversionRate !== undefined) payload.conversionRate = updates.conversionRate;

        const response = await fetch("/api/commercial/goals", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const resJson = await response.json().catch(() => ({}));
          throw new Error(resJson.error || "Falha ao salvar meta.");
        }

        if (targetIds.length > 1) {
          toast.success(`Alteração aplicada em ${targetIds.length} consultores selecionados!`);
        }
      } catch (err) {
        console.error("Erro ao salvar meta:", err);
        setData(previousData);
        setError(err instanceof Error ? err.message : "Erro ao salvar alteração.");
        toast.error(err instanceof Error ? err.message : "Erro ao salvar alteração.");
      }
    },
    [data, businessDays, month],
  );

  // Iniciar edição inline
  const startEdit = (
    operatorId: string,
    field: "targetValue" | "conversionRate",
    currentVal: number,
  ) => {
    setEditingCell({ operatorId, field });
    setEditValue(String(currentVal));
  };

  // Salvar edição inline (com suporte automático a múltiplos consultores selecionados)
  const commitInlineEdit = async (
    operatorId: string,
    field: "targetValue" | "conversionRate",
  ) => {
    if (committingRef.current) return;
    committingRef.current = true;
    try {
      const numVal = parseFlexibleNumber(editValue, field);
      setEditingCell(null);

      if (
        !Number.isFinite(numVal) ||
        numVal < 0 ||
        (field === "conversionRate" && numVal > 100)
      ) {
        return;
      }

      const targetIds =
        selectedIds.size > 1 && selectedIds.has(operatorId)
          ? Array.from(selectedIds)
          : [operatorId];

      await persistGoalChange(
        targetIds,
        field === "targetValue" ? { targetValue: numVal } : { conversionRate: numVal },
      );
    } finally {
      committingRef.current = false;
    }
  };

  // Aplicar edição em massa pela barra superior
  const handleApplyBulk = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedIds.size === 0) return;

    const updates: { targetValue?: number; conversionRate?: number } = {};
    if (bulkTargetInput.trim() !== "") {
      const parsedTarget = parseFlexibleNumber(bulkTargetInput, "targetValue");
      if (!Number.isFinite(parsedTarget) || parsedTarget < 0) {
        toast.error("Informe uma Meta Mensal válida.");
        return;
      }
      updates.targetValue = parsedTarget;
    }
    if (bulkRateInput.trim() !== "") {
      const parsedRate = parseFlexibleNumber(bulkRateInput, "conversionRate");
      if (!Number.isFinite(parsedRate) || parsedRate < 0 || parsedRate > 100) {
        toast.error("Informe uma Taxa de Conversão válida entre 0% e 100%.");
        return;
      }
      updates.conversionRate = parsedRate;
    }

    if (updates.targetValue === undefined && updates.conversionRate === undefined) {
      toast.info("Preencha a Meta Mensal ou a Taxa de Conversão para aplicar aos selecionados.");
      return;
    }

    setSavingBulk(true);
    try {
      await persistGoalChange(Array.from(selectedIds), updates);
      setBulkTargetInput("");
      setBulkRateInput("");
    } finally {
      setSavingBulk(false);
    }
  };

  const allSelected =
    liveConsultants.length > 0 &&
    liveConsultants.every((c) => selectedIds.has(c.operatorId));

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(liveConsultants.map((c) => c.operatorId)));
    }
  };

  const toggleSelectOne = (operatorId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(operatorId)) next.delete(operatorId);
      else next.add(operatorId);
      return next;
    });
  };

  const selectByTeam = (division: "maquinas" | "personnalite") => {
    setSelectedIds(
      new Set(
        liveConsultants
          .filter((c) => c.division?.toLowerCase() === division)
          .map((c) => c.operatorId),
      ),
    );
  };

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
            Defina e edite metas mensais por consultor individualmente ou em massa.
          </p>
        </div>

        {/* Month Selector / Navigator Controls */}
        <div className="flex items-center gap-1.5 self-start sm:self-auto font-mono">
          <SystemTooltip content="Mês anterior">
            <button
              type="button"
              onClick={() => handleMonthStep(-1)}
              className="p-2 rounded-[4px] border border-border/80 dark:border-zinc-800 bg-card dark:bg-zinc-950/70 hover:bg-muted dark:hover:bg-zinc-900 text-muted-foreground hover:text-foreground transition shadow-sm cursor-pointer flex items-center justify-center"
              aria-label="Mês anterior"
            >
              <ChevronUp className="h-4 w-4" />
            </button>
          </SystemTooltip>

          <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
            <SystemTooltip content="Clique para selecionar outro mês">
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="px-3.5 py-2 rounded-[4px] border border-border/80 dark:border-zinc-800 bg-card dark:bg-zinc-950/70 hover:bg-muted dark:hover:bg-zinc-900 text-xs font-mono font-bold text-foreground transition shadow-sm flex items-center gap-2 cursor-pointer"
                >
                  <span>{formatMonthLabel(month)}</span>
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              </PopoverTrigger>
            </SystemTooltip>

            <PopoverContent
              align="end"
              className="w-64 p-3 bg-card dark:bg-zinc-950 border border-border/80 dark:border-zinc-800 shadow-xl rounded-[4px] font-mono"
            >
              <div className="flex items-center justify-between mb-3 px-1">
                <SystemTooltip content="Ano anterior">
                  <button
                    type="button"
                    onClick={() => setPickerYear((y) => y - 1)}
                    className="p-1 rounded-[2px] hover:bg-muted dark:hover:bg-zinc-800 text-muted-foreground hover:text-foreground transition cursor-pointer"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                </SystemTooltip>
                <span className="text-xs font-bold text-foreground dark:text-zinc-100 font-mono">
                  {pickerYear}
                </span>
                <SystemTooltip content="Próximo ano">
                  <button
                    type="button"
                    onClick={() => setPickerYear((y) => y + 1)}
                    className="p-1 rounded-[2px] hover:bg-muted dark:hover:bg-zinc-800 text-muted-foreground hover:text-foreground transition cursor-pointer"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </SystemTooltip>
              </div>

              <div className="grid grid-cols-3 gap-1.5">
                {MONTH_SHORT.map((mName, idx) => {
                  const mStr = `${pickerYear}-${String(idx + 1).padStart(2, "0")}`;
                  const isSelected = month === mStr;
                  return (
                    <SystemTooltip key={mName} content={`Selecionar ${MONTH_NAMES[idx]} de ${pickerYear}`}>
                      <button
                        type="button"
                        onClick={() => handleSelectMonth(idx)}
                        className={`py-1.5 text-xs font-mono font-bold rounded-[2px] transition cursor-pointer ${
                          isSelected
                            ? "bg-primary text-primary-foreground shadow-sm"
                            : "hover:bg-muted dark:hover:bg-zinc-800 text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {mName}
                      </button>
                    </SystemTooltip>
                  );
                })}
              </div>

              <div className="mt-3 pt-2 border-t border-border/80 dark:border-zinc-800 flex justify-end">
                <SystemTooltip content="Voltar para o mês corrente">
                  <button
                    type="button"
                    onClick={handleGoCurrentMonth}
                    className="text-[10px] font-mono font-bold uppercase tracking-wider text-primary hover:underline cursor-pointer"
                  >
                    Mês atual
                  </button>
                </SystemTooltip>
              </div>
            </PopoverContent>
          </Popover>

          <SystemTooltip content="Próximo mês">
            <button
              type="button"
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
            {totals.consultantsWithGoal} consultores com meta •{" "}
            {formatCurrency(totals.totalDailyTarget)}/dia útil
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
            {totals.attainment.toFixed(1).replace(".", ",")}% da meta • Carteira:{" "}
            {formatCurrency(totals.totalOpenPortfolioValue)}
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
            {remainingDays} restantes no mês
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
            Meta diária linear: {formatCurrency(totals.totalDailyTarget)}
          </div>
        </div>
      </div>

      {/* ─── Main Table Container: Metas por Consultor ─── */}
      <div className="rounded-[4px] border border-border/80 bg-card dark:border-zinc-800 dark:bg-zinc-950/70 p-6 shadow-sm space-y-4">
        {/* Table Title, Quick Bulk Selection & Mass Action Bar */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-mono font-bold text-foreground dark:text-zinc-100">
              Metas por Consultor — {formatMonthLong(month)}
            </h2>
            <p className="text-xs text-muted-foreground dark:text-zinc-400 mt-0.5">
              Selecione múltiplos consultores para editar em massa (ou clique em um selecionado para refletir em todos os marcados).
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 font-mono">
            <SystemTooltip content="Selecionar todos os consultores da lista">
              <button
                type="button"
                onClick={toggleSelectAll}
                className="px-2.5 py-1 rounded-[3px] border border-border/80 dark:border-zinc-800 bg-muted/30 dark:bg-zinc-900 text-[11px] font-bold text-muted-foreground hover:text-foreground transition cursor-pointer"
              >
                {allSelected ? "Desmarcar todos" : "Selecionar todos"}
              </button>
            </SystemTooltip>

            <SystemTooltip content="Selecionar todos os consultores da equipe Máquinas">
              <button
                type="button"
                onClick={() => selectByTeam("maquinas")}
                className="px-2.5 py-1 rounded-[3px] border border-border/80 dark:border-zinc-800 bg-muted/30 dark:bg-zinc-900 text-[11px] font-bold text-muted-foreground hover:text-foreground transition cursor-pointer"
              >
                Selecionar Máquinas
              </button>
            </SystemTooltip>

            <SystemTooltip content="Selecionar todos os consultores da equipe Personnalité">
              <button
                type="button"
                onClick={() => selectByTeam("personnalite")}
                className="px-2.5 py-1 rounded-[3px] border border-border/80 dark:border-zinc-800 bg-muted/30 dark:bg-zinc-900 text-[11px] font-bold text-muted-foreground hover:text-foreground transition cursor-pointer"
              >
                Selecionar Personnalité
              </button>
            </SystemTooltip>
          </div>
        </div>

        {/* Barra de Edição em Massa (Visível quando há consultores selecionados) */}
        {selectedIds.size > 0 && (
          <form
            onSubmit={(e) => void handleApplyBulk(e)}
            className="flex flex-wrap items-center justify-between gap-3 rounded-[4px] border border-primary/40 bg-primary/5 dark:bg-primary/10 px-4 py-3 font-mono"
          >
            <div className="flex items-center gap-2">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-[2px] bg-primary text-xs font-bold text-primary-foreground">
                {selectedIds.size}
              </span>
              <div>
                <div className="text-xs font-bold text-foreground dark:text-zinc-100">
                  {selectedIds.size === 1
                    ? "1 consultor selecionado"
                    : `${selectedIds.size} consultores selecionados para edição em massa`}
                </div>
                <div className="text-[10px] text-muted-foreground dark:text-zinc-400">
                  Preencha abaixo ou edite diretamente na linha de qualquer consultor selecionado para refletir em todos.
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <SystemTooltip content="Definir a mesma Meta Mensal (R$) para todos os consultores selecionados">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-bold uppercase text-muted-foreground">
                    Meta Mensal:
                  </span>
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="Ex: 340000"
                    value={bulkTargetInput}
                    onChange={(e) => setBulkTargetInput(e.target.value)}
                    className="w-32 rounded-[3px] border border-border/80 dark:border-zinc-700 bg-background dark:bg-zinc-900 px-2.5 py-1 text-xs font-mono font-bold text-foreground outline-none focus:border-primary"
                  />
                </div>
              </SystemTooltip>

              <SystemTooltip content="Definir a mesma Taxa de Conversão (%) para todos os consultores selecionados">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-bold uppercase text-muted-foreground">
                    Taxa (%):
                  </span>
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="Ex: 10"
                    value={bulkRateInput}
                    onChange={(e) => setBulkRateInput(e.target.value)}
                    className="w-20 rounded-[3px] border border-border/80 dark:border-zinc-700 bg-background dark:bg-zinc-900 px-2.5 py-1 text-xs font-mono font-bold text-foreground outline-none focus:border-primary"
                  />
                </div>
              </SystemTooltip>

              <SystemTooltip content="Aplicar os valores preenchidos a todos os consultores selecionados">
                <button
                  type="submit"
                  disabled={savingBulk}
                  className="inline-flex items-center gap-1.5 rounded-[3px] bg-primary px-3 py-1 text-xs font-mono font-bold text-primary-foreground shadow-sm hover:brightness-110 disabled:opacity-50 cursor-pointer"
                >
                  {savingBulk ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Users className="h-3.5 w-3.5" />
                  )}
                  <span>Aplicar em massa</span>
                </button>
              </SystemTooltip>

              <SystemTooltip content="Limpar seleção de consultores">
                <button
                  type="button"
                  onClick={() => setSelectedIds(new Set())}
                  className="inline-flex items-center justify-center h-7 w-7 rounded-[3px] border border-border/80 dark:border-zinc-700 bg-background dark:bg-zinc-900 text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </SystemTooltip>
            </div>
          </form>
        )}

        {loading ? (
          <div className="flex min-h-[260px] items-center justify-center text-primary">
            <Loader2 className="h-7 w-7 animate-spin" />
          </div>
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-left border-collapse font-sans">
              <thead>
                <tr className="border-b border-border/80 dark:border-zinc-800 text-[10px] font-mono font-bold uppercase tracking-[.14em] text-muted-foreground dark:text-zinc-400">
                  <th className="py-3 px-2.5 w-10 text-center">
                    <SystemTooltip
                      content={
                        allSelected
                          ? "Desmarcar todos os consultores"
                          : "Selecionar todos os consultores para edição em massa"
                      }
                    >
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={allSelected}
                        onClick={toggleSelectAll}
                        className={`mx-auto flex h-4 w-4 items-center justify-center rounded-[2px] border transition cursor-pointer ${
                          allSelected
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border/80 dark:border-zinc-700 bg-background dark:bg-zinc-900"
                        }`}
                      >
                        {allSelected && <Check className="h-3 w-3 stroke-[3]" />}
                      </button>
                    </SystemTooltip>
                  </th>
                  <th className="py-3 px-3 min-w-[190px]">
                    <SystemTooltip content="Consultor comercial ativo no mês">
                      <span className="cursor-help">Consultor</span>
                    </SystemTooltip>
                  </th>
                  <th className="py-3 px-3 min-w-[110px]">
                    <SystemTooltip content="Divisão ou equipe comercial do consultor">
                      <span className="cursor-help">Equipe</span>
                    </SystemTooltip>
                  </th>
                  <th className="py-3 px-3 min-w-[140px]">
                    <SystemTooltip content="Soma total das negociações com status em andamento na carteira do consultor">
                      <span className="cursor-help">Total em Carteira</span>
                    </SystemTooltip>
                  </th>
                  <th className="py-3 px-3 min-w-[145px]">
                    <SystemTooltip content="Meta de faturamento mensal do consultor (clique para editar)">
                      <span className="cursor-help">Meta Mensal</span>
                    </SystemTooltip>
                  </th>
                  <th className="py-3 px-3 min-w-[125px]">
                    <SystemTooltip content="Taxa de conversão estimada sobre a carteira (clique para editar)">
                      <span className="cursor-help">Taxa Conversão</span>
                    </SystemTooltip>
                  </th>
                  <th className="py-3 px-3 min-w-[125px]">
                    <SystemTooltip content="Meta diária linear do consultor (Meta Mensal ÷ Dias Úteis do mês)">
                      <span className="cursor-help">Meta Diária</span>
                    </SystemTooltip>
                  </th>
                  <th className="py-3 px-3 min-w-[125px]">
                    <SystemTooltip content="Volume financeiro de negociações ganhas no mês">
                      <span className="cursor-help">Realizado</span>
                    </SystemTooltip>
                  </th>
                  <th className="py-3 px-3 min-w-[140px]">
                    <SystemTooltip content="Percentual de atingimento da meta mensal">
                      <span className="cursor-help">Atingimento</span>
                    </SystemTooltip>
                  </th>
                  <th className="py-3 px-3 min-w-[125px] text-right">
                    <SystemTooltip content="Diferença pendente para atingir a meta mensal">
                      <span className="cursor-help">GAP</span>
                    </SystemTooltip>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40 dark:divide-zinc-800/60 text-xs">
                {liveConsultants.length === 0 ? (
                  <tr>
                    <td
                      colSpan={10}
                      className="py-8 text-center text-muted-foreground dark:text-zinc-400 text-xs font-mono"
                    >
                      Nenhum consultor comercial cadastrado na aba Consultores. Cadastre os consultores comerciais na aba &quot;Consultores&quot; para definir e acompanhar suas metas.
                    </td>
                  </tr>
                ) : (
                  liveConsultants.map((consultant) => {
                    const isSelected = selectedIds.has(consultant.operatorId);
                    const isEditingTarget =
                      editingCell?.operatorId === consultant.operatorId &&
                      editingCell?.field === "targetValue";
                    const isEditingRate =
                      editingCell?.operatorId === consultant.operatorId &&
                      editingCell?.field === "conversionRate";
                    const isMassPreviewRow =
                      affectedInlineOperatorIds.has(consultant.operatorId) &&
                      editingCell?.operatorId !== consultant.operatorId;

                    return (
                      <tr
                        key={consultant.operatorId}
                        className={`transition-colors group ${
                          isSelected
                            ? "bg-primary/5 dark:bg-primary/10 hover:bg-primary/10 dark:hover:bg-primary/15"
                            : "hover:bg-muted/20 dark:hover:bg-zinc-900/50"
                        }`}
                      >
                        {/* Checkbox de Seleção */}
                        <td className="py-3 px-2.5 text-center">
                          <SystemTooltip
                            content={
                              isSelected
                                ? `Desmarcar ${consultant.name}`
                                : `Selecionar ${consultant.name} para edição em massa`
                            }
                          >
                            <button
                              type="button"
                              role="checkbox"
                              aria-checked={isSelected}
                              onClick={() => toggleSelectOne(consultant.operatorId)}
                              className={`mx-auto flex h-4 w-4 items-center justify-center rounded-[2px] border transition cursor-pointer ${
                                isSelected
                                  ? "border-primary bg-primary text-primary-foreground"
                                  : "border-border/80 dark:border-zinc-700 bg-background dark:bg-zinc-900"
                              }`}
                            >
                              {isSelected && <Check className="h-3 w-3 stroke-[3]" />}
                            </button>
                          </SystemTooltip>
                        </td>

                        {/* Consultor (Avatar + Nome) */}
                        <td className="py-3 px-3">
                          <SystemTooltip content={`Consultor: ${consultant.name} (${consultant.email})`}>
                            <div className="flex items-center gap-2.5">
                              <img
                                src={
                                  consultant.avatar ||
                                  getDeterministicConsultantAvatar(consultant.name)
                                }
                                alt={consultant.name}
                                className="w-7 h-7 rounded-[2px] object-cover shrink-0 border border-border/80 dark:border-zinc-800"
                                onError={(e) => {
                                  const img = e.currentTarget;
                                  const fallback = getDeterministicConsultantAvatar(
                                    consultant.name,
                                  );
                                  if (img.src !== fallback) {
                                    img.src = fallback;
                                  }
                                }}
                              />
                              <span className="font-semibold text-foreground dark:text-zinc-100 truncate max-w-[180px]">
                                {consultant.name}
                              </span>
                            </div>
                          </SystemTooltip>
                        </td>

                        {/* Equipe */}
                        <td className="py-3 px-3 text-[10px] font-mono font-bold uppercase tracking-wider text-muted-foreground dark:text-zinc-400">
                          <SystemTooltip content={`Equipe comercial: ${(consultant.division || "—").toUpperCase()}`}>
                            <span>{consultant.division || "—"}</span>
                          </SystemTooltip>
                        </td>

                        {/* Total em Carteira (Somente negociações em andamento) */}
                        <td className="py-3 px-3 font-mono font-semibold text-foreground dark:text-zinc-200">
                          <SystemTooltip
                            content={`${consultant.openPortfolioCount || 0} negociação(ões) em andamento na carteira • Potencial convertido (${consultant.conversionRate}%): ${formatCurrency(((consultant.openPortfolioValue || 0) * consultant.conversionRate) / 100)}`}
                          >
                            <div className="inline-flex items-center gap-1.5">
                              <BriefcaseBusiness className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                              <span>{formatCurrency(consultant.openPortfolioValue || 0)}</span>
                            </div>
                          </SystemTooltip>
                        </td>

                        {/* Meta Mensal (Inline Edit) */}
                        <td className="py-3 px-3">
                          {isEditingTarget ? (
                            <SystemTooltip
                              content={
                                selectedIds.size > 1 && isSelected
                                  ? `Pressione Enter para aplicar a todos os ${selectedIds.size} consultores selecionados`
                                  : "Digite o valor e pressione Enter para salvar"
                              }
                            >
                              <input
                                type="text"
                                inputMode="decimal"
                                autoFocus
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    void commitInlineEdit(consultant.operatorId, "targetValue");
                                  } else if (e.key === "Escape") {
                                    setEditingCell(null);
                                  }
                                }}
                                onBlur={() => {
                                  void commitInlineEdit(consultant.operatorId, "targetValue");
                                }}
                                className="w-32 rounded-[2px] border border-primary bg-background dark:bg-zinc-900 px-2.5 py-1 text-xs font-mono font-bold text-foreground outline-none ring-1 ring-primary"
                              />
                            </SystemTooltip>
                          ) : (
                            <SystemTooltip
                              content={
                                selectedIds.size > 1 && isSelected
                                  ? `Clique para editar a meta mensal dos ${selectedIds.size} consultores selecionados`
                                  : "Clique para editar a meta mensal"
                              }
                            >
                              <button
                                type="button"
                                onMouseDown={(e) => {
                                  if (editingCell) {
                                    e.preventDefault();
                                    void commitInlineEdit(
                                      editingCell.operatorId,
                                      editingCell.field,
                                    ).then(() => {
                                      startEdit(
                                        consultant.operatorId,
                                        "targetValue",
                                        consultant.targetValue,
                                      );
                                    });
                                  }
                                }}
                                onClick={() =>
                                  startEdit(
                                    consultant.operatorId,
                                    "targetValue",
                                    consultant.targetValue,
                                  )
                                }
                                className={`inline-flex items-center gap-1.5 py-1 px-1.5 rounded-[2px] text-xs font-mono font-bold transition cursor-pointer ${
                                  isMassPreviewRow && editingCell?.field === "targetValue"
                                    ? "text-primary bg-primary/10 ring-1 ring-primary/40"
                                    : "text-foreground hover:text-primary hover:bg-muted/40 dark:hover:bg-zinc-800"
                                }`}
                              >
                                <span>{formatCurrency(consultant.targetValue, true)}</span>
                                <Pencil className="h-3 w-3 text-muted-foreground/40 group-hover:text-primary transition" />
                              </button>
                            </SystemTooltip>
                          )}
                        </td>

                        {/* Taxa Conversão (Inline Edit — Sem input type="number" nativo do navegador) */}
                        <td className="py-3 px-3">
                          {isEditingRate ? (
                            <SystemTooltip
                              content={
                                selectedIds.size > 1 && isSelected
                                  ? `Pressione Enter para aplicar a taxa aos ${selectedIds.size} consultores selecionados`
                                  : "Digite a taxa (0 a 100) e pressione Enter para salvar"
                              }
                            >
                              <input
                                type="text"
                                inputMode="decimal"
                                autoFocus
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    void commitInlineEdit(consultant.operatorId, "conversionRate");
                                  } else if (e.key === "Escape") {
                                    setEditingCell(null);
                                  }
                                }}
                                onBlur={() => {
                                  void commitInlineEdit(consultant.operatorId, "conversionRate");
                                }}
                                className="w-20 rounded-[2px] border border-primary bg-background dark:bg-zinc-900 px-2.5 py-1 text-xs font-mono font-bold text-foreground outline-none ring-1 ring-primary"
                              />
                            </SystemTooltip>
                          ) : (
                            <SystemTooltip
                              content={
                                selectedIds.size > 1 && isSelected
                                  ? `Clique para editar a taxa de conversão dos ${selectedIds.size} consultores selecionados`
                                  : "Clique para editar a taxa de conversão"
                              }
                            >
                              <button
                                type="button"
                                onMouseDown={(e) => {
                                  if (editingCell) {
                                    e.preventDefault();
                                    void commitInlineEdit(
                                      editingCell.operatorId,
                                      editingCell.field,
                                    ).then(() => {
                                      startEdit(
                                        consultant.operatorId,
                                        "conversionRate",
                                        consultant.conversionRate,
                                      );
                                    });
                                  }
                                }}
                                onClick={() =>
                                  startEdit(
                                    consultant.operatorId,
                                    "conversionRate",
                                    consultant.conversionRate,
                                  )
                                }
                                className={`inline-flex items-center gap-1.5 py-1 px-1.5 rounded-[2px] text-xs font-mono font-bold transition cursor-pointer ${
                                  isMassPreviewRow && editingCell?.field === "conversionRate"
                                    ? "text-primary bg-primary/10 ring-1 ring-primary/40"
                                    : "text-foreground hover:text-primary hover:bg-muted/40 dark:hover:bg-zinc-800"
                                }`}
                              >
                                <span>{consultant.conversionRate}%</span>
                                <Pencil className="h-3 w-3 text-muted-foreground/40 group-hover:text-primary transition" />
                              </button>
                            </SystemTooltip>
                          )}
                        </td>

                        {/* Meta Diária */}
                        <td className="py-3 px-3 font-mono font-semibold text-foreground dark:text-zinc-200">
                          <SystemTooltip
                            content={`Meta diária linear: ${formatCurrency(consultant.dailyTarget, true)} (${formatCurrency(consultant.targetValue)} ÷ ${businessDays} dias úteis)`}
                          >
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
                          <SystemTooltip content="Diferença pendente para atingir a meta mensal">
                            <span>{formatCurrency(consultant.gap)}</span>
                          </SystemTooltip>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>

              {/* ─── Footer: TOTAL GERAL ─── */}
              {liveConsultants.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-border/80 dark:border-zinc-800 text-xs font-mono font-bold">
                    <td className="py-4 px-2.5" />
                    <td className="py-4 px-3 uppercase tracking-wider text-foreground dark:text-zinc-100">
                      <SystemTooltip content="Consolidação geral de todos os consultores comerciais">
                        <span>TOTAL GERAL</span>
                      </SystemTooltip>
                    </td>
                    <td className="py-4 px-3" />
                    <td className="py-4 px-3 font-mono text-foreground dark:text-zinc-100">
                      <SystemTooltip
                        content={`Total de ${totals.totalOpenPortfolioCount} negociação(ões) em andamento na carteira de todos os consultores`}
                      >
                        <span>{formatCurrency(totals.totalOpenPortfolioValue)}</span>
                      </SystemTooltip>
                    </td>
                    <td className="py-4 px-3 font-mono text-foreground dark:text-zinc-100">
                      <SystemTooltip content="Soma das metas mensais de todos os consultores">
                        <span>{formatCurrency(totals.targetValue)}</span>
                      </SystemTooltip>
                    </td>
                    <td className="py-4 px-3 font-mono text-muted-foreground dark:text-zinc-400 font-semibold">
                      <SystemTooltip content="Taxa de conversão média dos consultores">
                        <span>{totals.avgConversionRate.toFixed(1)}% méd.</span>
                      </SystemTooltip>
                    </td>
                    <td className="py-4 px-3 font-mono text-foreground dark:text-zinc-100 font-semibold">
                      <SystemTooltip
                        content={`Soma das metas diárias lineares (${formatCurrency(totals.targetValue)} ÷ ${businessDays} dias úteis)`}
                      >
                        <span>{formatCurrency(totals.totalDailyTarget)}</span>
                      </SystemTooltip>
                    </td>
                    <td className="py-4 px-3 font-mono text-foreground dark:text-zinc-100">
                      <SystemTooltip content="Total faturado por todos os consultores no mês">
                        <span>{formatCurrency(totals.realizedValue)}</span>
                      </SystemTooltip>
                    </td>
                    <td className="py-4 px-3">
                      <SystemTooltip content="Percentual consolidado de atingimento da meta mensal">
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
                      </SystemTooltip>
                    </td>
                    <td className="py-4 px-3 font-mono font-bold text-primary text-right">
                      <SystemTooltip content="GAP consolidado restante para bater a meta total do mês">
                        <span>{formatCurrency(totals.gap)}</span>
                      </SystemTooltip>
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
