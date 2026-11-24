import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import {
  extractValidDocument,
  isGenericName,
  normalizeLegacyClickType,
  normalizeLegacyEmail,
  normalizeLegacyLcSender,
  normalizeLegacyPhone,
  parseLegacyTimestamp,
  runLegacyFagnerSiteMigration,
  type SqlExecutor,
} from "../src/lib/livechat/legacy-fagner-site-migration";

function wrapPglite(pg: PGlite): SqlExecutor {
  return {
    async query<T = Record<string, any>>(text: string, params: unknown[] = []) {
      const res = await pg.query<T>(text, params);
      return { rows: res.rows };
    },
  };
}

async function createLegacySchema(pg: PGlite) {
  await pg.exec(`
    CREATE TABLE lc_visitors (
      "id" TEXT PRIMARY KEY,
      "cookieId" TEXT NOT NULL,
      "ip" TEXT,
      "city" TEXT,
      "country" TEXT,
      "browser" TEXT,
      "deviceType" TEXT,
      "userAgent" TEXT,
      "currentPage" TEXT,
      "currentPageTitle" TEXT,
      "source" TEXT,
      "utmSource" TEXT,
      "utmMedium" TEXT,
      "utmCampaign" TEXT,
      "referrer" TEXT,
      "totalVisits" INTEGER NOT NULL DEFAULT 1,
      "totalPages" INTEGER NOT NULL DEFAULT 0,
      "totalChats" INTEGER NOT NULL DEFAULT 0,
      "category" TEXT NOT NULL DEFAULT 'visitor',
      "engagementScore" INTEGER NOT NULL DEFAULT 0,
      "purchaseIntentScore" INTEGER NOT NULL DEFAULT 0,
      "totalTimeSeconds" INTEGER NOT NULL DEFAULT 0,
      "aiBriefing" JSONB,
      "isOnline" TEXT NOT NULL DEFAULT 'false',
      "pipelineStage" TEXT NOT NULL DEFAULT 'novo_atendimento',
      "firstSeenAt" TEXT NOT NULL,
      "lastSeenAt" TEXT NOT NULL,
      "name" TEXT,
      "notes" JSONB DEFAULT '[]'::jsonb,
      "posVendaNome" TEXT,
      "posVendaTelefone" TEXT,
      "posVendaEmail" TEXT,
      "posVendaCnpjCpf" TEXT,
      "posVendaNotaPedido" TEXT,
      "posVendaProblema" TEXT,
      "posVendaCnpjData" JSONB,
      "pecaDesejada" TEXT,
      "pecasECliente" TEXT,
      "maquinaDesejada" TEXT,
      "maquinaProdutoFabricado" TEXT,
      "maquinaVolumeProducao" TEXT,
      "maquinaQualificacaoSDR" TEXT,
      "maquinaClienteNovo" TEXT,
      "maquinaRating" INTEGER,
      "rdCrmDealId" TEXT,
      "vtexOrderFormId" TEXT,
      "vtexOrderId" TEXT,
      "vtexOrderStatus" TEXT,
      "vtexOrderData" JSONB,
      "npsRating" INTEGER,
      "npsComment" TEXT,
      "npsStage" TEXT,
      "bigdataRawData" JSONB
    );

    CREATE TABLE lc_pageviews (
      "id" TEXT PRIMARY KEY,
      "visitorId" TEXT NOT NULL,
      "url" TEXT NOT NULL,
      "pageTitle" TEXT,
      "scrollDepth" INTEGER,
      "timeSpent" INTEGER,
      "intentTag" TEXT,
      "visitedAt" TEXT NOT NULL
    );

    CREATE TABLE lc_click_events (
      id SERIAL PRIMARY KEY,
      "visitorId" TEXT NOT NULL,
      url TEXT,
      "elementId" TEXT,
      "elementText" TEXT,
      "clickType" TEXT NOT NULL DEFAULT 'custom',
      "clickedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE lc_chats (
      "id" TEXT PRIMARY KEY,
      "visitorId" TEXT NOT NULL,
      "agentId" TEXT,
      "status" TEXT NOT NULL DEFAULT 'closed',
      "startedAt" TEXT NOT NULL,
      "endedAt" TEXT,
      "visitorName" TEXT,
      "visitorEmail" TEXT,
      "source" TEXT NOT NULL DEFAULT 'widget',
      "aiHandled" TEXT NOT NULL DEFAULT 'true',
      "needsHuman" TEXT NOT NULL DEFAULT 'false',
      "proactiveApproach" TEXT NOT NULL DEFAULT 'false',
      "mood" TEXT,
      "closeReason" TEXT,
      "engagementScore" INTEGER DEFAULT 0,
      "vtexProduct" TEXT,
      "noiseFiltered" INTEGER DEFAULT 0
    );

    CREATE TABLE lc_messages (
      "id" TEXT PRIMARY KEY,
      "chatId" TEXT NOT NULL,
      "sender" TEXT NOT NULL,
      "content" TEXT NOT NULL,
      "read" TEXT NOT NULL DEFAULT 'true',
      "sentAt" TEXT NOT NULL
    );

    CREATE TABLE uc_bridge (
      id TEXT PRIMARY KEY,
      phone TEXT UNIQUE NOT NULL,
      email TEXT,
      cnpj_cpf TEXT,
      display_name TEXT,
      company_name TEXT,
      lc_cookie_id TEXT,
      wa_contact_id TEXT,
      rd_crm_deal_id TEXT,
      site_profile JSONB DEFAULT '{}'::jsonb,
      collected_data JSONB DEFAULT '{}'::jsonb,
      flow_history JSONB DEFAULT '[]'::jsonb,
      channels_used TEXT[] DEFAULT ARRAY['site']::TEXT[]
    );
  `);
}

async function createTargetSchemaWithMigration0067(pg: PGlite) {
  await pg.exec(`
    CREATE TABLE tenants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );

    CREATE TABLE crm_accounts (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      name TEXT NOT NULL,
      trade_name TEXT,
      document TEXT
    );

    CREATE TABLE contacts (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      account_id TEXT REFERENCES crm_accounts(id),
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      cnpj TEXT,
      cpf TEXT,
      tags JSONB DEFAULT '[]'::jsonb NOT NULL,
      main_channel TEXT NOT NULL,
      wallet_operator_id TEXT,
      responsible_name TEXT DEFAULT 'Na Fila' NOT NULL,
      rd_crm_deal_id TEXT,
      cnpj_details JSONB DEFAULT '{}'::jsonb NOT NULL,
      custom_fields JSONB DEFAULT '{}'::jsonb NOT NULL,
      entry_channel TEXT,
      first_source TEXT,
      first_campaign TEXT,
      utm_source TEXT,
      utm_medium TEXT,
      utm_campaign TEXT,
      landing_page TEXT,
      is_legacy BOOLEAN DEFAULT false NOT NULL,
      is_test BOOLEAN DEFAULT false NOT NULL,
      created_at TIMESTAMP DEFAULT now() NOT NULL,
      updated_at TIMESTAMP DEFAULT now() NOT NULL
    );

    CREATE TABLE contact_phones (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      phone TEXT NOT NULL,
      phone_identity TEXT NOT NULL,
      type TEXT DEFAULT 'commercial' NOT NULL,
      label TEXT,
      is_primary BOOLEAN DEFAULT false NOT NULL,
      has_whatsapp BOOLEAN DEFAULT true NOT NULL,
      position INTEGER DEFAULT 0 NOT NULL,
      created_at TIMESTAMP DEFAULT now() NOT NULL,
      updated_at TIMESTAMP DEFAULT now() NOT NULL
    );
    CREATE UNIQUE INDEX idx_contact_phones_contact_identity_uniq
      ON contact_phones (tenant_id, contact_id, phone_identity) WHERE phone_identity <> '';

    CREATE TABLE crm_deals (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      account_id TEXT,
      rd_deal_id TEXT
    );

    CREATE TABLE crm_deal_contacts (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      deal_id TEXT NOT NULL REFERENCES crm_deals(id),
      contact_id TEXT NOT NULL REFERENCES contacts(id),
      is_primary BOOLEAN DEFAULT false NOT NULL
    );

    CREATE TABLE conversations (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      contact_id TEXT NOT NULL REFERENCES contacts(id),
      contact_phone_id TEXT REFERENCES contact_phones(id),
      contact_phone TEXT,
      whatsapp_connection_id TEXT,
      operator_id TEXT,
      sector_id TEXT,
      queue_state TEXT DEFAULT 'fila' NOT NULL,
      unread_count INTEGER DEFAULT 0 NOT NULL,
      version INTEGER DEFAULT 1 NOT NULL,
      updated_at TIMESTAMP DEFAULT now() NOT NULL,
      last_message_text TEXT,
      last_message_time TIMESTAMP DEFAULT now() NOT NULL,
      created_at TIMESTAMP DEFAULT now() NOT NULL
    );

    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      conversation_id TEXT NOT NULL REFERENCES conversations(id),
      sender_type TEXT NOT NULL,
      sender_name TEXT NOT NULL,
      content TEXT NOT NULL,
      is_internal_note BOOLEAN DEFAULT false NOT NULL,
      external_id TEXT,
      provider TEXT DEFAULT 'baileys',
      direction TEXT DEFAULT 'inbound',
      status TEXT DEFAULT 'accepted' NOT NULL,
      meta_details JSONB DEFAULT '{}'::jsonb NOT NULL,
      updated_at TIMESTAMP DEFAULT now() NOT NULL,
      sent_at TIMESTAMP DEFAULT now() NOT NULL
    );

    CREATE TABLE agent_flow_states (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      conversation_id TEXT NOT NULL REFERENCES conversations(id),
      agent_type TEXT NOT NULL,
      current_step TEXT NOT NULL
    );

    CREATE TABLE lc_visitors (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      cookie_id TEXT NOT NULL,
      session_start TIMESTAMP DEFAULT now() NOT NULL,
      last_seen_at TIMESTAMP DEFAULT now() NOT NULL,
      name TEXT,
      company TEXT,
      cnpj TEXT,
      phone TEXT,
      email TEXT,
      product_interest TEXT,
      quantity_interest TEXT,
      intent_score INTEGER DEFAULT 0 NOT NULL,
      pipeline_stage TEXT DEFAULT 'novo' NOT NULL,
      temperature TEXT DEFAULT 'frio' NOT NULL,
      current_url TEXT,
      current_title TEXT,
      referrer TEXT,
      user_agent TEXT,
      ip_address TEXT
    );

    CREATE TABLE lc_chats (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      visitor_id TEXT NOT NULL,
      channel TEXT DEFAULT 'livechat' NOT NULL,
      status TEXT DEFAULT 'active' NOT NULL,
      operator_id TEXT,
      started_at TIMESTAMP DEFAULT now() NOT NULL,
      closed_at TIMESTAMP,
      outcome TEXT,
      wa_conversation_id TEXT
    );

    CREATE TABLE lc_messages (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      sender TEXT NOT NULL,
      content TEXT NOT NULL,
      content_type TEXT DEFAULT 'text' NOT NULL,
      media_url TEXT,
      media_type TEXT,
      file_name TEXT,
      tray_product_data JSONB,
      sent_at TIMESTAMP DEFAULT now() NOT NULL
    );

    CREATE TABLE lc_pageviews (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      visitor_id TEXT NOT NULL,
      url TEXT NOT NULL,
      title TEXT,
      time_on_page_sec INTEGER DEFAULT 0,
      scroll_depth_pct INTEGER DEFAULT 0,
      visited_at TIMESTAMP DEFAULT now() NOT NULL
    );

    CREATE TABLE lc_click_events (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      visitor_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      event_data JSONB,
      occurred_at TIMESTAMP DEFAULT now() NOT NULL
    );

    -- Função e trigger reais da 0054/0056 para garantir validação rigorosa de duplicidade de telefone
    CREATE OR REPLACE FUNCTION contact_phone_identity(value text) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
    DECLARE digits text := regexp_replace(coalesce(value, ''), '[^0-9]', '', 'g');
    DECLARE national text;
    BEGIN
      IF digits = '' THEN RETURN ''; END IF;
      national := digits;
      IF digits LIKE '55%' AND length(digits) IN (12, 13) THEN national := substr(digits, 3); END IF;
      IF length(national) = 11 AND substr(national, 3) ~ '^9[6-9][0-9]{7}$' THEN
        national := substr(national, 1, 2) || substr(national, 4);
      END IF;
      IF length(national) = 10 THEN RETURN '55' || national; END IF;
      RETURN digits;
    END;
    $$;

    CREATE OR REPLACE FUNCTION guard_contact_phone_identity() RETURNS trigger AS $$
    DECLARE identity_key text := contact_phone_identity(NEW.phone);
    BEGIN
      IF length(identity_key) < 8 THEN RETURN NEW; END IF;
      IF EXISTS (
        SELECT 1 FROM contacts c
        WHERE c.tenant_id = NEW.tenant_id AND c.id <> NEW.id AND contact_phone_identity(c.phone) = identity_key
      ) OR EXISTS (
        SELECT 1 FROM contact_phones cp
        WHERE cp.tenant_id = NEW.tenant_id AND cp.contact_id <> NEW.id AND cp.phone_identity = identity_key
      ) THEN
        RAISE EXCEPTION 'Já existe um contato com este telefone neste tenant';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER trg_contact_phone_identity
      BEFORE INSERT OR UPDATE OF phone ON contacts
      FOR EACH ROW EXECUTE FUNCTION guard_contact_phone_identity();

    -- Índice antigo da 0056 (será atualizado pela migração 0067 real logo abaixo)
    CREATE UNIQUE INDEX idx_conversations_tenant_contact_uniq
      ON conversations (tenant_id, contact_id, COALESCE(contact_phone_id, ''))
      WHERE whatsapp_connection_id IS NULL;
  `);

  // Aplica o arquivo SQL real da migração 0067!
  const migration0067Path = path.resolve(
    import.meta.dir,
    "../src/db/migrations/0067_site_conversations_multi_session_index.sql",
  );
  const migration0067Sql = readFileSync(migration0067Path, "utf8");
  await pg.exec(migration0067Sql);
}

describe("Helpers puros da migração Fagner Site Legado", () => {
  it("normaliza telefones BR/internacionais e valida CPF/CNPJ com dígitos verificadores", () => {
    expect(normalizeLegacyPhone("(14) 98146-8232")).toBe("5514981468232");
    expect(normalizeLegacyPhone("014 8146-8232")).toBe("551481468232");
    expect(normalizeLegacyPhone("5511999887766")).toBe("5511999887766");
    expect(normalizeLegacyPhone("11111111111")).toBeNull();
    expect(normalizeLegacyPhone("12345")).toBeNull();

    // CNPJ válido real de teste (11.222.333/0001-81) e CPF inválido (111.111.111-11)
    expect(extractValidDocument("11.222.333/0001-81")).toEqual({
      cpf: null,
      cnpj: "11222333000181",
      digits: "11222333000181",
    });
    expect(extractValidDocument("111.111.111-11", "00.000.000/0000-00")).toEqual({
      cpf: null,
      cnpj: null,
      digits: null,
    });
  });

  it("normaliza timestamps TEXT legados, e-mails, cliques e remetentes", () => {
    const parsedPg = parseLegacyTimestamp("2026-08-15 14:22:10.123+00");
    expect(parsedPg.toISOString()).toBe("2026-08-15T14:22:10.123Z");

    const fallback = new Date("2026-09-01T00:00:00.000Z");
    expect(parseLegacyTimestamp("data-invalida", fallback).toISOString()).toBe(fallback.toISOString());

    expect(normalizeLegacyEmail("  Joao@Empresa.COM.BR ")).toBe("joao@empresa.com.br");
    expect(normalizeLegacyEmail("teste@teste.com")).toBeNull();

    expect(normalizeLegacyClickType("whatsapp_btn")).toBe("whatsapp_click");
    expect(normalizeLegacyClickType("comprar_agora")).toBe("add_to_cart");
    expect(normalizeLegacyLcSender("agent")).toBe("operator");
    expect(normalizeLegacyLcSender("ai")).toBe("ai");
    expect(isGenericName("Visitante do site")).toBe(true);
    expect(isGenericName("5514981468232", "5514981468232")).toBe(true);
    expect(isGenericName("Carlos Eduardo")).toBe(false);
  });
});

describe("ETL Completo Fagner Site Legado -> Valem Chat (PGlite real + migração 0067)", () => {
  it("executa dry-run sem gravar, aplica migração com match em 4 camadas, merge de cookie v2, zero Kanban e idempotência 100%", async () => {
    const legacyPg = new PGlite();
    const targetPg = new PGlite();

    await createLegacySchema(legacyPg);
    await createTargetSchemaWithMigration0067(targetPg);

    // ── Seed do destino (Valem Chat com 2 tenants: tecfag e valem) ──
    await targetPg.exec(`
      INSERT INTO tenants (id, name) VALUES ('tecfag', 'Tecfag'), ('valem', 'Valem');

      -- Tenant VALEM (deve ficar 100% intocado)
      INSERT INTO contacts (id, tenant_id, name, phone, main_channel, responsible_name)
      VALUES ('c-valem-1', 'valem', 'Cliente Valem Intacto', '5514981468232', 'whatsapp', 'Operador Valem');

      -- Tenant TECFAG:
      -- 1) Contato WhatsApp existente (telefone SEM 9º dígito, enquanto legado virá COM 9º dígito!)
      INSERT INTO crm_accounts (id, tenant_id, name, trade_name, document)
      VALUES ('acc-cnpj-1', 'tecfag', 'INDUSTRIA ALFA LTDA', 'Alfa Pack', '11222333000181');

      INSERT INTO contacts (id, tenant_id, name, phone, main_channel, wallet_operator_id, responsible_name)
      VALUES ('c-wa-1', 'tecfag', 'Roberto Almeida', '551481468232', 'whatsapp', 'op-vini', 'Vinícius');
      INSERT INTO contact_phones (id, tenant_id, contact_id, phone, phone_identity, is_primary)
      VALUES ('cp-wa-1', 'tecfag', 'c-wa-1', '551481468232', '551481468232', true);
      INSERT INTO conversations (id, tenant_id, contact_id, contact_phone_id, contact_phone, queue_state, last_message_text)
      VALUES ('conv-wa-1', 'tecfag', 'c-wa-1', 'cp-wa-1', '551481468232', 'meus', 'Oi no WhatsApp');

      -- 2) Contato existente que dará match por CNPJ (Tier 2)
      INSERT INTO contacts (id, tenant_id, account_id, name, cnpj, main_channel, responsible_name)
      VALUES ('c-doc-1', 'tecfag', 'acc-cnpj-1', 'Mariana Silva', '11222333000181', 'whatsapp', 'Isabella');

      -- 3) Contato existente que dará match por RD Deal ID (Tier 3)
      INSERT INTO contacts (id, tenant_id, name, main_channel, responsible_name)
      VALUES ('c-rd-1', 'tecfag', 'Eduardo Costa', 'whatsapp', 'Na Fila');
      INSERT INTO crm_deals (id, tenant_id, rd_deal_id) VALUES ('deal-1', 'tecfag', 'rd-deal-9988');
      INSERT INTO crm_deal_contacts (id, tenant_id, deal_id, contact_id, is_primary)
      VALUES ('dc-1', 'tecfag', 'deal-1', 'c-rd-1', true);

      -- 4) Contato existente único por e-mail (Tier 4)
      INSERT INTO contacts (id, tenant_id, name, email, main_channel, responsible_name)
      VALUES ('c-email-1', 'tecfag', '5511977776666', 'compras@padariareal.com.br', 'whatsapp', 'Na Fila');

      -- 5) Dois contatos compartilhando mesmo e-mail (ambíguo -> NÃO pode fazer auto-match!)
      INSERT INTO contacts (id, tenant_id, name, email, main_channel, responsible_name)
      VALUES
        ('c-amb-1', 'tecfag', 'Sócio A', 'contato@duplicada.com.br', 'whatsapp', 'Na Fila'),
        ('c-amb-2', 'tecfag', 'Sócio B', 'contato@duplicada.com.br', 'whatsapp', 'Na Fila');

      -- 6) Visitante que JÁ voltou no widget v2 (mesmo cookie 'ck-returning-v2') e está em automação viva!
      INSERT INTO lc_visitors (id, tenant_id, cookie_id, session_start, last_seen_at, name, intent_score)
      VALUES ('v2-active-id', 'tecfag', 'ck-returning-v2', '2026-11-23 18:00:00', '2026-11-23 18:10:00', 'Lucas Retornou', 40);
      INSERT INTO contacts (id, tenant_id, name, main_channel, responsible_name)
      VALUES ('cont-lc-v2-active-id', 'tecfag', 'Lucas Retornou', 'livechat', 'Na Fila');
      INSERT INTO conversations (id, tenant_id, contact_id, queue_state, unread_count, last_message_text)
      VALUES ('conv-lc-v2-active-id', 'tecfag', 'cont-lc-v2-active-id', 'automacao', 1, 'Mensagem viva de hoje');
    `);

    // ── Seed do legado (Fagner Site) ──
    await legacyPg.exec(`
      -- Visitante 1A (cookie 1) e 1B (cookie 2 - outro celular) -> AMBOS com telefone do Roberto (c-wa-1), COM 9º dígito!
      INSERT INTO lc_visitors ("id","cookieId","name","posVendaNome","posVendaTelefone","posVendaEmail","maquinaDesejada","purchaseIntentScore","utmSource","city","firstSeenAt","lastSeenAt")
      VALUES
        ('leg-v1a','ck-roberto-1','Roberto','Roberto Almeida','(14) 98146-8232','roberto@empresa.com.br','Seladora FRM980',85,'google','Bauru','2026-06-10T10:00:00.000Z','2026-06-10T10:30:00.000Z'),
        ('leg-v1b','ck-roberto-2','Roberto Celular','Roberto Almeida','5514981468232',NULL,'Túnel BSD1535P',72,'instagram','Bauru','2026-07-12T15:00:00.000Z','2026-07-12T15:20:00.000Z'),
        -- Visitante 2 -> Match Tier 2 por CNPJ
        ('leg-v2','ck-mariana','Mariana','Mariana Silva',NULL,NULL,'Envasadora',65,'direct','SP','2026-08-01T11:00:00.000Z','2026-08-01T11:15:00.000Z'),
        -- Visitante 3 -> Match Tier 3 por rdCrmDealId
        ('leg-v3','ck-eduardo','Eduardo',NULL,NULL,NULL,'Datador',55,'google','RJ','2026-08-05T09:00:00.000Z','2026-08-05T09:10:00.000Z'),
        -- Visitante 4 -> Match Tier 4 por e-mail único (e faz upgrade do nome numérico '5511977776666' -> 'Fernanda Compras')
        ('leg-v4','ck-fernanda','Fernanda Compras',NULL,NULL,'COMPRAS@PADARIAREAL.COM.BR','Seladora a Vácuo',70,'google','MG','2026-08-10T14:00:00.000Z','2026-08-10T14:20:00.000Z'),
        -- Visitante 5 -> E-mail ambíguo (não deve mesclar em c-amb-1 nem c-amb-2; cria novo contato legado)
        ('leg-v5','ck-amb','Visitante Amb',NULL,NULL,'contato@duplicada.com.br',NULL,30,'direct','SP','2026-08-11T10:00:00.000Z','2026-08-11T10:05:00.000Z'),
        -- Visitante 6 -> Mesmo cookie 'ck-returning-v2' de quem já voltou ontem no v2!
        ('leg-v6','ck-returning-v2','Lucas Antigo',NULL,NULL,'lucas@antigo.com.br','Paletizadora',80,'google','PR','2026-05-01T08:00:00.000Z','2026-05-01T08:30:00.000Z'),
        -- Visitante 7A e 7B -> Novo lead identificado (2 cookies diferentes, MESMO telefone novo!) -> 1 contato novo, 0 erro na trigger!
        ('leg-v7a','ck-novo-1','Pedro Novo','Pedro Novo','11944445555','pedro@novo.com.br','Seladora',60,'google','SP','2026-09-01T10:00:00.000Z','2026-09-01T10:15:00.000Z'),
        ('leg-v7b','ck-novo-2','Pedro Novo','Pedro Novo','551144445555',NULL,'Peça resistência',50,'direct','SP','2026-09-05T10:00:00.000Z','2026-09-05T10:10:00.000Z'),
        -- Visitante 8 -> 100% anônimo (só pageview + clique, sem chat e sem dados)
        ('leg-v8','ck-anon','Visitante',NULL,NULL,NULL,NULL,15,'google','BA','2026-09-10T12:00:00.000Z','2026-09-10T12:02:00.000Z');

      UPDATE lc_visitors SET "posVendaCnpjCpf" = '11.222.333/0001-81' WHERE "id" = 'leg-v2';
      UPDATE lc_visitors SET "rdCrmDealId" = 'rd-deal-9988' WHERE "id" = 'leg-v3';

      INSERT INTO lc_pageviews ("id","visitorId","url","pageTitle","scrollDepth","timeSpent","visitedAt")
      VALUES
        ('pv-1','leg-v1a','https://www.tecfag.com.br/seladora-frm980','Seladora FRM980',80,120,'2026-06-10T10:01:00.000Z'),
        ('pv-2','leg-v6','https://www.tecfag.com.br/paletizadora','Paletizadora',90,200,'2026-05-01T08:05:00.000Z'),
        ('pv-3','leg-v8','https://www.tecfag.com.br/','Home Tecfag',40,30,'2026-09-10T12:00:30.000Z');

      INSERT INTO lc_click_events ("visitorId", url, "elementId", "elementText", "clickType", "clickedAt")
      VALUES
        ('leg-v1a','https://www.tecfag.com.br/seladora-frm980','btn-wpp','Chamar no WhatsApp','whatsapp_button','2026-06-10T10:05:00.000Z'),
        ('leg-v8','https://www.tecfag.com.br/','cta-1','Ver Catálogo','cta','2026-09-10T12:01:00.000Z');

      INSERT INTO lc_chats ("id","visitorId","status","startedAt","endedAt","visitorName","vtexProduct")
      VALUES
        ('ch-1a','leg-v1a','closed','2026-06-10T10:06:00.000Z','2026-06-10T10:25:00.000Z','Roberto Almeida','FRM980'),
        ('ch-1b','leg-v1b','closed','2026-07-12T15:05:00.000Z','2026-07-12T15:18:00.000Z','Roberto Celular','BSD1535P'),
        ('ch-6','leg-v6','closed','2026-05-01T08:10:00.000Z','2026-05-01T08:25:00.000Z','Lucas Antigo','Paletizadora'),
        ('ch-7a','leg-v7a','closed','2026-09-01T10:05:00.000Z','2026-09-01T10:12:00.000Z','Pedro Novo','Seladora');

      INSERT INTO lc_messages ("id","chatId","sender","content","sentAt")
      VALUES
        ('m-1','ch-1a','visitor','Quero cotar a seladora FRM980','2026-06-10T10:06:10.000Z'),
        ('m-2','ch-1a','ai','Claro Roberto! Qual sua produção diária?','2026-06-10T10:06:30.000Z'),
        ('m-3','ch-1a','agent','Oi Roberto, assumi seu atendimento aqui.','2026-06-10T10:10:00.000Z'),
        ('m-4','ch-1b','visitor','Agora preciso do túnel BSD1535P','2026-07-12T15:05:10.000Z'),
        ('m-5','ch-6','visitor','Oi, quero orçamento de paletizadora','2026-05-01T08:10:10.000Z'),
        ('m-6','ch-7a','visitor','Preciso de seladora para café','2026-09-01T10:05:10.000Z');
    `);

    const legacyExec = wrapPglite(legacyPg);
    const targetExec = wrapPglite(targetPg);

    // ── 1. DRY-RUN: valida contagens e garante ZERO escrita no destino ──
    const dryReport = await runLegacyFagnerSiteMigration(legacyExec, targetExec, {
      tenantId: "tecfag",
      dryRun: true,
    });
    expect(dryReport.dryRun).toBe(true);
    expect(dryReport.sourceCounts.lcVisitors).toBe(10);
    expect(dryReport.deduplication.mergedIntoExistingActiveV2Cookie).toBe(1);
    expect(dryReport.matching.matchedByPhone).toBe(2); // leg-v1a e leg-v1b -> c-wa-1
    expect(dryReport.matching.matchedByDocument).toBe(1); // leg-v2 -> c-doc-1
    expect(dryReport.matching.matchedByRdDeal).toBe(1); // leg-v3 -> c-rd-1
    expect(dryReport.matching.matchedByEmail).toBe(1); // leg-v4 -> c-email-1
    expect(dryReport.matching.ambiguousMatchesCount).toBe(1); // leg-v5 (duplicada.com.br)
    expect(dryReport.matching.anonymousVisitorsWithoutContact).toBe(1); // leg-v8
    expect(dryReport.targetPlannedOrWritten.agentFlowStatesInserted).toBe(0);

    // Garante que dry-run não inseriu nada
    const afterDryVisitors = await targetPg.query<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM lc_visitors WHERE tenant_id = 'tecfag'`,
    );
    expect(afterDryVisitors.rows[0].c).toBe(1); // apenas v2-active-id

    // ── 2. APPLY REAL ──
    const applyReport = await runLegacyFagnerSiteMigration(legacyExec, targetExec, {
      tenantId: "tecfag",
      dryRun: false,
      batchSize: 2, // força múltiplos lotes para testar chunking
    });
    expect(applyReport.warnings).toEqual([]);
    expect(applyReport.targetPlannedOrWritten.lcVisitorsInserted).toBe(9);
    expect(applyReport.targetPlannedOrWritten.lcVisitorsMerged).toBe(1);
    expect(applyReport.targetPlannedOrWritten.lcPageviewsInserted).toBe(3);
    expect(applyReport.targetPlannedOrWritten.lcClickEventsInserted).toBe(2);
    expect(applyReport.targetPlannedOrWritten.lcChatsInserted).toBe(4);
    expect(applyReport.targetPlannedOrWritten.lcMessagesInserted).toBe(6);
    expect(applyReport.targetPlannedOrWritten.agentFlowStatesInserted).toBe(0);

    // Verifica tenant VALEM 100% intocado
    const valemCheck = await targetPg.query(
      `SELECT name, custom_fields FROM contacts WHERE tenant_id = 'valem' AND id = 'c-valem-1'`,
    );
    expect(valemCheck.rows[0]).toEqual({ name: "Cliente Valem Intacto", custom_fields: {} });

    // Verifica Roberto (c-wa-1): enriquecido sem sobrescrever nome/carteira, 2 cookies vinculados, 2 conv-lc-* finalizados!
    const robertoContact = await targetPg.query<any>(
      `SELECT name, email, wallet_operator_id, utm_source, custom_fields FROM contacts WHERE id = 'c-wa-1'`,
    );
    expect(robertoContact.rows[0].name).toBe("Roberto Almeida");
    expect(robertoContact.rows[0].wallet_operator_id).toBe("op-vini");
    expect(robertoContact.rows[0].email).toBe("roberto@empresa.com.br");
    expect(robertoContact.rows[0].utm_source).toBe("google");
    expect(robertoContact.rows[0].custom_fields.linkedSiteContactIds).toEqual([
      "cont-lc-leg-v1a",
      "cont-lc-leg-v1b",
    ]);
    expect(robertoContact.rows[0].custom_fields.legacyFagnerSite.sessions.length).toBe(2);

    const robertoSiteConvs = await targetPg.query<any>(
      `SELECT id, queue_state, unread_count FROM conversations WHERE contact_id = 'c-wa-1' AND id LIKE 'conv-lc-%' ORDER BY id`,
    );
    expect(robertoSiteConvs.rows).toEqual([
      { id: "conv-lc-leg-v1a", queue_state: "finalizados", unread_count: 0 },
      { id: "conv-lc-leg-v1b", queue_state: "finalizados", unread_count: 0 },
    ]);

    // Verifica lc_chats vinculados ao WhatsApp do Roberto e sender 'agent' -> 'operator'
    const robertoLcChats = await targetPg.query<any>(
      `SELECT id, status, wa_conversation_id FROM lc_chats WHERE visitor_id IN ('leg-v1a','leg-v1b') ORDER BY id`,
    );
    expect(robertoLcChats.rows).toEqual([
      { id: "ch-1a", status: "closed", wa_conversation_id: "conv-wa-1" },
      { id: "ch-1b", status: "closed", wa_conversation_id: "conv-wa-1" },
    ]);

    const agentMsg = await targetPg.query<any>(`SELECT sender FROM lc_messages WHERE id = 'm-3'`);
    expect(agentMsg.rows[0].sender).toBe("operator");

    // Verifica upgrade de nome numérico no contato de e-mail único (c-email-1)
    const fernandaContact = await targetPg.query<any>(`SELECT name FROM contacts WHERE id = 'c-email-1'`);
    expect(fernandaContact.rows[0].name).toBe("Fernanda Compras");

    // Verifica merge do cookie já ativo no v2 ('ck-returning-v2' -> 'v2-active-id')
    const mergedV2 = await targetPg.query<any>(
      `SELECT id, session_start, name, email, intent_score FROM lc_visitors WHERE id = 'v2-active-id'`,
    );
    expect(new Date(mergedV2.rows[0].session_start).toISOString()).toBe("2026-05-01T08:00:00.000Z");
    expect(mergedV2.rows[0].name).toBe("Lucas Retornou"); // preservou nome do v2!
    expect(mergedV2.rows[0].email).toBe("lucas@antigo.com.br"); // preencheu lacuna!
    expect(mergedV2.rows[0].intent_score).toBe(80); // GREATEST(40, 80)

    // Verifica que a conversa viva v2 ('conv-lc-v2-active-id') permaneceu em 'automacao' (NÃO fechada!)
    const activeV2Conv = await targetPg.query<any>(
      `SELECT queue_state, unread_count FROM conversations WHERE id = 'conv-lc-v2-active-id'`,
    );
    expect(activeV2Conv.rows[0]).toEqual({ queue_state: "automacao", unread_count: 1 });

    // Verifica pageview legado de leg-v6 reapontado para v2-active-id
    const pv6 = await targetPg.query<any>(`SELECT visitor_id FROM lc_pageviews WHERE id = 'pv-2'`);
    expect(pv6.rows[0].visitor_id).toBe("v2-active-id");

    // Verifica deduplicação intra-legado de Pedro Novo (leg-v7a + leg-v7b -> 1 único contato!)
    const pedroContacts = await targetPg.query<any>(
      `SELECT id, is_legacy, responsible_name FROM contacts WHERE tenant_id = 'tecfag' AND email = 'pedro@novo.com.br'`,
    );
    expect(pedroContacts.rows.length).toBe(1);
    expect(pedroContacts.rows[0].is_legacy).toBe(true);
    expect(pedroContacts.rows[0].responsible_name).toBe("Na Fila");

    // Verifica anônimo (leg-v8): está em lc_visitors e lc_pageviews, mas NÃO criou contato nem conversa!
    const anonVisitor = await targetPg.query<any>(`SELECT id FROM lc_visitors WHERE id = 'leg-v8'`);
    const anonContact = await targetPg.query<any>(`SELECT id FROM contacts WHERE id = 'cont-lc-leg-v8'`);
    expect(anonVisitor.rows.length).toBe(1);
    expect(anonContact.rows.length).toBe(0);

    // Verifica Kanban 100% limpo (0 linhas em agent_flow_states)
    const flowsCount = await targetPg.query<{ c: number }>(`SELECT COUNT(*)::int AS c FROM agent_flow_states`);
    expect(flowsCount.rows[0].c).toBe(0);

    // ── 3. IDEMPOTÊNCIA: rodar --apply pela 2ª vez não duplica nada e dá 0 erros ──
    const secondRun = await runLegacyFagnerSiteMigration(legacyExec, targetExec, {
      tenantId: "tecfag",
      dryRun: false,
      batchSize: 2,
    });
    expect(secondRun.warnings).toEqual([]);
    expect(secondRun.targetPlannedOrWritten.lcVisitorsInserted).toBe(0);
    expect(secondRun.targetPlannedOrWritten.lcPageviewsInserted).toBe(0);
    expect(secondRun.targetPlannedOrWritten.lcClickEventsInserted).toBe(0);
    expect(secondRun.targetPlannedOrWritten.lcChatsInserted).toBe(0);
    expect(secondRun.targetPlannedOrWritten.lcMessagesInserted).toBe(0);
    expect(secondRun.targetPlannedOrWritten.contactsCreated).toBe(0);
    expect(secondRun.targetPlannedOrWritten.conversationsInserted).toBe(0);
    expect(secondRun.targetPlannedOrWritten.messagesInserted).toBe(0);

    const robertoAfterSecond = await targetPg.query<any>(
      `SELECT custom_fields FROM contacts WHERE id = 'c-wa-1'`,
    );
    expect(robertoAfterSecond.rows[0].custom_fields.legacyFagnerSite.sessions.length).toBe(2);

    await legacyPg.close();
    await targetPg.close();
  });
});
