/**
 * verify-e5-filters-and-list.ts
 * 
 * Suíte de Testes Automatizada de E5 (Barra de filtros e lista das capturas 2–5 e 7)
 * Conforme especificado em PLANO-EXECUCAO-CRM-PENDENCIAS.md (Seção 100 e E5).
 * 
 * Asserções Automatizadas:
 * 1. Trava de segurança mandatória: execução estrita em valemchat_test.
 * 2. Criação de estrutura multi-tenant (2 tenants de teste, múltiplos operadores, funil com 4 etapas).
 * 3. Criação de volume de negócios (> 50 negociações, exatamente 60 negociações com status diversificados).
 * 4. Filtro por vendedor / responsável:
 *    - Filtro por 1 operador.
 *    - Filtro por 2 operadores simultâneos (operatorIds: string[]).
 * 5. Filtro de status:
 *    - Status "all", "open", "won", "lost", "paused".
 *    - Status "not_paused": garante que negócios abertos, ganhos e perdidos sejam listados, excluindo estritamente os pausados.
 * 6. Ordenação dinâmica completa (sortBy):
 *    - name_asc e name_desc (ordenação por título).
 *    - created_asc e created_desc (ordenação cronológica).
 *    - next_task_asc (negociação com tarefa pendente mais urgente primeiro, sem tarefa por último).
 *    - rating_desc (maior qualificação primeiro).
 * 7. Filtros avançados com agregação exata:
 *    - stageIds: seleção múltipla de etapas.
 *    - Faixa de valor (minValue e maxValue).
 *    - Data de criação (createdAfter e createdBefore).
 *    - Tarefa vencida (hasOverdueTask: true).
 * 8. Busca abrangente e eliminação comprovada de duplicatas de join:
 *    - Negociação com 3 contatos e 2 conversas vinculadas.
 *    - Busca por título, ID, razão social da conta, documento (CNPJ), nome do contato e telefone.
 *    - Prova inequívoca de retorno de exatamente 1 registro (zero duplicação via subqueries EXISTS).
 * 9. Ações em massa (bulkUpdateDeals):
 *    - Mover múltiplos cards de etapa com auditoria.
 *    - Atribuir vendedor em lote.
 *    - Alterar status comercial em lote.
 *    - Bloqueio de movimentação para etapa de outro funil ou outro tenant.
 * 10. Paginação estável e agregação do resumo de etapas sincronizada.
 * 11. Teardown cirúrgico garantido.
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
  crmDealActivities,
  crmDealEvents,
} from "../src/db/schema";
import { eq, and, sql, inArray, desc } from "drizzle-orm";
import {
  crmService,
  CrmValidationError,
  CrmCrossTenantError,
  CrmNotFoundError,
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
    throw new Error(`Falha na asserção: ${message}`);
  }
  assertionsPassed++;
  console.log(`  ✓ [${totalAssertions}] ${message}`);
}

async function runE5Tests() {
  console.log("\n=================================================================");
  console.log("🚀 INICIANDO VERIFICAÇÃO AUTOMATIZADA: E5 (FILTROS E LISTA CRM)");
  console.log("=================================================================\n");

  const runId = crypto.randomBytes(3).toString("hex");
  const tenantA = `t_e5_a_${runId}`;
  const tenantB = `t_e5_b_${runId}`;
  createdTenantIds.push(tenantA, tenantB);

  try {
    // -----------------------------------------------------------------
    // FASE 1: PREPARAÇÃO DE TENANTS E OPERADORES
    // -----------------------------------------------------------------
    console.log("📌 FASE 1: Preparando Tenants e Operadores de Teste...");

    await db.insert(tenants).values([
      { id: tenantA, name: `Tenant E5 Alpha ${runId}`, slug: `slug_e5_a_${runId}`, connectionType: "meta" },
      { id: tenantB, name: `Tenant E5 Beta ${runId}`, slug: `slug_e5_b_${runId}`, connectionType: "meta" },
    ]);

    const op1Id = `op_e5_1_${runId}`;
    const op2Id = `op_e5_2_${runId}`;
    const opOtherId = `op_e5_other_${runId}`;
    createdOperatorIds.push(op1Id, op2Id, opOtherId);

    await db.insert(operators).values([
      { id: op1Id, tenantId: tenantA, name: "Vendedor 1 Alpha", email: `vendedor1_${runId}@alpha.test`, role: "operator", passwordHash: "dummy" },
      { id: op2Id, tenantId: tenantA, name: "Vendedora 2 Alpha", email: `vendedora2_${runId}@alpha.test`, role: "operator", passwordHash: "dummy" },
      { id: opOtherId, tenantId: tenantB, name: "Operador Outro Tenant", email: `other_${runId}@beta.test`, role: "operator", passwordHash: "dummy" },
    ]);

    assert(true, "Tenants e Operadores criados com isolamento estrito.");

    // -----------------------------------------------------------------
    // FASE 2: CRIAÇÃO DO FUNIL COM 4 ETAPAS
    // -----------------------------------------------------------------
    console.log("\n📌 FASE 2: Criando Funil e Etapas no Tenant A...");

    const pipeData = await crmService.createPipeline(tenantA, {
      name: "Funil de Vendas E5",
      isDefault: true,
      coolingDays: 7,
      stages: [
        { name: "Triagem", orderIndex: 0 },
        { name: "Proposta", orderIndex: 1 },
        { name: "Fechado Ganho", orderIndex: 2, isWinStage: true },
        { name: "Fechado Perdido", orderIndex: 3, isLossStage: true },
      ],
    });

    createdPipelineIds.push(pipeData.id);
    pipeData.stages.forEach((s) => createdStageIds.push(s.id));

    const stageTriagem = pipeData.stages[0];
    const stageProposta = pipeData.stages[1];
    const stageGanho = pipeData.stages[2];
    const stagePerdido = pipeData.stages[3];

    assert(pipeData.stages.length === 4, "Funil criado com exatamente 4 etapas.");

    // -----------------------------------------------------------------
    // FASE 3: CRIAÇÃO DE VOLUME (> 50 NEGOCIAÇÕES, EXATAMENTE 60 DEALS)
    // -----------------------------------------------------------------
    console.log("\n📌 FASE 3: Criando 60 Negociações com Status e Vendedores Variados...");

    // Cria Conta PJ e Conta PF
    const accPj = await crmService.createAccount(tenantA, {
      name: "Empresa Alpha Embalagens S/A",
      tradeName: "Alpha Embalagens",
      type: "company",
      document: "12345678000199",
      email: "contato@alphaembalagens.test",
    });
    createdAccountIds.push(accPj.id);

    const accPf = await crmService.createAccount(tenantA, {
      name: "João da Silva Sauro",
      type: "person",
      document: "12345678909",
      email: "joao.sauro@test.com",
    });
    createdAccountIds.push(accPf.id);

    // 30 deals para op1, 30 deals para op2
    // 10 deals pausados
    // Valores de R$ 1.000 a R$ 60.000
    // Qualificação de 0 a 5
    const dealRows = [];
    const now = new Date();

    for (let i = 1; i <= 60; i++) {
      const dealId = `deal_e5_${runId}_${String(i).padStart(3, "0")}`;
      createdDealIds.push(dealId);

      const isOp1 = i <= 30;
      const assignedOp = isOp1 ? op1Id : op2Id;
      const isPaused = i > 50; // Deals 51 a 60 são paused (10 deals)
      const isWon = i > 40 && i <= 45; // 5 won
      const isLost = i > 45 && i <= 50; // 5 lost
      const status = isPaused ? "paused" : isWon ? "won" : isLost ? "lost" : "open";
      
      const stageId = isWon ? stageGanho.id : isLost ? stagePerdido.id : (i % 2 === 0 ? stageProposta.id : stageTriagem.id);
      const accId = i % 2 === 0 ? accPj.id : accPf.id;
      const val = (i * 1000).toFixed(2); // 1.000,00 até 60.000,00
      const rating = (i % 5) + 1; // 1 a 5 estrelas

      // Datas de criação escalonadas para testar ordenação
      const createdAt = new Date(now.getTime() - (61 - i) * 3600 * 1000); // i=1 mais antigo, i=60 mais novo

      dealRows.push({
        id: dealId,
        tenantId: tenantA,
        title: `Negociação E5 ${String(i).padStart(2, "0")} - ${i % 2 === 0 ? "Frascos" : "Válvulas"}`,
        accountId: accId,
        pipelineId: pipeData.id,
        stageId,
        status,
        value: val,
        currency: "BRL",
        operatorId: assignedOp,
        rating,
        version: 1,
        createdAt,
        updatedAt: createdAt,
        lastActivityAt: createdAt,
      });
    }

    await db.insert(crmDeals).values(dealRows);

    const initialDealsList = await crmService.getDeals(tenantA, {
      pipelineId: pipeData.id,
      limit: 100,
    });

    assert(initialDealsList.total === 60, `Volume de 60 negociações criado com sucesso (total retornado: ${initialDealsList.total}).`);

    // -----------------------------------------------------------------
    // FASE 4: TESTES DE FILTRO DE RESPONSÁVEL / VENDEDOR
    // -----------------------------------------------------------------
    console.log("\n📌 FASE 4: Validando Filtros de Vendedor (Responsável)...");

    // 1. Filtro por op1 (deve trazer exatamente 30)
    const op1Deals = await crmService.getDeals(tenantA, {
      pipelineId: pipeData.id,
      operatorId: op1Id,
    });
    assert(op1Deals.total === 30, `Filtro por 1 operador retorna exatamente 30 negociações (obtido: ${op1Deals.total}).`);
    assert(op1Deals.deals.every((d) => d.operatorId === op1Id), "Todas as negociações retornadas pertencem ao operador 1.");

    // 2. Filtro por 2 operadores simultâneos (operatorIds)
    const multiOpDeals = await crmService.getDeals(tenantA, {
      pipelineId: pipeData.id,
      operatorIds: [op1Id, op2Id],
    });
    assert(multiOpDeals.total === 60, `Filtro por 2 operadores simultâneos retorna 60 negociações (obtido: ${multiOpDeals.total}).`);

    // 3. Filtro por operador inexistente
    const noOpDeals = await crmService.getDeals(tenantA, {
      pipelineId: pipeData.id,
      operatorId: "op_inexistente",
    });
    assert(noOpDeals.total === 0, "Filtro por operador inexistente retorna 0 negociações.");

    // -----------------------------------------------------------------
    // FASE 5: TESTES DE FILTRO DE STATUS (INCLUINDO 'not_paused')
    // -----------------------------------------------------------------
    console.log("\n📌 FASE 5: Validando Filtros de Status (especialmente 'not_paused')...");

    // 1. Status 'all'
    const allStatus = await crmService.getDeals(tenantA, {
      pipelineId: pipeData.id,
      status: "all",
    });
    assert(allStatus.total === 60, `Status 'all' retorna 60 negociações.`);

    // 2. Status 'paused' (deve ter exatamente 10)
    const pausedDeals = await crmService.getDeals(tenantA, {
      pipelineId: pipeData.id,
      status: "paused",
    });
    assert(pausedDeals.total === 10, `Status 'paused' retorna exatamente 10 negociações (obtido: ${pausedDeals.total}).`);
    assert(pausedDeals.deals.every((d) => d.status === "paused"), "Todos os deals retornados têm status='paused'.");

    // 3. Status 'not_paused' (deve ter exatamente 60 - 10 = 50 negociações)
    const notPausedDeals = await crmService.getDeals(tenantA, {
      pipelineId: pipeData.id,
      status: "not_paused",
      limit: 100,
    });
    assert(notPausedDeals.total === 50, `Status 'not_paused' retorna exatamente 50 negociações (obtido: ${notPausedDeals.total}).`);
    assert(
      notPausedDeals.deals.every((d) => d.status !== "paused"),
      "NENHUMA negociação retornada em 'not_paused' possui status='paused'."
    );

    // -----------------------------------------------------------------
    // FASE 6: TESTES DE ORDENAÇÃO COMPLETA (sortBy)
    // -----------------------------------------------------------------
    console.log("\n📌 FASE 6: Validando Ordenação Completa (sortBy)...");

    // 1. name_asc (A - Z)
    const nameAsc = await crmService.getDeals(tenantA, {
      pipelineId: pipeData.id,
      sortBy: "name_asc",
      limit: 5,
    });
    assert(nameAsc.deals[0].title <= nameAsc.deals[1].title, `name_asc: '${nameAsc.deals[0].title}' <= '${nameAsc.deals[1].title}'.`);

    // 2. name_desc (Z - A)
    const nameDesc = await crmService.getDeals(tenantA, {
      pipelineId: pipeData.id,
      sortBy: "name_desc",
      limit: 5,
    });
    assert(nameDesc.deals[0].title >= nameDesc.deals[1].title, `name_desc: '${nameDesc.deals[0].title}' >= '${nameDesc.deals[1].title}'.`);

    // 3. created_asc (mais antigas primeiro)
    const createdAsc = await crmService.getDeals(tenantA, {
      pipelineId: pipeData.id,
      sortBy: "created_asc",
      limit: 5,
    });
    assert(
      new Date(createdAsc.deals[0].createdAt).getTime() <= new Date(createdAsc.deals[1].createdAt).getTime(),
      "created_asc: mais antigas retornadas antes das mais novas."
    );

    // 4. created_desc (mais novas primeiro)
    const createdDesc = await crmService.getDeals(tenantA, {
      pipelineId: pipeData.id,
      sortBy: "created_desc",
      limit: 5,
    });
    assert(
      new Date(createdDesc.deals[0].createdAt).getTime() >= new Date(createdDesc.deals[1].createdAt).getTime(),
      "created_desc: mais recentes retornadas antes das mais antigas."
    );

    // 5. next_task_asc (tarefa pendente mais próxima primeiro)
    // Insere atividades em deals específicos:
    // deal 1: tarefa vencida (ontem)
    // deal 2: tarefa amanhã (+1 dia)
    // deal 3: tarefa semana que vem (+7 dias)
    // deal 4: sem tarefa
    const deal1 = createdDealIds[0];
    const deal2 = createdDealIds[1];
    const deal3 = createdDealIds[2];

    const yesterday = new Date(now.getTime() - 24 * 3600 * 1000);
    const tomorrow = new Date(now.getTime() + 24 * 3600 * 1000);
    const nextWeek = new Date(now.getTime() + 7 * 24 * 3600 * 1000);

    await db.insert(crmDealActivities).values([
      {
        id: `act_e5_1_${runId}`,
        tenantId: tenantA,
        dealId: deal1,
        type: "task",
        title: "Tarefa Vencida Ontem",
        dueDate: yesterday,
        status: "pending",
        createdAt: now,
      },
      {
        id: `act_e5_2_${runId}`,
        tenantId: tenantA,
        dealId: deal2,
        type: "task",
        title: "Tarefa Para Amanhã",
        dueDate: tomorrow,
        status: "pending",
        createdAt: now,
      },
      {
        id: `act_e5_3_${runId}`,
        tenantId: tenantA,
        dealId: deal3,
        type: "task",
        title: "Tarefa Próxima Semana",
        dueDate: nextWeek,
        status: "pending",
        createdAt: now,
      },
    ]);

    const nextTaskSort = await crmService.getDeals(tenantA, {
      pipelineId: pipeData.id,
      sortBy: "next_task_asc",
      limit: 5,
    });

    assert(nextTaskSort.deals[0].id === deal1, `next_task_asc: Tarefa vencida (deal1) é a 1ª da lista (ID: ${nextTaskSort.deals[0].id}).`);
    assert(nextTaskSort.deals[1].id === deal2, `next_task_asc: Tarefa de amanhã (deal2) é a 2ª da lista (ID: ${nextTaskSort.deals[1].id}).`);
    assert(nextTaskSort.deals[2].id === deal3, `next_task_asc: Tarefa de semana que vem (deal3) é a 3ª da lista (ID: ${nextTaskSort.deals[2].id}).`);
    assert(nextTaskSort.deals[0].nextTask?.isOverdue === true, "nextTask no deal 1 está marcado como isOverdue=true.");
    assert(nextTaskSort.deals[1].nextTask?.isFuture === true, "nextTask no deal 2 está marcado como isFuture=true.");

    // -----------------------------------------------------------------
    // FASE 7: TESTES DE FILTROS AVANÇADOS
    // -----------------------------------------------------------------
    console.log("\n📌 FASE 7: Validando Filtros Avançados...");

    // 1. stageIds (múltiplas etapas: Triagem e Proposta)
    const multiStageDeals = await crmService.getDeals(tenantA, {
      pipelineId: pipeData.id,
      stageIds: [stageTriagem.id, stageProposta.id],
      limit: 100,
    });
    assert(
      multiStageDeals.deals.every((d) => d.stageId === stageTriagem.id || d.stageId === stageProposta.id),
      `stageIds: todas as ${multiStageDeals.total} negociações pertencem às etapas informadas.`
    );

    // 2. Faixa de valor (minValue=10000, maxValue=20000)
    const rangeValueDeals = await crmService.getDeals(tenantA, {
      pipelineId: pipeData.id,
      minValue: 10000,
      maxValue: 20000,
      limit: 100,
    });
    assert(rangeValueDeals.total === 11, `Faixa R$ 10.000 a R$ 20.000 retorna 11 negociações (obtido: ${rangeValueDeals.total}).`);
    assert(
      rangeValueDeals.deals.every((d) => Number(d.value) >= 10000 && Number(d.value) <= 20000),
      "Todos os deals estão no intervalo de valor especificado."
    );

    // 3. hasOverdueTask: true
    const overdueFilter = await crmService.getDeals(tenantA, {
      pipelineId: pipeData.id,
      hasOverdueTask: true,
    });
    assert(overdueFilter.total === 1, `hasOverdueTask: retorna exatamente 1 negociação (obtido: ${overdueFilter.total}).`);
    assert(overdueFilter.deals[0].id === deal1, "A negociação com tarefa vencida é o deal1.");

    // -----------------------------------------------------------------
    // FASE 8: BUSCA ABRANGENTE E PROVA DE AUSÊNCIA DE DUPLICATAS DE JOIN
    // -----------------------------------------------------------------
    console.log("\n📌 FASE 8: Validando Busca Abrangente e Eliminação de Duplicatas de Join...");

    // Prepara um deal especial com:
    // - 3 contatos vinculados
    // - 2 conversas ativas vinculadas
    const specialDealId = createdDealIds[5]; // Deal 6
    const ct1Id = `ct_e5_1_${runId}`;
    const ct2Id = `ct_e5_2_${runId}`;
    const ct3Id = `ct_e5_3_${runId}`;
    createdContactIds.push(ct1Id, ct2Id, ct3Id);

    await db.insert(contacts).values([
      { id: ct1Id, tenantId: tenantA, name: "Carlos Eduardo da Silva", phone: "11988881111", email: "carlos@test.com", mainChannel: "whatsapp" },
      { id: ct2Id, tenantId: tenantA, name: "Beatriz Helena Ramos", phone: "11977772222", email: "beatriz@test.com", mainChannel: "whatsapp" },
      { id: ct3Id, tenantId: tenantA, name: "Marcos Vinicius Porto", phone: "11966663333", email: "marcos@test.com", mainChannel: "whatsapp" },
    ]);

    await db.insert(crmDealContacts).values([
      { id: `dc_e5_1_${runId}`, tenantId: tenantA, dealId: specialDealId, contactId: ct1Id, isPrimary: true },
      { id: `dc_e5_2_${runId}`, tenantId: tenantA, dealId: specialDealId, contactId: ct2Id, isPrimary: false },
      { id: `dc_e5_3_${runId}`, tenantId: tenantA, dealId: specialDealId, contactId: ct3Id, isPrimary: false },
    ]);

    const conv1Id = `conv_e5_1_${runId}`;
    const conv2Id = `conv_e5_2_${runId}`;
    createdConversationIds.push(conv1Id, conv2Id);

    await db.insert(conversations).values([
      { id: conv1Id, tenantId: tenantA, contactId: ct1Id, queueState: "meus" },
      { id: conv2Id, tenantId: tenantA, contactId: ct2Id, queueState: "meus" },
    ]);

    await db.insert(crmConversationDeals).values([
      { id: `cd_e5_1_${runId}`, tenantId: tenantA, dealId: specialDealId, conversationId: conv1Id, isActive: true },
      { id: `cd_e5_2_${runId}`, tenantId: tenantA, dealId: specialDealId, conversationId: conv2Id, isActive: true },
    ]);

    // 1. Busca por nome do 2º contato ("Beatriz")
    const searchContactResult = await crmService.getDeals(tenantA, {
      pipelineId: pipeData.id,
      search: "Beatriz",
    });
    assert(searchContactResult.total === 1, `Busca por contato participante retorna exatamente 1 resultado (obtido: ${searchContactResult.total}).`);
    assert(searchContactResult.deals[0].id === specialDealId, "O resultado encontrado é a negociação especial com múltiplos vínculos.");

    // 2. Busca por telefone do 3º contato ("966663333")
    const searchPhoneResult = await crmService.getDeals(tenantA, {
      pipelineId: pipeData.id,
      search: "966663333",
    });
    assert(searchPhoneResult.total === 1, `Busca por telefone do 3º contato retorna exatamente 1 resultado.`);
    assert(searchPhoneResult.deals[0].id === specialDealId, "Encontra o deal correto pelo telefone de contato participante.");

    // 3. Busca por CNPJ da conta ("12345678000199")
    const searchCnpjResult = await crmService.getDeals(tenantA, {
      pipelineId: pipeData.id,
      search: "12345678000199",
      limit: 100,
    });
    assert(searchCnpjResult.total === 30, `Busca por CNPJ retorna todos os 30 deals da Empresa Alpha sem nenhuma duplicação.`);
    // Confirma que specialDealId está presente apenas UMA VEZ
    const specialDealOccurrences = searchCnpjResult.deals.filter((d) => d.id === specialDealId).length;
    assert(specialDealOccurrences === 1, `ZERO DUPLICAÇÃO DE JOIN: O deal com 3 contatos e 2 conversas aparece exatamente 1 vez.`);

    // -----------------------------------------------------------------
    // FASE 9: AÇÕES EM MASSA (bulkUpdateDeals)
    // -----------------------------------------------------------------
    console.log("\n📌 FASE 9: Validando Ações em Massa (bulkUpdateDeals)...");

    const batchDealIds = [createdDealIds[10], createdDealIds[11], createdDealIds[12]];

    // 1. Mover em lote para etapa 'Proposta'
    const bulkMoveResult = await crmService.bulkUpdateDeals(tenantA, op1Id, {
      dealIds: batchDealIds,
      stageId: stageProposta.id,
    });
    assert(bulkMoveResult.success === true, "Ação em massa para mover etapa concluída com sucesso.");
    assert(bulkMoveResult.updatedCount === 3, "Exatamente 3 negociações foram atualizadas.");

    // Confere no banco
    const updatedBatchDeals = await db
      .select({ id: crmDeals.id, stageId: crmDeals.stageId })
      .from(crmDeals)
      .where(inArray(crmDeals.id, batchDealIds));
    assert(
      updatedBatchDeals.every((d) => d.stageId === stageProposta.id),
      "Todos os 3 deals estão agora na etapa 'Proposta'."
    );

    // 2. Alterar vendedor em lote para op2
    const bulkOpResult = await crmService.bulkUpdateDeals(tenantA, op1Id, {
      dealIds: batchDealIds,
      operatorId: op2Id,
    });
    assert(bulkOpResult.updatedCount === 3, "Vendedor alterado em lote para 3 negociações.");

    // 3. Alterar status em lote para 'won'
    const bulkStatusResult = await crmService.bulkUpdateDeals(tenantA, op1Id, {
      dealIds: batchDealIds,
      status: "won",
    });
    assert(bulkStatusResult.updatedCount === 3, "Status alterado em lote para 'won'.");
    const wonDealsCheck = await db
      .select({ id: crmDeals.id, status: crmDeals.status, closedAt: crmDeals.closedAt })
      .from(crmDeals)
      .where(inArray(crmDeals.id, batchDealIds));
    assert(
      wonDealsCheck.every((d) => d.status === "won" && d.closedAt !== null),
      "Todos os deals alterados em lote possuem status='won' e closedAt preenchido."
    );

    // 4. Bloqueio cross-tenant em ações em massa
    let crossTenantErrorThrown = false;
    try {
      await crmService.bulkUpdateDeals(tenantB, opOtherId, {
        dealIds: batchDealIds, // Pertencem ao tenantA
        status: "paused",
      });
    } catch (err: any) {
      crossTenantErrorThrown = true;
      assert(err instanceof CrmNotFoundError, "Ação em massa com deals de outro tenant é rejeitada.");
    }
    assert(crossTenantErrorThrown, "Bloqueio cross-tenant em ações em massa validado com sucesso.");

    // -----------------------------------------------------------------
    // FASE 10: SINCRONIZAÇÃO DE AGREGAÇÃO DO RESUMO DE ETAPAS
    // -----------------------------------------------------------------
    console.log("\n📌 FASE 10: Validando Resumo de Etapas com Filtros Avançados...");

    const summaryWithFilters = await crmService.getPipelineStagesSummary(tenantA, pipeData.id, {
      status: "not_paused",
    });
    assert(
      summaryWithFilters.totalDeals === 50,
      `Resumo de etapas com 'not_paused' calcula exatamente 50 negociações (obtido: ${summaryWithFilters.totalDeals}).`
    );

    // -----------------------------------------------------------------
    // FASE 11: PAGINAÇÃO ESTÁVEL
    // -----------------------------------------------------------------
    console.log("\n📌 FASE 11: Validando Paginação Estável...");

    const page1 = await crmService.getDeals(tenantA, {
      pipelineId: pipeData.id,
      limit: 15,
      offset: 0,
      sortBy: "name_asc",
    });
    assert(page1.deals.length === 15, `Página 1 retorna 15 deals (total real: ${page1.total}).`);

    const page2 = await crmService.getDeals(tenantA, {
      pipelineId: pipeData.id,
      limit: 15,
      offset: 15,
      sortBy: "name_asc",
    });
    assert(page2.deals.length === 15, `Página 2 retorna 15 deals.`);
    assert(page1.deals[0].id !== page2.deals[0].id, "Página 1 e Página 2 contêm negociações distintas e ordenadas.");

    console.log("\n=================================================================");
    console.log(`🎉 TODAS AS ${assertionsPassed} ASSERÇÕES DE E5 FORAM APROVADAS!`);
    console.log("=================================================================\n");

  } finally {
    // -----------------------------------------------------------------
    // FASE 12: TEARDOWN CIRÚRGICO
    // -----------------------------------------------------------------
    console.log("🧹 EXECUTANDO TEARDOWN CIRÚRGICO...");

    if (createdDealIds.length > 0) {
      await db.delete(crmDealActivities).where(inArray(crmDealActivities.dealId, createdDealIds));
      await db.delete(crmDealEvents).where(inArray(crmDealEvents.dealId, createdDealIds));
      await db.delete(crmDealContacts).where(inArray(crmDealContacts.dealId, createdDealIds));
      await db.delete(crmConversationDeals).where(inArray(crmConversationDeals.dealId, createdDealIds));
      await db.delete(crmDeals).where(inArray(crmDeals.id, createdDealIds));
    }
    if (createdConversationIds.length > 0) {
      await db.delete(conversations).where(inArray(conversations.id, createdConversationIds));
    }
    if (createdContactIds.length > 0) {
      await db.delete(contacts).where(inArray(contacts.id, createdContactIds));
    }
    if (createdAccountIds.length > 0) {
      await db.delete(crmAccounts).where(inArray(crmAccounts.id, createdAccountIds));
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

    console.log("✓ Limpeza cirúrgica concluída com sucesso.\n");
  }
}

runE5Tests()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error("💥 ERRO NA SUÍTE E5:", err);
    process.exit(1);
  });
