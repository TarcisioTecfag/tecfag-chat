import React, { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useChat } from "@/hooks/useChatState";
import {
  Building2,
  User,
  Star,
  MessageSquare,
  MessageCircle,
  Clock,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  PauseCircle,
  MoreVertical,
  Pencil,
  ListTodo,
  ArrowRight,
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
  primaryConversationId?: string | null;
  primaryContactId?: string | null;
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

export interface DealCardProps {
  deal: DealCardData;
  coolingDays?: number;
  coolingEnabled?: boolean;
  operatorName?: string;
  onClick?: (deal: DealCardData) => void;
  onQuickMove?: (dealId: string, newStageId: string, currentVersion: number) => void;
  onTaskCompleted?: (dealId: string, activityId: string) => void;
  onCreateTaskClick?: (deal: DealCardData) => void;
  allStages?: Array<{ id: string; name: string }>;
  isDragging?: boolean;
  isOverlay?: boolean;
  onStartDrag?: (e: React.PointerEvent<HTMLDivElement>, deal: DealCardData) => void;
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
  isDragging = false,
  isOverlay = false,
  onStartDrag,
}: DealCardProps) {
  const navigate = useNavigate();
  const [completingTask, setCompletingTask] = useState(false);
  const [showQuickMenu, setShowQuickMenu] = useState(false);

  // Cálculo de estagnação ("Esfriando há X dias")
  const lastActiveDate = deal.lastActivityAt
    ? new Date(deal.lastActivityAt)
    : new Date(deal.updatedAt || deal.createdAt);
  const now = new Date();
  const diffDays = Math.max(0, Math.floor((now.getTime() - lastActiveDate.getTime()) / (1000 * 60 * 60 * 24)));
  const isCooling = coolingEnabled && deal.status === "open" && diffDays >= coolingDays;

  // Formatação de valor
  const isNullValue = deal.value === null || deal.value === undefined;
  const rawValue = !isNullValue ? Number(deal.value) : null;
  const formattedValue = rawValue !== null && !isNaN(rawValue)
    ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(rawValue)
    : null;

  // Status visual harmonizado com a paleta do sistema (neutro no "Em andamento", sem azul destoante)
  const statusBadge = {
    open: {
      label: "Em andamento",
      color: "text-muted-foreground bg-muted/80 border-border/80",
      icon: Clock,
    },
    won: {
      label: "Vendido",
      color: "text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
      icon: CheckCircle2,
    },
    lost: {
      label: "Perdido",
      color: "text-destructive bg-destructive/10 border-destructive/30",
      icon: XCircle,
    },
    paused: {
      label: "Pausado",
      color: "text-amber-700 dark:text-amber-400 bg-amber-500/10 border-amber-500/30",
      icon: PauseCircle,
    },
  }[deal.status];

  // Pointer Down para Drag customizado fluido sem delay
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isOverlay || isDragging) return;
    if (e.button !== 0) return; // apenas clique esquerdo
    const target = e.target as HTMLElement;
    // Não iniciar drag se clicou em botões, links ou menus internos
    if (target.closest('button, a, input, select, textarea, [role="button"], [data-no-drag]')) {
      return;
    }
    if (onStartDrag) {
      onStartDrag(e, deal);
    }
  };

  const handleCardClick = () => {
    if (isOverlay || isDragging) return;
    if (!onStartDrag && onClick) {
      onClick(deal);
    }
  };

  // Helper de Tooltip condicional: desativa no Overlay para evitar glitches de popover ao arrastar
  const CardTooltip = ({ content, children }: { content: React.ReactNode; children: React.ReactElement }) => {
    if (isOverlay || !content) return children;
    return <SystemTooltip content={content}>{children}</SystemTooltip>;
  };

  // Concluir tarefa rapidamente
  const handleCompleteTask = async (e: React.MouseEvent) => {
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
  };

  // Ação de abrir no Mini Chat
  const handleOpenMiniChat = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (deal.primaryConversationId) {
      window.dispatchEvent(
        new CustomEvent("crm:open-mini-chat", {
          detail: { conversationId: deal.primaryConversationId },
        })
      );
      return;
    }
    if (deal.primaryContactId) {
      fetch(`/api/contacts/${deal.primaryContactId}/conversations`, { method: "POST" })
        .then((res) => res.json())
        .then((data) => {
          if (data.conversationId) {
            window.dispatchEvent(
              new CustomEvent("crm:open-mini-chat", {
                detail: { conversationId: data.conversationId },
              })
            );
          } else {
            window.dispatchEvent(new CustomEvent("crm:open-mini-chat", { detail: {} }));
          }
        })
        .catch(() => {
          window.dispatchEvent(new CustomEvent("crm:open-mini-chat", { detail: {} }));
        });
      return;
    }
    if (deal.account?.phone) {
      window.dispatchEvent(
        new CustomEvent("crm:open-mini-chat", {
          detail: { phone: deal.account.phone, name: deal.account.name },
        })
      );
      return;
    }
    window.dispatchEvent(new CustomEvent("crm:open-mini-chat", { detail: {} }));
  };

  const { setActiveView, setSelectedChatId } = useChat();

  // Ação de abrir conversa completa no Chat
  const handleOpenFullChat = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (deal.primaryConversationId) {
      setSelectedChatId(deal.primaryConversationId);
      setActiveView("chat");
      if (window.location.pathname !== "/") navigate({ to: "/" });
      return;
    }
    if (deal.primaryContactId) {
      fetch(`/api/contacts/${deal.primaryContactId}/conversations`, { method: "POST" })
        .then((res) => res.json())
        .then((data) => {
          if (data.conversationId) {
            setSelectedChatId(data.conversationId);
          }
          setActiveView("chat");
          if (window.location.pathname !== "/") navigate({ to: "/" });
        })
        .catch(() => {
          setActiveView("chat");
          if (window.location.pathname !== "/") navigate({ to: "/" });
        });
      return;
    }
    setActiveView("chat");
    if (window.location.pathname !== "/") navigate({ to: "/" });
  };

  return (
    <div
      data-deal-card={deal.id}
      data-stage-id={deal.stageId}
      onPointerDown={handlePointerDown}
      onClick={handleCardClick}
      className={`group relative flex flex-col justify-between h-[196px] min-h-[196px] max-h-[196px] rounded-xl border p-3 select-none overflow-hidden transition-all duration-150 ${
        isOverlay
          ? "border-primary bg-card/95 shadow-2xl ring-2 ring-primary/80 cursor-grabbing pointer-events-none"
          : isDragging
          ? "opacity-25 border-dashed border-2 border-primary/50 bg-primary/[0.04] scale-[0.98] pointer-events-none"
          : isCooling
          ? "border-amber-400/70 dark:border-amber-500/50 bg-amber-500/[0.04] shadow-xs cursor-grab active:cursor-grabbing hover:shadow-md hover:-translate-y-0.5 hover:border-primary/50"
          : deal.status === "won"
          ? "border-emerald-500/40 bg-emerald-500/[0.02] shadow-xs cursor-grab active:cursor-grabbing hover:shadow-md hover:-translate-y-0.5 hover:border-primary/50"
          : deal.status === "lost"
          ? "border-destructive/30 bg-destructive/[0.02] shadow-xs cursor-grab active:cursor-grabbing hover:shadow-md hover:-translate-y-0.5 hover:border-primary/50"
          : "border-border/80 bg-card shadow-xs cursor-grab active:cursor-grabbing hover:shadow-md hover:-translate-y-0.5 hover:border-primary/50"
      }`}
    >
      {/* ── 1. TOPO: Título (altura fixa 36px) + Chip de Esfriamento + Menu ── */}
      <div className="flex items-start justify-between gap-1.5 min-h-[36px] max-h-[36px]">
        <CardTooltip content={deal.title}>
          <h4 className="min-w-0 flex-1 break-words text-xs font-bold text-foreground leading-snug line-clamp-2 group-hover:text-primary transition-colors cursor-pointer">
            {deal.title}
          </h4>
        </CardTooltip>

        <div className="flex items-center gap-1 shrink-0">
          {/* Chip compacto de Esfriamento: mesmo tamanho de card sem distorcer altura */}
          {isCooling && (
            <CardTooltip content={`Esfriando há ${diffDays} ${diffDays === 1 ? "dia" : "dias"} sem atividade recente`}>
              <span className="inline-flex items-center gap-1 rounded bg-amber-500/15 border border-amber-500/35 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-300 shrink-0">
                <AlertTriangle className="h-2.5 w-2.5 text-amber-600 dark:text-amber-400 shrink-0 animate-pulse" />
                <span>{diffDays}d</span>
              </span>
            </CardTooltip>
          )}

          {/* Menu Rápido de Ações */}
          <div className="relative">
            <CardTooltip content="Ações rápidas">
              <button
                type="button"
                aria-label={`Ações da negociação ${deal.title}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setShowQuickMenu(!showQuickMenu);
                }}
                className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <MoreVertical className="h-3.5 w-3.5" />
              </button>
            </CardTooltip>

            {showQuickMenu && (
              <div
                onClick={(e) => e.stopPropagation()}
                className="absolute right-0 top-6 z-30 w-44 rounded-xl border border-border bg-popover p-1.5 shadow-xl text-[11px] font-medium text-popover-foreground animate-in fade-in zoom-in-95"
              >
                <button
                  type="button"
                  onClick={() => {
                    setShowQuickMenu(false);
                    onClick?.(deal);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-accent hover:text-accent-foreground cursor-pointer transition-colors"
                >
                  <Pencil className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span>Editar Negociação</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setShowQuickMenu(false);
                    onCreateTaskClick ? onCreateTaskClick(deal) : onClick?.(deal);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-accent hover:text-accent-foreground cursor-pointer transition-colors"
                >
                  <ListTodo className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
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
                          <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
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

      {/* ── 2. CLIENTE / EMPRESA (altura fixa 16px) ── */}
      <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground h-4 min-w-0 overflow-hidden">
        {deal.account ? (
          <>
            {deal.account.type === "company" ? (
              <Building2 className="h-3 w-3 text-primary/70 shrink-0" />
            ) : (
              <User className="h-3 w-3 text-primary/70 shrink-0" />
            )}
            <CardTooltip content={deal.account.name || deal.account.tradeName}>
              <span className="truncate font-medium text-foreground/80 cursor-default">
                {deal.account.name || deal.account.tradeName}
              </span>
            </CardTooltip>
          </>
        ) : (
          <span className="text-[11px] text-muted-foreground/60 italic truncate">
            Cliente não definido
          </span>
        )}
      </div>

      {/* ── 3. VALOR COMERCIAL + VENDEDOR / CONVERSAS (altura fixa 20px) ── */}
      <div className="mt-1.5 flex items-center justify-between gap-2 text-xs h-5">
        <div className="min-w-0 shrink-0">
          {formattedValue !== null ? (
            <span className="font-bold text-foreground tabular-nums text-xs">
              {formattedValue}
            </span>
          ) : (
            <CardTooltip content="Clique para adicionar valor">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onClick?.(deal);
                }}
                className="text-[11px] font-medium text-primary hover:underline transition-colors cursor-pointer"
              >
                + Adicionar valor
              </button>
            </CardTooltip>
          )}
        </div>

        <div className="flex items-center gap-1.5 min-w-0 justify-end">
          {(deal.conversationsCount || 0) > 0 && (
            <CardTooltip content={`${deal.conversationsCount} conversa(s) vinculada(s)`}>
              <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-primary/10 px-1 py-0.5 text-[10px] font-bold text-primary">
                <MessageSquare className="h-2.5 w-2.5" />
                {deal.conversationsCount}
              </span>
            </CardTooltip>
          )}

          {operatorName ? (
            <CardTooltip content={`Responsável: ${operatorName}`}>
              <span className="flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
                <User className="h-3 w-3 shrink-0" />
                <span className="truncate max-w-[120px]">{operatorName}</span>
              </span>
            </CardTooltip>
          ) : (
            <span className="text-[11px] text-muted-foreground/60 truncate">
              Sem responsável
            </span>
          )}
        </div>
      </div>

      {/* ── 4. PRÓXIMA TAREFA / AÇÕES RÁPIDAS (Ícones discretos substituindo + Tarefa) ── */}
      <div className="mt-1.5 pt-1.5 border-t border-border/50">
        <div className="flex items-center justify-between gap-2 h-7 px-2 rounded-lg border bg-muted/40 border-border/50 text-xs">
          {deal.nextTask ? (
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              <Clock
                className={`h-3 w-3 shrink-0 ${
                  deal.nextTask.isOverdue
                    ? "text-red-600 dark:text-red-400"
                    : deal.nextTask.isToday
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-muted-foreground"
                }`}
              />
              <CardTooltip content={deal.nextTask.title}>
                <span className="truncate text-foreground/80 cursor-default text-[11px]">
                  {deal.nextTask.isOverdue && (
                    <strong className="text-red-600 dark:text-red-400 mr-1 font-bold">
                      Atrasada:
                    </strong>
                  )}
                  {deal.nextTask.isToday && (
                    <strong className="text-amber-600 dark:text-amber-400 mr-1 font-bold">
                      Hoje:
                    </strong>
                  )}
                  {deal.nextTask.title}
                </span>
              </CardTooltip>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 min-w-0 flex-1 text-[11px] text-muted-foreground">
              {isCooling ? (
                <span className="truncate text-amber-700 dark:text-amber-400 font-medium">
                  Sem tarefas recentes
                </span>
              ) : (
                <span className="truncate">Sem tarefas pendentes</span>
              )}
            </div>
          )}

          {/* Ícones de ação à direita: Checkmark de tarefa + Mini Chat + Chat Completo */}
          <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
            {deal.nextTask?.id && (
              <CardTooltip content="Concluir tarefa rapidamente">
                <button
                  type="button"
                  aria-label={`Concluir tarefa: ${deal.nextTask.title}`}
                  onClick={handleCompleteTask}
                  disabled={completingTask}
                  className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-emerald-500 hover:bg-muted transition-colors cursor-pointer disabled:opacity-50"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                </button>
              </CardTooltip>
            )}

            {/* Abrir no Mini Chat */}
            <CardTooltip content="Abrir no Mini Chat">
              <button
                type="button"
                aria-label="Abrir no Mini Chat"
                onClick={handleOpenMiniChat}
                className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-primary transition-colors cursor-pointer"
              >
                <MessageCircle className="h-3.5 w-3.5" />
              </button>
            </CardTooltip>

            {/* Abrir conversa no Chat */}
            <CardTooltip content="Abrir conversa no Chat">
              <button
                type="button"
                aria-label="Abrir conversa no Chat"
                onClick={handleOpenFullChat}
                className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-primary transition-colors cursor-pointer"
              >
                <MessageSquare className="h-3.5 w-3.5" />
              </button>
            </CardTooltip>
          </div>
        </div>
      </div>

      {/* ── 5. RODAPÉ: Status (Sem azul) + Estrelas Vermelhas (Paleta do Sistema) ── */}
      <div className="mt-1.5 flex items-center justify-between gap-2 h-5">
        {statusBadge && (
          <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium ${statusBadge.color}`}>
            <statusBadge.icon className="h-2.5 w-2.5" />
            {statusBadge.label}
          </span>
        )}

        {/* Estrelas vermelhas na cor primária do sistema */}
        <div aria-label={`Qualificação: ${deal.rating || 0} de 5`} className="flex items-center gap-0.5">
          {[1, 2, 3, 4, 5].map((star) => (
            <Star
              key={star}
              aria-hidden="true"
              className={`h-3 w-3 ${
                (deal.rating || 0) >= star
                  ? "fill-primary text-primary"
                  : "text-muted-foreground/25"
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
