import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
import {
  MCP_TOOLS,
  getVisibleMcpTools,
  inferMcpAuditEventType,
  isWriteMcpTool,
  normalizeMcpAccessLevel,
  processMcpJsonRpcPayload,
  summarizeMcpToolResult,
  type McpAccessContext,
} from "../src/lib/mcp/valem-tecfag-mcp-core";
import { getApiLibraryCatalog } from "../src/lib/marketing/api-library-catalog";

function makeAccess(accessLevel: "read" | "read_write" | undefined): McpAccessContext {
  return {
    authorized: true,
    lockedTenantId: "tecfag",
    defaultTenantId: "tecfag",
    authMode: "token_tecfag",
    accessLevel,
    keyId: "test-key",
    keyLabel: "Chave de Teste",
    skipAuditLog: true,
  };
}

describe("MCP Editável Real (/api/mcp + permissão read/read_write + ponte stdio)", () => {
  it("possui 34 ferramentas únicas (12 leitura + 22 escrita) com 100% de paridade no catálogo da Biblioteca de API", () => {
    const readTools = MCP_TOOLS.filter((t) => t.access === "read");
    const writeTools = MCP_TOOLS.filter((t) => t.access === "write");

    expect(MCP_TOOLS).toHaveLength(34);
    expect(readTools).toHaveLength(12);
    expect(writeTools).toHaveLength(22);
    expect(new Set(MCP_TOOLS.map((t) => t.name)).size).toBe(34);

    const catalogMcp = getApiLibraryCatalog("tecfag").filter((e) => e.kind === "mcp");
    const coreNames = new Set(MCP_TOOLS.map((t) => t.name));
    const catalogNames = new Set(catalogMcp.map((e) => e.mcpToolName));

    expect(catalogMcp).toHaveLength(34);
    expect(catalogNames.size).toBe(34);
    for (const name of coreNames) {
      expect(catalogNames.has(name)).toBe(true);
    }
  });

  it("faz fallback seguro para 'read' em normalizeMcpAccessLevel e filtra tools/list por permissão", async () => {
    expect(normalizeMcpAccessLevel(undefined)).toBe("read");
    expect(normalizeMcpAccessLevel("admin")).toBe("read");
    expect(normalizeMcpAccessLevel("read")).toBe("read");
    expect(normalizeMcpAccessLevel("read_write")).toBe("read_write");

    const readVisible = getVisibleMcpTools(makeAccess("read"));
    const rwVisible = getVisibleMcpTools(makeAccess("read_write"));
    expect(readVisible).toHaveLength(12);
    expect(readVisible.every((t) => t.access === "read")).toBe(true);
    expect(rwVisible).toHaveLength(34);

    const listRead = await processMcpJsonRpcPayload(
      { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
      makeAccess("read"),
    );
    expect(listRead.body?.result?.tools).toHaveLength(12);
    expect(
      listRead.body.result.tools.some((t: { name: string }) => isWriteMcpTool(t.name)),
    ).toBe(false);

    const listRw = await processMcpJsonRpcPayload(
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
      makeAccess("read_write"),
    );
    expect(listRw.body?.result?.tools).toHaveLength(34);
  });

  it("bloqueia TODAS as 22 ferramentas de escrita quando a chave tem permissão 'read' ou indefinida", async () => {
    const writeTools = MCP_TOOLS.filter((t) => t.access === "write");
    for (const tool of writeTools) {
      const resRead = await processMcpJsonRpcPayload(
        {
          jsonrpc: "2.0",
          id: `deny-${tool.name}`,
          method: "tools/call",
          params: { name: tool.name, arguments: {} },
        },
        makeAccess("read"),
      );
      expect(resRead.body?.result?.isError).toBe(true);
      const errText = String(resRead.body?.result?.content?.[0]?.text || "");
      expect(errText).toContain("Permissão insuficiente (Somente Leitura)");
    }

    const resUndefined = await processMcpJsonRpcPayload(
      {
        jsonrpc: "2.0",
        id: "deny-undef",
        method: "tools/call",
        params: { name: "chat_send_message", arguments: { conversationId: "c1", content: "oi" } },
      },
      makeAccess(undefined),
    );
    expect(resUndefined.body?.result?.isError).toBe(true);
    expect(String(resUndefined.body?.result?.content?.[0]?.text || "")).toContain(
      "Permissão insuficiente (Somente Leitura)",
    );
  });

  it("valida campos obrigatórios em ferramentas de escrita quando a chave é 'read_write'", async () => {
    const cases: Array<{ name: string; args: Record<string, unknown>; expectedError: string }> = [
      { name: "create_crm_deal", args: {}, expectedError: "'title'" },
      { name: "update_crm_deal_owner", args: { dealId: "d1" }, expectedError: "'operatorId'" },
      { name: "mark_deal_lost", args: { dealId: "d1" }, expectedError: "'lossReason'" },
      { name: "create_contact", args: {}, expectedError: "'name'" },
      { name: "create_account", args: {}, expectedError: "'name'" },
      { name: "create_task", args: {}, expectedError: "'title'" },
      { name: "chat_send_message", args: { conversationId: "c1" }, expectedError: "'content'" },
      { name: "chat_add_internal_note", args: { conversationId: "c1" }, expectedError: "'content'" },
      { name: "chat_transfer_conversation", args: { conversationId: "c1" }, expectedError: "'operatorId'" },
      { name: "chat_close_conversation", args: {}, expectedError: "'conversationId'" },
      { name: "create_conversation", args: {}, expectedError: "'contactId'" },
      {
        name: "update_meta_template_visibility",
        args: { templateId: "t1" },
        expectedError: "'allPipelines'",
      },
      { name: "send_meta_template", args: { conversationId: "c1" }, expectedError: "'templateName'" },
      { name: "create_quick_response", args: { shortcut: "/oi" }, expectedError: "'text'" },
      { name: "delete_quick_response", args: {}, expectedError: "'quickResponseId'" },
      { name: "update_sector", args: {}, expectedError: "'sectorId'" },
    ];

    for (const tc of cases) {
      const res = await processMcpJsonRpcPayload(
        {
          jsonrpc: "2.0",
          id: `val-${tc.name}`,
          method: "tools/call",
          params: { name: tc.name, arguments: tc.args },
        },
        makeAccess("read_write"),
      );
      expect(res.body?.result?.isError).toBe(true);
      expect(String(res.body?.result?.content?.[0]?.text || "")).toContain(tc.expectedError);
    }
  });

  it("não contém mocks/simulações em valem-tecfag-mcp-write-tools.ts e respeita o Design System em McpSettingsTab.tsx", () => {
    const writeToolsCode = fs.readFileSync("src/lib/mcp/valem-tecfag-mcp-write-tools.ts", "utf8");
    expect(writeToolsCode.toLowerCase()).not.toContain("sucesso simulado");
    expect(writeToolsCode.toLowerCase()).not.toContain("simulação");
    expect(writeToolsCode).toContain("crmService.createDeal");
    expect(writeToolsCode).toContain("outboundQueue.enqueueAndSend");
    expect(writeToolsCode).toContain("createMetaTemplate");
    expect(writeToolsCode).toContain("setMetaTemplateBindings");

    const uiCode = fs.readFileSync("src/components/chat/McpSettingsTab.tsx", "utf8");
    expect(uiCode).not.toMatch(/\btitle\s*=\s*["'{]/);
    expect(uiCode).not.toMatch(/<select[\s>]/i);
    expect(uiCode).not.toMatch(/type\s*=\s*["'](date|time|datetime-local)["']/i);
    expect(uiCode).toContain("SystemTooltip");
  });

  it("classifica todas as 22 tools de escrita como 'action' na auditoria e gera resumos específicos", () => {
    const writeTools = MCP_TOOLS.filter((t) => t.access === "write");
    for (const tool of writeTools) {
      expect(inferMcpAuditEventType(tool.name)).toBe("action");
      const summary = summarizeMcpToolResult(tool.name, {
        dealId: "deal-1",
        title: "Teste",
        stageName: "Proposta",
        operatorName: "João",
        lossReason: "Preço",
        name: "Cliente",
        contactId: "cont-1",
        accountId: "acc-1",
        taskId: "task-1",
        status: "completed",
        channel: "meta",
        conversationId: "conv-1",
        messageId: "msg-1",
        queueState: "meus",
        version: 2,
        templateId: "tpl-1",
        templateName: "retorno",
        template: { name: "retorno" },
        allPipelines: true,
        shortcut: "/oi",
        quickResponseId: "qr-1",
        deletedId: "qr-1",
        sectorId: "sec-1",
        operatorIds: ["op-1"],
      });
      expect(summary).not.toBe("Dados retornados com sucesso");
      expect(summary.length).toBeGreaterThan(10);
    }
    expect(inferMcpAuditEventType("list_meta_templates")).toBe("query");
    expect(summarizeMcpToolResult("list_meta_templates", { total: 4 })).toContain("4 template(s)");
  });

  it("executa scripts/mcp-server.mjs com sintaxe válida e ponte stdio JSON-RPC real", async () => {
    const syntax = spawnSync("node", ["--check", "scripts/mcp-server.mjs"], { encoding: "utf8" });
    expect(syntax.status).toBe(0);

    let capturedAuth = "";
    let capturedBridge = "";
    const server = http.createServer((req, res) => {
      capturedAuth = String(req.headers.authorization || "");
      capturedBridge = String(req.headers["x-mcp-bridge"] || "");
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        const rpc = JSON.parse(body || "{}");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: rpc.id,
            result: { echoedMethod: rpc.method, ok: true },
          }),
        );
      });
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address() as { port: number };
    const remoteUrl = `http://127.0.0.1:${addr.port}/api/mcp`;

    try {
      const child = spawn("node", ["scripts/mcp-server.mjs"], {
        env: {
          ...process.env,
          MCP_REMOTE_URL: remoteUrl,
          MCP_TOKEN: "mcp_tf_test_token",
          MCP_CLIENT_LABEL: "TestClient",
        },
        stdio: ["pipe", "pipe", "pipe"],
      });

      const lines: string[] = [];
      const done = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Timeout aguardando resposta stdio")), 8000);
        let buf = "";
        child.stdout.on("data", (chunk) => {
          buf += chunk.toString("utf8");
          const parts = buf.split("\n");
          buf = parts.pop() || "";
          for (const line of parts) {
            if (line.trim()) lines.push(line.trim());
          }
          if (lines.length >= 2) {
            clearTimeout(timer);
            resolve();
          }
        });
        child.on("error", reject);
      });

      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) + "\n");
      child.stdin.write(
        JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }) + "\n",
      );

      await done;
      child.kill();

      const resp1 = JSON.parse(lines[0]);
      const resp2 = JSON.parse(lines[1]);
      expect(resp1).toEqual({ jsonrpc: "2.0", id: 1, result: {} });
      expect(resp2).toEqual({
        jsonrpc: "2.0",
        id: 2,
        result: { echoedMethod: "tools/list", ok: true },
      });
      expect(capturedAuth).toBe("Bearer mcp_tf_test_token");
      expect(capturedBridge).toBe("TestClient");
    } finally {
      server.close();
    }
  });
});
