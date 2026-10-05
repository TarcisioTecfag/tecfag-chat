import React, { useState, useRef, useEffect } from "react";
import { DealCard, DealCardData } from "./DealCard";
import { Plus, ChevronDown, Loader2 } from "lucide-react";
import { SystemTooltip } from "@/components/ui/tooltip";

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
}

export function PipelineColumn({
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
}: PipelineColumnProps) {
  const [isOver, setIsOver] = useState(false);
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

  const localFormattedTotal = hasKnownValue
    ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(totalKnownValue)
    : "-";

  const displayCount = summary ? summary.dealsCount : deals.length;
  const displayFormattedTotal = summary ? summary.formattedTotalValue : localFormattedTotal;

  // Drag over / drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (!isOver) setIsOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsOver(false);
    try {
      const dataStr = e.dataTransfer.getData("text/plain");
      if (!dataStr) return;
      const data = JSON.parse(dataStr);
      if (data.dealId && data.fromStageId !== stage.id) {
        onDropDeal(data.dealId, stage.id, data.version);
      }
    } catch (err) {
      console.error("[PipelineColumn] Falha ao processar drop:", err);
    }
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`flex flex-col h-full min-w-[330px] max-w-[360px] flex-1 rounded-t-2xl rounded-b-none border border-b-0 transition-all duration-200 ${
        isOver
          ? "border-primary/80 ring-2 ring-primary/30 bg-primary/[0.06] scale-[1.008]"
          : "border-border/80 bg-muted/65 dark:bg-muted/25 shadow-xs"
      }`}
    >
      {/* Cabeçalho da Coluna com sólido aprimorado */}
      <div className="shrink-0 px-3.5 py-3 border-b border-border/70 bg-muted/85 dark:bg-muted/45 rounded-t-2xl">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <SystemTooltip content={stage.name}>
              <h3 className="text-sm font-bold text-foreground line-clamp-2 break-words cursor-default">
                {stage.name}
              </h3>
            </SystemTooltip>
            <SystemTooltip content={`${displayCount} negociações no total nesta etapa`}>
              <span className="flex h-6 shrink-0 items-center justify-center rounded-md bg-background/90 border border-border/70 px-2 text-xs font-semibold tabular-nums text-foreground/80 cursor-default">
                {displayCount}
              </span>
            </SystemTooltip>
          </div>

          {onNewDealAtStage && (
            <SystemTooltip content={`Nova negociação em ${stage.name}`}>
              <button
                onClick={() => onNewDealAtStage(stage.id)}
                type="button"
                aria-label={`Nova negociação em ${stage.name}`}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-all duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </SystemTooltip>
          )}
        </div>

        {/* Totalizador Financeiro da Etapa */}
        <div className="mt-1.5 flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>Total conhecido:</span>
          <span className="font-medium tabular-nums text-foreground/80">{displayFormattedTotal}</span>
        </div>
      </div>

      {/* Lista de Cards da Etapa com scroll vertical */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="min-h-0 flex-1 overflow-y-auto p-2.5 pb-6 space-y-2.5 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-thumb]:rounded-full"
      >
        {deals.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center px-4 space-y-2.5">
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
                operatorName={(deal.operatorId || deal.ownerId) ? operatorsMap.get((deal.operatorId || deal.ownerId)!) : undefined}
                onClick={onDealClick}
                onQuickMove={onDropDeal}
                allStages={allStages}
                onCreateTaskClick={onCreateTaskClick}
              />
            ))}

            {summary && summary.dealsCount > deals.length && (
              <div
                ref={sentinelRef}
                className="pt-2 pb-1 text-center space-y-1.5 border-t border-dashed border-border/50"
              >
                {loadingMore ? (
                  <div className="flex items-center justify-center gap-2 text-xs font-medium text-primary py-1.5 animate-in fade-in duration-200">
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
  );
}
