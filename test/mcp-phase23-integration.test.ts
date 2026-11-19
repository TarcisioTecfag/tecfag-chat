import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import {
  agentFlowStates,
  contacts,
  conversations,
  crmActionHistory,
  crmDeals,
  crmPipelines,
  crmProducts,
  crmStages,
  mcpIdempotencyRecords,
  messages,
  operators,
  tenants,
  webhookDeliveries,
  webhookSubscriptions,
} from "../src/db/schema";
import { processMcpJsonRpcPayload, type McpAccessContext } from "../src/lib/mcp/valem-tecfag-mcp-core";
import { dispatchWebhook } from "../src/lib/webhooks/dispatcher";
import { verifySignature } from "../src/lib/webhooks/crypto";
import { SdrDebouncer } from "../src/lib/valentina/sdr-debouncer";

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

function makeRwAccess(): McpAccessContext {
  return {
    authorized: true,
    lockedTenantId: "tecfag",
    defaultTenantId: "tecfag",
    authMode: "token_tecfag",
    accessLevel: "read_write",
    keyId: "test-p23-key",
    keyLabel: "Chave Fases 2 e 3",
    skipAuditLog: true,
  };
}

async function callTool(name: string, args: Record<string, unknown>) {
  const res = await processMcpJsonRpcPayload(
    {
      jsonrpc: "2.0",
      id: `p23-${name}-${crypto.randomUUID().slice(0, 6)}`,
      method: "tools/call",
      params: { name, arguments: args },
    },
    makeRwAccess(),
  );
  const isError = Boolean(res.body?.result?.isError);
  const text = String(res.body?.result?.content?.[0]?.text || "");
  if (isError) {
    return { isError: true as const, errorText: text, data: null as any };
  }
  return { isError: false as const, errorText: "", data: JSON.parse(text) };
}

describe.skipIf(!RUN_DB_TESTS)("Integração PostgreSQL — MCP Fases 2 e 3 (Itens 4, 8, 5, 6 e 7)", () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const tenantId = "tecfag";
  const pipeId = `pipe-p23-${suffix}`;
  const stageAId = `stg-p23-a-${suffix}`;
  const stageBId = `stg-p23-b-${suffix}`;
  const opId = `op-p23-${suffix}`;
  const prodId = `prod-p23-${suffix}`;
  const contact1Id = `cont-p23-1-${suffix}`;
  const contact2Id = `cont-p23-2-${suffix}`;
  const contact3Id = `cont-p23-3-${suffix}`;
  const conv1Id = `conv-p23-1-${suffix}`;
  const conv2Id = `conv-p23-2-${suffix}`;
  const createdDealIds: string[] = [];
  const createdSubIds: string[] = [];
  const idempPrefix = `batch-p23-${suffix}`;

  beforeAll(async () => {
    await db
      .insert(tenants)
      .values({ id: tenantId, name: "Tecfag", slug: "tecfag", connectionType: "meta" })
      .onConflictDoNothing();

    await db.insert(operators).values({
      id: opId,
      tenantId,
      name: `Operador P23 ${suffix}`,
      email: `p23-${suffix}@tecfag.test`,
      passwordHash: "hash-test",
      role: "agent",
      status: "disponivel",
      isOnline: true,
    });

    await db.insert(crmPipelines).values({
      id: pipeId,
      tenantId,
      name: `FUNIL P23 ${suffix}`,
      orderIndex: 98,
      isDefault: false,
    });

    await db.insert(crmStages).values([
      { id: stageAId, tenantId, pipelineId: pipeId, name: "ATENDER", orderIndex: 0 },
      { id: stageBId, tenantId, pipelineId: pipeId, name: "PROPOSTA", orderIndex: 1 },
    ]);

    await db.insert(crmProducts).values({
      id: prodId,
      tenantId,
      name: `Envasadora P23 ${suffix}`,
      sku: `SKU-${suffix}`,
      unitPrice: "12000.00",
      unit: "UN",
      isActive: true,
    });

    await db.insert(contacts).values([
      { id: contact1Id, tenantId, name: `Cliente P23 Um ${suffix}`, phone: `5511988${suffix.replace(/\D/g, "").padEnd(6, "1").slice(0, 6)}`, mainChannel: "whatsapp" },
      { id: contact2Id, tenantId, name: `Cliente P23 Dois ${suffix}`, phone: `5511977${suffix.replace(/\D/g, "").padEnd(6, "2").slice(0, 6)}`, mainChannel: "whatsapp" },
      { id: contact3Id, tenantId, name: `Cliente P23 Tres ${suffix}`, phone: `5511966${suffix.replace(/\D/g, "").padEnd(6, "3").slice(0, 6)}`, mainChannel: "whatsapp" },
    ]);

    await db.insert(conversations).values([
      { id: conv1Id, tenantId, contactId: contact1Id, queueState: "automacao", operatorId: null },
      { id: conv2Id, tenantId, contactId: contact2Id, queueState: "fila", operatorId: null },
    ]);
  });

  afterAll(async () => {
    SdrDebouncer.getInstance().clearSession(conv1Id);
    if (createdSubIds.length > 0) {
      await db
        .delete(webhookDeliveries)
        .where(and(eq(webhookDeliveries.tenantId, tenantId), inArray(webhookDeliveries.subscriptionId, createdSubIds)))
        .catch(() => {});
      await db
        .delete(webhookSubscriptions)
        .where(and(eq(webhookSubscriptions.tenantId, tenantId), inArray(webhookSubscriptions.id, createdSubIds)))
        .catch(() => {});
    }
    if (createdDealIds.length > 0) {
      await db
        .delete(crmDeals)
        .where(and(eq(crmDeals.tenantId, tenantId), inArray(crmDeals.id, createdDealIds)));
    }
    await db
      .delete(agentFlowStates)
      .where(and(eq(agentFlowStates.tenantId, tenantId), inArray(agentFlowStates.conversationId, [conv1Id, conv2Id])));
    await db
      .delete(conversations)
      .where(and(eq(conversations.tenantId, tenantId), inArray(conversations.id, [conv1Id, conv2Id])));
    await db
      .delete(contacts)
      .where(and(eq(contacts.tenantId, tenantId), inArray(contacts.id, [contact1Id, contact2Id, contact3Id])));
    await db
      .delete(crmProducts)
      .where(and(eq(crmProducts.tenantId, tenantId), eq(crmProducts.id, prodId)));
    await db
      .delete(crmPipelines)
      .where(and(eq(crmPipelines.tenantId, tenantId), eq(crmPipelines.id, pipeId)));
    await db
      .delete(operators)
      .where(and(eq(operators.tenantId, tenantId), eq(operators.id, opId)));
    await db
      .delete(mcpIdempotencyRecords)
      .where(
        and(
          eq(mcpIdempotencyRecords.tenantId, tenantId),
          inArray(mcpIdempotencyRecords.idempotencyKey, [
            `${idempPrefix}:item:0`,
            `${idempPrefix}:item:1`,
            `${idempPrefix}:upd-0`,
          ]),
        ),
      );
    await db
      .delete(crmActionHistory)
      .where(and(eq(crmActionHistory.tenantId, tenantId), eq(crmActionHistory.operatorName, `Teste P23 ${suffix}`)));
  });

  it("Fase 2 · Item 4: vincular/desvincular conversa↔card, consulta bidirecional e troca de contato com guarda de colisão", async () => {
    const dealRes = await callTool("create_crm_deal", {
      title: `Card Link P23 ${suffix}`,
      pipelineId: pipeId,
      stageId: stageAId,
      contactId: contact1Id,
      operatorId: opId,
    });
    expect(dealRes.isError).toBe(false);
    const dealId = dealRes.data.dealId as string;
    createdDealIds.push(dealId);

    // Link conversa ↔ card
    const linked = await callTool("link_conversation_deal", {
      conversationId: conv1Id,
      dealId,
      setAsActiveContext: true,
    });
    expect(linked.isError).toBe(false);
    expect(linked.data.setAsActiveContext).toBe(true);

    // Consulta bidirecional
    const lookup = await callTool("get_deal_conversations", { dealId, conversationId: conv1Id });
    expect(lookup.isError).toBe(false);
    expect(lookup.data.totalConversations).toBeGreaterThanOrEqual(1);
    expect(lookup.data.conversations.some((c: any) => c.id === conv1Id && c.linkType === "direct")).toBe(true);
    expect(lookup.data.activeContextDealId).toBe(dealId);

    // Desvincular com forceUnlinkLast
    const unlinked = await callTool("unlink_conversation_deal", {
      conversationId: conv1Id,
      dealId,
      forceUnlinkLast: true,
    });
    expect(unlinked.isError).toBe(false);
    expect(unlinked.data.unlinked).toBe(true);

    // Troca de contato da conversa: colisão com contact2Id (que já tem conv2Id) bloqueada com mensagem clara
    const collision = await callTool("reassign_conversation_contact", {
      conversationId: conv1Id,
      newContactId: contact2Id,
    });
    expect(collision.isError).toBe(true);
    expect(collision.errorText).toContain("merge_contacts");

    // Troca de contato da conversa para contact3Id (sem conversa na conexão) funciona
    const reassigned = await callTool("reassign_conversation_contact", {
      conversationId: conv1Id,
      newContactId: contact3Id,
      reason: "Cliente chamou de novo cadastro",
      actorName: `Teste P23 ${suffix}`,
    });
    expect(reassigned.isError).toBe(false);
    expect(reassigned.data.previousContactId).toBe(contact1Id);
    expect(reassigned.data.newContactId).toBe(contact3Id);
  });

  it("Fase 2 · Item 8: batch_upsert_crm_deals cria/atualiza com retorno item a item e idempotência real sem duplicar", async () => {
    const firstRun = await callTool("batch_upsert_crm_deals", {
      idempotencyKey: idempPrefix,
      items: [
        {
          title: `Lote Lead 1 ${suffix}`,
          pipelineId: pipeId,
          stageName: "ATENDER",
          contactId: contact1Id,
          operatorId: opId,
          value: 15000,
          source: "Planilha Comercial",
        },
        {
          title: `Lote Lead 2 ${suffix}`,
          pipelineId: pipeId,
          stageName: "PROPOSTA",
          contactId: contact2Id,
          operatorId: opId,
          value: 28000,
        },
        {
          // Item propositalmente inválido (sem title) — não deve derrubar os itens 0 e 1
          pipelineId: pipeId,
          contactId: contact3Id,
        },
      ],
    });
    expect(firstRun.isError).toBe(false);
    expect(firstRun.data.createdCount).toBe(2);
    expect(firstRun.data.errorCount).toBe(1);
    expect(firstRun.data.partialSuccess).toBe(true);
    const deal1Id = firstRun.data.results[0].dealId as string;
    const deal2Id = firstRun.data.results[1].dealId as string;
    createdDealIds.push(deal1Id, deal2Id);

    // Repete exatamente a mesma chamada (simulando retry após erro 502) -> replay idempotente sem duplicar!
    const replayRun = await callTool("batch_upsert_crm_deals", {
      idempotencyKey: idempPrefix,
      items: [
        {
          title: `Lote Lead 1 ${suffix}`,
          pipelineId: pipeId,
          stageName: "ATENDER",
          contactId: contact1Id,
          operatorId: opId,
          value: 15000,
        },
        {
          title: `Lote Lead 2 ${suffix}`,
          pipelineId: pipeId,
          stageName: "PROPOSTA",
          contactId: contact2Id,
          operatorId: opId,
          value: 28000,
        },
      ],
    });
    expect(replayRun.isError).toBe(false);
    expect(replayRun.data.createdCount).toBe(0);
    expect(replayRun.data.replayedCount).toBe(2);
    expect(replayRun.data.results[0].dealId).toBe(deal1Id);
    expect(replayRun.data.results[1].dealId).toBe(deal2Id);

    // Atualiza em lote com chave idempotente por item
    const updRun = await callTool("batch_upsert_crm_deals", {
      items: [
        {
          idempotencyKey: `${idempPrefix}:upd-0`,
          dealId: deal1Id,
          value: 19900,
          campaign: "Campanha Lote",
        },
      ],
    });
    expect(updRun.isError).toBe(false);
    expect(updRun.data.updatedCount).toBe(1);
    expect(Number(updRun.data.results[0].value)).toBe(19900);
  });

  it("Fase 3 · Item 5: produtos no catálogo/card, emissão e listagem de propostas comerciais", async () => {
    const dealRes = await callTool("create_crm_deal", {
      title: `Card Proposta P23 ${suffix}`,
      pipelineId: pipeId,
      stageId: stageAId,
      contactId: contact1Id,
      operatorId: opId,
    });
    expect(dealRes.isError).toBe(false);
    const dealId = dealRes.data.dealId as string;
    createdDealIds.push(dealId);

    // Listar catálogo
    const catalog = await callTool("list_crm_products", { search: `Envasadora P23 ${suffix}` });
    expect(catalog.isError).toBe(false);
    expect(catalog.data.totalProducts).toBe(1);
    expect(catalog.data.products[0].id).toBe(prodId);

    // Adicionar produto do catálogo ao card (preenche nome e preço 12000 automaticamente, qty 2 = 24000)
    const added = await callTool("add_deal_product", {
      dealId,
      productId: prodId,
      quantity: 2,
    });
    expect(added.isError).toBe(false);
    expect(Number(added.data.dealTotalValue)).toBe(24000);
    const dealProductId = added.data.dealProductId as string;

    // Emitir proposta formal
    const prop = await callTool("create_deal_proposal", {
      dealId,
      title: "Proposta Envasadora Automática",
      paymentTerms: "50% entrada + 50% na entrega",
      deliveryTerms: "15 dias úteis",
      validityDays: 10,
    });
    expect(prop.isError).toBe(false);
    expect(prop.data.proposalNumber).toMatch(/^PROP-\d{4}-\d{4}$/);

    // Listar propostas do card
    const listedProps = await callTool("list_deal_proposals", { dealId });
    expect(listedProps.isError).toBe(false);
    expect(listedProps.data.totalProposals).toBe(1);

    // Remover produto do card
    const removed = await callTool("remove_deal_product", { dealId, dealProductId });
    expect(removed.isError).toBe(false);
    expect(Number(removed.data.dealTotalValue)).toBe(0);
  });

  it("Fase 3 · Item 6: webhook durável com HMAC-SHA256, retry após HTTP 500 e reenvio manual via MCP", async () => {
    let failFirst = true;
    let receivedHeaderSig = "";
    let receivedEvent = "";
    let receivedBody: any = null;

    const server = http.createServer((req, res) => {
      receivedHeaderSig = String(req.headers["x-webhook-signature"] || "");
      receivedEvent = String(req.headers["x-webhook-event"] || "");
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        receivedBody = JSON.parse(raw || "{}");
        if (failFirst) {
          failFirst = false;
          res.writeHead(500, { "Content-Type": "text/plain" });
          res.end("Receiver temporarily unavailable");
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address() as { port: number };
    const localWebhookUrl = `http://127.0.0.1:${addr.port}/hook`;
    const subId = crypto.randomUUID();
    const secret = `whsec_test_${suffix}`;
    createdSubIds.push(subId);

    try {
      // Valida que upsert_webhook_subscription exige HTTPS em produção
      const httpRejected = await callTool("upsert_webhook_subscription", {
        action: "create",
        name: "Teste HTTP inseguro",
        url: localWebhookUrl,
        events: ["message.received"],
      });
      expect(httpRejected.isError).toBe(true);
      expect(httpRejected.errorText).toContain("HTTPS");

      // Insere subscrição local de teste direto para testar entrega HTTP real + HMAC + retry
      await db.insert(webhookSubscriptions).values({
        id: subId,
        tenantId,
        name: `Receptor Local P23 ${suffix}`,
        url: localWebhookUrl,
        secret,
        events: ["conversation.created", "message.received"],
        isActive: true,
      });

      const subsList = await callTool("list_webhook_subscriptions", {});
      expect(subsList.isError).toBe(false);
      expect(subsList.data.subscriptions.some((s: any) => s.id === subId)).toBe(true);

      // 1ª tentativa retorna HTTP 500 -> deve ficar em status 'retrying' com nextRetryAt preenchido
      const firstDispatch = await dispatchWebhook(
        tenantId,
        "message.received",
        { conversationId: conv1Id, content: "Olá Fagner!" },
        { eventId: `evt-p23-${suffix}`, awaitDelivery: true },
      );
      expect(firstDispatch.enqueued).toBe(1);
      expect(firstDispatch.results?.[0]?.status).toBe("retrying");
      expect(firstDispatch.results?.[0]?.statusCode).toBe(500);
      const deliveryId = firstDispatch.results![0].deliveryId;

      // Consulta fila via MCP
      const delList = await callTool("list_webhook_deliveries", {
        subscriptionId: subId,
        status: "retrying",
      });
      expect(delList.isError).toBe(false);
      expect(delList.data.totalDeliveries).toBe(1);

      // Reenvio manual via MCP agora recebe HTTP 200 e assinatura HMAC válida!
      const retried = await callTool("retry_webhook_delivery", { deliveryId });
      expect(retried.isError).toBe(false);
      expect(retried.data.status).toBe("delivered");
      expect(retried.data.statusCode).toBe(200);
      expect(receivedEvent).toBe("message.received");
      expect(verifySignature(receivedBody, receivedHeaderSig, secret)).toBe(true);
    } finally {
      server.close();
    }
  });

  it("Fase 3 · Item 7: controlar triagem do Fagner (pause_ai, set_manual, resume_ai) + ler/gravar resumo com nota interna", async () => {
    // Coloca um timer pendente no SdrDebouncer para confirmar limpeza imediata ao pausar
    SdrDebouncer.getInstance().pushIncomingMessage(tenantId, conv1Id, "5511999990000", {
      text: "Oi",
      receivedAt: new Date(),
    });
    expect(SdrDebouncer.getInstance().isBusy(conv1Id)).toBe(true);

    // 1. Pausar IA -> limpa debouncer + grava outcome='paused'
    const paused = await callTool("set_conversation_triage_mode", {
      conversationId: conv1Id,
      action: "pause_ai",
      reason: "Revisão comercial em andamento",
      actorName: `Teste P23 ${suffix}`,
    });
    expect(paused.isError).toBe(false);
    expect(paused.data.isPaused).toBe(true);
    expect(paused.data.isAiActive).toBe(false);
    expect(paused.data.debouncerCleared).toBe(true);
    expect(SdrDebouncer.getInstance().isBusy(conv1Id)).toBe(false);

    // 2. Marcar atendimento manual com operador responsável
    const manual = await callTool("set_conversation_triage_mode", {
      conversationId: conv1Id,
      action: "set_manual",
      operatorId: opId,
      reason: "Vendedor assumiu negociação",
      actorName: `Teste P23 ${suffix}`,
    });
    expect(manual.isError).toBe(false);
    expect(manual.data.queueState).toBe("meus");
    expect(manual.data.operatorId).toBe(opId);
    expect(manual.data.isManual).toBe(true);
    expect(manual.data.isAiActive).toBe(false);

    // 3. Gravar resumo da triagem + nota interna para o vendedor
    const sumSaved = await callTool("update_triage_summary", {
      conversationId: conv1Id,
      summary: "Cliente procura seladora contínua FR-900 para 500 un/hora.",
      collectedData: { produto: "FR-900", volume: "500 un/hora" },
      currentStep: "Passagem ao Consultor",
      postInternalNote: true,
      actorName: `Teste P23 ${suffix}`,
    });
    expect(sumSaved.isError).toBe(false);
    expect(sumSaved.data.internalNoteId).toBeTruthy();

    // Confirma nota interna no banco
    const [noteRow] = await db
      .select()
      .from(messages)
      .where(and(eq(messages.tenantId, tenantId), eq(messages.id, sumSaved.data.internalNoteId)));
    expect(noteRow?.isInternalNote).toBe(true);
    expect(noteRow?.content).toContain("FR-900");

    // 4. Ler estado e resumo da triagem
    const readSum = await callTool("get_triage_summary", { conversationId: conv1Id });
    expect(readSum.isError).toBe(false);
    expect(readSum.data.isManual).toBe(true);
    expect(readSum.data.summary).toContain("FR-900");
    expect(readSum.data.collectedData.produto).toBe("FR-900");

    // 5. Retomar atendimento automático
    const resumed = await callTool("set_conversation_triage_mode", {
      conversationId: conv1Id,
      action: "resume_ai",
      actorName: `Teste P23 ${suffix}`,
    });
    expect(resumed.isError).toBe(false);
    expect(resumed.data.queueState).toBe("automacao");
    expect(resumed.data.operatorId).toBeNull();
    expect(resumed.data.isAiActive).toBe(true);
  });
});
