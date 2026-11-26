import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as ts from "typescript";

function extractPostHandler(filePath: string, bindings: Record<string, unknown>) {
  const source = readFileSync(filePath, "utf8");
  const tree = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
  let initializer: string | undefined;
  function walk(node: ts.Node) {
    if (
      ts.isPropertyAssignment(node) &&
      node.name.getText(tree) === "POST" &&
      ts.isArrowFunction(node.initializer)
    ) {
      initializer = node.initializer.getText(tree);
    }
    ts.forEachChild(node, walk);
  }
  walk(tree);
  if (!initializer) throw new Error(`Handler POST não encontrado em ${filePath}`);
  const compiled = ts.transpileModule(`const handler = ${initializer};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function(...Object.keys(bindings), `${compiled}; return handler;`)(
    ...Object.values(bindings),
  ) as (ctx: { request: Request }) => Promise<Response>;
}

describe("Transferência exige operador obrigatório (proibida transferência para fila sem operador)", () => {
  const updateQueuePath = join(process.cwd(), "src/routes/api/chats/update-queue.ts");

  function makeBindings(role: "agent" | "admin", canTransferChat = true) {
    const convRow = {
      id: "conv-1",
      tenantId: "tenant-x",
      contactId: "cont-1",
      operatorId: "op-1",
      sectorId: null,
      queueState: "meus",
      whatsappConnectionId: null,
      version: 1,
    };
    const dbChain = {
      select: () => dbChain,
      from: () => dbChain,
      where: () => Promise.resolve([convRow]),
    };
    return {
      requireSession: async () => ({
        session: {
          tenantId: "tenant-x",
          operator: { id: "op-1", name: "Evelyn", role },
          permissions: {
            chat: {
              canTransferChat,
              canOverrideChat: role === "admin",
              canCaptureChat: true,
              canFinishChat: true,
            },
          },
        },
      }),
      requireConversationAccess: async () => null,
      requireConversationSendAccess: async () => null,
      requireCrmDealAccess: async () => null,
      isDedicatedBaileysRoutingEnabled: async () => false,
      db: dbChain,
      conversations: { id: "id", tenantId: "tenantId" },
      operators: { id: "id", tenantId: "tenantId" },
      sectors: { id: "id", tenantId: "tenantId", name: "name" },
      and: (...args: unknown[]) => args,
      eq: (...args: unknown[]) => args,
    };
  }

  test("bloqueia transferência explícita (isTransfer: true) para queueState='fila' tanto para agent quanto para admin (HTTP 400 OPERATOR_REQUIRED_FOR_TRANSFER)", async () => {
    for (const role of ["agent", "admin"] as const) {
      const post = extractPostHandler(updateQueuePath, makeBindings(role));
      const res = await post({
        request: new Request("http://localhost/api/chats/update-queue", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversationId: "conv-1",
            queueState: "fila",
            operatorId: null,
            sectorId: "sec-pos-venda",
            isTransfer: true,
            expectedVersion: 1,
          }),
        }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.code).toBe("OPERATOR_REQUIRED_FOR_TRANSFER");
      expect(data.error).toContain("operador responsável");
    }
  });

  test("bloqueia operador não-admin tentando enviar conversa para queueState='fila' mesmo sem flag isTransfer", async () => {
    const post = extractPostHandler(updateQueuePath, makeBindings("agent"));
    const res = await post({
      request: new Request("http://localhost/api/chats/update-queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: "conv-1",
          queueState: "fila",
          operatorId: null,
          sectorId: "sec-pecas",
          expectedVersion: 1,
        }),
      }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.code).toBe("OPERATOR_REQUIRED_FOR_TRANSFER");
  });

  test("contratos de UI e Hook: remove completamente opções de 'Fila Geral do Setor' sem operador em ChatPanel, MobileActionsModal e useChatState", () => {
    const chatPanel = readFileSync(
      join(process.cwd(), "src/components/chat/ChatPanel.tsx"),
      "utf8",
    );
    const mobileModal = readFileSync(
      join(process.cwd(), "src/components/mobile/MobileActionsModal.tsx"),
      "utf8",
    );
    const chatState = readFileSync(
      join(process.cwd(), "src/hooks/useChatState.tsx"),
      "utf8",
    );
    const transferDealModal = readFileSync(
      join(process.cwd(), "src/components/chat/ChatTransferDealActionModal.tsx"),
      "utf8",
    );

    // ChatPanel não oferece mais botão de Fila Geral sem operador nem targetOperatorId: null
    expect(chatPanel).not.toContain("Fila Geral do Setor");
    expect(chatPanel).not.toContain("Setores (Fila Geral");
    expect(chatPanel).not.toContain("Fila do setor");
    expect(chatPanel).not.toMatch(/initiateChatTransfer\(\{[\s\S]{0,200}targetOperatorId:\s*null/);

    // MobileActionsModal não oferece mais transferência para setor sem operador
    expect(mobileModal).not.toContain("Setores (Fila Geral");
    expect(mobileModal).not.toContain("Fila do Setor");
    expect(mobileModal).not.toContain("handleTransfer(null");

    // useChatState exige targetOperatorId válido e sempre move transferências para "meus"
    expect(chatState).toContain(
      'toast.error("Selecione um operador responsável para transferir o atendimento.")',
    );
    expect(chatState).toContain('const targetQueueState = "meus" as const;');
    expect(chatState).not.toContain('const targetQueueState = targetOp ? "meus" : "fila"');

    // PendingChatTransferIntent exige targetOperatorId: string (não null)
    expect(transferDealModal).toContain("targetOperatorId: string;");
  });
});
