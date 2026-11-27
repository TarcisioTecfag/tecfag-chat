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
import type { SdrTriageSession } from "./SdrTab";
import { isReplacementPartsIntent } from "../../lib/triage/industrial-policy";

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

export type SdrViewMode = "kanban" | "live";
export type SdrChannelFilter = "all" | "whatsapp" | "site";
export type SdrPeriodFilter = "todos" | "hoje" | "7dias" | "30dias";
export type SdrStatusFilter =
  | "all"
  | "awaiting_approval"
  | "active"
  | "completed"
  | "abandoned"
  | "stopped"
  | "manual";

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
  statusFilter: SdrStatusFilter;
  channelFilter: SdrChannelFilter;
  periodFilter: SdrPeriodFilter;
  selectedDate: Date | null;
}

export const DEFAULT_SDR_FILTER_STATE: SdrFilterState = {
  searchQuery: "",
  unreadOnly: false,
  showCompleted: false,
  statusFilter: "all",
  channelFilter: "all",
  periodFilter: "todos",
  selectedDate: null,
};

const BRT_OFFSET_MS = -3 * 60 * 60 * 1000;

export function getBrtDateKey(dateInput: Date | string | number): string | null {
  const ms =
    typeof dateInput === "number"
      ? dateInput
      : dateInput instanceof Date
        ? dateInput.getTime()
        : Date.parse(dateInput);
  if (Number.isNaN(ms)) return null;
  const shifted = new Date(ms + BRT_OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const d = String(shifted.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function getSessionActivityTimestamp(session: SdrTriageSession): number {
  let maxClientTs = 0;
  if (session.lastClientMessageAt) {
    const parsed = Date.parse(session.lastClientMessageAt);
    if (!Number.isNaN(parsed)) maxClientTs = parsed;
  }

  let maxAnyTs = 0;
  if (session.lastMessageAt) {
    const parsed = Date.parse(session.lastMessageAt);
    if (!Number.isNaN(parsed)) maxAnyTs = parsed;
  }

  if (Array.isArray(session.messages)) {
    for (const msg of session.messages) {
      if (!msg.sentAt) continue;
      const ts = Date.parse(msg.sentAt);
      if (Number.isNaN(ts)) continue;
      if (ts > maxAnyTs) maxAnyTs = ts;
      if (msg.sender === "client" && ts > maxClientTs) {
        maxClientTs = ts;
      }
    }
  }

  if (maxClientTs > 0) return maxClientTs;
  if (maxAnyTs > 0) return maxAnyTs;
  if (session.startedAt) {
    const started = Date.parse(session.startedAt);
    if (!Number.isNaN(started)) return started;
  }
  return 0;
}

/** Identifica atendimentos informativos encerrados automaticamente (Currículos / Fornecedores — não são leads). */
export function isInformativeClosureSession(session: SdrTriageSession): boolean {
  if (session.isInformativeClosure === true) return true;
  const subflow = String(session.subflow || "").trim().toUpperCase();
  const isInfoSubflow = subflow === "5B_CURRICULO" || subflow === "5C_COMPRAS";
  return (
    isInfoSubflow &&
    (session.status === "completed" ||
      session.monitoring?.informativeAutoClosed === true ||
      session.monitoring?.state === "resolved" ||
      session.monitoring?.state === "closed")
  );
}

/** Atendimentos informativos já encerrados que ainda aparecem em OUTROS até o SDR bater o olho e clicar em Ocultar. */
export function isUnhiddenInformativeSession(session: SdrTriageSession): boolean {
  const hidden = session.sdrHidden === true || session.monitoring?.sdrHidden === true;
  return isInformativeClosureSession(session) && !hidden;
}

/**
 * Fonte única de filtragem para Kanban SDR e Lista Ao Vivo.
 * Garante consistência 100% entre os dois modos de visualização.
 */
export function filterSdrSessions(
  sessions: SdrTriageSession[],
  filterState: SdrFilterState,
  now: Date = new Date(),
): SdrTriageSession[] {
  const q = (filterState.searchQuery || "").trim().toLowerCase();
  const todayBrt = getBrtDateKey(now);
  const selectedBrt = filterState.selectedDate
    ? `${filterState.selectedDate.getFullYear()}-${String(filterState.selectedDate.getMonth() + 1).padStart(2, "0")}-${String(filterState.selectedDate.getDate()).padStart(2, "0")}`
    : null;

  const filteredWithTs: Array<{ session: SdrTriageSession; activityTs: number }> = [];

  for (const session of sessions) {
    // 1. Canal (WhatsApp ou Site)
    if (filterState.channelFilter !== "all") {
      const rawChan = session.channel || "whatsapp";
      const normalizedChan = rawChan === "livechat" || rawChan === "site" ? "site" : "whatsapp";
      if (normalizedChan !== filterState.channelFilter) continue;
    }

    // 2. Apenas não lidas
    if (filterState.unreadOnly) {
      if ((session.unreadCount || 0) <= 0) continue;
    }

    // 3. Status explícito da triagem
    if (filterState.statusFilter !== "all") {
      if (session.status !== filterState.statusFilter) continue;
    } else if (
      !filterState.showCompleted &&
      (session.status === "completed" || session.status === "manual") &&
      !isUnhiddenInformativeSession(session)
    ) {
      // Oculta concluídos / assumidos manualmente do Kanban ativo por padrão,
      // mantendo visíveis em OUTROS apenas os informativos não-lead até o SDR clicar em "Ocultar"
      continue;
    }

    // 4. Data específica (calendário em Horário de Brasília)
    const activityTs = getSessionActivityTimestamp(session);
    const startedTs = session.startedAt ? Date.parse(session.startedAt) : NaN;

    if (selectedBrt) {
      const actKey = activityTs > 0 ? getBrtDateKey(activityTs) : null;
      const startKey = !Number.isNaN(startedTs) ? getBrtDateKey(startedTs) : null;
      if (actKey !== selectedBrt && startKey !== selectedBrt) continue;
    } else if (filterState.periodFilter !== "todos") {
      const refTs = activityTs > 0 ? activityTs : !Number.isNaN(startedTs) ? startedTs : 0;
      if (refTs <= 0) continue;

      if (filterState.periodFilter === "hoje") {
        const refKey = getBrtDateKey(refTs);
        const startKey = !Number.isNaN(startedTs) ? getBrtDateKey(startedTs) : null;
        if (refKey !== todayBrt && startKey !== todayBrt) continue;
      } else if (filterState.periodFilter === "7dias") {
        const diffDays = (now.getTime() - refTs) / (1000 * 60 * 60 * 24);
        if (diffDays > 7) continue;
      } else if (filterState.periodFilter === "30dias") {
        const diffDays = (now.getTime() - refTs) / (1000 * 60 * 60 * 24);
        if (diffDays > 30) continue;
      }
    }

    // 5. Busca textual (nome, empresa, telefone, prévia ou mensagens carregadas)
    if (q) {
      const matchName = (session.contactName || "").toLowerCase().includes(q);
      const matchCompany = (session.company || "").toLowerCase().includes(q);
      const matchPhone = (session.phone || "").toLowerCase().includes(q);
      const matchPreview = (session.lastMessagePreview || "").toLowerCase().includes(q);
      const matchMessages =
        !matchName &&
        !matchCompany &&
        !matchPhone &&
        !matchPreview &&
        (session.messages || []).some((msg) => (msg.text || "").toLowerCase().includes(q));
      if (!matchName && !matchCompany && !matchPhone && !matchPreview && !matchMessages) {
        continue;
      }
    }

    filteredWithTs.push({ session, activityTs });
  }

  filteredWithTs.sort((a, b) => {
    const aAwaiting = a.session.status === "awaiting_approval" ? 0 : 1;
    const bAwaiting = b.session.status === "awaiting_approval" ? 0 : 1;
    if (aAwaiting !== bAwaiting) return aAwaiting - bAwaiting;
    return b.activityTs - a.activityTs;
  });

  return filteredWithTs.map((entry) => entry.session);
}

/**
 * Assinatura leve para structural sharing: se uma sessão não mudou nada entre polls,
 * preserva a referência exata do objeto anterior para que React.memo pule o re-render do card/linha.
 */
function buildSessionContentSignature(s: SdrTriageSession): string {
  const lastMsg = s.messages && s.messages.length > 0 ? s.messages[s.messages.length - 1] : null;
  return [
    s.id,
    s.conversationId,
    s.contactName,
    s.contactAvatar || "",
    s.company,
    s.phone,
    s.currentStep,
    s.status,
    s.outcome || "",
    s.responsibleName || "",
    s.unreadCount || 0,
    s.channel || "",
    s.subflow || "",
    s.funnelStage || "",
    s.targetFunnel || "",
    s.isInformativeClosure ? 1 : 0,
    s.sdrHidden ? 1 : 0,
    s.lastClientMessageAt || "",
    s.lastMessageAt || "",
    s.lastMessagePreview || "",
    s.triageProgress
      ? `${s.triageProgress.filledCount}/${s.triageProgress.totalCount}/${s.triageProgress.percentage}`
      : "",
    s.pendingApproval
      ? `${s.pendingApproval.suggestedSectorId || ""}|${s.pendingApproval.suggestedOperatorId || ""}|${s.pendingApproval.suggestedPipelineId || ""}|${s.pendingApproval.suggestedStageId || ""}|${s.pendingApproval.needsReview ? 1 : 0}`
      : "",
    s.monitoring ? `${s.monitoring.state}|${s.monitoring.label}|${s.monitoring.operatorId || ""}` : "",
    s.linkedDeal ? `${s.linkedDeal.dealId}|${s.linkedDeal.dealTitle}` : "",
    s.knownClient ? `${s.knownClient.companyName}|${s.knownClient.confirmed ? 1 : 0}` : "",
    s.previousTriages?.length || 0,
    s.messagesLoaded ? 1 : 0,
    s.messages?.length || 0,
    lastMsg ? `${lastMsg.id || ""}|${lastMsg.sentAt || ""}|${lastMsg.text?.length || 0}` : "",
    JSON.stringify(s.collectedData || {}),
  ].join("\x1f");
}

export function mergeSessionsPreservingRefs(
  prev: SdrTriageSession[],
  next: SdrTriageSession[],
): SdrTriageSession[] {
  if (prev.length === 0) return next;
  const prevById = new Map<string, { session: SdrTriageSession; sig: string }>();
  for (const s of prev) {
    prevById.set(s.id, { session: s, sig: buildSessionContentSignature(s) });
  }

  let changed = prev.length !== next.length;
  const merged = next.map((item, idx) => {
    const existing = prevById.get(item.id);
    if (existing && existing.sig === buildSessionContentSignature(item)) {
      if (prev[idx] !== existing.session) changed = true;
      return existing.session;
    }
    changed = true;
    return item;
  });

  return changed ? merged : prev;
}

export interface AdaptivePollOptions {
  viewMode: SdrViewMode;
  effectiveType?: string | null;
  saveData?: boolean;
  lastRttMs?: number;
  errorStreak?: number;
}

/**
 * Calcula intervalo adaptativo de polling para funcionar com fluidez em internet lenta/instável,
 * mantendo resposta imediata em rede boa e via eventos SSE.
 */
export function computeAdaptiveSdrPollDelayMs({
  viewMode,
  effectiveType,
  saveData = false,
  lastRttMs = 0,
  errorStreak = 0,
}: AdaptivePollOptions): number {
  const isSlowNetwork =
    saveData ||
    effectiveType === "slow-2g" ||
    effectiveType === "2g" ||
    effectiveType === "3g" ||
    lastRttMs >= 1500;

  let baseMs = viewMode === "live" ? 7000 : 10000;
  if (isSlowNetwork) {
    baseMs = viewMode === "live" ? 14000 : 18000;
  } else if (lastRttMs >= 800) {
    baseMs = viewMode === "live" ? 10000 : 13000;
  }

  if (errorStreak > 0) {
    const multiplier = Math.min(4, Math.pow(1.6, Math.min(errorStreak, 4)));
    return Math.min(35000, Math.round(baseMs * multiplier));
  }

  return baseMs;
}

export function hasActiveSdrFilters(filterState: SdrFilterState): boolean {
  return (
    filterState.unreadOnly ||
    filterState.showCompleted ||
    filterState.statusFilter !== "all" ||
    filterState.channelFilter !== "all" ||
    filterState.periodFilter !== "todos" ||
    Boolean(filterState.selectedDate)
  );
}

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
  const upperSubflow = String(session.subflow || "").trim().toUpperCase();
  if (
    isInformativeClosureSession(session) ||
    upperSubflow === "5B_CURRICULO" ||
    upperSubflow === "5C_COMPRAS"
  ) {
    return "outros";
  }

  const norm = (str: string = "") =>
    str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

  const outcome = norm(session.outcome);
  const step = norm(session.currentStep);

  // 1. Sem Resposta / Abandonado sempre prevalece sobre o funnelStage coletado antes do abandono
  if (
    session.status === "abandoned" ||
    outcome === "abandoned" ||
    outcome.includes("sem resposta") ||
    outcome.includes("sem_resposta") ||
    outcome === "no_reply" ||
    step === "sem resposta"
  ) {
    return "sem_resposta";
  }

  if (session.funnelStage) {
    const rawStage = String(session.funnelStage) as KanbanColumnKey;
    if (VALID_COLUMN_KEYS.has(rawStage)) {
      return rawStage;
    }
    return "outros";
  }

  const resp = norm(session.responsibleName);
  const qualif = norm(
    session.collectedData?.["SETOR / FUNIL DE DESTINO"]?.value ||
    session.collectedData?.["TIPO DE QUALIFICAÇÃO"]?.value
  );
  const prod = norm(
    session.collectedData?.["MÁQUINA / PEÇA / INTERESSE"]?.value ||
    session.collectedData?.["QUAL O TIPO DE PRODUTO?"]?.value
  );

  // 2. Setores Específicos
  if (
    qualif.includes("peca") ||
    step.includes("peca") ||
    isReplacementPartsIntent(prod)
  ) {
    return "pecas";
  }
  if (
    qualif.includes("personalite") ||
    qualif.includes("personnalite") ||
    prod.includes("personalite") ||
    prod.includes("personnalite") ||
    resp.includes("personalite") ||
    resp.includes("personnalite")
  ) {
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

  // 3. Concluída, interrompida, manual ou transferida sem setor específico -> Outros
  if (
    session.status === "completed" ||
    session.status === "stopped" ||
    session.status === "manual" ||
    outcome === "completed" ||
    outcome === "transferred" ||
    outcome === "stopped" ||
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
