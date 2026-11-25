import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import {
  evaluateIndustrialClientMessages,
  industrialClientMessages,
} from "../src/lib/triage/industrial-handoff";
import {
  assessIndustrialReadiness,
  isExistingCommercialProposalInquiry,
  requestsGenericHuman,
  resolveIndustrialRoute,
} from "../src/lib/triage/industrial-policy";
import {
  buildIndustrialReplyRewritePrompt,
  sanitizeRewrittenIndustrialMessages,
} from "../src/lib/triage/industrial-reply-rewriter";
import { buildTecfagFagnerPrompt } from "../src/lib/valentina/sdr-tecfag-prompt";
import { getAiPersona } from "../src/lib/ai-persona";

describe("Eliminação de fallbacks prontos robóticos (100% Gemini) + caso Renato/Taratur (proposta existente)", () => {
  it("reconhece proposta comercial existente (Renato: 'proposta comercial 0022524-01') e NUNCA exige aplicação/produção nem joga para Pós-Venda", () => {
    expect(
      isExistingCommercialProposalInquiry(
        "Bom dia!! Com quem converso sobre a proposta comercial 0022524-01",
      ),
    ).toBe(true);
    expect(isExistingCommercialProposalInquiry("Na proposta já consta isso")).toBe(true);
    expect(isExistingCommercialProposalInquiry("Quero comprar uma seladora a vácuo")).toBe(false);

    const routeTurn1 = resolveIndustrialRoute({
      text: "Bom dia!! Com quem converso sobre a proposta comercial 0022524-01\nSou da Taratur Alimentos, meu nome é Renato",
      collectedData: {},
    });
    expect(routeTurn1.subflow).toBe("5A_CLIENTE");
    expect(routeTurn1.targetFunnel).toBe("Análise e revisão humana");
    expect(routeTurn1.needsReview).toBe(true);

    const readinessTurn2 = assessIndustrialReadiness(routeTurn1, {
      "NOME COMPLETO": { value: "Renato", status: "filled" },
      EMPRESA: { value: "TARATUR ALIMENTOS LTDA", status: "filled" },
      "CNPJ OU CPF": { value: "44.678.965/0001-03", status: "filled" },
      "MÁQUINA / PEÇA / INTERESSE": { value: "Proposta comercial 0022524-01", status: "filled" },
    });
    expect(readinessTurn2.ready).toBe(true);
    expect(readinessTurn2.missing).toEqual([]);
    expect(readinessTurn2.action).toBe("review");
  });

  it("detecta resistência explícita por consultor ('Preciso apenas falar com o consultor') e roteia imediatamente para revisão humana", () => {
    expect(requestsGenericHuman("Preciso apenas falar com o consultor")).toBe(true);
    expect(requestsGenericHuman("Só quero falar com o vendedor")).toBe(true);

    const route = resolveIndustrialRoute({
      text: "Preciso apenas falar com o consultor",
      collectedData: {
        "NOME COMPLETO": { value: "Renato", status: "filled" },
      },
      existingSubflow: "MAQUINAS",
    });
    expect(route.subflow).toBe("5A_CLIENTE");
    expect(route.reason).toBe("human_requested");
    expect(assessIndustrialReadiness(route, {}).ready).toBe(true);
  });

  it("NUNCA injeta 'O que você produz ou pretende embalar?' ou qualquer pergunta pronta hardcoded quando remove promessa prematura em collecting", () => {
    const route = resolveIndustrialRoute({
      text: "Quero uma seladora",
      collectedData: {
        "NOME COMPLETO": { value: "Renato", status: "filled" },
        "CNPJ OU CPF": { value: "44.678.965/0001-03", status: "filled" },
        "MÁQUINA / PEÇA / INTERESSE": { value: "Seladora", status: "filled" },
      },
    });
    const data = {
      "NOME COMPLETO": { value: "Renato", status: "filled" },
      "CNPJ OU CPF": { value: "44.678.965/0001-03", status: "filled" },
      "MÁQUINA / PEÇA / INTERESSE": { value: "Seladora", status: "filled" },
    };

    const evaluated = evaluateIndustrialClientMessages({
      result: { status: "collecting", operator: null, deal: null },
      route,
      data,
      messages: [
        "Compreendido, Renato. Você tem razão, as informações já constam na proposta.",
        "Já estou direcionando seu atendimento para a equipe responsável.",
      ],
    });

    const syncOut = industrialClientMessages({
      result: { status: "collecting", operator: null, deal: null },
      route,
      data,
      messages: [
        "Compreendido, Renato. Você tem razão, as informações já constam na proposta.",
        "Já estou direcionando seu atendimento para a equipe responsável.",
      ],
    });

    const combined = [...evaluated.messages, ...syncOut].join(" ");
    expect(combined).not.toContain("O que você produz ou pretende embalar?");
    expect(combined).not.toContain("Pode me informar seu nome?");
    expect(combined).not.toContain("Qual é o volume aproximado da sua produção?");
    expect(combined).not.toContain("Pode me informar o CNPJ ou CPF");
    expect(evaluated.needsGeminiRewrite).toBe(true);
    expect(evaluated.rewriteMode).toBe("collecting_missing_fields");
    expect(evaluated.missingFields).toEqual(["application", "production"]);
  });

  it("prompt de reescrita Gemini inclui escape hatch shouldEscalateToReview e sanitizador respeita cada modo", () => {
    const prompt = buildIndustrialReplyRewritePrompt({
      tenantId: "tecfag",
      conversationId: "conv-renato",
      aiPersona: getAiPersona("tecfag"),
      rewriteMode: "collecting_missing_fields",
      conversationHistoryText: "[Cliente]: Na proposta já consta isso",
      batchSummary: "Preciso apenas falar com o consultor",
      collectedData: {
        "NOME COMPLETO": { value: "Renato", status: "filled" },
      },
      missingFields: ["application", "production"],
    });
    expect(prompt).toContain("shouldEscalateToReview");
    expect(prompt).toContain("proposta/orçamento/cadastro existente");

    // Quando não escala, remove promessa prematura
    expect(
      sanitizeRewrittenIndustrialMessages(
        "collecting_missing_fields",
        [
          "Já estou encaminhando para a equipe.",
          "Para te indicar a opção certa, qual produto você vai embalar?",
        ],
        false,
      ),
    ).toEqual(["Para te indicar a opção certa, qual produto você vai embalar?"]);

    // Quando escala via escape hatch, preserva mensagem natural de direcionamento
    expect(
      sanitizeRewrittenIndustrialMessages(
        "collecting_missing_fields",
        ["Sem problemas, Renato! Já estou passando para o consultor continuar sobre a proposta."],
        true,
      ),
    ).toEqual(["Sem problemas, Renato! Já estou passando para o consultor continuar sobre a proposta."]);
  });

  it("código-fonte de industrial-handoff.ts e sdr-engine.ts não contém mais as perguntas prontas hardcoded nem bypass de texto pronto", () => {
    const handoffSrc = fs.readFileSync(
      path.join(process.cwd(), "src/lib/triage/industrial-handoff.ts"),
      "utf8",
    );
    const engineSrc = fs.readFileSync(
      path.join(process.cwd(), "src/lib/valentina/sdr-engine.ts"),
      "utf8",
    );

    expect(handoffSrc).not.toContain("O que você produz ou pretende embalar?");
    expect(handoffSrc).not.toContain("Qual é o volume aproximado da sua produção?");
    expect(handoffSrc).not.toContain("Pode me informar seu nome?");
    expect(handoffSrc).not.toContain("Pode me informar o CNPJ ou CPF para localizar o cadastro?");
    expect(engineSrc).not.toContain("Vou acionar a equipe responsável pelo seu atendimento.");
    expect(engineSrc).toContain("rewriteIndustrialReplyWithGemini");

    const prompt = buildTecfagFagnerPrompt({
      aiPersona: getAiPersona("tecfag"),
      knowledgeContext: "",
      conversationHistoryText: "",
      batchSummary: "proposta comercial 0022524-01",
      currentDataSummary: {},
      cnpjDirective: "",
      firstMessageRule: "",
      hasPreviousEmoji: false,
      hasPreviousAudio: false,
    });
    expect(prompt).toContain("PROPOSTA COMERCIAL EXISTENTE");
  });
});
