import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import * as orm from "drizzle-orm";
import * as pg from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import { PGlite } from "@electric-sql/pglite";
import { loadAccessSource } from "./helpers/access-harness.mjs";

const schema = loadAccessSource("src/db/schema.ts", {
  "drizzle-orm": orm,
  "drizzle-orm/pg-core": pg,
});

let client;
let db;
let access;

before(async () => {
  client = new PGlite();
  db = drizzle(client, { schema });

  await client.exec(`
    CREATE TABLE tenants (
      id text PRIMARY KEY,
      name text NOT NULL,
      slug text NOT NULL UNIQUE,
      connection_type text NOT NULL DEFAULT 'meta'
    );
    CREATE TABLE contacts (
      id text PRIMARY KEY,
      tenant_id text NOT NULL,
      name text NOT NULL,
      phone text,
      main_channel text DEFAULT 'whatsapp'
    );
    CREATE TABLE whatsapp_connections (
      id text PRIMARY KEY,
      tenant_id text NOT NULL,
      name text NOT NULL,
      owner_operator_id text
    );
    CREATE TABLE whatsapp_connection_group_access (
      id text PRIMARY KEY,
      tenant_id text NOT NULL,
      connection_id text NOT NULL,
      group_id text NOT NULL,
      can_read boolean NOT NULL DEFAULT false
    );
    CREATE TABLE conversations (
      id text PRIMARY KEY,
      tenant_id text NOT NULL,
      contact_id text NOT NULL,
      operator_id text,
      queue_state text NOT NULL DEFAULT 'fila',
      whatsapp_connection_id text
    );
  `);

  access = loadAccessSource("src/lib/access-control/conversation-access.ts", {
    "../../db": { db },
    "../../db/schema": schema,
    "drizzle-orm": orm,
  });

  await client.exec(`
    INSERT INTO tenants (id, name, slug) VALUES
      ('tecfag', 'Tecfag', 'tecfag'),
      ('valem', 'Valem', 'valem');

    INSERT INTO contacts (id, tenant_id, name, phone, main_channel) VALUES
      ('cont-lc-ovidio', 'tecfag', 'Ovídio Teles', '5575991259811', 'livechat'),
      ('cont-rafael', 'tecfag', 'Rafael Boff', '5511999990001', 'whatsapp'),
      ('cont-ig', 'tecfag', 'Lead Instagram', null, 'instagram'),
      ('cont-lc-valem', 'valem', 'Cliente Site Valem', '5511999990002', 'livechat');

    INSERT INTO conversations (id, tenant_id, contact_id, operator_id, queue_state, whatsapp_connection_id) VALUES
      ('conv-56fbd6b8-wa', 'tecfag', 'cont-lc-ovidio', 'op-isabella', 'meus', NULL),
      ('conv-lc-ovidio', 'tecfag', 'cont-lc-ovidio', 'op-isabella', 'meus', NULL),
      ('conv-rafael-wa', 'tecfag', 'cont-rafael', 'op-isabella', 'meus', NULL),
      ('conv-lc-rafael', 'tecfag', 'cont-rafael', 'op-isabella', 'meus', NULL),
      ('conv-ig-1', 'tecfag', 'cont-ig', 'op-isabella', 'meus', NULL),
      ('conv-valem-wa', 'valem', 'cont-lc-valem', 'op-valem', 'meus', NULL);
  `);
});

after(async () => {
  await client?.close();
});

function makePrincipal(tenantId, operatorId, allowedChannels, role = "agent") {
  return {
    tenantId,
    operator: { id: operatorId, role, groupId: `grp-${operatorId}` },
    permissions: {
      views: { chat: true },
      chat: {
        canViewAllChats: true,
        restrictToOwnChats: false,
        canViewQueueMine: true,
        canViewQueueWaiting: true,
        canViewQueueBot: true,
        canViewQueueClosed: true,
      },
    },
    accessGroup: { allowedChannels },
  };
}

async function queryVisibleIds(principal) {
  const rows = await db
    .select({ id: schema.conversations.id })
    .from(schema.conversations)
    .where(access.conversationReadCondition(principal));
  return rows.map((r) => r.id).sort();
}

test("PostgreSQL real: grupo SDR e Pós-venda (sem livechat) veem conversa WhatsApp de contato nascido no Site, sem vazar conv-lc-*", async () => {
  const sdr = makePrincipal("tecfag", "op-isabella", ["whatsapp", "instagram", "messenger"]);
  const posVenda = makePrincipal("tecfag", "op-deborah", ["whatsapp"]);
  const siteOnly = makePrincipal("tecfag", "op-site", ["livechat"]);
  const igOnly = makePrincipal("tecfag", "op-ig", ["instagram"]);
  const admin = makePrincipal("tecfag", "op-admin", ["whatsapp", "instagram", "messenger", "livechat"], "admin");
  const valemSeller = makePrincipal("valem", "op-valem", ["whatsapp"]);

  assert.deepEqual(await queryVisibleIds(sdr), [
    "conv-56fbd6b8-wa",
    "conv-ig-1",
    "conv-rafael-wa",
  ]);
  assert.equal(await access.requireConversationAccess(sdr, "conv-56fbd6b8-wa"), null);
  assert.equal((await access.requireConversationAccess(sdr, "conv-lc-ovidio")).status, 404);
  assert.equal((await access.requireConversationAccess(sdr, "conv-lc-rafael")).status, 404);

  assert.deepEqual(await queryVisibleIds(posVenda), [
    "conv-56fbd6b8-wa",
    "conv-rafael-wa",
  ]);
  assert.equal(await access.requireConversationAccess(posVenda, "conv-56fbd6b8-wa"), null);
  assert.equal((await access.requireConversationAccess(posVenda, "conv-lc-ovidio")).status, 404);

  assert.deepEqual(await queryVisibleIds(siteOnly), [
    "conv-lc-ovidio",
    "conv-lc-rafael",
  ]);
  assert.equal((await access.requireConversationAccess(siteOnly, "conv-56fbd6b8-wa")).status, 404);

  assert.deepEqual(await queryVisibleIds(igOnly), ["conv-ig-1"]);
  assert.equal((await access.requireConversationAccess(igOnly, "conv-56fbd6b8-wa")).status, 404);

  assert.deepEqual(await queryVisibleIds(admin), [
    "conv-56fbd6b8-wa",
    "conv-ig-1",
    "conv-lc-ovidio",
    "conv-lc-rafael",
    "conv-rafael-wa",
  ]);

  // Isolamento multi-tenant preservado: valem só enxerga valem
  assert.deepEqual(await queryVisibleIds(valemSeller), ["conv-valem-wa"]);
  assert.equal((await access.requireConversationAccess(valemSeller, "conv-56fbd6b8-wa")).status, 404);
});
