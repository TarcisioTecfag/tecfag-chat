import { describe, expect, it } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import { notifyOperatorLeadTransferred } from "../src/lib/valentina/operator-notifications";

async function createMinimalNotificationDb() {
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
      pipeline_id text NOT NULL,
      stage_id text NOT NULL,
      status text NOT NULL DEFAULT 'open',
      value numeric(14,2),
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

describe("notifyOperatorLeadTransferred — regressão schema Drizzle real (PGlite)", () => {
  it("executa todas as queries sem erro de coluna undefined (contacts.company / messages.mediaType), resolve empresa via crm_accounts e emite SSE isolado por tenant", async () => {
    const { pg, testDb } = await createMinimalNotificationDb();
    try {
      await pg.exec(`
        INSERT INTO tenants (id, name, slug, connection_type) VALUES
          ('tecfag', 'Tecfag', 'tecfag', 'meta'),
          ('valem', 'Valem', 'valem', 'baileys');

        INSERT INTO operators (id, tenant_id, name, email, password) VALUES
          ('op-tf-1', 'tecfag', 'Melissa Gomes', 'melissa@tecfag.com.br', 'x'),
          ('op-vl-1', 'valem', 'Denys Valem', 'denys@valem.com.br', 'x');

        INSERT INTO crm_accounts (id, tenant_id, type, name, trade_name) VALUES
          ('acc-tf-1', 'tecfag', 'company', 'INDUSTRIA ALFA LTDA', 'Alfa Pack');

        INSERT INTO contacts (id, tenant_id, account_id, name, phone, cnpj_details) VALUES
          ('cnt-tf-1', 'tecfag', 'acc-tf-1', 'Carlos Mendes', '5514999990001', '{}'::jsonb),
          ('cnt-vl-1', 'valem', NULL, 'Ana Souza', '5511999990002', '{"nomeFantasia":"Cosmeticos Beta"}'::jsonb);

        INSERT INTO conversations (id, tenant_id, contact_id, operator_id, last_message_text) VALUES
          ('conv-tf-1', 'tecfag', 'cnt-tf-1', 'op-tf-1', 'Preciso de uma seladora a vacuo'),
          ('conv-vl-1', 'valem', 'cnt-vl-1', 'op-vl-1', 'Quero cotar valvulas spray');

        INSERT INTO messages (id, tenant_id, conversation_id, sender_type, sender_name, content, media_interpretation) VALUES
          ('msg-tf-1', 'tecfag', 'conv-tf-1', 'client', 'Carlos Mendes', '[áudio]', 'Quero seladora para 200 pacotes por dia'),
          ('msg-tf-2', 'tecfag', 'conv-tf-1', 'bot', 'Fagner', 'Perfeito Carlos, vou direcionar para a especialista.', NULL),
          ('msg-vl-1', 'valem', 'conv-vl-1', 'client', 'Ana Souza', 'Preciso de 5 mil valvulas spray 24/410', NULL);

        INSERT INTO agent_flow_states (id, tenant_id, conversation_id, agent_type, current_step, collected_data, metadata) VALUES
          ('flow-tf-1', 'tecfag', 'conv-tf-1', 'sdr', 'Concluído', '{"MÁQUINA / PEÇA / INTERESSE":{"value":"Seladora a vácuo","status":"filled"}}'::jsonb, '{"targetFunnel":"FUNIL MÁQUINAS"}'::jsonb);

        INSERT INTO crm_deals (id, tenant_id, title, pipeline_id, stage_id) VALUES
          ('deal-tf-1', 'tecfag', 'Alfa Pack — Seladora a vácuo', 'pipe-1', 'stg-1'),
          ('deal-vl-1', 'valem', 'Cosmeticos Beta — Valvulas Spray', 'pipe-vl', 'stg-vl');

        INSERT INTO crm_conversation_deals (id, tenant_id, conversation_id, deal_id, is_active) VALUES
          ('cd-tf-1', 'tecfag', 'conv-tf-1', 'deal-tf-1', true),
          ('cd-vl-1', 'valem', 'conv-vl-1', 'deal-vl-1', true);
      `);

      const emitted: Array<{ tenantId: string; event: any }> = [];

      // 1. Tenant Tecfag (Fagner) — empresa via crm_accounts.tradeName + interpretação de áudio
      const okTecfag = await notifyOperatorLeadTransferred(
        {
          tenantId: "tecfag",
          operatorId: "op-tf-1",
          conversationId: "conv-tf-1",
          cycle: "2026-11-25T12:00:00.000Z",
          transferSource: "sdr_auto",
        },
        {
          database: testDb,
          ensureTask: async () => ({ taskId: "task-tf-1", taskTitle: "Responder o contato" }),
          notifyPublic: (tenantId, event) => emitted.push({ tenantId, event }),
        },
      );

      expect(okTecfag).toBe(true);
      expect(emitted).toHaveLength(1);
      expect(emitted[0].tenantId).toBe("tecfag");
      expect(emitted[0].event.message.author).toBe("Fagner");
      expect(emitted[0].event.message.content).toContain("Alfa Pack");
      expect(emitted[0].event.message.content).toContain("200 pacotes por dia");
      expect(emitted[0].event.message.metadata.dealId).toBe("deal-tf-1");
      expect(emitted[0].event.message.metadata.taskId).toBe("task-tf-1");

      // Idempotência no mesmo cycle não duplica registro nem SSE
      const okTecfagRepeat = await notifyOperatorLeadTransferred(
        {
          tenantId: "tecfag",
          operatorId: "op-tf-1",
          conversationId: "conv-tf-1",
          cycle: "2026-11-25T12:00:00.000Z",
          transferSource: "sdr_auto",
        },
        {
          database: testDb,
          ensureTask: async () => ({ taskId: "task-tf-1", taskTitle: "Responder o contato" }),
          notifyPublic: (tenantId, event) => emitted.push({ tenantId, event }),
        },
      );
      expect(okTecfagRepeat).toBe(true);
      expect(emitted).toHaveLength(1);

      // 2. Tenant Valem (Valentina) — empresa via fallback contacts.cnpjDetails.nomeFantasia
      const okValem = await notifyOperatorLeadTransferred(
        {
          tenantId: "valem",
          operatorId: "op-vl-1",
          conversationId: "conv-vl-1",
          transferSource: "manual_transfer",
          transferredBy: "Gestor",
        },
        {
          database: testDb,
          ensureTask: async () => ({ taskId: "task-vl-1", taskTitle: "Responder o contato" }),
          notifyPublic: (tenantId, event) => emitted.push({ tenantId, event }),
        },
      );

      expect(okValem).toBe(true);
      expect(emitted).toHaveLength(2);
      expect(emitted[1].tenantId).toBe("valem");
      expect(emitted[1].event.message.author).toBe("Valentina");
      expect(emitted[1].event.message.content).toContain("Cosmeticos Beta");
      expect(emitted[1].event.message.content).toContain("5 mil valvulas spray");

      const tfRows = await testDb
        .select()
        .from(schema.internalMessages)
        .where(eq(schema.internalMessages.tenantId, "tecfag"));
      const vlRows = await testDb
        .select()
        .from(schema.internalMessages)
        .where(eq(schema.internalMessages.tenantId, "valem"));
      expect(tfRows).toHaveLength(1);
      expect(vlRows).toHaveLength(1);
    } finally {
      await pg.close();
    }
  });
});
