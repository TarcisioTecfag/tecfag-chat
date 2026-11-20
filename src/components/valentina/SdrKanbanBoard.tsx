// ══════════════════════════════════════════════════════════════════════════════
// 📋 SDR KANBAN BOARD — Visão de Funil de Triagem Fagner / Valentina
// ══════════════════════════════════════════════════════════════════════════════

import React, { useState, useMemo, useRef, useEffect, useCallback } from "react";
import {
  Clock,
  CheckCircle2,
  ChevronRight,
  ChevronLeft,
  Square,
  UserCheck,
  MessageSquare,
  Sparkles,
} from "lucide-react";
import type { SdrTriageSession } from "./SdrTab";
import {
  KANBAN_COLUMNS,
  KanbanColumnKey,
  classifySessionToColumn,
  filterSdrSessions,
  SdrFilterState,
  computeOffscreenKanbanIndicators,
  getColumnScrollTarget,
  OffscreenIndicatorInfo,
  OffscreenColumnMetric,
} from "./sdr-kanban-data";
import { getAiPersona } from "@/lib/ai-persona";
import { computeIndustrialTriageProgress } from "@/lib/triage/industrial-policy";
import { useChat } from "@/hooks/useChatState";
import { SystemTooltip } from "@/components/ui/tooltip";

export interface SdrKanbanBoardProps {
  sessions: SdrTriageSession[];
  selectedSessionId?: string | null;
  onSelectSession: (session: SdrTriageSession) => void;
  filterState: SdrFilterState;
  sdrEnabled?: boolean;
}

function formatTimeAgoFromIso(isoDate?: string | null): string {
  if (!isoDate) return "Recente";
  const ms = Date.parse(isoDate);
  if (Number.isNaN(ms)) return "Recente";
  const diffMin = Math.max(0, Math.floor((Date.now() - ms) / 60000));
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
}

export function SdrKanbanBoard({
  sessions,
  selectedSessionId,
  onSelectSession,
  filterState,
  sdrEnabled = true,
}: SdrKanbanBoardProps) {
  const { tenant } = useChat();
  const persona = getAiPersona(tenant || "");

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
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;

    if (
      target.closest('button, a, input, select, textarea, [role="button"], [data-no-pan]')
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

  const handleBoardWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const cardList = target.closest("[data-column-card-list]");
    if (cardList && cardList.scrollHeight > cardList.clientHeight) {
      return;
    }
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && boardContainerRef.current) {
      boardContainerRef.current.scrollLeft += e.deltaY;
    }
  };

  // Fonte única de filtragem compartilhada com SdrTab
  const filteredSessions = useMemo(
    () => filterSdrSessions(sessions, filterState),
    [sessions, filterState],
  );

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

  // ── INDICADORES DE AVISO PARA COLUNAS FORA DA ÁREA VISÍVEL ──
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

  useEffect(() => {
    const currentMap: Record<string, Set<string>> = {};
    for (const col of KANBAN_COLUMNS) {
      currentMap[col.key] = new Set((sessionsByColumn[col.key] || []).map((s) => s.id));
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
    [],
  );

  return (
    <div className="relative flex flex-col flex-1 h-full min-h-0 shrink-0">
      {/* ── INDICADOR DISCRETO ESQUERDO ── */}
      {offscreenIndicators.left && (
        <div className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 z-20">
          <SystemTooltip
            content={`${offscreenIndicators.left.targetCount} atendimento(s) em ${offscreenIndicators.left.targetColumnLabel} — Clique para rolar`}
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

      {/* ── INDICADOR DISCRETO DIREITO ── */}
      {offscreenIndicators.right && (
        <div className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 z-20">
          <SystemTooltip
            content={
              offscreenIndicators.right.hiddenColumnsWithCards.length > 1
                ? `${offscreenIndicators.right.targetCount} em ${offscreenIndicators.right.targetColumnLabel} (${offscreenIndicators.right.totalHiddenCount} no total à direita) — Clique para rolar`
                : `${offscreenIndicators.right.targetCount} atendimento(s) em ${offscreenIndicators.right.targetColumnLabel} — Clique para rolar`
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

      {/* ── QUADRO KANBAN COM PAN SCROLL (9 COLUNAS) ── */}
      <div
        ref={boardContainerRef}
        onScroll={handleBoardScroll}
        onPointerDown={handleBoardPointerDown}
        onWheel={handleBoardWheel}
        className={`w-full flex-1 min-h-0 flex flex-col overflow-x-auto overflow-y-hidden pb-2 pt-0.5 select-none transition-colors ${
          isPanning ? "cursor-grabbing" : "cursor-grab"
        } [&::-webkit-scrollbar]:h-2.5 [&::-webkit-scrollbar-track]:bg-muted/40 [&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/35 [&::-webkit-scrollbar-thumb:hover]:bg-primary [&::-webkit-scrollbar-thumb]:rounded-full`}
      >
        <div className="flex items-stretch gap-3 min-w-max flex-1 min-h-0 h-full">
          {KANBAN_COLUMNS.map((column) => {
            const ColumnIcon = column.icon;
            const columnSessions = sessionsByColumn[column.key] || [];
            const count = columnSessions.length;
            const awaitingCount = columnSessions.filter(
              (s) => s.status === "awaiting_approval",
            ).length;

            return (
              <div
                key={column.key}
                ref={(el) => {
                  columnRefs.current[column.key] = el;
                }}
                data-kanban-col={column.key}
                className="w-[260px] shrink-0 h-full min-h-0 flex flex-col bg-muted/15 dark:bg-zinc-900/30 rounded-2xl border border-border/80 overflow-hidden shadow-xs"
              >
                {/* Cabeçalho da Coluna */}
                <div
                  className={`flex items-center justify-between px-3 py-2.5 border-b border-border/80 shrink-0 ${column.headerBg}`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <ColumnIcon className="h-3.5 w-3.5 shrink-0" style={{ color: column.accentColor }} />
                    <span className="text-[11px] font-extrabold uppercase tracking-wide truncate text-foreground">
                      {column.label}
                    </span>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {awaitingCount > 0 && (
                      <SystemTooltip
                        content={`${awaitingCount} triagem(ns) aguardando aprovação SDR nesta coluna`}
                      >
                        <span className="inline-flex items-center gap-0.5 text-[9px] font-extrabold px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/35">
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                          {awaitingCount}
                        </span>
                      </SystemTooltip>
                    )}
                    <span
                      className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full shrink-0 ${column.badgeBg}`}
                    >
                      {count}
                    </span>
                  </div>
                </div>

                {/* Lista de Cards da Coluna */}
                <div
                  data-column-card-list="true"
                  className="p-2.5 flex flex-col gap-2 flex-1 min-h-0 overflow-y-auto scrollbar-thin"
                >
                  {columnSessions.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center p-4 text-center border border-dashed border-border/70 rounded-xl bg-card/40 min-h-[140px]">
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
                          .filter(Boolean)
                          .map((n) => n[0])
                          .slice(0, 2)
                          .join("")
                          .toUpperCase() || "C";

                      const adaptiveProgress = computeIndustrialTriageProgress({
                        subflow: session.subflow || null,
                        funnelStage: session.funnelStage || column.key || null,
                        targetFunnel: session.targetFunnel || null,
                        collectedData: session.collectedData || {},
                        company:
                          session.company && session.company !== "Empresa não informada"
                            ? session.company
                            : null,
                        isCompleted: session.status === "completed",
                      });

                      const filledCount =
                        session.triageProgress?.filledCount ?? adaptiveProgress.filledCount;
                      const totalCount =
                        session.triageProgress?.totalCount ?? adaptiveProgress.totalCount;
                      const progress =
                        session.triageProgress?.percentage ?? adaptiveProgress.percentage;

                      const botRunning = sdrEnabled && session.status === "active";
                      const isAwaitingApproval = session.status === "awaiting_approval";
                      const pendingApproval =
                        session.pendingApproval || session.monitoring?.pendingApproval || null;
                      const timeAgo = formatTimeAgoFromIso(
                        session.lastClientMessageAt || session.lastMessageAt || session.startedAt,
                      );

                      return (
                        <div
                          key={session.id}
                          onClick={() => onSelectSession(session)}
                          className={`group relative p-2.5 rounded-xl border bg-card text-left transition-all duration-150 cursor-pointer shadow-xs hover:shadow-md hover:border-primary/50 ${
                            isSelected
                              ? "border-primary ring-2 ring-primary/20 bg-primary-soft/10"
                              : isAwaitingApproval
                                ? "border-amber-500/60 ring-1 ring-amber-500/20 bg-amber-500/[0.04] hover:border-amber-500"
                                : "border-border/80 hover:bg-card"
                          }`}
                        >
                          {/* Top row: Foto real (com fallback de iniciais) + Nome + Unread */}
                          <div className="flex items-start justify-between gap-1.5">
                            <div className="flex items-start gap-2 min-w-0">
                              {session.contactAvatar ? (
                                <img
                                  src={session.contactAvatar}
                                  alt={session.contactName}
                                  className="h-7 w-7 rounded-full object-cover border border-primary/25 shrink-0"
                                  onError={(e) => {
                                    const img = e.currentTarget;
                                    img.style.display = "none";
                                    const fallback = img.nextElementSibling as HTMLElement | null;
                                    if (fallback) fallback.style.display = "flex";
                                  }}
                                />
                              ) : null}
                              <div
                                style={{ display: session.contactAvatar ? "none" : "flex" }}
                                className="h-7 w-7 rounded-full bg-primary/10 border border-primary/20 items-center justify-center text-primary font-bold text-[10px] shrink-0"
                              >
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

                            {Boolean(session.unreadCount && session.unreadCount > 0) && (
                              <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground shrink-0 tabular-nums">
                                {session.unreadCount}
                              </span>
                            )}
                          </div>

                          {/* Middle row: Progresso fiel a Campos X/Y */}
                          <div className="mt-2.5 space-y-1">
                            <div className="flex items-center justify-between text-[9px] text-muted-foreground">
                              <span>
                                Campos {filledCount}/{totalCount}
                              </span>
                              <span className="font-bold text-foreground tabular-nums">
                                {Math.round(progress)}%
                              </span>
                            </div>
                            <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all duration-300 ${
                                  progress >= 100
                                    ? "bg-emerald-500"
                                    : progress > 50
                                      ? "bg-primary"
                                      : "bg-primary/65"
                                }`}
                                style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
                              />
                            </div>
                          </div>

                          {/* Status Pill Fiel & Tempo */}
                          <div className="mt-2 flex items-center justify-between gap-1 text-[10px]">
                            {isAwaitingApproval ? (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-extrabold bg-amber-500/18 text-amber-700 dark:text-amber-300 border border-amber-500/40">
                                <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                                Aguardando Aprovação
                              </span>
                            ) : session.status === "completed" ? (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/12 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25">
                                <CheckCircle2 className="h-2.5 w-2.5" />
                                Transferido
                              </span>
                            ) : session.status === "abandoned" ? (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/12 text-amber-700 dark:text-amber-300 border border-amber-500/30">
                                <Clock className="h-2.5 w-2.5" />
                                Sem Resposta
                              </span>
                            ) : session.status === "stopped" ? (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-rose-500/12 text-rose-600 dark:text-rose-400 border border-rose-500/25">
                                <Square className="h-2.5 w-2.5" />
                                Interrompido
                              </span>
                            ) : session.status === "manual" ? (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-sky-500/12 text-sky-600 dark:text-sky-400 border border-sky-500/25">
                                <UserCheck className="h-2.5 w-2.5" />
                                Manual
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-primary-soft text-primary border border-primary/25">
                                <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                                Em Triagem
                              </span>
                            )}

                            <span className="text-[9px] text-muted-foreground font-mono shrink-0">
                              {timeAgo}
                            </span>
                          </div>

                          {isAwaitingApproval && pendingApproval && (
                            <div className="mt-1.5 px-2 py-1 rounded-lg bg-amber-500/10 border border-amber-500/25 text-[9px] text-amber-800 dark:text-amber-200 flex items-center gap-1 truncate">
                              <Sparkles className="h-2.5 w-2.5 text-amber-600 dark:text-amber-400 shrink-0" />
                              <span className="truncate font-semibold">
                                {pendingApproval.suggestedSectorName || pendingApproval.targetFunnel || "Setor"}
                                {pendingApproval.suggestedOperatorName
                                  ? ` → ${pendingApproval.suggestedOperatorName}`
                                  : ""}
                              </span>
                            </div>
                          )}

                          {/* Bottom Row: Estado real do Bot (respeitando toggle global) */}
                          <div className="mt-2 pt-1.5 border-t border-border/50 flex items-center justify-between text-[9px] text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <span
                                className={`h-1.5 w-1.5 rounded-full ${
                                  isAwaitingApproval
                                    ? "bg-amber-500"
                                    : botRunning
                                      ? "bg-emerald-500"
                                      : "bg-zinc-400"
                                }`}
                              />
                              <span className="font-semibold">
                                {persona.name}:{" "}
                                {isAwaitingApproval
                                  ? "pronto p/ aprovação"
                                  : botRunning
                                    ? "ativo"
                                    : sdrEnabled
                                      ? "parado"
                                      : "pausado"}
                              </span>
                            </span>

                            <span
                              className={`text-[8px] font-bold transition flex items-center gap-0.5 ${
                                isAwaitingApproval
                                  ? "text-amber-700 dark:text-amber-300 opacity-100"
                                  : "opacity-0 group-hover:opacity-100 text-primary"
                              }`}
                            >
                              {isAwaitingApproval ? (
                                <>
                                  <CheckCircle2 className="h-2.5 w-2.5" /> Aprovar
                                </>
                              ) : (
                                <>
                                  <MessageSquare className="h-2.5 w-2.5" /> Ver chat
                                </>
                              )}
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
