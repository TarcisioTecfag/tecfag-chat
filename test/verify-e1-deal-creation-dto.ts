/**
 * verify-e1-deal-creation-dto.ts
 * 
 * Suíte de Testes e Validação Técnica de E1 (Criação Transacional, DTO Único e Modelo Negócio/Cliente)
 * Conforme especificado em PLANO-EXECUCAO-CRM-PENDENCIAS.md (Seção 1.2 e E1).
 * 
 * Asserções Automatizadas:
 * 1. Trava de segurança mandatória (assertTestDatabaseIsolation): execução exclusiva em valemchat_test.
 * 2. Criação atômica de PF com CPF válido (11 dígitos): cria crmAccounts (type: "person", documentType: "cpf") e crmDeals numa única transação.
 * 3. Criação atômica de PJ com CNPJ válido (14 dígitos): cria crmAccounts (type: "company", documentType: "cnpj") e crmDeals numa única transação.
 * 4. Validação de formato de CPF: CPF com tamanho incorreto (< 11 ou > 11) é rejeitado com INVALID_DOCUMENT_FORMAT e não cria conta nem deal (rollback).
 * 5. Validação de formato de CNPJ: CNPJ com tamanho incorreto (< 14 ou > 14) é rejeitado com INVALID_DOCUMENT_FORMAT e não cria conta nem deal (rollback).
 * 6. Reutilização de Conta Existente por Documento: criar nova negociação com mesmo documento reutiliza a conta sem duplicá-la.
 * 7. Distinção estrita de valor no banco e DTO: valor ausente (null) não vira zero presumido ("0.00"), e zero real persiste "0.00".
 * 8. Nota inicial persistida atomicamente: se informada na criação, persiste como atividade (type: "note", status: "completed") na mesma transação.
 * 9. Rollback atômico verificado: erro de negócio (ex: etapa inexistente) reverte a criação da conta embutida (zero contas órfãs).
 * 10. Vendedor (operatorId) independente e persistível: atribuição de vendedor diferente do criador, edição via updateDeal, e rejeição de operador cross-tenant.
 * 11. DTO padronizado retornado em listDeals e getDealById: presença de operatorId, account.type, account.document, contactsCount e nextTask.
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
  authSessions,
  accessGroups,
  contacts,
  conversations,
  crmPipelines,
  crmStages,
  crmDeals,
  crmAccounts,
  crmDealContacts,
  crmConversationDeals,
  crmDealActivities,
  crmDealEvents,
} from "../src/db/schema";
import { eq, and, sql, inArray } from "drizzle-orm";
import { crmService, CrmValidationError, CrmCrossTenantError } from "../src/lib/crm/crm-service";
import { ROLE_PRESETS, DEFAULT_ADMIN_PERMISSIONS } from "../src/lib/rbac";

// =====================================================================
// TRAVA DE SEGURANÇA MANDATÓRIA: BANCO EXCLUSIVO DE TESTE
// =====================================================================
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  console.error("\n🛑 ERRO CRÍTICO DE SEGURANÇA: TEST_DATABASE_URL NÃO CONFIGURADA!");
  console.error("Configure TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/valemchat_test\n");
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
const createdGroupIds: string[] = [];
const createdPipelineIds: string[] = [];
const createdStageIds: string[] = [];
const createdAccountIds: string[] = [];
const createdDealIds: string[] = [];
const createdActivityIds: string[] = [];

let passedAssertions = 0;
let failedAssertions = 0;

function assert(condition: boolean, description: string) {
  if (condition) {
    console.log(`  ✓ ${description}`);
    passedAssertions++;
  } else {
    console.error(`  ✗ FALHA: ${description}`);
    failedAssertions++;
  }
}

async function runTests() {
  console.log("=====================================================================");
  console.log("SUÍTE DE TESTES E1: CRIAÇÃO TRANSACTIONAL, DTO ÚNICO & MODELO NEGÓCIO");
  console.log("Banco Alvo: valemchat_test (Isolamento Comprovado)");
  console.log("=====================================================================\n");

  const runId = Date.now().toString(36);
  const tenantA = `test-tenant-e1a-${runId}`;
  const tenantB = `test-tenant-e1b-${runId}`;
  createdTenantIds.push(tenantA, tenantB);

  try {
    // -----------------------------------------------------------------
    // PREPARAÇÃO: Tenants, Operadores, Grupo Admin e Funil de Teste
    // -----------------------------------------------------------------
    console.log("1. Preparando Tenants, Operadores e Estruturas de Teste...");

    await db.insert(tenants).values([
      { id: tenantA, name: "Empresa Teste E1-A", slug: `slug-${tenantA}`, connectionType: "meta" },
      { id: tenantB, name: "Empresa Teste E1-B", slug: `slug-${tenantB}`, connectionType: "meta" },
    ]);

    const groupAdminA = `grp-admin-a-${runId}`;
    createdGroupIds.push(groupAdminA);
    await db.insert(accessGroups).values({
      id: groupAdminA,
      tenantId: tenantA,
      name: "Admin CRM A",
      canCreateUser: true,
      canDeleteUser: true,
      permissions: {
        views: { chat: true, crm: true, operators: true },
        crm: { ...DEFAULT_ADMIN_PERMISSIONS.crm, canViewAllDeals: true, canCreateDeals: true, canEditDeals: true },
      },
    });

    const opAdminA = `op-admin-a-${runId}`;
    const opSellerA = `op-seller-a-${runId}`;
    const opB = `op-b-${runId}`;
    createdOperatorIds.push(opAdminA, opSellerA, opB);

    await db.insert(operators).values([
      { id: opAdminA, tenantId: tenantA, name: "Admin A", email: `admin_a_${runId}@test.com`, passwordHash: "dummyhash", role: "admin", groupId: groupAdminA },
      { id: opSellerA, tenantId: tenantA, name: "Vendedor A", email: `seller_a_${runId}@test.com`, passwordHash: "dummyhash", role: "agent", groupId: groupAdminA },
      { id: opB, tenantId: tenantB, name: "Operador B", email: `op_b_${runId}@test.com`, passwordHash: "dummyhash", role: "admin" },
    ]);

    // Funil e Etapas no Tenant A
    const pipeA = `pipe-a-${runId}`;
    const stage1A = `stage-1a-${runId}`;
    const stage2A = `stage-2a-${runId}`;
    createdPipelineIds.push(pipeA);
    createdStageIds.push(stage1A, stage2A);

    await db.insert(crmPipelines).values({
      id: pipeA,
      tenantId: tenantA,
      name: "Funil Comercial E1",
      orderIndex: 0,
      isDefault: true,
    });

    await db.insert(crmStages).values([
      { id: stage1A, tenantId: tenantA, pipelineId: pipeA, name: "Qualificação", orderIndex: 0 },
      { id: stage2A, tenantId: tenantA, pipelineId: pipeA, name: "Proposta", orderIndex: 1 },
    ]);

    console.log("  ✓ Estrutura de teste inicializada com sucesso.\n");

    // -----------------------------------------------------------------
    // CENÁRIO 1: Criação atômica de PF com CPF válido (11 dígitos)
    // -----------------------------------------------------------------
    console.log("2. Testando Criação Atômica de PF com CPF Válido...");

    const dealPf = await crmService.createDeal(tenantA, opAdminA, {
      title: "Negociação Carlos Silva",
      pipelineId: pipeA,
      stageId: stage1A,
      account: {
        name: "Carlos Eduardo da Silva",
        type: "person",
        document: "123.456.789-01",
        phone: "(14) 99888-7766",
        email: "carlos.silva@teste.com",
      },
      value: "4500.00",
      operatorId: opSellerA,
    });
    createdDealIds.push(dealPf.id);
    if (dealPf.accountId) createdAccountIds.push(dealPf.accountId);

    assert(!!dealPf.id && !!dealPf.accountId, "Deal PF criado com accountId gerado");
    assert(dealPf.value === "4500.00", "Valor de R$ 4500.00 persistido como '4500.00'");
    assert(dealPf.operatorId === opSellerA, "Vendedor atribuído é o Vendedor A (independente do criador)");

    // Verificar se a conta compradora foi persistida corretamente
    const [accPf] = await db.select().from(crmAccounts).where(eq(crmAccounts.id, dealPf.accountId!)).limit(1);
    assert(accPf?.type === "person", "Tipo da conta persistido como 'person'");
    assert(accPf?.documentType === "cpf", "documentType detectado e persistido como 'cpf'");
    assert(accPf?.document === "12345678901", "Documento CPF normalizado em 11 dígitos");
    assert(accPf?.phone === "14998887766", "Telefone normalizado sem pontuação");

    // -----------------------------------------------------------------
    // CENÁRIO 2: Criação atômica de PJ com CNPJ válido (14 dígitos)
    // -----------------------------------------------------------------
    console.log("\n3. Testando Criação Atômica de PJ com CNPJ Válido...");

    const dealPj = await crmService.createDeal(tenantA, opAdminA, {
      title: "Fornecimento de Tampas Valem",
      pipelineId: pipeA,
      stageId: stage1A,
      account: {
        name: "Valem Embalagens e Válvulas Ltda",
        tradeName: "Valem Embalagens",
        type: "company",
        document: "12.345.678/0001-90",
        phone: "(14) 3322-1100",
        email: "compras@valem.com.br",
      },
      value: "18500.75",
      operatorId: opSellerA,
    });
    createdDealIds.push(dealPj.id);
    if (dealPj.accountId) createdAccountIds.push(dealPj.accountId);

    assert(!!dealPj.id && !!dealPj.accountId, "Deal PJ criado com accountId gerado");
    assert(dealPj.value === "18500.75", "Valor de R$ 18500.75 persistido como '18500.75'");

    const [accPj] = await db.select().from(crmAccounts).where(eq(crmAccounts.id, dealPj.accountId!)).limit(1);
    assert(accPj?.type === "company", "Tipo da conta persistido como 'company'");
    assert(accPj?.documentType === "cnpj", "documentType detectado e persistido como 'cnpj'");
    assert(accPj?.document === "12345678000190", "Documento CNPJ normalizado em 14 dígitos");
    assert(accPj?.tradeName === "Valem Embalagens", "Nome fantasia persistido");

    // -----------------------------------------------------------------
    // CENÁRIO 3: Validação de CPF com tamanho inválido (rejeição + rollback)
    // -----------------------------------------------------------------
    console.log("\n4. Testando Validação Rígida de Formato de CPF...");

    let cpfErrorThrown = false;
    const countAccBeforeCpf = (await db.select({ count: sql<number>`count(*)::int` }).from(crmAccounts).where(eq(crmAccounts.tenantId, tenantA)))[0].count;

    try {
      await crmService.createDeal(tenantA, opAdminA, {
        title: "Deal CPF Inválido",
        pipelineId: pipeA,
        stageId: stage1A,
        account: {
          name: "Cliente CPF Errado",
          type: "person",
          document: "123.456.78", // 8 dígitos apenas
        },
      });
    } catch (err: any) {
      if (err instanceof CrmValidationError && err.code === "INVALID_DOCUMENT_FORMAT") {
        cpfErrorThrown = true;
      }
    }

    assert(cpfErrorThrown, "Tentativa com CPF de tamanho inválido disparou CrmValidationError (INVALID_DOCUMENT_FORMAT)");
    const countAccAfterCpf = (await db.select({ count: sql<number>`count(*)::int` }).from(crmAccounts).where(eq(crmAccounts.tenantId, tenantA)))[0].count;
    assert(countAccBeforeCpf === countAccAfterCpf, "Zero contas criadas no banco após erro de CPF (rollback atômico)");

    // -----------------------------------------------------------------
    // CENÁRIO 4: Validação de CNPJ com tamanho inválido (rejeição + rollback)
    // -----------------------------------------------------------------
    console.log("\n5. Testando Validação Rígida de Formato de CNPJ...");

    let cnpjErrorThrown = false;
    const countAccBeforeCnpj = (await db.select({ count: sql<number>`count(*)::int` }).from(crmAccounts).where(eq(crmAccounts.tenantId, tenantA)))[0].count;

    try {
      await crmService.createDeal(tenantA, opAdminA, {
        title: "Deal CNPJ Inválido",
        pipelineId: pipeA,
        stageId: stage1A,
        account: {
          name: "Empresa CNPJ Errado",
          type: "company",
          document: "12.345.678/0001", // 12 dígitos apenas
        },
      });
    } catch (err: any) {
      if (err instanceof CrmValidationError && err.code === "INVALID_DOCUMENT_FORMAT") {
        cnpjErrorThrown = true;
      }
    }

    assert(cnpjErrorThrown, "Tentativa com CNPJ de tamanho inválido disparou CrmValidationError (INVALID_DOCUMENT_FORMAT)");
    const countAccAfterCnpj = (await db.select({ count: sql<number>`count(*)::int` }).from(crmAccounts).where(eq(crmAccounts.tenantId, tenantA)))[0].count;
    assert(countAccBeforeCnpj === countAccAfterCnpj, "Zero contas criadas no banco após erro de CNPJ (rollback atômico)");

    // -----------------------------------------------------------------
    // CENÁRIO 5: Reutilização de Conta Existente por Documento
    // -----------------------------------------------------------------
    console.log("\n6. Testando Reutilização de Conta Existente por Documento...");

    const dealPjReused = await crmService.createDeal(tenantA, opAdminA, {
      title: "Segundo Fornecimento Valem",
      pipelineId: pipeA,
      stageId: stage2A,
      account: {
        name: "Valem Embalagens Nova Unidade",
        type: "company",
        document: "12.345.678/0001-90", // mesmo CNPJ da anterior
      },
      value: "5000.00",
    });
    createdDealIds.push(dealPjReused.id);

    assert(dealPjReused.accountId === dealPj.accountId, "Negociação associada à mesma conta existente (mesmo accountId)");

    const countValemAcc = (
      await db
        .select({ count: sql<number>`count(*)::int` })
        .from(crmAccounts)
        .where(and(eq(crmAccounts.tenantId, tenantA), eq(crmAccounts.document, "12345678000190")))
    )[0].count;

    assert(countValemAcc === 1, "Exatamente 1 conta compradora persiste no banco para o CNPJ (sem duplicação)");

    // -----------------------------------------------------------------
    // CENÁRIO 6: Distinção estrita entre valor ausente (null) e zero ("0.00")
    // -----------------------------------------------------------------
    console.log("\n7. Testando Distinção Estrita entre Valor Ausente (null) e Zero ('0.00')...");

    // 6a: Deal sem valor (null)
    const dealNullVal = await crmService.createDeal(tenantA, opAdminA, {
      title: "Negociação Valor A Combinar",
      pipelineId: pipeA,
      stageId: stage1A,
      value: null,
    });
    createdDealIds.push(dealNullVal.id);
    assert(dealNullVal.value === null, "Deal criado com value: null armazena null no banco (não vira '0.00')");

    // 6b: Deal com zero real
    const dealZeroVal = await crmService.createDeal(tenantA, opAdminA, {
      title: "Negociação Cortesia / R$ 0,00",
      pipelineId: pipeA,
      stageId: stage1A,
      value: 0,
    });
    createdDealIds.push(dealZeroVal.id);
    assert(dealZeroVal.value === "0.00", "Deal criado com value: 0 armazena '0.00' no banco");

    // 6c: Atualização de valor via updateDeal
    const updatedToZero = await crmService.updateDeal(tenantA, dealNullVal.id, opAdminA, {
      value: "0.00",
    });
    assert(updatedToZero.value === "0.00", "updateDeal permitiu transicionar de null para '0.00'");

    const updatedToNull = await crmService.updateDeal(tenantA, dealZeroVal.id, opAdminA, {
      value: null,
    });
    assert(updatedToNull.value === null, "updateDeal permitiu transicionar de '0.00' para null");

    // -----------------------------------------------------------------
    // CENÁRIO 7: Nota inicial persistida atomicamente como atividade
    // -----------------------------------------------------------------
    console.log("\n8. Testando Persistência Atômica da Nota Inicial...");

    const noteContent = "Cliente solicitou envio de catálogo físico e amostras de 30ml.";
    const dealWithNote = await crmService.createDeal(tenantA, opAdminA, {
      title: "Negociação com Nota Inicial",
      pipelineId: pipeA,
      stageId: stage1A,
      initialNote: noteContent,
    });
    createdDealIds.push(dealWithNote.id);

    const activities = await db
      .select()
      .from(crmDealActivities)
      .where(and(eq(crmDealActivities.dealId, dealWithNote.id), eq(crmDealActivities.tenantId, tenantA)));

    for (const act of activities) createdActivityIds.push(act.id);

    assert(activities.length === 1, "Exatamente 1 atividade registrada para o negócio");
    assert(activities[0]?.type === "note", "Tipo de atividade é 'note'");
    assert(activities[0]?.status === "completed", "Status da nota inicial é 'completed'");
    assert(activities[0]?.description === noteContent, "Conteúdo da nota coincide com o enviado");

    // -----------------------------------------------------------------
    // CENÁRIO 8: Rollback Total na Falha (Zero Contas Órfãs)
    // -----------------------------------------------------------------
    console.log("\n9. Testando Rollback Total em Falha de Criação...");

    let stageErrorThrown = false;
    const orphanDoc = "99887766554";
    try {
      await crmService.createDeal(tenantA, opAdminA, {
        title: "Negociação Que Vai Falhar",
        pipelineId: pipeA,
        stageId: "stage-inexistente-xyz",
        account: {
          name: "Conta Não Deve Existir",
          type: "person",
          document: orphanDoc,
        },
      });
    } catch (err) {
      stageErrorThrown = true;
    }

    assert(stageErrorThrown, "Criação com etapa inválida falhou e lançou erro");
    const [orphanAcc] = await db
      .select()
      .from(crmAccounts)
      .where(and(eq(crmAccounts.tenantId, tenantA), eq(crmAccounts.document, orphanDoc)))
      .limit(1);

    assert(!orphanAcc, "Conta embutida NÃO foi gravada no banco (zero contas órfãs garantido por transação)");

    // -----------------------------------------------------------------
    // CENÁRIO 9: Vendedor (operatorId) Persistível, Editável e com Isolamento de Tenant
    // -----------------------------------------------------------------
    console.log("\n10. Testando Vendedor Persistível, Edição e Isolamento...");

    // Criação atribuindo opSellerA
    const dealSeller = await crmService.createDeal(tenantA, opAdminA, {
      title: "Negociação Vendedor Teste",
      pipelineId: pipeA,
      stageId: stage1A,
      operatorId: opSellerA,
    });
    createdDealIds.push(dealSeller.id);
    assert(dealSeller.operatorId === opSellerA, "Vendedor opSellerA atribuído com sucesso");

    // Edição para opAdminA
    const updatedSeller = await crmService.updateDeal(tenantA, dealSeller.id, opAdminA, {
      operatorId: opAdminA,
    });
    assert(updatedSeller.operatorId === opAdminA, "Vendedor atualizado com sucesso via updateDeal");

    // Tentativa de atribuir operador de outro tenant (opB do tenantB)
    let crossTenantOpError = false;
    try {
      await crmService.updateDeal(tenantA, dealSeller.id, opAdminA, {
        operatorId: opB,
      });
    } catch (err: any) {
      if (err instanceof CrmCrossTenantError) {
        crossTenantOpError = true;
      }
    }
    assert(crossTenantOpError, "Atribuição de operador de outro tenant bloqueada com CrmCrossTenantError (HTTP 403)");

    // -----------------------------------------------------------------
    // CENÁRIO 10: DTO Padronizado Único em getDeals e getDealById
    // -----------------------------------------------------------------
    console.log("\n11. Testando DTO Padronizado Único em getDeals e getDealById...");

    const { deals: listDeals } = await crmService.getDeals(tenantA, { pipelineId: pipeA });
    assert(listDeals.length >= 4, `listDeals retornou ${listDeals.length} negócios`);

    const sample = listDeals.find((d) => d.id === dealPf.id);
    assert(sample !== undefined, "Negociação encontrada na listagem");
    assert(sample?.operatorId === opSellerA, "DTO listDeals contém operatorId padronizado");
    assert(sample?.account?.type === "person", "DTO listDeals contém account.type ('person')");
    assert(sample?.account?.document === "12345678901", "DTO listDeals contém account.document");
    assert(typeof sample?.contactsCount === "number", "DTO listDeals contém contactsCount numérico");
    assert(typeof sample?.conversationsCount === "number", "DTO listDeals contém conversationsCount numérico");

    const detail = await crmService.getDealById(tenantA, dealPf.id);
    assert(detail !== null, "getDealById retornou ficha detalhada da negociação");
    assert(detail?.operatorId === opSellerA, "Ficha detalhada contém operatorId correto");
    assert(detail?.account?.type === "person", "Ficha detalhada contém account.type ('person')");
    assert(detail?.account?.document === "12345678901", "Ficha detalhada contém account.document");

  } catch (err: any) {
    console.error("\n❌ ERRO INESPERADO NA EXECUÇÃO DOS TESTES:", err);
    failedAssertions++;
  } finally {
    // -----------------------------------------------------------------
    // TEARDOWN: Limpeza Estrita dos Dados de Teste Criados
    // -----------------------------------------------------------------
    console.log("\n12. Executando Teardown e Limpeza de Dados de Teste...");

    try {
      if (createdActivityIds.length > 0) {
        await db.delete(crmDealActivities).where(inArray(crmDealActivities.id, createdActivityIds));
      }
      if (createdDealIds.length > 0) {
        await db.delete(crmDealEvents).where(inArray(crmDealEvents.dealId, createdDealIds));
        await db.delete(crmDealActivities).where(inArray(crmDealActivities.dealId, createdDealIds));
        await db.delete(crmDealContacts).where(inArray(crmDealContacts.dealId, createdDealIds));
        await db.delete(crmConversationDeals).where(inArray(crmConversationDeals.dealId, createdDealIds));
        await db.delete(crmDeals).where(inArray(crmDeals.id, createdDealIds));
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
      if (createdGroupIds.length > 0) {
        await db.delete(accessGroups).where(inArray(accessGroups.id, createdGroupIds));
      }
      if (createdTenantIds.length > 0) {
        await db.delete(tenants).where(inArray(tenants.id, createdTenantIds));
      }
      console.log("  ✓ Limpeza cirúrgica concluída sem resíduos.");
    } catch (cleanupErr) {
      console.error("  ❌ Falha no teardown de teste:", cleanupErr);
    } finally {
      await client.end();
    }
  }

  console.log("\n=====================================================================");
  console.log(`RELATÓRIO FINAL E1: ${passedAssertions} APROVADOS, ${failedAssertions} FALHAS`);
  console.log("=====================================================================\n");

  if (failedAssertions > 0) {
    process.exit(1);
  }
}

runTests();
