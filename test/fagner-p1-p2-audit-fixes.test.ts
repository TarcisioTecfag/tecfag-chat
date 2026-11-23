import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_INDUSTRIAL_SILENCE_CONFIG,
  evaluateIndustrialSilence,
  findLatestClientRescheduleMs,
  parseIndustrialSilenceConfig,
} from "../src/lib/triage/industrial-silence-policy";
import {
  isAutomatedBotOrUraMessage,
  isClientDecliningTriage,
  isValidIndustrialPersonName,
  normalizeIndustrialFunnel,
  resolveIndustrialRoute,
} from "../src/lib/triage/industrial-policy";
import {
  INDUSTRIAL_AWAITING_APPROVAL_CLIENT_MESSAGE,
  INDUSTRIAL_HUMAN_REQUEST_APPROVAL_MESSAGE,
  industrialClientMessages,
} from "../src/lib/triage/industrial-handoff";
import { buildTecfagFagnerPrompt } from "../src/lib/valentina/sdr-tecfag-prompt";
import { selectContextualPromptPhotos } from "../src/lib/valentina/knowledge-service";
import { getAiPersona } from "../src/lib/ai-persona";

describe("Correções P1/P2 da Auditoria Fagner — Itens 2, 3, 4 e 5 (23/11/2026)", () => {
  describe("Item 2 — Régua de silêncio (60m→+120m→+180m) + respeito a reagendamento explícito", () => {
    it("defaults sobem para 60m (FU1), 120m (FU2) e 180m (Sem Resposta), eliminando abandono em 20 min", () => {
      const cfg = parseIndustrialSilenceConfig({});
      expect(DEFAULT_INDUSTRIAL_SILENCE_CONFIG.followUp1Minutes).toBe(60);
      expect(DEFAULT_INDUSTRIAL_SILENCE_CONFIG.followUp2Minutes).toBe(120);
      expect(DEFAULT_INDUSTRIAL_SILENCE_CONFIG.noResponseAfterFollowUp2Minutes).toBe(180);
      expect(cfg.followUp2Minutes).toBe(120);
    });

    it("respeita reagendamento explícito (casos Produtos da Roça e Eliezer) — não cobra às 08:00 nem abandona às 08:20", () => {
      const cfg = parseIndustrialSilenceConfig({});
      const sunNightMsg = new Date("2026-11-23T00:00:00.000Z"); // Dom 21:00 BRT
      const mon0800Brt = new Date("2026-11-23T11:00:00.000Z"); // Seg 08:00 BRT
      const mon0820Brt = new Date("2026-11-23T11:20:00.000Z"); // Seg 08:20 BRT

      const msgs = [
        {
          id: "m1",
          senderType: "client",
          sentAt: sunNightMsg,
          content: "Mas é só pra lembrar, na segunda-feira a gente conversa, preocupa não.",
        },
        {
          id: "m2",
          senderType: "bot",
          sentAt: new Date("2026-11-23T00:01:00.000Z"),
          content: "Combinado. Na segunda-feira, em horário comercial, retomamos o contato.",
        },
      ];

      expect(findLatestClientRescheduleMs(msgs)).not.toBeNull();

      const dec0800 = evaluateIndustrialSilence({
        now: mon0800Brt,
        withinSchedule: true,
        flow: {
          id: "fs-roca",
          tenantId: "tecfag",
          conversationId: "conv-roca",
          startedAt: new Date("2026-11-21T05:24:00.000Z"),
          lastInteractionAt: new Date("2026-11-23T00:01:00.000Z"),
          outcome: "in_progress",
          completedAt: null,
          followUpStage: 0,
          collectedData: {},
          metadata: { followUpStage: 0 },
        },
        conversation: { id: "conv-roca", queueState: "automacao", operatorId: null },
        recentMessages: msgs,
        config: cfg,
      });
      expect(dec0800.action).toBe("none");
      expect(dec0800.reason).toBe("client_rescheduled_grace_period");

      // Mesmo se stage=1 já tivesse sido enviado, às 08:20 não envia FU2 nem abandona
      const dec0820 = evaluateIndustrialSilence({
        now: mon0820Brt,
        withinSchedule: true,
        flow: {
          id: "fs-eli",
          tenantId: "tecfag",
          conversationId: "conv-eli",
          startedAt: new Date("2026-11-20T14:15:00.000Z"),
          lastInteractionAt: mon0800Brt,
          outcome: "in_progress",
          completedAt: null,
          followUpStage: 1,
          collectedData: {},
          metadata: { followUpStage: 1 },
        },
        conversation: { id: "conv-eli", queueState: "automacao", operatorId: null },
        recentMessages: [
          {
            id: "e1",
            senderType: "client",
            sentAt: new Date("2026-11-22T23:00:00.000Z"), // Dom 20:00 BRT
            content: "Fagner, vou precisar pegar o CNPJ amanhã",
          },
          {
            id: "e2",
            senderType: "bot",
            sentAt: mon0800Brt,
            content: "Olá! Conseguiu ver minha última mensagem?",
          },
        ],
        config: cfg,
      });
      expect(dec0820.action).toBe("none");
      expect(dec0820.reason).toBe("client_rescheduled_grace_period");
    });

    it("cancela silêncio se a conversa estiver em queueState='fila'", () => {
      const dec = evaluateIndustrialSilence({
        now: new Date("2026-11-23T14:00:00.000Z"),
        withinSchedule: true,
        flow: {
          id: "fs-fila",
          tenantId: "tecfag",
          conversationId: "conv-fila",
          startedAt: new Date("2026-11-23T11:00:00.000Z"),
          lastInteractionAt: new Date("2026-11-23T11:05:00.000Z"),
          outcome: "in_progress",
          completedAt: null,
          followUpStage: 0,
          collectedData: {},
          metadata: {},
        },
        conversation: { id: "conv-fila", queueState: "fila", operatorId: null },
        recentMessages: [
          { id: "f1", senderType: "bot", sentAt: new Date("2026-11-23T11:05:00.000Z"), content: "Olá" },
        ],
      });
      expect(dec.action).toBe("cancel_by_human");
    });
  });

  describe("Item 3 — Fim da despedida dupla, desistência, currículos e anti-bot 0800", () => {
    it("remove despedida/agradecimento redundante em awaiting_approval e preserva respostas informativas reais", () => {
      const route = resolveIndustrialRoute({ text: "seladora a vácuo", collectedData: {} });
      const msgs = industrialClientMessages({
        result: { status: "awaiting_approval", operator: null, deal: null },
        route,
        data: {},
        messages: [
          "Obrigado, Josiane. Todas as informações foram registradas.",
          "Um de nossos especialistas em equipamentos industriais entrará em contato em breve com uma proposta detalhada.",
        ],
      });
      expect(msgs).toEqual([INDUSTRIAL_AWAITING_APPROVAL_CLIENT_MESSAGE]);

      // Quando há pergunta objetiva real (ex.: Black Friday / Bauru), preserva apenas o informativo
      const withInfo = industrialClientMessages({
        result: { status: "awaiting_approval", operator: null, deal: null },
        route,
        data: {},
        messages: [
          "Certo, José. Agradeço pelas informações.",
          "Nossa matriz fica em Bauru/SP com atendimento para todo o Brasil.",
        ],
      });
      expect(withInfo).toEqual([
        "Nossa matriz fica em Bauru/SP com atendimento para todo o Brasil.",
        INDUSTRIAL_AWAITING_APPROVAL_CLIENT_MESSAGE,
      ]);
    });

    it("usa mensagem neutra adequada quando cliente pediu humano sem coleta completa (Fabio, Alceu, Amiê)", () => {
      const route = resolveIndustrialRoute({ text: "Quero falar com humano", collectedData: {} });
      const msgs = industrialClientMessages({
        result: { status: "awaiting_approval", operator: null, deal: null },
        route,
        data: {},
        messages: ["Compreendido. Um de nossos especialistas irá assumir o atendimento."],
      });
      expect(msgs).toEqual([INDUSTRIAL_HUMAN_REQUEST_APPROVAL_MESSAGE]);
      expect(msgs[0]).not.toContain("já coletei tudo");
    });

    it("para status 'resolved' (currículo 5B_CURRICULO ou recusa), NÃO injeta 'Perfeito, já coletei tudo!'", () => {
      const route = resolveIndustrialRoute({ text: "Segue meu currículo para vaga de estágio", collectedData: {} });
      const msgs = industrialClientMessages({
        result: { status: "resolved", operator: null, deal: null },
        route,
        data: {},
        messages: ["Certo. Agradecemos o seu contato. Tenha um ótimo dia!"],
      });
      expect(msgs).toEqual(["Certo. Agradecemos o seu contato. Tenha um ótimo dia!"]);
    });

    it("detecta desistência explícita (caso Dayse Sanches: 'Não, agradeço') sem falso positivo em novas demandas", () => {
      expect(isClientDecliningTriage("Não, agradeço")).toBe(true);
      expect(isClientDecliningTriage("nao obrigado")).toBe(true);
      expect(isClientDecliningTriage("Não tenho interesse, pode encerrar")).toBe(true);
      expect(isClientDecliningTriage("Não, obrigado, quero ver uma seladora a vácuo")).toBe(false);
      expect(isClientDecliningTriage("Preciso de fita teflon")).toBe(false);
    });

    it("detecta URA automática externa e telefones 0800 (caso Grupo Caçola 558007222652)", () => {
      expect(isAutomatedBotOrUraMessage({ phone: "558007222652", text: "Olá" })).toBe(true);
      expect(
        isAutomatedBotOrUraMessage({
          phone: "5511999998888",
          text: "Olá, seja bem vindo ao Grupo Caçola. A seguir digite a opção desejada:\n*1* - Vendas\n*2* - Compras\n*3* - Financeiro\n*13* - Finalizar Autoatendimento",
        }),
      ).toBe(true);
      expect(
        isAutomatedBotOrUraMessage({
          phone: "5511999998888",
          text: "Não entendi, poderia repetir?",
        }),
      ).toBe(true);
      expect(
        isAutomatedBotOrUraMessage({
          phone: "5511999998888",
          text: "Bom dia, preciso de uma seladora a vácuo",
        }),
      ).toBe(false);
    });
  });

  describe("Item 4 — Mídia / PDF na 1ª mensagem (Marcelo) e leitura direta de NF (Samara)", () => {
    it("sdr-engine não sobrescreve 1ª mensagem com mídia e rotula anexos multimodais; prompt proíbe negar leitura de NF", () => {
      const sdrEngineSrc = fs.readFileSync(
        path.resolve(process.cwd(), "src/lib/valentina/sdr-engine.ts"),
        "utf8",
      );
      const inboundSrc = fs.readFileSync(
        path.resolve(process.cwd(), "src/lib/whatsapp/inbound.ts"),
        "utf8",
      );

      expect(sdrEngineSrc).toContain("!hasMediaInBatch &&");
      expect(sdrEngineSrc).toContain("Leia/analise diretamente este conteúdo visual/textual/auditivo");
      // inbound não anexa buffer cru de vídeo em mediaBase64 (evita sufocar foto da NF no mesmo lote)
      expect(inboundSrc).toContain('mediaType = "document"');
      expect(inboundSrc).not.toContain("if (media && media.dataBuffer) {\n      mimeType = media.mimeType;\n      mediaBase64 = media.dataBuffer.toString(\"base64\");");

      const prompt = buildTecfagFagnerPrompt({
        aiPersona: getAiPersona("tecfag"),
        knowledgeContext: "",
        conversationHistoryText: "",
        batchSummary: "Segue a nota fiscal da compra",
        currentDataSummary: {},
        cnpjDirective: "",
        firstMessageRule: "",
        hasPreviousEmoji: false,
        hasPreviousAudio: false,
      });
      expect(prompt).toContain("NUNCA diga \"por ser um assistente virtual, não consigo ler imagens/documentos/notas fiscais\"");
      expect(prompt).toContain("NUNCA copie apelidos/status de perfil do WhatsApp");
    });
  });

  describe("Item 5 — Higiene de funis canônicos, proteção contra apelidos WhatsApp e dedup inter-turnos", () => {
    it("normaliza grafias duplicadas de funil ('Pós venda' -> 'Pós-Venda', 'Suporte Técnico' -> 'Assistência Técnica')", () => {
      expect(normalizeIndustrialFunnel("Pós venda")).toBe("Pós-Venda");
      expect(normalizeIndustrialFunnel("Pós-Venda")).toBe("Pós-Venda");
      expect(normalizeIndustrialFunnel("Pos venda")).toBe("Pós-Venda");
      expect(normalizeIndustrialFunnel("Suporte Técnico")).toBe("Assistência Técnica");
      expect(normalizeIndustrialFunnel("Suporte Tecnico")).toBe("Assistência Técnica");
      expect(normalizeIndustrialFunnel("Assistência Técnica")).toBe("Assistência Técnica");
    });

    it("rejeita apelidos/status/e-mails/telefones como NOME COMPLETO (Em Reuniao, ., 558007222652) e aceita nomes reais", () => {
      expect(isValidIndustrialPersonName("Em Reuniao")).toBe(false);
      expect(isValidIndustrialPersonName("Em Reunião")).toBe(false);
      expect(isValidIndustrialPersonName(".")).toBe(false);
      expect(isValidIndustrialPersonName("558007222652")).toBe(false);
      expect(isValidIndustrialPersonName("financeiro@patiocontorno.com")).toBe(false);
      expect(isValidIndustrialPersonName("Nome privado")).toBe(false);
      expect(isValidIndustrialPersonName("A")).toBe(false);

      expect(isValidIndustrialPersonName("José Nolasco")).toBe(true);
      expect(isValidIndustrialPersonName("Állek")).toBe(true);
      expect(isValidIndustrialPersonName("Mônica")).toBe(true);
      expect(isValidIndustrialPersonName("Marcello Mattos")).toBe(true);
    });

    it("sdr-engine possui guarda anti-duplicação inter-turnos e skip de CWR para não-comerciais", () => {
      const sdrEngineSrc = fs.readFileSync(
        path.resolve(process.cwd(), "src/lib/valentina/sdr-engine.ts"),
        "utf8",
      );
      expect(sdrEngineSrc).toContain("DEDUPLICAÇÃO INTER-TURNOS");
      expect(sdrEngineSrc).toContain("isNonCommercialOutcome");
      expect(sdrEngineSrc).toContain("isClientDeclinedTurn");
      expect(sdrEngineSrc).toContain("isAutomatedBotOrUraMessage");
    });
  });

  describe("Anti-Spam de Fotos Aleatórias no Fagner (industrial)", () => {
    const samplePhotos = [
      {
        name: "Seladora a Vácuo DZ400.png",
        category: "Seladoras",
        sku: "DZ400",
        compactModel: "dz400",
      },
      {
        name: "Envasadora de Líquidos SYF-200.png",
        category: "Envasadoras",
        sku: "SYF-200",
        compactModel: "syf200",
      },
      {
        name: "Encapsuladora Softgel SOFTECH110.png",
        category: "Personnalite",
        sku: "SOFTECH110",
        compactModel: "softech110",
      },
    ];

    it("não injeta fotos aleatórias no prompt industrial quando a mensagem está vazia ou usa apenas termos genéricos ('seladora', 'máquina')", () => {
      expect(
        selectContextualPromptPhotos({
          items: samplePhotos,
          queryHint: "",
          isIndustrialPolicy: true,
        }),
      ).toEqual([]);

      expect(
        selectContextualPromptPhotos({
          items: samplePhotos,
          queryHint: "Olá, preciso de uma seladora a vácuo para carnes",
          isIndustrialPolicy: true,
        }),
      ).toEqual([]);

      // Quando o cliente cita um modelo específico (DZ400), libera apenas o modelo correspondente
      const exactMatch = selectContextualPromptPhotos({
        items: samplePhotos,
        queryHint: "Quero saber mais sobre a DZ400",
        isIndustrialPolicy: true,
      });
      expect(exactMatch.map((p) => p.sku)).toEqual(["DZ400"]);

      // Quando o cliente pede foto explicitamente de uma família, libera a família (limitado a maxPhotos)
      const explicitPhoto = selectContextualPromptPhotos({
        items: samplePhotos,
        queryHint: "Pode me mandar foto da seladora a vácuo?",
        isIndustrialPolicy: true,
      });
      expect(explicitPhoto.map((p) => p.sku)).toEqual(["DZ400"]);

      // Valem (não-industrial) preserva comportamento legado sem quebrar
      expect(
        selectContextualPromptPhotos({
          items: samplePhotos,
          queryHint: "",
          isIndustrialPolicy: false,
        }).length,
      ).toBe(3);
    });

    it("sdr-engine bloqueia spam de fotos não solicitadas (limite 1 em 24h, bloqueio em fechamento/handoff e exigência de modelo específico)", () => {
      const sdrEngineSrc = fs.readFileSync(
        path.resolve(process.cwd(), "src/lib/valentina/sdr-engine.ts"),
        "utf8",
      );
      expect(sdrEngineSrc).toContain("botImagesSentIn24hCount >= 1");
      expect(sdrEngineSrc).toContain("isIndustrialClosingOrHandoffTurn");
      expect(sdrEngineSrc).toContain("clientMentionedSpecificMachineModel");
      expect(sdrEngineSrc).toContain("Array.from(new Set(rawImageUrlsToSend))");
      expect(sdrEngineSrc).toContain("const maxIndustrialImagesPerTurn = isExplicitClientPhotoReq ? 3 : 1;");

      const prompt = buildTecfagFagnerPrompt({
        aiPersona: getAiPersona("tecfag"),
        knowledgeContext: "",
        conversationHistoryText: "",
        batchSummary: "Quero uma seladora",
        currentDataSummary: {},
        cnpjDirective: "",
        firstMessageRule: "",
        hasPreviousEmoji: false,
        hasPreviousAudio: false,
      });
      expect(prompt).toContain("NUNCA envie fotos aleatórias, genéricas ou repetidas durante a triagem");
    });
  });
});
