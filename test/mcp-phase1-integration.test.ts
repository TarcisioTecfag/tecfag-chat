import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import crypto from "node:crypto";
import fs from "node:fs";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import {
  contactPhones,
  contacts,
  conversations,
  crmActionHistory,
  crmConversationDeals,
  crmDealContacts,
  crmDeals,
  crmPipelines,
  crmStages,
  messages,
  operators,
  tenants,
} from "../src/db/schema";
import { processMcpJsonRpcPayload, type McpAccessContext } from "../src/lib/mcp/valem-tecfag-mcp-core";

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
    keyId: "test-phase1-key",
    keyLabel: "Chave Fase 1",
    skipAuditLog: true,
  };
}

async function callTool(name: string, args: Record<string, unknown>) {
  const res = await processMcpJsonRpcPayload(
    {
      jsonrpc: "2.0",
      id: `p1-${name}-${crypto.randomUUID().slice(0, 6)}`,
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

describe.skipIf(!RUN_DB_TESTS)("Integração PostgreSQL — MCP Fase 1 (Itens 1, 2 e 3)", () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const tenantId = "tecfag";
  const pipeId = `pipe-mcp-p1-${suffix}`;
  const stageAId = `stg-mcp-p1-a-${suffix}`;
  const stageBId = `stg-mcp-p1-b-${suffix}`;
  const opId = `op-mcp-p1-${suffix}`;
  const contactMainId = `cont-mcp-p1-main-${suffix}`;
  const contactDupId = `cont-mcp-p1-dup-${suffix}`;
  const contactOtherId = `cont-mcp-p1-other-${suffix}`;
  const convMainId = `conv-mcp-p1-main-${suffix}`;
  const convDupId = `conv-mcp-p1-dup-${suffix}`;
  const msgDupId = `msg-mcp-p1-dup-${suffix}`;
  const createdDealIds: string[] = [];

  beforeAll(async () => {
    await db
      .insert(tenants)
      .values({ id: tenantId, name: "Tecfag", slug: "tecfag", connectionType: "meta" })
      .onConflictDoNothing();

    await db.insert(operators).values({
      id: opId,
      tenantId,
      name: `Consultor Fase1 ${suffix}`,
      email: `fase1-${suffix}@tecfag.test`,
      passwordHash: "hash-test-only",
      role: "agent",
      status: "disponivel",
      isOnline: true,
    });

    await db.insert(crmPipelines).values({
      id: pipeId,
      tenantId,
      name: `FUNIL FASE1 ${suffix}`,
      orderIndex: 99,
      isDefault: false,
    });

    await db.insert(crmStages).values([
      { id: stageAId, tenantId, pipelineId: pipeId, name: "ATENDER", orderIndex: 0 },
      { id: stageBId, tenantId, pipelineId: pipeId, name: "PROPOSTA", orderIndex: 1 },
    ]);

    await db.insert(contacts).values([
      {
        id: contactMainId,
        tenantId,
        name: `Giuliano Principal ${suffix}`,
        phone: "5511999990001",
        email: null,
        mainChannel: "whatsapp",
        tags: ["lead"],
      },
      {
        id: contactDupId,
        tenantId,
        name: `NUF Duplicado ${suffix}`,
        phone: "5511999990002",
        email: `giuliano-${suffix}@empresa.com`,
        mainChannel: "whatsapp",
        tags: ["duplicado"],
      },
      {
        id: contactOtherId,
        tenantId,
        name: `Richard Troca ${suffix}`,
        phone: "5511999990003",
        mainChannel: "whatsapp",
      },
    ]);

    await db
      .insert(contactPhones)
      .values([
        {
          id: `cp-main-${suffix}`,
          tenantId,
          contactId: contactMainId,
          phone: "5511999990001",
          phoneIdentity: "5511999990001",
          isPrimary: true,
          position: 0,
        },
        {
          id: `cp-dup-${suffix}`,
          tenantId,
          contactId: contactDupId,
          phone: "5511999990002",
          phoneIdentity: "5511999990002",
          isPrimary: true,
          position: 0,
        },
      ])
      .onConflictDoNothing();

    // Cria 2 conversas na mesma conexão padrão (NULL) para testar colisão real no merge_contacts
    await db.insert(conversations).values([
      {
        id: convMainId,
        tenantId,
        contactId: contactMainId,
        queueState: "meus",
        operatorId: opId,
        lastMessageText: "Msg antiga",
        lastMessageTime: new Date(Date.now() - 60_000),
      },
      {
        id: convDupId,
        tenantId,
        contactId: contactDupId,
        queueState: "fila",
        lastMessageText: "Msg mais recente do duplicado",
        lastMessageTime: new Date(),
      },
    ]);

    await db.insert(messages).values({
      id: msgDupId,
      tenantId,
      conversationId: convDupId,
      senderType: "client",
      senderName: "Giuliano",
      content: "Quero orçamento da seladora",
    });
  });

  afterAll(async () => {
    if (createdDealIds.length > 0) {
      await db
        .delete(crmDeals)
        .where(and(eq(crmDeals.tenantId, tenantId), inArray(crmDeals.id, createdDealIds)));
    }
    await db
      .delete(conversations)
      .where(and(eq(conversations.tenantId, tenantId), inArray(conversations.id, [convMainId, convDupId])));
    await db
      .delete(contacts)
      .where(
        and(
          eq(contacts.tenantId, tenantId),
          inArray(contacts.id, [contactMainId, contactDupId, contactOtherId]),
        ),
      );
    await db
      .delete(crmPipelines)
      .where(and(eq(crmPipelines.tenantId, tenantId), eq(crmPipelines.id, pipeId)));
    await db
      .delete(operators)
      .where(and(eq(operators.tenantId, tenantId), eq(operators.id, opId)));
    await db
      .delete(crmActionHistory)
      .where(and(eq(crmActionHistory.tenantId, tenantId), eq(crmActionHistory.operatorName, `Teste Fase1 ${suffix}`)));
  });

  it("Item 2: list_crm_pipelines e list_operators retornam IDs oficiais isolados por tenant", async () => {
    const pipesRes = await callTool("list_crm_pipelines", {
      search: `FUNIL FASE1 ${suffix}`,
      includeDealCounts: true,
    });
    expect(pipesRes.isError).toBe(false);
    expect(pipesRes.data.totalPipelines).toBe(1);
    expect(pipesRes.data.pipelines[0].id).toBe(pipeId);
    expect(pipesRes.data.pipelines[0].stages.map((s: any) => s.name)).toEqual(["ATENDER", "PROPOSTA"]);

    const opsRes = await callTool("list_operators", { search: `Consultor Fase1 ${suffix}` });
    expect(opsRes.isError).toBe(false);
    expect(opsRes.data.totalOperators).toBe(1);
    expect(opsRes.data.operators[0].id).toBe(opId);
    expect(opsRes.data.operators[0].passwordHash).toBeUndefined();
  });

  it("Item 1: update_crm_deal edita parcialmente valor, fonte, campanha e produto retornando card atualizado", async () => {
    const created = await callTool("create_crm_deal", {
      title: `Card Fase1 ${suffix}`,
      pipelineId: pipeId,
      stageId: stageAId,
      contactId: contactOtherId,
      operatorId: opId,
      value: 0,
    });
    expect(created.isError).toBe(false);
    const dealId = created.data.dealId as string;
    createdDealIds.push(dealId);

    const updated = await callTool("update_crm_deal", {
      dealId,
      title: `Card Fase1 Editado ${suffix}`,
      value: 24500.5,
      source: "Busca Paga | Google",
      campaign: "Campanha Seladoras Nov",
      stageName: "PROPOSTA",
      product: {
        name: "Seladora Contínua FR-900",
        quantity: 1,
        unitPrice: 24500.5,
      },
    });
    expect(updated.isError).toBe(false);
    expect(updated.data.deal.title).toBe(`Card Fase1 Editado ${suffix}`);
    expect(Number(updated.data.deal.value)).toBe(24500.5);
    expect(updated.data.deal.source).toBe("Busca Paga | Google");
    expect(updated.data.deal.campaign).toBe("Campanha Seladoras Nov");
    expect(updated.data.deal.stageId).toBe(stageBId);
  });

  it("Item 3: replace_crm_deal_contact, merge_contacts (com colisão de conversa) e archive_crm_deal auditado", async () => {
    const created = await callTool("create_crm_deal", {
      title: `Card Contato Errado ${suffix}`,
      pipelineId: pipeId,
      stageId: stageAId,
      contactId: contactOtherId,
      operatorId: opId,
    });
    expect(created.isError).toBe(false);
    const dealId = created.data.dealId as string;
    createdDealIds.push(dealId);

    // 3A. Trocar contato errado do card para contactDupId
    const replaced = await callTool("replace_crm_deal_contact", {
      dealId,
      newContactId: contactDupId,
      reason: "Telefone compartilhado com Richard",
      actorName: `Teste Fase1 ${suffix}`,
    });
    expect(replaced.isError).toBe(false);
    expect(replaced.data.removedContactIds).toEqual([contactOtherId]);
    expect(replaced.data.contacts.map((c: any) => c.contactId)).toEqual([contactDupId]);

    // 3B. merge_contacts com strategy='block' detecta colisão de conversa
    const blocked = await callTool("merge_contacts", {
      sourceContactId: contactDupId,
      targetContactId: contactMainId,
      conversationConflictStrategy: "block",
    });
    expect(blocked.isError).toBe(true);
    expect(blocked.errorText).toContain("Conflito de conversa");

    // 3C. merge_contacts com strategy='merge_messages' consolida tudo atomicamente
    const merged = await callTool("merge_contacts", {
      sourceContactId: contactDupId,
      targetContactId: contactMainId,
      reason: "Unificar cadastro NUF duplicado em Giuliano",
      actorName: `Teste Fase1 ${suffix}`,
    });
    expect(merged.isError).toBe(false);
    expect(merged.data.contact.email).toBe(`giuliano-${suffix}@empresa.com`);
    expect(merged.data.contact.tags).toContain("lead");
    expect(merged.data.contact.tags).toContain("duplicado");
    expect(merged.data.summary.movedPhonesCount).toBe(1);
    expect(merged.data.summary.movedDealsCount).toBe(1);
    expect(merged.data.summary.mergedConversationsCount).toBe(1);
    expect(merged.data.summary.movedMessagesCount).toBe(1);

    // Confirma que a mensagem foi preservada na conversa principal e o card agora aponta para contactMainId
    const [migratedMsg] = await db
      .select()
      .from(messages)
      .where(and(eq(messages.tenantId, tenantId), eq(messages.id, msgDupId)));
    expect(migratedMsg?.conversationId).toBe(convMainId);

    const dealLinks = await db
      .select()
      .from(crmDealContacts)
      .where(and(eq(crmDealContacts.tenantId, tenantId), eq(crmDealContacts.dealId, dealId)));
    expect(dealLinks.map((l) => l.contactId)).toEqual([contactMainId]);

    // 3D. archive_crm_deal envia para Lixeira com motivo e autor auditados
    const archived = await callTool("archive_crm_deal", {
      dealId,
      reason: "Card criado em duplicidade na distribuição",
      actorName: `Teste Fase1 ${suffix}`,
    });
    expect(archived.isError).toBe(false);
    expect(archived.data.mode).toBe("archive");
    expect(archived.data.status).toBe("paused");
    expect(archived.data.pausedReason).toBe("Lixeira — Card criado em duplicidade na distribuição");

    // 3E. Bloqueia exclusão definitiva se houver conversa ativa vinculada ao card
    await db
      .insert(crmConversationDeals)
      .values({
        id: `ccd-p1-${suffix}`,
        tenantId,
        conversationId: convMainId,
        dealId,
        isActive: true,
      })
      .onConflictDoNothing();
    const blockedDelete = await callTool("archive_crm_deal", {
      dealId,
      reason: "Teste trava conversa vinculada",
      mode: "delete_permanent",
      confirmPermanentDelete: true,
      actorName: `Teste Fase1 ${suffix}`,
    });
    expect(blockedDelete.isError).toBe(true);
    expect(blockedDelete.errorText).toContain("possui conversa vinculada");
  });
});
