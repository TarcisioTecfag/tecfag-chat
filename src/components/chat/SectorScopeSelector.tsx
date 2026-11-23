import React, { useMemo, useState } from "react";
import { Building2, Check, ChevronDown, Globe, Users } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { SystemTooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface SectorOption {
  id: string;
  name: string;
  operatorIds?: string[];
}

export interface SectorScopeValue {
  allSectors: boolean;
  sectorIds: string[];
}

interface SectorScopeSelectorProps {
  value: SectorScopeValue;
  onChange: (next: SectorScopeValue) => void;
  sectors: SectorOption[];
  disabled?: boolean;
  compact?: boolean;
  triggerClassName?: string;
  placeholder?: string;
  align?: "start" | "center" | "end";
}

export const SectorScopeSelector: React.FC<SectorScopeSelectorProps> = ({
  value,
  onChange,
  sectors,
  disabled = false,
  compact = false,
  triggerClassName,
  placeholder = "Todos os setores",
  align = "end",
}) => {
  const [open, setOpen] = useState(false);

  const normalized = useMemo<SectorScopeValue>(() => {
    const sectorIds = Array.isArray(value?.sectorIds)
      ? Array.from(new Set(value.sectorIds.filter(Boolean)))
      : [];
    const allSectors =
      value?.allSectors !== undefined ? Boolean(value.allSectors) : sectorIds.length === 0;
    return {
      allSectors: allSectors || sectorIds.length === 0,
      sectorIds: allSectors ? [] : sectorIds,
    };
  }, [value]);

  const isGlobal = normalized.allSectors || normalized.sectorIds.length === 0;

  const summaryLabel = useMemo(() => {
    if (isGlobal) return placeholder;
    if (normalized.sectorIds.length === 1) {
      const sector = sectors.find((s) => s.id === normalized.sectorIds[0]);
      return sector ? `Setor: ${sector.name}` : "1 setor";
    }
    if (normalized.sectorIds.length === 2) {
      const names = normalized.sectorIds
        .map((id) => sectors.find((s) => s.id === id)?.name)
        .filter(Boolean);
      if (names.length === 2) return names.join(", ");
    }
    return `${normalized.sectorIds.length} setores`;
  }, [isGlobal, normalized.sectorIds, sectors, placeholder]);

  const handleSetGlobal = () => {
    onChange({ allSectors: true, sectorIds: [] });
  };

  const handleToggleSector = (sectorId: string) => {
    const nextSet = new Set(normalized.sectorIds);
    if (nextSet.has(sectorId)) {
      nextSet.delete(sectorId);
    } else {
      nextSet.add(sectorId);
    }
    const nextIds = Array.from(nextSet);
    onChange({
      allSectors: nextIds.length === 0,
      sectorIds: nextIds,
    });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <SystemTooltip content="Definir quais setores podem ver e enviar este item no chat (admins veem todos)">
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            className={cn(
              "inline-flex items-center justify-between gap-1.5 rounded-lg border text-left transition-all cursor-pointer",
              compact ? "h-7 px-2.5 text-[11px]" : "h-8 px-3 text-xs",
              isGlobal
                ? "border-border/60 bg-background/80 text-muted-foreground hover:border-border hover:text-foreground"
                : "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 font-medium hover:bg-emerald-500/15",
              disabled && "opacity-50 cursor-not-allowed",
              triggerClassName,
            )}
          >
            <span className="inline-flex items-center gap-1.5 truncate max-w-[200px]">
              {isGlobal ? (
                <Globe className="h-3.5 w-3.5 shrink-0 opacity-70" />
              ) : (
                <Users className="h-3.5 w-3.5 shrink-0" />
              )}
              <span className="truncate">{summaryLabel}</span>
            </span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
          </button>
        </PopoverTrigger>
      </SystemTooltip>

      <PopoverContent
        align={align}
        className="w-72 p-0 overflow-hidden border-border bg-popover shadow-xl"
      >
        <div className="border-b border-border/60 bg-muted/30 px-3.5 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <Building2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              Visibilidade por Setor
            </span>
            {!isGlobal && (
              <button
                type="button"
                onClick={handleSetGlobal}
                className="text-[11px] font-medium text-primary hover:underline cursor-pointer"
              >
                Liberar Todos
              </button>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
            Restrinja quem vê no chat por equipe. Administradores sempre visualizam todos.
          </p>
        </div>

        <div className="max-h-72 overflow-y-auto overscroll-contain p-2 space-y-1">
          <button
            type="button"
            onClick={handleSetGlobal}
            className={cn(
              "w-full flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-xs transition-colors border cursor-pointer",
              isGlobal
                ? "border-primary/40 bg-primary/10 text-primary font-semibold"
                : "border-transparent hover:bg-muted/60 text-foreground",
            )}
          >
            <span className="inline-flex items-center gap-2">
              <Globe className="h-3.5 w-3.5 shrink-0" />
              <span>Todos os setores (Global)</span>
            </span>
            {isGlobal && <Check className="h-3.5 w-3.5 shrink-0" />}
          </button>

          {sectors.length === 0 ? (
            <p className="px-2.5 py-3 text-[11px] text-muted-foreground text-center">
              Nenhum setor cadastrado neste tenant.
            </p>
          ) : (
            <div className="pt-1 space-y-0.5">
              {sectors.map((sector) => {
                const checked = !isGlobal && normalized.sectorIds.includes(sector.id);
                const membersCount = Array.isArray(sector.operatorIds) ? sector.operatorIds.length : 0;
                return (
                  <label
                    key={sector.id}
                    className={cn(
                      "flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-xs transition-colors cursor-pointer select-none",
                      checked
                        ? "bg-emerald-500/10 text-foreground font-semibold"
                        : "hover:bg-muted/60 text-foreground/90",
                    )}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => handleToggleSector(sector.id)}
                      />
                      <span className="truncate">{sector.name}</span>
                    </span>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {membersCount} {membersCount === 1 ? "membro" : "membros"}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};
