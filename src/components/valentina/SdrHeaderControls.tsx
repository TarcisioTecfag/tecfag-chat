import React, { useState, useRef, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  X,
  Filter,
  Radio,
  RefreshCw,
  EyeOff,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { SystemTooltip } from "@/components/ui/tooltip";
import { SdrFilterState } from "./sdr-kanban-data";
import { IndustrialTriageHistory } from "./IndustrialTriageHistory";

export interface SdrHeaderControlsProps {
  filterState: SdrFilterState;
  onFilterChange: React.Dispatch<React.SetStateAction<SdrFilterState>>;
  onRefresh: () => void;
  isLoading: boolean;
  personaName: string;
  onVarredura?: () => void;
  showTriageHistory?: boolean;
  tenantId?: string;
  selectedConversationId?: string;
}

export function SdrHeaderControls({
  filterState,
  onFilterChange,
  onRefresh,
  isLoading,
  personaName,
  onVarredura,
  showTriageHistory,
  tenantId,
  selectedConversationId,
}: SdrHeaderControlsProps) {
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);
  const [currentCalendarMonth, setCurrentCalendarMonth] = useState<Date>(
    () => filterState.selectedDate || new Date()
  );

  // Fecha o popover ao clicar fora
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(event.target as Node)) {
        setIsFilterOpen(false);
      }
    }
    if (isFilterOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isFilterOpen]);

  // Funções do mini calendário
  const daysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
  const firstDayOfMonth = (year: number, month: number) => new Date(year, month, 1).getDay();

  const calendarDays = useMemo(() => {
    const year = currentCalendarMonth.getFullYear();
    const month = currentCalendarMonth.getMonth();
    const totalDays = daysInMonth(year, month);
    const startDay = firstDayOfMonth(year, month);

    const days: (number | null)[] = [];
    for (let i = 0; i < startDay; i++) {
      days.push(null);
    }
    for (let d = 1; d <= totalDays; d++) {
      days.push(d);
    }
    return days;
  }, [currentCalendarMonth]);

  const monthNames = [
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

  const hasActiveFilter =
    filterState.unreadOnly ||
    !filterState.showCompleted ||
    filterState.statusFilter !== "all" ||
    Boolean(filterState.selectedDate);

  const handleUpdate = (patch: Partial<SdrFilterState>) => {
    onFilterChange((prev) => ({ ...prev, ...patch }));
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* ── CAMPO DE BUSCA COMPACTO ── */}
      <div className="relative w-44 sm:w-52 md:w-60">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
        <input
          type="text"
          placeholder="Nome, empresa ou fone..."
          value={filterState.searchQuery}
          onChange={(e) => handleUpdate({ searchQuery: e.target.value })}
          className="w-full pl-8 pr-7 py-1 rounded-lg border border-border bg-muted/30 text-xs focus:outline-none focus:ring-2 focus:ring-primary/20 placeholder:text-muted-foreground/60 text-foreground transition"
        />
        {filterState.searchQuery && (
          <SystemTooltip content="Limpar busca">
            <button
              onClick={() => handleUpdate({ searchQuery: "" })}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded-full hover:bg-muted text-muted-foreground transition cursor-pointer"
            >
              <X className="h-3 w-3" />
            </button>
          </SystemTooltip>
        )}
      </div>

      {/* ── BOTÃO DE FILTROS COM POPOVER ── */}
      <div className="relative" ref={filterRef}>
        <SystemTooltip content="Filtros avançados (mensagens não lidas, status, período)">
          <button
            onClick={() => setIsFilterOpen(!isFilterOpen)}
            className={`px-2.5 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1.5 border cursor-pointer shadow-soft ${
              isFilterOpen || hasActiveFilter
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card text-foreground border-border hover:bg-muted/60"
            }`}
          >
            <Filter className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Filtros</span>
            {hasActiveFilter && (
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
            )}
          </button>
        </SystemTooltip>

        {/* POPOVER FILTROS AVANÇADOS */}
        <AnimatePresence>
          {isFilterOpen && (
            <motion.div
              initial={{ opacity: 0, y: 6, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6, scale: 0.97 }}
              transition={{ duration: 0.16 }}
              className="absolute right-0 mt-2 z-50 w-72 rounded-2xl bg-card border border-border text-foreground shadow-2xl p-4 space-y-4"
            >
              {/* Cabeçalho */}
              <div className="flex items-center justify-between border-b border-border pb-2">
                <h4 className="text-xs font-extrabold tracking-wide uppercase text-foreground">
                  Filtros Avançados
                </h4>
                <SystemTooltip content="Fechar filtros">
                  <button
                    onClick={() => setIsFilterOpen(false)}
                    className="p-1 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition cursor-pointer"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </SystemTooltip>
              </div>

              {/* Switch 1: Apenas não lidas */}
              <div className="flex items-center justify-between gap-2">
                <div>
                  <span className="text-xs font-bold block text-foreground">Apenas não lidas</span>
                  <span className="text-[10px] text-muted-foreground block">
                    Mostra somente chats com mensagens novas
                  </span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={filterState.unreadOnly}
                  onClick={() => handleUpdate({ unreadOnly: !filterState.unreadOnly })}
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    filterState.unreadOnly ? "bg-primary" : "bg-muted-foreground/30"
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                      filterState.unreadOnly ? "translate-x-4" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>

              {/* Switch 2: Ver Ocultados */}
              <div className="flex items-center justify-between gap-2">
                <div>
                  <span className="text-xs font-bold flex items-center gap-1.5 text-foreground">
                    <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />
                    Ver Concluídos
                  </span>
                  <span className="text-[10px] text-muted-foreground block">
                    Exibe cards com triagem concluída
                  </span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={filterState.showCompleted}
                  onClick={() => handleUpdate({ showCompleted: !filterState.showCompleted })}
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    filterState.showCompleted ? "bg-primary" : "bg-muted-foreground/30"
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                      filterState.showCompleted ? "translate-x-4" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>

              {/* Status da Triagem */}
              <div className="space-y-1.5 pt-1">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground block">
                  Status da Triagem
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() =>
                      handleUpdate({
                        statusFilter: filterState.statusFilter === "all" ? "all" : "all",
                      })
                    }
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold transition flex-1 border cursor-pointer ${
                      filterState.statusFilter === "all"
                        ? "bg-primary text-primary-foreground border-primary shadow-soft"
                        : "bg-muted/40 text-muted-foreground border-border hover:text-foreground"
                    }`}
                  >
                    Todos
                  </button>
                  <button
                    onClick={() =>
                      handleUpdate({
                        statusFilter:
                          filterState.statusFilter === "analisando" ? "all" : "analisando",
                      })
                    }
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold transition flex-1 border cursor-pointer ${
                      filterState.statusFilter === "analisando"
                        ? "bg-primary text-primary-foreground border-primary shadow-soft"
                        : "bg-muted/40 text-muted-foreground border-border hover:text-foreground"
                    }`}
                  >
                    Analisando
                  </button>
                  <button
                    onClick={() =>
                      handleUpdate({
                        statusFilter:
                          filterState.statusFilter === "concluida" ? "all" : "concluida",
                      })
                    }
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold transition flex-1 border cursor-pointer ${
                      filterState.statusFilter === "concluida"
                        ? "bg-primary text-primary-foreground border-primary shadow-soft"
                        : "bg-muted/40 text-muted-foreground border-border hover:text-foreground"
                    }`}
                  >
                    Concluída
                  </button>
                </div>
              </div>

              {/* Seletor de Período / Mini Calendário */}
              <div className="space-y-2 pt-1 border-t border-border">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">
                    Período
                  </span>
                  {filterState.selectedDate && (
                    <button
                      onClick={() => handleUpdate({ selectedDate: null })}
                      className="text-[10px] text-primary hover:underline cursor-pointer font-semibold"
                    >
                      Limpar data
                    </button>
                  )}
                </div>

                <div className="p-2.5 rounded-xl bg-muted/30 border border-border space-y-2">
                  <div className="flex items-center justify-between text-xs font-bold px-1">
                    <SystemTooltip content="Mês anterior">
                      <button
                        onClick={() => {
                          const prev = new Date(currentCalendarMonth);
                          prev.setMonth(prev.getMonth() - 1);
                          setCurrentCalendarMonth(prev);
                        }}
                        className="p-1 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition cursor-pointer"
                      >
                        <ChevronLeft className="h-3.5 w-3.5" />
                      </button>
                    </SystemTooltip>
                    <span className="text-foreground">
                      {monthNames[currentCalendarMonth.getMonth()]} {currentCalendarMonth.getFullYear()}
                    </span>
                    <SystemTooltip content="Próximo mês">
                      <button
                        onClick={() => {
                          const next = new Date(currentCalendarMonth);
                          next.setMonth(next.getMonth() + 1);
                          setCurrentCalendarMonth(next);
                        }}
                        className="p-1 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition cursor-pointer"
                      >
                        <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    </SystemTooltip>
                  </div>

                  {/* Grade de Dias */}
                  <div className="grid grid-cols-7 gap-1 text-center text-[10px]">
                    {["D", "S", "T", "Q", "Q", "S", "S"].map((d, i) => (
                      <span key={i} className="text-muted-foreground/70 font-bold py-0.5">
                        {d}
                      </span>
                    ))}
                    {calendarDays.map((day, idx) => {
                      if (!day) {
                        return <div key={`empty-${idx}`} />;
                      }
                      const isSel =
                        filterState.selectedDate &&
                        filterState.selectedDate.getDate() === day &&
                        filterState.selectedDate.getMonth() === currentCalendarMonth.getMonth() &&
                        filterState.selectedDate.getFullYear() === currentCalendarMonth.getFullYear();

                      return (
                        <button
                          key={`day-${day}`}
                          onClick={() => {
                            const d = new Date(currentCalendarMonth);
                            d.setDate(day);
                            handleUpdate({ selectedDate: isSel ? null : d });
                          }}
                          className={`py-1 rounded-md text-[11px] font-semibold transition cursor-pointer ${
                            isSel
                              ? "bg-primary text-primary-foreground font-bold shadow-soft"
                              : "text-foreground hover:bg-muted"
                          }`}
                        >
                          {day}
                        </button>
                      );
                    })}
                  </div>

                  <p className="text-[9px] text-muted-foreground text-center pt-1">
                    {filterState.selectedDate
                      ? `Filtro ativo: ${filterState.selectedDate.toLocaleDateString("pt-BR")}`
                      : "Selecione um dia específico"}
                  </p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── BOTÃO DE VARREDURA ── */}
      <SystemTooltip content={`Executar varredura ativa de novas mensagens e sincronizar clientes no ${personaName}`}>
        <button
          onClick={onVarredura || onRefresh}
          className="px-2.5 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1.5 border border-border bg-card text-foreground hover:bg-muted/60 cursor-pointer shadow-soft"
        >
          <Radio className="h-3.5 w-3.5 text-primary" />
          <span className="hidden sm:inline">Varredura</span>
        </button>
      </SystemTooltip>

      {/* ── BOTÃO HISTÓRICO E NOTAS (AO LADO DE VARREDURA) ── */}
      {showTriageHistory && tenantId && (
        <IndustrialTriageHistory
          key={tenantId}
          tenantId={tenantId}
          initialConversationId={selectedConversationId}
        />
      )}

      {/* ── BOTÃO ATUALIZAR ── */}
      <SystemTooltip content="Atualizar conversas e kanban em tempo real">
        <button
          onClick={onRefresh}
          className="px-2.5 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1.5 border border-border bg-card text-foreground hover:bg-muted/60 cursor-pointer shadow-soft"
        >
          <RefreshCw className={`h-3.5 w-3.5 text-primary ${isLoading ? "animate-spin" : ""}`} />
          <span className="hidden sm:inline">Atualizar</span>
        </button>
      </SystemTooltip>
    </div>
  );
}
