/**
 * Estado, ordenação e fila de Pop-ups de Atenção / Cobrança da Supervisão.
 *
 * Mantém:
 * - Fila FIFO de pop-ups para o consultor específico cobrado pelo gestor
 * - Deduplicação por ID/conversa e isolamento estrito por (tenantId, operatorId)
 * - Sincronização de fechamento entre abas abertas via localStorage
 * - Regra determinística da tag "ATENÇÃO!" e subida da conversa para o 1º lugar
 *   (expira automaticamente quando o operador envia a primeira mensagem ao cliente)
 */

import {
  getConversationSortTimestamp,
  type Conversation,
  type SupervisorAttentionState,
} from "./mockData";

export interface IncomingSupervisorAttentionAlert {
  id: string;
  tenantId: string;
  operatorId: string;
  conversationId: string;
  supervisorName: string;
  supervisorRole?: string | null;
  warningText: string;
  source?: string | null;
  alertReason?: string | null;
  didAssignOperator?: boolean;
  clientName: string;
  clientPhone?: string | null;
  clientAvatar?: string | null;
  company?: string | null;
  machine?: string | null;
  dealId?: string | null;
  dealTitle?: string | null;
  dealPipelineName?: string | null;
  dealStageName?: string | null;
  channel?: string | null;
  sectorName?: string | null;
  lastClientMessage?: string | null;
  receivedAt: string;
}

export const SUPERVISOR_ALERT_RECOVERY_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutos
export const RESOLVED_SUPERVISOR_ALERT_BROADCAST_KEY = "valem_supervisor_alert_resolved_v1";
const DISMISSED_STORAGE_PREFIX = "valem_dismissed_supervisor_alerts_v1:";
const DISMISSED_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_DISMISSED_ENTRIES = 200;

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeOptionalText(value: unknown): string | null {
  const clean = normalizeText(value);
  return clean || null;
}

/**
 * Indica se a conversa possui tag "ATENÇÃO!" ativa da supervisão.
 * - Conversas finalizadas nunca exibem "ATENÇÃO!".
 * - Se `currentOperatorId` for informado e o alerta tiver `operatorId` específico,
 *   retorna `true` para o consultor cobrado (ou quando o dono atual da conversa ainda é o consultor cobrado).
 */
export function hasActiveSupervisorAttention(
  conv: Pick<Conversation, "queue" | "operatorId" | "supervisorAttention"> | null | undefined,
  currentOperatorId?: string | null,
): boolean {
  if (!conv || conv.queue === "finalizados") return false;
  const att = conv.supervisorAttention;
  if (!att || !att.at) return false;
  const parsedAt = Date.parse(att.at);
  if (!Number.isFinite(parsedAt)) return false;

  const targetOp = normalizeOptionalText(att.operatorId);
  if (!targetOp) return true;

  // Se o consultor cobrado é o usuário atual, sempre está ativo enquanto não responder
  if (currentOperatorId && targetOp === currentOperatorId) return true;

  // Para gestores/visualizadores de "Todos", mantém visível enquanto o dono da conversa for o consultor cobrado
  if (conv.operatorId && conv.operatorId === targetOp) return true;

  return false;
}

/**
 * Indica se a conversa deve subir para o 1º lugar absoluto da lista do operador atual.
 */
export function getSupervisorAttentionPriorityTimestamp(
  conv: Pick<Conversation, "queue" | "operatorId" | "supervisorAttention"> | null | undefined,
  currentOperatorId?: string | null,
): number {
  if (!hasActiveSupervisorAttention(conv, currentOperatorId)) return 0;
  const ts = Date.parse(conv!.supervisorAttention!.at);
  return Number.isFinite(ts) ? ts : 0;
}

/**
 * Comparador canônico de conversas na lista de atendimentos (ChatList e Mini Chat CRM):
 * 1. Conversas ativas com tag "ATENÇÃO!" da supervisão sobem para o 1º lugar (mais recente primeiro)
 * 2. Conversas fixadas (`pinned`)
 * 3. Conversas ativas antes de finalizadas
 * 4. Última mensagem real trocada (cliente ou operador) mais recente primeiro
 */
export function compareConversationsForList(
  a: Conversation & { pinned?: boolean },
  b: Conversation & { pinned?: boolean },
  currentOperatorId?: string | null,
): number {
  const aAttTs = getSupervisorAttentionPriorityTimestamp(a, currentOperatorId);
  const bAttTs = getSupervisorAttentionPriorityTimestamp(b, currentOperatorId);
  const aHasAtt = aAttTs > 0 ? 1 : 0;
  const bHasAtt = bAttTs > 0 ? 1 : 0;
  if (aHasAtt !== bHasAtt) return bHasAtt - aHasAtt;
  if (aHasAtt && bHasAtt && aAttTs !== bAttTs) return bAttTs - aAttTs;

  const aPinned = a.pinned ? 1 : 0;
  const bPinned = b.pinned ? 1 : 0;
  if (aPinned !== bPinned) return bPinned - aPinned;

  const aClosed = a.queue === "finalizados" ? 1 : 0;
  const bClosed = b.queue === "finalizados" ? 1 : 0;
  if (aClosed !== bClosed) return aClosed - bClosed;

  return getConversationSortTimestamp(b) - getConversationSortTimestamp(a);
}

/**
 * Extrai um objeto `SupervisorAttentionState` válido de payload SSE/API.
 */
export function normalizeSupervisorAttentionState(raw: unknown): SupervisorAttentionState | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const atRaw = obj.at ?? obj.supervisorAttentionAt;
  const at =
    atRaw instanceof Date
      ? atRaw.toISOString()
      : typeof atRaw === "string" && atRaw.trim()
        ? atRaw.trim()
        : "";
  if (!at || !Number.isFinite(Date.parse(at))) return null;
  return {
    at,
    operatorId: normalizeOptionalText(obj.operatorId ?? obj.supervisorAttentionOperatorId),
    message: normalizeOptionalText(obj.message ?? obj.supervisorAttentionMessage),
    by: normalizeOptionalText(obj.by ?? obj.supervisorAttentionBy),
    messageId: normalizeOptionalText(obj.messageId ?? obj.supervisorAttentionMessageId),
  };
}

/**
 * Extrai e valida um alerta de pop-up a partir de um evento SSE `supervisor_attention_alert`.
 */
export function extractSupervisorAttentionAlertFromEvent(
  eventPayload: unknown,
  context: { tenantId: string; operatorId: string },
): IncomingSupervisorAttentionAlert | null {
  if (!eventPayload || typeof eventPayload !== "object") return null;
  if (!context.tenantId || !context.operatorId) return null;

  const payloadObj = eventPayload as Record<string, unknown>;
  const alertObj =
    payloadObj.alert && typeof payloadObj.alert === "object"
      ? (payloadObj.alert as Record<string, unknown>)
      : payloadObj;

  const eventTenantId = normalizeText(payloadObj.tenantId || alertObj.tenantId);
  if (eventTenantId && eventTenantId !== context.tenantId) return null;

  const targetOperatorId = normalizeText(payloadObj.operatorId || alertObj.operatorId);
  if (!targetOperatorId || targetOperatorId !== context.operatorId) return null;

  const conversationId = normalizeText(alertObj.conversationId);
  const warningText = normalizeText(alertObj.warningText || alertObj.content || alertObj.message);
  if (!conversationId || !warningText) return null;

  const id =
    normalizeText(alertObj.id || alertObj.messageId) || `sup-alert-${conversationId}-${Date.now()}`;

  const receivedAt =
    normalizeText(alertObj.receivedAt || alertObj.sentAt) || new Date().toISOString();

  return {
    id,
    tenantId: context.tenantId,
    operatorId: context.operatorId,
    conversationId,
    supervisorName: normalizeText(alertObj.supervisorName) || "Supervisão",
    supervisorRole: normalizeOptionalText(alertObj.supervisorRole),
    warningText,
    source: normalizeOptionalText(alertObj.source),
    alertReason: normalizeOptionalText(alertObj.alertReason),
    didAssignOperator: Boolean(alertObj.didAssignOperator),
    clientName: normalizeText(alertObj.clientName) || "Cliente",
    clientPhone: normalizeOptionalText(alertObj.clientPhone),
    clientAvatar: normalizeOptionalText(alertObj.clientAvatar),
    company: normalizeOptionalText(alertObj.company),
    machine: normalizeOptionalText(alertObj.machine),
    dealId: normalizeOptionalText(alertObj.dealId),
    dealTitle: normalizeOptionalText(alertObj.dealTitle),
    dealPipelineName: normalizeOptionalText(alertObj.dealPipelineName),
    dealStageName: normalizeOptionalText(alertObj.dealStageName),
    channel: normalizeOptionalText(alertObj.channel),
    sectorName: normalizeOptionalText(alertObj.sectorName),
    lastClientMessage: normalizeOptionalText(alertObj.lastClientMessage),
    receivedAt,
  };
}

/**
 * Constrói alertas recuperáveis (ex: após reload F5) a partir de conversas carregadas
 * que estejam com flag `supervisorAttention` recente e direcionada ao operador atual.
 */
export function extractRecoverableSupervisorAlertsFromConversations(
  conversations: Conversation[],
  options: {
    tenantId: string;
    operatorId: string;
    nowMs?: number;
    maxAgeMs?: number;
    dismissedIds?: ReadonlySet<string>;
  },
): IncomingSupervisorAttentionAlert[] {
  if (!options.tenantId || !options.operatorId || !Array.isArray(conversations)) return [];
  const nowMs = options.nowMs ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? SUPERVISOR_ALERT_RECOVERY_MAX_AGE_MS;
  const recovered: IncomingSupervisorAttentionAlert[] = [];

  for (const conv of conversations) {
    if (!conv || conv.id === "valentina" || conv.queue === "finalizados") continue;
    const att = conv.supervisorAttention;
    if (!att || !att.at || !att.message) continue;
    if (att.operatorId !== options.operatorId) continue;

    const createdMs = Date.parse(att.at);
    if (!Number.isFinite(createdMs)) continue;
    const ageMs = nowMs - createdMs;
    if (ageMs < -60_000 || ageMs > maxAgeMs) continue;

    const alertId = normalizeText(att.messageId) || `sup-rec-${conv.id}-${createdMs}`;
    if (options.dismissedIds?.has(alertId)) continue;

    const company =
      normalizeOptionalText(conv.cnpjDetails?.nomeFantasia) ||
      normalizeOptionalText(conv.cnpjDetails?.razaoSocial) ||
      null;

    const lastClientMsg = [...(conv.messages || [])]
      .reverse()
      .find((m) => m.side === "in" && !m.isInternalNote && m.senderType !== "system");

    recovered.push({
      id: alertId,
      tenantId: options.tenantId,
      operatorId: options.operatorId,
      conversationId: conv.id,
      supervisorName: normalizeText(att.by) || "Supervisão",
      warningText: att.message,
      clientName: normalizeText(conv.name) || "Cliente",
      clientPhone: normalizeOptionalText(conv.phone),
      clientAvatar: normalizeOptionalText(conv.avatar),
      company,
      channel: conv.channel,
      sectorName: normalizeOptionalText(conv.sectorName),
      lastClientMessage: normalizeOptionalText(lastClientMsg?.text),
      receivedAt: att.at,
    });
  }

  return recovered.sort((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt));
}

export function enqueueSupervisorAttentionAlert(
  queue: IncomingSupervisorAttentionAlert[],
  incoming: IncomingSupervisorAttentionAlert,
  dismissedIds?: ReadonlySet<string>,
): IncomingSupervisorAttentionAlert[] {
  if (dismissedIds?.has(incoming.id)) return queue;

  const existingIdx = queue.findIndex(
    (item) =>
      item.id === incoming.id ||
      (item.tenantId === incoming.tenantId &&
        item.operatorId === incoming.operatorId &&
        item.conversationId === incoming.conversationId),
  );

  if (existingIdx !== -1) {
    const existing = queue[existingIdx];
    const merged: IncomingSupervisorAttentionAlert = {
      ...existing,
      ...incoming,
      company: incoming.company || existing.company,
      machine: incoming.machine || existing.machine,
      dealId: incoming.dealId || existing.dealId,
      dealTitle: incoming.dealTitle || existing.dealTitle,
      dealPipelineName: incoming.dealPipelineName || existing.dealPipelineName,
      dealStageName: incoming.dealStageName || existing.dealStageName,
      clientPhone: incoming.clientPhone || existing.clientPhone,
      clientAvatar: incoming.clientAvatar || existing.clientAvatar,
      sectorName: incoming.sectorName || existing.sectorName,
      lastClientMessage: incoming.lastClientMessage || existing.lastClientMessage,
      alertReason: incoming.alertReason || existing.alertReason,
    };
    return queue.map((item, idx) => (idx === existingIdx ? merged : item));
  }

  return [...queue, incoming];
}

export function removeSupervisorAttentionAlert(
  queue: IncomingSupervisorAttentionAlert[],
  match: { id?: string | null; conversationId?: string | null },
): IncomingSupervisorAttentionAlert[] {
  const id = normalizeText(match.id);
  const conversationId = normalizeText(match.conversationId);
  if (!id && !conversationId) return queue;
  return queue.filter(
    (item) =>
      (id ? item.id !== id : true) &&
      (conversationId ? item.conversationId !== conversationId : true),
  );
}

function getDismissedStorageKey(tenantId: string, operatorId: string): string {
  return `${DISMISSED_STORAGE_PREFIX}${tenantId}:${operatorId}`;
}

type StoredDismissedRecord = Record<string, number>;

function readDismissedRecord(
  tenantId: string,
  operatorId: string,
  nowMs: number,
  storage: Pick<Storage, "getItem" | "setItem"> | null,
): StoredDismissedRecord {
  if (!storage || !tenantId || !operatorId) return {};
  try {
    const raw = storage.getItem(getDismissedStorageKey(tenantId, operatorId));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const pruned: StoredDismissedRecord = {};
    for (const [key, ts] of Object.entries(parsed)) {
      if (typeof ts === "number" && Number.isFinite(ts) && nowMs - ts <= DISMISSED_TTL_MS) {
        pruned[key] = ts;
      }
    }
    return pruned;
  } catch {
    return {};
  }
}

export function readDismissedSupervisorAlertIds(
  tenantId: string,
  operatorId: string,
  options?: {
    nowMs?: number;
    storage?: Pick<Storage, "getItem" | "setItem"> | null;
  },
): Set<string> {
  const storage =
    options?.storage !== undefined
      ? options.storage
      : typeof window !== "undefined"
        ? window.localStorage
        : null;
  const nowMs = options?.nowMs ?? Date.now();
  const rec = readDismissedRecord(tenantId, operatorId, nowMs, storage);
  return new Set(Object.keys(rec));
}

export function markSupervisorAlertDismissed(
  tenantId: string,
  operatorId: string,
  alertId: string,
  options?: {
    conversationId?: string | null;
    nowMs?: number;
    storage?: Pick<Storage, "getItem" | "setItem"> | null;
  },
): void {
  const storage =
    options?.storage !== undefined
      ? options.storage
      : typeof window !== "undefined"
        ? window.localStorage
        : null;
  if (!storage || !tenantId || !operatorId || !alertId) return;
  const nowMs = options?.nowMs ?? Date.now();
  try {
    const rec = readDismissedRecord(tenantId, operatorId, nowMs, storage);
    rec[alertId] = nowMs;

    const sortedEntries = Object.entries(rec)
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_DISMISSED_ENTRIES);
    storage.setItem(
      getDismissedStorageKey(tenantId, operatorId),
      JSON.stringify(Object.fromEntries(sortedEntries)),
    );

    storage.setItem(
      RESOLVED_SUPERVISOR_ALERT_BROADCAST_KEY,
      JSON.stringify({
        tenantId,
        operatorId,
        alertId,
        conversationId: options?.conversationId || null,
        at: nowMs,
      }),
    );
  } catch {
    // storage indisponível (modo privado/quota) — não bloqueia o fluxo
  }
}

export interface ResolvedSupervisorAlertBroadcast {
  tenantId: string;
  operatorId: string;
  alertId: string;
  conversationId: string | null;
  at: number;
}

export function parseResolvedSupervisorAlertBroadcast(
  rawValue: string | null | undefined,
): ResolvedSupervisorAlertBroadcast | null {
  if (!rawValue) return null;
  try {
    const parsed = JSON.parse(rawValue);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.tenantId !== "string" ||
      typeof parsed.operatorId !== "string" ||
      typeof parsed.alertId !== "string"
    ) {
      return null;
    }
    return {
      tenantId: parsed.tenantId,
      operatorId: parsed.operatorId,
      alertId: parsed.alertId,
      conversationId: typeof parsed.conversationId === "string" ? parsed.conversationId : null,
      at: typeof parsed.at === "number" ? parsed.at : Date.now(),
    };
  } catch {
    return null;
  }
}
