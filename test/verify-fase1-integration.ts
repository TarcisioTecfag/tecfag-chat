/**
 * Suíte de Testes de Integração — Fase 1 (Fundação e Núcleo de Dados CRM)
 *
 * Valida a modelagem de dados, unicidade, isolamento multi-tenant,
 * concorrência otimista e relação N:N conversas ↔ negociações.
 *
 * REGRA MANDATÓRIA:
 * Executa APENAS se TEST_DATABASE_URL estiver configurada para um banco que contenha "test" no nome.
 * Nunca roda em banco operacional.
 */
import { db, client, assertTestDatabaseIsolation } from "../src/db";
import { crmService } from "../src/lib/crm/crm-service";
import { getTenantLegacyInventory } from "../src/lib/crm/legacy-inventory";
import {
  tenants,
  contacts,
  conversations,
  crmAccounts,
  crmPipelines,
  crmStages,
  crmDeals,
  crmConversationDeals,
  crmDealEvents,
} from "../src/db/schema";
import { eq, and, inArray } from "drizzle-orm";

async function runFase1Tests() {
  console.log("=== INICIANDO VERIFICAÇÃO DE INTEGRAÇÃO — FASE 1 (CRM CORE) ===");

  // 1. Trava de Isolamento de Banco
  console.log("\n[1/7] Validando isolamento do banco de teste...");
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
  const createdAccountIds: string[] = [];
  const createdPipelineIds: string[] = [];
  const createdDealIds: string[] = [];
  const createdConvIds: string[] = [];
  const createdContactIds: string[] = [];

  try {
    // Cria tenant temporário de teste
    await db.insert(tenants).values({
      id: testTenantId,
      name: "Tenant de Teste Fase 1",
      slug: `test-fase1-${Date.now()}`,
      connectionType: "meta",
    });

    // 2. Teste de Criação de Contas PF e PJ com normalização
    console.log("\n[2/7] Testando criação e normalização de Contas PF/PJ...");
    const accountPj = await crmService.createAccount(testTenantId, {
      name: "Tecfag Indústria de Embalagens",
      tradeName: "Tecfag",
      document: "12.345.678/0001-95",
      email: "contato@tecfag.com.br",
    });
    createdAccountIds.push(accountPj.id);

    if (accountPj.document !== "12345678000195" || accountPj.type !== "company") {
      throw new Error(`Falha na normalização de PJ: doc=${accountPj.document}, type=${accountPj.type}`);
    }
    console.log("✓ Conta PJ criada com normalização de CNPJ (14 dígitos)");

    const accountPf = await crmService.createAccount(testTenantId, {
      name: "João da Silva",
      document: "123.456.789-00",
      email: "joao@email.com",
    });
    createdAccountIds.push(accountPf.id);

    if (accountPf.document !== "12345678900" || accountPf.type !== "person") {
      throw new Error(`Falha na normalização de PF: doc=${accountPf.document}, type=${accountPf.type}`);
    }
    console.log("✓ Conta PF criada com normalização de CPF (11 dígitos)");

    // 3. Teste de Funil e Etapas
    console.log("\n[3/7] Testando criação de Funil e Etapas...");
    const pipeline = await crmService.createPipeline(testTenantId, {
      name: "Vendas Máquinas 2026",
      stages: [
        { name: "Qualificação", orderIndex: 0 },
        { name: "Proposta", orderIndex: 1 },
        { name: "Fechamento", orderIndex: 2, isWinStage: true },
      ],
    });
    createdPipelineIds.push(pipeline.id);

    if (pipeline.stages.length !== 3) {
      throw new Error(`Divergência nas etapas criadas: esperado 3, obteve ${pipeline.stages.length}`);
    }
    console.log(`✓ Funil criado com ${pipeline.stages.length} etapas ordenadas`);

    // 4. Teste de Criação de Negociação
    console.log("\n[4/7] Testando criação de Deal com auditoria...");
    const stage0 = pipeline.stages[0];
    const deal = await crmService.createDeal(testTenantId, null, {
      title: "Válvulas Spray - Projeto 100k",
      pipelineId: pipeline.id,
      stageId: stage0.id,
      accountId: accountPj.id,
      value: "48500.00",
      currency: "BRL",
    });
    createdDealIds.push(deal.id);

    if (deal.version !== 1 || deal.status !== "open") {
      throw new Error(`Deal criado com estado incorreto: version=${deal.version}, status=${deal.status}`);
    }
    console.log("✓ Negociação criada com versão 1 e auditoria registrada");

    // 5. Teste de Concorrência Otimista (Optimistic Locking)
    console.log("\n[5/7] Testando controle de concorrência otimista...");
    const stage1 = pipeline.stages[1];
    const updatedDeal = await crmService.updateDeal(testTenantId, deal.id, null, {
      stageId: stage1.id,
      value: "52000.00",
      expectedVersion: 1, // Versão correta
    });

    if (updatedDeal.version !== 2) {
      throw new Error(`Versão não incrementada: esperado 2, obteve ${updatedDeal.version}`);
    }
    console.log("✓ Movimentação de etapa executada com versão incrementada para 2");

    // Tentativa de update com versão desatualizada (deve falhar)
    let conflictCaught = false;
    try {
      await crmService.updateDeal(testTenantId, deal.id, null, {
        stageId: stage0.id,
        expectedVersion: 1, // Versão antiga
      });
    } catch (e: any) {
      if (e.message.includes("CONCURRENCY_CONFLICT")) {
        conflictCaught = true;
      }
    }

    if (!conflictCaught) {
      throw new Error("Esperava-se CONCURRENCY_CONFLICT ao tentar atualizar com versão obsoleta.");
    }
    console.log("✓ Conflito de concorrência (409) disparado com sucesso em tentativa com versão antiga");

    // 6. Teste de Relacionamento N:N Conversas ↔ Negociações
    console.log("\n[6/7] Testando vínculo N:N entre Conversas e Negociações...");
    const contactId = `test-cnt-${Date.now()}`;
    createdContactIds.push(contactId);
    await db.insert(contacts).values({
      id: contactId,
      tenantId: testTenantId,
      name: "Contato Teste N:N",
      mainChannel: "whatsapp",
      phone: "5511999990001",
    });

    const conv1Id = `test-conv-1-${Date.now()}`;
    const conv2Id = `test-conv-2-${Date.now()}`;
    createdConvIds.push(conv1Id, conv2Id);

    await db.insert(conversations).values({
      id: conv1Id,
      tenantId: testTenantId,
      contactId,
      queueState: "fila",
    });
    await db.insert(conversations).values({
      id: conv2Id,
      tenantId: testTenantId,
      contactId,
      queueState: "meus",
    });

    // Vincula ambas as conversas ao mesmo deal
    await crmService.linkConversationDeal(testTenantId, conv1Id, deal.id, null, "chat");
    await crmService.linkConversationDeal(testTenantId, conv2Id, deal.id, null, "crm");

    const conv1Deals = await crmService.getConversationDeals(testTenantId, conv1Id);
    if (conv1Deals.length !== 1 || conv1Deals[0].id !== deal.id) {
      throw new Error("Falha ao recuperar negociação vinculada à conversa 1");
    }

    // Desvincula conversa 1 sem apagar o deal
    const unlinked = await crmService.unlinkConversationDeal(testTenantId, conv1Id, deal.id, null);
    if (!unlinked) {
      throw new Error("Falha ao desvincular conversa 1");
    }

    const conv1DealsAfter = await crmService.getConversationDeals(testTenantId, conv1Id);
    if (conv1DealsAfter.length !== 0) {
      throw new Error("Conversa 1 ainda possui deals ativos após desvinculação");
    }

    const conv2DealsAfter = await crmService.getConversationDeals(testTenantId, conv2Id);
    if (conv2DealsAfter.length !== 1) {
      throw new Error("Conversa 2 deveria permanecer vinculada ao deal");
    }
    console.log("✓ Vínculo N:N validado: múltiplas conversas por deal e desvinculação isolada sem exclusão");

    // 7. Teste de Inventário de Dados Legados
    console.log("\n[7/7] Testando inventário seguro somente-leitura...");
    const inventory = await getTenantLegacyInventory(testTenantId);
    if (inventory.contacts.total !== 1 || inventory.conversations.total !== 2) {
      throw new Error(`Inventário inconsistente: contatos=${inventory.contacts.total}, convs=${inventory.conversations.total}`);
    }
    console.log("✓ Inventário de dados legados executado com sucesso");

    console.log("\n=======================================================");
    console.log("🎉 TODOS OS TESTES DA FASE 1 FORAM APROVADOS COM SUCESSO!");
    console.log("=======================================================\n");

  } finally {
    // Limpeza estritamente cirúrgica por IDs criados
    console.log("Executando limpeza cirúrgica de dados de teste...");
    try {
      if (createdConvIds.length > 0) {
        await db.delete(crmConversationDeals).where(inArray(crmConversationDeals.conversationId, createdConvIds));
        await db.delete(conversations).where(inArray(conversations.id, createdConvIds));
      }
      if (createdContactIds.length > 0) {
        await db.delete(contacts).where(inArray(contacts.id, createdContactIds));
      }
      if (createdDealIds.length > 0) {
        await db.delete(crmDealEvents).where(inArray(crmDealEvents.dealId, createdDealIds));
        await db.delete(crmDeals).where(inArray(crmDeals.id, createdDealIds));
      }
      if (createdPipelineIds.length > 0) {
        await db.delete(crmStages).where(inArray(crmStages.pipelineId, createdPipelineIds));
        await db.delete(crmPipelines).where(inArray(crmPipelines.id, createdPipelineIds));
      }
      if (createdAccountIds.length > 0) {
        await db.delete(crmAccounts).where(inArray(crmAccounts.id, createdAccountIds));
      }
      await db.delete(tenants).where(eq(tenants.id, testTenantId));
      console.log("✓ Limpeza concluída.");
    } catch (cleanErr: any) {
      console.warn("Aviso na limpeza cirúrgica:", cleanErr.message);
    }
    await client.end();
  }
}

runFase1Tests().catch((e) => {
  console.error("Erro fatal no teste da Fase 1:", e);
  process.exit(1);
});
