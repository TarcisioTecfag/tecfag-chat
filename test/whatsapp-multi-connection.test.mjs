import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as orm from "drizzle-orm";
import * as pg from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import { PGlite } from "@electric-sql/pglite";
import ts from "typescript";
import { loadAccessSource, routeStub, apiRequest } from "./helpers/access-harness.mjs";

// Embedded PostgreSQL only: no DATABASE_URL, .env, live credentials, sockets or network.
const schema = loadAccessSource("src/db/schema.ts", {
  "drizzle-orm": orm,
  "drizzle-orm/pg-core": pg,
});
const policy = loadAccessSource("src/lib/whatsapp/connection-policy.ts");
const crypto = loadAccessSource("src/lib/whatsapp/connection-crypto.ts", {
  "./connection-policy": policy,
});
let client, db, connectionService, access, principal;
const originalFlag = process.env.WHATSAPP_MULTI_CONNECTION_TENANTS;
const originalKey = process.env.WHATSAPP_CONNECTION_ENCRYPTION_KEY;
const tenant = "connection-test-a";
const otherTenant = "connection-test-b";
const session = (operator = "seller-a", role = "agent") => ({
  tenantId: tenant,
  operator: { id: operator, role, name: operator },
  permissions: {
    views: { chat: true, settings: true },
    settings: { canManageWhatsapp: true },
    chat: { canCaptureChat: true, canViewAllChats: true, restrictToOwnChats: false },
  },
  accessGroup: { allowedChannels: ["whatsapp"] },
});

before(async () => {
  process.env.WHATSAPP_MULTI_CONNECTION_TENANTS = `${tenant},${otherTenant}`;
  process.env.WHATSAPP_CONNECTION_ENCRYPTION_KEY = "ab".repeat(32);
  client = new PGlite();
  db = drizzle(client, { schema });
  for (const table of [
    schema.tenants,
    schema.operators,
    schema.contacts,
    schema.conversations,
    schema.messages,
    schema.mediaFiles,
    schema.pendingInbounds,
    schema.channelConfigs,
  ]) {
    const config = pg.getTableConfig(table);
    const columns = config.columns
      .filter((c) => c.name !== "whatsapp_connection_id")
      .map((c) => {
        const type = c.getSQLType();
        const defaultValue = type.includes("timestamp")
          ? " DEFAULT now()"
          : type === "integer"
            ? " DEFAULT 0"
            : type === "boolean"
              ? " DEFAULT false"
              : type === "jsonb"
                ? " DEFAULT '{}'::jsonb"
                : "";
        return `"${c.name}" ${type}${c.name === "id" ? " PRIMARY KEY" : defaultValue}`;
      });
    await client.exec(`CREATE TABLE "${config.name}" (${columns.join(",")})`);
  }
  await client.exec(
    fs.readFileSync("src/db/migrations/0047_whatsapp_multi_connection.sql", "utf8"),
  );
  await db.insert(schema.tenants).values([
    { id: tenant, name: "Test A", slug: "test-a", connectionType: "meta" },
    { id: otherTenant, name: "Test B", slug: "test-b", connectionType: "baileys" },
  ]);
  await db
    .insert(schema.operators)
    .values(
      ["seller-a", "seller-b", "admin-a"]
        .map((id) => ({
          id,
          tenantId: tenant,
          name: id,
          email: `${id}@example.invalid`,
          passwordHash: "test",
          role: id.startsWith("admin") ? "admin" : "agent",
        }))
        .concat([
          {
            id: "seller-other",
            tenantId: otherTenant,
            name: "Other",
            email: "other@example.invalid",
            passwordHash: "test",
            role: "agent",
          },
        ]),
    );
  await db.insert(schema.contacts).values([
    {
      id: "customer",
      tenantId: tenant,
      name: "Maria",
      phone: "5511999990000",
      mainChannel: "whatsapp",
    },
    {
      id: "customer-other",
      tenantId: otherTenant,
      name: "Maria",
      phone: "5511999990000",
      mainChannel: "whatsapp",
    },
  ]);
  await db
    .insert(schema.channelConfigs)
    .values({
      id: "corporate-config",
      tenantId: tenant,
      activeProvider: "meta",
      connectionStatus: "connected",
    });
  await db
    .insert(schema.whatsappConnections)
    .values(
      Array.from({ length: 6 }, (_, i) => ({
        id: `number-${i + 1}`,
        tenantId: tenant,
        name: `Number ${i + 1}`,
        ownerOperatorId: i === 1 ? "seller-b" : "seller-a",
      })),
    );
  await db
    .insert(schema.whatsappConnections)
    .values({
      id: "number-other",
      tenantId: otherTenant,
      name: "Other number",
      ownerOperatorId: "seller-other",
    });
  await db.insert(schema.conversations).values([
    {
      id: "official",
      tenantId: tenant,
      contactId: "customer",
      operatorId: "seller-a",
      queueState: "meus",
    },
    {
      id: "personal-a",
      tenantId: tenant,
      contactId: "customer",
      operatorId: "seller-a",
      queueState: "meus",
      whatsappConnectionId: "number-1",
    },
    {
      id: "personal-b",
      tenantId: tenant,
      contactId: "customer",
      operatorId: "seller-b",
      queueState: "meus",
      whatsappConnectionId: "number-2",
    },
    {
      id: "foreign",
      tenantId: otherTenant,
      contactId: "customer-other",
      operatorId: "seller-other",
      queueState: "meus",
      whatsappConnectionId: "number-other",
    },
  ]);
  const overrides = { "../../db": { db }, "../../db/schema": schema, "drizzle-orm": orm };
  connectionService = loadAccessSource("src/lib/whatsapp/connections.ts", {
    ...overrides,
    "./connection-policy": policy,
    "./connection-crypto": crypto,
  });
  access = loadAccessSource("src/lib/access-control/conversation-access.ts", overrides);
  principal = session();
});
after(async () => {
  await client?.close();
  if (originalFlag === undefined) delete process.env.WHATSAPP_MULTI_CONNECTION_TENANTS;
  else process.env.WHATSAPP_MULTI_CONNECTION_TENANTS = originalFlag;
  if (originalKey === undefined) delete process.env.WHATSAPP_CONNECTION_ENCRYPTION_KEY;
  else process.env.WHATSAPP_CONNECTION_ENCRYPTION_KEY = originalKey;
});

test("one tenant supports six Baileys numbers plus its existing official Meta connection", async () => {
  const rows = await db
    .select()
    .from(schema.whatsappConnections)
    .where(orm.eq(schema.whatsappConnections.tenantId, tenant));
  assert.equal(rows.length, 6);
  assert.equal(
    (await connectionService.resolveConversationConnection(tenant, "official")).provider,
    "meta",
  );
  assert.equal(
    (await connectionService.resolveConversationConnection(tenant, "personal-a")).connectionId,
    "number-1",
  );
  await assert.rejects(
    connectionService.resolveConversationConnection(otherTenant, "personal-a"),
    /Conversa não encontrada/,
  );
});

test("one contact has independent corporate and personal threads; duplicate same-number thread is rejected", async () => {
  await assert.rejects(
    db
      .insert(schema.conversations)
      .values({
        id: "duplicate",
        tenantId: tenant,
        contactId: "customer",
        whatsappConnectionId: "number-1",
      }),
  );
  const rows = await db
    .select()
    .from(schema.contacts)
    .where(orm.eq(schema.contacts.tenantId, tenant));
  assert.equal(rows.length, 1);
});

test("database rejects foreign tenant connection, contact, owner and message connection", async () => {
  await assert.rejects(
    db
      .insert(schema.conversations)
      .values({
        id: "wrong-tenant",
        tenantId: otherTenant,
        contactId: "customer-other",
        whatsappConnectionId: "number-1",
      }),
  );
  await assert.rejects(
    db
      .insert(schema.conversations)
      .values({
        id: "wrong-contact",
        tenantId: tenant,
        contactId: "customer-other",
        whatsappConnectionId: "number-3",
      }),
  );
  await assert.rejects(
    db
      .insert(schema.whatsappConnections)
      .values({
        id: "wrong-owner",
        tenantId: tenant,
        name: "Wrong",
        ownerOperatorId: "seller-other",
      }),
  );
  await assert.rejects(
    db
      .insert(schema.messages)
      .values({
        id: "wrong-message",
        tenantId: tenant,
        conversationId: "personal-a",
        content: "wrong",
        senderType: "agent",
        whatsappConnectionId: "number-2",
      }),
  );
});

test("connection visibility is enforced in SQL and does not grant access through a shared contact", async () => {
  const visible = async (who) =>
    (
      await db
        .select({ id: schema.conversations.id })
        .from(schema.conversations)
        .where(access.conversationReadCondition(who))
    )
      .map((r) => r.id)
      .sort();
  assert.deepEqual(await visible(principal), ["official", "personal-a"]);
  assert.deepEqual(await visible(session("seller-b")), ["official", "personal-b"]);
  assert.deepEqual(await visible(session("admin-a", "admin")), [
    "official",
    "personal-a",
    "personal-b",
  ]);
  assert.equal((await access.requireConversationAccess(principal, "personal-b")).status, 404);
  assert.equal((await access.requireConversationAccess(principal, "foreign")).status, 404);
});

test("encrypted auth is bound to both tenant and connection and fails on tampering", () => {
  const secret = '{"creds":{"registered":true}}';
  const envelope = crypto.encryptConnectionAuth(tenant, "number-1", secret);
  assert.ok(!envelope.includes("registered"));
  assert.equal(crypto.decryptConnectionAuth(tenant, "number-1", envelope), secret);
  assert.throws(() => crypto.decryptConnectionAuth(otherTenant, "number-1", envelope));
  assert.throws(() => crypto.decryptConnectionAuth(tenant, "number-2", envelope));
  assert.throws(() =>
    crypto.decryptConnectionAuth(tenant, "number-1", envelope.slice(0, -5) + "AAAAA"),
  );
});

test("session leases exclude another process and old tokens cannot renew or overwrite credentials", async () => {
  const token = await connectionService.acquireConnectionLease(tenant, "number-4");
  await assert.rejects(
    connectionService.acquireConnectionLease(tenant, "number-4"),
    /outra instância/,
  );
  assert.equal(await connectionService.renewConnectionLease(tenant, "number-4", "stale"), false);
  await assert.rejects(
    connectionService.updateBaileysConfig(
      tenant,
      "number-4",
      { baileysSessionStatus: "connected" },
      "stale",
    ),
  );
  assert.equal(await connectionService.renewConnectionLease(tenant, "number-4", token), true);
  await connectionService.releaseConnectionLease(tenant, "number-4", token);
  const next = await connectionService.acquireConnectionLease(tenant, "number-4");
  assert.notEqual(next, token);
  await connectionService.releaseConnectionLease(tenant, "number-4", next);
});

test("a verified number cannot be replaced by another phone when reconnecting", async () => {
  const token = await connectionService.acquireConnectionLease(tenant, "number-5");
  await connectionService.updateBaileysConfig(
    tenant,
    "number-5",
    { baileysPairedPhone: "5511988880000" },
    token,
  );
  await connectionService.updateBaileysConfig(
    tenant,
    "number-5",
    { baileysPairedPhone: null, baileysAuthKeys: null },
    token,
  );
  await assert.rejects(
    connectionService.updateBaileysConfig(
      tenant,
      "number-5",
      { baileysPairedPhone: "5511977770000" },
      token,
    ),
    /outro número/,
  );
  await connectionService.releaseConnectionLease(tenant, "number-5", token);
});

test("deduplication separates numbers, peers and directions while preserving legacy event IDs", () => {
  const key = { id: "same-stanza", remoteJid: "5511999990000@s.whatsapp.net", fromMe: false };
  const values = [
    policy.baileysEventId(tenant, "number-1", key),
    policy.baileysEventId(tenant, "number-2", key),
    policy.baileysEventId(otherTenant, "number-1", key),
    policy.baileysEventId(tenant, "number-1", { ...key, fromMe: true }),
    policy.baileysEventId(tenant, "number-1", { ...key, remoteJid: "other@lid" }),
  ];
  assert.equal(new Set(values).size, values.length);
  assert.equal(policy.baileysEventId(tenant, null, key), `baileys:${tenant}:same-stanza`);
  assert.equal(policy.baileysStanzaId(values[0]), "same-stanza");
});

test("selected capture excludes unknown peers until a commercial contact is selected", async () => {
  const peers = loadAccessSource("src/lib/whatsapp/connection-contacts.ts", {
    "../../db": { db },
    "../../db/schema": schema,
    "drizzle-orm": orm,
    "../utils": { buildPhoneSearchTerms: (phone) => [phone] },
  });
  await peers.bindConnectionIdentity(
    db,
    tenant,
    "number-1",
    "customer",
    "customer@lid",
    "Maria pessoal",
  );
  assert.equal(await peers.captureConnectionPeer(tenant, "number-1", "customer@lid"), false);
  await db
    .insert(schema.whatsappConnectionContacts)
    .values({ id: "selection", tenantId: tenant, connectionId: "number-1", contactId: "customer" });
  assert.equal(await peers.captureConnectionPeer(tenant, "number-1", "customer@lid"), true);
  assert.equal(await peers.captureConnectionPeer(tenant, "number-1", "private@lid"), false);
  const [contact] = await db
    .select()
    .from(schema.contacts)
    .where(orm.eq(schema.contacts.id, "customer"));
  assert.equal(contact.name, "Maria");
  assert.equal(contact.whatsappJid, null);
});

test("outbound dispatch preserves its selected connection if the corporate provider changes", async () => {
  const sent = [];
  const dispatch = loadAccessSource("src/lib/whatsapp/dispatch.ts", {
    "../../db": { db },
    "../../db/schema": schema,
    "drizzle-orm": orm,
    "./connections": connectionService,
    "./connection-policy": policy,
    "./adapters/meta": {
      metaAdapter: {
        send: async () => {
          throw Error("Personal message reached Meta");
        },
      },
    },
    "./adapters/baileys": {
      baileysAdapter: {
        send: async (tid, payload) => {
          sent.push({ tid, ...payload });
          return { externalId: "wire-out", status: "accepted" };
        },
      },
    },
    "./envelope": loadAccessSource("src/lib/whatsapp/envelope.ts"),
    "./meta-status": { replayPendingMetaStatuses: async () => {} },
    "./meta-presence": { resetMetaTypingThrottle: () => {} },
    "../commercial/tma": { recordCommercialFirstResponse: async () => {} },
    "../baileys/session-manager": {
      SessionManager: { getInstance: () => ({ notifyPublic() {} }) },
    },
  });
  await db
    .insert(schema.messages)
    .values({
      id: "queued-personal",
      tenantId: tenant,
      conversationId: "personal-a",
      whatsappConnectionId: "number-1",
      content: "Proposta",
      senderType: "agent",
      direction: "outbound",
      provider: "baileys",
      status: "pending",
      sentAt: new Date(),
      metaDetails: {
        version: 1,
        text: "Proposta",
        operatorId: "seller-a",
        whatsappConnectionId: "number-1",
      },
    });
  const result = await dispatch.dispatchStored(tenant, "queued-personal");
  assert.equal(result.status, "accepted");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].whatsappConnectionId, "number-1");
  assert.equal(sent[0].recipientPhone, "5511999990000");
  assert.equal(await dispatch.dispatchStored(tenant, "queued-personal"), null);
  assert.equal(sent.length, 1);
  await db
    .insert(schema.messages)
    .values({
      id: "queued-changed-destination",
      tenantId: tenant,
      conversationId: "personal-a",
      whatsappConnectionId: "number-1",
      content: "Must not redirect",
      senderType: "agent",
      direction: "outbound",
      provider: "baileys",
      status: "pending",
      sentAt: new Date(),
      metaDetails: {
        version: 1,
        text: "Must not redirect",
        operatorId: "seller-a",
        recipientPhone: "5521888880000",
      },
    });
  assert.equal(
    (await dispatch.dispatchStored(tenant, "queued-changed-destination")).status,
    "failed",
  );
  assert.equal(sent.length, 1);
});

test("connection API scopes the QR, hides secrets and permits only admin creation", async () => {
  let who = principal;
  const managers = {
    forConnection: (_t, id) => ({ getStatus: () => "qr_ready", getQr: () => `qr:${id}` }),
    getInstance: () => ({ notifyPublic() {} }),
  };
  const route = loadAccessSource("src/routes/api/whatsapp/connections.ts", {
    "@tanstack/react-router": routeStub,
    "drizzle-orm": orm,
    "../../../db": { db },
    "../../../db/schema": schema,
    "../../../lib/auth-session": { requireSession: async () => ({ session: who }) },
    "../../../lib/baileys/session-manager": { SessionManager: managers },
    "../../../lib/whatsapp/connection-crypto": crypto,
    "../../../lib/whatsapp/connection-policy": policy,
    "../../../lib/whatsapp/connections": connectionService,
    "../../../lib/crm/deal-associations": {
      lockContactDeals: async () => {},
      syncConversationDeals: async () => true,
    },
    "../../../lib/access-control/conversation-access": access,
  }).Route.server.handlers;
  const listing = await (await route.GET({ request: apiRequest(undefined, "GET") })).json();
  assert.ok(listing.connections.some((c) => c.id === "number-1"));
  assert.ok(!listing.connections.some((c) => c.id === "number-2"));
  assert.ok(!JSON.stringify(listing).includes("authEncrypted"));
  assert.equal(
    (
      await route.GET({
        request: apiRequest(undefined, "GET", "http://test.local/api?id=number-2"),
      })
    ).status,
    404,
  );
  const qr = await (
    await route.GET({
      request: apiRequest(undefined, "GET", "http://test.local/api?id=number-1&tenantId=ignored"),
    })
  ).json();
  assert.equal(qr.qr, null);
  const token = await connectionService.acquireConnectionLease(tenant, "number-1");
  await connectionService.storeConnectionQr(tenant, "number-1", token, "qr:number-1");
  const liveQr = await (
    await route.GET({ request: apiRequest(undefined, "GET", "http://test.local/api?id=number-1") })
  ).json();
  assert.equal(liveQr.qr, "qr:number-1");
  await connectionService.releaseConnectionLease(tenant, "number-1", token);
  assert.equal(
    (
      await route.POST({
        request: apiRequest({
          action: "create",
          name: "No",
          ownerOperatorId: "seller-a",
          capturePolicy: "all",
        }),
      })
    ).status,
    403,
  );
  who = session("admin-a", "admin");
  assert.equal(
    (
      await route.POST({
        request: apiRequest({
          action: "create",
          tenantId: otherTenant,
          name: "Other",
          ownerOperatorId: "seller-other",
          capturePolicy: "all",
        }),
      })
    ).status,
    404,
  );
  const started = await route.POST({
    request: apiRequest({
      action: "start",
      connectionId: "number-3",
      contactId: "customer",
      tenantId: otherTenant,
    }),
  });
  assert.equal(started.status, 200);
  const { conversationId } = await started.json();
  const [created] = await db
    .select()
    .from(schema.conversations)
    .where(orm.eq(schema.conversations.id, conversationId));
  assert.equal(created.tenantId, tenant);
  assert.equal(created.whatsappConnectionId, "number-3");
  assert.equal(created.contactId, "customer");
});

test("unified history is chronological, labelled and excludes another seller and tenant", async () => {
  let who = principal;
  const route = loadAccessSource("src/routes/api/whatsapp/contact-history.ts", {
    "@tanstack/react-router": routeStub,
    "drizzle-orm": orm,
    "../../../db": { db },
    "../../../db/schema": schema,
    "../../../lib/auth-session": { requireSession: async () => ({ session: who }) },
    "../../../lib/access-control/conversation-access": access,
    "../../../lib/whatsapp/connection-policy": policy,
    "../../../lib/whatsapp/meta-reactions": { readReactions: () => [] },
  }).Route.server.handlers;
  for (const [i, id] of ["official", "personal-a", "personal-b", "foreign"].entries())
    await db
      .insert(schema.messages)
      .values({
        id: `history-${i}`,
        tenantId: id === "foreign" ? otherTenant : tenant,
        conversationId: id,
        content: id,
        senderType: "client",
        provider: id === "official" ? "meta" : "baileys",
        sentAt: new Date(`2026-10-26T10:0${i}:00Z`),
      });
  const read = () =>
    route.GET({
      request: apiRequest(undefined, "GET", "http://test.local/api?conversationId=official"),
    });
  const history = await (await read()).json();
  assert.ok(history.messages.some((m) => m.conversationId === "official"));
  assert.ok(
    history.messages.some(
      (m) => m.conversationId === "personal-a" && m.connectionName === "Number 1",
    ),
  );
  assert.ok(!history.messages.some((m) => ["personal-b", "foreign"].includes(m.conversationId)));
  assert.deepEqual(
    history.messages.map((m) => m.sentAtISO),
    history.messages.map((m) => m.sentAtISO).sort(),
  );
  who = session("admin-a", "admin");
  const adminHistory = await (await read()).json();
  assert.ok(adminHistory.messages.some((m) => m.conversationId === "personal-b"));
  assert.ok(!adminHistory.messages.some((m) => m.conversationId === "foreign"));
});

function isolatedModule(file, overrides) {
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const imports = Object.fromEntries(
    source.statements.filter(ts.isImportDeclaration).map((item) => [item.moduleSpecifier.text, {}]),
  );
  return loadAccessSource(file, { ...imports, ...overrides });
}

test("different tenants/numbers have separate sockets and QR listeners; replayed phone echoes are deduplicated", async () => {
  const singletons = new Map();
  const peers = loadAccessSource("src/lib/whatsapp/connection-contacts.ts", {
    "../../db": { db },
    "../../db/schema": schema,
    "drizzle-orm": orm,
    "../utils": { buildPhoneSearchTerms: (phone) => [phone] },
  });
  const { SessionManager } = isolatedModule("src/lib/baileys/session-manager.ts", {
    "node:crypto": await import("node:crypto"),
    "../../db": { db },
    "../../db/schema": schema,
    "drizzle-orm": orm,
    "node:async_hooks": await import("node:async_hooks"),
    "../runtime-singleton": {
      runtimeSingleton: (key, create) => {
        if (!singletons.has(key)) singletons.set(key, create());
        return singletons.get(key);
      },
    },
    "../whatsapp/connections": connectionService,
    "../whatsapp/connection-policy": policy,
    "../whatsapp/connection-contacts": peers,
    "./jid-validator": loadAccessSource("src/lib/baileys/jid-validator.ts"),
    "@whiskeysockets/baileys": {
      proto: {
        WebMessageInfo: { fromObject: (value) => ({ ...value }), toObject: (value) => value },
      },
    },
  });
  const a = SessionManager.forConnection(tenant, "number-1");
  const b = SessionManager.forConnection(tenant, "number-2");
  assert.equal(a, SessionManager.forConnection(tenant, "number-1"));
  assert.notEqual(a, b);
  assert.notEqual(a, SessionManager.forConnection(otherTenant, "number-1"));
  const socket = { signalRepository: { lidMapping: { getPNForLID: async () => undefined } } };
  a.sessions.set(tenant, socket);
  assert.equal(a.getSession(tenant), socket);
  assert.equal(b.getSession(tenant), undefined);
  const receivedA = [],
    receivedB = [];
  a.registerListener(tenant, (event) => receivedA.push(event), false);
  b.registerListener(tenant, (event) => receivedB.push(event), false);
  a.notifyPublic(tenant, { type: "qr", qr: "only-a" });
  assert.equal(receivedA[0].qr, "only-a");
  assert.equal(receivedB.length, 0);

  const token = await connectionService.acquireConnectionLease(tenant, "number-1");
  a.leaseToken = token;
  const count = async () =>
    (await client.query("SELECT count(*)::int AS n FROM pending_inbounds")).rows[0].n;
  const previous = await count();
  await a.captureInbound(tenant, {
    key: { id: "private-message", remoteJid: "private@lid" },
    message: { conversation: "must not be stored" },
  });
  assert.equal(await count(), previous);
  await connectionService.releaseConnectionLease(tenant, "number-1", token);
  a.leaseToken = null;

  const key = { id: "same-native-id", remoteJid: "customer@lid", fromMe: true };
  const externalA = policy.baileysEventId(tenant, "number-1", key);
  await db
    .insert(schema.messages)
    .values({
      id: "echo-original",
      tenantId: tenant,
      conversationId: "personal-a",
      whatsappConnectionId: "number-1",
      content: "Sent once",
      direction: "outbound",
      senderType: "agent",
      externalId: externalA,
    });
  await db.insert(schema.pendingInbounds).values([
    {
      id: "echo-inbound-a",
      tenantId: tenant,
      whatsappConnectionId: "number-1",
      provider: "baileys",
      externalEventId: externalA,
      status: "pending",
      payload: {},
    },
    {
      id: "echo-inbound-b",
      tenantId: tenant,
      whatsappConnectionId: "number-2",
      provider: "baileys",
      externalEventId: policy.baileysEventId(tenant, "number-2", key),
      status: "pending",
      payload: {},
    },
  ]);
  let calls = 0;
  a.handleIncomingMessage = b.handleIncomingMessage = async () => {
    calls++;
  };
  await a.recoverInbound(tenant, { key });
  assert.equal(calls, 0);
  await b.recoverInbound(tenant, { key });
  assert.equal(calls, 1);
  await b.recoverInbound(tenant, { key });
  assert.equal(calls, 1);
});

test("the real Baileys adapter selects the personal socket and rejects quotes from another number", async () => {
  const sends = [];
  const { baileysAdapter } = isolatedModule("src/lib/whatsapp/adapters/baileys.ts", {
    "../../../db": { db },
    "../../../db/schema": schema,
    "drizzle-orm": orm,
    "../connections": connectionService,
    "../connection-policy": policy,
    "../connection-contacts": { connectionPeerJid: async (_t, id) => `${id}@lid` },
    "../../baileys/session-manager": {
      SessionManager: {
        forConnection: (_t, id) => ({
          ensureConnectionOwnership: async () => true,
          getStatus: () => (id === "number-1" ? "connected" : "disconnected"),
          getSession: () => ({
            sendMessage: async (jid, message, options) => {
              sends.push({ id, jid, message, options });
              return { key: { id: "wire-response" } };
            },
          }),
        }),
      },
    },
  });
  const payload = {
    tenantId: tenant,
    conversationId: "personal-a",
    recipientPhone: "5511999990000",
    text: "Proposta",
  };
  const sent = await baileysAdapter.send(tenant, payload);
  assert.equal(sent.status, "accepted");
  assert.equal(sends[0].id, "number-1");
  assert.equal(sends[0].jid, "number-1@lid");
  assert.equal(policy.baileysStanzaId(sent.externalId), "wire-response");
  const quote = await baileysAdapter.send(tenant, { ...payload, quotedMessageId: "history-2" });
  assert.equal(quote.status, "failed");
  const offline = await baileysAdapter.send(tenant, { ...payload, conversationId: "personal-b" });
  assert.equal(offline.retryable, true);
  const official = await baileysAdapter.send(tenant, { ...payload, conversationId: "official" });
  assert.equal(official.status, "failed");
  assert.equal(sends.length, 1);
});

test("auth keys persist encrypted per connection and revoked sessions cannot save late credentials", async (context) => {
  const token = await connectionService.acquireConnectionLease(tenant, "number-6");
  const { useDrizzleAuthState } = loadAccessSource("src/lib/baileys/drizzle-auth.ts", {
    "@whiskeysockets/baileys": { initAuthCreds: () => ({ registered: false }), BufferJSON: {} },
    "../../db": { db },
    "../../db/schema": schema,
    "drizzle-orm": orm,
    "../whatsapp/connections": connectionService,
    "../whatsapp/connection-crypto": crypto,
  });
  const auth = await useDrizzleAuthState(tenant, "number-6", token);
  auth.state.creds.registered = true;
  await auth.state.keys.set({ session: { peer: "test-key-value" } });
  await auth.saveCreds();
  const read = async () =>
    (
      await db
        .select()
        .from(schema.whatsappConnections)
        .where(orm.eq(schema.whatsappConnections.id, "number-6"))
    )[0].authEncrypted;
  const first = await read();
  assert.ok(first && !first.includes("test-key-value"));
  const reopened = await useDrizzleAuthState(tenant, "number-6", token);
  assert.equal(reopened.state.creds.registered, true);
  assert.deepEqual(await reopened.state.keys.get("session", ["peer"]), { peer: "test-key-value" });
  await connectionService.releaseConnectionLease(tenant, "number-6", token);
  const log = context.mock.method(console, "error", () => {});
  auth.state.creds.registered = false;
  await auth.saveCreds();
  log.mock.restore();
  assert.equal(await read(), first);
});

test("sending a saved attachment requires visibility of its original number's conversation", async () => {
  await db
    .insert(schema.mediaFiles)
    .values({
      id: "private-attachment",
      tenantId: tenant,
      conversationId: "personal-b",
      mimeType: "image/png",
      base64Data: "test-only",
    });
  let sends = 0;
  const route = isolatedModule("src/routes/api/whatsapp/send.ts", {
    "@tanstack/react-router": routeStub,
    "drizzle-orm": orm,
    "../../../db": { db },
    "../../../db/schema": schema,
    "../../../lib/auth-session": { requireSession: async () => ({ session: principal }) },
    "../../../lib/whatsapp/connections": connectionService,
    "../../../lib/access-control/conversation-access": access,
    "../../../lib/crm/deal-associations": { syncConversationDeals: async () => true },
    "../../../lib/whatsapp/outbound": {
      outboundQueue: {
        enqueueAndSend: async () => {
          sends++;
          throw Error("Must not send hidden media");
        },
      },
    },
  }).Route.server.handlers;
  const response = await route.POST({
    request: apiRequest({
      conversationId: "personal-a",
      text: "attempt",
      mediaType: "image",
      mediaUrl: "/api/baileys/media?messageId=private-attachment",
    }),
  });
  assert.equal(response.status, 404);
  assert.equal(sends, 0);
});
