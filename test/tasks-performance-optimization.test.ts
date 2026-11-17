import { beforeAll, afterAll, describe, expect, test, mock } from "bun:test";
import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import { DEFAULT_ADMIN_PERMISSIONS } from "../src/lib/rbac";

describe("Otimização de Performance e Isolamento Multi-Tenant de Tarefas (/api/tasks)", () => {
  let pg: any;
  let db: any;
  let tasksGetHandler: (args: any) => Promise<Response>;
  let tasksPutHandler: (args: any) => Promise<Response>;
  let operatorsGetHandler: (args: any) => Promise<Response>;

  let activeSession = {
    tenantId: "tenant-a",
    operator: {
      id: "op-admin-a",
      tenantId: "tenant-a",
      role: "admin",
      name: "Admin A",
      email: "admin@tenant-a.test",
    },
    permissions: structuredClone(DEFAULT_ADMIN_PERMISSIONS),
  };

  beforeAll(async () => {
    const pglite = await import("@electric-sql/pglite");
    const { PGlite } = pglite;
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

    const perfMigrationSql = await readFile(
      new URL("../src/db/migrations/0060_tasks_performance_optimization.sql", import.meta.url),
      "utf8",
    );
    // Executa duas vezes para validar idempotência dos índices IF NOT EXISTS
    await pg.exec(perfMigrationSql);
    await pg.exec(perfMigrationSql);

    mock.module("@/db", () => ({
      db,
      client: () => {
        throw new Error("Conexões externas são proibidas nesta suíte.");
      },
    }));
    mock.module("../src/db", () => ({
      db,
      client: () => {
        throw new Error("Conexões externas são proibidas nesta suíte.");
      },
    }));

    const authModule = await import("../src/lib/auth-session");
    const mockedAuth = {
      ...authModule,
      requireSession: async () => ({ session: activeSession }),
    };
    mock.module("@/lib/auth-session", () => mockedAuth);
    mock.module("../src/lib/auth-session", () => mockedAuth);

    await db.insert(schema.tenants).values([
      { id: "tenant-a", name: "Tenant A", slug: "tenant-a", connectionType: "meta" },
      { id: "tenant-b", name: "Tenant B", slug: "tenant-b", connectionType: "baileys" },
    ]);

    const hugeBase64Avatar = "data:image/png;base64," + "A".repeat(220_000);

    await db.insert(schema.operators).values([
      {
        id: "op-admin-a",
        tenantId: "tenant-a",
        name: "Admin A",
        email: "admin@tenant-a.test",
        passwordHash: "hash",
        role: "admin",
        avatar: hugeBase64Avatar,
        isActive: true,
      },
      {
        id: "op-consultor-a",
        tenantId: "tenant-a",
        name: "Beatriz Consultora",
        email: "beatriz@tenant-a.test",
        passwordHash: "hash",
        role: "agent",
        avatar: hugeBase64Avatar,
        isActive: true,
      },
      {
        id: "op-admin-b",
        tenantId: "tenant-b",
        name: "Admin B",
        email: "admin@tenant-b.test",
        passwordHash: "hash",
        role: "admin",
        avatar: hugeBase64Avatar,
        isActive: true,
      },
    ]);

    await db.insert(schema.crmPipelines).values([
      { id: "pipe-a", tenantId: "tenant-a", name: "Funil Comercial A" },
      { id: "pipe-b", tenantId: "tenant-b", name: "Funil Comercial B" },
    ]);

    await db.insert(schema.crmStages).values([
      { id: "stage-a", tenantId: "tenant-a", pipelineId: "pipe-a", name: "Proposta Enviada", orderIndex: 0 },
      { id: "stage-b", tenantId: "tenant-b", pipelineId: "pipe-b", name: "Qualificação", orderIndex: 0 },
    ]);

    await db.insert(schema.crmAccounts).values({
      id: "acc-a1",
      tenantId: "tenant-a",
      type: "company",
      name: "Indústria Seladora Sul Ltda",
    });

    await db.insert(schema.contacts).values([
      {
        id: "contact-sec-1",
        tenantId: "tenant-a",
        accountId: "acc-a1",
        name: "Contato Secundário 1",
        phone: "5511911111111",
        mainChannel: "whatsapp",
      },
      {
        id: "contact-primary",
        tenantId: "tenant-a",
        accountId: "acc-a1",
        name: "Antonio Comprador Principal",
        phone: "5514999011195",
        mainChannel: "whatsapp",
      },
      {
        id: "contact-sec-2",
        tenantId: "tenant-a",
        accountId: "acc-a1",
        name: "Contato Secundário 2",
        phone: "5511922222222",
        mainChannel: "whatsapp",
      },
    ]);

    // Duas conexões WhatsApp + duas conversas para o contato principal: deve resolver sempre a mais recente
    await db.insert(schema.whatsappConnections).values([
      { id: "wconn-1", tenantId: "tenant-a", name: "Canal Antigo", provider: "meta" },
      { id: "wconn-2", tenantId: "tenant-a", name: "Canal Principal", provider: "meta" },
    ]);

    await db.insert(schema.conversations).values([
      {
        id: "conv-old",
        tenantId: "tenant-a",
        contactId: "contact-primary",
        whatsappConnectionId: "wconn-1",
        updatedAt: new Date("2026-01-10T10:00:00.000Z"),
      },
      {
        id: "conv-latest",
        tenantId: "tenant-a",
        contactId: "contact-primary",
        whatsappConnectionId: "wconn-2",
        updatedAt: new Date("2026-11-10T15:30:00.000Z"),
      },
    ]);

    await db.insert(schema.crmDeals).values([
      {
        id: "deal-a1",
        tenantId: "tenant-a",
        pipelineId: "pipe-a",
        stageId: "stage-a",
        accountId: "acc-a1",
        operatorId: "op-consultor-a",
        title: "0025145 - Seladora Contínua Industrial",
        value: "18500.00",
        status: "open",
      },
      {
        id: "deal-b1",
        tenantId: "tenant-b",
        pipelineId: "pipe-b",
        stageId: "stage-b",
        operatorId: "op-admin-b",
        title: "Negócio Isolado Tenant B",
        value: "9000.00",
        status: "open",
      },
    ]);

    // 3 contatos vinculados à mesma negociação (para garantir ausência de multiplicação N:M)
    await db.insert(schema.crmDealContacts).values([
      { id: "dc-1", tenantId: "tenant-a", dealId: "deal-a1", contactId: "contact-sec-1", isPrimary: false },
      { id: "dc-2", tenantId: "tenant-a", dealId: "deal-a1", contactId: "contact-primary", isPrimary: true },
      { id: "dc-3", tenantId: "tenant-a", dealId: "deal-a1", contactId: "contact-sec-2", isPrimary: false },
    ]);

    const nowMs = Date.now();
    const past2024 = new Date("2024-06-15T12:00:00.000Z");
    const overdueOldWindow = new Date(nowMs - 120 * 24 * 60 * 60 * 1000); // 120 dias atrás (fora da janela atual)
    const overdueCurrentWindow = new Date(nowMs - 2 * 60 * 60 * 1000);   // 2 horas atrás (dentro da janela atual)
    const futureCurrentWindow = new Date(nowMs + 24 * 60 * 60 * 1000);   // Amanhã (dentro da janela atual)
    const completedCurrentWindow = new Date(nowMs - 3 * 60 * 60 * 1000); // Concluída hoje

    await db.insert(schema.crmDealActivities).values([
      // Histórico antigo concluído (2024)
      {
        id: "act-hist-1",
        tenantId: "tenant-a",
        dealId: "deal-a1",
        operatorId: "op-consultor-a",
        assignedToOperatorId: "op-consultor-a",
        type: "call",
        title: "Ligação Histórica 2024 #1",
        status: "completed",
        dueDate: past2024,
        completedAt: past2024,
      },
      {
        id: "act-hist-2",
        tenantId: "tenant-a",
        dealId: "deal-a1",
        operatorId: "op-consultor-a",
        assignedToOperatorId: "op-consultor-a",
        type: "email",
        title: "Email Histórico 2024 #2",
        status: "completed",
        dueDate: past2024,
        completedAt: past2024,
      },
      // Atrasadas antigas fora da janela de 3 meses
      {
        id: "act-overdue-old-1",
        tenantId: "tenant-a",
        dealId: "deal-a1",
        operatorId: "op-consultor-a",
        assignedToOperatorId: "op-consultor-a",
        type: "task",
        title: "Cobrança Atrasada Antiga #1",
        status: "pending",
        dueDate: overdueOldWindow,
      },
      {
        id: "act-overdue-old-2",
        tenantId: "tenant-a",
        dealId: "deal-a1",
        operatorId: "op-consultor-a",
        assignedToOperatorId: "op-consultor-a",
        type: "whatsapp",
        title: "WhatsApp Atrasado Antigo #2",
        status: "pending",
        dueDate: overdueOldWindow,
      },
      // Tarefas dentro da janela atual de 3 meses
      {
        id: "act-overdue-now",
        tenantId: "tenant-a",
        dealId: "deal-a1",
        operatorId: "op-admin-a",
        assignedToOperatorId: "op-consultor-a",
        assignedToOperatorIds: ["op-consultor-a"],
        type: "call",
        title: "Aguardando envio do CNPJ para Seladora",
        status: "pending",
        dueDate: overdueCurrentWindow,
      },
      {
        id: "act-future-now",
        tenantId: "tenant-a",
        dealId: "deal-a1",
        operatorId: "op-consultor-a",
        assignedToOperatorId: "op-consultor-a",
        type: "meeting",
        title: "Reunião de Fechamento Seladora",
        status: "pending",
        dueDate: futureCurrentWindow,
      },
      {
        id: "act-done-now",
        tenantId: "tenant-a",
        dealId: "deal-a1",
        operatorId: "op-consultor-a",
        assignedToOperatorId: "op-consultor-a",
        type: "task",
        title: "Envio de Catálogo Técnico",
        status: "completed",
        dueDate: completedCurrentWindow,
        completedAt: completedCurrentWindow,
      },
      // Cancelada e Nota (nunca devem entrar em tarefas)
      {
        id: "act-cancelled",
        tenantId: "tenant-a",
        dealId: "deal-a1",
        operatorId: "op-consultor-a",
        type: "task",
        title: "Tarefa Cancelada",
        status: "cancelled",
        dueDate: overdueCurrentWindow,
      },
      {
        id: "act-note",
        tenantId: "tenant-a",
        dealId: "deal-a1",
        operatorId: "op-consultor-a",
        type: "note",
        title: "Anotação Interna",
        status: "completed",
        dueDate: overdueCurrentWindow,
      },
      // Tarefa atrasada de OUTRO tenant (tenant-b) — isolamento estrito
      {
        id: "act-tenant-b-overdue",
        tenantId: "tenant-b",
        dealId: "deal-b1",
        operatorId: "op-admin-b",
        assignedToOperatorId: "op-admin-b",
        type: "call",
        title: "Tarefa Secreta Tenant B",
        status: "pending",
        dueDate: overdueCurrentWindow,
      },
    ]);

    const tasksRoute = await import("../src/routes/api/tasks");
    tasksGetHandler = (tasksRoute.Route.options as any).server.handlers.GET;
    tasksPutHandler = (tasksRoute.Route.options as any).server.handlers.PUT;

    const operatorsRoute = await import("../src/routes/api/operators");
    operatorsGetHandler = (operatorsRoute.Route.options as any).server.handlers.GET;
  }, 30_000);

  afterAll(async () => {
    await pg?.close?.();
  });

  test("GET /api/operators?lite=true retorna catálogo enxuto sem trafegar avatares Base64", async () => {
    const res = await operatorsGetHandler({
      request: new Request("http://localhost/api/operators?lite=true"),
    });
    expect(res.status).toBe(200);
    const rawText = await res.text();
    // Dois operadores tinham 220KB de Base64 cada; o payload lite deve ter menos de 1KB
    expect(rawText.length).toBeLessThan(1024);
    expect(rawText).not.toContain("data:image/png;base64");

    const parsed = JSON.parse(rawText);
    expect(parsed).toHaveLength(2);
    expect(parsed.map((o: any) => o.id).sort()).toEqual(["op-admin-a", "op-consultor-a"]);
  });

  test("GET /api/tasks com janela de 3 meses deduplica contatos, omite Base64 e retorna summary global exato", async () => {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
    const to = new Date(now.getFullYear(), now.getMonth() + 2, 0, 23, 59, 59, 999).toISOString();

    const res = await tasksGetHandler({
      request: new Request(
        `http://localhost/api/tasks?all=true&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&includeSummary=true`,
      ),
    });
    expect(res.status).toBe(200);
    const rawJson = await res.text();
    expect(rawJson).not.toContain("data:image/png;base64");

    const body = JSON.parse(rawJson);
    // Apenas as 3 tarefas ativas da janela atual (sem duplicar pelos 3 contatos da negociação!)
    expect(body.tasks).toHaveLength(3);
    expect(body.tasks.map((t: any) => t.id).sort()).toEqual([
      "act-done-now",
      "act-future-now",
      "act-overdue-now",
    ]);

    // Summary global reflete TODO o passivo do tenant-a (incluindo atrasadas antigas e histórico) sem inflar tasks[]
    expect(body.summary).toEqual({
      pendingCount: 4,   // 2 antigas + 1 atrasada atual + 1 futura atual
      overdueCount: 3,   // 2 antigas + 1 atrasada atual
      completedCount: 3, // 2 de 2024 + 1 atual
      totalCount: 7,
    });

    // Verifica resolução do contato primário (isPrimary=true) e da conversa mais recente (conv-latest)
    const sample = body.tasks.find((t: any) => t.id === "act-overdue-now");
    expect(sample.client.name).toBe("Antonio Comprador Principal");
    expect(sample.client.phone).toBe("5514999011195");
    expect(sample.chatContactId).toBe("contact-primary");
    expect(sample.chatConversationId).toBe("conv-latest");
    expect(sample.operatorAvatar).toBeNull();
    expect(sample.assignedOperators[0].avatar).toBeNull();
    expect(sample.deal.stageName).toBe("Proposta Enviada");
  });

  test("GET /api/tasks aplica paginação (limit/offset), statusFilter=overdue e busca textual no SQL", async () => {
    const page1Res = await tasksGetHandler({
      request: new Request("http://localhost/api/tasks?all=true&statusFilter=overdue&limit=2&offset=0"),
    });
    const page1 = await page1Res.json();
    expect(page1.tasks).toHaveLength(2);
    expect(page1.totalMatching).toBe(3);
    expect(page1.hasMore).toBe(true);

    const page2Res = await tasksGetHandler({
      request: new Request("http://localhost/api/tasks?all=true&statusFilter=overdue&limit=2&offset=2"),
    });
    const page2 = await page2Res.json();
    expect(page2.tasks).toHaveLength(1);
    expect(page2.totalMatching).toBe(3);
    expect(page2.hasMore).toBe(false);

    // Busca textual pelo nome do contato principal / negócio
    const searchRes = await tasksGetHandler({
      request: new Request("http://localhost/api/tasks?all=true&q=CNPJ&limit=20&offset=0"),
    });
    const searchData = await searchRes.json();
    expect(searchData.tasks).toHaveLength(1);
    expect(searchData.tasks[0].id).toBe("act-overdue-now");
  });

  test("PUT /api/tasks com rescheduleAllOverdue reagenda em lote transacional preservando isolamento entre tenants", async () => {
    const newTargetDue = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();

    const putRes = await tasksPutHandler({
      request: new Request("http://localhost/api/tasks", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "bulk_reschedule",
          rescheduleAllOverdue: true,
          all: true,
          scope: "all",
          dueDate: newTargetDue,
        }),
      }),
    });
    expect(putRes.status).toBe(200);
    const putBody = await putRes.json();
    expect(putBody.success).toBe(true);
    expect(putBody.updatedCount).toBe(3); // As 3 atrasadas do tenant-a

    // Agora overdueCount do tenant-a deve ser 0
    const summaryRes = await tasksGetHandler({
      request: new Request("http://localhost/api/tasks?all=true&includeSummary=true&limit=5"),
    });
    const summaryBody = await summaryRes.json();
    expect(summaryBody.summary.overdueCount).toBe(0);
    expect(summaryBody.summary.pendingCount).toBe(4);

    // Garante que a tarefa atrasada do tenant-b NÃO foi alterada
    const [tenantBTask] = await db
      .select()
      .from(schema.crmDealActivities)
      .where(eq(schema.crmDealActivities.id, "act-tenant-b-overdue"));
    expect(tenantBTask.dueDate!.getTime()).toBeLessThan(Date.now());
  });
});
