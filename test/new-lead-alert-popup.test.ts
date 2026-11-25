import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as orm from "drizzle-orm";
import * as pgCore from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import { PGlite } from "@electric-sql/pglite";
import * as schema from "../src/db/schema";
import {
  notifyOperatorLeadTransferred,
  resolveLeadPopupFields,
} from "../src/lib/valentina/operator-notifications";
import {
  enqueueIncomingLeadAlert,
  extractIncomingLeadAlertFromNotification,
  LEAD_ALERT_RECOVERY_MAX_AGE_MS,
  markLeadAlertDismissed,
  parseResolvedLeadAlertBroadcast,
  readDismissedLeadAlertIds,
  removeIncomingLeadAlert,
  RESOLVED_LEAD_ALERT_BROADCAST_KEY,
  shouldRecoverUnreadLeadAlert,
} from "../src/lib/lead-alert-queue";
import {
  tryAcquireCrossTabSoundSlot,
  tryAcquireNewLeadSoundSlot,
} from "../src/lib/sound-notifications";
import { loadAccessSource } from "./helpers/access-harness.mjs";

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
}

async function createFullNotificationDb() {
  const pg = new PGlite();
  await pg.exec(`
    CREATE TABLE tenants (
      id text PRIMARY KEY,
      name text NOT NULL,
      slug text NOT NULL UNIQUE,
      connection_type text NOT NULL,
      created_at timestamp NOT NULL DEFAULT now()
    );
    CREATE TABLE operators (
      id text PRIMARY KEY,
      tenant_id text NOT NULL REFERENCES tenants(id),
      name text NOT NULL,
      email text NOT NULL,
      password text NOT NULL,
      role text NOT NULL DEFAULT 'agent',
      status text NOT NULL DEFAULT 'disponivel',
      is_online boolean NOT NULL DEFAULT true,
      created_at timestamp NOT NULL DEFAULT now()
    );
    CREATE TABLE crm_accounts (
      id text PRIMARY KEY,
      tenant_id text NOT NULL REFERENCES tenants(id),
      type text NOT NULL DEFAULT 'company',
      name text NOT NULL,
      trade_name text,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    );
    CREATE TABLE contacts (
      id text PRIMARY KEY,
      tenant_id text NOT NULL REFERENCES tenants(id),
      account_id text REFERENCES crm_accounts(id),
      name text NOT NULL,
      phone text,
      main_channel text NOT NULL DEFAULT 'whatsapp',
      responsible_name text NOT NULL DEFAULT 'Na Fila',
      tags jsonb NOT NULL DEFAULT '[]'::jsonb,
      cnpj_details jsonb NOT NULL DEFAULT '{}'::jsonb,
      custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
      is_legacy boolean NOT NULL DEFAULT false,
      is_test boolean NOT NULL DEFAULT false,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    );
    CREATE TABLE conversations (
      id text PRIMARY KEY,
      tenant_id text NOT NULL REFERENCES tenants(id),
      contact_id text NOT NULL REFERENCES contacts(id),
      queue_state text NOT NULL DEFAULT 'meus',
      operator_id text REFERENCES operators(id),
      whatsapp_connection_id text,
      last_message_text text,
      last_message_time timestamp NOT NULL DEFAULT now(),
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    );
    CREATE TABLE messages (
      id text PRIMARY KEY,
      tenant_id text NOT NULL REFERENCES tenants(id),
      conversation_id text NOT NULL REFERENCES conversations(id),
      sender_type text NOT NULL,
      sender_name text NOT NULL,
      content text NOT NULL,
      is_internal_note boolean NOT NULL DEFAULT false,
      media_interpretation text,
      status text NOT NULL DEFAULT 'accepted',
      meta_details jsonb NOT NULL DEFAULT '{}'::jsonb,
      updated_at timestamp NOT NULL DEFAULT now(),
      sent_at timestamp NOT NULL DEFAULT now()
    );
    CREATE TABLE agent_flow_states (
      id text PRIMARY KEY,
      tenant_id text NOT NULL REFERENCES tenants(id),
      conversation_id text NOT NULL REFERENCES conversations(id),
      agent_type text NOT NULL,
      current_step text NOT NULL,
      collected_data jsonb NOT NULL DEFAULT '{}'::jsonb,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      started_at timestamp NOT NULL DEFAULT now(),
      last_interaction_at timestamp NOT NULL DEFAULT now()
    );
    CREATE TABLE crm_deals (
      id text PRIMARY KEY,
      tenant_id text NOT NULL REFERENCES tenants(id),
      title text NOT NULL,
      account_id text REFERENCES crm_accounts(id),
      pipeline_id text NOT NULL,
      stage_id text NOT NULL,
      status text NOT NULL DEFAULT 'open',
      value numeric(14,2),
      custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    );
    CREATE TABLE crm_conversation_deals (
      id text PRIMARY KEY,
      tenant_id text NOT NULL REFERENCES tenants(id),
      conversation_id text NOT NULL REFERENCES conversations(id),
      deal_id text NOT NULL REFERENCES crm_deals(id),
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamp NOT NULL DEFAULT now()
    );
    CREATE TABLE crm_deal_products (
      id text PRIMARY KEY,
      tenant_id text NOT NULL REFERENCES tenants(id),
      deal_id text NOT NULL REFERENCES crm_deals(id),
      product_id text,
      name text NOT NULL,
      quantity numeric(12,3) NOT NULL DEFAULT 1,
      unit_price numeric(12,2) NOT NULL DEFAULT 0,
      discount_percent numeric(5,2) NOT NULL DEFAULT 0,
      total_price numeric(12,2) NOT NULL DEFAULT 0,
      notes text,
      created_at timestamp NOT NULL DEFAULT now()
    );
    CREATE TABLE crm_custom_field_definitions (
      id text PRIMARY KEY,
      tenant_id text NOT NULL REFERENCES tenants(id),
      entity_type text NOT NULL,
      name text NOT NULL,
      field_type text NOT NULL DEFAULT 'text',
      options jsonb NOT NULL DEFAULT '[]'::jsonb,
      required boolean NOT NULL DEFAULT false,
      required_rule text NOT NULL DEFAULT 'always',
      required_from_stage_id text,
      is_unique boolean NOT NULL DEFAULT false,
      visible_on_create boolean NOT NULL DEFAULT true,
      all_pipelines boolean NOT NULL DEFAULT true,
      pipeline_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
      sort_order integer NOT NULL DEFAULT 0,
      archived_at timestamp,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    );
    CREATE TABLE internal_messages (
      id text PRIMARY KEY,
      tenant_id text NOT NULL REFERENCES tenants(id),
      operator_id text NOT NULL REFERENCES operators(id),
      direction text NOT NULL,
      agent_type text NOT NULL,
      content text NOT NULL,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      read integer NOT NULL DEFAULT 0,
      created_at timestamp NOT NULL DEFAULT now(),
      repeat_count integer NOT NULL DEFAULT 1,
      last_fired_at timestamp NOT NULL DEFAULT now()
    );
  `);

  const testDb = drizzle(pg, { schema });
  return { pg, testDb };
}

describe("resolveLeadPopupFields & notifyOperatorLeadTransferred — Nome, Máquina e Empresa limpos", () => {
  it("prioriza máquina da triagem/produto e nunca substitui por mensagem solta ou placeholders", () => {
    const resolved = resolveLeadPopupFields({
      explicitClientName: "Cliente WhatsApp",
      contactName: "Renato Silva",
      explicitCompany: "Empresa não informada",
      accountTradeName: "Taratur Alimentos",
      explicitInterest: "Máquinas",
      targetFunnel: "Máquinas",
      collectedData: {
        "MÁQUINA / PEÇA / INTERESSE": { value: "Seladora a Vácuo DZ-280/2SE", status: "filled" },
        "APLICAÇÃO / O QUE PRODUZ": { value: "Queijo mussarela", status: "filled" },
      },
    });

    expect(resolved.clientName).toBe("Renato Silva");
    expect(resolved.machine).toBe("Seladora a Vácuo DZ-280/2SE");
    expect(resolved.company).toBe("Taratur Alimentos");
  });

  it("extrai máquina do dealTitle e empresa da Receita quando campos explícitos não existem", () => {
    const resolved = resolveLeadPopupFields({
      contactName: "Carlos Mendes",
      dealTitle: "Alfa Pack — Envasadora EV-200",
      collectedData: {
        _RECEITA_FEDERAL: { nomeFantasia: "Alfa Pack" } as any,
      },
    });

    expect(resolved.clientName).toBe("Carlos Mendes");
    expect(resolved.company).toBe("Alfa Pack");
    expect(resolved.machine).toBe("Envasadora EV-200");
  });

  it("não corrompe o campo machine com lastMessageText ('ok obrigado') e enriquece via crm_deal_products + account do card", async () => {
    const { pg, testDb } = await createFullNotificationDb();
    try {
      await pg.exec(`
        INSERT INTO tenants (id, name, slug, connection_type) VALUES
          ('tecfag', 'Tecfag', 'tecfag', 'meta'),
          ('valem', 'Valem', 'valem', 'baileys');

        INSERT INTO operators (id, tenant_id, name, email, password) VALUES
          ('op-melissa', 'tecfag', 'Melissa Gomes', 'melissa@tecfag.com.br', 'x'),
          ('op-denys', 'valem', 'Denys Valem', 'denys@valem.com.br', 'x');

        INSERT INTO crm_accounts (id, tenant_id, type, name, trade_name) VALUES
          ('acc-acai', 'tecfag', 'company', 'ACAI VERAO INDUSTRIA LTDA', 'Açaí Verão'),
          ('acc-valem', 'valem', 'company', 'BETA COSMETICOS LTDA', 'Beta Cosméticos');

        INSERT INTO contacts (id, tenant_id, account_id, name, phone) VALUES
          ('cnt-1', 'tecfag', NULL, 'Carlos Eduardo', '5514999991111'),
          ('cnt-2', 'tecfag', 'acc-acai', 'Lucinalva Souza', '5514999992222'),
          ('cnt-3', 'valem', 'acc-valem', 'Marcos Lima', '5511999993333');

        INSERT INTO conversations (id, tenant_id, contact_id, operator_id, last_message_text) VALUES
          ('conv-1', 'tecfag', 'cnt-1', 'op-melissa', 'ok obrigado'),
          ('conv-2', 'tecfag', 'cnt-2', 'op-melissa', 'combinado'),
          ('conv-3', 'valem', 'cnt-3', 'op-denys', 'blz');

        INSERT INTO agent_flow_states (id, tenant_id, conversation_id, agent_type, current_step, collected_data, metadata) VALUES
          ('flow-2', 'tecfag', 'conv-2', 'sdr', 'Concluído', '{"MÁQUINA / PEÇA / INTERESSE":{"value":"Empacotadora DGF300","status":"filled"}}'::jsonb, '{"targetFunnel":"FUNIL MÁQUINAS"}'::jsonb);

        INSERT INTO crm_deals (id, tenant_id, title, account_id, pipeline_id, stage_id) VALUES
          ('deal-1', 'tecfag', 'Carlos Eduardo', 'acc-acai', 'pipe-m', 'stg-1'),
          ('deal-2', 'tecfag', 'Açaí Verão — Empacotadora DGF300', 'acc-acai', 'pipe-m', 'stg-1'),
          ('deal-3', 'valem', 'Beta Cosméticos — Válvula Spray 24/410', 'acc-valem', 'pipe-v', 'stg-v1');

        INSERT INTO crm_conversation_deals (id, tenant_id, conversation_id, deal_id, is_active) VALUES
          ('cd-1', 'tecfag', 'conv-1', 'deal-1', true),
          ('cd-2', 'tecfag', 'conv-2', 'deal-2', true),
          ('cd-3', 'valem', 'conv-3', 'deal-3', true);

        INSERT INTO crm_deal_products (id, tenant_id, deal_id, name) VALUES
          ('dp-1', 'tecfag', 'deal-1', 'Envasadora Automática EV-400');
      `);

      const emitted: Array<{ tenantId: string; event: any }> = [];

      // Caso 1: Transferência manual sem triagem — puxa máquina de crm_deal_products e empresa da conta do card
      await notifyOperatorLeadTransferred(
        {
          tenantId: "tecfag",
          operatorId: "op-melissa",
          conversationId: "conv-1",
          transferSource: "manual_transfer",
          transferredBy: "Tarcisio",
        },
        {
          database: testDb,
          ensureTask: async () => ({ taskId: "t-1", taskTitle: "Responder o contato" }),
          notifyPublic: (tenantId, event) => emitted.push({ tenantId, event }),
        },
      );

      expect(emitted).toHaveLength(1);
      const ev1 = emitted[0].event;
      expect(ev1.message.metadata.clientName).toBe("Carlos Eduardo");
      expect(ev1.message.metadata.machine).toBe("Envasadora Automática EV-400");
      expect(ev1.message.metadata.company).toBe("Açaí Verão");
      expect(ev1.message.warningMetadata.conversationId).toBe("conv-1");
      expect(ev1.message.warningMetadata.machine).toBe("Envasadora Automática EV-400");
      expect(ev1.message.warningMetadata.company).toBe("Açaí Verão");
      expect(ev1.message.metadata.machine).not.toBe("ok obrigado");

      // Caso 2: Triagem Fagner com lastMessageText = "combinado" — puxa máquina do collectedData
      await notifyOperatorLeadTransferred(
        {
          tenantId: "tecfag",
          operatorId: "op-melissa",
          conversationId: "conv-2",
          transferSource: "sdr_auto",
          cycle: "2026-11-25T14:00:00.000Z",
        },
        {
          database: testDb,
          ensureTask: async () => ({ taskId: "t-2", taskTitle: "Responder o contato" }),
          notifyPublic: (tenantId, event) => emitted.push({ tenantId, event }),
        },
      );

      expect(emitted).toHaveLength(2);
      const ev2 = emitted[1].event;
      expect(ev2.message.metadata.clientName).toBe("Lucinalva Souza");
      expect(ev2.message.metadata.machine).toBe("Empacotadora DGF300");
      expect(ev2.message.metadata.company).toBe("Açaí Verão");

      // Caso 3: Tenant Valem (multi-tenant isolado) — puxa produto do título do deal
      await notifyOperatorLeadTransferred(
        {
          tenantId: "valem",
          operatorId: "op-denys",
          conversationId: "conv-3",
          transferSource: "sdr_auto",
        },
        {
          database: testDb,
          ensureTask: async () => ({ taskId: "t-3", taskTitle: "Responder o contato" }),
          notifyPublic: (tenantId, event) => emitted.push({ tenantId, event }),
        },
      );

      expect(emitted).toHaveLength(3);
      expect(emitted[2].tenantId).toBe("valem");
      expect(emitted[2].event.message.author).toBe("Valentina");
      expect(emitted[2].event.message.metadata.machine).toBe("Válvula Spray 24/410");
      expect(emitted[2].event.message.metadata.company).toBe("Beta Cosméticos");
    } finally {
      await pg.close();
    }
  });
});

describe("filterConversationEvent — entrega SSE de Lead Novo mesmo sem valentina.canAccessChat", () => {
  it("entrega operator_ai_notification de lead_transfer para vendedor com views.chat=true e canAccessChat=false, bloqueando terceiros", async () => {
    const client = new PGlite();
    try {
      const db = drizzle(client);
      const loadedSchema = loadAccessSource("src/db/schema.ts", {
        "drizzle-orm": orm,
        "drizzle-orm/pg-core": pgCore,
      });
      for (const table of [
        loadedSchema.conversations,
        loadedSchema.contacts,
        loadedSchema.whatsappConnections,
        loadedSchema.whatsappConnectionGroupAccess,
      ]) {
        const cfg = pgCore.getTableConfig(table);
        await client.exec(
          `CREATE TABLE "${cfg.name}" (${cfg.columns
            .map((c: any) => `"${c.name}" ${c.getSQLType()}`)
            .join(",")})`,
        );
      }

      await client.query(
        "INSERT INTO contacts (id, tenant_id, name, main_channel, phone) VALUES ('c-1', 'tecfag', 'Lead Novo', 'whatsapp', '5514999990000')",
      );
      await client.query(
        "INSERT INTO conversations (id, tenant_id, contact_id, operator_id, queue_state, created_at, last_message_time) VALUES ('conv-lead-1', 'tecfag', 'c-1', 'op-vendedor', 'meus', NOW(), NOW())",
      );

      const access = loadAccessSource("src/lib/access-control/conversation-access.ts", {
        "../../db": { db },
        "../../db/schema": loadedSchema,
        "drizzle-orm": orm,
      });
      const events = loadAccessSource("src/lib/access-control/conversation-events.ts", {
        "../../db": { db },
        "../../db/schema": loadedSchema,
        "drizzle-orm": orm,
        "./conversation-access": access,
      });

      const sellerWithoutAiChat = {
        tenantId: "tecfag",
        operator: { id: "op-vendedor", name: "Vendedor", role: "agent", groupId: "grp-1" },
        permissions: {
          views: { chat: true, valentina: false },
          chat: {
            canViewQueueMine: true,
            canViewQueueWaiting: false,
            canViewQueueBot: false,
            canViewQueueClosed: false,
            restrictToOwnChats: true,
          },
          valentina: { canAccessChat: false },
        },
        accessGroup: { allowedChannels: ["whatsapp"] },
      };

      const leadEvent = {
        type: "operator_ai_notification",
        tenantId: "tecfag",
        operatorId: "op-vendedor",
        message: {
          id: "notif-1",
          warningType: "new_lead",
          metadata: { type: "lead_transfer", conversationId: "conv-lead-1" },
          warningMetadata: { conversationId: "conv-lead-1", clientId: "conv-lead-1" },
        },
      };

      const delivered = await events.filterConversationEvent(sellerWithoutAiChat, leadEvent);
      expect(delivered).not.toBeNull();

      // Alerta comum de IA (não-lead) continua bloqueado quando canAccessChat=false
      const nonLeadEvent = {
        type: "operator_ai_notification",
        tenantId: "tecfag",
        operatorId: "op-vendedor",
        message: { id: "notif-2", warningType: "delay", metadata: { type: "sla_alert" } },
      };
      expect(await events.filterConversationEvent(sellerWithoutAiChat, nonLeadEvent)).toBeNull();

      // Outro vendedor nunca recebe
      const otherSeller = {
        ...sellerWithoutAiChat,
        operator: { ...sellerWithoutAiChat.operator, id: "op-outro" },
      };
      expect(await events.filterConversationEvent(otherSeller, leadEvent)).toBeNull();

      // Outro tenant nunca recebe
      const valemSession = {
        ...sellerWithoutAiChat,
        tenantId: "valem",
      };
      expect(await events.filterConversationEvent(valemSession, leadEvent)).toBeNull();
    } finally {
      await client.close();
    }
  });
});

describe("lead-alert-queue & sound-notifications — fila FIFO, dedupe, sync cross-tab e som dedicado", () => {
  it("extrai, enfileira em FIFO, deduplica por conversa e sincroniza fechamento entre abas isolado por tenant/operador", () => {
    const storage = createMemoryStorage();
    const now = 1_760_000_000_000;

    const a1 = extractIncomingLeadAlertFromNotification(
      {
        id: "notif-a",
        warningType: "new_lead",
        createdAt: new Date(now).toISOString(),
        metadata: {
          type: "lead_transfer",
          conversationId: "conv-a",
          clientName: "João",
          machine: "Seladora BS-450",
          company: "Doces Sul",
        },
      },
      { tenantId: "tecfag", operatorId: "op-1" },
    )!;
    const a2 = extractIncomingLeadAlertFromNotification(
      {
        id: "notif-b",
        warningType: "new_lead",
        createdAt: new Date(now + 1000).toISOString(),
        metadata: {
          type: "lead_transfer",
          conversationId: "conv-b",
          clientName: "Maria",
          machine: "Envasadora EV-100",
          company: "Café Norte",
        },
      },
      { tenantId: "tecfag", operatorId: "op-1" },
    )!;

    expect(a1).not.toBeNull();
    expect(a1.clientName).toBe("João");
    expect(a1.machine).toBe("Seladora BS-450");
    expect(a1.company).toBe("Doces Sul");

    let queue = enqueueIncomingLeadAlert([], a1);
    queue = enqueueIncomingLeadAlert(queue, a2);
    // Mesmo conversationId com dado mais completo atualiza sem duplicar
    queue = enqueueIncomingLeadAlert(queue, { ...a1, id: "notif-a-upd", company: "Doces Sul Ltda" });
    expect(queue).toHaveLength(2);
    expect(queue[0].company).toBe("Doces Sul Ltda");
    expect(queue[1].conversationId).toBe("conv-b");

    markLeadAlertDismissed("tecfag", "op-1", "notif-a", {
      conversationId: "conv-a",
      nowMs: now + 2000,
      storage,
    });
    expect(readDismissedLeadAlertIds("tecfag", "op-1", { nowMs: now + 3000, storage }).has("notif-a")).toBe(true);
    // Outro tenant não vê como dispensado
    expect(readDismissedLeadAlertIds("valem", "op-1", { nowMs: now + 3000, storage }).has("notif-a")).toBe(false);

    const broadcast = parseResolvedLeadAlertBroadcast(
      storage.getItem(RESOLVED_LEAD_ALERT_BROADCAST_KEY),
    );
    expect(broadcast?.alertId).toBe("notif-a");
    expect(broadcast?.conversationId).toBe("conv-a");

    queue = removeIncomingLeadAlert(queue, { conversationId: "conv-a" });
    expect(queue).toHaveLength(1);
    expect(queue[0].conversationId).toBe("conv-b");
  });

  it("recupera apenas alertas não lidos com menos de 5 minutos e ignora antigos ou já lidos", () => {
    const now = 1_760_000_000_000;
    const freshRow = {
      id: "notif-fresh",
      read: 0,
      createdAt: new Date(now - 60_000).toISOString(),
      metadata: { type: "lead_transfer", conversationId: "conv-1", clientName: "Ana", machine: "DGF300" },
    };
    const oldRow = {
      id: "notif-old",
      read: 0,
      createdAt: new Date(now - LEAD_ALERT_RECOVERY_MAX_AGE_MS - 30_000).toISOString(),
      metadata: { type: "lead_transfer", conversationId: "conv-2", clientName: "Antigo" },
    };
    const readRow = {
      id: "notif-read",
      read: 1,
      createdAt: new Date(now - 10_000).toISOString(),
      metadata: { type: "lead_transfer", conversationId: "conv-3", clientName: "Lido" },
    };

    expect(
      shouldRecoverUnreadLeadAlert(freshRow, { tenantId: "tecfag", operatorId: "op-1", nowMs: now }),
    ).not.toBeNull();
    expect(
      shouldRecoverUnreadLeadAlert(oldRow, { tenantId: "tecfag", operatorId: "op-1", nowMs: now }),
    ).toBeNull();
    expect(
      shouldRecoverUnreadLeadAlert(readRow, { tenantId: "tecfag", operatorId: "op-1", nowMs: now }),
    ).toBeNull();
  });

  it("garante que o ping de mensagem comum NÃO bloqueia o alerta sonoro de Lead Novo", () => {
    const storage = createMemoryStorage();
    const t = 1_760_000_000_000;

    expect(tryAcquireCrossTabSoundSlot(t, storage)).toBe(true);
    // Mesmo 50ms depois de um ping de mensagem comum, o som de Lead Novo DEVE tocar!
    expect(tryAcquireNewLeadSoundSlot(t + 50, storage)).toBe(true);
    // Mas duas abas tentando tocar o mesmo Lead Novo simultaneamente são deduplicadas
    expect(tryAcquireNewLeadSoundSlot(t + 100, storage)).toBe(false);
    expect(tryAcquireNewLeadSoundSlot(t + 2500, storage)).toBe(true);
  });
});

describe("NewLeadAlertModal — contrato visual, sobreposição global e Design System", () => {
  it("renderiza LEAD NOVO, Nome, Máquina, Empresa e botão 'Clique aqui para falar com ele' acima de tudo e sem controles nativos", () => {
    const modalSource = readFileSync(
      resolve(__dirname, "../src/components/ui/NewLeadAlertModal.tsx"),
      "utf-8",
    );
    const rootSource = readFileSync(resolve(__dirname, "../src/routes/__root.tsx"), "utf-8");

    expect(modalSource).toContain("LEAD NOVO");
    expect(modalSource).toContain("Clique aqui para falar com ele");
    expect(modalSource).toContain("Máquina");
    expect(modalSource).toContain("Empresa");
    expect(modalSource).toContain("createPortal");
    expect(modalSource).toContain("z-[10080]");
    expect(modalSource).toContain("getAiPersona");
    expect(modalSource).toContain("SystemTooltip");
    expect(modalSource).not.toMatch(/\btitle="/);
    expect(modalSource).not.toContain("<select");

    expect(rootSource).toContain("NewLeadAlertModal");
  });
});
