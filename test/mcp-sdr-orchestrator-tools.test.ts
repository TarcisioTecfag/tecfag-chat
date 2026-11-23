import { describe, expect, it } from "bun:test";
import crypto from "node:crypto";
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
  MCP_SDR_ORCHESTRATOR_TOOLS,
  resolveMcpSdrOrchestratorActorName,
} from "../src/lib/mcp/valem-tecfag-mcp-sdr-orchestrator-tools";
import { getApiLibraryCatalog } from "../src/lib/marketing/api-library-catalog";

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
    keyId: `test-sdr-orch-${accessLevel}`,
    keyLabel: `Orquestrador SDR (${accessLevel})`,
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
  return { isError: false as const, errorText: "", data: text ? JSON.parse(text) : null };
}

describe("MCP v3.9.0 — Orquestrador SDR Industrial (Aprovação, Correção, Conclusão, Stop/Resume e Recovery)", () => {
  it("expõe versão 3.9.0, separa leitura/escrita corretamente e mantém 100% de paridade na Biblioteca de API", () => {
    expect(MCP_SERVER_INFO.version).toBe("3.10.0");
    expect(MCP_SDR_ORCHESTRATOR_TOOLS).toHaveLength(5);

    const readTools = getVisibleMcpTools(makeAccess("read"));
    const rwTools = getVisibleMcpTools(makeAccess("read_write"));
    const readNames = new Set(readTools.map((t) => t.name));
    const rwNames = new Set(rwTools.map((t) => t.name));

    expect(readNames.has("get_triage_approval_options")).toBe(true);
    expect(readNames.has("approve_fagner_triage")).toBe(false);
    expect(readNames.has("dismiss_fagner_triage")).toBe(false);
    expect(readNames.has("stop_or_resume_fagner_triage")).toBe(false);
    expect(readNames.has("recover_fagner_stuck_turns")).toBe(false);

    for (const tool of MCP_SDR_ORCHESTRATOR_TOOLS) {
      expect(rwNames.has(tool.name)).toBe(true);
    }

    expect(isWriteMcpTool("get_triage_approval_options")).toBe(false);
    expect(isWriteMcpTool("approve_fagner_triage")).toBe(true);
    expect(isWriteMcpTool("dismiss_fagner_triage")).toBe(true);
    expect(isWriteMcpTool("stop_or_resume_fagner_triage")).toBe(true);
    expect(isWriteMcpTool("recover_fagner_stuck_turns")).toBe(true);

    expect(formatMcpToolLabel("get_triage_approval_options")).toContain("Opções Oficiais de Aprovação SDR");
    expect(formatMcpToolLabel("approve_fagner_triage")).toContain("Aprovar / Corrigir Triagem SDR");
    expect(formatMcpToolLabel("dismiss_fagner_triage")).toContain("Concluir Triagem SDR sem Transferir");
    expect(formatMcpToolLabel("stop_or_resume_fagner_triage")).toContain("Parar / Retomar Assistente IA");
    expect(formatMcpToolLabel("recover_fagner_stuck_turns")).toContain("Recuperar Turnos Travados");

    expect(
      summarizeMcpToolResult("get_triage_approval_options", {
        sectorsCount: 8,
        operatorsCount: 24,
        pipelinesCount: 7,
      }),
    ).toContain("8 setor(es), 24 operador(es) e 7 funil(is)");
    expect(
      summarizeMcpToolResult("approve_fagner_triage", {
        conversationId: "conv-1",
        operatorName: "Guilherme",
        targetFunnel: "Máquinas",
      }),
    ).toContain("Triagem aprovada na conversa conv-1 → Guilherme (Máquinas)");
    expect(
      summarizeMcpToolResult("dismiss_fagner_triage", {
        conversationId: "conv-2",
        queueState: "finalizados",
      }),
    ).toContain("Triagem concluída sem transferência na conversa conv-2");
    expect(
      summarizeMcpToolResult("stop_or_resume_fagner_triage", {
        action: "stop",
        assistantName: "Fagner",
        conversationId: "conv-3",
        queueState: "fila",
      }),
    ).toContain("Fagner interrompido na conversa conv-3 (fila)");
    expect(
      summarizeMcpToolResult("recover_fagner_stuck_turns", {
        recoveredCount: 3,
      }),
    ).toContain("3 conversa(s) reativada(s)");

    // Paridade 100% entre MCP_TOOLS e Biblioteca de API
    const catalogTecfag = getApiLibraryCatalog("tecfag");
    const catalogMcpNames = new Set(
      catalogTecfag.filter((e) => e.kind === "mcp" && e.mcpToolName).map((e) => e.mcpToolName),
    );
    for (const tool of MCP_TOOLS) {
      expect(catalogMcpNames.has(tool.name)).toBe(true);
    }
  });

  it("bloqueia tools de escrita SDR quando a chave MCP é somente leitura ('read')", async () => {
    const readAccess = makeAccess("read", "tecfag");
    for (const name of [
      "approve_fagner_triage",
      "dismiss_fagner_triage",
      "stop_or_resume_fagner_triage",
      "recover_fagner_stuck_turns",
    ]) {
      const res = await callMcp(name, { conversationId: "conv-test" }, readAccess);
      expect(res.isError).toBe(true);
      expect(res.errorText.toLowerCase()).toMatch(/leitura|escrita|permiss|read_write/);
    }
  });

  it("preserva isolamento multi-tenant bloqueando tools industriais no tenant não-industrial (valem)", async () => {
    const valemRw = makeAccess("read_write", "valem");
    for (const name of [
      "get_triage_approval_options",
      "approve_fagner_triage",
      "dismiss_fagner_triage",
      "recover_fagner_stuck_turns",
    ]) {
      const res = await callMcp(name, { conversationId: "conv-valem-1" }, valemRw);
      expect(res.isError).toBe(true);
      expect(res.errorText.toLowerCase()).toContain("industrial");
    }
  });

  it("resolve corretamente o nome do ator do Orquestrador SDR", () => {
    expect(resolveMcpSdrOrchestratorActorName("Orquestrador Telegram", "Operador", { keyLabel: "Chave" })).toBe(
      "Orquestrador Telegram",
    );
    expect(resolveMcpSdrOrchestratorActorName(undefined, "Guilherme", { keyLabel: "Chave" })).toBe("Guilherme");
    expect(resolveMcpSdrOrchestratorActorName(undefined, undefined, { keyLabel: "Orquestrador SDR" })).toBe(
      "Orquestrador SDR",
    );
    expect(resolveMcpSdrOrchestratorActorName(undefined, undefined, undefined)).toBe("Orquestrador SDR (MCP)");
  });
});
