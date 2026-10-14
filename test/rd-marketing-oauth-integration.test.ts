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
    const journeyMigration = await readFile(
      new URL("../src/db/migrations/0038_rd_marketing_journey.sql", import.meta.url),
      "utf8",
    );
    await database.client.unsafe(journeyMigration);
    await database.client.unsafe(journeyMigration);
    const syncMigration = await readFile(
      new URL("../src/db/migrations/0039_rd_marketing_sync.sql", import.meta.url),
      "utf8",
    );
    await database.client.unsafe(syncMigration);
    await database.client.unsafe(syncMigration);
    const isolationMigration = await readFile(
      new URL("../src/db/migrations/0041_rd_marketing_outbound_test.sql", import.meta.url),
      "utf8",
    );
    await database.client.unsafe(isolationMigration);
    await database.client.unsafe(isolationMigration);
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

  test("migração do teste isolado preserva envios gerais já ativos e é idempotente", async () => {
    const migration = await readFile(
      new URL("../src/db/migrations/0041_rd_marketing_outbound_test.sql", import.meta.url),
      "utf8",
    );
    const rollback = new Error("rollback do teste de migração");
    expect(
      await rejected(
        database.client.begin(async (tx) => {
          await tx`ALTER TABLE rd_marketing_sync_settings DROP COLUMN outbound_scope`;
          await tx`ALTER TABLE rd_marketing_sync_settings DROP COLUMN test_contact`;
          await tx`INSERT INTO rd_marketing_sync_settings(tenant_id, outbound_enabled) VALUES (${tenantId}, true), (${otherTenantId}, false)`;
          await tx.unsafe(migration);
          const [active] =
            await tx`SELECT outbound_scope FROM rd_marketing_sync_settings WHERE tenant_id = ${tenantId}`;
          const [inactive] =
            await tx`SELECT outbound_scope FROM rd_marketing_sync_settings WHERE tenant_id = ${otherTenantId}`;
          expect(active.outbound_scope).toBe("all");
          expect(inactive.outbound_scope).toBe("test");
          await tx`UPDATE rd_marketing_sync_settings SET outbound_scope = 'test' WHERE tenant_id = ${tenantId}`;
          await tx.unsafe(migration);
          const [repeated] =
            await tx`SELECT outbound_scope FROM rd_marketing_sync_settings WHERE tenant_id = ${tenantId}`;
          expect(repeated.outbound_scope).toBe("test");
          throw rollback;
        }),
      ),
    ).toBe(rollback);
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

  test("jornada é compartilhada por contato, pagina com cache e só liga recibos comprovados", async () => {
    const { dealRdJourney } = await import("../src/lib/rd-marketing/journey");
    const { defaultMappings, deliveryIdentity } = await import("../src/lib/rd-marketing/mapping");
    const { hashToken } = await import("../src/lib/rd-marketing/service");
    const pipelineId = randomUUID(),
      stageId = randomUUID();
    const contactId = randomUUID(),
      dealA = randomUUID(),
      dealB = randomUUID(),
      flowId = randomUUID();
    await database.db
      .insert(schema.crmPipelines)
      .values({ id: pipelineId, tenantId, name: "Teste" });
    await database.db
      .insert(schema.crmStages)
      .values({ id: stageId, tenantId, pipelineId, name: "Entrada", orderIndex: 0 });
    await database.db.insert(schema.contacts).values({
      id: contactId,
      tenantId,
      name: "Contato teste",
      email: "lead@example.com",
      mainChannel: "whatsapp",
    });
    await database.db.insert(schema.crmDeals).values([
      {
        id: dealA,
        tenantId,
        title: "Negociação A",
        value: "1250.00",
        pipelineId,
        stageId,
        operatorId: `${tenantId}-agent`,
      },
      {
        id: dealB,
        tenantId,
        title: "Negociação B",
        value: "6500.00",
        status: "won",
        pipelineId,
        stageId,
        operatorId: `${tenantId}-admin`,
      },
    ]);
    await database.db.insert(schema.crmDealContacts).values([
      { id: randomUUID(), tenantId, dealId: dealA, contactId, isPrimary: true },
      { id: randomUUID(), tenantId, dealId: dealB, contactId, isPrimary: true },
    ]);
    const settings = {
      name: "Teste",
      enabled: true,
      pipelineId,
      stageId,
      operatorId: null,
      deduplication: "event" as const,
      eventIdPath: "rd_conversion.id",
      mappings: defaultMappings,
    };
    await database.db
      .insert(schema.rdMarketingFlows)
      .values({ id: flowId, tenantId, tokenHash: randomUUID(), settings });
    const identityHash = hashToken(
      deliveryIdentity(
        {
          uuid,
          rd_event: {
            event_timestamp: "2026-10-13T13:32:00-03:00",
            event_identifier: "formulario",
          },
        },
        settings,
      ),
    );
    await database.db
      .insert(schema.rdMarketingReceipts)
      .values({ id: randomUUID(), tenantId, flowId, identityHash, dealId: dealB });
    const viewer = { operatorId: `${tenantId}-agent`, canViewAll: false };
    const before = calls.length;
    const first = await dealRdJourney(tenantId, dealA, viewer, { contactId }, provider);
    expect(first.cached).toBe(false);
    expect(calls.length - before).toBe(3);
    expect(first.events).toHaveLength(1);
    expect(first.events[0].deals).toHaveLength(0);
    expect(first.relatedDeals?.map((deal) => deal.id)).toEqual([dealA]);
    const savedPages = await database.db
      .select()
      .from(schema.rdMarketingJourneyPages)
      .where(eq(schema.rdMarketingJourneyPages.tenantId, tenantId));
    for (const saved of savedPages)
      await database.db
        .update(schema.rdMarketingJourneyPages)
        .set({
          data: {
            ...saved.data,
            events: saved.data.events.map((event) => ({ ...event, source: null })),
          },
        })
        .where(
          and(
            eq(schema.rdMarketingJourneyPages.tenantId, tenantId),
            eq(schema.rdMarketingJourneyPages.id, saved.id),
          ),
        );
    const oldSync = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    await database.db
      .update(schema.rdMarketingJourneyLinks)
      .set({ syncedAt: oldSync })
      .where(
        and(
          eq(schema.rdMarketingJourneyLinks.tenantId, tenantId),
          eq(schema.rdMarketingJourneyLinks.contactId, contactId),
        ),
      );
    const cached = await dealRdJourney(
      tenantId,
      dealB,
      { ...viewer, canViewAll: true },
      { contactId },
      provider,
    );
    expect(cached.cached).toBe(true);
    expect(cached.snapshotId).toBe(first.snapshotId);
    expect(cached.syncedAt).toBe(oldSync.toISOString());
    expect(cached.events[0].source).toBe("google");
    expect(calls.length - before).toBe(3);
    expect(cached.events[0].deals).toEqual([{ id: dealB, title: "Negociação B" }]);
    expect(cached.relatedDeals).toHaveLength(2);
    expect(cached.relatedDeals?.find((deal) => deal.id === dealB)).toMatchObject({
      title: "Negociação B",
      status: "won",
      value: "6500.00",
      currency: "BRL",
      pipelineName: "Teste",
      stageName: "Entrada",
      operatorName: "admin",
      createdAt: expect.any(String),
    });
    const second = await dealRdJourney(
      tenantId,
      dealA,
      viewer,
      { contactId, eventType: "CONVERSION", page: 2, snapshotId: first.snapshotId },
      provider,
    );
    expect(second.pages[0].page).toBe(2);
    expect(calls.at(-1)?.url).toContain("page=2");
    const pageCalls = calls.length;
    expect(
      (
        await dealRdJourney(
          tenantId,
          dealA,
          viewer,
          { contactId, eventType: "CONVERSION", page: 2, snapshotId: first.snapshotId },
          provider,
        )
      ).cached,
    ).toBe(true);
    expect(calls.length).toBe(pageCalls);
    const reopened = await dealRdJourney(
      tenantId,
      dealB,
      { ...viewer, canViewAll: true },
      { contactId },
      provider,
    );
    expect(reopened.cached).toBe(true);
    expect(reopened.snapshotId).toBe(first.snapshotId);
    expect(reopened.pages.map((page) => `${page.eventType}:${page.page}`).sort()).toEqual([
      "CONVERSION:1",
      "CONVERSION:2",
      "OPPORTUNITY:1",
    ]);
    expect(calls.length).toBe(pageCalls);
    expect(
      (await rejected(dealRdJourney(tenantId, dealB, viewer, { contactId }, provider))) as Error,
    ).toMatchObject({ code: "FORBIDDEN" });
    expect(
      await rejected(
        dealRdJourney(
          otherTenantId,
          dealA,
          { ...viewer, canViewAll: true },
          { contactId },
          provider,
        ),
      ),
    ).toMatchObject({ code: "NOT_FOUND" });
    expect(
      await rejected(dealRdJourney(tenantId, dealA, viewer, { contactId: "unlinked" }, provider)),
    ).toMatchObject({ code: "RD_CONTACT_REQUIRED" });
    expect(calls.length).toBe(pageCalls);
    expect(
      await rejected(
        dealRdJourney(
          tenantId,
          dealA,
          viewer,
          { contactId, refresh: true },
          (async () => new Response(null, { status: 429 })) as typeof fetch,
        ),
      ),
    ).toMatchObject({ code: "RD_HTTP_429" });
    const afterFailedRefresh = await dealRdJourney(
      tenantId,
      dealA,
      viewer,
      { contactId },
      provider,
    );
    expect(afterFailedRefresh.snapshotId).toBe(first.snapshotId);
    expect(afterFailedRefresh.pages).toHaveLength(3);
    expect(calls.length).toBe(pageCalls);
    const updated = await dealRdJourney(
      tenantId,
      dealA,
      viewer,
      { contactId, refresh: true },
      provider,
    );
    expect(updated.snapshotId).not.toBe(first.snapshotId);
    expect(updated.cached).toBe(false);
    expect(updated.pages).toHaveLength(2);
    expect(calls.length).toBe(pageCalls + 2);
    expect((await dealRdJourney(tenantId, dealA, viewer, { contactId }, provider)).snapshotId).toBe(
      updated.snapshotId,
    );
    expect(calls.length).toBe(pageCalls + 2);
    expect(
      await rejected(
        dealRdJourney(
          tenantId,
          dealA,
          viewer,
          { contactId, eventType: "CONVERSION", page: 2, snapshotId: first.snapshotId },
          provider,
        ),
      ),
    ).toMatchObject({ code: "RD_SNAPSHOT_CHANGED" });
    const route = (await import("../src/routes/api/crm/deals/$dealId/rd-marketing")).Route.options
      .server!.handlers!.GET!;
    const response = await route({
      request: new Request(
        `http://localhost/api/crm/deals/${dealA}/rd-marketing?tenantId=${otherTenantId}&contactId=${contactId}`,
        { headers: { Cookie: adminCookie } },
      ),
      params: { dealId: dealA },
    } as never);
    expect(response.status).toBe(200);
    expect((await response.json()).contactId).toBe(contactId);
    expect(
      (
        await route({
          request: new Request(`http://localhost/api/crm/deals/${dealA}/rd-marketing`),
          params: { dealId: dealA },
        } as never)
      ).status,
    ).toBe(401);
    const contactsCount = await database.db
      .select()
      .from(schema.contacts)
      .where(eq(schema.contacts.tenantId, tenantId));
    expect(contactsCount).toHaveLength(1);
    expect(
      await database.db
        .select()
        .from(schema.crmDeals)
        .where(eq(schema.crmDeals.tenantId, tenantId)),
    ).toHaveLength(2);
    expect(
      calls
        .filter((call) => call.url.includes("/platform/"))
        .every((call) => call.method === "GET"),
    ).toBe(true);
    await service.disconnectRd(tenantId);
    expect(
      await rejected(dealRdJourney(tenantId, dealA, viewer, { contactId }, provider)),
    ).toMatchObject({ code: "RD_NOT_CONNECTED" });
  }, 30000);
  test("webhooks de jornada não criam cadastros/cards, são idempotentes e respeitam a conta", async () => {
    await connect();
    const sync = await import("../src/lib/rd-marketing/sync-settings");
    const notifications = await import("../src/lib/rd-marketing/notifications");
    const hook = await sync.createRdJourneyEndpoint(tenantId, "CONVERSION", "Teste de jornada");
    expect((await sync.createRdJourneyEndpoint(tenantId, "CONVERSION", "Teste")).id).toBe(hook.id);
    const token = decryptRdSecret(tenantId, "journey-webhook", hook.tokenEncrypted);
    const envelope = {
      tenantId: otherTenantId,
      event_type: "WEBHOOK.CONVERTED",
      event_identifier: "botao-teste",
      event_timestamp: "2026-10-14T12:00:00Z",
      contact: { uuid, email: "lead@example.com", funnel: { origin: "Busca Paga | Google" } },
    };
    const contactsBefore = await database.db
      .select()
      .from(schema.contacts)
      .where(eq(schema.contacts.tenantId, tenantId));
    const dealsBefore = await database.db
      .select()
      .from(schema.crmDeals)
      .where(eq(schema.crmDeals.tenantId, tenantId));
    expect((await notifications.storeJourneyNotification(hook, envelope)).stored).toBe(1);
    expect(
      (
        await notifications.storeJourneyNotification(hook, {
          ...envelope,
          timestamp: "2026-10-14T15:00:00Z",
        })
      ).duplicates,
    ).toBe(1);
    expect(
      await database.db
        .select()
        .from(schema.contacts)
        .where(eq(schema.contacts.tenantId, tenantId)),
    ).toHaveLength(contactsBefore.length);
    expect(
      await database.db
        .select()
        .from(schema.crmDeals)
        .where(eq(schema.crmDeals.tenantId, tenantId)),
    ).toHaveLength(dealsBefore.length);
    expect(
      await database.db
        .select()
        .from(schema.rdMarketingJourneyNotifications)
        .where(eq(schema.rdMarketingJourneyNotifications.tenantId, otherTenantId)),
    ).toHaveLength(0);
    const remote: Record<string, unknown>[] = [];
    let created = 0;
    const registrationProvider = (async (input: unknown, init: RequestInit) => {
      if (String(input).endsWith("/integrations/webhooks")) {
        if (init.method === "GET") return Response.json(remote);
        const body = JSON.parse(String(init.body));
        const row = { ...body, uuid: randomUUID() };
        remote.push(row);
        created++;
        const validation = await notifications.journeyEndpointForToken(token);
        expect((await notifications.storeJourneyNotification(validation, {})).stored).toBe(0);
        expect(
          (await notifications.storeJourneyNotification(validation, { test: true })).stored,
        ).toBe(0);
        return Response.json(row, { status: 201 });
      }
      return provider(input as RequestInfo, init);
    }) as typeof fetch;
    await sync.registerRdJourneyEndpoint(
      tenantId,
      hook.id,
      "https://local.example/api/settings/rd-marketing/sync",
      registrationProvider,
    );
    await sync.registerRdJourneyEndpoint(
      tenantId,
      hook.id,
      "https://local.example/api/settings/rd-marketing/sync",
      registrationProvider,
    );
    expect(created).toBe(1);
    expect(remote[0].include_relations).toEqual(["COMPANY", "CONTACT_FUNNEL"]);
    const [pipeline] = await database.db
      .select()
      .from(schema.crmPipelines)
      .where(eq(schema.crmPipelines.tenantId, tenantId))
      .limit(1);
    const [stage] = await database.db
      .select()
      .from(schema.crmStages)
      .where(
        and(eq(schema.crmStages.tenantId, tenantId), eq(schema.crmStages.pipelineId, pipeline.id)),
      )
      .limit(1);
    await database.db.insert(schema.rdMarketingFlows).values({
      id: randomUUID(),
      tenantId,
      tokenHash: hook.tokenHash,
      settings: {
        name: "Aquisição",
        enabled: true,
        pipelineId: pipeline.id,
        stageId: stage.id,
        operatorId: null,
        deduplication: "event",
        eventIdPath: "rd_conversion.id",
        mappings: [],
      },
    });
    const cardPost = (await import("../src/routes/api/webhooks/rd-marketing/$token")).Route.options
      .server!.handlers!.POST!;
    const ignored = await cardPost({
      request: new Request("http://localhost/api/webhooks/rd-marketing/" + token, {
        method: "POST",
        body: JSON.stringify({ ...envelope, event_type: "WEBHOOK.MARKED_OPPORTUNITY" }),
      }),
      params: { token },
    } as never);
    expect(ignored.status).toBe(202);
    expect((await ignored.json()).ignored).toContain("Evento comercial");
    expect(
      await database.db
        .select()
        .from(schema.crmDeals)
        .where(eq(schema.crmDeals.tenantId, tenantId)),
    ).toHaveLength(dealsBefore.length);
    const journeyPost = (await import("../src/routes/api/webhooks/rd-marketing/journey/$token"))
      .Route.options.server!.handlers!.POST!;
    expect(
      (
        await journeyPost({
          request: new Request("http://localhost/api/webhooks/rd-marketing/journey/" + token, {
            method: "POST",
            body: JSON.stringify(envelope),
          }),
          params: { token },
        } as never)
      ).status,
    ).toBe(202);
    expect(
      (
        await journeyPost({
          request: new Request("http://localhost"),
          params: { token: "invalid" },
        } as never)
      ).status,
    ).toBe(401);
    const handlers = (await import("../src/routes/api/settings/rd-marketing/sync")).Route.options
      .server!.handlers!;
    const get = handlers.GET!;
    expect(
      (
        await get({
          request: new Request("http://localhost/api/settings/rd-marketing/sync"),
        } as never)
      ).status,
    ).toBe(401);
    expect(
      (
        await get({
          request: new Request("http://localhost/api/settings/rd-marketing/sync", {
            headers: { Cookie: agentCookie },
          }),
        } as never)
      ).status,
    ).toBe(403);
    const status = await get({
      request: new Request(
        "http://localhost/api/settings/rd-marketing/sync?tenantId=" + otherTenantId,
        { headers: { Cookie: adminCookie } },
      ),
    } as never);
    expect((await status.json()).endpoints).toHaveLength(1);
    expect(
      (
        await handlers.POST!({
          request: new Request("http://localhost/api/settings/rd-marketing/sync", {
            method: "POST",
            headers: {
              Cookie: adminCookie,
              Origin: "https://attacker.example",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              action: "save",
              tenantId: otherTenantId,
              outboundEnabled: true,
              currency: "BRL",
            }),
          }),
        } as never)
      ).status,
    ).toBe(400);
    await service.disconnectRd(tenantId);
    expect(await rejected(notifications.journeyEndpointForToken(token))).toMatchObject({
      code: "UNAUTHORIZED",
    });
    const retired = await journeyPost({
      request: new Request("http://localhost", { method: "POST", body: JSON.stringify(envelope) }),
      params: { token },
    } as never);
    expect(retired.status).toBe(202);
    expect((await retired.json()).stored).toBe(0);
  }, 30000);
  test("retorno comercial preserva venda/perda de cards distintos, evita ecos e não repete timeout", async () => {
    await connect();
    const { crmService } = await import("../src/lib/crm/crm-service");
    const sync = await import("../src/lib/rd-marketing/sync-settings");
    const { runRdCommercialWorker } = await import("../src/lib/rd-marketing/commercial-outbox");
    const pipelineId = randomUUID(),
      stageId = randomUUID(),
      contactId = randomUUID();
    await database.db
      .insert(schema.crmPipelines)
      .values({ id: pipelineId, tenantId, name: "Comercial teste" });
    await database.db
      .insert(schema.crmStages)
      .values({ id: stageId, tenantId, pipelineId, name: "Entrada", orderIndex: 0 });
    await database.db.insert(schema.contacts).values({
      id: contactId,
      tenantId,
      email: "lead@example.com",
      name: "Contato comercial",
      mainChannel: "whatsapp",
    });
    await sync.saveRdSyncSettings(tenantId, true, "BRL", { outboundScope: "all" });
    const actor = tenantId + "-admin";
    const data = {
      title: "Teste comercial",
      pipelineId,
      stageId,
      contactId,
      value: "1000.00",
      marketingOrigin: true,
    };
    const a = await crmService.createDeal(tenantId, actor, data);
    await crmService.updateDeal(tenantId, a.id, actor, { operatorId: tenantId + "-agent" });
    const b = await crmService.createDeal(tenantId, actor, data);
    const manual = await crmService.createDeal(tenantId, actor, {
      ...data,
      marketingOrigin: false,
    });
    await crmService.updateDeal(tenantId, a.id, actor, { status: "lost" });
    await crmService.updateDeal(tenantId, b.id, actor, { status: "won" });
    await crmService.updateDeal(tenantId, b.id, actor, { title: "Título editado", status: "won" });
    const sent: Record<string, unknown>[] = [];
    let timeout = false,
      rateLimit = false;
    const commercialProvider = (async (input: unknown, init: RequestInit) => {
      if (String(input).endsWith("/platform/events") && init.method === "POST") {
        if (rateLimit) {
          rateLimit = false;
          return new Response(null, { status: 429 });
        }
        sent.push(JSON.parse(String(init.body)));
        if (timeout) throw new Error("Simula resposta perdida após aceitação");
        return Response.json({ event_uuid: randomUUID() });
      }
      return provider(input as RequestInfo, init);
    }) as typeof fetch;
    const outboxRows = () =>
      database.db
        .select()
        .from(schema.rdMarketingCommercialOutbox)
        .where(eq(schema.rdMarketingCommercialOutbox.tenantId, tenantId));
    expect(await outboxRows()).toHaveLength(3);
    const rollback = await rejected(
      database.db.transaction(async (tx) => {
        await crmService.createDeal(tenantId, actor, { ...data, marketingOrigin: false }, tx);
        throw new Error("Rollback esperado");
      }),
    );
    expect(rollback).toMatchObject({ message: "Rollback esperado" });
    expect(await outboxRows()).toHaveLength(3);
    await Promise.all([
      runRdCommercialWorker(tenantId, commercialProvider),
      runRdCommercialWorker(tenantId, commercialProvider),
    ]);
    expect(sent.map((event) => event.event_type).sort()).toEqual([
      "OPPORTUNITY",
      "OPPORTUNITY_LOST",
      "SALE",
    ]);
    expect(
      (sent.find((event) => event.event_type === "SALE")!.payload as Record<string, unknown>).value,
    ).toBe(1000);
    expect((await outboxRows()).every((row) => row.status === "sent")).toBe(true);
    await runRdCommercialWorker(tenantId, commercialProvider);
    expect(sent).toHaveLength(3);
    await crmService.updateDeal(tenantId, b.id, actor, { status: "open" });
    rateLimit = true;
    await runRdCommercialWorker(tenantId, commercialProvider);
    const deferred = (await outboxRows()).find((row) => row.status === "pending")!;
    expect(deferred.nextRetryAt.getTime()).toBeGreaterThan(Date.now());
    expect(sent).toHaveLength(3);
    await runRdCommercialWorker(tenantId, commercialProvider);
    expect(sent).toHaveLength(3);
    await database.db
      .update(schema.rdMarketingCommercialOutbox)
      .set({ nextRetryAt: new Date(Date.now() - 1) })
      .where(
        and(
          eq(schema.rdMarketingCommercialOutbox.tenantId, tenantId),
          eq(schema.rdMarketingCommercialOutbox.id, deferred.id),
        ),
      );
    await runRdCommercialWorker(tenantId, commercialProvider);
    await crmService.updateDeal(tenantId, b.id, actor, { status: "won" });
    timeout = true;
    await runRdCommercialWorker(tenantId, commercialProvider);
    const attempts = sent.length;
    const unknown = (await outboxRows()).find((row) => row.status === "unknown")!;
    expect(unknown.eventType).toBe("SALE");
    const waitingId = randomUUID();
    await database.db.insert(schema.rdMarketingCommercialOutbox).values({
      id: waitingId,
      tenantId,
      connectionVersion: unknown.connectionVersion,
      dealId: manual.id,
      contactId,
      dealVersion: 100000,
      eventType: "OPPORTUNITY",
      payload: { email: "lead@example.com" },
      snapshot: { title: "Aguarda confirmação anterior" },
      createdAt: new Date(Date.now() + 1000),
    });
    const waiting = (await sync.rdSyncStatus(tenantId, "http://localhost")).deliveries.find(
      (row) => row.id === waitingId,
    )!;
    expect(waiting.waitsFor).toEqual({ id: unknown.id, status: "unknown" });
    expect(waiting.attempts).toBe(0);
    await database.db
      .delete(schema.rdMarketingCommercialOutbox)
      .where(
        and(
          eq(schema.rdMarketingCommercialOutbox.tenantId, tenantId),
          eq(schema.rdMarketingCommercialOutbox.id, waitingId),
        ),
      );
    await runRdCommercialWorker(tenantId, commercialProvider);
    expect(sent).toHaveLength(attempts);
    await sync.reviewRdDelivery(tenantId, unknown.id, actor, "confirmed");
    timeout = false;
    await runRdCommercialWorker(tenantId, commercialProvider);
    expect(sent).toHaveLength(attempts);
    const journey = await (
      await import("../src/lib/rd-marketing/journey")
    ).dealRdJourney(
      tenantId,
      a.id,
      { operatorId: actor, canViewAll: true },
      { contactId },
      commercialProvider,
    );
    expect(journey.events.filter((event) => event.eventType === "SALE")).toHaveLength(2);
    expect(
      journey.events.some(
        (event) => event.eventType === "OPPORTUNITY_LOST" && event.deals[0]?.id === a.id,
      ),
    ).toBe(true);
    const restricted = await (
      await import("../src/lib/rd-marketing/journey")
    ).dealRdJourney(
      tenantId,
      a.id,
      { operatorId: tenantId + "-agent", canViewAll: false },
      { contactId },
      commercialProvider,
    );
    expect(restricted.events.filter((event) => event.eventType === "SALE")).toHaveLength(0);
    expect(
      restricted.events.some(
        (event) => event.eventType === "OPPORTUNITY_LOST" && event.deals[0]?.id === a.id,
      ),
    ).toBe(true);
    await crmService.updateDeal(tenantId, manual.id, actor, { status: "lost" });
    const interrupted = (await outboxRows()).find(
      (row) => row.status === "pending" && row.dealId === manual.id,
    )!;
    await database.db
      .update(schema.rdMarketingCommercialOutbox)
      .set({ status: "processing", leaseToken: randomUUID(), leaseUntil: new Date(Date.now() - 1) })
      .where(
        and(
          eq(schema.rdMarketingCommercialOutbox.tenantId, tenantId),
          eq(schema.rdMarketingCommercialOutbox.id, interrupted.id),
        ),
      );
    await runRdCommercialWorker(tenantId, commercialProvider);
    expect((await outboxRows()).find((row) => row.id === interrupted.id)?.status).toBe("unknown");
    expect(sent).toHaveLength(attempts);
    await sync.reviewRdDelivery(tenantId, interrupted.id, actor, "not_recorded");
    await connect();
    expect((await sync.rdSyncStatus(tenantId, "https://local.example")).outboundEnabled).toBe(
      false,
    );
    await runRdCommercialWorker(tenantId, commercialProvider);
    expect(
      (await outboxRows()).some((row) => row.status === "blocked" && row.dealId === manual.id),
    ).toBe(true);
    expect(sent).toHaveLength(attempts);
  }, 30000);
  test("retorno por UUID usa o telefone identificador e bloqueia números apenas informativos", async () => {
    await connect();
    const { crmService } = await import("../src/lib/crm/crm-service");
    const { saveRdSyncSettings } = await import("../src/lib/rd-marketing/sync-settings");
    const { runRdCommercialWorker } = await import("../src/lib/rd-marketing/commercial-outbox");
    const pipelineId = randomUUID(),
      stageId = randomUUID();
    await database.db
      .insert(schema.crmPipelines)
      .values({ id: pipelineId, tenantId, name: "Identificadores RD" });
    await database.db
      .insert(schema.crmStages)
      .values({ id: stageId, tenantId, pipelineId, name: "Entrada", orderIndex: 0 });
    const [connection] = await database.db
      .select()
      .from(schema.rdMarketingConnections)
      .where(eq(schema.rdMarketingConnections.tenantId, tenantId));
    await saveRdSyncSettings(tenantId, true, "BRL", { outboundScope: "all" });
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    const uuids = [randomUUID(), randomUUID()];
    const deals = [];
    for (let i = 0; i < ids.length; i++) {
      await database.db.insert(schema.contacts).values({
        id: ids[i],
        tenantId,
        name: "Teste sem email",
        mainChannel: "whatsapp",
        phone: i === 2 ? "5511999990000" : null,
      });
      if (i < 2)
        await database.db.insert(schema.rdMarketingJourneyLinks).values({
          id: randomUUID(),
          tenantId,
          contactId: ids[i],
          connectionVersion: connection.version,
          rdUuid: uuids[i],
          snapshotId: randomUUID(),
        });
      const deal = await crmService.createDeal(tenantId, tenantId + "-admin", {
        title: "Identificador",
        pipelineId,
        stageId,
        contactId: ids[i],
        value: "100",
        marketingOrigin: true,
      });
      await crmService.updateDeal(tenantId, deal.id, tenantId + "-admin", { status: "won" });
      deals.push(deal.id);
    }
    const posts: Record<string, unknown>[] = [];
    const phoneProvider = (async (input: unknown, init: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/platform/events") && init.method === "POST") {
        posts.push(JSON.parse(String(init.body)));
        return Response.json({ event_uuid: randomUUID() });
      }
      if (url.includes("/platform/contacts/uuid:")) {
        const requested = url.split("uuid:")[1];
        return Response.json({
          uuid: requested,
          phone: requested === uuids[0] ? "+5511888880000" : undefined,
          personal_phone: "+5511999990000",
          mobile_phone: "+5511999990000",
        });
      }
      if (url.includes("/platform/contacts/phone:"))
        return Response.json({
          uuid: randomUUID(),
          email: "different@example.com",
          phone: "+5511777770000",
          personal_phone: "+5511999990000",
        });
      return provider(input as RequestInfo, init);
    }) as typeof fetch;
    await runRdCommercialWorker(tenantId, phoneProvider);
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({
      event_type: "SALE",
      payload: { phone: "+5511888880000", value: 100 },
    });
    const rows = await database.db
      .select()
      .from(schema.rdMarketingCommercialOutbox)
      .where(eq(schema.rdMarketingCommercialOutbox.tenantId, tenantId));
    expect(rows.find((row) => row.dealId === deals[0])?.status).toBe("sent");
    expect(rows.find((row) => row.dealId === deals[1])?.status).toBe("blocked");
    expect(rows.find((row) => row.dealId === deals[2])?.status).toBe("blocked");
  }, 30000);
  test("teste isolado envia só ao UUID escolhido, bloqueia fila antiga e mantém entrada irrestrita", async () => {
    await connect();
    const sync = await import("../src/lib/rd-marketing/sync-settings");
    const { crmService } = await import("../src/lib/crm/crm-service");
    const { receiveLeads } = await import("../src/lib/rd-marketing/service");
    const { defaultMappings } = await import("../src/lib/rd-marketing/mapping");
    const notifications = await import("../src/lib/rd-marketing/notifications");
    const { runRdCommercialWorker } = await import("../src/lib/rd-marketing/commercial-outbox");
    const testUuid = randomUUID(),
      otherUuid = randomUUID();
    const testEmail = `isolated-${randomUUID()}@example.com`,
      otherEmail = `real-${randomUUID()}@example.com`;
    const pipelineId = randomUUID(),
      stageId = randomUUID(),
      contactId = randomUUID(),
      otherId = randomUUID();
    await database.db
      .insert(schema.crmPipelines)
      .values({ id: pipelineId, tenantId, name: "Teste isolado" });
    await database.db
      .insert(schema.crmStages)
      .values({ id: stageId, tenantId, pipelineId, name: "Entrada", orderIndex: 0 });
    await database.db.insert(schema.contacts).values([
      { id: contactId, tenantId, name: "Meu teste", email: testEmail, mainChannel: "whatsapp" },
      { id: otherId, tenantId, name: "Outro lead", email: otherEmail, mainChannel: "whatsapp" },
    ]);
    const actor = tenantId + "-admin";
    const data = { pipelineId, stageId, title: "Isolamento", value: "0", contactId };
    const posts: Record<string, unknown>[] = [];
    let contactReads = 0,
      changeTargetOnRead = false,
      changeTargetOnUnauthorized = false;
    const switchTarget = () =>
      database.db
        .update(schema.rdMarketingSyncSettings)
        .set({ testContact: { uuid: otherUuid, name: "Outro", email: otherEmail, phone: null } })
        .where(eq(schema.rdMarketingSyncSettings.tenantId, tenantId));
    const isolatedProvider = (async (input: unknown, init: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/platform/events") && init.method === "POST") {
        if (changeTargetOnUnauthorized) {
          changeTargetOnUnauthorized = false;
          await switchTarget();
          return new Response(null, { status: 401 });
        }
        posts.push(JSON.parse(String(init.body)));
        return Response.json({ event_uuid: randomUUID() });
      }
      if (url.includes("/platform/contacts/uuid:")) {
        contactReads++;
        const requested = url.split("uuid:")[1];
        if (changeTargetOnRead) {
          changeTargetOnRead = false;
          await switchTarget();
        }
        return Response.json({
          uuid: requested,
          name: "Meu teste",
          email: requested === testUuid ? testEmail : otherEmail,
        });
      }
      return provider(input as RequestInfo, init);
    }) as typeof fetch;
    await sync.saveRdSyncSettings(tenantId, true, "BRL", { outboundScope: "all" });
    const old = await crmService.createDeal(tenantId, actor, { ...data, contactId: otherId });
    const restricted = { outboundScope: "test" as const, testContactUuid: testUuid };
    await sync.saveRdSyncSettings(tenantId, true, "BRL", restricted, isolatedProvider);
    const saved = await sync.rdSyncStatus(tenantId, "http://localhost");
    expect(saved.testContact).toMatchObject({ uuid: testUuid, email: testEmail });
    expect(saved.outboundScope).toBe("test");
    const postSettings = (await import("../src/routes/api/settings/rd-marketing/sync")).Route
      .options.server!.handlers!.POST!;
    const missingScope = await postSettings({
      request: new Request("http://localhost/api/settings/rd-marketing/sync", {
        method: "POST",
        headers: {
          Cookie: adminCookie,
          Origin: "http://localhost",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "save",
          outboundEnabled: true,
          currency: "BRL",
          tenantId: otherTenantId,
        }),
      }),
    } as never);
    expect(missingScope.status).toBe(400);
    const settingsRequest = (testContactUuid: string) =>
      new Request("http://localhost/api/settings/rd-marketing/sync", {
        method: "POST",
        headers: {
          Cookie: adminCookie,
          Origin: "http://localhost",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "save",
          outboundEnabled: true,
          currency: "BRL",
          outboundScope: "test",
          testContactUuid,
          tenantId: otherTenantId,
        }),
      });
    const beforeInvalid = contactReads;
    const invalidNumber = await postSettings({ request: settingsRequest("1234567890") } as never);
    expect(invalidNumber.status).toBe(400);
    expect((await invalidNumber.json()).error).toContain("Um número sozinho não é um UUID");
    expect(contactReads).toBe(beforeInvalid);
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = isolatedProvider;
      const savedByRoute = await postSettings({
        request: settingsRequest(`\u00a0UUID: ${testUuid.toUpperCase()}\u00a0`),
      } as never);
      expect(savedByRoute.status).toBe(200);
      expect((await savedByRoute.json()).testContact?.uuid).toBe(testUuid);
    } finally {
      globalThis.fetch = originalFetch;
    }
    const getSettings = (await import("../src/routes/api/settings/rd-marketing/sync")).Route.options
      .server!.handlers!.GET!;
    const reloaded = await getSettings({
      request: new Request("http://localhost/api/settings/rd-marketing/sync", {
        headers: { Cookie: adminCookie },
      }),
    } as never);
    expect((await reloaded.json()).testContact).toMatchObject({ uuid: testUuid, email: testEmail });
    const truncated = await postSettings({
      request: settingsRequest(testUuid.slice(0, -1)),
    } as never);
    expect(truncated.status).toBe(400);
    expect((await truncated.json()).error).toContain("35 caracteres");
    expect((await sync.rdSyncStatus(tenantId, "http://localhost")).testContact?.uuid).toBe(
      testUuid,
    );
    expect(
      await rejected(
        sync.saveRdSyncSettings(tenantId, true, "BRL", restricted, (async () =>
          Response.json({ uuid: otherUuid, name: "Outro", email: otherEmail })) as typeof fetch),
      ),
    ).toMatchObject({ code: "BAD_REQUEST" });
    expect((await sync.rdSyncStatus(tenantId, "http://localhost")).testContact?.uuid).toBe(
      testUuid,
    );
    expect(
      await rejected(
        sync.saveRdSyncSettings(tenantId, true, "BRL", { outboundScope: "test" }, isolatedProvider),
      ),
    ).toMatchObject({ code: "BAD_REQUEST" });
    const real = await crmService.createDeal(tenantId, actor, { ...data, contactId: otherId });
    await crmService.updateDeal(tenantId, real.id, actor, { status: "won" });
    const mine = await crmService.createDeal(tenantId, actor, data);
    const second = await crmService.createDeal(tenantId, actor, { ...data, marketingOrigin: true });
    await crmService.updateDeal(tenantId, mine.id, actor, { status: "won" });
    await crmService.updateDeal(tenantId, second.id, actor, { status: "lost" });
    const readsBeforeWorker = contactReads;
    await runRdCommercialWorker(tenantId, isolatedProvider);
    expect(contactReads - readsBeforeWorker).toBe(3);
    expect(posts).toHaveLength(3);
    expect(
      posts.every((post) => (post.payload as Record<string, unknown>).email === testEmail),
    ).toBe(true);
    expect(posts.map((post) => post.event_type).sort()).toEqual([
      "OPPORTUNITY",
      "OPPORTUNITY_LOST",
      "SALE",
    ]);
    const rows = await database.db
      .select()
      .from(schema.rdMarketingCommercialOutbox)
      .where(eq(schema.rdMarketingCommercialOutbox.tenantId, tenantId));
    expect(rows.some((row) => row.dealId === real.id)).toBe(false);
    expect(rows.find((row) => row.dealId === old.id)?.status).toBe("blocked");
    await database.db
      .insert(schema.crmDealContacts)
      .values({ id: randomUUID(), tenantId, dealId: real.id, contactId, isPrimary: false });
    const noValue = await crmService.createDeal(tenantId, actor, {
      ...data,
      marketingOrigin: true,
      value: null,
    });
    await crmService.updateDeal(tenantId, noValue.id, actor, { status: "won" });
    const diagnosis = await sync.rdSyncStatus(tenantId, "http://localhost");
    expect(diagnosis.testDeals.find((deal) => deal.id === real.id)?.reason).toContain(
      "contato principal",
    );
    expect(diagnosis.testDeals.find((deal) => deal.id === noValue.id)?.reason).toContain("valor");
    expect(
      diagnosis.deliveries.find(
        (delivery) => delivery.dealId === mine.id && delivery.eventType === "SALE",
      ),
    ).toMatchObject({ attempts: 1, status: "sent" });
    const processAsAgent = await postSettings({
      request: new Request("http://localhost/api/settings/rd-marketing/sync", {
        method: "POST",
        headers: {
          Cookie: agentCookie,
          Origin: "http://localhost",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "process", tenantId: otherTenantId }),
      }),
    } as never);
    expect(processAsAgent.status).toBe(403);
    await sync.reviewRdDelivery(
      tenantId,
      rows.find((row) => row.dealId === old.id)!.id,
      actor,
      "retry",
    );
    await runRdCommercialWorker(tenantId, isolatedProvider);
    expect(posts).toHaveLength(3);
    const flowSettings = {
      name: "Entrada livre",
      enabled: true,
      pipelineId,
      stageId,
      operatorId: null,
      deduplication: "event" as const,
      eventIdPath: "rd_conversion.id",
      mappings: defaultMappings,
    };
    const [flow] = await database.db
      .insert(schema.rdMarketingFlows)
      .values({ id: randomUUID(), tenantId, tokenHash: randomUUID(), settings: flowSettings })
      .returning();
    const envelope = {
      event_type: "WEBHOOK.CONVERTED",
      event_timestamp: "2026-10-14T15:00:00Z",
      event_identifier: "teste-entrada",
      contact: { uuid: otherUuid, name: "Outro lead", email: otherEmail },
    };
    expect((await receiveLeads(flow, envelope))[0].status).toBe("created");
    const hook = await sync.createRdJourneyEndpoint(tenantId, "CONVERSION", "Entrada livre");
    expect((await notifications.storeJourneyNotification(hook, envelope)).stored).toBe(1);
    const [rdImported] = await receiveLeads(flow, {
      ...envelope,
      event_timestamp: "2026-10-14T15:00:01Z",
      contact: { uuid: testUuid, name: "Importado do RD", email: testEmail },
    });
    expect(
      (await sync.rdSyncStatus(tenantId, "http://localhost")).testDeals.find(
        (deal) => deal.id === rdImported.dealId,
      )?.reason,
    ).toContain("Card criado pelo RD");
    await crmService.updateDeal(tenantId, second.id, actor, { status: "open" });
    changeTargetOnRead = true;
    await runRdCommercialWorker(tenantId, isolatedProvider);
    expect(posts).toHaveLength(3);
    await sync.saveRdSyncSettings(tenantId, true, "BRL", restricted, isolatedProvider);
    await crmService.updateDeal(tenantId, second.id, actor, { status: "won" });
    changeTargetOnUnauthorized = true;
    await runRdCommercialWorker(tenantId, isolatedProvider);
    expect(posts).toHaveLength(3);
    const otherStatus = await sync.rdSyncStatus(otherTenantId, "http://localhost");
    expect(otherStatus.outboundEnabled).toBe(false);
    expect(otherStatus.testDeals).toHaveLength(0);
  }, 30000);
  test("dois contatos locais não recebem o mesmo UUID RD na conexão ativa", async () => {
    await connect();
    const { dealRdJourney } = await import("../src/lib/rd-marketing/journey");
    const pipelineId = randomUUID(),
      stageId = randomUUID(),
      dealId = randomUUID();
    const contactA = randomUUID(),
      contactB = randomUUID();
    await database.db
      .insert(schema.crmPipelines)
      .values({ id: pipelineId, tenantId, name: "Teste de identidade" });
    await database.db
      .insert(schema.crmStages)
      .values({ id: stageId, tenantId, pipelineId, name: "Entrada", orderIndex: 0 });
    await database.db.insert(schema.contacts).values([
      {
        id: contactA,
        tenantId,
        name: "Contato A",
        email: "alias-a@example.com",
        mainChannel: "whatsapp",
      },
      {
        id: contactB,
        tenantId,
        name: "Contato B",
        email: "alias-b@example.com",
        mainChannel: "whatsapp",
      },
    ]);
    await database.db
      .insert(schema.crmDeals)
      .values({ id: dealId, tenantId, title: "Identidade", pipelineId, stageId });
    await database.db.insert(schema.crmDealContacts).values([
      { id: randomUUID(), tenantId, dealId, contactId: contactA },
      { id: randomUUID(), tenantId, dealId, contactId: contactB },
    ]);
    const aliasProvider = (async (input: unknown, init: RequestInit) => {
      const url = String(input);
      if (url.includes("/platform/contacts/email:"))
        return Response.json({
          uuid,
          email: decodeURIComponent(url.split("email:")[1]),
          name: "Alias",
        });
      return provider(input as RequestInfo, init);
    }) as typeof fetch;
    const viewer = { operatorId: `${tenantId}-admin`, canViewAll: true };
    await dealRdJourney(tenantId, dealId, viewer, { contactId: contactA }, aliasProvider);
    expect(
      await rejected(
        dealRdJourney(tenantId, dealId, viewer, { contactId: contactB }, aliasProvider),
      ),
    ).toMatchObject({ code: "RD_IDENTITY_CONFLICT" });
    expect(
      await database.db
        .select()
        .from(schema.rdMarketingJourneyLinks)
        .where(
          and(
            eq(schema.rdMarketingJourneyLinks.tenantId, tenantId),
            eq(schema.rdMarketingJourneyLinks.contactId, contactB),
          ),
        ),
    ).toHaveLength(0);
  }, 30000);
});
