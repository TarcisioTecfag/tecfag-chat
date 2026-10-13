import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { decryptRdSecret } from "../src/lib/rd-marketing/api-crypto";

async function rejected(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Esperava uma rejeicao.");
}

const testUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!testUrl)("RD Marketing OAuth: banco local descartável", () => {
  let database: typeof import("../src/db");
  let schema: typeof import("../src/db/schema");
  let service: typeof import("../src/lib/rd-marketing/api-service");
  let auth: typeof import("../src/lib/auth-session");
  let handlers: Record<string, (context: { request: Request }) => Promise<Response>>;
  let callback: (context: { request: Request }) => Promise<Response>;
  let adminCookie: string, agentCookie: string;
  let session: Awaited<ReturnType<typeof auth.getAuthSession>>;
  const tenantId = `oauth-test-${randomUUID()}`,
    otherTenantId = `oauth-other-${randomUUID()}`;
  const base = "http://localhost/api/settings/rd-marketing/connection";
  const uuid = randomUUID();
  const calls: {
    url: string;
    method: string;
    authorization?: string;
    body?: Record<string, unknown>;
  }[] = [];
  let failToken = false,
    rejectAccess = false,
    tokenCounter = 0;
  const provider = (async (input: unknown, init: RequestInit) => {
    const url = String(input),
      method = init.method || "GET";
    calls.push({
      url,
      method,
      authorization: (init.headers as Record<string, string>)?.Authorization,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    });
    if (url.includes("/auth/token")) {
      if (failToken) return Response.json({ secret: "must-never-leak" }, { status: 401 });
      tokenCounter++;
      return Response.json({
        access_token: `access-${tokenCounter}`,
        refresh_token: `refresh-${tokenCounter}`,
        expires_in: 3600,
      });
    }
    if (
      rejectAccess &&
      (init.headers as Record<string, string>).Authorization === "Bearer rejected"
    )
      return new Response(null, { status: 401 });
    if (url.includes("/events"))
      return Response.json(
        url.includes("CONVERSION")
          ? {
              events: Array(10).fill({
                created_at: "2026-10-13T13:32:00-03:00",
                payload: {
                  conversion_identifier: "formulario",
                  conversion_origin: { source: "google", campaign: "teste" },
                },
              }),
            }
          : [],
      );
    return Response.json({ uuid, name: "Cliente de teste", email: "lead@example.com" });
  }) as typeof fetch;
  const invoke = (
    method: string,
    body?: unknown,
    cookie = adminCookie,
    origin = "http://localhost",
  ) =>
    handlers[method]({
      request: new Request(base + "?tenantId=" + otherTenantId, {
        method,
        headers: {
          ...(cookie ? { Cookie: cookie } : {}),
          "Content-Type": "application/json",
          Origin: origin,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
    });
  const nonce = async () =>
    new URL(await service.beginRdAuthorization(session!, base)).searchParams.get("state")!;
  const connect = async () =>
    service.finishRdAuthorization(session!, base, await nonce(), "auth-code", provider);

  beforeAll(async () => {
    if (
      !testUrl ||
      !/test/i.test(new URL(testUrl).pathname) ||
      !["localhost", "127.0.0.1"].includes(new URL(testUrl).hostname)
    )
      throw new Error("Use banco descartável local de teste.");
    process.env.NODE_ENV = "test";
    process.env.RD_MARKETING_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    database = await import("../src/db");
    await database.assertTestDatabaseIsolation();
    if ((await database.client`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`).length)
      throw new Error("Banco deve estar vazio.");
    schema = await import("../src/db/schema");
    const { generateDrizzleJson, generateMigration } = await import("drizzle-kit/api");
    for (const statement of await generateMigration(
      generateDrizzleJson({}),
      generateDrizzleJson(schema),
    ))
      await database.client.unsafe(statement);
    const migration = await readFile(
      new URL("../src/db/migrations/0037_rd_marketing_oauth.sql", import.meta.url),
      "utf8",
    );
    await database.client.unsafe(migration);
    await database.client.unsafe(migration);
    await database.db.insert(schema.tenants).values([
      { id: tenantId, name: "OAuth teste", slug: tenantId, connectionType: "meta" },
      { id: otherTenantId, name: "Outro teste", slug: otherTenantId, connectionType: "meta" },
    ]);
    for (const role of ["admin", "agent"])
      await database.db.insert(schema.operators).values({
        id: `${tenantId}-${role}`,
        tenantId,
        name: role,
        email: `${role}@example.com`,
        passwordHash: "test",
        role,
      });
    auth = await import("../src/lib/auth-session");
    adminCookie = `session_token=${(await auth.createSession(tenantId, `${tenantId}-admin`)).token}`;
    agentCookie = `session_token=${(await auth.createSession(tenantId, `${tenantId}-agent`)).token}`;
    session = await auth.getAuthSession(new Request(base, { headers: { Cookie: adminCookie } }));
    service = await import("../src/lib/rd-marketing/api-service");
    handlers = (await import("../src/routes/api/settings/rd-marketing/connection")).Route.options
      .server!.handlers as unknown as typeof handlers;
    callback = (await import("../src/routes/api/settings/rd-marketing/callback")).Route.options
      .server!.handlers!.GET as typeof callback;
  }, 60000);
  afterAll(async () => {
    if (database) await database.client.end();
  });

  test("rotas exigem admin, sessão e origem; tenant vem somente da sessão", async () => {
    expect((await invoke("GET", undefined, "")).status).toBe(401);
    expect((await invoke("GET", undefined, agentCookie)).status).toBe(403);
    expect(
      (
        await invoke(
          "POST",
          { action: "save", clientId: "app", clientSecret: "secret" },
          adminCookie,
          "https://attacker.example",
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await invoke("POST", {
          action: "save",
          tenantId: otherTenantId,
          clientId: "app",
          clientSecret: "secret",
        })
      ).status,
    ).toBe(200);
    const rows = await database.db
      .select()
      .from(schema.rdMarketingConnections)
      .where(eq(schema.rdMarketingConnections.tenantId, tenantId));
    expect(rows).toHaveLength(1);
    expect(rows[0].clientSecretEncrypted).not.toContain("secret");
    expect(
      await database.db
        .select()
        .from(schema.rdMarketingConnections)
        .where(eq(schema.rdMarketingConnections.tenantId, otherTenantId)),
    ).toHaveLength(0);
    const status = await (await invoke("GET")).json();
    expect(status.callbackUrl).toBe("http://localhost/api/settings/rd-marketing/callback");
    expect(status.clientSecret).toBeUndefined();
    expect(status.connected).toBe(false);
    expect(
      (
        await callback({
          request: new Request(
            "http://localhost/api/settings/rd-marketing/callback?code=x&state=x",
          ),
        })
      ).status,
    ).toBe(401);
  });
  test("OAuth valida sessão, tenant, expiração e consumo único", async () => {
    const state = await nonce();
    const pending = await database.db
      .select()
      .from(schema.rdMarketingOAuthStates)
      .where(eq(schema.rdMarketingOAuthStates.tenantId, tenantId));
    expect(pending[0].stateHash).not.toBe(state);

    expect(
      await rejected(
        service.finishRdAuthorization(
          { ...session!, tokenHash: "another-session" },
          base,
          state,
          "code",
          provider,
        ),
      ),
    ).toMatchObject({ code: "RD_STATE_INVALID" });

    expect(
      await rejected(
        service.finishRdAuthorization(
          { ...session!, tenantId: otherTenantId },
          base,
          state,
          "code",
          provider,
        ),
      ),
    ).toMatchObject({ code: "RD_STATE_INVALID" });

    await service.finishRdAuthorization(session!, base, state, "auth-code", provider);

    expect(calls.at(-1)?.body).toEqual({
      client_id: "app",
      client_secret: "secret",
      code: "auth-code",
    });
    expect(
      await rejected(service.finishRdAuthorization(session!, base, state, "auth-code", provider)),
    ).toMatchObject({ code: "RD_STATE_INVALID" });

    const expired = await nonce();
    await database.db
      .update(schema.rdMarketingOAuthStates)
      .set({ expiresAt: new Date(0) })
      .where(eq(schema.rdMarketingOAuthStates.tenantId, tenantId));
    expect(
      await rejected(service.finishRdAuthorization(session!, base, expired, "code", provider)),
    ).toMatchObject({ code: "RD_STATE_INVALID" });

    const status = await (await invoke("GET")).json();
    expect(status.connected).toBe(true);
    expect(JSON.stringify(status)).not.toContain("access-");
  });
  test("erro na troca de tokens consome estado sem expor o provedor", async () => {
    const state = await nonce();
    failToken = true;
    expect(
      await rejected(service.finishRdAuthorization(session!, base, state, "code", provider)),
    ).toMatchObject({ code: "RD_HTTP_401" });
    failToken = false;
    expect(
      await rejected(service.finishRdAuthorization(session!, base, state, "code", provider)),
    ).toMatchObject({ code: "RD_STATE_INVALID" });
  });
  test("trocar aplicativo e desconectar invalidam autorizações pendentes", async () => {
    const state = await nonce();
    await service.saveRdCredentials(tenantId, "app-2", "secret-2");
    expect(
      await rejected(service.finishRdAuthorization(session!, base, state, "code", provider)),
    ).toMatchObject({ code: "RD_STATE_INVALID" });
    expect((await service.rdConnectionStatus(tenantId, base)).connected).toBe(false);
    await service.saveRdCredentials(tenantId, "app-2", "");
    const [row] = await database.db
      .select()
      .from(schema.rdMarketingConnections)
      .where(eq(schema.rdMarketingConnections.tenantId, tenantId));
    expect(decryptRdSecret(tenantId, "client-secret", row.clientSecretEncrypted)).toBe("secret-2");
    const state2 = await nonce();
    await service.disconnectRd(tenantId);
    expect(
      await rejected(service.finishRdAuthorization(session!, base, state2, "code", provider)),
    ).toMatchObject({ code: "RD_STATE_INVALID" });
    await connect();
  });
  test("consulta pagina eventos, preserva atribuição e não escreve contatos/cards", async () => {
    const result = await service.probeRdLead(tenantId, "email", "lead+tag@example.com", provider);
    expect(result.contact.uuid).toBe(uuid);
    expect(result.contact.phone).toBeNull();
    expect(result.pages[0].events[0].campaign).toBe("teste");
    expect(result.pages[0].nextPage).toBe(2);
    expect(result.pages[1].events).toHaveLength(0);
    await service.readRdEventPage(tenantId, uuid, "CONVERSION", 2, provider);
    expect(calls.at(-1)?.url).toContain("page=2");
    expect(
      calls
        .filter((call) => call.url.includes("/platform/"))
        .every((call) => call.method === "GET"),
    ).toBe(true);
    expect(
      await database.db
        .select()
        .from(schema.contacts)
        .where(eq(schema.contacts.tenantId, tenantId)),
    ).toHaveLength(0);
    expect(
      await database.db
        .select()
        .from(schema.crmDeals)
        .where(eq(schema.crmDeals.tenantId, tenantId)),
    ).toHaveLength(0);
    expect(
      await rejected(service.probeRdLead(otherTenantId, "email", "lead@example.com", provider)),
    ).toMatchObject({ code: "RD_NOT_CONFIGURED" });
  });
  test("renovação concorrente usa apenas um refresh e persiste rotação", async () => {
    await database.db
      .update(schema.rdMarketingConnections)
      .set({ tokenExpiresAt: new Date(0) })
      .where(eq(schema.rdMarketingConnections.tenantId, tenantId));
    const before = calls.filter((call) => call.url.endsWith("/auth/token")).length;
    await Promise.all([
      service.probeRdLead(tenantId, "uuid", uuid, provider),
      service.probeRdLead(tenantId, "uuid", uuid, provider),
    ]);
    expect(calls.filter((call) => call.url.endsWith("/auth/token")).length - before).toBe(1);
    const [row] = await database.db
      .select()
      .from(schema.rdMarketingConnections)
      .where(eq(schema.rdMarketingConnections.tenantId, tenantId));
    expect(decryptRdSecret(tenantId, "refresh-token", row.refreshTokenEncrypted!)).toBe(
      `refresh-${tokenCounter}`,
    );
    expect(row.tokenExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 3500000);
  });
  test("401 renova e repete; callback inválido não reflete código", async () => {
    const { encryptRdSecret } = await import("../src/lib/rd-marketing/api-crypto");
    await database.db
      .update(schema.rdMarketingConnections)
      .set({ accessTokenEncrypted: encryptRdSecret(tenantId, "access-token", "rejected") })
      .where(and(eq(schema.rdMarketingConnections.tenantId, tenantId)));
    rejectAccess = true;
    await service.probeRdLead(tenantId, "uuid", uuid, provider);
    rejectAccess = false;
    const response = await callback({
      request: new Request(
        "http://localhost/api/settings/rd-marketing/callback?state=invalid&code=secret-code",
        { headers: { Cookie: adminCookie } },
      ),
    });
    expect(response.status).toBe(400);
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(await response.text()).not.toContain("secret-code");
  });
});
