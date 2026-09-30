import React, { useState, useEffect } from "react";
import {
  Columns3,
  List,
  Search,
  Plus,
  Filter,
  Layers,
  Settings2,
  ArrowUpDown,
  X,
  Building2,
  ContactRound,
  ClipboardList,
  BriefcaseBusiness,
  Activity,
} from "lucide-react";
import { OperatorFilterPopover } from "./OperatorFilterPopover";
import { AdvancedFiltersState, countActiveAdvancedFilters } from "./AdvancedFiltersModal";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SystemTooltip } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export interface PipelineOption {
  id: string;
  name: string;
  isDefault?: boolean;
}

export type CrmStatusFilter = "all" | "open" | "won" | "lost" | "paused" | "not_paused";

interface CrmToolbarProps {
  viewMode: "kanban" | "list";
  onViewModeChange: (mode: "kanban" | "list") => void;
  pipelines: PipelineOption[];
  selectedPipelineId: string;
  onPipelineChange: (pipelineId: string) => void;
  statusFilter: CrmStatusFilter;
  onStatusFilterChange: (status: CrmStatusFilter) => void;
  operators: Array<{ id: string; name: string }>;
  currentOperatorId?: string | null;
  selectedOperatorIds: string[];
  onOperatorIdsChange: (operatorIds: string[]) => void;
  sortBy: string;
  onSortByChange: (sortBy: string) => void;
  advancedFilters: AdvancedFiltersState;
  onOpenAdvancedFilters: () => void;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  onNewDealClick: () => void;
  onCreateCompanyClick: () => void;
  onCreateContactClick: () => void;
  onCreateTaskClick: () => void;
  onManagePipelinesClick?: () => void;
  onManageFieldsClick?: () => void;
}

export function CrmToolbar({
  viewMode,
  onViewModeChange,
  pipelines,
  selectedPipelineId,
  onPipelineChange,
  statusFilter,
  onStatusFilterChange,
  operators,
  currentOperatorId,
  selectedOperatorIds,
  onOperatorIdsChange,
  sortBy,
  onSortByChange,
  advancedFilters,
  onOpenAdvancedFilters,
  searchQuery,
  onSearchQueryChange,
  onNewDealClick,
  onCreateCompanyClick,
  onCreateContactClick,
  onCreateTaskClick,
  onManagePipelinesClick,
  onManageFieldsClick,
}: CrmToolbarProps) {
  // Estado local para busca com debounce
  const [localSearch, setLocalSearch] = useState(searchQuery);

  useEffect(() => {
    setLocalSearch(searchQuery);
  }, [searchQuery]);

  useEffect(() => {
    const handler = setTimeout(() => {
      if (localSearch !== searchQuery) {
        onSearchQueryChange(localSearch);
      }
    }, 300);
    return () => clearTimeout(handler);
  }, [localSearch, searchQuery, onSearchQueryChange]);

  const activeAdvancedCount = countActiveAdvancedFilters(advancedFilters);

  return (
    <div className="rounded-2xl border border-border bg-card p-3 shadow-xs">
      {/* Linha Superior: Seletor de Funil + Alternância Kanban/Lista + Responsável + Status + Ações */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Bloco Esquerda: Funil, Kanban/Lista, Vendedor */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Seletor de Funis */}
          <div className="relative flex items-center gap-1">
            <Select value={selectedPipelineId} onValueChange={onPipelineChange}>
              <SelectTrigger className="h-8 border-border bg-muted/30 text-xs font-bold text-foreground rounded-xl px-2.5 gap-1.5 focus:ring-1 focus:ring-primary">
                <div className="flex items-center gap-1.5 truncate">
                  <Layers className="h-3.5 w-3.5 text-primary shrink-0" />
                  <SelectValue placeholder="Selecione um funil..." />
                </div>
              </SelectTrigger>
              <SelectContent>
                {pipelines.length === 0 ? (
                  <SelectItem value="__none__" disabled className="text-xs text-muted-foreground">
                    Nenhum funil
                  </SelectItem>
                ) : (
                  pipelines.map((p) => (
                    <SelectItem key={p.id} value={p.id} className="text-xs font-medium">
                      {p.name} {p.isDefault ? "(Padrão)" : ""}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>

            {onManagePipelinesClick && (
              <SystemTooltip content="Gerenciar funis e etapas">
                <button
                  type="button"
                  onClick={onManagePipelinesClick}
                  className="flex h-8 w-8 items-center justify-center rounded-xl border border-border bg-muted/30 text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors cursor-pointer"
                >
                  <Settings2 className="h-3.5 w-3.5" />
                </button>
              </SystemTooltip>
            )}
            {onManageFieldsClick && (
              <SystemTooltip content="Configurar campos de cadastro">
                <button type="button" onClick={onManageFieldsClick} aria-label="Configurar campos de cadastro"
                  className="flex h-8 items-center gap-1 rounded-xl border border-border bg-muted/30 px-2 text-xs font-semibold text-muted-foreground hover:text-foreground">
                  <Settings2 className="h-3.5 w-3.5" /> Campos
                </button>
              </SystemTooltip>
            )}
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

          {/* Filtro de Vendedor / Responsável com Popover */}
          <OperatorFilterPopover
            operators={operators}
            currentOperatorId={currentOperatorId}
            selectedOperatorIds={selectedOperatorIds}
            onChange={onOperatorIdsChange}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select value={statusFilter} onValueChange={(value) => onStatusFilterChange(value as CrmStatusFilter)}>
            <SelectTrigger aria-label="Status da negociação" className="h-8 min-w-40 rounded-xl border-border bg-muted/30 px-2.5 text-xs font-semibold">
              <div className="flex items-center gap-1.5"><Activity className="h-3.5 w-3.5 text-muted-foreground" /><SelectValue /></div>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os status</SelectItem>
              <SelectItem value="open">Em andamento</SelectItem>
              <SelectItem value="won">Vendido</SelectItem>
              <SelectItem value="lost">Perdido</SelectItem>
              <SelectItem value="paused">Pausado</SelectItem>
              <SelectItem value="not_paused">Não pausado</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sortBy} onValueChange={onSortByChange}>
            <SelectTrigger aria-label="Ordenar negociações" className="h-8 min-w-44 border-border bg-muted/30 text-xs font-semibold text-foreground rounded-xl px-2.5 gap-1.5 focus:ring-1 focus:ring-primary">
              <div className="flex items-center gap-1.5 truncate">
                <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <SelectValue />
              </div>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="updated_desc" className="text-xs font-medium">Atualizadas por último</SelectItem>
              <SelectItem value="created_desc" className="text-xs font-medium">Criação (mais recentes)</SelectItem>
              <SelectItem value="created_asc" className="text-xs font-medium">Criação (mais antigas)</SelectItem>
              <SelectItem value="name_asc" className="text-xs font-medium">Nome (A - Z)</SelectItem>
              <SelectItem value="name_desc" className="text-xs font-medium">Nome (Z - A)</SelectItem>
              <SelectItem value="next_task_asc" className="text-xs font-medium">Próxima tarefa (urgente)</SelectItem>
              <SelectItem value="close_date_asc" className="text-xs font-medium">Previsão (mais próxima)</SelectItem>
              <SelectItem value="close_date_desc" className="text-xs font-medium">Previsão (mais distante)</SelectItem>
              <SelectItem value="rating_desc" className="text-xs font-medium">Qualificação (maior)</SelectItem>
              <SelectItem value="contact_recent" className="text-xs font-medium">Última atividade</SelectItem>
            </SelectContent>
          </Select>

          {/* Botão Filtros Avançados */}
          <button
            type="button"
            onClick={onOpenAdvancedFilters}
            className={`flex items-center gap-1.5 rounded-xl border px-3 py-1 text-xs font-semibold transition-colors cursor-pointer ${
              activeAdvancedCount > 0
                ? "border-primary bg-primary/10 text-primary font-bold"
                : "border-border bg-muted/20 text-muted-foreground hover:bg-muted/40 hover:text-foreground"
            }`}
          >
            <Filter className="h-3.5 w-3.5" />
            <span>Filtros</span>
            {activeAdvancedCount > 0 && (
              <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-extrabold text-primary-foreground">
                {activeAdvancedCount}
              </span>
            )}
          </button>

          {/* Campo de Busca Abrangente com Debounce */}
          <div className="relative w-44 sm:w-52">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Buscar título, conta, contato, ID..."
              value={localSearch}
              onChange={(e) => setLocalSearch(e.target.value)}
              className="h-8 w-full rounded-xl border border-border bg-muted/20 pl-8 pr-7 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
            {localSearch && (
              <button
                type="button"
                onClick={() => {
                  setLocalSearch("");
                  onSearchQueryChange("");
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="flex h-8 items-center gap-1.5 rounded-xl bg-primary px-3 text-xs font-bold text-primary-foreground shadow-xs hover:opacity-90 transition-opacity cursor-pointer whitespace-nowrap">
                <Plus className="h-4 w-4" /><span>Criar</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44 rounded-xl p-1.5">
              <DropdownMenuItem onSelect={onNewDealClick} className="text-xs font-semibold"><BriefcaseBusiness /> Criar negociação</DropdownMenuItem>
              <DropdownMenuItem onSelect={onCreateCompanyClick} className="text-xs font-semibold"><Building2 /> Criar empresa</DropdownMenuItem>
              <DropdownMenuItem onSelect={onCreateContactClick} className="text-xs font-semibold"><ContactRound /> Criar contato</DropdownMenuItem>
              <DropdownMenuItem onSelect={onCreateTaskClick} className="text-xs font-semibold"><ClipboardList /> Criar tarefa</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}
