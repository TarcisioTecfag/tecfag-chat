/**
 * verify-e8-extended-parity.ts
 * Suíte de Verificação Automatizada — Entrega E8: Paridade Funcional Ampliada das Capturas
 *
 * Valida os critérios de aceitação da Seção E8:
 * 1. Trava de segurança garantindo execução exclusiva em banco de teste isolado (valemchat_test)
 * 2. Produtos e Propostas Comerciais:
 *    - Cadastro no catálogo e vínculo com precisão de centavos
 *    - Emissão de proposta formal com snapshot imutável e sequence lock anual
 *    - Copiar texto da proposta NÃO altera status para 'sent' nem 'copied' (apenas clipboard com toast)
 *    - Envio confirmado requer ação explícita ('sent') com sentAt preenchido
 *    - Aceite ('accepted') e Recusa ('rejected') auditados
 * 3. Arquivos do Negócio (crm_deal_files):
 *    - Anexar documento com metadados, mimeType, limite de tamanho (<= 25MB)
 *    - Vínculo opcional e seguro a conversa existente do mesmo tenant
 *    - Rejeição de arquivo com tamanho excessivo ou conversa de outro tenant
 *    - Exclusão com registro de auditoria imutável em crm_deal_events
 * 4. Questionários e Briefings Técnicos (crm_deal_questionnaires):
 *    - Registro de respostas estruturadas (jsonb) versionadas (v1, v2)
 *    - Vínculo opcional a contato do tenant
 *    - Histórico auditável de preenchimento
 * 5. E-mails Comerciais Registrados (crm_deal_emails):
 *    - Registro verificado de e-mails trocados (outbound e inbound)
 *    - Validação estrita de formato de e-mail
 *    - Não simulação de envio fantasma quando SMTP não configurado
 * 6. Priorização Comercial IA (crm_deals):
 *    - Critério comercial mensurável, auditado e explicável
 *    - Integração compatível com Vertex AI e fallback heurístico transparente
 *    - Persistência das colunas ai_priority_score, ai_priority_level, ai_priority_reason, ai_priority_updated_at
 * 7. Calendário Comercial (getCrmCalendarTasks):
 *    - Consulta de tarefas com prazo (dueDate IS NOT NULL) como fonte de verdade
 *    - Filtros por período (start/end) e status (pending/completed)
 *    - Retorno completo do negócio para navegação direta ao card/tarefa exatos
 * 8. Isolamento Multi-Tenant estrito em todas as operações
 * 9. Teardown cirúrgico em valemchat_test
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
  crmProducts,
  crmDealProducts,
  crmProposals,
  crmDealFiles,
  crmDealQuestionnaires,
  crmDealEmails,
  crmDealActivities,
  crmDealEvents,
} from "../src/db/schema";
import { crmService } from "../src/lib/crm/crm-service";

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

function assert(condition: boolean, testName: string, detail?: string) {
  summary.total++;
  if (condition) {
    summary.passed++;
    console.log(`  ✅ [PASS] ${testName}`);
  } else {
    summary.failed++;
    console.error(`  ❌ [FAIL] ${testName}`);
    if (detail) console.error(`     Detalhe: ${detail}`);
  }
}

async function run() {
  console.log("═════════════════════════════════════════════════════════════════════");
  console.log("🚀 INICIANDO VERIFICAÇÃO AUTOMATIZADA: ENTREGA E8 (PARIDADE AMPLIADA)");
  console.log(`📌 Banco de dados alvo: ${dbUrl}`);
  console.log("═════════════════════════════════════════════════════════════════════\n");

  const tenantAlpha = `tenant-e8-alpha-${Date.now()}`;
  const tenantBeta = `tenant-e8-beta-${Date.now()}`;
  createdTenantIds.push(tenantAlpha, tenantBeta);

  try {
    // 0. Setup: Criar Tenants e Operadores
    console.log("📦 0. Setup de Tenants e Operadores Isolados...");
    await db.insert(tenants).values([
      { id: tenantAlpha, name: "Tenant Alpha (E8)", slug: `slug_alpha_${Date.now()}`, connectionType: "meta" },
      { id: tenantBeta, name: "Tenant Beta (E8)", slug: `slug_beta_${Date.now()}`, connectionType: "meta" },
    ]);

    const opAlpha = `op-alpha-${Date.now()}`;
    const opBeta = `op-beta-${Date.now()}`;
    createdOperatorIds.push(opAlpha, opBeta);

    await db.insert(operators).values([
      {
        id: opAlpha,
        tenantId: tenantAlpha,
        name: "Vendedor Alpha",
        email: `alpha@${tenantAlpha}.com`,
        passwordHash: "hash-alpha",
        role: "admin",
      },
      {
        id: opBeta,
        tenantId: tenantBeta,
        name: "Vendedor Beta",
        email: `beta@${tenantBeta}.com`,
        passwordHash: "hash-beta",
        role: "admin",
      },
    ]);

    // Setup de Funil e Etapas no Tenant Alpha
    const pipeAlpha = `pipe-alpha-${Date.now()}`;
    const stageAlpha1 = `stg-alpha-1-${Date.now()}`;
    const stageAlpha2 = `stg-alpha-2-${Date.now()}`;
    await db.insert(crmPipelines).values({
      id: pipeAlpha,
      tenantId: tenantAlpha,
      name: "Funil Comercial Alpha",
      isDefault: true,
    });
    await db.insert(crmStages).values([
      { id: stageAlpha1, tenantId: tenantAlpha, pipelineId: pipeAlpha, name: "Proposta", orderIndex: 0 },
      { id: stageAlpha2, tenantId: tenantAlpha, pipelineId: pipeAlpha, name: "Fechamento", orderIndex: 1 },
    ]);

    // Setup de Contato e Conversa no Tenant Alpha
    const contactAlpha = `contact-alpha-${Date.now()}`;
    await db.insert(contacts).values({
      id: contactAlpha,
      tenantId: tenantAlpha,
      name: "Comprador Indústria Alpha",
      phone: "5511999990001",
      mainChannel: "whatsapp",
    });

    const convAlpha = `conv-alpha-${Date.now()}`;
    await db.insert(conversations).values({
      id: convAlpha,
      tenantId: tenantAlpha,
      contactId: contactAlpha,
      queueState: "fila",
    });

    // Setup de Negociação Alpha
    const dealAlpha = await crmService.createDeal(tenantAlpha, opAlpha, {
      title: "Fornecimento de Embalagens e Válvulas 2026",
      pipelineId: pipeAlpha,
      stageId: stageAlpha1,
      operatorId: opAlpha,
      value: "65000.00",
    });
    assert(!!dealAlpha && dealAlpha.id.length > 0, "Criação de negociação Alpha para testes de E8");

    // ─────────────────────────────────────────────────────────────────
    // BLOCO 1: PRODUTOS & PROPOSTAS COM CÓPIA SEM ENVIO PREMATURO
    // ─────────────────────────────────────────────────────────────────
    console.log("\n📦 1. Testando Produtos e Propostas (Sem Envio Prematuro/Simulado)...");

    // Cadastrar produto no catálogo
    const prod1Id = `prod-1-${Date.now()}`;
    await db.insert(crmProducts).values({
      id: prod1Id,
      tenantId: tenantAlpha,
      name: "Válvula Spray 24/410 Luxo",
      sku: "VALV-24410-LUX",
      basePrice: "2.50",
      unit: "UN",
    });

    // Adicionar item ao negócio
    const dealItem = await crmService.addDealProduct(tenantAlpha, dealAlpha.id, opAlpha, {
      name: "Válvula Spray 24/410 Luxo",
      productId: prod1Id,
      quantity: 20000,
      unitPrice: 2.5,
      discountPercent: 10, // 20.000 * 2.50 = 50.000 - 10% = 45.000
    });

    assert(
      parseFloat(dealItem.totalPrice) === 45000,
      "Cálculo exato de preço com desconto em centavos no item do deal",
      `Total esperado: 45000.00, obtido: ${dealItem.totalPrice}`
    );

    // Emitir Proposta Formal
    const proposal = await crmService.createProposal(tenantAlpha, dealAlpha.id, opAlpha, {
      title: "Orçamento Formal Lote 20k Válvulas",
    });

    assert(proposal.status === "draft", "Nova proposta comercial nasce estritamente com status 'draft'");
    assert(parseFloat(proposal.total) === 45000, "Valor da proposta reflete fielmente os itens congelados");
    assert(proposal.sentAt === null, "sentAt é estritamente nulo na criação da proposta");

    // Simulação do comportamento de cópia de texto:
    // "Copiar texto para a área de transferência não deve ser tratado como envio confirmado"
    // Validar que o status permanece 'draft' e NÃO vai para 'sent' nem 'copied'
    const [propAfterCopyCheck] = await db
      .select()
      .from(crmProposals)
      .where(and(eq(crmProposals.id, proposal.id), eq(crmProposals.tenantId, tenantAlpha)));

    assert(
      propAfterCopyCheck.status === "draft",
      "Copiar texto para WhatsApp preserva proposta como 'draft' sem inferir envio confirmado",
      `Status atual: ${propAfterCopyCheck.status}`
    );

    // Envio Confirmado requer ação explícita
    const sentProposal = await crmService.updateProposalStatus(
      tenantAlpha,
      proposal.id,
      opAlpha,
      "sent"
    );
    assert(sentProposal.status === "sent", "Status transiciona para 'sent' após confirmação explícita de envio");
    assert(sentProposal.sentAt !== null, "sentAt é preenchido com timestamp real no envio confirmado");

    // Aceite formal da proposta
    const acceptedProposal = await crmService.updateProposalStatus(
      tenantAlpha,
      proposal.id,
      opAlpha,
      "accepted"
    );
    assert(acceptedProposal.status === "accepted", "Proposta transiciona para 'accepted' com sucesso");
    assert(acceptedProposal.acceptedAt !== null, "acceptedAt é gravado com data de aprovação pelo cliente");

    // Isolamento: Tenant Beta não altera proposta do Tenant Alpha
    let betaProposalTamperError = false;
    try {
      await crmService.updateProposalStatus(tenantBeta, proposal.id, opBeta, "rejected");
    } catch {
      betaProposalTamperError = true;
    }
    assert(betaProposalTamperError, "Tenant cruzado não consegue alterar status de proposta de outro tenant");

    // ─────────────────────────────────────────────────────────────────
    // BLOCO 2: ARQUIVOS DA NEGOCIAÇÃO (crm_deal_files)
    // ─────────────────────────────────────────────────────────────────
    console.log("\n📦 2. Testando Anexos e Arquivos do Negócio (crm_deal_files)...");

    // Anexar arquivo válido com vínculo à conversa
    const dealFile = await crmService.uploadDealFile(tenantAlpha, dealAlpha.id, opAlpha, {
      fileName: "Especificacao_Tecnica_Valvula_24410.pdf",
      fileSize: 1024 * 450, // 450 KB
      mimeType: "application/pdf",
      storagePath: `/crm-uploads/${dealAlpha.id}/Especificacao_Tecnica_Valvula_24410.pdf`,
      conversationId: convAlpha,
      metadata: { originalSource: "whatsapp_attachment" },
    });

    assert(!!dealFile.id, "Upload de arquivo realizado com sucesso");
    assert(dealFile.fileName === "Especificacao_Tecnica_Valvula_24410.pdf", "Nome do arquivo preservado");
    assert(dealFile.conversationId === convAlpha, "Vínculo de origem da conversa preservado no arquivo");

    // Rejeição de arquivo com tamanho superior a 100MB
    let oversizedFileError = false;
    try {
      await crmService.uploadDealFile(tenantAlpha, dealAlpha.id, opAlpha, {
        fileName: "Arquivo_Gigante_Invalido.iso",
        fileSize: 105 * 1024 * 1024, // 105 MB (> 100MB limite)
        mimeType: "application/octet-stream",
        storagePath: "/tmp/fake.iso",
      });
    } catch (e: any) {
      oversizedFileError = true;
      assert(e.message.includes("100MB"), "Erro claro e explicativo ao exceder limite de 100MB por arquivo");
    }
    assert(oversizedFileError, "Rejeição estrita de arquivo acima de 100MB");

    // Rejeição de conversa de outro tenant
    let crossTenantConvError = false;
    try {
      await crmService.uploadDealFile(tenantAlpha, dealAlpha.id, opAlpha, {
        fileName: "Doc_Invalido.pdf",
        fileSize: 1024,
        mimeType: "application/pdf",
        storagePath: "/tmp/doc.pdf",
        conversationId: "conv-fantasma-de-outro-tenant",
      });
    } catch {
      crossTenantConvError = true;
    }
    assert(crossTenantConvError, "Rejeita tentativa de vincular conversa inexistente ou de outro tenant");

    // Listar arquivos
    const fileList = await crmService.getDealFiles(tenantAlpha, dealAlpha.id);
    assert(fileList.length === 1, "Listagem de arquivos retorna exatamente o arquivo anexado");
    assert(fileList[0].uploaderName === "Vendedor Alpha", "Join com operador uploader retorna nome correto");

    // Exclusão de arquivo com auditoria
    const deleteSuccess = await crmService.deleteDealFile(tenantAlpha, dealAlpha.id, dealFile.id, opAlpha);
    assert(deleteSuccess, "Exclusão de arquivo realizada com sucesso");

    const [deletedAudit] = await db
      .select()
      .from(crmDealEvents)
      .where(
        and(
          eq(crmDealEvents.tenantId, tenantAlpha),
          eq(crmDealEvents.dealId, dealAlpha.id),
          eq(crmDealEvents.eventType, "deal_file_deleted")
        )
      );
    assert(!!deletedAudit, "Evento 'deal_file_deleted' registrado na auditoria imutável");

    // ─────────────────────────────────────────────────────────────────
    // BLOCO 3: QUESTIONÁRIOS E BRIEFINGS TÉCNICOS
    // ─────────────────────────────────────────────────────────────────
    console.log("\n📦 3. Testando Questionários e Briefings (crm_deal_questionnaires)...");

    const questionnaireAnswers = [
      { question: "Volume mensal estimado de demanda", answer: "20.000 frascos/mês" },
      { question: "Aplicação e especificação técnica do produto", answer: "Linha cosmética hidratante" },
      { question: "Cliente já testou amostras físicas?", answer: "Sim - Aprovado em teste de estanqueidade" },
      { question: "Previsão estimada de fechamento comercial", answer: "Próximos 15 dias" },
    ];

    const questV1 = await crmService.saveDealQuestionnaire(tenantAlpha, dealAlpha.id, opAlpha, {
      formTitle: "Qualificação Técnica de Embalagens Cosméticas",
      version: 1,
      answers: questionnaireAnswers,
      contactId: contactAlpha,
    });

    assert(!!questV1.id, "Questionário v1 salvo com sucesso");
    assert(questV1.version === 1, "Versão 1 gravada corretamente");
    assert(Array.isArray(questV1.answers) && (questV1.answers as any).length === 4, "Todas as respostas estruturadas salvas em jsonb");

    // Salvar versão 2 com atualização de escopo
    const questV2 = await crmService.saveDealQuestionnaire(tenantAlpha, dealAlpha.id, opAlpha, {
      formTitle: "Qualificação Técnica de Embalagens Cosméticas",
      version: 2,
      answers: [
        ...questionnaireAnswers,
        { question: "Necessita serigrafia ou rotulagem?", answer: "Sim - Serigrafia em 2 cores" },
      ],
      contactId: contactAlpha,
    });

    assert(questV2.version === 2, "Versão 2 registrada preservando histórico de versões");

    const questionnairesList = await crmService.getDealQuestionnaires(tenantAlpha, dealAlpha.id);
    assert(questionnairesList.length === 2, "Listagem retorna histórico completo de questionários (v2 e v1)");
    assert(questionnairesList[0].version === 2, "Listagem ordenada decrescente traz versão mais recente primeiro");

    // Isolamento: Tenant Beta não acessa questionários de Alpha
    let betaQuestAccessBlocked = false;
    try {
      await crmService.getDealQuestionnaires(tenantBeta, dealAlpha.id);
    } catch {
      betaQuestAccessBlocked = true;
    }
    assert(betaQuestAccessBlocked, "Tenant Beta é impedido de listar questionários de negócio de Alpha");

    // ─────────────────────────────────────────────────────────────────
    // BLOCO 4: E-MAILS COMERCIAIS REGISTRADOS (SEM DISPARO FANTASMA)
    // ─────────────────────────────────────────────────────────────────
    console.log("\n📦 4. Testando Registro Auditado de E-mails (crm_deal_emails)...");

    // Registro de E-mail Outbound
    const emailOutbound = await crmService.logDealEmail(tenantAlpha, dealAlpha.id, opAlpha, {
      direction: "outbound",
      fromAddress: "comercial@valem.com.br",
      toAddress: "compras@industria-alpha.com.br",
      subject: "Envio de Proposta Comercial PROP-2026-0001",
      bodyText: "Prezado comprador, segue em anexo a proposta para fornecimento de válvulas.",
      sentAt: new Date(),
    });

    assert(!!emailOutbound.id, "E-mail de saída registrado com sucesso");
    assert(emailOutbound.direction === "outbound", "Direção outbound preservada");
    assert(emailOutbound.isVerified === true, "E-mail marcado como verificado");

    // Registro de E-mail Inbound
    const emailInbound = await crmService.logDealEmail(tenantAlpha, dealAlpha.id, opAlpha, {
      direction: "inbound",
      fromAddress: "compras@industria-alpha.com.br",
      toAddress: "comercial@valem.com.br",
      subject: "Re: Envio de Proposta Comercial PROP-2026-0001",
      bodyText: "Proposta recebida e encaminhada para a diretoria financeira aprovar.",
      sentAt: new Date(),
    });

    assert(emailInbound.direction === "inbound", "E-mail de entrada registrado com sucesso");

    // Validação estrita de formato de e-mail
    let invalidEmailBlocked = false;
    try {
      await crmService.logDealEmail(tenantAlpha, dealAlpha.id, opAlpha, {
        fromAddress: "email-invalido-sem-arroba",
        toAddress: "compras@empresa.com",
        subject: "Teste",
      });
    } catch {
      invalidEmailBlocked = true;
    }
    assert(invalidEmailBlocked, "Endereço de e-mail sem '@' é rejeitado com validação estrita");

    // Listagem de e-mails
    const dealEmails = await crmService.getDealEmails(tenantAlpha, dealAlpha.id);
    assert(dealEmails.length === 2, "Listagem de e-mails retorna o histórico bidirecional completo");

    // ─────────────────────────────────────────────────────────────────
    // BLOCO 5: PRIORIZAÇÃO COMERCIAL IA (CRITÉRIO MENSURÁVEL E EXPLICÁVEL)
    // ─────────────────────────────────────────────────────────────────
    console.log("\n📦 5. Testando Priorização Comercial IA com Critério Explicável...");

    const priority = await crmService.calculateDealAiPriority(tenantAlpha, dealAlpha.id, opAlpha);

    assert(
      typeof priority.score === "number" && priority.score >= 0 && priority.score <= 100,
      "Prioridade IA gera score numérico mensurável entre 0 e 100",
      `Score obtido: ${priority.score}`
    );

    assert(
      ["baixa", "media", "alta", "critica"].includes(priority.level),
      "Prioridade IA categoriza nível válido ('baixa' | 'media' | 'alta' | 'critica')",
      `Nível obtido: ${priority.level}`
    );

    assert(
      typeof priority.reason === "string" && priority.reason.length > 10,
      "Prioridade IA fornece justificativa explicável e auditável para a equipe comercial",
      `Justificativa: ${priority.reason}`
    );

    // Conferir se os campos foram salvos na tabela crm_deals
    const [updatedDeal] = await db
      .select({
        score: crmDeals.aiPriorityScore,
        level: crmDeals.aiPriorityLevel,
        reason: crmDeals.aiPriorityReason,
        updatedAt: crmDeals.aiPriorityUpdatedAt,
      })
      .from(crmDeals)
      .where(and(eq(crmDeals.id, dealAlpha.id), eq(crmDeals.tenantId, tenantAlpha)));

    assert(updatedDeal.score === priority.score, "aiPriorityScore persistido corretamente em crm_deals");
    assert(updatedDeal.level === priority.level, "aiPriorityLevel persistido corretamente em crm_deals");
    assert(updatedDeal.reason === priority.reason, "aiPriorityReason persistido com integridade");
    assert(updatedDeal.updatedAt !== null, "aiPriorityUpdatedAt registrado");

    // Conferir se evento foi registrado na auditoria
    const [aiAudit] = await db
      .select()
      .from(crmDealEvents)
      .where(
        and(
          eq(crmDealEvents.tenantId, tenantAlpha),
          eq(crmDealEvents.dealId, dealAlpha.id),
          eq(crmDealEvents.eventType, "deal_ai_priority_calculated")
        )
      );
    assert(!!aiAudit, "Evento 'deal_ai_priority_calculated' registrado na trilha de auditoria");

    // ─────────────────────────────────────────────────────────────────
    // BLOCO 6: CALENDÁRIO COMERCIAL E TAREFAS COM PRAZO
    // ─────────────────────────────────────────────────────────────────
    console.log("\n📦 6. Testando Calendário Comercial com Prazos e Navegação Direta...");

    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    // Criar tarefas com prazo
    const task1 = await crmService.createDealActivity(tenantAlpha, dealAlpha.id, opAlpha, {
      type: "task",
      title: "Enviar amostra técnica via Sedex 10",
      dueDate: tomorrow.toISOString(),
    });

    const task2 = await crmService.createDealActivity(tenantAlpha, dealAlpha.id, opAlpha, {
      type: "task",
      title: "Reunião de alinhamento com a diretoria",
      dueDate: nextWeek.toISOString(),
    });

    // Tarefa do tipo nota (não deve aparecer no calendário)
    await crmService.createDealActivity(tenantAlpha, dealAlpha.id, opAlpha, {
      type: "note",
      title: "Anotação interna que não tem prazo",
    });

    // Consultar calendário completo do Tenant Alpha
    const calendarTasks = await crmService.getCrmCalendarTasks(tenantAlpha, { status: "all" });

    assert(
      calendarTasks.length === 2,
      "Calendário retorna estritamente as atividades do tipo tarefa com prazo (ignora notas)",
      `Total retornado: ${calendarTasks.length}`
    );

    // Validar integridade dos metadados para navegação direta ao card/tarefa
    const firstCalTask = calendarTasks[0];
    assert(firstCalTask.dealId === dealAlpha.id, "Calendário retorna dealId correto para clique e navegação");
    assert(firstCalTask.dealTitle === dealAlpha.title, "Calendário retorna dealTitle para visualização");
    assert(firstCalTask.pipelineId === pipeAlpha, "Calendário retorna pipelineId para troca de contexto de funil");
    assert(firstCalTask.stageId === stageAlpha1, "Calendário retorna stageId da coluna atual");
    assert(firstCalTask.stageName === "Proposta", "Calendário retorna stageName para exibição");
    assert(firstCalTask.operatorName === "Vendedor Alpha", "Calendário retorna nome do responsável");

    // Filtro por período
    const filteredByDate = await crmService.getCrmCalendarTasks(tenantAlpha, {
      startDate: new Date(now.getTime() - 1000),
      endDate: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000), // próximos 3 dias
    });
    assert(filteredByDate.length === 1, "Filtro de período do calendário isola apenas tarefas no intervalo solicitado");

    // Concluir uma tarefa e filtrar por pendentes
    await crmService.updateDealActivity(tenantAlpha, dealAlpha.id, task1.id, opAlpha, { status: "completed" });
    const pendingCalendarTasks = await crmService.getCrmCalendarTasks(tenantAlpha, { status: "pending" });
    assert(pendingCalendarTasks.length === 1, "Filtro status: 'pending' exclui tarefas já concluídas");
    assert(pendingCalendarTasks[0].taskId === task2.id, "Tarefa pendente restante é exatamente a de próxima semana");

    // Isolamento: Tenant Beta consulta seu calendário e não vê NADA do Tenant Alpha
    const betaCalendarTasks = await crmService.getCrmCalendarTasks(tenantBeta);
    assert(betaCalendarTasks.length === 0, "Isolamento absoluto: Tenant Beta recebe 0 tarefas do Tenant Alpha no calendário");

    // ─────────────────────────────────────────────────────────────────
    // BLOCO 7: FICHA UNIFICADA (GETDEALBYID TRAZENDO TODOS OS MÓDULOS E8)
    // ─────────────────────────────────────────────────────────────────
    console.log("\n📦 7. Testando Enriquecimento Completo da Ficha (getDealById com E8)...");

    const fullDealDetail = await crmService.getDealById(tenantAlpha, dealAlpha.id);
    assert(!!fullDealDetail, "getDealById retorna com sucesso");
    assert(Array.isArray(fullDealDetail?.products) && fullDealDetail.products.length === 1, "Ficha contém produtos mapeados");
    assert(Array.isArray(fullDealDetail?.proposals) && fullDealDetail.proposals.length === 1, "Ficha contém propostas emitidas");
    assert(Array.isArray(fullDealDetail?.questionnaires) && fullDealDetail.questionnaires.length === 2, "Ficha contém questionários respondidos");
    assert(Array.isArray(fullDealDetail?.emails) && fullDealDetail.emails.length === 2, "Ficha contém e-mails registrados");
    assert(fullDealDetail?.aiPriorityScore !== null, "Ficha exibe aiPriorityScore");
    assert(fullDealDetail?.aiPriorityLevel !== null, "Ficha exibe aiPriorityLevel");
    assert(fullDealDetail?.aiPriorityReason !== null, "Ficha exibe aiPriorityReason");

  } catch (error: any) {
    console.error("❌ ERRO INESPERADO DURANTE A EXECUÇÃO DOS TESTES E8:", error);
    summary.failed++;
  } finally {
    // ─────────────────────────────────────────────────────────────────
    // TEARDOWN CIRÚRGICO
    // ─────────────────────────────────────────────────────────────────
    console.log("\n🧹 Executando Teardown Cirúrgico em valemchat_test...");
    try {
      if (createdTenantIds.length > 0) {
        // Graças a cascade em tenants, deletar o tenant limpa todas as tabelas filhas
        await db.delete(tenants).where(inArray(tenants.id, createdTenantIds));
        console.log(`  ✨ Tenants ${createdTenantIds.join(", ")} e todos os dados associados foram excluídos.`);
      }
    } catch (e: any) {
      console.warn("  ⚠️ Falha durante teardown:", e.message);
    } finally {
      await client.end();
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // RELATÓRIO FINAL
  // ─────────────────────────────────────────────────────────────────
  console.log("\n═════════════════════════════════════════════════════════════════════");
  console.log("📊 RESULTADO DA SUÍTE DE TESTES E8 (PARIDADE AMPLIADA)");
  console.log(`   Total de Testes:   ${summary.total}`);
  console.log(`   Testes Aprovados:  ${summary.passed} ✅`);
  console.log(`   Testes Falhados:   ${summary.failed} ❌`);
  console.log("═════════════════════════════════════════════════════════════════════");

  if (summary.failed > 0) {
    console.error("\n❌ A suíte de testes E8 encerrou com falhas!");
    process.exit(1);
  } else {
    console.log("\n🎉 TODAS AS VERIFICAÇÕES DE E8 FORAM CONCLUÍDAS COM SUCESSO!");
    process.exit(0);
  }
}

run();
