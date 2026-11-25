/**
 * Estado e utilitários puros para a fila de Pop-ups de Interrupção de Lead Novo.
 *
 * Mantém deduplicação por ID/conversa, isolamento rigoroso por (tenantId, operatorId),
 * recuperação controlada de transferências recém-chegadas em caso de reload (<= 5 min)
 * e sincronização entre abas abertas do mesmo navegador via localStorage.
 */

export interface IncomingLeadAlert {
  id: string;
  tenantId: string;
  operatorId: string;
  conversationId: string;
  clientName: string;
  machine: string | null;
  company: string | null;
  targetFunnel?: string | null;
  dealId?: string | null;
  dealTitle?: string | null;
  transferSource?: "sdr_auto" | "manual_transfer" | "rodizio_reassignment" | string | null;
  transferredBy?: string | null;
  receivedAt: string;
}

export const LEAD_ALERT_RECOVERY_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutos
export const RESOLVED_LEAD_ALERT_BROADCAST_KEY = "valem_lead_alert_resolved_v1";
const DISMISSED_STORAGE_PREFIX = "valem_dismissed_lead_alerts_v1:";
const DISMISSED_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_DISMISSED_ENTRIES = 200;

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isPlaceholder(value: string): boolean {
  if (!value) return true;
  const norm = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
  return (
    norm === "-" ||
    norm === "--" ||
    norm === "..." ||
    norm === "aguardando..." ||
    norm === "nao informada" ||
    norm === "nao informado" ||
    norm === "empresa nao informada" ||
    norm === "atendimento comercial transferido para sua fila"
  );
}

/**
 * Fallback defensivo para notificações antigas que só possuem o `interest` composto
 * ("Setor/Funil: X | Negociação: Y | Tarefa: Responder o contato | Seladora").
 */
function extractLegacyMachineFromInterest(interestRaw: string, dealTitle?: string | null): string | null {
  const clean = normalizeText(interestRaw);
  if (!clean || isPlaceholder(clean)) return null;
  const parts = clean
    .split("|")
    .map((p) => p.trim())
    .filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const seg = parts[i];
    if (/^(?:setor\/funil|negocia[cç][aã]o|tarefa)\s*:/i.test(seg)) continue;
    if (!isPlaceholder(seg)) return seg;
  }
  const funnelPart = parts.find((p) => /^setor\/funil\s*:/i.test(p));
  if (funnelPart) {
    const val = funnelPart.replace(/^setor\/funil\s*:/i, "").trim();
    if (val && !isPlaceholder(val)) return val;
  }
  if (dealTitle && !isPlaceholder(dealTitle)) return dealTitle.trim();
  return null;
}

export function isLeadTransferNotificationPayload(rawNotif: any): boolean {
  if (!rawNotif || typeof rawNotif !== "object") return false;
  const meta =
    rawNotif.metadata && typeof rawNotif.metadata === "object"
      ? rawNotif.metadata
      : typeof rawNotif.metadata === "string"
        ? (() => {
            try {
              return JSON.parse(rawNotif.metadata);
            } catch {
              return {};
            }
          })()
        : {};
  const isWhisper =
    meta.type === "supervisor_whisper" ||
    meta.warningType === "whisper" ||
    rawNotif.warningType === "whisper";
  if (isWhisper) return false;

  return (
    meta.type === "lead_transfer" ||
    meta.warningType === "new_lead" ||
    rawNotif.warningType === "new_lead"
  );
}

export function extractIncomingLeadAlertFromNotification(
  rawNotif: any,
  context: { tenantId: string; operatorId: string },
): IncomingLeadAlert | null {
  if (!context.tenantId || !context.operatorId) return null;
  if (!isLeadTransferNotificationPayload(rawNotif)) return null;

  const meta =
    rawNotif.metadata && typeof rawNotif.metadata === "object"
      ? rawNotif.metadata
      : typeof rawNotif.metadata === "string"
        ? (() => {
            try {
              return JSON.parse(rawNotif.metadata);
            } catch {
              return {};
            }
          })()
        : {};
  const wm =
    rawNotif.warningMetadata && typeof rawNotif.warningMetadata === "object"
      ? rawNotif.warningMetadata
      : {};

  const conversationId = normalizeText(
    meta.conversationId || wm.conversationId || meta.clientId || wm.clientId,
  );
  if (!conversationId) return null;

  const alertId =
    normalizeText(rawNotif.id) || `lead-alert-${conversationId}-${Date.now()}`;

  const clientName =
    normalizeText(meta.clientName) ||
    normalizeText(meta.contactName) ||
    normalizeText(wm.clientName) ||
    "Cliente";

  const dealTitle = normalizeText(meta.dealTitle || wm.dealTitle) || null;
  const rawMachine = normalizeText(meta.machine || wm.machine);
  const machine =
    (rawMachine && !isPlaceholder(rawMachine) ? rawMachine : null) ||
    extractLegacyMachineFromInterest(
      normalizeText(meta.interest || wm.interest),
      dealTitle,
    );

  const rawCompany = normalizeText(meta.company || wm.company);
  const company = rawCompany && !isPlaceholder(rawCompany) ? rawCompany : null;

  const receivedAt =
    normalizeText(meta.receivedAt || wm.receivedAt || rawNotif.createdAt) ||
    new Date().toISOString();

  return {
    id: alertId,
    tenantId: context.tenantId,
    operatorId: context.operatorId,
    conversationId,
    clientName,
    machine,
    company,
    targetFunnel: normalizeText(meta.targetFunnel || wm.targetFunnel) || null,
    dealId: normalizeText(meta.dealId || wm.dealId) || null,
    dealTitle,
    transferSource: normalizeText(meta.transferSource || wm.transferSource) || null,
    transferredBy: normalizeText(meta.transferredBy || wm.transferredBy) || null,
    receivedAt,
  };
}

export function enqueueIncomingLeadAlert(
  queue: IncomingLeadAlert[],
  incoming: IncomingLeadAlert,
  dismissedIds?: ReadonlySet<string>,
): IncomingLeadAlert[] {
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
    const merged: IncomingLeadAlert = {
      ...existing,
      ...incoming,
      machine: incoming.machine || existing.machine,
      company: incoming.company || existing.company,
      dealId: incoming.dealId || existing.dealId,
      dealTitle: incoming.dealTitle || existing.dealTitle,
      targetFunnel: incoming.targetFunnel || existing.targetFunnel,
    };
    return queue.map((item, idx) => (idx === existingIdx ? merged : item));
  }

  return [...queue, incoming];
}

export function removeIncomingLeadAlert(
  queue: IncomingLeadAlert[],
  match: { id?: string | null; conversationId?: string | null },
): IncomingLeadAlert[] {
  const id = normalizeText(match.id);
  const conversationId = normalizeText(match.conversationId);
  if (!id && !conversationId) return queue;
  return queue.filter(
    (item) =>
      (id ? item.id !== id : true) &&
      (conversationId ? item.conversationId !== conversationId : true),
  );
}

export function shouldRecoverUnreadLeadAlert(
  rawRow: any,
  options: {
    tenantId: string;
    operatorId: string;
    nowMs?: number;
    maxAgeMs?: number;
    dismissedIds?: ReadonlySet<string>;
  },
): IncomingLeadAlert | null {
  if (!rawRow || typeof rawRow !== "object") return null;
  if (rawRow.read !== 0 && rawRow.read !== false) return null;

  const alert = extractIncomingLeadAlertFromNotification(rawRow, {
    tenantId: options.tenantId,
    operatorId: options.operatorId,
  });
  if (!alert) return null;
  if (options.dismissedIds?.has(alert.id)) return null;

  const nowMs = options.nowMs ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? LEAD_ALERT_RECOVERY_MAX_AGE_MS;
  const createdMs = new Date(alert.receivedAt).getTime();
  if (!Number.isFinite(createdMs)) return null;
  const ageMs = nowMs - createdMs;
  if (ageMs < -60_000 || ageMs > maxAgeMs) return null;

  return alert;
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

export function readDismissedLeadAlertIds(
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

export function markLeadAlertDismissed(
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

    // Sincroniza fechamento com outras abas abertas do mesmo operador
    storage.setItem(
      RESOLVED_LEAD_ALERT_BROADCAST_KEY,
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

export interface ResolvedLeadAlertBroadcast {
  tenantId: string;
  operatorId: string;
  alertId: string;
  conversationId: string | null;
  at: number;
}

export function parseResolvedLeadAlertBroadcast(
  rawValue: string | null | undefined,
): ResolvedLeadAlertBroadcast | null {
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
      conversationId:
        typeof parsed.conversationId === "string" ? parsed.conversationId : null,
      at: typeof parsed.at === "number" ? parsed.at : Date.now(),
    };
  } catch {
    return null;
  }
}
