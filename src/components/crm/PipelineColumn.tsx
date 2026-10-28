import React, { useRef, useEffect } from "react";
import { DealCard, DealCardData, CardTooltip } from "./DealCard";
import { Plus, ChevronDown, Loader2, ArrowDown } from "lucide-react";

const COLUMN_BRL_FORMATTER = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const COLUMN_CONTAIN_STYLE: React.CSSProperties = {
  contain: "layout paint style",
};

export interface PipelineStageData {
  id: string;
  name: string;
  orderIndex: number;
  isWinStage?: boolean;
  isLossStage?: boolean;
}

export interface PipelineStageSummary {
  stageId: string;
  dealsCount: number;
  knownValueDealsCount: number;
  totalValue: number;
  formattedTotalValue: string;
}

interface PipelineColumnProps {
  stage: PipelineStageData;
  deals: DealCardData[];
  summary?: PipelineStageSummary;
  coolingDays?: number;
  coolingEnabled?: boolean;
  operatorsMap: Map<string, string>;
  allStages: Array<{ id: string; name: string }>;
  onDealClick: (deal: DealCardData) => void;
  onDropDeal: (dealId: string, newStageId: string, version: number) => void;
  onNewDealAtStage?: (stageId: string) => void;
  onCreateTaskClick?: (deal: DealCardData) => void;
  onLoadMore?: () => void;
  loadingMore?: boolean;
  onStartCardDrag?: (e: React.PointerEvent<HTMLDivElement>, deal: DealCardData) => void;
}

export const PipelineColumn = React.memo(function PipelineColumn({
  stage,
  deals,
  summary,
  coolingDays = 10,
  coolingEnabled = true,
  operatorsMap,
  allStages,
  onDealClick,
  onDropDeal,
  onNewDealAtStage,
  onCreateTaskClick,
  onLoadMore,
  loadingMore = false,
  onStartCardDrag,
}: PipelineColumnProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Auto-scroll via IntersectionObserver: detecta aproximação do final da coluna
  useEffect(() => {
    if (!sentinelRef.current || !onLoadMore) return;
    if (!summary || summary.dealsCount <= deals.length) return;
    if (loadingMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry.isIntersecting && !loadingMore && onLoadMore) {
          onLoadMore();
        }
      },
      {
        root: scrollContainerRef.current,
        rootMargin: "250px",
        threshold: 0,
      },
    );

    const target = sentinelRef.current;
    observer.observe(target);

    return () => {
      observer.unobserve(target);
      observer.disconnect();
    };
  }, [onLoadMore, loadingMore, summary?.dealsCount, deals.length]);

  // Backup com handler de rolagem contínua
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    if (scrollHeight - scrollTop - clientHeight < 250) {
      if (onLoadMore && !loadingMore && summary && summary.dealsCount > deals.length) {
        onLoadMore();
      }
    }
  };

  // Soma de valores: prioriza agregação do servidor se disponível
  let displayFormattedTotal = "-";
  if (summary) {
    displayFormattedTotal = summary.formattedTotalValue;
  } else {
    let totalKnownValue = 0;
    let hasKnownValue = false;
    for (const d of deals) {
      if (d.value !== null && d.value !== undefined) {
        const num = Number(d.value);
        if (!isNaN(num) && num > 0) {
          totalKnownValue += num;
          hasKnownValue = true;
        }
      }
    }
    if (hasKnownValue) {
      displayFormattedTotal = COLUMN_BRL_FORMATTER.format(totalKnownValue);
    }
  }

  const displayCount = summary ? summary.dealsCount : deals.length;

  return (
    <div
      data-tour="crm.stage-summary" data-stage-column={stage.id}
      style={COLUMN_CONTAIN_STYLE}
      className="group/column flex flex-col h-full min-w-[85vw] sm:min-w-[310px] md:min-w-[330px] max-w-[92vw] sm:max-w-[360px] flex-1 rounded-t-2xl rounded-b-none border border-b-0 transition-colors duration-100 border-border/80 bg-muted/65 dark:bg-muted/25 shadow-xs data-[is-target=true]:border-primary data-[is-target=true]:ring-2 data-[is-target=true]:ring-primary/45 data-[is-target=true]:bg-primary/[0.04]"
    >
      {/* Cabeçalho da Coluna com sólido aprimorado e cursor-grab para pan scroll do quadro */}
      <div className="shrink-0 px-3.5 py-3 border-b border-border/70 bg-muted/85 dark:bg-muted/45 rounded-t-2xl cursor-grab active:cursor-grabbing select-none">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <CardTooltip content={stage.name}>
              <h3 className="text-sm font-bold text-foreground line-clamp-2 break-words">
                {stage.name}
              </h3>
            </CardTooltip>
            <CardTooltip content={`${displayCount} negociações no total nesta etapa`}>
              <span className="flex h-6 shrink-0 items-center justify-center rounded-md bg-background/90 border border-border/70 px-2 text-xs font-semibold tabular-nums text-foreground/80">
                {displayCount}
              </span>
            </CardTooltip>
          </div>

          {onNewDealAtStage && (
            <CardTooltip content={`Nova negociação em ${stage.name}`}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onNewDealAtStage(stage.id);
                }}
                type="button"
                data-tour="crm.stage-create" aria-label={`Nova negociação em ${stage.name}`}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors duration-100 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </CardTooltip>
          )}
        </div>

        {/* Totalizador Financeiro da Etapa */}
        <div className="mt-1.5 flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>Total conhecido:</span>
          <span className="font-semibold tabular-nums text-primary">{displayFormattedTotal}</span>
        </div>
      </div>

      {/* Container relativo da coluna: permite overlay de drop em 0ms (sem empurrar os cards nem causar reflow) */}
      <div className="relative min-h-0 flex-1 flex flex-col overflow-hidden">
        {/* Indicador visual de soltura via GPU Overlay (Zero Layout Shift / Zero Reflow nos cards da coluna) */}
        <div
          data-drop-zone="true"
          className="opacity-0 group-data-[is-target=true]/column:opacity-100 transition-opacity duration-100 pointer-events-none select-none absolute inset-x-2.5 top-2.5 z-20 h-[108px] rounded-xl border-2 border-dashed border-primary bg-card/95 flex flex-col items-center justify-center gap-1.5 text-primary p-3 shadow-lg"
        >
          <div className="h-8 w-8 rounded-full bg-primary/15 flex items-center justify-center text-primary">
            <ArrowDown className="h-4 w-4" />
          </div>
          <span className="text-xs font-bold tracking-wide text-center line-clamp-1">
            Soltar em {stage.name}
          </span>
        </div>

        {/* Lista de Cards da Etapa com scroll vertical e isolamento do mouse wheel */}
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          data-column-card-list="true"
          className="min-h-0 flex-1 overflow-y-auto p-2.5 pb-6 space-y-2.5 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-thumb]:rounded-full"
        >
          {deals.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center px-4 space-y-2.5 select-none">
              <p className="text-xs text-muted-foreground">
                Nenhuma negociação nesta etapa
              </p>
              {summary && summary.dealsCount > 0 && onLoadMore && (
                <button
                  type="button"
                  onClick={onLoadMore}
                  disabled={loadingMore}
                  className="inline-flex items-center gap-1.5 text-xs text-primary font-semibold hover:underline cursor-pointer disabled:opacity-50"
                >
                  {loadingMore ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>Carregando...</span>
                    </>
                  ) : (
                    <span>Carregar {summary.dealsCount} negociações</span>
                  )}
                </button>
              )}
            </div>
          ) : (
            <>
              {deals.map((deal) => (
                <DealCard
                  key={deal.id}
                  deal={deal}
                  coolingDays={coolingDays}
                  coolingEnabled={coolingEnabled}
                  operatorName={
                    deal.operatorId || deal.ownerId
                      ? operatorsMap.get((deal.operatorId || deal.ownerId)!)
                      : undefined
                  }
                  onClick={onDealClick}
                  onQuickMove={onDropDeal}
                  allStages={allStages}
                  onCreateTaskClick={onCreateTaskClick}
                  onStartDrag={onStartCardDrag}
                />
              ))}

              {summary && summary.dealsCount > deals.length && (
                <div
                  ref={sentinelRef}
                  className="pt-2 pb-1 text-center space-y-1.5 border-t border-dashed border-border/50"
                >
                  {loadingMore ? (
                    <div className="flex items-center justify-center gap-2 text-xs font-medium text-primary py-1.5">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>Carregando mais negociações...</span>
                    </div>
                  ) : (
                    <div className="text-[11px] text-muted-foreground flex flex-col items-center gap-0.5">
                      <span>Mostrando {deals.length} de {summary.dealsCount} negociações</span>
                      <span className="text-[10px] text-muted-foreground/60 flex items-center gap-1">
                        <ChevronDown className="h-3 w-3" />
                        <span>Role para carregar mais</span>
                      </span>
                    </div>
                  )}
                </div>
              )}

              {summary && summary.dealsCount <= deals.length && deals.length > 50 && (
                <div className="pt-2 pb-1 text-center text-[10px] text-muted-foreground/60 border-t border-dashed border-border/40">
                  Todas as {deals.length} negociações carregadas
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
});
