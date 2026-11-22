import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as orm from "drizzle-orm";
import * as pg from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import { PGlite } from "@electric-sql/pglite";
import ts from "typescript";
import { loadAccessSource } from "./helpers/access-harness.mjs";

const schema = loadAccessSource("src/db/schema.ts", {
  "drizzle-orm": orm,
  "drizzle-orm/pg-core": pg,
});
const policy = loadAccessSource("src/lib/whatsapp/connection-policy.ts");
const crypto = loadAccessSource("src/lib/whatsapp/connection-crypto.ts", {
  "./connection-policy": policy,
});

let client;
let db;
let connectionService;
const tenant = "lease-shutdown-tenant";
const originalFlag = process.env.WHATSAPP_MULTI_CONNECTION_TENANTS;
const originalKey = process.env.WHATSAPP_CONNECTION_ENCRYPTION_KEY;

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

before(async () => {
  process.env.WHATSAPP_MULTI_CONNECTION_TENANTS = tenant;
  process.env.WHATSAPP_CONNECTION_ENCRYPTION_KEY = "cd".repeat(32);
  client = new PGlite();
  db = drizzle(client, { schema });

  for (const table of [
    schema.tenants,
    schema.accessGroups,
    schema.operators,
    schema.contacts,
    schema.conversations,
    schema.messages,
    schema.mediaFiles,
    schema.pendingInbounds,
    schema.channelConfigs,
    schema.crmActionHistory,
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
  await client.exec(
    fs.readFileSync("src/db/migrations/0048_whatsapp_connection_group_access.sql", "utf8"),
  );

  await db.insert(schema.tenants).values({
    id: tenant,
    name: "Lease Shutdown Test",
    slug: "lease-shutdown-test",
    connectionType: "meta",
  });
  await db.insert(schema.operators).values({
    id: "op-1",
    tenantId: tenant,
    name: "Operador 1",
    email: "op1@example.invalid",
    passwordHash: "test",
    role: "agent",
  });
  await db.insert(schema.whatsappConnections).values([
    {
      id: "conn-1",
      tenantId: tenant,
      name: "Celular 1",
      ownerOperatorId: "op-1",
      baileysSessionStatus: "connected",
      authEncrypted: crypto.encryptConnectionAuth(tenant, "conn-1", '{"creds":{"registered":true}}'),
    },
    {
      id: "conn-2",
      tenantId: tenant,
      name: "Celular 2",
      ownerOperatorId: "op-1",
      baileysSessionStatus: "connected",
      authEncrypted: crypto.encryptConnectionAuth(tenant, "conn-2", '{"creds":{"registered":true}}'),
    },
  ]);

  connectionService = loadAccessSource("src/lib/whatsapp/connections.ts", {
    "../../db": { db },
    "../../db/schema": schema,
    "drizzle-orm": orm,
    "./connection-policy": policy,
    "./connection-crypto": crypto,
  });
});

after(async () => {
  await client?.close();
  if (originalFlag === undefined) delete process.env.WHATSAPP_MULTI_CONNECTION_TENANTS;
  else process.env.WHATSAPP_MULTI_CONNECTION_TENANTS = originalFlag;
  if (originalKey === undefined) delete process.env.WHATSAPP_CONNECTION_ENCRYPTION_KEY;
  else process.env.WHATSAPP_CONNECTION_ENCRYPTION_KEY = originalKey;
});

async function loadSessionManager() {
  const singletons = new Map();
  const { SessionManager } = isolatedModule("src/lib/baileys/session-manager.ts", {
    "node:crypto": await import("node:crypto"),
    "node:async_hooks": await import("node:async_hooks"),
    "../../db": { db },
    "../../db/schema": schema,
    "drizzle-orm": orm,
    "../runtime-singleton": {
      runtimeSingleton: (key, create) => {
        if (!singletons.has(key)) singletons.set(key, create());
        return singletons.get(key);
      },
      getRuntimeSingleton: (key) => singletons.get(key),
    },
    "../whatsapp/connections": connectionService,
    "../whatsapp/connection-policy": policy,
    "./jid-validator": loadAccessSource("src/lib/baileys/jid-validator.ts"),
    "@whiskeysockets/baileys": {
      proto: {
        WebMessageInfo: { fromObject: (value) => ({ ...value }), toObject: (value) => value },
      },
    },
  });
  return SessionManager;
}

test("pauseSession on ownership-loss or without leaseToken skips DB write, logs zero errors and preserves active owner state", async () => {
  const SessionManager = await loadSessionManager();
  const ownerToken = await connectionService.acquireConnectionLease(tenant, "conn-1");
  await db
    .update(schema.whatsappConnections)
    .set({ baileysSessionStatus: "connected" })
    .where(orm.eq(schema.whatsappConnections.id, "conn-1"));

  const [beforeRow] = await db
    .select()
    .from(schema.whatsappConnections)
    .where(orm.eq(schema.whatsappConnections.id, "conn-1"));

  const challenger = SessionManager.forConnection(tenant, "conn-1");
  const errors = [];
  const origError = console.error;
  console.error = (...args) => errors.push(args.join(" "));
  try {
    await challenger.pauseSession(tenant, "ownership-loss");
    await challenger.pauseSession(tenant, "manual");
  } finally {
    console.error = origError;
  }

  assert.equal(errors.length, 0, `Não deveria logar erro, mas logou: ${errors.join(" | ")}`);

  const [afterRow] = await db
    .select()
    .from(schema.whatsappConnections)
    .where(orm.eq(schema.whatsappConnections.id, "conn-1"));
  assert.equal(afterRow.baileysSessionStatus, "connected");
  assert.equal(afterRow.leaseToken, ownerToken);
  assert.equal(afterRow.authEncrypted, beforeRow.authEncrypted);

  await connectionService.releaseConnectionLease(tenant, "conn-1", ownerToken);
});

test("shutdownIfInitialized releases all leases immediately (with or without open socket) while preserving authEncrypted (no QR re-scan)", async () => {
  const SessionManager = await loadSessionManager();

  const [orig1] = await db
    .select({ authEncrypted: schema.whatsappConnections.authEncrypted })
    .from(schema.whatsappConnections)
    .where(orm.eq(schema.whatsappConnections.id, "conn-1"));
  const [orig2] = await db
    .select({ authEncrypted: schema.whatsappConnections.authEncrypted })
    .from(schema.whatsappConnections)
    .where(orm.eq(schema.whatsappConnections.id, "conn-2"));

  // conn-1: has an active socket + lease
  const mgr1 = SessionManager.forConnection(tenant, "conn-1");
  const token1 = await connectionService.acquireConnectionLease(tenant, "conn-1");
  mgr1.leaseToken = token1;
  mgr1.leaseTenantId = tenant;
  let ended = 0;
  let loggedOut = 0;
  mgr1.sessions.set(tenant, {
    end: () => {
      ended++;
    },
    logout: async () => {
      loggedOut++;
    },
  });

  // conn-2: acquired lease mid-handshake (no socket in sessions yet)
  const mgr2 = SessionManager.forConnection(tenant, "conn-2");
  const token2 = await connectionService.acquireConnectionLease(tenant, "conn-2");
  mgr2.leaseToken = token2;
  mgr2.leaseTenantId = tenant;

  await SessionManager.shutdownIfInitialized();

  assert.equal(ended, 1, "Socket ativo deve ser encerrado com sock.end()");
  assert.equal(loggedOut, 0, "shutdown() NUNCA deve chamar sock.logout()");

  const rows = await db
    .select()
    .from(schema.whatsappConnections)
    .where(orm.eq(schema.whatsappConnections.tenantId, tenant));
  const row1 = rows.find((r) => r.id === "conn-1");
  const row2 = rows.find((r) => r.id === "conn-2");

  // Leases released immediately -> new container can acquire instantly without waiting 90s
  assert.equal(row1.leaseToken, null);
  assert.equal(row1.leaseUntil, null);
  assert.equal(row2.leaseToken, null);
  assert.equal(row2.leaseUntil, null);

  // Encrypted credentials 100% preserved -> zero QR re-scan
  assert.equal(row1.authEncrypted, orig1.authEncrypted);
  assert.equal(row2.authEncrypted, orig2.authEncrypted);

  const nextToken1 = await connectionService.acquireConnectionLease(tenant, "conn-1");
  const nextToken2 = await connectionService.acquireConnectionLease(tenant, "conn-2");
  assert.ok(nextToken1 && nextToken1 !== token1);
  assert.ok(nextToken2 && nextToken2 !== token2);
  await connectionService.releaseConnectionLease(tenant, "conn-1", nextToken1);
  await connectionService.releaseConnectionLease(tenant, "conn-2", nextToken2);
});

test("railway.json execs node as PID 1, Nitro close hook calls shutdownIfInitialized, and explicit logout log only appears on loggedOut", () => {
  const railwayConfig = JSON.parse(fs.readFileSync("railway.json", "utf8"));
  assert.match(
    railwayConfig.deploy.startCommand,
    /exec\s+node\s+\.output\/server\/index\.mjs/,
    "startCommand deve usar exec node para entregar SIGTERM ao processo Node",
  );

  const recoveryPluginSrc = fs.readFileSync("server/plugins/recovery.ts", "utf8");
  assert.match(
    recoveryPluginSrc,
    /SessionManager\.shutdownIfInitialized\(\)/,
    "Nitro close hook deve aguardar SessionManager.shutdownIfInitialized()",
  );

  const sessionManagerSrc = fs.readFileSync("src/lib/baileys/session-manager.ts", "utf8");
  const explicitLogoutMatches = sessionManagerSrc.match(/Logout explícito detectado/g) ?? [];
  assert.equal(
    explicitLogoutMatches.length,
    1,
    "A mensagem 'Logout explícito detectado' deve existir apenas no tratamento real de DisconnectReason.loggedOut",
  );
});
