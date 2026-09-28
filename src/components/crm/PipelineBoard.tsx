import React from "react";
import { PipelineColumn, PipelineStageData } from "./PipelineColumn";
import { DealCardData } from "./DealCard";

interface PipelineBoardProps {
  pipeline: {
    id: string;
    name: string;
    coolingDays?: number;
    stages: PipelineStageData[];
  };
  deals: DealCardData[];
  operatorsMap: Map<string, string>;
  onDealClick: (deal: DealCardData) => void;
  onMoveDeal: (dealId: string, newStageId: string, currentVersion: number) => void;
  onNewDealAtStage?: (stageId: string) => void;
}

export function PipelineBoard({
  pipeline,
  deals,
  operatorsMap,
  onDealClick,
  onMoveDeal,
  onNewDealAtStage,
}: PipelineBoardProps) {
  // Ordena etapas
  const sortedStages = [...(pipeline.stages || [])].sort((a, b) => a.orderIndex - b.orderIndex);

  // Mapeamento simplificado para select de troca de etapas
  const allStages = sortedStages.map((s) => ({ id: s.id, name: s.name }));

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
      // Caso a negociação esteja em uma etapa desconhecida, anexa na primeira
      const firstStage = sortedStages[0];
      if (firstStage) {
        dealsByStage.get(firstStage.id)?.push(deal);
      }
    }
  }

  return (
    <div className="flex h-full w-full gap-4 overflow-x-auto pb-4 pt-1 px-1 [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-thumb]:rounded-full">
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
            coolingDays={pipeline.coolingDays ?? 10}
            operatorsMap={operatorsMap}
            allStages={allStages}
            onDealClick={onDealClick}
            onDropDeal={onMoveDeal}
            onNewDealAtStage={onNewDealAtStage}
          />
        ))
      )}
    </div>
  );
}
