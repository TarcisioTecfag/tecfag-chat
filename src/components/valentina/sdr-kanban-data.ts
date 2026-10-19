// ══════════════════════════════════════════════════════════════════════════════
// 📋 SDR KANBAN DATA & TYPES — Organização do Funil de Triagem Fagner / Valentina
// ══════════════════════════════════════════════════════════════════════════════

import React from "react";
import {
  Target,
  Wrench,
  Package,
  Settings,
  Sparkles,
  CircleDollarSign,
  Component,
  Layers,
  MessageSquareOff,
} from "lucide-react";
import { SdrTriageSession } from "./SdrTab";

export type KanbanColumnKey =
  | "triagem"
  | "assistencia_tecnica"
  | "pos_venda"
  | "maquinas"
  | "personalite"
  | "financeiro"
  | "pecas"
  | "outros"
  | "sem_resposta";

export interface KanbanColumnDef {
  key: KanbanColumnKey;
  label: string;
  icon: React.ElementType;
  headerBorder: string;
  headerBg: string;
  badgeBg: string;
  badgeText: string;
  accentColor: string;
  emptyText: string;
}

export interface OffscreenColumnMetric {
  key: KanbanColumnKey;
  label: string;
  accentColor: string;
  count: number;
  visibleLeft: number;
  visibleRight: number;
}

export interface OffscreenIndicatorInfo {
  targetColumnKey: KanbanColumnKey;
  targetColumnLabel: string;
  accentColor: string;
  targetCount: number;
  totalHiddenCount: number;
  hiddenColumnsWithCards: Array<{ key: KanbanColumnKey; label: string; count: number }>;
}

export function computeOffscreenKanbanIndicators(
  containerWidth: number,
  columns: OffscreenColumnMetric[],
  thresholdPx: number = 12
): {
  left: OffscreenIndicatorInfo | null;
  right: OffscreenIndicatorInfo | null;
} {
  if (containerWidth <= 0 || columns.length === 0) {
    return { left: null, right: null };
  }

  const hiddenLeft = columns.filter(
    (col) => col.visibleLeft < -thresholdPx && col.count > 0
  );
  const hiddenRight = columns.filter(
    (col) => col.visibleRight > containerWidth + thresholdPx && col.count > 0
  );

  const leftTarget = hiddenLeft.length > 0 ? hiddenLeft[0] : null;
  const rightTarget = hiddenRight.length > 0 ? hiddenRight[0] : null;

  return {
    left: leftTarget
      ? {
          targetColumnKey: leftTarget.key,
          targetColumnLabel: leftTarget.label,
          accentColor: leftTarget.accentColor,
          targetCount: leftTarget.count,
          totalHiddenCount: hiddenLeft.reduce((sum, c) => sum + c.count, 0),
          hiddenColumnsWithCards: hiddenLeft.map((c) => ({
            key: c.key,
            label: c.label,
            count: c.count,
          })),
        }
      : null,
    right: rightTarget
      ? {
          targetColumnKey: rightTarget.key,
          targetColumnLabel: rightTarget.label,
          accentColor: rightTarget.accentColor,
          targetCount: rightTarget.count,
          totalHiddenCount: hiddenRight.reduce((sum, c) => sum + c.count, 0),
          hiddenColumnsWithCards: hiddenRight.map((c) => ({
            key: c.key,
            label: c.label,
            count: c.count,
          })),
        }
      : null,
  };
}

export function getColumnScrollTarget(params: {
  direction: "left" | "right";
  currentScrollLeft: number;
  containerWidth: number;
  columnVisibleLeft: number;
  columnVisibleRight: number;
  paddingPx?: number;
}): number {
  const {
    direction,
    currentScrollLeft,
    containerWidth,
    columnVisibleLeft,
    columnVisibleRight,
    paddingPx = 4,
  } = params;

  if (direction === "right") {
    const deltaRight = columnVisibleRight - containerWidth + paddingPx;
    return Math.max(0, currentScrollLeft + deltaRight);
  }

  return Math.max(0, currentScrollLeft + columnVisibleLeft - paddingPx);
}

export interface SdrFilterState {
  searchQuery: string;
  unreadOnly: boolean;
  showCompleted: boolean;
  statusFilter: "all" | "analisando" | "concluida";
  selectedDate: Date | null;
}

export const DEFAULT_SDR_FILTER_STATE: SdrFilterState = {
  searchQuery: "",
  unreadOnly: false,
  showCompleted: true,
  statusFilter: "all",
  selectedDate: null,
};

export const NEUTRAL_STAGE_STYLE = {
  headerBorder: "border-slate-300 dark:border-slate-700",
  headerBg: "bg-slate-100/80 dark:bg-slate-800/60",
  badgeBg: "bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200",
  badgeText: "text-slate-800 dark:text-slate-200",
  accentColor: "#64748b",
} as const;

export const KANBAN_COLUMNS: KanbanColumnDef[] = [
  {
    key: "triagem",
    label: "TRIAGEM",
    icon: Target,
    ...NEUTRAL_STAGE_STYLE,
    emptyText: "A IA moverá clientes automaticamente",
  },
  {
    key: "assistencia_tecnica",
    label: "ASSISTÊNCIA TÉCNICA",
    icon: Wrench,
    ...NEUTRAL_STAGE_STYLE,
    emptyText: "A IA moverá clientes automaticamente",
  },
  {
    key: "pos_venda",
    label: "PÓS VENDA",
    icon: Package,
    ...NEUTRAL_STAGE_STYLE,
    emptyText: "A IA moverá clientes automaticamente",
  },
  {
    key: "maquinas",
    label: "MÁQUINAS",
    icon: Settings,
    ...NEUTRAL_STAGE_STYLE,
    emptyText: "A IA moverá clientes automaticamente",
  },
  {
    key: "personalite",
    label: "PERSONNALITÉ",
    icon: Sparkles,
    ...NEUTRAL_STAGE_STYLE,
    emptyText: "A IA moverá clientes automaticamente",
  },
  {
    key: "financeiro",
    label: "FINANCEIRO",
    icon: CircleDollarSign,
    ...NEUTRAL_STAGE_STYLE,
    emptyText: "A IA moverá clientes automaticamente",
  },
  {
    key: "pecas",
    label: "PEÇAS",
    icon: Component,
    ...NEUTRAL_STAGE_STYLE,
    emptyText: "A IA moverá clientes automaticamente",
  },
  {
    key: "outros",
    label: "OUTROS",
    icon: Layers,
    ...NEUTRAL_STAGE_STYLE,
    emptyText: "A IA moverá clientes automaticamente",
  },
  {
    key: "sem_resposta",
    label: "SEM RESPOSTA",
    icon: MessageSquareOff,
    ...NEUTRAL_STAGE_STYLE,
    emptyText: "Nenhum contato pendente de resposta",
  },
];

const VALID_COLUMN_KEYS = new Set<KanbanColumnKey>(KANBAN_COLUMNS.map((c) => c.key));

// ─── Classificador Inteligente de Funil ──────────────────────────────────────
export function classifySessionToColumn(session: SdrTriageSession): KanbanColumnKey {
  if ((session as any).funnelStage) {
    const rawStage = String((session as any).funnelStage) as KanbanColumnKey;
    if (VALID_COLUMN_KEYS.has(rawStage)) {
      return rawStage;
    }
    return "outros";
  }

  const norm = (str: string = "") =>
    str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

  const outcome = norm(session.outcome);
  const step = norm(session.currentStep);
  const resp = norm(session.responsibleName);
  const qualif = norm(
    session.collectedData?.["SETOR / FUNIL DE DESTINO"]?.value ||
    session.collectedData?.["TIPO DE QUALIFICAÇÃO"]?.value
  );
  const prod = norm(
    session.collectedData?.["MÁQUINA / PEÇA / INTERESSE"]?.value ||
    session.collectedData?.["QUAL O TIPO DE PRODUTO?"]?.value
  );

  // 1. Sem Resposta / Abandonado
  if (
    session.status === "abandoned" ||
    outcome === "abandoned" ||
    outcome.includes("sem resposta") ||
    outcome.includes("sem_resposta") ||
    outcome === "no_reply"
  ) {
    return "sem_resposta";
  }

  // 2. Setores Específicos
  if (qualif.includes("peca") || prod.includes("peca") || step.includes("peca")) {
    return "pecas";
  }
  if (qualif.includes("personalite") || prod.includes("personalite") || resp.includes("personalite")) {
    return "personalite";
  }
  if (qualif.includes("maquina") || prod.includes("maquina") || prod.includes("seladora") || prod.includes("embaladora") || resp.includes("maquina")) {
    return "maquinas";
  }
  if (qualif.includes("assistencia") || qualif.includes("suporte") || step.includes("assistencia") || step.includes("suporte") || resp.includes("assistencia")) {
    return "assistencia_tecnica";
  }
  if (qualif.includes("pos venda") || qualif.includes("pos-venda") || resp.includes("pos venda") || step.includes("pos venda")) {
    return "pos_venda";
  }
  if (qualif.includes("financeiro") || step.includes("financeiro") || resp.includes("financeiro")) {
    return "financeiro";
  }

  // 3. Concluída ou transferida / escalada sem setor específico -> Outros
  if (
    session.status === "completed" ||
    outcome === "completed" ||
    outcome === "transferred" ||
    outcome === "problem" ||
    outcome === "escalated"
  ) {
    return "outros";
  }

  // 4. Em andamento / Triagem
  return "triagem";
}

// ─── Sessões Mock Removidas — Sistema opera 100% com atendimentos reais ──────
export const BENCHMARK_SDR_SESSIONS: SdrTriageSession[] = [];

