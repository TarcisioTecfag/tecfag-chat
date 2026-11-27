// ══════════════════════════════════════════════════════════════════════════════
// 🧭 SITE ENTRY TRACKER — Preserva URL/UTM/ClickID/Referrer de entrada na VTEX
// Mantém a origem real da sessão entre recarregamentos de página (sessionStorage)
// com fallback curto (30 min) em localStorage para links abertos em nova aba.
// ══════════════════════════════════════════════════════════════════════════════

const ENTRY_STORAGE_KEY = "tecfag_site_entry_v1";
const LOCAL_FALLBACK_TTL_MS = 30 * 60 * 1000;

const TRACKING_QUERY_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "gclid",
  "fbclid",
  "gbraid",
  "wbraid",
  "msclkid",
  "ttclid",
] as const;

export interface SiteEntrySnapshot {
  url: string;
  title: string;
  referrer: string;
  capturedAt: number;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function parseUrlSafe(raw: string | null | undefined): URL | null {
  if (!raw || typeof raw !== "string") return null;
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:" ? u : null;
  } catch {
    return null;
  }
}

function registrableRoot(hostname: string): string {
  const parts = hostname.toLowerCase().replace(/^www\./, "").split(".");
  if (
    parts.length >= 3 &&
    ["com", "net", "org", "gov", "edu", "ind"].includes(parts[parts.length - 2]) &&
    parts[parts.length - 1].length === 2
  ) {
    return parts.slice(-3).join(".");
  }
  return parts.slice(-2).join(".");
}

export function isExternalReferrerForPage(
  referrer: string | null | undefined,
  pageUrl: string | null | undefined,
): boolean {
  const ref = parseUrlSafe(referrer);
  if (!ref) return false;
  const page = parseUrlSafe(pageUrl);
  if (!page) return true;
  return registrableRoot(ref.hostname) !== registrableRoot(page.hostname);
}

export function hasTrackingQueryParams(rawUrl: string | null | undefined): boolean {
  const parsed = parseUrlSafe(rawUrl);
  if (!parsed) return false;
  return TRACKING_QUERY_KEYS.some((key) => Boolean(parsed.searchParams.get(key)?.trim()));
}

function hasAttributionSignals(entry: Pick<SiteEntrySnapshot, "url" | "referrer">): boolean {
  return hasTrackingQueryParams(entry.url) || isExternalReferrerForPage(entry.referrer, entry.url);
}

function readSnapshot(storage: StorageLike | null | undefined, expectedOrigin: string): SiteEntrySnapshot | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(ENTRY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || typeof parsed.url !== "string") return null;
    const parsedUrl = parseUrlSafe(parsed.url);
    if (!parsedUrl || parsedUrl.origin !== expectedOrigin) return null;
    return {
      url: parsed.url,
      title: typeof parsed.title === "string" ? parsed.title : "",
      referrer: typeof parsed.referrer === "string" ? parsed.referrer : "",
      capturedAt: typeof parsed.capturedAt === "number" && Number.isFinite(parsed.capturedAt) ? parsed.capturedAt : 0,
    };
  } catch {
    return null;
  }
}

function writeSnapshot(storage: StorageLike | null | undefined, snapshot: SiteEntrySnapshot): void {
  if (!storage) return;
  try {
    storage.setItem(ENTRY_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Storage indisponível (modo privado / sandbox)
  }
}

/**
 * Resolve e persiste a entrada real do visitante na sessão atual:
 * - Se a página atual trouxe UTM, Click ID ou referrer externo, ela é a nova entrada da campanha.
 * - Caso contrário, preserva a entrada já salva na `sessionStorage` (mesma aba entre recarregamentos VTEX)
 *   ou fallback recente (< 30 min) na `localStorage` (ex.: produto aberto em nova aba).
 */
export function resolveAndPersistSiteEntry(params: {
  currentUrl: string;
  currentTitle: string;
  referrer: string;
  sessionStorage?: StorageLike | null;
  localStorage?: StorageLike | null;
  nowMs?: number;
}): SiteEntrySnapshot {
  const nowMs = params.nowMs ?? Date.now();
  const currentParsed = parseUrlSafe(params.currentUrl);
  const currentExternalRef = isExternalReferrerForPage(params.referrer, params.currentUrl)
    ? params.referrer
    : "";
  const currentSnapshot: SiteEntrySnapshot = {
    url: params.currentUrl,
    title: params.currentTitle || "",
    referrer: currentExternalRef,
    capturedAt: nowMs,
  };

  if (!currentParsed) {
    return currentSnapshot;
  }

  const origin = currentParsed.origin;
  const fromSession = readSnapshot(params.sessionStorage, origin);
  const fromLocalRaw = readSnapshot(params.localStorage, origin);
  const fromLocal =
    fromLocalRaw && nowMs - fromLocalRaw.capturedAt <= LOCAL_FALLBACK_TTL_MS ? fromLocalRaw : null;

  const currentHasTracking = hasTrackingQueryParams(currentSnapshot.url);
  const currentHasExternalRef = Boolean(currentExternalRef);

  // Nova chegada com UTM/ClickID explícito ou referrer externo (se ainda não havia tracking na sessão)
  if (currentHasTracking) {
    writeSnapshot(params.sessionStorage, currentSnapshot);
    writeSnapshot(params.localStorage, currentSnapshot);
    return currentSnapshot;
  }

  if (fromSession && hasAttributionSignals(fromSession)) {
    writeSnapshot(params.localStorage, { ...fromSession, capturedAt: nowMs });
    return fromSession;
  }

  if (currentHasExternalRef) {
    writeSnapshot(params.sessionStorage, currentSnapshot);
    writeSnapshot(params.localStorage, currentSnapshot);
    return currentSnapshot;
  }

  if (fromSession) {
    return fromSession;
  }

  if (fromLocal && hasAttributionSignals(fromLocal)) {
    writeSnapshot(params.sessionStorage, fromLocal);
    return fromLocal;
  }

  writeSnapshot(params.sessionStorage, currentSnapshot);
  writeSnapshot(params.localStorage, currentSnapshot);
  return currentSnapshot;
}

export function getBrowserSiteEntry(): SiteEntrySnapshot | null {
  if (typeof window === "undefined") return null;
  return resolveAndPersistSiteEntry({
    currentUrl: window.location?.href || "",
    currentTitle: typeof document !== "undefined" ? document.title || "" : "",
    referrer: typeof document !== "undefined" ? document.referrer || "" : "",
    sessionStorage: typeof sessionStorage !== "undefined" ? sessionStorage : null,
    localStorage: typeof localStorage !== "undefined" ? localStorage : null,
  });
}
