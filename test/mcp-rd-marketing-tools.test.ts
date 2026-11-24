import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import crypto from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import {
  crmPipelines,
  crmStages,
  rdMarketingEvents,
  rdMarketingFlows,
  rdMarketingJourneyEndpoints,
  rdMarketingJourneyNotifications,
  rdMarketingLogs,
  tenants,
} from "../src/db/schema";
import {
  MCP_SERVER_INFO,
  MCP_TOOLS,
  formatMcpToolLabel,
  getVisibleMcpTools,
  isWriteMcpTool,
  processMcpJsonRpcPayload,
  summarizeMcpToolResult,
  type McpAccessContext,
} from "../src/lib/mcp/valem-tecfag-mcp-core";
import {
  maskFlowWebhookToken,
  summarizeRdEventPayload,
} from "../src/lib/mcp/valem-tecfag-mcp-rd-marketing-tools";
import { encodeFlowWebhookToken } from "../src/lib/rd-marketing/api-crypto";
import { hashToken } from "../src/lib/rd-marketing/service";
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
    keyId: `test-rd-mkt-${accessLevel}`,
    keyLabel: `Chave Teste RD Marketing (${accessLevel})`,
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

describe("MCP v3.10.0 — Ferramentas Read-Only de RD Station Marketing", () => {
  it("expõe as 4 tools read-only em leitura e escrita, com labels, summaries e 100% de paridade na Biblioteca de API", () => {
    expect(MCP_SERVER_INFO.version).toBe("3.13.0");

    const rdTools = [
      "list_rd_marketing_flows",
      "list_rd_marketing_events",
      "list_rd_marketing_logs",
      "search_rd_marketing_journey_notifications",
    ];

    const readNames = new Set(getVisibleMcpTools(makeAccess("read")).map((t) => t.name));
    const rwNames = new Set(getVisibleMcpTools(makeAccess("read_write")).map((t) => t.name));

    for (const toolName of rdTools) {
      expect(readNames.has(toolName)).toBe(true);
      expect(rwNames.has(toolName)).toBe(true);
      expect(isWriteMcpTool(toolName)).toBe(false);
    }

    expect(formatMcpToolLabel("list_rd_marketing_flows")).toBe(
      "Listagem de Fluxos RD Station Marketing",
    );
    expect(formatMcpToolLabel("list_rd_marketing_events")).toBe(
      "Consulta de Eventos Webhook RD Marketing",
    );
    expect(formatMcpToolLabel("list_rd_marketing_logs")).toBe(
      "Consulta de Logs RD Station Marketing",
    );
    expect(formatMcpToolLabel("search_rd_marketing_journey_notifications")).toBe(
      "Busca de Notificações de Jornada RD Marketing",
    );

    expect(
      summarizeMcpToolResult("list_rd_marketing_flows", {
        returnedCount: 2,
        totalFlowsInTenant: 5,
        enabledCount: 4,
        pausedCount: 1,
      }),
    ).toContain("2/5 fluxo(s) RD Marketing");
    expect(
      summarizeMcpToolResult("list_rd_marketing_events", { returnedCount: 7 }),
    ).toContain("7 evento(s) webhook RD Marketing");
    expect(
      summarizeMcpToolResult("list_rd_marketing_logs", { returnedCount: 12 }),
    ).toContain("12 log(s) RD Marketing");
    expect(
      summarizeMcpToolResult("search_rd_marketing_journey_notifications", { returnedCount: 3 }),
    ).toContain("3 notificação(ões) de jornada RD Marketing");

    const catalog = getApiLibraryCatalog("tecfag");
    const catalogMcpNames = new Set(
      catalog.filter((e) => e.kind === "mcp" && e.mcpToolName).map((e) => e.mcpToolName),
    );
    for (const tool of MCP_TOOLS) {
      expect(catalogMcpNames.has(tool.name)).toBe(true);
    }
  });

  it("mascara token de webhook sem nunca vazar o segredo completo e resume payloads de leads", () => {
    const fullToken =
      "b8dc2e5b5ded0719e1422d55c1edcab2270935e4fc225675fb74097a418b4f1b";
    const masked = maskFlowWebhookToken(fullToken);
    expect(masked.tokenSuffix).toBe("418b4f1b");
    expect(masked.tokenMasked).toBe("b8dc2e5b...418b4f1b");
    expect(masked.tokenMasked).not.toContain(fullToken);
    expect(maskFlowWebhookToken(null)).toEqual({ tokenMasked: null, tokenSuffix: null });

    const summary = summarizeRdEventPayload({
      leads: [
        {
          uuid: "rd-uuid-123",
          name: "Manoel Marcos",
          email: "ribeiromanoelmarcos1@gmail.com",
          mobile_phone: "+55 75 99975-5641",
          first_conversion: {
            content: {
              identificador: "Botão Whatsapp | LP Black November 2026",
              utm_source: "google-display",
              utm_medium: "cpc",
              utm_campaign: "black-november-2026",
            },
          },
          last_conversion: {
            content: {
              identificador: "Botão Whatsapp | LP Black November 2026",
              utm_source: "google-display",
              utm_medium: "cpc",
              utm_campaign: "black-november-2026",
            },
          },
        },
      ],
    });

    expect(summary.leadsCount).toBe(1);
    expect(summary.leads[0]?.name).toBe("Manoel Marcos");
    expect(summary.leads[0]?.email).toBe("ribeiromanoelmarcos1@gmail.com");
    expect(summary.leads[0]?.phone).toBe("+55 75 99975-5641");
    expect(summary.leads[0]?.lastConversionIdentifier).toBe(
      "Botão Whatsapp | LP Black November 2026",
    );
    expect(summary.leads[0]?.utmSource).toBe("google-display");
    expect(summary.leads[0]?.utmCampaign).toBe("black-november-2026");
  });

  if (RUN_DB_TESTS) {
    describe("Integração PostgreSQL real + Isolamento Multi-Tenant (tecfag vs valem)", () => {
      const suffix = crypto.randomBytes(4).toString("hex");
      const tfPipelineId = `pipe-test-rd-tf-${suffix}`;
      const tfStageId = `stg-test-rd-tf-${suffix}`;
      const vlPipelineId = `pipe-test-rd-vl-${suffix}`;
      const vlStageId = `stg-test-rd-vl-${suffix}`;
      const tfFlowId = `flow-test-rd-tf-${suffix}`;
      const vlFlowId = `flow-test-rd-vl-${suffix}`;
      const tfToken = crypto.randomBytes(32).toString("hex");
      const vlToken = crypto.randomBytes(32).toString("hex");
      const tfEventId = `ev-test-rd-tf-${suffix}`;
      const vlEventId = `ev-test-rd-vl-${suffix}`;
      const tfLogCreatedId = `lg-test-rd-tf-c-${suffix}`;
      const tfLogDiagId = `lg-test-rd-tf-d-${suffix}`;
      const vlLogId = `lg-test-rd-vl-${suffix}`;
      const tfEpId = `ep-test-rd-tf-${suffix}`;
      const vlEpId = `ep-test-rd-vl-${suffix}`;
      const tfNotifId = `jn-test-rd-tf-${suffix}`;
      const vlNotifId = `jn-test-rd-vl-${suffix}`;

      beforeAll(async () => {
        await db
          .insert(tenants)
          .values([
            { id: "tecfag", name: "Tecfag", slug: "tecfag", connectionType: "meta" },
            { id: "valem", name: "Valem", slug: "valem", connectionType: "baileys" },
          ])
          .onConflictDoNothing();

        await db.insert(crmPipelines).values([
          { id: tfPipelineId, tenantId: "tecfag", name: `Funil Teste RD TF ${suffix}` },
          { id: vlPipelineId, tenantId: "valem", name: `Funil Teste RD VL ${suffix}` },
        ]);

        await db.insert(crmStages).values([
          {
            id: tfStageId,
            tenantId: "tecfag",
            pipelineId: tfPipelineId,
            name: "CONTATAR",
            orderIndex: 0,
          },
          {
            id: vlStageId,
            tenantId: "valem",
            pipelineId: vlPipelineId,
            name: "NOVO",
            orderIndex: 0,
          },
        ]);

        await db.insert(rdMarketingFlows).values([
          {
            id: tfFlowId,
            tenantId: "tecfag",
            tokenHash: hashToken(tfToken),
            tokenEncrypted: encodeFlowWebhookToken("tecfag", tfToken),
            settings: {
              name: `Botão Whatsapp | LP Black Test ${suffix}`,
              enabled: true,
              pipelineId: tfPipelineId,
              stageId: tfStageId,
              operatorId: null,
              deduplication: "event",
              eventIdPath: "rd_conversion.id",
              campaignFromFlow: true,
              mappings: [
                { source: "name", target: "contact.name" },
                { source: "name", target: "deal.title" },
              ],
            },
          },
          {
            id: vlFlowId,
            tenantId: "valem",
            tokenHash: hashToken(vlToken),
            tokenEncrypted: encodeFlowWebhookToken("valem", vlToken),
            settings: {
              name: `Fluxo Secreto Valem ${suffix}`,
              enabled: false,
              pipelineId: vlPipelineId,
              stageId: vlStageId,
              operatorId: null,
              deduplication: "lead",
              eventIdPath: "rd_conversion.id",
              mappings: [
                { source: "name", target: "contact.name" },
                { source: "name", target: "deal.title" },
              ],
            },
          },
        ]);

        await db.insert(rdMarketingEvents).values([
          {
            id: tfEventId,
            tenantId: "tecfag",
            flowId: tfFlowId,
            status: "error",
            attempts: 2,
            errorMessage: "Telefone do contato inválido.",
            outcomes: [{ index: 0, status: "error", error: "Telefone do contato inválido." }],
            payload: {
              leads: [
                {
                  uuid: `uuid-tf-${suffix}`,
                  name: `Lead Black Teste ${suffix}`,
                  email: `lead.black.${suffix}@example.com`,
                  mobile_phone: "+55 75 99975-5641",
                  last_conversion: {
                    content: { identificador: `LP Black Test ${suffix}` },
                  },
                },
              ],
            },
            settings: {
              name: `Botão Whatsapp | LP Black Test ${suffix}`,
              enabled: true,
              pipelineId: tfPipelineId,
              stageId: tfStageId,
              operatorId: null,
              deduplication: "event",
              eventIdPath: "rd_conversion.id",
              mappings: [
                { source: "name", target: "contact.name" },
                { source: "name", target: "deal.title" },
              ],
            },
          },
          {
            id: vlEventId,
            tenantId: "valem",
            flowId: vlFlowId,
            status: "processed",
            attempts: 1,
            outcomes: [{ index: 0, status: "created", dealId: `deal-vl-${suffix}` }],
            payload: {
              leads: [
                {
                  name: `Lead Valem Sigiloso ${suffix}`,
                  email: `sigilo.valem.${suffix}@example.com`,
                },
              ],
            },
            settings: {
              name: `Fluxo Secreto Valem ${suffix}`,
              enabled: false,
              pipelineId: vlPipelineId,
              stageId: vlStageId,
              operatorId: null,
              deduplication: "lead",
              eventIdPath: "rd_conversion.id",
              mappings: [
                { source: "name", target: "contact.name" },
                { source: "name", target: "deal.title" },
              ],
            },
          },
        ]);

        await db.insert(rdMarketingLogs).values([
          {
            id: tfLogCreatedId,
            tenantId: "tecfag",
            flowId: tfFlowId,
            status: "error",
            message: `Falha de teste ${suffix}: telefone inválido`,
          },
          {
            id: tfLogDiagId,
            tenantId: "tecfag",
            flowId: tfFlowId,
            status: "diagnostic",
            message: JSON.stringify({ version: 1, note: `diag-${suffix}` }),
          },
          {
            id: vlLogId,
            tenantId: "valem",
            flowId: vlFlowId,
            status: "created",
            dealId: `deal-vl-${suffix}`,
            message: `Card Valem sigiloso ${suffix}`,
          },
        ]);

        await db.insert(rdMarketingJourneyEndpoints).values([
          {
            id: tfEpId,
            tenantId: "tecfag",
            connectionVersion: "v1",
            kind: "CONVERSION",
            label: `Conversões Teste TF ${suffix}`,
            tokenHash: `hash-ep-tf-${suffix}`,
            tokenEncrypted: "enc-dummy-tf",
            enabled: true,
            registrationStatus: "registered",
          },
          {
            id: vlEpId,
            tenantId: "valem",
            connectionVersion: "v1",
            kind: "CONVERSION",
            label: `Conversões Teste VL ${suffix}`,
            tokenHash: `hash-ep-vl-${suffix}`,
            tokenEncrypted: "enc-dummy-vl",
            enabled: true,
            registrationStatus: "registered",
          },
        ]);

        await db.insert(rdMarketingJourneyNotifications).values([
          {
            id: tfNotifId,
            tenantId: "tecfag",
            connectionVersion: "v1",
            endpointId: tfEpId,
            rdUuid: `uuid-tf-${suffix}`,
            email: `lead.black.${suffix}@example.com`,
            phone: "5575999755641",
            eventType: "CONVERSION",
            eventKey: `ek-tf-${suffix}`,
            identifier: `Botão Whatsapp | LP Black Test ${suffix}`,
            occurredAt: new Date(),
            data: {
              title: "Conversão Teste",
              identifier: `Botão Whatsapp | LP Black Test ${suffix}`,
            } as any,
          },
          {
            id: vlNotifId,
            tenantId: "valem",
            connectionVersion: "v1",
            endpointId: vlEpId,
            rdUuid: `uuid-vl-${suffix}`,
            email: `sigilo.valem.${suffix}@example.com`,
            phone: "5511999990000",
            eventType: "CONVERSION",
            eventKey: `ek-vl-${suffix}`,
            identifier: `Conversao Valem ${suffix}`,
            occurredAt: new Date(),
            data: { title: "Sigilo Valem" } as any,
          },
        ]);
      });

      afterAll(async () => {
        await db
          .delete(rdMarketingJourneyNotifications)
          .where(inArray(rdMarketingJourneyNotifications.id, [tfNotifId, vlNotifId]));
        await db
          .delete(rdMarketingJourneyEndpoints)
          .where(inArray(rdMarketingJourneyEndpoints.id, [tfEpId, vlEpId]));
        await db
          .delete(rdMarketingLogs)
          .where(inArray(rdMarketingLogs.id, [tfLogCreatedId, tfLogDiagId, vlLogId]));
        await db
          .delete(rdMarketingEvents)
          .where(inArray(rdMarketingEvents.id, [tfEventId, vlEventId]));
        await db
          .delete(rdMarketingFlows)
          .where(inArray(rdMarketingFlows.id, [tfFlowId, vlFlowId]));
        await db
          .delete(crmStages)
          .where(inArray(crmStages.id, [tfStageId, vlStageId]));
        await db
          .delete(crmPipelines)
          .where(inArray(crmPipelines.id, [tfPipelineId, vlPipelineId]));
      });

      it("list_rd_marketing_flows retorna apenas fluxos do tenant, com sufixo mascarado e sem vazar token completo", async () => {
        const res = await callMcp(
          "list_rd_marketing_flows",
          { query: suffix },
          makeAccess("read", "tecfag"),
        );
        expect(res.isError).toBe(false);
        expect(res.data.tenantId).toBe("tecfag");
        expect(res.data.returnedCount).toBe(1);

        const flow = res.data.flows[0];
        expect(flow.id).toBe(tfFlowId);
        expect(flow.name).toBe(`Botão Whatsapp | LP Black Test ${suffix}`);
        expect(flow.enabled).toBe(true);
        expect(flow.tokenSuffix).toBe(tfToken.slice(-8));
        expect(flow.tokenMasked).toBe(`${tfToken.slice(0, 8)}...${tfToken.slice(-8)}`);
        expect(JSON.stringify(res.data)).not.toContain(tfToken);
        expect(JSON.stringify(res.data)).not.toContain(vlFlowId);
        expect(flow.pipeline.name).toBe(`Funil Teste RD TF ${suffix}`);
        expect(flow.stage.name).toBe("CONTATAR");
        expect(flow.stats.totalEvents).toBe(1);
        expect(flow.stats.errorEvents).toBe(1);
        expect(flow.stats.errorLogsCount).toBe(1);
      });

      it("list_rd_marketing_events filtra por query/status e respeita isolamento de tenant", async () => {
        const res = await callMcp(
          "list_rd_marketing_events",
          { query: `lead.black.${suffix}`, status: "error", includePayload: true },
          makeAccess("read", "tecfag"),
        );
        expect(res.isError).toBe(false);
        expect(res.data.returnedCount).toBe(1);
        expect(res.data.events[0].id).toBe(tfEventId);
        expect(res.data.events[0].errorMessage).toBe("Telefone do contato inválido.");
        expect(res.data.events[0].leadSummary.leads[0].name).toBe(`Lead Black Teste ${suffix}`);
        expect(res.data.events[0].payload).toBeTruthy();

        const crossTenant = await callMcp(
          "list_rd_marketing_events",
          { query: `sigilo.valem.${suffix}` },
          makeAccess("read", "tecfag"),
        );
        expect(crossTenant.isError).toBe(false);
        expect(crossTenant.data.returnedCount).toBe(0);
      });

      it("list_rd_marketing_logs oculta diagnostic por padrão e inclui quando includeDiagnostics=true", async () => {
        const defaultRes = await callMcp(
          "list_rd_marketing_logs",
          { flowId: tfFlowId },
          makeAccess("read", "tecfag"),
        );
        expect(defaultRes.isError).toBe(false);
        expect(defaultRes.data.returnedCount).toBe(1);
        expect(defaultRes.data.logs[0].id).toBe(tfLogCreatedId);

        const withDiag = await callMcp(
          "list_rd_marketing_logs",
          { flowId: tfFlowId, includeDiagnostics: true },
          makeAccess("read", "tecfag"),
        );
        expect(withDiag.isError).toBe(false);
        expect(withDiag.data.returnedCount).toBe(2);
      });

      it("search_rd_marketing_journey_notifications encontra a conversão exata sem vazar dados do outro tenant", async () => {
        const res = await callMcp(
          "search_rd_marketing_journey_notifications",
          { query: `lead.black.${suffix}`, eventType: "CONVERSION" },
          makeAccess("read", "tecfag"),
        );
        expect(res.isError).toBe(false);
        expect(res.data.returnedCount).toBe(1);
        expect(res.data.notifications[0].id).toBe(tfNotifId);
        expect(res.data.notifications[0].identifier).toBe(
          `Botão Whatsapp | LP Black Test ${suffix}`,
        );
        expect(res.data.notifications[0].endpoint?.label).toBe(`Conversões Teste TF ${suffix}`);

        const crossTenant = await callMcp(
          "search_rd_marketing_journey_notifications",
          { query: `sigilo.valem.${suffix}` },
          makeAccess("read", "tecfag"),
        );
        expect(crossTenant.isError).toBe(false);
        expect(crossTenant.data.returnedCount).toBe(0);
      });
    });
  }
});
