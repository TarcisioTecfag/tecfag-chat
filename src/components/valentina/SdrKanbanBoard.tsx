// ══════════════════════════════════════════════════════════════════════════════
// 📌 SDR KANBAN BOARD — Visão de Funil de Triagem Fagner / Valentina
// ══════════════════════════════════════════════════════════════════════════════

import React, { useState, useMemo, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  Filter,
  RefreshCw,
  Power,
  EyeOff,
  Eye,
  X,
  ChevronLeft,
  ChevronRight,
  Clock,
  CheckCircle2,
  AlertCircle,
  MessageSquare,
  Radio,
  SlidersHorizontal,
  Bot,
  Sparkles,
} from "lucide-react";
import { SdrTriageSession } from "./SdrTab";
import { KANBAN_COLUMNS, KanbanColumnDef, classifySessionToColumn } from "./sdr-kanban-data";
import { getAiPersona } from "@/lib/ai-persona";
import { useChat } from "@/hooks/useChatState";
import { toast } from "sonner";

export interface SdrKanbanBoardProps {
  sessions: SdrTriageSession[];
  selectedSessionId?: string | null;
  onSelectSession: (session: SdrTriageSession) => void;
  sdrEnabled: boolean;
  onToggleSdr: () => void;
  onRefresh: () => void;
  isLoading?: boolean;
}

export function SdrKanbanBoard({
  sessions,
  selectedSessionId,
  onSelectSession,
  sdrEnabled,
  onToggleSdr,
  onRefresh,
  isLoading,
}: SdrKanbanBoardProps) {
  const { tenant } = useChat();
  const persona = getAiPersona(tenant || "tecfag");

  // Busca e Filtros
  const [searchQuery, setSearchQuery] = useState("");
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [showCompleted, setShowCompleted] = useState(true);
  const [statusFilter, setStatusFilter] = useState<"all" | "analisando" | "concluida">("all");
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [currentCalendarMonth, setCurrentCalendarMonth] = useState<Date>(new Date());

  const filterRef = useRef<HTMLDivElement | null>(null);

  // Fechar popover ao clicar fora
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

  // Filtragem dos cards
  const filteredSessions = useMemo(() => {
    return sessions.filter((session) => {
      // 1. Busca por nome, empresa ou telefone
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchName = session.contactName.toLowerCase().includes(q);
        const matchCompany = (session.company || "").toLowerCase().includes(q);
        const matchPhone = (session.phone || "").toLowerCase().includes(q);
        if (!matchName && !matchCompany && !matchPhone) return false;
      }

      // 2. Apenas não lidas
      if (unreadOnly) {
        const unread = (session as any).unreadCount || 0;
        if (unread <= 0) return false;
      }

      // 3. Ver Ocultados (se desligado, esconde concluídas)
      if (!showCompleted) {
        const isCompleted =
          session.status === "completed" ||
          (session as any).triageStatus === "concluida" ||
          session.outcome === "completed";
        if (isCompleted) return false;
      }

      // 4. Status da Triagem
      if (statusFilter === "analisando") {
        const isCompleted =
          session.status === "completed" ||
          (session as any).triageStatus === "concluida" ||
          session.outcome === "completed";
        if (isCompleted) return false;
      } else if (statusFilter === "concluida") {
        const isCompleted =
          session.status === "completed" ||
          (session as any).triageStatus === "concluida" ||
          session.outcome === "completed";
        if (!isCompleted) return false;
      }

      // 5. Filtro de Data
      if (selectedDate && session.startedAt) {
        const sessDate = new Date(session.startedAt);
        const sameDay =
          sessDate.getDate() === selectedDate.getDate() &&
          sessDate.getMonth() === selectedDate.getMonth() &&
          sessDate.getFullYear() === selectedDate.getFullYear();
        if (!sameDay) return false;
      }

      return true;
    });
  }, [sessions, searchQuery, unreadOnly, showCompleted, statusFilter, selectedDate]);

  // Agrupamento por colunas
  const sessionsByColumn = useMemo(() => {
    const map: Record<string, SdrTriageSession[]> = {
      triagem: [],
      assistencia_tecnica: [],
      pos_venda: [],
      maquinas: [],
      personalite: [],
      financeiro: [],
      pecas: [],
      avulso: [],
      outros: [],
      problemas: [],
      sem_resposta: [],
    };

    for (const session of filteredSessions) {
      const colKey = classifySessionToColumn(session);
      if (map[colKey]) {
        map[colKey].push(session);
      } else {
        map.outros.push(session);
      }
    }

    return map;
  }, [filteredSessions]);

  // Manipulação do clique do card com animação suave para o chat
  const handleCardClick = (session: SdrTriageSession) => {
    onSelectSession(session);

    // Animação de scroll suave até a área de chat logo abaixo
    setTimeout(() => {
      const chatSection = document.getElementById("sdr-live-chat-section");
      if (chatSection) {
        chatSection.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 60);
  };

  const handleVarreduraClick = () => {
    toast.info(`Varredura ativa: ${persona.name} está monitorando 100% das mensagens recebidas.`);
    onRefresh();
  };

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
    "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
  ];

  return (
    <div className="flex flex-col gap-3 shrink-0">
      {/* ── HEADER SUPERIOR DE CONTROLE (Fagner Conversas) ──────────────────── */}
      <div className="flex items-center justify-between gap-3 px-5 py-3 bg-card rounded-2xl border border-border shadow-xs flex-wrap">
        {/* Lado Esquerdo: Identificação do Agente */}
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="h-9 w-9 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary font-bold text-sm shadow-xs overflow-hidden">
              <Bot className="h-5 w-5" />
            </div>
            <span
              className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full ring-2 ring-card ${
                sdrEnabled ? "bg-emerald-500 animate-pulse" : "bg-zinc-400"
              }`}
            />
          </div>

          <div>
            <h2 className="text-sm font-extrabold text-foreground flex items-center gap-2">
              <span>{persona.name} Conversas</span>
            </h2>
            <p className="text-[11px] text-muted-foreground">
              Conversas em tempo real pela Inteligência, sem intervenção humana.
            </p>
          </div>
        </div>

        {/* Lado Direito: Busca, Filtros, Varredura, Status e Atualizar */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Campo de Busca */}
          <div className="relative min-w-[220px]">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Nome, empresa ou telefone..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 rounded-xl border border-border bg-muted/20 text-xs focus:outline-none focus:ring-2 focus:ring-primary/20 placeholder:text-muted-foreground/60 text-foreground transition"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-2 p-0.5 rounded-full hover:bg-muted text-muted-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          {/* Botão Filtros com Popover */}
          <div className="relative" ref={filterRef}>
            <button
              onClick={() => setIsFilterOpen(!isFilterOpen)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 border cursor-pointer shadow-xs ${
                isFilterOpen || unreadOnly || !showCompleted || statusFilter !== "all" || selectedDate
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card text-foreground border-border hover:bg-muted/60"
              }`}
            >
              <Filter className="h-3.5 w-3.5" />
              <span>Filtros</span>
              {(unreadOnly || !showCompleted || statusFilter !== "all" || selectedDate) && (
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
              )}
            </button>

            {/* POPOVER FILTROS AVANÇADOS (Fiel à foto media_1791552956302.png) */}
            <AnimatePresence>
              {isFilterOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 6, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 6, scale: 0.97 }}
                  transition={{ duration: 0.16 }}
                  className="absolute right-0 mt-2 z-50 w-72 rounded-2xl bg-zinc-950 border border-zinc-800 text-zinc-100 shadow-2xl p-4 space-y-4"
                >
                  {/* Cabeçalho */}
                  <div className="flex items-center justify-between border-b border-zinc-800/80 pb-2">
                    <h4 className="text-xs font-extrabold tracking-wide uppercase text-zinc-100">
                      Filtros Avançados
                    </h4>
                    <button
                      onClick={() => setIsFilterOpen(false)}
                      className="p-1 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {/* Switch 1: Apenas não lidas */}
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <span className="text-xs font-bold block text-zinc-100">Apenas não lidas</span>
                      <span className="text-[10px] text-zinc-400 block">
                        Mostra somente chats com mensagens novas
                      </span>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={unreadOnly}
                      onClick={() => setUnreadOnly(!unreadOnly)}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                        unreadOnly ? "bg-emerald-500" : "bg-zinc-700"
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                          unreadOnly ? "translate-x-4" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>

                  {/* Switch 2: Ver Ocultados */}
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <span className="text-xs font-bold flex items-center gap-1.5 text-zinc-100">
                        <EyeOff className="h-3.5 w-3.5 text-zinc-400" />
                        Ver Ocultados
                      </span>
                      <span className="text-[10px] text-zinc-400 block">
                        Exibe cards com triagem concluída
                      </span>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={showCompleted}
                      onClick={() => setShowCompleted(!showCompleted)}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                        showCompleted ? "bg-emerald-500" : "bg-zinc-700"
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                          showCompleted ? "translate-x-4" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>

                  {/* Status da Triagem */}
                  <div className="space-y-1.5 pt-1">
                    <span className="text-[10px] font-extrabold uppercase tracking-wider text-zinc-400 block">
                      Status da Triagem
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => setStatusFilter(statusFilter === "analisando" ? "all" : "analisando")}
                        className={`px-3 py-1 rounded-xl text-xs font-bold transition flex-1 border ${
                          statusFilter === "analisando"
                            ? "bg-zinc-800 text-white border-zinc-600 shadow-inner"
                            : "bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-zinc-200"
                        }`}
                      >
                        Analisando
                      </button>
                      <button
                        onClick={() => setStatusFilter(statusFilter === "concluida" ? "all" : "concluida")}
                        className={`px-3 py-1 rounded-xl text-xs font-bold transition flex-1 border ${
                          statusFilter === "concluida"
                            ? "bg-zinc-800 text-white border-zinc-600 shadow-inner"
                            : "bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-zinc-200"
                        }`}
                      >
                        Concluída
                      </button>
                    </div>
                  </div>

                  {/* Seletor de Período / Mini Calendário */}
                  <div className="space-y-2 pt-1 border-t border-zinc-800/80">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-extrabold uppercase tracking-wider text-zinc-400">
                        Período
                      </span>
                      {selectedDate && (
                        <button
                          onClick={() => setSelectedDate(null)}
                          className="text-[10px] text-primary hover:underline"
                        >
                          Limpar data
                        </button>
                      )}
                    </div>

                    <div className="p-2.5 rounded-xl bg-zinc-900 border border-zinc-800 space-y-2">
                      <div className="flex items-center justify-between text-xs font-bold px-1">
                        <button
                          onClick={() => {
                            const prev = new Date(currentCalendarMonth);
                            prev.setMonth(prev.getMonth() - 1);
                            setCurrentCalendarMonth(prev);
                          }}
                          className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100"
                        >
                          <ChevronLeft className="h-3.5 w-3.5" />
                        </button>
                        <span>
                          {monthNames[currentCalendarMonth.getMonth()]} {currentCalendarMonth.getFullYear()}
                        </span>
                        <button
                          onClick={() => {
                            const next = new Date(currentCalendarMonth);
                            next.setMonth(next.getMonth() + 1);
                            setCurrentCalendarMonth(next);
                          }}
                          className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100"
                        >
                          <ChevronRight className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      {/* Grade de Dias */}
                      <div className="grid grid-cols-7 gap-1 text-center text-[10px]">
                        {["D", "S", "T", "Q", "Q", "S", "S"].map((d, i) => (
                          <span key={i} className="text-zinc-500 font-bold py-0.5">
                            {d}
                          </span>
                        ))}
                        {calendarDays.map((day, idx) => {
                          if (!day) {
                            return <div key={`empty-${idx}`} />;
                          }
                          const isSel =
                            selectedDate &&
                            selectedDate.getDate() === day &&
                            selectedDate.getMonth() === currentCalendarMonth.getMonth() &&
                            selectedDate.getFullYear() === currentCalendarMonth.getFullYear();

                          return (
                            <button
                              key={`day-${day}`}
                              onClick={() => {
                                const d = new Date(currentCalendarMonth);
                                d.setDate(day);
                                setSelectedDate(isSel ? null : d);
                              }}
                              className={`py-1 rounded text-[11px] font-semibold transition ${
                                isSel
                                  ? "bg-primary text-primary-foreground font-bold"
                                  : "text-zinc-300 hover:bg-zinc-800"
                              }`}
                            >
                              {day}
                            </button>
                          );
                        })}
                      </div>

                      <p className="text-[9px] text-zinc-400 text-center pt-1">
                        {selectedDate
                          ? `Filtro ativo: ${selectedDate.toLocaleDateString("pt-BR")}`
                          : "Selecione a data inicial"}
                      </p>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Botão Varredura */}
          <button
            onClick={handleVarreduraClick}
            title="Executar varredura ativa de novas mensagens e sincronizar clientes"
            className="px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 border border-border bg-card text-foreground hover:bg-muted/60 cursor-pointer shadow-xs"
          >
            <Radio className="h-3.5 w-3.5 text-primary" />
            <span>Varredura</span>
          </button>

          {/* Botão Status Ativo/Pausado */}
          <button
            onClick={onToggleSdr}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 border cursor-pointer shadow-xs ${
              sdrEnabled
                ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800/60 hover:bg-emerald-100"
                : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border-zinc-300 dark:border-zinc-700 hover:bg-zinc-200"
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${
                sdrEnabled ? "bg-emerald-500 animate-pulse" : "bg-zinc-400"
              }`}
            />
            <span>
              {persona.name} {sdrEnabled ? "(Ativo)" : "(Pausado)"}
            </span>
          </button>

          {/* Botão Atualizar */}
          <button
            onClick={onRefresh}
            title="Atualizar conversas e kanban"
            className="px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 border border-border bg-card text-foreground hover:bg-muted/60 cursor-pointer shadow-xs"
          >
            <RefreshCw className={`h-3.5 w-3.5 text-primary ${isLoading ? "animate-spin" : ""}`} />
            <span>Atualizar</span>
          </button>
        </div>
      </div>

      {/* ── QUADRO KANBAN COM SCROLL HORIZONTAL (11 COLUNAS) ───────────────── */}
      <div className="w-full overflow-x-auto pb-3 pt-1 scrollbar-thin">
        <div className="flex items-start gap-3 min-w-max">
          {KANBAN_COLUMNS.map((column) => {
            const ColumnIcon = column.icon;
            const columnSessions = sessionsByColumn[column.key] || [];
            const count = columnSessions.length;

            return (
              <div
                key={column.key}
                className="w-[260px] shrink-0 flex flex-col bg-muted/15 dark:bg-zinc-900/30 rounded-2xl border border-border/80 overflow-hidden shadow-xs"
              >
                {/* Cabeçalho da Coluna */}
                <div
                  className={`flex items-center justify-between px-3 py-2.5 border-b border-border/80 ${column.headerBg}`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <ColumnIcon className="h-3.5 w-3.5 shrink-0" style={{ color: column.accentColor }} />
                    <span className="text-[11px] font-extrabold uppercase tracking-wide truncate text-foreground">
                      {column.label}
                    </span>
                  </div>

                  <span
                    className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full shrink-0 ${column.badgeBg}`}
                  >
                    {count}
                  </span>
                </div>

                {/* Lista de Cards da Coluna */}
                <div className="p-2.5 flex flex-col gap-2 min-h-[360px] max-h-[520px] overflow-y-auto scrollbar-thin">
                  {columnSessions.length === 0 ? (
                    // Empty State da Coluna
                    <div className="flex-1 flex flex-col items-center justify-center p-4 text-center border border-dashed border-border/70 rounded-xl bg-card/40 my-auto min-h-[140px]">
                      <div className="h-8 w-8 rounded-full bg-muted/60 flex items-center justify-center text-muted-foreground mb-2">
                        <ColumnIcon className="h-4 w-4" style={{ color: column.accentColor }} />
                      </div>
                      <span className="text-[11px] font-bold text-foreground">Nenhum cliente</span>
                      <p className="text-[9px] text-muted-foreground mt-0.5 leading-tight max-w-[170px]">
                        {column.emptyText}
                      </p>
                    </div>
                  ) : (
                    columnSessions.map((session) => {
                      const isSelected = selectedSessionId === session.id;
                      const initials =
                        session.contactName
                          ?.split(" ")
                          .map((n) => n[0])
                          .slice(0, 2)
                          .join("")
                          .toUpperCase() || "C";

                      const progress =
                        (session as any).progressPct ??
                        Math.min(
                          100,
                          Math.round(
                            (Object.values(session.collectedData || {}).filter(
                              (f) => f && f.status === "filled"
                            ).length /
                              6) *
                              100
                          )
                        );

                      const isConcluida =
                        session.status === "completed" ||
                        (session as any).triageStatus === "concluida" ||
                        session.outcome === "completed";

                      const isSemResposta =
                        column.key === "sem_resposta" ||
                        (session as any).triageStatus === "sem_resposta" ||
                        session.outcome === "sem_resposta";

                      const botAtivo = (session as any).botStatus === "ativo" || session.status === "active";

                      const timeAgo =
                        (session as any).timeAgo ||
                        (session.startedAt ? "Hoje" : "Recente");

                      return (
                        <div
                          key={session.id}
                          onClick={() => handleCardClick(session)}
                          className={`group relative p-2.5 rounded-xl border bg-card text-left transition-all duration-150 cursor-pointer shadow-xs hover:shadow-md hover:border-primary/50 ${
                            isSelected
                              ? "border-primary ring-2 ring-primary/20 bg-primary-soft/10"
                              : "border-border/80 hover:bg-card"
                          }`}
                        >
                          {/* Top row: Avatar + Nome + Badge */}
                          <div className="flex items-start justify-between gap-1.5">
                            <div className="flex items-start gap-2 min-w-0">
                              <div className="h-7 w-7 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary font-bold text-[10px] shrink-0">
                                {initials}
                              </div>

                              <div className="min-w-0">
                                <h5 className="text-[11px] font-bold text-foreground truncate group-hover:text-primary transition leading-tight">
                                  {session.contactName}
                                </h5>
                                <p className="text-[9px] text-muted-foreground truncate leading-tight mt-0.5">
                                  {session.company && session.company !== "Empresa não informada"
                                    ? session.company
                                    : session.phone || "Contato WhatsApp"}
                                </p>
                              </div>
                            </div>

                            {/* Badge top-right */}
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground shrink-0">
                              {(session as any).unreadCount ? (session as any).unreadCount : "•"}
                            </span>
                          </div>

                          {/* Middle row: Barra de Progresso */}
                          <div className="mt-2.5 space-y-1">
                            <div className="flex items-center justify-between text-[9px] text-muted-foreground">
                              <span>Progresso</span>
                              <span className="font-bold text-foreground">{progress}%</span>
                            </div>
                            <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all duration-300 ${
                                  isConcluida
                                    ? "bg-emerald-500"
                                    : progress > 50
                                    ? "bg-primary"
                                    : "bg-amber-500"
                                }`}
                                style={{ width: `${progress}%` }}
                              />
                            </div>
                          </div>

                          {/* Status Pill & Time Row */}
                          <div className="mt-2 flex items-center justify-between gap-1 text-[10px]">
                            {isConcluida ? (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/40">
                                <CheckCircle2 className="h-2.5 w-2.5" />
                                Triagem concluída
                              </span>
                            ) : isSemResposta ? (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800/40">
                                <Clock className="h-2.5 w-2.5" />
                                Sem Resposta
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800/40">
                                <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                                Analisando...
                              </span>
                            )}

                            <span className="text-[9px] text-muted-foreground font-mono shrink-0">
                              {timeAgo}
                            </span>
                          </div>

                          {/* Bottom Row: Bot Status */}
                          <div className="mt-2 pt-1.5 border-t border-border/50 flex items-center justify-between text-[9px] text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <span
                                className={`h-1.5 w-1.5 rounded-full ${
                                  botAtivo ? "bg-emerald-500" : "bg-zinc-400"
                                }`}
                              />
                              <span className="font-semibold">
                                {persona.name}: {botAtivo ? "ativo" : "parado"}
                              </span>
                            </span>

                            <span className="text-[8px] opacity-0 group-hover:opacity-100 text-primary font-bold transition flex items-center gap-0.5">
                              Abrir chat ↓
                            </span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
