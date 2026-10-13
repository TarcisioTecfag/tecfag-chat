import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { defaultMappings, type FlowSettings } from "../src/lib/rd-marketing/mapping";

// Esta suíte exige banco descartável e cria o schema do zero. Nunca usa DATABASE_URL.
const testUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!testUrl)("RD Marketing: PostgreSQL isolado", () => {
  let database: typeof import("../src/db");
  let schema: typeof import("../src/db/schema");
  let service: typeof import("../src/lib/rd-marketing/service");
  let authModule: typeof import("../src/lib/auth-session");
  let settingsHandlers: Record<string, (context: any) => Promise<Response>>;
  let webhookHandler: (context: any) => Promise<Response>;
  let adminCookie: string;
  let agentCookie: string;
  let webhookToken: string;
  const tenantId = `rd-test-${randomUUID()}`;
  const otherTenantId = `rd-other-${randomUUID()}`;
  const pipelineId = `pipe-${randomUUID()}`;
  const stageId = `stage-${randomUUID()}`;
  let flow: typeof import("../src/db/schema").rdMarketingFlows.$inferSelect;
  const config: FlowSettings = {
    name: "Teste isolado",
    enabled: true,
    pipelineId,
    stageId,
    operatorId: null,
    deduplication: "lead",
    eventIdPath: "",
    mappings: defaultMappings,
  };
  const makeLead = () => ({
    uuid: randomUUID(),
    name: "Teste",
    email: `${randomUUID()}@example.com`,
    mobile_phone: "",
  });

  beforeAll(async () => {
    if (
      !testUrl ||
      !/test/i.test(new URL(testUrl).pathname) ||
      !["127.0.0.1", "localhost"].includes(new URL(testUrl).hostname)
    )
      throw new Error("Use uma base descartável local com 'test' no nome.");
    process.env.NODE_ENV = "test";
    database = await import("../src/db");
    await database.assertTestDatabaseIsolation();
    schema = await import("../src/db/schema");
    // Somente base vazia: impedir qualquer alteração em banco de teste já usado por outra suíte.
    const tables =
      await database.client`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`;
    if (tables.length) throw new Error("A suíte precisa de banco descartável vazio.");
    const { generateDrizzleJson, generateMigration } = await import("drizzle-kit/api");
    const statements = await generateMigration(
      generateDrizzleJson({}),
      generateDrizzleJson(schema),
    );
    for (const statement of statements) await database.client.unsafe(statement);
    await database.client.unsafe(
      await readFile(
        new URL("../src/db/migrations/0024_customer_identity_guards.sql", import.meta.url),
        "utf8",
      ),
    );
    // A migration aditiva também deve ser segura ao reaplicar sobre o schema atual.
    await database.client.unsafe(
      await readFile(
        new URL("../src/db/migrations/0035_rd_marketing.sql", import.meta.url),
        "utf8",
      ),
    );
    await database.db.insert(schema.tenants).values([
      { id: tenantId, name: "Teste", slug: tenantId, connectionType: "meta" },
      { id: otherTenantId, name: "Outro", slug: otherTenantId, connectionType: "meta" },
    ]);
    await database.db
      .insert(schema.crmPipelines)
      .values({ id: pipelineId, tenantId, name: "Teste" });
    await database.db
      .insert(schema.crmStages)
      .values({ id: stageId, tenantId, pipelineId, name: "Entrada", orderIndex: 0 });
    service = await import("../src/lib/rd-marketing/service");
    webhookToken = service.newWebhookToken();
    const [saved] = await database.db
      .insert(schema.rdMarketingFlows)
      .values({
        id: randomUUID(),
        tenantId,
        tokenHash: service.hashToken(webhookToken),
        settings: config,
      })
      .returning();
    flow = saved;
    authModule = await import("../src/lib/auth-session");
    for (const role of ["admin", "agent"])
      await database.db.insert(schema.operators).values({
        id: `${tenantId}-${role}`,
        tenantId,
        name: role,
        email: `${role}@example.com`,
        passwordHash: "test",
        role,
      });
    adminCookie = `session_token=${(await authModule.createSession(tenantId, `${tenantId}-admin`)).token}`;
    agentCookie = `session_token=${(await authModule.createSession(tenantId, `${tenantId}-agent`)).token}`;
    settingsHandlers = (await import("../src/routes/api/settings/rd-marketing")).Route.options
      .server!.handlers as any;
    webhookHandler = (await import("../src/routes/api/webhooks/rd-marketing/$token")).Route.options
      .server!.handlers!.POST as any;
  }, 60000);

  afterAll(async () => {
    if (database) await database.client.end();
  });

  test("simula sem gravar e cria contato, card, auditoria e recibo", async () => {
    const lead = makeLead();
    const preview = await service.previewFlow(tenantId, config, { leads: [lead] });
    expect(preview.results[0].contact.email).toBe(lead.email);
    const before = await database.db
      .select()
      .from(schema.crmDeals)
      .where(eq(schema.crmDeals.tenantId, tenantId));
    expect(before).toHaveLength(0);
    const results = await service.receiveLeads(flow, { leads: [lead] });
    expect(results[0].status).toBe("created");
    const dealId = results[0].dealId!;
    const [deal] = await database.db
      .select()
      .from(schema.crmDeals)
      .where(and(eq(schema.crmDeals.tenantId, tenantId), eq(schema.crmDeals.id, dealId)));
    expect(deal.pipelineId).toBe(pipelineId);
    expect(deal.source).toBe("Não informada");
    const linked = await database.db
      .select()
      .from(schema.crmDealContacts)
      .where(
        and(
          eq(schema.crmDealContacts.tenantId, tenantId),
          eq(schema.crmDealContacts.dealId, dealId),
        ),
      );
    expect(linked).toHaveLength(1);
    const events = await database.db
      .select()
      .from(schema.crmDealEvents)
      .where(
        and(eq(schema.crmDealEvents.tenantId, tenantId), eq(schema.crmDealEvents.dealId, dealId)),
      );
    expect(events).toHaveLength(1);
    const notes = await database.db
      .select()
      .from(schema.crmDealActivities)
      .where(
        and(
          eq(schema.crmDealActivities.tenantId, tenantId),
          eq(schema.crmDealActivities.dealId, dealId),
          eq(schema.crmDealActivities.type, "note"),
        ),
      );
    expect(notes).toHaveLength(1);
    expect(notes[0].description).toContain(
      "Negociação criada automaticamente pelo RD Station Marketing.",
    );
    expect(
      (await service.receiveLeads(flow, { leads: [{ ...lead, name: "Alterado" }] }))[0],
    ).toEqual({ status: "duplicate", dealId });
  });

  test("grava atribuição e nota automática uma vez, junto com o card", async () => {
    const settings: FlowSettings = {
      ...config,
      attributionConversion: "last",
      requireAttribution: true,
      mappings: [...defaultMappings, { source: "message", target: "deal.initialNote" }],
    };
    const [attributionFlow] = await database.db
      .insert(schema.rdMarketingFlows)
      .values({
        id: randomUUID(),
        tenantId,
        tokenHash: service.hashToken(service.newWebhookToken()),
        settings,
      })
      .returning();
    const lead = {
      ...makeLead(),
      first_conversion: { conversion_origin: { source: "Google", campaign: "Primeira" } },
      last_conversion: { conversion_origin: { source: "Meta", campaign: "Última" } },
      message: "Quero orçamento.",
    };
    const result = await service.receiveLeads(attributionFlow, { leads: [lead] });
    await service.receiveLeads(attributionFlow, { leads: [lead] });
    const dealId = result[0].dealId!;
    const [deal] = await database.db
      .select()
      .from(schema.crmDeals)
      .where(and(eq(schema.crmDeals.tenantId, tenantId), eq(schema.crmDeals.id, dealId)));
    expect(deal.source).toBe("Meta");
    expect(deal.campaign).toBe("Última");
    const notes = await database.db
      .select()
      .from(schema.crmDealActivities)
      .where(
        and(
          eq(schema.crmDealActivities.tenantId, tenantId),
          eq(schema.crmDealActivities.dealId, dealId),
          eq(schema.crmDealActivities.type, "note"),
        ),
      );
    expect(notes).toHaveLength(1);
    expect(notes[0].description).toContain(
      "Negociação criada automaticamente pelo RD Station Marketing.",
    );
    expect(notes[0].description).toContain("Fonte: Meta");
    expect(notes[0].description).toContain("Campanha: Última");
    expect(notes[0].description).toContain("Quero orçamento.");
    const missing = { ...makeLead(), last_conversion: { conversion_origin: { source: "Google" } } };
    await expect(service.receiveLeads(attributionFlow, { leads: [missing] })).rejects.toThrow(
      "Fonte e Campanha",
    );
    const contacts = await database.db
      .select()
      .from(schema.contacts)
      .where(and(eq(schema.contacts.tenantId, tenantId), eq(schema.contacts.email, missing.email)));
    expect(contacts).toHaveLength(0);
  });

  test("cada conversão cria card, reutilizando telefone e CNPJ mesmo entre contatos distintos", async () => {
    const settings: FlowSettings = {
      ...config,
      deduplication: "event",
      eventIdPath: "rd_conversion.id",
      attributionConversion: "last",
      requireAttribution: true,
      mappings: [
        ...defaultMappings,
        { source: "company", target: "company.name" },
        { source: "cnpj", target: "company.document" },
      ],
    };
    const [conversionFlow] = await database.db
      .insert(schema.rdMarketingFlows)
      .values({
        id: randomUUID(),
        tenantId,
        tokenHash: service.hashToken(service.newWebhookToken()),
        settings,
      })
      .returning();
    const conversion = (date: string, campaign: string) => ({
      created_at: date,
      content: { identificador: "orcamento" },
      conversion_origin: { source: "Google", campaign },
    });
    const lead = {
      ...makeLead(),
      mobile_phone: "11976543210",
      company: "Empresa compartilhada",
      cnpj: "45678912000188",
      last_conversion: conversion("2026-10-13T10:00:00-03:00", "Campanha A"),
    };
    const anotherContact = { ...lead, ...makeLead(), mobile_phone: "11981230001" };
    const firstResults = await Promise.all(
      [lead, anotherContact].map((item) => service.receiveLeads(conversionFlow, { leads: [item] })),
    );
    const second = await service.receiveLeads(conversionFlow, {
      leads: [
        {
          ...lead,
          mobile_phone: "+55 (11) 97654-3210",
          last_conversion: conversion("2026-10-13T11:00:00-03:00", "Campanha B"),
        },
      ],
    });
    const resend = await service.receiveLeads(conversionFlow, { leads: [lead] });
    expect(resend[0].status).toBe("duplicate");
    expect(second[0].dealId).not.toBe(firstResults[0][0].dealId);
    const accounts = await database.db
      .select()
      .from(schema.crmAccounts)
      .where(
        and(eq(schema.crmAccounts.tenantId, tenantId), eq(schema.crmAccounts.document, lead.cnpj)),
      );
    expect(accounts).toHaveLength(1);
    const contacts = await database.db
      .select()
      .from(schema.contacts)
      .where(
        and(eq(schema.contacts.tenantId, tenantId), eq(schema.contacts.accountId, accounts[0].id)),
      );
    expect(contacts).toHaveLength(2);
    expect(contacts.filter((contact) => contact.phone === "5511976543210")).toHaveLength(1);
    const cards = await database.db
      .select()
      .from(schema.crmDeals)
      .where(
        and(eq(schema.crmDeals.tenantId, tenantId), eq(schema.crmDeals.accountId, accounts[0].id)),
      );
    expect(cards).toHaveLength(3);
    expect(cards.find((card) => card.id === second[0].dealId)?.campaign).toBe("Campanha B");
  });

  test("reenvios concorrentes criam apenas um card", async () => {
    const lead = makeLead();
    const results = await Promise.all(
      Array.from({ length: 4 }, () => service.receiveLeads(flow, { leads: [lead] })),
    );
    expect(results.filter((r) => r[0].status === "created")).toHaveLength(1);
    expect(new Set(results.map((r) => r[0].dealId)).size).toBe(1);
  });

  test("variações concorrentes de telefone reutilizam o mesmo contato", async () => {
    const leads = [
      { ...makeLead(), mobile_phone: "11998761234" },
      { ...makeLead(), mobile_phone: "1198761234" },
    ];
    const results = await Promise.all(
      leads.map((lead) => service.receiveLeads(flow, { leads: [lead] })),
    );
    const links = await Promise.all(
      results.map((result) =>
        database.db
          .select()
          .from(schema.crmDealContacts)
          .where(
            and(
              eq(schema.crmDealContacts.tenantId, tenantId),
              eq(schema.crmDealContacts.dealId, result[0].dealId!),
            ),
          ),
      ),
    );
    expect(links[0][0].contactId).toBe(links[1][0].contactId);
  });

  test("falha no segundo lead reverte o lote completo e permite reenvio", async () => {
    const settings: FlowSettings = {
      ...config,
      mappings: [
        ...defaultMappings,
        { source: "company", target: "company.name" },
        { source: "cnpj", target: "company.document" },
      ],
    };
    const [batchFlow] = await database.db
      .insert(schema.rdMarketingFlows)
      .values({
        id: randomUUID(),
        tenantId,
        tokenHash: service.hashToken(service.newWebhookToken()),
        settings,
      })
      .returning();
    const lead = { ...makeLead(), company: "Empresa do lote", cnpj: "23456789000166" };
    // Primeiro item cria card/contato/empresa/nota; o segundo conflita com a empresa recém-vinculada.
    const batch = { leads: [lead, { ...lead, uuid: randomUUID(), cnpj: "34567890000177" }] };
    await expect(service.receiveLeads(batchFlow, batch)).rejects.toThrow(
      "documento recebido difere",
    );
    const saved = await database.db
      .select()
      .from(schema.contacts)
      .where(and(eq(schema.contacts.tenantId, tenantId), eq(schema.contacts.email, lead.email)));
    expect(saved).toHaveLength(0);
    const accounts = await database.db
      .select()
      .from(schema.crmAccounts)
      .where(
        and(eq(schema.crmAccounts.tenantId, tenantId), eq(schema.crmAccounts.document, lead.cnpj)),
      );
    expect(accounts).toHaveLength(0);
    expect((await service.receiveLeads(batchFlow, { leads: [lead] }))[0].status).toBe("created");
  });

  test("por evento reusa o contato e cria cards para conversões distintas", async () => {
    const settings: FlowSettings = {
      ...config,
      deduplication: "event",
      eventIdPath: "conversion_id",
    };
    const [eventFlow] = await database.db
      .insert(schema.rdMarketingFlows)
      .values({
        id: randomUUID(),
        tenantId,
        tokenHash: service.hashToken(service.newWebhookToken()),
        settings,
      })
      .returning();
    const lead = makeLead();
    const first = await service.receiveLeads(eventFlow, {
      leads: [{ ...lead, conversion_id: "one" }],
    });
    const second = await service.receiveLeads(eventFlow, {
      leads: [{ ...lead, conversion_id: "two" }],
    });
    expect(first[0].dealId).not.toBe(second[0].dealId);
    expect(
      (await service.receiveLeads(eventFlow, { leads: [{ ...lead, conversion_id: "two" }] }))[0]
        .status,
    ).toBe("duplicate");
    const contacts = await database.db
      .select()
      .from(schema.contacts)
      .where(and(eq(schema.contacts.tenantId, tenantId), eq(schema.contacts.email, lead.email)));
    expect(contacts).toHaveLength(1);
  });

  test("rejeita funil, responsável e campo personalizado de outro tenant", async () => {
    await expect(service.validateFlow(otherTenantId, config)).rejects.toThrow();
    await database.db.insert(schema.operators).values({
      id: "foreign-operator",
      tenantId: otherTenantId,
      name: "Outro",
      email: "other@example.com",
      passwordHash: "test",
    });
    await expect(
      service.validateFlow(tenantId, { ...config, operatorId: "foreign-operator" }),
    ).rejects.toThrow();
    await database.db.insert(schema.crmCustomFieldDefinitions).values({
      id: "foreign-field",
      tenantId: otherTenantId,
      entityType: "deal",
      name: "Outro",
      fieldType: "text",
    });
    await expect(
      service.validateFlow(tenantId, {
        ...config,
        mappings: [
          ...defaultMappings,
          { source: "name", target: "deal.customFields.foreign-field" },
        ],
      }),
    ).rejects.toThrow();
    const others = await database.db
      .select()
      .from(schema.crmDeals)
      .where(eq(schema.crmDeals.tenantId, otherTenantId));
    expect(others).toHaveLength(0);
  });

  test("exige campos obrigatórios sem deixar cadastro parcial", async () => {
    const fieldId = randomUUID();
    await database.db.insert(schema.crmCustomFieldDefinitions).values({
      id: fieldId,
      tenantId,
      entityType: "deal",
      name: "Obrigatório",
      fieldType: "text",
      required: true,
    });
    const lead = makeLead();
    await expect(service.receiveLeads(flow, { leads: [lead] })).rejects.toThrow("Obrigatório");
    const saved = await database.db
      .select()
      .from(schema.contacts)
      .where(and(eq(schema.contacts.tenantId, tenantId), eq(schema.contacts.email, lead.email)));
    expect(saved).toHaveLength(0);
    await database.db
      .update(schema.crmCustomFieldDefinitions)
      .set({ archivedAt: new Date() })
      .where(
        and(
          eq(schema.crmCustomFieldDefinitions.tenantId, tenantId),
          eq(schema.crmCustomFieldDefinitions.id, fieldId),
        ),
      );
  });

  test("configurações exigem sessão admin e ignoram tenant informado pelo cliente", async () => {
    expect(
      (
        await settingsHandlers.GET({
          request: new Request("http://localhost/api/settings/rd-marketing"),
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await settingsHandlers.GET({
          request: new Request("http://localhost/api/settings/rd-marketing", {
            headers: { Cookie: agentCookie },
          }),
        })
      ).status,
    ).toBe(403);
    const response = await settingsHandlers.GET({
      request: new Request(`http://localhost/api/settings/rd-marketing?tenantId=${otherTenantId}`, {
        headers: { Cookie: adminCookie },
      }),
    });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.flows.some((f: any) => f.id === flow.id)).toBe(true);
    expect(JSON.stringify(data)).not.toContain("tokenHash");
    const [foreign] = await database.db
      .insert(schema.rdMarketingFlows)
      .values({
        id: randomUUID(),
        tenantId: otherTenantId,
        tokenHash: service.hashToken(service.newWebhookToken()),
        settings: config,
      })
      .returning();
    const mutation = await settingsHandlers.POST({
      request: new Request("http://localhost/api/settings/rd-marketing", {
        method: "POST",
        headers: { Cookie: adminCookie },
        body: JSON.stringify({ action: "rotate", id: foreign.id, tenantId: otherTenantId }),
      }),
    });
    expect(mutation.status).toBe(404);
    const forbidden = await settingsHandlers.POST({
      request: new Request("http://localhost/api/settings/rd-marketing", {
        method: "POST",
        headers: { Cookie: agentCookie },
        body: JSON.stringify({ action: "save", settings: config }),
      }),
    });
    expect(forbidden.status).toBe(403);
  });

  test("webhook autentica segredo, rejeita JSON inválido e usa apenas destino configurado", async () => {
    const send = (token: string, body: string) =>
      webhookHandler({
        params: { token },
        request: new Request(`http://localhost/api/webhooks/rd-marketing/${token}`, {
          method: "POST",
          body,
        }),
      });
    expect((await send("invalid", "{}")).status).toBe(401);
    expect((await send("f".repeat(64), "{}")).status).toBe(401);
    expect((await send(webhookToken, "invalid json")).status).toBe(400);
    expect((await send(webhookToken, "x".repeat(512 * 1024 + 1))).status).toBe(413);
    const response = await send(
      webhookToken,
      JSON.stringify({
        leads: [
          {
            ...makeLead(),
            tenantId: otherTenantId,
            pipelineId: "foreign",
            stageId: "foreign",
            operatorId: "foreign-operator",
          },
        ],
      }),
    );
    expect(response.status).toBe(200);
    const data = await response.json();
    const [deal] = await database.db
      .select()
      .from(schema.crmDeals)
      .where(
        and(eq(schema.crmDeals.tenantId, tenantId), eq(schema.crmDeals.id, data.results[0].dealId)),
      );
    expect(deal.pipelineId).toBe(pipelineId);
    expect(deal.operatorId).toBeNull();
    await database.db
      .update(schema.rdMarketingFlows)
      .set({ settings: { ...config, enabled: false } })
      .where(
        and(
          eq(schema.rdMarketingFlows.tenantId, tenantId),
          eq(schema.rdMarketingFlows.id, flow.id),
        ),
      );
    expect((await send(webhookToken, JSON.stringify({ leads: [makeLead()] }))).status).toBe(409);
    await database.db
      .update(schema.rdMarketingFlows)
      .set({ settings: config })
      .where(
        and(
          eq(schema.rdMarketingFlows.tenantId, tenantId),
          eq(schema.rdMarketingFlows.id, flow.id),
        ),
      );
    const rotation = await settingsHandlers.POST({
      request: new Request("http://localhost/api/settings/rd-marketing", {
        method: "POST",
        headers: { Cookie: adminCookie },
        body: JSON.stringify({ action: "rotate", id: flow.id }),
      }),
    });
    expect(rotation.status).toBe(200);
    const newToken = (await rotation.json()).webhookUrl.split("/").at(-1);
    expect((await send(webhookToken, JSON.stringify({ leads: [makeLead()] }))).status).toBe(401);
    expect((await send(newToken, JSON.stringify({ leads: [makeLead()] }))).status).toBe(200);
  });

  test("reutiliza empresa e contato entre fluxos, preservando dados existentes", async () => {
    const settings = {
      ...config,
      mappings: [
        ...defaultMappings,
        { source: "company", target: "company.name" },
        { source: "cnpj", target: "company.document" },
      ],
    };
    const [companyFlow] = await database.db
      .insert(schema.rdMarketingFlows)
      .values({
        id: randomUUID(),
        tenantId,
        tokenHash: service.hashToken(service.newWebhookToken()),
        settings,
      })
      .returning();
    const lead = { ...makeLead(), company: "Empresa Teste", cnpj: "12345678000199" };
    const first = await service.receiveLeads(companyFlow, { leads: [lead] });
    const [otherFlow] = await database.db
      .insert(schema.rdMarketingFlows)
      .values({
        id: randomUUID(),
        tenantId,
        tokenHash: service.hashToken(service.newWebhookToken()),
        settings,
      })
      .returning();
    const second = await service.receiveLeads(otherFlow, {
      leads: [{ ...lead, name: "Nome alterado" }],
    });
    const deals = await database.db
      .select()
      .from(schema.crmDeals)
      .where(and(eq(schema.crmDeals.tenantId, tenantId), eq(schema.crmDeals.id, first[0].dealId!)));
    const accounts = await database.db
      .select()
      .from(schema.crmAccounts)
      .where(
        and(eq(schema.crmAccounts.tenantId, tenantId), eq(schema.crmAccounts.document, lead.cnpj)),
      );
    const savedContacts = await database.db
      .select()
      .from(schema.contacts)
      .where(and(eq(schema.contacts.tenantId, tenantId), eq(schema.contacts.email, lead.email)));
    expect(first[0].dealId).not.toBe(second[0].dealId);
    expect(accounts).toHaveLength(1);
    expect(accounts[0].id).toBe(deals[0].accountId);
    expect(savedContacts).toHaveLength(1);
    expect(savedContacts[0].name).toBe("Teste");
    expect(savedContacts[0].accountId).toBe(accounts[0].id);
  });
});
