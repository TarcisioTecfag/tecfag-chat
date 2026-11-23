import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import crypto from "node:crypto";
import fs from "node:fs";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../src/db";
import {
  contacts,
  conversationDealContexts,
  conversations,
  crmActionHistory,
  crmCatalogItems,
  crmConversationDeals,
  crmCustomFieldDefinitions,
  crmDealActivities,
  crmDealContacts,
  crmDealEvents,
  crmDeals,
  crmPipelines,
  crmStageSettings,
  crmStages,
  metaMessageTemplates,
  operators,
  tenants,
  whatsappConnections,
} from "../src/db/schema";
import { DEFAULT_MATURITY_RULES } from "../src/lib/commercial/metrics";
import {
  MCP_SERVER_INFO,
  processMcpJsonRpcPayload,
  type McpAccessContext,
} from "../src/lib/mcp/valem-tecfag-mcp-core";
import { computeCycleTierForValue } from "../src/lib/mcp/valem-tecfag-mcp-wave1-tools";
import { buildMcpMetaTemplateSuppliedParams } from "../src/lib/mcp/valem-tecfag-mcp-write-tools";
import { resolveMetaTemplateValues } from "../src/lib/whatsapp/meta-template-common";

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

function makeAccess(
  tenantId: "tecfag" | "valem",
  accessLevel: "read" | "read_write" = "read",
): McpAccessContext {
  return {
    authorized: true,
    lockedTenantId: tenantId,
    defaultTenantId: tenantId,
    authMode: tenantId === "valem" ? "token_valem" : "token_tecfag",
    accessLevel,
    keyId: `test-w1-${tenantId}-${accessLevel}`,
    keyLabel: `Chave Onda1 ${tenantId}`,
    skipAuditLog: true,
  };
}

async function callTool(
  name: string,
  args: Record<string, unknown>,
  tenantId: "tecfag" | "valem" = "tecfag",
  accessLevel: "read" | "read_write" = "read",
) {
  const res = await processMcpJsonRpcPayload(
    {
      jsonrpc: "2.0",
      id: `w1-${name}-${crypto.randomUUID().slice(0, 6)}`,
      method: "tools/call",
      params: { name, arguments: args },
    },
    makeAccess(tenantId, accessLevel),
  );
  const isError = Boolean(res.body?.result?.isError);
  const text = String(res.body?.result?.content?.[0]?.text || "");
  if (isError) {
    return { isError: true as const, errorText: text, data: null as any };
  }
  return { isError: false as const, errorText: "", data: JSON.parse(text) };
}

describe("MCP v3.4.0 — Onda 1 & Piloto Black (Unitário & Validações)", () => {
  it("expõe versão 3.8.0 e calcula corretamente faixas de ciclo 80% (esfria) e 110% (limite)", () => {
    expect(MCP_SERVER_INFO.version).toBe("3.8.0");

    const t1 = computeCycleTierForValue(5_000, DEFAULT_MATURITY_RULES)!;
    expect(t1.tierIndex).toBe(1);
    expect(t1.cycleDays).toBe(3);
    expect(t1.coolingAtDays).toBe(2.4);
    expect(t1.limitAtDays).toBe(3.3);

    const t3 = computeCycleTierForValue(120_000, DEFAULT_MATURITY_RULES)!;
    expect(t3.tierIndex).toBe(3);
    expect(t3.cycleDays).toBe(30);
    expect(t3.coolingAtDays).toBe(24);
    expect(t3.limitAtDays).toBe(33);

    const t5 = computeCycleTierForValue(950_000, DEFAULT_MATURITY_RULES)!;
    expect(t5.tierIndex).toBe(5);
    expect(t5.cycleDays).toBe(90);
    expect(t5.coolingAtDays).toBe(72);
    expect(t5.limitAtDays).toBe(99);

    expect(computeCycleTierForValue(0, DEFAULT_MATURITY_RULES)).toBeNull();
    expect(computeCycleTierForValue(-100, DEFAULT_MATURITY_RULES)).toBeNull();
  });

  it("valida argumentos obrigatórios das 5 ferramentas de leitura mesmo com chave 'read'", async () => {
    const cases = [
      { name: "get_stage_rules", args: {}, expected: "Informe 'stageId'" },
      { name: "validate_deal_stage_transition", args: {}, expected: "'dealId'" },
      { name: "check_operator_schedule_conflict", args: { operatorId: "op-1" }, expected: "'scheduledAt'" },
      {
        name: "check_operator_schedule_conflict",
        args: { operatorId: "op-1", scheduledAt: "nao-e-data" },
        expected: "Data inválida",
      },
      { name: "get_stage_queue", args: {}, expected: "Informe 'stageId'" },
      { name: "get_deal_audit_log", args: {}, expected: "'dealId'" },
    ];

    for (const c of cases) {
      const res = await callTool(c.name, c.args, "tecfag", "read");
      expect(res.isError).toBe(true);
      expect(res.errorText).toContain(c.expected);
    }
  });

  it("send_meta_template resolve auto-bindings (customer_name/operator_name) mesmo sem enviar parameters", () => {
    // Caso real dos 9 templates fagner_* com {{1}} = customer_name e parameters omitido
    const suppliedAuto = buildMcpMetaTemplateSuppliedParams(1, { "1": "customer_name" }, undefined);
    const resolvedAuto = resolveMetaTemplateValues(
      1,
      { "1": "customer_name" },
      suppliedAuto,
      { customerName: "joão silva", operatorName: "Fagner" },
    );
    expect(resolvedAuto).toEqual(["João"]);

    // Caso real de templates sem variáveis (fagner_coringa_c, fagner_coringa_e)
    const suppliedEmpty = buildMcpMetaTemplateSuppliedParams(0, {}, undefined);
    expect(resolveMetaTemplateValues(0, {}, suppliedEmpty, { customerName: "Maria" })).toEqual([]);

    // Caso misto: {{1}} = customer_name (auto) e {{2}} = manual; cliente passa só o valor manual
    const suppliedMixed = buildMcpMetaTemplateSuppliedParams(
      2,
      { "1": "customer_name", "2": "manual" },
      ["Seladora FR-900"],
    );
    expect(
      resolveMetaTemplateValues(
        2,
        { "1": "customer_name", "2": "manual" },
        suppliedMixed,
        { customerName: "CARLOS" },
      ),
    ).toEqual(["Carlos", "Seladora FR-900"]);

    // Caso manual faltando continua bloqueando corretamente
    const suppliedMissingManual = buildMcpMetaTemplateSuppliedParams(1, { "1": "manual" }, undefined);
    expect(() =>
      resolveMetaTemplateValues(1, { "1": "manual" }, suppliedMissingManual, { customerName: "Ana" }),
    ).toThrow("Valor ausente para {{1}}.");
  });

  it("send_meta_template resolve bindings 'deal_field:*' (Black November T1/T3), aceita override manual e sanitiza quebras/tabs", () => {
    const t1GapBindings = {
      "1": "deal_field:black_maquina" as const,
      "2": "deal_field:black_preco" as const,
      "3": "deal_field:gap_t1" as const,
    };
    const t3GapBindings = {
      "1": "deal_field:black_maquina" as const,
      "2": "deal_field:black_preco" as const,
      "3": "deal_field:gap_t3" as const,
    };
    const dealFields = {
      black_maquina: "FX-800",
      black_preco: "R$ 1.063,12",
      gap_t1:
        "acho que essas máquinas podem te interessar:\nDatadora Hot Stamp HP351 por R$ 462,94 e Seladora Conjugada 'L' de Bancada por R$ 3.966,67",
      gap_t3:
        "Datadora Hot Stamp HP351 por R$ 462,94\te Seladora Conjugada 'L' de Bancada por R$ 3.966,67",
    };

    // T1 com gap puxando automaticamente do card (sem enviar parameters)
    const suppliedT1 = buildMcpMetaTemplateSuppliedParams(3, t1GapBindings, undefined);
    expect(
      resolveMetaTemplateValues(3, t1GapBindings, suppliedT1, {
        dealCustomFields: dealFields,
      }),
    ).toEqual([
      "FX-800",
      "R$ 1.063,12",
      "acho que essas máquinas podem te interessar: Datadora Hot Stamp HP351 por R$ 462,94 e Seladora Conjugada 'L' de Bancada por R$ 3.966,67",
    ]);

    // T3 com gap puxando gap_t3 na posição {{3}} (e sanitizando \t)
    const suppliedT3 = buildMcpMetaTemplateSuppliedParams(3, t3GapBindings, undefined);
    expect(
      resolveMetaTemplateValues(3, t3GapBindings, suppliedT3, {
        dealCustomFields: dealFields,
      }),
    ).toEqual([
      "FX-800",
      "R$ 1.063,12",
      "Datadora Hot Stamp HP351 por R$ 462,94 e Seladora Conjugada 'L' de Bancada por R$ 3.966,67",
    ]);

    // Override explícito via parameters continua prevalecendo (útil para testes de amostras A/B/C)
    const suppliedOverride = buildMcpMetaTemplateSuppliedParams(3, t1GapBindings, [
      "FX-800",
      "R$ 1.063,12",
      "acho que essa máquina pode te interessar: Seladora de Pedal por cerca de R$ 783",
    ]);
    expect(
      resolveMetaTemplateValues(3, t1GapBindings, suppliedOverride, {
        dealCustomFields: dealFields,
      }),
    ).toEqual([
      "FX-800",
      "R$ 1.063,12",
      "acho que essa máquina pode te interessar: Seladora de Pedal por cerca de R$ 783",
    ]);

    // Erro claro quando o campo do card está vazio e nenhum parameter foi enviado
    const suppliedMissingDeal = buildMcpMetaTemplateSuppliedParams(3, t1GapBindings, undefined);
    expect(() =>
      resolveMetaTemplateValues(3, t1GapBindings, suppliedMissingDeal, {
        dealCustomFields: { black_maquina: "FX-800", black_preco: "R$ 1.063,12" },
      }),
    ).toThrow("campo do card 'gap_t1' vazio");
  });
});

describe.skipIf(!RUN_DB_TESTS)("MCP v3.2.0 — Onda 1 (Integração PostgreSQL Real)", () => {
  const suffix = `w1-${crypto.randomBytes(4).toString("hex")}`;
  const tenantId = "tecfag" as const;

  const pipeId = `pipe-${suffix}`;
  const st1Id = `st1-${suffix}`;
  const st2Id = `st2-${suffix}`;
  const op1Id = `op1-${suffix}`;
  const contact1Id = `ct1-${suffix}`;
  const contact2Id = `ct2-${suffix}`;
  const convId = `conv-${suffix}`;
  const dealOldId = `deal-old-${suffix}`;
  const dealFreshId = `deal-fresh-${suffix}`;
  const dealDetachId = `deal-detach-${suffix}`;
  const cfAlwaysId = `cf-always-${suffix}`;
  const cfStage2Id = `cf-st2-${suffix}`;
  const lossItemId = `loss-${suffix}`;
  const tplId = `tpl-${suffix}`;
  const actOverdueId = `act-overdue-${suffix}`;
  const actConflictId = `act-conflict-${suffix}`;

  const createdActionIds: string[] = [];

  beforeAll(async () => {
    await db
      .insert(tenants)
      .values([
        { id: "tecfag", name: "Tecfag", slug: "tecfag", connectionType: "meta" },
        { id: "valem", name: "Valem", slug: "valem", connectionType: "baileys" },
      ])
      .onConflictDoNothing();

    await db.insert(operators).values({
      id: op1Id,
      tenantId,
      name: `Consultor Onda1 ${suffix}`,
      email: `consultor.${suffix}@tecfag.test`,
      passwordHash: "test-hash-not-used",
      role: "agent",
      status: "active",
    });

    await db.insert(crmPipelines).values({
      id: pipeId,
      tenantId,
      name: `Funil Onda1 ${suffix}`,
      orderIndex: 99,
      isDefault: false,
    });

    await db.insert(crmStages).values([
      {
        id: st1Id,
        tenantId,
        pipelineId: pipeId,
        name: `QUALIFICANDO ${suffix}`,
        orderIndex: 1,
        requiredFields: [],
      },
      {
        id: st2Id,
        tenantId,
        pipelineId: pipeId,
        name: `ATENDER ${suffix}`,
        orderIndex: 2,
        requiredFields: [],
      },
    ]);

    await db.insert(crmStageSettings).values({
      stageId: st2Id,
      tenantId,
      abbreviation: "E6",
      objective: "Primeiro contato comercial em até 15 minutos",
      description: "Etapa de passagem",
      coolingEnabled: true,
      coolingDays: 7,
    });

    await db.insert(crmCustomFieldDefinitions).values([
      {
        id: cfAlwaysId,
        tenantId,
        entityType: "deal",
        name: `Máquina Onda1 ${suffix}`,
        fieldType: "text",
        required: true,
        requiredRule: "always",
        allPipelines: false,
        pipelineIds: [pipeId],
        visibleOnCreate: true,
        sortOrder: 1,
      },
      {
        id: cfStage2Id,
        tenantId,
        entityType: "deal",
        name: `Investimento Onda1 ${suffix}`,
        fieldType: "number",
        required: true,
        requiredRule: "stage_onwards",
        requiredFromStageId: st2Id,
        allPipelines: false,
        pipelineIds: [pipeId],
        visibleOnCreate: true,
        sortOrder: 2,
      },
    ]);

    await db.insert(crmCatalogItems).values({
      id: lossItemId,
      tenantId,
      kind: "loss_reason",
      name: `Motivo Onda1 ${suffix}`,
      allPipelines: false,
      pipelineIds: [pipeId],
      stageIds: [st2Id],
    });

    await db.insert(metaMessageTemplates).values({
      id: tplId,
      tenantId,
      metaTemplateId: `meta-${suffix}`,
      name: `tpl_onda1_${suffix}`,
      language: "pt_BR",
      category: "UTILITY",
      status: "APPROVED",
      bodyText: "Olá {{1}}, tudo bem?",
      components: [],
      bindings: { "1": "customer_name" },
      customGroups: [],
      allPipelines: false,
      pipelineIds: [pipeId],
      stageIds: [st2Id],
    });

    await db.insert(contacts).values([
      {
        id: contact1Id,
        tenantId,
        name: `Lead Antigo ${suffix}`,
        phone: `5511991${Math.floor(100000 + Math.random() * 899999)}`,
        mainChannel: "whatsapp",
      },
      {
        id: contact2Id,
        tenantId,
        name: `Lead Recente ${suffix}`,
        phone: `5511992${Math.floor(100000 + Math.random() * 899999)}`,
        mainChannel: "whatsapp",
      },
    ]);

    await db.insert(conversations).values({
      id: convId,
      tenantId,
      contactId: contact1Id,
      clientName: `Lead Antigo ${suffix}`,
      clientPhone: "5511999990001",
      channel: "whatsapp",
      queueState: "meus",
      assignedOperatorId: op1Id,
    });

    const now = new Date();
    const fortyMinAgo = new Date(now.getTime() - 40 * 60_000);
    const fiveMinAgo = new Date(now.getTime() - 5 * 60_000);
    const twoHoursAgo = new Date(now.getTime() - 120 * 60_000);
    const tomorrow15 = new Date(now.getTime() + 24 * 60 * 60_000);
    tomorrow15.setMinutes(0, 0, 0);

    await db.insert(crmDeals).values([
      {
        id: dealOldId,
        tenantId,
        title: `Card Atrasado ${suffix}`,
        pipelineId: pipeId,
        stageId: st2Id,
        status: "open",
        value: "120000.00",
        operatorId: op1Id,
        customFields: { [cfAlwaysId]: "Seladora FR-900" }, // falta cfStage2Id!
        isTest: false,
        createdAt: twoHoursAgo,
        updatedAt: fortyMinAgo,
      },
      {
        id: dealFreshId,
        tenantId,
        title: `Card Recente ${suffix}`,
        pipelineId: pipeId,
        stageId: st2Id,
        status: "open",
        value: "25000.00",
        operatorId: op1Id,
        customFields: { [cfAlwaysId]: "Rotuladora", [cfStage2Id]: 25000 },
        isTest: false,
        createdAt: fiveMinAgo,
        updatedAt: fiveMinAgo,
      },
      {
        id: dealDetachId,
        tenantId,
        title: `Card Duplicado Para Excluir ${suffix}`,
        pipelineId: pipeId,
        stageId: st1Id,
        status: "open",
        value: "0.00",
        operatorId: op1Id,
        customFields: {},
        isTest: true,
        createdAt: fiveMinAgo,
        updatedAt: fiveMinAgo,
      },
    ]);

    await db.insert(crmDealContacts).values([
      { id: `dc1-${suffix}`, tenantId, dealId: dealOldId, contactId: contact1Id, isPrimary: true },
      { id: `dc2-${suffix}`, tenantId, dealId: dealFreshId, contactId: contact2Id, isPrimary: true },
      { id: `dc3-${suffix}`, tenantId, dealId: dealDetachId, contactId: contact1Id, isPrimary: true },
    ]);

    await db.insert(crmDealEvents).values([
      {
        id: `ev1-${suffix}`,
        tenantId,
        dealId: dealOldId,
        eventType: "created",
        toStageId: st1Id,
        toStatus: "open",
        operatorId: op1Id,
        createdAt: twoHoursAgo,
      },
      {
        id: `ev2-${suffix}`,
        tenantId,
        dealId: dealOldId,
        eventType: "stage_changed",
        fromStageId: st1Id,
        toStageId: st2Id,
        operatorId: op1Id,
        createdAt: fortyMinAgo,
      },
    ]);

    await db.execute(sql`
      INSERT INTO crm_deal_activities (id, tenant_id, deal_id, type, title, status, due_date, assigned_to_operator_id, assigned_to_operator_ids)
      VALUES
        (${actOverdueId}, ${tenantId}, ${dealOldId}, 'call', ${`Ligação atrasada ${suffix}`}, 'pending', ${fortyMinAgo.toISOString()}::timestamptz, ${op1Id}, ${JSON.stringify([op1Id])}::jsonb),
        (${actConflictId}, ${tenantId}, ${dealFreshId}, 'meeting', ${`Reunião agendada ${suffix}`}, 'pending', ${tomorrow15.toISOString()}::timestamptz, ${op1Id}, ${JSON.stringify([op1Id])}::jsonb)
    `);

    await db.insert(crmConversationDeals).values({
      id: `ccd-${suffix}`,
      tenantId,
      conversationId: convId,
      dealId: dealDetachId,
      isActive: true,
    });

    await db.insert(conversationDealContexts).values({
      tenantId,
      conversationId: convId,
      currentDealId: dealDetachId,
      previousDealId: null,
      selectionRequired: false,
      version: 1,
    });
  });

  afterAll(async () => {
    await db
      .delete(crmDealActivities)
      .where(and(eq(crmDealActivities.tenantId, tenantId), inArray(crmDealActivities.id, [actOverdueId, actConflictId])));
    await db
      .delete(conversationDealContexts)
      .where(and(eq(conversationDealContexts.tenantId, tenantId), eq(conversationDealContexts.conversationId, convId)));
    await db
      .delete(crmConversationDeals)
      .where(and(eq(crmConversationDeals.tenantId, tenantId), eq(crmConversationDeals.conversationId, convId)));
    await db
      .delete(crmDeals)
      .where(and(eq(crmDeals.tenantId, tenantId), inArray(crmDeals.id, [dealOldId, dealFreshId, dealDetachId])));
    await db
      .delete(conversations)
      .where(and(eq(conversations.tenantId, tenantId), eq(conversations.id, convId)));
    await db
      .delete(contacts)
      .where(and(eq(contacts.tenantId, tenantId), inArray(contacts.id, [contact1Id, contact2Id])));
    await db
      .delete(metaMessageTemplates)
      .where(and(eq(metaMessageTemplates.tenantId, tenantId), eq(metaMessageTemplates.id, tplId)));
    await db
      .delete(crmCatalogItems)
      .where(and(eq(crmCatalogItems.tenantId, tenantId), eq(crmCatalogItems.id, lossItemId)));
    await db
      .delete(crmCustomFieldDefinitions)
      .where(and(eq(crmCustomFieldDefinitions.tenantId, tenantId), inArray(crmCustomFieldDefinitions.id, [cfAlwaysId, cfStage2Id])));
    await db
      .delete(crmStageSettings)
      .where(and(eq(crmStageSettings.tenantId, tenantId), eq(crmStageSettings.stageId, st2Id)));
    await db
      .delete(crmStages)
      .where(and(eq(crmStages.tenantId, tenantId), inArray(crmStages.id, [st1Id, st2Id])));
    await db
      .delete(crmPipelines)
      .where(and(eq(crmPipelines.tenantId, tenantId), eq(crmPipelines.id, pipeId)));
    await db
      .delete(operators)
      .where(and(eq(operators.tenantId, tenantId), eq(operators.id, op1Id)));
    if (createdActionIds.length > 0) {
      await db
        .delete(crmActionHistory)
        .where(and(eq(crmActionHistory.tenantId, tenantId), inArray(crmActionHistory.id, createdActionIds)));
    }
  });

  it("Item 9 (parcial): get_stage_rules lê regras reais da etapa, campos cumulativos, templates e ciclo 80%/110% com isolamento por tenant", async () => {
    const res = await callTool("get_stage_rules", { dealId: dealOldId }, "tecfag", "read");
    expect(res.isError).toBe(false);
    expect(res.data.pipeline.id).toBe(pipeId);
    expect(res.data.stage.id).toBe(st2Id);
    expect(res.data.stage.abbreviation).toBe("E6");
    expect(res.data.stage.coolingDays).toBe(7);

    const reqNames = res.data.requiredFields.items.map((f: any) => f.name);
    expect(reqNames).toContain(`Máquina Onda1 ${suffix}`);
    expect(reqNames).toContain(`Investimento Onda1 ${suffix}`);

    expect(res.data.generalRules.applicableCycle.cycleDays).toBe(30);
    expect(res.data.generalRules.applicableCycle.coolingAtDays).toBe(24);
    expect(res.data.generalRules.applicableCycle.limitAtDays).toBe(33);

    // Isolamento multi-tenant: valem não enxerga etapa/card da tecfag
    const crossTenant = await callTool("get_stage_rules", { dealId: dealOldId }, "valem", "read");
    expect(crossTenant.isError).toBe(true);
    expect(crossTenant.errorText).toContain("não encontrada");
  });

  it("Item 11 (parcial): validate_deal_stage_transition detecta campo faltando, tarefa atrasada e ordem cronológica de bloqueios", async () => {
    const res = await callTool(
      "validate_deal_stage_transition",
      { dealId: dealOldId, targetStageId: st2Id },
      "tecfag",
      "read",
    );
    expect(res.isError).toBe(false);
    expect(res.data.canMoveInCrmNow).toBe(false);
    expect(res.data.canTransitionCleanly).toBe(false);
    expect(res.data.missingFields).toContain(`Investimento Onda1 ${suffix}`);
    expect(res.data.overdueActivitiesCount).toBe(1);
    expect(res.data.hasFutureScheduledActivity).toBe(false);
    expect(res.data.blockers.length).toBeGreaterThanOrEqual(2);
    expect(res.data.blockers[0].code).toBe("overdue_activity");

    // Card completo com reunião futura agendada passa limpo
    const clean = await callTool(
      "validate_deal_stage_transition",
      { dealId: dealFreshId, targetStageId: st2Id },
      "tecfag",
      "read",
    );
    expect(clean.isError).toBe(false);
    expect(clean.data.canMoveInCrmNow).toBe(true);
    expect(clean.data.canTransitionCleanly).toBe(true);
    expect(clean.data.blockers).toHaveLength(0);
  });

  it("Item 11 (parcial): check_operator_schedule_conflict identifica exatamente qual lead ocupa o horário", async () => {
    const [act] = await db
      .select({ dueDate: crmDealActivities.dueDate })
      .from(crmDealActivities)
      .where(eq(crmDealActivities.id, actConflictId))
      .limit(1);
    const conflictStart = new Date(act!.dueDate!.getTime() + 5 * 60_000).toISOString();

    const conflict = await callTool(
      "check_operator_schedule_conflict",
      { operatorId: op1Id, scheduledAt: conflictStart, durationMinutes: 15 },
      "tecfag",
      "read",
    );
    expect(conflict.isError).toBe(false);
    expect(conflict.data.hasConflict).toBe(true);
    expect(conflict.data.conflictCount).toBe(1);
    expect(conflict.data.conflicts[0].dealId).toBe(dealFreshId);
    expect(conflict.data.conflicts[0].leadContactName).toBe(`Lead Recente ${suffix}`);

    // Ignorando a própria atividade, não há conflito
    const selfExcluded = await callTool(
      "check_operator_schedule_conflict",
      {
        operatorId: op1Id,
        scheduledAt: conflictStart,
        durationMinutes: 15,
        excludeActivityId: actConflictId,
      },
      "tecfag",
      "read",
    );
    expect(selfExcluded.isError).toBe(false);
    expect(selfExcluded.data.hasConflict).toBe(false);

    // Horário 2 horas depois está livre
    const freeStart = new Date(act!.dueDate!.getTime() + 120 * 60_000).toISOString();
    const free = await callTool(
      "check_operator_schedule_conflict",
      { operatorId: op1Id, scheduledAt: freeStart, durationMinutes: 15 },
      "tecfag",
      "read",
    );
    expect(free.isError).toBe(false);
    expect(free.data.hasConflict).toBe(false);
  });

  it("Item 13 (parcial): get_stage_queue ordena por tempo de espera real e marca SLA > 15 min", async () => {
    const q = await callTool(
      "get_stage_queue",
      { pipelineId: pipeId, stageId: st2Id, slaMinutes: 15 },
      "tecfag",
      "read",
    );
    expect(q.isError).toBe(false);
    expect(q.data.totalOpenInStage).toBe(2);
    expect(q.data.breachedCount).toBe(1);
    expect(q.data.withinSlaCount).toBe(1);
    expect(q.data.queue[0].dealId).toBe(dealOldId);
    expect(q.data.queue[0].stageEnteredSource).toBe("stage_changed_event");
    expect(q.data.queue[0].slaBreached).toBe(true);
    expect(q.data.queue[0].waitMinutes).toBeGreaterThanOrEqual(35);
    expect(q.data.queue[1].dealId).toBe(dealFreshId);
    expect(q.data.queue[1].slaBreached).toBe(false);

    const onlyBreached = await callTool(
      "get_stage_queue",
      { pipelineId: pipeId, stageId: st2Id, slaMinutes: 15, onlyBreached: true },
      "tecfag",
      "read",
    );
    expect(onlyBreached.isError).toBe(false);
    expect(onlyBreached.data.returnedCount).toBe(1);
    expect(onlyBreached.data.queue[0].dealId).toBe(dealOldId);
  });

  it("Item 3 (1-passo) + Item 17 (parcial): archive_crm_deal(detachConversations=true) preserva a conversa e get_deal_audit_log lê eventos e histórico administrativo", async () => {
    // 1. Consulta log de card existente
    const logRes = await callTool(
      "get_deal_audit_log",
      { dealId: dealOldId, order: "asc" },
      "tecfag",
      "read",
    );
    expect(logRes.isError).toBe(false);
    expect(logRes.data.dealExists).toBe(true);
    expect(logRes.data.totalEvents).toBe(2);
    expect(logRes.data.events[0].eventType).toBe("created");
    expect(logRes.data.events[1].eventType).toBe("stage_changed");
    expect(logRes.data.events[1].fromStageName).toBe(`QUALIFICANDO ${suffix}`);
    expect(logRes.data.events[1].toStageName).toBe(`ATENDER ${suffix}`);
    expect(logRes.data.events[1].operatorName).toBe(`Consultor Onda1 ${suffix}`);

    // 2. Exclusão definitiva em 1 passo com detachConversations=true preserva a conversa no chat
    const delRes = await callTool(
      "archive_crm_deal",
      {
        dealId: dealDetachId,
        reason: `Limpeza duplicado 1-passo ${suffix}`,
        mode: "delete_permanent",
        confirmPermanentDelete: true,
        detachConversations: true,
        operatorId: op1Id,
      },
      "tecfag",
      "read_write",
    );
    expect(delRes.isError).toBe(false);
    expect(delRes.data.deleted).toBe(true);
    expect(delRes.data.detachConversations).toBe(true);
    expect(delRes.data.conversationsPreserved).toBe(true);
    expect(delRes.data.detachedConversationIds).toEqual([convId]);

    // Conversa continua intacta no banco, contexto limpo e card apagado
    const [convStillExists] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.tenantId, tenantId), eq(conversations.id, convId)))
      .limit(1);
    expect(convStillExists?.id).toBe(convId);

    const [ctxAfter] = await db
      .select({ currentDealId: conversationDealContexts.currentDealId })
      .from(conversationDealContexts)
      .where(and(eq(conversationDealContexts.tenantId, tenantId), eq(conversationDealContexts.conversationId, convId)))
      .limit(1);
    expect(ctxAfter?.currentDealId).toBeNull();

    // 3. Mesmo após excluído, get_deal_audit_log encontra o registro administrativo em crm_action_history
    const deletedLog = await callTool(
      "get_deal_audit_log",
      { dealId: dealDetachId },
      "tecfag",
      "read",
    );
    expect(deletedLog.isError).toBe(false);
    expect(deletedLog.data.dealExists).toBe(false);
    expect(deletedLog.data.adminActionsCount).toBeGreaterThanOrEqual(1);
    expect(deletedLog.data.adminActions[0].action).toBe("delete_permanent");
    for (const a of deletedLog.data.adminActions) {
      createdActionIds.push(a.id);
    }
  });

  it("update_contact limpa walletOperatorId (null e '') gravando responsibleName='Na Fila' sem erro SQL e create_conversation cria/reabre o canal corporativo oficial mesmo quando existe conversa Baileys", async () => {
    // 1. Atribui carteira no contato 2
    const setWallet = await callTool(
      "update_contact",
      { contactId: contact2Id, walletOperatorId: op1Id },
      "tecfag",
      "read_write",
    );
    expect(setWallet.isError).toBe(false);
    expect(setWallet.data.walletOperatorId).toBe(op1Id);
    expect(setWallet.data.responsibleName).toBe(`Consultor Onda1 ${suffix}`);

    // 2. Limpa carteira com null -> não quebra NOT NULL em responsible_name
    const clearNull = await callTool(
      "update_contact",
      { contactId: contact2Id, walletOperatorId: null },
      "tecfag",
      "read_write",
    );
    expect(clearNull.isError).toBe(false);
    expect(clearNull.data.walletOperatorId).toBeNull();
    expect(clearNull.data.responsibleName).toBe("Na Fila");

    // 3. Limpa carteira com "" -> também retorna "Na Fila"
    const clearEmpty = await callTool(
      "update_contact",
      { contactId: contact2Id, walletOperatorId: "" },
      "tecfag",
      "read_write",
    );
    expect(clearEmpty.isError).toBe(false);
    expect(clearEmpty.data.walletOperatorId).toBeNull();
    expect(clearEmpty.data.responsibleName).toBe("Na Fila");

    // 4. Simula conversa existente de celular pessoal (Baileys, whatsappConnectionId != null) para contact2Id
    const baileysConnId = `conn-baileys-${suffix}`;
    const baileysConvId = `conv-baileys-${suffix}`;
    await db.insert(whatsappConnections).values({
      id: baileysConnId,
      tenantId,
      name: `Celular Vendedor ${suffix}`,
      provider: "baileys",
      ownerOperatorId: op1Id,
      enabled: true,
    });
    await db.insert(conversations).values({
      id: baileysConvId,
      tenantId,
      contactId: contact2Id,
      contactPhone: "5514999990002",
      whatsappConnectionId: baileysConnId,
      queueState: "meus",
      operatorId: op1Id,
      unreadCount: 0,
      lastMessageTime: new Date(),
    });

    try {
      // 5. create_conversation deve ignorar a conversa Baileys e criar uma nova no canal oficial (whatsappConnectionId = null)
      const createdOfficial = await callTool(
        "create_conversation",
        {
          contactId: contact2Id,
          queueState: "meus",
          operatorId: op1Id,
          reopenIfExists: true,
        },
        "tecfag",
        "read_write",
      );
      expect(createdOfficial.isError).toBe(false);
      expect(createdOfficial.data.reopened).toBe(false);
      expect(createdOfficial.data.conversationId).not.toBe(baileysConvId);
      expect(createdOfficial.data.whatsappConnectionId).toBeNull();
      expect(createdOfficial.data.isOfficialChannel).toBe(true);

      const officialConvId = createdOfficial.data.conversationId as string;

      // 6. Segunda chamada reutiliza/reabre a conversa do canal oficial (nunca a do Baileys)
      const reopenedOfficial = await callTool(
        "create_conversation",
        {
          contactId: contact2Id,
          queueState: "meus",
          operatorId: op1Id,
          reopenIfExists: true,
        },
        "tecfag",
        "read_write",
      );
      expect(reopenedOfficial.isError).toBe(false);
      expect(reopenedOfficial.data.reopened).toBe(true);
      expect(reopenedOfficial.data.conversationId).toBe(officialConvId);
      expect(reopenedOfficial.data.isOfficialChannel).toBe(true);

      await db
        .delete(conversations)
        .where(and(eq(conversations.tenantId, tenantId), eq(conversations.id, officialConvId)));
    } finally {
      await db
        .delete(conversations)
        .where(and(eq(conversations.tenantId, tenantId), eq(conversations.id, baileysConvId)));
      await db
        .delete(whatsappConnections)
        .where(and(eq(whatsappConnections.tenantId, tenantId), eq(whatsappConnections.id, baileysConnId)));
    }
  });
});
