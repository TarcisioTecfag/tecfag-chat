import React, { useState } from "react";
import { DealCard, DealCardData } from "./DealCard";
import { Plus } from "lucide-react";
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
}: PipelineColumnProps) {
  const [isOver, setIsOver] = useState(false);

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
      className={`flex flex-col h-full min-w-[280px] max-w-[320px] flex-1 rounded-2xl border transition-all duration-200 ${
        isOver
          ? "border-primary/80 ring-2 ring-primary/30 bg-primary/[0.04] scale-[1.008]"
          : "border-border/60 bg-muted/20"
      }`}
    >
      {/* Cabeçalho da Coluna */}
      <div className="shrink-0 px-3.5 py-3 border-b border-border/50">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <SystemTooltip content={stage.name}>
              <h3 className="text-sm font-semibold text-foreground line-clamp-2 break-words cursor-default">
                {stage.name}
              </h3>
            </SystemTooltip>
            <SystemTooltip content={`${displayCount} negociações no total nesta etapa`}>
              <span className="flex h-6 shrink-0 items-center justify-center rounded-md bg-muted px-2 text-xs font-semibold tabular-nums text-muted-foreground cursor-default">
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
      <div className="min-h-0 flex-1 overflow-y-auto p-2.5 space-y-2.5 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-thumb]:rounded-full">
        {deals.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center px-4">
            <p className="text-xs text-muted-foreground">
              Nenhuma negociação nesta etapa
            </p>
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
              />
            ))}

            {summary && summary.dealsCount > deals.length && (
              <div className="py-2 text-center text-xs text-muted-foreground border-t border-dashed border-border/60">
                Mostrando {deals.length} de {summary.dealsCount} negociações
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
