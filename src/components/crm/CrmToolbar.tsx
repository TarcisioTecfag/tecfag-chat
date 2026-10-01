import React, { useState } from "react";
import {
  Columns3,
  List,
  Search,
  Plus,
  Filter,
  Layers,
  ArrowUpDown,
  X,
  Building2,
  ContactRound,
  ClipboardList,
  Activity,
  ChevronDown,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

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
  stages: Array<{ id: string; name: string }>;
  onAdvancedFiltersChange: (filters: AdvancedFiltersState) => void;
  onOpenAdvancedFilters: () => void;
  onClearFilters: () => void;
  onOpenSearch: () => void;
  onNewDealClick: () => void;
  onCreateCompanyClick: () => void;
  onCreateContactClick: () => void;
  onCreateTaskClick: () => void;
}

const sortOptions = [
  { value: "updated_desc", label: "Atualizadas por último", shortLabel: "Atualização" },
  { value: "created_desc", label: "Criação (mais recentes)", shortLabel: "Mais recentes" },
  { value: "created_asc", label: "Criação (mais antigas)", shortLabel: "Mais antigas" },
  { value: "name_asc", label: "Nome (A - Z)", shortLabel: "Nome A–Z" },
  { value: "name_desc", label: "Nome (Z - A)", shortLabel: "Nome Z–A" },
  { value: "next_task_asc", label: "Próxima tarefa (urgente)", shortLabel: "Próxima tarefa" },
  { value: "close_date_asc", label: "Previsão (mais próxima)", shortLabel: "Previsão próxima" },
  { value: "close_date_desc", label: "Previsão (mais distante)", shortLabel: "Previsão distante" },
  { value: "rating_desc", label: "Qualificação (maior)", shortLabel: "Qualificação" },
  { value: "contact_recent", label: "Última atividade", shortLabel: "Última atividade" },
];

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
  stages,
  onAdvancedFiltersChange,
  onOpenAdvancedFilters,
  onClearFilters,
  onOpenSearch,
  onNewDealClick,
  onCreateCompanyClick,
  onCreateContactClick,
  onCreateTaskClick,
}: CrmToolbarProps) {
  const [compactFiltersOpen, setCompactFiltersOpen] = useState(false);

  const activeAdvancedCount = countActiveAdvancedFilters(advancedFilters);
  const activeFilterCount =
    activeAdvancedCount + Number(statusFilter !== "all") + Number(selectedOperatorIds.length > 0);
  const hasFilters = activeFilterCount > 0;
  const selectedPipeline = pipelines.find((pipeline) => pipeline.id === selectedPipelineId);
  const selectedSort = sortOptions.find((option) => option.value === sortBy) || sortOptions[0];
  const filterChips: Array<{ key: keyof AdvancedFiltersState; label: string }> = [];
  const currency = (value: number) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
  const dateLabel = (value: string) => value.split("-").reverse().join("/");

  if (advancedFilters.stageIds?.length) {
    const names = advancedFilters.stageIds.map(
      (id) => stages.find((stage) => stage.id === id)?.name || "Etapa indisponível",
    );
    filterChips.push({ key: "stageIds", label: `Etapas: ${names.join(", ")}` });
  }
  if (advancedFilters.minValue != null)
    filterChips.push({
      key: "minValue",
      label: `Valor mínimo: ${currency(advancedFilters.minValue)}`,
    });
  if (advancedFilters.maxValue != null)
    filterChips.push({
      key: "maxValue",
      label: `Valor máximo: ${currency(advancedFilters.maxValue)}`,
    });
  if (advancedFilters.createdAfter)
    filterChips.push({
      key: "createdAfter",
      label: `Criadas a partir de ${dateLabel(advancedFilters.createdAfter)}`,
    });
  if (advancedFilters.createdBefore)
    filterChips.push({
      key: "createdBefore",
      label: `Criadas até ${dateLabel(advancedFilters.createdBefore)}`,
    });
  if (advancedFilters.hasOverdueTask)
    filterChips.push({ key: "hasOverdueTask", label: "Com tarefas vencidas" });
  if (advancedFilters.coolingOnly)
    filterChips.push({
      key: "coolingOnly",
      label: `Sem atividade há ${advancedFilters.coolingDays ?? 10} dias`,
    });

  const removeFilter = (key: keyof AdvancedFiltersState) => {
    const next = { ...advancedFilters };
    delete next[key];
    if (key === "coolingOnly") delete next.coolingDays;
    onAdvancedFiltersChange(next);
  };

  const clearFilters = () => {
    onClearFilters();
  };

  const renderResponsibleFilter = () => (
    <OperatorFilterPopover
      operators={operators}
      currentOperatorId={currentOperatorId}
      selectedOperatorIds={selectedOperatorIds}
      onChange={onOperatorIdsChange}
    />
  );

  const renderStatusFilter = () => (
    <Select
      value={statusFilter}
      onValueChange={(value) => onStatusFilterChange(value as CrmStatusFilter)}
    >
      <SelectTrigger
        aria-label="Status da negociação"
        className="h-9 w-full gap-2 rounded-lg bg-background px-3 text-sm shadow-none"
      >
        <div className="flex min-w-0 items-center gap-2">
          <Activity className="h-4 w-4 shrink-0 text-muted-foreground" />
          <SelectValue />
        </div>
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
  );

  const renderSort = () => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Ordenar negociações: ${selectedSort.label}`}
          className="flex h-9 w-full items-center justify-between gap-2 whitespace-nowrap rounded-lg px-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowUpDown className="h-4 w-4 shrink-0" />
          <span>
            Ordenar: <span className="text-foreground">{selectedSort.shortLabel}</span>
          </span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Ordenar negociações</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={sortBy} onValueChange={onSortByChange}>
          {sortOptions.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const renderAdvancedButton = () => (
    <button
      type="button"
      onClick={() => {
        setCompactFiltersOpen(false);
        onOpenAdvancedFilters();
      }}
      className={`flex h-9 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg border px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${activeAdvancedCount ? "border-primary/30 bg-primary/5 text-primary" : "border-border hover:bg-muted"}`}
    >
      <Filter className="h-4 w-4" />
      Mais filtros
      {activeAdvancedCount > 0 && (
        <span className="rounded-full bg-primary/10 px-1.5 text-xs tabular-nums">
          {activeAdvancedCount}
        </span>
      )}
    </button>
  );

  return (
    <div className="@container/crm-toolbar min-w-0 shrink-0 rounded-2xl border border-border bg-card shadow-xs">
      <div className="flex flex-col gap-3 px-4 py-3 @[38rem]/crm-toolbar:flex-row @[38rem]/crm-toolbar:items-center @[38rem]/crm-toolbar:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-2">
          <Select value={selectedPipelineId} onValueChange={onPipelineChange}>
            <SelectTrigger
              aria-label="Funil de negociações"
              className="h-10 w-auto min-w-0 max-w-full gap-3 rounded-lg border-transparent bg-transparent px-1 text-base font-semibold shadow-none @[38rem]/crm-toolbar:max-w-80 cursor-pointer hover:bg-muted/30 transition-colors"
            >
              <div className="flex min-w-0 items-center gap-2">
                <Layers className="h-4 w-4 shrink-0 text-primary" />
                <span className="truncate">
                  <SelectValue placeholder="Selecione um funil">
                    {selectedPipeline?.name}
                  </SelectValue>
                </span>
              </div>
            </SelectTrigger>
            <SelectContent>
              {pipelines.length === 0 ? (
                <SelectItem value="__none__" disabled>
                  Nenhum funil
                </SelectItem>
              ) : (
                pipelines.map((pipeline) => (
                  <SelectItem key={pipeline.id} value={pipeline.id}>
                    {pipeline.name}
                    {pipeline.isDefault ? " (Padrão)" : ""}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
          <div
            role="group"
            aria-label="Visualização das negociações"
            className="flex shrink-0 items-center rounded-lg bg-muted/60 p-1"
          >
            {(["kanban", "list"] as const).map((mode) => {
              const Icon = mode === "kanban" ? Columns3 : List;
              return (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={viewMode === mode}
                  onClick={() => onViewModeChange(mode)}
                  className={`flex h-8 items-center gap-2 rounded-md px-3 text-sm font-medium transition-all duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${viewMode === mode ? "bg-card text-foreground shadow-xs font-semibold" : "text-muted-foreground hover:text-foreground"}`}
                >
                  <Icon className="h-4 w-4" />
                  {mode === "kanban" ? "Quadro" : "Lista"}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex shrink-0 self-start rounded-lg bg-primary text-primary-foreground shadow-xs">
          <button
            type="button"
            onClick={onNewDealClick}
            className="flex h-10 items-center gap-2 rounded-l-lg px-4 text-sm font-semibold hover:bg-black/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <Plus className="h-4 w-4" />
            Nova negociação
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Outras opções de criação"
                className="flex h-10 w-10 items-center justify-center rounded-r-lg border-l border-primary-foreground/25 hover:bg-black/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <ChevronDown className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Outras criações</DropdownMenuLabel>
              <DropdownMenuItem onSelect={onCreateCompanyClick}>
                <Building2 />
                Criar empresa
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onCreateContactClick}>
                <ContactRound />
                Criar contato
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onCreateTaskClick}>
                <ClipboardList />
                Criar tarefa
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="flex items-center gap-2 border-t border-border/60 px-4 py-3">
        <button
          type="button"
          onClick={onOpenSearch}
          aria-label="Buscar negociações, empresas e contatos"
          className="flex h-9 min-w-0 flex-1 items-center gap-3 rounded-lg border border-border bg-background px-3 text-left text-sm text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Search className="h-4 w-4 shrink-0" />
          <span className="truncate">Buscar negociações, empresas ou contatos...</span>
        </button>
        <div className="hidden shrink-0 items-center gap-2 @[64rem]/crm-toolbar:flex">
          <div className="w-56">{renderResponsibleFilter()}</div>
          <div className="w-44">{renderStatusFilter()}</div>
          {renderAdvancedButton()}
          <div className="ml-1 border-l border-border pl-2">{renderSort()}</div>
        </div>
        <div className="shrink-0 @[64rem]/crm-toolbar:hidden">
          <Popover open={compactFiltersOpen} onOpenChange={setCompactFiltersOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={`Filtros e ordenação, ${activeFilterCount} filtros ativos`}
                className="flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Filter className="h-4 w-4" />
                <span className="hidden @[24rem]/crm-toolbar:inline">Filtros</span>
                {activeFilterCount > 0 && (
                  <span className="rounded-full bg-primary/10 px-1.5 text-xs text-primary">
                    {activeFilterCount}
                  </span>
                )}
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)] space-y-4 p-4">
              <p className="text-sm font-semibold">Filtros e ordenação</p>
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">Responsável</p>
                {renderResponsibleFilter()}
              </div>
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">Status</p>
                {renderStatusFilter()}
              </div>
              <div className="border-t border-border pt-2">{renderSort()}</div>
              {renderAdvancedButton()}
              {hasFilters && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="text-sm text-muted-foreground underline underline-offset-4"
                >
                  Limpar filtros
                </button>
              )}
            </PopoverContent>
          </Popover>
        </div>
        {hasFilters && (
          <SystemTooltip content="Limpar filtros">
            <button
              type="button"
              aria-label="Limpar filtros"
              onClick={clearFilters}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="h-4 w-4" />
            </button>
          </SystemTooltip>
        )}
      </div>

      {filterChips.length > 0 && (
        <div
          aria-label="Filtros avançados aplicados"
          className="flex flex-wrap items-center gap-2 border-t border-border/60 px-4 py-2.5"
        >
          {filterChips.map(({ key, label }) => (
            <SystemTooltip key={key} content={label}>
              <button
                type="button"
                aria-label={`Remover filtro: ${label}`}
                onClick={() => removeFilter(key)}
                className="flex min-h-7 max-w-full items-center gap-2 rounded-md bg-muted px-2 py-1 text-xs text-foreground hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="truncate">{label}</span>
                <X className="h-3.5 w-3.5 shrink-0" />
              </button>
            </SystemTooltip>
          ))}
        </div>
      )}
    </div>
  );
}
