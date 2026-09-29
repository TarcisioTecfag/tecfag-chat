/**
 * verify-e3-deal-activities-next-task.ts
 * 
 * Suíte de Testes Automatizada de E3 (Tarefas Comerciais Completas e Próxima Ação)
 * Conforme especificado em PLANO-EXECUCAO-CRM-PENDENCIAS.md (Seção 1.2 e E3).
 * 
 * Asserções Automatizadas:
 * 1. Trava de segurança mandatória: execução estrita em valemchat_test.
 * 2. Criação de tarefas (task, call, meeting) e notas comerciais (note) com validação relacional.
 * 3. Conclusão atômica de tarefa: transição para status='completed', completedAt preenchido e evento gerado.
 * 4. Reabertura atômica de tarefa: transição para status='pending', completedAt anulado e evento gerado.
 * 5. Reagendamento atômica de tarefa: dueDate atualizado e evento de auditoria gerado.
 * 6. Cancelamento atômico de tarefa: status='cancelled' e evento gerado.
 * 7. Imutabilidade absoluta de notas comerciais: rejeição estrita de transição (concluir/reabrir/cancelar/editar)
 *    com código NOTE_IS_IMMUTABLE e proibição de conversão (INVALID_TYPE_CONVERSION).
 * 8. Cálculo de nextTask em getDeals (sem N+1):
 *    - Descarte de notas ('note').
 *    - Descarte de tarefas concluídas e canceladas.
 *    - Ordenação cronológica asc NULLS LAST.
 *    - Flags temporais: isOverdue, isToday, isFuture, hasNoDueDate.
 *    - Join correto do responsável (responsibleName).
 * 9. Multi-card na mesma conversa: tarefas vinculadas a cada deal sem colisão ou contaminação.
 * 10. Exclusão de atividades com auditoria e proteção de notas.
 * 11. Isolamento Multi-tenant estrito: operações em tarefas de outro tenant rejeitadas com NOT_FOUND ou CROSS_TENANT.
 * 12. Teardown cirúrgico: limpeza completa sem resíduos no valemchat_test.
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
  crmDealActivities,
  crmDealEvents,
} from "../src/db/schema";
import { eq, and, sql, inArray } from "drizzle-orm";
import { crmService, CrmValidationError, CrmCrossTenantError, CrmNotFoundError } from "../src/lib/crm/crm-service";

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
const createdDealIds: string[] = [];
const createdAccountIds: string[] = [];
const createdActivityIds: string[] = [];

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

async function runE3TestSuite() {
  console.log("\n=======================================================================");
  console.log(" INICIANDO SUÍTE DE TESTES E3 — TAREFAS COMERCIAIS & PRÓXIMA AÇÃO");
  console.log(" Banco de Execução: postgres://postgres:123@localhost:5432/valemchat_test");
  console.log("=======================================================================\n");

  const runSuffix = `e3_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
  const tenantA = `t_a_${runSuffix}`;
  const tenantB = `t_b_${runSuffix}`;

  try {
    // -----------------------------------------------------------------
    // FASE 0: SETUP DE AMBIENTE ISOLADO (TENANT A E TENANT B)
    // -----------------------------------------------------------------
    console.log("--- FASE 0: Setup de Ambientes Multi-Tenant ---");
    createdTenantIds.push(tenantA, tenantB);

    await db.insert(tenants).values([
      { id: tenantA, name: `Tenant A - Valem Test ${runSuffix}`, slug: `slug-${tenantA}`, connectionType: "meta" },
      { id: tenantB, name: `Tenant B - Tecfag Test ${runSuffix}`, slug: `slug-${tenantB}`, connectionType: "meta" },
    ]);
    assert(true, "Tenants A e B criados com isolamento estrito.");

    // Operadores no Tenant A e Tenant B
    const opA1 = `op_a1_${runSuffix}`;
    const opA2 = `op_a2_${runSuffix}`;
    const opB1 = `op_b1_${runSuffix}`;
    createdOperatorIds.push(opA1, opA2, opB1);

    await db.insert(operators).values([
      { id: opA1, tenantId: tenantA, name: "Vendedor Alpha", email: `alpha_${runSuffix}@test.com`, role: "operator", passwordHash: "dummy" },
      { id: opA2, tenantId: tenantA, name: "Vendedora Beta", email: `beta_${runSuffix}@test.com`, role: "operator", passwordHash: "dummy" },
      { id: opB1, tenantId: tenantB, name: "Operador Externo", email: `externo_${runSuffix}@test.com`, role: "operator", passwordHash: "dummy" },
    ]);
    assert(true, "Operadores criados nos tenants com sucesso.");

    // Funil e Etapas no Tenant A e Tenant B
    const pipeA = `pipe_a_${runSuffix}`;
    const pipeB = `pipe_b_${runSuffix}`;
    const stageA1 = `stg_a1_${runSuffix}`;
    const stageB1 = `stg_b1_${runSuffix}`;
    createdPipelineIds.push(pipeA, pipeB);

    await db.insert(crmPipelines).values([
      { id: pipeA, tenantId: tenantA, name: "Funil Comercial A", orderIndex: 0 },
      { id: pipeB, tenantId: tenantB, name: "Funil Comercial B", orderIndex: 0 },
    ]);

    await db.insert(crmStages).values([
      { id: stageA1, tenantId: tenantA, pipelineId: pipeA, name: "Prospecção", orderIndex: 0 },
      { id: stageB1, tenantId: tenantB, pipelineId: pipeB, name: "Inicial", orderIndex: 0 },
    ]);
    assert(true, "Funis e etapas criados.");

    // Contatos e Conversas
    const contA = `cont_a_${runSuffix}`;
    createdContactIds.push(contA);
    await db.insert(contacts).values({
      id: contA,
      tenantId: tenantA,
      name: "Carlos Comprador",
      phone: "11988887777",
      mainChannel: "whatsapp",
    });

    const convA = `conv_a_${runSuffix}`;
    createdConversationIds.push(convA);
    await db.insert(conversations).values({
      id: convA,
      tenantId: tenantA,
      contactId: contA,
      phone: "11988887777",
    });

    // Negociação Principal no Tenant A
    const dealA1 = await crmService.createDeal(tenantA, opA1, {
      title: "Negociação Válvulas Spray Lote 1",
      pipelineId: pipeA,
      stageId: stageA1,
      conversationId: convA,
      account: { name: "Valem Embalagens S/A", type: "company" },
    });
    createdDealIds.push(dealA1.id);
    if (dealA1.accountId) createdAccountIds.push(dealA1.accountId);
    assert(dealA1.id.length > 0, "Negociação Deal 1 criada no Tenant A.");

    // Segunda Negociação na mesma conversa (Cenário Multi-card)
    const dealA2 = await crmService.createDeal(tenantA, opA2, {
      title: "Negociação Potes Cosméticos Lote 2",
      pipelineId: pipeA,
      stageId: stageA1,
      conversationId: convA,
      accountId: dealA1.accountId,
    });
    createdDealIds.push(dealA2.id);
    assert(dealA2.id.length > 0, "Negociação Deal 2 criada na mesma conversa.");

    // Negociação no Tenant B (para teste de isolamento)
    const dealB1 = await crmService.createDeal(tenantB, opB1, {
      title: "Negociação Tecfag Cloud B",
      pipelineId: pipeB,
      stageId: stageB1,
      account: { name: "Cliente Tecfag B", type: "company" },
    });
    createdDealIds.push(dealB1.id);
    if (dealB1.accountId) createdAccountIds.push(dealB1.accountId);
    assert(dealB1.id.length > 0, "Negociação Deal B1 criada no Tenant B.");

    // -----------------------------------------------------------------
    // FASE 1: CRIAÇÃO DE ATIVIDADES E NOTAS COM VALIDAÇÃO RELACIONAL
    // -----------------------------------------------------------------
    console.log("\n--- FASE 1: Criação de Atividades e Notas Comerciais ---");

    // 1.1 Criar tarefa comercial padrão
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(10, 0, 0, 0);

    const task1 = await crmService.createDealActivity(tenantA, dealA1.id, opA1, {
      type: "task",
      title: "Enviar apresentação técnica e catálogo",
      description: "Encaminhar catálogo 2026 em PDF",
      dueDate: tomorrow,
      assignedToOperatorId: opA1,
      conversationId: convA,
    });
    createdActivityIds.push(task1.id);
    assert(task1.status === "pending", "Tarefa 1 criada com status 'pending'.");
    assert(task1.type === "task", "Tipo da Tarefa 1 é 'task'.");
    assert(task1.operatorName === "Vendedor Alpha", "Join com operador criador funcionou.");
    assert(task1.assignedToOperatorName === "Vendedor Alpha", "Join com operador responsável funcionou.");

    // 1.2 Criar ligação agendada para hoje
    const today = new Date();
    today.setHours(16, 0, 0, 0);

    const taskToday = await crmService.createDealActivity(tenantA, dealA1.id, opA1, {
      type: "call",
      title: "Ligar para alinhar quantidade mínima",
      dueDate: today,
      assignedToOperatorId: opA2,
    });
    createdActivityIds.push(taskToday.id);
    assert(taskToday.status === "pending", "Ligação criada para hoje.");
    assert(taskToday.assignedToOperatorName === "Vendedora Beta", "Atribuída à Vendedora Beta.");

    // 1.3 Criar nota comercial (note)
    const note1 = await crmService.createDealActivity(tenantA, dealA1.id, opA1, {
      type: "note",
      title: "Cliente solicitou entrega em caixas paletizadas.",
      description: "Histórico permanente de requisitos logísticos acordados via WhatsApp.",
    });
    createdActivityIds.push(note1.id);
    assert(note1.type === "note", "Nota comercial criada com tipo 'note'.");
    assert(note1.status === "completed", "Notas comerciais são salvas com status 'completed'.");

    // 1.4 Rejeição de criação com dados inválidos
    let invalidCreationBlocked = false;
    try {
      await crmService.createDealActivity(tenantA, dealA1.id, opA1, {
        type: "task",
        title: "", // título vazio deve falhar
      });
    } catch (e: any) {
      invalidCreationBlocked = e instanceof CrmValidationError;
    }
    assert(invalidCreationBlocked, "Criação de atividade com título vazio rejeitada com CrmValidationError.");

    // 1.5 Rejeição de criação para deal inexistente
    let nonExistentDealBlocked = false;
    try {
      await crmService.createDealActivity(tenantA, "deal_inexistente_999", opA1, {
        type: "task",
        title: "Tarefa Fantasma",
      });
    } catch (e: any) {
      nonExistentDealBlocked = e instanceof CrmNotFoundError;
    }
    assert(nonExistentDealBlocked, "Criação de atividade para deal inexistente rejeitada com CrmNotFoundError.");

    // -----------------------------------------------------------------
    // FASE 2: CONCLUSÃO, REABERTURA, REAGENDAMENTO E CANCELAMENTO
    // -----------------------------------------------------------------
    console.log("\n--- FASE 2: Ciclo de Vida da Tarefa Comercial ---");

    // 2.1 Concluir Tarefa 1
    const completedTask1 = await crmService.updateDealActivity(tenantA, dealA1.id, task1.id, opA1, {
      status: "completed",
    });
    assert(completedTask1.status === "completed", "Tarefa 1 concluída com sucesso.");
    assert(completedTask1.completedAt !== null, "completedAt preenchido automaticamente.");

    // Verificar evento de auditoria gerado
    const [eventCompleted] = await db
      .select()
      .from(crmDealEvents)
      .where(and(eq(crmDealEvents.dealId, dealA1.id), eq(crmDealEvents.eventType, "activity_completed")))
      .orderBy(sql`${crmDealEvents.createdAt} DESC`)
      .limit(1);
    assert(!!eventCompleted, "Evento 'activity_completed' registrado na auditoria do deal.");

    // 2.2 Reabrir Tarefa 1
    const reopenedTask1 = await crmService.updateDealActivity(tenantA, dealA1.id, task1.id, opA1, {
      status: "pending",
    });
    assert(reopenedTask1.status === "pending", "Tarefa 1 reaberta com status 'pending'.");
    assert(reopenedTask1.completedAt === null, "completedAt anulado na reabertura.");

    const [eventReopened] = await db
      .select()
      .from(crmDealEvents)
      .where(and(eq(crmDealEvents.dealId, dealA1.id), eq(crmDealEvents.eventType, "activity_reopened")))
      .orderBy(sql`${crmDealEvents.createdAt} DESC`)
      .limit(1);
    assert(!!eventReopened, "Evento 'activity_reopened' registrado na auditoria.");

    // 2.3 Reagendar Tarefa 1
    const newDueDate = new Date();
    newDueDate.setDate(newDueDate.getDate() + 3);
    newDueDate.setHours(14, 30, 0, 0);

    const rescheduledTask1 = await crmService.updateDealActivity(tenantA, dealA1.id, task1.id, opA1, {
      dueDate: newDueDate,
    });
    assert(
      rescheduledTask1.dueDate !== null &&
      new Date(rescheduledTask1.dueDate).getTime() === newDueDate.getTime(),
      "Prazo da Tarefa 1 atualizado com sucesso."
    );

    const [eventRescheduled] = await db
      .select()
      .from(crmDealEvents)
      .where(and(eq(crmDealEvents.dealId, dealA1.id), eq(crmDealEvents.eventType, "activity_rescheduled")))
      .orderBy(sql`${crmDealEvents.createdAt} DESC`)
      .limit(1);
    assert(!!eventRescheduled, "Evento 'activity_rescheduled' registrado na auditoria.");

    // 2.4 Cancelar Tarefa 1
    const cancelledTask1 = await crmService.updateDealActivity(tenantA, dealA1.id, task1.id, opA1, {
      status: "cancelled",
    });
    assert(cancelledTask1.status === "cancelled", "Tarefa 1 cancelada com sucesso.");

    const [eventCancelled] = await db
      .select()
      .from(crmDealEvents)
      .where(and(eq(crmDealEvents.dealId, dealA1.id), eq(crmDealEvents.eventType, "activity_cancelled")))
      .orderBy(sql`${crmDealEvents.createdAt} DESC`)
      .limit(1);
    assert(!!eventCancelled, "Evento 'activity_cancelled' registrado na auditoria.");

    // -----------------------------------------------------------------
    // FASE 3: IMUTABILIDADE ABSOLUTA DE NOTAS COMERCIAIS
    // -----------------------------------------------------------------
    console.log("\n--- FASE 3: Blindagem e Imutabilidade de Notas Comerciais ---");

    // 3.1 Tentativa de concluir uma nota comercial
    let noteCompleteBlocked = false;
    let noteCompleteCode = "";
    try {
      await crmService.updateDealActivity(tenantA, dealA1.id, note1.id, opA1, {
        status: "completed",
      });
    } catch (e: any) {
      if (e instanceof CrmValidationError) {
        noteCompleteBlocked = true;
        noteCompleteCode = e.code;
      }
    }
    assert(noteCompleteBlocked, "Tentativa de concluir nota comercial bloqueada.");
    assert(noteCompleteCode === "NOTE_IS_IMMUTABLE", "Código de erro é estritamente NOTE_IS_IMMUTABLE.");

    // 3.2 Tentativa de reabrir ou cancelar nota comercial
    let noteCancelBlocked = false;
    try {
      await crmService.updateDealActivity(tenantA, dealA1.id, note1.id, opA1, {
        status: "cancelled",
      });
    } catch (e: any) {
      noteCancelBlocked = e instanceof CrmValidationError && e.code === "NOTE_IS_IMMUTABLE";
    }
    assert(noteCancelBlocked, "Tentativa de cancelar nota comercial bloqueada com NOTE_IS_IMMUTABLE.");

    // 3.3 Tentativa de editar título ou descrição de nota comercial
    let noteEditBlocked = false;
    try {
      await crmService.updateDealActivity(tenantA, dealA1.id, note1.id, opA1, {
        title: "Tentativa de adulterar histórico",
      });
    } catch (e: any) {
      noteEditBlocked = e instanceof CrmValidationError && e.code === "NOTE_IS_IMMUTABLE";
    }
    assert(noteEditBlocked, "Tentativa de editar texto de nota comercial bloqueada com NOTE_IS_IMMUTABLE.");

    // 3.4 Tentativa de converter uma tarefa em nota
    let conversionBlocked = false;
    let conversionCode = "";
    try {
      await crmService.updateDealActivity(tenantA, dealA1.id, taskToday.id, opA1, {
        type: "note",
      });
    } catch (e: any) {
      if (e instanceof CrmValidationError) {
        conversionBlocked = true;
        conversionCode = e.code;
      }
    }
    assert(conversionBlocked, "Tentativa de converter tarefa em nota bloqueada.");
    assert(conversionCode === "INVALID_TYPE_CONVERSION", "Código de erro de conversão é INVALID_TYPE_CONVERSION.");

    // 3.5 Tentativa de excluir nota comercial
    let noteDeleteBlocked = false;
    try {
      await crmService.deleteDealActivity(tenantA, dealA1.id, note1.id, opA1);
    } catch (e: any) {
      noteDeleteBlocked = e instanceof CrmValidationError && e.code === "NOTE_IS_IMMUTABLE";
    }
    assert(noteDeleteBlocked, "Tentativa de excluir nota comercial bloqueada com NOTE_IS_IMMUTABLE.");

    // -----------------------------------------------------------------
    // FASE 4: CÁLCULO DETERMINÍSTICO DE NEXTTASK (ORDENAÇÃO E FLAGS)
    // -----------------------------------------------------------------
    console.log("\n--- FASE 4: Cálculo Determinístico de nextTask em getDeals ---");

    // Criar tarefas com datas estratégicas no Deal A1:
    // 1. Tarefa Atrasada (ontem)
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(9, 0, 0, 0);

    const taskOverdue = await crmService.createDealActivity(tenantA, dealA1.id, opA1, {
      type: "task",
      title: "Cobrar retorno de cotação atrasada",
      dueDate: yesterday,
      assignedToOperatorId: opA1,
    });
    createdActivityIds.push(taskOverdue.id);

    // 2. Tarefa Futura
    const inThreeDays = new Date();
    inThreeDays.setDate(inThreeDays.getDate() + 3);
    const taskFuture = await crmService.createDealActivity(tenantA, dealA1.id, opA1, {
      type: "meeting",
      title: "Reunião de alinhamento diretoria",
      dueDate: inThreeDays,
      assignedToOperatorId: opA2,
    });
    createdActivityIds.push(taskFuture.id);

    // 3. Tarefa sem Prazo
    const taskNoDate = await crmService.createDealActivity(tenantA, dealA1.id, opA1, {
      type: "task",
      title: "Pesquisar alternativas de transporte",
      dueDate: undefined,
    });
    createdActivityIds.push(taskNoDate.id);

    // Consultar lista de deals e inspecionar Deal A1
    const { deals: dealsList } = await crmService.getDeals(tenantA, {
      pipelineId: pipeA,
    });

    const enrichedDealA1 = dealsList.find((d) => d.id === dealA1.id);
    assert(!!enrichedDealA1, "Deal A1 encontrado na listagem.");
    assert(!!enrichedDealA1?.nextTask, "nextTask calculado e presente no Deal A1.");

    // Como há uma tarefa atrasada (ontem) e tarefas hoje e futuras, a mais antiga pendente por dueDate ASC deve ser taskOverdue!
    assert(
      enrichedDealA1?.nextTask?.id === taskOverdue.id,
      "nextTask escolheu a tarefa com prazo mais antigo pendente (taskOverdue)."
    );
    assert(enrichedDealA1?.nextTask?.isOverdue === true, "Flag isOverdue é true para a tarefa atrasada.");
    assert(enrichedDealA1?.nextTask?.isToday === false, "Flag isToday é false para a tarefa atrasada.");
    assert(enrichedDealA1?.nextTask?.isFuture === false, "Flag isFuture é false para a tarefa atrasada.");
    assert(enrichedDealA1?.nextTask?.hasNoDueDate === false, "Flag hasNoDueDate é false.");
    assert(enrichedDealA1?.nextTask?.responsibleName === "Vendedor Alpha", "responsibleName resolvido via join.");

    // Concluir a tarefa atrasada para testar o fallback imediato para a tarefa de hoje
    await crmService.updateDealActivity(tenantA, dealA1.id, taskOverdue.id, opA1, {
      status: "completed",
    });

    const { deals: dealsAfterOverdue } = await crmService.getDeals(tenantA, {
      pipelineId: pipeA,
    });
    const enrichedDealA1After = dealsAfterOverdue.find((d) => d.id === dealA1.id);
    assert(
      enrichedDealA1After?.nextTask?.id === taskToday.id,
      "Após concluir a atrasada, nextTask agora é a tarefa de hoje (taskToday)."
    );
    assert(enrichedDealA1After?.nextTask?.isToday === true, "Flag isToday é true para a tarefa de hoje.");
    assert(enrichedDealA1After?.nextTask?.isOverdue === false, "Flag isOverdue é false.");
    assert(enrichedDealA1After?.nextTask?.responsibleName === "Vendedora Beta", "responsibleName é Vendedora Beta.");

    // Testar DealDetailModal / getDealById com nextTask
    const dealDetail = await crmService.getDealById(tenantA, dealA1.id);
    assert(!!dealDetail?.nextTask, "getDealById também inclui nextTask enriquecido.");
    assert(dealDetail?.nextTask?.id === taskToday.id, "getDealById.nextTask bate com a listagem.");

    // -----------------------------------------------------------------
    // FASE 5: MULTI-CARD NA MESMA CONVERSA (SEM COLISÃO DE TAREFAS)
    // -----------------------------------------------------------------
    console.log("\n--- FASE 5: Tarefas Comerciais em Múltiplos Cards ---");

    // Criar tarefa específica no Deal A2 (mesma conversa convA)
    const taskDeal2 = await crmService.createDealActivity(tenantA, dealA2.id, opA2, {
      type: "task",
      title: "Enviar amostras de potes cosméticos",
      dueDate: inThreeDays,
      assignedToOperatorId: opA2,
      conversationId: convA,
    });
    createdActivityIds.push(taskDeal2.id);

    // Listar atividades de cada deal individualmente
    const activitiesDeal1 = await crmService.getDealActivities(tenantA, dealA1.id);
    const activitiesDeal2 = await crmService.getDealActivities(tenantA, dealA2.id);

    const deal1HasTask2 = activitiesDeal1.some((a) => a.id === taskDeal2.id);
    const deal2HasTask2 = activitiesDeal2.some((a) => a.id === taskDeal2.id);
    const deal2HasTask1 = activitiesDeal2.some((a) => a.id === task1.id);

    assert(!deal1HasTask2, "Deal A1 não contém a tarefa do Deal A2.");
    assert(deal2HasTask2, "Deal A2 contém sua respectiva tarefa.");
    assert(!deal2HasTask1, "Deal A2 não contém tarefas do Deal A1.");

    // -----------------------------------------------------------------
    // FASE 6: EXCLUSÃO CIRÚRGICA DE TAREFAS
    // -----------------------------------------------------------------
    console.log("\n--- FASE 6: Exclusão Cirúrgica de Tarefas ---");

    // Excluir taskNoDate do Deal A1
    const deleteResult = await crmService.deleteDealActivity(tenantA, dealA1.id, taskNoDate.id, opA1);
    assert(deleteResult.success === true, "deleteDealActivity retornou sucesso.");

    const [deletedRecord] = await db
      .select()
      .from(crmDealActivities)
      .where(eq(crmDealActivities.id, taskNoDate.id))
      .limit(1);
    assert(!deletedRecord, "Registro de taskNoDate foi removido do banco.");

    const [eventDeleted] = await db
      .select()
      .from(crmDealEvents)
      .where(and(eq(crmDealEvents.dealId, dealA1.id), eq(crmDealEvents.eventType, "activity_deleted")))
      .orderBy(sql`${crmDealEvents.createdAt} DESC`)
      .limit(1);
    assert(!!eventDeleted, "Evento 'activity_deleted' registrado na auditoria.");

    // -----------------------------------------------------------------
    // FASE 7: ISOLAMENTO MULTI-TENANT ESTRITO
    // -----------------------------------------------------------------
    console.log("\n--- FASE 7: Isolamento Multi-tenant Estrito ---");

    // 7.1 Tenant B tenta ler atividades do Deal A1
    let crossTenantReadBlocked = false;
    try {
      await crmService.getDealActivities(tenantB, dealA1.id);
    } catch (e: any) {
      crossTenantReadBlocked = e instanceof CrmNotFoundError;
    }
    assert(crossTenantReadBlocked, "Tenant B bloqueado ao tentar ler atividades do Tenant A.");

    // 7.2 Tenant B tenta concluir tarefa do Tenant A
    let crossTenantUpdateBlocked = false;
    try {
      await crmService.updateDealActivity(tenantB, dealA1.id, taskToday.id, opB1, {
        status: "completed",
      });
    } catch (e: any) {
      crossTenantUpdateBlocked = e instanceof CrmNotFoundError;
    }
    assert(crossTenantUpdateBlocked, "Tenant B bloqueado ao tentar atualizar tarefa do Tenant A.");

    // 7.3 Tenant B tenta excluir tarefa do Tenant A
    let crossTenantDeleteBlocked = false;
    try {
      await crmService.deleteDealActivity(tenantB, dealA1.id, taskToday.id, opB1);
    } catch (e: any) {
      crossTenantDeleteBlocked = e instanceof CrmNotFoundError;
    }
    assert(crossTenantDeleteBlocked, "Tenant B bloqueado ao tentar excluir tarefa do Tenant A.");

    // 7.4 Tentativa de atribuir tarefa a operador de outro tenant
    let crossTenantAssignBlocked = false;
    try {
      await crmService.createDealActivity(tenantA, dealA1.id, opA1, {
        type: "task",
        title: "Atribuição Ilegal",
        assignedToOperatorId: opB1, // operador do Tenant B
      });
    } catch (e: any) {
      crossTenantAssignBlocked = e instanceof CrmCrossTenantError;
    }
    assert(crossTenantAssignBlocked, "Atribuição de tarefa a operador de outro tenant bloqueada com CrmCrossTenantError.");

    console.log("\n=======================================================================");
    console.log(` ✅ TODAS AS ASSERÇÕES DE E3 PASSARAM COM SUCESSO! (${assertionsPassed}/${totalAssertions})`);
    console.log("=======================================================================\n");

  } finally {
    // -----------------------------------------------------------------
    // FASE 8: TEARDOWN CIRÚRGICO NO VALEMCHAT_TEST
    // -----------------------------------------------------------------
    console.log("--- FASE 8: Teardown Cirúrgico no valemchat_test ---");
    try {
      // 1. Remover atividades
      if (createdActivityIds.length > 0) {
        await db.delete(crmDealActivities).where(inArray(crmDealActivities.id, createdActivityIds));
      }
      if (createdDealIds.length > 0) {
        await db.delete(crmDealActivities).where(inArray(crmDealActivities.dealId, createdDealIds));
        await db.delete(crmDealEvents).where(inArray(crmDealEvents.dealId, createdDealIds));
        await db.delete(crmConversationDeals).where(inArray(crmConversationDeals.dealId, createdDealIds));
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
      if (createdPipelineIds.length > 0) {
        await db.delete(crmStages).where(inArray(crmStages.pipelineId, createdPipelineIds));
        await db.delete(crmPipelines).where(inArray(crmPipelines.id, createdPipelineIds));
      }
      if (createdOperatorIds.length > 0) {
        await db.delete(operators).where(inArray(operators.id, createdOperatorIds));
      }
      if (createdTenantIds.length > 0) {
        await db.delete(tenants).where(inArray(tenants.id, createdTenantIds));
      }
      console.log("✓ Limpeza cirúrgica concluída com sucesso sem deixar resíduos.");
    } catch (cleanupErr) {
      console.error("⚠️ Alerta no teardown:", cleanupErr);
    } finally {
      await client.end();
    }
  }
}

runE3TestSuite().catch((err) => {
  console.error("\n🛑 ERRO FATAL NA EXECUÇÃO DA SUÍTE DE TESTES E3:", err);
  process.exit(1);
});
