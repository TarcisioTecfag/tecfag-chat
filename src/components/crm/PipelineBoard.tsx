import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { PipelineColumn, PipelineStageData, PipelineStageSummary } from "./PipelineColumn";
import { DealCard, DealCardData } from "./DealCard";
import { StageTerminalConfirmDialog } from "./StageTerminalConfirmDialog";

interface PipelineBoardProps {
  pipeline: {
    id: string;
    name: string;
    coolingDays?: number;
    stages: PipelineStageData[];
  };
  deals: DealCardData[];
  stageSettings?: Record<string, { coolingEnabled: boolean; coolingDays: number }>;
  stagesSummaryMap?: Map<string, PipelineStageSummary>;
  operatorsMap: Map<string, string>;
  onDealClick: (deal: DealCardData) => void;
  onMoveDeal: (
    dealId: string,
    newStageId: string,
    currentVersion: number,
    terminalData?: { status: "won" | "lost"; lossReason?: string; value?: string | number | null }
  ) => void;
  onNewDealAtStage?: (stageId: string) => void;
  onCreateTaskClick?: (deal: DealCardData) => void;
  onLoadMoreStage?: (stageId: string) => void;
  loadingMoreStages?: Record<string, boolean>;
}

interface ActiveDragInfo {
  deal: DealCardData;
  originStageId: string;
  cardWidth: number;
  cardHeight: number;
  initialX: number;
  initialY: number;
}

export function PipelineBoard({
  pipeline,
  deals,
  stageSettings,
  stagesSummaryMap,
  operatorsMap,
  onDealClick,
  onMoveDeal,
  onNewDealAtStage,
  onCreateTaskClick,
  onLoadMoreStage,
  loadingMoreStages,
}: PipelineBoardProps) {
  // Ordena etapas (Memoizado para manter referências estáveis)
  const sortedStages = useMemo(
    () => [...(pipeline.stages || [])].sort((a, b) => a.orderIndex - b.orderIndex),
    [pipeline.stages]
  );

  // Mapeamento simplificado para select de troca de etapas (Memoizado)
  const allStages = useMemo(
    () => sortedStages.map((s) => ({ id: s.id, name: s.name })),
    [sortedStages]
  );

  // Ref principal do container rolável do Kanban
  const boardContainerRef = useRef<HTMLDivElement>(null);

  // ── ESTADO 1: PAN SCROLL (CLICAR E ARRASTAR A TELA COM O MOUSE) ──
  const [isPanning, setIsPanning] = useState(false);
  const panStateRef = useRef<{
    startX: number;
    startY: number;
    scrollLeft: number;
    hasMoved: boolean;
  } | null>(null);

  // ── ESTADO 2: DRAG & DROP ZERO-RERENDER (120 FPS DIRETO NO DOM VIA GPU + RAF) ──
  const [activeDrag, setActiveDrag] = useState<ActiveDragInfo | null>(null);
  const hoveredStageIdRef = useRef<string | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Estado para diálogo de confirmação em etapa terminal (Ganho/Perda)
  const [terminalConfirm, setTerminalConfirm] = useState<{
    dealId: string;
    version: number;
    targetStageId: string;
    targetStageName: string;
    dealTitle: string;
    currentValue?: string | number | null;
    type: "win" | "loss";
  } | null>(null);

  // Agrupa deals por stageId (Memoizado estritamente para não quebrar React.memo das colunas)
  const dealsByStage = useMemo(() => {
    const map = new Map<string, DealCardData[]>();
    for (const s of sortedStages) {
      map.set(s.id, []);
    }

    for (const deal of deals) {
      const list = map.get(deal.stageId);
      if (list) {
        list.push(deal);
      } else {
        const firstStage = sortedStages[0];
        if (firstStage) {
          map.get(firstStage.id)?.push(deal);
        }
      }
    }
    return map;
  }, [sortedStages, deals]);

  // Intercepta movimentação para verificar etapa terminal
  const handleInterceptMove = useCallback(
    (dealId: string, newStageId: string, version: number) => {
      const targetStage = sortedStages.find((s) => s.id === newStageId);
      const deal = deals.find((d) => d.id === dealId);

      if (targetStage?.isWinStage) {
        setTerminalConfirm({
          dealId,
          version,
          targetStageId: newStageId,
          targetStageName: targetStage.name,
          dealTitle: deal?.title || "Negociação",
          currentValue: deal?.value,
          type: "win",
        });
        return;
      }

      if (targetStage?.isLossStage) {
        setTerminalConfirm({
          dealId,
          version,
          targetStageId: newStageId,
          targetStageName: targetStage.name,
          dealTitle: deal?.title || "Negociação",
          currentValue: deal?.value,
          type: "loss",
        });
        return;
      }

      // Etapa padrão não terminal
      onMoveDeal(dealId, newStageId, version);
    },
    [sortedStages, deals, onMoveDeal]
  );

  // Cancelamento via tecla ESC
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && activeDrag) {
        document.body.style.userSelect = "";
        document.body.style.cursor = "";

        // Remove highlights e fantasmas do DOM
        const container = boardContainerRef.current;
        if (container) {
          const targets = container.querySelectorAll<HTMLElement>("[data-is-target]");
          targets.forEach((el) => el.removeAttribute("data-is-target"));
          const ghosts = container.querySelectorAll<HTMLElement>("[data-is-ghost]");
          ghosts.forEach((el) => el.removeAttribute("data-is-ghost"));
        }

        hoveredStageIdRef.current = null;
        setActiveDrag(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeDrag]);

  // ── INÍCIO DO ARRASTO DE CARD 120 FPS NATIVO (ZERO RE-RENDERS DURANTE O ARRASTE) ──
  const handleStartCardDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, deal: DealCardData) => {
      if (e.button !== 0) return; // apenas clique primário
      const cardEl = e.currentTarget;
      const rect = cardEl.getBoundingClientRect();
      const grabOffsetX = e.clientX - rect.left;
      const grabOffsetY = e.clientY - rect.top;

      const container = boardContainerRef.current;
      if (!container) return;

      const candidate = {
        cardEl,
        deal,
        originStageId: deal.stageId,
        startX: e.clientX,
        startY: e.clientY,
        cardWidth: rect.width,
        cardHeight: rect.height,
        grabOffsetX,
        grabOffsetY,
        isDragging: false,
      };

      // VARIÁVEIS DE ALTA PERFORMANCE (rAF COALESCENCE)
      let rafId: number | null = null;
      let latestX = e.clientX;
      let latestY = e.clientY;
      let currentTargetCol: HTMLElement | null = null;

      // GEOMETRIA ESTÁTICA EM CACHE (Lida 1 única vez no início do arraste, eliminando Layout Thrashing)
      let containerLeft = 0;
      let containerRight = 0;
      let maxScrollLeft = 0;
      let cachedColumns: Array<{
        stageId: string;
        offsetLeft: number;
        width: number;
        el: HTMLElement;
      }> = [];

      const initGeometryCache = () => {
        if (!container) return;
        const cRect = container.getBoundingClientRect();
        containerLeft = cRect.left;
        containerRight = cRect.right;
        maxScrollLeft = container.scrollWidth - container.clientWidth;

        cachedColumns = [];
        const cols = container.querySelectorAll<HTMLElement>("[data-stage-column]");
        cols.forEach((col) => {
          const stageId = col.getAttribute("data-stage-column");
          if (stageId) {
            cachedColumns.push({
              stageId,
              offsetLeft: col.offsetLeft,
              width: col.offsetWidth,
              el: col,
            });
          }
        });
      };

      // LOOP rAF QUE EXECUTA EM 60/120Hz NO VSYNC DO MONITOR (SEM BLOQUEIO DA THREAD PRINCIPAL)
      const tick = () => {
        rafId = null;
        if (!candidate.isDragging) return;

        // 1. Atualização do Overlay diretamente via Transform da GPU (0ms, 0 re-renders)
        const curX = latestX - candidate.grabOffsetX;
        const curY = latestY - candidate.grabOffsetY;
        if (overlayRef.current) {
          overlayRef.current.style.transform = `translate3d(${curX}px, ${curY}px, 0) rotate(1.8deg) scale(1.02)`;
        }

        // 2. Auto-scroll suave horizontal nas bordas do Kanban
        const edgeMargin = 110;
        const leftDist = latestX - containerLeft;
        const rightDist = containerRight - latestX;
        let edgeSpeed = 0;

        if (leftDist < edgeMargin && container.scrollLeft > 0) {
          const factor = Math.min(1, Math.max(0.1, (edgeMargin - leftDist) / edgeMargin));
          edgeSpeed = -Math.round(factor * 22);
        } else if (
          rightDist < edgeMargin &&
          container.scrollLeft < maxScrollLeft - 1
        ) {
          const factor = Math.min(1, Math.max(0.1, (edgeMargin - rightDist) / edgeMargin));
          edgeSpeed = Math.round(factor * 22);
        }

        if (edgeSpeed !== 0) {
          container.scrollLeft += edgeSpeed;
        }

        // 3. Detecção aritmética pura de coluna alvo (4 operações matemáticas, zero getBoundingClientRect)
        const currentScroll = container.scrollLeft;
        let hoveredCol: { stageId: string; el: HTMLElement } | null = null;

        for (let i = 0; i < cachedColumns.length; i++) {
          const col = cachedColumns[i];
          const colScreenLeft = containerLeft + col.offsetLeft - currentScroll;
          const colScreenRight = colScreenLeft + col.width;
          if (latestX >= colScreenLeft && latestX <= colScreenRight) {
            hoveredCol = col;
            break;
          }
        }

        // 4. Highlight e Drop Indicator atualizados instantaneamente no DOM (0 re-renders no React!)
        if (hoveredCol) {
          if (hoveredCol.el !== currentTargetCol) {
            if (currentTargetCol) {
              currentTargetCol.removeAttribute("data-is-target");
            }
            if (hoveredCol.stageId !== candidate.originStageId) {
              hoveredCol.el.setAttribute("data-is-target", "true");
              currentTargetCol = hoveredCol.el;
              hoveredStageIdRef.current = hoveredCol.stageId;
            } else {
              currentTargetCol = null;
              hoveredStageIdRef.current = null;
            }
          }
        } else if (currentTargetCol) {
          currentTargetCol.removeAttribute("data-is-target");
          currentTargetCol = null;
          hoveredStageIdRef.current = null;
        }

        // Se estiver em auto-scroll de borda, agenda próximo frame para continuar rolando suavemente
        if (edgeSpeed !== 0 && candidate.isDragging) {
          rafId = requestAnimationFrame(tick);
        }
      };

      const handleCardPointerMove = (ev: PointerEvent) => {
        latestX = ev.clientX;
        latestY = ev.clientY;

        const dx = ev.clientX - candidate.startX;
        const dy = ev.clientY - candidate.startY;

        // Limiar de 5px para diferenciar clique de arrasto
        if (!candidate.isDragging && Math.hypot(dx, dy) >= 5) {
          candidate.isDragging = true;
          document.body.style.userSelect = "none";
          document.body.style.cursor = "grabbing";

          // Marca o card de origem como silhueta fantasma direto no DOM
          candidate.cardEl.setAttribute("data-is-ghost", "true");

          // Inicializa cache geométrico 1 única vez
          initGeometryCache();

          // Monta o Portal flutuante (único re-render do ciclo)
          setActiveDrag({
            deal: candidate.deal,
            originStageId: candidate.originStageId,
            cardWidth: candidate.cardWidth,
            cardHeight: candidate.cardHeight,
            initialX: ev.clientX - candidate.grabOffsetX,
            initialY: ev.clientY - candidate.grabOffsetY,
          });
        }

        if (!candidate.isDragging) return;

        // Coalescência de alta frequência de mouse: 1 único tick por frame vsync
        if (rafId === null) {
          rafId = requestAnimationFrame(tick);
        }
      };

      const handleCardPointerUp = () => {
        window.removeEventListener("pointermove", handleCardPointerMove);
        window.removeEventListener("pointerup", handleCardPointerUp);
        window.removeEventListener("pointercancel", handleCardPointerUp);

        if (rafId !== null) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }

        document.body.style.userSelect = "";
        document.body.style.cursor = "";

        if (candidate.isDragging) {
          // Remove silhueta fantasma do card de origem
          candidate.cardEl.removeAttribute("data-is-ghost");

          // Remove highlight da coluna alvo
          if (currentTargetCol) {
            currentTargetCol.removeAttribute("data-is-target");
            currentTargetCol = null;
          }

          // Suprime clique residual
          const suppressClick = (clickEv: MouseEvent) => {
            clickEv.stopImmediatePropagation();
            clickEv.preventDefault();
            window.removeEventListener("click", suppressClick, true);
          };
          window.addEventListener("click", suppressClick, true);

          const targetStage = hoveredStageIdRef.current;
          hoveredStageIdRef.current = null;

          if (targetStage && targetStage !== candidate.originStageId) {
            handleInterceptMove(candidate.deal.id, targetStage, candidate.deal.version);
          }
          setActiveDrag(null);
        } else {
          // Movimento menor que 5px: clique intencional para abrir modal do deal
          onDealClick(candidate.deal);
        }
      };

      window.addEventListener("pointermove", handleCardPointerMove);
      window.addEventListener("pointerup", handleCardPointerUp);
      window.addEventListener("pointercancel", handleCardPointerUp);
    },
    [onDealClick, handleInterceptMove]
  );

  // ── MOTOR DE PAN SCROLL HORIZONTAL (CLICAR E ARRASTAR O FUNDO OU TOPO DA TELA) ──
  const handleBoardPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return; // apenas clique esquerdo
    const target = e.target as HTMLElement;

    // Ignora se clicou em um card ou elemento interativo
    if (
      target.closest(
        '[data-deal-card], button, a, input, select, textarea, [role="button"], [data-no-pan]'
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
        // Suprime clique se foi arrasto de tela
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

  // Scroll horizontal suave com rodinha do mouse sobre cabeçalhos ou fundo
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

  // Mapa estável de callbacks de carregar mais por etapa (evita novas funções inline a cada render)
  const onLoadMoreMap = useMemo(() => {
    const map: Record<string, () => void> = {};
    if (!onLoadMoreStage) return map;
    for (const stage of sortedStages) {
      map[stage.id] = () => onLoadMoreStage(stage.id);
    }
    return map;
  }, [sortedStages, onLoadMoreStage]);

  return (
    <>
      <div
        ref={boardContainerRef}
        data-board-container="true"
        onPointerDown={handleBoardPointerDown}
        onWheel={handleBoardWheel}
        className={`flex h-full w-full gap-4 overflow-x-auto overflow-y-hidden pb-3 pt-1 pl-1 pr-5 select-none transition-colors ${
          isPanning ? "cursor-grabbing" : "cursor-grab"
        } [&::-webkit-scrollbar]:h-2.5 [&::-webkit-scrollbar-track]:bg-muted/40 [&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/35 [&::-webkit-scrollbar-thumb:hover]:bg-primary [&::-webkit-scrollbar-thumb]:rounded-full`}
      >
        {sortedStages.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-2xl border border-dashed border-border/80 p-8 text-center">
            <div>
              <h4 className="text-sm font-bold text-foreground">Nenhuma etapa cadastrada</h4>
              <p className="mt-1 text-xs text-muted-foreground">
                Este funil não possui etapas configuradas para exibir o quadro Kanban.
              </p>
            </div>
          </div>
        ) : (
          sortedStages.map((stage) => (
            <PipelineColumn
              key={stage.id}
              stage={stage}
              deals={dealsByStage.get(stage.id) || []}
              summary={stagesSummaryMap?.get(stage.id)}
              coolingDays={stageSettings?.[stage.id]?.coolingDays ?? pipeline.coolingDays ?? 10}
              coolingEnabled={stageSettings?.[stage.id]?.coolingEnabled ?? true}
              operatorsMap={operatorsMap}
              allStages={allStages}
              onDealClick={onDealClick}
              onDropDeal={handleInterceptMove}
              onNewDealAtStage={onNewDealAtStage}
              onCreateTaskClick={onCreateTaskClick}
              onLoadMore={onLoadMoreMap[stage.id]}
              loadingMore={!!loadingMoreStages?.[stage.id]}
              draggedDealId={activeDrag?.deal.id}
              onStartCardDrag={handleStartCardDrag}
            />
          ))
        )}
      </div>

      {/* ── DRAG OVERLAY FLUTUANTE EM ALTA DEFINIÇÃO E 120 FPS NATIVO (ZERO RE-RENDERS) ── */}
      {activeDrag &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={overlayRef}
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              width: `${activeDrag.cardWidth}px`,
              height: `${activeDrag.cardHeight}px`,
              transform: `translate3d(${activeDrag.initialX}px, ${activeDrag.initialY}px, 0) rotate(1.8deg) scale(1.02)`,
              zIndex: 999999,
              pointerEvents: "none",
              willChange: "transform",
            }}
            className="select-none shadow-2xl shadow-black/90 ring-2 ring-primary border border-primary/90 rounded-xl bg-card overflow-hidden"
          >
            <DealCard
              deal={activeDrag.deal}
              coolingDays={
                stageSettings?.[activeDrag.deal.stageId]?.coolingDays ??
                pipeline.coolingDays ??
                10
              }
              coolingEnabled={stageSettings?.[activeDrag.deal.stageId]?.coolingEnabled ?? true}
              operatorName={
                activeDrag.deal.operatorId || activeDrag.deal.ownerId
                  ? operatorsMap.get((activeDrag.deal.operatorId || activeDrag.deal.ownerId)!)
                  : undefined
              }
              allStages={allStages}
              isOverlay={true}
            />
          </div>,
          document.body
        )}

      {/* Confirmação explícita de Ganho / Perda em Etapas Terminais */}
      {terminalConfirm && (
        <StageTerminalConfirmDialog
          isOpen={true}
          type={terminalConfirm.type}
          stageName={terminalConfirm.targetStageName}
          dealTitle={terminalConfirm.dealTitle}
          currentValue={terminalConfirm.currentValue}
          onConfirm={(data) => {
            onMoveDeal(
              terminalConfirm.dealId,
              terminalConfirm.targetStageId,
              terminalConfirm.version,
              data
            );
            setTerminalConfirm(null);
          }}
          onCancel={() => setTerminalConfirm(null)}
        />
      )}
    </>
  );
}
