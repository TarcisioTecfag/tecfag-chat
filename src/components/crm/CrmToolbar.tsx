import React from "react";
import {
  Columns3,
  List,
  Search,
  Plus,
  Filter,
  Layers,
  UserCheck,
  Check,
  ChevronDown,
} from "lucide-react";

export interface PipelineOption {
  id: string;
  name: string;
  isDefault?: boolean;
}

interface CrmToolbarProps {
  viewMode: "kanban" | "list";
  onViewModeChange: (mode: "kanban" | "list") => void;
  pipelines: PipelineOption[];
  selectedPipelineId: string;
  onPipelineChange: (pipelineId: string) => void;
  statusFilter: "all" | "open" | "won" | "lost" | "paused";
  onStatusFilterChange: (status: "all" | "open" | "won" | "lost" | "paused") => void;
  onlyMyDeals: boolean;
  onToggleOnlyMyDeals: (onlyMine: boolean) => void;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  onNewDealClick: () => void;
}

export function CrmToolbar({
  viewMode,
  onViewModeChange,
  pipelines,
  selectedPipelineId,
  onPipelineChange,
  statusFilter,
  onStatusFilterChange,
  onlyMyDeals,
  onToggleOnlyMyDeals,
  searchQuery,
  onSearchQueryChange,
  onNewDealClick,
}: CrmToolbarProps) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-3 shadow-sm md:flex-row md:items-center md:justify-between">
      {/* Esquerda: Seletor de Funil + Alternância de View (Kanban / Lista) */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Seletor de Funis */}
        <div className="relative">
          <div className="flex items-center gap-1.5 rounded-xl border border-border bg-muted/30 px-3 py-1.5 text-xs font-semibold text-foreground">
            <Layers className="h-3.5 w-3.5 text-primary shrink-0" />
            <select
              value={selectedPipelineId}
              onChange={(e) => onPipelineChange(e.target.value)}
              className="bg-transparent font-bold text-foreground outline-none cursor-pointer pr-4 text-xs"
            >
              {pipelines.length === 0 ? (
                <option value="" disabled className="bg-card text-muted-foreground">
                  Nenhum funil disponível
                </option>
              ) : (
                pipelines.map((p) => (
                  <option key={p.id} value={p.id} className="bg-card text-foreground">
                    {p.name} {p.isDefault ? "(Padrão)" : ""}
                  </option>
                ))
              )}
            </select>
          </div>
        </div>

        {/* Toggle Kanban / Lista */}
        <div className="flex items-center rounded-xl border border-border bg-muted/30 p-0.5">
          <button
            onClick={() => onViewModeChange("kanban")}
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-bold transition-all cursor-pointer ${
              viewMode === "kanban"
                ? "bg-primary text-primary-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Columns3 className="h-3.5 w-3.5" />
            <span>Quadro</span>
          </button>
          <button
            onClick={() => onViewModeChange("list")}
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-bold transition-all cursor-pointer ${
              viewMode === "list"
                ? "bg-primary text-primary-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <List className="h-3.5 w-3.5" />
            <span>Lista</span>
          </button>
        </div>

        {/* Toggle Minhas Negociações */}
        <button
          onClick={() => onToggleOnlyMyDeals(!onlyMyDeals)}
          className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
            onlyMyDeals
              ? "border-primary bg-primary/10 text-primary font-bold"
              : "border-border bg-muted/20 text-muted-foreground hover:bg-muted/40 hover:text-foreground"
          }`}
        >
          <UserCheck className="h-3.5 w-3.5" />
          <span>{onlyMyDeals ? "Minhas Negociações" : "Todas as Negociações"}</span>
        </button>

        {/* Filtro de Status */}
        <div className="flex items-center rounded-xl border border-border bg-muted/30 p-0.5">
          {(
            [
              { id: "all", label: "Todos" },
              { id: "open", label: "Em andamento" },
              { id: "won", label: "Vendidos" },
              { id: "lost", label: "Perdidos" },
              { id: "paused", label: "Pausados" },
            ] as const
          ).map((s) => (
            <button
              key={s.id}
              onClick={() => onStatusFilterChange(s.id)}
              className={`rounded-lg px-2 py-1 text-[11px] font-semibold transition-all cursor-pointer ${
                statusFilter === s.id
                  ? "bg-card text-foreground shadow-xs font-bold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Direita: Busca + Botão Criar Negociação */}
      <div className="flex items-center gap-2">
        {/* Campo de Busca */}
        <div className="relative flex-1 md:w-56">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            placeholder="Buscar negociação..."
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            className="h-8 w-full rounded-xl border border-border bg-muted/20 pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        {/* Botão + Nova Negociação */}
        <button
          onClick={onNewDealClick}
          className="flex h-8 items-center gap-1.5 rounded-xl bg-primary px-3 text-xs font-bold text-primary-foreground shadow-sm hover:opacity-90 transition-opacity cursor-pointer whitespace-nowrap"
        >
          <Plus className="h-4 w-4" />
          <span>Nova Negociação</span>
        </button>
      </div>
    </div>
  );
}
