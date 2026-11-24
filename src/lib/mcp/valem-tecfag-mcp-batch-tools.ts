import {
  formatMarketingSectorLabel,
  isEffectiveCommercialWin,
} from "../marketing/crm-attribution";
import {
  listMarketingStageHistory,
  projectCanonicalDealSourceName,
} from "../marketing/crm-reporting-service";
import {
  computeAccountFilledFields,
  formatAccountCustomFields,
  normalizeCustomFieldDefinitionRow,
} from "./valem-tecfag-mcp-account-fields";

export const GET_CRM_DEALS_BATCH_MAX_IDS = 50;

export const GET_CRM_DEALS_BATCH_TOOL_SCHEMA = {
  name: "get_crm_deals_batch",
  access: "read" as const,
  description:
    "Lê a ficha 360º de até 50 negociações do CRM em uma única chamada otimizada em lote (substitui dezenas de chamadas sequenciais a get_crm_deal_details). Permite controlar quais blocos incluir (contatos, produtos, propostas, atividades, eventos, conversas vinculadas e histórico de etapas) para máxima velocidade de sincronização.",
  inputSchema: {
    type: "object",
    required: ["dealIds"],
    properties: {
      tenantId: {
        type: "string",
        enum: ["tecfag", "valem"],
        default: "tecfag",
        description: "Tenant do sistema ('tecfag' ou 'valem'). Ignorado quando a chave MCP está travada em um tenant.",
      },
      dealIds: {
        type: "array",
        items: { type: "string" },
        minItems: 1,
        maxItems: GET_CRM_DEALS_BATCH_MAX_IDS,
        description: `Lista de IDs de negociações (crm_deals.id) a carregar em lote (1 a ${GET_CRM_DEALS_BATCH_MAX_IDS} itens).`,
      },
      includeContacts: {
        type: "boolean",
        default: true,
        description: "Se true (padrão), inclui contatos vinculados a cada card.",
      },
      includeProducts: {
        type: "boolean",
        default: true,
        description: "Se true (padrão), inclui produtos/itens orçados de cada card.",
      },
      includeProposals: {
        type: "boolean",
        default: true,
        description: "Se true (padrão), inclui propostas comerciais de cada card.",
      },
      includeActivities: {
        type: "boolean",
        default: true,
        description: "Se true (padrão), inclui atividades/tarefas recentes de cada card.",
      },
      activitiesLimit: {
        type: "number",
        default: 10,
        description: "Máximo de atividades recentes por card (padrão 10, máx 30).",
      },
      includeEvents: {
        type: "boolean",
        default: false,
        description: "Se true, inclui eventos recentes de auditoria do card (padrão false para maior velocidade).",
      },
      eventsLimit: {
        type: "number",
        default: 20,
        description: "Máximo de eventos recentes por card quando includeEvents=true (padrão 20, máx 50).",
      },
      includeConversations: {
        type: "boolean",
        default: true,
        description: "Se true (padrão), inclui conversas WhatsApp/Site vinculadas a cada card.",
      },
      includeStageHistory: {
        type: "boolean",
        default: false,
        description: "Se true, inclui o histórico resumido de etapas de marketing (padrão false para maior velocidade).",
      },
    },
  },
};

function clampInt(raw: unknown, fallback: number, min: number, max: number): number {
  const num = Number(raw);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(num)));
}

function formatCnpjOrCpf(raw: unknown): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length === 14) {
    return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  }
  if (digits.length === 11) {
    return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  }
  return String(raw);
}

function extractReceitaDetails(addressObj: unknown, fallbackDoc: unknown) {
  const addr =
    addressObj && typeof addressObj === "object" && !Array.isArray(addressObj)
      ? (addressObj as Record<string, any>)
      : {};
  return {
    cnpjFormatted: formatCnpjOrCpf(fallbackDoc || addr.cleanCnpj || addr.cnpjFormatted),
    razaoSocial: addr.razaoSocial || null,
    nomeFantasia: addr.nomeFantasia || null,
    situacaoCadastral: addr.situacaoCadastral || null,
    dataAbertura: addr.dataAbertura || null,
    porte: addr.porte || null,
    capitalSocial: addr.capitalSocial || null,
    naturezaJuridica: addr.naturezaJuridica || null,
    atividadePrincipal: addr.atividadePrincipal || null,
    atividadesSecundarias: addr.atividadesSecundarias || null,
    endereco: {
      logradouro: addr.street || addr.logradouro || null,
      numero: addr.number || addr.numero || null,
      complemento: addr.complement || addr.complemento || null,
      bairro: addr.neighborhood || addr.bairro || null,
      municipio: addr.city || addr.municipio || null,
      uf: addr.state || addr.uf || null,
      cep: addr.zipCode || addr.cep || null,
    },
    qsa: addr.qsa || null,
    consultedAt: addr.consultedAt || null,
  };
}

function groupRowsByDealId<T extends Record<string, any>>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const key = String(row.deal_id || "");
    if (!key) continue;
    const list = map.get(key);
    if (list) list.push(row);
    else map.set(key, [row]);
  }
  return map;
}

export async function executeGetCrmDealsBatch(
  args: Record<string, unknown>,
  tenantId: "tecfag" | "valem",
  sql: any,
) {
  const rawIds = Array.isArray(args.dealIds) ? args.dealIds : [];
  const uniqueIds = Array.from(
    new Set(
      rawIds
        .map((id) => String(id ?? "").trim())
        .filter((id) => id.length > 0),
    ),
  );

  if (uniqueIds.length === 0) {
    throw new Error("Informe 'dealIds' com ao menos 1 ID de negociação.");
  }
  if (uniqueIds.length > GET_CRM_DEALS_BATCH_MAX_IDS) {
    throw new Error(
      `Limite máximo de ${GET_CRM_DEALS_BATCH_MAX_IDS} negociações por chamada em 'get_crm_deals_batch' (recebidos: ${uniqueIds.length}).`,
    );
  }

  const includeContacts = args.includeContacts !== false;
  const includeProducts = args.includeProducts !== false;
  const includeProposals = args.includeProposals !== false;
  const includeActivities = args.includeActivities !== false;
  const activitiesLimit = clampInt(args.activitiesLimit, 10, 1, 30);
  const includeEvents = args.includeEvents === true;
  const eventsLimit = clampInt(args.eventsLimit, 20, 1, 50);
  const includeConversations = args.includeConversations !== false;
  const includeStageHistory = args.includeStageHistory === true;

  const dealRows: Array<Record<string, any>> = await sql`
    SELECT
      d.*,
      p.name AS pipeline_name,
      orig_p.name AS original_pipeline_name,
      st.name AS stage_name,
      st.is_win_stage,
      op.name AS operator_name,
      op.email AS operator_email,
      acc.name AS account_name,
      acc.trade_name AS account_trade_name,
      acc.type AS account_type,
      acc.document AS account_document,
      acc.segment AS account_segment,
      acc.phone AS account_phone,
      acc.email AS account_email,
      acc.website AS account_website,
      acc.address AS account_address,
      acc.notes AS account_notes,
      acc.custom_fields AS account_custom_fields,
      acc.rd_organization_id AS account_rd_organization_id
    FROM crm_deals d
    JOIN crm_pipelines p ON p.id = d.pipeline_id AND p.tenant_id = d.tenant_id
    LEFT JOIN crm_pipelines orig_p ON orig_p.id = d.original_pipeline_id AND orig_p.tenant_id = d.tenant_id
    JOIN crm_stages st ON st.id = d.stage_id AND st.tenant_id = d.tenant_id
    LEFT JOIN operators op ON op.id = d.operator_id AND op.tenant_id = d.tenant_id
    LEFT JOIN crm_accounts acc ON acc.id = d.account_id AND acc.tenant_id = d.tenant_id
    WHERE d.tenant_id = ${tenantId}
      AND d.id = ANY(${uniqueIds}::text[])
  `;

  const dealMap = new Map<string, Record<string, any>>();
  for (const row of dealRows) {
    dealMap.set(String(row.id), row);
  }

  const foundIds = uniqueIds.filter((id) => dealMap.has(id));
  const missingDealIds = uniqueIds.filter((id) => !dealMap.has(id));

  if (foundIds.length === 0) {
    return {
      tenantId,
      requestedCount: uniqueIds.length,
      foundCount: 0,
      missingDealIds,
      deals: [],
    };
  }

  const [
    fieldDefinitions,
    contactRows,
    productRows,
    proposalRows,
    activityRows,
    conversationRows,
    eventRows,
  ] = await Promise.all([
    sql`
      SELECT id, entity_type, name, field_type, options, required, archived_at
      FROM crm_custom_field_definitions
      WHERE tenant_id = ${tenantId} AND entity_type IN ('deal', 'company')
    `,
    includeContacts
      ? sql`
          SELECT
            dc.deal_id,
            dc.role,
            dc.is_primary,
            c.id,
            c.name,
            c.phone,
            c.email,
            c.cpf,
            c.cnpj,
            c.main_channel
          FROM crm_deal_contacts dc
          JOIN contacts c ON c.id = dc.contact_id AND c.tenant_id = dc.tenant_id
          WHERE dc.tenant_id = ${tenantId}
            AND dc.deal_id = ANY(${foundIds}::text[])
          ORDER BY dc.deal_id ASC, dc.is_primary DESC, c.name ASC
        `
      : Promise.resolve([]),
    includeProducts
      ? sql`
          SELECT deal_id, id, product_id, name, quantity, unit_price, discount_percent, total_price, notes
          FROM crm_deal_products
          WHERE tenant_id = ${tenantId}
            AND deal_id = ANY(${foundIds}::text[])
          ORDER BY deal_id ASC, created_at ASC
        `
      : Promise.resolve([]),
    includeProposals
      ? sql`
          SELECT deal_id, id, proposal_number, title, status, subtotal, discount, total, payment_terms, delivery_terms, created_at
          FROM crm_proposals
          WHERE tenant_id = ${tenantId}
            AND deal_id = ANY(${foundIds}::text[])
          ORDER BY deal_id ASC, created_at DESC
        `
      : Promise.resolve([]),
    includeActivities
      ? sql`
          SELECT deal_id, id, type, title, description, completion_note, status, due_date, completed_at, created_at
          FROM (
            SELECT
              deal_id,
              id,
              type,
              title,
              description,
              completion_note,
              status,
              due_date,
              completed_at,
              created_at,
              ROW_NUMBER() OVER (PARTITION BY deal_id ORDER BY created_at DESC) AS rn
            FROM crm_deal_activities
            WHERE tenant_id = ${tenantId}
              AND deal_id = ANY(${foundIds}::text[])
          ) ranked
          WHERE rn <= ${activitiesLimit}
          ORDER BY deal_id ASC, created_at DESC
        `
      : Promise.resolve([]),
    includeConversations
      ? sql`
          SELECT
            cd.deal_id,
            cd.conversation_id,
            cd.origin,
            cd.is_active,
            cd.created_by_operator_id,
            op.name AS created_by_operator_name,
            conv.queue_state,
            conv.last_message_text,
            conv.last_message_time
          FROM crm_conversation_deals cd
          JOIN conversations conv ON conv.id = cd.conversation_id AND conv.tenant_id = cd.tenant_id
          LEFT JOIN operators op ON op.id = cd.created_by_operator_id AND op.tenant_id = cd.tenant_id
          WHERE cd.tenant_id = ${tenantId}
            AND cd.deal_id = ANY(${foundIds}::text[])
          ORDER BY cd.deal_id ASC, cd.created_at DESC
        `
      : Promise.resolve([]),
    includeEvents
      ? sql`
          SELECT deal_id, id, event_type, from_stage_id, to_stage_id, operator_id, operator_name, metadata, created_at
          FROM (
            SELECT
              de.deal_id,
              de.id,
              de.event_type,
              de.from_stage_id,
              de.to_stage_id,
              de.operator_id,
              op.name AS operator_name,
              de.metadata,
              de.created_at,
              ROW_NUMBER() OVER (PARTITION BY de.deal_id ORDER BY de.created_at DESC) AS rn
            FROM crm_deal_events de
            LEFT JOIN operators op ON op.id = de.operator_id AND op.tenant_id = de.tenant_id
            WHERE de.tenant_id = ${tenantId}
              AND de.deal_id = ANY(${foundIds}::text[])
              AND de.event_type != 'conversation_action'
          ) ranked
          WHERE rn <= ${eventsLimit}
          ORDER BY deal_id ASC, created_at DESC
        `
      : Promise.resolve([]),
  ]);

  const stageHistoryByDeal = new Map<string, any[]>();
  if (includeStageHistory) {
    const historyEntries = await Promise.all(
      foundIds.map(async (dealId) => {
        const res = await listMarketingStageHistory(
          tenantId,
          { dealId, includeTests: true, includeLegacy: true, limit: 1 },
          sql,
        );
        return [dealId, res.items] as const;
      }),
    );
    for (const [dealId, items] of historyEntries) {
      stageHistoryByDeal.set(dealId, items);
    }
  }

  const dealFieldDefinitions = fieldDefinitions.filter((f: any) => f.entity_type === "deal");
  const companyFieldDefinitions = fieldDefinitions
    .filter((f: any) => f.entity_type === "company" && !f.archived_at)
    .map(normalizeCustomFieldDefinitionRow);
  const fieldMap = new Map<string, string>(
    dealFieldDefinitions.map((f: any) => [String(f.id), String(f.name)]),
  );

  const contactsByDeal = groupRowsByDealId(contactRows);
  const productsByDeal = groupRowsByDealId(productRows);
  const proposalsByDeal = groupRowsByDealId(proposalRows);
  const activitiesByDeal = groupRowsByDealId(activityRows);
  const conversationsByDeal = groupRowsByDealId(conversationRows);
  const eventsByDeal = groupRowsByDealId(eventRows);

  const deals = foundIds.map((dealId) => {
    const deal = dealMap.get(dealId)!;
    const rawCustom =
      deal.custom_fields && typeof deal.custom_fields === "object" ? deal.custom_fields : {};
    const labeledCustomFields: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rawCustom)) {
      const label = fieldMap.get(k) || k;
      labeledCustomFields[label] = v;
    }

    const accountReceita = deal.account_id
      ? extractReceitaDetails(deal.account_address, deal.account_document)
      : null;
    const accountCustomFormatted = deal.account_id
      ? formatAccountCustomFields(deal.account_custom_fields, companyFieldDefinitions)
      : null;
    const accountFilledSummary =
      deal.account_id && accountReceita && accountCustomFormatted
        ? computeAccountFilledFields(
            {
              name: deal.account_name,
              tradeName: deal.account_trade_name,
              segment: deal.account_segment,
              document: deal.account_document,
              phone: deal.account_phone,
              email: deal.account_email,
              website: deal.account_website,
              notes: deal.account_notes,
              rdOrganizationId: deal.account_rd_organization_id,
            },
            accountReceita,
            accountCustomFormatted.filledCustomFields,
          )
        : null;

    const effectiveWon = isEffectiveCommercialWin({
      status: deal.status,
      stageIsWin: deal.is_win_stage,
      stageName: deal.stage_name,
      sectorCurrent: deal.sector_current,
    });
    const canonicalSource = projectCanonicalDealSourceName(deal);

    const itemContacts = (contactsByDeal.get(dealId) || []).map(({ deal_id: _d, ...rest }) => rest);
    const itemProducts = (productsByDeal.get(dealId) || []).map(({ deal_id: _d, ...p }) => ({
      ...p,
      quantity: Number(p.quantity || 0),
      unit_price: Number(p.unit_price || 0),
      total_price: Number(p.total_price || 0),
    }));
    const itemProposals = (proposalsByDeal.get(dealId) || []).map(({ deal_id: _d, ...rest }) => rest);
    const itemActivities = (activitiesByDeal.get(dealId) || []).map(({ deal_id: _d, ...rest }) => rest);
    const itemConversations = (conversationsByDeal.get(dealId) || []).map(({ deal_id: _d, ...rest }) => rest);
    const itemEvents = (eventsByDeal.get(dealId) || []).map(({ deal_id: _d, ...rest }) => rest);

    return {
      deal: {
        id: deal.id,
        id_rd: deal.rd_deal_id || null,
        rd_deal_url: deal.rd_deal_url || null,
        title: deal.title,
        value: Number(deal.value || 0),
        currency: deal.currency,
        status: deal.status,
        win: effectiveWon,
        isEffectiveWon: effectiveWon,
        winAt: effectiveWon ? deal.won_at || deal.closed_at || deal.updated_at : null,
        lostAt: deal.status === "lost" ? deal.lost_at || deal.closed_at || deal.updated_at : null,
        sectorOrigin: deal.sector_origin || null,
        sectorOriginLabel: formatMarketingSectorLabel(deal.sector_origin),
        sectorCurrent: deal.sector_current || null,
        sectorCurrentLabel: formatMarketingSectorLabel(deal.sector_current),
        originalPipeline: {
          id: deal.original_pipeline_id || deal.pipeline_id,
          name: deal.original_pipeline_name || deal.pipeline_name,
        },
        pipeline: { id: deal.pipeline_id, name: deal.pipeline_name },
        stage: { id: deal.stage_id, name: deal.stage_name },
        operator: deal.operator_id
          ? { id: deal.operator_id, name: deal.operator_name, email: deal.operator_email }
          : null,
        entryChannel: deal.entry_channel || null,
        deal_source_name: canonicalSource,
        source: canonicalSource,
        sourceRaw: deal.source || null,
        campaign_name: deal.campaign || null,
        campaign: deal.campaign || null,
        utmSource: deal.utm_source || null,
        utmMedium: deal.utm_medium || null,
        utmCampaign: deal.utm_campaign || null,
        utmContent: deal.utm_content || null,
        utmTerm: deal.utm_term || null,
        clickId: deal.click_id || null,
        landingPage: deal.landing_page || null,
        lossReason: deal.loss_reason,
        pausedReason: deal.paused_reason,
        isLegacy: Boolean(deal.is_legacy),
        isTest: Boolean(deal.is_test),
        expectedCloseDate: deal.expected_close_date,
        closedAt: deal.closed_at,
        createdAt: deal.created_at,
        updatedAt: deal.updated_at,
        customFields: labeledCustomFields,
      },
      account: deal.account_id
        ? {
            id: deal.account_id,
            type: deal.account_type,
            name: deal.account_name,
            tradeName: deal.account_trade_name,
            document: formatCnpjOrCpf(deal.account_document),
            segment: deal.account_segment,
            phone: deal.account_phone,
            email: deal.account_email,
            website: deal.account_website,
            notes: deal.account_notes || null,
            rdOrganizationId: deal.account_rd_organization_id || null,
            customFields: accountCustomFormatted?.customFields ?? {},
            customFieldsRaw: accountCustomFormatted?.customFieldsRaw ?? {},
            filledCustomFields: accountCustomFormatted?.filledCustomFields ?? [],
            filledFields: accountFilledSummary?.filledFields ?? null,
            receitaFederal: accountReceita,
          }
        : null,
      ...(includeContacts ? { contacts: itemContacts } : {}),
      ...(includeProducts ? { products: itemProducts } : {}),
      ...(includeProposals ? { proposals: itemProposals } : {}),
      ...(includeStageHistory ? { stageHistory: stageHistoryByDeal.get(dealId) || [] } : {}),
      ...(includeActivities ? { recentActivities: itemActivities } : {}),
      ...(includeEvents ? { recentEvents: itemEvents } : {}),
      ...(includeConversations ? { linkedConversations: itemConversations } : {}),
    };
  });

  return {
    tenantId,
    requestedCount: uniqueIds.length,
    foundCount: deals.length,
    missingDealIds,
    deals,
  };
}
