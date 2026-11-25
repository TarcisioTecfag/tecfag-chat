import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

import {
  INDUSTRIAL_CURRICULUM_SOLIDES_URL,
  INDUSTRIAL_SUPPLIERS_EMAIL,
  assessIndustrialReadiness,
  canFinishIndustrialTriage,
  isIndustrialInformativeSubflow,
  resolveIndustrialRoute,
} from "../src/lib/triage/industrial-policy";
import {
  evaluateIndustrialClientMessages,
  industrialClientMessages,
} from "../src/lib/triage/industrial-handoff";
import {
  buildIndustrialReplyRewritePrompt,
  sanitizeRewrittenIndustrialMessages,
} from "../src/lib/triage/industrial-reply-rewriter";
import { projectIndustrialMonitoring } from "../src/lib/triage/industrial-monitor";
import { buildTecfagFagnerPrompt } from "../src/lib/valentina/sdr-tecfag-prompt";
import {
  DEFAULT_SDR_FILTER_STATE,
  classifySessionToColumn,
  filterSdrSessions,
  isInformativeClosureSession,
  isUnhiddenInformativeSession,
} from "../src/components/valentina/sdr-kanban-data";
import type { SdrTriageSession } from "../src/components/valentina/SdrTab";

const readRepoFile = (relPath: string) =>
  fs.readFileSync(path.resolve(process.cwd(), relPath), "utf8");

const fagnerPersona = {
  name: "Fagner",
  company: "Grupo Tecfag",
  segment: "Máquinas e equipamentos industriais de embalagem",
  tone: "consultivo, cordial e objetivo",
  gender: "male" as const,
  triagePolicy: "industrial" as const,
};

describe("Fagner Site + WhatsApp — Currículos (Sólides), Fornecedores/Parcerias (adm@tecfag.com.br) e botão Ocultar no Painel SDR", () => {
  test("1. Classifica currículos e vagas em 5B_CURRICULO (stage outros, sem deal, action inform)", () => {
    const samples = [
      "Olá, gostaria de enviar meu currículo para vocês",
      "Quero mandar meu CV para o RH",
      "Vocês têm vagas abertas? Quero trabalhar na Tecfag",
      "Como faço para participar do processo seletivo / trabalhe conosco?",
      "Gostaria de falar com alguém do RH para mandar meu currículo",
    ];

    for (const text of samples) {
      const route = resolveIndustrialRoute({ text, collectedData: {} });
      expect(route.subflow).toBe("5B_CURRICULO");
      expect(route.funnelStage).toBe("outros");
      expect(route.targetFunnel).toBe("Currículos");
      expect(isIndustrialInformativeSubflow(route.subflow)).toBe(true);

      const readiness = assessIndustrialReadiness(route, {});
      expect(readiness.ready).toBe(true);
      expect(readiness.action).toBe("inform");
      expect(readiness.createsDeal).toBe(false);

      expect(
        canFinishIndustrialTriage({
          route,
          data: {},
          isCompleted: false,
          hasPendingQuestion: false,
        }),
      ).toBe(true);
    }
  });

  test("2. Classifica oferta de produtos, parcerias, transportadoras e venda de insumos em 5C_COMPRAS sem falso positivo em rastreio/peças", () => {
    const supplierSamples = [
      "Olá, gostaria de oferecer nossos produtos para a Tecfag",
      "Bom dia, queremos fazer uma parceria comercial com vocês",
      "Somos uma transportadora e gostaríamos de apresentar nossa tabela de frete",
      "Sou da transportadora Rápido Sul e quero oferecer serviços de transporte e logística",
      "Quero vender insumos e matéria-prima para a fábrica de vocês",
      "Sou fornecedor de embalagens e gostaria de falar com o setor de compras",
    ];

    for (const text of supplierSamples) {
      const route = resolveIndustrialRoute({ text, collectedData: {} });
      expect(route.subflow).toBe("5C_COMPRAS");
      expect(route.funnelStage).toBe("outros");
      expect(route.targetFunnel).toBe("Compras / Fornecedores");
      expect(isIndustrialInformativeSubflow(route.subflow)).toBe(true);

      const readiness = assessIndustrialReadiness(route, {});
      expect(readiness.ready).toBe(true);
      expect(readiness.action).toBe("inform");
      expect(readiness.createsDeal).toBe(false);
    }

    // Garante ZERO regressão em clientes reais rastreando pedido ou comprando peças/máquinas!
    const trackingRoute = resolveIndustrialRoute({
      text: "Oi, minha máquina veio pela transportadora e ainda não chegou, consegue rastrear meu pedido?",
      collectedData: {},
    });
    expect(trackingRoute.subflow).toBe("4A_RASTREAR");
    expect(trackingRoute.funnelStage).toBe("pos_venda");

    const partsRoute = resolveIndustrialRoute({
      text: "Preciso comprar teflon e resistência de reposição para minha seladora",
      collectedData: {},
    });
    expect(partsRoute.subflow).toBe("PECAS");

    const machineRoute = resolveIndustrialRoute({
      text: "Eu vendo bolos e salgados e quero comprar uma seladora a vácuo",
      collectedData: {},
    });
    expect(machineRoute.subflow).toBe("MAQUINAS");

    // Se o LLM identificou 5C_COMPRAS em texto com "transportadora" sem contexto de rastreio, respeita 5C_COMPRAS
    const aiClassifiedCarrier = resolveIndustrialRoute({
      text: "Olá, aqui é da transportadora Alfa, atendemos Bauru e região",
      aiSubflow: "5C_COMPRAS",
      collectedData: {},
    });
    expect(aiClassifiedCarrier.subflow).toBe("5C_COMPRAS");
    expect(aiClassifiedCarrier.funnelStage).toBe("outros");
  });

  test("3. Prompt do Fagner (Site + WhatsApp) contém exatamente o link do Sólides e o e-mail adm@tecfag.com.br", () => {
    const prompt = buildTecfagFagnerPrompt({
      aiPersona: fagnerPersona,
      knowledgeContext: "",
      conversationHistoryText: "",
      batchSummary: "Quero enviar currículo",
      currentDataSummary: {},
      cnpjDirective: "",
      firstMessageRule: "",
      hasPreviousEmoji: false,
      hasPreviousAudio: false,
    });

    expect(prompt).toContain("As mesmas regras valem no site e no WhatsApp");
    expect(prompt).toContain(INDUSTRIAL_CURRICULUM_SOLIDES_URL);
    expect(prompt).toContain("https://grupotecfag.vagas.solides.com.br");
    expect(prompt).toContain("RH");
    expect(prompt).toContain(INDUSTRIAL_SUPPLIERS_EMAIL);
    expect(prompt).toContain("adm@tecfag.com.br");
    expect(prompt).toContain("5B_CURRICULO");
    expect(prompt).toContain("5C_COMPRAS");
  });

  test("4. Validador de balões e Rewriter preservam respostas oficiais com Sólides/adm@tecfag.com.br e reescrevem se faltarem", () => {
    const curriculoRoute = resolveIndustrialRoute({
      text: "Quero mandar currículo",
      collectedData: {},
    });
    const goodCurriculoReply = [
      "Para enviar seu currículo, pedimos que cadastre pelo Sólides usando o link https://grupotecfag.vagas.solides.com.br — assim nosso RH pode analisar com calma e dar retorno para você!",
    ];
    const evalGoodCurriculo = evaluateIndustrialClientMessages({
      result: { status: "resolved", operator: null, deal: null },
      route: curriculoRoute,
      data: {},
      messages: goodCurriculoReply,
    });
    expect(evalGoodCurriculo.needsGeminiRewrite).toBe(false);
    expect(evalGoodCurriculo.messages).toEqual(goodCurriculoReply);

    // Se o LLM esquecer o link do Sólides, aciona reescrita obrigatória com subflow 5B_CURRICULO
    const evalMissingLink = evaluateIndustrialClientMessages({
      result: { status: "resolved", operator: null, deal: null },
      route: curriculoRoute,
      data: {},
      messages: ["Obrigado pelo interesse em trabalhar conosco!"],
    });
    expect(evalMissingLink.needsGeminiRewrite).toBe(true);
    expect(evalMissingLink.rewriteMode).toBe("resolved");

    const fornecedorRoute = resolveIndustrialRoute({
      text: "Somos fornecedores e queremos oferecer produtos",
      collectedData: {},
    });
    const goodFornecedorReply = [
      "Para oferecer produtos, parcerias ou insumos, pedimos gentilmente que envie sua proposta para o e-mail do nosso setor responsável: adm@tecfag.com.br.",
    ];
    const evalGoodFornecedor = evaluateIndustrialClientMessages({
      result: { status: "resolved", operator: null, deal: null },
      route: fornecedorRoute,
      data: {},
      messages: goodFornecedorReply,
    });
    expect(evalGoodFornecedor.needsGeminiRewrite).toBe(false);
    expect(evalGoodFornecedor.messages).toEqual(goodFornecedorReply);

    const evalMissingEmail = evaluateIndustrialClientMessages({
      result: { status: "resolved", operator: null, deal: null },
      route: fornecedorRoute,
      data: {},
      messages: ["Obrigado pelo contato, vamos ver internamente."],
    });
    expect(evalMissingEmail.needsGeminiRewrite).toBe(true);
    expect(evalMissingEmail.rewriteMode).toBe("resolved");

    // Rewriter prompt inclui explicitamente Sólides em 5B_CURRICULO e adm@tecfag.com.br em 5C_COMPRAS
    const rewriteCurriculoPrompt = buildIndustrialReplyRewritePrompt({
      tenantId: "tecfag",
      conversationId: "conv-1",
      aiPersona: fagnerPersona,
      rewriteMode: "resolved",
      subflow: "5B_CURRICULO",
      conversationHistoryText: "",
      batchSummary: "Quero mandar currículo",
      collectedData: {},
    });
    expect(rewriteCurriculoPrompt).toContain("https://grupotecfag.vagas.solides.com.br");

    const rewriteSuppliersPrompt = buildIndustrialReplyRewritePrompt({
      tenantId: "tecfag",
      conversationId: "conv-2",
      aiPersona: fagnerPersona,
      rewriteMode: "resolved",
      subflow: "5C_COMPRAS",
      conversationHistoryText: "",
      batchSummary: "Quero fazer parceria de transportadora",
      collectedData: {},
    });
    expect(rewriteSuppliersPrompt).toContain("adm@tecfag.com.br");

    // Sanitizer preserva os balões oficiais mesmo contendo "setor" / "RH ... analisar"
    expect(
      sanitizeRewrittenIndustrialMessages("resolved", goodCurriculoReply, false, "5B_CURRICULO"),
    ).toEqual(goodCurriculoReply);
    expect(
      sanitizeRewrittenIndustrialMessages("resolved", goodFornecedorReply, false, "5C_COMPRAS"),
    ).toEqual(goodFornecedorReply);
    expect(
      industrialClientMessages({
        result: { status: "resolved", operator: null, deal: null },
        route: fornecedorRoute,
        data: {},
        messages: goodFornecedorReply,
      }),
    ).toEqual(goodFornecedorReply);
  });

  test("5. Painel SDR: cards informativos vão para OUTROS, aparecem até clicar em Ocultar e somem ao ocultar (nunca em Aprovação)", () => {
    const makeSession = (overrides: Partial<SdrTriageSession>): SdrTriageSession => ({
      id: "fs-1",
      conversationId: "conv-1",
      contactName: "Candidato Silva",
      company: "Empresa não informada",
      phone: "5514999990000",
      currentStep: "Concluído (Informativo)",
      collectedData: {},
      startedAt: "2026-11-25T15:00:00.000Z",
      lastMessageAt: "2026-11-25T15:01:00.000Z",
      status: "completed",
      outcome: "completed",
      channel: "whatsapp",
      messages: [],
      ...overrides,
    });

    const curriculoVisivel = makeSession({
      id: "fs-curriculo",
      conversationId: "conv-curriculo",
      subflow: "5B_CURRICULO",
      funnelStage: "outros",
      targetFunnel: "Currículos",
      isInformativeClosure: true,
      sdrHidden: false,
    });

    const fornecedorOcultado = makeSession({
      id: "fs-fornecedor-oculto",
      conversationId: "conv-fornecedor",
      contactName: "Transportadora Sul",
      subflow: "5C_COMPRAS",
      funnelStage: "outros",
      targetFunnel: "Compras / Fornecedores",
      isInformativeClosure: true,
      sdrHidden: true,
    });

    const leadTransferido = makeSession({
      id: "fs-lead-done",
      conversationId: "conv-lead-done",
      contactName: "Cliente Comprador",
      subflow: "MAQUINAS",
      funnelStage: "maquinas",
      targetFunnel: "Máquinas",
      status: "completed",
      outcome: "transferred",
    });

    expect(classifySessionToColumn(curriculoVisivel)).toBe("outros");
    expect(classifySessionToColumn(fornecedorOcultado)).toBe("outros");
    expect(isInformativeClosureSession(curriculoVisivel)).toBe(true);
    expect(isUnhiddenInformativeSession(curriculoVisivel)).toBe(true);
    expect(isUnhiddenInformativeSession(fornecedorOcultado)).toBe(false);

    // No filtro padrão (showCompleted: false):
    // - Currículo ainda não ocultado APARECE em OUTROS para o SDR bater o olho e clicar em Ocultar
    // - Fornecedor já ocultado SOME do painel ativo
    // - Lead transferido normal continua oculto por padrão
    const activeFiltered = filterSdrSessions(
      [curriculoVisivel, fornecedorOcultado, leadTransferido],
      DEFAULT_SDR_FILTER_STATE,
    );
    expect(activeFiltered.map((s) => s.id)).toEqual(["fs-curriculo"]);

    // Com "Ver Concluídos" ligado, todos aparecem para auditoria
    const withCompleted = filterSdrSessions(
      [curriculoVisivel, fornecedorOcultado, leadTransferido],
      { ...DEFAULT_SDR_FILTER_STATE, showCompleted: true },
    );
    expect(withCompleted.map((s) => s.id)).toContain("fs-curriculo");
    expect(withCompleted.map((s) => s.id)).toContain("fs-fornecedor-oculto");
    expect(withCompleted.map((s) => s.id)).toContain("fs-lead-done");
  });

  test("6. Projeção de monitoramento e contratos de segurança / encerramento automático / UI Design System", () => {
    const monCurriculo = projectIndustrialMonitoring(
      {
        startedAt: "2026-11-25T15:00:00.000Z",
        outcome: "completed",
        metadata: {
          subflow: "5B_CURRICULO",
          funnelStage: "outros",
          targetFunnel: "Currículos",
          handoffStatus: "resolved",
          informativeAutoClosed: true,
          sdrHidden: false,
        },
      },
      { operatorId: null, queueState: "finalizados" },
    );
    expect(monCurriculo.state).toBe("closed");
    expect(monCurriculo.label).toContain("Currículos");
    expect(monCurriculo.informativeAutoClosed).toBe(true);
    expect(monCurriculo.sdrHidden).toBe(false);

    const monHidden = projectIndustrialMonitoring(
      {
        startedAt: "2026-11-25T15:00:00.000Z",
        outcome: "completed",
        metadata: {
          subflow: "5C_COMPRAS",
          funnelStage: "outros",
          targetFunnel: "Compras / Fornecedores",
          handoffStatus: "resolved",
          informativeAutoClosed: true,
          sdrHidden: true,
          sdrHiddenBy: { operatorId: "op-1", operatorName: "Isabella", at: "2026-11-25T15:05:00.000Z" },
        },
      },
      { operatorId: null, queueState: "finalizados" },
    );
    expect(monHidden.sdrHidden).toBe(true);
    expect(monHidden.sdrHiddenByName).toBe("Isabella");

    // Contratos arquiteturais: ação hide autenticada, encerramento Site + WhatsApp, Design System
    const approvalRoute = readRepoFile("src/routes/api/valentina/triage-approval.ts");
    expect(approvalRoute).toContain('action === "hide"');
    expect(approvalRoute).toContain("hideIndustrialInformativeTriage");
    expect(approvalRoute).not.toMatch(/["'](valem|tecfag)["']/);

    const sdrEngine = readRepoFile("src/lib/valentina/sdr-engine.ts");
    expect(sdrEngine).toContain("isInformativeNonLeadClosure");
    expect(sdrEngine).toContain('queueState: "finalizados"');
    expect(sdrEngine).toContain("closeAutoCreatedCwrDealForNonLead");
    expect(sdrEngine).toContain("informativeAutoClosed: true");

    const kanbanBoard = readRepoFile("src/components/valentina/SdrKanbanBoard.tsx");
    expect(kanbanBoard).toContain("Ocultar");
    expect(kanbanBoard).toContain("EyeOff");
    expect(kanbanBoard).not.toMatch(/\btitle=/);

    const approvalPanel = readRepoFile("src/components/valentina/IndustrialApprovalPanel.tsx");
    expect(approvalPanel).toContain('action: "hide"');
    expect(approvalPanel).toContain("Ocultar");
    expect(approvalPanel).not.toMatch(/\btitle=/);
    expect(approvalPanel).not.toMatch(/<select[\s>]/);
  });
});
