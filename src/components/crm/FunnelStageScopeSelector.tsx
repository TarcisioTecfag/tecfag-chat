import React, { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, Filter, Layers, Globe, Sparkles } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { SystemTooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface FunnelStageOption {
  id: string;
  name: string;
  color?: string | null;
  stages?: Array<{
    id: string;
    name: string;
    color?: string | null;
    orderIndex?: number;
  }>;
}

export type PipelineWithStages = FunnelStageOption;

export interface FunnelStageScopeValue {
  allPipelines: boolean;
  pipelineIds: string[];
  stageIds: string[];
}

interface FunnelStageScopeSelectorProps {
  value: FunnelStageScopeValue;
  onChange: (next: FunnelStageScopeValue) => void;
  pipelines?: FunnelStageOption[];
  disabled?: boolean;
  compact?: boolean;
  triggerClassName?: string;
  placeholder?: string;
  align?: "start" | "center" | "end";
}

let cachedPipelinesPromise: Promise<FunnelStageOption[]> | null = null;

async function fetchPipelinesForScope(): Promise<FunnelStageOption[]> {
  if (!cachedPipelinesPromise) {
    cachedPipelinesPromise = fetch("/api/crm/pipelines?forPermissions=true", {
      credentials: "include",
    })
      .then((res) => (res.ok ? res.json() : { pipelines: [] }))
      .then((data) => (Array.isArray(data?.pipelines) ? data.pipelines : []))
      .catch(() => []);
  }
  return cachedPipelinesPromise;
}

export const FunnelStageScopeSelector: React.FC<FunnelStageScopeSelectorProps> = ({
  value,
  onChange,
  pipelines: externalPipelines,
  disabled = false,
  compact = false,
  placeholder = "Todos os funis (Global)",
  align = "end",
}) => {
  const [open, setOpen] = useState(false);
  const [loadedPipelines, setLoadedPipelines] = useState<FunnelStageOption[]>(
    externalPipelines || [],
  );

  useEffect(() => {
    if (externalPipelines && externalPipelines.length > 0) {
      setLoadedPipelines(externalPipelines);
      return;
    }
    let active = true;
    fetchPipelinesForScope().then((list) => {
      if (active) setLoadedPipelines(list);
    });
    return () => {
      active = false;
    };
  }, [externalPipelines]);

  const normalized = useMemo<FunnelStageScopeValue>(() => {
    const pipelineIds = Array.isArray(value?.pipelineIds) ? value.pipelineIds : [];
    const stageIds = Array.isArray(value?.stageIds) ? value.stageIds : [];
    const allPipelines =
      value?.allPipelines !== undefined
        ? Boolean(value.allPipelines)
        : pipelineIds.length === 0 && stageIds.length === 0;
    return {
      allPipelines: allPipelines && pipelineIds.length === 0 && stageIds.length === 0 ? true : allPipelines,
      pipelineIds,
      stageIds,
    };
  }, [value]);

  const summaryLabel = useMemo(() => {
    if (normalized.allPipelines || (normalized.pipelineIds.length === 0 && normalized.stageIds.length === 0)) {
      return placeholder;
    }
    const stageCount = normalized.stageIds.length;
    const pipeCount = normalized.pipelineIds.length;

    if (stageCount === 1) {
      for (const p of loadedPipelines) {
        const st = p.stages?.find((s) => s.id === normalized.stageIds[0]);
        if (st) return `${p.name} › ${st.name}`;
      }
      return "1 etapa vinculada";
    }
    if (stageCount > 1) {
      return `${stageCount} etapas (${pipeCount || 1} ${pipeCount === 1 ? "funil" : "funis"})`;
    }
    if (pipeCount === 1) {
      const p = loadedPipelines.find((item) => item.id === normalized.pipelineIds[0]);
      return p ? `Funil: ${p.name}` : "1 funil vinculado";
    }
    return `${pipeCount} funis vinculados`;
  }, [normalized, loadedPipelines, placeholder]);

  const handleSetGlobal = () => {
    onChange({
      allPipelines: true,
      pipelineIds: [],
      stageIds: [],
    });
  };

  const handleTogglePipeline = (pipeline: FunnelStageOption) => {
    const pipeSet = new Set(normalized.pipelineIds);
    const stageSet = new Set(normalized.stageIds);
    const pipeStageIds = (pipeline.stages || []).map((s) => s.id);

    if (pipeSet.has(pipeline.id)) {
      pipeSet.delete(pipeline.id);
      for (const sId of pipeStageIds) stageSet.delete(sId);
    } else {
      pipeSet.add(pipeline.id);
    }

    const nextPipes = Array.from(pipeSet);
    const nextStages = Array.from(stageSet);
    onChange({
      allPipelines: nextPipes.length === 0 && nextStages.length === 0,
      pipelineIds: nextPipes,
      stageIds: nextStages,
    });
  };

  const handleToggleStage = (pipeline: FunnelStageOption, stageId: string) => {
    const pipeSet = new Set(normalized.pipelineIds);
    const stageSet = new Set(normalized.stageIds);

    if (stageSet.has(stageId)) {
      stageSet.delete(stageId);
    } else {
      stageSet.add(stageId);
      pipeSet.add(pipeline.id);
    }

    const nextPipes = Array.from(pipeSet);
    const nextStages = Array.from(stageSet);
    onChange({
      allPipelines: nextPipes.length === 0 && nextStages.length === 0,
      pipelineIds: nextPipes,
      stageIds: nextStages,
    });
  };

  const handleSelectAllStagesInPipeline = (pipeline: FunnelStageOption) => {
    const pipeSet = new Set(normalized.pipelineIds);
    const stageSet = new Set(normalized.stageIds);
    pipeSet.add(pipeline.id);
    for (const s of pipeline.stages || []) {
      stageSet.delete(s.id);
    }
    onChange({
      allPipelines: false,
      pipelineIds: Array.from(pipeSet),
      stageIds: Array.from(stageSet),
    });
  };

  const isGlobal =
    normalized.allPipelines ||
    (normalized.pipelineIds.length === 0 && normalized.stageIds.length === 0);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <SystemTooltip content="Definir em quais funis e etapas este item fica disponível">
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            className={cn(
              "inline-flex items-center justify-between gap-1.5 rounded-lg border text-left transition-all",
              compact ? "h-7 px-2.5 text-[11px]" : "h-8 px-3 text-xs",
              isGlobal
                ? "border-border/60 bg-background/80 text-muted-foreground hover:border-border hover:text-foreground"
                : "border-primary/40 bg-primary/10 text-primary font-medium hover:bg-primary/15",
              disabled && "opacity-50 cursor-not-allowed",
            )}
          >
            <span className="inline-flex items-center gap-1.5 truncate max-w-[210px]">
              {isGlobal ? (
                <Globe className="h-3.5 w-3.5 shrink-0 opacity-70" />
              ) : (
                <Filter className="h-3.5 w-3.5 shrink-0" />
              )}
              <span className="truncate">{summaryLabel}</span>
            </span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
          </button>
        </PopoverTrigger>
      </SystemTooltip>

      <PopoverContent
        align={align}
        className="w-80 p-0 overflow-hidden border-border bg-popover shadow-xl"
      >
        <div className="border-b border-border/60 bg-muted/30 px-3.5 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <Layers className="h-3.5 w-3.5 text-primary" />
              Vínculo por Funil e Etapa
            </span>
            {!isGlobal && (
              <button
                type="button"
                onClick={handleSetGlobal}
                className="text-[11px] font-medium text-primary hover:underline"
              >
                Tornar Global
              </button>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
            Escolha se este item vale para todos os funis ou apenas para funis/etapas específicos.
          </p>
        </div>

        <div className="max-h-72 overflow-y-auto p-2 space-y-2">
          <button
            type="button"
            onClick={handleSetGlobal}
            className={cn(
              "w-full flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-xs transition-colors border",
              isGlobal
                ? "border-primary/40 bg-primary/10 text-primary font-semibold"
                : "border-transparent hover:bg-muted/60 text-foreground",
            )}
          >
            <span className="flex items-center gap-2">
              <Globe className="h-3.5 w-3.5" />
              <span>Todos os funis e etapas (Global / Fallback)</span>
            </span>
            {isGlobal && <Check className="h-3.5 w-3.5 shrink-0" />}
          </button>

          {loadedPipelines.map((pipeline) => {
            const stages = pipeline.stages || [];
            const selectedStagesInPipe = stages.filter((s) =>
              normalized.stageIds.includes(s.id),
            );
            const isPipeSelected =
              !isGlobal &&
              (normalized.pipelineIds.includes(pipeline.id) ||
                selectedStagesInPipe.length > 0);
            const isEntirePipeMode =
              isPipeSelected && selectedStagesInPipe.length === 0;

            return (
              <div
                key={pipeline.id}
                className={cn(
                  "rounded-lg border transition-colors",
                  isPipeSelected
                    ? "border-primary/30 bg-primary/5"
                    : "border-border/50 bg-background/40",
                )}
              >
                <div className="flex items-center justify-between gap-2 px-2.5 py-2">
                  <label className="flex items-center gap-2 text-xs font-medium text-foreground cursor-pointer flex-1 min-w-0">
                    <Checkbox
                      checked={isPipeSelected}
                      onCheckedChange={() => handleTogglePipeline(pipeline)}
                    />
                    <span
                      className="h-2 w-2 rounded-full shrink-0"
                      style={{ backgroundColor: pipeline.color || "#6366f1" }}
                    />
                    <span className="truncate">{pipeline.name}</span>
                  </label>

                  {isPipeSelected && stages.length > 0 && (
                    <SystemTooltip
                      content={
                        isEntirePipeMode
                          ? "Válido em qualquer etapa deste funil (clique em uma etapa abaixo para restringir)"
                          : "Limpar etapas específicas e liberar para o funil inteiro"
                      }
                    >
                      <button
                        type="button"
                        onClick={() => handleSelectAllStagesInPipeline(pipeline)}
                        className={cn(
                          "text-[10px] px-1.5 py-0.5 rounded font-medium transition-colors",
                          isEntirePipeMode
                            ? "bg-primary/15 text-primary"
                            : "bg-muted text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {isEntirePipeMode
                          ? "Funil inteiro"
                          : `${selectedStagesInPipe.length}/${stages.length} etapas`}
                      </button>
                    </SystemTooltip>
                  )}
                </div>

                {stages.length > 0 && (
                  <div className="border-t border-border/40 px-2.5 py-1.5 bg-background/60 flex flex-wrap gap-1">
                    {stages.map((stage) => {
                      const isStageChecked =
                        !isGlobal && normalized.stageIds.includes(stage.id);
                      return (
                        <button
                          key={stage.id}
                          type="button"
                          onClick={() => handleToggleStage(pipeline, stage.id)}
                          className={cn(
                            "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] border transition-all",
                            isStageChecked
                              ? "border-primary bg-primary text-primary-foreground font-medium shadow-xs"
                              : isEntirePipeMode
                                ? "border-primary/25 bg-primary/5 text-foreground hover:border-primary/50"
                                : "border-border/60 bg-background text-muted-foreground hover:text-foreground hover:border-border",
                          )}
                        >
                          <span
                            className="h-1.5 w-1.5 rounded-full shrink-0"
                            style={{
                              backgroundColor: isStageChecked
                                ? "currentColor"
                                : stage.color || "#94a3b8",
                            }}
                          />
                          <span className="truncate max-w-[130px]">{stage.name}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
};
