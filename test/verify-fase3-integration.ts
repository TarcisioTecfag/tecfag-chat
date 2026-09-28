/**
 * Suíte de Testes de Integração — Fase 3 (Conversas Integradas ao CRM)
 *
 * Valida os requisitos da Fase 3:
 * 1. Multi-cards por conversa e navegação biunívoca.
 * 2. Direcionamento explícito de atividades/tarefas para um card de destino.
 * 3. Marcação de mensagens do chat como evidência comercial (crm_activity_messages).
 * 4. Consulta e desmarcação de evidências com auditoria.
 *
 * REGRA MANDATÓRIA:
 * Executa APENAS se TEST_DATABASE_URL estiver configurada para um banco que contenha "test" no nome.
 */
import { db, client, assertTestDatabaseIsolation } from "../src/db";
import { crmService } from "../src/lib/crm/crm-service";
import {
  tenants,
  contacts,
  conversations,
  messages,
  operators,
  crmAccounts,
  crmPipelines,
  crmStages,
  crmDeals,
  crmConversationDeals,
  crmDealActivities,
  crmActivityMessages,
  crmDealEvents,
} from "../src/db/schema";
import { eq, and, inArray } from "drizzle-orm";

async function runFase3Tests() {
  console.log("=== INICIANDO VERIFICAÇÃO DE INTEGRAÇÃO — FASE 3 (CONVERSAS INTEGRADAS) ===");

  // 1. Trava de Isolamento de Banco
  console.log("\n[1/5] Validando isolamento do banco de teste...");
  try {
    const dbInfo = await assertTestDatabaseIsolation();
    console.log(`✓ Conectado com segurança ao banco de teste: ${dbInfo.databaseName}`);
  } catch (err: any) {
    console.error(`🛑 Falha na trava de segurança: ${err.message}`);
    console.log("ℹ️ Conforme regra mandatória, o teste foi suspenso para proteger bancos operacionais.");
    await client.end();
    return;
  }

  const testTenantId = `test-tenant-${Date.now()}`;
  const createdOperatorIds: string[] = [];
  const createdAccountIds: string[] = [];
  const createdPipelineIds: string[] = [];
  const createdDealIds: string[] = [];
  const createdConvIds: string[] = [];
  const createdContactIds: string[] = [];
  const createdMessageIds: string[] = [];

  try {
    // 2. Setup de dados de teste (Tenant, Operador, Pipeline, Conversa, Mensagens)
    console.log("\n[2/5] Criando massa de teste isolada...");
    await db.insert(tenants).values({
      id: testTenantId,
      name: "Tenant de Teste Fase 3",
      slug: `test-fase3-${Date.now()}`,
      connectionType: "meta",
    });

    const opId = `op-${Date.now()}`;
    createdOperatorIds.push(opId);
    await db.insert(operators).values({
      id: opId,
      tenantId: testTenantId,
      name: "Operador Teste",
      email: `op-${Date.now()}@test.com`,
      role: "vendedor",
      status: "online",
    });

    const account = await crmService.createAccount(testTenantId, {
      name: "Cliente Comercial Alfa",
      document: "33.123.456/0001-78",
      email: "alfa@comercial.com",
    });
    createdAccountIds.push(account.id);

    const pipeline = await crmService.createPipeline(testTenantId, {
      name: "Funil Comercial Teste",
      stages: [
        { name: "Prospecção", orderIndex: 0 },
        { name: "Negociação", orderIndex: 1 },
      ],
    });
    createdPipelineIds.push(pipeline.id);

    const stages = await crmService.getPipelines(testTenantId);
    const stageId = stages[0].stages[0].id;

    // Contato e Conversa de teste
    const contactId = `ct-${Date.now()}`;
    createdContactIds.push(contactId);
    await db.insert(contacts).values({
      id: contactId,
      tenantId: testTenantId,
      name: "Contato Teste Alfa",
      phone: "+5511999887766",
    });

    const convId = `conv-${Date.now()}`;
    createdConvIds.push(convId);
    await db.insert(conversations).values({
      id: convId,
      tenantId: testTenantId,
      contactId: contactId,
      operatorId: opId,
      queueState: "meus",
    });

    // Mensagens na conversa
    const msg1Id = `msg-${Date.now()}-1`;
    const msg2Id = `msg-${Date.now()}-2`;
    createdMessageIds.push(msg1Id, msg2Id);
    await db.insert(messages).values([
      {
        id: msg1Id,
        tenantId: testTenantId,
        conversationId: convId,
        senderType: "client",
        senderName: "Contato Teste Alfa",
        content: "Segue em anexo a autorização do pedido no valor de R$ 45.000,00.",
      },
      {
        id: msg2Id,
        tenantId: testTenantId,
        conversationId: convId,
        senderType: "agent",
        senderName: "Operador Teste",
        content: "Excelente! Proposta aprovada com sucesso.",
      },
    ]);
    console.log("✓ Massa de teste criada com sucesso.");

    // 3. Teste Multi-Cards por Conversa
    console.log("\n[3/5] Testando vinculação de múltiplos cards a uma mesma conversa...");
    const dealA = await crmService.createDeal(testTenantId, opId, {
      title: "Negociação A - Lote de Válvulas",
      pipelineId: pipeline.id,
      stageId: stageId,
      accountId: account.id,
      value: 25000,
      conversationId: convId,
    });
    createdDealIds.push(dealA.id);

    const dealB = await crmService.createDeal(testTenantId, opId, {
      title: "Negociação B - Linha de Frascos",
      pipelineId: pipeline.id,
      stageId: stageId,
      accountId: account.id,
      value: 45000,
    });
    createdDealIds.push(dealB.id);

    // Vincula a mesma conversa também ao Deal B
    await crmService.linkConversationToDeal(testTenantId, dealB.id, convId, opId, false);

    // Verifica se a conversa possui 2 deals vinculados
    const convDeals = await crmService.getDealsForConversation(testTenantId, convId);
    if (convDeals.length !== 2) {
      throw new Error(`Esperado 2 deals vinculados à conversa, encontrado ${convDeals.length}`);
    }
    console.log(`✓ Conversa vinculada com sucesso a ${convDeals.length} cards distintos (Multi-card comprovado).`);

    // 4. Teste de Atividade Direcionada a um Card Específico
    console.log("\n[4/5] Testando direcionamento de atividade comercial para o Deal B...");
    const activity = await crmService.createDealActivity(testTenantId, dealB.id, opId, {
      type: "task",
      title: "Enviar boleto de entrada para Negociação B",
      conversationId: convId,
      dueDate: new Date(Date.now() + 86400000),
    });

    if (activity.dealId !== dealB.id || activity.conversationId !== convId) {
      throw new Error("Falha no vínculo da atividade ao dealB e à conversa.");
    }

    const dealBDetail = await crmService.getDealById(testTenantId, dealB.id);
    if (!dealBDetail || dealBDetail.activities.length === 0) {
      throw new Error("Atividade não encontrada na ficha detalhada do Deal B.");
    }
    console.log(`✓ Atividade comercial gravada e associada com precisão ao Deal B: "${activity.title}".`);

    // 5. Teste de Marcação de Mensagem como Evidência Comercial
    console.log("\n[5/5] Testando marcação de mensagem como evidência comercial e auditoria...");
    const evidence = await crmService.markMessageAsEvidence(
      testTenantId,
      dealB.id,
      msg1Id,
      opId,
      "Autorização expressa de compra enviada pelo cliente."
    );

    if (evidence.dealId !== dealB.id || evidence.messageId !== msg1Id || !evidence.note) {
      throw new Error("Dados da evidência incorretos.");
    }

    // Consulta de evidências do Deal
    const dealEvidences = await crmService.getDealEvidenceMessages(testTenantId, dealB.id);
    if (dealEvidences.length !== 1 || dealEvidences[0].message.id !== msg1Id) {
      throw new Error(`Esperado 1 evidência para Deal B, encontrado: ${dealEvidences.length}`);
    }
    console.log(`✓ Mensagem anexada como evidência: "${dealEvidences[0].message.content}"`);
    console.log(`  Nota registrada: "${dealEvidences[0].note}"`);

    // Desmarcar evidência
    const removed = await crmService.unmarkMessageEvidence(testTenantId, dealB.id, evidence.id, opId);
    if (!removed) {
      throw new Error("Falha ao desmarcar evidência.");
    }

    const postRemoveEvidences = await crmService.getDealEvidenceMessages(testTenantId, dealB.id);
    if (postRemoveEvidences.length !== 0) {
      throw new Error("Evidência não foi removida do Deal.");
    }
    console.log("✓ Evidência desmarcada com sucesso e confirmada na base.");

    // Verifica auditoria de desmarcação
    const dealAfterDetail = await crmService.getDealById(testTenantId, dealB.id);
    const hasAuditRemove = dealAfterDetail?.events.some(
      (e) => e.eventType === "message_evidence_removed"
    );
    if (!hasAuditRemove) {
      throw new Error("Evento de auditoria message_evidence_removed não registrado.");
    }
    console.log("✓ Evento de auditoria registrado no log imutável do Deal.");

    console.log("\n=======================================================");
    console.log("🎉 TODOS OS TESTES DA FASE 3 FORAM APROVADOS COM SUCESSO!");
    console.log("=======================================================\n");
  } catch (err: any) {
    console.error(`\n❌ ERRO NA SUÍTE DE TESTES DA FASE 3: ${err.message}`);
    console.error(err.stack);
    process.exitCode = 1;
  } finally {
    // Teardown higiênico
    console.log("Realizando limpeza cirúrgica dos dados de teste...");
    try {
      if (createdDealIds.length > 0) {
        await db.delete(crmDealEvents).where(inArray(crmDealEvents.dealId, createdDealIds));
        await db.delete(crmActivityMessages).where(inArray(crmActivityMessages.dealId, createdDealIds));
        await db.delete(crmDealActivities).where(inArray(crmDealActivities.dealId, createdDealIds));
        await db.delete(crmConversationDeals).where(inArray(crmConversationDeals.dealId, createdDealIds));
        await db.delete(crmDeals).where(inArray(crmDeals.id, createdDealIds));
      }
      if (createdConvIds.length > 0) {
        await db.delete(messages).where(inArray(messages.conversationId, createdConvIds));
        await db.delete(conversations).where(inArray(conversations.id, createdConvIds));
      }
      if (createdContactIds.length > 0) {
        await db.delete(contacts).where(inArray(contacts.id, createdContactIds));
      }
      if (createdPipelineIds.length > 0) {
        await db.delete(crmStages).where(inArray(crmStages.pipelineId, createdPipelineIds));
        await db.delete(crmPipelines).where(inArray(crmPipelines.id, createdPipelineIds));
      }
      if (createdAccountIds.length > 0) {
        await db.delete(crmAccounts).where(inArray(crmAccounts.id, createdAccountIds));
      }
      if (createdOperatorIds.length > 0) {
        await db.delete(operators).where(inArray(operators.id, createdOperatorIds));
      }
      await db.delete(tenants).where(eq(tenants.id, testTenantId));
      console.log("✓ Limpeza concluída sem impacto em produção.");
    } catch (cleanErr: any) {
      console.warn("Aviso ao limpar dados de teste:", cleanErr.message);
    } finally {
      await client.end();
    }
  }
}

runFase3Tests();
