import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import crypto from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import {
  contacts,
  conversations,
  crmConversationDeals,
  crmDeals,
  crmPipelines,
  crmStages,
  internalMessages,
  mcpIdempotencyRecords,
  messages,
  operators,
  sectors,
  tenants,
} from "../src/db/schema";
import {
  MCP_SERVER_INFO,
  formatMcpToolLabel,
  getVisibleMcpTools,
  isWriteMcpTool,
  processMcpJsonRpcPayload,
  summarizeMcpToolResult,
  type McpAccessContext,
} from "../src/lib/mcp/valem-tecfag-mcp-core";
import {
  acknowledgeOperatorWhisper,
  normalizeWhisperPriority,
  normalizeWhisperTone,
} from "../src/lib/valentina/operator-whisper-service";
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
    keyId: `test-whisper-${accessLevel}`,
    keyLabel: `Chave Teste Sussurro (${accessLevel})`,
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

describe("MCP v3.12.0 — Sussurros / Cobranças ao Operador (Fagner/Valentina)", () => {
  it("expõe send_operator_whisper apenas em read_write e list_operator_whispers em read e read_write, com labels, summaries e paridade na Biblioteca de API", () => {
    expect(MCP_SERVER_INFO.version).toBe("3.12.0");

    const readNames = new Set(getVisibleMcpTools(makeAccess("read")).map((t) => t.name));
    const rwNames = new Set(getVisibleMcpTools(makeAccess("read_write")).map((t) => t.name));

    expect(readNames.has("send_operator_whisper")).toBe(false);
    expect(rwNames.has("send_operator_whisper")).toBe(true);
    expect(isWriteMcpTool("send_operator_whisper")).toBe(true);

    expect(readNames.has("list_operator_whispers")).toBe(true);
    expect(rwNames.has("list_operator_whispers")).toBe(true);
    expect(isWriteMcpTool("list_operator_whispers")).toBe(false);

    expect(formatMcpToolLabel("send_operator_whisper")).toBe(
      "Enviar Sussurro / Cobrança ao Operador",
    );
    expect(formatMcpToolLabel("list_operator_whispers")).toBe(
      "Listar Histórico de Sussurros Enviados",
    );

    expect(
      summarizeMcpToolResult("send_operator_whisper", {
        priority: "urgente",
        deliveredCount: 1,
        context: { deal: { title: "Indústria Alfa" } },
      }),
    ).toContain("Indústria Alfa");

    expect(
      summarizeMcpToolResult("list_operator_whispers", {
        returnedCount: 3,
        summary: { pendingAckCount: 2, acknowledgedCount: 1 },
      }),
    ).toContain("2 pendente(s)");

    expect(normalizeWhisperPriority("URGENTE")).toBe("urgente");
    expect(normalizeWhisperPriority("high")).toBe("alta");
    expect(normalizeWhisperPriority("invalid")).toBe("normal");
    expect(normalizeWhisperTone("direto")).toBe("direto");
    expect(normalizeWhisperTone("urgente")).toBe("urgente");
    expect(normalizeWhisperTone("outro")).toBe("consultivo");

    const catalog = getApiLibraryCatalog("tecfag");
    const mcpNamesInCatalog = new Set(
      catalog
        .filter((item) => item.kind === "mcp")
        .map((item) => item.mcpToolName || item.pathOrTool),
    );
    expect(mcpNamesInCatalog.has("send_operator_whisper")).toBe(true);
    expect(mcpNamesInCatalog.has("list_operator_whispers")).toBe(true);
  });

  it("bloqueia send_operator_whisper quando chamado com chave read-only", async () => {
    const res = await callMcp(
      "send_operator_whisper",
      { operatorId: "op-qualquer", message: "Teste bloqueio read-only" },
      makeAccess("read", "tecfag"),
    );
    expect(res.isError).toBe(true);
    expect(res.errorText).toMatch(/somente leitura|read_write|permiss/i);
  });
});

describe.if(RUN_DB_TESTS)(
  "Integração PostgreSQL — Sussurro híbrido, broadcast, ciência e isolamento multi-tenant",
  () => {
    const suffix = crypto.randomBytes(4).toString("hex");
    const tecfagOp1 = `op-whisp-tf-1-${suffix}`;
    const tecfagOp2 = `op-whisp-tf-2-${suffix}`;
    const valemOp1 = `op-whisp-vl-1-${suffix}`;
    const tecfagSectorId = `sec-whisp-tf-${suffix}`;
    const tecfagContactId = `ct-whisp-tf-${suffix}`;
    const tecfagConvId = `conv-whisp-tf-${suffix}`;
    const tecfagPipelineId = `pipe-whisp-tf-${suffix}`;
    const tecfagStageId = `stage-whisp-tf-${suffix}`;
    const tecfagDealId = `deal-whisp-tf-${suffix}`;
    const linkId = `cdl-whisp-tf-${suffix}`;
    const idempKey = `whisp-idemp-${suffix}`;

    beforeAll(async () => {
      await db
        .insert(tenants)
        .values([
          { id: "tecfag", name: "Tecfag", slug: "tecfag", connectionType: "meta" },
          { id: "valem", name: "Valem", slug: "valem", connectionType: "baileys" },
        ])
        .onConflictDoNothing();

      await db.insert(operators).values([
        {
          id: tecfagOp1,
          tenantId: "tecfag",
          name: `Vendedor Alpha ${suffix}`,
          email: `alpha.${suffix}@tecfag.test`,
          passwordHash: "hash",
          role: "agent",
        },
        {
          id: tecfagOp2,
          tenantId: "tecfag",
          name: `Vendedor Beta ${suffix}`,
          email: `beta.${suffix}@tecfag.test`,
          passwordHash: "hash",
          role: "agent",
        },
        {
          id: valemOp1,
          tenantId: "valem",
          name: `Vendedora Valem ${suffix}`,
          email: `valem.${suffix}@valem.test`,
          passwordHash: "hash",
          role: "agent",
        },
      ]);

      await db.insert(sectors).values({
        id: tecfagSectorId,
        tenantId: "tecfag",
        name: `Setor Sussurro ${suffix}`,
        operatorIds: [tecfagOp1, tecfagOp2],
      });

      await db.insert(contacts).values({
        id: tecfagContactId,
        tenantId: "tecfag",
        name: `Cliente Teste ${suffix}`,
        phone: `5514999${suffix.slice(0, 6).replace(/[^0-9]/g, "1").padEnd(6, "2")}`,
        mainChannel: "whatsapp",
        walletOperatorId: tecfagOp1,
      });

      await db.insert(conversations).values({
        id: tecfagConvId,
        tenantId: "tecfag",
        contactId: tecfagContactId,
        operatorId: tecfagOp2, // conversa com Op2, deal com Op1 — para testar zero efeito colateral!
        queueState: "fila",
        unreadCount: 0,
      });

      await db.insert(crmPipelines).values({
        id: tecfagPipelineId,
        tenantId: "tecfag",
        name: `Funil Sussurro ${suffix}`,
      });

      await db.insert(crmStages).values({
        id: tecfagStageId,
        tenantId: "tecfag",
        pipelineId: tecfagPipelineId,
        name: "Proposta Enviada",
        orderIndex: 0,
      });

      await db.insert(crmDeals).values({
        id: tecfagDealId,
        tenantId: "tecfag",
        title: `Máquina Teste ${suffix}`,
        pipelineId: tecfagPipelineId,
        stageId: tecfagStageId,
        operatorId: tecfagOp1,
        status: "open",
      });

      await db.insert(crmConversationDeals).values({
        id: linkId,
        tenantId: "tecfag",
        conversationId: tecfagConvId,
        dealId: tecfagDealId,
        isActive: true,
      });
    });

    afterAll(async () => {
      await db
        .delete(mcpIdempotencyRecords)
        .where(
          and(
            eq(mcpIdempotencyRecords.tenantId, "tecfag"),
            eq(mcpIdempotencyRecords.idempotencyKey, idempKey),
          ),
        );
      await db
        .delete(internalMessages)
        .where(inArray(internalMessages.operatorId, [tecfagOp1, tecfagOp2, valemOp1]));
      await db.delete(messages).where(eq(messages.conversationId, tecfagConvId));
      await db.delete(crmConversationDeals).where(eq(crmConversationDeals.id, linkId));
      await db.delete(crmDeals).where(eq(crmDeals.id, tecfagDealId));
      await db.delete(crmStages).where(eq(crmStages.id, tecfagStageId));
      await db.delete(crmPipelines).where(eq(crmPipelines.id, tecfagPipelineId));
      await db.delete(conversations).where(eq(conversations.id, tecfagConvId));
      await db.delete(contacts).where(eq(contacts.id, tecfagContactId));
      await db.delete(sectors).where(eq(sectors.id, tecfagSectorId));
      await db
        .delete(operators)
        .where(inArray(operators.id, [tecfagOp1, tecfagOp2, valemOp1]));
    });

    it("envia sussurro híbrido por dealId (infere dono, descobre conversa, espelha invisível sem transferir fila) e suporta idempotencyKey", async () => {
      const access = makeAccess("read_write", "tecfag");
      const first = await callMcp(
        "send_operator_whisper",
        {
          dealId: tecfagDealId,
          message: "Por favor retorne a proposta hoje antes das 17h.",
          priority: "alta",
          idempotencyKey: idempKey,
        },
        access,
      );

      expect(first.isError).toBe(false);
      expect(first.data.success).toBe(true);
      expect(first.data.personaName).toBe("Fagner");
      expect(first.data.deliveredCount).toBe(1);
      expect(first.data.deliveries[0].operatorId).toBe(tecfagOp1);
      expect(first.data.deliveries[0].didAssignConversation).toBe(false);
      expect(first.data.deliveries[0].conversationMessageId).toBeTruthy();

      // Verifica que a conversa NÃO teve fila nem operador alterados (zero efeitos colaterais!)
      const [convAfter] = await db
        .select({ queueState: conversations.queueState, operatorId: conversations.operatorId })
        .from(conversations)
        .where(eq(conversations.id, tecfagConvId));
      expect(convAfter.queueState).toBe("fila");
      expect(convAfter.operatorId).toBe(tecfagOp2);

      // Verifica o espelho na tabela messages
      const [mirrored] = await db
        .select()
        .from(messages)
        .where(eq(messages.id, first.data.deliveries[0].conversationMessageId));
      expect(mirrored.isInternalNote).toBe(true);
      expect((mirrored.metaDetails as any)?.supervisorWhisper).toBe(true);
      expect((mirrored.metaDetails as any)?.pairedWithInternalWhisper).toBe(true);

      // Replay idempotente
      const replay = await callMcp(
        "send_operator_whisper",
        {
          dealId: tecfagDealId,
          message: "Por favor retorne a proposta hoje antes das 17h.",
          priority: "alta",
          idempotencyKey: idempKey,
        },
        access,
      );
      expect(replay.isError).toBe(false);
      expect(replay.data.idempotentReplay).toBe(true);
      expect(replay.data.deliveries[0].whisperId).toBe(first.data.deliveries[0].whisperId);
    });

    it("permite envio em modo discreto (asAiOnly) para Valem (Valentina) e mantém isolamento total entre tenants", async () => {
      const valemAccess = makeAccess("read_write", "valem");

      // Valem não pode cobrar operador da Tecfag
      const cross = await callMcp(
        "send_operator_whisper",
        { operatorId: tecfagOp1, message: "Tentativa cross-tenant" },
        valemAccess,
      );
      expect(cross.isError).toBe(true);

      // Valem envia em modo discreto para seu próprio operador
      const res = await callMcp(
        "send_operator_whisper",
        {
          operatorId: valemOp1,
          message: "Lembrete rápido sobre a meta de hoje.",
          asAiOnly: true,
          senderName: "Diretoria Valem",
        },
        valemAccess,
      );
      expect(res.isError).toBe(false);
      expect(res.data.personaName).toBe("Valentina");
      expect(res.data.asAiOnly).toBe(true);
      expect(res.data.displayedSender).toBe("Valentina");
      expect(res.data.auditSenderName).toBe("Diretoria Valem");

      // Tecfag não enxerga sussurros da Valem
      const tfList = await callMcp(
        "list_operator_whispers",
        { operatorId: valemOp1 },
        makeAccess("read", "tecfag"),
      );
      expect(tfList.isError).toBe(false);
      expect(tfList.data.returnedCount).toBe(0);
    });

    it("envia broadcast por setor, bloqueia assignConversation em broadcast, e rastreia confirmação de ciência (Ciente)", async () => {
      const access = makeAccess("read_write", "tecfag");

      // Bloqueio de assignConversation em broadcast
      const invalidBroadcast = await callMcp(
        "send_operator_whisper",
        {
          sectorId: tecfagSectorId,
          conversationId: tecfagConvId,
          assignConversation: true,
          message: "Teste inválido",
        },
        access,
      );
      expect(invalidBroadcast.isError).toBe(true);

      // Broadcast válido para setor inteiro
      const broadcast = await callMcp(
        "send_operator_whisper",
        {
          sectorId: tecfagSectorId,
          message: "Reunião relâmpago comercial às 16h30.",
          priority: "urgente",
        },
        access,
      );
      expect(broadcast.isError).toBe(false);
      expect(broadcast.data.mode).toBe("broadcast");
      expect(broadcast.data.deliveredCount).toBe(2);

      const whisperOp2 = broadcast.data.deliveries.find((d: any) => d.operatorId === tecfagOp2);
      expect(whisperOp2).toBeTruthy();

      // Outro operador NÃO pode confirmar ciência de sussurro alheio
      await expect(
        acknowledgeOperatorWhisper({
          tenantId: "tecfag",
          operatorId: tecfagOp1,
          whisperId: whisperOp2.whisperId,
        }),
      ).rejects.toThrow();

      // O próprio destinatário confirma ciência
      const ack = await acknowledgeOperatorWhisper({
        tenantId: "tecfag",
        operatorId: tecfagOp2,
        whisperId: whisperOp2.whisperId,
      });
      expect(ack.success).toBe(true);
      expect(ack.alreadyAcknowledged).toBe(false);

      // list_operator_whispers reflete o status acknowledged
      const ackList = await callMcp(
        "list_operator_whispers",
        { operatorId: tecfagOp2, status: "acknowledged" },
        makeAccess("read", "tecfag"),
      );
      expect(ackList.isError).toBe(false);
      expect(ackList.data.whispers.some((w: any) => w.id === whisperOp2.whisperId)).toBe(true);
    });
  },
);
