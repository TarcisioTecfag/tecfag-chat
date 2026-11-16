import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import postgres from "postgres";
import {
  computeLockedSectorOrigin,
  extractMetaReferralAttribution,
  extractSiteContextAttribution,
  isEffectiveCommercialWin,
  isTestEntityTitle,
  normalizeRdDealSource,
  resolveDealCurrentSector,
} from "../src/lib/marketing/crm-attribution";
import {
  decodeMarketingCursor,
  encodeMarketingCursor,
  getMarketingAuditBatch,
  listMarketingActivities,
  listMarketingContacts,
  listMarketingConversations,
  listMarketingDeals,
  listMarketingGoals,
  listMarketingMessages,
  listMarketingStageHistory,
  listMarketingTriages,
} from "../src/lib/marketing/crm-reporting-service";
import {
  DEFAULT_MCP_TECFAG_TOKEN,
  DEFAULT_MCP_VALEM_TOKEN,
  executeMcpTool,
} from "../src/lib/mcp/valem-tecfag-mcp-core";
import { Route as IndexRoute } from "../src/routes/api/v1/marketing/index";
import { Route as DealsRoute } from "../src/routes/api/v1/marketing/deals";
import { Route as MessagesRoute } from "../src/routes/api/v1/marketing/messages";

function loadLocalDbUrl(): string | null {
  if (fs.existsSync(".env")) {
    const raw = fs.readFileSync(".env", "utf8");
    const m = raw.match(/^\s*DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m);
    if (m?.[1]) {
      try {
        const u = new URL(m[1]);
        if (u.hostname === "localhost" || u.hostname === "127.0.0.1") {
          return m[1];
        }
      } catch {}
    }
  }
  return null;
}

describe("Marketing × CRM — Taxonomia RD, Setores Imutáveis, Regra Única de Venda e Paridade API + MCP", () => {
  it("normaliza deal_source_name exatamente para os textos oficiais do RD Station CRM", () => {
    expect(
      normalizeRdDealSource({
        utmSource: "google",
        utmMedium: "cpc",
        utmCampaign: "search_envasadoras_nov",
      }),
    ).toBe("Busca Paga | Google");

    expect(
      normalizeRdDealSource({
        utmSource: "facebook",
        utmMedium: "paid_social",
        fbclid: "IwAR12345",
      }),
    ).toBe("Busca Paga | Meta");

    expect(
      normalizeRdDealSource({
        utmSource: "mercadolivre",
        utmMedium: "cpc",
      }),
    ).toBe("Busca Paga | Mercado Livre");

    expect(
      normalizeRdDealSource({
        utmSource: "google",
        utmMedium: "organic",
      }),
    ).toBe("Busca Orgânica | Google");

    // Nunca vaza rótulos operacionais ('manual', 'chat', 'whatsapp', 'WhatsApp SDR (Fagner)') como deal_source_name
    expect(normalizeRdDealSource({ explicitSource: "manual" })).toBeNull();
    expect(normalizeRdDealSource({ explicitSource: "whatsapp" })).toBeNull();
    expect(normalizeRdDealSource({ explicitSource: "WhatsApp SDR (Fagner)" })).toBeNull();

    // Preserva fontes customizadas válidas do RD
    expect(normalizeRdDealSource({ explicitSource: "Feiras e Eventos" })).toBe("Feiras e Eventos");
  });

  it("extrai atribuição de anúncios Click-to-WhatsApp (Meta Cloud API referral) e separa campaign_name de utm_campaign", () => {
    const attr = extractMetaReferralAttribution({
      from: "5516999991111",
      referral: {
        source_type: "ad",
        source_id: "12021099887766",
        ctwa_clid: "ARAkLk998877",
        headline: "Envasadora Pastosa Automática",
        source_url:
          "https://lp.tecfag.com.br/envasadora?utm_source=ig&utm_medium=paid_social&utm_campaign=meta_q4_envasadoras",
      },
    });

    expect(attr).not.toBeNull();
    expect(attr!.entryChannel).toBe("whatsapp");
    expect(attr!.source).toBe("Busca Paga | Meta");
    expect(attr!.campaign).toBe("CTWA | Envasadora Pastosa Automática");
    expect(attr!.utmCampaign).toBe("meta_q4_envasadoras");
    expect(attr!.clickId).toBe("ARAkLk998877");
  });

  it("extrai atribuição do widget do site (VTEX / LiveChat) com gclid e UTMs", () => {
    const attr = extractSiteContextAttribution({
      version: 1,
      capturedAt: "2026-11-16T12:00:00.000Z",
      page: {
        url: "https://www.tecfag.com.br/seladora-continua",
        title: "Seladora Contínua",
        referrer: "",
        utm: {},
      },
      entry: {
        url: "https://www.tecfag.com.br/seladora-continua?utm_source=google&utm_medium=cpc&utm_campaign=pmax_seladoras&gclid=Cj0KCQiA123",
        title: "Seladora Contínua",
        referrer: "https://www.google.com/",
        enteredAt: "2026-11-16T11:59:00.000Z",
        utm: {
          utm_source: "google",
          utm_medium: "cpc",
          utm_campaign: "pmax_seladoras",
        },
      },
      product: null,
    });

    expect(attr).not.toBeNull();
    expect(attr!.entryChannel).toBe("site_chat");
    expect(attr!.source).toBe("Busca Paga | Google");
    expect(attr!.campaign).toBe("Chat Site");
    expect(attr!.utmCampaign).toBe("pmax_seladoras");
    expect(attr!.clickId).toBe("Cj0KCQiA123");
  });

  it("aplica a trava de imutabilidade em sector_origin e resolve FUNIL CWR pela divisão do responsável", () => {
    // Nasce no SDR -> pre_venda
    const sdrSector = resolveDealCurrentSector({
      pipelineName: "FUNIL SDR",
      stageName: "PARA TRIAR",
    });
    expect(sdrSector).toBe("pre_venda");
    let lockedOrigin = computeLockedSectorOrigin(null, sdrSector);
    expect(lockedOrigin).toBe("pre_venda");

    // Ganha pela 1ª vez setor comercial (FUNIL CWR com Beatriz -> divisão maquinas -> semi_industrial)
    const cwrBeatriz = resolveDealCurrentSector({
      pipelineName: "FUNIL CWR",
      stageName: "PROPOSTA ENVIADA",
      operatorDivision: "maquinas",
    });
    expect(cwrBeatriz).toBe("semi_industrial");
    lockedOrigin = computeLockedSectorOrigin(lockedOrigin, cwrBeatriz);
    expect(lockedOrigin).toBe("semi_industrial");

    // Depois muda para Diana (divisão personnalite -> personnalite): sector_current muda, mas sector_origin NÃO muda!
    const cwrDiana = resolveDealCurrentSector({
      pipelineName: "FUNIL CWR",
      stageName: "FECHAMENTO",
      operatorDivision: "personnalite",
    });
    expect(cwrDiana).toBe("personnalite");
    lockedOrigin = computeLockedSectorOrigin(lockedOrigin, cwrDiana);
    expect(lockedOrigin).toBe("semi_industrial");
  });

  it("identifica palavra isolada TESTE sem falsos positivos e aplica regra única de venda (FECHAMENTO / VENDA CONCLUÍDA)", () => {
    expect(isTestEntityTitle("TESTE NÃO APAGAR")).toBe(true);
    expect(isTestEntityTitle("Gabriel (Teste)")).toBe(true);
    expect(isTestEntityTitle("Indústria de Atestados Médicos")).toBe(false);
    expect(isTestEntityTitle("Contestação Fiscal Ltda")).toBe(false);

    expect(
      isEffectiveCommercialWin({
        status: "open",
        stageName: "FECHAMENTO",
        sectorCurrent: "semi_industrial",
      }),
    ).toBe(true);
    expect(
      isEffectiveCommercialWin({
        status: "open",
        stageName: "VENDA CONCLUÍDA",
        sectorCurrent: "pecas",
      }),
    ).toBe(true);
    // Suporte técnico aberto nunca conta como venda comercial
    expect(
      isEffectiveCommercialWin({
        status: "open",
        stageIsWin: true,
        stageName: "FINALIZADOS",
        sectorCurrent: "suporte_tecnico",
      }),
    ).toBe(false);

    const cur = encodeMarketingCursor("2026-11-16T12:00:00.000Z", "deal-123");
    expect(decodeMarketingCursor(cur)).toEqual({
      t: "2026-11-16T12:00:00.000Z",
      id: "deal-123",
    });
  });
});

const localDbUrl = loadLocalDbUrl();

describe.skipIf(!localDbUrl)("Integração PostgreSQL — 9 Endpoints Marketing, Isolamento Multi-Tenant e Paridade API = MCP", () => {
  let sql: ReturnType<typeof postgres>;
  const tenantA = `mkt-iso-a-${randomUUID().slice(0, 8)}`;
  const tenantB = `mkt-iso-b-${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    sql = postgres(localDbUrl!, {
      max: 2,
      prepare: false,
      connection: { TimeZone: "UTC" },
    });

    const now = new Date("2026-11-16T10:00:00.000Z");
    const t1 = new Date("2026-11-16T10:10:00.000Z");
    const t2 = new Date("2026-11-16T10:30:00.000Z");

    await sql`
      INSERT INTO tenants (id, name, slug, connection_type)
      VALUES
        (${tenantA}, 'Tenant Marketing A', ${tenantA}, 'meta'),
        (${tenantB}, 'Tenant Marketing B', ${tenantB}, 'baileys')
    `;

    // Operadores + perfil de consultor (CWR) + meta mensal
    await sql`
      INSERT INTO operators (id, tenant_id, name, email, password_hash, role, status)
      VALUES
        (${`op-a-${tenantA}`}, ${tenantA}, 'Diana Personnalité', ${`diana@${tenantA}.com`}, 'test-hash-only', 'agent', 'online'),
        (${`op-b-${tenantB}`}, ${tenantB}, 'Vendedor B', ${`vend@${tenantB}.com`}, 'test-hash-only', 'agent', 'online')
    `;
    await sql`
      INSERT INTO commercial_consultant_profiles (id, tenant_id, operator_id, division, active_on_tv)
      VALUES (${`ccp-${tenantA}`}, ${tenantA}, ${`op-a-${tenantA}`}, 'personnalite', true)
    `;
    await sql`
      INSERT INTO commercial_goals (id, tenant_id, month, operator_id, target_value, conversion_rate)
      VALUES (${`goal-${tenantA}`}, ${tenantA}, '2026-11', ${`op-a-${tenantA}`}, 450000.00, 12.50)
    `;

    // Funis e etapas (CWR + Funil de Testes)
    await sql`
      INSERT INTO crm_pipelines (id, tenant_id, name, order_index)
      VALUES
        (${`pipe-cwr-${tenantA}`}, ${tenantA}, 'FUNIL CWR', 1),
        (${`pipe-test-${tenantA}`}, ${tenantA}, 'FUNIL DE TESTES', 99),
        (${`pipe-b-${tenantB}`}, ${tenantB}, 'FUNIL MÁQUINAS', 1)
    `;
    await sql`
      INSERT INTO crm_stages (id, tenant_id, pipeline_id, name, order_index, is_win_stage)
      VALUES
        (${`stg-qual-${tenantA}`}, ${tenantA}, ${`pipe-cwr-${tenantA}`}, 'QUALIFICANDO', 0, false),
        (${`stg-fech-${tenantA}`}, ${tenantA}, ${`pipe-cwr-${tenantA}`}, 'FECHAMENTO', 1, false),
        (${`stg-test-${tenantA}`}, ${tenantA}, ${`pipe-test-${tenantA}`}, 'TESTES', 0, false),
        (${`stg-b-${tenantB}`}, ${tenantB}, ${`pipe-b-${tenantB}`}, 'PROPOSTA', 0, false)
    `;

    // Conta, Contato, Telefone extra, Conversa, Mensagens (cliente -> bot -> humano) e Triagem
    await sql`
      INSERT INTO crm_accounts (id, tenant_id, type, name, document)
      VALUES (${`acc-${tenantA}`}, ${tenantA}, 'company', 'Envasadora Brasil LTDA', '12345678000199')
    `;
    await sql`
      INSERT INTO contacts (
        id, tenant_id, account_id, name, email, phone, cnpj, main_channel,
        first_source, first_campaign, utm_source, utm_medium, utm_campaign, sector_origin, is_test, created_at, updated_at
      )
      VALUES (
        ${`cnt-${tenantA}`}, ${tenantA}, ${`acc-${tenantA}`}, 'Carlos Comprador', 'carlos@envasadorabrasil.com.br',
        '5516991234567', '12345678000199', 'whatsapp',
        'Busca Paga | Google', 'CRM | Form Google - Rotuladora', 'google', 'cpc', 'search_rotuladoras_nov',
        'semi_industrial', false, ${now}, ${t2}
      )
    `;
    await sql`
      INSERT INTO contact_phones (id, tenant_id, contact_id, phone, phone_identity, is_primary)
      VALUES (${`cp-${tenantA}`}, ${tenantA}, ${`cnt-${tenantA}`}, '5516988887777', '5516988887777', false)
    `;
    await sql`
      INSERT INTO conversations (id, tenant_id, contact_id, operator_id, queue_state, created_at, updated_at)
      VALUES (${`conv-${tenantA}`}, ${tenantA}, ${`cnt-${tenantA}`}, ${`op-a-${tenantA}`}, 'meus', ${now}, ${t2})
    `;
    await sql`
      INSERT INTO messages (id, tenant_id, conversation_id, sender_type, sender_name, content, is_internal_note, sent_at, updated_at)
      VALUES
        (${`m1-${tenantA}`}, ${tenantA}, ${`conv-${tenantA}`}, 'client', 'Carlos', 'Olá, quero cotação de rotuladora', false, ${now}, ${now}),
        (${`m2-${tenantA}`}, ${tenantA}, ${`conv-${tenantA}`}, 'bot', 'Fagner IA', 'Olá Carlos! Qual a produção por hora?', false, ${new Date(now.getTime() + 15_000)}, ${new Date(now.getTime() + 15_000)}),
        (${`m3-${tenantA}`}, ${tenantA}, ${`conv-${tenantA}`}, 'operator', 'Diana Personnalité', 'Oi Carlos, vou assumir seu atendimento!', false, ${new Date(now.getTime() + 120_000)}, ${new Date(now.getTime() + 120_000)})
    `;
    await sql`
      INSERT INTO agent_flow_states (id, tenant_id, conversation_id, agent_type, current_step, collected_data, started_at, last_interaction_at, completed_at, outcome)
      VALUES (
        ${`afs-${tenantA}`}, ${tenantA}, ${`conv-${tenantA}`}, 'sdr', 'completed',
        '{"targetFunnel":"FUNIL PERSONNALITÉ","equipment":"Rotuladora Automática"}'::jsonb,
        ${now}, ${t1}, ${t1}, 'transferred'
      )
    `;

    // Negociação real em FECHAMENTO com status='open' (deve retornar win=true e win_at preenchido!) + Negociação de Teste + Negociação de outro tenant
    await sql`
      INSERT INTO crm_deals (
        id, tenant_id, rd_deal_id, title, account_id, pipeline_id, original_pipeline_id, stage_id,
        status, value, operator_id, entry_channel, source, campaign,
        utm_source, utm_medium, utm_campaign, sector_origin, sector_current,
        won_at, is_legacy, is_test, created_at, updated_at
      )
      VALUES
        (
          ${`deal-real-${tenantA}`}, ${tenantA}, '68abc123rd', 'Rotuladora Industrial R$ 150k',
          ${`acc-${tenantA}`}, ${`pipe-cwr-${tenantA}`}, ${`pipe-cwr-${tenantA}`}, ${`stg-fech-${tenantA}`},
          'open', 150000.00, ${`op-a-${tenantA}`}, 'whatsapp_sdr', 'Busca Paga | Google', 'CRM | Form Google - Rotuladora',
          'google', 'cpc', 'search_rotuladoras_nov', 'semi_industrial', 'personnalite',
          ${t2}, false, false, ${now}, ${t2}
        ),
        (
          ${`deal-test-${tenantA}`}, ${tenantA}, null, 'Card TESTE Interno',
          null, ${`pipe-test-${tenantA}`}, ${`pipe-test-${tenantA}`}, ${`stg-test-${tenantA}`},
          'open', 9999999.00, ${`op-a-${tenantA}`}, 'manual', null, null,
          null, null, null, 'teste', 'teste',
          null, false, true, ${now}, ${t1}
        ),
        (
          ${`deal-other-${tenantB}`}, ${tenantB}, null, 'Deal Isolado Tenant B',
          null, ${`pipe-b-${tenantB}`}, ${`pipe-b-${tenantB}`}, ${`stg-b-${tenantB}`},
          'open', 50000.00, ${`op-b-${tenantB}`}, 'manual', 'Busca Paga | Meta', 'Form B',
          'meta', 'cpc', 'camp_b', 'semi_industrial', 'semi_industrial',
          null, false, false, ${now}, ${t1}
        )
    `;

    await sql`
      INSERT INTO crm_deal_contacts (id, tenant_id, deal_id, contact_id, role, is_primary)
      VALUES (${`dc-${tenantA}`}, ${tenantA}, ${`deal-real-${tenantA}`}, ${`cnt-${tenantA}`}, 'buyer', true)
    `;
    await sql`
      INSERT INTO crm_conversation_deals (id, tenant_id, conversation_id, deal_id, origin, is_active)
      VALUES (${`cd-${tenantA}`}, ${tenantA}, ${`conv-${tenantA}`}, ${`deal-real-${tenantA}`}, 'chat', true)
    `;
    await sql`
      INSERT INTO crm_deal_activities (id, tenant_id, deal_id, conversation_id, type, title, status, due_date, operator_id, assigned_to_operator_id, created_at, updated_at)
      VALUES (
        ${`act-${tenantA}`}, ${tenantA}, ${`deal-real-${tenantA}`}, ${`conv-${tenantA}`},
        'task', 'Confirmar CNPJ para emissão da NF', 'pending', ${new Date("2026-11-10T12:00:00.000Z")},
        ${`op-a-${tenantA}`}, ${`op-a-${tenantA}`}, ${now}, ${t1}
      )
    `;

    // Insere 1 transição real de etapa + 35 eventos conversation_action de ruído para provar imunidade de stageHistory!
    await sql`
      INSERT INTO crm_deal_events (id, tenant_id, deal_id, event_type, from_stage_id, to_stage_id, metadata, operator_id, created_at)
      VALUES (
        ${`ev-stg-${tenantA}`}, ${tenantA}, ${`deal-real-${tenantA}`}, 'stage_changed',
        ${`stg-qual-${tenantA}`}, ${`stg-fech-${tenantA}`},
        ${sql.json({ fromStageId: `stg-qual-${tenantA}`, fromStageName: "QUALIFICANDO", toStageId: `stg-fech-${tenantA}`, toStageName: "FECHAMENTO" })},
        ${`op-a-${tenantA}`}, ${t1}
      )
    `;
    for (let i = 0; i < 35; i++) {
      await sql`
        INSERT INTO crm_deal_events (id, tenant_id, deal_id, event_type, metadata, created_at)
        VALUES (
          ${`ev-noise-${i}-${tenantA}`}, ${tenantA}, ${`deal-real-${tenantA}`}, 'conversation_action',
          '{"action":"view"}'::jsonb, ${new Date(t1.getTime() + (i + 1) * 1000)}
        )
      `;
    }
  });

  afterAll(async () => {
    if (sql) {
      await sql`DELETE FROM agent_flow_states WHERE tenant_id IN (${tenantA}, ${tenantB})`;
      await sql`DELETE FROM tenants WHERE id IN (${tenantA}, ${tenantB})`;
      await sql.end();
    }
  });

  it("isola estritamente por tenant, oculta is_test=true por padrão e entrega 100% de paridade entre API e MCP", async () => {
    const apiDeals = await listMarketingDeals(tenantA, {}, sql);
    expect(apiDeals.items).toHaveLength(1); // Excluiu deal-test e deal-other-tenantB!

    const deal = apiDeals.items[0];
    expect(deal.id).toBe(`deal-real-${tenantA}`);
    expect(deal.id_rd).toBe("68abc123rd");
    expect(deal.win).toBe(true); // FECHAMENTO com status='open' conta como venda!
    expect(deal.win_at).toBe("2026-11-16T10:30:00.000Z");
    expect(deal.deal_source_name).toBe("Busca Paga | Google");
    expect(deal.campaign_name).toBe("CRM | Form Google - Rotuladora");
    expect(deal.utm_campaign).toBe("search_rotuladoras_nov");
    expect(deal.sector_origin).toBe("semi_industrial");
    expect(deal.sector_current).toBe("personnalite");
    expect(deal.organization_cnpj).toBe("12345678000199");
    expect(deal.contacts_emails).toContain("carlos@envasadorabrasil.com.br");
    expect(deal.contacts_phones_last9).toContain("991234567");
    expect(deal.contacts_phones_last9).toContain("988887777");

    // Paridade exata com MCP search_crm_deals e get_crm_deal_details
    const mcpSearch: any = await executeMcpTool(
      "search_crm_deals",
      { status: "closed_won_effective" },
      {
        authorized: true,
        lockedTenantId: tenantA as any,
        defaultTenantId: tenantA as any,
        authMode: "token_tecfag",
        skipAuditLog: true,
      },
      sql,
    );
    expect(mcpSearch.returnedCount).toBe(1);
    expect(mcpSearch.deals[0].id).toBe(deal.id);
    expect(mcpSearch.deals[0].id_rd).toBe(deal.id_rd);
    expect(mcpSearch.deals[0].win).toBe(deal.win);
    expect(mcpSearch.deals[0].deal_source_name).toBe(deal.deal_source_name);
    expect(mcpSearch.deals[0].sectorOrigin).toBe(deal.sector_origin);
    expect(mcpSearch.deals[0].sectorCurrent).toBe(deal.sector_current);

    const mcpDetails: any = await executeMcpTool(
      "get_crm_deal_details",
      { dealId: deal.id },
      {
        authorized: true,
        lockedTenantId: tenantA as any,
        defaultTenantId: tenantA as any,
        authMode: "token_tecfag",
        skipAuditLog: true,
      },
      sql,
    );
    // Mesmo com 35 eventos conversation_action, stageHistory preserva os 2 intervalos exatos!
    expect(mcpDetails.stageHistory).toHaveLength(2);
    expect(mcpDetails.stageHistory[0].stage_name).toBe("QUALIFICANDO");
    expect(mcpDetails.stageHistory[0].duration_seconds).toBe(600);
    expect(mcpDetails.stageHistory[1].stage_name).toBe("FECHAMENTO");
    expect(mcpDetails.stageHistory[1].duration_seconds).toBe(1200);
  });

  it("entrega métricas completas nos endpoints contacts, conversations, messages (metadata-only), activities, triages, goals e audit-batch", async () => {
    const contactsRes = await listMarketingContacts(tenantA, { phone: "988887777" }, sql);
    expect(contactsRes.items).toHaveLength(1);
    expect(contactsRes.items[0].cnpj_cpf).toBe("12345678000199");

    const convsRes = await listMarketingConversations(tenantA, {}, sql);
    expect(convsRes.items).toHaveLength(1);
    expect(convsRes.items[0].first_bot_response_seconds).toBe(15);
    expect(convsRes.items[0].first_human_response_seconds).toBe(120);
    expect(convsRes.items[0].only_bot).toBe(false);
    expect(convsRes.items[0].is_unanswered).toBe(false);

    // Messages: metadados por padrão (sem content!), e com content quando includeContent=true
    const msgsMeta = await listMarketingMessages(tenantA, {}, sql);
    expect(msgsMeta.metadata_only).toBe(true);
    expect(msgsMeta.items).toHaveLength(3);
    expect("content" in msgsMeta.items[0]).toBe(false);
    expect(msgsMeta.items[0].char_length).toBeGreaterThan(10);

    const msgsFull = await listMarketingMessages(tenantA, { includeContent: true }, sql);
    expect(msgsFull.metadata_only).toBe(false);
    expect(msgsFull.items[0].content).toContain("cotação de rotuladora");

    const actsRes = await listMarketingActivities(tenantA, {}, sql);
    expect(actsRes.items).toHaveLength(1);
    expect(actsRes.items[0].is_overdue).toBe(true);

    const triagesRes = await listMarketingTriages(tenantA, {}, sql);
    expect(triagesRes.items).toHaveLength(1);
    expect(triagesRes.items[0].target_funnel).toBe("FUNIL PERSONNALITÉ");

    const goalsRes = await listMarketingGoals(tenantA, { month: "2026-11" }, sql);
    expect(goalsRes.total_target_value).toBe(450000);
    expect(goalsRes.totals_by_sector.personnalite).toBe(450000);

    const batchRes = await getMarketingAuditBatch(tenantA, { source: "Google" }, sql);
    expect(batchRes.batch_size).toBe(1);
    expect(batchRes.items[0].conversations[0].messages).toHaveLength(3);
  });

  it("valida segurança HTTP nas rotas REST (/api/v1/marketing/*): 401 sem token, 403 em tentativa cross-tenant e 200 com Bearer token", async () => {
    const indexGet = (IndexRoute.options.server as any).handlers.GET;
    const dealsGet = (DealsRoute.options.server as any).handlers.GET;
    const msgsGet = (MessagesRoute.options.server as any).handlers.GET;

    // 1. Sem token -> 401
    const unauthRes = await indexGet({
      request: new Request("http://localhost/api/v1/marketing/"),
    });
    expect(unauthRes.status).toBe(401);

    // 2. Token da Valem tentando ler ?tenant_id=tecfag -> 403 FORBIDDEN
    const crossTenantRes = await dealsGet({
      request: new Request("http://localhost/api/v1/marketing/deals?tenant_id=tecfag&limit=5", {
        headers: { Authorization: `Bearer ${DEFAULT_MCP_VALEM_TOKEN}` },
      }),
    });
    expect(crossTenantRes.status).toBe(403);

    // 3. Token da Tecfag lendo /api/v1/marketing/deals -> 200 OK com id_rd e setores preenchidos
    const okDealsRes = await dealsGet({
      request: new Request("http://localhost/api/v1/marketing/deals?limit=5&order=desc", {
        headers: { Authorization: `Bearer ${DEFAULT_MCP_TECFAG_TOKEN}` },
      }),
    });
    expect(okDealsRes.status).toBe(200);
    const okDealsJson = await okDealsRes.json();
    expect(okDealsJson.tenant_id).toBe("tecfag");
    expect(okDealsJson.items.length).toBeGreaterThan(0);
    expect(okDealsJson.items.every((d: any) => d.is_test === false)).toBe(true);
    expect(okDealsJson.items.every((d: any) => Boolean(d.sector_current))).toBe(true);

    // 4. Token da Tecfag lendo /api/v1/marketing/messages -> 200 OK metadata_only=true
    const okMsgsRes = await msgsGet({
      request: new Request("http://localhost/api/v1/marketing/messages?limit=3", {
        headers: { Authorization: `Bearer ${DEFAULT_MCP_TECFAG_TOKEN}` },
      }),
    });
    expect(okMsgsRes.status).toBe(200);
    const okMsgsJson = await okMsgsRes.json();
    expect(okMsgsJson.metadata_only).toBe(true);

    // 5. Paginação determinística por cursor (sem sobreposição entre página 1 e página 2)
    const page1Res = await dealsGet({
      request: new Request("http://localhost/api/v1/marketing/deals?limit=3", {
        headers: { Authorization: `Bearer ${DEFAULT_MCP_TECFAG_TOKEN}` },
      }),
    });
    const page1 = await page1Res.json();
    expect(page1.items).toHaveLength(3);
    expect(page1.pagination.has_more).toBe(true);
    expect(typeof page1.pagination.next_cursor).toBe("string");

    const page2Res = await dealsGet({
      request: new Request(
        `http://localhost/api/v1/marketing/deals?limit=3&cursor=${encodeURIComponent(page1.pagination.next_cursor)}`,
        {
          headers: { Authorization: `Bearer ${DEFAULT_MCP_TECFAG_TOKEN}` },
        },
      ),
    });
    const page2 = await page2Res.json();
    if (!page2.items) throw new Error(`page2 error: ${JSON.stringify(page2)}`);
    expect(page2.items).toHaveLength(3);
    const page1Ids = new Set(page1.items.map((d: any) => d.id));
    for (const d of page2.items) {
      expect(page1Ids.has(d.id)).toBe(false);
    }
  });
});
