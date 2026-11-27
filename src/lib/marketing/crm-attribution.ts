import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  commercialConsultantProfiles,
  contacts,
  conversations,
  crmDeals,
  crmPipelines,
  crmStages,
  lcPageviews,
  lcVisitors,
  messages,
  sectors,
} from "../../db/schema";
import { getAiPersona } from "../ai-persona";
import {
  isSiteConversationId,
  visitorIdFromSiteConversation,
} from "../livechat/site-channel-policy";
import {
  captureSiteContext,
  isExternalSiteReferrer,
  readSiteContext,
  type SiteContext,
} from "../livechat/site-context";

/**
 * Ponto de conversão padrão do chat do site por tenant:
 * - Perfil industrial (Fagner / loja VTEX): "Fagner | Vtex"
 * - Demais tenants (ex.: Valem / Valentina): "Chat Site"
 */
export function getDefaultSiteCampaignLabel(tenantId?: string | null): string {
  if (tenantId && getAiPersona(tenantId).triagePolicy === "industrial") {
    return "Fagner | Vtex";
  }
  return "Chat Site";
}

export const MARKETING_SECTORS = [
  "semi_industrial",
  "personnalite",
  "projetos",
  "pecas",
  "pre_venda",
  "suporte_tecnico",
  "externo",
  "financeiro",
  "teste",
] as const;

export type MarketingSector = (typeof MARKETING_SECTORS)[number];

export const MARKETING_SECTOR_LABELS: Record<MarketingSector, string> = {
  semi_industrial: "Semi Industrial",
  personnalite: "Personnalité",
  projetos: "Projetos",
  pecas: "Peças",
  pre_venda: "Pré-venda",
  suporte_tecnico: "Suporte Técnico",
  externo: "Externo",
  financeiro: "Financeiro",
  teste: "Teste",
};

export const COMMERCIAL_DEFINITIVE_SECTORS = new Set<MarketingSector>([
  "semi_industrial",
  "personnalite",
  "projetos",
  "pecas",
]);

export const REPORTABLE_MARKETING_SECTORS = new Set<MarketingSector>([
  "semi_industrial",
  "personnalite",
  "projetos",
  "pecas",
  "pre_venda",
]);

export function isValidMarketingSector(val: unknown): val is MarketingSector {
  return typeof val === "string" && (MARKETING_SECTORS as readonly string[]).includes(val);
}

export function formatMarketingSectorLabel(sector: string | null | undefined): string | null {
  if (!sector) return null;
  if (isValidMarketingSector(sector)) return MARKETING_SECTOR_LABELS[sector];
  return sector;
}

function normText(raw: unknown): string {
  return String(raw || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function cleanStr(raw: unknown, maxLen = 500): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (
    !trimmed ||
    /^encoded_/i.test(trimmed) ||
    /^(unknown|undefined|null|n[aã]o informad[oa]|desconhecid[oa]|nada|-)$/i.test(trimmed)
  ) {
    return null;
  }
  return trimmed.slice(0, maxLen);
}

/**
 * Detecta palavra isolada "TESTE" ou "TESTES" no título ou nome do contato,
 * sem falsos positivos em palavras reais como "Atestado", "Contestação", etc.
 */
export function isTestEntityTitle(rawTitle: string | null | undefined): boolean {
  if (!rawTitle) return false;
  return /(?:^|[^a-zA-ZÀ-ÿ0-9])testes?(?:$|[^a-zA-ZÀ-ÿ0-9])/i.test(rawTitle.trim());
}

/**
 * Identifica se um valor bruto de `source` é apenas um rótulo operacional de canal
 * (ex.: 'manual', 'chat', 'whatsapp', 'WhatsApp SDR (Fagner)') e NÃO uma fonte de mídia.
 */
export function isOperationalChannelLabel(rawSource: unknown): boolean {
  const n = normText(rawSource);
  if (!n) return false;
  return (
    n === "manual" ||
    n === "chat" ||
    n === "chat site" ||
    n === "livechat" ||
    n === "site_chat" ||
    n === "whatsapp" ||
    n === "auto_sdr" ||
    n === "crm" ||
    n === "import_rd" ||
    n === "rd station marketing" ||
    n === "nao informada" ||
    n === "nao informado" ||
    n.startsWith("whatsapp sdr")
  );
}

export function inferEntryChannelFromOperationalSource(
  rawSource: unknown,
  fallback: string | null = null,
): string | null {
  const n = normText(rawSource);
  if (!n) return fallback;
  if (n.startsWith("whatsapp sdr") || n === "auto_sdr") return "whatsapp_sdr";
  if (n === "whatsapp" || n === "chat") return "whatsapp";
  if (n === "manual" || n === "crm") return "manual";
  if (n === "site_chat" || n === "livechat") return "site_chat";
  if (n === "rd_webhook" || n === "rd station marketing") return "rd_webhook";
  return fallback;
}

export interface UtmAndAttributionInput {
  explicitSource?: string | null;
  explicitCampaign?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  utmTerm?: string | null;
  clickId?: string | null;
  gclid?: string | null;
  fbclid?: string | null;
  ctwaClid?: string | null;
  hasMetaAdReferral?: boolean;
  referrer?: string | null;
  landingPage?: string | null;
  channel?: string | null;
  entryChannel?: string | null;
}

export interface NormalizedMarketingAttribution {
  entryChannel: string | null;
  source: string | null; // deal_source_name (padrão RD CRM)
  campaign: string | null; // campaign_name = Ponto de Conversão (NUNCA utm_campaign)
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  clickId: string | null;
  landingPage: string | null;
}

const PAID_MEDIUM_RE =
  /\b(cpc|ppc|paid|paid_social|paidsocial|ads|adwords|shopping|display|pmax|performance_max|remarketing|retargeting|sponsored|trafego_pago|midia_paga|metaads|googleads|google\s+ads|facebook\s+ads|meta\s+ads|rede[-_\s]?pesquisa)\b/i;

const ORGANIC_MEDIUM_RE = /\b(organic|organico|seo)\b/i;

const OWN_COMPANY_DOMAIN_RE =
  /(?:^|\.)(?:tecfag[a-z0-9-]*|valem[a-z0-9-]*)\.com(?:\.br)?$|(?:^|\.)(?:tecfagchat|valemchat)\.up\.railway\.app$/i;

function stripOuterParens(val: string): string {
  return val.replace(/^\((.+)\)$/, "$1").trim();
}

function extractBareHostname(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  let host = trimmed.toLowerCase();
  if (/^https?:\/\//i.test(host)) {
    try {
      host = new URL(host).hostname.toLowerCase();
    } catch {
      return null;
    }
  } else {
    host = host.split(/[/?#]/)[0].replace(/:\d+$/, "");
  }
  if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(host)) return null;
  return host.replace(/^www\./, "");
}

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

function isSelfDomainHost(host: string, landingPage?: string | null): boolean {
  if (OWN_COMPANY_DOMAIN_RE.test(host)) return true;
  const landingHost = extractBareHostname(landingPage);
  if (landingHost && registrableRoot(host) === registrableRoot(landingHost)) {
    return true;
  }
  return false;
}

export interface ExtractedUrlTrackingParams {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  gclid: string | null;
  fbclid: string | null;
  msclkid: string | null;
  ttclid: string | null;
  clickId: string | null;
  landingPage: string | null;
}

/**
 * Percorre URLs em ordem cronológica (ex.: `lc_pageviews` ASC + `siteContext.entry.url`)
 * e extrai os primeiros parâmetros de rastreamento encontrados (UTMs e Click IDs),
 * priorizando como `landingPage` a primeira URL portadora de tracking.
 */
export function extractTrackingParamsFromUrls(
  ...urls: Array<string | null | undefined>
): ExtractedUrlTrackingParams {
  let utmSource: string | null = null;
  let utmMedium: string | null = null;
  let utmCampaign: string | null = null;
  let utmContent: string | null = null;
  let utmTerm: string | null = null;
  let gclid: string | null = null;
  let fbclid: string | null = null;
  let msclkid: string | null = null;
  let ttclid: string | null = null;
  let firstValidUrl: string | null = null;
  let firstTrackedUrl: string | null = null;

  for (const rawUrl of urls) {
    const cleanUrl = cleanStr(rawUrl, 1000);
    if (!cleanUrl) continue;
    if (!firstValidUrl) firstValidUrl = cleanUrl;
    try {
      const parsed = new URL(cleanUrl, "https://site.local");
      const s = cleanStr(parsed.searchParams.get("utm_source"), 200);
      const m = cleanStr(parsed.searchParams.get("utm_medium"), 200);
      const c = cleanStr(parsed.searchParams.get("utm_campaign"), 200);
      const ct = cleanStr(parsed.searchParams.get("utm_content"), 200);
      const tm = cleanStr(parsed.searchParams.get("utm_term"), 200);
      const gc =
        cleanStr(parsed.searchParams.get("gclid"), 250) ||
        cleanStr(parsed.searchParams.get("gbraid"), 250) ||
        cleanStr(parsed.searchParams.get("wbraid"), 250);
      const fb = cleanStr(parsed.searchParams.get("fbclid"), 250);
      const ms = cleanStr(parsed.searchParams.get("msclkid"), 250);
      const tt = cleanStr(parsed.searchParams.get("ttclid"), 250);

      const urlHasTracking = Boolean(s || m || c || ct || tm || gc || fb || ms || tt);
      if (urlHasTracking && !firstTrackedUrl) {
        firstTrackedUrl = cleanUrl;
      }

      if (!utmSource && s) utmSource = s;
      if (!utmMedium && m) utmMedium = m;
      if (!utmCampaign && c) utmCampaign = c;
      if (!utmContent && ct) utmContent = ct;
      if (!utmTerm && tm) utmTerm = tm;
      if (!gclid && gc) gclid = gc;
      if (!fbclid && fb) fbclid = fb;
      if (!msclkid && ms) msclkid = ms;
      if (!ttclid && tt) ttclid = tt;
    } catch {
      // ignore unparseable URL
    }
  }

  return {
    utmSource,
    utmMedium,
    utmCampaign,
    utmContent,
    utmTerm,
    gclid,
    fbclid,
    msclkid,
    ttclid,
    clickId: gclid || fbclid || msclkid || ttclid || null,
    landingPage: firstTrackedUrl || firstValidUrl,
  };
}

/**
 * Converte sinais de UTM / Click IDs / Referrals exatamente para a taxonomia oficial
 * de `deal_source_name` do RD Station CRM usada pelos dashboards de Marketing:
 * - "Busca Paga | Google" / "Busca Paga | google-shopping" / "Busca Paga | google-rede-pesquisa"
 * - "Busca Paga | Meta"
 * - "Busca Paga | Mercado Livre"
 * - "Busca Orgânica | Google"
 * - "Social | linktree"
 * - "Tráfego Direto" (incluindo "(direct)", "(none)", domínios próprios e chat do site sem UTM/referrer externo)
 * - "Referência | <domínio externo>"
 */
export function normalizeRdDealSource(input: UtmAndAttributionInput): string | null {
  const explicit = cleanStr(input.explicitSource, 160);
  const explicitClean = explicit && !isOperationalChannelLabel(explicit) ? explicit : null;

  // Se já veio formatado no padrão canônico do RD ("Categoria | Subfonte"), preserva fielmente —
  // exceto "Referência | <domínio próprio>" (auto-referência do próprio site → Tráfego Direto).
  if (explicitClean && /\s\|\s/.test(explicitClean)) {
    const refMatch = explicitClean.match(/^refer[eê]ncia\s*\|\s*(.+)$/i);
    if (refMatch) {
      const refHost = extractBareHostname(refMatch[1]);
      if (refHost && isSelfDomainHost(refHost, input.landingPage)) {
        return "Tráfego Direto";
      }
    }
    return explicitClean;
  }

  const landingTracking = input.landingPage ? extractTrackingParamsFromUrls(input.landingPage) : null;
  const effectiveUtmSource = cleanStr(input.utmSource, 160) || landingTracking?.utmSource || null;
  const effectiveUtmMedium = cleanStr(input.utmMedium, 160) || landingTracking?.utmMedium || null;
  const rawSourceOriginal = effectiveUtmSource || explicitClean;
  const rawSourceToken = normText(rawSourceOriginal);
  const rawSourceBare = stripOuterParens(rawSourceToken);
  const rawMedium = stripOuterParens(normText(effectiveUtmMedium));
  const rawChannel = normText(input.channel);
  const refNorm = normText(input.referrer);
  const effectiveClickId = cleanStr(input.clickId, 250);
  const hasGclid =
    Boolean(cleanStr(input.gclid)) ||
    Boolean(landingTracking?.gclid) ||
    Boolean(effectiveClickId && /^(Cj0K|EAIa|CjwK)/i.test(effectiveClickId));
  const hasFbclid =
    Boolean(cleanStr(input.fbclid)) ||
    Boolean(landingTracking?.fbclid) ||
    Boolean(effectiveClickId && /^(IwAR|IwZX|PAZX)/i.test(effectiveClickId));
  const hasMsclkid = Boolean(landingTracking?.msclkid);
  const hasTtclid = Boolean(landingTracking?.ttclid);
  const hasCtwa = Boolean(cleanStr(input.ctwaClid)) || Boolean(input.hasMetaAdReferral);

  const isPaidChannel =
    rawChannel === "paid search" ||
    rawChannel === "busca paga" ||
    rawChannel === "display" ||
    rawChannel === "other advertising" ||
    rawChannel === "paid social";

  const isPaid =
    hasGclid ||
    hasFbclid ||
    hasMsclkid ||
    hasTtclid ||
    hasCtwa ||
    isPaidChannel ||
    PAID_MEDIUM_RE.test(rawMedium) ||
    PAID_MEDIUM_RE.test(rawSourceBare);

  if (
    hasCtwa ||
    (isPaid && /\b(meta|metaads|fb|ig|facebook|instagram)\b/.test(rawSourceBare)) ||
    (hasFbclid && !rawSourceBare)
  ) {
    return "Busca Paga | Meta";
  }

  // Preserva subfontes pagas compostas do Google usadas pelo Marketing (ex.: google-shopping, google-rede-pesquisa)
  if (isPaid && /^google[-_][a-z0-9_-]+$/i.test(rawSourceBare)) {
    return `Busca Paga | ${rawSourceOriginal || rawSourceBare}`;
  }

  if (hasGclid || (isPaid && /\b(google|googleads|google ads|adwords)\b/.test(rawSourceBare))) {
    return "Busca Paga | Google";
  }

  if (isPaid && /\b(mercadolivre|mercado livre|meli)\b/.test(rawSourceBare)) {
    return "Busca Paga | Mercado Livre";
  }

  if (hasMsclkid || (isPaid && /\bbing\b/.test(rawSourceBare))) {
    return "Busca Paga | Bing";
  }

  if (isPaid && /\blinkedin\b/.test(rawSourceBare)) {
    return "Busca Paga | LinkedIn";
  }

  if (hasTtclid || (isPaid && /\btiktok\b/.test(rawSourceBare))) {
    return "Busca Paga | TikTok";
  }

  if (isPaid && rawSourceBare) {
    return `Busca Paga | ${rawSourceOriginal || rawSourceBare}`;
  }

  // Tráfego Direto: "(direct)", "direct", "direto", "(none)", "trafego direto", canal "Direct"
  if (
    rawSourceBare === "direct" ||
    rawSourceBare === "direto" ||
    rawSourceBare === "none" ||
    rawSourceBare === "trafego direto" ||
    rawSourceBare === "acesso direto" ||
    rawSourceBare === "direct traffic" ||
    (!rawSourceBare && (rawChannel === "direct" || rawChannel === "trafego direto"))
  ) {
    return "Tráfego Direto";
  }

  // Domínio / URL como fonte: auto-referência do próprio site -> Tráfego Direto; domínio externo -> canal ou Referência
  const sourceHost = extractBareHostname(rawSourceOriginal);
  if (sourceHost) {
    if (isSelfDomainHost(sourceHost, input.landingPage)) {
      return "Tráfego Direto";
    }
    if (/(^|\.)google\./.test(sourceHost)) return "Busca Orgânica | Google";
    if (/(^|\.)bing\./.test(sourceHost)) return "Busca Orgânica | Bing";
    if (/(^|\.)yahoo\./.test(sourceHost)) return "Busca Orgânica | Yahoo";
    if (/(^|\.)linktr\.ee$/.test(sourceHost)) return "Social | linktree";
    if (/(^|\.)instagram\.com$/.test(sourceHost)) return "Social | Instagram";
    if (/(^|\.)facebook\.com$|(^|\.)fb\.com$/.test(sourceHost)) return "Social | Facebook";
    if (/(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(sourceHost)) return "Social | YouTube";
    return `Referência | ${sourceHost}`;
  }

  // Orgânico / Social / E-mail
  if (
    (/\bgoogle\b/.test(rawSourceBare) &&
      (!rawMedium || rawMedium === "none" || ORGANIC_MEDIUM_RE.test(rawMedium) || rawChannel === "organic search")) ||
    (!rawSourceBare && refNorm.includes("google."))
  ) {
    return "Busca Orgânica | Google";
  }

  if (
    (/\bbing\b/.test(rawSourceBare) &&
      (!rawMedium || rawMedium === "none" || ORGANIC_MEDIUM_RE.test(rawMedium) || rawChannel === "organic search")) ||
    (!rawSourceBare && refNorm.includes("bing."))
  ) {
    return "Busca Orgânica | Bing";
  }

  if (/\byahoo\b/.test(rawSourceBare) || (!rawSourceBare && refNorm.includes("yahoo."))) {
    return "Busca Orgânica | Yahoo";
  }

  if (
    /(?:^|[\s_-])linktree(?:$|[\s_-])|linktr\.ee/i.test(rawSourceBare) ||
    refNorm.includes("linktr.ee")
  ) {
    return "Social | linktree";
  }

  if (/\b(instagram|ig)\b/.test(rawSourceBare) || refNorm.includes("instagram.com")) {
    return "Social | Instagram";
  }

  if (/\b(facebook|fb)\b/.test(rawSourceBare) || refNorm.includes("facebook.com")) {
    return "Social | Facebook";
  }

  if (/\byoutube\b/.test(rawSourceBare) || refNorm.includes("youtube.com")) {
    return "Social | YouTube";
  }

  if (
    /\b(email|e-mail|newsletter|rdstation)\b/.test(rawMedium) ||
    /\b(newsletter)\b/.test(rawSourceBare) ||
    rawChannel === "email"
  ) {
    return "E-mail Marketing";
  }

  // Referrer de domínio externo sem UTM -> Referência | <domínio>; domínio próprio -> Tráfego Direto
  const refHost = extractBareHostname(input.referrer);
  if (!rawSourceBare && refHost) {
    if (isSelfDomainHost(refHost, input.landingPage)) {
      return "Tráfego Direto";
    }
    return `Referência | ${refHost}`;
  }

  if (explicitClean) {
    return explicitClean;
  }

  if (input.entryChannel === "site_chat" || input.entryChannel === "livechat") {
    return "Tráfego Direto";
  }

  return null;
}

/**
 * Extrai atribuição de anúncios Click-to-WhatsApp (CTWA) vindos no campo `referral`
 * do webhook oficial da Meta Cloud API.
 */
export function extractMetaReferralAttribution(rawPayload: unknown): NormalizedMarketingAttribution | null {
  if (!rawPayload || typeof rawPayload !== "object") return null;
  const msg = rawPayload as Record<string, any>;
  const ref = msg.referral;
  if (!ref || typeof ref !== "object") return null;

  const sourceType = normText(ref.source_type);
  const ctwaClid = cleanStr(ref.ctwa_clid, 250);
  const sourceId = cleanStr(ref.source_id, 160);
  const headline = cleanStr(ref.headline, 180);
  const sourceUrl = cleanStr(ref.source_url, 1000);

  let utmSource: string | null = null;
  let utmMedium: string | null = null;
  let utmCampaign: string | null = null;
  let utmContent: string | null = null;
  let utmTerm: string | null = null;
  let fbclid: string | null = null;

  if (sourceUrl) {
    try {
      const parsed = new URL(sourceUrl);
      utmSource = cleanStr(parsed.searchParams.get("utm_source"), 200);
      utmMedium = cleanStr(parsed.searchParams.get("utm_medium"), 200);
      utmCampaign = cleanStr(parsed.searchParams.get("utm_campaign"), 200);
      utmContent = cleanStr(parsed.searchParams.get("utm_content"), 200);
      utmTerm = cleanStr(parsed.searchParams.get("utm_term"), 200);
      fbclid = cleanStr(parsed.searchParams.get("fbclid"), 250);
    } catch {
      // URL não parseável; mantém dados diretos do referral
    }
  }

  const isAd = sourceType === "ad" || Boolean(ctwaClid);
  const source = normalizeRdDealSource({
    utmSource: utmSource || "meta",
    utmMedium: utmMedium || (isAd ? "cpc" : "social"),
    ctwaClid,
    fbclid,
    hasMetaAdReferral: isAd,
    entryChannel: "whatsapp",
  });

  const conversionLabel = headline
    ? `CTWA | ${headline}`.slice(0, 200)
    : sourceId
      ? `CTWA | Ad ${sourceId}`
      : "CTWA | Meta Ads";

  return {
    entryChannel: "whatsapp",
    source: source || (isAd ? "Busca Paga | Meta" : "Social | Instagram"),
    campaign: conversionLabel,
    utmSource: utmSource || "meta",
    utmMedium: utmMedium || (isAd ? "cpc" : "social"),
    utmCampaign: utmCampaign || headline || sourceId || null,
    utmContent: utmContent || sourceId || null,
    utmTerm,
    clickId: ctwaClid || fbclid || sourceId || null,
    landingPage: sourceUrl,
  };
}

/**
 * Extrai atribuição do contexto de navegação do visitante no site (LiveChat / Widget VTEX).
 */
export function extractSiteContextAttribution(
  siteContext: SiteContext | null | undefined,
  conversionPointLabel = "Chat Site",
): NormalizedMarketingAttribution | null {
  if (!siteContext) return null;
  const entry = siteContext.entry || siteContext.page;
  if (!entry) return null;

  const entryUtm = entry.utm || {};
  const pageUtm = siteContext.page?.utm || {};
  const urlTracking = extractTrackingParamsFromUrls(entry.url, siteContext.page?.url);

  const utmSource = cleanStr(entryUtm.utm_source, 200) || cleanStr(pageUtm.utm_source, 200) || urlTracking.utmSource;
  const utmMedium = cleanStr(entryUtm.utm_medium, 200) || cleanStr(pageUtm.utm_medium, 200) || urlTracking.utmMedium;
  const utmCampaign =
    cleanStr(entryUtm.utm_campaign, 200) || cleanStr(pageUtm.utm_campaign, 200) || urlTracking.utmCampaign;
  const utmContent =
    cleanStr(entryUtm.utm_content, 200) || cleanStr(pageUtm.utm_content, 200) || urlTracking.utmContent;
  const utmTerm = cleanStr(entryUtm.utm_term, 200) || cleanStr(pageUtm.utm_term, 200) || urlTracking.utmTerm;

  const externalReferrer = isExternalSiteReferrer(entry.referrer, entry.url)
    ? entry.referrer
    : isExternalSiteReferrer(siteContext.page?.referrer, siteContext.page?.url)
      ? siteContext.page?.referrer
      : entry.referrer;

  const landingPage = urlTracking.landingPage || cleanStr(entry.url, 1000);

  const source = normalizeRdDealSource({
    utmSource,
    utmMedium,
    utmCampaign,
    gclid: urlTracking.gclid,
    fbclid: urlTracking.fbclid,
    clickId: urlTracking.clickId,
    referrer: externalReferrer,
    landingPage,
    entryChannel: "site_chat",
  });

  return {
    entryChannel: "site_chat",
    source: source || "Tráfego Direto",
    campaign: conversionPointLabel,
    utmSource,
    utmMedium,
    utmCampaign,
    utmContent,
    utmTerm,
    clickId: urlTracking.clickId,
    landingPage,
  };
}

export interface VisitorJourneyAttributionResult {
  attribution: NormalizedMarketingAttribution;
  hasExplicitTracking: boolean;
  enrichedSiteContext: SiteContext | null;
}

/**
 * Resolve a atribuição real da jornada do visitante no site combinando:
 * `lc_pageviews` (ordem cronológica ASC — mesma fonte do modal Jornada do Cliente),
 * `lc_visitors` (referrer externo persistido) e `siteContext` da conexão atual.
 * Isolado estritamente por `tenantId`.
 */
export async function resolveVisitorJourneyAttributionInTx(
  tx: any,
  tenantId: string,
  params: {
    visitorIds?: string[];
    cookieIds?: string[];
    siteContext?: SiteContext | null;
    conversionPointLabel?: string | null;
  },
): Promise<VisitorJourneyAttributionResult | null> {
  const conversionPointLabel = params.conversionPointLabel || getDefaultSiteCampaignLabel(tenantId);
  const visitorIdList = Array.from(
    new Set((params.visitorIds || []).map((v) => String(v || "").trim()).filter(Boolean)),
  );
  const cookieIdList = Array.from(
    new Set((params.cookieIds || []).map((c) => String(c || "").trim()).filter(Boolean)),
  );

  let matchedVisitors: Array<{
    id: string;
    cookieId: string;
    currentUrl: string | null;
    currentTitle: string | null;
    referrer: string | null;
  }> = [];

  try {
    if (visitorIdList.length > 0) {
      matchedVisitors = await tx
        .select({
          id: lcVisitors.id,
          cookieId: lcVisitors.cookieId,
          currentUrl: lcVisitors.currentUrl,
          currentTitle: lcVisitors.currentTitle,
          referrer: lcVisitors.referrer,
        })
        .from(lcVisitors)
        .where(and(eq(lcVisitors.tenantId, tenantId), inArray(lcVisitors.id, visitorIdList)))
        .orderBy(desc(lcVisitors.lastSeenAt))
        .limit(10);
    }
    if (matchedVisitors.length === 0 && cookieIdList.length > 0) {
      matchedVisitors = await tx
        .select({
          id: lcVisitors.id,
          cookieId: lcVisitors.cookieId,
          currentUrl: lcVisitors.currentUrl,
          currentTitle: lcVisitors.currentTitle,
          referrer: lcVisitors.referrer,
        })
        .from(lcVisitors)
        .where(and(eq(lcVisitors.tenantId, tenantId), inArray(lcVisitors.cookieId, cookieIdList)))
        .orderBy(desc(lcVisitors.lastSeenAt))
        .limit(10);
    }
  } catch {
    // Em ambientes de teste com mocks parciais sem lc_visitors, segue com siteContext
  }

  const allVisitorIds = Array.from(new Set([...visitorIdList, ...matchedVisitors.map((v) => v.id)]));
  let pageviewRows: Array<{ url: string; title: string | null }> = [];
  if (allVisitorIds.length > 0) {
    try {
      pageviewRows = await tx
        .select({
          url: lcPageviews.url,
          title: lcPageviews.title,
        })
        .from(lcPageviews)
        .where(and(eq(lcPageviews.tenantId, tenantId), inArray(lcPageviews.visitorId, allVisitorIds)))
        .orderBy(asc(lcPageviews.visitedAt))
        .limit(60);
    } catch {
      // Ignora em mocks parciais sem lc_pageviews
    }
  }

  const sc = params.siteContext || null;
  if (!sc && matchedVisitors.length === 0 && pageviewRows.length === 0) {
    return null;
  }

  const candidateUrls: Array<string | null | undefined> = [
    ...pageviewRows.map((pv) => pv.url),
    sc?.entry?.url,
    ...matchedVisitors.map((v) => v.currentUrl),
    sc?.page?.url,
  ];
  const urlTracking = extractTrackingParamsFromUrls(...candidateUrls);

  const utmSource =
    urlTracking.utmSource || cleanStr(sc?.entry?.utm?.utm_source, 200) || cleanStr(sc?.page?.utm?.utm_source, 200);
  const utmMedium =
    urlTracking.utmMedium || cleanStr(sc?.entry?.utm?.utm_medium, 200) || cleanStr(sc?.page?.utm?.utm_medium, 200);
  const utmCampaign =
    urlTracking.utmCampaign ||
    cleanStr(sc?.entry?.utm?.utm_campaign, 200) ||
    cleanStr(sc?.page?.utm?.utm_campaign, 200);
  const utmContent =
    urlTracking.utmContent ||
    cleanStr(sc?.entry?.utm?.utm_content, 200) ||
    cleanStr(sc?.page?.utm?.utm_content, 200);
  const utmTerm =
    urlTracking.utmTerm || cleanStr(sc?.entry?.utm?.utm_term, 200) || cleanStr(sc?.page?.utm?.utm_term, 200);

  const candidateReferrers = [
    sc?.entry?.referrer,
    ...matchedVisitors.map((v) => v.referrer),
    sc?.page?.referrer,
  ];
  const externalReferrer =
    candidateReferrers.find((r) => isExternalSiteReferrer(r, urlTracking.landingPage || sc?.page?.url)) ||
    null;

  const hasExplicitTracking = Boolean(
    utmSource || utmMedium || utmCampaign || urlTracking.clickId || externalReferrer,
  );

  const source =
    normalizeRdDealSource({
      utmSource,
      utmMedium,
      utmCampaign,
      gclid: urlTracking.gclid,
      fbclid: urlTracking.fbclid,
      clickId: urlTracking.clickId,
      referrer: externalReferrer,
      landingPage: urlTracking.landingPage,
      entryChannel: "site_chat",
    }) || "Tráfego Direto";

  // Enriquece siteContext.entry com a página real de entrada da jornada (ex.: URL com UTM de pageviews[0])
  let enrichedSiteContext: SiteContext | null = sc;
  if (sc && (urlTracking.landingPage || externalReferrer)) {
    const currentEntryTracking = extractTrackingParamsFromUrls(sc.entry?.url);
    const currentEntryHasSignals = Boolean(
      currentEntryTracking.utmSource ||
        currentEntryTracking.clickId ||
        Object.keys(sc.entry?.utm || {}).length > 0 ||
        isExternalSiteReferrer(sc.entry?.referrer, sc.entry?.url),
    );
    if (!currentEntryHasSignals && hasExplicitTracking) {
      const matchedPv = pageviewRows.find((pv) => pv.url === urlTracking.landingPage);
      try {
        const pageOrigin = new URL(sc.page.url).origin;
        const rebuilt = captureSiteContext(
          {
            entry: {
              url: urlTracking.landingPage || sc.entry.url,
              title: matchedPv?.title || sc.entry.title,
              referrer: externalReferrer || sc.entry.referrer,
            },
            page: sc.page,
            product: sc.product || undefined,
          },
          pageOrigin,
          new Date(sc.capturedAt),
          Boolean(sc.product),
        );
        if (rebuilt) enrichedSiteContext = rebuilt;
      } catch {
        // mantém sc original
      }
    }
  }

  return {
    attribution: {
      entryChannel: "livechat",
      source,
      campaign: conversionPointLabel,
      utmSource,
      utmMedium,
      utmCampaign,
      utmContent,
      utmTerm,
      clickId: urlTracking.clickId,
      landingPage: urlTracking.landingPage,
    },
    hasExplicitTracking,
    enrichedSiteContext,
  };
}

/**
 * Mapeia o nome de um funil específico (ou funil original do RD) para o enum fechado `MarketingSector`.
 * Retorna `null` se o funil for unificado/compartilhado (ex.: FUNIL CWR), exigindo resolução pelo operador/etapa.
 */
export function resolveSectorFromPipelineName(
  pipelineName: string | null | undefined,
  pipelineId?: string | null,
): MarketingSector | null {
  const n = normText(pipelineName);
  const pid = normText(pipelineId);

  if (pid === "pipe-tecfag-funil-testes" || (n.includes("teste") && !n.includes("arquivo") && !n.includes("historico"))) {
    return "teste";
  }
  if (n.includes("cwr") || n.includes("war room") || n.includes("esforco") || n.includes("v31")) {
    return null; // Funil unificado: setor depende da divisão do responsável / etapa
  }
  if (n.includes("arquivo") || n.includes("historico") || pid === "pipe-tecfag-testes") {
    return null; // Arquivo legado: setor vem de funil_original_rd ou divisão
  }
  if (n.includes("maquina") || n.includes("semi industrial") || n.includes("semi-industrial")) {
    return "semi_industrial";
  }
  if (n.includes("personnalite") || n.includes("personalite")) {
    return "personnalite";
  }
  if (n.includes("projeto")) {
    return "projetos";
  }
  if (n.includes("peca")) {
    return "pecas";
  }
  if (n.includes("sdr") || n.includes("triagem") || n.includes("pre-venda") || n.includes("pre venda")) {
    return "pre_venda";
  }
  if (n.includes("suporte") || n.includes("assistencia") || n.includes("pos venda") || n.includes("pos-venda")) {
    return "suporte_tecnico";
  }
  if (n.includes("externo")) {
    return "externo";
  }
  if (n.includes("financeiro") || n.includes("cobranca")) {
    return "financeiro";
  }
  return null;
}

export function resolveSectorFromOperatorContext(params: {
  operatorDivision?: string | null;
  operatorSectorNames?: string[];
  stageName?: string | null;
  customFields?: Record<string, unknown> | null;
}): MarketingSector {
  const sectorNamesNorm = (params.operatorSectorNames || []).map(normText);

  // 1. Se o operador pertence explicitamente ao setor de SDR / Pré-venda, Projetos, Peças, Suporte ou Financeiro
  if (sectorNamesNorm.some((s) => s === "sdr" || s.includes("pre venda") || s.includes("pre-venda") || s.includes("triagem"))) {
    return "pre_venda";
  }
  if (sectorNamesNorm.some((s) => s.includes("projeto")) && !params.operatorDivision) {
    return "projetos";
  }
  if (sectorNamesNorm.some((s) => s.includes("peca"))) {
    return "pecas";
  }
  if (sectorNamesNorm.some((s) => s.includes("suporte") || s.includes("assistencia") || s.includes("pos venda") || s.includes("pos-venda"))) {
    return "suporte_tecnico";
  }
  if (sectorNamesNorm.some((s) => s.includes("financeiro"))) {
    return "financeiro";
  }

  // 2. Divisão comercial oficial (commercial_consultant_profiles — mesma fonte das metas)
  const div = normText(params.operatorDivision);
  if (div === "maquinas" || div === "semi_industrial") return "semi_industrial";
  if (div === "personnalite" || div === "personalite") return "personnalite";

  // 3. Setores comerciais de atendimento
  if (sectorNamesNorm.some((s) => s.includes("personnalite") || s.includes("personalite"))) {
    return "personnalite";
  }
  if (sectorNamesNorm.some((s) => s.includes("maquina"))) {
    return "semi_industrial";
  }
  if (sectorNamesNorm.some((s) => s.includes("projeto"))) {
    return "projetos";
  }

  // 4. Etapa de pré-qualificação no funil unificado quando sem consultor comercial definido
  const stg = normText(params.stageName);
  if (
    stg === "prospects" ||
    stg === "contatar" ||
    stg === "contatando" ||
    stg.includes("pre-qualific") ||
    stg.includes("pre qualific") ||
    stg === "qualificando" ||
    stg === "para triar" ||
    stg === "em triagem" ||
    stg.includes("para analise")
  ) {
    return "pre_venda";
  }

  // 5. Fallback por customFields legados do RD ("Equipes do Responsável")
  const cf = params.customFields || {};
  const rawTeams = normText(
    cf["cf-tf-deal-equipes-responsavel"] || cf["Equipes do Responsável"] || "",
  );
  if (rawTeams.includes("projeto") && !rawTeams.includes("maquina")) return "projetos";
  if (rawTeams.includes("personnalite") && !rawTeams.includes("maquina")) return "personnalite";
  if (rawTeams.includes("maquina")) return "semi_industrial";

  return "pre_venda";
}

/**
 * Resolve o setor atual (`sector_current`) de uma negociação combinando:
 * flag de teste -> setor explícito -> legado (`funil_original_rd`) -> funil específico -> divisão/setor do operador (CWR).
 */
export function resolveDealCurrentSector(params: {
  isTest?: boolean;
  isLegacy?: boolean;
  explicitSector?: string | null;
  pipelineId?: string | null;
  pipelineName?: string | null;
  stageId?: string | null;
  stageName?: string | null;
  operatorDivision?: string | null;
  operatorSectorNames?: string[];
  customFields?: Record<string, unknown> | null;
}): MarketingSector {
  if (params.isTest) return "teste";

  if (params.explicitSector && isValidMarketingSector(params.explicitSector)) {
    return params.explicitSector;
  }

  const cf = params.customFields || {};
  const origRdFunnel = cleanStr(cf.funil_original_rd, 200);
  if (params.isLegacy && origRdFunnel) {
    const fromOrig = resolveSectorFromPipelineName(origRdFunnel);
    if (fromOrig) return fromOrig;
  }

  const fromPipeline = resolveSectorFromPipelineName(params.pipelineName, params.pipelineId);
  if (fromPipeline) return fromPipeline;

  if (origRdFunnel) {
    const fromOrigFallback = resolveSectorFromPipelineName(origRdFunnel);
    if (fromOrigFallback) return fromOrigFallback;
  }

  return resolveSectorFromOperatorContext({
    operatorDivision: params.operatorDivision,
    operatorSectorNames: params.operatorSectorNames,
    stageName: params.stageName,
    customFields: cf,
  });
}

/**
 * Regra de imutabilidade de `sector_origin`:
 * - Na criação, recebe o setor inicial.
 * - Enquanto estiver como `'pre_venda'` (ou nulo), assim que o card ganhar pela 1ª vez
 *   um setor comercial definitivo (`semi_industrial`, `personnalite`, `projetos`, `pecas`),
 *   `sector_origin` grava esse primeiro setor comercial e NUNCA MAIS MUDA (mesmo que depois
 *   o card pule entre Máquinas e Personnalité).
 */
export function computeLockedSectorOrigin(
  previousSectorOrigin: string | null | undefined,
  nextSectorCurrent: MarketingSector,
): MarketingSector {
  if (!previousSectorOrigin || !isValidMarketingSector(previousSectorOrigin)) {
    return nextSectorCurrent;
  }
  if (
    previousSectorOrigin === "pre_venda" &&
    COMMERCIAL_DEFINITIVE_SECTORS.has(nextSectorCurrent)
  ) {
    return nextSectorCurrent;
  }
  return previousSectorOrigin;
}

/**
 * Verifica se a etapa representa vitória comercial (`FECHAMENTO` / `VENDA CONCLUÍDA` / `isWinStage`),
 * excluindo etapas administrativas como `FINALIZADOS` de Suporte Técnico ou Financeiro.
 */
export function isEffectiveCommercialWin(params: {
  status: string | null | undefined;
  stageIsWin?: boolean | null;
  stageName?: string | null;
  sectorCurrent?: string | null;
}): boolean {
  if (params.status === "won") return true;
  if (params.status !== "open") return false;
  if (params.sectorCurrent === "suporte_tecnico" || params.sectorCurrent === "financeiro") {
    return false;
  }
  if (params.stageIsWin) return true;
  const stg = normText(params.stageName);
  return stg.startsWith("fechamento") || stg.startsWith("venda concluida");
}

/**
 * Carrega no banco (dentro ou fora de transação) o contexto de setor de um operador e funil/etapa
 * estritamente isolado por `tenantId`.
 */
export async function loadDealSectorResolutionContext(
  tx: any,
  tenantId: string,
  pipelineId: string,
  stageId: string,
  operatorId: string | null | undefined,
): Promise<{
  pipelineName: string | null;
  stageName: string | null;
  stageIsWin: boolean;
  stageIsLoss: boolean;
  operatorDivision: string | null;
  operatorSectorNames: string[];
}> {
  const [pipeRows, stageRows, profileRows, allSectors] = await Promise.all([
    tx
      .select({ name: crmPipelines.name })
      .from(crmPipelines)
      .where(and(eq(crmPipelines.tenantId, tenantId), eq(crmPipelines.id, pipelineId)))
      .limit(1),
    tx
      .select({
        name: crmStages.name,
        isWinStage: crmStages.isWinStage,
        isLossStage: crmStages.isLossStage,
      })
      .from(crmStages)
      .where(and(eq(crmStages.tenantId, tenantId), eq(crmStages.id, stageId)))
      .limit(1),
    operatorId
      ? tx
          .select({ division: commercialConsultantProfiles.division })
          .from(commercialConsultantProfiles)
          .where(
            and(
              eq(commercialConsultantProfiles.tenantId, tenantId),
              eq(commercialConsultantProfiles.operatorId, operatorId),
            ),
          )
          .limit(1)
      : Promise.resolve([]),
    operatorId
      ? tx
          .select({ name: sectors.name, operatorIds: sectors.operatorIds })
          .from(sectors)
          .where(eq(sectors.tenantId, tenantId))
      : Promise.resolve([]),
  ]);

  const operatorSectorNames = operatorId
    ? allSectors
        .filter((s: any) => Array.isArray(s.operatorIds) && s.operatorIds.includes(operatorId))
        .map((s: any) => String(s.name || ""))
    : [];

  return {
    pipelineName: pipeRows[0]?.name || null,
    stageName: stageRows[0]?.name || null,
    stageIsWin: Boolean(stageRows[0]?.isWinStage),
    stageIsLoss: Boolean(stageRows[0]?.isLossStage),
    operatorDivision: profileRows[0]?.division || null,
    operatorSectorNames,
  };
}

/**
 * Herda atribuição de marketing (source, campaign, UTMs, clickId, landingPage) a partir
 * da conversa (mensagens com `marketingAttribution` ou `siteContext`) ou do contato (`contacts`).
 */
export async function resolveInheritedMarketingAttribution(
  tx: any,
  tenantId: string,
  params: {
    contactId?: string | null;
    conversationId?: string | null;
    siteConversationId?: string | null;
    isSiteOriginated?: boolean;
    explicitSource?: string | null;
    explicitCampaign?: string | null;
    explicitEntryChannel?: string | null;
    utmSource?: string | null;
    utmMedium?: string | null;
    utmCampaign?: string | null;
    utmContent?: string | null;
    utmTerm?: string | null;
    clickId?: string | null;
    landingPage?: string | null;
  },
): Promise<NormalizedMarketingAttribution> {
  const siteCampaignLabel = getDefaultSiteCampaignLabel(tenantId);
  const isSiteFlow = Boolean(
    params.isSiteOriginated ||
      params.siteConversationId ||
      isSiteConversationId(params.conversationId) ||
      params.explicitEntryChannel === "livechat" ||
      params.explicitEntryChannel === "site_chat",
  );
  const inferredChannel =
    cleanStr(params.explicitEntryChannel, 60) ||
    (isSiteFlow ? "livechat" : null) ||
    inferEntryChannelFromOperationalSource(
      params.explicitSource,
      params.conversationId ? "whatsapp" : "manual",
    );

  const normalizeSiteCampaign = (raw: string | null | undefined): string | null => {
    const cleaned = cleanStr(raw, 200);
    if (!cleaned) return null;
    if (normText(cleaned) === "chat site" && siteCampaignLabel !== "Chat Site") {
      return siteCampaignLabel;
    }
    return cleaned;
  };

  let convAttribution: Partial<NormalizedMarketingAttribution> | null = null;
  let convSiteContext: SiteContext | null = null;

  // 1. Verificar primeiro toque persistido no contato (também fornece siteVisitorId/linkedSiteContactIds)
  let contactRow: any = null;
  let priorDealRow: any = null;
  if (params.contactId) {
    try {
      const [c] = await tx
        .select({
          firstSource: contacts.firstSource,
          firstCampaign: contacts.firstCampaign,
          utmSource: contacts.utmSource,
          utmMedium: contacts.utmMedium,
          utmCampaign: contacts.utmCampaign,
          utmContent: contacts.utmContent,
          utmTerm: contacts.utmTerm,
          clickId: contacts.clickId,
          landingPage: contacts.landingPage,
          customFields: contacts.customFields,
        })
        .from(contacts)
        .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, params.contactId)))
        .limit(1);
      contactRow = c || null;
    } catch {
      // Ignora em mocks parciais
    }
  }

  // 2. Coletar IDs de visitante e conversas do site vinculadas para consultar jornada real (`lc_pageviews` / `lc_visitors`)
  const candidateVisitorIds = new Set<string>();
  const candidateCookieIds = new Set<string>();
  const candidateConvIds = new Set<string>();

  if (params.conversationId) candidateConvIds.add(params.conversationId);
  if (params.siteConversationId) candidateConvIds.add(params.siteConversationId);

  const vidFromSiteConv = params.siteConversationId
    ? visitorIdFromSiteConversation(params.siteConversationId)
    : null;
  const vidFromConv = params.conversationId
    ? visitorIdFromSiteConversation(params.conversationId)
    : null;
  if (vidFromSiteConv) candidateVisitorIds.add(vidFromSiteConv);
  if (vidFromConv) candidateVisitorIds.add(vidFromConv);
  if (params.contactId && params.contactId.startsWith("cont-lc-")) {
    const vid = params.contactId.slice("cont-lc-".length);
    if (vid) candidateVisitorIds.add(vid);
  }
  const contactCf =
    contactRow?.customFields && typeof contactRow.customFields === "object"
      ? (contactRow.customFields as Record<string, any>)
      : {};
  if (typeof contactCf.siteVisitorId === "string" && contactCf.siteVisitorId.trim()) {
    candidateVisitorIds.add(contactCf.siteVisitorId.trim());
  }
  if (typeof contactCf.siteCookieId === "string" && contactCf.siteCookieId.trim()) {
    candidateCookieIds.add(contactCf.siteCookieId.trim());
  }
  if (Array.isArray(contactCf.linkedSiteContactIds)) {
    for (const linkedId of contactCf.linkedSiteContactIds) {
      if (typeof linkedId === "string" && linkedId.startsWith("cont-lc-")) {
        const vid = linkedId.slice("cont-lc-".length);
        if (vid) candidateVisitorIds.add(vid);
      }
    }
  }
  for (const vid of candidateVisitorIds) {
    candidateConvIds.add(`conv-lc-${vid}`);
  }

  // 3. Verificar atribuição capturada nas mensagens recentes da conversa (Meta CTWA referral ou siteContext)
  const convIdsList = Array.from(candidateConvIds);
  if (convIdsList.length > 0) {
    try {
      const recentClientMsgs = await tx
        .select({ metaDetails: messages.metaDetails })
        .from(messages)
        .where(
          and(
            eq(messages.tenantId, tenantId),
            convIdsList.length === 1
              ? eq(messages.conversationId, convIdsList[0])
              : inArray(messages.conversationId, convIdsList),
            eq(messages.senderType, "client"),
            eq(messages.isInternalNote, false),
          ),
        )
        .orderBy(desc(messages.sentAt))
        .limit(20);

      for (const row of recentClientMsgs) {
        const meta = (row.metaDetails || {}) as Record<string, any>;
        const sc = readSiteContext(meta.siteContext);
        if (sc && !convSiteContext) {
          convSiteContext = sc;
        }
        const metaAttr =
          meta.marketingAttribution && typeof meta.marketingAttribution === "object"
            ? (meta.marketingAttribution as Partial<NormalizedMarketingAttribution>)
            : sc
              ? extractSiteContextAttribution(sc, siteCampaignLabel)
              : null;
        if (metaAttr) {
          const hasRich = Boolean(
            metaAttr.utmSource ||
              metaAttr.clickId ||
              (metaAttr.source &&
                !isOperationalChannelLabel(metaAttr.source) &&
                normText(metaAttr.source) !== "contato pelo site" &&
                normText(metaAttr.source) !== "trafego direto"),
          );
          if (!convAttribution || hasRich) {
            convAttribution = metaAttr;
            if (hasRich) break;
          }
        }
      }
    } catch {
      // Ignora em ambientes de teste com mocks parciais
    }
  }

  if (!convSiteContext && contactCf.siteContext) {
    convSiteContext = readSiteContext(contactCf.siteContext);
  }
  if (!convAttribution && convSiteContext) {
    convAttribution = extractSiteContextAttribution(convSiteContext, siteCampaignLabel);
  }

  // 4. Consultar jornada real do visitante no site (`lc_pageviews` + `lc_visitors`)
  const journeyResolution =
    candidateVisitorIds.size > 0 || candidateCookieIds.size > 0
      ? await resolveVisitorJourneyAttributionInTx(tx, tenantId, {
          visitorIds: Array.from(candidateVisitorIds),
          cookieIds: Array.from(candidateCookieIds),
          siteContext: convSiteContext,
          conversionPointLabel: siteCampaignLabel,
        })
      : null;
  const journeyAttr = journeyResolution?.attribution || null;

  // 5. Fallback para último deal com fonte válida do contato
  const contactValidFirstSource =
    contactRow?.firstSource && !isOperationalChannelLabel(contactRow.firstSource)
      ? cleanStr(contactRow.firstSource, 160)
      : null;

  const convHasExplicitTracking = Boolean(
    convAttribution?.utmSource ||
      convAttribution?.utmMedium ||
      convAttribution?.clickId ||
      (convAttribution?.source &&
        !isOperationalChannelLabel(convAttribution.source) &&
        normText(convAttribution.source) !== "contato pelo site" &&
        normText(convAttribution.source) !== "trafego direto"),
  );
  const hasCurrentVisitTracking = Boolean(
    journeyResolution?.hasExplicitTracking || convHasExplicitTracking,
  );

  if (params.contactId && !contactValidFirstSource && !hasCurrentVisitTracking) {
    try {
      const [d] = await tx
        .select({
          source: crmDeals.source,
          campaign: crmDeals.campaign,
          utmSource: crmDeals.utmSource,
          utmMedium: crmDeals.utmMedium,
          utmCampaign: crmDeals.utmCampaign,
          utmContent: crmDeals.utmContent,
          utmTerm: crmDeals.utmTerm,
          clickId: crmDeals.clickId,
          landingPage: crmDeals.landingPage,
        })
        .from(crmDeals)
        .where(
          and(
            eq(crmDeals.tenantId, tenantId),
            sql`EXISTS (
              SELECT 1 FROM crm_deal_contacts dc
              WHERE dc.tenant_id = ${tenantId}
                AND dc.deal_id = ${crmDeals.id}
                AND dc.contact_id = ${params.contactId}
            )`,
            sql`${crmDeals.source} IS NOT NULL AND ${crmDeals.source} != ''`,
          ),
        )
        .orderBy(desc(crmDeals.createdAt))
        .limit(1);
      if (d && !isOperationalChannelLabel(d.source)) {
        priorDealRow = d;
      }
    } catch {
      // Ignora em mocks parciais
    }
  }

  // Quando a visita/conversa atual possui rastreamento explícito (UTM, ClickID ou referrer externo),
  // mantemos os parâmetros dessa visita coesos sem misturar UTMs/clickId antigos de `contacts` ou deals anteriores.
  const utmSource =
    cleanStr(params.utmSource, 200) ||
    cleanStr(journeyAttr?.utmSource, 200) ||
    cleanStr(convAttribution?.utmSource, 200) ||
    (hasCurrentVisitTracking ? null : cleanStr(contactRow?.utmSource, 200) || cleanStr(priorDealRow?.utmSource, 200));
  const utmMedium =
    cleanStr(params.utmMedium, 200) ||
    cleanStr(journeyAttr?.utmMedium, 200) ||
    cleanStr(convAttribution?.utmMedium, 200) ||
    (hasCurrentVisitTracking ? null : cleanStr(contactRow?.utmMedium, 200) || cleanStr(priorDealRow?.utmMedium, 200));
  const utmCampaign =
    cleanStr(params.utmCampaign, 200) ||
    cleanStr(journeyAttr?.utmCampaign, 200) ||
    cleanStr(convAttribution?.utmCampaign, 200) ||
    (hasCurrentVisitTracking
      ? null
      : cleanStr(contactRow?.utmCampaign, 200) || cleanStr(priorDealRow?.utmCampaign, 200));
  const utmContent =
    cleanStr(params.utmContent, 200) ||
    cleanStr(journeyAttr?.utmContent, 200) ||
    cleanStr(convAttribution?.utmContent, 200) ||
    (hasCurrentVisitTracking
      ? null
      : cleanStr(contactRow?.utmContent, 200) || cleanStr(priorDealRow?.utmContent, 200));
  const utmTerm =
    cleanStr(params.utmTerm, 200) ||
    cleanStr(journeyAttr?.utmTerm, 200) ||
    cleanStr(convAttribution?.utmTerm, 200) ||
    (hasCurrentVisitTracking ? null : cleanStr(contactRow?.utmTerm, 200) || cleanStr(priorDealRow?.utmTerm, 200));
  const clickId =
    cleanStr(params.clickId, 250) ||
    cleanStr(journeyAttr?.clickId, 250) ||
    cleanStr(convAttribution?.clickId, 250) ||
    (hasCurrentVisitTracking ? null : cleanStr(contactRow?.clickId, 250) || cleanStr(priorDealRow?.clickId, 250));
  const landingPage =
    cleanStr(params.landingPage, 1000) ||
    (journeyResolution?.hasExplicitTracking ? cleanStr(journeyAttr?.landingPage, 1000) : null) ||
    cleanStr(convAttribution?.landingPage, 1000) ||
    cleanStr(journeyAttr?.landingPage, 1000) ||
    (hasCurrentVisitTracking
      ? null
      : cleanStr(contactRow?.landingPage, 1000) || cleanStr(priorDealRow?.landingPage, 1000));

  const explicitValidSource =
    params.explicitSource && !isOperationalChannelLabel(params.explicitSource)
      ? cleanStr(params.explicitSource, 160)
      : null;

  const journeyExplicitSource =
    journeyResolution?.hasExplicitTracking && journeyAttr?.source ? journeyAttr.source : null;
  const convValidSource =
    convAttribution?.source && !isOperationalChannelLabel(convAttribution.source)
      ? cleanStr(convAttribution.source, 160)
      : null;
  const nonGenericConvSource =
    convValidSource &&
    normText(convValidSource) !== "contato pelo site" &&
    normText(convValidSource) !== "trafego direto"
      ? convValidSource
      : null;
  const nonGenericContactSource =
    contactValidFirstSource &&
    normText(contactValidFirstSource) !== "contato pelo site"
      ? contactValidFirstSource
      : null;

  const source =
    normalizeRdDealSource({
      explicitSource:
        explicitValidSource ||
        journeyExplicitSource ||
        nonGenericConvSource ||
        nonGenericContactSource ||
        cleanStr(priorDealRow?.source, 160) ||
        (isSiteFlow ? journeyAttr?.source || convValidSource : contactValidFirstSource),
      utmSource,
      utmMedium,
      utmCampaign,
      clickId,
      landingPage,
      entryChannel: inferredChannel,
    }) || (isSiteFlow ? "Tráfego Direto" : null);

  const campaign =
    normalizeSiteCampaign(params.explicitCampaign) ||
    (isSiteFlow ? siteCampaignLabel : null) ||
    normalizeSiteCampaign(convAttribution?.campaign) ||
    normalizeSiteCampaign(contactRow?.firstCampaign) ||
    normalizeSiteCampaign(priorDealRow?.campaign) ||
    null;

  return {
    entryChannel:
      cleanStr(params.explicitEntryChannel, 60) ||
      (isSiteFlow ? "livechat" : null) ||
      convAttribution?.entryChannel ||
      inferredChannel,
    source,
    campaign,
    utmSource,
    utmMedium,
    utmCampaign,
    utmContent,
    utmTerm,
    clickId,
    landingPage,
  };
}
