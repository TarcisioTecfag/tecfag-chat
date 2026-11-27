/** Evidência declarada pelo navegador. Não confirma produto, compra ou classificação comercial. */
const record = (raw: unknown): Record<string, unknown> =>
  raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
const text = (raw: unknown, max = 240) =>
  typeof raw === "string"
    ? raw
        .replace(/\p{Cc}/gu, " ")
        .trim()
        .slice(0, max)
    : "";
export const SITE_UTM_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
] as const;
export const SITE_CLICK_ID_KEYS = [
  "gclid",
  "fbclid",
  "gbraid",
  "wbraid",
  "msclkid",
  "ttclid",
] as const;
const OWN_SITE_DOMAIN_RE =
  /(?:^|\.)(?:tecfag[a-z0-9-]*|valem[a-z0-9-]*)\.com(?:\.br)?$|(?:^|\.)(?:tecfagchat|valemchat)\.up\.railway\.app$/i;
function registrableRoot(host: string): string {
  const parts = host.toLowerCase().replace(/^www\./, "").split(".");
  if (
    parts.length >= 3 &&
    ["com", "net", "org", "gov", "edu", "ind"].includes(parts[parts.length - 2]) &&
    parts[parts.length - 1].length === 2
  ) {
    return parts.slice(-3).join(".");
  }
  return parts.slice(-2).join(".");
}
export function isExternalSiteReferrer(
  referrer: string | null | undefined,
  pageUrl?: string | null,
): boolean {
  const ref = httpUrl(referrer);
  if (!ref) return false;
  const refHost = ref.hostname.toLowerCase().replace(/^www\./, "");
  if (OWN_SITE_DOMAIN_RE.test(refHost)) return false;
  const page = httpUrl(pageUrl);
  if (page) {
    const pageHost = page.hostname.toLowerCase().replace(/^www\./, "");
    if (registrableRoot(refHost) === registrableRoot(pageHost)) return false;
  }
  return true;
}
function httpUrl(raw: unknown): URL | null {
  if (typeof raw !== "string" || raw.length > 4000) return null;
  try {
    const url = new URL(raw);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password
      ? url
      : null;
  } catch {
    return null;
  }
}
function page(raw: unknown, origin: string) {
  const value = record(raw),
    url = httpUrl(value.url);
  if (!url || url.origin !== origin || url.pathname.length > 1600) return null;
  const utm: Record<string, string> = {};
  for (const key of SITE_UTM_KEYS) {
    const item = text(url.searchParams.get(key), 200);
    if (item) utm[key] = item;
  }
  const clickIds: Record<string, string> = {};
  for (const key of SITE_CLICK_ID_KEYS) {
    const item = text(url.searchParams.get(key), 250);
    if (item) clickIds[key] = item;
  }
  url.search = "";
  url.hash = "";
  for (const [key, item] of Object.entries(utm)) url.searchParams.set(key, item);
  for (const [key, item] of Object.entries(clickIds)) url.searchParams.set(key, item);
  const ref = httpUrl(value.referrer);
  if (ref) {
    ref.search = "";
    ref.hash = "";
  }
  return {
    url: url.href,
    title: text(value.title),
    referrer: ref?.href.slice(0, 2000) || null,
    utm,
  };
}
function entryHasAttributionSignals(entry: {
  url?: string | null;
  referrer?: string | null;
  utm?: Record<string, string> | null;
} | null | undefined): boolean {
  if (!entry) return false;
  if (entry.utm && Object.keys(entry.utm).length > 0) return true;
  const parsed = httpUrl(entry.url);
  if (parsed) {
    for (const key of SITE_CLICK_ID_KEYS) {
      if (parsed.searchParams.get(key)) return true;
    }
  }
  return isExternalSiteReferrer(entry.referrer, entry.url);
}
export function captureSiteContext(
  raw: unknown,
  origin: string | undefined,
  at: Date,
  inquiry = false,
) {
  const value = record(raw),
    expected = httpUrl(origin)?.origin;
  if (!expected || !Number.isFinite(+at)) return null;
  const current = page(value.page, expected);
  if (!current) return null;
  const product = record(value.product),
    productUrl = httpUrl(product.url);
  const selected =
    inquiry && productUrl?.origin === expected ? page({ url: product.url }, expected) : null;
  return {
    version: 1 as const,
    capturedAt: at.toISOString(),
    source: "browser_reported" as const,
    entry: page(value.entry, expected) || current,
    page: current,
    product: selected
      ? {
          source: "visitor_inquiry" as const,
          url: selected.url,
          name: text(product.name),
          sku: text(product.sku, 100),
          category: text(product.category, 200),
        }
      : null,
  };
}
export type SiteContext = NonNullable<ReturnType<typeof captureSiteContext>>;
export function readSiteContext(raw: unknown): SiteContext | null {
  const value = record(raw);
  if (
    value.version !== 1 ||
    value.source !== "browser_reported" ||
    typeof value.capturedAt !== "string"
  )
    return null;
  const origin = httpUrl(record(value.page).url)?.origin;
  return captureSiteContext(
    value,
    origin,
    new Date(value.capturedAt),
    record(value.product).source === "visitor_inquiry",
  );
}
export function mergeSiteContexts(before: unknown, after: unknown): SiteContext | null {
  const prior = readSiteContext(before),
    next = readSiteContext(after);
  if (!prior) return next;
  if (!next || prior.capturedAt > next.capturedAt) return prior;
  const resolvedEntry =
    !entryHasAttributionSignals(prior.entry) && entryHasAttributionSignals(next.entry)
      ? next.entry
      : prior.entry;
  return { ...next, entry: resolvedEntry, product: next.product || prior.product };
}
export function siteContextFromMessages(
  rows: { metaDetails?: unknown; senderType?: string; isInternalNote?: boolean }[],
  fallback?: unknown,
) {
  return rows.reduce(
    (context, row) =>
      row.senderType === "client" && !row.isInternalNote
        ? mergeSiteContexts(context, record(row.metaDetails).siteContext)
        : context,
    readSiteContext(fallback),
  );
}
export function siteProductInquiryText(context: SiteContext | null) {
  return context?.product
    ? `Gostaria de informações sobre ${context.product.name || "este produto"}.`
    : null;
}
