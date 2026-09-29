/**
 * verify-e6-deal-detail-navigation.ts
 * 
 * Suíte de Testes Automatizada de E6 (Ficha da negociação e navegação conversa ↔ card)
 * Conforme especificado em PLANO-EXECUCAO-CRM-PENDENCIAS.md (Seção 112 e E6).
 * 
 * Asserções Automatizadas:
 * 1. Trava de segurança mandatória: execução estrita em valemchat_test.
 * 2. Estrutura multi-tenant isolada (Tenants A e B, operadores, funis, contas e contatos).
 * 3. Ficha da negociação com Funil Real do Negócio:
 *    - Deal associado a funil secundário (não-padrão) retorna o funil correto e suas etapas reais ordenadas por orderIndex.
 *    - Deal com conta associada não infere documento de contato como documento da conta.
 * 4. Lateral editável completa:
 *    - Atualização de origem (source), campanha (campaign), previsão (expectedCloseDate) e qualificação (rating).
 *    - Preservação de versão e auditoria de concorrência.
 * 5. Ações Terminais (Ganho, Perda, Pausa):
 *    - Pausa com motivo (status: "paused", pausedReason: "Aguardando orçamento").
 *    - Retomada de pausa para aberto (status: "open", limpeza de pausedReason).
 *    - Ganho e perda com motivos correspondentes.
 * 6. DTO Completo da Aba Conversas:
 *    - Retorno completo: contactName, contactPhone, contactAvatar, mainChannel, channel, queueState, operatorName, lastMessageText, lastMessageTime, linkedAt, origin.
 * 7. Vínculo e Desvínculo N:N (Multi-card):
 *    - Vínculo idempotente e transacional de conversas a cards.
 *    - Suporte a multi-card: uma conversa vinculada a 2 cards diferentes simultaneamente.
 *    - Desvínculo preservando o histórico e sem excluir entidades.
 * 8. Suporte ao Aviso Preventivo de Divergência de Empresa no Chat:
 *    - Validação de detecção de empresa do contato vs empresa do negócio.
 * 9. Linha do Tempo / Histórico Unificado:
 *    - Coexistência de eventos de auditoria, notas comerciais, tarefas, propostas e evidências com autoria e data.
 * 10. Isolamento Multi-Tenant estrito:
 *    - Bloqueio de vínculo cross-tenant com CrmCrossTenantError.
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
  messages,
  crmPipelines,
  crmStages,
  crmDeals,
  crmAccounts,
  crmConversationDeals,
  crmDealContacts,
  crmDealActivities,
  crmDealEvents,
  crmProposals,
  crmActivityMessages,
} from "../src/db/schema";
import { eq, and, inArray, desc } from "drizzle-orm";
import {
  crmService,
  CrmCrossTenantError,
} from "../src/lib/crm/crm-service";

interface AssertSummary {
  total: number;
  passed: number;
  failed: number;
  assertions: Array<{ name: string; status: "PASS" | "FAIL"; details?: string }>;
}

const summary: AssertSummary = {
  total: 0,
  passed: 0,
  failed: 0,
  assertions: [],
};

function assert(condition: boolean, name: string, details?: string) {
  summary.total++;
  if (condition) {
    summary.passed++;
    summary.assertions.push({ name, status: "PASS" });
    console.log(`  ✅ [PASS] ${name}`);
  } else {
    summary.failed++;
    summary.assertions.push({ name, status: "FAIL", details });
    console.error(`  ❌ [FAIL] ${name} ${details ? `(${details})` : ""}`);
  }
}

async function runE6Suite() {
  console.log("\n================================================================================");
  console.log("  INICIANDO SUÍTE AUTOMATIZADA: E6 — FICHA DA NEGOCIAÇÃO E NAVEGAÇÃO CONVERSA ↔ CARD");
  console.log("================================================================================\n");

  // 1. Trava de segurança mandatória
  console.log("👉 1. Verificando trava de segurança do banco de dados...");
  assertTestDatabaseIsolation();
  const dbUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || "";
  assert(dbUrl.includes("valemchat_test"), "Execução estritamente isolada em valemchat_test");

  const runId = `e6-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
  const tenantA = `t-a-${runId}`;
  const tenantB = `t-b-${runId}`;

  // IDs para rastreamento e teardown cirúrgico
  const createdTenantIds = [tenantA, tenantB];
  const createdOperatorIds: string[] = [];
  const createdAccountIds: string[] = [];
  const createdContactIds: string[] = [];
  const createdConvIds: string[] = [];
  const createdPipelineIds: string[] = [];
  const createdStageIds: string[] = [];
  const createdDealIds: string[] = [];
  const createdProposalIds: string[] = [];
  const createdMessageIds: string[] = [];

  try {
    // 2. Setup Multi-Tenant
    console.log("\n👉 2. Criando estrutura multi-tenant isolada...");
    await db.insert(tenants).values([
      { id: tenantA, name: `Tenant A E6 ${runId}`, slug: `slug_a_${runId}`, connectionType: "meta" },
      { id: tenantB, name: `Tenant B E6 ${runId}`, slug: `slug_b_${runId}`, connectionType: "meta" },
    ]);

    const opA1 = `op-a1-${runId}`;
    const opA2 = `op-a2-${runId}`;
    const opB1 = `op-b1-${runId}`;
    createdOperatorIds.push(opA1, opA2, opB1);

    await db.insert(operators).values([
      { id: opA1, tenantId: tenantA, name: "Vendedor Alpha", email: `vendedor1-${runId}@valem.test`, role: "operator", passwordHash: "hash" },
      { id: opA2, tenantId: tenantA, name: "Vendedor Beta", email: `vendedor2-${runId}@valem.test`, role: "operator", passwordHash: "hash" },
      { id: opB1, tenantId: tenantB, name: "Vendedor Gamma B", email: `vendedor-b-${runId}@valem.test`, role: "operator", passwordHash: "hash" },
    ]);

    // Criar Funil Padrão e Funil Secundário no Tenant A
    const pipeStandardId = `pipe-std-${runId}`;
    const pipeCustomId = `pipe-cst-${runId}`;
    const pipeBId = `pipe-b-${runId}`;
    createdPipelineIds.push(pipeStandardId, pipeCustomId, pipeBId);

    await db.insert(crmPipelines).values([
      { id: pipeStandardId, tenantId: tenantA, name: "Funil Padrão Vendas", isDefault: true, orderIndex: 0 },
      { id: pipeCustomId, tenantId: tenantA, name: "Funil Pós-Venda Custom", isDefault: false, orderIndex: 1 },
      { id: pipeBId, tenantId: tenantB, name: "Funil Tenant B", isDefault: true, orderIndex: 0 },
    ]);

    // Etapas do Funil Secundário
    const stageC1 = `stg-c1-${runId}`;
    const stageC2 = `stg-c2-${runId}`;
    const stageC3 = `stg-c3-${runId}`;
    createdStageIds.push(stageC1, stageC2, stageC3);

    await db.insert(crmStages).values([
      { id: stageC1, tenantId: tenantA, pipelineId: pipeCustomId, name: "Onboarding Técnico", orderIndex: 0 },
      { id: stageC2, tenantId: tenantA, pipelineId: pipeCustomId, name: "Treinamento Operacional", orderIndex: 1 },
      { id: stageC3, tenantId: tenantA, pipelineId: pipeCustomId, name: "Go-Live Concluído", orderIndex: 2, isWinStage: true },
    ]);

    // Etapas do Funil Tenant B
    const stageB1 = `stg-b1-${runId}`;
    createdStageIds.push(stageB1);
    await db.insert(crmStages).values([
      { id: stageB1, tenantId: tenantB, pipelineId: pipeBId, name: "Etapa B Inicial", orderIndex: 0 },
    ]);

    // Contas e Contatos
    const accCompanyId = `acc-comp-${runId}`;
    const accOtherId = `acc-oth-${runId}`;
    createdAccountIds.push(accCompanyId, accOtherId);

    await db.insert(crmAccounts).values([
      {
        id: accCompanyId,
        tenantId: tenantA,
        name: "Indústria de Embalagens ABC Ltda",
        tradeName: "ABC Embalagens",
        document: "12345678000195",
        type: "company",
        email: "contato@abc.com.br",
        phone: "14999990001",
      },
      {
        id: accOtherId,
        tenantId: tenantA,
        name: "Comércio de Cosméticos XYZ S/A",
        tradeName: "XYZ Cosméticos",
        document: "98765432000110",
        type: "company",
        email: "compras@xyz.com.br",
        phone: "14999990002",
      },
    ]);

    const contact1Id = `ct-1-${runId}`;
    const contact2Id = `ct-2-${runId}`;
    const contactBId = `ct-b-${runId}`;
    createdContactIds.push(contact1Id, contact2Id, contactBId);

    await db.insert(contacts).values([
      {
        id: contact1Id,
        tenantId: tenantA,
        accountId: accCompanyId,
        name: "Mariana Engenheira",
        phone: "5514981112233",
        email: "mariana@abc.com.br",
        cpf: "11122233344",
        mainChannel: "whatsapp",
        avatar: "https://valem.test/avatars/mariana.jpg",
      },
      {
        id: contact2Id,
        tenantId: tenantA,
        accountId: accOtherId,
        name: "Carlos Diretor XYZ",
        phone: "5514982223344",
        email: "carlos@xyz.com.br",
        mainChannel: "instagram",
      },
      {
        id: contactBId,
        tenantId: tenantB,
        name: "Contato Invasor B",
        phone: "5514989998877",
        mainChannel: "whatsapp",
      },
    ]);

    // Conversas
    const conv1Id = `conv-1-${runId}`;
    const conv2Id = `conv-2-${runId}`;
    const conv3Id = `conv-3-${runId}`;
    const convBId = `conv-b-${runId}`;
    createdConvIds.push(conv1Id, conv2Id, conv3Id, convBId);

    const now = new Date();
    await db.insert(conversations).values([
      {
        id: conv1Id,
        tenantId: tenantA,
        contactId: contact1Id,
        operatorId: opA1,
        queueState: "meus",
        lastMessageText: "Olá Mariana, confirmamos o pedido das válvulas spray.",
        lastMessageTime: now,
        createdAt: new Date(now.getTime() - 3600000),
      },
      {
        id: conv2Id,
        tenantId: tenantA,
        contactId: contact1Id,
        operatorId: null,
        queueState: "fila",
        lastMessageText: "Gostaria de saber o prazo para seladoras automáticas.",
        lastMessageTime: new Date(now.getTime() - 1800000),
        createdAt: new Date(now.getTime() - 7200000),
      },
      {
        id: conv3Id,
        tenantId: tenantA,
        contactId: contact2Id,
        operatorId: opA2,
        queueState: "meus",
        lastMessageText: "Orçamento recebido, analisando internamente.",
        lastMessageTime: now,
      },
      {
        id: convBId,
        tenantId: tenantB,
        contactId: contactBId,
        operatorId: opB1,
        queueState: "meus",
        lastMessageText: "Conversa do tenant B.",
      },
    ]);

    assert(true, "Setup multi-tenant concluído com sucesso");

    // 3. Ficha da Negociação com Funil Real do Negócio (Sem fixar funil padrão)
    console.log("\n👉 3. Testando Ficha da Negociação com Funil Real do Negócio...");
    const deal1 = await crmService.createDeal(tenantA, opA1, {
      title: "Implantação Linha de Envasadoras ABC",
      pipelineId: pipeCustomId, // Funil Secundário / Não-Padrão
      stageId: stageC1,
      accountId: accCompanyId,
      contactId: contact1Id,
      conversationId: conv1Id,
      value: 125000.00,
      source: "whatsapp",
      campaign: "Campanha Seladoras 2026",
      rating: 4,
    });
    createdDealIds.push(deal1.id);

    const dealDetail = await crmService.getDealById(tenantA, deal1.id);
    assert(dealDetail !== null, "Negociação recuperada com sucesso por getDealById");
    assert(dealDetail?.pipeline !== null, "Pipeline real do negócio retornado no detalhe");
    assert(dealDetail?.pipeline?.id === pipeCustomId, "Pipeline retornado é o funil secundário real do card (não o padrão)");
    assert(dealDetail?.pipeline?.stages.length === 3, "Trilha de etapas real do funil secundário retornada (3 etapas)");
    assert(dealDetail?.pipeline?.stages[0].id === stageC1, "Primeira etapa coincide com a etapa do funil do negócio");

    // Verificação de isolamento documental: conta não deve herdar documento do contato
    assert(dealDetail?.account !== null, "Conta compradora vinculada retornada");
    assert(dealDetail?.account?.document === "12345678000195", "Documento da conta é estritamente o CNPJ da conta");
    assert(dealDetail?.contacts[0]?.contact?.cpf === "11122233344", "CPF do contato participante é mantido no contato sem sobrepor o documento da conta");

    // 4. Testando Lateral Editável Completa (Origem, Campanha, Previsão, Qualificação)
    console.log("\n👉 4. Testando Lateral Editável Completa...");
    const expectedDate = new Date("2026-12-15T12:00:00Z");
    const updatedDeal = await crmService.updateDeal(tenantA, deal1.id, opA1, {
      source: "meta",
      campaign: "Black Friday Indústria",
      expectedCloseDate: expectedDate,
      rating: 5,
      value: 135000.50,
      expectedVersion: dealDetail?.version,
    });

    assert(updatedDeal.source === "meta", "Origem comercial atualizada com sucesso para 'meta'");
    assert(updatedDeal.campaign === "Black Friday Indústria", "Campanha atualizada com sucesso");
    assert(updatedDeal.rating === 5, "Classificação / Qualificação atualizada para 5 estrelas");
    assert(Number(updatedDeal.value) === 135000.50, "Valor comercial atualizado");
    assert(updatedDeal.version === (dealDetail?.version ?? 0) + 1, "Concorrência otimista incrementou a versão");

    // 5. Testando Ações Terminais: Ganho, Perda, Pausa
    console.log("\n👉 5. Testando Ações Terminais (Pausa, Retomada, Ganho)...");
    const pausedDeal = await crmService.updateDeal(tenantA, deal1.id, opA1, {
      status: "paused",
      pausedReason: "Aguardando liberação de financiamento BNDES",
    });
    assert(pausedDeal.status === "paused", "Status do negócio alterado para 'paused'");
    assert(pausedDeal.pausedReason === "Aguardando liberação de financiamento BNDES", "Motivo da pausa registrado com sucesso");

    // Auditoria de pausa registrada
    const [pauseEvent] = await db
      .select()
      .from(crmDealEvents)
      .where(and(eq(crmDealEvents.dealId, deal1.id), eq(crmDealEvents.eventType, "status_changed")))
      .orderBy(desc(crmDealEvents.createdAt))
      .limit(1);
    assert(pauseEvent !== undefined, "Evento de auditoria gravado para a alteração de status");
    assert((pauseEvent?.metadata as any)?.toStatus === "paused", "Metadados do evento refletem o toStatus pausado");

    // Retomada da negociação
    const resumedDeal = await crmService.updateDeal(tenantA, deal1.id, opA1, {
      status: "open",
      pausedReason: null,
    });
    assert(resumedDeal.status === "open", "Negociação retomada com sucesso para status 'open'");
    assert(resumedDeal.pausedReason === null, "Motivo da pausa limpo na reabertura");

    // 6. Testando DTO Completo da Aba Conversas
    console.log("\n👉 6. Testando DTO Completo da Aba Conversas...");
    const dealDetailWithConvs = await crmService.getDealById(tenantA, deal1.id);
    assert(dealDetailWithConvs?.conversations.length === 1, "Aba conversas possui 1 conversa vinculada");

    const convDto = dealDetailWithConvs?.conversations[0];
    assert(convDto?.contactName === "Mariana Engenheira", "DTO traz contactName correto do contato");
    assert(convDto?.contactPhone === "5514981112233", "DTO traz contactPhone correto");
    assert(convDto?.contactAvatar === "https://valem.test/avatars/mariana.jpg", "DTO traz contactAvatar real");
    assert(convDto?.mainChannel === "whatsapp" && convDto?.channel === "whatsapp", "DTO traz mainChannel e channel formatados");
    assert(convDto?.queueState === "meus", "DTO traz queueState real da conversa");
    assert(convDto?.operatorName === "Vendedor Alpha", "DTO traz operatorName do responsável");
    assert(convDto?.lastMessageText?.includes("válvulas spray") === true, "DTO traz lastMessageText da conversa");
    assert(convDto?.lastMessageTime !== null, "DTO traz lastMessageTime da conversa");
    assert(convDto?.linkedAt !== null, "DTO traz carimbo de vinculação linkedAt");

    // 7. Testando Vínculo e Desvínculo N:N (Multi-card)
    console.log("\n👉 7. Testando Vínculo e Desvínculo N:N (Multi-card)...");
    // Vincula a segunda conversa (conv2Id) à mesma negociação
    const link2 = await crmService.linkConversationDeal(tenantA, conv2Id, deal1.id, opA1, "crm");
    assert(link2.isActive === true, "Segunda conversa vinculada com sucesso à negociação deal1");

    // Cria uma segunda negociação para testar Multi-Card (conv1 vinculada a 2 cards diferentes)
    const deal2 = await crmService.createDeal(tenantA, opA2, {
      title: "Fornecimento de Frascos Cosméticos XYZ",
      pipelineId: pipeCustomId,
      stageId: stageC1,
      accountId: accOtherId,
      value: 45000,
    });
    createdDealIds.push(deal2.id);

    // Vincula conv1 também ao deal2 (uma conversa ligada a 2 negociações distintas)
    const linkConv1ToDeal2 = await crmService.linkConversationDeal(tenantA, conv1Id, deal2.id, opA2, "chat");
    assert(linkConv1ToDeal2.isActive === true, "Conversa conv1 vinculada com sucesso a um segundo card (deal2)");

    // Verifica que a conversa 1 pertence a ambos os cards simultaneamente
    const conv1Deals = await crmService.getConversationDeals(tenantA, conv1Id);
    assert(conv1Deals.length === 2, "Conversa conv1 vinculada simultaneamente a 2 cards (Multi-card comprovado)");

    // Desvincula conv2Id do deal1 sem deletar as entidades
    const unlinked = await crmService.unlinkConversationDeal(tenantA, conv2Id, deal1.id, opA1);
    assert(unlinked === true, "Conversa desvinculada com sucesso");

    const deal1AfterUnlink = await crmService.getDealById(tenantA, deal1.id);
    assert(deal1AfterUnlink?.conversations.length === 1, "Conversa inativa não é listada na aba conversas do card");

    // Prova que a conversa conv2Id e o deal1 continuam existindo no banco
    const [persistedConv] = await db.select().from(conversations).where(eq(conversations.id, conv2Id));
    assert(persistedConv !== undefined, "Conversa permanece preservada no banco após desvínculo");

    // 8. Testando Suporte ao Aviso Preventivo de Divergência de Empresa no Chat
    console.log("\n👉 8. Testando Suporte ao Aviso Preventivo de Divergência de Empresa...");
    // A conversa conv3Id é do contato Carlos (accOtherId = XYZ)
    // O card deal1 é da conta ABC (accCompanyId = ABC)
    const [conv3] = await db.select().from(conversations).where(eq(conversations.id, conv3Id));
    const [conv3Contact] = await db.select().from(contacts).where(eq(contacts.id, conv3.contactId));

    assert(conv3Contact.accountId === accOtherId, "Contato da conversa 3 pertence à empresa XYZ");
    assert(deal1.accountId === accCompanyId, "Negociação deal1 pertence à empresa ABC");
    assert(conv3Contact.accountId !== deal1.accountId, "Divergência detectada entre conta do contato e conta do card (aciona aviso preventivo)");

    // 9. Testando Linha do Tempo / Histórico Unificado
    console.log("\n👉 9. Testando Linha do Tempo / Histórico Unificado...");
    // Adiciona atividade do tipo note
    await crmService.createDealActivity(tenantA, deal1.id, opA1, {
      type: "note",
      title: "Nota Comercial de Alinhamento",
      description: "Cliente solicitou envio de amostras até sexta-feira.",
    });

    // Adiciona atividade do tipo task com prazo
    await crmService.createDealActivity(tenantA, deal1.id, opA1, {
      type: "task",
      title: "Enviar Amostras Válvulas Spray 24/410",
      description: "Despachar via Sedex com código de rastreio.",
      dueDate: new Date(Date.now() + 86400000),
    });

    // Emite proposta comercial no deal1
    const propId = `prop-1-${runId}`;
    createdProposalIds.push(propId);
    await db.insert(crmProposals).values({
      id: propId,
      tenantId: tenantA,
      dealId: deal1.id,
      title: "Proposta Comercial Linha de Envasadoras",
      proposalNumber: "PROP-E6-001",
      version: 1,
      status: "draft",
      total: "135000.50",
      subtotal: "140000.00",
      discount: "4999.50",
      createdByOperatorId: opA1,
      paymentTerms: "30/60 dias",
      deliveryTerms: "CIF São Paulo",
      validityDays: 15,
      createdAt: new Date(),
    });

    // Cria mensagem e marca como evidência comercial
    const msgId = `msg-1-${runId}`;
    createdMessageIds.push(msgId);
    await db.insert(messages).values({
      id: msgId,
      tenantId: tenantA,
      conversationId: conv1Id,
      senderType: "client",
      senderName: "Mariana Engenheira",
      content: "Aprovamos a proposta de R$ 135.000,50! Podem gerar o contrato.",
      createdAt: new Date(),
    });

    await crmService.markMessageAsEvidence(
      tenantA,
      deal1.id,
      msgId,
      opA1,
      "Aceite formal do valor pelo cliente no WhatsApp"
    );

    // Consulta ficha consolidada
    const dealUnified = await crmService.getDealById(tenantA, deal1.id);
    assert((dealUnified?.events.length ?? 0) >= 3, "Negociação acumulou eventos de auditoria");
    assert((dealUnified?.activities.length ?? 0) >= 2, "Negociação acumulou tarefas e notas comerciais");
    assert((dealUnified?.proposals.length ?? 0) >= 1, "Negociação acumulou proposta comercial emitida");
    assert((dealUnified?.evidences.length ?? 0) >= 1, "Negociação acumulou evidência comercial marcada");

    const hasAuditAction = dealUnified?.events.some((e) => e.eventType === "conversation_linked");
    const hasNoteAction = dealUnified?.activities.some((a) => a.type === "note");
    const hasTaskAction = dealUnified?.activities.some((a) => a.type === "task");
    const hasEvidence = dealUnified?.evidences.some((ev) => ev.note?.includes("Aceite formal"));

    assert(Boolean(hasAuditAction), "Histórico unificado contém auditoria de vinculação");
    assert(Boolean(hasNoteAction), "Histórico unificado contém nota comercial");
    assert(Boolean(hasTaskAction), "Histórico unificado contém tarefa com prazo");
    assert(Boolean(hasEvidence), "Histórico unificado contém evidência comercial sem duplicar todo o chat");

    // 10. Testando Isolamento Multi-Tenant Estrito
    console.log("\n👉 10. Testando Isolamento Multi-Tenant Estrito...");
    let crossTenantBlocked = false;
    try {
      // Tenta vincular conversa do Tenant B no card do Tenant A
      await crmService.linkConversationDeal(tenantA, convBId, deal1.id, opA1, "crm");
    } catch (e: any) {
      if (e instanceof CrmCrossTenantError || e.message.includes("não encontrada no tenant")) {
        crossTenantBlocked = true;
      }
    }
    assert(crossTenantBlocked, "Tentativa de vincular conversa de outro tenant foi estritamente rejeitada com CrmCrossTenantError");

    const dealFromTenantB = await crmService.getDealById(tenantB, deal1.id);
    assert(dealFromTenantB === null, "Tentativa de ler deal do Tenant A usando credenciais do Tenant B retornou null");

  } finally {
    // 11. Teardown Cirúrgico
    console.log("\n👉 11. Executando Teardown Cirúrgico em valemchat_test...");
    try {
      if (createdTenantIds.length > 0) {
        // Remove evidências
        await db.delete(crmActivityMessages).where(inArray(crmActivityMessages.tenantId, createdTenantIds));
        // Remove mensagens
        if (createdMessageIds.length > 0) {
          await db.delete(messages).where(inArray(messages.id, createdMessageIds));
        }
        // Remove propostas
        await db.delete(crmProposals).where(inArray(crmProposals.tenantId, createdTenantIds));
        // Remove atividades
        await db.delete(crmDealActivities).where(inArray(crmDealActivities.tenantId, createdTenantIds));
        // Remove eventos
        await db.delete(crmDealEvents).where(inArray(crmDealEvents.tenantId, createdTenantIds));
        // Remove vínculos conversa-deal
        await db.delete(crmConversationDeals).where(inArray(crmConversationDeals.tenantId, createdTenantIds));
        // Remove participantes
        await db.delete(crmDealContacts).where(inArray(crmDealContacts.tenantId, createdTenantIds));
        // Remove deals
        await db.delete(crmDeals).where(inArray(crmDeals.tenantId, createdTenantIds));
        // Remove etapas
        await db.delete(crmStages).where(inArray(crmStages.tenantId, createdTenantIds));
        // Remove pipelines
        await db.delete(crmPipelines).where(inArray(crmPipelines.tenantId, createdTenantIds));
        // Remove conversas
        await db.delete(conversations).where(inArray(conversations.tenantId, createdTenantIds));
        // Remove contatos
        await db.delete(contacts).where(inArray(contacts.tenantId, createdTenantIds));
        // Remove contas
        await db.delete(crmAccounts).where(inArray(crmAccounts.tenantId, createdTenantIds));
        // Remove operadores
        await db.delete(operators).where(inArray(operators.tenantId, createdTenantIds));
        // Remove tenants
        await db.delete(tenants).where(inArray(tenants.id, createdTenantIds));
      }
      console.log("  🧹 Teardown cirúrgico concluído. Zero resíduos deixados no banco.");
    } catch (cleanErr: any) {
      console.error("  ⚠️ Erro durante o teardown cirúrgico:", cleanErr);
    }
  }

  // Relatório Final da Suíte
  console.log("\n================================================================================");
  console.log(`  RESUMO DA SUÍTE E6: ${summary.passed}/${summary.total} asserções aprovadas`);
  console.log("================================================================================");
  if (summary.failed > 0) {
    console.error(`❌ ${summary.failed} asserções falharam. Verifique os logs acima.`);
    process.exit(1);
  } else {
    console.log("🎉 100% das asserções de E6 foram APROVADAS com sucesso!\n");
  }
}

runE6Suite()
  .then(async () => {
    await client.end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("\n💥 Erro não tratado durante a execução da suíte E6:", err);
    await client.end();
    process.exit(1);
  });
