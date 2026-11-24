import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import crypto from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { DB_POOL_MAX, db, resolveDbPoolMax } from "../src/db";
import {
  contacts,
  conversations,
  crmAccounts,
  crmConversationDeals,
  crmDealActivities,
  crmDealContacts,
  crmDealProducts,
  crmDeals,
  crmPipelines,
  crmStages,
  mcpAuditLogs,
  operators,
  tenants,
} from "../src/db/schema";
import {
  HEAVY_MCP_TOOLS,
  McpTrafficGuard,
  buildMcpRateLimitedResponse,
  extractMcpPayloadInspection,
  normalizeMcpKeyLimitOverrides,
} from "../src/lib/mcp/mcp-guard";
import {
  clearMcpAuditLogs,
  enqueueMcpAuditLog,
  flushPendingMcpAuditLogs,
  insertMcpAuditLogRow,
  listMcpAuditLogs,
} from "../src/lib/mcp/mcp-audit-store";
import {
  MCP_SERVER_INFO,
  formatMcpToolLabel,
  getMcpAuthSettings,
  getVisibleMcpTools,
  invalidateMcpAuthCache,
  isWriteMcpTool,
  processMcpJsonRpcPayload,
  summarizeMcpToolResult,
  type McpAccessContext,
} from "../src/lib/mcp/valem-tecfag-mcp-core";
import { getApiLibraryCatalog } from "../src/lib/marketing/api-library-catalog";

const RUN_DB_TESTS = Boolean(process.env.DATABASE_URL);

function makeAccess(
  accessLevel: "read" | "read_write",
  tenantId: "tecfag" | "valem" = "tecfag",
): McpAccessContext {
  return {
    authorized: true,
    lockedTenantId: tenantId,
    defaultTenantId: tenantId,
    authMode: tenantId === "valem" ? "token_valem" : "token_tecfag",
    accessLevel,
    keyId: `test-scale-${accessLevel}`,
    keyLabel: `Chave Escala (${accessLevel})`,
    skipAuditLog: true,
  };
}

async function callMcp(
  name: string,
  args: Record<string, unknown>,
  access: McpAccessContext,
) {
  const res = await processMcpJsonRpcPayload(
    {
      jsonrpc: "2.0",
      id: crypto.randomUUID(),
      method: "tools/call",
      params: { name, arguments: args },
    },
    access,
  );
  const text = String(res.body?.result?.content?.[0]?.text || "");
  if (res.body?.result?.isError) {
    return { isError: true as const, errorText: text, data: null as any };
  }
  return { isError: false as const, errorText: "", data: JSON.parse(text) };
}

describe("MCP v3.13.0 — Pool, Guard (Rate Limit + Semáforo), Catálogo e Batch", () => {
  it("configura DB_POOL_MAX com padrão 25 e clamping seguro entre 5 e 50", () => {
    expect(resolveDbPoolMax(undefined)).toBe(25);
    expect(resolveDbPoolMax("")).toBe(25);
    expect(resolveDbPoolMax("abc")).toBe(25);
    expect(resolveDbPoolMax("2")).toBe(5);
    expect(resolveDbPoolMax("30")).toBe(30);
    expect(resolveDbPoolMax("200")).toBe(50);
    expect(DB_POOL_MAX).toBeGreaterThanOrEqual(5);
    expect(DB_POOL_MAX).toBeLessThanOrEqual(50);
  });

  it("expõe get_crm_deals_batch em read e read_write com versão 3.13.0, label, summary e paridade na Biblioteca de API", () => {
    expect(MCP_SERVER_INFO.version).toBe("3.13.0");

    const readNames = new Set(getVisibleMcpTools(makeAccess("read")).map((t) => t.name));
    const rwNames = new Set(getVisibleMcpTools(makeAccess("read_write")).map((t) => t.name));

    expect(readNames.has("get_crm_deals_batch")).toBe(true);
    expect(rwNames.has("get_crm_deals_batch")).toBe(true);
    expect(isWriteMcpTool("get_crm_deals_batch")).toBe(false);

    expect(formatMcpToolLabel("get_crm_deals_batch")).toBe(
      "Leitura em Lote de Negociações (até 50 Cards)",
    );
    expect(
      summarizeMcpToolResult("get_crm_deals_batch", {
        requestedCount: 10,
        foundCount: 8,
        missingDealIds: ["a", "b"],
      }),
    ).toContain("8/10");

    const catalog = getApiLibraryCatalog("tecfag");
    const mcpEndpoints = catalog.filter((e) => e.kind === "mcp");
    const batchDoc = mcpEndpoints.find((e) => e.mcpToolName === "get_crm_deals_batch");
    const searchDoc = mcpEndpoints.find((e) => e.mcpToolName === "search_crm_deals");
    expect(batchDoc).toBeDefined();
    expect(searchDoc?.params.some((p) => p.name.includes("updatedFrom"))).toBe(true);
    expect(searchDoc?.params.some((p) => p.name === "offset")).toBe(true);
  });

  it("inspeciona payloads JSON-RPC e REST direto diferenciando notificações, ferramentas leves e pesadas", () => {
    const notif = extractMcpPayloadInspection({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });
    expect(notif.isNotificationOnly).toBe(true);
    expect(notif.isHeavy).toBe(false);

    const light = extractMcpPayloadInspection({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "list_crm_pipelines", arguments: {} },
    });
    expect(light.isNotificationOnly).toBe(false);
    expect(light.isHeavy).toBe(false);
    expect(light.toolNames).toEqual(["list_crm_pipelines"]);

    const heavyDirect = extractMcpPayloadInspection({
      tool: "get_crm_deals_batch",
      arguments: { dealIds: ["d1", "d2"] },
    });
    expect(heavyDirect.isNotificationOnly).toBe(false);
    expect(heavyDirect.isHeavy).toBe(true);
    expect(heavyDirect.toolNames).toEqual(["get_crm_deals_batch"]);
  });

  it("aplica rate limit por chave e por tenant de forma isolada (sem afetar o outro tenant) retornando 429 + Retry-After", async () => {
    const guard = new McpTrafficGuard({
      rateLimitPerMin: 2,
      tenantRateLimitPerMin: 3,
      maxConcurrentPerKey: 4,
      maxConcurrentGlobal: 8,
      maxHeavyConcurrentPerKey: 2,
      maxHeavyConcurrentGlobal: 4,
      queueTimeoutMs: 100,
      maxQueue: 4,
    });

    const r1 = await guard.acquire({ tenantId: "tecfag", keyId: "key-a", isHeavy: false });
    expect(r1.allowed).toBe(true);
    if (r1.allowed) {
      expect(r1.headers["X-RateLimit-Limit"]).toBe("2");
      expect(r1.headers["X-RateLimit-Remaining"]).toBe("1");
      r1.release();
    }

    const r2 = await guard.acquire({ tenantId: "tecfag", keyId: "key-a", isHeavy: false });
    expect(r2.allowed).toBe(true);
    if (r2.allowed) r2.release();

    // 3ª chamada da key-a estoura o limite da chave (2/min)
    const r3 = await guard.acquire({ tenantId: "tecfag", keyId: "key-a", isHeavy: false });
    expect(r3.allowed).toBe(false);
    if (!r3.allowed) {
      expect(r3.reason).toBe("rate_limit_key");
      const resp = buildMcpRateLimitedResponse(r3, {}, "sess-1", "rpc-99");
      expect(resp.status).toBe(429);
      expect(Number(resp.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1);
      const body = await resp.json();
      expect(body.error.code).toBe(-32029);
      expect(body.id).toBe("rpc-99");
    }

    // key-b no mesmo tenant ainda tem 1 slot (tenant total = 3)
    const r4 = await guard.acquire({ tenantId: "tecfag", keyId: "key-b", isHeavy: false });
    expect(r4.allowed).toBe(true);
    if (r4.allowed) r4.release();

    // Próxima chamada da key-b estoura o limite do tenant tecfag (3/min)
    const r5 = await guard.acquire({ tenantId: "tecfag", keyId: "key-b", isHeavy: false });
    expect(r5.allowed).toBe(false);
    if (!r5.allowed) expect(r5.reason).toBe("rate_limit_tenant");

    // Tenant valem continua 100% isolado e operando normalmente!
    const rValem = await guard.acquire({ tenantId: "valem", keyId: "key-v", isHeavy: false });
    expect(rValem.allowed).toBe(true);
    if (rValem.allowed) rValem.release();
  });

  it("enfileira bursts curtos no semáforo sem head-of-line blocking entre ferramentas pesadas e leves e nunca vaza slots", async () => {
    const guard = new McpTrafficGuard({
      rateLimitPerMin: 100,
      tenantRateLimitPerMin: 200,
      maxConcurrentPerKey: 3,
      maxConcurrentGlobal: 4,
      maxHeavyConcurrentPerKey: 1,
      maxHeavyConcurrentGlobal: 1,
      queueTimeoutMs: 250,
      maxQueue: 5,
    });

    const heavy1 = await guard.acquire({ tenantId: "tecfag", keyId: "k1", isHeavy: true });
    expect(heavy1.allowed).toBe(true);

    // 2ª chamada pesada entra na fila de espera
    const heavy2Promise = guard.acquire({ tenantId: "tecfag", keyId: "k1", isHeavy: true });

    // Enquanto heavy2 aguarda slot pesado, chamada LEVE passa imediatamente!
    const light1 = await guard.acquire({ tenantId: "tecfag", keyId: "k1", isHeavy: false });
    expect(light1.allowed).toBe(true);
    if (light1.allowed) {
      expect(light1.waitedMs).toBe(0);
      light1.release();
    }

    // Libera heavy1 -> heavy2 deve ser promovida imediatamente!
    if (heavy1.allowed) {
      heavy1.release();
      heavy1.release(); // idempotência de release não deve corromper contadores
    }
    const heavy2 = await heavy2Promise;
    expect(heavy2.allowed).toBe(true);

    // Enquanto heavy2 segura o slot pesado, heavy3 deve dar timeout rápido (250ms)
    const heavy3 = await guard.acquire({ tenantId: "tecfag", keyId: "k1", isHeavy: true });
    expect(heavy3.allowed).toBe(false);
    if (!heavy3.allowed) expect(heavy3.reason).toBe("concurrency_timeout");

    if (heavy2.allowed) heavy2.release();
    const snap = guard.getSnapshot();
    expect(snap.active.global).toBe(0);
    expect(snap.active.heavyGlobal).toBe(0);
    expect(snap.active.queued).toBe(0);
  });

  it("classifica search_conversations, search_crm_deals, search_crm_accounts e search_contacts como ferramentas pesadas (proteção /dev/shm)", () => {
    for (const toolName of [
      "search_conversations",
      "search_crm_deals",
      "search_crm_accounts",
      "search_contacts",
    ]) {
      expect(HEAVY_MCP_TOOLS.has(toolName)).toBe(true);
      const inspected = extractMcpPayloadInspection({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: toolName, arguments: { query: "teste" } },
      });
      expect(inspected.isHeavy).toBe(true);
    }
  });

  it("aplica limites customizados independentes por chave (rate limit e concorrência) sem ultrapassar o teto global do servidor", async () => {
    expect(normalizeMcpKeyLimitOverrides(null)).toBeUndefined();
    expect(normalizeMcpKeyLimitOverrides({ rateLimitPerMin: "", maxConcurrent: null })).toBeUndefined();
    expect(
      normalizeMcpKeyLimitOverrides({
        rateLimitPerMin: 99999,
        maxConcurrent: 0,
        maxHeavyConcurrent: 2.9,
      }),
    ).toEqual({
      rateLimitPerMin: 5000,
      maxConcurrent: 1,
      maxHeavyConcurrent: 2,
    });

    const guard = new McpTrafficGuard({
      rateLimitPerMin: 180,
      tenantRateLimitPerMin: 300,
      maxConcurrentPerKey: 8,
      maxConcurrentGlobal: 6,
      maxHeavyConcurrentPerKey: 4,
      maxHeavyConcurrentGlobal: 3,
      queueTimeoutMs: 120,
      maxQueue: 10,
    });

    // Chave restrita: apenas 1 chamada pesada simultânea e 2 req/min
    const restrictedLimits = { rateLimitPerMin: 2, maxConcurrent: 2, maxHeavyConcurrent: 1 };
    const rA1 = await guard.acquire({
      tenantId: "tecfag",
      keyId: "key-restricted",
      isHeavy: true,
      keyLimits: restrictedLimits,
    });
    expect(rA1.allowed).toBe(true);
    if (rA1.allowed) {
      expect(rA1.headers["X-RateLimit-Limit"]).toBe("2");
      expect(rA1.headers["X-MCP-Concurrency-Limit"]).toBe("1");
    }

    // 2ª chamada pesada simultânea da mesma chave restrita deve esperar e expirar (limite = 1)
    const rA2 = await guard.acquire({
      tenantId: "tecfag",
      keyId: "key-restricted",
      isHeavy: true,
      keyLimits: restrictedLimits,
    });
    expect(rA2.allowed).toBe(false);
    if (!rA2.allowed) {
      expect(rA2.reason).toBe("concurrency_timeout");
      expect(rA2.headers["X-MCP-Concurrency-Limit"]).toBe("1");
    }

    // Enquanto isso, outra chave (key-vip) com limite maior (mesmo tentando pedir 10, respeita o teto global = 3)
    // consegue adquirir 2 slots pesados simultâneos (1 de key-restricted + 2 de key-vip = 3 global)
    const vipLimits = { rateLimitPerMin: 100, maxConcurrent: 10, maxHeavyConcurrent: 10 };
    const rV1 = await guard.acquire({
      tenantId: "tecfag",
      keyId: "key-vip",
      isHeavy: true,
      keyLimits: vipLimits,
    });
    const rV2 = await guard.acquire({
      tenantId: "tecfag",
      keyId: "key-vip",
      isHeavy: true,
      keyLimits: vipLimits,
    });
    expect(rV1.allowed).toBe(true);
    expect(rV2.allowed).toBe(true);
    if (rV1.allowed) {
      expect(rV1.headers["X-MCP-Concurrency-Limit"]).toBe("3"); // capped pelo global 3
    }

    // 4ª chamada pesada global (mesmo em outra chave/tenant) é protegida pelo teto global = 3
    const rGlobalCap = await guard.acquire({
      tenantId: "valem",
      keyId: "key-valem",
      isHeavy: true,
    });
    expect(rGlobalCap.allowed).toBe(false);
    if (!rGlobalCap.allowed) expect(rGlobalCap.reason).toBe("concurrency_timeout");

    // Libera slots e testa rate limit customizado (2 req/min) da chave restrita
    if (rA1.allowed) rA1.release();
    if (rV1.allowed) rV1.release();
    if (rV2.allowed) rV2.release();

    const rA3 = await guard.acquire({
      tenantId: "tecfag",
      keyId: "key-restricted",
      isHeavy: false,
      keyLimits: restrictedLimits,
    });
    expect(rA3.allowed).toBe(true);
    if (rA3.allowed) rA3.release();

    // 3ª requisição no minuto da key-restricted estoura o limite individual dela (2/min)
    const rA4 = await guard.acquire({
      tenantId: "tecfag",
      keyId: "key-restricted",
      isHeavy: false,
      keyLimits: restrictedLimits,
    });
    expect(rA4.allowed).toBe(false);
    if (!rA4.allowed) expect(rA4.reason).toBe("rate_limit_key");

    // E a key-vip continua operando livremente sem ser afetada pelo limite da key-restricted
    const rV3 = await guard.acquire({
      tenantId: "tecfag",
      keyId: "key-vip",
      isHeavy: false,
      keyLimits: vipLimits,
    });
    expect(rV3.allowed).toBe(true);
    if (rV3.allowed) rV3.release();

    expect(guard.getSnapshot().active.global).toBe(0);
    expect(guard.getSnapshot().active.heavyGlobal).toBe(0);
  });
});

describe.skipIf(!RUN_DB_TESTS)(
  "Integração PostgreSQL — MCP v3.13.0 (Audit Logs Dedicado, Auth Cache, Paginação Incremental e get_crm_deals_batch)",
  () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const pipeTecId = `pipe-scale-tf-${suffix}`;
    const stageTecId = `stg-scale-tf-${suffix}`;
    const pipeValId = `pipe-scale-vl-${suffix}`;
    const stageValId = `stg-scale-vl-${suffix}`;
    const opTecId = `op-scale-tf-${suffix}`;
    const accTecId = `acc-scale-tf-${suffix}`;
    const contactTecId = `cont-scale-tf-${suffix}`;
    const convTecId = `conv-scale-tf-${suffix}`;
    const deal1Id = `deal-scale-tf-1-${suffix}`;
    const deal2Id = `deal-scale-tf-2-${suffix}`;
    const deal3Id = `deal-scale-tf-3-${suffix}`;
    const dealValemId = `deal-scale-vl-1-${suffix}`;
    const actId = `act-scale-tf-${suffix}`;
    const prodLineId = `dprod-scale-tf-${suffix}`;
    const linkId = `cd-scale-tf-${suffix}`;
    const dcLinkId = `dc-scale-tf-${suffix}`;
    const auditIdsToClean: string[] = [];

    beforeAll(async () => {
      await db
        .insert(tenants)
        .values([
          { id: "tecfag", name: "Tecfag", slug: "tecfag", connectionType: "meta" },
          { id: "valem", name: "Valem", slug: "valem", connectionType: "baileys" },
        ])
        .onConflictDoNothing();

      await db.insert(operators).values({
        id: opTecId,
        tenantId: "tecfag",
        name: `Consultor Escala ${suffix}`,
        email: `escala-${suffix}@tecfag.test`,
        passwordHash: "hash",
        role: "agent",
      });

      await db.insert(crmPipelines).values([
        { id: pipeTecId, tenantId: "tecfag", name: `FUNIL ESCALA ${suffix}`, orderIndex: 99 },
        { id: pipeValId, tenantId: "valem", name: `FUNIL VALEM ${suffix}`, orderIndex: 99 },
      ]);

      await db.insert(crmStages).values([
        { id: stageTecId, tenantId: "tecfag", pipelineId: pipeTecId, name: "QUALIFICACAO", orderIndex: 1 },
        { id: stageValId, tenantId: "valem", pipelineId: pipeValId, name: "PROPOSTA", orderIndex: 1 },
      ]);

      await db.insert(crmAccounts).values({
        id: accTecId,
        tenantId: "tecfag",
        name: `Indústria Escala ${suffix}`,
        type: "company",
        document: "12345678000199",
      });

      await db.insert(contacts).values({
        id: contactTecId,
        tenantId: "tecfag",
        name: `Contato Escala ${suffix}`,
        phone: `551198888${suffix.slice(0, 4).replace(/[^0-9]/g, "1").padEnd(4, "1")}`,
        mainChannel: "whatsapp",
        accountId: accTecId,
      });

      await db.insert(conversations).values({
        id: convTecId,
        tenantId: "tecfag",
        contactId: contactTecId,
        queueState: "meus",
        operatorId: opTecId,
        lastMessageText: "Olá sobre a seladora",
        lastMessageTime: new Date("2026-11-24T12:00:00Z"),
      });

      await db.insert(crmDeals).values([
        {
          id: deal1Id,
          tenantId: "tecfag",
          pipelineId: pipeTecId,
          stageId: stageTecId,
          title: `Card Escala 01 ${suffix}`,
          value: "15000",
          status: "open",
          operatorId: opTecId,
          accountId: accTecId,
          createdAt: new Date("2026-11-20T10:00:00Z"),
          updatedAt: new Date("2026-11-20T12:00:00Z"),
        },
        {
          id: deal2Id,
          tenantId: "tecfag",
          pipelineId: pipeTecId,
          stageId: stageTecId,
          title: `Card Escala 02 ${suffix}`,
          value: "25000",
          status: "open",
          operatorId: opTecId,
          accountId: accTecId,
          createdAt: new Date("2026-11-22T10:00:00Z"),
          updatedAt: new Date("2026-11-22T12:00:00Z"),
        },
        {
          id: deal3Id,
          tenantId: "tecfag",
          pipelineId: pipeTecId,
          stageId: stageTecId,
          title: `Card Escala 03 ${suffix}`,
          value: "35000",
          status: "open",
          operatorId: opTecId,
          accountId: accTecId,
          createdAt: new Date("2026-11-24T10:00:00Z"),
          updatedAt: new Date("2026-11-24T15:00:00Z"),
        },
        {
          id: dealValemId,
          tenantId: "valem",
          pipelineId: pipeValId,
          stageId: stageValId,
          title: `Card Valem Isolado ${suffix}`,
          value: "99000",
          status: "open",
          createdAt: new Date("2026-11-24T10:00:00Z"),
          updatedAt: new Date("2026-11-24T15:00:00Z"),
        },
      ]);

      await db.insert(crmDealContacts).values({
        id: dcLinkId,
        tenantId: "tecfag",
        dealId: deal1Id,
        contactId: contactTecId,
        isPrimary: true,
      });

      await db.insert(crmDealProducts).values({
        id: prodLineId,
        tenantId: "tecfag",
        dealId: deal1Id,
        name: "Seladora Industrial X1",
        quantity: "2",
        unitPrice: "7500",
        totalPrice: "15000",
      });

      await db.insert(crmDealActivities).values({
        id: actId,
        tenantId: "tecfag",
        dealId: deal1Id,
        type: "note",
        title: "Nota Escala",
        description: "Cliente pediu proposta atualizada",
        status: "completed",
      });

      await db.insert(crmConversationDeals).values({
        id: linkId,
        tenantId: "tecfag",
        conversationId: convTecId,
        dealId: deal1Id,
        origin: "manual",
        isActive: true,
      });
    });

    afterAll(async () => {
      await flushPendingMcpAuditLogs();
      if (auditIdsToClean.length > 0) {
        await db.delete(mcpAuditLogs).where(inArray(mcpAuditLogs.id, auditIdsToClean));
      }
      await db.delete(crmConversationDeals).where(eq(crmConversationDeals.id, linkId));
      await db.delete(crmDealActivities).where(eq(crmDealActivities.id, actId));
      await db.delete(crmDealProducts).where(eq(crmDealProducts.id, prodLineId));
      await db.delete(crmDealContacts).where(eq(crmDealContacts.id, dcLinkId));
      await db
        .delete(crmDeals)
        .where(inArray(crmDeals.id, [deal1Id, deal2Id, deal3Id, dealValemId]));
      await db.delete(conversations).where(eq(conversations.id, convTecId));
      await db.delete(contacts).where(eq(contacts.id, contactTecId));
      await db.delete(crmAccounts).where(eq(crmAccounts.id, accTecId));
      await db.delete(crmStages).where(inArray(crmStages.id, [stageTecId, stageValId]));
      await db.delete(crmPipelines).where(inArray(crmPipelines.id, [pipeTecId, pipeValId]));
      await db.delete(operators).where(eq(operators.id, opTecId));
    });

    it("pagina search_crm_deals com offset, updatedFrom e sortBy=updated_asc respeitando isolamento multi-tenant", async () => {
      const page1 = await callMcp(
        "search_crm_deals",
        {
          pipelineName: `FUNIL ESCALA ${suffix}`,
          sortBy: "updated_asc",
          limit: 2,
          offset: 0,
        },
        makeAccess("read", "tecfag"),
      );
      expect(page1.isError).toBe(false);
      expect(page1.data.totalMatching).toBe(3);
      expect(page1.data.returnedCount).toBe(2);
      expect(page1.data.hasMore).toBe(true);
      expect(page1.data.nextOffset).toBe(2);
      expect(page1.data.deals.map((d: any) => d.id)).toEqual([deal1Id, deal2Id]);

      const page2 = await callMcp(
        "search_crm_deals",
        {
          pipelineName: `FUNIL ESCALA ${suffix}`,
          sortBy: "updated_asc",
          limit: 2,
          offset: 2,
        },
        makeAccess("read", "tecfag"),
      );
      expect(page2.isError).toBe(false);
      expect(page2.data.returnedCount).toBe(1);
      expect(page2.data.hasMore).toBe(false);
      expect(page2.data.nextOffset).toBeNull();
      expect(page2.data.deals[0].id).toBe(deal3Id);

      // Filtro incremental updatedFrom retorna apenas cards atualizados a partir de 2026-11-22
      const incremental = await callMcp(
        "search_crm_deals",
        {
          pipelineName: `FUNIL ESCALA ${suffix}`,
          updatedFrom: "2026-11-22T00:00:00Z",
          sortBy: "updated_asc",
          limit: 500,
        },
        makeAccess("read", "tecfag"),
      );
      expect(incremental.isError).toBe(false);
      expect(incremental.data.limit).toBe(500);
      expect(incremental.data.deals.map((d: any) => d.id)).toEqual([deal2Id, deal3Id]);
    });

    it("executa get_crm_deals_batch preservando ordem, carregando relacionamentos e bloqueando leak cross-tenant", async () => {
      const res = await callMcp(
        "get_crm_deals_batch",
        {
          dealIds: [deal3Id, deal1Id, dealValemId, "deal-nao-existe"],
          includeContacts: true,
          includeProducts: true,
          includeActivities: true,
          includeConversations: true,
          includeEvents: false,
        },
        makeAccess("read", "tecfag"),
      );

      expect(res.isError).toBe(false);
      expect(res.data.requestedCount).toBe(4);
      expect(res.data.foundCount).toBe(2);
      // dealValemId pertence ao tenant 'valem' e NUNCA pode vazar para 'tecfag'
      expect(res.data.missingDealIds).toEqual([dealValemId, "deal-nao-existe"]);
      expect(res.data.deals.map((d: any) => d.deal.id)).toEqual([deal3Id, deal1Id]);

      const d1 = res.data.deals[1];
      expect(d1.account?.name).toBe(`Indústria Escala ${suffix}`);
      expect(d1.contacts).toHaveLength(1);
      expect(d1.contacts[0].id).toBe(contactTecId);
      expect(d1.products).toHaveLength(1);
      expect(d1.products[0].name).toBe("Seladora Industrial X1");
      expect(d1.recentActivities).toHaveLength(1);
      expect(d1.linkedConversations).toHaveLength(1);
      expect(d1.linkedConversations[0].conversation_id).toBe(convTecId);
      expect(d1.recentEvents).toBeUndefined();

      // Rejeita lote acima de 50 IDs
      const tooMany = await callMcp(
        "get_crm_deals_batch",
        { dealIds: Array.from({ length: 51 }, (_, i) => `id-${i}`) },
        makeAccess("read", "tecfag"),
      );
      expect(tooMany.isError).toBe(true);
      expect(tooMany.errorText).toContain("50");
    });

    it("grava e lista logs assíncronos em mcp_audit_logs isolados por tenant e cacheia getMcpAuthSettings", async () => {
      const logTecId = `mcp-log-test-tf-${suffix}`;
      const logValId = `mcp-log-test-vl-${suffix}`;
      auditIdsToClean.push(logTecId, logValId);

      enqueueMcpAuditLog("tecfag", {
        id: logTecId,
        timestamp: new Date().toISOString(),
        keyId: "primary",
        keyLabel: "Link Principal (Tecfag)",
        toolName: "get_crm_deals_batch",
        toolLabel: "Leitura em Lote de Negociações (até 50 Cards)",
        argumentsSummary: "dealIds: [a, b]",
        argumentsRaw: { dealIds: ["a", "b"] },
        resultSummary: "2/2 carregadas",
        status: "success",
        latencyMs: 42,
        eventType: "query",
      });

      await insertMcpAuditLogRow("valem", {
        id: logValId,
        timestamp: new Date().toISOString(),
        keyId: "primary",
        keyLabel: "Link Principal (Valem)",
        toolName: "list_crm_pipelines",
        toolLabel: "Listar Funis",
        argumentsSummary: "Consulta geral",
        argumentsRaw: {},
        resultSummary: "3 funis",
        status: "success",
        latencyMs: 12,
        eventType: "query",
      });

      await flushPendingMcpAuditLogs();

      const tecLogs = await listMcpAuditLogs("tecfag", 50);
      const valLogs = await listMcpAuditLogs("valem", 50);

      expect(tecLogs.some((l) => l.id === logTecId)).toBe(true);
      expect(tecLogs.some((l) => l.id === logValId)).toBe(false);
      expect(valLogs.some((l) => l.id === logValId)).toBe(true);
      expect(valLogs.some((l) => l.id === logTecId)).toBe(false);

      // Verifica cache de autenticação e invalidação
      invalidateMcpAuthCache("tecfag");
      const firstAuth = await getMcpAuthSettings("tecfag");
      const secondAuth = await getMcpAuthSettings("tecfag");
      expect(secondAuth).toBe(firstAuth); // mesma referência em cache

      invalidateMcpAuthCache("tecfag");
      const thirdAuth = await getMcpAuthSettings("tecfag");
      expect(thirdAuth).not.toBe(firstAuth);
      expect(thirdAuth.tenantId).toBe("tecfag");
    });

    it("executa search_conversations sem full-scans concorrentes desnecessários e preserva paginação, queueSummary e isolamento multi-tenant", async () => {
      // Caminho rápido (offset=0, returned < limit): não precisa de COUNT(*) duplicado
      const fastRes = await callMcp(
        "search_conversations",
        { query: `Contato Escala ${suffix}`, limit: 10, offset: 0 },
        makeAccess("read", "tecfag"),
      );
      expect(fastRes.isError).toBe(false);
      expect(fastRes.data.returnedCount).toBe(1);
      expect(fastRes.data.totalMatching).toBe(1);
      expect(fastRes.data.hasMore).toBe(false);
      expect(fastRes.data.queueSummary).toBeDefined();
      expect(typeof fastRes.data.queueSummary.total).toBe("number");
      expect(fastRes.data.conversations[0].conversationId).toBe(convTecId);

      // Caminho paginado (returned === limit): executa COUNT(*) sequencialmente
      const pagedRes = await callMcp(
        "search_conversations",
        { query: `Contato Escala ${suffix}`, limit: 1, offset: 0 },
        makeAccess("read", "tecfag"),
      );
      expect(pagedRes.isError).toBe(false);
      expect(pagedRes.data.returnedCount).toBe(1);
      expect(pagedRes.data.totalMatching).toBe(1);
      expect(pagedRes.data.hasMore).toBe(false);

      // Isolamento estrito: tenant valem não enxerga conversa do tenant tecfag
      const valemRes = await callMcp(
        "search_conversations",
        { query: `Contato Escala ${suffix}`, limit: 10, offset: 0 },
        makeAccess("read", "valem"),
      );
      expect(valemRes.isError).toBe(false);
      expect(valemRes.data.returnedCount).toBe(0);
      expect(valemRes.data.totalMatching).toBe(0);
    });
  },
);
