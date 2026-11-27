import { describe, expect, it } from "bun:test";
import { getAiPersona } from "../src/lib/ai-persona";
import { parseIndustrialAiResult } from "../src/lib/triage/industrial-ai-result";
import {
  formatQuotedPreviewForSite,
  isMessageQuotableOnChannel,
  resolveIndustrialBubbleQuotes,
  resolveMetaReplyContextMessageId,
  resolveSiteQuotedSenderLabel,
  type QuotableMessageRef,
} from "../src/lib/triage/industrial-citations";
import { buildTecfagFagnerPrompt } from "../src/lib/valentina/sdr-tecfag-prompt";
import {
  buildMirroredSiteMessageId,
  buildMirroredSiteMessageRow,
} from "../src/lib/livechat/site-whatsapp-mirror";

describe("Fagner — Citações inteligentes por balão (WhatsApp + Widget do Site)", () => {
  const tenantId = "tecfag";

  it("inclui no prompt do Fagner as regras dos 3 cenários de citação e combinação por balão", () => {
    const prompt = buildTecfagFagnerPrompt({
      aiPersona: getAiPersona(tenantId),
      knowledgeContext: "Catálogo vazio",
      conversationHistoryText:
        "[26/11/2026 17:50 BRT · há 1 min] [ID MENSAGEM: bot-q1] [Fagner (SDR)]: Qual é o seu CNPJ ou CPF?",
      batchSummary: '[ID MENSAGEM: cli-m2] Cliente: "Vocês entregam em Minas Gerais?"',
      currentDataSummary: { "NOME COMPLETO": "Carlos Silva" },
      cnpjDirective: "",
      firstMessageRule: "Conversa em andamento.",
      hasPreviousEmoji: false,
      hasPreviousAudio: false,
    });

    expect(prompt).toContain("REGRAS DE CITAÇÃO DE MENSAGENS");
    expect(prompt).toContain("unanswered_question");
    expect(prompt).toContain("client_question");
    expect(prompt).toContain("client_media");
    expect(prompt).toContain("repetir sem ser repetitivo");
    expect(prompt).toContain("Antes, poderia só me responder isso rapidinho?");
    expect(prompt).toContain('"messageQuotes"');
  });

  it("faz parse seguro de messageQuotes em parseIndustrialAiResult ignorando entradas inválidas", () => {
    const parsed = parseIndustrialAiResult({
      subflow: "MAQUINAS",
      extractedData: { "NOME COMPLETO": "João" },
      funnelStage: "triagem",
      targetFunnel: "Máquinas",
      messagesToSend: [
        "Entregamos sim para todo o Brasil!",
        "Antes, poderia só me responder isso rapidinho?",
      ],
      quoteMessageId: null,
      messageQuotes: [
        { messageIndex: 0, quoteMessageId: "cli-q1", reason: "client_question" },
        { messageIndex: "1", quoteMessageId: "bot-q0", reason: "unanswered_question" },
        { messageIndex: 1, quoteMessageId: "dup-ignored", reason: "client_question" },
        { messageIndex: 99, quoteMessageId: "oob-ignored", reason: "client_question" },
        { messageIndex: 0, quoteMessageId: "null", reason: "client_question" },
      ],
      isCompleted: false,
    });

    expect(parsed).not.toBeNull();
    expect(parsed!.messageQuotes).toEqual([
      { messageIndex: 0, quoteMessageId: "cli-q1", reason: "client_question" },
      { messageIndex: 1, quoteMessageId: "bot-q0", reason: "unanswered_question" },
    ]);
  });

  it("Cenário 1 — Fuga de pergunta: cita a própria pergunta pendente do Fagner no balão de retomada curta", () => {
    const quotables: QuotableMessageRef[] = [
      {
        id: "bot-ask-cnpj",
        senderType: "bot",
        provider: "meta",
        externalId: "wamid.HBgM551100001",
        content: "Para agilizar, qual seria o CNPJ ou CPF?",
      },
      {
        id: "cli-tangent",
        senderType: "client",
        provider: "meta",
        externalId: "meta:tecfag:wamid.HBgM551100002",
        content: "Essa seladora é 220v né?",
        isCurrentBatch: true,
      },
    ];

    const finalMessages = [
      "Trabalhamos sim com opções em 220V conforme o modelo.",
      "Antes, poderia só me responder isso rapidinho?",
    ];

    const plan = resolveIndustrialBubbleQuotes({
      tenantId,
      channel: "whatsapp",
      initialAiMessages: finalMessages,
      finalMessages,
      aiMessageQuotes: [
        { messageIndex: 1, quoteMessageId: "bot-ask-cnpj", reason: "unanswered_question" },
      ],
      quotableMessages: quotables,
    });

    expect(plan).toEqual([undefined, "bot-ask-cnpj"]);
  });

  it("Cenário 2 — Pergunta do cliente: cita a mensagem exata da pergunta no balão que responde", () => {
    const quotables: QuotableMessageRef[] = [
      {
        id: "cli-msg-1",
        senderType: "client",
        provider: "meta",
        externalId: "meta:tecfag:wamid.1",
        content: "Meu nome é Marcos",
        isCurrentBatch: true,
      },
      {
        id: "cli-msg-2",
        senderType: "client",
        provider: "meta",
        externalId: "meta:tecfag:wamid.2",
        content: "Vocês ficam em qual cidade?",
        isCurrentBatch: true,
      },
    ];

    const finalMessages = [
      "Ficamos em Bauru/SP, com envio para todo o Brasil!",
      "E qual é o CNPJ ou CPF da sua empresa, Marcos?",
    ];

    const plan = resolveIndustrialBubbleQuotes({
      tenantId,
      channel: "whatsapp",
      initialAiMessages: finalMessages,
      finalMessages,
      aiMessageQuotes: [
        { messageIndex: 0, quoteMessageId: "cli-msg-2", reason: "client_question" },
      ],
      quotableMessages: quotables,
    });

    expect(plan).toEqual(["cli-msg-2", undefined]);
  });

  it("Cenário combinado — Pergunta do cliente + Fuga de pergunta no mesmo turno: cita cada uma no balão certo", () => {
    const quotables: QuotableMessageRef[] = [
      {
        id: "bot-ask-prod",
        senderType: "bot",
        provider: "livechat",
        externalId: "bot-ask-prod-widget",
        content: "Qual é a produção aproximada por hora ou por dia?",
      },
      {
        id: "cli-ask-garantia",
        senderType: "client",
        provider: "livechat",
        externalId: "usr_123",
        content: "Tem garantia de quanto tempo?",
        isCurrentBatch: true,
      },
    ];

    const finalMessages = [
      "A garantia oficial é de 12 meses para peças mecânicas e 90 dias para peças elétricas.",
      "Antes, consegue só me confirmar isso rapidinho?",
    ];

    const plan = resolveIndustrialBubbleQuotes({
      tenantId,
      channel: "site",
      initialAiMessages: finalMessages,
      finalMessages,
      aiMessageQuotes: [
        { messageIndex: 0, quoteMessageId: "cli-ask-garantia", reason: "client_question" },
        { messageIndex: 1, quoteMessageId: "bot-ask-prod", reason: "unanswered_question" },
      ],
      quotableMessages: quotables,
    });

    expect(plan).toEqual(["cli-ask-garantia", "bot-ask-prod"]);
  });

  it("Cenário 3 — Mídia do cliente (foto/áudio/PDF): cita automaticamente mesmo se a IA omitir messageQuotes", () => {
    const quotables: QuotableMessageRef[] = [
      {
        id: "cli-photo-1",
        senderType: "client",
        provider: "meta",
        externalId: "meta:tecfag:wamid.photo",
        content: "[MEDIA:image]med_123",
        mediaType: "image",
        isCurrentBatch: true,
      },
    ];

    const initialAi = [
      "Recebi a foto da etiqueta aqui! Já identifiquei o modelo FRM-980.",
      "Qual seria a produção diária aproximada?",
    ];
    const finalWithOpening = [
      "Boa tarde! Sou o Fagner, assistente virtual da Tecfag 😊",
      ...initialAi,
    ];

    const plan = resolveIndustrialBubbleQuotes({
      tenantId,
      channel: "whatsapp",
      initialAiMessages: initialAi,
      finalMessages: finalWithOpening,
      aiMessageQuotes: [],
      quotableMessages: quotables,
      batchMediaMessageId: "cli-photo-1",
    });

    // Nunca cita o balão de saudação/apresentação; cita no 1º balão substantivo!
    expect(plan).toEqual([undefined, "cli-photo-1", undefined]);
  });

  it("Triagem normal e saudação genérica não citam mensagens desnecessariamente", () => {
    const quotables: QuotableMessageRef[] = [
      {
        id: "cli-normal",
        senderType: "client",
        provider: "meta",
        externalId: "meta:tecfag:wamid.norm",
        content: "Meu nome é Ana Paula",
        isCurrentBatch: true,
      },
    ];

    const normalPlan = resolveIndustrialBubbleQuotes({
      tenantId,
      channel: "whatsapp",
      initialAiMessages: ["Perfeito, Ana! Qual é o CNPJ ou CPF?"],
      finalMessages: ["Perfeito, Ana! Qual é o CNPJ ou CPF?"],
      aiMessageQuotes: [],
      quotableMessages: quotables,
    });
    expect(normalPlan).toEqual([undefined]);

    const greetingPlan = resolveIndustrialBubbleQuotes({
      tenantId,
      channel: "whatsapp",
      initialAiMessages: ["Como posso te ajudar?"],
      finalMessages: [
        "Boa tarde!",
        "Eu sou o Fagner, assistente virtual da Tecfag 😊",
        "Como posso te ajudar?",
      ],
      aiMessageQuotes: [
        { messageIndex: 0, quoteMessageId: "cli-normal", reason: "client_question" },
      ],
      quotableMessages: quotables,
      isGenericGreetingOnly: true,
    });
    expect(greetingPlan).toEqual([undefined, undefined, undefined]);
  });

  it("bloqueia IDs alucinados, mensagens espelhadas do Site no WhatsApp e retomada em turno terminal", () => {
    const quotables: QuotableMessageRef[] = [
      {
        id: "lcx-mirrored-site-msg",
        senderType: "bot",
        provider: "livechat",
        externalId: null,
        content: "Qual a sua produção no site?",
      },
      {
        id: "bot-real-wa",
        senderType: "bot",
        provider: "meta",
        externalId: "wamid.HBgMREAL",
        content: "Qual o CNPJ?",
      },
      {
        id: "cli-final-q",
        senderType: "client",
        provider: "meta",
        externalId: "meta:tecfag:wamid.FINAL",
        content: "Vocês têm assistência técnica própria? Meu CNPJ é 12.345.678/0001-99",
        isCurrentBatch: true,
      },
    ];

    expect(isMessageQuotableOnChannel(quotables[0], "whatsapp", tenantId)).toBe(false);
    expect(isMessageQuotableOnChannel(quotables[0], "site", tenantId)).toBe(true);
    expect(isMessageQuotableOnChannel(quotables[1], "whatsapp", tenantId)).toBe(true);

    // Em turno terminal: permite citar pergunta final do cliente, mas bloqueia unanswered_question e IDs alucinados/espelhados
    const terminalPlan = resolveIndustrialBubbleQuotes({
      tenantId,
      channel: "whatsapp",
      initialAiMessages: [
        "Temos sim assistência técnica própria e peças de reposição em Bauru/SP.",
        "Já vou direcionar seus dados para o nosso especialista continuar com você!",
      ],
      finalMessages: [
        "Temos sim assistência técnica própria e peças de reposição em Bauru/SP.",
        "Já vou direcionar seus dados para o nosso especialista continuar com você!",
      ],
      aiMessageQuotes: [
        { messageIndex: 0, quoteMessageId: "cli-final-q", reason: "client_question" },
        { messageIndex: 1, quoteMessageId: "bot-real-wa", reason: "unanswered_question" },
      ],
      quotableMessages: quotables,
      isTerminalOrClosingTurn: true,
    });
    expect(terminalPlan).toEqual(["cli-final-q", undefined]);

    // ID alucinado ou espelhado nunca passa
    const invalidPlan = resolveIndustrialBubbleQuotes({
      tenantId,
      channel: "whatsapp",
      initialAiMessages: ["Certo!", "Antes, só me responde isso rapidinho?"],
      finalMessages: ["Certo!", "Antes, só me responde isso rapidinho?"],
      aiMessageQuotes: [
        { messageIndex: 0, quoteMessageId: "id-que-nao-existe", reason: "client_question" },
        { messageIndex: 1, quoteMessageId: "lcx-mirrored-site-msg", reason: "unanswered_question" },
      ],
      quotableMessages: quotables,
    });
    expect(invalidPlan).toEqual([undefined, undefined]);
  });

  it("resolveMetaReplyContextMessageId isola por tenant e bloqueia IDs não-Meta", () => {
    expect(resolveMetaReplyContextMessageId("meta:tecfag:wamid.HBgM123", "tecfag", "meta")).toBe(
      "wamid.HBgM123",
    );
    expect(resolveMetaReplyContextMessageId("wamid.HBgMOUTBOUND", "tecfag", "meta")).toBe(
      "wamid.HBgMOUTBOUND",
    );
    // Prefixo de outro tenant não é removido indevidamente e IDs de site/widget/órfão são bloqueados
    expect(
      resolveMetaReplyContextMessageId("bot-durable-abc-widget", "tecfag", "livechat"),
    ).toBeNull();
    expect(resolveMetaReplyContextMessageId("bot-durable-abc-widget", "tecfag", "meta")).toBeNull();
    expect(resolveMetaReplyContextMessageId("usr_999", "tecfag", "meta")).toBeNull();
    expect(resolveMetaReplyContextMessageId("meta:tecfag:orphan:abc", "tecfag", "meta")).toBeNull();
  });

  it("formata autor e preview de citação amigáveis para o Widget do Site e preserva citação no espelho Site→WA", () => {
    expect(
      resolveSiteQuotedSenderLabel({ senderType: "client", senderName: "Visitante" }, "Fagner"),
    ).toBe("Você");
    expect(
      resolveSiteQuotedSenderLabel({ senderType: "bot", senderName: "Fagner (SDR)" }, "Fagner"),
    ).toBe("Fagner");
    expect(
      resolveSiteQuotedSenderLabel(
        { senderType: "bot", senderName: "Valentina (SDR)" },
        "Valentina",
      ),
    ).toBe("Valentina");
    expect(
      resolveSiteQuotedSenderLabel({ senderType: "agent", senderName: "Adriano" }, "Fagner"),
    ).toBe("Adriano");

    expect(formatQuotedPreviewForSite("[MEDIA:image]med_bot_123\nFoto da DZ400")).toBe(
      "📷 Imagem: Foto da DZ400",
    );
    expect(
      formatQuotedPreviewForSite("[MEDIA:audio]med_aud_1", "Quero selar 500 pacotes por dia"),
    ).toBe("🎤 Áudio: Quero selar 500 pacotes por dia");
    expect(formatQuotedPreviewForSite("[MEDIA:document]med_pdf_1:cartao_cnpj.pdf")).toBe(
      "📄 cartao_cnpj.pdf",
    );
    expect(formatQuotedPreviewForSite("[Anexo_Cliente: https://site.com/foto.jpg]")).toBe(
      "📷 Imagem",
    );

    const mirrored = buildMirroredSiteMessageRow({
      tenantId: "tecfag",
      waConversationId: "conv-wa-1",
      siteConversationId: "conv-lc-v1",
      source: {
        id: "site-msg-2",
        senderType: "bot",
        senderName: "Fagner (SDR)",
        content: "Antes, poderia só me responder isso rapidinho?",
        direction: "outbound",
        status: "accepted",
        quotedMessageId: "site-msg-1",
        quotedMessageSender: "Fagner (SDR)",
        quotedMessageContent: "Qual é o seu CNPJ ou CPF?",
        sentAt: new Date("2026-11-26T20:00:00Z"),
      },
    });

    expect(mirrored.quotedMessageId).toBe(buildMirroredSiteMessageId("conv-wa-1", "site-msg-1"));
    expect(mirrored.quotedMessageSender).toBe("Fagner (SDR)");
    expect(mirrored.quotedMessageContent).toBe("Qual é o seu CNPJ ou CPF?");
  });
});
