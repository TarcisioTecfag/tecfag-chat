import React, { useState, useEffect, useMemo } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Users, Search, Check, X, UserCheck, ChevronDown } from "lucide-react";
import { SystemTooltip } from "@/components/ui/tooltip";

interface OperatorOption {
  id: string;
  name: string;
  avatar?: string | null;
}

interface OperatorFilterPopoverProps {
  operators: OperatorOption[];
  currentOperatorId?: string | null;
  selectedOperatorIds: string[];
  onChange: (operatorIds: string[]) => void;
  disabled?: boolean;
}

export function OperatorFilterPopover({
  operators,
  currentOperatorId,
  selectedOperatorIds,
  onChange,
  disabled = false,
}: OperatorFilterPopoverProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [tempSelected, setTempSelected] = useState<string[]>(selectedOperatorIds);
  const [isMineLocked, setIsMineLocked] = useState<boolean>(() =>
    Boolean(
      currentOperatorId &&
        selectedOperatorIds.length === 1 &&
        selectedOperatorIds[0] === currentOperatorId,
    ),
  );

  // Sincroniza seleção quando o popover abre
  useEffect(() => {
    if (isOpen) {
      setTempSelected(selectedOperatorIds);
      setIsMineLocked(
        Boolean(
          currentOperatorId &&
            selectedOperatorIds.length === 1 &&
            selectedOperatorIds[0] === currentOperatorId,
        ),
      );
      setSearch("");
    }
  }, [isOpen, selectedOperatorIds, currentOperatorId]);

  const filteredOperators = useMemo(() => {
    if (!search.trim()) return operators;
    const term = search.trim().toLowerCase();
    return operators.filter((op) => op.name.toLowerCase().includes(term));
  }, [operators, search]);

  const handleToggle = (opId: string) => {
    if (isMineLocked) return;
    setTempSelected((prev) =>
      prev.includes(opId) ? prev.filter((id) => id !== opId) : [...prev, opId]
    );
  };

  const handleSelectOnlyMine = () => {
    if (!currentOperatorId) return;
    setIsMineLocked(true);
    setSearch("");
    setTempSelected([currentOperatorId]);
  };

  const handleSelectAll = () => {
    setIsMineLocked(false);
    setTempSelected([]);
  };

  const handleClear = () => {
    setIsMineLocked(false);
    setTempSelected([]);
    onChange([]);
    setIsOpen(false);
  };

  const handleApply = () => {
    onChange(tempSelected);
    setIsOpen(false);
  };

  // Rótulo do botão gatilho
  const triggerLabel = useMemo(() => {
    if (selectedOperatorIds.length === 0) {
      return "Todos os responsáveis";
    }
    if (
      selectedOperatorIds.length === 1 &&
      currentOperatorId &&
      selectedOperatorIds[0] === currentOperatorId
    ) {
      return "Minhas Negociações";
    }
    if (selectedOperatorIds.length === 1) {
      const found = operators.find((o) => o.id === selectedOperatorIds[0]);
      return found ? found.name : "1 responsável";
    }
    return `${selectedOperatorIds.length} responsáveis`;
  }, [selectedOperatorIds, currentOperatorId, operators]);

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <SystemTooltip content={`Filtrar por responsável (${triggerLabel})`}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            aria-label={`Responsável: ${triggerLabel}`}
            data-tour="crm.owner"
            className={`flex h-9 w-full min-w-max items-center justify-between gap-2 whitespace-nowrap rounded-lg border px-3.5 text-sm font-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              selectedOperatorIds.length > 0
                ? "border-primary bg-primary/10 text-primary font-bold"
                : "border-border bg-muted/20 text-muted-foreground hover:bg-muted/40 hover:text-foreground"
            }`}
          >
            <Users className="h-4 w-4 shrink-0" />
            <span className="flex-1 whitespace-nowrap text-left">{triggerLabel}</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </button>
        </PopoverTrigger>
      </SystemTooltip>

      <PopoverContent className="w-80 max-w-[calc(100vw-2rem)] p-3" align="start">
        <div className="space-y-3">
          {/* Topo: Atalhos rápidos Minhas / Todas */}
          <div className="flex items-center gap-1 border-b border-border pb-2">
            <SystemTooltip content="Liberar filtro e permitir selecionar qualquer responsável">
              <button
                type="button"
                onClick={handleSelectAll}
                className={`flex-1 rounded-lg px-2 py-1 text-[11px] font-semibold transition cursor-pointer ${
                  !isMineLocked
                    ? "bg-primary text-primary-foreground font-bold"
                    : "bg-muted/40 text-muted-foreground hover:bg-muted"
                }`}
              >
                Todas
              </button>
            </SystemTooltip>
            {currentOperatorId && (
              <SystemTooltip content="Filtrar apenas minhas negociações (bloqueia outros usuários)">
                <button
                  type="button"
                  onClick={handleSelectOnlyMine}
                  className={`flex-1 flex items-center justify-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold transition cursor-pointer ${
                    isMineLocked
                      ? "bg-primary text-primary-foreground font-bold"
                      : "bg-muted/40 text-muted-foreground hover:bg-muted"
                  }`}
                >
                  <UserCheck className="h-3 w-3" />
                  <span>Minhas</span>
                </button>
              </SystemTooltip>
            )}
          </div>

          {/* Busca de operador */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              type="text"
              aria-label="Buscar responsável"
              placeholder={
                isMineLocked
                  ? "Clique em 'Todas' para escolher outros..."
                  : "Buscar responsável..."
              }
              disabled={isMineLocked}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-7 pl-8 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
            />
          </div>

          {/* Lista com scroll e checkboxes */}
          <div className="max-h-44 overflow-y-auto space-y-1 pr-1">
            {filteredOperators.length === 0 ? (
              <p className="text-center py-4 text-[11px] text-muted-foreground italic">
                Nenhum responsável encontrado
              </p>
            ) : (
              filteredOperators.map((op) => {
                const isChecked = tempSelected.includes(op.id);
                const isRowDisabled = isMineLocked;
                const rowTooltip = isMineLocked
                  ? "Filtro 'Minhas' ativo — clique em 'Todas' para escolher outros usuários"
                  : isChecked
                    ? `Desmarcar ${op.name}`
                    : `Selecionar ${op.name}`;
                return (
                  <SystemTooltip key={op.id} content={rowTooltip}>
                    <label
                      className={`flex items-center gap-2 p-1.5 rounded-lg text-xs transition-opacity ${
                        isRowDisabled
                          ? op.id === currentOperatorId
                            ? "bg-primary/10 cursor-not-allowed"
                            : "opacity-45 cursor-not-allowed"
                          : "hover:bg-muted/50 cursor-pointer"
                      }`}
                    >
                      <Checkbox
                        checked={isChecked}
                        disabled={isRowDisabled}
                        onCheckedChange={() => handleToggle(op.id)}
                      />
                      <span className="min-w-0 flex-1 break-words font-medium">{op.name}</span>
                      {op.id === currentOperatorId && (
                        <span className="text-[10px] text-primary font-bold">(Você)</span>
                      )}
                    </label>
                  </SystemTooltip>
                );
              })
            )}
          </div>

          {/* Rodapé: Limpar e Aplicar */}
          <div className="flex items-center justify-between border-t border-border pt-2">
            <SystemTooltip content="Limpar filtro de responsáveis">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleClear}
                className="h-7 text-[11px] text-muted-foreground hover:text-foreground px-2"
              >
                Limpar
              </Button>
            </SystemTooltip>
            <SystemTooltip content="Aplicar filtro de responsáveis selecionado">
              <Button
                type="button"
                size="sm"
                onClick={handleApply}
                className="h-7 text-[11px] font-bold px-3"
              >
                <Check className="h-3 w-3 mr-1" />
                Aplicar
              </Button>
            </SystemTooltip>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
