import React from "react";
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
} from "lucide-react";

export interface DealCardData {
  id: string;
  title: string;
  pipelineId: string;
  stageId: string;
  status: "open" | "won" | "lost" | "paused";
  value: string | number | null;
  currency?: string;
  rating?: number | null;
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
    legalName?: string | null;
    cnpj?: string | null;
    cpf?: string | null;
    isCompany?: boolean;
    city?: string | null;
    state?: string | null;
  } | null;
  conversationsCount?: number;
  contactsCount?: number;
  nextTask?: {
    title: string;
    dueDate?: string | Date | null;
  } | null;
}

interface DealCardProps {
  deal: DealCardData;
  coolingDays?: number;
  operatorName?: string;
  onClick: (deal: DealCardData) => void;
  onQuickMove?: (dealId: string, newStageId: string, currentVersion: number) => void;
  allStages?: Array<{ id: string; name: string }>;
}

export function DealCard({
  deal,
  coolingDays = 10,
  operatorName,
  onClick,
  onQuickMove,
  allStages = [],
}: DealCardProps) {
  // Cálculo de estagnação ("Esfriando há X dias")
  const lastActiveDate = deal.lastActivityAt
    ? new Date(deal.lastActivityAt)
    : new Date(deal.updatedAt || deal.createdAt);
  const now = new Date();
  const diffDays = Math.max(0, Math.floor((now.getTime() - lastActiveDate.getTime()) / (1000 * 60 * 60 * 24)));
  const isCooling = deal.status === "open" && diffDays >= coolingDays;

  // Formatação de valor
  const rawValue = deal.value ? Number(deal.value) : null;
  const formattedValue = rawValue !== null && !isNaN(rawValue)
    ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(rawValue)
    : null;

  // Status visual
  const statusBadge = {
    open: null,
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
        <div className="mb-2 flex items-center gap-1.5 rounded-md bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-300">
          <AlertTriangle className="h-3 w-3 shrink-0 text-amber-600 dark:text-amber-400 animate-pulse" />
          <span>Esfriando há {diffDays} {diffDays === 1 ? "dia" : "dias"}</span>
        </div>
      )}

      {/* Topo do Card: Título + Badge de Status */}
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-xs font-bold text-foreground leading-snug line-clamp-2 group-hover:text-primary transition-colors">
          {deal.title}
        </h4>
        {statusBadge && (
          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold border shrink-0 ${statusBadge.color}`}>
            <statusBadge.icon className="h-2.5 w-2.5" />
            {statusBadge.label}
          </span>
        )}
      </div>

      {/* Identificação do Cliente / Empresa */}
      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {deal.account ? (
          <>
            {deal.account.isCompany ? (
              <Building2 className="h-3 w-3 text-primary/70 shrink-0" />
            ) : (
              <User className="h-3 w-3 text-primary/70 shrink-0" />
            )}
            <span className="truncate font-medium text-foreground/80">
              {deal.account.name || deal.account.legalName}
            </span>
          </>
        ) : (
          <span className="text-[10px] italic text-muted-foreground/60">
            Cliente não definido
          </span>
        )}
      </div>

      {/* Qualificação Comercial (Estrelas) */}
      <div className="mt-2 flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map((star) => {
          const filled = (deal.rating || 0) >= star;
          return (
            <Star
              key={star}
              className={`h-2.5 w-2.5 ${
                filled
                  ? "fill-amber-400 text-amber-400"
                  : "text-muted-foreground/25"
              }`}
            />
          );
        })}
      </div>

      {/* Linha Divisória Sutil */}
      <div className="my-2.5 h-px bg-border/50" />

      {/* Rodapé do Card: Valor Comercial + Vendedor + Contador de Conversas */}
      <div className="flex items-center justify-between gap-1 text-[11px]">
        {/* Valor Comercial */}
        <div>
          {formattedValue ? (
            <span className="font-extrabold text-foreground tracking-tight text-xs">
              {formattedValue}
            </span>
          ) : (
            <span className="text-[10px] font-medium text-muted-foreground/60 hover:text-primary transition-colors">
              Sem valor
            </span>
          )}
        </div>

        {/* Informações da Direita: Conversas + Vendedor */}
        <div className="flex items-center gap-2">
          {/* Contador de conversas */}
          {(deal.conversationsCount || 0) > 0 && (
            <span
              title={`${deal.conversationsCount} conversas vinculadas`}
              className="inline-flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary"
            >
              <MessageSquare className="h-2.5 w-2.5" />
              {deal.conversationsCount}
            </span>
          )}

          {/* Vendedor / Responsável */}
          {operatorName ? (
            <span
              title={`Responsável: ${operatorName}`}
              className="inline-flex h-5 max-w-[70px] truncate items-center rounded-full bg-muted px-2 text-[9px] font-semibold text-muted-foreground"
            >
              {operatorName}
            </span>
          ) : (
            <span className="text-[9px] text-muted-foreground/50">
              Sem resp.
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
