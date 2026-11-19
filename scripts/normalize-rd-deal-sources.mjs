import { randomUUID } from "node:crypto";

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

function isOperationalChannelLabel(rawSource) {
  const n = normText(rawSource);
  if (!n) return false;
  return (
    n === "manual" ||
    n === "chat" ||
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

const PAID_MEDIUM_RE =
  /\b(cpc|ppc|paid|paid_social|paidsocial|ads|adwords|shopping|display|pmax|performance_max|remarketing|retargeting|sponsored|trafego_pago|midia_paga|metaads|googleads|google\s+ads|facebook\s+ads|meta\s+ads|rede[-_\s]?pesquisa)\b/i;

const ORGANIC_MEDIUM_RE = /\b(organic|organico|seo)\b/i;

const OWN_COMPANY_DOMAIN_RE =
  /(?:^|\.)(?:tecfag[a-z0-9-]*|valem[a-z0-9-]*)\.com(?:\.br)?$|(?:^|\.)(?:tecfagchat|valemchat)\.up\.railway\.app$/i;

function stripOuterParens(val) {
  return val.replace(/^\((.+)\)$/, "$1").trim();
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

export function normalizeStoredRdSource({
  explicitSource,
  utmSource,
  utmMedium,
  landingPage,
}) {
  const explicit = cleanStr(explicitSource, 160);
  const explicitClean = explicit && !isOperationalChannelLabel(explicit) ? explicit : null;

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

  const rawSourceOriginal = cleanStr(utmSource, 160) || explicitClean;
  const rawSourceToken = normText(rawSourceOriginal);
  const rawSourceBare = stripOuterParens(rawSourceToken);
  const rawMedium = stripOuterParens(normText(utmMedium));

  const isPaid = PAID_MEDIUM_RE.test(rawMedium) || PAID_MEDIUM_RE.test(rawSourceBare);

  if (isPaid && /\b(meta|metaads|fb|ig|facebook|instagram)\b/.test(rawSourceBare)) {
    return "Busca Paga | Meta";
  }
  if (isPaid && /^google[-_][a-z0-9_-]+$/i.test(rawSourceBare)) {
    return `Busca Paga | ${rawSourceOriginal || rawSourceBare}`;
  }
  if (isPaid && /\b(google|googleads|google ads|adwords)\b/.test(rawSourceBare)) {
    return "Busca Paga | Google";
  }
  if (isPaid && /\b(mercadolivre|mercado livre|meli)\b/.test(rawSourceBare)) {
    return "Busca Paga | Mercado Livre";
  }
  if (isPaid && /\bbing\b/.test(rawSourceBare)) {
    return "Busca Paga | Bing";
  }
  if (isPaid && /\blinkedin\b/.test(rawSourceBare)) {
    return "Busca Paga | LinkedIn";
  }
  if (isPaid && /\btiktok\b/.test(rawSourceBare)) {
    return "Busca Paga | TikTok";
  }
  if (isPaid && rawSourceBare) {
    return `Busca Paga | ${rawSourceOriginal || rawSourceBare}`;
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

  if (/\bgoogle\b/.test(rawSourceBare) && (!rawMedium || rawMedium === "none" || ORGANIC_MEDIUM_RE.test(rawMedium))) {
    return "Busca Orgânica | Google";
  }
  if (/\bbing\b/.test(rawSourceBare) && (!rawMedium || rawMedium === "none" || ORGANIC_MEDIUM_RE.test(rawMedium))) {
    return "Busca Orgânica | Bing";
  }
  if (/\byahoo\b/.test(rawSourceBare)) return "Busca Orgânica | Yahoo";
  if (/\blinktree\b/.test(rawSourceBare)) return "Social | linktree";
  if (/\b(instagram|ig)\b/.test(rawSourceBare)) return "Social | Instagram";
  if (/\b(facebook|fb)\b/.test(rawSourceBare)) return "Social | Facebook";
  if (/\byoutube\b/.test(rawSourceBare)) return "Social | YouTube";
  if (/\b(email|e-mail|newsletter|rdstation)\b/.test(rawMedium) || /\b(newsletter)\b/.test(rawSourceBare)) {
    return "E-mail Marketing";
  }

  return explicitClean;
}

export async function runNormalizeRdDealSourcesBackfill(sql) {
  let dealsUpdated = 0;
  let notesUpdated = 0;
  let contactsUpdated = 0;
  let catalogArchived = 0;

  await sql.begin(async (tx) => {
    const dealRows = await tx`
      SELECT id, tenant_id, source, utm_source, utm_medium, landing_page
      FROM crm_deals
      WHERE id NOT LIKE 'deal-rd-%'
        AND source IS NOT NULL
        AND btrim(source) != ''
    `;

    const ensuredCatalogByTenant = new Set();
    const replacedRawSourcesByTenant = new Map();

    for (const row of dealRows) {
      const current = String(row.source || "").trim();
      const next = normalizeStoredRdSource({
        explicitSource: current,
        utmSource: row.utm_source,
        utmMedium: row.utm_medium,
        landingPage: row.landing_page,
      });

      if (!next || next === current) continue;

      await tx`
        UPDATE crm_deals
        SET source = ${next}
        WHERE id = ${row.id} AND tenant_id = ${row.tenant_id}
      `;
      dealsUpdated++;

      const updatedNotes = await tx`
        UPDATE crm_deal_activities
        SET description = replace(description, ${`Fonte: ${current}`}, ${`Fonte: ${next}`})
        WHERE deal_id = ${row.id}
          AND tenant_id = ${row.tenant_id}
          AND type = 'note'
          AND description LIKE ${`%Fonte: ${current}%`}
        RETURNING id
      `;
      notesUpdated += updatedNotes.length;

      const catKey = `${row.tenant_id}::${next.toLocaleLowerCase("pt-BR")}`;
      if (!ensuredCatalogByTenant.has(catKey)) {
        ensuredCatalogByTenant.add(catKey);
        const existingCat = await tx`
          SELECT id, archived_at
          FROM crm_catalog_items
          WHERE tenant_id = ${row.tenant_id}
            AND kind = 'source'
            AND lower(name) = lower(${next})
          LIMIT 1
        `;
        if (existingCat.length === 0) {
          await tx`
            INSERT INTO crm_catalog_items (id, tenant_id, kind, name, created_at, updated_at)
            VALUES (${randomUUID()}, ${row.tenant_id}, 'source', ${next}, NOW(), NOW())
            ON CONFLICT DO NOTHING
          `;
        } else if (existingCat[0].archived_at) {
          await tx`
            UPDATE crm_catalog_items
            SET archived_at = NULL, updated_at = NOW()
            WHERE id = ${existingCat[0].id} AND tenant_id = ${row.tenant_id}
          `;
        }
      }

      if (!replacedRawSourcesByTenant.has(row.tenant_id)) {
        replacedRawSourcesByTenant.set(row.tenant_id, new Set());
      }
      replacedRawSourcesByTenant.get(row.tenant_id).add(current);
    }

    const contactRows = await tx`
      SELECT id, tenant_id, first_source, utm_source, utm_medium, landing_page
      FROM contacts
      WHERE first_source IS NOT NULL
        AND btrim(first_source) != ''
    `;

    for (const c of contactRows) {
      const current = String(c.first_source || "").trim();
      const next = normalizeStoredRdSource({
        explicitSource: current,
        utmSource: c.utm_source,
        utmMedium: c.utm_medium,
        landingPage: c.landing_page,
      });
      if (!next || next === current) continue;
      await tx`
        UPDATE contacts
        SET first_source = ${next}
        WHERE id = ${c.id} AND tenant_id = ${c.tenant_id}
      `;
      contactsUpdated++;
    }

    // Arquiva no catálogo apenas as fontes brutas que não são mais referenciadas por nenhum card ativo do tenant
    for (const [tenantId, rawSet] of replacedRawSourcesByTenant.entries()) {
      for (const rawName of rawSet) {
        const [stillUsed] = await tx`
          SELECT 1 AS used
          FROM crm_deals
          WHERE tenant_id = ${tenantId}
            AND source = ${rawName}
          LIMIT 1
        `;
        if (!stillUsed) {
          const archived = await tx`
            UPDATE crm_catalog_items
            SET archived_at = NOW(), updated_at = NOW()
            WHERE tenant_id = ${tenantId}
              AND kind = 'source'
              AND name = ${rawName}
              AND archived_at IS NULL
            RETURNING id
          `;
          catalogArchived += archived.length;
        }
      }
    }
  });

  return { dealsUpdated, notesUpdated, contactsUpdated, catalogArchived };
}
