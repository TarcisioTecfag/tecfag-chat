import React, { useState, useRef, useEffect, useMemo } from "react";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, X, Clock } from "lucide-react";
import { SystemTooltip } from "@/components/ui/tooltip";

interface CrmDatePickerProps {
  value?: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  tooltipText?: string;
}

export function CrmDatePicker({
  value,
  onChange,
  placeholder = "Selecionar data...",
  className = "",
  disabled = false,
  tooltipText = "Selecionar data",
}: CrmDatePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Parse value to Date
  const parsedDate = useMemo(() => {
    if (!value) return null;
    const clean = String(value).substring(0, 10);
    const parts = clean.split("-");
    if (parts.length === 3) {
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const day = parseInt(parts[2], 10);
      return new Date(year, month, day);
    }
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }, [value]);

  const [currentMonth, setCurrentMonth] = useState<Date>(() => parsedDate || new Date());

  useEffect(() => {
    if (parsedDate) {
      setCurrentMonth(new Date(parsedDate.getFullYear(), parsedDate.getMonth(), 1));
    }
  }, [value]);

  // Click outside to close
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  const monthNames = [
    "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
  ];

  const weekDays = ["D", "S", "T", "Q", "Q", "S", "S"];

  const calendarDays = useMemo(() => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const totalDays = new Date(year, month + 1, 0).getDate();
    const startDay = new Date(year, month, 1).getDay();

    const days: Array<{ day: number | null; dateString: string | null }> = [];
    for (let i = 0; i < startDay; i++) {
      days.push({ day: null, dateString: null });
    }
    for (let d = 1; d <= totalDays; d++) {
      const mStr = String(month + 1).padStart(2, "0");
      const dStr = String(d).padStart(2, "0");
      days.push({ day: d, dateString: `${year}-${mStr}-${dStr}` });
    }
    return days;
  }, [currentMonth]);

  const handleSelectDate = (dateStr: string) => {
    onChange(dateStr);
    setIsOpen(false);
  };

  const handleQuickSelect = (daysToAdd: number) => {
    const target = new Date();
    target.setDate(target.getDate() + daysToAdd);
    const y = target.getFullYear();
    const m = String(target.getMonth() + 1).padStart(2, "0");
    const d = String(target.getDate()).padStart(2, "0");
    onChange(`${y}-${m}-${d}`);
    setIsOpen(false);
  };

  const handleSelectEndOfMonth = () => {
    const now = new Date();
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const y = lastDay.getFullYear();
    const m = String(lastDay.getMonth() + 1).padStart(2, "0");
    const d = String(lastDay.getDate()).padStart(2, "0");
    onChange(`${y}-${m}-${d}`);
    setIsOpen(false);
  };

  const formattedDisplay = parsedDate
    ? parsedDate.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })
    : null;

  return (
    <div className="relative w-full" ref={containerRef}>
      <div className="flex items-center gap-1 w-full">
        <SystemTooltip content={tooltipText}>
          <button
            type="button"
            disabled={disabled}
            onClick={() => !disabled && setIsOpen((prev) => !prev)}
            className={`w-full h-8 flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-2.5 text-xs text-foreground outline-none transition-colors hover:border-primary/50 focus:border-primary disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${
              isOpen ? "border-primary ring-1 ring-primary/30" : ""
            } ${className}`}
          >
            <div className="flex items-center gap-2 truncate min-w-0">
              <CalendarIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className={`truncate ${formattedDisplay ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                {formattedDisplay || placeholder}
              </span>
            </div>
            {parsedDate && !disabled && (
              <SystemTooltip content="Remover data">
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    onChange(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.stopPropagation();
                      onChange(null);
                    }
                  }}
                  className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
                  aria-label="Limpar data"
                >
                  <X className="h-3 w-3" />
                </span>
              </SystemTooltip>
            )}
          </button>
        </SystemTooltip>
      </div>

      {isOpen && (
        <div className="absolute top-full left-0 mt-1 z-50 w-72 rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-2xl animate-in fade-in-0 zoom-in-95">
          {/* Cabeçalho do calendário */}
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-border/70">
            <span className="text-xs font-bold text-foreground">
              {monthNames[currentMonth.getMonth()]} {currentMonth.getFullYear()}
            </span>
            <div className="flex items-center gap-1">
              <SystemTooltip content="Mês anterior">
                <button
                  type="button"
                  onClick={() => {
                    const prev = new Date(currentMonth);
                    prev.setMonth(prev.getMonth() - 1);
                    setCurrentMonth(prev);
                  }}
                  className="flex h-6 w-6 items-center justify-center rounded-md border border-border/60 bg-muted/30 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground cursor-pointer"
                  aria-label="Mês anterior"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
              </SystemTooltip>
              <SystemTooltip content="Próximo mês">
                <button
                  type="button"
                  onClick={() => {
                    const next = new Date(currentMonth);
                    next.setMonth(next.getMonth() + 1);
                    setCurrentMonth(next);
                  }}
                  className="flex h-6 w-6 items-center justify-center rounded-md border border-border/60 bg-muted/30 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground cursor-pointer"
                  aria-label="Próximo mês"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </SystemTooltip>
            </div>
          </div>

          {/* Atalhos Rápidos */}
          <div className="grid grid-cols-4 gap-1 mb-2.5 pb-2 border-b border-border/50 text-[10px]">
            <SystemTooltip content="Definir para a data de hoje">
              <button
                type="button"
                onClick={() => handleQuickSelect(0)}
                className="py-1 px-1.5 rounded bg-muted/40 hover:bg-primary/20 hover:text-primary text-muted-foreground transition-colors text-center font-medium cursor-pointer"
              >
                Hoje
              </button>
            </SystemTooltip>
            <SystemTooltip content="Definir para daqui a 7 dias">
              <button
                type="button"
                onClick={() => handleQuickSelect(7)}
                className="py-1 px-1.5 rounded bg-muted/40 hover:bg-primary/20 hover:text-primary text-muted-foreground transition-colors text-center font-medium cursor-pointer"
              >
                +7d
              </button>
            </SystemTooltip>
            <SystemTooltip content="Definir para daqui a 15 dias">
              <button
                type="button"
                onClick={() => handleQuickSelect(15)}
                className="py-1 px-1.5 rounded bg-muted/40 hover:bg-primary/20 hover:text-primary text-muted-foreground transition-colors text-center font-medium cursor-pointer"
              >
                +15d
              </button>
            </SystemTooltip>
            <SystemTooltip content="Definir para o último dia deste mês">
              <button
                type="button"
                onClick={handleSelectEndOfMonth}
                className="py-1 px-1.5 rounded bg-muted/40 hover:bg-primary/20 hover:text-primary text-muted-foreground transition-colors text-center font-medium cursor-pointer"
              >
                Fim do mês
              </button>
            </SystemTooltip>
          </div>

          {/* Dias da Semana */}
          <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold text-muted-foreground mb-1">
            {weekDays.map((w, idx) => (
              <div key={idx} className="h-6 flex items-center justify-center">
                {w}
              </div>
            ))}
          </div>

          {/* Grade de Dias */}
          <div className="grid grid-cols-7 gap-1">
            {calendarDays.map((item, idx) => {
              if (!item.day || !item.dateString) {
                return <div key={`empty-${idx}`} className="h-7" />;
              }

              const isSelected = parsedDate
                ? parsedDate.getDate() === item.day &&
                  parsedDate.getMonth() === currentMonth.getMonth() &&
                  parsedDate.getFullYear() === currentMonth.getFullYear()
                : false;

              const today = new Date();
              const isToday =
                today.getDate() === item.day &&
                today.getMonth() === currentMonth.getMonth() &&
                today.getFullYear() === currentMonth.getFullYear();

              return (
                <button
                  key={item.dateString}
                  type="button"
                  onClick={() => handleSelectDate(item.dateString!)}
                  className={`h-7 w-full flex items-center justify-center rounded-md text-xs transition-colors cursor-pointer relative ${
                    isSelected
                      ? "bg-primary text-primary-foreground font-bold shadow-sm"
                      : isToday
                      ? "border border-primary/50 text-primary font-semibold hover:bg-primary/10"
                      : "text-foreground hover:bg-muted/80 hover:text-foreground"
                  }`}
                >
                  {item.day}
                  {isToday && !isSelected && (
                    <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-primary" />
                  )}
                </button>
              );
            })}
          </div>

          {/* Rodapé informativo */}
          <div className="mt-2.5 pt-2 border-t border-border/50 flex items-center justify-between text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {parsedDate ? `Previsão: ${formattedDisplay}` : "Nenhuma data selecionada"}
            </span>
            {parsedDate && (
              <button
                type="button"
                onClick={() => {
                  onChange(null);
                  setIsOpen(false);
                }}
                className="text-destructive hover:underline font-medium cursor-pointer"
              >
                Limpar
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
