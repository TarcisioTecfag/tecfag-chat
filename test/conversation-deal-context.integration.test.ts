import { beforeAll, afterAll, describe, expect, test, mock } from "bun:test";
import { and, eq, sql } from "drizzle-orm";
import { recordAttendanceEvent } from "../src/lib/attendance-events";
import { appendIndustrialJournal } from "../src/lib/triage/industrial-triage-journal-store";
import * as schema from "../src/db/schema";
import {
  getDealContext,
  selectDealContext,
  recordConversationAction,
  endDealContext,
} from "../src/lib/crm/conversation-deal-context";
import { DEFAULT_ADMIN_PERMISSIONS } from "../src/lib/rbac";
import { readFile } from "node:fs/promises";
import { getContactDealRows } from "../src/lib/crm/contact-deals-query";
import {
  isCurrentDealEligible,
  sortContactDeals,
  isDealWithinPostCloseGrace,
  getDealPostCloseGraceExpiresAt,
  findActiveGraceDeal,
  DEAL_POST_CLOSE_GRACE_MS,
} from "../src/lib/crm/conversation-deal-policy";

describe("Política de carência de 24h pós-venda e pós-perda", () => {
  test("reconhece negociação vendida ou perdida dentro de 24h e expira após 24h", () => {
    const now = new Date("2026-10-30T15:00:00.000Z").getTime();
    const wonRecent = {
      id: "deal-won-recent",
      title: "Seladora Automática",
      status: "won",
      isLinked: true,
      closedAt: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
    };
    const lostRecent = {
      id: "deal-lost-recent",
      title: "Envasadora Linear",
      status: "lost",
      isLinked: true,
      closedAt: new Date(now - 23 * 60 * 60 * 1000).toISOString(),
    };
    const wonExpired = {
      id: "deal-won-expired",
      title: "Datador Antigo",
      status: "won",
      isLinked: true,
      closedAt: new Date(now - DEAL_POST_CLOSE_GRACE_MS - 1000).toISOString(),
    };
    const pausedRecent = {
      id: "deal-paused",
      title: "Pausada",
      status: "paused",
      isLinked: true,
      closedAt: new Date(now - 1000).toISOString(),
    };
    const unlinkedWon = {
      id: "deal-unlinked",
      title: "Desvinculada",
      status: "won",
      isLinked: false,
      closedAt: new Date(now - 1000).toISOString(),
    };

    expect(isDealWithinPostCloseGrace(wonRecent, now)).toBe(true);
    expect(isDealWithinPostCloseGrace(lostRecent, now)).toBe(true);
    expect(isDealWithinPostCloseGrace(wonExpired, now)).toBe(false);
    expect(isDealWithinPostCloseGrace(pausedRecent, now)).toBe(false);
    expect(isDealWithinPostCloseGrace(unlinkedWon, now)).toBe(false);

    // Prioriza o previousDealId quando está dentro da janela de 24h
    const chosen = findActiveGraceDeal(
      [wonRecent, lostRecent, wonExpired],
      ["deal-lost-recent"],
      now,
    );
    expect(chosen?.id).toBe("deal-lost-recent");
    expect(getDealPostCloseGraceExpiresAt(chosen, now)).toBe(
      new Date(new Date(lostRecent.closedAt).getTime() + DEAL_POST_CLOSE_GRACE_MS).toISOString(),
    );
  });
});

// PostgreSQL WASM: esta suíte nunca abre conexões com bancos operacionais.
describe.skipIf(!process.env.PGLITE_TEST_MODULE)("Negociação atual: PostgreSQL isolado", () => {
  let pg: any,
    db: any,
    notes: any,
    queue: any,
    contextApi: any,
    taskApi: any,
    dealsApi: any,
    eventApi: any,
    callApi: any,
    contactApi: any;
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
          sql`${schema.crmDealEvents.metadata}->>'actionType' IN ('attendance.started', 'attendance.transferred', 'attendance.closed', 'attendance.reopened')`,
        ),
      );

  beforeAll(async () => {
    const pglite = await import(process.env.PGLITE_TEST_MODULE!);
    mock.module("@electric-sql/pglite", () => pglite);
    const { drizzle } = await import("drizzle-orm/pglite");
    pg = new pglite.PGlite();
    db = drizzle(pg, { schema });
    const { generateDrizzleJson, generateMigration } = await import("drizzle-kit/api");
    const {
      conversationDealContexts: _newTable,
      attendanceEventCycles: _cycles,
      attendanceEvents: _events,
      ...legacySchema
    } = schema;
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
    const attendanceMigration = await readFile(
      new URL("../src/db/migrations/0046_attendance_events.sql", import.meta.url),
      "utf8",
    );
    await pg.exec(attendanceMigration);
    await pg.exec(attendanceMigration);
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
    mock.module("../src/lib/call-transcriber", () => ({
      transcribeAudio: async () => "Transcrição de teste",
      formatCallNote: (text: string) => text,
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
    eventApi = (
      (await import("../src/routes/api/chats/$conversationId/events")).Route.options as any
    ).server.handlers;
    callApi = ((await import("../src/routes/api/calls")).Route.options as any).server.handlers;
    contactApi = ((await import("../src/routes/api/contacts/$contactId")).Route.options as any)
      .server.handlers;
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

  const ledger = (id: string) =>
    db
      .select()
      .from(schema.attendanceEvents)
      .where(
        and(
          eq(schema.attendanceEvents.tenantId, "context-a"),
          eq(schema.attendanceEvents.conversationId, id),
        ),
      )
      .orderBy(schema.attendanceEvents.createdAt, schema.attendanceEvents.id);
  const emit = (id: string, key: string) =>
    db.transaction((tx: any) =>
      recordAttendanceEvent(tx, {
        tenantId: "context-a",
        conversationId: id,
        sourceKey: key,
        eventType: "note.form_opened",
        description: `Operador A abriu nota ${key}`,
        actorName: "Operador A",
        operatorId: "op-a",
      }),
    );
  const getEvents = (id: string, query = "") =>
    eventApi.GET({
      params: { conversationId: id },
      request: new Request(`http://localhost/api/chats/${id}/events${query}`),
    });

  test("triagem completa fica pendente antes do card e é projetada uma única vez após a seleção", async () => {
    const f = await fixture(2);
    await db
      .insert(schema.agentFlowStates)
      .values({
        id: `flow-${f.id}`,
        tenantId: "context-a",
        conversationId: f.id,
        agentType: "sdr",
        currentStep: "Coleta",
        metadata: { attendanceActorName: "Assistente A" },
      });
    await db
      .update(schema.agentFlowStates)
      .set({
        collectedData: { CNPJ: { value: "12345678000190", status: "filled" } },
        metadata: {
          attendanceActorName: "Assistente A",
          knownClient: { confirmed: true, source: "history" },
        },
      })
      .where(
        and(
          eq(schema.agentFlowStates.tenantId, "context-a"),
          eq(schema.agentFlowStates.id, `flow-${f.id}`),
        ),
      );
    const before = await ledger(f.id);
    expect(before.map((e: any) => e.eventType)).toEqual(
      expect.arrayContaining([
        "triage.started",
        "triage.field_collected",
        "triage.client_recognized",
        "triage.data_restored",
      ]),
    );
    expect(before.every((e: any) => e.pendingBinding && !e.dealId)).toBe(true);
    const ctx = await state(f.id);
    await db.transaction((tx: any) =>
      selectDealContext(tx, "context-a", f.id, f.deals[0], "op-a", ctx.context.version),
    );
    const after = await ledger(f.id);
    expect(after.every((e: any) => !e.pendingBinding && e.dealId === f.deals[0])).toBe(true);
    const crm = await db
      .select()
      .from(schema.crmDealEvents)
      .where(
        and(
          eq(schema.crmDealEvents.tenantId, "context-a"),
          eq(schema.crmDealEvents.dealId, f.deals[0]),
          eq(schema.crmDealEvents.eventType, "conversation_action"),
        ),
      );
    expect(crm).toHaveLength(after.length);
    expect(
      crm.some(
        (e: any) =>
          e.metadata.actorName === "Assistente A" && e.metadata.actionType === "triage.started",
      ),
    ).toBe(true);
    await state(f.id);
    expect(await ledger(f.id)).toHaveLength(after.length);
  });

  test("trocar card não move eventos anteriores, inclusive recibos tardios da mesma mensagem", async () => {
    const f = await fixture(2);
    const ctx = await state(f.id);
    const first = await db.transaction((tx: any) =>
      selectDealContext(tx, "context-a", f.id, f.deals[0], "op-a", ctx.context.version),
    );
    await db
      .insert(schema.messages)
      .values({
        id: `out-${f.id}`,
        tenantId: "context-a",
        conversationId: f.id,
        senderType: "agent",
        senderName: "Operador A",
        content: "Mensagem",
        direction: "outbound",
        status: "pending",
      });
    await db.transaction((tx: any) =>
      selectDealContext(tx, "context-a", f.id, f.deals[1], "op-a", first.version),
    );
    await db
      .update(schema.messages)
      .set({ status: "failed", errorMessage: "Canal indisponível" })
      .where(and(eq(schema.messages.tenantId, "context-a"), eq(schema.messages.id, `out-${f.id}`)));
    await emit(f.id, `new-${f.id}`);
    const all = await ledger(f.id);
    expect(all.find((e: any) => e.eventType === "message.failed")).toMatchObject({
      dealId: f.deals[0],
    });
    expect(all.find((e: any) => e.sourceKey === `new-${f.id}`)).toMatchObject({
      dealId: f.deals[1],
    });
    await db
      .update(schema.messages)
      .set({ status: "failed" })
      .where(and(eq(schema.messages.tenantId, "context-a"), eq(schema.messages.id, `out-${f.id}`)));
    expect((await ledger(f.id)).filter((e: any) => e.eventType === "message.failed")).toHaveLength(
      1,
    );
  });

  test("pendências de um atendimento encerrado não são enviadas ao card de um atendimento novo", async () => {
    const f = await fixture(2);
    await emit(f.id, "old-pending");
    await db
      .update(schema.conversations)
      .set({ queueState: "finalizados" })
      .where(
        and(eq(schema.conversations.tenantId, "context-a"), eq(schema.conversations.id, f.id)),
      );
    await db.transaction((tx: any) => endDealContext(tx, "context-a", f.id));
    await db
      .update(schema.conversations)
      .set({ queueState: "meus" })
      .where(
        and(eq(schema.conversations.tenantId, "context-a"), eq(schema.conversations.id, f.id)),
      );
    await emit(f.id, "new-pending");
    const ctx = await state(f.id);
    await db.transaction((tx: any) =>
      selectDealContext(tx, "context-a", f.id, f.deals[1], "op-a", ctx.context.version),
    );
    const all = await ledger(f.id);
    expect(all.find((e: any) => e.sourceKey === "old-pending")).toMatchObject({
      dealId: null,
      pendingBinding: true,
    });
    expect(all.find((e: any) => e.sourceKey === "new-pending")).toMatchObject({
      dealId: f.deals[1],
      pendingBinding: false,
    });
    expect(all.find((e: any) => e.sourceKey === "old-pending").cycleId).not.toBe(
      all.find((e: any) => e.sourceKey === "new-pending").cycleId,
    );
  });

  test("a ação e as duas projeções são revertidas juntas em caso de falha", async () => {
    const f = await fixture();
    await state(f.id);
    const before = (await ledger(f.id)).length;
    await expect(
      db.transaction(async (tx: any) => {
        await tx
          .insert(schema.messages)
          .values({
            id: `rollback-${f.id}`,
            tenantId: "context-a",
            conversationId: f.id,
            senderType: "system",
            senderName: "Sistema",
            content: "Operação revertida",
            isInternalNote: true,
          });
        throw Error("rollback deliberado");
      }),
    ).rejects.toThrow("rollback deliberado");
    expect(await ledger(f.id)).toHaveLength(before);
    const crm = await db
      .select()
      .from(schema.crmDealEvents)
      .where(
        and(
          eq(schema.crmDealEvents.tenantId, "context-a"),
          eq(schema.crmDealEvents.dealId, f.deals[0]),
        ),
      );
    expect(crm.some((e: any) => e.metadata?.messageId === `rollback-${f.id}`)).toBe(false);
  });

  test("CRM -> atendimento não produz mensagem nem evento operacional", async () => {
    const f = await fixture();
    await state(f.id);
    const before = (await ledger(f.id)).length;
    const messagesBefore = await db
      .select()
      .from(schema.messages)
      .where(
        and(eq(schema.messages.tenantId, "context-a"), eq(schema.messages.conversationId, f.id)),
      );
    await db
      .update(schema.crmDeals)
      .set({ operatorId: "op-b", status: "won" })
      .where(and(eq(schema.crmDeals.tenantId, "context-a"), eq(schema.crmDeals.id, f.deals[0])));
    await db
      .insert(schema.crmDealActivities)
      .values({
        id: `crm-only-${f.id}`,
        tenantId: "context-a",
        conversationId: f.id,
        dealId: f.deals[0],
        type: "note",
        title: "Nota no CRM",
        operatorId: "op-a",
      });
    expect(await ledger(f.id)).toHaveLength(before);
    expect(
      await db
        .select()
        .from(schema.messages)
        .where(
          and(eq(schema.messages.tenantId, "context-a"), eq(schema.messages.conversationId, f.id)),
        ),
    ).toHaveLength(messagesBefore.length);
  });

  test("ligações registram solicitação, conexão e encerramento sem depender da transcrição", async () => {
    const f = await fixture();
    await state(f.id);
    await db
      .insert(schema.callSessions)
      .values({
        id: `call-${f.id}`,
        tenantId: "context-a",
        conversationId: f.id,
        roomId: crypto.randomUUID(),
        operatorId: "op-a",
      });
    for (const status of ["active", "ended", "ended"])
      await db
        .update(schema.callSessions)
        .set({ status })
        .where(
          and(
            eq(schema.callSessions.tenantId, "context-a"),
            eq(schema.callSessions.id, `call-${f.id}`),
          ),
        );
    const all = (await ledger(f.id)).filter((e: any) => e.eventType.startsWith("call."));
    expect(all.map((e: any) => e.eventType)).toEqual(["call.waiting", "call.active", "call.ended"]);
    expect(
      all.every((e: any) => e.dealId === f.deals[0] && e.metadata.ownerOperatorId === "op-a"),
    ).toBe(true);
  });

  test("Eventos tem paginação própria, datas completas e inclui notas históricas fora das mensagens carregadas", async () => {
    const f = await fixture();
    await state(f.id);
    await pg.exec("ALTER TABLE messages DISABLE TRIGGER attendance_message_capture");
    try {
      await db.insert(schema.messages).values({ id: `legacy-${f.id}`, tenantId: "context-a", conversationId: f.id,
        senderType: "agent", senderName: "Operador antigo", content: "Nota anterior à atualização",
        isInternalNote: true, sentAt: new Date("2025-01-01T12:00:00Z"),
      });
    } finally { await pg.exec("ALTER TABLE messages ENABLE TRIGGER attendance_message_capture"); }
    await db.transaction(async (tx: any) => {
      for (let n = 0; n < 73; n++)
        await recordAttendanceEvent(tx, {
          tenantId: "context-a",
          conversationId: f.id,
          sourceKey: `page-${n}`,
          eventType: "note.form_opened",
          description: `Nota ${n}`,
          actorName: "Operador A",
          operatorId: "op-a",
        });
    });
    const page1 = await (await getEvents(f.id)).json();
    const page2 = await (
      await getEvents(f.id, `?cursor=${encodeURIComponent(page1.nextCursor)}`)
    ).json();
    expect(page1.events).toHaveLength(50);
    expect(page2.events).toHaveLength(26);
    expect(new Set([...page1.events, ...page2.events].map((e: any) => e.id)).size).toBe(76);
    expect(page2.events.at(-1)).toMatchObject({ legacy: true, description: "Nota anterior à atualização" });
    expect(page2.nextCursor).toBeNull();
    expect((await getEvents(f.id, "?cursor=invalid")).status).toBe(400);
  });

  test("abertura de nota é autenticada, idempotente, não aceita ator/card do cliente e rejeita conclusão inventada", async () => {
    const f = await fixture();
    const ctx = await state(f.id);
    const body = {
      eventType: "note.form_opened",
      actionId: "same-action",
      expectedContextVersion: ctx.context.version,
      tenantId: "context-b",
      operatorId: "op-b",
      dealId: "foreign-deal",
      description: "falso",
    };
    expect((await eventApi.POST(request(f.id, body))).status).toBe(200);
    expect((await eventApi.POST(request(f.id, body))).status).toBe(200);
    const all = (await ledger(f.id)).filter((e: any) => e.eventType === "note.form_opened");
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      actorName: "Operador A",
      operatorId: "op-a",
      dealId: f.deals[0],
    });
    expect((await eventApi.POST(request(f.id, { ...body, eventType: "call.ended" }))).status).toBe(
      400,
    );
    authenticated = false;
    try {
      expect((await getEvents(f.id)).status).toBe(401);
      expect((await eventApi.POST(request(f.id, body))).status).toBe(401);
    } finally {
      authenticated = true;
    }
    session.tenantId = "context-b";
    try {
      expect((await getEvents(f.id)).status).toBe(404);
    } finally {
      session.tenantId = "context-a";
    }
  });

  test("contexto adulterado de outro tenant não recebe eventos", async () => {
    const f = await fixture(2);
    await db
      .insert(schema.conversationDealContexts)
      .values({ tenantId: "context-a", conversationId: f.id, currentDealId: "foreign-deal" });
    await emit(f.id, "foreign-context");
    expect((await ledger(f.id)).find((e: any) => e.sourceKey === "foreign-context")).toMatchObject({
      dealId: null,
      pendingBinding: true,
    });
  });

  test("reinício da triagem antes da atualização da fila já pertence ao novo atendimento", async () => {
    const f = await fixture(2); const ctx = await state(f.id);
    await db.transaction((tx: any) => selectDealContext(tx, "context-a", f.id, f.deals[0], "op-a", ctx.context.version));
    await db.update(schema.conversations).set({ queueState: "finalizados" }).where(and(eq(schema.conversations.tenantId, "context-a"), eq(schema.conversations.id, f.id)));
    expect((await state(f.id)).context.currentDealId).toBeNull();
    await db.insert(schema.agentFlowStates).values({ id: `reopen-flow-${f.id}`, tenantId: "context-a", conversationId: f.id,
      agentType: "sdr", currentStep: "Coleta", metadata: { attendanceActorName: "Assistente A" } });
    await db.update(schema.conversations).set({ queueState: "meus" }).where(and(eq(schema.conversations.tenantId, "context-a"), eq(schema.conversations.id, f.id)));
    const reopened = await state(f.id);
    await db.transaction((tx: any) => selectDealContext(tx, "context-a", f.id, f.deals[1], "op-a", reopened.context.version));
    expect((await ledger(f.id)).find((e: any) => e.eventType === "triage.started")).toMatchObject({ dealId: f.deals[1], pendingBinding: false });
  });

  test("nota sem card é registrada e aguarda seleção; tarefa efetiva aparece também nos Eventos", async () => {
    const f = await fixture(2);
    const ctx = await state(f.id);
    expect(
      (
        await notes(
          request(f.id, {
            conversationId: f.id,
            content: "Antes da seleção",
            isInternalNote: true,
            noteScope: "general",
            expectedContextVersion: ctx.context.version,
          }),
        )
      ).status,
    ).toBe(200);
    expect((await ledger(f.id)).find((e: any) => e.eventType === "note.created")).toMatchObject({
      dealId: null,
      pendingBinding: true,
    });
    const chosen = await db.transaction((tx: any) =>
      selectDealContext(tx, "context-a", f.id, f.deals[0], "op-a", ctx.context.version),
    );
    expect(
      (
        await taskApi(
          request(f.id, {
            conversationId: f.id,
            tagName: "Retornar ao cliente",
            dueDate: "2026-10-30",
            expectedContextVersion: chosen.version,
          }),
        )
      ).status,
    ).toBe(200);
    expect((await ledger(f.id)).find((e: any) => e.eventType === "task.created")).toMatchObject({
      dealId: f.deals[0],
      actorName: "Operador A",
    });
  });

  test("reação do operador em mensagem do cliente gera evento; reação recebida e repetição não duplicam", async () => {
    const f = await fixture();
    await state(f.id);
    await db
      .insert(schema.messages)
      .values({
        id: `client-${f.id}`,
        tenantId: "context-a",
        conversationId: f.id,
        senderType: "client",
        senderName: "Cliente",
        content: "Olá",
      });
    const base = {
      attendanceReactionActor: { name: "Operador A", operatorId: "op-a" },
      reactions: { operator: { emoji: "👍", operatorId: "op-a", at: "first" } },
    };
    for (const metaDetails of [
      base,
      {
        ...base,
        reactions: {
          operator: { ...base.reactions.operator, at: "retry" },
          client: { emoji: "❤️" },
        },
      },
    ])
      await db
        .update(schema.messages)
        .set({ metaDetails })
        .where(
          and(eq(schema.messages.tenantId, "context-a"), eq(schema.messages.id, `client-${f.id}`)),
        );
    expect(
      (await ledger(f.id)).filter((e: any) => e.eventType === "message.reaction_changed"),
    ).toHaveLength(1);
  });

  test("briefing segue o card atual mesmo quando o recibo da triagem aponta para outro card", async () => {
    const f = await fixture(2);
    const ctx = await state(f.id);
    await db.transaction((tx: any) =>
      selectDealContext(tx, "context-a", f.id, f.deals[0], "op-a", ctx.context.version),
    );
    const startedAt = new Date("2026-10-23T10:00:00Z");
    await db.transaction((tx: any) =>
      appendIndustrialJournal(
        tx,
        null,
        {
          id: `journal-${f.id}`,
          tenantId: "context-a",
          conversationId: f.id,
          startedAt,
          completedAt: new Date(),
          lastInteractionAt: new Date(),
          currentStep: "Concluído",
          outcome: "transferred",
          collectedData: { CNPJ: { value: "12345678000190", status: "filled" } },
          metadata: {
            targetFunnel: "Máquinas",
            handoffReceipt: {
              cycle: startedAt.toISOString(),
              result: {
                status: "transferred",
                operator: { id: "op-a", name: "Operador A" },
                deal: { dealId: f.deals[1] },
              },
            },
          },
        },
        "handoff",
        "confirmed",
      ),
    );
    expect((await events(f.deals[0])).filter((e: any) => e.id.startsWith("brief-"))).toHaveLength(
      1,
    );
    expect(await events(f.deals[1])).toHaveLength(0);
  });

  test("edições do cliente feitas no Conversas registram autor e alterações apenas no card atual", async () => {
    const f = await fixture();
    await state(f.id);
    const update = (headers: Record<string, string>, body: unknown) =>
      contactApi.PATCH({
        params: { contactId: f.id },
        request: new Request(`http://localhost/api/contacts/${f.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...headers },
          body: JSON.stringify(body),
        }),
      });
    expect(
      (
        await update(
          { "X-Attendance-Conversation": f.id },
          { name: "Cliente atualizado", tags: ["Retorno"] },
        )
      ).status,
    ).toBe(200);
    const log = (await ledger(f.id)).find((e: any) => e.eventType === "contact.updated");
    expect(log).toMatchObject({ operatorId: "op-a", dealId: f.deals[0] });
    expect(log.metadata.changes.map((c: any) => c.field)).toEqual(
      expect.arrayContaining(["name", "tags"]),
    );
    expect((await update({}, { name: "Alteração pelo cadastro" })).status).toBe(200);
    expect((await ledger(f.id)).filter((e: any) => e.eventType === "contact.updated")).toHaveLength(
      1,
    );
    const other = await fixture();
    expect(
      (await update({ "X-Attendance-Conversation": other.id }, { name: "Forjado" })).status,
    ).toBe(403);
  });

  test("API de ligação usa sessão e registra estados reais; sinalização pública não expõe a transcrição", async () => {
    const f = await fixture();
    await state(f.id);
    const callRequest = (action: string, body: unknown) => ({
      request: new Request(`http://localhost/api/calls${action ? `?action=${action}` : ""}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    });
    const response = await callApi.POST(
      callRequest("", { conversationId: f.id, tenantId: "context-b", operatorId: "op-b" }),
    );
    expect(response.status).toBe(200);
    const call = await response.json();
    expect(call.roomId).toMatch(/^call-[0-9a-f-]{36}$/);
    expect(
      (
        await callApi.POST(
          callRequest("signal", { roomId: call.roomId, role: "client", type: "client:joined" }),
        )
      ).status,
    ).toBe(200);
    expect((await ledger(f.id)).find((e: any) => e.eventType === "call.connecting")).toBeDefined();
    expect((await ledger(f.id)).some((e: any) => e.eventType === "call.active")).toBe(false);
    expect(
      (
        await callApi.POST(
          callRequest("signal", { roomId: call.roomId, role: "client", type: "call:connected" }),
        )
      ).status,
    ).toBe(200);
    const publicState = await (
      await callApi.GET({
        request: new Request(`http://localhost/api/calls?roomId=${call.roomId}`),
      })
    ).json();
    expect(publicState.transcription).toBeUndefined();
    session.tenantId = "context-b";
    try {
      expect((await callApi.POST(callRequest("end", { roomId: call.roomId }))).status).toBe(404);
    } finally {
      session.tenantId = "context-a";
    }
    expect((await callApi.POST(callRequest("end", { roomId: call.roomId }))).status).toBe(200);
    expect((await ledger(f.id)).filter((e: any) => e.eventType === "call.ended")).toHaveLength(1);
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
  test("nota com contexto antigo é recusada inclusive no modo de vínculo pendente", async () => {
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
    expect((await notes(request(f.id, { ...body, noteScope: "general" }))).status).toBe(409);
    expect(
      (
        await notes(
          request(f.id, {
            ...body,
            noteScope: "general",
            expectedContextVersion: context.context.version,
          }),
        )
      ).status,
    ).toBe(200);
    const [ledger] = await db
      .select()
      .from(schema.attendanceEvents)
      .where(
        and(
          eq(schema.attendanceEvents.tenantId, "context-a"),
          eq(schema.attendanceEvents.conversationId, f.id),
          eq(schema.attendanceEvents.eventType, "note.created"),
        ),
      );
    expect(ledger.dealId).toBe(f.deals[0]);
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
  test("carência de 24h pós-venda ou pós-perda dispensa vínculo de negociação atual e expira após 24h", async () => {
    for (const closedStatus of ["won", "lost"] as const) {
      const f = await fixture(2);
      const initial = await state(f.id);
      await db.transaction((tx: any) =>
        selectDealContext(tx, "context-a", f.id, f.deals[0], "op-a", initial.context.version),
      );
      const recentClosedAt = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2h atrás (dentro de 24h)
      await db
        .update(schema.crmDeals)
        .set({ status: closedStatus, closedAt: recentClosedAt })
        .where(
          and(eq(schema.crmDeals.tenantId, "context-a"), eq(schema.crmDeals.id, f.deals[0])),
        );

      const statusRes = await dealsApi.GET({
        params: { conversationId: f.id },
        request: new Request("http://localhost/api/chats/" + f.id + "/deals?statusOnly=1"),
      });
      const statusJson = await statusRes.json();
      expect(statusJson).toMatchObject({
        dealRequired: false,
        currentDealRequired: false,
        gracePeriodActive: true,
        graceDeal: {
          id: f.deals[0],
          status: closedStatus,
        },
      });
      expect(typeof statusJson.graceExpiresAt).toBe("string");

      const ctxRes = await contextApi.GET({
        params: { conversationId: f.id },
        request: new Request("http://localhost"),
      });
      const ctxJson = await ctxRes.json();
      expect(ctxJson).toMatchObject({
        hasCurrentDeal: false,
        selectionRequired: false,
        gracePeriodActive: true,
        graceDeal: {
          id: f.deals[0],
          status: closedStatus,
        },
      });

      // Durante a carência de 24h, notas internas e encerramento funcionam sem selecionar outro card
      const noteRes = await notes(
        request(f.id, {
          conversationId: f.id,
          content: `Nota em carência (${closedStatus})`,
          isInternalNote: true,
          expectedContextVersion: ctxJson.version,
        }),
      );
      expect(noteRes.status).toBe(200);

      // Após expirar 24h (ex: 25h atrás), volta a exigir seleção de negociação atual
      const expiredClosedAt = new Date(Date.now() - 25 * 60 * 60 * 1000);
      await db
        .update(schema.crmDeals)
        .set({ closedAt: expiredClosedAt })
        .where(
          and(eq(schema.crmDeals.tenantId, "context-a"), eq(schema.crmDeals.id, f.deals[0])),
        );

      const expiredStatusRes = await dealsApi.GET({
        params: { conversationId: f.id },
        request: new Request("http://localhost/api/chats/" + f.id + "/deals?statusOnly=1"),
      });
      expect(await expiredStatusRes.json()).toMatchObject({
        dealRequired: false,
        currentDealRequired: true,
        gracePeriodActive: false,
        graceDeal: null,
      });

      const expiredCtxRes = await contextApi.GET({
        params: { conversationId: f.id },
        request: new Request("http://localhost"),
      });
      expect(await expiredCtxRes.json()).toMatchObject({
        hasCurrentDeal: false,
        selectionRequired: true,
        gracePeriodActive: false,
        graceDeal: null,
      });
    }
  });
});
