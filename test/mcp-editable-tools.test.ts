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
  it("possui 83 ferramentas únicas (33 leitura + 50 escrita) com 100% de paridade no catálogo da Biblioteca de API", () => {
    const readTools = MCP_TOOLS.filter((t) => t.access === "read");
    const writeTools = MCP_TOOLS.filter((t) => t.access === "write");

    expect(MCP_TOOLS).toHaveLength(83);
    expect(readTools).toHaveLength(33);
    expect(writeTools).toHaveLength(50);
    expect(new Set(MCP_TOOLS.map((t) => t.name)).size).toBe(83);

    const catalogMcp = getApiLibraryCatalog("tecfag").filter((e) => e.kind === "mcp");
    const coreNames = new Set(MCP_TOOLS.map((t) => t.name));
    const catalogNames = new Set(catalogMcp.map((e) => e.mcpToolName));

    expect(catalogMcp).toHaveLength(83);
    expect(catalogNames.size).toBe(83);
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
    expect(readVisible).toHaveLength(33);
    expect(readVisible.every((t) => t.access === "read")).toBe(true);
    expect(rwVisible).toHaveLength(83);

    const listRead = await processMcpJsonRpcPayload(
      { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
      makeAccess("read"),
    );
    expect(listRead.body?.result?.tools).toHaveLength(33);
    expect(
      listRead.body.result.tools.some((t: { name: string }) => isWriteMcpTool(t.name)),
    ).toBe(false);

    const listRw = await processMcpJsonRpcPayload(
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
      makeAccess("read_write"),
    );
    expect(listRw.body?.result?.tools).toHaveLength(83);
  });

  it("bloqueia TODAS as 50 ferramentas de escrita quando a chave tem permissão 'read' ou indefinida", async () => {
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
      { name: "update_contact", args: {}, expectedError: "'contactId'" },
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
      { name: "update_crm_deal", args: {}, expectedError: "'dealId'" },
      { name: "merge_contacts", args: { sourceContactId: "c1" }, expectedError: "'targetContactId'" },
      { name: "merge_contacts", args: { sourceContactId: "c1", targetContactId: "c1" }, expectedError: "não podem ser iguais" },
      { name: "replace_crm_deal_contact", args: { dealId: "d1" }, expectedError: "'newContactId'" },
      { name: "archive_crm_deal", args: { dealId: "d1" }, expectedError: "'reason'" },
      {
        name: "archive_crm_deal",
        args: { dealId: "d1", reason: "Card duplicado", mode: "delete_permanent" },
        expectedError: "confirmPermanentDelete=true",
      },
      { name: "link_conversation_deal", args: { conversationId: "c1" }, expectedError: "'dealId'" },
      { name: "unlink_conversation_deal", args: { dealId: "d1" }, expectedError: "'conversationId'" },
      { name: "reassign_conversation_contact", args: { conversationId: "c1" }, expectedError: "'newContactId'" },
      { name: "batch_upsert_crm_deals", args: { items: [] }, expectedError: "'items'" },
      {
        name: "batch_upsert_crm_deals",
        args: { items: Array.from({ length: 501 }, () => ({ title: "x" })) },
        expectedError: "Limite máximo de 500 itens",
      },
      {
        name: "chat_send_media",
        args: { conversationId: "c1", mediaType: "image", mediaUrl: "http://127.0.0.1/x.png" },
        expectedError: "HTTPS",
      },
      { name: "add_deal_product", args: {}, expectedError: "'dealId'" },
      { name: "remove_deal_product", args: { dealId: "d1" }, expectedError: "'dealProductId'" },
      { name: "create_deal_proposal", args: {}, expectedError: "'dealId'" },
      { name: "upsert_webhook_subscription", args: {}, expectedError: "'action'" },
      { name: "retry_webhook_delivery", args: {}, expectedError: "'deliveryId'" },
      { name: "set_conversation_triage_mode", args: { conversationId: "c1" }, expectedError: "'action'" },
      { name: "update_triage_summary", args: { conversationId: "c1" }, expectedError: "'summary'" },
      { name: "create_knowledge_folder", args: {}, expectedError: "'name'" },
      { name: "update_knowledge_folder", args: {}, expectedError: "'folderId'" },
      { name: "update_knowledge_folder", args: { folderId: "f1" }, expectedError: "'name' ou 'parentId'" },
      { name: "delete_knowledge_folder", args: {}, expectedError: "'folderId'" },
      { name: "upsert_knowledge_file", args: {}, expectedError: "'name'" },
      { name: "upsert_knowledge_file", args: { name: "doc.txt" }, expectedError: "'content' (texto) ou 'base64'" },
      { name: "update_knowledge_file", args: {}, expectedError: "'fileId'" },
      { name: "update_knowledge_file", args: { fileId: "kf1" }, expectedError: "pelo menos um campo" },
      { name: "delete_knowledge_file", args: {}, expectedError: "'fileId' ou 'fileIds'" },
      { name: "delete_meta_template", args: { templateName: "x" }, expectedError: "confirmDelete=true" },
      { name: "delete_meta_template", args: { confirmDelete: true }, expectedError: "'metaTemplateId'" },
      { name: "create_crm_custom_field", args: { name: "Máquina Black" }, expectedError: "'fieldType'" },
      { name: "create_crm_custom_field", args: { fieldType: "text" }, expectedError: "'name'" },
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

  it("classifica todas as 44 tools de escrita como 'action' na auditoria e gera resumos específicos", () => {
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
        updatedFields: ["value", "source"],
        mergedSourceContactId: "cont-dup",
        targetContactId: "cont-main",
        contact: { name: "Giuliano" },
        newContactId: "cont-ok",
        newContactName: "Giuliano",
        mode: "archive",
        reason: "Card duplicado",
        totalItems: 10,
        createdCount: 7,
        updatedCount: 2,
        replayedCount: 1,
        errorCount: 0,
        mediaType: "document",
        dealTotalValue: "15000.00",
        removedDealProductId: "dp-1",
        proposalNumber: "PROP-2026-0001",
        proposalId: "prop-1",
        action: "pause_ai",
        subscriptionId: "whsub-1",
        deliveryId: "whd-1",
        statusCode: 200,
        currentStep: "Resumo Registrado",
        folderId: "f-1",
        folder: { id: "f-1", name: "Manuais" },
        deletedFolderId: "f-1",
        deletedFolderName: "Manuais",
        deletedFilesCount: 2,
        fileId: "kf-1",
        file: { id: "kf-1", name: "Manual.md" },
        deletedCount: 1,
      });
      expect(summary).not.toBe("Dados retornados com sucesso");
      expect(summary.length).toBeGreaterThan(10);
    }
    expect(inferMcpAuditEventType("list_meta_templates")).toBe("query");
    expect(summarizeMcpToolResult("list_meta_templates", { total: 4 })).toContain("4 template(s)");
    expect(inferMcpAuditEventType("list_crm_pipelines")).toBe("query");
    expect(
      summarizeMcpToolResult("list_crm_pipelines", { totalPipelines: 3, totalStages: 15 }),
    ).toContain("3 funil(is)");
    expect(inferMcpAuditEventType("list_operators")).toBe("query");
    expect(
      summarizeMcpToolResult("list_operators", { totalOperators: 12, totalSectors: 4 }),
    ).toContain("12 operador(es)");
    expect(inferMcpAuditEventType("get_deal_conversations")).toBe("query");
    expect(inferMcpAuditEventType("list_crm_products")).toBe("query");
    expect(inferMcpAuditEventType("list_deal_proposals")).toBe("query");
    expect(inferMcpAuditEventType("list_webhook_subscriptions")).toBe("query");
    expect(inferMcpAuditEventType("list_webhook_deliveries")).toBe("query");
    expect(inferMcpAuditEventType("get_triage_summary")).toBe("query");
    expect(inferMcpAuditEventType("list_knowledge_folders")).toBe("query");
    expect(inferMcpAuditEventType("search_knowledge_files")).toBe("query");
    expect(inferMcpAuditEventType("get_knowledge_file_content")).toBe("query");
    expect(inferMcpAuditEventType("query_knowledge_rag")).toBe("query");
    expect(
      summarizeMcpToolResult("list_knowledge_folders", { totalFolders: 3, totalFilesInTenant: 12 }),
    ).toContain("3 pasta(s)");
    expect(
      summarizeMcpToolResult("search_knowledge_files", { returnedCount: 2, totalMatched: 5 }),
    ).toContain("2 de 5");
    expect(
      summarizeMcpToolResult("get_knowledge_file_content", {
        name: "Manual.md",
        returnedChars: 1200,
        totalChars: 1200,
      }),
    ).toContain("Manual.md");
    expect(
      summarizeMcpToolResult("query_knowledge_rag", { query: "FR-900", returnedChars: 900 }),
    ).toContain("FR-900");
    expect(inferMcpAuditEventType("get_stage_rules")).toBe("query");
    expect(inferMcpAuditEventType("validate_deal_stage_transition")).toBe("query");
    expect(inferMcpAuditEventType("check_operator_schedule_conflict")).toBe("query");
    expect(inferMcpAuditEventType("get_stage_queue")).toBe("query");
    expect(inferMcpAuditEventType("get_deal_audit_log")).toBe("query");
    expect(
      summarizeMcpToolResult("get_stage_rules", {
        stage: { name: "ATENDER" },
        requiredFields: { count: 2 },
        lossReasons: { count: 5 },
        metaTemplates: { count: 3 },
      }),
    ).toContain("ATENDER");
    expect(
      summarizeMcpToolResult("validate_deal_stage_transition", {
        dealId: "deal-1",
        targetStageName: "ATENDER",
        missingFieldsCount: 1,
        overdueActivitiesCount: 2,
      }),
    ).toContain("1 campo(s) faltando");
    expect(
      summarizeMcpToolResult("check_operator_schedule_conflict", {
        operatorName: "Diana",
        hasConflict: true,
        conflictCount: 1,
      }),
    ).toContain("Conflito detectado");
    expect(
      summarizeMcpToolResult("get_stage_queue", {
        stage: { name: "ATENDER" },
        totalOpenInStage: 4,
        breachedCount: 2,
        slaMinutes: 15,
      }),
    ).toContain("2 acima de 15 min");
    expect(
      summarizeMcpToolResult("get_deal_audit_log", {
        dealId: "deal-1",
        returnedEvents: 5,
        totalEvents: 5,
        adminActionsCount: 1,
      }),
    ).toContain("5/5 evento(s)");
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
