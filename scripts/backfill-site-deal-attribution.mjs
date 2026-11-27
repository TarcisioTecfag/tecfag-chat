import { randomUUID } from "node:crypto";

const PAID_MEDIUM_RE =
  /\b(cpc|ppc|paid|paid_social|paidsocial|ads|adwords|shopping|display|pmax|performance_max|remarketing|retargeting|sponsored|trafego_pago|midia_paga|metaads|googleads|google\s+ads|facebook\s+ads|meta\s+ads|rede[-_\s]?pesquisa)\b/i;

const ORGANIC_MEDIUM_RE = /\b(organic|organico|seo)\b/i;

const OWN_COMPANY_DOMAIN_RE =
  /(?:^|\.)(?:tecfag[a-z0-9-]*|valem[a-z0-9-]*)\.com(?:\.br)?$|(?:^|\.)(?:tecfagchat|valemchat)\.up\.railway\.app$/i;

function normText(raw) {
  return String(raw || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function cleanStr(raw, maxLen = 500) {
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

function stripOuterParens(val) {
  return val.replace(/^\((.+)\)$/, "$1").trim();
}

function isOperationalOrGenericSource(rawSource) {
  const n = normText(rawSource);
  if (!n) return true;
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
    n === "contato pelo site" ||
    n === "nao informada" ||
    n === "nao informado" ||
    n.startsWith("whatsapp sdr")
  );
}

function extractBareHostname(raw) {
  if (!raw) return null;
  const trimmed = String(raw).trim();
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

function registrableRoot(host) {
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

function isSelfDomainHost(host, landingPage) {
  if (OWN_COMPANY_DOMAIN_RE.test(host)) return true;
  const landingHost = extractBareHostname(landingPage);
  if (landingHost && registrableRoot(host) === registrableRoot(landingHost)) {
    return true;
  }
  return false;
}

function isExternalReferrer(referrer, pageUrl) {
  const refHost = extractBareHostname(referrer);
  if (!refHost) return false;
  return !isSelfDomainHost(refHost, pageUrl);
}

export function extractTrackingFromUrls(urls) {
  let utmSource = null;
  let utmMedium = null;
  let utmCampaign = null;
  let utmContent = null;
  let utmTerm = null;
  let gclid = null;
  let fbclid = null;
  let msclkid = null;
  let ttclid = null;
  let trackedLandingPage = null;
  let firstValidUrl = null;

  for (const raw of urls) {
    const cleaned = cleanStr(raw, 1000);
    if (!cleaned) continue;
    if (!firstValidUrl) firstValidUrl = cleaned;
    try {
      const parsed = new URL(cleaned, "https://site.local");
      const s = cleanStr(parsed.searchParams.get("utm_source"), 200);
      const m = cleanStr(parsed.searchParams.get("utm_medium"), 200);
      const c = cleanStr(parsed.searchParams.get("utm_campaign"), 200);
      const ct = cleanStr(parsed.searchParams.get("utm_content"), 200);
      const t = cleanStr(parsed.searchParams.get("utm_term"), 200);
      const gc =
        cleanStr(parsed.searchParams.get("gclid"), 250) ||
        cleanStr(parsed.searchParams.get("gbraid"), 250) ||
        cleanStr(parsed.searchParams.get("wbraid"), 250);
      const fb = cleanStr(parsed.searchParams.get("fbclid"), 250);
      const ms = cleanStr(parsed.searchParams.get("msclkid"), 250);
      const tt = cleanStr(parsed.searchParams.get("ttclid"), 250);

      const hasAny = Boolean(s || m || c || ct || t || gc || fb || ms || tt);
      if (hasAny && !trackedLandingPage) trackedLandingPage = cleaned;

      if (!utmSource && s) utmSource = s;
      if (!utmMedium && m) utmMedium = m;
      if (!utmCampaign && c) utmCampaign = c;
      if (!utmContent && ct) utmContent = ct;
      if (!utmTerm && t) utmTerm = t;
      if (!gclid && gc) gclid = gc;
      if (!fbclid && fb) fbclid = fb;
      if (!msclkid && ms) msclkid = ms;
      if (!ttclid && tt) ttclid = tt;
    } catch {
      // ignora URL inválida
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
    landingPage: trackedLandingPage || firstValidUrl,
  };
}

export function normalizeSiteBackfillSource({
  explicitSource,
  utmSource,
  utmMedium,
  clickId,
  gclid,
  fbclid,
  msclkid,
  ttclid,
  referrer,
  landingPage,
}) {
  const urlFallback = landingPage ? extractTrackingFromUrls([landingPage]) : null;
  const effUtmSource = cleanStr(utmSource, 200) || urlFallback?.utmSource || null;
  const effUtmMedium = cleanStr(utmMedium, 200) || urlFallback?.utmMedium || null;
  const effClickId = cleanStr(clickId, 250) || urlFallback?.clickId || null;
  const effGclid =
    cleanStr(gclid, 250) ||
    urlFallback?.gclid ||
    (effClickId && /^(?:Cj0K|EAIa|CjwK)/i.test(effClickId) ? effClickId : null);
  const effFbclid =
    cleanStr(fbclid, 250) ||
    urlFallback?.fbclid ||
    (effClickId && /^(?:IwAR|IwZX|PAZX)/i.test(effClickId) ? effClickId : null);
  const effMsclkid = cleanStr(msclkid, 250) || urlFallback?.msclkid || null;
  const effTtclid = cleanStr(ttclid, 250) || urlFallback?.ttclid || null;

  const explicit = cleanStr(explicitSource, 160);
  const explicitClean = explicit && !isOperationalOrGenericSource(explicit) ? explicit : null;

  const rawSourceOriginal = effUtmSource || explicitClean;
  const rawSourceToken = normText(rawSourceOriginal);
  const rawSourceBare = stripOuterParens(rawSourceToken);
  const rawMedium = stripOuterParens(normText(effUtmMedium));
  const refNorm = normText(referrer);

  const isPaid =
    PAID_MEDIUM_RE.test(rawMedium) ||
    PAID_MEDIUM_RE.test(rawSourceBare) ||
    Boolean(effGclid || effFbclid || effMsclkid || effTtclid);

  if (effFbclid || (isPaid && /\b(meta|metaads|fb|ig|facebook|instagram)\b/.test(rawSourceBare))) {
    return "Busca Paga | Meta";
  }
  if (isPaid && /^google[-_][a-z0-9_-]+$/i.test(rawSourceBare)) {
    return `Busca Paga | ${rawSourceOriginal || rawSourceBare}`;
  }
  if (effGclid || (isPaid && /\b(google|googleads|google ads|adwords)\b/.test(rawSourceBare))) {
    return "Busca Paga | Google";
  }
  if (effMsclkid || (isPaid && /\bbing\b/.test(rawSourceBare))) {
    return "Busca Paga | Bing";
  }
  if (effTtclid || (isPaid && /\btiktok\b/.test(rawSourceBare))) {
    return "Busca Paga | TikTok";
  }
  if (isPaid && /\b(mercadolivre|mercado livre|meli)\b/.test(rawSourceBare)) {
    return "Busca Paga | Mercado Livre";
  }
  if (isPaid && /\blinkedin\b/.test(rawSourceBare)) {
    return "Busca Paga | LinkedIn";
  }
  if (isPaid && rawSourceBare) {
    return `Busca Paga | ${rawSourceOriginal || rawSourceBare}`;
  }

  if (explicitClean && /\s\|\s/.test(explicitClean)) {
    const refMatch = explicitClean.match(/^refer[eê]ncia\s*\|\s*(.+)$/i);
    if (refMatch) {
      const refHost = extractBareHostname(refMatch[1]);
      if (refHost && isSelfDomainHost(refHost, landingPage)) {
        return "Tráfego Direto";
      }
    }
    return explicitClean;
  }

  if (
    rawSourceBare === "direct" ||
    rawSourceBare === "direto" ||
    rawSourceBare === "none" ||
    rawSourceBare === "trafego direto" ||
    rawSourceBare === "acesso direto" ||
    rawSourceBare === "direct traffic"
  ) {
    return "Tráfego Direto";
  }

  const sourceHost = extractBareHostname(rawSourceOriginal);
  if (sourceHost) {
    if (isSelfDomainHost(sourceHost, landingPage)) return "Tráfego Direto";
    if (/(^|\.)google\./.test(sourceHost)) return "Busca Orgânica | Google";
    if (/(^|\.)bing\./.test(sourceHost)) return "Busca Orgânica | Bing";
    if (/(^|\.)yahoo\./.test(sourceHost)) return "Busca Orgânica | Yahoo";
    if (/(^|\.)linktr\.ee$/.test(sourceHost)) return "Social | linktree";
    if (/(^|\.)instagram\.com$/.test(sourceHost)) return "Social | Instagram";
    if (/(^|\.)facebook\.com$|(^|\.)fb\.com$/.test(sourceHost)) return "Social | Facebook";
    if (/(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(sourceHost)) return "Social | YouTube";
    return `Referência | ${sourceHost}`;
  }

  if (
    (/\bgoogle\b/.test(rawSourceBare) &&
      (!rawMedium || rawMedium === "none" || ORGANIC_MEDIUM_RE.test(rawMedium))) ||
    (!rawSourceBare && refNorm.includes("google."))
  ) {
    return "Busca Orgânica | Google";
  }
  if (
    (/\bbing\b/.test(rawSourceBare) &&
      (!rawMedium || rawMedium === "none" || ORGANIC_MEDIUM_RE.test(rawMedium))) ||
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
  if (
    /\b(instagram|ig)\b/.test(rawSourceBare) ||
    refNorm.includes("instagram.com") ||
    refNorm.includes("l.instagram.com")
  ) {
    return "Social | Instagram";
  }
  if (/\b(facebook|fb)\b/.test(rawSourceBare) || refNorm.includes("facebook.com")) {
    return "Social | Facebook";
  }
  if (/\byoutube\b/.test(rawSourceBare) || refNorm.includes("youtube.com")) {
    return "Social | YouTube";
  }
  if (/\blinkedin\b/.test(rawSourceBare) || refNorm.includes("linkedin.com")) {
    return "Social | LinkedIn";
  }
  if (/\btiktok\b/.test(rawSourceBare) || refNorm.includes("tiktok.com")) {
    return "Social | TikTok";
  }
  if (
    /\b(email|e-mail|newsletter|rdstation)\b/.test(rawMedium) ||
    /\b(newsletter)\b/.test(rawSourceBare)
  ) {
    return "E-mail Marketing";
  }

  const refHost = extractBareHostname(referrer);
  if (!rawSourceBare && refHost) {
    if (isSelfDomainHost(refHost, landingPage)) {
      return "Tráfego Direto";
    }
    return `Referência | ${refHost}`;
  }

  return explicitClean || "Tráfego Direto";
}

function detectHumanEdits(events) {
  let humanEditedSource = false;
  let humanEditedCampaign = false;
  for (const ev of events) {
    const isHuman =
      ev.source_channel === "crm_ui" ||
      ev.actor_type === "human" ||
      Boolean(ev.operator_id);
    if (!isHuman) continue;
    const type = String(ev.event_type || "").toLowerCase();
    const meta = ev.metadata && typeof ev.metadata === "object" ? ev.metadata : {};
    const changedFields = Array.isArray(meta.changedFields)
      ? meta.changedFields.map((f) => String(f).toLowerCase())
      : [];
    const field = typeof meta.field === "string" ? meta.field.toLowerCase() : "";

    if (
      type === "source_changed" ||
      field === "source" ||
      changedFields.includes("source") ||
      (meta.changes && typeof meta.changes === "object" && "source" in meta.changes)
    ) {
      humanEditedSource = true;
    }
    if (
      type === "campaign_changed" ||
      field === "campaign" ||
      changedFields.includes("campaign") ||
      (meta.changes && typeof meta.changes === "object" && "campaign" in meta.changes)
    ) {
      humanEditedCampaign = true;
    }
  }
  return { humanEditedSource, humanEditedCampaign };
}

async function ensureCatalogOptionTx(tx, tenantId, kind, name, cacheSet) {
  if (!name) return;
  const key = `${tenantId}::${kind}::${name.toLocaleLowerCase("pt-BR")}`;
  if (cacheSet.has(key)) return;
  cacheSet.add(key);

  const existing = await tx`
    SELECT id, archived_at
    FROM crm_catalog_items
    WHERE tenant_id = ${tenantId}
      AND kind = ${kind}
      AND lower(name) = lower(${name})
    LIMIT 1
  `;
  if (existing.length === 0) {
    await tx`
      INSERT INTO crm_catalog_items (id, tenant_id, kind, name, created_at, updated_at)
      VALUES (${randomUUID()}, ${tenantId}, ${kind}, ${name}, NOW(), NOW())
      ON CONFLICT DO NOTHING
    `;
  } else if (existing[0].archived_at) {
    await tx`
      UPDATE crm_catalog_items
      SET archived_at = NULL, updated_at = NOW()
      WHERE id = ${existing[0].id} AND tenant_id = ${tenantId}
    `;
  }
}

/**
 * Backfill idempotente de atribuição (Fonte, Campanha e UTMs) para cards originados
 * no Chat do Site (Fagner Site) de um tenant específico.
 *
 * Regras de segurança:
 * - Isolamento estrito por `tenant_id` (nunca toca outros tenants).
 * - Nunca modifica cards importados do RD Station (`id LIKE 'deal-rd-%'`).
 * - Preserva edições manuais humanas registradas em `crm_deal_events`.
 * - Recupera UTMs/ClickIDs/Referrers reais a partir de `lc_pageviews`, `lc_visitors`
 *   e `messages.meta_details` (mesma fonte da Jornada do Cliente).
 */
export async function runSiteDealAttributionBackfill(
  tx,
  targetTenantId,
  options = {},
) {
  const tenantId = String(targetTenantId || "").trim();
  if (!tenantId) {
    throw new Error("targetTenantId obrigatório para backfill de atribuição do site.");
  }
  const targetCampaign = options.targetCampaign || "Fagner | Vtex";

  const summary = {
    tenantId,
    targetCampaign,
    candidatesScanned: 0,
    dealsUpdated: 0,
    dealsSkippedHumanEdit: 0,
    contactsUpdated: 0,
    catalogArchived: 0,
    sourceBreakdown: {},
    sampleUpdates: [],
  };

  const deals = await tx`
    SELECT id, tenant_id, title, entry_channel, source, campaign,
           utm_source, utm_medium, utm_campaign, utm_content, utm_term,
           click_id, landing_page, created_at
    FROM crm_deals
    WHERE tenant_id = ${tenantId}
      AND id NOT LIKE 'deal-rd-%'
      AND (
        lower(coalesce(entry_channel, '')) IN ('livechat', 'site_chat')
        OR lower(coalesce(btrim(source), '')) = 'chat site'
        OR lower(coalesce(btrim(campaign), '')) = 'chat site'
      )
    ORDER BY created_at ASC
  `;

  summary.candidatesScanned = deals.length;
  const catalogCache = new Set();

  for (const deal of deals) {
    const events = await tx`
      SELECT event_type, actor_type, source_channel, operator_id, metadata
      FROM crm_deal_events
      WHERE tenant_id = ${tenantId}
        AND deal_id = ${deal.id}
    `;
    const { humanEditedSource, humanEditedCampaign } = detectHumanEdits(events);

    const linkedContacts = await tx`
      SELECT c.id, c.first_source, c.first_campaign,
             c.utm_source, c.utm_medium, c.utm_campaign, c.utm_content, c.utm_term,
             c.click_id, c.landing_page, c.custom_fields
      FROM crm_deal_contacts dc
      INNER JOIN contacts c
        ON c.id = dc.contact_id AND c.tenant_id = ${tenantId}
      WHERE dc.tenant_id = ${tenantId}
        AND dc.deal_id = ${deal.id}
      ORDER BY dc.is_primary DESC, dc.created_at ASC
    `;

    const linkedConvs = await tx`
      SELECT conversation_id
      FROM crm_conversation_deals
      WHERE tenant_id = ${tenantId}
        AND deal_id = ${deal.id}
    `;

    const convIds = new Set(linkedConvs.map((r) => String(r.conversation_id)).filter(Boolean));
    const visitorIds = new Set();
    const cookieIds = new Set();

    for (const cid of convIds) {
      if (cid.startsWith("conv-lc-")) {
        const vid = cid.slice("conv-lc-".length);
        if (vid) visitorIds.add(vid);
      }
    }

    for (const c of linkedContacts) {
      const cid = String(c.id || "");
      if (cid.startsWith("cont-lc-")) {
        const vid = cid.slice("cont-lc-".length);
        if (vid) visitorIds.add(vid);
      }
      const cf = c.custom_fields && typeof c.custom_fields === "object" ? c.custom_fields : {};
      if (typeof cf.siteVisitorId === "string" && cf.siteVisitorId.trim()) {
        visitorIds.add(cf.siteVisitorId.trim());
      }
      if (typeof cf.siteCookieId === "string" && cf.siteCookieId.trim()) {
        cookieIds.add(cf.siteCookieId.trim());
      }
      if (Array.isArray(cf.linkedSiteContactIds)) {
        for (const lsid of cf.linkedSiteContactIds) {
          if (typeof lsid === "string" && lsid.startsWith("cont-lc-")) {
            const vid = lsid.slice("cont-lc-".length);
            if (vid) visitorIds.add(vid);
          }
        }
      }
    }

    const convIdArr = Array.from(convIds);
    if (convIdArr.length > 0) {
      const bridgedChats = await tx`
        SELECT visitor_id
        FROM lc_chats
        WHERE tenant_id = ${tenantId}
          AND wa_conversation_id = ANY(${convIdArr}::text[])
      `;
      for (const ch of bridgedChats) {
        if (ch.visitor_id) visitorIds.add(String(ch.visitor_id));
      }
    }

    for (const vid of visitorIds) {
      convIds.add(`conv-lc-${vid}`);
    }

    let visitors = [];
    const visitorIdArr = Array.from(visitorIds);
    if (visitorIdArr.length > 0) {
      visitors = await tx`
        SELECT id, cookie_id, current_url, referrer
        FROM lc_visitors
        WHERE tenant_id = ${tenantId}
          AND id = ANY(${visitorIdArr}::text[])
        ORDER BY last_seen_at DESC
        LIMIT 10
      `;
    }
    const cookieIdArr = Array.from(cookieIds);
    if (visitors.length === 0 && cookieIdArr.length > 0) {
      visitors = await tx`
        SELECT id, cookie_id, current_url, referrer
        FROM lc_visitors
        WHERE tenant_id = ${tenantId}
          AND cookie_id = ANY(${cookieIdArr}::text[])
        ORDER BY last_seen_at DESC
        LIMIT 10
      `;
    }
    for (const v of visitors) {
      if (v.id) visitorIds.add(String(v.id));
    }

    const allVisitorIds = Array.from(visitorIds);
    let pageviews = [];
    if (allVisitorIds.length > 0) {
      pageviews = await tx`
        SELECT url, title
        FROM lc_pageviews
        WHERE tenant_id = ${tenantId}
          AND visitor_id = ANY(${allVisitorIds}::text[])
        ORDER BY visited_at ASC
        LIMIT 100
      `;
    }

    const allConvIds = Array.from(convIds);
    let clientMsgs = [];
    if (allConvIds.length > 0) {
      clientMsgs = await tx`
        SELECT meta_details
        FROM messages
        WHERE tenant_id = ${tenantId}
          AND conversation_id = ANY(${allConvIds}::text[])
          AND sender_type = 'client'
          AND is_internal_note = false
          AND meta_details IS NOT NULL
        ORDER BY sent_at ASC
        LIMIT 60
      `;
    }

    const msgUrls = [];
    const msgReferrers = [];
    let msgUtm = {};
    let msgAttr = null;

    for (const m of clientMsgs) {
      const meta = m.meta_details && typeof m.meta_details === "object" ? m.meta_details : {};
      const sc = meta.siteContext && typeof meta.siteContext === "object" ? meta.siteContext : null;
      if (sc) {
        if (sc.entry?.url) msgUrls.push(sc.entry.url);
        if (sc.page?.url) msgUrls.push(sc.page.url);
        if (sc.entry?.referrer) msgReferrers.push(sc.entry.referrer);
        if (sc.page?.referrer) msgReferrers.push(sc.page.referrer);
        if (sc.entry?.utm && typeof sc.entry.utm === "object" && !msgUtm.utm_source) {
          msgUtm = { ...sc.entry.utm };
        }
      }
      if (meta.marketingAttribution && typeof meta.marketingAttribution === "object") {
        const ma = meta.marketingAttribution;
        if (!msgAttr || ma.utmSource || ma.clickId) {
          msgAttr = ma;
        }
      }
    }

    for (const c of linkedContacts) {
      const cf = c.custom_fields && typeof c.custom_fields === "object" ? c.custom_fields : {};
      const sc = cf.siteContext && typeof cf.siteContext === "object" ? cf.siteContext : null;
      if (sc?.entry?.url) msgUrls.push(sc.entry.url);
      if (sc?.entry?.referrer) msgReferrers.push(sc.entry.referrer);
      if (sc?.page?.url) msgUrls.push(sc.page.url);
    }

    const journeyTracking = extractTrackingFromUrls([
      ...pageviews.map((p) => p.url),
      ...msgUrls,
      ...visitors.map((v) => v.current_url),
      deal.landing_page,
    ]);

    const journeyUtmSource =
      journeyTracking.utmSource || cleanStr(msgUtm.utm_source, 200) || cleanStr(msgAttr?.utmSource, 200);
    const journeyUtmMedium =
      journeyTracking.utmMedium || cleanStr(msgUtm.utm_medium, 200) || cleanStr(msgAttr?.utmMedium, 200);
    const journeyUtmCampaign =
      journeyTracking.utmCampaign ||
      cleanStr(msgUtm.utm_campaign, 200) ||
      cleanStr(msgAttr?.utmCampaign, 200);
    const journeyUtmContent =
      journeyTracking.utmContent ||
      cleanStr(msgUtm.utm_content, 200) ||
      cleanStr(msgAttr?.utmContent, 200);
    const journeyUtmTerm =
      journeyTracking.utmTerm || cleanStr(msgUtm.utm_term, 200) || cleanStr(msgAttr?.utmTerm, 200);
    const journeyClickId = journeyTracking.clickId || cleanStr(msgAttr?.clickId, 250);

    const candidateReferrers = [
      ...msgReferrers,
      ...visitors.map((v) => v.referrer),
    ];
    const externalReferrer =
      candidateReferrers.find((r) =>
        isExternalReferrer(r, journeyTracking.landingPage || deal.landing_page),
      ) || null;

    const hasJourneyTracking = Boolean(
      journeyUtmSource || journeyUtmMedium || journeyUtmCampaign || journeyClickId || externalReferrer,
    );

    const primaryContact = linkedContacts[0] || null;
    const contactValidSource =
      primaryContact?.first_source && !isOperationalOrGenericSource(primaryContact.first_source)
        ? cleanStr(primaryContact.first_source, 160)
        : null;

    const effUtmSource =
      cleanStr(deal.utm_source, 200) ||
      journeyUtmSource ||
      (hasJourneyTracking ? null : cleanStr(primaryContact?.utm_source, 200));
    const effUtmMedium =
      cleanStr(deal.utm_medium, 200) ||
      journeyUtmMedium ||
      (hasJourneyTracking ? null : cleanStr(primaryContact?.utm_medium, 200));
    const effUtmCampaign =
      cleanStr(deal.utm_campaign, 200) ||
      journeyUtmCampaign ||
      (hasJourneyTracking ? null : cleanStr(primaryContact?.utm_campaign, 200));
    const effUtmContent =
      cleanStr(deal.utm_content, 200) ||
      journeyUtmContent ||
      (hasJourneyTracking ? null : cleanStr(primaryContact?.utm_content, 200));
    const effUtmTerm =
      cleanStr(deal.utm_term, 200) ||
      journeyUtmTerm ||
      (hasJourneyTracking ? null : cleanStr(primaryContact?.utm_term, 200));
    const effClickId =
      cleanStr(deal.click_id, 250) ||
      journeyClickId ||
      (hasJourneyTracking ? null : cleanStr(primaryContact?.click_id, 250));
    const effLandingPage =
      (hasJourneyTracking && journeyTracking.landingPage) ||
      cleanStr(deal.landing_page, 1000) ||
      journeyTracking.landingPage ||
      cleanStr(primaryContact?.landing_page, 1000);

    const dealExistingValidSource =
      deal.source && !isOperationalOrGenericSource(deal.source)
        ? cleanStr(deal.source, 160)
        : null;

    const computedSource = normalizeSiteBackfillSource({
      explicitSource: hasJourneyTracking
        ? null
        : dealExistingValidSource || contactValidSource || null,
      utmSource: effUtmSource,
      utmMedium: effUtmMedium,
      clickId: effClickId,
      gclid: journeyTracking.gclid,
      fbclid: journeyTracking.fbclid,
      msclkid: journeyTracking.msclkid,
      ttclid: journeyTracking.ttclid,
      referrer: externalReferrer,
      landingPage: effLandingPage,
    });

    const nextSource = humanEditedSource ? deal.source : computedSource;
    const nextCampaign = humanEditedCampaign ? deal.campaign : targetCampaign;

    const dealChanged =
      nextSource !== deal.source ||
      nextCampaign !== deal.campaign ||
      (effUtmSource && effUtmSource !== deal.utm_source) ||
      (effUtmMedium && effUtmMedium !== deal.utm_medium) ||
      (effUtmCampaign && effUtmCampaign !== deal.utm_campaign) ||
      (effUtmContent && effUtmContent !== deal.utm_content) ||
      (effUtmTerm && effUtmTerm !== deal.utm_term) ||
      (effClickId && effClickId !== deal.click_id) ||
      (effLandingPage && effLandingPage !== deal.landing_page);

    if (humanEditedSource && humanEditedCampaign && !dealChanged) {
      summary.dealsSkippedHumanEdit++;
      continue;
    }

    if (dealChanged) {
      await tx`
        UPDATE crm_deals
        SET source = ${nextSource},
            campaign = ${nextCampaign},
            utm_source = ${effUtmSource || deal.utm_source},
            utm_medium = ${effUtmMedium || deal.utm_medium},
            utm_campaign = ${effUtmCampaign || deal.utm_campaign},
            utm_content = ${effUtmContent || deal.utm_content},
            utm_term = ${effUtmTerm || deal.utm_term},
            click_id = ${effClickId || deal.click_id},
            landing_page = ${effLandingPage || deal.landing_page},
            updated_at = NOW()
        WHERE id = ${deal.id} AND tenant_id = ${tenantId}
      `;

      const eventMeta = {
        origin: "site_attribution_backfill",
        previousSource: deal.source,
        nextSource,
        previousCampaign: deal.campaign,
        nextCampaign,
        recoveredFromJourney: hasJourneyTracking,
        utmSource: effUtmSource,
        landingPage: effLandingPage,
      };
      await tx`
        INSERT INTO crm_deal_events (
          id, tenant_id, deal_id, event_type,
          actor_type, source_channel, actor_name, metadata, created_at
        )
        VALUES (
          ${`ev-site-attr-${randomUUID().slice(0, 12)}`},
          ${tenantId},
          ${deal.id},
          'attribution_normalized',
          'system',
          'migration',
          'Backfill Atribuição Site',
          ${JSON.stringify(eventMeta)}::jsonb,
          NOW()
        )
      `;

      summary.dealsUpdated++;
      const srcKey = nextSource || "null";
      summary.sourceBreakdown[srcKey] = (summary.sourceBreakdown[srcKey] || 0) + 1;
      if (summary.sampleUpdates.length < 25) {
        summary.sampleUpdates.push({
          dealId: deal.id,
          title: deal.title,
          from: { source: deal.source, campaign: deal.campaign },
          to: { source: nextSource, campaign: nextCampaign, utmSource: effUtmSource },
        });
      }
    }

    if (nextSource) {
      await ensureCatalogOptionTx(tx, tenantId, "source", nextSource, catalogCache);
    }
    if (nextCampaign) {
      await ensureCatalogOptionTx(tx, tenantId, "campaign", nextCampaign, catalogCache);
    }

    // Atualiza contatos vinculados de forma não-destrutiva
    for (const c of linkedContacts) {
      const prevSrc = cleanStr(c.first_source, 160);
      const prevSrcNorm = normText(prevSrc);
      const canReplaceContactSource =
        !prevSrc ||
        isOperationalOrGenericSource(prevSrc) ||
        (prevSrcNorm === "trafego direto" && hasJourneyTracking);
      const canReplaceContactCampaign =
        !cleanStr(c.first_campaign, 200) || normText(c.first_campaign) === "chat site";

      const nextContactSource = canReplaceContactSource && nextSource ? nextSource : c.first_source;
      const nextContactCampaign =
        canReplaceContactCampaign && nextCampaign ? nextCampaign : c.first_campaign;
      const nextContactUtmSource = c.utm_source || effUtmSource || null;
      const nextContactUtmMedium = c.utm_medium || effUtmMedium || null;
      const nextContactUtmCampaign = c.utm_campaign || effUtmCampaign || null;
      const nextContactUtmContent = c.utm_content || effUtmContent || null;
      const nextContactUtmTerm = c.utm_term || effUtmTerm || null;
      const nextContactClickId = c.click_id || effClickId || null;
      const nextContactLanding =
        (!c.landing_page || (hasJourneyTracking && !c.utm_source)) && effLandingPage
          ? effLandingPage
          : c.landing_page;

      const contactChanged =
        nextContactSource !== c.first_source ||
        nextContactCampaign !== c.first_campaign ||
        nextContactUtmSource !== c.utm_source ||
        nextContactUtmMedium !== c.utm_medium ||
        nextContactUtmCampaign !== c.utm_campaign ||
        nextContactUtmContent !== c.utm_content ||
        nextContactUtmTerm !== c.utm_term ||
        nextContactClickId !== c.click_id ||
        nextContactLanding !== c.landing_page;

      if (contactChanged) {
        await tx`
          UPDATE contacts
          SET first_source = ${nextContactSource},
              first_campaign = ${nextContactCampaign},
              utm_source = ${nextContactUtmSource},
              utm_medium = ${nextContactUtmMedium},
              utm_campaign = ${nextContactUtmCampaign},
              utm_content = ${nextContactUtmContent},
              utm_term = ${nextContactUtmTerm},
              click_id = ${nextContactClickId},
              landing_page = ${nextContactLanding}
          WHERE id = ${c.id} AND tenant_id = ${tenantId}
        `;
        summary.contactsUpdated++;
      }
    }
  }

  // Arquiva "Chat Site" no catálogo de source e campaign se zero cards do tenant ainda referenciarem
  for (const kind of ["source", "campaign"]) {
    const stillUsed =
      kind === "source"
        ? await tx`
            SELECT 1 AS used
            FROM crm_deals
            WHERE tenant_id = ${tenantId}
              AND lower(coalesce(btrim(source), '')) = 'chat site'
            LIMIT 1
          `
        : await tx`
            SELECT 1 AS used
            FROM crm_deals
            WHERE tenant_id = ${tenantId}
              AND lower(coalesce(btrim(campaign), '')) = 'chat site'
            LIMIT 1
          `;

    if (stillUsed.length === 0) {
      const archived = await tx`
        UPDATE crm_catalog_items
        SET archived_at = NOW(), updated_at = NOW()
        WHERE tenant_id = ${tenantId}
          AND kind = ${kind}
          AND lower(btrim(name)) = 'chat site'
          AND archived_at IS NULL
        RETURNING id
      `;
      summary.catalogArchived += archived.length;
    }
  }

  return summary;
}
