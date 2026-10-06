import React, { useState, useMemo } from "react";
import { DealCardData } from "./DealCard";
import {
  Building2,
  User,
  Star,
  MessageSquare,
  ChevronRight,
  Clock,
  AlertCircle,
  RefreshCw,
  Loader2,
  Activity,
  ThumbsDown,
  ThumbsUp,
  Pause,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SystemTooltip } from "@/components/ui/tooltip";
import { BulkActionsSuite } from "./BulkActionsSuite";

interface DealListProps {
  deals: DealCardData[];
  stages: Array<{ id: string; name: string; isWinStage?: boolean; isLossStage?: boolean }>;
  operators: Array<{ id: string; name: string }>;
  stagesMap: Map<string, string>;
  operatorsMap: Map<string, string>;
  pipelines?: Array<{
    id: string;
    name: string;
    stages: Array<{ id: string; name: string; isWinStage?: boolean; isLossStage?: boolean; orderIndex?: number }>;
  }>;
  currentPipelineId?: string;
  filterParams?: Record<string, any>;
  onDealClick: (deal: DealCardData) => void;
  total: number;
  limit: number;
  offset: number;
  onPageChange: (newOffset: number) => void;
  onLimitChange?: (newLimit: number) => void;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onClearFilters?: () => void;
  onRefreshData?: () => void;
  onCreateTaskClick?: (deal: DealCardData) => void;
}

function getInitials(name: string): string {
  if (!name || name === "Não atribuído" || name === "Sem responsável") return "—";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function DealList({
  deals,
  stages,
  operators,
  stagesMap,
  operatorsMap,
  pipelines = [],
  currentPipelineId,
  filterParams,
  onDealClick,
  total,
  limit,
  offset,
  onPageChange,
  onLimitChange,
  loading = false,
  error = null,
  onRetry,
  onClearFilters,
  onRefreshData,
  onCreateTaskClick,
}: DealListProps) {
  // Seleção de linhas na página
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Seleção global de todo o filtro (além da página atual)
  const [isAllFilterSelected, setIsAllFilterSelected] = useState(false);

  const currentPage = Math.floor(offset / limit) + 1;
  const totalPages = Math.ceil(total / limit) || 1;

  // Verifica se todos os itens da página atual estão selecionados
  const isAllCurrentSelected = useMemo(() => {
    if (deals.length === 0) return false;
    return deals.every((d) => selectedIds.has(d.id));
  }, [deals, selectedIds]);

  const handleToggleSelectAll = () => {
    if (isAllFilterSelected) {
      setIsAllFilterSelected(false);
      setSelectedIds(new Set());
      return;
    }

    if (isAllCurrentSelected) {
      // Desmarca todos da página atual
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const d of deals) next.delete(d.id);
        return next;
      });
    } else {
      // Marca todos da página atual
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const d of deals) next.add(d.id);
        return next;
      });
    }
  };

  const handleToggleSelectRow = (dealId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (isAllFilterSelected) {
      setIsAllFilterSelected(false);
    }
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(dealId)) {
        next.delete(dealId);
      } else {
        next.add(dealId);
      }
      return next;
    });
  };

  const handleClearSelection = () => {
    setSelectedIds(new Set());
    setIsAllFilterSelected(false);
  };

  // Contagem efetiva
  const effectiveCount = isAllFilterSelected ? total : selectedIds.size;

  // Array de páginas para a navegação numérica
  const paginationRange = useMemo(() => {
    const delta = 2;
    const range: Array<number | string> = [];
    for (
      let i = Math.max(2, currentPage - delta);
      i <= Math.min(totalPages - 1, currentPage + delta);
      i++
    ) {
      range.push(i);
    }

    if (currentPage - delta > 2) {
      range.unshift("...");
    }
    if (currentPage + delta < totalPages - 1) {
      range.push("...");
    }

    range.unshift(1);
    if (totalPages > 1) {
      range.push(totalPages);
    }

    return range;
  }, [currentPage, totalPages]);

  return (
    <div className="flex flex-col h-full w-full bg-card rounded-2xl border border-border overflow-hidden relative">
      {/* ──────────────────────────────────────────────────────────────────────────
          BARRA DE AÇÕES EM MASSA (EXIBIDA QUANDO HOUVER SELEÇÃO ATIVA)
          ────────────────────────────────────────────────────────────────────────── */}
      {effectiveCount > 0 && (
        <BulkActionsSuite
          selectedIds={selectedIds}
          onClearSelection={handleClearSelection}
          isAllFilterSelected={isAllFilterSelected}
          onToggleAllFilter={() => setIsAllFilterSelected((prev) => !prev)}
          total={total}
          deals={deals}
          operators={operators}
          pipelines={pipelines}
          currentPipelineId={currentPipelineId}
          filterParams={filterParams}
          onSuccess={() => {
            handleClearSelection();
            if (onRefreshData) onRefreshData();
          }}
        />
      )}

      {/* Conteúdo Principal: Tabela / Carregando / Erro / Vazio */}
      <div className="flex-1 overflow-x-auto overflow-y-auto">
        {loading && deals.length === 0 ? (
          <div className="flex h-full min-h-[300px] w-full items-center justify-center">
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <Loader2 className="h-7 w-7 animate-spin text-primary" />
              <p className="text-xs font-medium">Carregando lista de negociações...</p>
            </div>
          </div>
        ) : error ? (
          <div className="flex h-full min-h-[300px] w-full items-center justify-center p-6 text-center">
            <div className="max-w-sm space-y-3">
              <AlertCircle className="mx-auto h-8 w-8 text-red-500" />
              <h4 className="text-sm font-bold text-foreground">Falha ao carregar negociações</h4>
              <p className="text-xs text-muted-foreground">{error}</p>
              {onRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground shadow-xs hover:opacity-90 transition cursor-pointer"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  <span>Tentar novamente</span>
                </button>
              )}
            </div>
          </div>
        ) : (
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-muted-foreground font-bold uppercase text-[11px] tracking-wider sticky top-0 z-10 backdrop-blur-xs">
                {/* Checkbox selecionar todos */}
                <th className="py-3 px-3 w-10 text-center">
                  <Checkbox
                    checked={isAllFilterSelected || isAllCurrentSelected}
                    onCheckedChange={handleToggleSelectAll}
                    aria-label="Selecionar todas as negociações da página"
                    className="data-[state=checked]:bg-cyan-500 data-[state=checked]:border-cyan-500 rounded-sm"
                  />
                </th>
                <th className="py-3 px-3">Negociações</th>
                <th className="py-3 px-3">Responsável</th>
                <th className="py-3 px-2 text-center">Qualificação</th>
                <th className="py-3 px-3">Etapa do Funil</th>
                <th className="py-3 px-3 text-right">Valor Total</th>
                <th className="py-3 px-3">Data de Criação</th>
                <th className="py-3 px-3">Status</th>
                <th className="py-3 px-3">Próxima Tarefa</th>
                <th className="py-3 px-2 text-center">Conversas</th>
                <th className="py-3 px-2 text-center w-10">Ações</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-border/60">
              {deals.length === 0 ? (
                <tr>
                  <td colSpan={11} className="py-16 text-center text-muted-foreground">
                    <div className="flex flex-col items-center justify-center gap-2 max-w-sm mx-auto">
                      <p className="font-semibold text-foreground text-sm">
                        Nenhuma negociação encontrada
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Não existem negociações que correspondam aos filtros ou busca selecionados.
                      </p>
                      {onClearFilters && (
                        <button
                          type="button"
                          onClick={onClearFilters}
                          className="mt-2 text-xs font-bold text-primary hover:underline cursor-pointer"
                        >
                          Limpar todos os filtros
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                deals.map((deal) => {
                  const isSelected = isAllFilterSelected || selectedIds.has(deal.id);
                  const isNullValue = deal.value === null || deal.value === undefined;
                  const rawValue = !isNullValue ? Number(deal.value) : null;
                  const formattedValue =
                    rawValue !== null && !isNaN(rawValue)
                      ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
                          rawValue
                        )
                      : null;

                  const stageName = stagesMap.get(deal.stageId) || "Etapa desconhecida";
                  const sellerId = deal.operatorId || deal.ownerId;
                  const operatorName = sellerId
                    ? operatorsMap.get(sellerId) || "Não atribuído"
                    : "Sem responsável";

                  const statusBadge = {
                    open: {
                      label: "Em andamento",
                      color: "bg-muted/80 text-muted-foreground border-border/80",
                      icon: <Activity className="h-4 w-4 text-sky-500" />,
                    },
                    won: {
                      label: "Vendido",
                      color: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
                      icon: <ThumbsUp className="h-4 w-4 text-emerald-500" />,
                    },
                    lost: {
                      label: "Perdido",
                      color: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
                      icon: <ThumbsDown className="h-4 w-4 text-red-500" />,
                    },
                    paused: {
                      label: "Pausado",
                      color: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
                      icon: <Pause className="h-4 w-4 text-amber-500" />,
                    },
                  }[deal.status] || {
                    label: deal.status,
                    color: "bg-muted text-muted-foreground border-border",
                    icon: <Activity className="h-4 w-4 text-muted-foreground" />,
                  };

                  const formattedCreatedAt = new Date(deal.createdAt).toLocaleDateString("pt-BR", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                  });

                  // Próxima Tarefa Badge
                  const nextTask = (deal as any).nextTask;

                  return (
                    <tr
                      key={deal.id}
                      onClick={() => onDealClick(deal)}
                      className={`transition-colors cursor-pointer group ${
                        isSelected
                          ? "bg-cyan-500/10 dark:bg-cyan-500/15 hover:bg-cyan-500/15 dark:hover:bg-cyan-500/20"
                          : "hover:bg-muted/40"
                      }`}
                    >
                      {/* Checkbox de Linha */}
                      <td
                        className="py-3 px-3 text-center"
                        onClick={(e) => handleToggleSelectRow(deal.id, e)}
                      >
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => {}}
                          aria-label={`Selecionar ${deal.title}`}
                          className="data-[state=checked]:bg-cyan-500 data-[state=checked]:border-cyan-500 rounded-sm"
                        />
                      </td>

                      {/* Negociação (Título + Cliente) */}
                      <td className="py-3 px-3 max-w-[220px]">
                        <div className="font-bold text-foreground truncate group-hover:text-primary transition-colors">
                          {deal.title}
                        </div>
                        {deal.account ? (
                          <div className="flex items-center gap-1 text-[11px] text-muted-foreground truncate">
                            {deal.account.type === "company" ? (
                              <Building2 className="h-3 w-3 text-muted-foreground/70 shrink-0" />
                            ) : (
                              <User className="h-3 w-3 text-muted-foreground/70 shrink-0" />
                            )}
                            <span className="truncate">{deal.account.name || deal.account.tradeName}</span>
                          </div>
                        ) : (
                          <div className="text-[10px] text-muted-foreground/60 font-mono truncate">
                            #{deal.id.slice(-6)}
                          </div>
                        )}
                      </td>

                      {/* Responsável (Avatar com iniciais idêntico ao screenshot) */}
                      <td className="py-3 px-3 max-w-[140px] truncate">
                        <div className="flex items-center gap-2 truncate">
                          <div className="h-6 w-6 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold text-[10px] flex items-center justify-center shrink-0 shadow-2xs">
                            {getInitials(operatorName)}
                          </div>
                          <span className="font-medium text-foreground truncate text-xs">
                            {operatorName}
                          </span>
                        </div>
                      </td>

                      {/* Qualificação (Número com estrelas) */}
                      <td className="py-3 px-2 text-center whitespace-nowrap">
                        <span className="font-bold text-xs text-foreground">
                          {deal.rating || 1}
                        </span>
                      </td>

                      {/* Etapa do Funil */}
                      <td className="py-3 px-3">
                        <span className="inline-block font-bold text-[11px] text-foreground uppercase tracking-wide">
                          {stageName}
                        </span>
                      </td>

                      {/* Valor Total */}
                      <td className="py-3 px-3 text-right whitespace-nowrap">
                        {formattedValue ? (
                          <span className="font-bold text-xs text-foreground">
                            {formattedValue}
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDealClick(deal);
                            }}
                            className="text-xs font-semibold text-cyan-600 dark:text-cyan-400 hover:underline cursor-pointer"
                          >
                            Adicionar valor
                          </button>
                        )}
                      </td>

                      {/* Data de Criação */}
                      <td className="py-3 px-3 text-muted-foreground whitespace-nowrap text-xs">
                        {formattedCreatedAt}
                      </td>

                      {/* Status (Ícone com Tooltip informativo) */}
                      <td className="py-3 px-3 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span className="shrink-0">{statusBadge.icon}</span>
                          <SystemTooltip content={`Status: ${statusBadge.label}`}>
                            <div className="h-4 w-4 rounded-full bg-muted/80 text-muted-foreground hover:bg-muted flex items-center justify-center text-[10px] font-bold cursor-default select-none">
                              i
                            </div>
                          </SystemTooltip>
                        </div>
                      </td>

                      {/* Próxima Tarefa */}
                      <td className="py-3 px-3 max-w-[150px]">
                        {nextTask ? (
                          <SystemTooltip
                            content={`${nextTask.title} (${
                              nextTask.dueDate
                                ? new Date(nextTask.dueDate).toLocaleDateString("pt-BR")
                                : "Sem prazo"
                            })`}
                          >
                            <div
                              className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold border truncate cursor-default ${
                                nextTask.isOverdue
                                ? "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20"
                                : nextTask.isToday
                                ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
                                : "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20"
                              }`}
                            >
                              <Clock className="h-2.5 w-2.5 shrink-0" />
                              <span className="truncate">{nextTask.title}</span>
                            </div>
                          </SystemTooltip>
                        ) : (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onCreateTaskClick ? onCreateTaskClick(deal) : onDealClick(deal);
                            }}
                            className="text-[11px] font-semibold text-primary hover:underline cursor-pointer"
                          >
                            + Tarefa
                          </button>
                        )}
                      </td>

                      {/* Conversas */}
                      <td className="py-3 px-2 text-center">
                        {(deal.conversationsCount || 0) > 0 ? (
                          <span className="inline-flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">
                            <MessageSquare className="h-2.5 w-2.5" />
                            {deal.conversationsCount}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/40 text-[11px]">-</span>
                        )}
                      </td>

                      {/* Ações */}
                      <td className="py-3 px-2 text-center">
                        <SystemTooltip content="Ver detalhes">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDealClick(deal);
                            }}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
                          >
                            <ChevronRight className="h-4 w-4" />
                          </button>
                        </SystemTooltip>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* ──────────────────────────────────────────────────────────────────────────
          BARRA DE PAGINAÇÃO (ESTILO RD CRM COM BOTÕES NUMÉRICOS)
          ────────────────────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between border-t border-border px-4 py-2.5 bg-muted/20 gap-2 select-none">
        {/* Esquerda: Exibindo [10 v] de X negociações */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Exibindo</span>
          {onLimitChange && (
            <Select value={String(limit)} onValueChange={(val) => onLimitChange(Number(val))}>
              <SelectTrigger className="h-7 w-[68px] border-border bg-card text-xs font-bold text-foreground rounded-lg px-2 gap-1 focus:ring-1 focus:ring-primary">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="10" className="text-xs font-medium">10</SelectItem>
                <SelectItem value="25" className="text-xs font-medium">25</SelectItem>
                <SelectItem value="50" className="text-xs font-medium">50</SelectItem>
                <SelectItem value="100" className="text-xs font-medium">100</SelectItem>
              </SelectContent>
            </Select>
          )}
          <span>
            de <strong className="font-semibold text-foreground">{total}</strong> negociações
          </span>
        </div>

        {/* Direita: Anterior 1 2 3 4 5 ... 309 Próxima */}
        <div className="flex items-center gap-1 sm:gap-1.5">
          <button
            type="button"
            onClick={() => onPageChange(Math.max(0, offset - limit))}
            disabled={offset === 0}
            className="px-2.5 py-1 text-xs rounded-lg border border-border bg-card text-foreground font-semibold hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
          >
            Anterior
          </button>

          {paginationRange.map((item, idx) => {
            if (typeof item === "string") {
              return (
                <span
                  key={`ellipsis-${idx}`}
                  className="px-1 text-xs font-bold text-muted-foreground"
                >
                  ...
                </span>
              );
            }

            const pageOffset = (item - 1) * limit;
            const isCurrent = item === currentPage;

            return (
              <button
                key={`page-${item}`}
                type="button"
                onClick={() => onPageChange(pageOffset)}
                className={`min-w-[28px] h-7 px-1.5 text-xs rounded-lg font-bold transition cursor-pointer ${
                  isCurrent
                    ? "bg-primary text-primary-foreground shadow-2xs"
                    : "border border-border bg-card text-foreground hover:bg-muted"
                }`}
              >
                {item}
              </button>
            );
          })}

          <button
            type="button"
            onClick={() => onPageChange(offset + limit)}
            disabled={offset + limit >= total}
            className="px-2.5 py-1 text-xs rounded-lg border border-border bg-card text-foreground font-semibold hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
          >
            Próxima
          </button>
        </div>
      </div>
    </div>
  );
}
