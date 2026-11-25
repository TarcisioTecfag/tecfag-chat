import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  applyKnownClientConfirmationToData,
  buildKnownClientPromptDirective,
  doesExtractedCompanyMatchKnownClient,
  evaluateKnownCompanyConfirmation,
  type KnownClientProfile,
} from "../src/lib/triage/known-client-lookup";
import { isIndustrialOwnerStillValidForSend } from "../src/lib/triage/industrial-ownership-guard";
import { evaluateIndustrialClientMessages } from "../src/lib/triage/industrial-handoff";
import { buildIndustrialReplyRewritePrompt } from "../src/lib/triage/industrial-reply-rewriter";
import {
  isVagueIndustrialProductionValue,
  resolveIndustrialRoute,
} from "../src/lib/triage/industrial-policy";
import { decideIndustrialMachine } from "../src/lib/triage/industrial-decisor";
import {
  emptyIndustrialSettings,
  industrialSettingsSchema,
} from "../src/lib/triage/industrial-settings";
import { resolveTemplateTopicSummary } from "../src/lib/livechat/site-whatsapp-handoff";
import { buildTecfagFagnerPrompt } from "../src/lib/valentina/sdr-tecfag-prompt";
import { getAiPersona } from "../src/lib/ai-persona";

const root = path.resolve(import.meta.dir, "..");

describe("Pacote de 8 correções da triagem Site → WhatsApp do Fagner", () => {
  const annaKnownClient: KnownClientProfile = {
    companyName: "ANNA KARLA BERNARDES LTDA",
    document: "51.770.747/0001-60",
    contactName: "Tarcisio Pereira Do Nascimento",
    accountId: "acc-rd-6a8497ff118da00024e17436",
    contactId: "cont-c0237266-b391-43e5-8789-f0343beccd65",
    source: "crm_account",
  };

  it("P0 #1: permite entrega da mensagem de despedida no Site pós-ponte WhatsApp e garante TYPING_STOP no debouncer", () => {
    // Conversa finalizada normal continua bloqueada
    expect(
      isIndustrialOwnerStillValidForSend({
        queueState: "finalizados",
        operatorId: null,
        expectedOperatorId: null,
      }),
    ).toBe(false);

    // Conversa do Site recém-finalizada pela ponte Site→WhatsApp (sem operador) pode entregar a despedida
    expect(
      isIndustrialOwnerStillValidForSend({
        queueState: "finalizados",
        operatorId: null,
        expectedOperatorId: null,
        allowSiteWhatsappClosing: true,
      }),
    ).toBe(true);

    // Mas se houver operador atribuído, continua bloqueado mesmo com flag
    expect(
      isIndustrialOwnerStillValidForSend({
        queueState: "finalizados",
        operatorId: "op-1",
        expectedOperatorId: null,
        allowSiteWhatsappClosing: true,
      }),
    ).toBe(false);

    const deliveryCtx = readFileSync(
      path.join(root, "src/lib/valentina/industrial-delivery-context.ts"),
      "utf8",
    );
    expect(deliveryCtx).toContain('flowMeta?.handoffStatus === "continued_to_whatsapp"');
    expect(deliveryCtx).toContain("flowMeta?.siteWhatsappTemplateSent === true");

    const debouncer = readFileSync(
      path.join(root, "src/lib/valentina/sdr-debouncer.ts"),
      "utf8",
    );
    expect(debouncer).toContain('sendBotPresence(session.tenantId, session.conversationId, session.phone, "paused")');

    const sdrEngine = readFileSync(
      path.join(root, "src/lib/valentina/sdr-engine.ts"),
      "utf8",
    );
    expect(sdrEngine).toContain("allowSiteWhatsappClosing: Boolean(");
  });

  it("P0 #2: reconhece retratação/confirmação informal de empresa recorrente e impede cobrança falsa de CNPJ", () => {
    const botAskedHistory = [
      "Para agilizar, pode confirmar por favor? Sua empresa é a ANNA KARLA BERNARDES LTDA, certo?",
      "Poderia então me informar o nome da sua empresa ou o CNPJ, por favor?",
    ];

    // Turno 2: recusa explícita continua retornando rejected
    expect(
      evaluateKnownCompanyConfirmation({
        clientText: "nao",
        recentBotMessages: [botAskedHistory[0]],
        knownClient: annaKnownClient,
        currentData: {},
      }),
    ).toBe("rejected");

    // Turno 3 (caso real do Tarcisio): "mentira / é aquele mesmo / é anna minha empresa"
    expect(
      evaluateKnownCompanyConfirmation({
        clientText: "mentira\né aquele mesmo\né anna minha empresa",
        recentBotMessages: botAskedHistory,
        knownClient: annaKnownClient,
        currentData: {},
      }),
    ).toBe("confirmed");

    // Mesmo sem recentBotMessages, menção à empresa + "meu cnpj" confirma
    expect(
      evaluateKnownCompanyConfirmation({
        clientText: "mais vc ja tem meu cnpj\ne o anna\nanna karla la\nmeu cnpj",
        recentBotMessages: [],
        knownClient: annaKnownClient,
        currentData: {},
      }),
    ).toBe("confirmed");

    // Proteção em profundidade: nome extraído pelo LLM compatível com knownClient
    expect(doesExtractedCompanyMatchKnownClient("ANNA KARLA BERNARDES LTDA", annaKnownClient)).toBe(true);
    expect(doesExtractedCompanyMatchKnownClient("Anna Karla Bernardes", annaKnownClient)).toBe(true);
    expect(doesExtractedCompanyMatchKnownClient("EMPRESA TOTALMENTE DIFERENTE LTDA", annaKnownClient)).toBe(false);

    // Ao confirmar, grava _KNOWN_COMPANY_CONFIRMED e CNPJ OU CPF do cadastro
    const enriched = applyKnownClientConfirmationToData({}, annaKnownClient);
    expect(enriched._KNOWN_COMPANY_CONFIRMED?.status).toBe("filled");
    expect(enriched["CNPJ OU CPF"]?.value).toBe("51.770.747/0001-60");
    expect(enriched["EMPRESA"]?.value).toBe("ANNA KARLA BERNARDES LTDA");

    // Diretriz de recusa orienta pedir CNPJ/CPF diretamente (nunca "nome da empresa ou CNPJ")
    const rejectedDirective = buildKnownClientPromptDirective({
      knownClient: annaKnownClient,
      confirmationStatus: "rejected",
      currentData: {},
    });
    expect(rejectedDirective).toContain("CNPJ ou CPF");
    expect(rejectedDirective).toContain('NUNCA peça "o nome da empresa ou o CNPJ"');

    // Se ainda estiver pending e o Gemini precisar reescrever para pedir documento, o prompt de reescrita orienta confirmar a empresa conhecida
    const route = resolveIndustrialRoute({ text: "quero seladora", collectedData: {} });
    const evaluated = evaluateIndustrialClientMessages({
      result: { status: "collecting", operator: null, deal: null },
      route,
      data: {
        "NOME COMPLETO": { value: "Tarcisio", status: "filled" },
        "MÁQUINA / PEÇA / INTERESSE": { value: "Seladora", status: "filled" },
        "RAMO / O QUE EMBALA": { value: "Trigo", status: "filled" },
        "VOLUME / PRODUÇÃO": { value: "3000 pacotes por hora", status: "filled" },
      },
      messages: ["Vou encaminhar para nossa equipe."],
      knownCompanyToConfirm: annaKnownClient.companyName,
    });
    expect(evaluated.needsGeminiRewrite).toBe(true);
    expect(evaluated.missingFields).toEqual(["document"]);
    const rewritePrompt = buildIndustrialReplyRewritePrompt({
      tenantId: "tecfag",
      conversationId: "conv-test-anna",
      aiPersona: { name: "Fagner", company: "Grupo Tecfag", segment: "Máquinas", tone: "consultivo", gender: "male" },
      rewriteMode: "collecting_missing_fields",
      conversationHistoryText: "",
      batchSummary: "quero seladora",
      collectedData: {},
      missingFields: evaluated.missingFields,
      knownCompanyToConfirm: annaKnownClient.companyName,
    });
    expect(rewritePrompt).toContain("ANNA KARLA BERNARDES LTDA");
  });

  it("P1 #3: Decisor aceita alternativas separadas por '/' ou 'ou' (ex.: 'Seladora / Empacotadora automática para trigo')", async () => {
    const settings = industrialSettingsSchema.parse({
      ...emptyIndustrialSettings(),
      catalog: [
        {
          id: "sel-manual",
          name: "Seladora Manual SM300",
          code: "SM300",
          line: "SEMI-INDUSTRIAL",
          production: "200/h",
          aliases: [],
        },
        {
          id: "emp-auto-trigo",
          name: "Empacotadora Automática AFPP1328",
          code: "AFPP1328",
          line: "PERSONNALITE",
          production: "3600/h",
          description: "Empacotadora vertical automática com dosador para grãos e farinha de trigo",
          aliases: [],
        },
      ],
    });

    const decision = await decideIndustrialMachine({
      settings,
      revision: 1,
      input: {
        interest: "Seladora / Empacotadora automática para trigo",
        application: "Trigo em sacolas plásticas de 300g",
        production: "3000 pacotes por hora",
        customerContext: "preciso de uma seladora quero selar trigo 300g 3 mil por hora",
      },
      suggest: async (candidates) => {
        const ids = candidates.map((c) => c.id);
        expect(ids).toContain("emp-auto-trigo");
        expect(ids).toContain("sel-manual");
        return {
          machineId: "emp-auto-trigo",
          confidence: 0.97,
          reason: "Alta produtividade de 3.000 pacotes/hora de trigo",
        };
      },
    });

    expect(decision.status).toBe("confirmed");
    expect(decision.machineId).toBe("emp-auto-trigo");
    expect(decision.line).toBe("PERSONNALITE");
  });

  it("P1 #4 e P2 #7: template WhatsApp usa 'MÁQUINA / PEÇA / INTERESSE', limpa sectorId ao reabrir WA e zera unreadCount ao finalizar Site", () => {
    const topic = resolveTemplateTopicSummary({
      data: {
        "MÁQUINA / PEÇA / INTERESSE": {
          value: "Seladora / Empacotadora automática para trigo",
          status: "filled",
        },
      },
      route: resolveIndustrialRoute({ text: "seladora", collectedData: {} }),
    });
    expect(topic).toBe("Seladora / Empacotadora automática para trigo");

    const handoffSrc = readFileSync(
      path.join(root, "src/lib/livechat/site-whatsapp-handoff.ts"),
      "utf8",
    );
    expect(handoffSrc).toContain("sectorId: null");
    expect(handoffSrc).toContain("unreadCount: 0");
  });

  it("P1 #5: widget do Site usa primeiro nome e transparência de assistente virtual", () => {
    const widgetSrc = readFileSync(
      path.join(root, "tecfag-widget/src/components/ChatWidget/ChatWidget.tsx"),
      "utf8",
    );
    expect(widgetSrc).not.toContain("Especialista em automações industriais");
    expect(widgetSrc).toContain("assistente virtual da Tecfag");
    expect(widgetSrc).toContain("extractFirstNameForGreeting");
  });

  it("P2 #6 e #8: rejeita produção vaga ('muito trigo'), evita eco robótico no prompt e acelera digitação no Site", () => {
    expect(isVagueIndustrialProductionValue("muito trigo")).toBe(true);
    expect(isVagueIndustrialProductionValue("muito")).toBe(true);
    expect(isVagueIndustrialProductionValue("bastante")).toBe(true);
    expect(isVagueIndustrialProductionValue("pouco")).toBe(true);

    // Valores reais ou escalas reconhecidas continuam válidos
    expect(isVagueIndustrialProductionValue("3000 pacotes por hora")).toBe(false);
    expect(isVagueIndustrialProductionValue("50 unidades por dia")).toBe(false);
    expect(isVagueIndustrialProductionValue("pequena produção")).toBe(false);
    expect(isVagueIndustrialProductionValue("estou começando agora")).toBe(false);
    expect(isVagueIndustrialProductionValue("não tenho estimativa ainda")).toBe(false);

    const prompt = buildTecfagFagnerPrompt({
      aiPersona: getAiPersona("tecfag"),
      knowledgeContext: "",
      conversationHistoryText: "",
      batchSummary: "preciso de uma seladora",
      currentDataSummary: {},
      cnpjDirective: "",
      firstMessageRule: "",
      hasPreviousEmoji: false,
      hasPreviousAudio: false,
    });
    expect(prompt).toContain("ZERO ECO ROBÓTICO");
    expect(prompt).toContain("a solução ideal é X");
    expect(prompt).toContain("muito trigo");

    const sdrEngine = readFileSync(
      path.join(root, "src/lib/valentina/sdr-engine.ts"),
      "utf8",
    );
    expect(sdrEngine).toContain("isVagueIndustrialProductionValue");
    expect(sdrEngine).toContain("doesExtractedCompanyMatchKnownClient");
    expect(sdrEngine).toContain("Math.min(1100, Math.max(400, text.length * 16))");
  });
});
