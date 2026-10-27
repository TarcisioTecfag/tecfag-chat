import React, { useEffect, useMemo, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SystemTooltip } from "@/components/ui/tooltip";
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  X,
} from "lucide-react";

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

const WEEKDAY_NAMES_PT = ["D", "S", "T", "Q", "Q", "S", "S"];
const HOURS_LIST = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTES_LIST = ["00", "05", "10", "15", "20", "25", "30", "35", "40", "45", "50", "55"];

function formatYMD(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getRelativeDateYMD(daysOffset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysOffset);
  return formatYMD(d);
}

export interface SystemDateTimePickerProps {
  value?: string | Date | null;
  onChange: (nextValue: string) => void;
  mode?: "date" | "datetime";
  placeholder?: string;
  tooltip?: string;
  id?: string;
  ariaLabel?: string;
  disabled?: boolean;
  allowClear?: boolean;
  className?: string;
  defaultTime?: string;
}

/**
 * Seletor de Data e Hora 100% customizado do Design System.
 * Substitui <input type="date"> e <input type="datetime-local"> nativos do navegador,
 * utilizando Popover customizado e SystemTooltip.
 */
export function SystemDateTimePicker({
  value,
  onChange,
  mode = "date",
  placeholder,
  tooltip,
  id,
  ariaLabel,
  disabled = false,
  allowClear = false,
  className = "",
  defaultTime = "09:00",
}: SystemDateTimePickerProps) {
  const [isDateOpen, setIsDateOpen] = useState(false);
  const [isTimeOpen, setIsTimeOpen] = useState(false);

  const parsed = useMemo(() => {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      const datePart = formatYMD(value);
      const hh = String(value.getHours()).padStart(2, "0");
      const mm = String(Math.floor(value.getMinutes() / 5) * 5).padStart(2, "0");
      return { datePart, timePart: `${hh}:${mm}` };
    }
    const raw = typeof value === "string" ? value.trim() : "";
    if (!raw) {
      return { datePart: "", timePart: defaultTime };
    }
    if (raw.includes("T")) {
      const [dPart, tPartRaw] = raw.split("T");
      const tPart = (tPartRaw || defaultTime).slice(0, 5);
      return { datePart: dPart || "", timePart: /^\d{2}:\d{2}$/.test(tPart) ? tPart : defaultTime };
    }
    return { datePart: raw.slice(0, 10), timePart: defaultTime };
  }, [value, defaultTime]);

  const { datePart, timePart } = parsed;

  const [calendarMonth, setCalendarMonth] = useState<number>(() => {
    if (datePart) {
      const [, m] = datePart.split("-");
      if (m) return Math.max(0, Math.min(11, parseInt(m, 10) - 1));
    }
    return new Date().getMonth();
  });

  const [calendarYear, setCalendarYear] = useState<number>(() => {
    if (datePart) {
      const [y] = datePart.split("-");
      if (y) return parseInt(y, 10);
    }
    return new Date().getFullYear();
  });

  useEffect(() => {
    if (datePart) {
      const [y, m] = datePart.split("-");
      if (y && m) {
        const yNum = parseInt(y, 10);
        const mNum = parseInt(m, 10) - 1;
        if (!Number.isNaN(yNum)) setCalendarYear(yNum);
        if (!Number.isNaN(mNum) && mNum >= 0 && mNum <= 11) setCalendarMonth(mNum);
      }
    }
  }, [datePart]);

  const formattedDateBR = useMemo(() => {
    if (!datePart) return placeholder || "Selecionar data";
    const [y, m, d] = datePart.split("-");
    if (y && m && d) return `${d}/${m}/${y}`;
    return datePart;
  }, [datePart, placeholder]);

  const [rawHour, rawMin] = (timePart || defaultTime).split(":");
  const selectedHour = rawHour || "09";
  const selectedMin = rawMin || "00";

  const emitValue = (nextDate: string, nextTime: string) => {
    if (!nextDate) {
      onChange("");
      return;
    }
    if (mode === "datetime") {
      onChange(`${nextDate}T${nextTime || defaultTime}`);
    } else {
      onChange(nextDate);
    }
  };

  const prevMonth = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (calendarMonth === 0) {
      setCalendarMonth(11);
      setCalendarYear((y) => y - 1);
    } else {
      setCalendarMonth((m) => m - 1);
    }
  };

  const nextMonth = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (calendarMonth === 11) {
      setCalendarMonth(0);
      setCalendarYear((y) => y + 1);
    } else {
      setCalendarMonth((m) => m + 1);
    }
  };

  const handleSelectDay = (day: number, monthOffset = 0) => {
    let targetMonth = calendarMonth + monthOffset;
    let targetYear = calendarYear;

    if (targetMonth < 0) {
      targetMonth = 11;
      targetYear -= 1;
    } else if (targetMonth > 11) {
      targetMonth = 0;
      targetYear += 1;
    }

    const nextDate = `${targetYear}-${String(targetMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    emitValue(nextDate, timePart);
    setIsDateOpen(false);
  };

  const renderCalendarDays = () => {
    const firstDayIndex = new Date(calendarYear, calendarMonth, 1).getDay();
    const daysInCurrentMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
    const daysInPrevMonth = new Date(calendarYear, calendarMonth, 0).getDate();
    const todayYMD = formatYMD(new Date());

    const cells: React.ReactNode[] = [];

    for (let i = firstDayIndex - 1; i >= 0; i--) {
      const dayNum = daysInPrevMonth - i;
      cells.push(
        <button
          key={`prev-${dayNum}`}
          type="button"
          onClick={() => handleSelectDay(dayNum, -1)}
          className="h-7 w-7 text-[11px] text-muted-foreground/35 hover:bg-muted/40 rounded-lg flex items-center justify-center transition-colors cursor-pointer"
        >
          {dayNum}
        </button>,
      );
    }

    for (let day = 1; day <= daysInCurrentMonth; day++) {
      const dayYMD = `${calendarYear}-${String(calendarMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const isSelected = datePart === dayYMD;
      const isToday = todayYMD === dayYMD;
      const formattedDayTooltip = `${String(day).padStart(2, "0")}/${String(calendarMonth + 1).padStart(2, "0")}/${calendarYear}`;

      cells.push(
        <SystemTooltip key={`cur-${day}`} content={formattedDayTooltip}>
          <button
            type="button"
            onClick={() => handleSelectDay(day, 0)}
            className={`h-7 w-7 text-xs font-semibold rounded-lg flex items-center justify-center transition-all cursor-pointer ${
              isSelected
                ? "bg-primary text-primary-foreground font-bold shadow-xs hover:bg-primary/90"
                : isToday
                  ? "border border-primary/50 text-primary font-bold hover:bg-primary/10"
                  : "text-foreground hover:bg-muted hover:text-primary"
            }`}
          >
            {day}
          </button>
        </SystemTooltip>,
      );
    }

    const totalFilled = cells.length;
    const remaining = (7 - (totalFilled % 7)) % 7;
    for (let day = 1; day <= remaining; day++) {
      cells.push(
        <button
          key={`next-${day}`}
          type="button"
          onClick={() => handleSelectDay(day, 1)}
          className="h-7 w-7 text-[11px] text-muted-foreground/35 hover:bg-muted/40 rounded-lg flex items-center justify-center transition-colors cursor-pointer"
        >
          {day}
        </button>,
      );
    }

    return cells;
  };

  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      {/* Seletor de Data (Popover + SystemTooltip) */}
      <Popover open={isDateOpen} onOpenChange={(next) => !disabled && setIsDateOpen(next)}>
        <SystemTooltip content={tooltip || "Selecionar data no calendário do sistema"}>
          <PopoverTrigger asChild>
            <button
              id={id}
              type="button"
              disabled={disabled}
              aria-label={ariaLabel || "Selecionar data"}
              className="flex-1 h-9 px-3 rounded-xl bg-muted/50 text-xs font-semibold text-foreground border border-border hover:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary flex items-center justify-between gap-2 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed group"
            >
              <div className="flex items-center gap-2 min-w-0">
                <CalendarDays className="h-3.5 w-3.5 text-primary shrink-0 group-hover:scale-105 transition-transform" />
                <span className={`truncate ${datePart ? "text-foreground" : "text-muted-foreground"}`}>
                  {formattedDateBR}
                </span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {allowClear && datePart && (
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      onChange("");
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.stopPropagation();
                        onChange("");
                      }
                    }}
                    className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                  </span>
                )}
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground opacity-70" />
              </div>
            </button>
          </PopoverTrigger>
        </SystemTooltip>

        <PopoverContent
          className="w-[264px] p-3 rounded-2xl border border-border shadow-xl bg-card z-[220]"
          align="start"
        >
          <div className="flex items-center justify-between mb-2 px-1">
            <SystemTooltip content="Mês anterior">
              <button
                type="button"
                onClick={prevMonth}
                className="h-6 w-6 flex items-center justify-center rounded-lg text-primary hover:bg-muted transition-colors cursor-pointer"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
            </SystemTooltip>
            <span className="text-xs font-bold text-foreground">
              {MONTH_NAMES_PT[calendarMonth]} de {calendarYear}
            </span>
            <SystemTooltip content="Próximo mês">
              <button
                type="button"
                onClick={nextMonth}
                className="h-6 w-6 flex items-center justify-center rounded-lg text-primary hover:bg-muted transition-colors cursor-pointer"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </SystemTooltip>
          </div>

          <div className="grid grid-cols-7 gap-1 mb-1 text-center">
            {WEEKDAY_NAMES_PT.map((w, idx) => (
              <span key={idx} className="text-[10px] font-bold text-muted-foreground">
                {w}
              </span>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1 text-center">{renderCalendarDays()}</div>

          <div className="flex items-center justify-between pt-2 mt-2 border-t border-border/50 text-[10px]">
            <button
              type="button"
              onClick={() => {
                emitValue(getRelativeDateYMD(0), timePart);
                setIsDateOpen(false);
              }}
              className="font-semibold text-primary hover:underline cursor-pointer"
            >
              Hoje
            </button>
            <button
              type="button"
              onClick={() => {
                emitValue(getRelativeDateYMD(1), timePart);
                setIsDateOpen(false);
              }}
              className="font-semibold text-muted-foreground hover:text-foreground cursor-pointer"
            >
              Amanhã
            </button>
            {allowClear && datePart && (
              <button
                type="button"
                onClick={() => {
                  onChange("");
                  setIsDateOpen(false);
                }}
                className="font-semibold text-destructive hover:underline cursor-pointer"
              >
                Limpar
              </button>
            )}
          </div>
        </PopoverContent>
      </Popover>

      {/* Seletor de Hora (quando mode === "datetime") */}
      {mode === "datetime" && (
        <Popover open={isTimeOpen} onOpenChange={(next) => !disabled && setIsTimeOpen(next)}>
          <SystemTooltip content="Selecionar horário">
            <PopoverTrigger asChild>
              <button
                type="button"
                disabled={disabled}
                aria-label="Selecionar horário"
                className="w-[104px] shrink-0 h-9 px-2.5 rounded-xl bg-muted/50 text-xs font-semibold text-foreground border border-border hover:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary flex items-center justify-between gap-1.5 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed group"
              >
                <div className="flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-primary shrink-0 group-hover:scale-105 transition-transform" />
                  <span className="font-mono font-bold">{timePart || defaultTime}</span>
                </div>
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground opacity-70 shrink-0" />
              </button>
            </PopoverTrigger>
          </SystemTooltip>

          <PopoverContent
            className="w-[188px] p-2.5 rounded-2xl shadow-xl border border-border bg-card z-[220]"
            align="end"
          >
            <div className="grid grid-cols-2 gap-1.5 text-center text-xs">
              <div>
                <div className="text-[10px] font-bold text-muted-foreground uppercase pb-1 border-b border-border/60 mb-1">
                  Hora
                </div>
                <div className="h-40 overflow-y-auto space-y-0.5 scrollbar-thin pr-0.5">
                  {HOURS_LIST.map((h) => {
                    const isSelected = selectedHour === h;
                    return (
                      <button
                        type="button"
                        key={h}
                        onClick={() => {
                          const baseDate = datePart || getRelativeDateYMD(0);
                          emitValue(baseDate, `${h}:${selectedMin}`);
                        }}
                        className={`w-full py-1 rounded-lg text-xs transition-colors cursor-pointer ${
                          isSelected
                            ? "bg-primary text-primary-foreground font-bold shadow-xs"
                            : "text-foreground hover:bg-muted font-medium"
                        }`}
                      >
                        {h}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-bold text-muted-foreground uppercase pb-1 border-b border-border/60 mb-1">
                  Minuto
                </div>
                <div className="h-40 overflow-y-auto space-y-0.5 scrollbar-thin pr-0.5">
                  {MINUTES_LIST.map((m) => {
                    const isSelected = selectedMin === m;
                    return (
                      <button
                        type="button"
                        key={m}
                        onClick={() => {
                          const baseDate = datePart || getRelativeDateYMD(0);
                          emitValue(baseDate, `${selectedHour}:${m}`);
                          setIsTimeOpen(false);
                        }}
                        className={`w-full py-1 rounded-lg text-xs transition-colors cursor-pointer ${
                          isSelected
                            ? "bg-primary text-primary-foreground font-bold shadow-xs"
                            : "text-foreground hover:bg-muted font-medium"
                        }`}
                      >
                        {m}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
