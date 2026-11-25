import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { and, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, client } from "../src/db";
import {
  contacts,
  conversations,
  crmConversationDeals,
  crmDeals,
  crmPipelines,
  crmStages,
  messages,
  metaMessageTemplates,
  rdMarketingFlows,
  rdMarketingLogs,
  rdMarketingScheduledTemplates,
  tenants,
} from "../src/db/schema";
import {
  DEFAULT_RD_TEMPLATE_DELAY_MINUTES,
  defaultMappings,
  flowSettingsSchema,
  resolveFlowTemplateDelay,
  type FlowSettings,
} from "../src/lib/rd-marketing/mapping";
import {
  cancelPendingRdScheduledTemplatesOnClientMessage,
  cancelScheduledRdTemplateByOperator,
  describeScheduledTemplateCancelReason,
  dispatchScheduledRdTemplateNow,
  evaluateWhatsappActivityBlock,
  listScheduledRdTemplateDispatches,
  processDueRdScheduledTemplatesForTenant,
  scheduleRdSdrTemplatePostCommit,
  type RdTemplateDispatcherFn,
} from "../src/lib/rd-marketing/scheduled-template-dispatch";
import { receiveLeads } from "../src/lib/rd-marketing/service";
import { executeRdMarketingMcpTool } from "../src/lib/mcp/valem-tecfag-mcp-rd-marketing-tools";

describe("RD Marketing: disparo atrasado condicional de template (regras puras)", () => {
  const baseSettings: FlowSettings = {
    name: "Botão Whatsapp | Site Tecfag",
    enabled: true,
    pipelineId: "pipe-1",
    stageId: "stage-1",
    operatorId: null,
    deduplication: "event",
    eventIdPath: "rd_conversion.id",
    whatsappTemplateId: "tpl-123",
    mappings: defaultMappings,
  };

  test("preserva retrocompatibilidade de fluxos sem campos de atraso e valida limites de minutos", () => {
    const legacy = flowSettingsSchema.parse(baseSettings);
    expect(resolveFlowTemplateDelay(legacy)).toEqual({
      enabled: false,
      minutes: DEFAULT_RD_TEMPLATE_DELAY_MINUTES,
    });

    const enabledDefault = flowSettingsSchema.parse({
      ...baseSettings,
      whatsappTemplateDelayEnabled: true,
    });
    expect(resolveFlowTemplateDelay(enabledDefault)).toEqual({
      enabled: true,
      minutes: 5,
    });

    const custom = flowSettingsSchema.parse({
      ...baseSettings,
      whatsappTemplateDelayEnabled: true,
      whatsappTemplateDelayMinutes: 12,
    });
    expect(resolveFlowTemplateDelay(custom)).toEqual({
      enabled: true,
      minutes: 12,
    });

    expect(
      flowSettingsSchema.safeParse({
        ...baseSettings,
        whatsappTemplateDelayEnabled: true,
        whatsappTemplateDelayMinutes: 0,
      }).success,
    ).toBe(false);
    expect(
      flowSettingsSchema.safeParse({
        ...baseSettings,
        whatsappTemplateDelayEnabled: true,
        whatsappTemplateDelayMinutes: 1441,
      }).success,
    ).toBe(false);
    expect(
      flowSettingsSchema.safeParse({
        ...baseSettings,
        whatsappTemplateDelayEnabled: true,
        whatsappTemplateDelayMinutes: 2.5,
      }).success,
    ).toBe(false);
  });

  test("evaluateWhatsappActivityBlock cobre mensagens durante atraso, pré-webhook 15 min, chats vazios e conversas ativas", () => {
    const triggeredAt = new Date("2026-11-25T14:00:00Z");
    const now = new Date("2026-11-25T14:05:00Z");

    // 1. Sem conversas -> livre para disparar
    expect(
      evaluateWhatsappActivityBlock({
        triggeredAt,
        now,
        conversations: [],
      }),
    ).toEqual({ blocked: false });

    // 2. Cliente mandou msg durante a janela de 5 min -> cancela
    expect(
      evaluateWhatsappActivityBlock({
        triggeredAt,
        now,
        latestClientMessage: {
          conversationId: "conv-1",
          sentAt: new Date("2026-11-25T14:02:00Z"),
        },
        conversations: [],
      }),
    ).toEqual({
      blocked: true,
      reason: "client_messaged_during_delay",
      conversationId: "conv-1",
    });

    // 3. Cliente mandou msg 8 min ANTES do webhook chegar (dentro da janela de 15 min) -> cancela
    expect(
      evaluateWhatsappActivityBlock({
        triggeredAt,
        now,
        latestClientMessage: {
          conversationId: "conv-1",
          sentAt: new Date("2026-11-25T13:52:00Z"),
        },
        conversations: [],
      }),
    ).toEqual({
      blocked: true,
      reason: "client_messaged_before_webhook",
      conversationId: "conv-1",
    });

    // 4. Mensagem antiga (20 min antes) em conversa finalizada -> NÃO bloqueia
    expect(
      evaluateWhatsappActivityBlock({
        triggeredAt,
        now,
        latestClientMessage: {
          conversationId: "conv-old",
          sentAt: new Date("2026-11-25T13:40:00Z"),
        },
        conversations: [
          {
            id: "conv-old",
            queueState: "finalizados",
            operatorId: null,
            whatsappConnectionId: null,
            latestRealMessageAt: new Date("2026-11-25T13:40:00Z"),
            activeSdrFlowLastInteractionAt: null,
          },
        ],
      }),
    ).toEqual({ blocked: false });

    // 5. Chat aberto vazio em 'fila' (0 mensagens reais, ex.: aberto via CRM) -> NÃO bloqueia
    expect(
      evaluateWhatsappActivityBlock({
        triggeredAt,
        now,
        conversations: [
          {
            id: "conv-empty",
            queueState: "fila",
            operatorId: null,
            whatsappConnectionId: null,
            latestRealMessageAt: null,
            activeSdrFlowLastInteractionAt: null,
          },
        ],
      }),
    ).toEqual({ blocked: false });

    // 6. Conversa humana ativa em 'meus' há 2 dias com carteira -> bloqueia
    expect(
      evaluateWhatsappActivityBlock({
        triggeredAt,
        now,
        walletOperatorId: "op-melissa",
        operatorNamesById: { "op-melissa": "Melissa Gomes" },
        conversations: [
          {
            id: "conv-meus",
            queueState: "meus",
            operatorId: "op-melissa",
            whatsappConnectionId: null,
            latestRealMessageAt: new Date("2026-11-23T14:00:00Z"),
            activeSdrFlowLastInteractionAt: null,
          },
        ],
      }),
    ).toEqual({
      blocked: true,
      reason: "wallet_protected",
      conversationId: "conv-meus",
      operatorName: "Melissa Gomes",
    });

    // 7. Conversa humana parada em 'meus' há 10 dias -> NÃO bloqueia
    expect(
      evaluateWhatsappActivityBlock({
        triggeredAt,
        now,
        walletOperatorId: "op-melissa",
        conversations: [
          {
            id: "conv-meus-old",
            queueState: "meus",
            operatorId: "op-melissa",
            whatsappConnectionId: null,
            latestRealMessageAt: new Date("2026-11-15T14:00:00Z"),
            activeSdrFlowLastInteractionAt: null,
          },
        ],
      }),
    ).toEqual({ blocked: false });

    // 8. Conversa ativa em 'automacao' com msg real há 2h -> bloqueia
    expect(
      evaluateWhatsappActivityBlock({
        triggeredAt,
        now,
        conversations: [
          {
            id: "conv-auto",
            queueState: "automacao",
            operatorId: null,
            whatsappConnectionId: null,
            latestRealMessageAt: new Date("2026-11-25T12:00:00Z"),
            activeSdrFlowLastInteractionAt: new Date("2026-11-25T12:00:00Z"),
          },
        ],
      }),
    ).toEqual({
      blocked: true,
      reason: "active_automacao_conversation",
      conversationId: "conv-auto",
    });

    // 9. Mensagens descritivas de cancelamento
    expect(
      describeScheduledTemplateCancelReason("client_messaged_during_delay", {
        templateLabel: "apresentacao7",
        delayMinutes: 5,
      }),
    ).toContain("apresentacao7");
  });
});

describe("RD Marketing: fila durável PostgreSQL de templates atrasados e isolamento multi-tenant", () => {
  const runId = randomUUID().slice(0, 8);
  const tenantA = `rd-delay-a-${runId}`;
  const tenantB = `rd-delay-b-${runId}`;
  const pipeA = `pipe-a-${runId}`;
  const stageContatarA = `stg-contatar-a-${runId}`;
  const pipeB = `pipe-b-${runId}`;
  const stageContatarB = `stg-contatar-b-${runId}`;
  const flowA1 = `flow-a1-${runId}`;
  const flowA2 = `flow-a2-${runId}`;
  const flowB1 = `flow-b1-${runId}`;
  const tplA1 = `111111${runId}`;
  const tplA2 = `222222${runId}`;
  const tplB1 = `333333${runId}`;

  const makeFlowSettings = (
    name: string,
    pipelineId: string,
    stageId: string,
    whatsappTemplateId: string,
    delayMinutes = 5,
  ): FlowSettings => ({
    name,
    enabled: true,
    pipelineId,
    stageId,
    operatorId: null,
    deduplication: "event",
    eventIdPath: "rd_conversion.id",
    whatsappTemplateId,
    whatsappTemplateDelayEnabled: true,
    whatsappTemplateDelayMinutes: delayMinutes,
    mappings: defaultMappings,
  });

  beforeAll(async () => {
    // Garante existência da tabela 0071 mesmo se o banco de teste ainda não aplicou o script de deploy
    await client.unsafe(`
      CREATE TABLE IF NOT EXISTS rd_marketing_scheduled_templates (
        id text PRIMARY KEY,
        tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        flow_id text NOT NULL REFERENCES rd_marketing_flows(id) ON DELETE CASCADE,
        deal_id text NOT NULL,
        contact_id text NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
        whatsapp_template_id text NOT NULL,
        client_name text,
        company_name text,
        document text,
        delay_minutes integer NOT NULL DEFAULT 5,
        status text NOT NULL DEFAULT 'pending',
        scheduled_for timestamp NOT NULL,
        triggered_at timestamp NOT NULL DEFAULT now(),
        processed_at timestamp,
        cancel_reason text,
        lease_token text,
        lease_until timestamp,
        attempts integer NOT NULL DEFAULT 0,
        last_error text,
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_rd_sched_tpl_due
        ON rd_marketing_scheduled_templates (tenant_id, status, scheduled_for);
      CREATE INDEX IF NOT EXISTS idx_rd_sched_tpl_contact_status
        ON rd_marketing_scheduled_templates (tenant_id, contact_id, status);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_rd_sched_tpl_one_pending_per_contact
        ON rd_marketing_scheduled_templates (tenant_id, contact_id)
        WHERE status = 'pending';
    `);

    await db.insert(tenants).values([
      { id: tenantA, name: "Tenant Delay A", slug: tenantA, connectionType: "meta" },
      { id: tenantB, name: "Tenant Delay B", slug: tenantB, connectionType: "meta" },
    ]);

    await db.insert(crmPipelines).values([
      { id: pipeA, tenantId: tenantA, name: "FUNIL CWR" },
      { id: pipeB, tenantId: tenantB, name: "FUNIL CWR" },
    ]);

    await db.insert(crmStages).values([
      { id: stageContatarA, tenantId: tenantA, pipelineId: pipeA, name: "CONTATAR", orderIndex: 0 },
      { id: stageContatarB, tenantId: tenantB, pipelineId: pipeB, name: "CONTATAR", orderIndex: 0 },
    ]);

    await db.insert(metaMessageTemplates).values([
      {
        id: `${tenantA}:${tplA1}`,
        tenantId: tenantA,
        metaTemplateId: tplA1,
        name: "botao_site_ativo",
        language: "pt_BR",
        category: "UTILITY",
        status: "APPROVED",
        bodyText: "Olá, {{1}}! Vi seu interesse no site.",
        components: [],
      },
      {
        id: `${tenantA}:${tplA2}`,
        tenantId: tenantA,
        metaTemplateId: tplA2,
        name: "seladoras_ativo",
        language: "pt_BR",
        category: "UTILITY",
        status: "APPROVED",
        bodyText: "Olá, {{1}}! Vi seu interesse em seladoras.",
        components: [],
      },
      {
        id: `${tenantB}:${tplB1}`,
        tenantId: tenantB,
        metaTemplateId: tplB1,
        name: "valem_ativo",
        language: "pt_BR",
        category: "UTILITY",
        status: "APPROVED",
        bodyText: "Olá, {{1}}! Valem à disposição.",
        components: [],
      },
    ]);

    await db.insert(rdMarketingFlows).values([
      {
        id: flowA1,
        tenantId: tenantA,
        tokenHash: `hash-a1-${runId}`,
        tokenEncrypted: `enc-a1-${runId}`,
        settings: makeFlowSettings("Botão Whatsapp | Site", pipeA, stageContatarA, tplA1, 5),
      },
      {
        id: flowA2,
        tenantId: tenantA,
        tokenHash: `hash-a2-${runId}`,
        tokenEncrypted: `enc-a2-${runId}`,
        settings: makeFlowSettings("Botão Whatsapp | Seladoras", pipeA, stageContatarA, tplA2, 7),
      },
      {
        id: flowB1,
        tenantId: tenantB,
        tokenHash: `hash-b1-${runId}`,
        tokenEncrypted: `enc-b1-${runId}`,
        settings: makeFlowSettings("Fluxo Valem", pipeB, stageContatarB, tplB1, 5),
      },
    ]);
  });

  afterAll(async () => {
    await db.delete(tenants).where(inArray(tenants.id, [tenantA, tenantB]));
  });

  test("receiveLeads com atraso ligado cria o card na hora, agenda o template (sem disparar ainda) e preserva tokenHash/URL", async () => {
    const [flowBefore] = await db
      .select()
      .from(rdMarketingFlows)
      .where(eq(rdMarketingFlows.id, flowA1));

    const outcomes = await receiveLeads(flowBefore, {
      leads: [
        {
          uuid: `uuid-lead-delay-${runId}`,
          name: "Carlos Agendado",
          email: `carlos.${runId}@empresa.com`,
          mobile_phone: "5511991112233",
          last_conversion: {
            created_at: "2026-11-25T14:00:00Z",
            content: { identificador: "botao-whatsapp-site" },
          },
        },
      ],
    });

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].status).toBe("created");
    expect(outcomes[0].dealId).toBeTruthy();

    const scheduled = await listScheduledRdTemplateDispatches(tenantA);
    const match = scheduled.find((item) => item.dealId === outcomes[0].dealId);
    expect(match).toBeDefined();
    expect(match?.delayMinutes).toBe(5);
    expect(match?.templateName).toBe("botao_site_ativo");
    expect(match?.status).toBe("pending");

    // Token do webhook permanece intacto
    const [flowAfter] = await db
      .select()
      .from(rdMarketingFlows)
      .where(eq(rdMarketingFlows.id, flowA1));
    expect(flowAfter.tokenHash).toBe(flowBefore.tokenHash);
    expect(flowAfter.tokenEncrypted).toBe(flowBefore.tokenEncrypted);

    // MCP expõe configuração de atraso do fluxo
    const mcpResult = (await executeRdMarketingMcpTool(
      "list_rd_marketing_flows",
      { query: "Botão Whatsapp | Site" },
      tenantA as any,
    )) as any;
    expect(mcpResult.flows[0].whatsappTemplateDelay).toEqual({ enabled: true, minutes: 5 });
  });

  test("deduplicação por contato substitui agendamento anterior pelo mais recente e reinicia o timer", async () => {
    const contactId = `cont-dedup-${runId}`;
    const deal1 = `deal-dedup-1-${runId}`;
    const deal2 = `deal-dedup-2-${runId}`;
    await db.insert(contacts).values({
      id: contactId,
      tenantId: tenantA,
      name: "Lead Duplo Clique",
      phone: "5511992223344",
      mainChannel: "whatsapp",
    });
    await db.insert(crmDeals).values([
      { id: deal1, tenantId: tenantA, title: "Lead Clique 1", pipelineId: pipeA, stageId: stageContatarA, status: "open" },
      { id: deal2, tenantId: tenantA, title: "Lead Clique 2", pipelineId: pipeA, stageId: stageContatarA, status: "open" },
    ]);

    const t0 = new Date("2026-11-25T15:00:00Z");
    const first = await scheduleRdSdrTemplatePostCommit(
      {
        tenantId: tenantA,
        flowId: flowA1,
        dealId: deal1,
        contactId,
        whatsappTemplateId: tplA1,
        clientName: "Lead Duplo Clique",
        delayEnabled: true,
        delayMinutes: 5,
      },
      { now: t0 },
    );
    expect(first.scheduled).toBe(true);

    const t2 = new Date("2026-11-25T15:02:00Z");
    const second = await scheduleRdSdrTemplatePostCommit(
      {
        tenantId: tenantA,
        flowId: flowA2,
        dealId: deal2,
        contactId,
        whatsappTemplateId: tplA2,
        clientName: "Lead Duplo Clique",
        delayEnabled: true,
        delayMinutes: 7,
      },
      { now: t2 },
    );
    expect(second.scheduled).toBe(true);
    expect(second.replacedScheduleId).toBe(first.scheduleId);
    expect(second.scheduledFor?.toISOString()).toBe("2026-11-25T15:09:00.000Z");

    const rows = await db
      .select()
      .from(rdMarketingScheduledTemplates)
      .where(
        and(
          eq(rdMarketingScheduledTemplates.tenantId, tenantA),
          eq(rdMarketingScheduledTemplates.contactId, contactId),
        ),
      );
    const pendingRows = rows.filter((r) => r.status === "pending");
    const replacedRow = rows.find((r) => r.id === first.scheduleId);
    expect(pendingRows).toHaveLength(1);
    expect(pendingRows[0].id).toBe(second.scheduleId);
    expect(pendingRows[0].whatsappTemplateId).toBe(tplA2);
    expect(replacedRow?.status).toBe("cancelled");
    expect(replacedRow?.cancelReason).toBe("replaced_by_newer_flow");
  });

  test("mensagem do cliente durante a janela cancela o template imediatamente e vincula o card à conversa", async () => {
    const contactId = `cont-reply-${runId}`;
    const convId = `conv-reply-${runId}`;
    const dealId = `deal-reply-${runId}`;
    await db.insert(contacts).values({
      id: contactId,
      tenantId: tenantA,
      name: "Maria Respondeu",
      phone: "5511993334455",
      mainChannel: "whatsapp",
    });
    await db.insert(crmDeals).values({
      id: dealId,
      tenantId: tenantA,
      title: "Maria Respondeu",
      pipelineId: pipeA,
      stageId: stageContatarA,
      status: "open",
    });

    const t0 = new Date("2026-11-25T16:00:00Z");
    const sched = await scheduleRdSdrTemplatePostCommit(
      {
        tenantId: tenantA,
        flowId: flowA1,
        dealId,
        contactId,
        whatsappTemplateId: tplA1,
        clientName: "Maria Respondeu",
        delayEnabled: true,
        delayMinutes: 5,
      },
      { now: t0 },
    );
    expect(sched.scheduled).toBe(true);

    // Cliente abre conversa e manda mensagem 2 minutos depois
    await db.insert(conversations).values({
      id: convId,
      tenantId: tenantA,
      contactId,
      contactPhone: "5511993334455",
      queueState: "automacao",
      operatorId: null,
    });
    await db.insert(messages).values({
      id: `msg-reply-${runId}`,
      tenantId: tenantA,
      conversationId: convId,
      senderType: "client",
      senderName: "Maria Respondeu",
      content: "Olá, vim pelo botão do site!",
      isInternalNote: false,
      direction: "inbound",
      sentAt: new Date("2026-11-25T16:02:00Z"),
    });

    const cancelRes = await cancelPendingRdScheduledTemplatesOnClientMessage({
      tenantId: tenantA,
      contactId,
      conversationId: convId,
      messageAt: new Date("2026-11-25T16:02:00Z"),
    });
    expect(cancelRes.cancelledCount).toBe(1);
    expect(cancelRes.cancelledIds).toEqual([sched.scheduleId!]);

    const [schedRow] = await db
      .select()
      .from(rdMarketingScheduledTemplates)
      .where(eq(rdMarketingScheduledTemplates.id, sched.scheduleId!));
    expect(schedRow.status).toBe("cancelled");
    expect(schedRow.cancelReason).toBe("client_messaged_during_delay");

    // Card foi vinculado à conversa ativa
    const links = await db
      .select()
      .from(crmConversationDeals)
      .where(
        and(
          eq(crmConversationDeals.tenantId, tenantA),
          eq(crmConversationDeals.conversationId, convId),
          eq(crmConversationDeals.dealId, dealId),
        ),
      );
    expect(links).toHaveLength(1);
  });

  test("mensagem pré-webhook nos últimos 15 min cancela já no agendamento; chat do site (conv-lc-*) e chat vazio em fila NÃO bloqueiam", async () => {
    // Caso 1: cliente já mandou WhatsApp 4 min antes do webhook chegar
    const contactPre = `cont-pre-${runId}`;
    const convPre = `conv-pre-${runId}`;
    const dealPre = `deal-pre-${runId}`;
    await db.insert(contacts).values({
      id: contactPre,
      tenantId: tenantA,
      name: "Cliente Pré-Webhook",
      phone: "5511994445566",
      mainChannel: "whatsapp",
    });
    await db.insert(conversations).values({
      id: convPre,
      tenantId: tenantA,
      contactId: contactPre,
      contactPhone: "5511994445566",
      queueState: "automacao",
      operatorId: null,
    });
    await db.insert(messages).values({
      id: `msg-pre-${runId}`,
      tenantId: tenantA,
      conversationId: convPre,
      senderType: "client",
      senderName: "Cliente Pré-Webhook",
      content: "Oi, quero cotação",
      isInternalNote: false,
      direction: "inbound",
      sentAt: new Date("2026-11-25T16:56:00Z"),
    });

    const preRes = await scheduleRdSdrTemplatePostCommit(
      {
        tenantId: tenantA,
        flowId: flowA1,
        dealId: dealPre,
        contactId: contactPre,
        whatsappTemplateId: tplA1,
        clientName: "Cliente Pré-Webhook",
        delayEnabled: true,
        delayMinutes: 5,
      },
      { now: new Date("2026-11-25T17:00:00Z") },
    );
    expect(preRes.scheduled).toBe(false);
    expect(preRes.cancelled).toBe(true);
    expect(preRes.reason).toBe("client_messaged_before_webhook");

    // Caso 2a: contato só tem conversa do Site (conv-lc-*) com mensagem recente -> NÃO bloqueia WhatsApp!
    const contactSiteOnly = `cont-site-${runId}`;
    const dealSiteOnly = `deal-site-${runId}`;
    // Caso 2b: contato tem conversa WhatsApp vazia em 'fila' (só nota interna, 0 msgs reais) -> NÃO bloqueia!
    const contactEmptyFila = `cont-empty-${runId}`;
    const dealEmptyFila = `deal-empty-${runId}`;
    await db.insert(contacts).values([
      {
        id: contactSiteOnly,
        tenantId: tenantA,
        name: "Cliente Site",
        phone: "5511995556677",
        mainChannel: "whatsapp",
      },
      {
        id: contactEmptyFila,
        tenantId: tenantA,
        name: "Cliente Chat Vazio",
        phone: "5511995556688",
        mainChannel: "whatsapp",
      },
    ]);
    await db.insert(conversations).values([
      {
        id: `conv-lc-${runId}`,
        tenantId: tenantA,
        contactId: contactSiteOnly,
        contactPhone: "5511995556677",
        queueState: "automacao",
        operatorId: null,
      },
      {
        id: `conv-empty-fila-${runId}`,
        tenantId: tenantA,
        contactId: contactEmptyFila,
        contactPhone: "5511995556688",
        queueState: "fila",
        operatorId: null,
      },
    ]);
    await db.insert(messages).values([
      {
        id: `msg-site-${runId}`,
        tenantId: tenantA,
        conversationId: `conv-lc-${runId}`,
        senderType: "client",
        senderName: "Cliente Site",
        content: "Mensagem no site",
        isInternalNote: false,
        direction: "inbound",
        sentAt: new Date("2026-11-25T16:58:00Z"),
      },
      {
        id: `msg-note-${runId}`,
        tenantId: tenantA,
        conversationId: `conv-empty-fila-${runId}`,
        senderType: "system",
        senderName: "Sistema",
        content: "Nota interna",
        isInternalNote: true,
        direction: "outbound",
        sentAt: new Date("2026-11-25T16:59:00Z"),
      },
    ]);

    const okSiteRes = await scheduleRdSdrTemplatePostCommit(
      {
        tenantId: tenantA,
        flowId: flowA1,
        dealId: dealSiteOnly,
        contactId: contactSiteOnly,
        whatsappTemplateId: tplA1,
        clientName: "Cliente Site",
        delayEnabled: true,
        delayMinutes: 5,
      },
      { now: new Date("2026-11-25T17:00:00Z") },
    );
    expect(okSiteRes.scheduled).toBe(true);

    const okEmptyRes = await scheduleRdSdrTemplatePostCommit(
      {
        tenantId: tenantA,
        flowId: flowA1,
        dealId: dealEmptyFila,
        contactId: contactEmptyFila,
        whatsappTemplateId: tplA1,
        clientName: "Cliente Chat Vazio",
        delayEnabled: true,
        delayMinutes: 5,
      },
      { now: new Date("2026-11-25T17:00:00Z") },
    );
    expect(okEmptyRes.scheduled).toBe(true);
  });

  test("worker dispara após o prazo, recheca mensagem de última hora, respeita isolamento de tenant e suporta ações manuais", async () => {
    const contactSilentA = `cont-silent-a-${runId}`;
    const contactLastSecA = `cont-lastsec-a-${runId}`;
    const contactManualA = `cont-manual-a-${runId}`;
    const contactTenantB = `cont-b-${runId}`;

    await db.insert(contacts).values([
      { id: contactSilentA, tenantId: tenantA, name: "Silencioso A", phone: "5511996660001", mainChannel: "whatsapp" },
      { id: contactLastSecA, tenantId: tenantA, name: "Mandou no Fim", phone: "5511996660002", mainChannel: "whatsapp" },
      { id: contactManualA, tenantId: tenantA, name: "Manual Operador", phone: "5511996660003", mainChannel: "whatsapp" },
      { id: contactTenantB, tenantId: tenantB, name: "Lead Tenant B", phone: "5511996660004", mainChannel: "whatsapp" },
    ]);

    const t0 = new Date("2026-11-25T18:00:00Z");
    const schedSilent = await scheduleRdSdrTemplatePostCommit(
      {
        tenantId: tenantA,
        flowId: flowA1,
        dealId: `deal-silent-${runId}`,
        contactId: contactSilentA,
        whatsappTemplateId: tplA1,
        clientName: "Silencioso A",
        delayEnabled: true,
        delayMinutes: 5,
      },
      { now: t0 },
    );
    const schedLastSec = await scheduleRdSdrTemplatePostCommit(
      {
        tenantId: tenantA,
        flowId: flowA1,
        dealId: `deal-lastsec-${runId}`,
        contactId: contactLastSecA,
        whatsappTemplateId: tplA1,
        clientName: "Mandou no Fim",
        delayEnabled: true,
        delayMinutes: 5,
      },
      { now: t0 },
    );
    const schedManual = await scheduleRdSdrTemplatePostCommit(
      {
        tenantId: tenantA,
        flowId: flowA1,
        dealId: `deal-manual-${runId}`,
        contactId: contactManualA,
        whatsappTemplateId: tplA1,
        clientName: "Manual Operador",
        delayEnabled: true,
        delayMinutes: 30,
      },
      { now: t0 },
    );
    const schedTenantB = await scheduleRdSdrTemplatePostCommit(
      {
        tenantId: tenantB,
        flowId: flowB1,
        dealId: `deal-b-${runId}`,
        contactId: contactTenantB,
        whatsappTemplateId: tplB1,
        clientName: "Lead Tenant B",
        delayEnabled: true,
        delayMinutes: 5,
      },
      { now: t0 },
    );

    // Simula mensagem direta no banco sem passar pelo hook inbound para validar a rechecagem do worker
    await db.insert(conversations).values({
      id: `conv-lastsec-${runId}`,
      tenantId: tenantA,
      contactId: contactLastSecA,
      contactPhone: "5511996660002",
      queueState: "automacao",
      operatorId: null,
    });
    await db.insert(messages).values({
      id: `msg-lastsec-${runId}`,
      tenantId: tenantA,
      conversationId: `conv-lastsec-${runId}`,
      senderType: "client",
      senderName: "Mandou no Fim",
      content: "Oi!",
      isInternalNote: false,
      direction: "inbound",
      sentAt: new Date("2026-11-25T18:04:30Z"),
    });

    // Isolamento multi-tenant: Tenant B não pode cancelar nem disparar agendamento do Tenant A
    await expect(
      cancelScheduledRdTemplateByOperator(tenantB, schedManual.scheduleId!, "Operador B"),
    ).rejects.toThrow("Agendamento não encontrado");

    const dispatchedJobs: Array<{ contactId: string; delayedMinutes?: number; manualTrigger?: boolean }> = [];
    const fakeDispatcher: RdTemplateDispatcherFn = async (job) => {
      dispatchedJobs.push({
        contactId: job.contactId,
        delayedMinutes: job.dispatchContext?.delayedMinutes,
        manualTrigger: job.dispatchContext?.manualTrigger,
      });
      return { dispatched: true, templateName: "botao_site_ativo", cwrAction: "moved_to_contacting" };
    };

    // Aos 5 minutos e 5 segundos, processa apenas Tenant A
    const summaryA = await processDueRdScheduledTemplatesForTenant(tenantA, {
      now: new Date("2026-11-25T18:05:05Z"),
      dispatcher: fakeDispatcher,
    });

    expect(summaryA.sent).toBeGreaterThanOrEqual(1);
    expect(dispatchedJobs.some((j) => j.contactId === contactSilentA && j.delayedMinutes === 5)).toBe(true);
    expect(dispatchedJobs.some((j) => j.contactId === contactLastSecA)).toBe(false);
    expect(dispatchedJobs.some((j) => j.contactId === contactTenantB)).toBe(false);

    const [silentRow] = await db
      .select()
      .from(rdMarketingScheduledTemplates)
      .where(eq(rdMarketingScheduledTemplates.id, schedSilent.scheduleId!));
    const [lastSecRow] = await db
      .select()
      .from(rdMarketingScheduledTemplates)
      .where(eq(rdMarketingScheduledTemplates.id, schedLastSec.scheduleId!));
    const [tenantBRow] = await db
      .select()
      .from(rdMarketingScheduledTemplates)
      .where(eq(rdMarketingScheduledTemplates.id, schedTenantB.scheduleId!));

    expect(silentRow.status).toBe("sent");
    expect(lastSecRow.status).toBe("cancelled");
    expect(lastSecRow.cancelReason).toBe("client_messaged_during_delay");
    expect(tenantBRow.status).toBe("pending"); // Tenant B intocado!

    // Ação manual "Enviar agora" pelo operador no Tenant A
    const manualSend = await dispatchScheduledRdTemplateNow(
      tenantA,
      schedManual.scheduleId!,
      "Tarcísio",
      { dispatcher: fakeDispatcher },
    );
    expect(manualSend.dispatched).toBe(true);
    expect(dispatchedJobs.some((j) => j.contactId === contactManualA && j.manualTrigger === true)).toBe(true);

    // Ação manual "Cancelar" no Tenant B
    const manualCancelB = await cancelScheduledRdTemplateByOperator(
      tenantB,
      schedTenantB.scheduleId!,
      "Operador Valem",
    );
    expect(manualCancelB.cancelled).toBe(true);

    const logsA = await db
      .select({ status: rdMarketingLogs.status, message: rdMarketingLogs.message })
      .from(rdMarketingLogs)
      .where(eq(rdMarketingLogs.tenantId, tenantA));
    expect(logsA.some((l) => l.status === "scheduled")).toBe(true);
    expect(logsA.some((l) => l.status === "cancelled")).toBe(true);
  });

  test("worker cancela agendamento se o fluxo for pausado ou o template for removido antes do horário previsto", async () => {
    const flowPausedId = `flow-paused-${runId}`;
    const contactPaused = `cont-paused-${runId}`;
    await db.insert(rdMarketingFlows).values({
      id: flowPausedId,
      tenantId: tenantA,
      tokenHash: `hash-paused-${runId}`,
      settings: makeFlowSettings("Fluxo Pausado Depois", pipeA, stageContatarA, tplA1, 5),
    });
    await db.insert(contacts).values({
      id: contactPaused,
      tenantId: tenantA,
      name: "Lead Fluxo Pausado",
      phone: "5511997770001",
      mainChannel: "whatsapp",
    });

    const t0 = new Date("2026-11-25T19:00:00Z");
    const sched = await scheduleRdSdrTemplatePostCommit(
      {
        tenantId: tenantA,
        flowId: flowPausedId,
        dealId: `deal-paused-${runId}`,
        contactId: contactPaused,
        whatsappTemplateId: tplA1,
        clientName: "Lead Fluxo Pausado",
        delayEnabled: true,
        delayMinutes: 5,
      },
      { now: t0 },
    );
    expect(sched.scheduled).toBe(true);

    // Admin pausa o fluxo antes de vencer os 5 min
    await db
      .update(rdMarketingFlows)
      .set({
        settings: {
          ...makeFlowSettings("Fluxo Pausado Depois", pipeA, stageContatarA, tplA1, 5),
          enabled: false,
        },
      })
      .where(eq(rdMarketingFlows.id, flowPausedId));

    let dispatcherCalled = false;
    await processDueRdScheduledTemplatesForTenant(tenantA, {
      now: new Date("2026-11-25T19:06:00Z"),
      dispatcher: async () => {
        dispatcherCalled = true;
        return { dispatched: true };
      },
    });

    expect(dispatcherCalled).toBe(false);
    const [row] = await db
      .select()
      .from(rdMarketingScheduledTemplates)
      .where(eq(rdMarketingScheduledTemplates.id, sched.scheduleId!));
    expect(row.status).toBe("cancelled");
    expect(row.cancelReason).toBe("flow_disabled_or_deleted");
  });
});
