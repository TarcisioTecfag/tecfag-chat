import { describe, expect, it } from "bun:test";
import {
  evaluateIndustrialOpeningPlan,
  finalizeIndustrialOpeningMessages,
  findRecentOwnSdrOutbound,
  hasMeaningfulExtractedDemand,
  hasPriorRecentClientContext,
} from "../src/lib/triage/industrial-opening-policy";
import {
  evaluateIndustrialSilence,
  evaluateIndustrialTurnRecovery,
} from "../src/lib/triage/industrial-silence-policy";

const FAGNER_PERSONA = {
  name: "Fagner",
  gender: "male" as const,
  company: "Grupo Tecfag",
};

describe("Abertura contextual do Fagner (industrial-opening-policy)", () => {
  it("Caso Aloisio: template ativo recente em priorMessages + 5 msgs do cliente + lote atual 'Boa tarde' NUNCA sobrescreve resposta da IA por 'Como posso te ajudar?'", () => {
    const now = new Date("2026-11-24T21:16:20.000Z");
    const priorMessages = [
      {
        id: "msg-tpl-1",
        senderType: "agent",
        senderName: "Fagner (SDR)",
        content:
          "Olá, Aloisio! Recebi seu interesse em nossas Seladoras em L e queria entender melhor a sua necessidade. Podemos conversar?",
        sentAt: new Date("2026-11-24T13:17:10.555Z"),
        isInternalNote: false,
        status: "delivered",
      },
      {
        id: "msg-c-1",
        senderType: "client",
        senderName: "Aloisio Boff",
        content: "Sim, podemos!",
        sentAt: new Date("2026-11-24T13:20:13.000Z"),
        isInternalNote: false,
      },
      {
        id: "msg-c-2",
        senderType: "client",
        senderName: "Aloisio Boff",
        content: "Está seladora já vem com o túnel de encolhimento? Que preço está?",
        sentAt: new Date("2026-11-24T13:20:40.000Z"),
        isInternalNote: false,
      },
      {
        id: "msg-c-3",
        senderType: "client",
        senderName: "Aloisio Boff",
        content: "Nossa caixa mede 600 mm comprimento 400 mm largura 150 mm altura",
        sentAt: new Date("2026-11-24T13:43:11.000Z"),
        isInternalNote: false,
      },
    ];
    const historyMessages = [
      {
        id: "msg-c-4",
        senderType: "client",
        senderName: "Aloisio Boff",
        content: "Boa tarde",
        sentAt: new Date("2026-11-24T21:15:48.000Z"),
        isInternalNote: false,
      },
    ];

    const plan = evaluateIndustrialOpeningPlan({
      greetingAlreadyDone: false,
      siteWidgetAlreadyGreeted: false,
      historyMessages,
      priorMessages,
      now,
      aiPersona: FAGNER_PERSONA,
      greeting: "Boa noite!",
    });

    expect(plan.mode).toBe("active_template_continuation");
    expect(plan.isFirstMessage).toBe(false);
    expect(plan.hasRecentOwnSdrOutbound).toBe(true);
    expect(plan.firstMessageRule).toContain("CONTINUAÇÃO DE ABORDAGEM ATIVA RECENTE");
    expect(plan.firstMessageRule).toContain("Seladoras em L");

    const aiReply = [
      "Boa noite, Aloisio! Vi as medidas da sua caixa (600x400x150mm) e sua dúvida sobre a seladora em L com túnel de encolhimento.",
      "Para direcionar ao especialista e montar a proposta certa, qual seria sua produtividade aproximada e o CNPJ da empresa?",
    ];
    const finalized = finalizeIndustrialOpeningMessages({
      plan,
      aiMessages: aiReply,
      batchTexts: ["Boa tarde"],
      batchMessageIds: ["msg-c-4"],
      hasMediaInBatch: false,
      hasStoreTurn: false,
      isClientDeclinedTurn: false,
      directOperatorStatus: "none",
      historyMessages,
      priorMessages,
      extractedData: {
        "MÁQUINA / PEÇA / INTERESSE": "Seladora em L com túnel de encolhimento",
        "RAMO / O QUE EMBALA": "Caixa com 600mm x 400mm x 150mm",
      },
      subflow: "MAQUINAS",
      now,
      aiPersona: FAGNER_PERSONA,
      greeting: "Boa noite!",
    });

    expect(finalized.isGenericGreetingOnly).toBe(false);
    expect(finalized.messagesToSend).toEqual(aiReply);
    expect(finalized.messagesToSend.join(" ")).not.toContain("Como posso te ajudar");
    expect(finalized.messagesToSend.join(" ")).not.toContain("Eu sou o Fagner");
  });

  it("Caso Gabriel Coutinho / Maicon Goldbach: template ativo + resposta curta 'Sim, podemos!' mantém resposta contextual e remove eventual reapresentação acidental", () => {
    const now = new Date("2026-11-24T13:17:30.000Z");
    const historyMessages = [
      {
        id: "msg-tpl-gabriel",
        senderType: "agent",
        senderName: "Fagner (SDR)",
        content:
          "Olá, Gabriel! Recebi seu interesse em nossas Seladoras em L e queria entender melhor a sua necessidade. Podemos conversar?",
        sentAt: new Date("2026-11-24T13:16:34.138Z"),
        isInternalNote: false,
        status: "read",
      },
      {
        id: "msg-gabriel-sim",
        senderType: "client",
        senderName: "Gabriel Coutinho",
        content: "Sim, podemos!",
        sentAt: new Date("2026-11-24T13:16:51.000Z"),
        isInternalNote: false,
      },
    ];

    const plan = evaluateIndustrialOpeningPlan({
      greetingAlreadyDone: false,
      siteWidgetAlreadyGreeted: false,
      historyMessages,
      priorMessages: [],
      now,
      aiPersona: FAGNER_PERSONA,
      greeting: "Bom dia!",
    });

    expect(plan.mode).toBe("active_template_continuation");
    expect(plan.isFirstMessage).toBe(false);

    const finalized = finalizeIndustrialOpeningMessages({
      plan,
      aiMessages: [
        "Bom dia!",
        "Eu sou o Fagner, do Grupo Tecfag 😊",
        "Ótimo, Gabriel! Sobre a Seladora em L, qual produto você pretende embalar e qual seria a produtividade aproximada?",
      ],
      batchTexts: ["Sim, podemos!"],
      batchMessageIds: ["msg-gabriel-sim"],
      hasMediaInBatch: false,
      hasStoreTurn: false,
      isClientDeclinedTurn: false,
      directOperatorStatus: "none",
      historyMessages,
      priorMessages: [],
      extractedData: { "MÁQUINA / PEÇA / INTERESSE": "Seladora em L" },
      subflow: "MAQUINAS",
      now,
      aiPersona: FAGNER_PERSONA,
      greeting: "Bom dia!",
    });

    expect(finalized.isGenericGreetingOnly).toBe(false);
    expect(finalized.messagesToSend).toEqual([
      "Ótimo, Gabriel! Sobre a Seladora em L, qual produto você pretende embalar e qual seria a produtividade aproximada?",
    ]);
  });

  it("Receptivo sem template: mensagens anteriores do cliente com contexto + lote atual curto ('Boa tarde') NÃO cai em abertura genérica", () => {
    const now = new Date("2026-11-25T14:15:00.000Z");
    const priorMessages = [
      {
        id: "msg-prev-1",
        senderType: "client",
        content: "Preciso de uma seladora em L para caixa 600x400x150mm",
        sentAt: new Date("2026-11-25T13:00:00.000Z"),
        isInternalNote: false,
      },
    ];

    const plan = evaluateIndustrialOpeningPlan({
      greetingAlreadyDone: false,
      siteWidgetAlreadyGreeted: false,
      historyMessages: [
        {
          id: "msg-cur-1",
          senderType: "client",
          content: "Boa tarde",
          sentAt: new Date("2026-11-25T14:14:30.000Z"),
          isInternalNote: false,
        },
      ],
      priorMessages,
      now,
      aiPersona: FAGNER_PERSONA,
      greeting: "Boa tarde!",
    });

    expect(plan.mode).toBe("fresh_inbound_first_turn");
    expect(
      hasPriorRecentClientContext(priorMessages, new Set(["msg-cur-1"]), now),
    ).toBe(true);
    expect(
      hasMeaningfulExtractedDemand({ "MÁQUINA / PEÇA / INTERESSE": "Seladora em L" }, "MAQUINAS"),
    ).toBe(true);

    const finalized = finalizeIndustrialOpeningMessages({
      plan,
      aiMessages: [
        "Vi que você busca uma seladora em L para caixas de 600x400x150mm.",
        "Qual é o seu nome e quantas caixas por dia você pretende embalar?",
      ],
      batchTexts: ["Boa tarde"],
      batchMessageIds: ["msg-cur-1"],
      hasMediaInBatch: false,
      hasStoreTurn: false,
      isClientDeclinedTurn: false,
      directOperatorStatus: "none",
      historyMessages: [],
      priorMessages,
      extractedData: { "MÁQUINA / PEÇA / INTERESSE": "Seladora em L" },
      subflow: "MAQUINAS",
      now,
      aiPersona: FAGNER_PERSONA,
      greeting: "Boa tarde!",
    });

    expect(finalized.isGenericGreetingOnly).toBe(false);
    expect(finalized.messagesToSend[0]).toBe(
      "Boa tarde! Sou o Fagner, assistente virtual do Grupo Tecfag 😊",
    );
    expect(finalized.messagesToSend[1]).toContain("seladora em L");
    expect(finalized.messagesToSend.join(" ")).not.toContain("Como posso te ajudar");
  });

  it("Receptivo com contexto onde a IA já abriu se apresentando naturalmente preserva os balões sem duplicar", () => {
    const now = new Date("2026-11-25T11:16:30.000Z");
    const plan = evaluateIndustrialOpeningPlan({
      greetingAlreadyDone: false,
      siteWidgetAlreadyGreeted: false,
      historyMessages: [],
      priorMessages: [],
      now,
      aiPersona: FAGNER_PERSONA,
      greeting: "Bom dia!",
    });

    const aiReply = [
      "Bom dia! Sou o Fagner, assistente virtual do Grupo Tecfag.",
      "Sobre sua dúvida, a necessidade de compressor depende do equipamento — temos modelos pneumáticos e elétricos.",
      "Qual produto você pretende envasar?",
    ];

    const finalized = finalizeIndustrialOpeningMessages({
      plan,
      aiMessages: aiReply,
      batchTexts: ["Bom dia", "Precisa de compressor?"],
      batchMessageIds: ["m1", "m2"],
      hasMediaInBatch: false,
      hasStoreTurn: false,
      isClientDeclinedTurn: false,
      directOperatorStatus: "none",
      historyMessages: [],
      priorMessages: [],
      extractedData: {},
      subflow: null,
      now,
      aiPersona: FAGNER_PERSONA,
      greeting: "Bom dia!",
    });

    expect(finalized.isGenericGreetingOnly).toBe(false);
    expect(finalized.messagesToSend).toEqual(aiReply);
  });

  it("Receptivo puramente saudação fria ('Oi') sem histórico recente mantém abertura padrão com 'assistente virtual'", () => {
    const now = new Date("2026-11-25T11:00:00.000Z");
    const plan = evaluateIndustrialOpeningPlan({
      greetingAlreadyDone: false,
      siteWidgetAlreadyGreeted: false,
      historyMessages: [
        {
          id: "m-oi",
          senderType: "client",
          content: "Oi",
          sentAt: now,
          isInternalNote: false,
        },
      ],
      priorMessages: [],
      now,
      aiPersona: FAGNER_PERSONA,
      greeting: "Bom dia!",
    });

    expect(plan.mode).toBe("fresh_inbound_first_turn");

    const finalized = finalizeIndustrialOpeningMessages({
      plan,
      aiMessages: ["Olá! Em que posso ajudar?"],
      batchTexts: ["Oi"],
      batchMessageIds: ["m-oi"],
      hasMediaInBatch: false,
      hasStoreTurn: false,
      isClientDeclinedTurn: false,
      directOperatorStatus: "none",
      historyMessages: [],
      priorMessages: [],
      extractedData: {},
      subflow: null,
      now,
      aiPersona: FAGNER_PERSONA,
      greeting: "Bom dia!",
    });

    expect(finalized.isGenericGreetingOnly).toBe(true);
    expect(finalized.messagesToSend).toEqual([
      "Bom dia!",
      "Eu sou o Fagner, assistente virtual do Grupo Tecfag 😊",
      "Como posso te ajudar?",
    ]);
  });

  it("Template antigo (> 7 dias) não é tratado como abordagem ativa recente", () => {
    const now = new Date("2026-11-25T11:00:00.000Z");
    const oldTemplate = [
      {
        id: "msg-old",
        senderType: "bot",
        senderName: "Fagner (SDR)",
        content: "Olá! Recebi seu interesse em seladoras.",
        sentAt: new Date("2026-10-20T11:00:00.000Z"),
        isInternalNote: false,
        status: "delivered",
      },
    ];

    expect(findRecentOwnSdrOutbound(oldTemplate, now).found).toBe(false);
    const plan = evaluateIndustrialOpeningPlan({
      greetingAlreadyDone: false,
      siteWidgetAlreadyGreeted: false,
      historyMessages: [],
      priorMessages: oldTemplate,
      now,
      aiPersona: FAGNER_PERSONA,
      greeting: "Bom dia!",
    });
    expect(plan.mode).toBe("fresh_inbound_first_turn");
    expect(plan.isFirstMessage).toBe(true);
  });
});

describe("Resgate do limbo após template SDR legado (industrial-silence-policy)", () => {
  it("evaluateIndustrialTurnRecovery resgata lead cujo template foi salvo como senderType='agent' + senderName='Fagner (SDR)' (Gabriel/Maicon)", () => {
    const now = new Date("2026-11-25T11:30:00.000Z");
    const decision = evaluateIndustrialTurnRecovery({
      now,
      isDebouncerBusy: false,
      conversation: {
        id: "conv-360750ea-c76d-45ab-8d4b-6d09e7b46407",
        queueState: "automacao",
        operatorId: null,
      },
      flow: null,
      recentMessages: [
        {
          id: "msg-tpl-1",
          senderType: "agent",
          senderName: "Fagner (SDR)",
          content: "Olá, Gabriel! Recebi seu interesse em nossas Seladoras em L...",
          sentAt: new Date("2026-11-24T13:16:34.138Z"),
        },
        {
          id: "msg-in-1",
          senderType: "client",
          senderName: "Gabriel Coutinho",
          content: "Sim, podemos!",
          sentAt: new Date("2026-11-24T13:16:51.000Z"),
        },
      ],
    });

    expect(decision.shouldRecover).toBe(true);
    expect(decision.lastClientMessageId).toBe("msg-in-1");
    expect(decision.nextAttemptNumber).toBe(1);
  });

  it("evaluateIndustrialTurnRecovery CONTINUA bloqueando quando há mensagem real de operador humano (senderType='agent')", () => {
    const now = new Date("2026-11-25T11:30:00.000Z");
    const decision = evaluateIndustrialTurnRecovery({
      now,
      isDebouncerBusy: false,
      conversation: {
        id: "conv-human-1",
        queueState: "automacao",
        operatorId: null,
      },
      flow: null,
      recentMessages: [
        {
          id: "msg-op-1",
          senderType: "agent",
          senderName: "Evelyn Silveira",
          content: "Oi Gabriel, já estou te atendendo por aqui!",
          sentAt: new Date("2026-11-24T13:16:34.000Z"),
        },
        {
          id: "msg-in-1",
          senderType: "client",
          senderName: "Gabriel Coutinho",
          content: "Combinado!",
          sentAt: new Date("2026-11-24T13:16:51.000Z"),
        },
      ],
    });

    expect(decision.shouldRecover).toBe(false);
    expect(decision.reason).toBe("agent_message_present");
  });

  it("evaluateIndustrialSilence ignora template próprio 'Fagner (SDR)' e continua cancelando para operador humano real", () => {
    const now = new Date("2026-11-25T14:30:00.000Z");
    const baseInput = {
      now,
      withinSchedule: true,
      flow: {
        id: "fs-sdr-tecfag-conv-1",
        tenantId: "tecfag",
        conversationId: "conv-1",
        startedAt: new Date("2026-11-25T12:00:00.000Z"),
        outcome: "in_progress",
        currentStep: "Em Qualificação",
        completedAt: null,
        followUpStage: 0,
        collectedData: {},
        metadata: {},
      },
      conversation: {
        id: "conv-1",
        queueState: "automacao",
        operatorId: null,
      },
    };

    const withOwnTemplate = evaluateIndustrialSilence({
      ...baseInput,
      recentMessages: [
        {
          id: "m1",
          senderType: "agent",
          senderName: "Fagner (SDR)",
          content: "Olá! Recebi seu interesse em Seladoras em L.",
          sentAt: new Date("2026-11-25T12:01:00.000Z"),
        },
        {
          id: "m2",
          senderType: "client",
          content: "Sim, podemos!",
          sentAt: new Date("2026-11-25T12:05:00.000Z"),
        },
        {
          id: "m3",
          senderType: "bot",
          senderName: "Fagner (SDR)",
          content: "Qual produto você pretende embalar?",
          sentAt: new Date("2026-11-25T12:06:00.000Z"),
        },
      ],
    });

    expect(withOwnTemplate.action).toBe("send_followup");
    expect(withOwnTemplate.nextStage).toBe(1);

    const withHumanAgent = evaluateIndustrialSilence({
      ...baseInput,
      recentMessages: [
        {
          id: "m1",
          senderType: "agent",
          senderName: "Denise Gomes",
          content: "Oi, assumi por aqui!",
          sentAt: new Date("2026-11-25T12:05:00.000Z"),
        },
      ],
    });

    expect(withHumanAgent.action).toBe("cancel_by_human");
    expect(withHumanAgent.reason).toBe("agent_message_present");
  });
});
