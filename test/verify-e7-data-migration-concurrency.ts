/**
 * verify-e7-data-migration-concurrency.ts
 * Suíte de Verificação Automatizada — Entrega E7: Migração RD, Qualidade dos Dados e Concorrência
 *
 * Valida os critérios de aceitação da Seção E7:
 * 1. Trava de segurança garantindo execução exclusiva em banco de teste isolado (valemchat_test)
 * 2. Inventário pré-migração estritamente somente-leitura (0 mutações no banco)
 * 3. Primeira execução de migração completa: funis, etapas, contas, contatos, deals com valores reais e tarefas
 * 4. Reconciliação honesta: etapas inexistentes NÃO alocam deals arbitrariamente (unmappedDetails)
 * 5. Idempotência absoluta: segunda execução do mesmo lote NÃO duplica contas, contatos, deals ou tarefas
 * 6. Preservação de edições locais: edições manuais locais não são substituídas silenciosamente
 * 7. Integridade de atendimento: tarefas têm conversationId null e conversas históricas não são associadas cegamente
 * 8. Trava de concorrência: duas migrações simultâneas no mesmo tenant disparam CrmConcurrencyError
 * 9. Política de fonte de verdade (rd_primary vs local_primary) e sincronização
 * 10. Isolamento multi-tenant estrito
 * 11. Teardown cirúrgico em valemchat_test
 */

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, and, inArray, sql } from "drizzle-orm";
import * as schema from "../src/db/schema";
import {
  tenants,
  operators,
  contacts,
  conversations,
  crmPipelines,
  crmStages,
  crmDeals,
  crmAccounts,
  crmDealContacts,
  crmDealActivities,
  crmConversationDeals,
  crmMigrationRuns,
  channelConfigs,
} from "../src/db/schema";
import { RdCrmMigrator, RdFetcher } from "../src/lib/crm/rd-migrator";
import { CrmConcurrencyError, CrmValidationError } from "../src/lib/crm/crm-service";

const dbUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

if (!dbUrl || !dbUrl.includes("test")) {
  console.error("❌ ERRO FATAL: TEST_DATABASE_URL deve apontar explicitamente para o banco de teste (valemchat_test)!");
  process.exit(1);
}

const client = postgres(dbUrl, { max: 1 });
const db = drizzle(client, { schema });

// Arrays para teardown cirúrgico
const createdTenantIds: string[] = [];
const createdOperatorIds: string[] = [];

const summary = {
  total: 0,
  passed: 0,
  failed: 0,
};

function assert(condition: boolean, message: string) {
  summary.total++;
  if (condition) {
    summary.passed++;
    console.log(`  ✅ [PASS] ${message}`);
  } else {
    summary.failed++;
    console.error(`  ❌ [FAIL] ${message}`);
    throw new Error(`Falha na asserção: ${message}`);
  }
}

async function runE7Suite() {
  console.log("\n================================================================================");
  console.log("  INICIANDO SUÍTE AUTOMATIZADA: E7 — MIGRAÇÃO RD, QUALIDADE E CONCORRÊNCIA");
  console.log("================================================================================");

  // 1. Verificação de Isolamento do Banco de Testes
  console.log("\n👉 1. Verificando trava de segurança do banco de dados...");
  assert(dbUrl!.includes("valemchat_test"), "Execução estritamente isolada em valemchat_test");

  const runId = Math.random().toString(36).substring(2, 7);
  const tenantA = `ten-a-e7-${runId}`;
  const tenantB = `ten-b-e7-${runId}`;
  createdTenantIds.push(tenantA, tenantB);

  try {
    // 2. Setup Multi-Tenant Isolado
    console.log("\n👉 2. Criando estrutura multi-tenant isolada...");
    await db.insert(tenants).values([
      { id: tenantA, name: `Tenant A E7 ${runId}`, slug: `slug_a_${runId}`, connectionType: "meta" },
      { id: tenantB, name: `Tenant B E7 ${runId}`, slug: `slug_b_${runId}`, connectionType: "meta" },
    ]);

    const opAdminA = `op-adm-a-${runId}`;
    const opSellerA = `op-sel-a-${runId}`;
    const opAdminB = `op-adm-b-${runId}`;
    createdOperatorIds.push(opAdminA, opSellerA, opAdminB);

    await db.insert(operators).values([
      {
        id: opAdminA,
        tenantId: tenantA,
        name: "Administrador Alpha",
        email: `admin-${runId}@valem.test`,
        role: "admin",
        passwordHash: "hash",
      },
      {
        id: opSellerA,
        tenantId: tenantA,
        name: "Vendedor Especialista",
        email: `vendedor-${runId}@valem.test`,
        role: "operator",
        passwordHash: "hash",
      },
      {
        id: opAdminB,
        tenantId: tenantB,
        name: "Administrador Beta",
        email: `admin-b-${runId}@valem.test`,
        role: "admin",
        passwordHash: "hash",
      },
    ]);

    await db.insert(channelConfigs).values([
      {
        id: `cfg-a-${runId}`,
        tenantId: tenantA,
        activeChannel: "meta",
        rdCrmSourceOfTruth: "rd_primary",
        rdCrmSyncPolicy: "manual",
      },
      {
        id: `cfg-b-${runId}`,
        tenantId: tenantB,
        activeChannel: "meta",
        rdCrmSourceOfTruth: "rd_primary",
        rdCrmSyncPolicy: "manual",
      },
    ]);

    // Mock completo e fiel da API v2 do RD Station CRM
    const mockRdData = {
      pipelines: [
        {
          id: `rd-pipe-1-${runId}`,
          name: "Funil Comercial Máquinas",
          stages: [
            { id: `rd-stg-101-${runId}`, name: "Qualificação Inicial", order: 0 },
            { id: `rd-stg-102-${runId}`, name: "Proposta Enviada", order: 1 },
            { id: `rd-stg-103-${runId}`, name: "Negociação e Fechamento", order: 2 },
          ],
        },
      ],
      deals: [
        {
          id: `rd-deal-1-${runId}`,
          name: "Venda Envasadora Linear 4 Bicos",
          deal_pipeline_id: `rd-pipe-1-${runId}`,
          deal_stage_id: `rd-stg-101-${runId}`,
          amount_total: "125000.00",
          win: null,
          created_at: "2026-09-01T10:00:00Z",
          prediction_date: "2026-10-15T00:00:00Z",
          user_id: "user-rd-1",
          user: { id: "user-rd-1", name: "Vendedor Especialista", email: `vendedor-${runId}@valem.test` },
          organization_id: `rd-org-1-${runId}`,
          organization: {
            id: `rd-org-1-${runId}`,
            name: "Indústria Farmacêutica ABC Ltda",
            cnpj: "12345678000195",
            email: "contato@abc.farm.br",
          },
          contacts: [
            {
              id: `rd-ct-1-${runId}`,
              name: "Renata Diretora de Operações",
              phone: "+55 (14) 99888-1122",
              email: "renata@abc.farm.br",
            },
          ],
        },
        {
          id: `rd-deal-2-${runId}`,
          name: "Fornecimento de Seladoras Contínuas",
          deal_pipeline_id: `rd-pipe-1-${runId}`,
          deal_stage_id: `rd-stg-102-${runId}`,
          amount_total: "45000.50",
          win: true,
          created_at: "2026-09-05T14:00:00Z",
          prediction_date: "2026-09-28T00:00:00Z",
          user_id: "user-rd-unmapped",
          user: { id: "user-rd-unmapped", name: "Consultor Externo Desconhecido", email: "externo@terceirizado.test" },
          organization_id: `rd-org-2-${runId}`,
          organization: {
            id: `rd-org-2-${runId}`,
            name: "Cosméticos Bella Vita S/A",
            cnpj: "98765432000110",
          },
          contacts: [],
        },
        {
          id: `rd-deal-3-unmapped-stage-${runId}`,
          name: "Deal em Etapa Removida no RD",
          deal_pipeline_id: `rd-pipe-1-${runId}`,
          deal_stage_id: `rd-stg-inexistente-${runId}`, // Etapa ausente!
          amount_total: "80000.00",
          win: null,
        },
      ],
      activities: [
        {
          id: `rd-act-1-${runId}`,
          deal_id: `rd-deal-1-${runId}`,
          subject: "Reunião de Apresentação Técnica do Projeto",
          activity_type: "meeting",
          done: true,
          date: "2026-09-10",
          notes: "Apresentado layout da linha de envase para a diretoria técnica.",
        },
        {
          id: `rd-act-2-${runId}`,
          deal_id: `rd-deal-1-${runId}`,
          subject: "Enviar Minuta Contratual e Termo de Garantia",
          activity_type: "task",
          done: false,
          date: "2026-10-05",
          notes: "Aguardando aprovação do financeiro.",
        },
        {
          id: `rd-act-3-orphan-${runId}`,
          deal_id: "deal-rd-inexistente-999", // Tarefa órfã!
          subject: "Follow-up de Negócio que Não Existe",
          activity_type: "call",
          done: false,
        },
      ],
      users: [
        { id: "user-rd-1", name: "Vendedor Especialista", email: `vendedor-${runId}@valem.test` },
        { id: "user-rd-unmapped", name: "Consultor Externo Desconhecido", email: "externo@terceirizado.test" },
      ],
      custom_fields: [
        { id: "cf-1", label: "Segmento de Atuação", type: "string" },
        { id: "cf-2", label: "Volume Mensal Estimado", type: "number" },
      ],
    };

    // Mock Fetcher que atende rigorosamente a API v2
    const mockFetcher: RdFetcher = async (tId, method, path) => {
      if (path.includes("/pipelines")) {
        return { pipelines: mockRdData.pipelines };
      }
      if (path.includes("/deals")) {
        return { deals: mockRdData.deals, total: mockRdData.deals.length };
      }
      if (path.includes("/activities") || path.includes("/tasks")) {
        return { activities: mockRdData.activities, total: mockRdData.activities.length };
      }
      if (path.includes("/users")) {
        return { users: mockRdData.users };
      }
      if (path.includes("/custom_fields")) {
        return { custom_fields: mockRdData.custom_fields };
      }
      return {};
    };

    // 3. Teste do Inventário Remoto Sem Escrita (inspectRdInventory)
    console.log("\n👉 3. Testando Inventário Remoto Sem Escrita (inspectRdInventory)...");
    const [dealsBefore] = await db.select({ count: sql<number>`count(*)::int` }).from(crmDeals).where(eq(crmDeals.tenantId, tenantA));
    const [accsBefore] = await db.select({ count: sql<number>`count(*)::int` }).from(crmAccounts).where(eq(crmAccounts.tenantId, tenantA));
    const [tasksBefore] = await db.select({ count: sql<number>`count(*)::int` }).from(crmDealActivities).where(eq(crmDealActivities.tenantId, tenantA));

    const inventory = await RdCrmMigrator.inspectRdInventory(tenantA, mockFetcher);

    assert(inventory.pipelines.total === 1, "Inventário identificou 1 pipeline no RD");
    assert(inventory.pipelines.samples[0].stagesCount === 3, "Pipeline da amostra contém 3 etapas");
    assert(inventory.deals.total === 3, "Inventário identificou 3 deals no RD");
    assert(inventory.deals.totalValueEstimated === 250000.50, "Valor financeiro estimado de R$ 250.000,50 calculado");
    assert(inventory.users.total === 2, "Inventário identificou 2 usuários no RD");
    assert(inventory.tasks.total === 3, "Inventário identificou 3 tarefas no RD");
    assert(inventory.customFields.total === 2, "Inventário identificou 2 campos customizados");

    // Prova de que NENHUMA linha foi gravada no banco
    const [dealsAfter] = await db.select({ count: sql<number>`count(*)::int` }).from(crmDeals).where(eq(crmDeals.tenantId, tenantA));
    const [accsAfter] = await db.select({ count: sql<number>`count(*)::int` }).from(crmAccounts).where(eq(crmAccounts.tenantId, tenantA));
    const [tasksAfter] = await db.select({ count: sql<number>`count(*)::int` }).from(crmDealActivities).where(eq(crmDealActivities.tenantId, tenantA));

    assert(dealsBefore.count === dealsAfter.count, "Zero negociações gravadas no banco durante o inventário");
    assert(accsBefore.count === accsAfter.count, "Zero contas gravadas no banco durante o inventário");
    assert(tasksBefore.count === tasksAfter.count, "Zero tarefas gravadas no banco durante o inventário (estritamente somente-leitura)");

    // 4. Teste da Primeira Execução de Migração Completa
    console.log("\n👉 4. Testando Primeira Execução da Migração Completa (migrateAll)...");
    const report1 = await RdCrmMigrator.migrateAll(tenantA, opAdminA, {}, mockFetcher);

    assert(report1.status === "partial", "Status é 'partial' devido ao deal em etapa desmapeada e tarefa órfã");
    assert(report1.pipelines.importedOrMatched === 1, "Exatamente 1 funil importado/mapeado");
    assert(report1.stages.importedOrMatched === 3, "Exatamente 3 etapas importadas");
    assert(report1.deals.imported === 2, "Exatamente 2 deals com etapas válidas foram importados");
    assert(report1.deals.unmappedStageCount === 1, "Exatamente 1 deal em etapa inexistente foi detectado");
    assert(report1.deals.unmappedDetails.length === 1, "Detalhes do deal não mapeado registrados com razão clara");
    assert(report1.deals.unmappedDetails[0].rdStageId === `rd-stg-inexistente-${runId}`, "ID da etapa desmapeada coincide");
    assert(report1.organizations.imported === 2, "Exatamente 2 organizações compradoras importadas");
    assert(report1.contacts.imported === 1, "Exatamente 1 contato associado criado");
    assert(report1.contacts.associatedToDealsCount === 1, "Contato associado como participante (crmDealContacts)");
    assert(report1.tasks.imported === 2, "Exatamente 2 tarefas com deals existentes foram importadas");
    assert(report1.tasks.orphanCount === 1, "Exatamente 1 tarefa órfã isolada e não inserida");
    assert(report1.tasks.byStatus.completed === 1, "1 tarefa importada como concluída");
    assert(report1.tasks.byStatus.pending === 1, "1 tarefa importada como pendente");
    assert(report1.unmappedResponsible.length === 1, "Responsável não cadastrado localmente isolado no relatório");
    assert(report1.unmappedResponsible[0].email === "externo@terceirizado.test", "Email do responsável não mapeado identificado");

    // Validação de Valores Financeiros Reconciliados
    assert(report1.deals.totalValueImported === 170000.50, "Total importado honesto de R$ 170.000,50 (125.000 + 45.000,50)");
    assert(report1.deals.totalValueRd === 250000.50, "Total RD de R$ 250.000,50 computado no relatório");

    // 5. Teste da Regra de Ouro E7: Tarefas e Conversas Históricas
    console.log("\n👉 5. Testando Integridade de Atendimentos e Tarefas Importadas...");
    const importedTasks = await db
      .select()
      .from(crmDealActivities)
      .where(eq(crmDealActivities.tenantId, tenantA));

    for (const t of importedTasks) {
      assert(t.conversationId === null, `Tarefa '${t.title}' importada possui conversationId estritamente null`);
      assert(Boolean(t.rdTaskId), `Tarefa possui rdTaskId durável (${t.rdTaskId})`);
    }

    const linkedConvs = await db
      .select()
      .from(crmConversationDeals)
      .where(eq(crmConversationDeals.tenantId, tenantA));

    assert(linkedConvs.length === 0, "REGRA DE OURO E7: NENHUMA conversa histórica foi vinculada cegamente aos negócios");

    // 6. Teste de Idempotência Absoluta (Segunda Execução do Mesmo Lote)
    console.log("\n👉 6. Testando Idempotência Absoluta (Segunda Execução do Mesmo Lote)...");
    const report2 = await RdCrmMigrator.migrateAll(tenantA, opAdminA, {}, mockFetcher);

    assert(report2.deals.imported === 0, "Segunda execução: ZERO novos deals inseridos");
    assert(report2.deals.skippedAlreadyExists === 2, "Segunda execução: exatamente 2 deals identificados como existentes e pulados");
    assert(report2.organizations.imported === 0, "Segunda execução: ZERO novas organizações inseridas");
    assert(report2.organizations.skippedAlreadyExists === 2, "Segunda execução: 2 organizações existentes identificadas e puladas");
    assert(report2.tasks.imported === 0, "Segunda execução: ZERO novas tarefas inseridas");
    assert(report2.tasks.skippedAlreadyExists === 2, "Segunda execução: 2 tarefas existentes identificadas e puladas");
    assert(report2.contacts.imported === 0, "Segunda execução: ZERO novos contatos inseridos");

    // Contagem real no banco após 2 execuções consecutivas
    const [dealsFinal] = await db.select({ count: sql<number>`count(*)::int` }).from(crmDeals).where(eq(crmDeals.tenantId, tenantA));
    const [accsFinal] = await db.select({ count: sql<number>`count(*)::int` }).from(crmAccounts).where(eq(crmAccounts.tenantId, tenantA));
    const [tasksFinal] = await db.select({ count: sql<number>`count(*)::int` }).from(crmDealActivities).where(eq(crmDealActivities.tenantId, tenantA));

    assert(dealsFinal.count === 2, "Banco local mantém estritamente 2 negociações (zero duplicações comprovado)");
    assert(accsFinal.count === 2, "Banco local mantém estritamente 2 organizações (zero duplicações comprovado)");
    assert(tasksFinal.count === 2, "Banco local mantém estritamente 2 tarefas (zero duplicações comprovado)");

    // 7. Testando Preservação de Edições Locais (Sem Sobrescrita Silenciosa)
    console.log("\n👉 7. Testando Preservação de Edições Locais...");
    // Edita manualmente o deal 1 localmente
    const [dealToEdit] = await db
      .select()
      .from(crmDeals)
      .where(and(eq(crmDeals.tenantId, tenantA), eq(crmDeals.rdDealId, `rd-deal-1-${runId}`)));

    await db
      .update(crmDeals)
      .set({
        title: "Título Editado Manualmente Pelo Vendedor Local",
        source: "local_manual",
        updatedAt: new Date(),
      })
      .where(eq(crmDeals.id, dealToEdit.id));

    // Executa migração novamente sem forceUpdate
    const report3 = await RdCrmMigrator.migrateAll(tenantA, opAdminA, { forceUpdate: false }, mockFetcher);
    assert(report3.deals.skippedLocalEdited === 1, "Negócio editado localmente foi identificado e protegido");

    const [dealAfterMig] = await db
      .select()
      .from(crmDeals)
      .where(eq(crmDeals.id, dealToEdit.id));

    assert(
      dealAfterMig.title === "Título Editado Manualmente Pelo Vendedor Local",
      "Edição manual local permaneceu intacta (sem sobrescrita silenciosa)"
    );

    // 8. Teste de Trava de Concorrência em Migrações Simultâneas
    console.log("\n👉 8. Testando Trava de Concorrência em Migrações Simultâneas...");
    let concurrencyBlocked = false;

    // Simula uma migração longa travando o tenant
    const slowFetcher: RdFetcher = async (tId, m, p, b) => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      return mockFetcher(tId, m, p, b);
    };

    // Dispara a primeira em background
    const p1 = RdCrmMigrator.migrateAll(tenantA, opAdminA, {}, slowFetcher);

    // Imediatamente tenta disparar a segunda no mesmo tenant
    try {
      await RdCrmMigrator.migrateAll(tenantA, opAdminA, {}, mockFetcher);
    } catch (e: any) {
      if (e instanceof CrmConcurrencyError) {
        concurrencyBlocked = true;
      }
    }

    await p1; // Aguarda a primeira terminar

    assert(concurrencyBlocked, "Segunda migração concorrente foi estritamente rejeitada com CrmConcurrencyError");

    // 9. Teste de Política de Fonte de Verdade e Sincronização
    console.log("\n👉 9. Testando Política de Fonte de Verdade e Sincronização...");
    const policy = await RdCrmMigrator.getSyncPolicy(tenantA);
    assert(policy.sourceOfTruth === "rd_primary", "Fonte de verdade padrão é 'rd_primary'");
    assert(policy.syncPolicy === "manual", "Política de sincronização padrão é 'manual'");
    assert(policy.lastSyncAt !== null, "lastSyncAt atualizado após a execução");
    assert(policy.lastReport !== null, "lastReport armazenado no canal");

    // Atualiza política para local_primary e bidirectional
    const updatedPolicy = await RdCrmMigrator.updateSyncPolicy(tenantA, opAdminA, {
      sourceOfTruth: "local_primary",
      syncPolicy: "bidirectional",
    });

    assert(updatedPolicy.sourceOfTruth === "local_primary", "Fonte de verdade alterada com sucesso para 'local_primary'");
    assert(updatedPolicy.syncPolicy === "bidirectional", "Política de sincronização alterada para 'bidirectional'");

    // Rejeita valores inválidos
    let invalidPolicyRejected = false;
    try {
      await RdCrmMigrator.updateSyncPolicy(tenantA, opAdminA, {
        sourceOfTruth: "valor_invalido" as any,
      });
    } catch (e: any) {
      if (e instanceof CrmValidationError) invalidPolicyRejected = true;
    }
    assert(invalidPolicyRejected, "Política com valor inválido rejeitada com CrmValidationError");

    // 10. Histórico de Execuções e Isolamento Multi-Tenant
    console.log("\n👉 10. Testando Histórico de Execuções e Isolamento Multi-Tenant...");
    const runsTenantA = await RdCrmMigrator.getMigrationRuns(tenantA);
    assert(runsTenantA.length >= 3, "Histórico crm_migration_runs acumulou as execuções do Tenant A");
    assert(runsTenantA[0].tenantId === tenantA, "Execução pertence estritamente ao Tenant A");

    const runsTenantB = await RdCrmMigrator.getMigrationRuns(tenantB);
    assert(runsTenantB.length === 0, "Tenant B possui ZERO execuções no histórico (isolamento multi-tenant garantido)");

    const dealsTenantB = await db.select().from(crmDeals).where(eq(crmDeals.tenantId, tenantB));
    assert(dealsTenantB.length === 0, "Tenant B não possui nenhum deal importado do Tenant A");

  } finally {
    // 11. Teardown Cirúrgico
    console.log("\n👉 11. Executando Teardown Cirúrgico em valemchat_test...");
    try {
      if (createdTenantIds.length > 0) {
        await db.delete(crmMigrationRuns).where(inArray(crmMigrationRuns.tenantId, createdTenantIds));
        await db.delete(crmDealActivities).where(inArray(crmDealActivities.tenantId, createdTenantIds));
        await db.delete(crmDealContacts).where(inArray(crmDealContacts.tenantId, createdTenantIds));
        await db.delete(crmDeals).where(inArray(crmDeals.tenantId, createdTenantIds));
        await db.delete(crmStages).where(inArray(crmStages.tenantId, createdTenantIds));
        await db.delete(crmPipelines).where(inArray(crmPipelines.tenantId, createdTenantIds));
        await db.delete(contacts).where(inArray(contacts.tenantId, createdTenantIds));
        await db.delete(crmAccounts).where(inArray(crmAccounts.tenantId, createdTenantIds));
        await db.delete(channelConfigs).where(inArray(channelConfigs.tenantId, createdTenantIds));
        await db.delete(operators).where(inArray(operators.tenantId, createdTenantIds));
        await db.delete(tenants).where(inArray(tenants.id, createdTenantIds));
      }
      console.log("  🧹 Teardown cirúrgico concluído. Zero resíduos deixados no banco.");
    } catch (cleanErr: any) {
      console.error("  ⚠️ Erro durante o teardown cirúrgico:", cleanErr);
    }
  }

  // Relatório Final da Suíte
  console.log("\n================================================================================");
  console.log(`  RESUMO DA SUÍTE E7: ${summary.passed}/${summary.total} asserções aprovadas`);
  console.log("================================================================================");
  if (summary.failed > 0) {
    console.error(`❌ ${summary.failed} asserções falharam. Verifique os logs acima.`);
    process.exit(1);
  } else {
    console.log("🎉 100% das asserções de E7 foram APROVADAS com sucesso!\n");
  }
}

runE7Suite()
  .then(async () => {
    await client.end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("\n💥 Erro não tratado durante a execução da suíte E7:", err);
    await client.end();
    process.exit(1);
  });
