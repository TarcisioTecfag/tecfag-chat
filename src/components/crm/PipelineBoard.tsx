import React, { useState } from "react";
import { PipelineColumn, PipelineStageData, PipelineStageSummary } from "./PipelineColumn";
import { DealCardData } from "./DealCard";
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
      // Caso a negociação esteja em uma etapa desconhecida, anexa na primeira
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

  return (
    <>
      {/* Wrapper relativo para posicionar o overlay glassmorphism */}
      <div className="relative h-full w-full overflow-hidden">
        {/* Overlay glassmorphism sobre a barra de scroll horizontal */}
        <div
          className="pointer-events-none absolute bottom-0 left-0 right-0 z-10 h-6"
          style={{
            background:
              "linear-gradient(to top, rgba(var(--color-background, 15 23 42) / 0.55) 0%, transparent 100%)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            borderTop: "1px solid rgba(255,255,255,0.07)",
            boxShadow: "0 -2px 12px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.06)",
          }}
        />

      <div className="flex h-full w-full gap-4 overflow-x-auto pb-4 pt-1 pl-1 pr-5 [&::-webkit-scrollbar]:h-2.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/20 [&::-webkit-scrollbar-thumb]:backdrop-blur-sm [&::-webkit-scrollbar-thumb:hover]:bg-white/35 [&::-webkit-scrollbar-track]:bg-white/5 [&::-webkit-scrollbar-track]:rounded-full">
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
            />
          ))
        )}
      </div>
      </div>

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
