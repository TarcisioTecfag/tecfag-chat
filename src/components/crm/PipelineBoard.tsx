import React, { useState, useRef, useEffect, useCallback } from "react";
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

interface DragState {
  deal: DealCardData;
  originStageId: string;
  cardWidth: number;
  cardHeight: number;
  grabOffsetX: number;
  grabOffsetY: number;
  currentX: number;
  currentY: number;
  hoveredStageId: string | null;
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
  // Ordena etapas
  const sortedStages = [...(pipeline.stages || [])].sort((a, b) => a.orderIndex - b.orderIndex);

  // Mapeamento simplificado para select de troca de etapas
  const allStages = sortedStages.map((s) => ({ id: s.id, name: s.name }));

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

  // ── ESTADO 2: DRAG & DROP DE CARDS ULTRA FLUIDO E SEM DELAY ──
  const [dragState, setDragState] = useState<DragState | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  dragStateRef.current = dragState;
  const autoScrollRafRef = useRef<number | null>(null);

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

  // Agrupa deals por stageId
  const dealsByStage = new Map<string, DealCardData[]>();
  for (const s of sortedStages) {
    dealsByStage.set(s.id, []);
  }

  for (const deal of deals) {
    const list = dealsByStage.get(deal.stageId);
    if (list) {
      list.push(deal);
    } else {
      const firstStage = sortedStages[0];
      if (firstStage) {
        dealsByStage.get(firstStage.id)?.push(deal);
      }
    }
  }

  // Intercepta movimentação para verificar etapa terminal
  const handleInterceptMove = (dealId: string, newStageId: string, version: number) => {
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
  };

  // ── MOTOR DE AUTO-SCROLL HORIZONTAL AO ARRASTAR PRÓXIMO DAS BORDAS ──
  const stopEdgeScroll = useCallback(() => {
    if (autoScrollRafRef.current !== null) {
      cancelAnimationFrame(autoScrollRafRef.current);
      autoScrollRafRef.current = null;
    }
  }, []);

  const startEdgeScroll = useCallback(
    (direction: "left" | "right", speed: number) => {
      stopEdgeScroll();
      const step = () => {
        const container = boardContainerRef.current;
        if (!container) return;
        container.scrollLeft += direction === "right" ? speed : -speed;
        autoScrollRafRef.current = requestAnimationFrame(step);
      };
      autoScrollRafRef.current = requestAnimationFrame(step);
    },
    [stopEdgeScroll]
  );

  // Cancelamento via tecla ESC
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dragState) {
        stopEdgeScroll();
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
        setDragState(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [dragState, stopEdgeScroll]);

  // ── INÍCIO DO ARRASTO DE CARD (POINTER DOWN NO DEALCARD) ──
  const handleStartCardDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, deal: DealCardData) => {
      if (e.button !== 0) return; // apenas clique primário
      const cardEl = e.currentTarget;
      const rect = cardEl.getBoundingClientRect();
      const grabOffsetX = e.clientX - rect.left;
      const grabOffsetY = e.clientY - rect.top;

      const candidate = {
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

      const handleCardPointerMove = (ev: PointerEvent) => {
        const dx = ev.clientX - candidate.startX;
        const dy = ev.clientY - candidate.startY;

        // Limiar de 5px para diferenciar clique de arrasto
        if (!candidate.isDragging && Math.hypot(dx, dy) >= 5) {
          candidate.isDragging = true;
          document.body.style.userSelect = "none";
          document.body.style.cursor = "grabbing";
        }

        if (!candidate.isDragging) return;

        // Detecção em tempo real da coluna alvo sob o cursor
        const elements = document.elementsFromPoint(ev.clientX, ev.clientY);
        let foundStageId: string | null = null;
        for (const el of elements) {
          const col = el.closest("[data-stage-column]") as HTMLElement | null;
          if (col) {
            foundStageId = col.getAttribute("data-stage-column");
            break;
          }
        }

        const nextX = ev.clientX - candidate.grabOffsetX;
        const nextY = ev.clientY - candidate.grabOffsetY;

        setDragState({
          deal: candidate.deal,
          originStageId: candidate.originStageId,
          cardWidth: candidate.cardWidth,
          cardHeight: candidate.cardHeight,
          grabOffsetX: candidate.grabOffsetX,
          grabOffsetY: candidate.grabOffsetY,
          currentX: nextX,
          currentY: nextY,
          hoveredStageId: foundStageId,
        });

        // Verificação de proximidade das bordas para auto-scroll suave
        const container = boardContainerRef.current;
        if (container) {
          const cRect = container.getBoundingClientRect();
          const edgeMargin = 110;
          const leftDist = ev.clientX - cRect.left;
          const rightDist = cRect.right - ev.clientX;

          if (leftDist < edgeMargin && container.scrollLeft > 0) {
            const factor = Math.min(1, Math.max(0.1, (edgeMargin - leftDist) / edgeMargin));
            startEdgeScroll("left", Math.round(factor * 22));
          } else if (
            rightDist < edgeMargin &&
            container.scrollLeft < container.scrollWidth - container.clientWidth - 1
          ) {
            const factor = Math.min(1, Math.max(0.1, (edgeMargin - rightDist) / edgeMargin));
            startEdgeScroll("right", Math.round(factor * 22));
          } else {
            stopEdgeScroll();
          }
        }
      };

      const handleCardPointerUp = () => {
        window.removeEventListener("pointermove", handleCardPointerMove);
        window.removeEventListener("pointerup", handleCardPointerUp);
        window.removeEventListener("pointercancel", handleCardPointerUp);

        stopEdgeScroll();
        document.body.style.userSelect = "";
        document.body.style.cursor = "";

        if (candidate.isDragging) {
          // Suprime clique residual
          const suppressClick = (clickEv: MouseEvent) => {
            clickEv.stopImmediatePropagation();
            clickEv.preventDefault();
            window.removeEventListener("click", suppressClick, true);
          };
          window.addEventListener("click", suppressClick, true);

          const currentHoveredStage = dragStateRef.current?.hoveredStageId;
          if (currentHoveredStage && currentHoveredStage !== candidate.originStageId) {
            handleInterceptMove(candidate.deal.id, currentHoveredStage, candidate.deal.version);
          }
          setDragState(null);
        } else {
          // Movimento menor que 5px: clique intencional para abrir modal do deal
          onDealClick(candidate.deal);
        }
      };

      window.addEventListener("pointermove", handleCardPointerMove);
      window.addEventListener("pointerup", handleCardPointerUp);
      window.addEventListener("pointercancel", handleCardPointerUp);
    },
    [onDealClick, startEdgeScroll, stopEdgeScroll]
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

      if (panStateRef.current?.hasMoved) {
        const suppressClick = (ev: MouseEvent) => {
          ev.stopImmediatePropagation();
          ev.preventDefault();
          window.removeEventListener("click", suppressClick, true);
        };
        window.addEventListener("click", suppressClick, true);
      }

      panStateRef.current = null;
      setIsPanning(false);
      document.body.style.userSelect = "";
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
              onLoadMore={onLoadMoreStage ? () => onLoadMoreStage(stage.id) : undefined}
              loadingMore={!!loadingMoreStages?.[stage.id]}
              draggedDealId={dragState?.deal.id}
              targetStageId={dragState?.hoveredStageId}
              onStartCardDrag={handleStartCardDrag}
            />
          ))
        )}
      </div>

      {/* ── DRAG OVERLAY FLUTUANTE EM ALTA DEFINIÇÃO (REACT PORTAL NO BODY) ── */}
      {dragState &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              width: `${dragState.cardWidth}px`,
              height: `${dragState.cardHeight}px`,
              transform: `translate3d(${dragState.currentX}px, ${dragState.currentY}px, 0) rotate(2deg) scale(1.02)`,
              zIndex: 999999,
              pointerEvents: "none",
              willChange: "transform",
            }}
            className="select-none shadow-2xl shadow-black/80 ring-2 ring-primary border border-primary/90 rounded-xl bg-card/95 backdrop-blur-md overflow-hidden"
          >
            <DealCard
              deal={dragState.deal}
              coolingDays={
                stageSettings?.[dragState.deal.stageId]?.coolingDays ??
                pipeline.coolingDays ??
                10
              }
              coolingEnabled={stageSettings?.[dragState.deal.stageId]?.coolingEnabled ?? true}
              operatorName={
                dragState.deal.operatorId || dragState.deal.ownerId
                  ? operatorsMap.get((dragState.deal.operatorId || dragState.deal.ownerId)!)
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
