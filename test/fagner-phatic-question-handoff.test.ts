import { describe, expect, it } from "bun:test";
import {
  canFinishIndustrialTriage,
  hasPendingTriageQuestion,
  isPendingTriageQuestionBubble,
  resolveIndustrialRoute,
  stripTrailingPhaticConfirmationTag,
  type CollectedFields,
} from "../src/lib/triage/industrial-policy";
import {
  claimsIndustrialHandoffEffect,
  evaluateIndustrialClientMessages,
  isPrematureIndustrialHandoffBubble,
} from "../src/lib/triage/industrial-handoff";
import {
  evaluateIndustrialBusinessHours,
  parseIndustrialScheduleConfig,
} from "../src/lib/triage/industrial-business-hours";
import { sanitizeRewrittenIndustrialMessages } from "../src/lib/triage/industrial-reply-rewriter";

describe("Fix P0 — Pergunta fática no fim do balão (', ok?', ', tá?', ', combinado?') — Caso Lucas / SHABRA", () => {
  const lucasNightClosing = [
    "Sim, Lucas. Sobre o preço, pode ficar tranquilo. O especialista que vai te atender confirma todas as condições e os valores promocionais do site na hora de gerar o seu pedido.",
    "Já anotei tudo aqui: 1 Seladora PCS500A, 5 resistências e 2 teflons. Estou encaminhando para a nossa equipe e, como estamos fora do horário comercial, eles retornam o contato amanhã a partir das 8h para finalizar com você, ok?",
  ];

  const lucasMorningPrematureHandoff = [
    "Certo, Lucas. Anotado!",
    "Incluí a Seladora Contínua Pratic Seal TC-20 no seu pedido, junto com a PCS500A e as peças de reposição.",
    "Já estou passando seu pedido completo para um de nossos especialistas. Ele vai confirmar todos os itens, os valores promocionais e finalizar com você, ok?",
  ];

  it("não trata ', ok?' no fim do aviso de expediente (Lucas 26/11 18h33) como pergunta pendente e conclui a triagem em Peças", () => {
    expect(isPendingTriageQuestionBubble(lucasNightClosing[0])).toBe(false);
    expect(isPendingTriageQuestionBubble(lucasNightClosing[1])).toBe(false);
    expect(hasPendingTriageQuestion(lucasNightClosing)).toBe(false);
    expect(claimsIndustrialHandoffEffect(lucasNightClosing)).toBe(true);

    const dataPecas: CollectedFields = {
      "NOME COMPLETO": { value: "Lucas", status: "filled" },
      EMPRESA: { value: "SHABRA IMPORTACAO E EXPORTACAO LTDA", status: "filled" },
      "CNPJ OU CPF": { value: "46.529.441/0001-86", status: "filled" },
      "MÁQUINA / PEÇA / INTERESSE": {
        value: "1 Seladora PCS500A, 5 resistências para PCS500 e 2 teflons para PCS500",
        status: "filled",
      },
      "SETOR / FUNIL DE DESTINO": { value: "Peças", status: "filled" },
    };
    const route = resolveIndustrialRoute({
      text: "ESSE PREÇO QUE ESTA NO SITE DE VOCÊS, VOCÊS ESTÃO ACATANDO TAMBÉM",
      collectedData: dataPecas,
    });

    expect(
      canFinishIndustrialTriage({
        route,
        data: dataPecas,
        isCompleted: true,
        hasPendingQuestion: hasPendingTriageQuestion(lucasNightClosing),
      }),
    ).toBe(true);

    // Em awaiting_approval fora do expediente, preserva os 2 balões naturais do Fagner sem descartar o balão com ", ok?"
    const afterHoursEval = evaluateIndustrialBusinessHours(
      new Date("2026-11-26T21:33:32.000Z"), // 26/11 18:33 BRT -> fechado
      parseIndustrialScheduleConfig({}),
    );
    const evaluated = evaluateIndustrialClientMessages({
      result: { status: "awaiting_approval", operator: null, deal: null },
      route,
      data: dataPecas,
      messages: lucasNightClosing,
      businessHours: afterHoursEval,
    });
    expect(evaluated.needsGeminiRewrite).toBe(false);
    expect(evaluated.messages).toEqual(lucasNightClosing);
  });

  it("intercepta falso encaminhamento terminado em ', ok?' durante collecting (Lucas 27/11 08h35 em Máquinas sem aplicação/produção)", () => {
    expect(isPendingTriageQuestionBubble(lucasMorningPrematureHandoff[2])).toBe(false);
    expect(isPrematureIndustrialHandoffBubble(lucasMorningPrematureHandoff[2])).toBe(true);
    expect(claimsIndustrialHandoffEffect(lucasMorningPrematureHandoff)).toBe(true);

    const dataMaqIncomplete: CollectedFields = {
      "NOME COMPLETO": { value: "Lucas", status: "filled" },
      EMPRESA: { value: "SHABRA IMPORTACAO E EXPORTACAO LTDA", status: "filled" },
      "CNPJ OU CPF": { value: "46.529.441/0001-86", status: "filled" },
      "MÁQUINA / PEÇA / INTERESSE": {
        value:
          "1 Seladora PCS500A, 5 resistências p/ PCS500, 2 teflons p/ PCS500 e 1 Seladora Contínua Pratic Seal TC-20",
        status: "filled",
      },
      "SETOR / FUNIL DE DESTINO": { value: "Máquinas", status: "filled" },
    };
    const route = resolveIndustrialRoute({
      text: "VOU ESTAR QUERENDO A SELADORA CONTÍNUA PRATIC SEAL TC-20",
      aiSubflow: "MAQUINAS",
      collectedData: dataMaqIncomplete,
    });

    const evaluated = evaluateIndustrialClientMessages({
      result: { status: "collecting", operator: null, deal: null },
      route,
      data: dataMaqIncomplete,
      messages: lucasMorningPrematureHandoff,
    });
    expect(evaluated.needsGeminiRewrite).toBe(true);
    expect(evaluated.rewriteMode).toBe("collecting_missing_fields");
    expect(evaluated.missingFields).toEqual(["application", "production"]);
    expect(evaluated.messages).toEqual([
      "Certo, Lucas. Anotado!",
      "Incluí a Seladora Contínua Pratic Seal TC-20 no seu pedido, junto com a PCS500A e as peças de reposição.",
    ]);
  });

  it("reconhece tags fáticas comuns no fim de frases declarativas (', ok?', ', tá?', ', combinado?', ', tudo bem?', ', beleza?', ', né?')", () => {
    const declarativeWithPhatic = [
      "Estou direcionando seu atendimento para a nossa equipe comercial, tá?",
      "Nosso time retorna hoje a partir das 8h, combinado?",
      "Já deixei tudo registrado com a equipe de peças, tudo bem?",
      "Vamos seguir com o especialista amanhã cedo, beleza?",
      "Amanhã às 8h o consultor entra em contato por aqui, tá bom?",
      "Deixei tudo organizado para o retorno humano, certo?",
      "Ok?",
      "Combinado?",
      "Certo?",
    ];

    for (const msg of declarativeWithPhatic) {
      expect(isPendingTriageQuestionBubble(msg)).toBe(false);
    }
  });

  it("preserva 100% das perguntas reais de coleta, confirmação cadastral e oferta Site→WhatsApp (zero falso negativo)", () => {
    const realQuestions = [
      // Confirmação de cadastro conhecido com ", certo?" (Lucas 18h30)
      "Só para confirmar o cadastro e seguirmos: sua empresa é a SHABRA IMPORTACAO E EXPORTACAO LTDA 46.529.441/0001-86, certo?",
      // Pergunta real terminada com tag fática
      "Para agilizar, qual é o seu CNPJ, ok?",
      "Pode me informar o que você pretende embalar, tá?",
      "Você busca máquina nova ou peças de reposição, combinado?",
      "Quantos pacotes por dia você pretende produzir, ok?",
      // Duas frases com pergunta antes da tag fática
      "Qual máquina você precisa? Me conta os detalhes, ok?",
      // Oferta real de migração Site -> WhatsApp ("Pode ser?" NÃO é tag fática!)
      "Claro! Se você preferir, posso te mandar uma mensagem lá no WhatsApp no número (11) 99999-9999 para continuarmos de onde paramos. Pode ser?",
      // Pergunta legítima que explica motivo para o especialista
      "Para que eu possa direcionar sua solicitação ao especialista de peças, poderia me informar seu nome completo e CNPJ ou CPF?",
      // Saudação aberta
      "Como posso te ajudar?",
    ];

    for (const msg of realQuestions) {
      expect(isPendingTriageQuestionBubble(msg)).toBe(true);
      expect(hasPendingTriageQuestion([msg])).toBe(true);
      expect(isPrematureIndustrialHandoffBubble(msg)).toBe(false);
    }
  });

  it("sanitizeRewrittenIndustrialMessages em awaiting_approval preserva balão fático e continua filtrando perguntas reais e falsas alegações", () => {
    const result = sanitizeRewrittenIndustrialMessages(
      "awaiting_approval",
      [
        "Já estou direcionando seu atendimento e nossa equipe retorna amanhã a partir das 8h, ok?",
        "Qual é o seu CNPJ?",
        "Já criei o card no CRM para você.",
      ],
      false,
    );
    expect(result).toEqual([
      "Já estou direcionando seu atendimento e nossa equipe retorna amanhã a partir das 8h, ok?",
    ]);
  });

  it("stripTrailingPhaticConfirmationTag não remove ', certo?' quando há contexto de confirmação cadastral", () => {
    expect(
      stripTrailingPhaticConfirmationTag(
        "so para confirmar o cadastro: sua empresa e a shabra ltda, certo?",
      ),
    ).toContain("certo?");
    expect(
      stripTrailingPhaticConfirmationTag(
        "eles retornam o contato amanha a partir das 8h para finalizar com voce, ok?",
      ),
    ).toBe("eles retornam o contato amanha a partir das 8h para finalizar com voce");
  });
});
