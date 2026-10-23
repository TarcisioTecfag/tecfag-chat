import { beforeAll, afterAll, describe, expect, test, mock } from "bun:test";
import { and, eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import {
  getDealContext,
  selectDealContext,
  recordConversationAction,
  endDealContext,
  recordDealChangeInConversation,
} from "../src/lib/crm/conversation-deal-context";
import { DEFAULT_ADMIN_PERMISSIONS } from "../src/lib/rbac";
import { readFile } from "node:fs/promises";
import { getContactDealRows } from "../src/lib/crm/contact-deals-query";
import { isCurrentDealEligible, sortContactDeals } from "../src/lib/crm/conversation-deal-policy";

// PostgreSQL WASM: esta suíte nunca abre conexões com bancos operacionais.
describe.skipIf(!process.env.PGLITE_TEST_MODULE)("Negociação atual: PostgreSQL isolado", () => {
  let pg: any, db: any, notes: any, queue: any, contextApi: any, taskApi: any, dealsApi: any;
  let authenticated = true;
  const session: any = {
    tenantId: "context-a",
    operator: { id: "op-a", name: "Operador A", role: "admin" },
    permissions: structuredClone(DEFAULT_ADMIN_PERMISSIONS),
  };
  let serial = 0;
  const fixture = async (count = 1) => {
    const id = `context-${++serial}`;
    await db
      .insert(schema.contacts)
      .values({ id, tenantId: "context-a", name: id, mainChannel: "whatsapp" });
    await db
      .insert(schema.conversations)
      .values({ id, tenantId: "context-a", contactId: id, operatorId: "op-a", queueState: "meus" });
    const deals: string[] = [];
    for (let n = 0; n < count; n++) {
      const dealId = `${id}-deal-${n}`;
      deals.push(dealId);
      await db.insert(schema.crmDeals).values({
        id: dealId,
        tenantId: "context-a",
        title: dealId,
        pipelineId: "pipe-a",
        stageId: "stage-a",
        operatorId: "op-a",
      });
      await db
        .insert(schema.crmConversationDeals)
        .values({ id: `${dealId}-link`, tenantId: "context-a", conversationId: id, dealId });
    }
    return { id, deals };
  };
  const state = (id: string) =>
    db.transaction((tx: any) => getDealContext(tx, "context-a", id, "op-a"));
  const request = (id: string, body: unknown, method = "POST") => ({
    params: { conversationId: id },
    request: new Request("http://localhost/api/chats", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  });
  const events = (dealId: string) =>
    db
      .select()
      .from(schema.crmDealActivities)
      .where(
        and(
          eq(schema.crmDealActivities.tenantId, "context-a"),
          eq(schema.crmDealActivities.dealId, dealId),
        ),
      );

  const auditActions = (dealId: string) =>
    db
      .select()
      .from(schema.crmDealEvents)
      .where(
        and(
          eq(schema.crmDealEvents.tenantId, "context-a"),
          eq(schema.crmDealEvents.dealId, dealId),
          eq(schema.crmDealEvents.eventType, "conversation_action"),
        ),
      );

  beforeAll(async () => {
    const pglite = await import(process.env.PGLITE_TEST_MODULE!);
    mock.module("@electric-sql/pglite", () => pglite);
    const { drizzle } = await import("drizzle-orm/pglite");
    pg = new pglite.PGlite();
    db = drizzle(pg, { schema });
    const { generateDrizzleJson, generateMigration } = await import("drizzle-kit/api");
    const { conversationDealContexts: _newTable, ...legacySchema } = schema;
    for (const statement of await generateMigration(
      generateDrizzleJson({}),
      generateDrizzleJson(legacySchema),
    ))
      await pg.exec(statement);
    const migration = await readFile(
      new URL("../src/db/migrations/0045_conversation_deal_context.sql", import.meta.url),
      "utf8",
    );
    await pg.exec(migration);
    await pg.exec(migration); // DDL idempotente sobre uma base já existente.
    mock.module("../src/db", () => ({
      db,
      client: () => {
        throw new Error("Conexões externas proibidas.");
      },
    }));
    mock.module("../src/lib/auth-session", () => ({
      requireSession: async () =>
        authenticated ? { session } : { response: Response.json({}, { status: 401 }) },
    }));
    mock.module("../src/lib/baileys/session-manager", () => ({
      SessionManager: { getInstance: () => ({ notifyPublic() {} }) },
    }));
    mock.module("../src/lib/audit-service", () => ({
      auditService: { enqueueAudit: async () => {} },
    }));
    mock.module("../src/lib/commercial/tma", () => ({ recordCommercialTransfer: async () => {} }));
    mock.module("../src/lib/valentina/sdr-debouncer", () => ({
      SdrDebouncer: { getInstance: () => ({ clearSession() {} }) },
    }));
    await db.insert(schema.tenants).values([
      { id: "context-a", name: "A", slug: "context-a", connectionType: "meta" },
      { id: "context-b", name: "B", slug: "context-b", connectionType: "meta" },
    ]);
    await db.insert(schema.operators).values([
      {
        id: "op-a",
        tenantId: "context-a",
        name: "Operador A",
        email: "a@example.test",
        passwordHash: "test",
        role: "admin",
      },
      {
        id: "op-b",
        tenantId: "context-a",
        name: "Operador B",
        email: "b@example.test",
        passwordHash: "test",
      },
    ]);
    await db.insert(schema.crmPipelines).values([
      { id: "pipe-a", tenantId: "context-a", name: "Comercial" },
      { id: "pipe-b", tenantId: "context-b", name: "Outro tenant" },
    ]);
    await db.insert(schema.crmStages).values([
      {
        id: "stage-a",
        tenantId: "context-a",
        pipelineId: "pipe-a",
        name: "Entrada",
        orderIndex: 0,
      },
      {
        id: "stage-b",
        tenantId: "context-b",
        pipelineId: "pipe-b",
        name: "Entrada",
        orderIndex: 0,
      },
    ]);
    await db.insert(schema.crmDeals).values({
      id: "foreign-deal",
      tenantId: "context-b",
      title: "Restrito",
      pipelineId: "pipe-b",
      stageId: "stage-b",
    });
    notes = ((await import("../src/routes/api/chats")).Route.options as any).server.handlers.POST;
    queue = ((await import("../src/routes/api/chats/update-queue")).Route.options as any).server
      .handlers.POST;
    contextApi = (
      (await import("../src/routes/api/chats/$conversationId/deal-context")).Route.options as any
    ).server.handlers;
    taskApi = ((await import("../src/routes/api/chats/tag-task")).Route.options as any).server
      .handlers.POST;
    dealsApi = (
      (await import("../src/routes/api/chats/$conversationId/deals")).Route.options as any
    ).server.handlers;
  }, 120000);
  afterAll(async () => {
    mock.restore();
    if (pg) await pg.close();
  });

  test("nove cards do contato aparecem mesmo com apenas dois vínculos diretos; aviso exige seleção e histórico não é elegível", async () => {
    const f = await fixture(9);
    await db.insert(schema.crmDealContacts).values(
      f.deals.map((dealId: string) => ({
        id: `participant-${dealId}`,
        tenantId: "context-a",
        contactId: f.id,
        dealId,
      })),
    );
    for (let i = 2; i < f.deals.length; i++)
      await db
        .delete(schema.crmConversationDeals)
        .where(
          and(
            eq(schema.crmConversationDeals.tenantId, "context-a"),
            eq(schema.crmConversationDeals.dealId, f.deals[i]),
          ),
        );
    for (const [i, status] of [
      [0, "won"],
      [1, "lost"],
      [2, "paused"],
    ] as const)
      await db
        .update(schema.crmDeals)
        .set({ status, createdAt: new Date("2030-01-01T00:00:00Z") })
        .where(and(eq(schema.crmDeals.tenantId, "context-a"), eq(schema.crmDeals.id, f.deals[i])));
    const rows = await getContactDealRows(db, "context-a", f.id);
    expect(rows).toHaveLength(9);
    expect(await getContactDealRows(db, "context-b", f.id)).toHaveLength(0);
    expect(rows.slice(0, 6).every((d) => d.status === "open")).toBe(true);
    expect(rows.slice(6).every((d) => d.status !== "open")).toBe(true);
    const result = await dealsApi.GET({
      params: { conversationId: f.id },
      request: new Request("http://localhost/api/chats/" + f.id + "/deals"),
    });
    expect(result.status).toBe(200);
    expect((await result.json()).deals.map((d: any) => d.id)).toEqual(rows.map((d) => d.id));
    const before = await dealsApi.GET({
      params: { conversationId: f.id },
      request: new Request("http://localhost/api/chats/" + f.id + "/deals?statusOnly=1"),
    });
    expect(await before.json()).toMatchObject({
      dealRequired: false,
      currentDealRequired: true,
      eligibleCount: 6,
    });
    const contextResponse = await contextApi.GET({
      params: { conversationId: f.id },
      request: new Request("http://localhost"),
    });
    const options = await contextResponse.json();
    expect(options.deals).toHaveLength(9);
    expect(options.deals.filter(isCurrentDealEligible)).toHaveLength(6);
    expect(options.hasCurrentDeal).toBe(false);
    expect(
      (
        await contextApi.PATCH(
          request(f.id, { dealId: f.deals[0], expectedVersion: options.version }, "PATCH"),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await contextApi.PATCH(
          request(f.id, { dealId: f.deals[3], expectedVersion: options.version }, "PATCH"),
        )
      ).status,
    ).toBe(200);
    const after = await dealsApi.GET({
      params: { conversationId: f.id },
      request: new Request("http://localhost/api/chats/" + f.id + "/deals?statusOnly=1"),
    });
    expect((await after.json()).currentDealRequired).toBe(false);
    expect((await state(f.id)).context.currentDealId).toBe(f.deals[3]);
  });
  test("leitura canônica não duplica cards e mantém desvinculados somente no histórico", async () => {
    const f = await fixture(2);
    await db.insert(schema.crmDealContacts).values({
      id: `participant-${f.deals[0]}`,
      tenantId: "context-a",
      contactId: f.id,
      dealId: f.deals[0],
    });
    await db
      .update(schema.crmConversationDeals)
      .set({ isActive: false })
      .where(
        and(
          eq(schema.crmConversationDeals.tenantId, "context-a"),
          eq(schema.crmConversationDeals.dealId, f.deals[1]),
        ),
      );
    const rows = await getContactDealRows(db, "context-a", f.id);
    expect(rows).toHaveLength(2);
    expect(rows.find((d) => d.id === f.deals[1])?.isLinked).toBe(false);
    expect((await state(f.id)).context.currentDealId).toBe(f.deals[0]);
    expect(rows.filter(isCurrentDealEligible).map((d) => d.id)).toEqual([f.deals[0]]);
  });
  test("ordenar lista nunca promove card concluído, mesmo sendo o aberto em visualização", () => {
    const sorted = sortContactDeals([
      { id: "won", status: "won", createdAt: "2026-10-23" },
      { id: "open-old", status: "open", createdAt: "2026-10-21" },
      { id: "lost", status: "lost", createdAt: "2026-10-22" },
      { id: "open-new", status: "open", createdAt: "2026-10-22" },
    ]);
    expect(sorted.map((d) => d.id)).toEqual(["open-new", "open-old", "won", "lost"]);
  });
  test("seleção automática única é persistente; um segundo card não a substitui", async () => {
    const f = await fixture();
    const first = await state(f.id);
    expect(first.context.currentDealId).toBe(f.deals[0]);
    const revision = first.context.version;
    await db.insert(schema.crmDeals).values({
      id: `${f.id}-new`,
      tenantId: "context-a",
      title: "Novo",
      pipelineId: "pipe-a",
      stageId: "stage-a",
    });
    await db.insert(schema.crmConversationDeals).values({
      id: `${f.id}-new-link`,
      tenantId: "context-a",
      conversationId: f.id,
      dealId: `${f.id}-new`,
    });
    expect((await state(f.id)).context).toMatchObject({
      currentDealId: f.deals[0],
      version: revision,
    });
  });
  test("zero ou vários cards não são escolhidos arbitrariamente", async () => {
    for (const count of [0, 2, 4])
      expect((await state((await fixture(count)).id)).context.currentDealId).toBeNull();
  });
  test("troca manual preserva ações anteriores e rejeita seleção de aba desatualizada", async () => {
    const f = await fixture(2);
    const initial = await state(f.id);
    const selected = await db.transaction((tx: any) =>
      selectDealContext(tx, "context-a", f.id, f.deals[0], "op-a", initial.context.version),
    );
    await db.transaction((tx: any) =>
      recordConversationAction(tx, {
        tenantId: "context-a",
        conversationId: f.id,
        dealId: f.deals[0],
        operatorId: "op-a",
        messageId: "historic-note",
        content: "Primeiro assunto",
        type: "note",
      }),
    );
    await db.transaction((tx: any) =>
      selectDealContext(tx, "context-a", f.id, f.deals[1], "op-a", selected.version),
    );
    await expect(
      db.transaction((tx: any) =>
        selectDealContext(tx, "context-a", f.id, f.deals[0], "op-a", selected.version),
      ),
    ).rejects.toThrow("mudou");
    expect((await events(f.deals[0]))[0].description).toBe("Primeiro assunto");
    expect(await events(f.deals[1])).toHaveLength(0);
  });
  test("ganha, perdida, pausada e desvinculada exigem nova escolha sem promover outro card", async () => {
    for (const status of ["won", "lost", "paused", "unlinked"]) {
      const f = await fixture(2);
      const initial = await state(f.id);
      await db.transaction((tx: any) =>
        selectDealContext(tx, "context-a", f.id, f.deals[0], "op-a", initial.context.version),
      );
      if (status === "unlinked")
        await db
          .update(schema.crmConversationDeals)
          .set({ isActive: false })
          .where(
            and(
              eq(schema.crmConversationDeals.tenantId, "context-a"),
              eq(schema.crmConversationDeals.dealId, f.deals[0]),
            ),
          );
      else
        await db
          .update(schema.crmDeals)
          .set({ status })
          .where(
            and(eq(schema.crmDeals.tenantId, "context-a"), eq(schema.crmDeals.id, f.deals[0])),
          );
      expect((await state(f.id)).context).toMatchObject({
        currentDealId: null,
        previousDealId: f.deals[0],
        selectionRequired: true,
      });
    }
  });
  test("API de notas grava no card atual e é idempotente; ID enviado pelo cliente não redireciona", async () => {
    const f = await fixture();
    const context = await state(f.id);
    const body = {
      conversationId: f.id,
      content: "Nota comercial",
      isInternalNote: true,
      expectedContextVersion: context.context.version,
      clientMessageId: "note-retry-1",
      dealId: "foreign-deal",
      tenantId: "context-b",
    };
    const response = await notes(request(f.id, body));
    expect(response.status).toBe(200);
    expect((await notes(request(f.id, body))).status).toBe(200);
    expect(await events(f.deals[0])).toHaveLength(1);
    expect((await events(f.deals[0]))[0]).toMatchObject({
      tenantId: "context-a",
      description: "Nota comercial",
    });
  });
  test("nota com contexto antigo é recusada sem salvar; nota geral fica só na conversa", async () => {
    const f = await fixture();
    const context = await state(f.id);
    const body = {
      conversationId: f.id,
      content: "Contexto antigo",
      isInternalNote: true,
      expectedContextVersion: context.context.version - 1,
    };
    expect((await notes(request(f.id, body))).status).toBe(409);
    expect(await events(f.deals[0])).toHaveLength(0);
    expect((await notes(request(f.id, { ...body, noteScope: "general" }))).status).toBe(200);
    expect(await events(f.deals[0])).toHaveLength(0);
  });
  test("transferência mantém card e responsável comercial; encerramento registra sem ganhar/perder", async () => {
    const f = await fixture();
    const ctx = await state(f.id);
    await db
      .insert(schema.sectors)
      .values({ id: `${f.id}-sector`, tenantId: "context-a", name: "Pós-venda" });
    let response = await queue(
      request(f.id, {
        conversationId: f.id,
        queueState: "fila",
        sectorId: `${f.id}-sector`,
        expectedVersion: 1,
        expectedContextVersion: ctx.context.version,
      }),
    );
    expect(response.status).toBe(200);
    expect((await state(f.id)).context.currentDealId).toBe(f.deals[0]);
    const captured = await queue(
      request(f.id, {
        conversationId: f.id,
        queueState: "meus",
        operatorId: "op-a",
        expectedVersion: 2,
      }),
    );
    expect(captured.status).toBe(200);
    response = await queue(
      request(f.id, {
        conversationId: f.id,
        queueState: "finalizados",
        expectedVersion: 3,
        expectedContextVersion: ctx.context.version,
      }),
    );
    expect(response.status).toBe(200);
    const [deal] = await db
      .select()
      .from(schema.crmDeals)
      .where(and(eq(schema.crmDeals.tenantId, "context-a"), eq(schema.crmDeals.id, f.deals[0])));
    expect(deal).toMatchObject({ status: "open", operatorId: "op-a" });
    expect(await auditActions(f.deals[0])).toHaveLength(3);
    expect(await events(f.deals[0])).toHaveLength(0);
    const ended = (await state(f.id)).context;
    expect(ended).toMatchObject({
      currentDealId: null,
      previousDealId: f.deals[0],
      selectionRequired: true,
    });
    expect(
      (
        await queue(
          request(f.id, {
            conversationId: f.id,
            queueState: "meus",
            operatorId: "op-a",
            expectedVersion: 4,
          }),
        )
      ).status,
    ).toBe(200);
    expect((await state(f.id)).context.currentDealId).toBeNull();
  });
  test("isolamento, autenticação e propriedade também se aplicam à seleção", async () => {
    const f = await fixture();
    const ctx = await state(f.id);
    expect(
      (
        await contextApi.PATCH(
          request(f.id, { dealId: "foreign-deal", expectedVersion: ctx.context.version }, "PATCH"),
        )
      ).status,
    ).toBe(404);
    authenticated = false;
    expect(
      (
        await contextApi.GET({
          params: { conversationId: f.id },
          request: new Request("http://localhost"),
        })
      ).status,
    ).toBe(401);
    authenticated = true;
    await db
      .update(schema.conversations)
      .set({ operatorId: "op-b" })
      .where(
        and(eq(schema.conversations.tenantId, "context-a"), eq(schema.conversations.id, f.id)),
      );
    expect(
      (
        await contextApi.PATCH(
          request(f.id, { dealId: f.deals[0], expectedVersion: ctx.context.version }, "PATCH"),
        )
      ).status,
    ).toBe(403);
    await expect(
      db.transaction((tx: any) => getDealContext(tx, "context-b", f.id, "op-a")),
    ).rejects.toThrow("não encontrada");
  });
  test("ações do CRM refletem apenas na conversa que usa o card como contexto", async () => {
    const f = await fixture(2);
    const initial = await state(f.id);
    await db.transaction((tx: any) =>
      selectDealContext(tx, "context-a", f.id, f.deals[0], "op-a", initial.context.version),
    );
    await db.transaction((tx: any) =>
      recordDealChangeInConversation(tx, "context-a", f.deals[1], "Não deve aparecer"),
    );
    await db.transaction((tx: any) =>
      recordDealChangeInConversation(tx, "context-a", f.deals[0], "Negociação ganha no CRM"),
    );
    const all = await db
      .select()
      .from(schema.messages)
      .where(
        and(eq(schema.messages.tenantId, "context-a"), eq(schema.messages.conversationId, f.id)),
      );
    expect(all.some((m: any) => m.content === "Negociação ganha no CRM")).toBe(true);
    expect(all.some((m: any) => m.content === "Não deve aparecer")).toBe(false);
  });
  test("exclusão da negociação selecionada não promove automaticamente outro card", async () => {
    const f = await fixture(2);
    const initial = await state(f.id);
    await db.transaction((tx: any) =>
      selectDealContext(tx, "context-a", f.id, f.deals[0], "op-a", initial.context.version),
    );
    await db
      .delete(schema.crmDeals)
      .where(and(eq(schema.crmDeals.tenantId, "context-a"), eq(schema.crmDeals.id, f.deals[0])));
    expect((await state(f.id)).context.currentDealId).toBeNull();
  });
  test("tarefas usam o card atual, sem exigir integração RD, e rejeitam contexto antigo", async () => {
    const f = await fixture();
    const ctx = await state(f.id);
    const body = {
      conversationId: f.id,
      tagName: "Retornar ao cliente",
      dueDate: "2026-11-01",
      dueTime: "09:00",
      expectedContextVersion: ctx.context.version,
    };
    expect((await taskApi(request(f.id, { ...body, expectedContextVersion: 0 }))).status).toBe(409);
    expect((await taskApi(request(f.id, body))).status).toBe(200);
    expect((await events(f.deals[0]))[0]).toMatchObject({
      title: body.tagName,
      conversationId: f.id,
    });
  });
  test("transferência com mudança de assunto registra origem e muda destino atomicamente", async () => {
    const f = await fixture(2);
    const initial = await state(f.id);
    const selected = await db.transaction((tx: any) =>
      selectDealContext(tx, "context-a", f.id, f.deals[0], "op-a", initial.context.version),
    );
    const body = {
      conversationId: f.id,
      queueState: "meus",
      operatorId: "op-b",
      nextDealId: f.deals[1],
      expectedVersion: 0,
      expectedContextVersion: selected.version,
    };
    expect((await queue(request(f.id, body))).status).toBe(409);
    expect((await state(f.id)).context.currentDealId).toBe(f.deals[0]);
    expect(await events(f.deals[0])).toHaveLength(0);
    expect((await queue(request(f.id, { ...body, expectedVersion: 1 }))).status).toBe(200);
    expect((await state(f.id)).context.currentDealId).toBe(f.deals[1]);
    expect(await auditActions(f.deals[0])).toHaveLength(1);
    expect(await auditActions(f.deals[1])).toHaveLength(0);
  });
  test("seleção rejeita um card do mesmo tenant que não pertence à conversa", async () => {
    const f = await fixture();
    const unrelated = await fixture();
    const initial = await state(f.id);
    await expect(
      db.transaction((tx: any) =>
        selectDealContext(
          tx,
          "context-a",
          f.id,
          unrelated.deals[0],
          "op-a",
          initial.context.version,
        ),
      ),
    ).rejects.toThrow("vinculada");
  });
  test("transferência com seleção antiga ou inexistente é recusada sem alterar a fila", async () => {
    const f = await fixture(2);
    const ctx = await state(f.id);
    const body = {
      conversationId: f.id,
      queueState: "fila",
      expectedVersion: 1,
      expectedContextVersion: ctx.context.version,
    };
    expect((await queue(request(f.id, body))).status).toBe(409);
    await db.transaction((tx: any) =>
      selectDealContext(tx, "context-a", f.id, f.deals[0], "op-a", ctx.context.version),
    );
    expect((await queue(request(f.id, body))).status).toBe(409);
    const [conversation] = await db
      .select()
      .from(schema.conversations)
      .where(
        and(eq(schema.conversations.tenantId, "context-a"), eq(schema.conversations.id, f.id)),
      );
    expect(conversation).toMatchObject({ queueState: "meus", version: 1 });
  });
});
