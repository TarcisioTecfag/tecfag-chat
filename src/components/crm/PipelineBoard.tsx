import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  useImperativeHandle,
  forwardRef,
} from "react";
import { createPortal } from "react-dom";
import { useTrainingSurface } from "@/hooks/useTrainingSurface";
import { PipelineColumn, PipelineStageData, PipelineStageSummary } from "./PipelineColumn";
import { DealCard, DealCardData, hideSharedCardTooltip } from "./DealCard";
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
  coolingDays: number;
  coolingEnabled: boolean;
  operatorName?: string;
  allStages: Array<{ id: string; name: string }>;
}

interface DragOverlayHandle {
  start: (info: ActiveDragInfo) => void;
  stop: () => void;
  getElement: () => HTMLDivElement | null;
}

// Portal isolado para o card flutuante: montar/desmontar este componente NÃO re-renderiza o PipelineBoard nem as colunas!
const DragOverlayPortal = forwardRef<DragOverlayHandle, {}>(function DragOverlayPortal(_, ref) {
  const [activeDrag, setActiveDrag] = useState<ActiveDragInfo | null>(null);
  const overlayElRef = useRef<HTMLDivElement | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      start: (info: ActiveDragInfo) => setActiveDrag(info),
      stop: () => setActiveDrag(null),
      getElement: () => overlayElRef.current,
    }),
    []
  );

  if (!activeDrag || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={overlayElRef}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: `${activeDrag.cardWidth}px`,
        height: `${activeDrag.cardHeight}px`,
        transform: `translate3d(${Math.round(activeDrag.initialX)}px, ${Math.round(activeDrag.initialY)}px, 0)`,
        zIndex: 999999,
        pointerEvents: "none",
        willChange: "transform",
        contain: "layout paint style",
      }}
      className="select-none shadow-xl ring-2 ring-primary border border-primary rounded-xl bg-card overflow-hidden"
    >
      <DealCard
        deal={activeDrag.deal}
        coolingDays={activeDrag.coolingDays}
        coolingEnabled={activeDrag.coolingEnabled}
        operatorName={activeDrag.operatorName}
        allStages={activeDrag.allStages}
        isOverlay={true}
      />
    </div>,
    document.body
  );
});

export const PipelineBoard = React.memo(function PipelineBoard({
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
  const dragOverlayRef = useRef<DragOverlayHandle>(null);
  const hoveredStageIdRef = useRef<string | null>(null);
  const isDraggingRef = useRef(false);

  // Refs para evitar recriação de callbacks quando deals/settings mudam
  const dealsRef = useRef(deals);
  dealsRef.current = deals;
  const sortedStagesRef = useRef(sortedStages);
  sortedStagesRef.current = sortedStages;
  const stageSettingsRef = useRef(stageSettings);
  stageSettingsRef.current = stageSettings;
  const operatorsMapRef = useRef(operatorsMap);
  operatorsMapRef.current = operatorsMap;
  const allStagesRef = useRef(allStages);
  allStagesRef.current = allStages;
  const pipelineCoolingDaysRef = useRef(pipeline.coolingDays);
  pipelineCoolingDaysRef.current = pipeline.coolingDays;

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

  const prepareBoardSurface = (step: { id: string }) => {
    if (step.id === "crm.move-terminal") {
      const deal = dealsRef.current[0];
      const stage = sortedStagesRef.current.at(-1) || sortedStagesRef.current[0];
      if (!deal || !stage) return false;
      setTerminalConfirm({
        dealId: deal.id,
        version: deal.version || 1,
        targetStageId: stage.id,
        targetStageName: stage.name,
        dealTitle: deal.title || "Negociação de demonstração",
        currentValue: deal.value,
        type: "win",
      });
    } else if (terminalConfirm) {
      setTerminalConfirm(null);
    }
    return true;
  };
  useTrainingSurface("crm.terminal-dialog", prepareBoardSurface);
  useTrainingSurface("crm.board", prepareBoardSurface);

  // Agrupa deals por stageId preservando a referência do array de etapas não alteradas (mantém React.memo 100% intacto!)
  const prevDealsByStageRef = useRef<Map<string, DealCardData[]>>(new Map());
  const dealsByStage = useMemo(() => {
    const rawMap = new Map<string, DealCardData[]>();
    for (const s of sortedStages) {
      rawMap.set(s.id, []);
    }

    for (const deal of deals) {
      const list = rawMap.get(deal.stageId);
      if (list) {
        list.push(deal);
      } else {
        const firstStage = sortedStages[0];
        if (firstStage) {
          rawMap.get(firstStage.id)?.push(deal);
        }
      }
    }

    const prevMap = prevDealsByStageRef.current;
    const stableMap = new Map<string, DealCardData[]>();
    for (const [stageId, nextList] of rawMap.entries()) {
      const prevList = prevMap.get(stageId);
      if (
        prevList &&
        prevList.length === nextList.length &&
        prevList.every((item, idx) => item === nextList[idx])
      ) {
        stableMap.set(stageId, prevList);
      } else {
        stableMap.set(stageId, nextList);
      }
    }
    prevDealsByStageRef.current = stableMap;
    return stableMap;
  }, [sortedStages, deals]);

  // Intercepta movimentação para verificar etapa terminal (Estável: não depende de `deals` por valor)
  const handleInterceptMove = useCallback(
    (dealId: string, newStageId: string, version: number) => {
      const targetStage = sortedStagesRef.current.find((s) => s.id === newStageId);
      const deal = dealsRef.current.find((d) => d.id === dealId);

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
    [onMoveDeal]
  );

  // Limpeza global de flags de interação ao desmontar
  useEffect(() => {
    return () => {
      if (typeof document !== "undefined") {
        delete document.body.dataset.crmInteracting;
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
      }
    };
  }, []);

  const [mobileStageFilter, setMobileStageFilter] = useState<string>("all");

  // ── INÍCIO DO ARRASTO DE CARD 120 FPS NATIVO (ZERO RE-RENDERS DO QUADRO E DAS COLUNAS) ──
  const handleStartCardDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, deal: DealCardData) => {
      if (e.button !== 0) return; // apenas clique primário

      // Em dispositivos touch, preserva o scroll vertical/horizontal nativo sem sequestrar o toque com drag de 5px.
      // A mudança de etapa no touch é feita pelo menu de ações do card ("Mover para etapa") ou na ficha do negócio.
      if (e.pointerType === "touch") {
        const touchStartX = e.clientX;
        const touchStartY = e.clientY;
        let maxTouchMove = 0;

        const onTouchPointerMove = (ev: PointerEvent) => {
          const dist = Math.hypot(ev.clientX - touchStartX, ev.clientY - touchStartY);
          if (dist > maxTouchMove) maxTouchMove = dist;
        };

        const onTouchPointerEnd = (ev: PointerEvent) => {
          window.removeEventListener("pointermove", onTouchPointerMove);
          window.removeEventListener("pointerup", onTouchPointerEnd);
          window.removeEventListener("pointercancel", onTouchPointerCancel);
          const dist = Math.max(
            maxTouchMove,
            Math.hypot(ev.clientX - touchStartX, ev.clientY - touchStartY)
          );
          if (dist < 10) {
            onDealClick(deal);
          }
        };

        const onTouchPointerCancel = () => {
          window.removeEventListener("pointermove", onTouchPointerMove);
          window.removeEventListener("pointerup", onTouchPointerEnd);
          window.removeEventListener("pointercancel", onTouchPointerCancel);
        };

        window.addEventListener("pointermove", onTouchPointerMove, { passive: true });
        window.addEventListener("pointerup", onTouchPointerEnd);
        window.addEventListener("pointercancel", onTouchPointerCancel);
        return;
      }

      const cardEl = e.currentTarget;
      const container = boardContainerRef.current;
      if (!container) return;

      hideSharedCardTooltip();

      const rect = cardEl.getBoundingClientRect();
      // Compensação automática de CSS zoom (ex: zoom: 0.8 em telas <= 1536px)
      const cssScale = cardEl.offsetWidth > 0 ? rect.width / cardEl.offsetWidth : 1;
      const cardWidth = cardEl.offsetWidth || Math.round(rect.width / (cssScale || 1));
      const cardHeight = cardEl.offsetHeight || Math.round(rect.height / (cssScale || 1));

      const candidate = {
        cardEl,
        deal,
        originStageId: deal.stageId,
        startX: e.clientX,
        startY: e.clientY,
        startRectLeft: rect.left,
        startRectTop: rect.top,
        cardWidth,
        cardHeight,
        cssScale: cssScale || 1,
        isDragging: false,
      };

      // VARIÁVEIS DE ALTA PERFORMANCE (rAF COALESCENCE)
      let rafId: number | null = null;
      let latestX = e.clientX;
      let latestY = e.clientY;
      let currentTargetCol: HTMLElement | null = null;

      // GEOMETRIA ESTÁTICA EM CACHE (Lida 1 única vez no início do arrasto, na mesma escala de clientX)
      let containerLeft = 0;
      let containerRight = 0;
      let initialScrollLeft = 0;
      let maxScrollLeft = 0;
      let cachedColumns: Array<{
        stageId: string;
        initialLeft: number;
        initialRight: number;
        el: HTMLElement;
      }> = [];

      const initGeometryCache = () => {
        const cRect = container.getBoundingClientRect();
        containerLeft = cRect.left;
        containerRight = cRect.right;
        initialScrollLeft = container.scrollLeft;
        maxScrollLeft = container.scrollWidth - container.clientWidth;

        cachedColumns = [];
        const cols = container.querySelectorAll<HTMLElement>("[data-stage-column]");
        cols.forEach((col) => {
          const stageId = col.getAttribute("data-stage-column");
          if (stageId) {
            const colRect = col.getBoundingClientRect();
            cachedColumns.push({
              stageId,
              initialLeft: colRect.left,
              initialRight: colRect.right,
              el: col,
            });
          }
        });
      };

      const cleanupDragVisuals = () => {
        if (rafId !== null) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }
        isDraggingRef.current = false;
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
        delete document.body.dataset.crmInteracting;
        container.removeAttribute("data-interacting");
        candidate.cardEl.removeAttribute("data-is-ghost");

        if (currentTargetCol) {
          currentTargetCol.removeAttribute("data-is-target");
          currentTargetCol = null;
        }
        hoveredStageIdRef.current = null;
        dragOverlayRef.current?.stop();
      };

      // LOOP rAF QUE EXECUTA EM 60/120Hz NO VSYNC DO MONITOR (SEM BLOQUEIO DA THREAD PRINCIPAL)
      const tick = () => {
        rafId = null;
        if (!candidate.isDragging) return;

        // 1. Atualização do Overlay diretamente via Transform da GPU (0ms, 0 re-renders, compensado por cssScale)
        const dx = latestX - candidate.startX;
        const dy = latestY - candidate.startY;
        const curX = (candidate.startRectLeft + dx) / candidate.cssScale;
        const curY = (candidate.startRectTop + dy) / candidate.cssScale;

        const overlayEl = dragOverlayRef.current?.getElement();
        if (overlayEl) {
          overlayEl.style.transform = `translate3d(${Math.round(curX)}px, ${Math.round(curY)}px, 0)`;
        }

        // 2. Auto-scroll suave horizontal nas bordas do Kanban
        const edgeMargin = 110;
        const leftDist = latestX - containerLeft;
        const rightDist = containerRight - latestX;
        let edgeSpeed = 0;

        if (leftDist < edgeMargin && container.scrollLeft > 0) {
          const factor = Math.min(1, Math.max(0.1, (edgeMargin - leftDist) / edgeMargin));
          edgeSpeed = -Math.round(factor * 22);
        } else if (rightDist < edgeMargin && container.scrollLeft < maxScrollLeft - 1) {
          const factor = Math.min(1, Math.max(0.1, (edgeMargin - rightDist) / edgeMargin));
          edgeSpeed = Math.round(factor * 22);
        }

        if (edgeSpeed !== 0) {
          container.scrollLeft += edgeSpeed;
        }

        // 3. Detecção aritmética pura de coluna alvo na mesma escala de clientX (zero getBoundingClientRect)
        const scrollDeltaScreen =
          (container.scrollLeft - initialScrollLeft) * candidate.cssScale;
        let hoveredCol: { stageId: string; el: HTMLElement } | null = null;

        for (let i = 0; i < cachedColumns.length; i++) {
          const col = cachedColumns[i];
          const colScreenLeft = col.initialLeft - scrollDeltaScreen;
          const colScreenRight = col.initialRight - scrollDeltaScreen;
          if (latestX >= colScreenLeft && latestX <= colScreenRight) {
            hoveredCol = col;
            break;
          }
        }

        // 4. Highlight e Drop Indicator atualizados instantaneamente no DOM (0 re-renders e 0 reflow!)
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
          isDraggingRef.current = true;
          hideSharedCardTooltip();

          // Bloqueia hit-testing, :hover e prefetch nos 150+ cards do fundo durante todo o arrasto
          document.body.dataset.crmInteracting = "true";
          document.body.style.userSelect = "none";
          document.body.style.cursor = "grabbing";
          container.setAttribute("data-interacting", "true");

          // Marca o card de origem como silhueta fantasma direto no DOM
          candidate.cardEl.setAttribute("data-is-ghost", "true");

          // Inicializa cache geométrico 1 única vez
          initGeometryCache();

          const stSettings = stageSettingsRef.current?.[candidate.deal.stageId];
          const opId = candidate.deal.operatorId || candidate.deal.ownerId;

          // Monta apenas o Portal isolado (ZERO re-renders do PipelineBoard e das PipelineColumns!)
          dragOverlayRef.current?.start({
            deal: candidate.deal,
            originStageId: candidate.originStageId,
            cardWidth: candidate.cardWidth,
            cardHeight: candidate.cardHeight,
            initialX: (candidate.startRectLeft + dx) / candidate.cssScale,
            initialY: (candidate.startRectTop + dy) / candidate.cssScale,
            coolingDays: stSettings?.coolingDays ?? pipelineCoolingDaysRef.current ?? 10,
            coolingEnabled: stSettings?.coolingEnabled ?? true,
            operatorName: opId ? operatorsMapRef.current.get(opId) : undefined,
            allStages: allStagesRef.current,
          });
        }

        if (!candidate.isDragging) return;

        // Coalescência de alta frequência de mouse: 1 único tick por frame vsync
        if (rafId === null) {
          rafId = requestAnimationFrame(tick);
        }
      };

      const handleKeyDownCancel = (keyEv: KeyboardEvent) => {
        if (keyEv.key === "Escape" && candidate.isDragging) {
          window.removeEventListener("pointermove", handleCardPointerMove);
          window.removeEventListener("pointerup", handleCardPointerUp);
          window.removeEventListener("pointercancel", handleCardPointerUp);
          window.removeEventListener("keydown", handleKeyDownCancel);
          cleanupDragVisuals();
        }
      };

      const handleCardPointerUp = () => {
        window.removeEventListener("pointermove", handleCardPointerMove);
        window.removeEventListener("pointerup", handleCardPointerUp);
        window.removeEventListener("pointercancel", handleCardPointerUp);
        window.removeEventListener("keydown", handleKeyDownCancel);

        if (candidate.isDragging) {
          const targetStage = hoveredStageIdRef.current;
          cleanupDragVisuals();

          // Suprime clique residual
          const suppressClick = (clickEv: MouseEvent) => {
            clickEv.stopImmediatePropagation();
            clickEv.preventDefault();
            window.removeEventListener("click", suppressClick, true);
          };
          window.addEventListener("click", suppressClick, true);

          if (targetStage && targetStage !== candidate.originStageId) {
            handleInterceptMove(candidate.deal.id, targetStage, candidate.deal.version);
          }
        } else {
          // Movimento menor que 5px: clique intencional para abrir modal do deal
          onDealClick(candidate.deal);
        }
      };

      window.addEventListener("pointermove", handleCardPointerMove, { passive: true });
      window.addEventListener("pointerup", handleCardPointerUp);
      window.addEventListener("pointercancel", handleCardPointerUp);
      window.addEventListener("keydown", handleKeyDownCancel);
    },
    [onDealClick, handleInterceptMove]
  );

  // ── MOTOR DE PAN SCROLL HORIZONTAL 120FPS (ZERO RE-RENDERS + RAF COALESCENCE + BLOQUEIO DE HIT-TEST) ──
  const handleBoardPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "touch") return; // Em dispositivos touch, utiliza o scroll horizontal nativo fluido
    const isMiddleClick = e.button === 1;
    if (e.button !== 0 && !isMiddleClick) return;
    const target = e.target as HTMLElement;

    // Com clique esquerdo, ignora se clicou em um card ou elemento interativo (botão do meio permite pan em qualquer lugar)
    if (
      !isMiddleClick &&
      target.closest(
        '[data-deal-card], button, a, input, select, textarea, [role="button"], [data-no-pan]'
      )
    ) {
      return;
    }

    if (isMiddleClick) {
      e.preventDefault();
    }

    const container = boardContainerRef.current;
    if (!container) return;

    hideSharedCardTooltip();

    const cRect = container.getBoundingClientRect();
    const cssScale = container.offsetWidth > 0 ? cRect.width / container.offsetWidth : 1;

    const panState = {
      startX: e.clientX,
      startY: e.clientY,
      initialScrollLeft: container.scrollLeft,
      cssScale: cssScale || 1,
      hasMoved: false,
      latestX: e.clientX,
      rafId: null as number | null,
    };

    const flushPanScroll = () => {
      panState.rafId = null;
      if (!panState.hasMoved || !boardContainerRef.current) return;
      const dx = (panState.latestX - panState.startX) / panState.cssScale;
      boardContainerRef.current.scrollLeft = panState.initialScrollLeft - dx;
    };

    const handlePointerMove = (ev: PointerEvent) => {
      panState.latestX = ev.clientX;
      const dx = ev.clientX - panState.startX;
      const dy = ev.clientY - panState.startY;

      if (!panState.hasMoved && Math.hypot(dx, dy) > 4) {
        panState.hasMoved = true;
        hideSharedCardTooltip();
        document.body.dataset.crmInteracting = "true";
        document.body.style.userSelect = "none";
        document.body.style.cursor = "grabbing";
        container.setAttribute("data-interacting", "true");
        container.setAttribute("data-panning", "true");
      }

      if (panState.hasMoved && panState.rafId === null) {
        panState.rafId = requestAnimationFrame(flushPanScroll);
      }
    };

    const handlePointerUp = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);

      if (panState.rafId !== null) {
        cancelAnimationFrame(panState.rafId);
        panState.rafId = null;
      }

      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      delete document.body.dataset.crmInteracting;
      container.removeAttribute("data-interacting");
      container.removeAttribute("data-panning");

      if (panState.hasMoved) {
        const suppressClick = (clickEv: MouseEvent) => {
          clickEv.stopImmediatePropagation();
          clickEv.preventDefault();
          window.removeEventListener("click", suppressClick, true);
        };
        window.addEventListener("click", suppressClick, true);
      }
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
  }, []);

  // Scroll horizontal suave com rodinha do mouse sobre cabeçalhos ou fundo
  const handleBoardWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const cardList = target.closest("[data-column-card-list]");
    if (cardList && cardList.scrollHeight > cardList.clientHeight && !e.shiftKey) {
      return; // Permite scroll vertical nativo na lista de cards
    }
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && boardContainerRef.current) {
      boardContainerRef.current.scrollLeft += e.deltaY;
    }
  }, []);

  // Mapa estável de callbacks de carregar mais por etapa (evita novas funções inline a cada render)
  const onLoadMoreMap = useMemo(() => {
    const map: Record<string, () => void> = {};
    if (!onLoadMoreStage) return map;
    for (const stage of sortedStages) {
      map[stage.id] = () => onLoadMoreStage(stage.id);
    }
    return map;
  }, [sortedStages, onLoadMoreStage]);

  const visibleStages = useMemo(() => {
    if (mobileStageFilter === "all") return sortedStages;
    const filtered = sortedStages.filter((s) => s.id === mobileStageFilter);
    return filtered.length > 0 ? filtered : sortedStages;
  }, [sortedStages, mobileStageFilter]);

  return (
    <div className="flex flex-col h-full w-full min-h-0 overflow-hidden">
      {sortedStages.length > 1 && (
        <div className="md:hidden flex items-center gap-1.5 px-2 pb-2 overflow-x-auto scrollbar-none shrink-0">
          <button
            type="button"
            onClick={() => setMobileStageFilter("all")}
            className={`px-2.5 py-1 rounded-xl text-[11px] font-bold whitespace-nowrap transition cursor-pointer shrink-0 border ${
              mobileStageFilter === "all"
                ? "bg-primary text-primary-foreground border-primary shadow-xs"
                : "bg-card text-muted-foreground border-border/70 hover:text-foreground"
            }`}
          >
            Todas ({sortedStages.length})
          </button>
          {sortedStages.map((st) => {
            const count = stagesSummaryMap?.get(st.id)?.dealsCount ?? (dealsByStage.get(st.id)?.length || 0);
            const active = mobileStageFilter === st.id;
            return (
              <button
                key={st.id}
                type="button"
                onClick={() => setMobileStageFilter(st.id)}
                className={`px-2.5 py-1 rounded-xl text-[11px] font-bold whitespace-nowrap transition cursor-pointer shrink-0 border ${
                  active
                    ? "bg-primary text-primary-foreground border-primary shadow-xs"
                    : "bg-card text-muted-foreground border-border/70 hover:text-foreground"
                }`}
              >
                {st.name} ({count})
              </button>
            );
          })}
        </div>
      )}

      <div
        ref={boardContainerRef}
        data-board-container="true"
        onPointerDown={handleBoardPointerDown}
        onWheel={handleBoardWheel}
        className="flex flex-1 min-h-0 w-full gap-3 md:gap-4 overflow-x-auto overflow-y-hidden pb-3 pt-1 pl-1 pr-3 md:pr-5 select-none md:cursor-grab data-[panning=true]:cursor-grabbing data-[interacting=true]:[&_[data-deal-card]]:pointer-events-none data-[interacting=true]:[&_[data-column-card-list]]:pointer-events-none [&::-webkit-scrollbar]:h-2.5 [&::-webkit-scrollbar-track]:bg-muted/40 [&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/35 [&::-webkit-scrollbar-thumb:hover]:bg-primary [&::-webkit-scrollbar-thumb]:rounded-full"
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
          visibleStages.map((stage) => (
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
              onStartCardDrag={handleStartCardDrag}
            />
          ))
        )}
      </div>

      {/* ── DRAG OVERLAY FLUTUANTE ISOLADO EM 120 FPS (ZERO RE-RENDERS DO QUADRO) ── */}
      <DragOverlayPortal ref={dragOverlayRef} />

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
    </div>
  );
});
