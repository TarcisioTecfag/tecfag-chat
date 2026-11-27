import { describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../src/db/schema";
import {
  extractSiteContextAttribution,
  extractTrackingParamsFromUrls,
  getDefaultSiteCampaignLabel,
  isOperationalChannelLabel,
  normalizeRdDealSource,
  resolveInheritedMarketingAttribution,
  resolveVisitorJourneyAttributionInTx,
} from "../src/lib/marketing/crm-attribution";
import {
  captureSiteContext,
  isExternalSiteReferrer,
  mergeSiteContexts,
} from "../src/lib/livechat/site-context";
import { ensureSiteDealOnWhatsappHandoff } from "../src/lib/triage/industrial-cwr-crm";
import {
  resolveAndPersistSiteEntry,
  type StorageLike,
} from "../tecfag-widget/src/lib/site-entry";
import { runSiteDealAttributionBackfill } from "../scripts/backfill-site-deal-attribution.mjs";

function makeMemoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (key) => (map.has(key) ? map.get(key)! : null),
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

/** Adaptador tagged-template compatível com `postgres.js` sobre PGlite para testar o backfill real em SQL. */
function makePgliteSqlTag(pg: PGlite) {
  return async (strings: TemplateStringsArray, ...values: any[]) => {
    let text = "";
    for (let i = 0; i < strings.length; i++) {
      text += strings[i];
      if (i < values.length) text += `$${i + 1}`;
    }
    const res = await pg.query(text, values);
    return res.rows as any[];
  };
}

async function createAttributionTestDb() {
  const pg = new PGlite();
  await pg.exec(`
    CREATE TABLE tenants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );
    CREATE TABLE contacts (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      account_id TEXT,
      name TEXT NOT NULL DEFAULT 'Contato',
      phone TEXT,
      whatsapp_jid TEXT,
      whatsapp_user_id TEXT,
      whatsapp_username TEXT,
      email TEXT,
      cnpj TEXT,
      cpf TEXT,
      avatar TEXT,
      tags JSONB DEFAULT '[]'::jsonb NOT NULL,
      main_channel TEXT DEFAULT 'whatsapp' NOT NULL,
      wallet_operator_id TEXT,
      responsible_name TEXT DEFAULT 'Na Fila' NOT NULL,
      rd_crm_deal_id TEXT,
      rd_crm_deal_link TEXT,
      cnpj_details JSONB DEFAULT '{}'::jsonb NOT NULL,
      custom_fields JSONB DEFAULT '{}'::jsonb NOT NULL,
      entry_channel TEXT,
      first_source TEXT,
      first_campaign TEXT,
      utm_source TEXT,
      utm_medium TEXT,
      utm_campaign TEXT,
      utm_content TEXT,
      utm_term TEXT,
      click_id TEXT,
      landing_page TEXT,
      sector_origin TEXT,
      is_legacy BOOLEAN DEFAULT FALSE NOT NULL,
      is_test BOOLEAN DEFAULT FALSE NOT NULL,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
    CREATE TABLE conversations (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      contact_id TEXT NOT NULL,
      queue_state TEXT DEFAULT 'automacao' NOT NULL,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      sender_type TEXT NOT NULL,
      sender_name TEXT,
      content TEXT NOT NULL DEFAULT '',
      is_internal_note BOOLEAN DEFAULT FALSE NOT NULL,
      meta_details JSONB,
      sent_at TIMESTAMP DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
    CREATE TABLE lc_visitors (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      cookie_id TEXT NOT NULL,
      session_start TIMESTAMP DEFAULT NOW() NOT NULL,
      last_seen_at TIMESTAMP DEFAULT NOW() NOT NULL,
      current_url TEXT,
      current_title TEXT,
      referrer TEXT
    );
    CREATE TABLE lc_chats (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      visitor_id TEXT NOT NULL,
      channel TEXT DEFAULT 'livechat' NOT NULL,
      status TEXT DEFAULT 'active' NOT NULL,
      wa_conversation_id TEXT,
      started_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
    CREATE TABLE lc_pageviews (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      visitor_id TEXT NOT NULL,
      url TEXT NOT NULL,
      title TEXT,
      visited_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
    CREATE TABLE crm_pipelines (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      order_index INTEGER DEFAULT 0 NOT NULL
    );
    CREATE TABLE crm_stages (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      pipeline_id TEXT NOT NULL,
      name TEXT NOT NULL,
      order_index INTEGER DEFAULT 0 NOT NULL,
      is_win_stage BOOLEAN DEFAULT FALSE NOT NULL,
      is_loss_stage BOOLEAN DEFAULT FALSE NOT NULL
    );
    CREATE TABLE commercial_consultant_profiles (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      operator_id TEXT NOT NULL,
      division TEXT NOT NULL
    );
    CREATE TABLE sectors (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      operator_ids JSONB DEFAULT '[]'::jsonb NOT NULL
    );
    CREATE TABLE crm_deals (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      title TEXT NOT NULL,
      account_id TEXT,
      pipeline_id TEXT NOT NULL,
      stage_id TEXT NOT NULL,
      status TEXT DEFAULT 'open' NOT NULL,
      value NUMERIC,
      currency TEXT DEFAULT 'BRL' NOT NULL,
      expected_close_date TIMESTAMP,
      operator_id TEXT,
      entry_channel TEXT,
      source TEXT,
      campaign TEXT,
      utm_source TEXT,
      utm_medium TEXT,
      utm_campaign TEXT,
      utm_content TEXT,
      utm_term TEXT,
      click_id TEXT,
      landing_page TEXT,
      original_pipeline_id TEXT,
      sector_origin TEXT,
      sector_current TEXT,
      rating INTEGER DEFAULT 0 NOT NULL,
      loss_reason TEXT,
      paused_reason TEXT,
      rd_deal_id TEXT,
      rd_deal_url TEXT,
      custom_fields JSONB DEFAULT '{}'::jsonb NOT NULL,
      version INTEGER DEFAULT 1 NOT NULL,
      ai_priority_score INTEGER,
      ai_priority_level TEXT,
      ai_priority_reason TEXT,
      ai_priority_updated_at TIMESTAMP,
      last_activity_at TIMESTAMP DEFAULT NOW() NOT NULL,
      won_at TIMESTAMP,
      lost_at TIMESTAMP,
      closed_at TIMESTAMP,
      closed_by_operator_id TEXT,
      is_legacy BOOLEAN DEFAULT FALSE NOT NULL,
      is_test BOOLEAN DEFAULT FALSE NOT NULL,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
    CREATE TABLE crm_deal_contacts (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      deal_id TEXT NOT NULL,
      contact_id TEXT NOT NULL,
      role TEXT DEFAULT 'buyer' NOT NULL,
      is_primary BOOLEAN DEFAULT FALSE NOT NULL,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
    CREATE TABLE crm_conversation_deals (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      deal_id TEXT NOT NULL,
      origin TEXT DEFAULT 'chat' NOT NULL,
      created_by_operator_id TEXT,
      is_active BOOLEAN DEFAULT TRUE NOT NULL,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL,
      unlinked_at TIMESTAMP,
      unlinked_by_operator_id TEXT
    );
    CREATE TABLE crm_deal_events (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      deal_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      from_stage_id TEXT,
      to_stage_id TEXT,
      from_status TEXT,
      to_status TEXT,
      metadata JSONB DEFAULT '{}'::jsonb NOT NULL,
      operator_id TEXT,
      actor_type TEXT,
      source_channel TEXT,
      actor_name TEXT,
      client_ip TEXT,
      mcp_key_id TEXT,
      mcp_key_label TEXT,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
    CREATE TABLE crm_catalog_items (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      all_pipelines BOOLEAN DEFAULT TRUE NOT NULL,
      pipeline_ids JSONB DEFAULT '[]'::jsonb NOT NULL,
      stage_ids JSONB DEFAULT '[]'::jsonb NOT NULL,
      archived_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
  `);
  const db = drizzle(pg, { schema });
  return { pg, db, sqlTag: makePgliteSqlTag(pg) };
}

describe("Tecfag widget session entry persistence (VTEX multi-page)", () => {
  test("preserves Linktree landing UTM across full page navigations (/ -> /230 -> /produto)", () => {
    const session = makeMemoryStorage();
    const local = makeMemoryStorage();
    const t0 = 1_700_000_000_000;

    const first = resolveAndPersistSiteEntry({
      currentUrl: "https://www.tecfag.com.br/?utm_source=linktree",
      currentTitle: "Tecfag",
      referrer: "https://linktr.ee/tecfag",
      sessionStorage: session,
      localStorage: local,
      nowMs: t0,
    });
    expect(first.url).toBe("https://www.tecfag.com.br/?utm_source=linktree");
    expect(first.referrer).toBe("https://linktr.ee/tecfag");

    // Full-page reload na VTEX navegando para /230 com referrer interno
    const second = resolveAndPersistSiteEntry({
      currentUrl: "https://www.tecfag.com.br/230?map=productClusterIds",
      currentTitle: "Linha Semi Industrial",
      referrer: "https://www.tecfag.com.br/?utm_source=linktree",
      sessionStorage: session,
      localStorage: local,
      nowMs: t0 + 15_000,
    });
    expect(second.url).toBe("https://www.tecfag.com.br/?utm_source=linktree");
    expect(second.referrer).toBe("https://linktr.ee/tecfag");

    // Nova aba no mesmo browser dentro de 30 minutos (sessionStorage vazio, localStorage preenchido)
    const freshTabSession = makeMemoryStorage();
    const third = resolveAndPersistSiteEntry({
      currentUrl: "https://www.tecfag.com.br/envasadora/p",
      currentTitle: "Envasadora",
      referrer: "https://www.tecfag.com.br/230",
      sessionStorage: freshTabSession,
      localStorage: local,
      nowMs: t0 + 60_000,
    });
    expect(third.url).toBe("https://www.tecfag.com.br/?utm_source=linktree");
    expect(third.referrer).toBe("https://linktr.ee/tecfag");

    // Nova campanha explícita atualiza a entrada
    const fourth = resolveAndPersistSiteEntry({
      currentUrl: "https://www.tecfag.com.br/seladora/p?utm_source=google-shopping&utm_medium=cpc",
      currentTitle: "Seladora",
      referrer: "https://www.google.com/",
      sessionStorage: session,
      localStorage: local,
      nowMs: t0 + 120_000,
    });
    expect(fourth.url).toBe(
      "https://www.tecfag.com.br/seladora/p?utm_source=google-shopping&utm_medium=cpc",
    );
    expect(fourth.referrer).toBe("https://www.google.com/");
  });

  test("ignores internal referrer when landing directly without UTMs", () => {
    const session = makeMemoryStorage();
    const local = makeMemoryStorage();
    const entry = resolveAndPersistSiteEntry({
      currentUrl: "https://www.tecfag.com.br/230",
      currentTitle: "Tecfag",
      referrer: "https://www.tecfag.com.br/",
      sessionStorage: session,
      localStorage: local,
    });
    expect(entry.url).toBe("https://www.tecfag.com.br/230");
    expect(entry.referrer).toBe("");
  });
});

describe("site-context click ID preservation and referrer rules", () => {
  test("preserves gclid, fbclid, gbraid, wbraid, msclkid, ttclid while stripping private params", () => {
    const ctx = captureSiteContext(
      {
        entry: {
          url: "https://www.tecfag.com.br/?utm_source=google&utm_medium=cpc&gclid=Cj0KCQiA123&token=secret&cpf=12345678900",
          referrer: "https://www.google.com/",
        },
        page: {
          url: "https://www.tecfag.com.br/envasadora/p?fbclid=IwAR987&sessionId=xyz",
          referrer: "https://www.tecfag.com.br/",
        },
      },
      "https://www.tecfag.com.br",
      new Date("2026-11-27T15:00:00Z"),
    );

    expect(ctx).not.toBeNull();
    expect(ctx!.entry.url).toContain("utm_source=google");
    expect(ctx!.entry.url).toContain("gclid=Cj0KCQiA123");
    expect(ctx!.entry.url).not.toContain("token=secret");
    expect(ctx!.entry.url).not.toContain("cpf=12345678900");
    expect(ctx!.page.url).toContain("fbclid=IwAR987");
    expect(ctx!.page.url).not.toContain("sessionId=xyz");
    expect(isExternalSiteReferrer("https://linktr.ee/tecfag", ctx!.page.url)).toBe(true);
    expect(isExternalSiteReferrer("https://www.tecfag.com.br/", ctx!.page.url)).toBe(false);
  });

  test("mergeSiteContexts preserves prior tracked entry over internal navigation", () => {
    const t0 = new Date("2026-11-27T15:00:00Z");
    const first = captureSiteContext(
      { page: { url: "https://www.tecfag.com.br/?utm_source=linktree", referrer: "https://linktr.ee/tecfag" } },
      "https://www.tecfag.com.br",
      t0,
    );
    const second = captureSiteContext(
      { page: { url: "https://www.tecfag.com.br/230", referrer: "https://www.tecfag.com.br/" } },
      "https://www.tecfag.com.br",
      new Date(t0.getTime() + 10_000),
    );
    const merged = mergeSiteContexts(first, second);
    expect(merged?.entry.url).toBe("https://www.tecfag.com.br/?utm_source=linktree");
    expect(merged?.entry.referrer).toBe("https://linktr.ee/tecfag");
    expect(merged?.page.url).toBe("https://www.tecfag.com.br/230");
  });
});

describe("Canonical CRM marketing attribution rules", () => {
  test("maps tenant default site campaign without breaking non-industrial tenants", () => {
    expect(getDefaultSiteCampaignLabel("tecfag")).toBe("Fagner | Vtex");
    expect(getDefaultSiteCampaignLabel("valem")).toBe("Chat Site");
    expect(isOperationalChannelLabel("Chat Site")).toBe(true);
    expect(isOperationalChannelLabel("livechat")).toBe(true);
  });

  test("normalizes Linktree, Google/Meta paid, organic, external referrer and direct site fallback", () => {
    expect(normalizeRdDealSource({ utmSource: "linktree", entryChannel: "livechat" })).toBe(
      "Social | linktree",
    );
    expect(normalizeRdDealSource({ utmSource: "linktree_bio", entryChannel: "livechat" })).toBe(
      "Social | linktree",
    );
    expect(
      normalizeRdDealSource({ referrer: "https://linktr.ee/tecfag", entryChannel: "livechat" }),
    ).toBe("Social | linktree");
    expect(
      normalizeRdDealSource({
        utmSource: "google-shopping",
        utmMedium: "cpc",
        entryChannel: "livechat",
      }),
    ).toBe("Busca Paga | google-shopping");
    expect(
      normalizeRdDealSource({
        utmSource: "google-rede-pesquisa",
        utmMedium: "cpc",
        entryChannel: "livechat",
      }),
    ).toBe("Busca Paga | google-rede-pesquisa");
    expect(
      normalizeRdDealSource({ gclid: "Cj0KCQiA12345", entryChannel: "site_chat" }),
    ).toBe("Busca Paga | Google");
    expect(
      normalizeRdDealSource({ clickId: "Cj0KCQiA12345", entryChannel: "site_chat" }),
    ).toBe("Busca Paga | Google");
    expect(
      normalizeRdDealSource({ fbclid: "IwAR12345", entryChannel: "site_chat" }),
    ).toBe("Busca Paga | Meta");
    expect(
      normalizeRdDealSource({ referrer: "https://www.google.com/", entryChannel: "site_chat" }),
    ).toBe("Busca Orgânica | Google");
    expect(
      normalizeRdDealSource({
        referrer: "https://revistaembalagem.com.br/materia",
        landingPage: "https://www.tecfag.com.br/",
        entryChannel: "site_chat",
      }),
    ).toBe("Referência | revistaembalagem.com.br");
    expect(
      normalizeRdDealSource({ explicitSource: "Chat Site", entryChannel: "livechat" }),
    ).toBe("Tráfego Direto");
    expect(normalizeRdDealSource({ entryChannel: "site_chat" })).toBe("Tráfego Direto");
  });

  test("extractTrackingParamsFromUrls prefers first tracked URL across chronological pageviews", () => {
    const tracked = extractTrackingParamsFromUrls(
      "https://www.tecfag.com.br/?utm_source=linktree",
      "https://www.tecfag.com.br/230",
    );
    expect(tracked.utmSource).toBe("linktree");
    expect(tracked.landingPage).toBe("https://www.tecfag.com.br/?utm_source=linktree");
  });

  test("extractSiteContextAttribution keeps default campaign and falls back direct to Tráfego Direto", () => {
    const ctx = captureSiteContext(
      { page: { url: "https://www.tecfag.com.br/230" } },
      "https://www.tecfag.com.br",
      new Date("2026-11-27T15:00:00Z"),
    );
    const attr = extractSiteContextAttribution(ctx, "Fagner | Vtex");
    expect(attr?.source).toBe("Tráfego Direto");
    expect(attr?.campaign).toBe("Fagner | Vtex");
  });
});

describe("Database integration: journey resolution, site->WA handoff & idempotent backfill", () => {
  test("recovers Jackson Linktree UTM from lc_pageviews even when siteContext only has /230", async () => {
    const { pg, db } = await createAttributionTestDb();
    try {
      const tenantId = "tecfag";
      const visitorId = "44607160-e659-470b-91a2-0176ea826a2c";
      const siteConvId = `conv-lc-${visitorId}`;
      const waConvId = "conv-wa-jackson";
      const contactId = `cont-lc-${visitorId}`;

      await pg.exec(`
        INSERT INTO tenants (id, name) VALUES ('tecfag', 'Tecfag');
        INSERT INTO contacts (id, tenant_id, name, phone, main_channel)
          VALUES ('${contactId}', '${tenantId}', 'Jackson', '5541999990001', 'livechat');
        INSERT INTO conversations (id, tenant_id, contact_id) VALUES
          ('${siteConvId}', '${tenantId}', '${contactId}'),
          ('${waConvId}', '${tenantId}', '${contactId}');
        INSERT INTO lc_visitors (id, tenant_id, cookie_id, current_url, referrer)
          VALUES ('${visitorId}', '${tenantId}', 'ck-jackson', 'https://www.tecfag.com.br/230', 'https://www.tecfag.com.br/');
        INSERT INTO lc_pageviews (id, tenant_id, visitor_id, url, title, visited_at) VALUES
          ('pv-1', '${tenantId}', '${visitorId}', 'https://www.tecfag.com.br/?utm_source=linktree', 'Tecfag', NOW() - INTERVAL '3 minutes'),
          ('pv-2', '${tenantId}', '${visitorId}', 'https://www.tecfag.com.br/230', 'Categoria 230', NOW() - INTERVAL '2 minutes');
        INSERT INTO crm_pipelines (id, tenant_id, name, order_index) VALUES
          ('pipe-cwr', '${tenantId}', 'FUNIL CWR', 1),
          ('pipe-fin', '${tenantId}', 'Financeiro', 2);
        INSERT INTO crm_stages (id, tenant_id, pipeline_id, name, order_index) VALUES
          ('stg-contatando', '${tenantId}', 'pipe-cwr', 'CONTATANDO', 3),
          ('stg-fin-triagem', '${tenantId}', 'pipe-fin', 'Triagem', 1);
      `);

      const currentSiteCtx = captureSiteContext(
        { page: { url: "https://www.tecfag.com.br/230", referrer: "https://www.tecfag.com.br/" } },
        "https://www.tecfag.com.br",
        new Date("2026-11-27T15:46:00Z"),
      );

      const journey = await resolveVisitorJourneyAttributionInTx(db, tenantId, {
        visitorIds: [visitorId],
        siteContext: currentSiteCtx,
      });
      expect(journey?.hasExplicitTracking).toBe(true);
      expect(journey?.attribution.source).toBe("Social | linktree");
      expect(journey?.attribution.campaign).toBe("Fagner | Vtex");
      expect(journey?.attribution.utmSource).toBe("linktree");
      expect(journey?.attribution.landingPage).toBe("https://www.tecfag.com.br/?utm_source=linktree");
      expect(journey?.enrichedSiteContext?.entry.url).toBe(
        "https://www.tecfag.com.br/?utm_source=linktree",
      );

      // Handoff comercial (CWR) cria deal com Social | linktree + Fagner | Vtex (nunca Chat Site!)
      const handoffRes = await ensureSiteDealOnWhatsappHandoff(db as any, {
        tenantId,
        whatsappConversationId: waConvId,
        siteConversationId: siteConvId,
        contactId,
        clientName: "Jackson",
        companyName: "KERATIN BRAZIL",
        destinationKey: "COMERCIAL",
      });
      expect(handoffRes.ok).toBe(true);
      expect(handoffRes.dealId).toBeTruthy();

      const dealRes = await pg.query(
        `SELECT entry_channel, source, campaign, utm_source, landing_page FROM crm_deals WHERE id = $1`,
        [handoffRes.dealId],
      );
      expect(dealRes.rows[0]).toEqual({
        entry_channel: "livechat",
        source: "Social | linktree",
        campaign: "Fagner | Vtex",
        utm_source: "linktree",
        landing_page: "https://www.tecfag.com.br/?utm_source=linktree",
      });

      // Handoff operacional (FINANCEIRO) usa loadDealSectorResolutionContext corretamente e atribuição canônica
      const opHandoff = await ensureSiteDealOnWhatsappHandoff(db as any, {
        tenantId,
        whatsappConversationId: waConvId,
        siteConversationId: siteConvId,
        contactId,
        clientName: "Jackson",
        destinationKey: "FINANCEIRO",
        targetPipelineId: "pipe-fin",
        targetStageId: "stg-fin-triagem",
      });
      expect(opHandoff.ok).toBe(true);
      const opDealRes = await pg.query(
        `SELECT source, campaign, sector_current FROM crm_deals WHERE id = $1`,
        [opHandoff.dealId],
      );
      expect(opDealRes.rows[0]).toEqual({
        source: "Social | linktree",
        campaign: "Fagner | Vtex",
        sector_current: "financeiro",
      });
    } finally {
      await pg.close();
    }
  });

  test("existing contact entering Fagner Site gets Fagner | Vtex and does not leak stale UTMs into new tracked visit", async () => {
    const { pg, db } = await createAttributionTestDb();
    try {
      await pg.exec(`
        INSERT INTO tenants (id, name) VALUES ('tecfag', 'Tecfag');
        INSERT INTO contacts (id, tenant_id, name, first_source, first_campaign, utm_source, utm_medium, click_id)
          VALUES ('cont-guilherme', 'tecfag', 'Guilherme', 'Busca Paga | Google', 'Botão Whatsapp | LP Semi', 'google', 'cpc', 'Cj0KCQiAOLD');
        INSERT INTO conversations (id, tenant_id, contact_id) VALUES
          ('conv-lc-vis-gui', 'tecfag', 'cont-guilherme'),
          ('conv-wa-gui', 'tecfag', 'cont-guilherme');
        INSERT INTO lc_visitors (id, tenant_id, cookie_id, current_url)
          VALUES ('vis-gui', 'tecfag', 'ck-gui', 'https://www.tecfag.com.br/230');
        INSERT INTO lc_pageviews (id, tenant_id, visitor_id, url, visited_at)
          VALUES ('pv-gui-1', 'tecfag', 'vis-gui', 'https://www.tecfag.com.br/?utm_source=linktree', NOW());
      `);

      const attr = await resolveInheritedMarketingAttribution(db, "tecfag", {
        contactId: "cont-guilherme",
        conversationId: "conv-wa-gui",
        siteConversationId: "conv-lc-vis-gui",
        isSiteOriginated: true,
        explicitEntryChannel: "livechat",
      });

      // Nova visita veio pelo Linktree -> não herda click_id/utm_medium antigos do Google nem campanha antiga!
      expect(attr.source).toBe("Social | linktree");
      expect(attr.campaign).toBe("Fagner | Vtex");
      expect(attr.utmSource).toBe("linktree");
      expect(attr.utmMedium).toBeNull();
      expect(attr.clickId).toBeNull();
    } finally {
      await pg.close();
    }
  });

  test("backfill recovers Linktree/Google/Direct, protects manual human edits, isolates Valem, and is idempotent", async () => {
    const { pg, sqlTag } = await createAttributionTestDb();
    try {
      await pg.exec(`
        INSERT INTO tenants (id, name) VALUES ('tecfag', 'Tecfag'), ('valem', 'Valem');

        INSERT INTO contacts (id, tenant_id, name, first_source, first_campaign, utm_source, utm_medium) VALUES
          ('cont-lc-vis-jackson', 'tecfag', 'Jackson', 'Contato pelo Site', 'Chat Site', NULL, NULL),
          ('cont-lc-vis-geci', 'tecfag', 'Geci', 'Chat Site', 'Chat Site', 'google-shopping', 'cpc'),
          ('cont-lc-vis-direct', 'tecfag', 'João', NULL, NULL, NULL, NULL),
          ('cont-gui', 'tecfag', 'Guilherme', 'Busca Paga | Google', 'Botão Whatsapp | LP Semi', 'google', 'cpc'),
          ('cont-human', 'tecfag', 'Editado Manual', 'Chat Site', 'Chat Site', NULL, NULL),
          ('cont-valem', 'valem', 'Cliente Valem', 'Chat Site', 'Chat Site', NULL, NULL);

        INSERT INTO conversations (id, tenant_id, contact_id) VALUES
          ('conv-lc-vis-jackson', 'tecfag', 'cont-lc-vis-jackson'),
          ('conv-wa-jackson', 'tecfag', 'cont-lc-vis-jackson'),
          ('conv-lc-vis-direct', 'tecfag', 'cont-lc-vis-direct');

        INSERT INTO lc_visitors (id, tenant_id, cookie_id, current_url) VALUES
          ('vis-jackson', 'tecfag', 'ck-j', 'https://www.tecfag.com.br/230'),
          ('vis-direct', 'tecfag', 'ck-d', 'https://www.tecfag.com.br/envasadora/p');

        INSERT INTO lc_pageviews (id, tenant_id, visitor_id, url, visited_at) VALUES
          ('pv-j-1', 'tecfag', 'vis-jackson', 'https://www.tecfag.com.br/?utm_source=linktree', NOW() - INTERVAL '5 minutes'),
          ('pv-j-2', 'tecfag', 'vis-jackson', 'https://www.tecfag.com.br/230', NOW() - INTERVAL '4 minutes'),
          ('pv-d-1', 'tecfag', 'vis-direct', 'https://www.tecfag.com.br/envasadora/p', NOW() - INTERVAL '2 minutes');

        INSERT INTO crm_deals (id, tenant_id, title, pipeline_id, stage_id, entry_channel, source, campaign, utm_source, utm_medium) VALUES
          ('deal-jackson', 'tecfag', 'Jackson - KERATIN', 'p1', 's1', 'livechat', 'Chat Site', 'Chat Site', NULL, NULL),
          ('deal-geci', 'tecfag', 'Geci', 'p1', 's1', 'livechat', 'Chat Site', 'Chat Site', 'google-shopping', 'cpc'),
          ('deal-direct', 'tecfag', 'João', 'p1', 's1', 'livechat', 'Chat Site', 'Chat Site', NULL, NULL),
          ('deal-gui', 'tecfag', 'Guilherme', 'p1', 's1', 'livechat', 'Chat Site', 'Botão Whatsapp | LP Semi', NULL, NULL),
          ('deal-human', 'tecfag', 'Manual', 'p1', 's1', 'livechat', 'Indicação', 'Chat Site', NULL, NULL),
          ('deal-rd-999', 'tecfag', 'Legado RD', 'p1', 's1', 'rd_webhook', 'Chat Site', 'Chat Site', NULL, NULL),
          ('deal-valem-1', 'valem', 'Valem Lead', 'p2', 's2', 'livechat', 'Chat Site', 'Chat Site', NULL, NULL);

        INSERT INTO crm_deal_contacts (id, tenant_id, deal_id, contact_id, is_primary) VALUES
          ('dc-1', 'tecfag', 'deal-jackson', 'cont-lc-vis-jackson', true),
          ('dc-2', 'tecfag', 'deal-geci', 'cont-lc-vis-geci', true),
          ('dc-3', 'tecfag', 'deal-direct', 'cont-lc-vis-direct', true),
          ('dc-4', 'tecfag', 'deal-gui', 'cont-gui', true),
          ('dc-5', 'tecfag', 'deal-human', 'cont-human', true);

        INSERT INTO crm_conversation_deals (id, tenant_id, conversation_id, deal_id) VALUES
          ('cd-1', 'tecfag', 'conv-lc-vis-jackson', 'deal-jackson'),
          ('cd-2', 'tecfag', 'conv-wa-jackson', 'deal-jackson'),
          ('cd-3', 'tecfag', 'conv-lc-vis-direct', 'deal-direct');

        INSERT INTO crm_deal_events (id, tenant_id, deal_id, event_type, actor_type, source_channel, operator_id, metadata) VALUES
          ('ev-human-src', 'tecfag', 'deal-human', 'source_changed', 'human', 'crm_ui', 'op-1', '{"field":"source"}'::jsonb);

        INSERT INTO crm_catalog_items (id, tenant_id, kind, name) VALUES
          ('cat-src-cs', 'tecfag', 'source', 'Chat Site'),
          ('cat-cmp-cs', 'tecfag', 'campaign', 'Chat Site'),
          ('cat-valem-cs', 'valem', 'source', 'Chat Site');
      `);

      const summary = await runSiteDealAttributionBackfill(sqlTag, "tecfag");
      expect(summary.dealsUpdated).toBe(5);

      const deals = await pg.query(
        `SELECT id, source, campaign, utm_source FROM crm_deals ORDER BY id ASC`,
      );
      const byId = Object.fromEntries(deals.rows.map((r: any) => [r.id, r]));

      expect(byId["deal-jackson"]).toEqual({
        id: "deal-jackson",
        source: "Social | linktree",
        campaign: "Fagner | Vtex",
        utm_source: "linktree",
      });
      expect(byId["deal-geci"]).toEqual({
        id: "deal-geci",
        source: "Busca Paga | google-shopping",
        campaign: "Fagner | Vtex",
        utm_source: "google-shopping",
      });
      expect(byId["deal-direct"]).toEqual({
        id: "deal-direct",
        source: "Tráfego Direto",
        campaign: "Fagner | Vtex",
        utm_source: null,
      });
      expect(byId["deal-gui"]).toEqual({
        id: "deal-gui",
        source: "Busca Paga | Google",
        campaign: "Fagner | Vtex",
        utm_source: "google",
      });
      // Edição manual humana de Fonte foi preservada; campanha (não editada) foi normalizada
      expect(byId["deal-human"]).toEqual({
        id: "deal-human",
        source: "Indicação",
        campaign: "Fagner | Vtex",
        utm_source: null,
      });
      // Deal RD e tenant Valem permanecem intactos
      expect(byId["deal-rd-999"].source).toBe("Chat Site");
      expect(byId["deal-valem-1"].source).toBe("Chat Site");
      expect(byId["deal-valem-1"].campaign).toBe("Chat Site");

      // Contato do Jackson foi enriquecido
      const contactJ = await pg.query(
        `SELECT first_source, first_campaign, utm_source FROM contacts WHERE id = 'cont-lc-vis-jackson'`,
      );
      expect(contactJ.rows[0]).toEqual({
        first_source: "Social | linktree",
        first_campaign: "Fagner | Vtex",
        utm_source: "linktree",
      });

      // Catálogo: Social | linktree e Fagner | Vtex garantidos; Chat Site do Valem NÃO arquivado
      const cats = await pg.query(
        `SELECT tenant_id, kind, name, archived_at IS NOT NULL AS archived FROM crm_catalog_items ORDER BY tenant_id, kind, name`,
      );
      expect(
        cats.rows.some(
          (r: any) => r.tenant_id === "tecfag" && r.kind === "source" && r.name === "Social | linktree" && !r.archived,
        ),
      ).toBe(true);
      expect(
        cats.rows.some(
          (r: any) => r.tenant_id === "tecfag" && r.kind === "campaign" && r.name === "Fagner | Vtex" && !r.archived,
        ),
      ).toBe(true);
      expect(
        cats.rows.some(
          (r: any) => r.tenant_id === "valem" && r.kind === "source" && r.name === "Chat Site" && !r.archived,
        ),
      ).toBe(true);

      // Idempotência: 2ª execução não altera nenhum deal
      const secondRun = await runSiteDealAttributionBackfill(sqlTag, "tecfag");
      expect(secondRun.dealsUpdated).toBe(0);
    } finally {
      await pg.close();
    }
  });
});
