import React, { useEffect, useMemo, useRef, useState } from "react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { SystemTooltip } from "@/components/ui/tooltip";
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  X,
} from "lucide-react";
import {
  formatBrDateFromDate,
  formatYmdFromDate,
  maskBrDateInput,
  maskTimeInput,
  parseBrDateInput,
  parseTimeInput,
} from "@/lib/date-time-input";

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
const MINUTES_LIST = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"));

function getRelativeDateYMD(daysOffset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysOffset);
  return formatYmdFromDate(d);
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
 * Seletor de Data e Hora 100% customizado do Design System com suporte duplo:
 * digitação direta no teclado (DD/MM/AAAA e HH:mm) + Popover customizado e SystemTooltip.
 * Substitui <input type="date"> e <input type="datetime-local"> nativos do navegador.
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

  const dateAnchorRef = useRef<HTMLDivElement>(null);
  const timeAnchorRef = useRef<HTMLDivElement>(null);
  const isDateFocusedRef = useRef(false);
  const isTimeFocusedRef = useRef(false);

  const parsed = useMemo(() => {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      const datePart = formatYmdFromDate(value);
      const hh = String(value.getHours()).padStart(2, "0");
      const mm = String(value.getMinutes()).padStart(2, "0");
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

  const formattedDateBR = useMemo(() => {
    if (!datePart) return "";
    const [y, m, d] = datePart.split("-");
    if (y && m && d) return `${d}/${m}/${y}`;
    return datePart;
  }, [datePart]);

  const [dateInput, setDateInput] = useState<string>(() => formattedDateBR);
  const [isDateInvalid, setIsDateInvalid] = useState(false);
  const [timeInput, setTimeInput] = useState<string>(() => timePart || defaultTime);
  const [isTimeInvalid, setIsTimeInvalid] = useState(false);

  useEffect(() => {
    if (!isDateFocusedRef.current) {
      setDateInput(formattedDateBR);
      setIsDateInvalid(false);
    }
  }, [formattedDateBR]);

  useEffect(() => {
    if (!isTimeFocusedRef.current) {
      setTimeInput(timePart || defaultTime);
      setIsTimeInvalid(false);
    }
  }, [timePart, defaultTime]);

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

  const handleDateInputChange = (raw: string) => {
    const masked = maskBrDateInput(raw, dateInput);
    setDateInput(masked);

    if (!masked && allowClear) {
      setIsDateInvalid(false);
      onChange("");
      return;
    }

    const validDate = parseBrDateInput(masked, { allowTwoDigitYear: false });
    if (validDate) {
      setIsDateInvalid(false);
      setCalendarMonth(validDate.getMonth());
      setCalendarYear(validDate.getFullYear());
      emitValue(formatYmdFromDate(validDate), timePart);
    } else {
      setIsDateInvalid(masked.length === 10);
    }
  };

  const handleDateInputBlur = () => {
    isDateFocusedRef.current = false;
    if (!dateInput.trim()) {
      if (allowClear || !formattedDateBR) {
        setDateInput("");
        setIsDateInvalid(false);
        if (datePart) onChange("");
      } else {
        setDateInput(formattedDateBR);
        setIsDateInvalid(false);
      }
      return;
    }

    const validDate = parseBrDateInput(dateInput, { allowTwoDigitYear: true });
    if (validDate) {
      const normalizedBr = formatBrDateFromDate(validDate);
      setDateInput(normalizedBr);
      setIsDateInvalid(false);
      setCalendarMonth(validDate.getMonth());
      setCalendarYear(validDate.getFullYear());
      emitValue(formatYmdFromDate(validDate), timePart);
    } else {
      setIsDateInvalid(true);
    }
  };

  const handleTimeInputChange = (raw: string) => {
    const masked = maskTimeInput(raw, timeInput);
    setTimeInput(masked);

    const validTime = parseTimeInput(masked, { allowShorthand: false });
    if (validTime) {
      setIsTimeInvalid(false);
      const baseDate = datePart || getRelativeDateYMD(0);
      emitValue(baseDate, validTime);
    } else {
      setIsTimeInvalid(masked.length === 5);
    }
  };

  const handleTimeInputBlur = () => {
    isTimeFocusedRef.current = false;
    if (!timeInput.trim()) {
      setTimeInput(timePart || defaultTime);
      setIsTimeInvalid(false);
      return;
    }

    const validTime = parseTimeInput(timeInput, { allowShorthand: true });
    if (validTime) {
      setTimeInput(validTime);
      setIsTimeInvalid(false);
      const baseDate = datePart || getRelativeDateYMD(0);
      emitValue(baseDate, validTime);
    } else {
      setIsTimeInvalid(true);
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

    const chosen = new Date(targetYear, targetMonth, day);
    const nextDate = formatYmdFromDate(chosen);
    setDateInput(formatBrDateFromDate(chosen));
    setIsDateInvalid(false);
    emitValue(nextDate, timePart);
    setIsDateOpen(false);
  };

  const renderCalendarDays = () => {
    const firstDayIndex = new Date(calendarYear, calendarMonth, 1).getDay();
    const daysInCurrentMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
    const daysInPrevMonth = new Date(calendarYear, calendarMonth, 0).getDate();
    const todayYMD = formatYmdFromDate(new Date());

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
      {/* Seletor de Data (Digitável + Popover + SystemTooltip) */}
      <Popover open={isDateOpen} onOpenChange={(next) => !disabled && setIsDateOpen(next)}>
        <PopoverAnchor asChild>
          <div
            ref={dateAnchorRef}
            className={`flex-1 h-9 px-2.5 rounded-xl bg-muted/50 text-xs font-semibold text-foreground border flex items-center justify-between gap-1.5 transition-all ${
              disabled ? "opacity-50 cursor-not-allowed" : ""
            } ${
              isDateInvalid
                ? "border-rose-500 ring-1 ring-rose-500/30"
                : "border-border hover:border-primary/40 focus-within:border-primary focus-within:ring-1 focus-within:ring-primary"
            }`}
          >
            <SystemTooltip content={tooltip || "Abrir calendário do sistema"}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => !disabled && setIsDateOpen((prev) => !prev)}
                className="flex items-center justify-center text-primary shrink-0 hover:scale-105 transition-transform cursor-pointer disabled:cursor-not-allowed"
                aria-label="Abrir calendário"
              >
                <CalendarDays className="h-3.5 w-3.5" />
              </button>
            </SystemTooltip>

            <input
              id={id}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              disabled={disabled}
              value={dateInput}
              placeholder={placeholder || "DD/MM/AAAA"}
              aria-label={ariaLabel || "Selecionar data"}
              onFocus={() => {
                isDateFocusedRef.current = true;
                if (!disabled) setIsDateOpen(true);
              }}
              onClick={() => !disabled && setIsDateOpen(true)}
              onChange={(e) => handleDateInputChange(e.target.value)}
              onBlur={handleDateInputBlur}
              onKeyDown={(e) => {
                if (e.key === "Escape" && isDateOpen) {
                  e.stopPropagation();
                  setIsDateOpen(false);
                } else if (e.key === "Enter" && isDateOpen) {
                  e.preventDefault();
                  handleDateInputBlur();
                  setIsDateOpen(false);
                } else if (e.key === "Tab") {
                  setIsDateOpen(false);
                }
              }}
              className="w-full min-w-0 bg-transparent text-xs font-semibold text-foreground placeholder:text-muted-foreground focus:outline-none disabled:cursor-not-allowed"
            />

            <div className="flex items-center gap-1 shrink-0">
              {allowClear && (datePart || dateInput) && !disabled && (
                <SystemTooltip content="Limpar data">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDateInput("");
                      setIsDateInvalid(false);
                      onChange("");
                    }}
                    className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer"
                    aria-label="Limpar data"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </SystemTooltip>
              )}
              <button
                type="button"
                tabIndex={-1}
                disabled={disabled}
                onClick={() => !disabled && setIsDateOpen((prev) => !prev)}
                className="flex items-center justify-center text-muted-foreground opacity-70 hover:opacity-100 cursor-pointer disabled:cursor-not-allowed"
                aria-label="Alternar calendário"
              >
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isDateOpen ? "rotate-180" : ""}`} />
              </button>
            </div>
          </div>
        </PopoverAnchor>

        <PopoverContent
          className="w-[264px] p-3 rounded-2xl border border-border shadow-xl bg-card z-[220]"
          align="start"
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          onInteractOutside={(e) => {
            if (dateAnchorRef.current?.contains(e.target as Node)) {
              e.preventDefault();
            }
          }}
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
                const ymd = getRelativeDateYMD(0);
                const [y, m, d] = ymd.split("-");
                setDateInput(`${d}/${m}/${y}`);
                setIsDateInvalid(false);
                emitValue(ymd, timePart);
                setIsDateOpen(false);
              }}
              className="font-semibold text-primary hover:underline cursor-pointer"
            >
              Hoje
            </button>
            <button
              type="button"
              onClick={() => {
                const ymd = getRelativeDateYMD(1);
                const [y, m, d] = ymd.split("-");
                setDateInput(`${d}/${m}/${y}`);
                setIsDateInvalid(false);
                emitValue(ymd, timePart);
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
                  setDateInput("");
                  setIsDateInvalid(false);
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

      {/* Seletor de Hora (Digitável + Popover quando mode === "datetime") */}
      {mode === "datetime" && (
        <Popover open={isTimeOpen} onOpenChange={(next) => !disabled && setIsTimeOpen(next)}>
          <PopoverAnchor asChild>
            <div
              ref={timeAnchorRef}
              className={`w-[112px] shrink-0 h-9 px-2.5 rounded-xl bg-muted/50 text-xs font-semibold text-foreground border flex items-center justify-between gap-1.5 transition-all ${
                disabled ? "opacity-50 cursor-not-allowed" : ""
              } ${
                isTimeInvalid
                  ? "border-rose-500 ring-1 ring-rose-500/30"
                  : "border-border hover:border-primary/40 focus-within:border-primary focus-within:ring-1 focus-within:ring-primary"
              }`}
            >
              <SystemTooltip content="Abrir seletor de horário">
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => !disabled && setIsTimeOpen((prev) => !prev)}
                  className="flex items-center justify-center text-primary shrink-0 hover:scale-105 transition-transform cursor-pointer disabled:cursor-not-allowed"
                  aria-label="Abrir seletor de horário"
                >
                  <Clock className="h-3.5 w-3.5" />
                </button>
              </SystemTooltip>

              <input
                type="text"
                inputMode="numeric"
                autoComplete="off"
                disabled={disabled}
                value={timeInput}
                placeholder="HH:mm"
                aria-label="Selecionar horário"
                onFocus={() => {
                  isTimeFocusedRef.current = true;
                  if (!disabled) setIsTimeOpen(true);
                }}
                onClick={() => !disabled && setIsTimeOpen(true)}
                onChange={(e) => handleTimeInputChange(e.target.value)}
                onBlur={handleTimeInputBlur}
                onKeyDown={(e) => {
                  if (e.key === "Escape" && isTimeOpen) {
                    e.stopPropagation();
                    setIsTimeOpen(false);
                  } else if (e.key === "Enter" && isTimeOpen) {
                    e.preventDefault();
                    handleTimeInputBlur();
                    setIsTimeOpen(false);
                  } else if (e.key === "Tab") {
                    setIsTimeOpen(false);
                  }
                }}
                className="w-full min-w-0 bg-transparent font-mono text-xs font-bold text-foreground placeholder:text-muted-foreground focus:outline-none disabled:cursor-not-allowed"
              />

              <button
                type="button"
                tabIndex={-1}
                disabled={disabled}
                onClick={() => !disabled && setIsTimeOpen((prev) => !prev)}
                className="flex items-center justify-center text-muted-foreground opacity-70 hover:opacity-100 shrink-0 cursor-pointer disabled:cursor-not-allowed"
                aria-label="Alternar lista de horários"
              >
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isTimeOpen ? "rotate-180" : ""}`} />
              </button>
            </div>
          </PopoverAnchor>

          <PopoverContent
            className="w-[188px] p-2.5 rounded-2xl shadow-xl border border-border bg-card z-[220]"
            align="end"
            onOpenAutoFocus={(e) => e.preventDefault()}
            onCloseAutoFocus={(e) => e.preventDefault()}
            onInteractOutside={(e) => {
              if (timeAnchorRef.current?.contains(e.target as Node)) {
                e.preventDefault();
              }
            }}
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
                          const nextTime = `${h}:${selectedMin}`;
                          setTimeInput(nextTime);
                          setIsTimeInvalid(false);
                          emitValue(baseDate, nextTime);
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
                          const nextTime = `${selectedHour}:${m}`;
                          setTimeInput(nextTime);
                          setIsTimeInvalid(false);
                          emitValue(baseDate, nextTime);
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
