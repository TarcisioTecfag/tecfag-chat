import React, { useState } from "react";
import {
  Building2,
  User,
  Star,
  MessageSquare,
  Clock,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  PauseCircle,
  MoreVertical,
  Plus,
} from "lucide-react";
import { toast } from "sonner";
import { SystemTooltip } from "@/components/ui/tooltip";

export interface DealCardData {
  id: string;
  title: string;
  pipelineId: string;
  stageId: string;
  status: "open" | "won" | "lost" | "paused";
  value: string | number | null;
  currency?: string;
  rating?: number | null;
  operatorId?: string | null;
  ownerId?: string | null;
  accountId?: string | null;
  version: number;
  coolingAlertDays?: number | null;
  lastActivityAt?: string | Date | null;
  createdAt: string | Date;
  updatedAt: string | Date;
  account?: {
    id: string;
    name: string;
    tradeName?: string | null;
    type?: "person" | "company";
    document?: string | null;
    documentType?: string | null;
    email?: string | null;
    phone?: string | null;
    city?: string | null;
    state?: string | null;
  } | null;
  conversationsCount?: number;
  contactsCount?: number;
  nextTask?: {
    id?: string;
    title: string;
    type?: string;
    dueDate?: string | Date | null;
    isOverdue?: boolean;
    isToday?: boolean;
    isFuture?: boolean;
    hasNoDueDate?: boolean;
    responsibleName?: string | null;
  } | null;
}

interface DealCardProps {
  deal: DealCardData;
  coolingDays?: number;
  coolingEnabled?: boolean;
  operatorName?: string;
  onClick: (deal: DealCardData) => void;
  onQuickMove?: (dealId: string, newStageId: string, currentVersion: number) => void;
  onTaskCompleted?: (dealId: string, activityId: string) => void;
  onCreateTaskClick?: (deal: DealCardData) => void;
  allStages?: Array<{ id: string; name: string }>;
}

export function DealCard({
  deal,
  coolingDays = 10,
  coolingEnabled = true,
  operatorName,
  onClick,
  onQuickMove,
  onTaskCompleted,
  onCreateTaskClick,
  allStages = [],
}: DealCardProps) {
  const [completingTask, setCompletingTask] = useState(false);
  const [showQuickMenu, setShowQuickMenu] = useState(false);

  // Cálculo de estagnação ("Esfriando há X dias")
  const lastActiveDate = deal.lastActivityAt
    ? new Date(deal.lastActivityAt)
    : new Date(deal.updatedAt || deal.createdAt);
  const now = new Date();
  const diffDays = Math.max(0, Math.floor((now.getTime() - lastActiveDate.getTime()) / (1000 * 60 * 60 * 24)));
  const isCooling = coolingEnabled && deal.status === "open" && diffDays >= coolingDays;

  // Formatação de valor: distinção estrita entre null (não informado) e zero (R$ 0,00)
  const isNullValue = deal.value === null || deal.value === undefined;
  const rawValue = !isNullValue ? Number(deal.value) : null;
  const formattedValue = rawValue !== null && !isNaN(rawValue)
    ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(rawValue)
    : null;

  // Status visual com estado "Em andamento" visível
  const statusBadge = {
    open: { label: "Em andamento", color: "text-blue-700 dark:text-blue-400 bg-blue-500/10 border-blue-500/30", icon: Clock },
    won: { label: "Vendido", color: "text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/30", icon: CheckCircle2 },
    lost: { label: "Perdido", color: "text-red-700 dark:text-red-400 bg-red-500/10 border-red-500/30", icon: XCircle },
    paused: { label: "Pausado", color: "text-amber-700 dark:text-amber-400 bg-amber-500/10 border-amber-500/30", icon: PauseCircle },
  }[deal.status];

  // Drag start
  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData("text/plain", JSON.stringify({ dealId: deal.id, version: deal.version, fromStageId: deal.stageId }));
    e.dataTransfer.effectAllowed = "move";
  };

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onClick={() => onClick(deal)}
      className={`group relative rounded-xl border p-3.5 shadow-sm transition-all cursor-grab active:cursor-grabbing bg-card hover:shadow-md hover:-translate-y-0.5 ${
        isCooling
          ? "border-amber-400/60 dark:border-amber-500/40 bg-amber-500/[0.03]"
          : deal.status === "won"
          ? "border-emerald-500/40 bg-emerald-500/[0.02]"
          : deal.status === "lost"
          ? "border-red-500/30 bg-red-500/[0.02]"
          : "border-border hover:border-primary/50"
      }`}
    >
      {/* Alerta de Esfriamento */}
      {isCooling && (
        <div className="mb-2 flex items-center gap-1.5 rounded-md bg-amber-500/15 px-2 py-1 text-xs font-medium text-amber-700 dark:text-amber-300">
          <AlertTriangle className="h-3 w-3 shrink-0 text-amber-600 dark:text-amber-400 animate-pulse" />
          <span>Esfriando há {diffDays} {diffDays === 1 ? "dia" : "dias"}</span>
        </div>
      )}

      {/* Título com espaço próprio; status aparece nos metadados abaixo. */}
      <div className="flex items-start justify-between gap-2">
        <h4 title={deal.title} className="min-w-0 flex-1 break-words text-sm font-semibold text-foreground leading-snug line-clamp-2 group-hover:text-primary transition-colors">
          {deal.title}
        </h4>
        <div className="flex items-center gap-1 shrink-0">

          {/* Menu Rápido de Ações */}
          <div className="relative">
            <SystemTooltip content="Ações rápidas">
              <button
                type="button"
                aria-label={`Ações da negociação ${deal.title}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setShowQuickMenu(!showQuickMenu);
                }}
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <MoreVertical className="h-3.5 w-3.5" />
              </button>
            </SystemTooltip>

            {showQuickMenu && (
              <div
                onClick={(e) => e.stopPropagation()}
                className="absolute right-0 top-6 z-30 w-44 rounded-xl border border-border bg-popover p-1.5 shadow-xl text-[11px] font-medium text-popover-foreground animate-in fade-in zoom-in-95"
              >
                <button
                  type="button"
                  onClick={() => {
                    setShowQuickMenu(false);
                    onClick(deal);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-accent hover:text-accent-foreground cursor-pointer transition-colors"
                >
                  <span>✏️</span>
                  <span>Editar Negociação</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setShowQuickMenu(false);
                    onCreateTaskClick ? onCreateTaskClick(deal) : onClick(deal);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-accent hover:text-accent-foreground cursor-pointer transition-colors"
                >
                  <span>📋</span>
                  <span>Criar Tarefa</span>
                </button>

                {allStages.length > 1 && onQuickMove && (
                  <div className="border-t border-border/60 my-1 pt-1">
                    <p className="px-2 py-0.5 text-[9px] font-bold text-muted-foreground uppercase">
                      Mover para etapa:
                    </p>
                    {allStages
                      .filter((s) => s.id !== deal.stageId)
                      .slice(0, 4)
                      .map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => {
                            setShowQuickMenu(false);
                            onQuickMove(deal.id, s.id, deal.version);
                          }}
                          className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1 text-left text-[10px] hover:bg-accent truncate cursor-pointer transition-colors"
                        >
                          <span>➡️</span>
                          <span className="truncate">{s.name}</span>
                        </button>
                      ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Identificação do Cliente / Empresa */}
      <div className="mt-1.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
        {deal.account ? (
          <>
            {deal.account.type === "company" ? (
              <Building2 className="h-3 w-3 text-primary/70 shrink-0" />
            ) : (
              <User className="h-3 w-3 text-primary/70 shrink-0" />
            )}
            <span title={deal.account.name || deal.account.tradeName || undefined} className="truncate font-medium text-foreground/80">
              {deal.account.name || deal.account.tradeName}
            </span>
          </>
        ) : (
          <span className="text-xs text-muted-foreground">
            Cliente não definido
          </span>
        )}
      </div>

      {/* Rodapé do Card: Valor Comercial + Vendedor + Contador de Conversas */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 text-xs">
        {/* Valor Comercial ou "Adicionar valor" */}
        <div>
          {formattedValue !== null ? (
            <span className="font-semibold text-foreground tabular-nums text-sm">
              {formattedValue}
            </span>
          ) : (
            <SystemTooltip content="Clique para adicionar valor">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onClick(deal);
                }}
                className="text-xs font-medium text-primary hover:underline transition-colors cursor-pointer"
              >
                + Adicionar valor
              </button>
            </SystemTooltip>
          )}
        </div>

        {/* Informações da Direita: Conversas + Vendedor */}
        <div className="flex w-full min-w-0 items-center justify-between gap-2">
          {/* Contador de conversas clicável */}
          {(deal.conversationsCount || 0) > 0 && (
            <SystemTooltip content={`${deal.conversationsCount} conversas vinculadas (clique para abrir ficha)`}>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onClick(deal);
                }}
                className="inline-flex shrink-0 items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary hover:bg-primary/20 transition-colors cursor-pointer"
              >
                <MessageSquare className="h-2.5 w-2.5" />
                {deal.conversationsCount}
              </button>
            </SystemTooltip>
          )}

          {/* Vendedor / Responsável */}
          {operatorName ? (
            <SystemTooltip content={`Responsável: ${operatorName}`}>
              <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                <User className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{operatorName}</span>
              </span>
            </SystemTooltip>
          ) : (
            <span className="text-xs text-muted-foreground">
              Sem responsável
            </span>
          )}
        </div>
      </div>

      {/* ── FAIXA DA PRÓXIMA AÇÃO COMERCIAL (Estilo RD Station) ── */}
      <div className="mt-2.5 pt-2 border-t border-border/50">
        {deal.nextTask ? (
          <div
            className={`flex items-center justify-between gap-2 rounded-lg px-2 py-2 text-xs font-medium border transition-colors ${
              deal.nextTask.isOverdue
                ? "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/25"
                : deal.nextTask.isToday
                ? "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/25"
                : "bg-muted/50 text-foreground/80 border-border/60"
            }`}
          >
            <div className="flex items-center gap-1.5 min-w-0">
              <Clock
                className={`h-3 w-3 shrink-0 ${
                  deal.nextTask.isOverdue
                    ? "text-red-600 dark:text-red-400"
                    : deal.nextTask.isToday
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-muted-foreground"
                }`}
              />
              <span title={deal.nextTask.title} className="line-clamp-2 break-words">
                {deal.nextTask.isOverdue && (
                  <strong className="font-extrabold mr-1 text-red-600 dark:text-red-400">
                    Atrasada:
                  </strong>
                )}
                {deal.nextTask.isToday && (
                  <strong className="font-extrabold mr-1 text-amber-600 dark:text-amber-400">
                    Hoje:
                  </strong>
                )}
                {deal.nextTask.title}
                {deal.nextTask.dueDate && (
                  <span className="opacity-70 ml-1">
                    ({new Date(deal.nextTask.dueDate).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })})
                  </span>
                )}
              </span>
            </div>

            {deal.nextTask.id && (
                <SystemTooltip content="Concluir tarefa rapidamente">
                  <button
                    type="button"
                    aria-label={`Concluir tarefa: ${deal.nextTask.title}`}
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (!deal.nextTask?.id || completingTask) return;
                      setCompletingTask(true);
                      try {
                        const res = await fetch(`/api/crm/deals/${deal.id}/activities/${deal.nextTask.id}`, {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ status: "completed" }),
                        });
                        if (!res.ok) {
                          const err = await res.json();
                          throw new Error(err.error || "Erro ao concluir tarefa.");
                        }
                        toast.success("Tarefa concluída!");
                        onTaskCompleted?.(deal.id, deal.nextTask.id);
                      } catch (err: any) {
                        toast.error(err.message || "Erro ao concluir tarefa.");
                      } finally {
                        setCompletingTask(false);
                      }
                    }}
                    disabled={completingTask}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded hover:bg-black/10 dark:hover:bg-white/10 text-primary transition cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5 hover:scale-110 transition-transform" />
                  </button>
                </SystemTooltip>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground py-1">
            <span>Sem tarefas pendentes</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onCreateTaskClick ? onCreateTaskClick(deal) : onClick(deal);
              }}
              className="shrink-0 text-xs font-medium text-primary hover:underline cursor-pointer"
            >
              + Tarefa
            </button>
          </div>
        )}
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        {statusBadge && <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium ${statusBadge.color}`}>
          <statusBadge.icon className="h-3 w-3" />{statusBadge.label}
        </span>}
        <div aria-label={`Qualificação: ${deal.rating || 0} de 5`} className="flex items-center gap-0.5">
          {[1, 2, 3, 4, 5].map((star) => <Star key={star} aria-hidden="true" className={`h-3 w-3 ${(deal.rating || 0) >= star ? "fill-amber-400 text-amber-400" : "text-muted-foreground/25"}`} />)}
        </div>
      </div>
    </div>
  );
}
