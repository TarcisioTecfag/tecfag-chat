import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import crypto from "node:crypto";
import fs from "node:fs";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import {
  contacts,
  conversations,
  crmAccounts,
  crmActionHistory,
  crmDealEvents,
  crmDeals,
  crmPipelines,
  crmStages,
  operators,
  tasks,
  tenants,
} from "../src/db/schema";
import {
  enterAuditContext,
  extractAuditClientIp,
  formatAuditTimestampBrt,
  getAuditActorTypeLabel,
  getAuditSourceChannelLabel,
  inferHttpSourceChannel,
  resolveAuditOrigin,
  runWithAuditContext,
} from "../src/lib/audit/audit-context";
import { ensureAuditOriginSchema } from "../src/lib/audit/audit-schema";
import { crmService } from "../src/lib/crm/crm-service";
import { processMcpJsonRpcPayload, type McpAccessContext } from "../src/lib/mcp/valem-tecfag-mcp-core";

function hasLocalPostgres(): boolean {
  if (!fs.existsSync(".env")) return false;
  const raw = fs.readFileSync(".env", "utf8");
  const m = raw.match(/^\s*DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m);
  if (!m?.[1]) return false;
  try {
    const u = new URL(m[1]);
    return u.hostname === "localhost" || u.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

const RUN_DB_TESTS = hasLocalPostgres();

describe("AuditContext — helpers puros e isolamento de persona", () => {
  it("extrai IP, detecta canal HTTP e respeita persona por tenant (Fagner vs Valentina)", () => {
    const uiReq = new Request("https://tecfagchat.up.railway.app/api/crm/deals", {
      headers: {
        cookie: "session_token=abc",
        "x-forwarded-for": "189.10.20.30, 10.0.0.1",
      },
    });
    expect(extractAuditClientIp(uiReq)).toBe("189.10.20.30");
    expect(inferHttpSourceChannel(uiReq)).toBe("crm_ui");

    const apiReq = new Request("https://tecfagchat.up.railway.app/api/v1/marketing/deals", {
      headers: { authorization: "Bearer secret", "x-real-ip": "201.45.67.89" },
    });
    expect(extractAuditClientIp(apiReq)).toBe("201.45.67.89");
    expect(inferHttpSourceChannel(apiReq)).toBe("api");

    const importReq = new Request("https://tecfagchat.up.railway.app/api/crm/import/rd-crm");
    expect(inferHttpSourceChannel(importReq)).toBe("import");

    expect(getAuditActorTypeLabel("ai", "tecfag")).toBe("IA (Fagner)");
    expect(getAuditActorTypeLabel("ai", "valem")).toBe("IA (Valentina)");
    expect(getAuditSourceChannelLabel("mcp")).toBe("MCP");
    expect(getAuditSourceChannelLabel("crm_ui")).toBe("Interface do CRM");
    expect(formatAuditTimestampBrt(new Date("2026-11-25T13:30:00.000Z"))).toContain("25/11/2026");
  });

  it("AsyncLocalStorage propaga MCP context e nunca atribui operatorId da vendedora como ator", () => {
    const resolved = runWithAuditContext(
      {
        actorType: "system",
        sourceChannel: "mcp",
        actorOperatorId: null,
        actorName: "MCP (Central)",
        clientIp: "177.22.33.44",
        mcpKeyId: "mcp-key-central",
        mcpKeyLabel: "Central",
        mcpToolName: "update_crm_deal_owner",
      },
      () =>
        resolveAuditOrigin({
          tenantId: "tecfag",
          operatorId: "op-vendedora-destino",
          operatorName: "Pamela Titato",
        }),
    );

    expect(resolved.actorType).toBe("system");
    expect(resolved.sourceChannel).toBe("mcp");
    expect(resolved.actorOperatorId).toBeNull();
    expect(resolved.actorName).toBe("MCP (Central)");
    expect(resolved.clientIp).toBe("177.22.33.44");
    expect(resolved.mcpKeyLabel).toBe("Central");
  });

  it("enterAuditContext funciona no escopo assíncrono corrente", async () => {
    const result = await runWithAuditContext(
      { actorType: "system", sourceChannel: "api", actorOperatorId: null },
      async () => {
        enterAuditContext({
          actorType: "human",
          sourceChannel: "crm_ui",
          actorOperatorId: "op-1",
          actorName: "Tarcisio",
          clientIp: "191.1.2.3",
        });
        await Promise.resolve();
        return resolveAuditOrigin({ tenantId: "tecfag" });
      },
    );
    expect(result.actorType).toBe("human");
    expect(result.sourceChannel).toBe("crm_ui");
    expect(result.actorOperatorId).toBe("op-1");
    expect(result.clientIp).toBe("191.1.2.3");
  });
});

describe.skipIf(!RUN_DB_TESTS)("Integração PostgreSQL — Auditoria de Origem nas 6 Entidades (CRM UI, MCP, IA, Webhook)", () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const pipeId = `pipe-aud-${suffix}`;
  const stageA = `stg-aud-a-${suffix}`;
  const stageB = `stg-aud-b-${suffix}`;
  const opA = `op-aud-a-${suffix}`;
  const opB = `op-aud-b-${suffix}`;
  const contactId = `cont-aud-${suffix}`;
  const convId = `conv-aud-${suffix}`;
  const createdDealIds: string[] = [];
  const createdAccountIds: string[] = [];
  const createdContactIds: string[] = [contactId];
  const createdTaskIds: string[] = [];

  const mcpAccess: McpAccessContext = {
    authorized: true,
    lockedTenantId: "tecfag",
    defaultTenantId: "tecfag",
    authMode: "token_tecfag",
    accessLevel: "read_write",
    keyId: "mcp-key-central-test",
    keyLabel: "Central Comercial",
    clientIp: "189.99.88.77",
    skipAuditLog: true,
  };

  async function callMcp(name: string, args: Record<string, unknown>) {
    const res = await processMcpJsonRpcPayload(
      {
        jsonrpc: "2.0",
        id: `aud-${name}-${crypto.randomUUID().slice(0, 6)}`,
        method: "tools/call",
        params: { name, arguments: args },
      },
      mcpAccess,
    );
    const isError = Boolean(res.body?.result?.isError);
    const text = String(res.body?.result?.content?.[0]?.text || "");
    if (isError) return { isError: true as const, errorText: text, data: null as any };
    return { isError: false as const, errorText: "", data: JSON.parse(text) };
  }

  beforeAll(async () => {
    await ensureAuditOriginSchema();
    await db
      .insert(tenants)
      .values([
        { id: "tecfag", name: "Tecfag", slug: "tecfag", connectionType: "meta" },
        { id: "valem", name: "Valem", slug: "valem", connectionType: "baileys" },
      ])
      .onConflictDoNothing();

    await db.insert(operators).values([
      {
        id: opA,
        tenantId: "tecfag",
        name: `Vendedora A ${suffix}`,
        email: `aud-a-${suffix}@tecfag.test`,
        passwordHash: "hash",
        role: "agent",
        status: "disponivel",
        isOnline: true,
      },
      {
        id: opB,
        tenantId: "tecfag",
        name: `Vendedora B ${suffix}`,
        email: `aud-b-${suffix}@tecfag.test`,
        passwordHash: "hash",
        role: "agent",
        status: "disponivel",
        isOnline: true,
      },
    ]);

    await db.insert(crmPipelines).values({
      id: pipeId,
      tenantId: "tecfag",
      name: `FUNIL AUD ${suffix}`,
      orderIndex: 97,
      isDefault: false,
    });

    await db.insert(crmStages).values([
      { id: stageA, tenantId: "tecfag", pipelineId: pipeId, name: "ATENDER", orderIndex: 0 },
      { id: stageB, tenantId: "tecfag", pipelineId: pipeId, name: "PROPOSTA", orderIndex: 1 },
    ]);

    await db.insert(contacts).values({
      id: contactId,
      tenantId: "tecfag",
      name: `Cliente Aud ${suffix}`,
      phone: `5511933${suffix.replace(/\D/g, "").padEnd(6, "9").slice(0, 6)}`,
      mainChannel: "whatsapp",
    });

    await db.insert(conversations).values({
      id: convId,
      tenantId: "tecfag",
      contactId,
      queueState: "fila",
      operatorId: null,
    });
  });

  afterAll(async () => {
    const allEntityIds = [
      ...createdDealIds,
      ...createdAccountIds,
      ...createdContactIds,
      ...createdTaskIds,
      convId,
    ];
    if (allEntityIds.length > 0) {
      await db
        .delete(crmActionHistory)
        .where(and(eq(crmActionHistory.tenantId, "tecfag"), inArray(crmActionHistory.entityId, allEntityIds)))
        .catch(() => {});
    }
    if (createdTaskIds.length > 0) {
      await db.delete(tasks).where(inArray(tasks.id, createdTaskIds)).catch(() => {});
    }
    if (createdDealIds.length > 0) {
      await db.delete(crmDealEvents).where(inArray(crmDealEvents.dealId, createdDealIds)).catch(() => {});
      await db.delete(crmDeals).where(inArray(crmDeals.id, createdDealIds)).catch(() => {});
    }
    if (createdAccountIds.length > 0) {
      await db.delete(crmAccounts).where(inArray(crmAccounts.id, createdAccountIds)).catch(() => {});
    }
    await db.delete(conversations).where(eq(conversations.id, convId)).catch(() => {});
    if (createdContactIds.length > 0) {
      await db.delete(contacts).where(inArray(contacts.id, createdContactIds)).catch(() => {});
    }
    await db.delete(crmPipelines).where(eq(crmPipelines.id, pipeId)).catch(() => {});
    await db.delete(operators).where(inArray(operators.id, [opA, opB])).catch(() => {});
  });

  it("transferência via MCP NÃO credita à vendedora de destino e grava canal=mcp, chave e IP; ação na UI grava human/crm_ui/IP", async () => {
    // 1. Criação humana na Interface do CRM (com IP)
    const deal = await runWithAuditContext(
      {
        actorType: "human",
        sourceChannel: "crm_ui",
        actorOperatorId: opA,
        actorName: `Vendedora A ${suffix}`,
        clientIp: "200.10.20.30",
      },
      () =>
        crmService.createDeal("tecfag", opA, {
          title: `Card Auditoria ${suffix}`,
          pipelineId: pipeId,
          stageId: stageA,
          contactId,
          operatorId: opA,
          value: 50000,
        }),
    );
    createdDealIds.push(deal.id);

    // 2. Transferência de responsável via MCP para Vendedora B (caso real reportado pelo Vinícius!)
    const transferRes = await callMcp("update_crm_deal_owner", {
      dealId: deal.id,
      operatorId: opB,
    });
    expect(transferRes.isError).toBe(false);
    expect(transferRes.data.operatorId).toBe(opB);

    // Aguarda gravação assíncrona de crm_action_history
    await new Promise((r) => setTimeout(r, 150));

    // 3. Consulta via get_deal_audit_log
    const auditLog = await callMcp("get_deal_audit_log", {
      dealId: deal.id,
      order: "asc",
    });
    expect(auditLog.isError).toBe(false);

    const createdEvt = auditLog.data.events.find((e: any) => e.eventType === "created");
    expect(createdEvt).toBeTruthy();
    expect(createdEvt.actorType).toBe("human");
    expect(createdEvt.sourceChannel).toBe("crm_ui");
    expect(createdEvt.operatorId).toBe(opA);
    expect(createdEvt.clientIp).toBe("200.10.20.30");
    expect(createdEvt.createdAtBrt).toContain("BRT");

    const ownerEvt = auditLog.data.events.find((e: any) => e.eventType === "owner_changed");
    expect(ownerEvt).toBeTruthy();
    // CRÍTICO: NÃO pode ter sido creditado à Vendedora B (opB)!
    expect(ownerEvt.operatorId).toBeNull();
    expect(ownerEvt.actorType).toBe("system");
    expect(ownerEvt.sourceChannel).toBe("mcp");
    expect(ownerEvt.mcpKeyLabel).toBe("Central Comercial");
    expect(ownerEvt.actorName).toBe("MCP (Central Comercial)");
    expect(ownerEvt.clientIp).toBe("189.99.88.77");
    expect(ownerEvt.metadata.toOperatorId).toBe(opB);

    // 4. Filtro por canal MCP no get_deal_audit_log
    const mcpOnlyLog = await callMcp("get_deal_audit_log", {
      dealId: deal.id,
      sourceChannel: "mcp",
    });
    expect(mcpOnlyLog.isError).toBe(false);
    expect(mcpOnlyLog.data.events.every((e: any) => e.sourceChannel === "mcp")).toBe(true);
    expect(mcpOnlyLog.data.events.some((e: any) => e.eventType === "owner_changed")).toBe(true);
    expect(mcpOnlyLog.data.events.some((e: any) => e.eventType === "created")).toBe(false);

    // 5. Cobrir demais entidades (contact, account, task, note, conversation) via MCP + consultar em search_crm_audit_logs
    const accRes = await callMcp("create_account", {
      name: `Empresa Aud ${suffix}`,
      type: "company",
      document: `112223330001${suffix.replace(/\D/g, "").padEnd(2, "8").slice(0, 2)}`,
    });
    if (accRes.isError) throw new Error(`create_account falhou: ${accRes.errorText}`);
    expect(accRes.isError).toBe(false);
    createdAccountIds.push(accRes.data.accountId);

    const contactRes = await callMcp("create_contact", {
      name: `Contato Aud 2 ${suffix}`,
      phone: `5511922${suffix.replace(/\D/g, "").padEnd(6, "8").slice(0, 6)}`,
    });
    expect(contactRes.isError).toBe(false);
    createdContactIds.push(contactRes.data.contactId);

    const taskRes = await callMcp("create_task", {
      title: `Tarefa Aud ${suffix}`,
      type: "task",
    });
    expect(taskRes.isError).toBe(false);
    createdTaskIds.push(taskRes.data.taskId);

    const noteRes = await crmService.createDealActivity("tecfag", deal.id, opA, {
      type: "note",
      title: "Nota de auditoria",
      description: "Teste de auditoria de nota",
    });
    expect(noteRes.id).toBeTruthy();

    const convTransfer = await callMcp("chat_transfer_conversation", {
      conversationId: convId,
      operatorId: opB,
      reason: "Teste auditoria conversa",
    });
    expect(convTransfer.isError).toBe(false);

    await new Promise((r) => setTimeout(r, 200));

    // Consulta unificada via search_crm_audit_logs filtrando por IP do MCP
    const unified = await callMcp("search_crm_audit_logs", {
      sourceChannel: "mcp",
      clientIp: "189.99.88.77",
      limit: 50,
    });
    expect(unified.isError).toBe(false);
    const entityTypesFound = new Set(unified.data.entries.map((e: any) => e.entityType));
    expect(entityTypesFound.has("deal")).toBe(true);
    expect(entityTypesFound.has("account")).toBe(true);
    expect(entityTypesFound.has("contact")).toBe(true);
    expect(entityTypesFound.has("task")).toBe(true);
    expect(entityTypesFound.has("conversation")).toBe(true);

    // Verifica que a nota também entrou no log unificado
    const noteLogs = await callMcp("search_crm_audit_logs", {
      entityType: "note",
      entityId: noteRes.id,
    });
    expect(noteLogs.isError).toBe(false);
    expect(noteLogs.data.entries.length).toBeGreaterThanOrEqual(1);
    expect(noteLogs.data.entries[0].entityId).toBe(noteRes.id);
  });
});
