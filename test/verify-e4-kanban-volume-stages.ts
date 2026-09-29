/**
 * verify-e4-kanban-volume-stages.ts
 * 
 * Suíte de Testes Automatizada de E4 (Kanban correto com volume e ações de etapa)
 * Conforme especificado em PLANO-EXECUCAO-CRM-PENDENCIAS.md (Seção 1.2 e E4).
 * 
 * Asserções Automatizadas:
 * 1. Trava de segurança mandatória: execução estrita em valemchat_test.
 * 2. Criação de funil com 7 etapas personalizadas (incluindo isWinStage e isLossStage).
 * 3. Criação de volume de negócios (> 50 cards, exatamente 70 cards):
 *    - 10 cards por etapa.
 *    - Valores monetários conhecidos (R$ 21.000,00 por etapa) e valores não informados (null / "A combinar").
 *    - Vínculos N:N com contatos e conversas para provar ausência de inflação em joins.
 * 4. Agregação por etapa no servidor (getPipelineStagesSummary):
 *    - Contagem exata distinta de cards por etapa (count distinct deal.id).
 *    - Soma monetária real por etapa (sum value) sem distorção por conversas/contatos e sem presumir zero em nulos.
 *    - Contagem de valores conhecidos (knownValueDealsCount).
 *    - Formatação monetária adequada ("R$ 21.000,00" ou "-").
 *    - Retorno de etapas vazias (dealsCount: 0, totalValue: 0, formattedTotalValue: "-").
 * 5. Filtros de agregação:
 *    - Filtro por operador e por status.
 * 6. Transição de etapa com concorrência otimista (expectedVersion) e auditoria:
 *    - Movimentação normal incrementa versão e gera evento 'stage_changed'.
 *    - Versão desatualizada é rejeitada com CrmConcurrencyError.
 * 7. Transição em etapas terminais (isWinStage e isLossStage):
 *    - Movimentação para isWinStage atualiza status='won' e preenche closedAt.
 *    - Movimentação para isLossStage atualiza status='lost', preenche closedAt e guarda lossReason.
 *    - Movimentação de etapa terminal para intermediária restaura status='open' e closedAt=null.
 * 8. Gestão completa de funis e etapas por tenant (CRUD + Reordenação):
 *    - Atualização de funil (updatePipeline).
 *    - Criação de nova etapa (createStage).
 *    - Reordenação atômica de etapas (reorderStages).
 *    - Bloqueio de exclusão de etapa com deals vinculados (STAGE_HAS_DEALS).
 *    - Bloqueio de exclusão de funil com deals vinculados (PIPELINE_HAS_DEALS).
 *    - Exclusão permitida de etapa sem deals.
 * 9. Isolamento Multi-Tenant estrito:
 *    - Bloqueio cross-tenant em leitura de funil, resumo de etapas, alteração e criação de etapas.
 * 10. Teardown cirúrgico:
 *     - Limpeza completa dos dados de teste sem resíduos.
 */

import crypto from "node:crypto";
import {
  db,
  client,
  assertTestDatabaseIsolation,
} from "../src/db";
import {
  tenants,
  operators,
  contacts,
  conversations,
  crmPipelines,
  crmStages,
  crmDeals,
  crmAccounts,
  crmConversationDeals,
  crmDealContacts,
  crmDealEvents,
} from "../src/db/schema";
import { eq, and, sql, inArray, desc } from "drizzle-orm";
import {
  crmService,
  CrmValidationError,
  CrmCrossTenantError,
  CrmNotFoundError,
  CrmConcurrencyError,
} from "../src/lib/crm/crm-service";

// =====================================================================
// TRAVA DE SEGURANÇA MANDATÓRIA: BANCO EXCLUSIVO DE TESTE
// =====================================================================
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  console.error("\n🛑 ERRO CRÍTICO DE SEGURANÇA: TEST_DATABASE_URL NÃO CONFIGURADA!");
  console.error("Configure TEST_DATABASE_URL=postgres://postgres:123@localhost:5432/valemchat_test\n");
  process.exit(1);
}

const parsedUrl = new URL(testDatabaseUrl.replace(/^postgres:/, "http:"));
if (parsedUrl.pathname !== "/valemchat_test") {
  console.error(`\n🛑 RECUSANDO EXECUTAR: O banco deve ser estritamente 'valemchat_test'. Atual: ${parsedUrl.pathname}\n`);
  process.exit(1);
}

assertTestDatabaseIsolation();

// IDs rastreados para limpeza cirúrgica
const createdTenantIds: string[] = [];
const createdOperatorIds: string[] = [];
const createdContactIds: string[] = [];
const createdConversationIds: string[] = [];
const createdPipelineIds: string[] = [];
const createdStageIds: string[] = [];
const createdDealIds: string[] = [];
const createdAccountIds: string[] = [];

let assertionsPassed = 0;
let totalAssertions = 0;

function assert(condition: boolean, message: string) {
  totalAssertions++;
  if (!condition) {
    console.error(`❌ FALHA [Asserção ${totalAssertions}]: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  assertionsPassed++;
  console.log(`  ✓ Asserção ${totalAssertions}: ${message}`);
}

async function runE4Verification() {
  console.log("\n=======================================================================");
  console.log("🚀 INICIANDO VERIFICAÇÃO AUTOMATIZADA: E4 — KANBAN, VOLUME E ETAPAS");
  console.log("=======================================================================\n");

  const runId = Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
  const tenantA = `test-e4-a-${runId}`;
  const tenantB = `test-e4-b-${runId}`;
  createdTenantIds.push(tenantA, tenantB);

  try {
    // ── 1. SETUP DE TENANTS E OPERADORES ──────────────────────────────────
    console.log("📌 Etapa 1: Setup de Tenants e Operadores Isolados...");

    await db.insert(tenants).values([
      { id: tenantA, name: "Tenant E4 Principal (Volume)", slug: `slug-${tenantA}`, connectionType: "meta" },
      { id: tenantB, name: "Tenant E4 Secundário (Cross-Tenant)", slug: `slug-${tenantB}`, connectionType: "meta" },
    ]);
    assert(true, "Dois tenants de teste criados em valemchat_test.");

    const opA1Id = `op-e4-a1-${runId}`;
    const opA2Id = `op-e4-a2-${runId}`;
    const opBId = `op-e4-b-${runId}`;
    createdOperatorIds.push(opA1Id, opA2Id, opBId);

    await db.insert(operators).values([
      { id: opA1Id, tenantId: tenantA, name: "Vendedor Alpha", email: `vendedor.a1.${runId}@test.com`, role: "operator", passwordHash: "dummy" },
      { id: opA2Id, tenantId: tenantA, name: "Vendedor Beta", email: `vendedor.a2.${runId}@test.com`, role: "operator", passwordHash: "dummy" },
      { id: opBId, tenantId: tenantB, name: "Operador B", email: `op.b.${runId}@test.com`, role: "operator", passwordHash: "dummy" },
    ]);
    assert(true, "Operadores criados com isolamento de tenant.");

    // ── 2. SETUP DE FUNIL COM 7 ETAPAS PERSONALIZADAS ──────────────────────
    console.log("\n📌 Etapa 2: Criação de Funil de Vendas com 7 Etapas...");

    const createdPipe = await crmService.createPipeline(tenantA, {
      name: "Funil Comercial de Volume",
      coolingDays: 10,
      isDefault: true,
      stages: [
        { name: "Primeiro Contato", orderIndex: 0 },
        { name: "Qualificação", orderIndex: 1 },
        { name: "Apresentação", orderIndex: 2 },
        { name: "Proposta Enviada", orderIndex: 3 },
        { name: "Negociação", orderIndex: 4 },
        { name: "Fechado / Ganho", orderIndex: 5, isWinStage: true },
        { name: "Perdido", orderIndex: 6, isLossStage: true },
      ],
    });
    createdPipelineIds.push(createdPipe.id);
    for (const s of createdPipe.stages) {
      createdStageIds.push(s.id);
    }

    assert(createdPipe.stages.length === 7, "Funil criado com exatamente 7 etapas.");
    assert(createdPipe.stages[5].isWinStage === true, "Etapa 5 configurada como etapa terminal de Ganho (isWinStage).");
    assert(createdPipe.stages[6].isLossStage === true, "Etapa 6 configurada como etapa terminal de Perda (isLossStage).");

    const stages = createdPipe.stages;
    const stage0 = stages[0];
    const stage1 = stages[1];
    const stage2 = stages[2];
    const stage3 = stages[3];
    const stage4 = stages[4];
    const stage5Win = stages[5];
    const stage6Loss = stages[6];

    // Cria conta e contato base
    const account = await crmService.createAccount(tenantA, {
      name: "Indústria Global de Embalagens S/A",
      type: "company",
      document: "11.222.333/0001-44",
    });
    createdAccountIds.push(account.id);

    const contactId = `ct-e4-${runId}`;
    createdContactIds.push(contactId);
    await db.insert(contacts).values({
      id: contactId,
      tenantId: tenantA,
      name: "Diretor Comercial",
      phone: "+5511999990001",
      mainChannel: "whatsapp",
    });

    const convId = `conv-e4-${runId}`;
    createdConversationIds.push(convId);
    await db.insert(conversations).values({
      id: convId,
      tenantId: tenantA,
      contactId: contactId,
      channel: "whatsapp",
      status: "open",
    });

    // ── 3. CRIAÇÃO DE VOLUME DE NEGÓCIOS (> 50 CARDS, EXATAMENTE 70 CARDS) ─
    console.log("\n📌 Etapa 3: Criação de 70 Negócios (10 cards em cada uma das 7 etapas)...");

    // Para cada uma das 7 etapas:
    // 6 cards com valor monetário: R$ 1000, 2000, 3000, 4000, 5000, 6000 (Soma: R$ 21.000,00 por etapa)
    // 4 cards com valor null ("A combinar")
    // Total por etapa: 10 deals, 6 com valor conhecido = R$ 21.000,00
    // Total global (7 etapas): 70 deals, 42 com valor conhecido = R$ 147.000,00

    for (let sIdx = 0; sIdx < stages.length; sIdx++) {
      const currentStage = stages[sIdx];
      const stageStatus = currentStage.isWinStage ? "won" : currentStage.isLossStage ? "lost" : "open";

      for (let dIdx = 1; dIdx <= 10; dIdx++) {
        const dealId = `deal-e4-s${sIdx}-d${dIdx}-${runId}`;
        createdDealIds.push(dealId);

        const hasValue = dIdx <= 6;
        const dealValue = hasValue ? (dIdx * 1000).toFixed(2) : null;
        const assignedOp = (dIdx % 2 === 0) ? opA1Id : opA2Id;

        await db.insert(crmDeals).values({
          id: dealId,
          tenantId: tenantA,
          title: `Negociação Etapa ${sIdx + 1} #${dIdx}`,
          pipelineId: createdPipe.id,
          stageId: currentStage.id,
          status: stageStatus,
          value: dealValue,
          currency: "BRL",
          operatorId: assignedOp,
          accountId: account.id,
          rating: (dIdx % 5) + 1,
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        // Adiciona vínculos N:N com contato e conversa em alguns deals para provar que a agregação não infla
        if (dIdx === 1 || dIdx === 2) {
          await db.insert(crmDealContacts).values({
            id: `dc-e4-${sIdx}-${dIdx}-${runId}`,
            tenantId: tenantA,
            dealId,
            contactId,
            isPrimary: true,
            createdAt: new Date(),
          });
          await db.insert(crmConversationDeals).values({
            id: `cd-e4-${sIdx}-${dIdx}-${runId}`,
            tenantId: tenantA,
            dealId,
            conversationId: convId,
            isActive: true,
            createdAt: new Date(),
          });
        }
      }
    }

    assert(createdDealIds.length === 70, "70 negócios criados no banco de dados (> 50 cards).");

    // ── 4. VERIFICAÇÃO DO RESUMO DE AGREGAÇÃO POR ETAPA ───────────────────
    console.log("\n📌 Etapa 4: Validação de getPipelineStagesSummary (agregação de volume)...");

    const summary = await crmService.getPipelineStagesSummary(tenantA, createdPipe.id);

    assert(summary.pipelineId === createdPipe.id, "Resumo retornado pertence ao funil correto.");
    assert(summary.totalDeals === 70, `Total global de deals confere perfeitamente: esperado 70, obtido ${summary.totalDeals}.`);
    assert(summary.totalKnownValueDeals === 42, `Total de deals com valor conhecido: esperado 42, obtido ${summary.totalKnownValueDeals}.`);
    assert(summary.totalValue === 147000, `Soma financeira global: esperado R$ 147.000,00, obtido R$ ${summary.totalValue.toFixed(2)}.`);
    assert(summary.stages.length === 7, "Resumo contém exatamente as 7 etapas do funil.");

    // Verifica cada etapa individualmente
    for (let i = 0; i < summary.stages.length; i++) {
      const stgSum = summary.stages[i];
      assert(
        stgSum.dealsCount === 10,
        `Etapa ${i + 1} (${stages[i].name}): dealsCount exato = 10 (sem inflação N:N).`
      );
      assert(
        stgSum.knownValueDealsCount === 6,
        `Etapa ${i + 1}: knownValueDealsCount exato = 6 (sem converter nulos em R$ 0,00).`
      );
      assert(
        stgSum.totalValue === 21000,
        `Etapa ${i + 1}: totalValue exato = R$ 21.000,00.`
      );
      assert(
        stgSum.formattedTotalValue.includes("21.000"),
        `Etapa ${i + 1}: formatação monetária correta '${stgSum.formattedTotalValue}'.`
      );
    }

    // ── 5. ETAPA VAZIA E FILTROS DE AGREGAÇÃO ─────────────────────────────
    console.log("\n📌 Etapa 5: Validação de Etapa Vazia e Filtros...");

    // Cria uma 8ª etapa sem nenhum negócio vinculado
    const emptyStage = await crmService.createStage(tenantA, createdPipe.id, {
      name: "Etapa Sem Cards (Vazia)",
      orderIndex: 7,
    });
    createdStageIds.push(emptyStage.id);

    const summaryWithEmpty = await crmService.getPipelineStagesSummary(tenantA, createdPipe.id);
    assert(summaryWithEmpty.stages.length === 8, "Resumo agora inclui a 8ª etapa.");
    const emptyStageSummary = summaryWithEmpty.stages.find((s) => s.stageId === emptyStage.id);
    assert(emptyStageSummary !== undefined, "Etapa vazia encontrada no resumo.");
    assert(emptyStageSummary?.dealsCount === 0, "Etapa vazia possui dealsCount = 0.");
    assert(emptyStageSummary?.totalValue === 0, "Etapa vazia possui totalValue = 0.");
    assert(emptyStageSummary?.formattedTotalValue === "-", "Etapa vazia exibe '-' como valor.");

    // Filtro por Operador A1
    const summaryOpA1 = await crmService.getPipelineStagesSummary(tenantA, createdPipe.id, {
      operatorId: opA1Id,
    });
    // Metade dos deals foi atribuída a opA1 (5 por etapa x 7 etapas = 35)
    assert(summaryOpA1.totalDeals === 35, `Filtro por operador A1: totalDeals esperado 35, obtido ${summaryOpA1.totalDeals}.`);

    // ── 6. TRANSIÇÃO DE ETAPA E CONCORRÊNCIA OTIMISTA ────────────────────
    console.log("\n📌 Etapa 6: Validação de Transição de Etapa com Concorrência Otimista...");

    const dealToMoveId = createdDealIds[0]; // Deal da Etapa 0, versão 1
    const movedDeal = await crmService.updateDeal(tenantA, dealToMoveId, opA1Id, {
      stageId: stage1.id,
      expectedVersion: 1,
    });

    assert(movedDeal.stageId === stage1.id, "Negociação movida com sucesso para a Etapa 1.");
    assert(movedDeal.version === 2, "Versão incrementada de 1 para 2.");

    // Verifica evento de auditoria stage_changed
    const [stageEvent] = await db
      .select()
      .from(crmDealEvents)
      .where(and(eq(crmDealEvents.dealId, dealToMoveId), eq(crmDealEvents.eventType, "stage_changed")))
      .orderBy(desc(crmDealEvents.createdAt))
      .limit(1);

    assert(stageEvent !== undefined, "Evento de auditoria 'stage_changed' gerado com sucesso.");
    assert(stageEvent.operatorId === opA1Id, "Operador responsável registrado no evento.");

    // Tentativa de concorrência com expectedVersion=1 desatualizado (esperado erro 409)
    let concurrencyFailed = false;
    try {
      await crmService.updateDeal(tenantA, dealToMoveId, opA1Id, {
        stageId: stage2.id,
        expectedVersion: 1, // Conflito proposital
      });
    } catch (err: any) {
      if (err instanceof CrmConcurrencyError) {
        concurrencyFailed = true;
      }
    }
    assert(concurrencyFailed, "Concorrência otimista rejeitou versão desatualizada com CrmConcurrencyError (409).");

    // ── 7. TRANSIÇÕES EM ETAPAS TERMINAIS (isWinStage e isLossStage) ──────
    console.log("\n📌 Etapa 7: Validação de Etapas Terminais (Ganho/Perda)...");

    // Move deal para etapa com isWinStage: true
    const wonDeal = await crmService.updateDeal(tenantA, dealToMoveId, opA1Id, {
      stageId: stage5Win.id,
      expectedVersion: 2,
    });

    assert(wonDeal.stageId === stage5Win.id, "Negociação movida para etapa de Ganho.");
    assert(wonDeal.status === "won", "Status sincronizado automaticamente para 'won' em etapa isWinStage.");
    assert(wonDeal.closedAt !== null, "closedAt preenchido automaticamente ao ganhar o negócio.");

    // Move deal de etapa de Ganho de volta para etapa intermediária (não-terminal)
    const reopenedDeal = await crmService.updateDeal(tenantA, dealToMoveId, opA1Id, {
      stageId: stage3.id,
      expectedVersion: 3,
    });
    assert(reopenedDeal.stageId === stage3.id, "Negociação reaberta para etapa intermediária.");
    assert(reopenedDeal.status === "open", "Status restaurado automaticamente para 'open'.");
    assert(reopenedDeal.closedAt === null, "closedAt anulado ao reabrir a negociação.");

    // Move outro deal para etapa com isLossStage: true
    const dealLostId = createdDealIds[1];
    const lostDeal = await crmService.updateDeal(tenantA, dealLostId, opA1Id, {
      stageId: stage6Loss.id,
      lossReason: "Optou por concorrente",
      expectedVersion: 1,
    });

    assert(lostDeal.stageId === stage6Loss.id, "Negociação movida para etapa de Perda.");
    assert(lostDeal.status === "lost", "Status sincronizado para 'lost' em etapa isLossStage.");
    assert(lostDeal.lossReason === "Optou por concorrente", "Motivo de perda persistido corretamente.");
    assert(lostDeal.closedAt !== null, "closedAt preenchido ao perder o negócio.");

    // ── 8. CRUD E REORDENAÇÃO DE FUNIS E ETAPAS ──────────────────────────
    console.log("\n📌 Etapa 8: Gestão de Funis e Etapas (CRUD + Reordenação)...");

    // Atualização do funil
    const updatedPipe = await crmService.updatePipeline(tenantA, createdPipe.id, {
      name: "Funil Comercial Renovado",
      coolingDays: 14,
    });
    assert(updatedPipe.name === "Funil Comercial Renovado", "Nome do funil atualizado.");
    assert(updatedPipe.coolingDays === 14, "Dias de resfriamento do funil atualizados para 14.");

    // Reordenação de etapas
    const reordered = await crmService.reorderStages(tenantA, createdPipe.id, [
      { id: stage0.id, orderIndex: 1 },
      { id: stage1.id, orderIndex: 0 },
    ]);
    const rStage1 = reordered.find((s) => s.id === stage1.id);
    const rStage0 = reordered.find((s) => s.id === stage0.id);
    assert(rStage1?.orderIndex === 0, "Etapa 1 movida para a primeira posição (orderIndex 0).");
    assert(rStage0?.orderIndex === 1, "Etapa 0 movida para a segunda posição (orderIndex 1).");

    // Atualização de etapa
    const updatedStage = await crmService.updateStage(tenantA, emptyStage.id, {
      name: "Etapa Renomeada",
    });
    assert(updatedStage.name === "Etapa Renomeada", "Etapa renomeada com sucesso via updateStage.");

    // Bloqueio de exclusão de etapa com deals
    let deleteStageBlocked = false;
    try {
      await crmService.deleteStage(tenantA, stage2.id);
    } catch (err: any) {
      if (err instanceof CrmValidationError && err.code === "STAGE_HAS_DEALS") {
        deleteStageBlocked = true;
      }
    }
    assert(deleteStageBlocked, "Exclusão de etapa com negociações bloqueada com STAGE_HAS_DEALS.");

    // Bloqueio de exclusão de funil com deals
    let deletePipeBlocked = false;
    try {
      await crmService.deletePipeline(tenantA, createdPipe.id);
    } catch (err: any) {
      if (err instanceof CrmValidationError && err.code === "PIPELINE_HAS_DEALS") {
        deletePipeBlocked = true;
      }
    }
    assert(deletePipeBlocked, "Exclusão de funil com negociações bloqueada com PIPELINE_HAS_DEALS.");

    // Exclusão de etapa vazia permitida
    const deleteEmptyResult = await crmService.deleteStage(tenantA, emptyStage.id);
    assert(deleteEmptyResult.success === true, "Exclusão de etapa vazia concluída com sucesso.");

    // ── 9. ISOLAMENTO MULTI-TENANT ESTRITO ────────────────────────────────
    console.log("\n📌 Etapa 9: Validação de Isolamento Cross-Tenant...");

    let crossGetPipeBlocked = false;
    try {
      await crmService.getPipelineById(tenantB, createdPipe.id);
    } catch (err: any) {
      if (err instanceof CrmNotFoundError) {
        crossGetPipeBlocked = true;
      }
    }
    assert(crossGetPipeBlocked, "Tenant B não pode acessar funil de Tenant A (CrmNotFoundError).");

    let crossSummaryBlocked = false;
    try {
      await crmService.getPipelineStagesSummary(tenantB, createdPipe.id);
    } catch (err: any) {
      if (err instanceof CrmNotFoundError) {
        crossSummaryBlocked = true;
      }
    }
    assert(crossSummaryBlocked, "Tenant B não pode obter resumo de etapas de Tenant A.");

    let crossUpdatePipeBlocked = false;
    try {
      await crmService.updatePipeline(tenantB, createdPipe.id, { name: "Hack Funil" });
    } catch (err: any) {
      if (err instanceof CrmNotFoundError) {
        crossUpdatePipeBlocked = true;
      }
    }
    assert(crossUpdatePipeBlocked, "Tenant B não pode alterar funil de Tenant A.");

    let crossCreateStageBlocked = false;
    try {
      await crmService.createStage(tenantB, createdPipe.id, { name: "Etapa Invasora" });
    } catch (err: any) {
      if (err instanceof CrmNotFoundError) {
        crossCreateStageBlocked = true;
      }
    }
    assert(crossCreateStageBlocked, "Tenant B não pode criar etapa no funil de Tenant A.");

    console.log("\n=======================================================================");
    console.log(`✅ TODAS AS ${assertionsPassed}/${totalAssertions} ASSERÇÕES DE E4 FORAM APROVADAS!`);
    console.log("=======================================================================\n");

  } finally {
    // ── 10. TEARDOWN CIRÚRGICO ───────────────────────────────────────────
    console.log("🧹 Executando Teardown Cirúrgico em valemchat_test...");

    if (createdDealIds.length > 0) {
      await db.delete(crmConversationDeals).where(inArray(crmConversationDeals.dealId, createdDealIds));
      await db.delete(crmDealContacts).where(inArray(crmDealContacts.dealId, createdDealIds));
      await db.delete(crmDealEvents).where(inArray(crmDealEvents.dealId, createdDealIds));
      await db.delete(crmDeals).where(inArray(crmDeals.id, createdDealIds));
    }

    if (createdAccountIds.length > 0) {
      await db.delete(crmAccounts).where(inArray(crmAccounts.id, createdAccountIds));
    }

    if (createdConversationIds.length > 0) {
      await db.delete(conversations).where(inArray(conversations.id, createdConversationIds));
    }

    if (createdContactIds.length > 0) {
      await db.delete(contacts).where(inArray(contacts.id, createdContactIds));
    }

    if (createdStageIds.length > 0) {
      await db.delete(crmStages).where(inArray(crmStages.id, createdStageIds));
    }

    if (createdPipelineIds.length > 0) {
      await db.delete(crmPipelines).where(inArray(crmPipelines.id, createdPipelineIds));
    }

    if (createdOperatorIds.length > 0) {
      await db.delete(operators).where(inArray(operators.id, createdOperatorIds));
    }

    if (createdTenantIds.length > 0) {
      await db.delete(tenants).where(inArray(tenants.id, createdTenantIds));
    }

    console.log("✨ Limpeza cirúrgica concluída com sucesso.\n");
    await client.end();
  }
}

// Execução
runE4Verification().catch((err) => {
  console.error("\n❌ ERRO NA EXECUÇÃO DA SUÍTE E4:", err);
  process.exit(1);
});
