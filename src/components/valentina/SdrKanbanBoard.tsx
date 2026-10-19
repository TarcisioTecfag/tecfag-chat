// ══════════════════════════════════════════════════════════════════════════════
// 📋 SDR KANBAN BOARD — Visão de Funil de Triagem Fagner / Valentina
// ══════════════════════════════════════════════════════════════════════════════

import React, { useState, useMemo, useRef, useEffect, useCallback } from "react";
import {
  Clock,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
} from "lucide-react";
import { SdrTriageSession, getSdrSessionLatestClientTimestamp } from "./SdrTab";
import {
  KANBAN_COLUMNS,
  KanbanColumnKey,
  classifySessionToColumn,
  SdrFilterState,
  computeOffscreenKanbanIndicators,
  getColumnScrollTarget,
  OffscreenIndicatorInfo,
  OffscreenColumnMetric,
} from "./sdr-kanban-data";
import { getAiPersona } from "@/lib/ai-persona";
import { useChat } from "@/hooks/useChatState";
import { SystemTooltip } from "@/components/ui/tooltip";

export interface SdrKanbanBoardProps {
  sessions: SdrTriageSession[];
  selectedSessionId?: string | null;
  onSelectSession: (session: SdrTriageSession) => void;
  filterState: SdrFilterState;
}

export function SdrKanbanBoard({
  sessions,
  selectedSessionId,
  onSelectSession,
  filterState,
}: SdrKanbanBoardProps) {
  const { tenant } = useChat();
  const persona = getAiPersona(tenant || "tecfag");

  // Ref principal do container rolável do Kanban e refs individuais por coluna
  const boardContainerRef = useRef<HTMLDivElement>(null);
  const columnRefs = useRef<Partial<Record<KanbanColumnKey, HTMLDivElement | null>>>({});
  const scrollRafRef = useRef<number | null>(null);

  // ── ESTADO: PAN SCROLL HORIZONTAL (CLICAR E ARRASTAR A TELA COM O MOUSE) ──
  const [isPanning, setIsPanning] = useState(false);
  const panStateRef = useRef<{
    startX: number;
    startY: number;
    scrollLeft: number;
    hasMoved: boolean;
  } | null>(null);

  const handleBoardPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return; // apenas clique esquerdo
    const target = e.target as HTMLElement;

    // Ignora elementos interativos como botões, inputs, links
    if (
      target.closest(
        'button, a, input, select, textarea, [role="button"], [data-no-pan]'
      )
    ) {
      return;
    }

    const container = boardContainerRef.current;
    if (!container) return;

    panStateRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      scrollLeft: container.scrollLeft,
      hasMoved: false,
    };

    const handlePointerMove = (ev: PointerEvent) => {
      if (!panStateRef.current || !boardContainerRef.current) return;
      const dx = ev.clientX - panStateRef.current.startX;
      const dy = ev.clientY - panStateRef.current.startY;

      if (!panStateRef.current.hasMoved && Math.hypot(dx, dy) > 4) {
        panStateRef.current.hasMoved = true;
        setIsPanning(true);
        document.body.style.userSelect = "none";
      }

      if (panStateRef.current.hasMoved) {
        boardContainerRef.current.scrollLeft = panStateRef.current.scrollLeft - dx;
      }
    };

    const handlePointerUp = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);

      document.body.style.userSelect = "";
      setIsPanning(false);

      if (panStateRef.current?.hasMoved) {
        // Suprime clique se foi arrasto de tela para não disparar seleção de card
        const suppressClick = (clickEv: MouseEvent) => {
          clickEv.stopImmediatePropagation();
          clickEv.preventDefault();
          window.removeEventListener("click", suppressClick, true);
        };
        window.addEventListener("click", suppressClick, true);
      }
      panStateRef.current = null;
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
  };

  // Scroll horizontal suave com rodinha do mouse sobre áreas sem scroll vertical
  const handleBoardWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const cardList = target.closest("[data-column-card-list]");
    if (cardList && cardList.scrollHeight > cardList.clientHeight) {
      return; // Permite scroll vertical nativo na lista de cards
    }
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && boardContainerRef.current) {
      boardContainerRef.current.scrollLeft += e.deltaY;
    }
  };

  const { searchQuery, unreadOnly, showCompleted, statusFilter, selectedDate } = filterState;

  // Filtragem dos cards
  const filteredSessions = useMemo(() => {
    return sessions.filter((session) => {
      // 1. Busca por nome, empresa ou telefone
      if (searchQuery && searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchName = (session.contactName || "").toLowerCase().includes(q);
        const matchCompany = (session.company || "").toLowerCase().includes(q);
        const matchPhone = (session.phone || "").toLowerCase().includes(q);
        if (!matchName && !matchCompany && !matchPhone) return false;
      }

      // 2. Apenas não lidas
      if (unreadOnly) {
        const unread = (session as any).unreadCount || 0;
        if (unread <= 0) return false;
      }

      // 3. Ver Concluídos (se desligado, esconde concluídas)
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
    }).sort((a, b) => getSdrSessionLatestClientTimestamp(b) - getSdrSessionLatestClientTimestamp(a));
  }, [sessions, searchQuery, unreadOnly, showCompleted, statusFilter, selectedDate]);

  // Agrupamento pelas 9 colunas ativas
  const sessionsByColumn = useMemo(() => {
    const map: Record<KanbanColumnKey, SdrTriageSession[]> = {
      triagem: [],
      assistencia_tecnica: [],
      pos_venda: [],
      maquinas: [],
      personalite: [],
      financeiro: [],
      pecas: [],
      outros: [],
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

  // ── ESTADO: INDICADORES DE AVISO PARA COLUNAS FORA DA ÁREA VISÍVEL ──
  const [offscreenIndicators, setOffscreenIndicators] = useState<{
    left: OffscreenIndicatorInfo | null;
    right: OffscreenIndicatorInfo | null;
  }>({ left: null, right: null });
  const [hasNewRightArrival, setHasNewRightArrival] = useState(false);
  const prevSessionIdsByColRef = useRef<Record<string, Set<string>> | null>(null);

  const updateOffscreenIndicators = useCallback(() => {
    const container = boardContainerRef.current;
    if (!container) return;

    const containerRect = container.getBoundingClientRect();
    const containerWidth = container.clientWidth;

    const metrics: OffscreenColumnMetric[] = [];
    for (const col of KANBAN_COLUMNS) {
      const el = columnRefs.current[col.key];
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      metrics.push({
        key: col.key,
        label: col.label,
        accentColor: col.accentColor,
        count: (sessionsByColumn[col.key] || []).length,
        visibleLeft: rect.left - containerRect.left,
        visibleRight: rect.right - containerRect.left,
      });
    }

    const next = computeOffscreenKanbanIndicators(containerWidth, metrics);
    setOffscreenIndicators(next);

    if (!next.right) {
      setHasNewRightArrival(false);
    }
  }, [sessionsByColumn]);

  // Detecta entrada de novos clientes em colunas ocultas à direita (ex: OUTROS)
  useEffect(() => {
    const currentMap: Record<string, Set<string>> = {};
    for (const col of KANBAN_COLUMNS) {
      currentMap[col.key] = new Set(
        (sessionsByColumn[col.key] || []).map((s) => s.id)
      );
    }

    if (prevSessionIdsByColRef.current && boardContainerRef.current) {
      const container = boardContainerRef.current;
      const containerRect = container.getBoundingClientRect();
      const containerWidth = container.clientWidth;

      let detectedNewRight = false;
      for (const col of KANBAN_COLUMNS) {
        const el = columnRefs.current[col.key];
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        const visibleRight = rect.right - containerRect.left;
        const isHiddenRight = visibleRight > containerWidth + 12;

        if (isHiddenRight) {
          const prevSet = prevSessionIdsByColRef.current[col.key] || new Set();
          for (const id of currentMap[col.key]) {
            if (!prevSet.has(id)) {
              detectedNewRight = true;
              break;
            }
          }
        }
      }

      if (detectedNewRight) {
        setHasNewRightArrival(true);
      }
    }

    prevSessionIdsByColRef.current = currentMap;
    updateOffscreenIndicators();
  }, [sessionsByColumn, updateOffscreenIndicators]);

  useEffect(() => {
    const container = boardContainerRef.current;
    if (!container) return;

    updateOffscreenIndicators();

    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => updateOffscreenIndicators())
        : null;
    ro?.observe(container);
    window.addEventListener("resize", updateOffscreenIndicators);

    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", updateOffscreenIndicators);
      if (scrollRafRef.current !== null) {
        cancelAnimationFrame(scrollRafRef.current);
      }
    };
  }, [updateOffscreenIndicators]);

  const handleBoardScroll = useCallback(() => {
    if (scrollRafRef.current !== null) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      updateOffscreenIndicators();
    });
  }, [updateOffscreenIndicators]);

  const handleScrollToColumn = useCallback(
    (direction: "left" | "right", targetKey: KanbanColumnKey) => {
      const container = boardContainerRef.current;
      const colEl = columnRefs.current[targetKey];
      if (!container || !colEl) return;

      const containerRect = container.getBoundingClientRect();
      const colRect = colEl.getBoundingClientRect();

      const targetScrollLeft = getColumnScrollTarget({
        direction,
        currentScrollLeft: container.scrollLeft,
        containerWidth: container.clientWidth,
        columnVisibleLeft: colRect.left - containerRect.left,
        columnVisibleRight: colRect.right - containerRect.left,
        paddingPx: 8,
      });

      if (direction === "right") {
        setHasNewRightArrival(false);
      }

      container.scrollTo({
        left: targetScrollLeft,
        behavior: "smooth",
      });
    },
    []
  );

  // Manipulação do clique do card com scroll suave para o chat
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

  return (
    <div className="relative flex flex-col shrink-0">
      {/* ── INDICADOR DISCRETO ESQUERDO (COLUNAS COM CARDS À ESQUERDA FORA DE VISÃO) ── */}
      {offscreenIndicators.left && (
        <div className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 z-20">
          <SystemTooltip
            content={`${offscreenIndicators.left.targetCount} atendimento(s) em ${offscreenIndicators.left.targetColumnLabel} — Clique para rolar até ${offscreenIndicators.left.targetColumnLabel}`}
          >
            <button
              type="button"
              data-no-pan="true"
              onClick={() =>
                offscreenIndicators.left &&
                handleScrollToColumn("left", offscreenIndicators.left.targetColumnKey)
              }
              className="pointer-events-auto group/nav flex items-center gap-1.5 h-8 px-2.5 rounded-full bg-card/95 dark:bg-zinc-900/95 backdrop-blur-md border border-border/90 hover:border-primary/60 shadow-md hover:shadow-lg transition-all duration-200 cursor-pointer"
            >
              <ChevronLeft className="h-3.5 w-3.5 text-muted-foreground group-hover/nav:text-primary group-hover/nav:-translate-x-0.5 transition-all shrink-0" />
              <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground leading-none">
                {offscreenIndicators.left.targetCount}
              </span>
              <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground group-hover/nav:text-foreground transition-colors">
                {offscreenIndicators.left.targetColumnLabel}
              </span>
            </button>
          </SystemTooltip>
        </div>
      )}

      {/* ── INDICADOR DISCRETO DIREITO (EX: CLIENTES EM OUTROS FORA DA TELA INICIAL) ── */}
      {offscreenIndicators.right && (
        <div className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 z-20">
          <SystemTooltip
            content={
              offscreenIndicators.right.hiddenColumnsWithCards.length > 1
                ? `${offscreenIndicators.right.targetCount} em ${offscreenIndicators.right.targetColumnLabel} (${offscreenIndicators.right.totalHiddenCount} no total à direita) — Clique para rolar até ${offscreenIndicators.right.targetColumnLabel}`
                : `${offscreenIndicators.right.targetCount} atendimento(s) em ${offscreenIndicators.right.targetColumnLabel} — Clique para rolar até ${offscreenIndicators.right.targetColumnLabel}`
            }
          >
            <button
              type="button"
              data-no-pan="true"
              onClick={() =>
                offscreenIndicators.right &&
                handleScrollToColumn("right", offscreenIndicators.right.targetColumnKey)
              }
              className={`pointer-events-auto group/nav flex items-center gap-1.5 h-8 px-2.5 rounded-full bg-card/95 dark:bg-zinc-900/95 backdrop-blur-md border shadow-md hover:shadow-lg transition-all duration-200 cursor-pointer ${
                hasNewRightArrival
                  ? "border-primary ring-2 ring-primary/30"
                  : "border-border/90 hover:border-primary/60"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                  hasNewRightArrival ? "bg-primary animate-ping" : ""
                }`}
                style={{
                  backgroundColor: hasNewRightArrival
                    ? undefined
                    : offscreenIndicators.right.accentColor,
                }}
              />
              <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground group-hover/nav:text-foreground transition-colors">
                {offscreenIndicators.right.targetColumnLabel}
              </span>
              <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground leading-none">
                {offscreenIndicators.right.targetCount}
              </span>
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground group-hover/nav:text-primary group-hover/nav:translate-x-0.5 transition-all shrink-0" />
            </button>
          </SystemTooltip>
        </div>
      )}

      {/* ── QUADRO KANBAN COM PAN SCROLL POR CLIQUE E ARRASTE (9 COLUNAS) ── */}
      <div
        ref={boardContainerRef}
        onScroll={handleBoardScroll}
        onPointerDown={handleBoardPointerDown}
        onWheel={handleBoardWheel}
        className={`w-full overflow-x-auto overflow-y-hidden pb-3 pt-1 select-none transition-colors ${
          isPanning ? "cursor-grabbing" : "cursor-grab"
        } [&::-webkit-scrollbar]:h-2.5 [&::-webkit-scrollbar-track]:bg-muted/40 [&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/35 [&::-webkit-scrollbar-thumb:hover]:bg-primary [&::-webkit-scrollbar-thumb]:rounded-full`}
      >
        <div className="flex items-start gap-3 min-w-max">
          {KANBAN_COLUMNS.map((column) => {
            const ColumnIcon = column.icon;
            const columnSessions = sessionsByColumn[column.key] || [];
            const count = columnSessions.length;

            return (
              <div
                key={column.key}
                ref={(el) => {
                  columnRefs.current[column.key] = el;
                }}
                data-kanban-col={column.key}
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
                <div
                  data-column-card-list="true"
                  className="p-2.5 flex flex-col gap-2 min-h-[360px] max-h-[520px] overflow-y-auto scrollbar-thin"
                >
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

                      const filledFieldsCount = Object.values(session.collectedData || {}).filter((f: any) => {
                        if (!f) return false;
                        if (typeof f === "object" && f.status === "filled") return true;
                        const textVal = typeof f === "string" ? f : f.value;
                        return Boolean(
                          textVal &&
                            String(textVal).trim() !== "" &&
                            String(textVal) !== "Aguardando..." &&
                            !String(textVal).toLowerCase().includes("mantem")
                        );
                      }).length;

                      const progress =
                        (session as any).progressPct ??
                        Math.min(100, Math.round((filledFieldsCount / 6) * 100));

                      const isConcluida =
                        session.status === "completed" ||
                        (session as any).triageStatus === "concluida" ||
                        session.outcome === "completed";

                      const isSemResposta =
                        column.key === "sem_resposta" ||
                        (session as any).triageStatus === "sem_resposta" ||
                        session.outcome === "sem_resposta";

                      const botAtivo = (session as any).botStatus === "ativo" || session.status === "active";

                      const timeAgo = (() => {
                        if ((session as any).timeAgo) return (session as any).timeAgo;
                        if (!session.startedAt) return "Recente";
                        const startedMs = new Date(session.startedAt).getTime();
                        if (isNaN(startedMs)) return "Recente";
                        const diffMin = Math.max(0, Math.floor((Date.now() - startedMs) / 60000));
                        if (diffMin < 1) return "Agora";
                        if (diffMin < 60) return `${diffMin} min`;
                        const hours = Math.floor(diffMin / 60);
                        const mins = diffMin % 60;
                        if (hours < 24) {
                          return mins > 0 ? `${hours}h ${mins} min` : `${hours}h`;
                        }
                        const days = Math.floor(hours / 24);
                        const remHours = hours % 24;
                        return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
                      })();

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
                              Abrir chat <ChevronDown className="h-2.5 w-2.5" />
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
