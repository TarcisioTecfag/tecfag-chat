import React from "react";
import { DealCardData } from "./DealCard";
import {
  Building2,
  User,
  Star,
  MessageSquare,
  ChevronRight,
  CheckCircle2,
  XCircle,
  PauseCircle,
  Calendar,
} from "lucide-react";

interface DealListProps {
  deals: DealCardData[];
  stagesMap: Map<string, string>;
  operatorsMap: Map<string, string>;
  onDealClick: (deal: DealCardData) => void;
  total: number;
  limit: number;
  offset: number;
  onPageChange: (newOffset: number) => void;
}

export function DealList({
  deals,
  stagesMap,
  operatorsMap,
  onDealClick,
  total,
  limit,
  offset,
  onPageChange,
}: DealListProps) {
  const currentPage = Math.floor(offset / limit) + 1;
  const totalPages = Math.ceil(total / limit) || 1;

  return (
    <div className="flex flex-col h-full w-full bg-card rounded-2xl border border-border overflow-hidden">
      {/* Tabela */}
      <div className="flex-1 overflow-x-auto overflow-y-auto">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="border-b border-border bg-muted/30 text-muted-foreground font-semibold">
              <th className="py-3 px-4">Negociação</th>
              <th className="py-3 px-4">Cliente / Empresa</th>
              <th className="py-3 px-4">Etapa</th>
              <th className="py-3 px-4">Status</th>
              <th className="py-3 px-4">Responsável</th>
              <th className="py-3 px-4 text-right">Valor</th>
              <th className="py-3 px-4 text-center">Classificação</th>
              <th className="py-3 px-4 text-center">Conversas</th>
              <th className="py-3 px-4">Última Atividade</th>
              <th className="py-3 px-4 text-center">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {deals.length === 0 ? (
              <tr>
                <td colSpan={10} className="py-16 text-center text-muted-foreground italic">
                  Nenhuma negociação encontrada com os filtros selecionados.
                </td>
              </tr>
            ) : (
              deals.map((deal) => {
                const rawValue = deal.value ? Number(deal.value) : null;
                const formattedValue = rawValue !== null && !isNaN(rawValue)
                  ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(rawValue)
                  : "-";

                const stageName = stagesMap.get(deal.stageId) || "Etapa desconhecida";
                const operatorName = deal.ownerId ? operatorsMap.get(deal.ownerId) || "Não atribuído" : "Sem responsável";

                const statusBadge = {
                  open: { label: "Em andamento", color: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20" },
                  won: { label: "Vendido", color: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20" },
                  lost: { label: "Perdido", color: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20" },
                  paused: { label: "Pausado", color: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20" },
                }[deal.status];

                const dateToDisplay = deal.lastActivityAt || deal.updatedAt || deal.createdAt;
                const formattedDate = new Date(dateToDisplay).toLocaleDateString("pt-BR", {
                  day: "2-digit",
                  month: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                });

                return (
                  <tr
                    key={deal.id}
                    onClick={() => onDealClick(deal)}
                    className="hover:bg-muted/40 transition-colors cursor-pointer group"
                  >
                    {/* Título */}
                    <td className="py-3 px-4 font-bold text-foreground max-w-[200px] truncate group-hover:text-primary transition-colors">
                      {deal.title}
                    </td>

                    {/* Cliente / Empresa */}
                    <td className="py-3 px-4 max-w-[180px]">
                      {deal.account ? (
                        <div className="flex items-center gap-1.5 truncate">
                          {deal.account.isCompany ? (
                            <Building2 className="h-3.5 w-3.5 text-primary/70 shrink-0" />
                          ) : (
                            <User className="h-3.5 w-3.5 text-primary/70 shrink-0" />
                          )}
                          <span className="truncate font-medium text-foreground">
                            {deal.account.name || deal.account.legalName}
                          </span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground/60 italic">Cliente não definido</span>
                      )}
                    </td>

                    {/* Etapa */}
                    <td className="py-3 px-4 text-muted-foreground font-medium">
                      <span className="inline-block rounded-md bg-muted px-2 py-0.5 text-[11px]">
                        {stageName}
                      </span>
                    </td>

                    {/* Status */}
                    <td className="py-3 px-4">
                      <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold border ${statusBadge.color}`}>
                        {statusBadge.label}
                      </span>
                    </td>

                    {/* Responsável */}
                    <td className="py-3 px-4 text-muted-foreground max-w-[120px] truncate">
                      {operatorName}
                    </td>

                    {/* Valor */}
                    <td className="py-3 px-4 text-right font-extrabold text-foreground">
                      {formattedValue}
                    </td>

                    {/* Qualificação */}
                    <td className="py-3 px-4 text-center">
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

                    {/* Conversas */}
                    <td className="py-3 px-4 text-center">
                      {(deal.conversationsCount || 0) > 0 ? (
                        <span className="inline-flex items-center gap-1 rounded bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
                          <MessageSquare className="h-2.5 w-2.5" />
                          {deal.conversationsCount}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/40 text-[11px]">-</span>
                      )}
                    </td>

                    {/* Última Atividade */}
                    <td className="py-3 px-4 text-muted-foreground whitespace-nowrap text-[11px]">
                      {formattedDate}
                    </td>

                    {/* Ações */}
                    <td className="py-3 px-4 text-center">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onDealClick(deal);
                        }}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
                        title="Ver detalhes"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Paginação */}
      {total > limit && (
        <div className="flex items-center justify-between border-t border-border px-4 py-3 bg-muted/20">
          <span className="text-xs text-muted-foreground">
            Exibindo <span className="font-semibold text-foreground">{offset + 1}</span> a{" "}
            <span className="font-semibold text-foreground">{Math.min(offset + limit, total)}</span> de{" "}
            <span className="font-semibold text-foreground">{total}</span> negociações
          </span>

          <div className="flex items-center gap-2">
            <button
              onClick={() => onPageChange(Math.max(0, offset - limit))}
              disabled={offset === 0}
              className="px-3 py-1 text-xs rounded-lg border border-border bg-card text-foreground font-semibold hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
            >
              Anterior
            </button>
            <span className="text-xs font-bold text-muted-foreground px-2">
              Página {currentPage} de {totalPages}
            </span>
            <button
              onClick={() => onPageChange(offset + limit)}
              disabled={offset + limit >= total}
              className="px-3 py-1 text-xs rounded-lg border border-border bg-card text-foreground font-semibold hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
            >
              Próxima
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
