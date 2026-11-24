const DRAFT_STORAGE_PREFIX = "chat_drafts:v1:";
const MAX_DRAFTS_PER_TENANT = 120;
const MAX_DRAFT_LENGTH = 20_000;
const DRAFT_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 dias

interface StoredDraftEntry {
  text: string;
  updatedAt: number;
}

type TenantDraftMap = Record<string, StoredDraftEntry>;

function getStorage(storage?: Storage | null): Storage | null {
  if (storage !== undefined) return storage;
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function getStorageKey(tenantId: string): string {
  return `${DRAFT_STORAGE_PREFIX}${tenantId}`;
}

function pruneDraftMap(map: TenantDraftMap, now: number): TenantDraftMap {
  const validEntries = Object.entries(map).filter(([, entry]) => {
    if (!entry || typeof entry.text !== "string" || entry.text.length === 0) return false;
    if (typeof entry.updatedAt !== "number" || !Number.isFinite(entry.updatedAt)) return false;
    return now - entry.updatedAt <= DRAFT_TTL_MS;
  });

  if (validEntries.length <= MAX_DRAFTS_PER_TENANT) {
    return Object.fromEntries(validEntries);
  }

  validEntries.sort((a, b) => b[1].updatedAt - a[1].updatedAt);
  return Object.fromEntries(validEntries.slice(0, MAX_DRAFTS_PER_TENANT));
}

function readRawTenantDraftMap(
  tenantId: string,
  storage?: Storage | null,
): TenantDraftMap {
  const store = getStorage(storage);
  if (!store || !tenantId) return {};

  try {
    const raw = store.getItem(getStorageKey(tenantId));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as TenantDraftMap;
  } catch {
    return {};
  }
}

function readTenantDraftMap(
  tenantId: string,
  storage?: Storage | null,
  now = Date.now(),
): TenantDraftMap {
  return pruneDraftMap(readRawTenantDraftMap(tenantId, storage), now);
}

function writeTenantDraftMap(
  tenantId: string,
  map: TenantDraftMap,
  storage?: Storage | null,
): void {
  const store = getStorage(storage);
  if (!store || !tenantId) return;

  const key = getStorageKey(tenantId);
  try {
    const entries = Object.keys(map);
    if (entries.length === 0) {
      store.removeItem(key);
      return;
    }
    store.setItem(key, JSON.stringify(map));
  } catch {
    // QuotaExceededError ou modo privado: ignora silenciosamente sem afetar digitação
  }
}

/**
 * Lê o rascunho persistido de uma conversa, isolado por tenant.
 */
export function readChatDraft(
  tenantId: string | null | undefined,
  conversationId: string | null | undefined,
  options?: { storage?: Storage | null; now?: number },
): string {
  if (!tenantId || !conversationId) return "";
  const map = readTenantDraftMap(tenantId, options?.storage, options?.now ?? Date.now());
  return map[conversationId]?.text ?? "";
}

/**
 * Salva ou limpa o rascunho de texto de uma conversa, isolado por tenant.
 */
export function writeChatDraft(
  tenantId: string | null | undefined,
  conversationId: string | null | undefined,
  text: string,
  options?: { storage?: Storage | null; now?: number },
): void {
  if (!tenantId || !conversationId) return;
  const now = options?.now ?? Date.now();
  const map = readTenantDraftMap(tenantId, options?.storage, now);

  if (!text || text.trim().length === 0) {
    if (conversationId in map) {
      delete map[conversationId];
      writeTenantDraftMap(tenantId, map, options?.storage);
    }
    return;
  }

  const boundedText = text.length > MAX_DRAFT_LENGTH ? text.slice(0, MAX_DRAFT_LENGTH) : text;
  map[conversationId] = {
    text: boundedText,
    updatedAt: now,
  };
  writeTenantDraftMap(tenantId, pruneDraftMap(map, now), options?.storage);
}

/**
 * Remove explicitamente o rascunho de uma conversa (ex.: após envio).
 */
export function clearChatDraft(
  tenantId: string | null | undefined,
  conversationId: string | null | undefined,
  options?: { storage?: Storage | null; now?: number },
): void {
  if (!tenantId || !conversationId) return;
  const rawMap = readRawTenantDraftMap(tenantId, options?.storage);
  if (conversationId in rawMap) {
    delete rawMap[conversationId];
    const cleaned =
      options?.now !== undefined ? pruneDraftMap(rawMap, options.now) : rawMap;
    writeTenantDraftMap(tenantId, cleaned, options?.storage);
  }
}
