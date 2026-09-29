import React, { useState } from "react";
import { DealCard, DealCardData } from "./DealCard";
import { Plus, MoreHorizontal } from "lucide-react";

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
      className={`flex flex-col h-full min-w-[280px] max-w-[320px] flex-1 rounded-2xl border transition-colors ${
        isOver
          ? "border-primary bg-primary/5"
          : "border-border/60 bg-muted/20"
      }`}
    >
      {/* Cabeçalho da Coluna */}
      <div className="p-3.5 border-b border-border/50">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <h3 className="text-xs font-bold text-foreground truncate">
              {stage.name}
            </h3>
            <span
              title={`${displayCount} negociações no total nesta etapa`}
              className="flex h-5 items-center justify-center rounded-full bg-muted px-2 text-[10px] font-extrabold text-muted-foreground"
            >
              {displayCount}
            </span>
          </div>

          {onNewDealAtStage && (
            <button
              onClick={() => onNewDealAtStage(stage.id)}
              title="Nova negociação nesta etapa"
              className="flex h-6 w-6 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Totalizador Financeiro da Etapa */}
        <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>Total conhecido:</span>
          <span className="font-bold text-foreground/80">{displayFormattedTotal}</span>
        </div>
      </div>

      {/* Lista de Cards da Etapa com scroll vertical */}
      <div className="flex-1 overflow-y-auto p-2.5 space-y-2.5 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-thumb]:rounded-full">
        {deals.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center px-4">
            <p className="text-[11px] text-muted-foreground/60 italic">
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
                operatorName={(deal.operatorId || deal.ownerId) ? operatorsMap.get((deal.operatorId || deal.ownerId)!) : undefined}
                onClick={onDealClick}
                onQuickMove={onDropDeal}
                allStages={allStages}
              />
            ))}

            {summary && summary.dealsCount > deals.length && (
              <div className="py-2 text-center text-[10px] text-muted-foreground/70 border-t border-dashed border-border/60">
                Mostrando {deals.length} de {summary.dealsCount} negociações
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
