import { describe, expect, it } from "bun:test";
import {
  MCP_SERVER_INFO,
  MCP_TOOLS,
  formatMcpToolLabel,
  getVisibleMcpTools,
  processMcpJsonRpcPayload,
  summarizeMcpToolResult,
  type McpAccessContext,
} from "../src/lib/mcp/valem-tecfag-mcp-core";
import {
  computeTriageConversationMetrics,
  detectTriageQualityFlags,
  resolveTriageAuditDateWindow,
} from "../src/lib/mcp/valem-tecfag-mcp-triage-tools";
import { getApiLibraryCatalog } from "../src/lib/marketing/api-library-catalog";

function makeReadAccess(tenantId: "tecfag" | "valem" = "tecfag"): McpAccessContext {
  return {
    authorized: true,
    lockedTenantId: tenantId,
    defaultTenantId: tenantId,
    authMode: tenantId === "valem" ? "token_valem" : "token_tecfag",
    accessLevel: "read",
    keyId: "test-triage-read-key",
    keyLabel: "Chave Leitura Triagem",
    skipAuditLog: true,
  };
}

describe("MCP v3.4.0 — Ferramentas de Varredura e Auditoria Precisa de Triagens SDR", () => {
  it("expõe get_fagner_triage_sweep e get_fagner_triage_audit_batch em modo Somente Leitura com paridade total", () => {
    expect(MCP_SERVER_INFO.version).toBe("3.6.0");

    const readTools = getVisibleMcpTools(makeReadAccess("tecfag"));
    const readNames = new Set(readTools.map((t) => t.name));

    expect(readNames.has("get_fagner_triage_overview")).toBe(true);
    expect(readNames.has("get_fagner_triage_history")).toBe(true);
    expect(readNames.has("get_triage_summary")).toBe(true);
    expect(readNames.has("get_fagner_triage_sweep")).toBe(true);
    expect(readNames.has("get_fagner_triage_audit_batch")).toBe(true);

    const overviewTool = MCP_TOOLS.find((t) => t.name === "get_fagner_triage_overview")!;
    expect(overviewTool.description).toContain("awaiting_approval");
    expect((overviewTool.inputSchema as any).properties.period).toBeDefined();
    expect((overviewTool.inputSchema as any).properties.startDate).toBeDefined();
    expect((overviewTool.inputSchema as any).properties.endDate).toBeDefined();
    expect((overviewTool.inputSchema as any).properties.targetFunnel).toBeDefined();
    expect((overviewTool.inputSchema as any).properties.channel).toBeDefined();

    expect(formatMcpToolLabel("get_fagner_triage_sweep")).toBe("Varredura SQL da Triagem IA");
    expect(formatMcpToolLabel("get_fagner_triage_audit_batch")).toBe(
      "Auditoria em Lote da Triagem IA",
    );

    expect(
      summarizeMcpToolResult("get_fagner_triage_overview", {
        totalTrackedConversations: 12,
        countsByState: { collecting: 3, awaiting_approval: 2, transferred: 7 },
      }),
    ).toContain("2 aguardando aprovação");

    expect(
      summarizeMcpToolResult("get_fagner_triage_sweep", {
        period: "today",
        summary: {
          totalAnalyzed: 18,
          awaitingAiCount: 1,
          awaitingApprovalCount: 3,
          transferredCount: 10,
        },
      }),
    ).toContain("3 aprovação SDR");

    expect(
      summarizeMcpToolResult("get_fagner_triage_audit_batch", {
        period: "today",
        auditSummary: { totalMatched: 15, returnedCount: 10 },
      }),
    ).toContain("10/15");
  });

  it("isola persona corretamente no catálogo da Biblioteca de API (Tecfag = Fagner, Valem = Valentina)", () => {
    const tfCatalog = getApiLibraryCatalog("tecfag");
    const vlCatalog = getApiLibraryCatalog("valem");

    const tfSweep = tfCatalog.find((e) => e.mcpToolName === "get_fagner_triage_sweep")!;
    const vlSweep = vlCatalog.find((e) => e.mcpToolName === "get_fagner_triage_sweep")!;
    const tfBatch = tfCatalog.find((e) => e.mcpToolName === "get_fagner_triage_audit_batch")!;
    const vlBatch = vlCatalog.find((e) => e.mcpToolName === "get_fagner_triage_audit_batch")!;

    expect(tfSweep.title).toContain("Fagner");
    expect(tfSweep.title).not.toContain("Valentina");
    expect(tfSweep.supportsLivePlayground).toBe(true);

    expect(vlSweep.title).toContain("Valentina");
    expect(vlSweep.title).not.toContain("Fagner");

    expect(tfBatch.title).toContain("Fagner");
    expect(tfBatch.title).not.toContain("Valentina");
    expect(tfBatch.supportsLivePlayground).toBe(true);

    expect(vlBatch.title).toContain("Valentina");
    expect(vlBatch.title).not.toContain("Fagner");
  });

  it("resolve janelas de data em Brasília (today, 7d, 30d, range e all) com exatidão", () => {
    const ref = new Date("2026-11-22T17:15:00.000Z"); // 14:15 BRT

    const today = resolveTriageAuditDateWindow({ period: "today", now: ref });
    expect(today.period).toBe("today");
    expect(today.startUtc?.toISOString()).toBe("2026-11-22T03:00:00.000Z");
    expect(today.endUtc?.toISOString()).toBe("2026-11-23T02:59:59.999Z");

    const sevenDays = resolveTriageAuditDateWindow({ period: "7d", now: ref });
    expect(sevenDays.period).toBe("7d");
    expect(sevenDays.startUtc?.toISOString()).toBe("2026-11-16T03:00:00.000Z");
    expect(sevenDays.endUtc?.toISOString()).toBe("2026-11-23T02:59:59.999Z");

    const inferredRange = resolveTriageAuditDateWindow({
      startDate: "2026-11-20",
      endDate: "2026-11-21",
      now: ref,
    });
    expect(inferredRange.period).toBe("range");
    expect(inferredRange.startUtc?.toISOString()).toBe("2026-11-20T03:00:00.000Z");
    expect(inferredRange.endUtc?.toISOString()).toBe("2026-11-22T02:59:59.999Z");

    const all = resolveTriageAuditDateWindow({ period: "all", now: ref });
    expect(all.startUtc).toBeNull();
    expect(all.endUtc).toBeNull();
  });

  it("calcula SLA de 1ª resposta, contagens e detecta flags determinísticas de qualidade", () => {
    const now = new Date("2026-11-22T17:30:00.000Z");
    const metrics = computeTriageConversationMetrics(
      [
        { senderType: "client", sentAt: "2026-11-22T17:00:00.000Z" },
        { senderType: "bot", sentAt: "2026-11-22T17:04:00.000Z" }, // 240s (> 3m)
        { senderType: "client", sentAt: "2026-11-22T17:10:00.000Z" }, // 20 min waiting
      ],
      now,
    );

    expect(metrics.totalMessages).toBe(3);
    expect(metrics.clientMessages).toBe(2);
    expect(metrics.aiMessages).toBe(1);
    expect(metrics.humanAgentMessages).toBe(0);
    expect(metrics.firstResponseSeconds).toBe(240);
    expect(metrics.lastMessageSender).toBe("client");
    expect(metrics.waitingMinutes).toBe(20);

    const flags = detectTriageQualityFlags({
      monitoringState: "collecting",
      handoffIssue: null,
      outcome: "in_progress",
      queueState: "automacao",
      metrics,
      fieldsPercentage: 28,
      linkedDealsCount: 0,
      hasTargetFunnel: false,
    });

    expect(flags).toContain("awaiting_ai_reply");
    expect(flags).toContain("slow_first_reply_gt_3m");
    expect(flags).toContain("no_linked_crm_deal");

    const approvalFlags = detectTriageQualityFlags({
      monitoringState: "awaiting_approval",
      handoffIssue: null,
      outcome: "in_progress",
      queueState: "automacao",
      metrics: { ...metrics, lastMessageSender: "bot", firstResponseSeconds: 15 },
      fieldsPercentage: 40,
      linkedDealsCount: 1,
      hasTargetFunnel: false,
    });

    expect(approvalFlags).toContain("awaiting_approval_pending");
    expect(approvalFlags).toContain("low_field_completion");
    expect(approvalFlags).toContain("missing_target_funnel");
    expect(approvalFlags).not.toContain("awaiting_ai_reply");
    expect(approvalFlags).not.toContain("no_linked_crm_deal");
  });

  it("executa get_fagner_triage_sweep, get_fagner_triage_audit_batch e get_fagner_triage_overview via JSON-RPC contra o banco real quando configurado", async () => {
    if (!process.env.DATABASE_URL) {
      return;
    }

    const access = makeReadAccess("tecfag");

    const [sweepRes, batchRes, overviewRes] = await Promise.all([
      processMcpJsonRpcPayload(
        {
          jsonrpc: "2.0",
          id: 101,
          method: "tools/call",
          params: {
            name: "get_fagner_triage_sweep",
            arguments: { period: "all", limitPerBucket: 5 },
          },
        },
        access,
      ),
      processMcpJsonRpcPayload(
        {
          jsonrpc: "2.0",
          id: 102,
          method: "tools/call",
          params: {
            name: "get_fagner_triage_audit_batch",
            arguments: { period: "all", limit: 3, messagesPerConversation: 5 },
          },
        },
        access,
      ),
      processMcpJsonRpcPayload(
        {
          jsonrpc: "2.0",
          id: 103,
          method: "tools/call",
          params: {
            name: "get_fagner_triage_overview",
            arguments: { period: "all", limit: 5 },
          },
        },
        access,
      ),
    ]);

    expect(sweepRes.body?.result?.isError).not.toBe(true);
    const sweepData = JSON.parse(sweepRes.body.result.content[0].text);
    expect(sweepData.tenantId).toBe("tecfag");
    expect(sweepData.aiPersona).toBe("Fagner");
    expect(typeof sweepData.summary.totalAnalyzed).toBe("number");
    expect(typeof sweepData.summary.awaitingApprovalCount).toBe("number");
    expect(Array.isArray(sweepData.awaitingApproval)).toBe(true);
    expect(Array.isArray(sweepData.transferredByOperator)).toBe(true);

    expect(batchRes.body?.result?.isError).not.toBe(true);
    const batchData = JSON.parse(batchRes.body.result.content[0].text);
    expect(batchData.tenantId).toBe("tecfag");
    expect(batchData.aiPersona).toBe("Fagner");
    expect(typeof batchData.auditSummary.totalMatched).toBe("number");
    expect(Array.isArray(batchData.sessions)).toBe(true);

    expect(overviewRes.body?.result?.isError).not.toBe(true);
    const overviewData = JSON.parse(overviewRes.body.result.content[0].text);
    expect(overviewData.tenantId).toBe("tecfag");
    expect(overviewData.aiPersona).toBe("Fagner");
    expect(typeof overviewData.totalTrackedConversations).toBe("number");
    expect(typeof overviewData.countsByFunnel).toBe("object");
  }, 20000);
});
