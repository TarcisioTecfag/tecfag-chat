import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Filter, RotateCcw, Check } from "lucide-react";

export interface AdvancedFiltersState {
  stageIds?: string[];
  minValue?: number;
  maxValue?: number;
  createdAfter?: string;
  createdBefore?: string;
  hasOverdueTask?: boolean;
  coolingOnly?: boolean;
  coolingDays?: number;
}

export function countActiveAdvancedFilters(filters: AdvancedFiltersState): number {
  let count = 0;
  if (filters.stageIds && filters.stageIds.length > 0) count++;
  if (filters.minValue !== undefined && filters.minValue !== null) count++;
  if (filters.maxValue !== undefined && filters.maxValue !== null) count++;
  if (filters.createdAfter) count++;
  if (filters.createdBefore) count++;
  if (filters.hasOverdueTask) count++;
  if (filters.coolingOnly) count++;
  return count;
}

interface AdvancedFiltersModalProps {
  isOpen: boolean;
  onClose: () => void;
  stages: Array<{ id: string; name: string }>;
  filters: AdvancedFiltersState;
  onApply: (filters: AdvancedFiltersState) => void;
}

export function AdvancedFiltersModal({
  isOpen,
  onClose,
  stages,
  filters,
  onApply,
}: AdvancedFiltersModalProps) {
  const [stageIds, setStageIds] = useState<string[]>(filters.stageIds || []);
  const [minValue, setMinValue] = useState<string>(
    filters.minValue !== undefined ? String(filters.minValue) : ""
  );
  const [maxValue, setMaxValue] = useState<string>(
    filters.maxValue !== undefined ? String(filters.maxValue) : ""
  );
  const [createdAfter, setCreatedAfter] = useState<string>(filters.createdAfter || "");
  const [createdBefore, setCreatedBefore] = useState<string>(filters.createdBefore || "");
  const [hasOverdueTask, setHasOverdueTask] = useState<boolean>(filters.hasOverdueTask || false);
  const [coolingOnly, setCoolingOnly] = useState<boolean>(filters.coolingOnly || false);
  const [coolingDays, setCoolingDays] = useState<string>(
    filters.coolingDays !== undefined ? String(filters.coolingDays) : "10"
  );

  // Sincroniza estado quando o modal abre
  useEffect(() => {
    if (isOpen) {
      setStageIds(filters.stageIds || []);
      setMinValue(filters.minValue !== undefined ? String(filters.minValue) : "");
      setMaxValue(filters.maxValue !== undefined ? String(filters.maxValue) : "");
      setCreatedAfter(filters.createdAfter || "");
      setCreatedBefore(filters.createdBefore || "");
      setHasOverdueTask(filters.hasOverdueTask || false);
      setCoolingOnly(filters.coolingOnly || false);
      setCoolingDays(filters.coolingDays !== undefined ? String(filters.coolingDays) : "10");
    }
  }, [isOpen, filters]);

  const handleToggleStage = (stageId: string) => {
    setStageIds((prev) =>
      prev.includes(stageId) ? prev.filter((id) => id !== stageId) : [...prev, stageId]
    );
  };

  const handleClearAll = () => {
    setStageIds([]);
    setMinValue("");
    setMaxValue("");
    setCreatedAfter("");
    setCreatedBefore("");
    setHasOverdueTask(false);
    setCoolingOnly(false);
    setCoolingDays("10");
  };

  const handleSave = () => {
    const minValNum = minValue.trim() ? parseFloat(minValue) : undefined;
    const maxValNum = maxValue.trim() ? parseFloat(maxValue) : undefined;
    const coolingDaysNum = coolingDays.trim() ? parseInt(coolingDays, 10) : 10;

    onApply({
      stageIds: stageIds.length > 0 ? stageIds : undefined,
      minValue: !isNaN(minValNum as number) ? minValNum : undefined,
      maxValue: !isNaN(maxValNum as number) ? maxValNum : undefined,
      createdAfter: createdAfter || undefined,
      createdBefore: createdBefore || undefined,
      hasOverdueTask: hasOverdueTask || undefined,
      coolingOnly: coolingOnly || undefined,
      coolingDays: coolingOnly ? (!isNaN(coolingDaysNum) ? coolingDaysNum : 10) : undefined,
    });
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-bold">
            <Filter className="h-4 w-4 text-primary" />
            <span>Filtros Avançados de Negociações</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2 text-xs">
          {/* 1. Etapas do Funil */}
          {stages.length > 0 && (
            <div className="space-y-2">
              <Label className="text-xs font-semibold text-foreground">
                Filtrar por Etapa(s) do Funil
              </Label>
              <div className="grid grid-cols-2 gap-2 max-h-36 overflow-y-auto rounded-xl border border-border p-2 bg-muted/20">
                {stages.map((stg) => {
                  const isChecked = stageIds.includes(stg.id);
                  return (
                    <label
                      key={stg.id}
                      className="flex items-center gap-2 p-1 rounded-lg hover:bg-muted/40 cursor-pointer text-xs"
                    >
                      <Checkbox
                        checked={isChecked}
                        onCheckedChange={() => handleToggleStage(stg.id)}
                      />
                      <span className="truncate">{stg.name}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {/* 2. Faixa de Valor */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold text-foreground">
              Faixa de Valor da Negociação (R$)
            </Label>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-[11px] text-muted-foreground">Valor Mínimo</Label>
                <Input
                  type="number"
                  placeholder="Ex: 1000"
                  value={minValue}
                  onChange={(e) => setMinValue(e.target.value)}
                  className="h-8 text-xs"
                  step="any"
                />
              </div>
              <div>
                <Label className="text-[11px] text-muted-foreground">Valor Máximo</Label>
                <Input
                  type="number"
                  placeholder="Ex: 50000"
                  value={maxValue}
                  onChange={(e) => setMaxValue(e.target.value)}
                  className="h-8 text-xs"
                  step="any"
                />
              </div>
            </div>
          </div>

          {/* 3. Data de Criação */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold text-foreground">
              Período de Criação
            </Label>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-[11px] text-muted-foreground">Criado a partir de</Label>
                <Input
                  type="date"
                  value={createdAfter}
                  onChange={(e) => setCreatedAfter(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
              <div>
                <Label className="text-[11px] text-muted-foreground">Criado até</Label>
                <Input
                  type="date"
                  value={createdBefore}
                  onChange={(e) => setCreatedBefore(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
            </div>
          </div>

          {/* 4. Tarefa Vencida */}
          <div className="flex items-center justify-between rounded-xl border border-border p-3 bg-muted/20">
            <div className="space-y-0.5">
              <Label className="text-xs font-semibold text-foreground cursor-pointer">
                Apenas com Tarefas Vencidas
              </Label>
              <p className="text-[11px] text-muted-foreground">
                Exibe negócios que possuem atividades pendentes com prazo expirado
              </p>
            </div>
            <Switch
              checked={hasOverdueTask}
              onCheckedChange={setHasOverdueTask}
            />
          </div>

          {/* 5. Negociações Paradas / Esfriamento */}
          <div className="rounded-xl border border-border p-3 bg-muted/20 space-y-2">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-xs font-semibold text-foreground cursor-pointer">
                  Apenas Negociações Paradas (Esfriando)
                </Label>
                <p className="text-[11px] text-muted-foreground">
                  Sem nenhuma atividade ou atualização há vários dias
                </p>
              </div>
              <Switch
                checked={coolingOnly}
                onCheckedChange={setCoolingOnly}
              />
            </div>

            {coolingOnly && (
              <div className="flex items-center gap-2 pt-2 border-t border-border">
                <Label className="text-[11px] text-muted-foreground whitespace-nowrap">
                  Dias sem atividade:
                </Label>
                <Input
                  type="number"
                  min="1"
                  max="365"
                  value={coolingDays}
                  onChange={(e) => setCoolingDays(e.target.value)}
                  className="h-7 w-20 text-xs"
                />
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="flex items-center justify-between gap-2 pt-3 border-t border-border">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleClearAll}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="h-3.5 w-3.5 mr-1" />
            Limpar filtros
          </Button>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClose}
              className="text-xs"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSave}
              className="text-xs font-bold"
            >
              <Check className="h-3.5 w-3.5 mr-1" />
              Aplicar Filtros
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
