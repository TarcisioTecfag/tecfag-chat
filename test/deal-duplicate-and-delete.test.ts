import { describe, expect, test, beforeAll, afterAll, mock } from "bun:test";
import { and, eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import { DEFAULT_ADMIN_PERMISSIONS, hasCrmPermission } from "../src/lib/rbac";
import { formatDealEvent } from "../src/lib/crm/deal-event-format";
import { getActionLabel } from "../src/lib/crm/action-history-meta";

describe("deal duplicate & delete helpers (unit)", () => {
  test("hasCrmPermission respeita canDeleteDeals para não-admin e libera para admin", () => {
    const sellerPerms = structuredClone(DEFAULT_ADMIN_PERMISSIONS);
    sellerPerms.crm.canDeleteDeals = false;
    sellerPerms.crm.canCreateDeals = true;

    expect(hasCrmPermission(sellerPerms, "canDeleteDeals", "operator")).toBe(false);
    expect(hasCrmPermission(sellerPerms, "canCreateDeals", "operator")).toBe(true);
    expect(hasCrmPermission(sellerPerms, "canDeleteDeals", "admin")).toBe(true);

    sellerPerms.crm.canDeleteDeals = true;
    expect(hasCrmPermission(sellerPerms, "canDeleteDeals", "operator")).toBe(true);
  });

  test("formata eventos de duplicação e rótulo no histórico de ações", () => {
    const emptyMap = new Map<string, string>();
    const createdCopy = formatDealEvent(
      { eventType: "created", metadata: { duplicatedFromTitle: "Venda Original" } },
      emptyMap,
      emptyMap,
    );
    expect(createdCopy.title).toBe("Negociação duplicada");
    expect(createdCopy.description).toContain("Venda Original");

    const originEvt = formatDealEvent(
      { eventType: "deal_duplicated", metadata: { duplicatedTitle: "Venda Original (Cópia)" } },
      emptyMap,
      emptyMap,
    );
    expect(originEvt.title).toBe("Negociação duplicada");
    expect(originEvt.description).toContain("Venda Original (Cópia)");
    expect(getActionLabel("duplicate_deal")).toBe("Negociação duplicada");
  });
});

describe("duplicar e excluir negociação no PostgreSQL (PGlite) com isolamento multi-tenant", () => {
  let pg: any;
  let db: any;
  let crmService: any;
  let duplicatePost: (args: any) => Promise<Response>;
  let dealDelete: (args: any) => Promise<Response>;

  const activeSession = {
    tenantId: "tenant-alpha",
    operator: { id: "op-alpha-admin", role: "admin", name: "Gestor Alpha" },
    permissions: structuredClone(DEFAULT_ADMIN_PERMISSIONS),
  };

  beforeAll(async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle } = await import("drizzle-orm/pglite");
    pg = new PGlite();
    db = drizzle(pg, { schema });

    const { generateDrizzleJson, generateMigration } = await import("drizzle-kit/api");
    const statements = await generateMigration(
      generateDrizzleJson({}),
      generateDrizzleJson(schema),
    );
    for (const statement of statements) {
      await pg.exec(statement);
    }

    mock.module("../src/db", () => ({
      db,
      client: () => {
        throw new Error("Conexões externas são proibidas nesta suíte.");
      },
    }));

    const authModule = await import("../src/lib/auth-session");
    mock.module("../src/lib/auth-session", () => ({
      ...authModule,
      requireSession: async () => ({ session: activeSession }),
    }));

    const crmMod = await import("../src/lib/crm/crm-service");
    crmService = crmMod.crmService;

    const dupRoute = await import("../src/routes/api/crm/deals/$dealId/duplicate");
    duplicatePost = (dupRoute.Route.options as any).server.handlers.POST;

    const dealRoute = await import("../src/routes/api/crm/deals/$dealId");
    dealDelete = (dealRoute.Route.options as any).server.handlers.DELETE;

    // Seed dois tenants para garantir isolamento 100%
    for (const t of [
      { id: "tenant-alpha", name: "Alpha", slug: "alpha" },
      { id: "tenant-beta", name: "Beta", slug: "beta" },
    ]) {
      await db.insert(schema.tenants).values({
        id: t.id,
        name: t.name,
        slug: t.slug,
        connectionType: "meta",
      });
    }

    await db.insert(schema.operators).values([
      {
        id: "op-alpha-admin",
        tenantId: "tenant-alpha",
        name: "Gestor Alpha",
        email: "admin@alpha.test",
        passwordHash: "hash",
        role: "admin",
      },
      {
        id: "op-alpha-seller",
        tenantId: "tenant-alpha",
        name: "Vendedor Alpha",
        email: "seller@alpha.test",
        passwordHash: "hash",
        role: "operator",
      },
      {
        id: "op-beta-admin",
        tenantId: "tenant-beta",
        name: "Gestor Beta",
        email: "admin@beta.test",
        passwordHash: "hash",
        role: "admin",
      },
    ]);

    await db.insert(schema.crmPipelines).values([
      { id: "pipe-alpha", tenantId: "tenant-alpha", name: "Funil Alpha" },
      { id: "pipe-beta", tenantId: "tenant-beta", name: "Funil Beta" },
    ]);

    await db.insert(schema.crmStages).values([
      { id: "stg-a-1", tenantId: "tenant-alpha", pipelineId: "pipe-alpha", name: "Novo", orderIndex: 0 },
      { id: "stg-a-2", tenantId: "tenant-alpha", pipelineId: "pipe-alpha", name: "Proposta", orderIndex: 1 },
      { id: "stg-a-win", tenantId: "tenant-alpha", pipelineId: "pipe-alpha", name: "Ganho", orderIndex: 2, isWinStage: true },
      { id: "stg-b-1", tenantId: "tenant-beta", pipelineId: "pipe-beta", name: "Novo Beta", orderIndex: 0 },
    ]);

    await db.insert(schema.crmAccounts).values({
      id: "acc-alpha",
      tenantId: "tenant-alpha",
      name: "Indústria Alpha Ltda",
      type: "company",
      document: "02421911000118",
      documentType: "cnpj",
    });

    await db.insert(schema.contacts).values([
      {
        id: "cont-alpha-1",
        tenantId: "tenant-alpha",
        name: "Maria Compradora",
        phone: "5514999990001",
        mainChannel: "whatsapp",
        accountId: "acc-alpha",
      },
      {
        id: "cont-beta-1",
        tenantId: "tenant-beta",
        name: "João Beta",
        phone: "5514999990002",
        mainChannel: "whatsapp",
      },
    ]);

    await db.insert(schema.crmCustomFieldDefinitions).values([
      {
        id: "cf-unique-code",
        tenantId: "tenant-alpha",
        entityType: "deal",
        name: "Código Pedido Único",
        fieldType: "text",
        isUnique: true,
        isRequired: false,
      },
      {
        id: "cf-segment",
        tenantId: "tenant-alpha",
        entityType: "deal",
        name: "Segmento",
        fieldType: "text",
        isUnique: false,
        isRequired: false,
      },
    ]);

    await db.insert(schema.crmDeals).values([
      {
        id: "deal-alpha-origin",
        tenantId: "tenant-alpha",
        title: "Seladora TC-500",
        accountId: "acc-alpha",
        pipelineId: "pipe-alpha",
        stageId: "stg-a-win",
        status: "won",
        value: "18500.00",
        operatorId: "op-alpha-seller",
        source: "Google Ads",
        campaign: "Black",
        rating: 4,
        rdDealId: "rd-12345",
        customFields: {
          "cf-unique-code": "PED-999",
          "cf-segment": "Alimentos",
        },
      },
      {
        id: "deal-beta-only",
        tenantId: "tenant-beta",
        title: "Negócio Beta",
        pipelineId: "pipe-beta",
        stageId: "stg-b-1",
        status: "open",
        operatorId: "op-beta-admin",
      },
    ]);

    await db.insert(schema.crmDealContacts).values([
      {
        id: "dc-alpha-1",
        tenantId: "tenant-alpha",
        dealId: "deal-alpha-origin",
        contactId: "cont-alpha-1",
        role: "decision_maker",
        isPrimary: true,
      },
      {
        id: "dc-beta-1",
        tenantId: "tenant-beta",
        dealId: "deal-beta-only",
        contactId: "cont-beta-1",
        role: "buyer",
        isPrimary: true,
      },
    ]);

    await db.insert(schema.crmDealProducts).values({
      id: "dp-alpha-1",
      tenantId: "tenant-alpha",
      dealId: "deal-alpha-origin",
      name: "Seladora Automática TC-500",
      quantity: "2.000",
      unitPrice: "9250.00",
      discountPercent: "0.00",
      totalPrice: "18500.00",
    });
  }, 120000);

  afterAll(async () => {
    mock.restore();
    if (pg) await pg.close();
  });

  test("duplica negociação copiando contatos, produtos e campos não-únicos, removendo campo único e iniciando em status open fora de etapa terminal", async () => {
    const req = new Request("http://test/api/crm/deals/deal-alpha-origin/duplicate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Seladora TC-500 - Renovação", copyProducts: true }),
    });

    const res = await duplicatePost({ request: req, params: { dealId: "deal-alpha-origin" } });
    expect(res.status).toBe(201);
    const data = await res.json();

    expect(data.deal.id).not.toBe("deal-alpha-origin");
    expect(data.deal.tenantId).toBe("tenant-alpha");
    expect(data.deal.title).toBe("Seladora TC-500 - Renovação");
    expect(data.deal.status).toBe("open");
    // Estava em etapa de ganho (stg-a-win) -> deve ir para primeira etapa aberta (stg-a-1)
    expect(data.deal.stageId).toBe("stg-a-1");
    expect(data.deal.value).toBe("18500.00");
    expect(data.deal.rdDealId).toBeNull();
    expect(data.deal.customFields["cf-segment"]).toBe("Alimentos");
    expect(data.deal.customFields["cf-unique-code"]).toBeUndefined();
    expect(data.omittedUniqueFields).toEqual(["Código Pedido Único"]);
    expect(data.copiedContactsCount).toBe(1);
    expect(data.copiedProductsCount).toBe(1);

    const copiedContacts = await db
      .select()
      .from(schema.crmDealContacts)
      .where(
        and(
          eq(schema.crmDealContacts.tenantId, "tenant-alpha"),
          eq(schema.crmDealContacts.dealId, data.deal.id),
        ),
      );
    expect(copiedContacts).toHaveLength(1);
    expect(copiedContacts[0].role).toBe("decision_maker");
    expect(copiedContacts[0].isPrimary).toBe(true);

    const copiedProducts = await db
      .select()
      .from(schema.crmDealProducts)
      .where(
        and(
          eq(schema.crmDealProducts.tenantId, "tenant-alpha"),
          eq(schema.crmDealProducts.dealId, data.deal.id),
        ),
      );
    expect(copiedProducts).toHaveLength(1);
    expect(copiedProducts[0].name).toBe("Seladora Automática TC-500");

    // Isolamento multi-tenant: não permite duplicar deal de outro tenant
    const crossTenantRes = await duplicatePost({
      request: new Request("http://test/api/crm/deals/deal-beta-only/duplicate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
      params: { dealId: "deal-beta-only" },
    });
    expect(crossTenantRes.status).toBe(404);

    // Operador sem permissão canDeleteDeals recebe 403 no DELETE
    activeSession.operator = { id: "op-alpha-seller", role: "operator", name: "Vendedor Alpha" };
    activeSession.permissions = structuredClone(DEFAULT_ADMIN_PERMISSIONS);
    activeSession.permissions.crm.canDeleteDeals = false;

    const deniedDelRes = await dealDelete({
      request: new Request(`http://test/api/crm/deals/${data.deal.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "delete_permanent" }),
      }),
      params: { dealId: data.deal.id },
    });
    expect(deniedDelRes.status).toBe(403);

    // Com permissão canDeleteDeals, consegue excluir permanentemente a cópia (contato ainda tem o deal original!)
    activeSession.permissions.crm.canDeleteDeals = true;
    const allowedDelRes = await dealDelete({
      request: new Request(`http://test/api/crm/deals/${data.deal.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "delete_permanent" }),
      }),
      params: { dealId: data.deal.id },
    });
    expect(allowedDelRes.status).toBe(200);

    const [stillExists] = await db
      .select({ id: schema.crmDeals.id })
      .from(schema.crmDeals)
      .where(and(eq(schema.crmDeals.tenantId, "tenant-alpha"), eq(schema.crmDeals.id, data.deal.id)));
    expect(stillExists).toBeUndefined();

    // Deal do outro tenant segue 100% intacto e inacessível
    const crossTenantDelRes = await dealDelete({
      request: new Request("http://test/api/crm/deals/deal-beta-only", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "delete_trash" }),
      }),
      params: { dealId: "deal-beta-only" },
    });
    expect(crossTenantDelRes.status).toBe(404);
  });
});
