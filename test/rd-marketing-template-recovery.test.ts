import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "../src/db";
import {
  contactPhones,
  contacts,
  conversations,
  crmDealContacts,
  crmDeals,
  crmPipelines,
  crmStages,
  messages,
  metaMessageTemplates,
  rdMarketingEvents,
  rdMarketingFlows,
  rdMarketingLogs,
  tenants,
} from "../src/db/schema";
import {
  extractContactEmails,
  mergeContactEmails,
  normalizeContactEmailsInput,
} from "../src/lib/crm/contact-emails";
import { claimRdEvent, processRdEvent } from "../src/lib/rd-marketing/inbox";
import { defaultMappings, type FlowSettings } from "../src/lib/rd-marketing/mapping";
import { receiveLeads } from "../src/lib/rd-marketing/service";
import {
  inspectAndRepairRdFlowTemplates,
  listPendingRdTemplateDispatches,
  resolveApprovedRdTemplate,
} from "../src/lib/rd-marketing/sdr-template-dispatch";
import { executeRdMarketingMcpTool } from "../src/lib/mcp/valem-tecfag-mcp-rd-marketing-tools";

describe("RD Marketing: auto-cura de templates Meta, recovery de leads em CONTATAR e fix de loop em inbox.ts", () => {
  const runId = randomUUID().slice(0, 8);
  const tenantA = `rd-tpl-a-${runId}`;
  const tenantB = `rd-tpl-b-${runId}`;
  const pipeA = `pipe-a-${runId}`;
  const stageContatarA = `stg-contatar-${runId}`;
  const stageContatandoA = `stg-contatando-${runId}`;
  const flowStaleId = `flow-stale-${runId}`;
  const flowActivityId = `flow-act-${runId}`;
  const dealPendingNoConv = `deal-pend-0-${runId}`;
  const dealPendingInternalOnly = `deal-pend-int-${runId}`;
  const dealAlreadyContacted = `deal-sent-${runId}`;
  const dealMovedStage = `deal-moved-${runId}`;
  const contactNoConv = `cont-0-${runId}`;
  const contactInternalOnly = `cont-int-${runId}`;
  const contactSent = `cont-sent-${runId}`;
  const contactMoved = `cont-moved-${runId}`;
  const convInternalOnly = `conv-int-${runId}`;
  const convSent = `conv-sent-${runId}`;
  const eventActivityId = `ev-act-${runId}`;

  const oldMetaId = `4286263598${runId}`;
  const activeMetaId = `2377526299${runId}`;
  const tenantBMetaId = `9999999999${runId}`;

  const baseSettings: FlowSettings = {
    name: "CRM | LP Personnalité Teste",
    enabled: true,
    pipelineId: pipeA,
    stageId: stageContatarA,
    operatorId: null,
    deduplication: "event",
    eventIdPath: "rd_conversion.id",
    whatsappTemplateId: oldMetaId,
    mappings: defaultMappings,
  };

  beforeAll(async () => {
    await db.insert(tenants).values([
      { id: tenantA, name: "Tenant A", slug: tenantA, connectionType: "meta" },
      { id: tenantB, name: "Tenant B", slug: tenantB, connectionType: "meta" },
    ]);

    await db.insert(crmPipelines).values({
      id: pipeA,
      tenantId: tenantA,
      name: "FUNIL CWR",
    });

    await db.insert(crmStages).values([
      { id: stageContatarA, tenantId: tenantA, pipelineId: pipeA, name: "CONTATAR", orderIndex: 0 },
      { id: stageContatandoA, tenantId: tenantA, pipelineId: pipeA, name: "CONTATANDO", orderIndex: 1 },
    ]);

    await db.insert(metaMessageTemplates).values([
      {
        id: `${tenantA}:${oldMetaId}`,
        tenantId: tenantA,
        metaTemplateId: oldMetaId,
        name: "apresentacao7",
        language: "pt_BR",
        category: "UTILITY",
        status: "DELETED",
        bodyText: "Olá, {{1}}! Versão antiga.",
        components: [],
      },
      {
        id: `${tenantA}:${activeMetaId}`,
        tenantId: tenantA,
        metaTemplateId: activeMetaId,
        name: "apresentacao7",
        language: "pt_BR",
        category: "UTILITY",
        status: "APPROVED",
        bodyText: "Olá, {{1}}! Recebi seu interesse em nossos equipamentos automáticos.",
        components: [],
      },
      {
        id: `${tenantB}:${tenantBMetaId}`,
        tenantId: tenantB,
        metaTemplateId: tenantBMetaId,
        name: "apresentacao7",
        language: "pt_BR",
        category: "UTILITY",
        status: "APPROVED",
        bodyText: "Template de outro tenant (não pode vazar).",
        components: [],
      },
    ]);

    await db.insert(rdMarketingFlows).values([
      {
        id: flowStaleId,
        tenantId: tenantA,
        tokenHash: `hash-stale-${runId}`,
        settings: baseSettings,
      },
      {
        id: flowActivityId,
        tenantId: tenantA,
        tokenHash: `hash-act-${runId}`,
        settings: { ...baseSettings, name: "Botão Site Teste", whatsappTemplateId: null },
      },
    ]);

    await db.insert(contacts).values([
      { id: contactNoConv, tenantId: tenantA, name: "Lead Sem Conversa", phone: "5511997551838", mainChannel: "whatsapp" },
      { id: contactInternalOnly, tenantId: tenantA, name: "Lead Nota Interna", phone: "5537998126489", mainChannel: "whatsapp" },
      { id: contactSent, tenantId: tenantA, name: "Lead Com Mensagem", phone: "5511988887777", mainChannel: "whatsapp" },
      { id: contactMoved, tenantId: tenantA, name: "Lead Ja Movido", phone: "5511977776666", mainChannel: "whatsapp" },
    ]);

    await db.insert(crmDeals).values([
      {
        id: dealPendingNoConv,
        tenantId: tenantA,
        title: "Lead Sem Conversa",
        pipelineId: pipeA,
        stageId: stageContatarA,
        status: "open",
      },
      {
        id: dealPendingInternalOnly,
        tenantId: tenantA,
        title: "Lead Nota Interna",
        pipelineId: pipeA,
        stageId: stageContatarA,
        status: "open",
      },
      {
        id: dealAlreadyContacted,
        tenantId: tenantA,
        title: "Lead Com Mensagem",
        pipelineId: pipeA,
        stageId: stageContatarA,
        status: "open",
      },
      {
        id: dealMovedStage,
        tenantId: tenantA,
        title: "Lead Ja Movido",
        pipelineId: pipeA,
        stageId: stageContatandoA,
        status: "open",
      },
    ]);

    await db.insert(crmDealContacts).values([
      { id: `dc-0-${runId}`, tenantId: tenantA, dealId: dealPendingNoConv, contactId: contactNoConv, isPrimary: true },
      { id: `dc-1-${runId}`, tenantId: tenantA, dealId: dealPendingInternalOnly, contactId: contactInternalOnly, isPrimary: true },
      { id: `dc-2-${runId}`, tenantId: tenantA, dealId: dealAlreadyContacted, contactId: contactSent, isPrimary: true },
      { id: `dc-3-${runId}`, tenantId: tenantA, dealId: dealMovedStage, contactId: contactMoved, isPrimary: true },
    ]);

    await db.insert(conversations).values([
      {
        id: convInternalOnly,
        tenantId: tenantA,
        contactId: contactInternalOnly,
        contactPhone: "5537998126489",
        queueState: "meus",
        operatorId: null,
      },
      {
        id: convSent,
        tenantId: tenantA,
        contactId: contactSent,
        contactPhone: "5511988887777",
        queueState: "automacao",
        operatorId: null,
      },
    ]);

    await db.insert(messages).values([
      {
        id: `msg-int-${runId}`,
        tenantId: tenantA,
        conversationId: convInternalOnly,
        senderType: "system",
        senderName: "Automação RD Station Marketing",
        content: "Negociação atual selecionada automaticamente.",
        isInternalNote: true,
      },
      {
        id: `msg-real-${runId}`,
        tenantId: tenantA,
        conversationId: convSent,
        senderType: "bot",
        senderName: "IA SDR",
        content: "Olá! Recebi seu cadastro.",
        isInternalNote: false,
      },
    ]);

    await db.insert(rdMarketingLogs).values([
      {
        id: randomUUID(),
        tenantId: tenantA,
        flowId: flowStaleId,
        status: "warning",
        dealId: dealPendingNoConv,
        message: `Template WhatsApp '${oldMetaId}' não encontrado ou não aprovado na Meta.`,
      },
      {
        id: randomUUID(),
        tenantId: tenantA,
        flowId: flowStaleId,
        status: "warning",
        dealId: dealPendingInternalOnly,
        message: `Template WhatsApp '${oldMetaId}' não encontrado ou não aprovado na Meta.`,
      },
      {
        id: randomUUID(),
        tenantId: tenantA,
        flowId: flowStaleId,
        status: "warning",
        dealId: dealAlreadyContacted,
        message: `Template WhatsApp '${oldMetaId}' não encontrado ou não aprovado na Meta.`,
      },
      {
        id: randomUUID(),
        tenantId: tenantA,
        flowId: flowStaleId,
        status: "warning",
        dealId: dealMovedStage,
        message: `Template WhatsApp '${oldMetaId}' não encontrado ou não aprovado na Meta.`,
      },
    ]);

    await db.insert(rdMarketingEvents).values({
      id: eventActivityId,
      tenantId: tenantA,
      flowId: flowActivityId,
      payload: {
        leads: [
          {
            uuid: "uuid-echo-1",
            name: "Eco Atividade",
            email: "eco@example.com",
            last_conversion: {
              content: { identificador: "tecfag-chat-conversa-iniciada" },
            },
          },
        ],
      },
      settings: { ...baseSettings, name: "Botão Site Teste", whatsappTemplateId: null },
      status: "pending",
      outcomes: [],
      attempts: 12,
      nextRetryAt: new Date(Date.now() - 60_000),
    });
  });

  afterAll(async () => {
    await db.delete(tenants).where(inArray(tenants.id, [tenantA, tenantB]));
  });

  test("inbox.ts conclui evento de eco tecfag-chat-* como processed/ignored em vez de lançar TypeError e entrar em loop", async () => {
    const claimed = await claimRdEvent(tenantA, eventActivityId);
    expect(claimed).not.toBeNull();

    await processRdEvent(claimed!, async () => []);

    const [updated] = await db
      .select()
      .from(rdMarketingEvents)
      .where(eq(rdMarketingEvents.id, eventActivityId));
    expect(updated.status).toBe("processed");
    expect(updated.errorMessage).toBeNull();
    expect(updated.outcomes).toEqual([{ index: 0, status: "ignored" }]);
  });

  test("list_rd_marketing_flows resolve template por metaTemplateId e sugere substituto APPROVED quando DELETED", async () => {
    const result = (await executeRdMarketingMcpTool(
      "list_rd_marketing_flows",
      { query: "Personnalité" },
      tenantA,
    )) as any;

    expect(result.flows).toHaveLength(1);
    expect(result.flows[0].whatsappTemplate).toEqual({
      id: oldMetaId,
      name: "apresentacao7",
      status: "DELETED",
      activeReplacement: {
        metaTemplateId: activeMetaId,
        name: "apresentacao7",
        language: "pt_BR",
      },
    });
  });

  test("listPendingRdTemplateDispatches lista apenas cards abertos em CONTATAR sem mensagem real (incluindo conversa com apenas nota interna)", async () => {
    const pending = await listPendingRdTemplateDispatches(tenantA);
    const dealIds = pending.map((p) => p.dealId).sort();
    expect(dealIds).toEqual([dealPendingInternalOnly, dealPendingNoConv].sort());
    for (const item of pending) {
      expect(item.flowTemplateStatus).toBe("auto_healable");
      expect(item.resolvedTemplateId).toBe(activeMetaId);
      expect(item.resolvedTemplateName).toBe("apresentacao7");
    }
  });

  test("resolveApprovedRdTemplate auto-cura template DELETED pelo nome dentro do mesmo tenant sem vazar para tenantB", async () => {
    // Tenant B não pode resolver ID antigo do Tenant A
    const crossTenant = await resolveApprovedRdTemplate(tenantB, oldMetaId, {
      persistAutoHeal: false,
    });
    expect(crossTenant.template).toBeNull();

    // Tenant A auto-cura o ID antigo para o APPROVED ativo e persiste no fluxo
    const healed = await resolveApprovedRdTemplate(tenantA, oldMetaId, {
      flowId: flowStaleId,
      persistAutoHeal: true,
    });
    expect(healed.template?.metaTemplateId).toBe(activeMetaId);
    expect(healed.healedFromId).toBe(oldMetaId);

    const [flowAfter] = await db
      .select({ settings: rdMarketingFlows.settings })
      .from(rdMarketingFlows)
      .where(eq(rdMarketingFlows.id, flowStaleId));
    expect(flowAfter.settings.whatsappTemplateId).toBe(activeMetaId);

    // Após auto-cura, inspectAndRepairRdFlowTemplates não reporta mais o fluxo como stale
    const auditAfter = await inspectAndRepairRdFlowTemplates(tenantA, { applyAutoHeal: false });
    expect(auditAfter.staleFlows).toHaveLength(0);
  });

  test("contact-emails acumula múltiplos e-mails sem nunca descartar e valida formatos", () => {
    const m1 = mergeContactEmails("marcio@empresa.com", {}, "PAODEALHO@hotmail.com");
    expect(m1.primaryEmail).toBe("marcio@empresa.com");
    expect(m1.secondaryEmails).toEqual(["paodealho@hotmail.com"]);
    expect(m1.allEmails).toEqual(["marcio@empresa.com", "paodealho@hotmail.com"]);

    const m2 = mergeContactEmails(m1.primaryEmail, m1.customFields, "terceiro@empresa.com.br");
    expect(m2.allEmails).toEqual([
      "marcio@empresa.com",
      "paodealho@hotmail.com",
      "terceiro@empresa.com.br",
    ]);

    const norm = normalizeContactEmailsInput(
      ["novo@principal.com", "marcio@empresa.com", "MARCIO@EMPRESA.COM"],
      undefined,
      { extra: "keep" },
    );
    expect(norm.validationError).toBeUndefined();
    expect(norm.primaryEmail).toBe("novo@principal.com");
    expect(norm.secondaryEmails).toEqual(["marcio@empresa.com"]);
    expect(norm.customFields).toEqual({ extra: "keep", secondaryEmails: ["marcio@empresa.com"] });

    const bad = normalizeContactEmailsInput(["ok@ok.com", "nao-e-email"]);
    expect(bad.validationError).toContain("nao-e-email");
  });

  test("receiveLeads resolve contato via contact_phones secundário (caso José Arnaldo Link) e acumula 2º e-mail sem descartar", async () => {
    const existingSecondaryContactId = `cont-sec-${runId}`;
    await db.insert(contacts).values({
      id: existingSecondaryContactId,
      tenantId: tenantA,
      name: "Arnaldo Existente",
      phone: "5566974009107",
      email: "superjuina@gmail.com",
      mainChannel: "whatsapp",
      customFields: {},
    });
    await db.insert(contactPhones).values({
      id: `cp-sec-${runId}`,
      tenantId: tenantA,
      contactId: existingSecondaryContactId,
      phone: "5561992780010",
      phoneIdentity: "556192780010",
      type: "personal",
      isPrimary: false,
    });

    const [flowRow] = await db
      .select()
      .from(rdMarketingFlows)
      .where(eq(rdMarketingFlows.id, flowActivityId));

    const outcomes = await receiveLeads(flowRow, {
      leads: [
        {
          uuid: `uuid-arnaldo-${runId}`,
          name: "José Arnaldo Link",
          email: "arnaldo10.link@gmail.com",
          personal_phone: "+55 (61) 99278-0010",
          last_conversion: {
            created_at: "2026-11-24T17:00:00Z",
            content: { identificador: "botao-site-teste" },
          },
        },
      ],
    });

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].status).toBe("created");

    const [updatedContact] = await db
      .select()
      .from(contacts)
      .where(eq(contacts.id, existingSecondaryContactId));
    const extracted = extractContactEmails(
      updatedContact.email,
      updatedContact.customFields as Record<string, unknown>,
    );
    expect(extracted.primaryEmail).toBe("superjuina@gmail.com");
    expect(extracted.secondaryEmails).toContain("arnaldo10.link@gmail.com");
    expect(extracted.allEmails).toEqual(["superjuina@gmail.com", "arnaldo10.link@gmail.com"]);
  });
});
