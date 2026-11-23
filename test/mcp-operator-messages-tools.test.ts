import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import crypto from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import {
  agentFlowStates,
  contacts,
  conversations,
  messages,
  operators,
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
  computeOperatorConversationStats,
  matchesOperatorConversationFilters,
  resolveProactiveHandoffPlan,
} from "../src/lib/mcp/valem-tecfag-mcp-operator-messages-tools";
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
    keyId: `test-op-msg-${accessLevel}`,
    keyLabel: `Chave Teste (${accessLevel})`,
    skipAuditLog: true,
  };
}

describe("MCP v3.5.0 — Conversas/Mensagens por Colaborador & Repasse Proativo para IA", () => {
  it("expõe get_operator_conversations_messages em leitura e handoff_conversation_to_ai_proactive apenas em read_write", async () => {
    expect(MCP_SERVER_INFO.version).toBe("3.7.0");

    const readTools = getVisibleMcpTools(makeAccess("read"));
    const rwTools = getVisibleMcpTools(makeAccess("read_write"));
    const readNames = new Set(readTools.map((t) => t.name));
    const rwNames = new Set(rwTools.map((t) => t.name));

    expect(readNames.has("get_operator_conversations_messages")).toBe(true);
    expect(readNames.has("handoff_conversation_to_ai_proactive")).toBe(false);
    expect(rwNames.has("get_operator_conversations_messages")).toBe(true);
    expect(rwNames.has("handoff_conversation_to_ai_proactive")).toBe(true);

    expect(isWriteMcpTool("get_operator_conversations_messages")).toBe(false);
    expect(isWriteMcpTool("handoff_conversation_to_ai_proactive")).toBe(true);

    expect(formatMcpToolLabel("get_operator_conversations_messages")).toBe(
      "Conversas & Mensagens por Colaborador",
    );
    expect(formatMcpToolLabel("handoff_conversation_to_ai_proactive")).toBe(
      "Repasse Proativo para Triagem IA (Lote/Template)",
    );

    expect(
      summarizeMcpToolResult("get_operator_conversations_messages", {
        operator: { name: "Isabella Inhesta" },
        summary: {
          returnedCount: 25,
          totalMatched: 140,
          neverRepliedByAgentCount: 95,
          insideMeta24hWindowCount: 12,
          outsideMeta24hWindowCount: 128,
        },
      }),
    ).toContain("95 sem resposta humana");

    expect(
      summarizeMcpToolResult("handoff_conversation_to_ai_proactive", {
        aiPersona: "Fagner",
        dryRun: true,
        handedOffCount: 10,
        totalRequested: 12,
        sentTemplateCount: 7,
        aiTriggeredCount: 3,
        skippedCount: 2,
        errorCount: 0,
      }),
    ).toContain("[DRY-RUN] Repasse proativo para Fagner: 10/12");

    // Chave read-only bloqueia handoff_conversation_to_ai_proactive
    const blocked = await processMcpJsonRpcPayload(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "handoff_conversation_to_ai_proactive",
          arguments: { conversationId: "conv-1" },
        },
      },
      makeAccess("read"),
    );
    expect(blocked.body?.result?.isError).toBe(true);
    expect(String(blocked.body?.result?.content?.[0]?.text || "")).toContain(
      "Permissão insuficiente (Somente Leitura)",
    );
  });

  it("valida argumentos obrigatórios e limite máximo de lote em ambas as tools", async () => {
    const missingOp = await processMcpJsonRpcPayload(
      {
        jsonrpc: "2.0",
        id: 10,
        method: "tools/call",
        params: { name: "get_operator_conversations_messages", arguments: {} },
      },
      makeAccess("read"),
    );
    expect(missingOp.body?.result?.isError).toBe(true);
    expect(String(missingOp.body?.result?.content?.[0]?.text || "")).toContain("operatorId");

    const missingConvs = await processMcpJsonRpcPayload(
      {
        jsonrpc: "2.0",
        id: 11,
        method: "tools/call",
        params: { name: "handoff_conversation_to_ai_proactive", arguments: {} },
      },
      makeAccess("read_write"),
    );
    expect(missingConvs.body?.result?.isError).toBe(true);
    expect(String(missingConvs.body?.result?.content?.[0]?.text || "")).toContain(
      "conversationId",
    );

    const tooMany = await processMcpJsonRpcPayload(
      {
        jsonrpc: "2.0",
        id: 12,
        method: "tools/call",
        params: {
          name: "handoff_conversation_to_ai_proactive",
          arguments: {
            conversationIds: Array.from({ length: 51 }, (_, idx) => `conv-${idx + 1}`),
          },
        },
      },
      makeAccess("read_write"),
    );
    expect(tooMany.body?.result?.isError).toBe(true);
    expect(String(tooMany.body?.result?.content?.[0]?.text || "")).toContain("50");
  });

  it("isola persona corretamente na Biblioteca de API (Tecfag = Fagner, Valem = Valentina)", () => {
    const tfCatalog = getApiLibraryCatalog("tecfag");
    const vlCatalog = getApiLibraryCatalog("valem");

    const tfRead = tfCatalog.find(
      (e) => e.mcpToolName === "get_operator_conversations_messages",
    )!;
    const vlRead = vlCatalog.find(
      (e) => e.mcpToolName === "get_operator_conversations_messages",
    )!;
    const tfWrite = tfCatalog.find(
      (e) => e.mcpToolName === "handoff_conversation_to_ai_proactive",
    )!;
    const vlWrite = vlCatalog.find(
      (e) => e.mcpToolName === "handoff_conversation_to_ai_proactive",
    )!;

    expect(tfRead.supportsLivePlayground).toBe(true);
    expect(tfRead.useCases.join(" ")).toContain("Fagner");
    expect(tfRead.useCases.join(" ")).not.toContain("Valentina");

    expect(vlRead.useCases.join(" ")).toContain("Valentina");
    expect(vlRead.useCases.join(" ")).not.toContain("Fagner");

    expect(tfWrite.supportsLivePlayground).toBe(false);
    expect(tfWrite.title).toContain("Fagner");
    expect(tfWrite.title).not.toContain("Valentina");

    expect(vlWrite.title).toContain("Valentina");
    expect(vlWrite.title).not.toContain("Fagner");

    // Garantia de que o schema real existe em MCP_TOOLS
    expect(MCP_TOOLS.some((t) => t.name === "get_operator_conversations_messages")).toBe(true);
    expect(MCP_TOOLS.some((t) => t.name === "handoff_conversation_to_ai_proactive")).toBe(true);
  });

  it("calcula estatísticas de interação e janela 24h Meta com precisão", () => {
    const now = new Date("2026-11-22T18:00:00.000Z");

    // Caso 1: Cliente mandou mensagem há 3h e nenhum humano respondeu (só nota interna)
    const insideNeverReplied = computeOperatorConversationStats({
      totalMessages: 2,
      clientMessagesCount: 1,
      agentMessagesCount: 0,
      thisOperatorMessagesCount: 0,
      botMessagesCount: 0,
      internalNotesCount: 1,
      lastClientMessageAt: new Date("2026-11-22T15:00:00.000Z"),
      lastAgentMessageAt: null,
      lastBotMessageAt: null,
      isOfficialChannel: true,
      now,
    });
    expect(insideNeverReplied.neverRepliedByAgent).toBe(true);
    expect(insideNeverReplied.neverRepliedByThisOperator).toBe(true);
    expect(insideNeverReplied.awaitingAgentReply).toBe(true);
    expect(insideNeverReplied.withinMeta24hWindow).toBe(true);
    expect(insideNeverReplied.hoursSinceLastClientMessage).toBe(3);
    expect(insideNeverReplied.recommendedProactiveMethod).toBe("free_text_or_ai");

    expect(
      matchesOperatorConversationFilters(insideNeverReplied, {
        interactionFilter: "never_replied_by_agent",
        metaWindowFilter: "inside_24h",
      }),
    ).toBe(true);
    expect(
      matchesOperatorConversationFilters(insideNeverReplied, {
        interactionFilter: "never_replied_by_agent",
        metaWindowFilter: "outside_24h",
      }),
    ).toBe(false);

    // Caso 2: Cliente falou há 30h e nenhum humano respondeu (fora da janela 24h -> precisa template)
    const outsideNeverReplied = computeOperatorConversationStats({
      totalMessages: 1,
      clientMessagesCount: 1,
      agentMessagesCount: 0,
      thisOperatorMessagesCount: 0,
      botMessagesCount: 0,
      internalNotesCount: 0,
      lastClientMessageAt: new Date("2026-11-21T12:00:00.000Z"),
      lastAgentMessageAt: null,
      lastBotMessageAt: null,
      isOfficialChannel: true,
      now,
    });
    expect(outsideNeverReplied.withinMeta24hWindow).toBe(false);
    expect(outsideNeverReplied.hoursSinceLastClientMessage).toBe(30);
    expect(outsideNeverReplied.recommendedProactiveMethod).toBe("meta_template_required");
    expect(
      matchesOperatorConversationFilters(outsideNeverReplied, {
        interactionFilter: "never_replied_by_agent",
        metaWindowFilter: "outside_24h",
      }),
    ).toBe(true);

    // Caso 3: Outro humano respondeu, mas não este operador, e o cliente ainda não retornou
    const repliedByOther = computeOperatorConversationStats({
      totalMessages: 2,
      clientMessagesCount: 1,
      agentMessagesCount: 1,
      thisOperatorMessagesCount: 0,
      botMessagesCount: 0,
      internalNotesCount: 0,
      lastClientMessageAt: new Date("2026-11-22T14:00:00.000Z"),
      lastAgentMessageAt: new Date("2026-11-22T15:00:00.000Z"),
      lastBotMessageAt: null,
      isOfficialChannel: true,
      now,
    });
    expect(repliedByOther.neverRepliedByAgent).toBe(false);
    expect(repliedByOther.neverRepliedByThisOperator).toBe(true);
    expect(repliedByOther.awaitingAgentReply).toBe(false);
    expect(
      matchesOperatorConversationFilters(repliedByOther, {
        interactionFilter: "replied_by_agent",
        metaWindowFilter: "all",
      }),
    ).toBe(true);

    // Caso 4: Canal Baileys pessoal
    const baileysChat = computeOperatorConversationStats({
      totalMessages: 1,
      clientMessagesCount: 1,
      agentMessagesCount: 0,
      thisOperatorMessagesCount: 0,
      botMessagesCount: 0,
      internalNotesCount: 0,
      lastClientMessageAt: new Date("2026-11-21T12:00:00.000Z"),
      lastAgentMessageAt: null,
      lastBotMessageAt: null,
      isOfficialChannel: false,
      now,
    });
    expect(baileysChat.recommendedProactiveMethod).toBe("baileys_channel");
  });

  it("decide corretamente o plano de repasse proativo e respeita todas as travas de segurança", () => {
    const base = {
      isOfficialChannel: true,
      queueState: "meus",
      reopenIfClosed: true,
      agentMessagesCount: 0,
      onlyIfNeverRepliedByAgent: true,
      expectedOperatorId: "op-sdr-1",
      currentOperatorId: "op-sdr-1",
      walletOperatorId: "op-sdr-1",
      withinMeta24hWindow: true,
      insideWindowAction: "trigger_ai" as const,
      outsideWindowAction: "send_template" as const,
      hasTemplateName: false,
      hasProactiveMessage: false,
    };

    // Dentro da janela 24h -> trigger_ai
    expect(resolveProactiveHandoffPlan(base).decision).toBe("trigger_ai");

    // Fora da janela 24h sem template -> needs_meta_template (não dispara texto ilegal)
    expect(
      resolveProactiveHandoffPlan({ ...base, withinMeta24hWindow: false }).decision,
    ).toBe("needs_meta_template");

    // Fora da janela 24h com template -> send_template
    expect(
      resolveProactiveHandoffPlan({
        ...base,
        withinMeta24hWindow: false,
        hasTemplateName: true,
      }).decision,
    ).toBe("send_template");

    // Trava onlyIfNeverRepliedByAgent protege chats onde humano já conversou
    expect(
      resolveProactiveHandoffPlan({ ...base, agentMessagesCount: 2 }).decision,
    ).toBe("skipped_already_replied");

    // Quando onlyIfNeverRepliedByAgent=false, permite prosseguir
    expect(
      resolveProactiveHandoffPlan({
        ...base,
        agentMessagesCount: 2,
        onlyIfNeverRepliedByAgent: false,
      }).decision,
    ).toBe("trigger_ai");

    // Trava expectedOperatorId impede mexer em conversa de outro vendedor
    expect(
      resolveProactiveHandoffPlan({
        ...base,
        currentOperatorId: "op-outro",
        walletOperatorId: "op-outro",
      }).decision,
    ).toBe("skipped_operator_mismatch");

    // Canal Baileys pessoal nunca dispara template Meta
    expect(
      resolveProactiveHandoffPlan({ ...base, isOfficialChannel: false }).decision,
    ).toBe("skipped_non_official_channel");

    // Conversa finalizada com reopenIfClosed=false -> skipped_closed
    expect(
      resolveProactiveHandoffPlan({
        ...base,
        queueState: "finalizados",
        reopenIfClosed: false,
      }).decision,
    ).toBe("skipped_closed");
  });
});

describe.skipIf(!RUN_DB_TESTS)(
  "MCP v3.5.0 — Integração PostgreSQL Real (Leitura por Colaborador & Repasse Proativo)",
  () => {
    const suffix = `opmsg-${crypto.randomBytes(4).toString("hex")}`;
    const tenantId = "tecfag" as const;

    const opId = `op-${suffix}`;
    const opName = `SDR Teste ${suffix}`;
    const cInsideId = `ct-in-${suffix}`;
    const cOutsideId = `ct-out-${suffix}`;
    const cRepliedId = `ct-rep-${suffix}`;
    const convInsideId = `conv-in-${suffix}`;
    const convOutsideId = `conv-out-${suffix}`;
    const convRepliedId = `conv-rep-${suffix}`;

    beforeAll(async () => {
      await db
        .insert(tenants)
        .values([{ id: "tecfag", name: "Tecfag", slug: "tecfag", connectionType: "meta" }])
        .onConflictDoNothing();

      await db.insert(operators).values({
        id: opId,
        tenantId,
        name: opName,
        email: `sdr.${suffix}@tecfag.test`,
        passwordHash: "test-hash-not-used",
        role: "agent",
        status: "disponivel",
      });

      const phoneBase = suffix.replace(/\D/g, "").padEnd(6, "7").slice(0, 6);
      await db.insert(contacts).values([
        {
          id: cInsideId,
          tenantId,
          name: `Lead Janela 24h ${suffix}`,
          phone: `5511981${phoneBase}1`,
          mainChannel: "whatsapp",
          walletOperatorId: opId,
          responsibleName: opName,
        },
        {
          id: cOutsideId,
          tenantId,
          name: `Lead Fora 24h ${suffix}`,
          phone: `5511981${phoneBase}2`,
          mainChannel: "whatsapp",
          walletOperatorId: opId,
          responsibleName: opName,
        },
        {
          id: cRepliedId,
          tenantId,
          name: `Lead Ja Respondido ${suffix}`,
          phone: `5511981${phoneBase}3`,
          mainChannel: "whatsapp",
          walletOperatorId: opId,
          responsibleName: opName,
        },
      ]);

      const now = new Date();
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
      const fortyHoursAgo = new Date(now.getTime() - 40 * 60 * 60 * 1000);
      const oneHourAgo = new Date(now.getTime() - 1 * 60 * 60 * 1000);

      await db.insert(conversations).values([
        {
          id: convInsideId,
          tenantId,
          contactId: cInsideId,
          contactPhone: `5511981${phoneBase}1`,
          whatsappConnectionId: null,
          operatorId: opId,
          queueState: "meus",
          lastMessageText: "Quero orçamento de seladora",
          lastMessageTime: twoHoursAgo,
        },
        {
          id: convOutsideId,
          tenantId,
          contactId: cOutsideId,
          contactPhone: `5511981${phoneBase}2`,
          whatsappConnectionId: null,
          operatorId: opId,
          queueState: "meus",
          lastMessageText: "Oi, vim pelo site",
          lastMessageTime: fortyHoursAgo,
        },
        {
          id: convRepliedId,
          tenantId,
          contactId: cRepliedId,
          contactPhone: `5511981${phoneBase}3`,
          whatsappConnectionId: null,
          operatorId: opId,
          queueState: "meus",
          lastMessageText: "Olá, já vou te ajudar!",
          lastMessageTime: oneHourAgo,
        },
      ]);

      await db.insert(messages).values([
        {
          id: `msg-in-1-${suffix}`,
          tenantId,
          conversationId: convInsideId,
          senderType: "client",
          senderName: `Lead Janela 24h ${suffix}`,
          content: "Quero orçamento de seladora",
          isInternalNote: false,
          direction: "inbound",
          provider: "meta",
          sentAt: twoHoursAgo,
        },
        {
          id: `msg-in-note-${suffix}`,
          tenantId,
          conversationId: convInsideId,
          senderType: "agent",
          senderName: opName,
          content: "Nota interna não conta como resposta ao cliente",
          isInternalNote: true,
          direction: "outbound",
          provider: "internal",
          sentAt: oneHourAgo,
        },
        {
          id: `msg-out-1-${suffix}`,
          tenantId,
          conversationId: convOutsideId,
          senderType: "client",
          senderName: `Lead Fora 24h ${suffix}`,
          content: "Oi, vim pelo site",
          isInternalNote: false,
          direction: "inbound",
          provider: "meta",
          sentAt: fortyHoursAgo,
        },
        {
          id: `msg-rep-1-${suffix}`,
          tenantId,
          conversationId: convRepliedId,
          senderType: "client",
          senderName: `Lead Ja Respondido ${suffix}`,
          content: "Boa tarde",
          isInternalNote: false,
          direction: "inbound",
          provider: "meta",
          sentAt: twoHoursAgo,
        },
        {
          id: `msg-rep-2-${suffix}`,
          tenantId,
          conversationId: convRepliedId,
          senderType: "agent",
          senderName: opName,
          content: "Olá, já vou te ajudar!",
          isInternalNote: false,
          direction: "outbound",
          provider: "meta",
          sentAt: oneHourAgo,
        },
      ]);
    });

    afterAll(async () => {
      await db
        .delete(agentFlowStates)
        .where(
          and(
            eq(agentFlowStates.tenantId, tenantId),
            inArray(agentFlowStates.conversationId, [convInsideId, convOutsideId, convRepliedId]),
          ),
        );
      await db
        .delete(messages)
        .where(
          and(
            eq(messages.tenantId, tenantId),
            inArray(messages.conversationId, [convInsideId, convOutsideId, convRepliedId]),
          ),
        );
      await db
        .delete(conversations)
        .where(
          and(
            eq(conversations.tenantId, tenantId),
            inArray(conversations.id, [convInsideId, convOutsideId, convRepliedId]),
          ),
        );
      await db
        .delete(contacts)
        .where(
          and(
            eq(contacts.tenantId, tenantId),
            inArray(contacts.id, [cInsideId, cOutsideId, cRepliedId]),
          ),
        );
      await db
        .delete(operators)
        .where(and(eq(operators.tenantId, tenantId), eq(operators.id, opId)));
    });

    it("filtra corretamente quem nunca recebeu resposta humana, separa janela 24h e pagina mensagens no PostgreSQL real", async () => {
      const rpcRes = await processMcpJsonRpcPayload(
        {
          jsonrpc: "2.0",
          id: 101,
          method: "tools/call",
          params: {
            name: "get_operator_conversations_messages",
            arguments: {
              operatorName: opName,
              scope: "assigned_or_wallet",
              interactionFilter: "never_replied_by_agent",
              messagesPerConversation: 10,
              limit: 1,
              offset: 0,
            },
          },
        },
        makeAccess("read"),
      );

      expect(rpcRes.body?.result?.isError).not.toBe(true);
      const data = JSON.parse(rpcRes.body.result.content[0].text);

      expect(data.operator.id).toBe(opId);
      expect(data.summary.totalMatched).toBe(2);
      expect(data.summary.returnedCount).toBe(1);
      expect(data.summary.hasMore).toBe(true);
      expect(data.summary.nextOffset).toBe(1);
      expect(data.summary.neverRepliedByAgentCount).toBe(2);
      expect(data.summary.insideMeta24hWindowCount).toBe(1);
      expect(data.summary.outsideMeta24hWindowCount).toBe(1);

      // Página 1 = mais recente (convInsideId)
      expect(data.conversations).toHaveLength(1);
      expect(data.conversations[0].conversationId).toBe(convInsideId);
      expect(data.conversations[0].stats.neverRepliedByAgent).toBe(true);
      expect(data.conversations[0].stats.internalNotesCount).toBe(1);
      expect(data.conversations[0].stats.withinMeta24hWindow).toBe(true);
      expect(data.conversations[0].stats.recommendedProactiveMethod).toBe("free_text_or_ai");
      expect(data.conversations[0].messages).toHaveLength(2);

      // Página 2 = convOutsideId
      const page2Res = await processMcpJsonRpcPayload(
        {
          jsonrpc: "2.0",
          id: 102,
          method: "tools/call",
          params: {
            name: "get_operator_conversations_messages",
            arguments: {
              operatorId: opId,
              interactionFilter: "never_replied_by_agent",
              metaWindowFilter: "outside_24h",
              messagesPerConversation: 5,
            },
          },
        },
        makeAccess("read"),
      );
      const page2 = JSON.parse(page2Res.body.result.content[0].text);
      expect(page2.summary.totalMatched).toBe(1);
      expect(page2.conversations[0].conversationId).toBe(convOutsideId);
      expect(page2.conversations[0].stats.withinMeta24hWindow).toBe(false);
      expect(page2.conversations[0].stats.recommendedProactiveMethod).toBe(
        "meta_template_required",
      );
    });

    it("executa dryRun e repasse real (queue_only) limpando operador e carteira enquanto protege chats já respondidos", async () => {
      // 1. Simulação dryRun=true
      const dryRes = await processMcpJsonRpcPayload(
        {
          jsonrpc: "2.0",
          id: 201,
          method: "tools/call",
          params: {
            name: "handoff_conversation_to_ai_proactive",
            arguments: {
              conversationIds: [convInsideId, convOutsideId, convRepliedId],
              dryRun: true,
              onlyIfNeverRepliedByAgent: true,
              expectedOperatorId: opId,
              insideWindowAction: "trigger_ai",
              outsideWindowAction: "send_template",
            },
          },
        },
        makeAccess("read_write"),
      );
      expect(dryRes.body?.result?.isError).not.toBe(true);
      const dryData = JSON.parse(dryRes.body.result.content[0].text);
      expect(dryData.dryRun).toBe(true);
      expect(dryData.handedOffCount).toBe(1); // convInsideId
      expect(dryData.skippedCount).toBe(2); // convOutsideId (needs_meta_template) + convRepliedId (skipped_already_replied)

      const byIdDry = new Map(dryData.results.map((r: any) => [r.conversationId, r]));
      expect((byIdDry.get(convInsideId) as any).status).toBe("dry_run_ready");
      expect((byIdDry.get(convInsideId) as any).plannedAction).toBe("trigger_ai");
      expect((byIdDry.get(convOutsideId) as any).status).toBe("needs_meta_template");
      expect((byIdDry.get(convRepliedId) as any).status).toBe("skipped_already_replied");

      // 2. Execução real com queue_only (sem disparar WhatsApp real no teste)
      const execRes = await processMcpJsonRpcPayload(
        {
          jsonrpc: "2.0",
          id: 202,
          method: "tools/call",
          params: {
            name: "handoff_conversation_to_ai_proactive",
            arguments: {
              conversationIds: [convInsideId, convRepliedId],
              dryRun: false,
              onlyIfNeverRepliedByAgent: true,
              expectedOperatorId: opId,
              clearWallet: true,
              insideWindowAction: "queue_only",
            },
          },
        },
        makeAccess("read_write"),
      );
      expect(execRes.body?.result?.isError).not.toBe(true);
      const execData = JSON.parse(execRes.body.result.content[0].text);
      expect(execData.handedOffCount).toBe(1);
      expect(execData.queuedOnlyCount).toBe(1);
      expect(execData.skippedCount).toBe(1);

      // Verifica estado real no Postgres: convInsideId sem operador, em automacao, carteira limpa e flow in_progress
      const [convAfter] = await db
        .select()
        .from(conversations)
        .where(and(eq(conversations.tenantId, tenantId), eq(conversations.id, convInsideId)));
      expect(convAfter.queueState).toBe("automacao");
      expect(convAfter.operatorId).toBeNull();

      const [contactAfter] = await db
        .select()
        .from(contacts)
        .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, cInsideId)));
      expect(contactAfter.walletOperatorId).toBeNull();
      expect(contactAfter.responsibleName).toBe("Na Fila");

      const [flowAfter] = await db
        .select()
        .from(agentFlowStates)
        .where(
          and(
            eq(agentFlowStates.tenantId, tenantId),
            eq(agentFlowStates.conversationId, convInsideId),
          ),
        );
      expect(flowAfter).toBeDefined();
      expect(flowAfter.outcome).toBe("in_progress");

      // Verifica que convRepliedId permaneceu intacta com o SDR
      const [repliedAfter] = await db
        .select()
        .from(conversations)
        .where(and(eq(conversations.tenantId, tenantId), eq(conversations.id, convRepliedId)));
      expect(repliedAfter.queueState).toBe("meus");
      expect(repliedAfter.operatorId).toBe(opId);
    });
  },
);
