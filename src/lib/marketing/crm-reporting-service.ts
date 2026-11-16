import { client as defaultSqlClient } from "../../db";
import { calculateBusinessPacing, saoPauloDay } from "../commercial/metrics";
import { projectIndustrialMonitoring } from "../triage/industrial-monitor";
import {
  formatMarketingSectorLabel,
  isEffectiveCommercialWin,
  isOperationalChannelLabel,
  normalizeRdDealSource,
  resolveSectorFromPipelineName,
} from "./crm-attribution";

export interface MarketingCursorPayload {
  t: string;
  id: string;
}

export function encodeMarketingCursor(timestamp: Date | string, id: string): string {
  const iso = timestamp instanceof Date ? timestamp.toISOString() : new Date(timestamp).toISOString();
  return Buffer.from(JSON.stringify({ t: iso, id }), "utf8").toString("base64url");
}

export function decodeMarketingCursor(raw: string | null | undefined): MarketingCursorPayload | null {
  if (!raw || typeof raw !== "string") return null;
  try {
    const decoded = JSON.parse(Buffer.from(raw.trim(), "base64url").toString("utf8"));
    if (
      decoded &&
      typeof decoded === "object" &&
      typeof decoded.t === "string" &&
      typeof decoded.id === "string" &&
      !Number.isNaN(new Date(decoded.t).getTime())
    ) {
      return { t: decoded.t, id: decoded.id };
    }
    return null;
  } catch {
    return null;
  }
}

export function parseFlexibleDateBound(
  raw: string | null | undefined,
  bound: "start" | "end",
): string | null {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // YYYY-MM-DD interpretado no fuso oficial de relatórios (America/Sao_Paulo -03:00)
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const iso =
      bound === "start"
        ? `${trimmed}T00:00:00.000-03:00`
        : `${trimmed}T23:59:59.999-03:00`;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  const d = new Date(trimmed);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function clampPageLimit(raw: unknown, defaultLimit = 200, maxLimit = 1000): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return defaultLimit;
  return Math.min(maxLimit, Math.max(1, Math.floor(n)));
}

export function parseBoolParam(raw: unknown, defaultValue: boolean): boolean {
  if (raw === undefined || raw === null || raw === "") return defaultValue;
  if (typeof raw === "boolean") return raw;
  const s = String(raw).trim().toLowerCase();
  if (s === "true" || s === "1" || s === "yes") return true;
  if (s === "false" || s === "0" || s === "no") return false;
  return defaultValue;
}

function digitsOnly(val: unknown): string {
  return String(val || "").replace(/\D/g, "");
}

function last9PhoneDigits(val: unknown): string | null {
  const d = digitsOnly(val);
  if (d.length < 8) return null;
  return d.length >= 9 ? d.slice(-9) : d;
}

function formatCnpjCpfDisplay(raw: unknown): string | null {
  const d = digitsOnly(raw);
  if (!d) return null;
  if (d.length === 14) {
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  }
  if (d.length === 11) {
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  }
  return String(raw);
}

function toIso(val: unknown): string | null {
  if (!val) return null;
  const d = val instanceof Date ? val : new Date(String(val));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function buildWhereClause(sql: any, conditions: any[]) {
  return conditions.reduce((acc, curr, idx) => (idx === 0 ? curr : sql`${acc} AND ${curr}`));
}

/**
 * Projeta `deal_source_name` compatível com a taxonomia do RD Station CRM:
 * - Preserva fontes históricas migradas do RD (incluindo "Desconhecido" se veio do RD legado)
 * - Converte UTMs / Click IDs em "Busca Paga | Google", "Busca Paga | Meta", "Busca Paga | Mercado Livre", etc.
 * - NUNCA devolve rótulos técnicos operacionais ("manual", "chat", "whatsapp", "WhatsApp SDR...")
 */
export function projectCanonicalDealSourceName(row: {
  id?: string | null;
  source?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  click_id?: string | null;
  entry_channel?: string | null;
}): string | null {
  const rawSource = typeof row.source === "string" ? row.source.trim() : "";

  // Em cards legados migrados do RD (deal-rd-*), preserva fielmente o valor original do RD (ex.: "Desconhecido", "Busca Paga | Google")
  if (rawSource && String(row.id || "").startsWith("deal-rd-") && !isOperationalChannelLabel(rawSource)) {
    return rawSource;
  }

  const normalized = normalizeRdDealSource({
    explicitSource: rawSource || null,
    utmSource: row.utm_source || null,
    utmMedium: row.utm_medium || null,
    utmCampaign: row.utm_campaign || null,
    clickId: row.click_id || null,
    entryChannel: row.entry_channel || null,
  });

  if (normalized) return normalized;
  if (rawSource && String(row.id || "").startsWith("deal-rd-")) return rawSource;
  return null;
}

export interface MarketingDealsFilter {
  id?: string | null;
  idRd?: string | null;
  pipelineId?: string | null;
  stageId?: string | null;
  operatorId?: string | null;
  status?: string | null;
  win?: boolean | null;
  sectorOrigin?: string | null;
  sectorCurrent?: string | null;
  source?: string | null;
  campaign?: string | null;
  utmCampaign?: string | null;
  query?: string | null;
  createdFrom?: string | null;
  createdTo?: string | null;
  wonFrom?: string | null;
  wonTo?: string | null;
  lostFrom?: string | null;
  lostTo?: string | null;
  updatedSince?: string | null;
  includeTests?: boolean;
  includeLegacy?: boolean;
  order?: "asc" | "desc";
  limit?: number;
  cursor?: string | null;
}

export async function listMarketingDeals(
  tenantId: string,
  filters: MarketingDealsFilter = {},
  sql: any = defaultSqlClient,
) {
  const limit = clampPageLimit(filters.limit, 200, 1000);
  const includeTests = filters.includeTests === true;
  const includeLegacy = filters.includeLegacy !== false;
  const order = filters.order === "desc" ? "desc" : "asc";
  const decodedCursor = decodeMarketingCursor(filters.cursor);

  const conditions: any[] = [sql`d.tenant_id = ${tenantId}`];

  if (!includeTests) {
    conditions.push(sql`d.is_test = false`);
  }
  if (!includeLegacy) {
    conditions.push(sql`d.is_legacy = false`);
  }
  if (filters.id) {
    conditions.push(sql`d.id = ${filters.id.trim()}`);
  }
  if (filters.idRd) {
    conditions.push(sql`d.rd_deal_id = ${filters.idRd.trim()}`);
  }
  if (filters.pipelineId) {
    conditions.push(sql`d.pipeline_id = ${filters.pipelineId.trim()}`);
  }
  if (filters.stageId) {
    conditions.push(sql`d.stage_id = ${filters.stageId.trim()}`);
  }
  if (filters.operatorId) {
    conditions.push(sql`d.operator_id = ${filters.operatorId.trim()}`);
  }
  if (filters.status) {
    conditions.push(sql`d.status = ${filters.status.trim()}`);
  }
  if (filters.sectorOrigin) {
    conditions.push(sql`d.sector_origin = ${filters.sectorOrigin.trim()}`);
  }
  if (filters.sectorCurrent) {
    conditions.push(sql`d.sector_current = ${filters.sectorCurrent.trim()}`);
  }
  if (filters.win === true) {
    conditions.push(sql`(
      d.status = 'won'
      OR (
        d.status = 'open'
        AND COALESCE(d.sector_current, '') NOT IN ('suporte_tecnico', 'financeiro')
        AND (st.is_win_stage = true OR lower(st.name) ~ '^(fechamento|venda conclu[ií]da)')
      )
    )`);
  } else if (filters.win === false) {
    conditions.push(sql`NOT (
      d.status = 'won'
      OR (
        d.status = 'open'
        AND COALESCE(d.sector_current, '') NOT IN ('suporte_tecnico', 'financeiro')
        AND (st.is_win_stage = true OR lower(st.name) ~ '^(fechamento|venda conclu[ií]da)')
      )
    )`);
  }

  if (filters.source) {
    const src = `%${filters.source.trim()}%`;
    conditions.push(sql`(COALESCE(d.source, '') ILIKE ${src} OR COALESCE(d.utm_source, '') ILIKE ${src})`);
  }
  if (filters.campaign) {
    const cmp = `%${filters.campaign.trim()}%`;
    conditions.push(sql`COALESCE(d.campaign, '') ILIKE ${cmp}`);
  }
  if (filters.utmCampaign) {
    const ucmp = `%${filters.utmCampaign.trim()}%`;
    conditions.push(sql`COALESCE(d.utm_campaign, '') ILIKE ${ucmp}`);
  }
  if (filters.query) {
    const q = `%${filters.query.trim()}%`;
    const qDigits = digitsOnly(filters.query);
    if (qDigits.length >= 6) {
      const qDigPat = `%${qDigits}%`;
      conditions.push(sql`(
        d.title ILIKE ${q}
        OR COALESCE(d.rd_deal_id, '') ILIKE ${q}
        OR COALESCE(acc.name, '') ILIKE ${q}
        OR COALESCE(acc.trade_name, '') ILIKE ${q}
        OR COALESCE(acc.document, '') ILIKE ${qDigPat}
      )`);
    } else {
      conditions.push(sql`(
        d.title ILIKE ${q}
        OR COALESCE(d.rd_deal_id, '') ILIKE ${q}
        OR COALESCE(acc.name, '') ILIKE ${q}
        OR COALESCE(acc.trade_name, '') ILIKE ${q}
        OR COALESCE(d.loss_reason, '') ILIKE ${q}
      )`);
    }
  }

  const updatedSince = parseFlexibleDateBound(filters.updatedSince, "start");
  if (updatedSince) conditions.push(sql`d.updated_at >= ${updatedSince}::timestamp`);

  const createdFrom = parseFlexibleDateBound(filters.createdFrom, "start");
  if (createdFrom) conditions.push(sql`d.created_at >= ${createdFrom}::timestamp`);
  const createdTo = parseFlexibleDateBound(filters.createdTo, "end");
  if (createdTo) conditions.push(sql`d.created_at <= ${createdTo}::timestamp`);

  const wonFrom = parseFlexibleDateBound(filters.wonFrom, "start");
  if (wonFrom) conditions.push(sql`COALESCE(d.won_at, d.closed_at) >= ${wonFrom}::timestamp`);
  const wonTo = parseFlexibleDateBound(filters.wonTo, "end");
  if (wonTo) conditions.push(sql`COALESCE(d.won_at, d.closed_at) <= ${wonTo}::timestamp`);

  const lostFrom = parseFlexibleDateBound(filters.lostFrom, "start");
  if (lostFrom) conditions.push(sql`COALESCE(d.lost_at, d.closed_at) >= ${lostFrom}::timestamp`);
  const lostTo = parseFlexibleDateBound(filters.lostTo, "end");
  if (lostTo) conditions.push(sql`COALESCE(d.lost_at, d.closed_at) <= ${lostTo}::timestamp`);

  if (decodedCursor) {
    const cursorIso = decodedCursor.t;
    if (order === "desc") {
      conditions.push(
        sql`(d.updated_at < ${cursorIso}::timestamp OR (d.updated_at = ${cursorIso}::timestamp AND d.id < ${decodedCursor.id}))`,
      );
    } else {
      conditions.push(
        sql`(d.updated_at > ${cursorIso}::timestamp OR (d.updated_at = ${cursorIso}::timestamp AND d.id > ${decodedCursor.id}))`,
      );
    }
  }

  const whereClause = buildWhereClause(sql, conditions);
  const orderSql =
    order === "desc"
      ? sql`d.updated_at DESC, d.id DESC`
      : sql`d.updated_at ASC, d.id ASC`;

  const [rows, fieldDefs] = await Promise.all([
    sql`
      SELECT
        d.id,
        d.rd_deal_id,
        d.rd_deal_url,
        d.title,
        d.value,
        d.currency,
        d.status,
        d.pipeline_id,
        p.name AS pipeline_name,
        d.original_pipeline_id,
        orig_p.name AS original_pipeline_name,
        d.stage_id,
        st.name AS stage_name,
        st.is_win_stage,
        st.is_loss_stage,
        d.operator_id,
        op.name AS operator_name,
        op.email AS operator_email,
        d.account_id,
        acc.name AS account_name,
        acc.trade_name AS account_trade_name,
        acc.document AS account_document,
        acc.segment AS account_segment,
        acc.email AS account_email,
        acc.phone AS account_phone,
        d.entry_channel,
        d.source,
        d.campaign,
        d.utm_source,
        d.utm_medium,
        d.utm_campaign,
        d.utm_content,
        d.utm_term,
        d.click_id,
        d.landing_page,
        d.sector_origin,
        d.sector_current,
        d.loss_reason,
        d.paused_reason,
        d.rating,
        d.custom_fields,
        d.expected_close_date,
        d.won_at,
        d.lost_at,
        d.closed_at,
        d.is_legacy,
        d.is_test,
        d.created_at,
        d.updated_at
      FROM crm_deals d
      JOIN crm_pipelines p ON p.id = d.pipeline_id AND p.tenant_id = d.tenant_id
      JOIN crm_stages st ON st.id = d.stage_id AND st.tenant_id = d.tenant_id
      LEFT JOIN crm_pipelines orig_p ON orig_p.id = d.original_pipeline_id AND orig_p.tenant_id = d.tenant_id
      LEFT JOIN operators op ON op.id = d.operator_id AND op.tenant_id = d.tenant_id
      LEFT JOIN crm_accounts acc ON acc.id = d.account_id AND acc.tenant_id = d.tenant_id
      WHERE ${whereClause}
      ORDER BY ${orderSql}
      LIMIT ${limit + 1}
    `,
    sql`
      SELECT id, name
      FROM crm_custom_field_definitions
      WHERE tenant_id = ${tenantId} AND entity_type = 'deal'
    `,
  ]);

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const dealIds: string[] = pageRows.map((r: any) => String(r.id));

  // Busca em lote relações N:N (contatos + telefones adicionais, produtos e conversas vinculadas)
  const [contactRows, productRows, convLinkRows] =
    dealIds.length > 0
      ? await Promise.all([
          sql`
            SELECT
              dc.deal_id,
              dc.contact_id,
              dc.role,
              dc.is_primary,
              c.name,
              c.email,
              c.phone,
              c.cpf,
              c.cnpj,
              COALESCE(
                ARRAY_AGG(cp.phone) FILTER (WHERE cp.phone IS NOT NULL AND cp.phone != ''),
                ARRAY[]::text[]
              ) AS extra_phones
            FROM crm_deal_contacts dc
            JOIN contacts c ON c.id = dc.contact_id AND c.tenant_id = dc.tenant_id
            LEFT JOIN contact_phones cp ON cp.contact_id = c.id AND cp.tenant_id = c.tenant_id
            WHERE dc.tenant_id = ${tenantId}
              AND dc.deal_id IN ${sql(dealIds)}
            GROUP BY dc.deal_id, dc.contact_id, dc.role, dc.is_primary, dc.created_at, c.name, c.email, c.phone, c.cpf, c.cnpj
            ORDER BY dc.is_primary DESC, dc.created_at ASC
          `,
          sql`
            SELECT
              id,
              deal_id,
              product_id,
              name,
              quantity,
              unit_price,
              discount_percent,
              total_price
            FROM crm_deal_products
            WHERE tenant_id = ${tenantId}
              AND deal_id IN ${sql(dealIds)}
            ORDER BY created_at ASC
          `,
          sql`
            SELECT deal_id, conversation_id
            FROM crm_conversation_deals
            WHERE tenant_id = ${tenantId}
              AND deal_id IN ${sql(dealIds)}
              AND is_active = true
          `,
        ])
      : [[], [], []];

  const fieldLabelMap = new Map<string, string>();
  let clienteNovoFieldIds = new Set<string>();
  for (const f of fieldDefs) {
    const fid = String(f.id);
    const fname = String(f.name);
    fieldLabelMap.set(fid, fname);
    if (/cliente\s*novo/i.test(fname) || /cliente.?novo/i.test(fid)) {
      clienteNovoFieldIds.add(fid);
    }
  }

  const contactsByDeal = new Map<string, any[]>();
  for (const cr of contactRows) {
    const dId = String(cr.deal_id);
    const arr = contactsByDeal.get(dId) || [];
    arr.push(cr);
    contactsByDeal.set(dId, arr);
  }

  const productsByDeal = new Map<string, any[]>();
  for (const pr of productRows) {
    const dId = String(pr.deal_id);
    const arr = productsByDeal.get(dId) || [];
    arr.push(pr);
    productsByDeal.set(dId, arr);
  }

  const convsByDeal = new Map<string, string[]>();
  for (const cv of convLinkRows) {
    const dId = String(cv.deal_id);
    const arr = convsByDeal.get(dId) || [];
    arr.push(String(cv.conversation_id));
    convsByDeal.set(dId, arr);
  }

  const items = pageRows.map((r: any) => {
    const rawCf =
      r.custom_fields && typeof r.custom_fields === "object" && !Array.isArray(r.custom_fields)
        ? (r.custom_fields as Record<string, unknown>)
        : {};
    const labeledCf: Record<string, unknown> = {};
    let clienteNovo: unknown = null;

    for (const [k, v] of Object.entries(rawCf)) {
      const label = fieldLabelMap.get(k) || k;
      labeledCf[label] = v;
      if (
        clienteNovo === null &&
        v !== null &&
        v !== undefined &&
        v !== "" &&
        (clienteNovoFieldIds.has(k) || /cliente\s*novo/i.test(label) || /cliente.?novo/i.test(k))
      ) {
        clienteNovo = v;
      }
    }

    const dealContactsRaw = contactsByDeal.get(String(r.id)) || [];
    const emailSet = new Set<string>();
    const phoneSet = new Set<string>();
    const phoneLast9Set = new Set<string>();

    if (r.account_email) emailSet.add(String(r.account_email).trim().toLowerCase());
    if (r.account_phone) {
      const ap = digitsOnly(r.account_phone);
      if (ap) phoneSet.add(ap);
      const l9 = last9PhoneDigits(ap);
      if (l9) phoneLast9Set.add(l9);
    }

    const contactsDeals = dealContactsRaw.map((c: any) => {
      if (c.email) emailSet.add(String(c.email).trim().toLowerCase());
      const primaryPhoneDigits = digitsOnly(c.phone);
      if (primaryPhoneDigits) {
        phoneSet.add(primaryPhoneDigits);
        const l9 = last9PhoneDigits(primaryPhoneDigits);
        if (l9) phoneLast9Set.add(l9);
      }
      if (Array.isArray(c.extra_phones)) {
        for (const ep of c.extra_phones) {
          const epd = digitsOnly(ep);
          if (epd) {
            phoneSet.add(epd);
            const l9 = last9PhoneDigits(epd);
            if (l9) phoneLast9Set.add(l9);
          }
        }
      }
      return {
        contact_id: c.contact_id,
        deals_id: r.id,
        role: c.role,
        is_primary: Boolean(c.is_primary),
        name: c.name || null,
        email: c.email || null,
        phone: c.phone || null,
        phone_last9: last9PhoneDigits(c.phone),
        cpf: c.cpf || null,
        cnpj: c.cnpj || null,
      };
    });

    const win = isEffectiveCommercialWin({
      status: r.status,
      stageIsWin: r.is_win_stage,
      stageName: r.stage_name,
      sectorCurrent: r.sector_current,
    });
    const winAt = win ? toIso(r.won_at || r.closed_at || r.updated_at || r.created_at) : null;
    const lost = r.status === "lost";
    const lostAt = lost ? toIso(r.lost_at || r.closed_at || r.updated_at || r.created_at) : null;

    const dealSourceName = projectCanonicalDealSourceName(r);
    const orgDocDigits = digitsOnly(r.account_document) || null;

    return {
      // Aliases oficiais Kondado / RD Station CRM
      id: r.id,
      id_rd: r.rd_deal_id || null,
      rd_deal_url: r.rd_deal_url || null,
      name: r.title,
      title: r.title,
      created_at: toIso(r.created_at),
      updated_at: toIso(r.updated_at),
      closed_at: toIso(r.closed_at),
      expected_close_date: toIso(r.expected_close_date),
      amount_total: Number(r.value || 0),
      currency: r.currency || "BRL",
      organization_id: r.account_id || null,
      organization_name: r.account_name || null,
      organization_trade_name: r.account_trade_name || null,
      organization_cnpj: orgDocDigits,
      organization_cnpj_formatted: formatCnpjCpfDisplay(r.account_document),
      organization_segment: r.account_segment || null,
      deal_stage_pipeline_id: r.pipeline_id,
      deal_stage_pipeline_name: r.pipeline_name,
      original_pipeline_id: r.original_pipeline_id || r.pipeline_id,
      original_pipeline_name: r.original_pipeline_name || r.pipeline_name,
      deal_stage_id: r.stage_id,
      deal_stage_name: r.stage_name,
      status: r.status,
      win,
      win_at: winAt,
      lost,
      lost_at: lostAt,
      deal_source_name: dealSourceName,
      source_raw: r.source || null,
      campaign_name: r.campaign || null, // Ponto de conversão (padrão RD)
      entry_channel: r.entry_channel || null,
      utm_source: r.utm_source || null,
      utm_medium: r.utm_medium || null,
      utm_campaign: r.utm_campaign || null,
      utm_content: r.utm_content || null,
      utm_term: r.utm_term || null,
      click_id: r.click_id || null,
      landing_page: r.landing_page || null,
      user_id: r.operator_id || null,
      user_name: r.operator_name || null,
      user_email: r.operator_email || null,
      deal_lost_reason_name: r.loss_reason || null,
      paused_reason: r.paused_reason || null,
      sector_origin: r.sector_origin || null,
      sector_origin_label: formatMarketingSectorLabel(r.sector_origin),
      sector_current: r.sector_current || null,
      sector_current_label: formatMarketingSectorLabel(r.sector_current),
      cliente_novo: clienteNovo,
      rating: Number(r.rating || 0),
      contacts_deals: contactsDeals,
      contacts_emails: Array.from(emailSet),
      contacts_phones: Array.from(phoneSet),
      contacts_phones_last9: Array.from(phoneLast9Set),
      products: (productsByDeal.get(String(r.id)) || []).map((p: any) => ({
        id: p.id,
        product_id: p.product_id || null,
        name: p.name,
        quantity: Number(p.quantity || 0),
        unit_price: Number(p.unit_price || 0),
        discount_percent: Number(p.discount_percent || 0),
        total_price: Number(p.total_price || 0),
      })),
      linked_conversation_ids: convsByDeal.get(String(r.id)) || [],
      custom_fields: labeledCf,
      is_legacy: Boolean(r.is_legacy),
      is_test: Boolean(r.is_test),
    };
  });

  const lastRow = pageRows[pageRows.length - 1];
  const nextCursor =
    hasMore && lastRow ? encodeMarketingCursor(lastRow.updated_at, String(lastRow.id)) : null;

  return {
    tenant_id: tenantId,
    items,
    pagination: {
      limit,
      returned_count: items.length,
      has_more: hasMore,
      next_cursor: nextCursor,
    },
  };
}

export interface MarketingStageHistoryFilter {
  dealId?: string | null;
  pipelineId?: string | null;
  sectorOrigin?: string | null;
  sectorCurrent?: string | null;
  updatedSince?: string | null;
  createdFrom?: string | null;
  createdTo?: string | null;
  includeTests?: boolean;
  includeLegacy?: boolean;
  limit?: number;
  cursor?: string | null;
}

/**
 * Reconstrói a linha do tempo contínua de etapas (`start_date`, `end_date`, `duration_seconds`)
 * para cada negociação a partir de `crm_deals.created_at` + eventos de transição de etapa/funil
 * em `crm_deal_events` (totalmente imune a ruído de `conversation_action`).
 */
export async function listMarketingStageHistory(
  tenantId: string,
  filters: MarketingStageHistoryFilter = {},
  sql: any = defaultSqlClient,
) {
  const limit = clampPageLimit(filters.limit, 250, 1000);
  const includeTests = filters.includeTests === true;
  const includeLegacy = filters.includeLegacy !== false;
  const decodedCursor = decodeMarketingCursor(filters.cursor);

  const conditions: any[] = [sql`d.tenant_id = ${tenantId}`];
  if (!includeTests) conditions.push(sql`d.is_test = false`);
  if (!includeLegacy) conditions.push(sql`d.is_legacy = false`);
  if (filters.dealId) conditions.push(sql`d.id = ${filters.dealId.trim()}`);
  if (filters.pipelineId) conditions.push(sql`d.pipeline_id = ${filters.pipelineId.trim()}`);
  if (filters.sectorOrigin) conditions.push(sql`d.sector_origin = ${filters.sectorOrigin.trim()}`);
  if (filters.sectorCurrent) conditions.push(sql`d.sector_current = ${filters.sectorCurrent.trim()}`);

  const updatedSince = parseFlexibleDateBound(filters.updatedSince, "start");
  if (updatedSince) conditions.push(sql`d.updated_at >= ${updatedSince}::timestamp`);
  const createdFrom = parseFlexibleDateBound(filters.createdFrom, "start");
  if (createdFrom) conditions.push(sql`d.created_at >= ${createdFrom}::timestamp`);
  const createdTo = parseFlexibleDateBound(filters.createdTo, "end");
  if (createdTo) conditions.push(sql`d.created_at <= ${createdTo}::timestamp`);

  if (decodedCursor) {
    const cursorIso = decodedCursor.t;
    conditions.push(
      sql`(d.updated_at > ${cursorIso}::timestamp OR (d.updated_at = ${cursorIso}::timestamp AND d.id > ${decodedCursor.id}))`,
    );
  }

  const whereClause = buildWhereClause(sql, conditions);

  const [dealRows, allPipelines, allStages] = await Promise.all([
    sql`
      SELECT
        d.id,
        d.rd_deal_id,
        d.pipeline_id,
        d.original_pipeline_id,
        d.stage_id,
        d.status,
        d.sector_origin,
        d.sector_current,
        d.won_at,
        d.lost_at,
        d.closed_at,
        d.created_at,
        d.updated_at
      FROM crm_deals d
      WHERE ${whereClause}
      ORDER BY d.updated_at ASC, d.id ASC
      LIMIT ${limit + 1}
    `,
    sql`SELECT id, name FROM crm_pipelines WHERE tenant_id = ${tenantId}`,
    sql`SELECT id, pipeline_id, name, is_win_stage FROM crm_stages WHERE tenant_id = ${tenantId}`,
  ]);

  const hasMore = dealRows.length > limit;
  const pageDeals = hasMore ? dealRows.slice(0, limit) : dealRows;
  const dealIds: string[] = pageDeals.map((d: any) => String(d.id));

  const pipeMap = new Map<string, string>();
  for (const p of allPipelines) pipeMap.set(String(p.id), String(p.name));

  const stageMap = new Map<string, { name: string; pipelineId: string; isWinStage: boolean }>();
  for (const s of allStages) {
    stageMap.set(String(s.id), {
      name: String(s.name),
      pipelineId: String(s.pipeline_id),
      isWinStage: Boolean(s.is_win_stage),
    });
  }

  const eventRows =
    dealIds.length > 0
      ? await sql`
          SELECT
            e.id,
            e.deal_id,
            e.event_type,
            e.from_stage_id,
            e.to_stage_id,
            e.metadata,
            e.operator_id,
            op.name AS operator_name,
            e.created_at
          FROM crm_deal_events e
          LEFT JOIN operators op ON op.id = e.operator_id AND op.tenant_id = e.tenant_id
          WHERE e.tenant_id = ${tenantId}
            AND e.deal_id IN ${sql(dealIds)}
            AND e.event_type IN ('created', 'stage_changed', 'pipeline_changed', 'bulk_updated')
          ORDER BY e.created_at ASC, e.id ASC
        `
      : [];

  const eventsByDeal = new Map<string, any[]>();
  for (const ev of eventRows) {
    const dId = String(ev.deal_id);
    const list = eventsByDeal.get(dId) || [];
    list.push(ev);
    eventsByDeal.set(dId, list);
  }

  const nowMs = Date.now();
  const historyItems: any[] = [];

  for (const deal of pageDeals) {
    const dealId = String(deal.id);
    const rawEvents = eventsByDeal.get(dealId) || [];
    const createdAt = new Date(deal.created_at);
    const terminalDate = deal.won_at
      ? new Date(deal.won_at)
      : deal.lost_at
        ? new Date(deal.lost_at)
        : deal.closed_at
          ? new Date(deal.closed_at)
          : null;

    interface StageStep {
      stageId: string;
      stageName: string;
      pipelineId: string;
      pipelineName: string;
      startDate: Date;
      operatorId: string | null;
      operatorName: string | null;
    }

    const steps: StageStep[] = [];

    for (const ev of rawEvents) {
      const meta = (ev.metadata && typeof ev.metadata === "object" ? ev.metadata : {}) as Record<
        string,
        any
      >;
      const evDate = new Date(ev.created_at);

      if (ev.event_type === "created") {
        const sId = String(meta.stageId || deal.stage_id);
        const stgInfo = stageMap.get(sId);
        const pId = String(meta.pipelineId || stgInfo?.pipelineId || deal.original_pipeline_id || deal.pipeline_id);
        steps.push({
          stageId: sId,
          stageName: stgInfo?.name || String(meta.stageName || sId),
          pipelineId: pId,
          pipelineName: pipeMap.get(pId) || String(meta.pipelineName || pId),
          startDate: steps.length === 0 ? createdAt : evDate,
          operatorId: ev.operator_id || null,
          operatorName: ev.operator_name || null,
        });
        continue;
      }

      const fromStageId = String(ev.from_stage_id || meta.fromStageId || meta.previousStageId || "");
      const toStageId = String(ev.to_stage_id || meta.toStageId || meta.newStageId || "");

      if (!toStageId || (steps.length > 0 && steps[steps.length - 1].stageId === toStageId)) {
        continue;
      }

      // Se não houve evento 'created' gravado antes da 1ª mudança de etapa, reconstrói o intervalo inicial desde deal.created_at
      if (steps.length === 0 && fromStageId && fromStageId !== toStageId) {
        const fromInfo = stageMap.get(fromStageId);
        const fromPipeId = String(
          meta.fromPipelineId || fromInfo?.pipelineId || deal.original_pipeline_id || deal.pipeline_id,
        );
        steps.push({
          stageId: fromStageId,
          stageName: fromInfo?.name || String(meta.fromStageName || fromStageId),
          pipelineId: fromPipeId,
          pipelineName: pipeMap.get(fromPipeId) || String(meta.fromPipelineName || fromPipeId),
          startDate: createdAt,
          operatorId: null,
          operatorName: null,
        });
      }

      const toInfo = stageMap.get(toStageId);
      const toPipeId = String(meta.toPipelineId || toInfo?.pipelineId || deal.pipeline_id);
      steps.push({
        stageId: toStageId,
        stageName: toInfo?.name || String(meta.toStageName || toStageId),
        pipelineId: toPipeId,
        pipelineName: pipeMap.get(toPipeId) || String(meta.toPipelineName || toPipeId),
        startDate: evDate < createdAt ? createdAt : evDate,
        operatorId: ev.operator_id || null,
        operatorName: ev.operator_name || null,
      });
    }

    // Cards legados ou sem transições registradas: garante 1 linha canônica com a etapa/funil atual desde created_at
    if (steps.length === 0) {
      const curStageInfo = stageMap.get(String(deal.stage_id));
      const curPipeId = String(deal.pipeline_id);
      steps.push({
        stageId: String(deal.stage_id),
        stageName: curStageInfo?.name || String(deal.stage_id),
        pipelineId: curPipeId,
        pipelineName: pipeMap.get(curPipeId) || curPipeId,
        startDate: createdAt,
        operatorId: null,
        operatorName: null,
      });
    }

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const nextStep = steps[i + 1];
      const isLast = i === steps.length - 1;
      const endDate = nextStep ? nextStep.startDate : terminalDate;
      const effectiveEndMs = endDate ? endDate.getTime() : nowMs;
      const durationSeconds = Math.max(0, Math.round((effectiveEndMs - step.startDate.getTime()) / 1000));
      const stepSector =
        resolveSectorFromPipelineName(step.pipelineName, step.pipelineId) ||
        (isLast ? deal.sector_current : deal.sector_origin) ||
        deal.sector_current ||
        null;

      historyItems.push({
        id: `hist:${dealId}:${i}`,
        sequence: i + 1,
        deal_id: dealId,
        id_rd: deal.rd_deal_id || null,
        pipeline_id: step.pipelineId,
        pipeline_name: step.pipelineName,
        stage_id: step.stageId,
        stage_name: step.stageName,
        sector: stepSector,
        start_date: step.startDate.toISOString(),
        end_date: endDate ? endDate.toISOString() : null,
        duration_seconds: durationSeconds,
        is_current: isLast && deal.status === "open" && !deal.won_at,
        changed_by_user_id: step.operatorId,
        changed_by_user_name: step.operatorName,
        deal_updated_at: toIso(deal.updated_at),
      });
    }
  }

  const lastDeal = pageDeals[pageDeals.length - 1];
  const nextCursor =
    hasMore && lastDeal ? encodeMarketingCursor(lastDeal.updated_at, String(lastDeal.id)) : null;

  return {
    tenant_id: tenantId,
    items: historyItems,
    pagination: {
      limit,
      deals_processed: pageDeals.length,
      returned_count: historyItems.length,
      has_more: hasMore,
      next_cursor: nextCursor,
    },
  };
}

export interface MarketingContactsFilter {
  id?: string | null;
  email?: string | null;
  phone?: string | null;
  document?: string | null;
  sectorOrigin?: string | null;
  query?: string | null;
  updatedSince?: string | null;
  createdFrom?: string | null;
  createdTo?: string | null;
  includeTests?: boolean;
  includeLegacy?: boolean;
  limit?: number;
  cursor?: string | null;
}

export async function listMarketingContacts(
  tenantId: string,
  filters: MarketingContactsFilter = {},
  sql: any = defaultSqlClient,
) {
  const limit = clampPageLimit(filters.limit, 200, 1000);
  const includeTests = filters.includeTests === true;
  const includeLegacy = filters.includeLegacy !== false;
  const decodedCursor = decodeMarketingCursor(filters.cursor);

  const conditions: any[] = [sql`c.tenant_id = ${tenantId}`];
  if (!includeTests) conditions.push(sql`c.is_test = false`);
  if (!includeLegacy) conditions.push(sql`c.is_legacy = false`);
  if (filters.id) conditions.push(sql`c.id = ${filters.id.trim()}`);
  if (filters.sectorOrigin) conditions.push(sql`c.sector_origin = ${filters.sectorOrigin.trim()}`);
  if (filters.email) {
    conditions.push(sql`lower(COALESCE(c.email, '')) = ${filters.email.trim().toLowerCase()}`);
  }
  if (filters.phone) {
    const l9 = last9PhoneDigits(filters.phone) || digitsOnly(filters.phone);
    if (l9) {
      const pat = `%${l9}`;
      conditions.push(sql`(
        COALESCE(c.phone, '') LIKE ${pat}
        OR EXISTS (
          SELECT 1 FROM contact_phones cp
          WHERE cp.tenant_id = c.tenant_id
            AND cp.contact_id = c.id
            AND cp.phone LIKE ${pat}
        )
      )`);
    }
  }
  if (filters.document) {
    const doc = digitsOnly(filters.document);
    if (doc) {
      const pat = `%${doc}%`;
      conditions.push(sql`(
        COALESCE(c.cpf, '') LIKE ${pat}
        OR COALESCE(c.cnpj, '') LIKE ${pat}
        OR COALESCE(acc.document, '') LIKE ${pat}
      )`);
    }
  }
  if (filters.query) {
    const q = `%${filters.query.trim()}%`;
    conditions.push(sql`(
      c.name ILIKE ${q}
      OR COALESCE(c.email, '') ILIKE ${q}
      OR COALESCE(c.phone, '') ILIKE ${q}
      OR COALESCE(acc.name, '') ILIKE ${q}
    )`);
  }

  const updatedSince = parseFlexibleDateBound(filters.updatedSince, "start");
  if (updatedSince) conditions.push(sql`c.updated_at >= ${updatedSince}::timestamp`);
  const createdFrom = parseFlexibleDateBound(filters.createdFrom, "start");
  if (createdFrom) conditions.push(sql`c.created_at >= ${createdFrom}::timestamp`);
  const createdTo = parseFlexibleDateBound(filters.createdTo, "end");
  if (createdTo) conditions.push(sql`c.created_at <= ${createdTo}::timestamp`);

  if (decodedCursor) {
    const cursorIso = decodedCursor.t;
    conditions.push(
      sql`(c.updated_at > ${cursorIso}::timestamp OR (c.updated_at = ${cursorIso}::timestamp AND c.id > ${decodedCursor.id}))`,
    );
  }

  const whereClause = buildWhereClause(sql, conditions);

  const rows = await sql`
    SELECT
      c.id,
      c.name,
      c.email,
      c.phone,
      c.cpf,
      c.cnpj,
      c.main_channel,
      c.account_id,
      acc.name AS account_name,
      acc.document AS account_document,
      c.first_source,
      c.first_campaign,
      c.utm_source,
      c.utm_medium,
      c.utm_campaign,
      c.utm_content,
      c.utm_term,
      c.click_id,
      c.landing_page,
      c.sector_origin,
      c.is_legacy,
      c.is_test,
      c.created_at,
      c.updated_at
    FROM contacts c
    LEFT JOIN crm_accounts acc ON acc.id = c.account_id AND acc.tenant_id = c.tenant_id
    WHERE ${whereClause}
    ORDER BY c.updated_at ASC, c.id ASC
    LIMIT ${limit + 1}
  `;

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const contactIds: string[] = pageRows.map((r: any) => String(r.id));

  const [phoneRows, dealLinks, convRows] =
    contactIds.length > 0
      ? await Promise.all([
          sql`
            SELECT contact_id, phone
            FROM contact_phones
            WHERE tenant_id = ${tenantId}
              AND contact_id IN ${sql(contactIds)}
            ORDER BY is_primary DESC, position ASC
          `,
          sql`
            SELECT contact_id, deal_id
            FROM crm_deal_contacts
            WHERE tenant_id = ${tenantId}
              AND contact_id IN ${sql(contactIds)}
          `,
          sql`
            SELECT id, contact_id
            FROM conversations
            WHERE tenant_id = ${tenantId}
              AND contact_id IN ${sql(contactIds)}
          `,
        ])
      : [[], [], []];

  const extraPhonesMap = new Map<string, string[]>();
  for (const pr of phoneRows) {
    const cid = String(pr.contact_id);
    const list = extraPhonesMap.get(cid) || [];
    list.push(String(pr.phone));
    extraPhonesMap.set(cid, list);
  }

  const dealsMap = new Map<string, string[]>();
  for (const dl of dealLinks) {
    const cid = String(dl.contact_id);
    const list = dealsMap.get(cid) || [];
    list.push(String(dl.deal_id));
    dealsMap.set(cid, list);
  }

  const convsMap = new Map<string, string[]>();
  for (const cv of convRows) {
    const cid = String(cv.contact_id);
    const list = convsMap.get(cid) || [];
    list.push(String(cv.id));
    convsMap.set(cid, list);
  }

  const items = pageRows.map((r: any) => {
    const cid = String(r.id);
    const phones = new Set<string>();
    const phonesLast9 = new Set<string>();
    if (r.phone) {
      const p = digitsOnly(r.phone);
      if (p) phones.add(p);
      const l9 = last9PhoneDigits(p);
      if (l9) phonesLast9.add(l9);
    }
    for (const ep of extraPhonesMap.get(cid) || []) {
      const p = digitsOnly(ep);
      if (p) phones.add(p);
      const l9 = last9PhoneDigits(p);
      if (l9) phonesLast9.add(l9);
    }

    const emails = r.email ? [String(r.email).trim().toLowerCase()] : [];
    const cnpjCpf =
      digitsOnly(r.cnpj) || digitsOnly(r.cpf) || digitsOnly(r.account_document) || null;

    const normalizedFirstSource =
      normalizeRdDealSource({
        explicitSource: r.first_source || null,
        utmSource: r.utm_source || null,
        utmMedium: r.utm_medium || null,
        utmCampaign: r.utm_campaign || null,
        clickId: r.click_id || null,
      }) ||
      r.first_source ||
      null;

    return {
      id: cid,
      name: r.name,
      email: r.email || null,
      emails,
      phone: r.phone || null,
      phones: Array.from(phones),
      phones_last9: Array.from(phonesLast9),
      cpf: digitsOnly(r.cpf) || null,
      cnpj: digitsOnly(r.cnpj) || null,
      cnpj_cpf: cnpjCpf,
      account_id: r.account_id || null,
      organization_name: r.account_name || null,
      organization_cnpj: digitsOnly(r.account_document) || null,
      main_channel: r.main_channel || null,
      first_source: normalizedFirstSource,
      first_campaign: r.first_campaign || null,
      utm_source: r.utm_source || null,
      utm_medium: r.utm_medium || null,
      utm_campaign: r.utm_campaign || null,
      utm_content: r.utm_content || null,
      utm_term: r.utm_term || null,
      click_id: r.click_id || null,
      landing_page: r.landing_page || null,
      sector_origin: r.sector_origin || null,
      sector_origin_label: formatMarketingSectorLabel(r.sector_origin),
      deal_ids: dealsMap.get(cid) || [],
      conversation_ids: convsMap.get(cid) || [],
      is_legacy: Boolean(r.is_legacy),
      is_test: Boolean(r.is_test),
      created_at: toIso(r.created_at),
      updated_at: toIso(r.updated_at),
    };
  });

  const lastRow = pageRows[pageRows.length - 1];
  const nextCursor =
    hasMore && lastRow ? encodeMarketingCursor(lastRow.updated_at, String(lastRow.id)) : null;

  return {
    tenant_id: tenantId,
    items,
    pagination: {
      limit,
      returned_count: items.length,
      has_more: hasMore,
      next_cursor: nextCursor,
    },
  };
}

export interface MarketingConversationsFilter {
  id?: string | null;
  contactId?: string | null;
  operatorId?: string | null;
  sectorId?: string | null;
  queueState?: string | null;
  updatedSince?: string | null;
  createdFrom?: string | null;
  createdTo?: string | null;
  includeTests?: boolean;
  limit?: number;
  cursor?: string | null;
}

export async function listMarketingConversations(
  tenantId: string,
  filters: MarketingConversationsFilter = {},
  sql: any = defaultSqlClient,
) {
  const limit = clampPageLimit(filters.limit, 200, 1000);
  const includeTests = filters.includeTests === true;
  const decodedCursor = decodeMarketingCursor(filters.cursor);

  const conditions: any[] = [sql`conv.tenant_id = ${tenantId}`];
  if (!includeTests) conditions.push(sql`c.is_test = false`);
  if (filters.id) conditions.push(sql`conv.id = ${filters.id.trim()}`);
  if (filters.contactId) conditions.push(sql`conv.contact_id = ${filters.contactId.trim()}`);
  if (filters.operatorId) conditions.push(sql`conv.operator_id = ${filters.operatorId.trim()}`);
  if (filters.sectorId) conditions.push(sql`conv.sector_id = ${filters.sectorId.trim()}`);
  if (filters.queueState) conditions.push(sql`conv.queue_state = ${filters.queueState.trim()}`);

  const updatedSince = parseFlexibleDateBound(filters.updatedSince, "start");
  if (updatedSince) conditions.push(sql`conv.updated_at >= ${updatedSince}::timestamp`);
  const createdFrom = parseFlexibleDateBound(filters.createdFrom, "start");
  if (createdFrom) conditions.push(sql`conv.created_at >= ${createdFrom}::timestamp`);
  const createdTo = parseFlexibleDateBound(filters.createdTo, "end");
  if (createdTo) conditions.push(sql`conv.created_at <= ${createdTo}::timestamp`);

  if (decodedCursor) {
    const cursorIso = decodedCursor.t;
    conditions.push(
      sql`(conv.updated_at > ${cursorIso}::timestamp OR (conv.updated_at = ${cursorIso}::timestamp AND conv.id > ${decodedCursor.id}))`,
    );
  }

  const whereClause = buildWhereClause(sql, conditions);

  const rows = await sql`
    SELECT
      conv.id,
      conv.contact_id,
      c.name AS contact_name,
      COALESCE(conv.contact_phone, c.phone) AS contact_phone,
      c.email AS contact_email,
      c.main_channel,
      c.first_source,
      c.first_campaign,
      c.sector_origin AS contact_sector_origin,
      conv.operator_id,
      op.name AS operator_name,
      conv.sector_id,
      sec.name AS sector_name,
      conv.queue_state,
      conv.unread_count,
      conv.last_message_time,
      conv.created_at,
      conv.updated_at
    FROM conversations conv
    JOIN contacts c ON c.id = conv.contact_id AND c.tenant_id = conv.tenant_id
    LEFT JOIN operators op ON op.id = conv.operator_id AND op.tenant_id = conv.tenant_id
    LEFT JOIN sectors sec ON sec.id = conv.sector_id AND sec.tenant_id = conv.tenant_id
    WHERE ${whereClause}
    ORDER BY conv.updated_at ASC, conv.id ASC
    LIMIT ${limit + 1}
  `;

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const convIds: string[] = pageRows.map((r: any) => String(r.id));

  const [msgAggRows, dealLinkRows] =
    convIds.length > 0
      ? await Promise.all([
          sql`
            SELECT
              m.conversation_id,
              COUNT(*) FILTER (WHERE m.is_internal_note = false)::int AS total_msg_count,
              COUNT(*) FILTER (WHERE m.is_internal_note = false AND m.sender_type = 'client')::int AS client_msg_count,
              COUNT(*) FILTER (WHERE m.is_internal_note = false AND m.sender_type IN ('bot', 'ai'))::int AS bot_msg_count,
              COUNT(*) FILTER (WHERE m.is_internal_note = false AND m.sender_type = 'operator')::int AS human_msg_count,
              MIN(m.sent_at) FILTER (WHERE m.is_internal_note = false AND m.sender_type = 'client') AS first_client_message_at,
              MIN(m.sent_at) FILTER (WHERE m.is_internal_note = false AND m.sender_type IN ('bot', 'ai')) AS first_bot_response_at,
              MIN(m.sent_at) FILTER (WHERE m.is_internal_note = false AND m.sender_type = 'operator') AS first_human_response_at,
              MAX(m.sent_at) FILTER (WHERE m.is_internal_note = false AND m.sender_type = 'client') AS last_client_message_at,
              MAX(m.sent_at) FILTER (WHERE m.is_internal_note = false AND m.sender_type = 'operator') AS last_human_message_at
            FROM messages m
            WHERE m.tenant_id = ${tenantId}
              AND m.conversation_id IN ${sql(convIds)}
            GROUP BY m.conversation_id
          `,
          sql`
            SELECT conversation_id, deal_id
            FROM crm_conversation_deals
            WHERE tenant_id = ${tenantId}
              AND conversation_id IN ${sql(convIds)}
              AND is_active = true
          `,
        ])
      : [[], []];

  const aggMap = new Map<string, any>();
  for (const ag of msgAggRows) aggMap.set(String(ag.conversation_id), ag);

  const dealsByConv = new Map<string, string[]>();
  for (const dl of dealLinkRows) {
    const cid = String(dl.conversation_id);
    const list = dealsByConv.get(cid) || [];
    list.push(String(dl.deal_id));
    dealsByConv.set(cid, list);
  }

  const nowMs = Date.now();
  const items = pageRows.map((r: any) => {
    const convId = String(r.id);
    const agg = aggMap.get(convId) || {};
    const clientCount = Number(agg.client_msg_count || 0);
    const botCount = Number(agg.bot_msg_count || 0);
    const humanCount = Number(agg.human_msg_count || 0);
    const totalCount = Number(agg.total_msg_count || 0);

    const firstClientAt = agg.first_client_message_at ? new Date(agg.first_client_message_at) : null;
    const firstBotAt = agg.first_bot_response_at ? new Date(agg.first_bot_response_at) : null;
    const firstHumanAt = agg.first_human_response_at ? new Date(agg.first_human_response_at) : null;
    const lastClientAt = agg.last_client_message_at ? new Date(agg.last_client_message_at) : null;
    const lastHumanAt = agg.last_human_message_at ? new Date(agg.last_human_message_at) : null;

    const firstBotSeconds =
      firstClientAt && firstBotAt && firstBotAt >= firstClientAt
        ? Math.round((firstBotAt.getTime() - firstClientAt.getTime()) / 1000)
        : null;
    const firstHumanSeconds =
      firstClientAt && firstHumanAt && firstHumanAt >= firstClientAt
        ? Math.round((firstHumanAt.getTime() - firstClientAt.getTime()) / 1000)
        : null;

    const onlyBot = clientCount > 0 && botCount > 0 && humanCount === 0;
    const isUnanswered = clientCount > 0 && botCount === 0 && humanCount === 0;
    const hoursSinceLastClient =
      lastClientAt ? Number(((nowMs - lastClientAt.getTime()) / 3_600_000).toFixed(2)) : null;

    return {
      id: convId,
      contact_id: r.contact_id,
      contact_name: r.contact_name,
      contact_phone: r.contact_phone || null,
      contact_phone_last9: last9PhoneDigits(r.contact_phone),
      contact_email: r.contact_email || null,
      contact_first_source: r.first_source || null,
      contact_first_campaign: r.first_campaign || null,
      contact_sector_origin: r.contact_sector_origin || null,
      channel: r.main_channel || "whatsapp",
      operator_id: r.operator_id || null,
      operator_name: r.operator_name || null,
      sector_id: r.sector_id || null,
      sector_name: r.sector_name || null,
      queue_state: r.queue_state,
      unread_count: Number(r.unread_count || 0),
      linked_deal_ids: dealsByConv.get(convId) || [],
      total_msg_count: totalCount,
      client_msg_count: clientCount,
      bot_msg_count: botCount,
      human_msg_count: humanCount,
      first_client_message_at: toIso(firstClientAt),
      first_bot_response_at: toIso(firstBotAt),
      first_human_response_at: toIso(firstHumanAt),
      first_bot_response_seconds: firstBotSeconds,
      first_human_response_seconds: firstHumanSeconds,
      last_client_message_at: toIso(lastClientAt),
      last_human_message_at: toIso(lastHumanAt),
      last_message_at: toIso(r.last_message_time),
      only_bot: onlyBot,
      is_unanswered: isUnanswered,
      hours_since_last_client_message: hoursSinceLastClient,
      created_at: toIso(r.created_at),
      updated_at: toIso(r.updated_at),
    };
  });

  const lastRow = pageRows[pageRows.length - 1];
  const nextCursor =
    hasMore && lastRow ? encodeMarketingCursor(lastRow.updated_at, String(lastRow.id)) : null;

  return {
    tenant_id: tenantId,
    items,
    pagination: {
      limit,
      returned_count: items.length,
      has_more: hasMore,
      next_cursor: nextCursor,
    },
  };
}

export interface MarketingMessagesFilter {
  conversationId?: string | null;
  contactId?: string | null;
  senderType?: string | null;
  updatedSince?: string | null;
  sentFrom?: string | null;
  sentTo?: string | null;
  includeContent?: boolean;
  includeInternalNotes?: boolean;
  limit?: number;
  cursor?: string | null;
}

/**
 * Lista mensagens de atendimento em massa.
 * Por padrão (`includeContent = false`), devolve APENAS METADADOS (sem corpo de texto)
 * para viabilizar extração mensal rápida no script das 09h.
 */
export async function listMarketingMessages(
  tenantId: string,
  filters: MarketingMessagesFilter = {},
  sql: any = defaultSqlClient,
) {
  const limit = clampPageLimit(filters.limit, 500, 1000);
  const includeContent = filters.includeContent === true;
  const includeInternalNotes = filters.includeInternalNotes === true;
  const decodedCursor = decodeMarketingCursor(filters.cursor);

  const conditions: any[] = [sql`m.tenant_id = ${tenantId}`];
  if (!includeInternalNotes) {
    conditions.push(sql`m.is_internal_note = false`);
  }
  if (filters.conversationId) {
    conditions.push(sql`m.conversation_id = ${filters.conversationId.trim()}`);
  }
  if (filters.contactId) {
    conditions.push(sql`conv.contact_id = ${filters.contactId.trim()}`);
  }
  if (filters.senderType) {
    conditions.push(sql`m.sender_type = ${filters.senderType.trim()}`);
  }

  const updatedSince = parseFlexibleDateBound(filters.updatedSince, "start");
  if (updatedSince) conditions.push(sql`COALESCE(m.updated_at, m.sent_at) >= ${updatedSince}::timestamp`);
  const sentFrom = parseFlexibleDateBound(filters.sentFrom, "start");
  if (sentFrom) conditions.push(sql`m.sent_at >= ${sentFrom}::timestamp`);
  const sentTo = parseFlexibleDateBound(filters.sentTo, "end");
  if (sentTo) conditions.push(sql`m.sent_at <= ${sentTo}::timestamp`);

  if (decodedCursor) {
    const cursorIso = decodedCursor.t;
    conditions.push(
      sql`(m.sent_at > ${cursorIso}::timestamp OR (m.sent_at = ${cursorIso}::timestamp AND m.id > ${decodedCursor.id}))`,
    );
  }

  const whereClause = buildWhereClause(sql, conditions);

  const rows = await sql`
    SELECT
      m.id,
      m.conversation_id,
      conv.contact_id,
      m.sender_type,
      m.sender_name,
      m.direction,
      m.provider,
      m.status,
      m.is_internal_note,
      char_length(COALESCE(m.content, ''))::int AS char_length,
      (m.content LIKE '[MEDIA:%')::boolean AS has_media,
      CASE
        WHEN m.content LIKE '[MEDIA:audio]%' THEN 'audio'
        WHEN m.content LIKE '[MEDIA:image]%' THEN 'image'
        WHEN m.content LIKE '[MEDIA:video]%' THEN 'video'
        WHEN m.content LIKE '[MEDIA:document]%' THEN 'document'
        ELSE NULL
      END AS media_type,
      ${includeContent ? sql`m.content` : sql`NULL::text`} AS content,
      m.meta_details,
      m.sent_at,
      m.updated_at
    FROM messages m
    JOIN conversations conv ON conv.id = m.conversation_id AND conv.tenant_id = m.tenant_id
    WHERE ${whereClause}
    ORDER BY m.sent_at ASC, m.id ASC
    LIMIT ${limit + 1}
  `;

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const convIds: string[] = Array.from(new Set(pageRows.map((r: any) => String(r.conversation_id))));

  const dealLinkRows =
    convIds.length > 0
      ? await sql`
          SELECT conversation_id, deal_id
          FROM crm_conversation_deals
          WHERE tenant_id = ${tenantId}
            AND conversation_id IN ${sql(convIds)}
            AND is_active = true
        `
      : [];

  const dealsByConv = new Map<string, string[]>();
  for (const dl of dealLinkRows) {
    const cid = String(dl.conversation_id);
    const list = dealsByConv.get(cid) || [];
    list.push(String(dl.deal_id));
    dealsByConv.set(cid, list);
  }

  const items = pageRows.map((r: any) => {
    const meta = (r.meta_details && typeof r.meta_details === "object" ? r.meta_details : {}) as Record<
      string,
      any
    >;
    const item: Record<string, unknown> = {
      id: r.id,
      conversation_id: r.conversation_id,
      contact_id: r.contact_id,
      linked_deal_ids: dealsByConv.get(String(r.conversation_id)) || [],
      sent_at: toIso(r.sent_at),
      updated_at: toIso(r.updated_at || r.sent_at),
      sender_type: r.sender_type,
      sender_name: r.sender_name || null,
      direction: r.direction || (r.sender_type === "client" ? "inbound" : "outbound"),
      provider: r.provider || null,
      status: r.status || null,
      is_internal_note: Boolean(r.is_internal_note),
      has_media: Boolean(r.has_media),
      media_type: r.media_type || null,
      char_length: Number(r.char_length || 0),
      marketing_attribution: meta.marketingAttribution || null,
    };
    if (includeContent) {
      item.content = r.content || "";
    }
    return item;
  });

  const lastRow = pageRows[pageRows.length - 1];
  const nextCursor =
    hasMore && lastRow ? encodeMarketingCursor(lastRow.sent_at, String(lastRow.id)) : null;

  return {
    tenant_id: tenantId,
    metadata_only: !includeContent,
    items,
    pagination: {
      limit,
      returned_count: items.length,
      has_more: hasMore,
      next_cursor: nextCursor,
    },
  };
}

export interface MarketingActivitiesFilter {
  dealId?: string | null;
  operatorId?: string | null;
  type?: string | null;
  status?: string | null;
  updatedSince?: string | null;
  createdFrom?: string | null;
  createdTo?: string | null;
  dueFrom?: string | null;
  dueTo?: string | null;
  includeTests?: boolean;
  limit?: number;
  cursor?: string | null;
}

export async function listMarketingActivities(
  tenantId: string,
  filters: MarketingActivitiesFilter = {},
  sql: any = defaultSqlClient,
) {
  const limit = clampPageLimit(filters.limit, 250, 1000);
  const includeTests = filters.includeTests === true;
  const decodedCursor = decodeMarketingCursor(filters.cursor);

  const conditions: any[] = [sql`a.tenant_id = ${tenantId}`];
  if (!includeTests) conditions.push(sql`d.is_test = false`);
  if (filters.dealId) conditions.push(sql`a.deal_id = ${filters.dealId.trim()}`);
  if (filters.operatorId) {
    const opId = filters.operatorId.trim();
    conditions.push(sql`(a.operator_id = ${opId} OR a.assigned_to_operator_id = ${opId})`);
  }
  if (filters.type) conditions.push(sql`a.type = ${filters.type.trim()}`);
  if (filters.status) conditions.push(sql`a.status = ${filters.status.trim()}`);

  const updatedSince = parseFlexibleDateBound(filters.updatedSince, "start");
  if (updatedSince) conditions.push(sql`a.updated_at >= ${updatedSince}::timestamp`);
  const createdFrom = parseFlexibleDateBound(filters.createdFrom, "start");
  if (createdFrom) conditions.push(sql`a.created_at >= ${createdFrom}::timestamp`);
  const createdTo = parseFlexibleDateBound(filters.createdTo, "end");
  if (createdTo) conditions.push(sql`a.created_at <= ${createdTo}::timestamp`);
  const dueFrom = parseFlexibleDateBound(filters.dueFrom, "start");
  if (dueFrom) conditions.push(sql`a.due_date >= ${dueFrom}::timestamp`);
  const dueTo = parseFlexibleDateBound(filters.dueTo, "end");
  if (dueTo) conditions.push(sql`a.due_date <= ${dueTo}::timestamp`);

  if (decodedCursor) {
    const cursorIso = decodedCursor.t;
    conditions.push(
      sql`(a.updated_at > ${cursorIso}::timestamp OR (a.updated_at = ${cursorIso}::timestamp AND a.id > ${decodedCursor.id}))`,
    );
  }

  const whereClause = buildWhereClause(sql, conditions);

  const rows = await sql`
    SELECT
      a.id,
      a.rd_task_id,
      a.deal_id,
      d.rd_deal_id,
      d.title AS deal_title,
      d.sector_origin AS deal_sector_origin,
      d.sector_current AS deal_sector_current,
      a.conversation_id,
      a.type,
      a.title,
      a.description,
      a.completion_note,
      a.status,
      a.due_date,
      a.completed_at,
      a.operator_id,
      op_creator.name AS operator_name,
      a.assigned_to_operator_id,
      op_assignee.name AS assigned_to_name,
      a.created_at,
      a.updated_at
    FROM crm_deal_activities a
    JOIN crm_deals d ON d.id = a.deal_id AND d.tenant_id = a.tenant_id
    LEFT JOIN operators op_creator ON op_creator.id = a.operator_id AND op_creator.tenant_id = a.tenant_id
    LEFT JOIN operators op_assignee ON op_assignee.id = a.assigned_to_operator_id AND op_assignee.tenant_id = a.tenant_id
    WHERE ${whereClause}
    ORDER BY a.updated_at ASC, a.id ASC
    LIMIT ${limit + 1}
  `;

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const nowMs = Date.now();

  const items = pageRows.map((r: any) => {
    const dueMs = r.due_date ? new Date(r.due_date).getTime() : null;
    const isOverdue =
      r.status === "pending" && r.type !== "note" && dueMs !== null && dueMs < nowMs;

    return {
      id: r.id,
      rd_task_id: r.rd_task_id || null,
      deal_id: r.deal_id,
      id_rd: r.rd_deal_id || null,
      deal_name: r.deal_title,
      deal_sector_origin: r.deal_sector_origin || null,
      deal_sector_current: r.deal_sector_current || null,
      conversation_id: r.conversation_id || null,
      type: r.type,
      title: r.title,
      description: r.description || null,
      completion_note: r.completion_note || null,
      status: r.status,
      due_date: toIso(r.due_date),
      completed_at: toIso(r.completed_at),
      is_overdue: isOverdue,
      operator_id: r.operator_id || null,
      operator_name: r.operator_name || null,
      assigned_to_id: r.assigned_to_operator_id || null,
      assigned_to_name: r.assigned_to_name || null,
      created_at: toIso(r.created_at),
      updated_at: toIso(r.updated_at),
    };
  });

  const lastRow = pageRows[pageRows.length - 1];
  const nextCursor =
    hasMore && lastRow ? encodeMarketingCursor(lastRow.updated_at, String(lastRow.id)) : null;

  return {
    tenant_id: tenantId,
    items,
    pagination: {
      limit,
      returned_count: items.length,
      has_more: hasMore,
      next_cursor: nextCursor,
    },
  };
}

export interface MarketingTriagesFilter {
  conversationId?: string | null;
  outcome?: string | null;
  updatedSince?: string | null;
  startedFrom?: string | null;
  startedTo?: string | null;
  includeTests?: boolean;
  limit?: number;
  cursor?: string | null;
}

export async function listMarketingTriages(
  tenantId: string,
  filters: MarketingTriagesFilter = {},
  sql: any = defaultSqlClient,
) {
  const limit = clampPageLimit(filters.limit, 200, 1000);
  const includeTests = filters.includeTests === true;
  const decodedCursor = decodeMarketingCursor(filters.cursor);

  const conditions: any[] = [
    sql`afs.tenant_id = ${tenantId}`,
    sql`afs.agent_type = 'sdr'`,
  ];
  if (!includeTests) conditions.push(sql`c.is_test = false`);
  if (filters.conversationId) {
    conditions.push(sql`afs.conversation_id = ${filters.conversationId.trim()}`);
  }
  if (filters.outcome) {
    conditions.push(sql`afs.outcome = ${filters.outcome.trim()}`);
  }

  const updatedSince = parseFlexibleDateBound(filters.updatedSince, "start");
  if (updatedSince) conditions.push(sql`afs.last_interaction_at >= ${updatedSince}::timestamp`);
  const startedFrom = parseFlexibleDateBound(filters.startedFrom, "start");
  if (startedFrom) conditions.push(sql`afs.started_at >= ${startedFrom}::timestamp`);
  const startedTo = parseFlexibleDateBound(filters.startedTo, "end");
  if (startedTo) conditions.push(sql`afs.started_at <= ${startedTo}::timestamp`);

  if (decodedCursor) {
    const cursorIso = decodedCursor.t;
    conditions.push(
      sql`(afs.last_interaction_at > ${cursorIso}::timestamp OR (afs.last_interaction_at = ${cursorIso}::timestamp AND afs.id > ${decodedCursor.id}))`,
    );
  }

  const whereClause = buildWhereClause(sql, conditions);

  const rows = await sql`
    SELECT
      afs.id,
      afs.conversation_id,
      afs.current_step,
      afs.collected_data,
      afs.metadata,
      afs.started_at,
      afs.last_interaction_at,
      afs.completed_at,
      afs.outcome,
      conv.contact_id,
      conv.queue_state,
      conv.operator_id,
      op.name AS operator_name,
      conv.sector_id,
      sec.name AS sector_name,
      c.name AS contact_name,
      c.phone AS contact_phone,
      c.email AS contact_email,
      c.first_source,
      c.first_campaign
    FROM agent_flow_states afs
    JOIN conversations conv ON conv.id = afs.conversation_id AND conv.tenant_id = afs.tenant_id
    JOIN contacts c ON c.id = conv.contact_id AND c.tenant_id = conv.tenant_id
    LEFT JOIN operators op ON op.id = conv.operator_id AND op.tenant_id = conv.tenant_id
    LEFT JOIN sectors sec ON sec.id = conv.sector_id AND sec.tenant_id = conv.tenant_id
    WHERE ${whereClause}
    ORDER BY afs.last_interaction_at ASC, afs.id ASC
    LIMIT ${limit + 1}
  `;

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const convIds: string[] = Array.from(new Set(pageRows.map((r: any) => String(r.conversation_id))));

  const dealLinks =
    convIds.length > 0
      ? await sql`
          SELECT conversation_id, deal_id
          FROM crm_conversation_deals
          WHERE tenant_id = ${tenantId}
            AND conversation_id IN ${sql(convIds)}
            AND is_active = true
        `
      : [];

  const dealsByConv = new Map<string, string[]>();
  for (const dl of dealLinks) {
    const cid = String(dl.conversation_id);
    const list = dealsByConv.get(cid) || [];
    list.push(String(dl.deal_id));
    dealsByConv.set(cid, list);
  }

  const items = pageRows.map((r: any) => {
    const collected =
      r.collected_data && typeof r.collected_data === "object"
        ? (r.collected_data as Record<string, any>)
        : {};
    const meta =
      r.metadata && typeof r.metadata === "object" ? (r.metadata as Record<string, any>) : {};

    let monitoringState: string | null = null;
    try {
      const projected = projectIndustrialMonitoring({
        currentStep: r.current_step,
        outcome: r.outcome,
        collectedData: collected,
        metadata: meta,
        queueState: r.queue_state,
        operatorId: r.operator_id,
      } as any);
      monitoringState = projected?.state || null;
    } catch {
      monitoringState = r.outcome || r.current_step || null;
    }

    const startedAt = r.started_at ? new Date(r.started_at) : null;
    const endedAt = r.completed_at
      ? new Date(r.completed_at)
      : r.last_interaction_at
        ? new Date(r.last_interaction_at)
        : null;
    const durationSeconds =
      startedAt && endedAt && endedAt >= startedAt
        ? Math.round((endedAt.getTime() - startedAt.getTime()) / 1000)
        : null;

    const localCrm = (meta.localCrm && typeof meta.localCrm === "object" ? meta.localCrm : {}) as Record<
      string,
      any
    >;

    return {
      id: r.id,
      conversation_id: r.conversation_id,
      contact_id: r.contact_id,
      contact_name: r.contact_name,
      contact_phone: r.contact_phone || null,
      contact_phone_last9: last9PhoneDigits(r.contact_phone),
      contact_email: r.contact_email || null,
      contact_first_source: r.first_source || null,
      contact_first_campaign: r.first_campaign || null,
      current_step: r.current_step,
      monitoring_state: monitoringState,
      outcome: r.outcome || null,
      target_funnel:
        collected.targetFunnel ||
        collected.recommendedSector ||
        r.sector_name ||
        null,
      allocated_operator_id: r.operator_id || null,
      allocated_operator_name: r.operator_name || null,
      linked_deal_ids: Array.from(
        new Set([
          ...(dealsByConv.get(String(r.conversation_id)) || []),
          ...(localCrm.dealId ? [String(localCrm.dealId)] : []),
        ]),
      ),
      started_at: toIso(startedAt),
      last_interaction_at: toIso(r.last_interaction_at),
      completed_at: toIso(r.completed_at),
      duration_seconds: durationSeconds,
      collected_data: collected,
    };
  });

  const lastRow = pageRows[pageRows.length - 1];
  const nextCursor =
    hasMore && lastRow
      ? encodeMarketingCursor(lastRow.last_interaction_at, String(lastRow.id))
      : null;

  return {
    tenant_id: tenantId,
    items,
    pagination: {
      limit,
      returned_count: items.length,
      has_more: hasMore,
      next_cursor: nextCursor,
    },
  };
}

export interface MarketingGoalsFilter {
  month?: string | null; // YYYY-MM ou 'all'
  division?: string | null;
  operatorId?: string | null;
}

export async function listMarketingGoals(
  tenantId: string,
  filters: MarketingGoalsFilter = {},
  sql: any = defaultSqlClient,
) {
  const nowSpDay = saoPauloDay(new Date());
  const defaultMonth = nowSpDay.slice(0, 7);
  const rawMonth = filters.month?.trim();
  const filterAllMonths = rawMonth === "all";
  const targetMonth = !rawMonth ? defaultMonth : rawMonth;

  const conditions: any[] = [sql`g.tenant_id = ${tenantId}`];
  if (!filterAllMonths) {
    conditions.push(sql`g.month = ${targetMonth}`);
  }
  if (filters.operatorId) {
    conditions.push(sql`g.operator_id = ${filters.operatorId.trim()}`);
  }
  if (filters.division) {
    conditions.push(sql`lower(COALESCE(ccp.division, '')) = ${filters.division.trim().toLowerCase()}`);
  }

  const whereClause = buildWhereClause(sql, conditions);

  const [goalRows, calendarRows] = await Promise.all([
    sql`
      SELECT
        g.id,
        g.month,
        g.operator_id,
        op.name AS operator_name,
        op.email AS operator_email,
        ccp.division,
        ccp.active_on_tv,
        ccp.rd_user_id,
        g.target_value,
        g.conversion_rate,
        g.updated_at
      FROM commercial_goals g
      JOIN operators op ON op.id = g.operator_id AND op.tenant_id = g.tenant_id
      LEFT JOIN commercial_consultant_profiles ccp
        ON ccp.operator_id = g.operator_id
       AND ccp.tenant_id = g.tenant_id
      WHERE ${whereClause}
      ORDER BY g.month DESC, ccp.division ASC NULLS LAST, op.name ASC
    `,
    !filterAllMonths
      ? sql`
          SELECT date, type, scope, description, affects_goal
          FROM commercial_calendar_days
          WHERE tenant_id = ${tenantId}
            AND date LIKE ${`${targetMonth}-%`}
          ORDER BY date ASC
        `
      : Promise.resolve([]),
  ]);

  let businessCalendar: Record<string, unknown> | null = null;
  if (!filterAllMonths && /^\d{4}-\d{2}$/.test(targetMonth)) {
    try {
      const pacing = calculateBusinessPacing(targetMonth, calendarRows as any, new Date());
      businessCalendar = {
        month: targetMonth,
        total_business_days: pacing.totalBusinessDays,
        elapsed_business_days: pacing.elapsedBusinessDays,
        remaining_business_days: pacing.remainingBusinessDays,
        pacing_ratio: pacing.pacingRatio,
        special_days: calendarRows,
      };
    } catch {
      businessCalendar = {
        month: targetMonth,
        special_days: calendarRows,
      };
    }
  }

  const items = goalRows.map((r: any) => {
    const divNorm = String(r.division || "").toLowerCase();
    const sector =
      divNorm === "maquinas" || divNorm === "semi_industrial"
        ? "semi_industrial"
        : divNorm === "personnalite" || divNorm === "personalite"
          ? "personnalite"
          : null;
    return {
      id: r.id,
      month: r.month,
      user_id: r.operator_id,
      user_name: r.operator_name,
      user_email: r.operator_email,
      rd_user_id: r.rd_user_id || null,
      division: r.division || null,
      sector,
      sector_label: formatMarketingSectorLabel(sector),
      active_on_tv: r.active_on_tv !== false,
      target_value: Number(r.target_value || 0),
      conversion_rate_target: Number(r.conversion_rate || 0),
      updated_at: toIso(r.updated_at),
    };
  });

  const totalsBySector: Record<string, number> = {};
  let totalTargetValue = 0;
  for (const item of items) {
    totalTargetValue += item.target_value;
    const key = item.sector || "unassigned";
    totalsBySector[key] = Number(((totalsBySector[key] || 0) + item.target_value).toFixed(2));
  }

  return {
    tenant_id: tenantId,
    month: filterAllMonths ? "all" : targetMonth,
    total_target_value: Number(totalTargetValue.toFixed(2)),
    totals_by_sector: totalsBySector,
    business_calendar: businessCalendar,
    items,
  };
}

export interface MarketingAuditBatchFilter {
  dealIds?: string[];
  campaign?: string | null;
  utmCampaign?: string | null;
  source?: string | null;
  sectorOrigin?: string | null;
  sectorCurrent?: string | null;
  operatorId?: string | null;
  pipelineId?: string | null;
  status?: string | null;
  createdFrom?: string | null;
  createdTo?: string | null;
  includeTests?: boolean;
  maxMessagesPerConversation?: number;
  limit?: number;
}

/**
 * Atalho de auditoria qualitativa lead a lead (lotes de 15 a 50 negociações):
 * devolve o card completo + contatos + histórico de etapas + triagem do bot + atividades +
 * transcrição cronológica das conversas vinculadas.
 */
export async function getMarketingAuditBatch(
  tenantId: string,
  filters: MarketingAuditBatchFilter = {},
  sql: any = defaultSqlClient,
) {
  const limit = clampPageLimit(filters.limit, 20, 50);
  const maxMsgs = clampPageLimit(filters.maxMessagesPerConversation, 80, 200);

  let dealsResult: Awaited<ReturnType<typeof listMarketingDeals>>;

  if (Array.isArray(filters.dealIds) && filters.dealIds.length > 0) {
    const cleanIds = filters.dealIds.map((id) => String(id).trim()).filter(Boolean).slice(0, 50);
    const matchingRows = await sql`
      SELECT id FROM crm_deals
      WHERE tenant_id = ${tenantId}
        AND id IN ${sql(cleanIds)}
    `;
    const validSet = new Set(matchingRows.map((r: any) => String(r.id)));
    const allFetched: any[] = [];
    for (const dId of cleanIds) {
      if (!validSet.has(dId)) continue;
      const single = await listMarketingDeals(
        tenantId,
        { id: dId, includeTests: true, includeLegacy: true, limit: 1 },
        sql,
      );
      if (single.items[0]) allFetched.push(single.items[0]);
    }
    dealsResult = {
      tenant_id: tenantId,
      items: allFetched,
      pagination: {
        limit: cleanIds.length,
        returned_count: allFetched.length,
        has_more: false,
        next_cursor: null,
      },
    };
  } else {
    dealsResult = await listMarketingDeals(
      tenantId,
      {
        campaign: filters.campaign,
        utmCampaign: filters.utmCampaign,
        source: filters.source,
        sectorOrigin: filters.sectorOrigin,
        sectorCurrent: filters.sectorCurrent,
        operatorId: filters.operatorId,
        pipelineId: filters.pipelineId,
        status: filters.status,
        createdFrom: filters.createdFrom,
        createdTo: filters.createdTo,
        includeTests: filters.includeTests === true,
        order: "desc",
        limit,
      },
      sql,
    );
  }

  const deals = dealsResult.items;
  if (deals.length === 0) {
    return {
      tenant_id: tenantId,
      batch_size: 0,
      items: [],
    };
  }

  const allConvIds = Array.from(
    new Set(deals.flatMap((d: any) => d.linked_conversation_ids || [])),
  );
  const dealIds = deals.map((d: any) => String(d.id));

  // Busca em paralelo histórico de etapas, atividades, triagens e mensagens das conversas do lote
  const [stageHistByDealEntries, activitiesRows, triagesRes, messageRows] = await Promise.all([
    Promise.all(
      dealIds.map(async (dId) => {
        const res = await listMarketingStageHistory(
          tenantId,
          { dealId: dId, includeTests: true, includeLegacy: true, limit: 1 },
          sql,
        );
        return [dId, res.items] as const;
      }),
    ),
    sql`
      SELECT
        a.id,
        a.deal_id,
        a.type,
        a.title,
        a.description,
        a.completion_note,
        a.status,
        a.due_date,
        a.completed_at,
        op.name AS operator_name,
        a.created_at
      FROM crm_deal_activities a
      LEFT JOIN operators op ON op.id = COALESCE(a.assigned_to_operator_id, a.operator_id) AND op.tenant_id = a.tenant_id
      WHERE a.tenant_id = ${tenantId}
        AND a.deal_id IN ${sql(dealIds)}
      ORDER BY a.created_at ASC
    `,
    allConvIds.length > 0
      ? Promise.all(
          allConvIds.map(async (cId) => {
            const tr = await listMarketingTriages(
              tenantId,
              { conversationId: cId, includeTests: true, limit: 10 },
              sql,
            );
            return [cId, tr.items] as const;
          }),
        )
      : Promise.resolve([]),
    allConvIds.length > 0
      ? sql`
          SELECT
            m.id,
            m.conversation_id,
            m.sender_type,
            m.sender_name,
            m.content,
            m.sent_at
          FROM messages m
          WHERE m.tenant_id = ${tenantId}
            AND m.conversation_id IN ${sql(allConvIds)}
            AND m.is_internal_note = false
          ORDER BY m.sent_at ASC
        `
      : Promise.resolve([]),
  ]);

  const stageHistMap = new Map<string, any[]>(stageHistByDealEntries);

  const actsByDeal = new Map<string, any[]>();
  for (const a of activitiesRows) {
    const dId = String(a.deal_id);
    const list = actsByDeal.get(dId) || [];
    list.push({
      id: a.id,
      type: a.type,
      title: a.title,
      description: a.description || null,
      completion_note: a.completion_note || null,
      status: a.status,
      due_date: toIso(a.due_date),
      completed_at: toIso(a.completed_at),
      operator_name: a.operator_name || null,
      created_at: toIso(a.created_at),
    });
    actsByDeal.set(dId, list);
  }

  const triagesByConv = new Map<string, any[]>(triagesRes as Array<readonly [string, any[]]>);

  const msgsByConv = new Map<string, any[]>();
  for (const m of messageRows) {
    const cId = String(m.conversation_id);
    const list = msgsByConv.get(cId) || [];
    if (list.length < maxMsgs) {
      list.push({
        id: m.id,
        sent_at: toIso(m.sent_at),
        sender_type: m.sender_type,
        sender_name: m.sender_name || null,
        content: m.content || "",
      });
      msgsByConv.set(cId, list);
    }
  }

  const enrichedItems = deals.map((deal: any) => {
    const dId = String(deal.id);
    const convIds: string[] = deal.linked_conversation_ids || [];
    const conversationsTranscript = convIds.map((cId) => ({
      conversation_id: cId,
      triages: triagesByConv.get(cId) || [],
      messages: msgsByConv.get(cId) || [],
    }));

    return {
      deal,
      stage_history: stageHistMap.get(dId) || [],
      activities: actsByDeal.get(dId) || [],
      conversations: conversationsTranscript,
    };
  });

  return {
    tenant_id: tenantId,
    batch_size: enrichedItems.length,
    items: enrichedItems,
  };
}
