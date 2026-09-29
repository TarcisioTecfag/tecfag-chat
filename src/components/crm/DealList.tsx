import React, { useState, useMemo } from "react";
import { DealCardData } from "./DealCard";
import {
  Building2,
  User,
  Star,
  MessageSquare,
  ChevronRight,
  Calendar,
  Clock,
  ArrowRightLeft,
  UserCheck,
  CheckCircle2,
  X,
  AlertCircle,
  RefreshCw,
  Loader2,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { BulkActionsDialog, BulkActionType } from "./BulkActionsDialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SystemTooltip } from "@/components/ui/tooltip";

interface DealListProps {
  deals: DealCardData[];
  stages: Array<{ id: string; name: string; isWinStage?: boolean; isLossStage?: boolean }>;
  operators: Array<{ id: string; name: string }>;
  stagesMap: Map<string, string>;
  operatorsMap: Map<string, string>;
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
}

export function DealList({
  deals,
  stages,
  operators,
  stagesMap,
  operatorsMap,
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
}: DealListProps) {
  // Seleção de linhas
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Diálogo de Ações em Massa
  const [bulkAction, setBulkAction] = useState<BulkActionType | null>(null);

  const currentPage = Math.floor(offset / limit) + 1;
  const totalPages = Math.ceil(total / limit) || 1;

  // Verifica se todos os itens da página atual estão selecionados
  const isAllCurrentSelected = useMemo(() => {
    if (deals.length === 0) return false;
    return deals.every((d) => selectedIds.has(d.id));
  }, [deals, selectedIds]);

  const handleToggleSelectAll = () => {
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
  };

  return (
    <div className="flex flex-col h-full w-full bg-card rounded-2xl border border-border overflow-hidden relative">
      {/* Barra de Ações em Massa Flutuante */}
      {selectedIds.size > 0 && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 rounded-2xl bg-foreground text-background px-4 py-2 shadow-xl animate-in fade-in slide-in-from-top-2 duration-200">
          <span className="text-xs font-bold whitespace-nowrap">
            {selectedIds.size} negociação(ões) selecionada(s)
          </span>

          <div className="h-4 w-px bg-background/20 mx-1" />

          {/* Mover Etapa */}
          <button
            type="button"
            onClick={() => setBulkAction("stage")}
            className="flex items-center gap-1 rounded-lg bg-background/10 hover:bg-background/20 px-2.5 py-1 text-xs font-semibold cursor-pointer transition"
          >
            <ArrowRightLeft className="h-3.5 w-3.5" />
            <span>Mover Etapa</span>
          </button>

          {/* Alterar Vendedor */}
          <button
            type="button"
            onClick={() => setBulkAction("operator")}
            className="flex items-center gap-1 rounded-lg bg-background/10 hover:bg-background/20 px-2.5 py-1 text-xs font-semibold cursor-pointer transition"
          >
            <UserCheck className="h-3.5 w-3.5" />
            <span>Vendedor</span>
          </button>

          {/* Alterar Status */}
          <button
            type="button"
            onClick={() => setBulkAction("status")}
            className="flex items-center gap-1 rounded-lg bg-background/10 hover:bg-background/20 px-2.5 py-1 text-xs font-semibold cursor-pointer transition"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span>Status</span>
          </button>

          <button
            type="button"
            onClick={handleClearSelection}
            title="Desmarcar todas"
            className="flex h-6 w-6 items-center justify-center rounded-lg hover:bg-background/20 text-background/80 hover:text-background cursor-pointer ml-1"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
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
              <tr className="border-b border-border bg-muted/40 text-muted-foreground font-semibold sticky top-0 z-10 backdrop-blur-xs">
                {/* Checkbox selecionar todos */}
                <th className="py-3 px-3 w-10 text-center">
                  <Checkbox
                    checked={isAllCurrentSelected}
                    onCheckedChange={handleToggleSelectAll}
                    aria-label="Selecionar todas as negociações da página"
                  />
                </th>
                <th className="py-3 px-3">Negociação</th>
                <th className="py-3 px-3">Cliente / Empresa</th>
                <th className="py-3 px-3">Responsável</th>
                <th className="py-3 px-2 text-center">Qualif.</th>
                <th className="py-3 px-3">Etapa</th>
                <th className="py-3 px-3 text-right">Valor</th>
                <th className="py-3 px-3">Criação</th>
                <th className="py-3 px-3">Status</th>
                <th className="py-3 px-3">Próxima Tarefa</th>
                <th className="py-3 px-2 text-center">Conversas</th>
                <th className="py-3 px-2 text-center w-10">Ações</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-border/60">
              {deals.length === 0 ? (
                <tr>
                  <td colSpan={12} className="py-16 text-center text-muted-foreground">
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
                  const isSelected = selectedIds.has(deal.id);
                  const isNullValue = deal.value === null || deal.value === undefined;
                  const rawValue = !isNullValue ? Number(deal.value) : null;
                  const formattedValue =
                    rawValue !== null && !isNaN(rawValue)
                      ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
                          rawValue
                        )
                      : "-";

                  const stageName = stagesMap.get(deal.stageId) || "Etapa desconhecida";
                  const sellerId = deal.operatorId || deal.ownerId;
                  const operatorName = sellerId
                    ? operatorsMap.get(sellerId) || "Não atribuído"
                    : "Sem responsável";

                  const statusBadge = {
                    open: {
                      label: "Em andamento",
                      color: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
                    },
                    won: {
                      label: "Vendido",
                      color: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
                    },
                    lost: {
                      label: "Perdido",
                      color: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
                    },
                    paused: {
                      label: "Pausado",
                      color: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
                    },
                  }[deal.status] || {
                    label: deal.status,
                    color: "bg-muted text-muted-foreground border-border",
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
                      className={`hover:bg-muted/40 transition-colors cursor-pointer group ${
                        isSelected ? "bg-primary/5" : ""
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
                        />
                      </td>

                      {/* Negociação (Título + ID) */}
                      <td className="py-3 px-3 max-w-[200px]">
                        <div className="font-bold text-foreground truncate group-hover:text-primary transition-colors">
                          {deal.title}
                        </div>
                        <div className="text-[10px] text-muted-foreground font-mono truncate">
                          #{deal.id.slice(-6)}
                        </div>
                      </td>

                      {/* Cliente / Empresa */}
                      <td className="py-3 px-3 max-w-[180px]">
                        {deal.account ? (
                          <div className="flex items-center gap-1.5 truncate">
                            {deal.account.type === "company" ? (
                              <Building2 className="h-3.5 w-3.5 text-primary/70 shrink-0" />
                            ) : (
                              <User className="h-3.5 w-3.5 text-primary/70 shrink-0" />
                            )}
                            <span className="truncate font-medium text-foreground">
                              {deal.account.name || deal.account.tradeName}
                            </span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground/60 italic text-[11px]">
                            Cliente não definido
                          </span>
                        )}
                      </td>

                      {/* Responsável */}
                      <td className="py-3 px-3 text-muted-foreground max-w-[120px] truncate">
                        <span className="font-medium text-foreground">{operatorName}</span>
                      </td>

                      {/* Qualificação */}
                      <td className="py-3 px-2 text-center">
                        <div className="inline-flex items-center gap-0.5">
                          {[1, 2, 3, 4, 5].map((s) => (
                            <Star
                              key={s}
                              className={`h-2.5 w-2.5 ${
                                (deal.rating || 0) >= s
                                  ? "fill-amber-400 text-amber-400"
                                  : "text-muted-foreground/20"
                              }`}
                            />
                          ))}
                        </div>
                      </td>

                      {/* Etapa */}
                      <td className="py-3 px-3">
                        <span className="inline-block rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground">
                          {stageName}
                        </span>
                      </td>

                      {/* Valor */}
                      <td className="py-3 px-3 text-right font-extrabold text-foreground whitespace-nowrap">
                        {formattedValue}
                      </td>

                      {/* Criação */}
                      <td className="py-3 px-3 text-muted-foreground whitespace-nowrap text-[11px]">
                        {formattedCreatedAt}
                      </td>

                      {/* Status */}
                      <td className="py-3 px-3 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold border ${statusBadge.color}`}
                        >
                          {statusBadge.label}
                        </span>
                      </td>

                      {/* Próxima Tarefa */}
                      <td className="py-3 px-3 max-w-[150px]">
                        {nextTask ? (
                          <div
                            className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold border truncate ${
                              nextTask.isOverdue
                                ? "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20"
                                : nextTask.isToday
                                ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
                                : "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20"
                            }`}
                            title={`${nextTask.title} (${
                              nextTask.dueDate ? new Date(nextTask.dueDate).toLocaleDateString("pt-BR") : ""
                            })`}
                          >
                            <Clock className="h-2.5 w-2.5 shrink-0" />
                            <span className="truncate">{nextTask.title}</span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground/40 text-[11px]">-</span>
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

      {/* Barra de Paginação Estável */}
      <div className="flex flex-wrap items-center justify-between border-t border-border px-4 py-2.5 bg-muted/20 gap-2">
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>
            Exibindo{" "}
            <span className="font-semibold text-foreground">
              {total === 0 ? 0 : offset + 1}
            </span>{" "}
            a{" "}
            <span className="font-semibold text-foreground">
              {Math.min(offset + limit, total)}
            </span>{" "}
            de <span className="font-semibold text-foreground">{total}</span> negociações
          </span>

          {onLimitChange && (
            <div className="flex items-center gap-1.5 pl-2 border-l border-border">
              <span className="text-[11px] text-muted-foreground">Por página:</span>
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
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => onPageChange(Math.max(0, offset - limit))}
            disabled={offset === 0}
            className="px-2.5 py-1 text-xs rounded-lg border border-border bg-card text-foreground font-semibold hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
          >
            Anterior
          </button>
          <span className="text-xs font-bold text-muted-foreground px-1">
            Página {currentPage} de {totalPages}
          </span>
          <button
            onClick={() => onPageChange(offset + limit)}
            disabled={offset + limit >= total}
            className="px-2.5 py-1 text-xs rounded-lg border border-border bg-card text-foreground font-semibold hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
          >
            Próxima
          </button>
        </div>
      </div>

      {/* Modal de Ações em Massa */}
      {bulkAction && (
        <BulkActionsDialog
          isOpen={true}
          onClose={() => setBulkAction(null)}
          actionType={bulkAction}
          selectedDealIds={Array.from(selectedIds)}
          stages={stages}
          operators={operators}
          onSuccess={() => {
            setSelectedIds(new Set());
            if (onRefreshData) onRefreshData();
          }}
        />
      )}
    </div>
  );
}
