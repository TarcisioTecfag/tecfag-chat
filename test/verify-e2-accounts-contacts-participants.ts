/**
 * verify-e2-accounts-contacts-participants.ts
 * 
 * Suíte de Testes Automatizada de E2 (Cliente, Vários Contatos e Participantes da Negociação)
 * Conforme especificado em PLANO-EXECUCAO-CRM-PENDENCIAS.md (Seção 1.2 e E2).
 * 
 * Asserções Automatizadas:
 * 1. Trava de segurança mandatória: execução estrita em valemchat_test.
 * 2. Modelo Cliente 1:N Contatos: conta reúne múltiplos contatos (mínimo 3 contatos vinculados).
 * 3. Contato independente: contato existe validamente sem conta obrigatória (accountId: null).
 * 4. Múltiplos negócios no mesmo cliente: múltiplos cards reutilizam o mesmo accountId.
 * 5. Endpoints de contas (listagem e paginação): busca por termo (nome/documento) e paginação correta.
 * 6. Atualização cadastral de conta: edição de campos e validação de formato e unicidade de documento.
 * 7. Arquivamento suave de conta: soft delete com archivedAt preservando contatos e negócios.
 * 8. Histórico auditável de troca de empresa: transição registrada em crm_contact_account_history
 *    com operador e motivo, SEM reescrever o accountId de negociações anteriores.
 * 9. Gestão de participantes (crm_deal_contacts): adição com papéis distintos, card sem participante,
 *    alternância atômica do contato primário e reeleição automática ao remover o primário.
 * 10. Vínculo de conversa à conta (crm_account_conversations): vínculo auditável com nota de contexto,
 *     enriquecimento de dados (canal, última mensagem) e desvinculação atômica.
 * 11. Isolamento Multi-tenant estrito: rejeição cross-tenant em contas, contatos, conversas e participantes.
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
  crmDealContacts,
  crmAccountConversations,
  crmContactAccountHistory,
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
const createdStageIds: string[] = [];
const createdAccountIds: string[] = [];
const createdDealIds: string[] = [];

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

async function runTestSuite() {
  console.log("\n=====================================================================");
  console.log("SUÍTE DE TESTES E2 — CLIENTE, VÁRIOS CONTATOS E PARTICIPANTES (CRM)");
  console.log("=====================================================================\n");

  try {
    // -----------------------------------------------------------------
    // SETUP: Tenants e Operadores Isolados
    // -----------------------------------------------------------------
    const tenantA = `test-tenant-e2-a-${crypto.randomUUID().slice(0, 8)}`;
    const tenantB = `test-tenant-e2-b-${crypto.randomUUID().slice(0, 8)}`;
    createdTenantIds.push(tenantA, tenantB);

    await db.insert(tenants).values([
      { id: tenantA, name: "Tenant E2 A - Valem Test", slug: `slug-${tenantA}`, connectionType: "meta" },
      { id: tenantB, name: "Tenant E2 B - Tecfag Test", slug: `slug-${tenantB}`, connectionType: "meta" },
    ]);

    const opAId = `op-e2-a-${crypto.randomUUID().slice(0, 8)}`;
    const opBId = `op-e2-b-${crypto.randomUUID().slice(0, 8)}`;
    createdOperatorIds.push(opAId, opBId);

    await db.insert(operators).values([
      {
        id: opAId,
        tenantId: tenantA,
        email: `vendedor_a_${crypto.randomUUID().slice(0, 6)}@test.com`,
        name: "Vendedor Teste A",
        passwordHash: "hash-fake-e2",
        role: "admin",
      },
      {
        id: opBId,
        tenantId: tenantB,
        email: `vendedor_b_${crypto.randomUUID().slice(0, 6)}@test.com`,
        name: "Vendedor Teste B",
        passwordHash: "hash-fake-e2",
        role: "admin",
      },
    ]);

    // Pipeline e Etapas no Tenant A
    const pipeAId = `pipe-e2-${crypto.randomUUID().slice(0, 8)}`;
    createdPipelineIds.push(pipeAId);
    await db.insert(crmPipelines).values({
      id: pipeAId,
      tenantId: tenantA,
      name: "Funil Vendas E2",
      orderIndex: 0,
    });

    const stage1Id = `stage-e2-1-${crypto.randomUUID().slice(0, 8)}`;
    const stage2Id = `stage-e2-2-${crypto.randomUUID().slice(0, 8)}`;
    createdStageIds.push(stage1Id, stage2Id);
    await db.insert(crmStages).values([
      { id: stage1Id, tenantId: tenantA, pipelineId: pipeAId, name: "Primeiro Contato", orderIndex: 0 },
      { id: stage2Id, tenantId: tenantA, pipelineId: pipeAId, name: "Proposta", orderIndex: 1 },
    ]);

    console.log("📦 Setup concluído com sucesso. Iniciando cenários de E2...\n");

    // =================================================================
    // CENÁRIO 1: MODELO CLIENTE 1:N CONTATOS (Mínimo 3 contatos vinculados)
    // =================================================================
    console.log("--- CENÁRIO 1: Modelo Cliente 1:N Contatos ---");
    const accountPJ = await crmService.createAccount(tenantA, {
      name: "Indústria de Cosméticos Alfa Ltda",
      type: "company",
      documentType: "cnpj",
      document: "11222333000181",
      email: "contato@alfaembalagens.com.br",
      phone: "+5511999990001",
      city: "Guarulhos",
      state: "SP",
    });
    createdAccountIds.push(accountPJ.id);

    const contact1Id = `ct-e2-1-${crypto.randomUUID().slice(0, 8)}`;
    const contact2Id = `ct-e2-2-${crypto.randomUUID().slice(0, 8)}`;
    const contact3Id = `ct-e2-3-${crypto.randomUUID().slice(0, 8)}`;
    createdContactIds.push(contact1Id, contact2Id, contact3Id);

    await db.insert(contacts).values([
      { id: contact1Id, tenantId: tenantA, name: "Mariana Gerente Compras", phone: "+5511999991111", mainChannel: "whatsapp", accountId: accountPJ.id },
      { id: contact2Id, tenantId: tenantA, name: "Roberto Engenheiro Embalagem", phone: "+5511999992222", mainChannel: "whatsapp", accountId: accountPJ.id },
      { id: contact3Id, tenantId: tenantA, name: "Carla Diretora Financeira", phone: "+5511999993333", mainChannel: "whatsapp", accountId: accountPJ.id },
    ]);

    const accountWithContacts = await crmService.getAccountById(tenantA, accountPJ.id);
    assert(accountWithContacts !== null, "Conta carregada com sucesso via getAccountById");
    assert(accountWithContacts?.contacts.length === 3, "Conta reúne com sucesso 3 contatos vinculados (1:N)");
    assert(
      accountWithContacts?.contacts.some((c) => c.name === "Mariana Gerente Compras") &&
      accountWithContacts?.contacts.some((c) => c.name === "Roberto Engenheiro Embalagem") &&
      accountWithContacts?.contacts.some((c) => c.name === "Carla Diretora Financeira"),
      "Todos os 3 contatos retornados com nomes e dados corretos"
    );

    // =================================================================
    // CENÁRIO 2: CONTATO INDEPENDENTE (Sem conta obrigatória)
    // =================================================================
    console.log("\n--- CENÁRIO 2: Contato Independente sem Conta Obrigatória ---");
    const contactSoloId = `ct-e2-solo-${crypto.randomUUID().slice(0, 8)}`;
    createdContactIds.push(contactSoloId);
    await db.insert(contacts).values({
      id: contactSoloId,
      tenantId: tenantA,
      name: "Consultor Autônomo Silva",
      phone: "+5511999994444",
      mainChannel: "whatsapp",
      accountId: null,
    });

    const [soloDb] = await db.select().from(contacts).where(eq(contacts.id, contactSoloId));
    assert(soloDb !== undefined, "Contato independente criado no banco");
    assert(soloDb.accountId === null, "Contato independente possui accountId estritamente null sem erros");

    // =================================================================
    // CENÁRIO 3: MÚLTIPLOS CARDS VINCULADOS AO MESMO CLIENTE (Reutilização)
    // =================================================================
    console.log("\n--- CENÁRIO 3: Múltiplas Negociações no Mesmo Cliente ---");
    const deal1 = await crmService.createDeal(tenantA, opAId, {
      title: "Lote 50.000 Válvulas Spray Douradas",
      pipelineId: pipeAId,
      stageId: stage1Id,
      accountId: accountPJ.id,
      value: "45000.00",
      operatorId: opAId,
    });
    createdDealIds.push(deal1.id);

    const deal2 = await crmService.createDeal(tenantA, opAId, {
      title: "Lote 20.000 Frascos Âmbar 100ml",
      pipelineId: pipeAId,
      stageId: stage2Id,
      accountId: accountPJ.id,
      value: "18500.00",
      operatorId: opAId,
    });
    createdDealIds.push(deal2.id);

    const accountWithDeals = await crmService.getAccountById(tenantA, accountPJ.id);
    assert(accountWithDeals?.deals.length === 2, "Conta reúne 2 negociações associadas simultaneamente");
    assert(
      accountWithDeals?.deals.some((d) => d.id === deal1.id && d.value === "45000.00") &&
      accountWithDeals?.deals.some((d) => d.id === deal2.id && d.value === "18500.00"),
      "Negociações associadas preservam valores e identificadores íntegros"
    );

    // =================================================================
    // CENÁRIO 4: BUSCA E PAGINAÇÃO DE CONTAS (listAccounts)
    // =================================================================
    console.log("\n--- CENÁRIO 4: Busca Paginada de Contas ---");
    const searchByName = await crmService.listAccounts(tenantA, { query: "Cosméticos Alfa" });
    assert(searchByName.total >= 1, "Busca de contas por nome retorna resultados válidos");
    assert(searchByName.accounts[0].id === accountPJ.id, "Conta correta encontrada na busca por nome");

    const searchByDoc = await crmService.listAccounts(tenantA, { query: "11.222.333/0001-81" });
    assert(searchByDoc.total >= 1, "Busca de contas por CNPJ formatado sanitiza e encontra a conta");
    assert(searchByDoc.accounts[0].id === accountPJ.id, "Conta correta encontrada na busca por documento");

    const paginated = await crmService.listAccounts(tenantA, { limit: 1, offset: 0 });
    assert(paginated.accounts.length === 1, "Paginação respeita limit especificado");
    assert(paginated.limit === 1 && paginated.offset === 0, "Metadados de paginação (limit, offset) retornados");

    // =================================================================
    // CENÁRIO 5: ATUALIZAÇÃO CADASTRAL DE CONTA & VALIDAÇÕES
    // =================================================================
    console.log("\n--- CENÁRIO 5: Atualização Cadastral e Validação de Documento ---");
    const updatedAccount = await crmService.updateAccount(tenantA, accountPJ.id, {
      name: "Indústria Alfa Cosméticos e Embalagens S/A",
      address: { city: "São Paulo", state: "SP" },
      website: "https://alfacosmeticos.com.br",
    });
    assert(updatedAccount.name === "Indústria Alfa Cosméticos e Embalagens S/A", "Nome da conta atualizado com sucesso");
    assert((updatedAccount.address as any)?.city === "São Paulo", "Cidade atualizada com sucesso no endereço");
    assert(updatedAccount.website === "https://alfacosmeticos.com.br", "Website atualizado com sucesso");

    // Rejeição de CNPJ com tamanho inválido
    let threwInvalidDoc = false;
    try {
      await crmService.updateAccount(tenantA, accountPJ.id, {
        document: "12345", // Menos de 11/14 dígitos
      });
    } catch (e: any) {
      threwInvalidDoc = e instanceof CrmValidationError && e.code === "INVALID_DOCUMENT_FORMAT";
    }
    assert(threwInvalidDoc, "Rejeita atualização com documento em formato inválido (CrmValidationError)");

    // Rejeição de duplicidade no mesmo tenant
    const accountPJ2 = await crmService.createAccount(tenantA, {
      name: "Empresa Beta",
      type: "company",
      documentType: "cnpj",
      document: "99888777000166",
    });
    createdAccountIds.push(accountPJ2.id);

    let threwDuplicateDoc = false;
    try {
      await crmService.updateAccount(tenantA, accountPJ2.id, {
        document: "11222333000181", // Mesmo documento da accountPJ
      });
    } catch (e: any) {
      threwDuplicateDoc = e instanceof CrmValidationError && e.code === "DUPLICATE_DOCUMENT";
    }
    assert(threwDuplicateDoc, "Rejeita atualização que causaria duplicidade de documento no mesmo tenant");

    // =================================================================
    // CENÁRIO 6: ARQUIVAMENTO SUAVE (Soft Delete) DE CONTA
    // =================================================================
    console.log("\n--- CENÁRIO 6: Arquivamento Suave de Conta ---");
    const archived = await crmService.archiveAccount(tenantA, accountPJ2.id);
    assert(archived.archivedAt !== null, "Conta arquivada suavemente com archivedAt preenchido");

    const listWithoutArchived = await crmService.listAccounts(tenantA, { query: "Empresa Beta" });
    assert(listWithoutArchived.accounts.length === 0, "Conta arquivada omitida da listagem padrão");

    const listWithArchived = await crmService.listAccounts(tenantA, { query: "Empresa Beta", includeArchived: true });
    assert(listWithArchived.accounts.length === 1, "Conta arquivada aparece na listagem quando includeArchived: true");

    // =================================================================
    // CENÁRIO 7: TROCA DE EMPRESA DO CONTATO & PRESERVAÇÃO DE NEGÓCIOS
    // =================================================================
    console.log("\n--- CENÁRIO 7: Troca de Empresa com Histórico e Preservação de Deals ---");
    // Mariana Gerente Compras muda para uma nova empresa (Empresa Gama)
    const accountGama = await crmService.createAccount(tenantA, {
      name: "Laboratórios Gama Farmacêutica",
      type: "company",
      documentType: "cnpj",
      document: "44555666000122",
    });
    createdAccountIds.push(accountGama.id);

    const changeResult = await crmService.updateContactAccount(
      tenantA,
      contact1Id,
      accountGama.id,
      "Contratada como Head de Suprimentos na Gama",
      opAId
    );
    assert(changeResult.accountId === accountGama.id, "Retorno da atualização aponta para a nova conta Gama");
    const [updatedContact] = await db.select().from(contacts).where(eq(contacts.id, contact1Id));
    assert(updatedContact.accountId === accountGama.id, "Campo contacts.accountId reflete a nova conta Gama");

    // Verificar histórico de transição
    const historyList = await crmService.getContactAccountHistory(tenantA, contact1Id);
    assert(historyList.length >= 1, "Histórico de contas do contato recuperado com sucesso");
    assert(historyList[0].accountId === accountGama.id, "Registro mais recente aponta para a nova conta");
    assert(historyList[0].accountName === "Laboratórios Gama Farmacêutica", "Nome da conta resolvido no histórico");
    assert(historyList[0].reason === "Contratada como Head de Suprimentos na Gama", "Motivo registrado no histórico");

    // REGRA DE OURO: Negociações antigas (deal1 e deal2) NÃO tiveram seu accountId reescrito!
    const [deal1Check] = await db.select().from(crmDeals).where(eq(crmDeals.id, deal1.id));
    assert(deal1Check.accountId === accountPJ.id, "REGRA DE OURO: Deal histórico mantém accountId da empresa compradora original (não reescrito)");

    // =================================================================
    // CENÁRIO 8: GESTÃO DE PARTICIPANTES DA NEGOCIAÇÃO (crm_deal_contacts)
    // =================================================================
    console.log("\n--- CENÁRIO 8: Gestão de Participantes da Negociação ---");
    // Deal sem participantes inicialmente
    const dealWithoutParticipants = await crmService.createDeal(tenantA, opAId, {
      title: "Negociação Sem Participantes Inicial",
      pipelineId: pipeAId,
      stageId: stage1Id,
    });
    createdDealIds.push(dealWithoutParticipants.id);

    const initialContacts = await crmService.getDealContacts(tenantA, dealWithoutParticipants.id);
    assert(initialContacts.length === 0, "Card comercial criado validamente sem participantes (0 contatos)");

    // Adiciona Participante 1 (Comprador - primeiro adicionado se torna primário automaticamente)
    const partList1 = await crmService.addDealContact(
      tenantA,
      dealWithoutParticipants.id,
      contact1Id,
      "buyer",
      true
    );
    const addedPart1 = partList1.find((p) => p.contactId === contact1Id);
    assert(addedPart1 !== undefined && addedPart1.isPrimary === true, "Participante 1 adicionado como primário com papel 'buyer'");

    // Adiciona Participante 2 (Engenharia Técnica - secundário)
    const partList2 = await crmService.addDealContact(
      tenantA,
      dealWithoutParticipants.id,
      contact2Id,
      "technical",
      false
    );
    const addedPart2 = partList2.find((p) => p.contactId === contact2Id);
    assert(addedPart2 !== undefined && addedPart2.isPrimary === false, "Participante 2 adicionado como secundário com papel 'technical'");

    // Lista participantes da negociação
    const dealParticipants = await crmService.getDealContacts(tenantA, dealWithoutParticipants.id);
    assert(dealParticipants.length === 2, "Negociação possui 2 participantes vinculados");

    // Alternar primário: definir contato 2 como primário
    await crmService.setPrimaryDealContact(tenantA, dealWithoutParticipants.id, contact2Id);
    const updatedParticipants = await crmService.getDealContacts(tenantA, dealWithoutParticipants.id);
    const p1 = updatedParticipants.find((p) => p.contactId === contact1Id);
    const p2 = updatedParticipants.find((p) => p.contactId === contact2Id);
    assert(p2?.isPrimary === true && p1?.isPrimary === false, "Alternância atômica do primário: contato 2 é primário e contato 1 virou secundário");

    // Remover participante primário (contato 2): contato 1 deve ser promovido a primário automaticamente!
    await crmService.removeDealContact(tenantA, dealWithoutParticipants.id, contact2Id);
    const afterRemoval = await crmService.getDealContacts(tenantA, dealWithoutParticipants.id);
    assert(afterRemoval.length === 1, "Participante removido com sucesso");
    assert(afterRemoval[0].contactId === contact1Id && afterRemoval[0].isPrimary === true, "Promoção automática: participante restante foi eleito primário");

    // Remover o último participante: lista fica vazia sem erros
    await crmService.removeDealContact(tenantA, dealWithoutParticipants.id, contact1Id);
    const afterRemovalAll = await crmService.getDealContacts(tenantA, dealWithoutParticipants.id);
    assert(afterRemovalAll.length === 0, "Último participante removido; negociação mantém integridade com 0 participantes");

    // =================================================================
    // CENÁRIO 9: VÍNCULO DE ATENDIMENTO À CONTA (crm_account_conversations)
    // =================================================================
    console.log("\n--- CENÁRIO 9: Vínculo de Atendimento à Conta ---");
    const convId = `conv-e2-${crypto.randomUUID().slice(0, 8)}`;
    createdConversationIds.push(convId);
    await db.insert(conversations).values({
      id: convId,
      tenantId: tenantA,
      contactId: contact2Id,
      queueState: "fila",
    });

    const linkedConv = await crmService.linkAccountConversation(
      tenantA,
      accountPJ.id,
      convId,
      opAId,
      "Conversa inicial de levantamento de requisitos de frascos"
    );
    assert(linkedConv.conversationId === convId, "Atendimento vinculado à conta com sucesso");
    assert(linkedConv.contextNote === "Conversa inicial de levantamento de requisitos de frascos", "Nota de contexto do atendimento persistida");

    const accountConvs = await crmService.getAccountConversations(tenantA, accountPJ.id);
    assert(accountConvs.length >= 1, "Listagem de conversas vinculadas à conta recuperada com sucesso");
    assert(accountConvs[0].conversationId === convId, "Conversa correta listada na ficha da conta");
    assert(accountConvs[0].conversation.contactName === "Roberto Engenheiro Embalagem", "Nome do contato enriquecido na consulta de conversas da conta");

    // Desvinculação da conversa
    const unlinked = await crmService.unlinkAccountConversation(tenantA, accountPJ.id, convId);
    assert(unlinked.success === true, "Atendimento desvinculado da conta com sucesso");
    const accountConvsAfter = await crmService.getAccountConversations(tenantA, accountPJ.id);
    assert(accountConvsAfter.length === 0, "Lista de conversas da conta reflete desvinculação atômica");

    // =================================================================
    // CENÁRIO 10: ISOLAMENTO MULTI-TENANT ESTRITO
    // =================================================================
    console.log("\n--- CENÁRIO 10: Isolamento Multi-Tenant Estrito ---");
    // Tenant B tentando ler conta do Tenant A
    let crossTenantGetBlocked = false;
    try {
      await crmService.getAccountById(tenantB, accountPJ.id);
    } catch (e: any) {
      crossTenantGetBlocked = e instanceof CrmNotFoundError;
    }
    assert(crossTenantGetBlocked, "Isolamento: Tenant B bloqueado ao tentar carregar conta do Tenant A (CrmNotFoundError)");

    // Tenant B tentando atualizar conta do Tenant A
    let crossUpdateError = false;
    try {
      await crmService.updateAccount(tenantB, accountPJ.id, { name: "Hack Tenant B" });
    } catch (e: any) {
      crossUpdateError = e instanceof CrmNotFoundError;
    }
    assert(crossUpdateError, "Isolamento: Tenant B bloqueado ao tentar atualizar conta do Tenant A (CrmNotFoundError)");

    // Tentativa de vincular contato de outro tenant a uma conta
    const contactTenantBId = `ct-e2-tb-${crypto.randomUUID().slice(0, 8)}`;
    createdContactIds.push(contactTenantBId);
    await db.insert(contacts).values({
      id: contactTenantBId,
      tenantId: tenantB,
      name: "Contato Pertencente ao Tenant B",
      phone: "+5511999998888",
      mainChannel: "whatsapp",
    });

    let crossContactError = false;
    try {
      await crmService.updateContactAccount(tenantA, contactTenantBId, accountPJ.id, "Tentativa indevida", opAId);
    } catch (e: any) {
      crossContactError = e instanceof CrmNotFoundError || e instanceof CrmCrossTenantError;
    }
    assert(crossContactError, "Isolamento: Rejeita vínculo de contato do Tenant B com conta do Tenant A (CrmNotFoundError / CrmCrossTenantError)");

    // Tentativa de associar contato do Tenant A com conta pertencente ao Tenant B
    const accountTenantB = await crmService.createAccount(tenantB, {
      name: "Conta Exclusiva Tenant B",
      type: "company",
    });
    createdAccountIds.push(accountTenantB.id);

    let crossAccountError = false;
    try {
      await crmService.updateContactAccount(tenantA, contact1Id, accountTenantB.id, "Tentativa cross-tenant", opAId);
    } catch (e: any) {
      crossAccountError = e instanceof CrmCrossTenantError;
    }
    assert(crossAccountError, "Isolamento: Rejeita associar contato do Tenant A à conta do Tenant B (CrmCrossTenantError)");

    // Tentativa de adicionar participante de outro tenant a deal
    let crossParticipantError = false;
    try {
      await crmService.addDealContact(
        tenantA,
        deal1.id,
        contactTenantBId,
        "buyer"
      );
    } catch (e: any) {
      crossParticipantError = e instanceof CrmCrossTenantError;
    }
    assert(crossParticipantError, "Isolamento: Rejeita participante de outro tenant na negociação (CrmCrossTenantError)");

  } catch (error: any) {
    console.error("\n❌ ERRO INESPERADO NA EXECUÇÃO DOS TESTES:", error);
    failedAssertions++;
  } finally {
    // -----------------------------------------------------------------
    // TEARDOWN: Limpeza Cirúrgica em valemchat_test
    // -----------------------------------------------------------------
    console.log("\n🧹 Executando Teardown cirúrgico em valemchat_test...");
    try {
      if (createdDealIds.length > 0) {
        await db.delete(crmDealContacts).where(inArray(crmDealContacts.dealId, createdDealIds));
        await db.delete(crmDealActivities).where(inArray(crmDealActivities.dealId, createdDealIds));
        await db.delete(crmDealEvents).where(inArray(crmDealEvents.dealId, createdDealIds));
        await db.delete(crmDeals).where(inArray(crmDeals.id, createdDealIds));
      }
      if (createdAccountIds.length > 0) {
        await db.delete(crmAccountConversations).where(inArray(crmAccountConversations.accountId, createdAccountIds));
        await db.delete(crmContactAccountHistory).where(inArray(crmContactAccountHistory.accountId, createdAccountIds));
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
      console.log("✓ Teardown concluído com sucesso.");
    } catch (cleanErr) {
      console.error("Erro durante teardown:", cleanErr);
    } finally {
      await client.end();
    }
  }

  // -----------------------------------------------------------------
  // RELATÓRIO FINAL DE ASSERÇÕES
  // -----------------------------------------------------------------
  console.log("\n=====================================================================");
  console.log(`TOTAL DE ASSERÇÕES: ${passedAssertions + failedAssertions}`);
  console.log(`✓ PASSOU: ${passedAssertions}`);
  console.log(`✗ FALHOU: ${failedAssertions}`);
  console.log("=====================================================================\n");

  if (failedAssertions > 0) {
    process.exit(1);
  }
}

runTestSuite();
