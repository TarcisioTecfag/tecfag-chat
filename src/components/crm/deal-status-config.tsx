import React from "react";
import {
  Activity,
  Clock,
  CheckCircle2,
  XCircle,
  PauseCircle,
  type LucideIcon,
} from "lucide-react";

export type DealStatus = "open" | "won" | "lost" | "paused";
export type CrmStatusFilter = "all" | DealStatus;

export interface DealStatusMeta {
  value: CrmStatusFilter;
  label: string;
  icon: LucideIcon;
  iconColor: string;
  badgeColor: string;
}

/**
 * Mapa centralizado e padronizado de status de negociação em todo o CRM e Chat.
 * Cada status possui seu próprio ícone semântico exclusivo.
 */
export const CRM_STATUS_FILTER_MAP: Record<CrmStatusFilter, DealStatusMeta> = {
  all: {
    value: "all",
    label: "Todos os status",
    icon: Activity,
    iconColor: "text-muted-foreground",
    badgeColor: "text-muted-foreground bg-muted/80 border-border/80",
  },
  open: {
    value: "open",
    label: "Em andamento",
    icon: Clock,
    iconColor: "text-muted-foreground",
    badgeColor: "text-muted-foreground bg-muted/80 border-border/80",
  },
  won: {
    value: "won",
    label: "Vendido",
    icon: CheckCircle2,
    iconColor: "text-emerald-600 dark:text-emerald-400",
    badgeColor:
      "text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
  },
  lost: {
    value: "lost",
    label: "Perdido",
    icon: XCircle,
    iconColor: "text-destructive",
    badgeColor: "text-destructive bg-destructive/10 border-destructive/30",
  },
  paused: {
    value: "paused",
    label: "Pausado",
    icon: PauseCircle,
    iconColor: "text-amber-600 dark:text-amber-400",
    badgeColor:
      "text-amber-700 dark:text-amber-400 bg-amber-500/10 border-amber-500/30",
  },
};

export const DEAL_STATUS_MAP: Record<DealStatus, DealStatusMeta> = {
  open: CRM_STATUS_FILTER_MAP.open,
  won: CRM_STATUS_FILTER_MAP.won,
  lost: CRM_STATUS_FILTER_MAP.lost,
  paused: CRM_STATUS_FILTER_MAP.paused,
};

export const CRM_STATUS_FILTER_OPTIONS: DealStatusMeta[] = [
  CRM_STATUS_FILTER_MAP.all,
  CRM_STATUS_FILTER_MAP.open,
  CRM_STATUS_FILTER_MAP.won,
  CRM_STATUS_FILTER_MAP.lost,
  CRM_STATUS_FILTER_MAP.paused,
];

export const DEAL_STATUS_OPTIONS: DealStatusMeta[] = [
  DEAL_STATUS_MAP.open,
  DEAL_STATUS_MAP.won,
  DEAL_STATUS_MAP.lost,
  DEAL_STATUS_MAP.paused,
];

export function getDealStatusMeta(status?: string | null): DealStatusMeta {
  if (status && status in DEAL_STATUS_MAP) {
    return DEAL_STATUS_MAP[status as DealStatus];
  }
  return DEAL_STATUS_MAP.open;
}

export function getDealStatusFilterMeta(status?: string | null): DealStatusMeta {
  if (status && status in CRM_STATUS_FILTER_MAP) {
    return CRM_STATUS_FILTER_MAP[status as CrmStatusFilter];
  }
  return CRM_STATUS_FILTER_MAP.all;
}

export function DealStatusOptionContent({
  status,
  iconClassName = "h-3.5 w-3.5",
}: {
  status: CrmStatusFilter | string;
  iconClassName?: string;
}) {
  const meta = getDealStatusFilterMeta(status);
  const Icon = meta.icon;
  return (
    <span className="inline-flex items-center gap-2">
      <Icon className={`${iconClassName} shrink-0 ${meta.iconColor}`} />
      <span>{meta.label}</span>
    </span>
  );
}

export function DealStatusBadge({
  status,
  size = "sm",
  className = "",
}: {
  status?: string | null;
  size?: "xs" | "sm" | "md";
  className?: string;
}) {
  const meta = getDealStatusMeta(status);
  const Icon = meta.icon;

  const sizeClasses =
    size === "xs"
      ? "px-1.5 py-0.5 text-[9px] gap-1"
      : size === "md"
        ? "px-2.5 py-0.5 text-[11px] gap-1.5"
        : "px-1.5 py-0.5 text-[10px] gap-1";

  const iconSizeClasses =
    size === "xs" ? "h-2.5 w-2.5" : size === "md" ? "h-3 w-3" : "h-2.5 w-2.5";

  return (
    <span
      className={`inline-flex items-center rounded border font-semibold ${sizeClasses} ${meta.badgeColor} ${className}`}
    >
      <Icon className={`${iconSizeClasses} shrink-0`} />
      <span>{meta.label}</span>
    </span>
  );
}
