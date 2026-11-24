import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_INDUSTRIAL_SILENCE_CONFIG,
  evaluateIndustrialSilence,
  findLatestClientRescheduleMs,
  isBotClosingOrInformativeMessage,
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
import {
  buildTecfagFagnerPrompt,
  evaluateIndustrialMachineSuggestionGate,
} from "../src/lib/valentina/sdr-tecfag-prompt";
import {
  evaluateIndustrialSdrOwnershipGuard,
  isOwnSdrOutboundSender,
} from "../src/lib/triage/industrial-ownership-guard";
import { classifySweepPendingBucket } from "../src/lib/triage/sdr-sweep";
import {
  searchIndustrialCatalogEntries,
  selectContextualPromptPhotos,
} from "../src/lib/valentina/knowledge-service";
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
    it("preserva conclusão natural do Fagner em awaiting_approval sem injetar bolha genérica extra", () => {
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
      expect(msgs).toEqual([
        "Obrigado, Josiane. Todas as informações foram registradas.",
        "Um de nossos especialistas em equipamentos industriais entrará em contato em breve com uma proposta detalhada.",
      ]);
      expect(msgs.join("\n")).not.toMatch(/j[aá] coletei tudo|estou validando/i);

      // Quando há pergunta objetiva real (ex.: Bauru), preserva sem anexar bolha genérica fixa
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
        "Certo, José. Agradeço pelas informações.",
        "Nossa matriz fica em Bauru/SP com atendimento para todo o Brasil.",
      ]);
    });

    it("em pedido de humano preserva resposta natural do Fagner ou usa fallback limpo sem 'já coletei tudo'", () => {
      const route = resolveIndustrialRoute({ text: "Quero falar com humano", collectedData: {} });
      const msgs = industrialClientMessages({
        result: { status: "awaiting_approval", operator: null, deal: null },
        route,
        data: {},
        messages: ["Compreendido. Um de nossos especialistas irá assumir o atendimento."],
      });
      expect(msgs).toEqual(["Compreendido. Um de nossos especialistas irá assumir o atendimento."]);
      expect(msgs[0]).not.toMatch(/j[aá] coletei tudo|estou validando/i);

      const fallbackMsgs = industrialClientMessages({
        result: { status: "awaiting_approval", operator: null, deal: null },
        route,
        data: {},
        messages: [],
      });
      expect(fallbackMsgs).toEqual([INDUSTRIAL_HUMAN_REQUEST_APPROVAL_MESSAGE]);
      expect(fallbackMsgs[0]).not.toMatch(/j[aá] coletei tudo|estou validando/i);
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

    it("sdr-engine bloqueia fotos proativas/não solicitadas no Fagner (exige pedido explícito de foto e trava fora da coleta)", () => {
      const sdrEngineSrc = fs.readFileSync(
        path.resolve(process.cwd(), "src/lib/valentina/sdr-engine.ts"),
        "utf8",
      );
      expect(sdrEngineSrc).toContain("const industrialPhotoAllowed =");
      expect(sdrEngineSrc).toContain("isExplicitClientPhotoReq");
      expect(sdrEngineSrc).toContain("!isIndustrialClosingOrHandoffTurn");
      expect(sdrEngineSrc).toContain("!industrialMachineSuggestionGate?.suppressModelListing");
      expect(sdrEngineSrc).toContain("Array.from(new Set(rawImageUrlsToSend))");
      expect(sdrEngineSrc).toContain("const maxIndustrialImagesPerTurn = industrialPhotoAllowed ? 3 : 0;");

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
      expect(prompt).toContain("NUNCA envie fotos proativamente, aleatórias, genéricas ou repetidas durante a triagem");
    });
  });

  describe("Trava de Pré-Requisito e Tom de Sugestão para Oferta de Máquinas no Fagner", () => {
    it("bloqueia oferta/listagem de modelos específicos antes de coletar TODOS os dados essenciais (nome, empresa/CNPJ, aplicação e produtividade/volume)", () => {
      // 1. Apenas pedido genérico de família ("seladora a vácuo")
      const genericTurn = evaluateIndustrialMachineSuggestionGate({
        currentDataSummary: {},
        batchSummary: "Olá, preciso de uma seladora a vácuo",
      });
      expect(genericTurn.mode).toBe("collect_before_suggesting");
      expect(genericTurn.suppressModelListing).toBe(true);
      expect(genericTurn.directive).toContain("TRAVA DE SUGESTÃO DE MÁQUINA ATIVA");
      expect(genericTurn.directive).toContain("PROIBIDO oferecer, indicar, recomendar ou citar");

      // 2. Tem produto/peso da embalagem (potes de 500g), MAS ainda NÃO tem produtividade/volume nem nome/empresa
      const onlyProductTurn = evaluateIndustrialMachineSuggestionGate({
        currentDataSummary: {
          "MÁQUINA / PEÇA / INTERESSE": "Envasadora",
          "RAMO / O QUE EMBALA": "Mel em potes de 500g",
        },
        batchSummary: "Quero uma envasadora para potes de 500g de mel",
      });
      expect(onlyProductTurn.mode).toBe("collect_before_suggesting");
      expect(onlyProductTurn.suppressModelListing).toBe(true);
      expect(onlyProductTurn.hasApplication).toBe(true);
      expect(onlyProductTurn.hasVolume).toBe(false);

      // 2.1 Tem aplicação e produtividade na 1ª mensagem, mas ainda faltam Nome e CNPJ/Empresa -> continua bloqueado!
      const missingIdentityTurn = evaluateIndustrialMachineSuggestionGate({
        currentDataSummary: {},
        batchSummary: "Preciso de uma seladora a vácuo para embalar queijo fatiado, cerca de 500 pacotes por dia",
      });
      expect(missingIdentityTurn.mode).toBe("collect_before_suggesting");
      expect(missingIdentityTurn.suppressModelListing).toBe(true);
      expect(missingIdentityTurn.hasApplication).toBe(true);
      expect(missingIdentityTurn.hasVolume).toBe(true);
      expect(missingIdentityTurn.isFullCollectionComplete).toBe(false);

      // 2.2 Tem Nome + Aplicação + Produtividade, mas confirmação de empresa ainda pendente -> continua bloqueado!
      const pendingCompanyTurn = evaluateIndustrialMachineSuggestionGate({
        currentDataSummary: {
          "NOME COMPLETO": "Tarcisio",
          "EMPRESA": "Tarcisio Silva",
          "MÁQUINA / PEÇA / INTERESSE": "Envasadora",
          "RAMO / O QUE EMBALA": "Mel em potes de 500g",
          "VOLUME / PRODUÇÃO": "800 potes por dia",
        },
        batchSummary: "São cerca de 800 potes por dia",
        hasPendingCompanyConfirmation: true,
      });
      expect(pendingCompanyTurn.mode).toBe("collect_before_suggesting");
      expect(pendingCompanyTurn.suppressModelListing).toBe(true);

      // 3. Coleta completa (Nome + Empresa/CNPJ + Aplicação + Produtividade) -> libera SOMENTE como sugestão condicional (nunca certeza)
      const qualifiedTurn = evaluateIndustrialMachineSuggestionGate({
        currentDataSummary: {
          "NOME COMPLETO": "Maria Silva",
          "CNPJ OU CPF": "12.345.678/0001-99",
          "MÁQUINA / PEÇA / INTERESSE": "Envasadora",
          "RAMO / O QUE EMBALA": "Mel em potes de 500g",
          "VOLUME / PRODUÇÃO": "800 potes por dia",
        },
        batchSummary: "São cerca de 800 potes por dia",
      });
      expect(qualifiedTurn.mode).toBe("suggest_as_possibility_only");
      expect(qualifiedTurn.suppressModelListing).toBe(false);
      expect(qualifiedTurn.isFullCollectionComplete).toBe(true);
      expect(qualifiedTurn.directive).toContain("MODO SUGESTÃO CONDICIONAL LIBERADO");
      expect(qualifiedTurn.directive).toContain("sugestão inicial / possível opção");
      expect(qualifiedTurn.directive).toContain("NUNCA como certeza");

      // 4. Cliente perguntou explicitamente sobre um modelo específico (DZ400) antes de completar a coleta ->
      // libera APENAS a ficha do modelo citado (onlyExplicitMatchedModels=true) e bloqueia empurrar outros modelos
      const specificModelTurn = evaluateIndustrialMachineSuggestionGate({
        currentDataSummary: {},
        batchSummary: "Qual a capacidade da DZ400?",
      });
      expect(specificModelTurn.mode).toBe("client_asked_specific_model");
      expect(specificModelTurn.suppressModelListing).toBe(false);
      expect(specificModelTurn.onlyExplicitMatchedModels).toBe(true);
      expect(specificModelTurn.directive).toContain("PROIBIDO oferecer, recomendar ou citar OUTROS modelos");

      // 5. Fluxo de assistência/manual não sofre supressão
      const manualTurn = evaluateIndustrialMachineSuggestionGate({
        currentDataSummary: {},
        batchSummary: "Preciso do manual da minha seladora que deu defeito",
        subflow: "3_AT",
      });
      expect(manualTurn.mode).toBe("non_machine_or_support_flow");
      expect(manualTurn.suppressModelListing).toBe(false);
    });

    it("searchIndustrialCatalogEntries oculta nomes/códigos de modelos quando suppressModelListingUntilQualified=true mas preserva alerta de família não encontrada/bloqueada", () => {
      const miniCatalog = [
        {
          id: "1",
          name: "Seladora a Vácuo DZ400",
          sku: "DZ400",
          code: "PAMQSELA001",
          line: "SEMI-INDUSTRIAL",
          production: "2 a 3 ciclos/min",
          description: "Seladora a vácuo de câmara para alimentos.",
          active: true,
        },
      ];

      const suppressed = searchIndustrialCatalogEntries(
        "Preciso de uma seladora a vácuo",
        miniCatalog,
        [],
        10,
        { suppressModelListingUntilQualified: true },
      );
      expect(suppressed).toContain("LINHA CONFIRMADA SEM LISTAGEM DE MODELOS NESTE TURNO");
      expect(suppressed).not.toContain("DZ400");
      expect(suppressed).not.toContain("PAMQSELA001");

      // Quando liberado (após coletar aplicação + produtividade), volta a exibir o modelo normalmente
      const revealed = searchIndustrialCatalogEntries(
        "Preciso de uma seladora a vácuo para carnes",
        miniCatalog,
        [],
        10,
        { suppressModelListingUntilQualified: false },
      );
      expect(revealed).toContain("DZ400");
      expect(revealed).toContain("EQUIPAMENTOS ENCONTRADOS NO CATÁLOGO OFICIAL");

      // Família não encontrada continua emitindo aviso anti-alucinação mesmo com supressão ativa
      const notFound = searchIndustrialCatalogEntries(
        "Vocês vendem máquina de bolinhas de paintball?",
        miniCatalog,
        [],
        10,
        { suppressModelListingUntilQualified: true },
      );
      expect(notFound).toContain("NENHUMA máquina do catálogo oficial correspondeu");
    });

    it("prompt do Fagner contém regra permanente de pré-requisitos e tom explícito de sugestão (e sdr-engine passa suppressIndustrialModelListing ao RAG)", () => {
      const prompt = buildTecfagFagnerPrompt({
        aiPersona: getAiPersona("tecfag"),
        knowledgeContext: "",
        conversationHistoryText: "",
        batchSummary: "Quero uma envasadora",
        currentDataSummary: {},
        cnpjDirective: "",
        firstMessageRule: "",
        hasPreviousEmoji: false,
        hasPreviousAudio: false,
      });
      expect(prompt).toContain("REGRA OBRIGATÓRIA DE SUGESTÃO DE MÁQUINAS");
      expect(prompt).toContain("sugestão preliminar de possível máquina");
      expect(prompt).toContain("TRAVA DE SUGESTÃO DE MÁQUINA ATIVA NESTE TURNO");

      const sdrEngineSrc = fs.readFileSync(
        path.resolve(process.cwd(), "src/lib/valentina/sdr-engine.ts"),
        "utf8",
      );
      expect(sdrEngineSrc).toContain("evaluateIndustrialMachineSuggestionGate");
      expect(sdrEngineSrc).toContain("suppressIndustrialModelListing");
    });
  });

  describe("Bloqueio de Follow-up de Silêncio pós-Informativo (BRUNA) e pós-Despedida (Carlos)", () => {
    it("não cobra silêncio em fluxo informativo (5B_CURRICULO / 5C_COMPRAS / Concluído (Informativo)) — caso BRUNA GABRIELE", () => {
      const decisionBySubflow = evaluateIndustrialSilence({
        now: new Date("2026-11-24T13:30:00.000Z"),
        withinSchedule: true,
        flow: {
          id: "fs-bruna",
          tenantId: "tecfag",
          conversationId: "conv-lc-da8ce890-6573-40e3-a703-d4275f21ac79",
          startedAt: new Date("2026-11-24T11:00:00.000Z"),
          outcome: "in_progress",
          currentStep: "Concluído (Informativo)",
          metadata: { subflow: "5B_CURRICULO", followUpStage: 0 },
        },
        conversation: { id: "conv-lc-da8ce890-6573-40e3-a703-d4275f21ac79", queueState: "automacao", operatorId: null },
        recentMessages: [
          { id: "m1", senderType: "client", sentAt: "2026-11-24T11:01:00.000Z", content: "Como faço pra enviar currículo" },
          { id: "m2", senderType: "bot", sentAt: "2026-11-24T11:01:30.000Z", content: "Olá, Bruna. O setor responsável pelo recebimento de currículos é o nosso RH. Registrei seu contato e interesse." },
          { id: "m3", senderType: "bot", sentAt: "2026-11-24T11:01:31.000Z", content: "Posso ajudar com mais alguma informação sobre nossos equipamentos ou serviços?" },
        ],
      });
      expect(decisionBySubflow.action).toBe("none");
      expect(decisionBySubflow.reason).toBe("informative_or_resolved_flow");

      // Mesmo sem subflow/currentStep preenchidos, a pergunta protocolar de cortesia NÃO dispara follow-up
      const decisionByMessage = evaluateIndustrialSilence({
        now: new Date("2026-11-24T13:30:00.000Z"),
        withinSchedule: true,
        flow: {
          id: "fs-bruna-2",
          tenantId: "tecfag",
          conversationId: "conv-lc-da8ce890-6573-40e3-a703-d4275f21ac79",
          startedAt: new Date("2026-11-24T11:00:00.000Z"),
          outcome: "in_progress",
          metadata: { followUpStage: 0 },
        },
        conversation: { id: "conv-lc-da8ce890-6573-40e3-a703-d4275f21ac79", queueState: "automacao", operatorId: null },
        recentMessages: [
          { id: "m1", senderType: "client", sentAt: "2026-11-24T11:01:00.000Z", content: "Como faço pra enviar currículo" },
          { id: "m2", senderType: "bot", sentAt: "2026-11-24T11:01:30.000Z", content: "Posso ajudar com mais alguma informação sobre nossos equipamentos ou serviços?" },
        ],
      });
      expect(decisionByMessage.action).toBe("none");
      expect(decisionByMessage.reason).toBe("bot_already_closed_conversation");
    });

    it("não cobra silêncio após despedida cordial do próprio Fagner — caso Carlos", () => {
      const decision = evaluateIndustrialSilence({
        now: new Date("2026-11-23T19:00:00.000Z"),
        withinSchedule: true,
        flow: {
          id: "fs-carlos",
          tenantId: "tecfag",
          conversationId: "conv-rdc-551497125011",
          startedAt: new Date("2026-11-23T17:00:00.000Z"),
          outcome: "in_progress",
          currentStep: "Em Qualificação",
          metadata: { followUpStage: 0 },
        },
        conversation: { id: "conv-rdc-551497125011", queueState: "automacao", operatorId: null },
        recentMessages: [
          { id: "m1", senderType: "client", sentAt: "2026-11-23T17:45:11.000Z", content: "[MEDIA:audio]" },
          { id: "m2", senderType: "bot", sentAt: "2026-11-23T17:45:52.000Z", content: "Compreendido, Carlos. Agradeço o retorno." },
          { id: "m3", senderType: "bot", sentAt: "2026-11-23T17:45:52.100Z", content: "Ficamos à disposição para qualquer necessidade futura. Um abraço." },
        ],
      });
      expect(decision.action).toBe("none");
      expect(decision.reason).toBe("bot_already_closed_conversation");
    });

    it("preserva follow-up normal de silêncio quando o Fagner fez uma pergunta real de qualificação", () => {
      expect(
        isBotClosingOrInformativeMessage(
          "Ficamos à disposição para ajudar! Para agilizar, qual produto você pretende envasar e qual a sua produção diária?",
        ),
      ).toBe(false);

      const decision = evaluateIndustrialSilence({
        now: new Date("2026-11-24T13:10:00.000Z"),
        withinSchedule: true,
        flow: {
          id: "fs-normal",
          tenantId: "tecfag",
          conversationId: "conv-wa-normal",
          startedAt: new Date("2026-11-24T12:00:00.000Z"),
          outcome: "in_progress",
          currentStep: "Em Qualificação",
          metadata: { followUpStage: 0 },
        },
        conversation: { id: "conv-wa-normal", queueState: "automacao", operatorId: null },
        recentMessages: [
          { id: "m1", senderType: "client", sentAt: "2026-11-24T12:01:00.000Z", content: "Quero uma seladora" },
          { id: "m2", senderType: "bot", sentAt: "2026-11-24T12:01:30.000Z", content: "Para te ajudar melhor, o que você vai embalar e qual a produção diária aproximada?" },
        ],
      });
      expect(decision.action).toBe("send_followup");
      expect(decision.nextStage).toBe(1);
    });

    it("integração: sdr-followup-engine passa currentStep e sdr-engine encerra fluxos informativos e despedidas cordiais", () => {
      const followUpSrc = fs.readFileSync(
        path.resolve(process.cwd(), "src/lib/valentina/sdr-followup-engine.ts"),
        "utf8",
      );
      const sdrEngineSrc = fs.readFileSync(
        path.resolve(process.cwd(), "src/lib/valentina/sdr-engine.ts"),
        "utf8",
      );
      expect(followUpSrc).toContain("currentStep: flow.currentStep");
      expect(sdrEngineSrc).toContain("isCordialBotClosingTurn");
      expect(sdrEngineSrc).toContain("isInformativeResolution");
    });
  });

  describe("Hotfix 24/11 11h17 — P0 Ownership SDR Template (6 leads RD) + Pedro ready + P1 VTEX preço WA + Sweep falsos positivos", () => {
    it("P0.A: template enviado como 'Fagner (SDR)' em automacao (mesmo com senderType='agent') NÃO bloqueia o Fagner SDR, mas agentes externos/humanos continuam bloqueados", () => {
      expect(isOwnSdrOutboundSender("Fagner (SDR)")).toBe(true);
      expect(isOwnSdrOutboundSender("Valentina (SDR)")).toBe(true);
      expect(isOwnSdrOutboundSender("Isabella Inhesta")).toBe(false);
      expect(isOwnSdrOutboundSender("Fagner")).toBe(false);

      const now = new Date("2026-11-24T14:15:00.000Z");
      // Caso real Aloisio Boff / Gabriel Coutinho / João Angelo: template RD salvo como agent com senderName="Fagner (SDR)" em automacao sem operador
      const ownTemplateDecision = evaluateIndustrialSdrOwnershipGuard({
        queueState: "automacao",
        operatorId: null,
        flowOutcome: null,
        latestOutbound: {
          senderType: "agent",
          senderName: "Fagner (SDR)",
          sentAt: "2026-11-24T13:17:10.555Z",
          isInternalNote: false,
        },
        now,
      });
      expect(ownTemplateDecision.blocked).toBe(false);

      // Agente humano/externo sem sufixo "(SDR)" CONTINUA bloqueado mesmo em automacao
      const externalAgentDecision = evaluateIndustrialSdrOwnershipGuard({
        queueState: "automacao",
        operatorId: null,
        flowOutcome: null,
        latestOutbound: {
          senderType: "agent",
          senderName: "Isabella Inhesta",
          sentAt: "2026-11-24T13:17:10.555Z",
          isInternalNote: false,
        },
        now,
      });
      expect(externalAgentDecision.blocked).toBe(true);
      expect(externalAgentDecision.reason).toBe("external_agent_active");

      // Fila humana ('fila') CONTINUA 100% bloqueada mesmo que senderName seja Fagner (SDR)
      const filaDecision = evaluateIndustrialSdrOwnershipGuard({
        queueState: "fila",
        operatorId: null,
        flowOutcome: null,
        latestOutbound: {
          senderType: "agent",
          senderName: "Fagner (SDR)",
          sentAt: "2026-11-24T13:17:10.555Z",
          isInternalNote: false,
        },
        now,
      });
      expect(filaDecision.blocked).toBe(true);
      expect(filaDecision.reason).toBe("non_automacao_queue:fila");

      // send_meta_template passa senderType="bot" em disparos SDR sem operador
      const mcpWriteSrc = fs.readFileSync(
        path.resolve(process.cwd(), "src/lib/mcp/valem-tecfag-mcp-write-tools.ts"),
        "utf8",
      );
      expect(mcpWriteSrc).toContain('senderType: isSdrAutomatedTemplate ? "bot" : "agent"');
    });

    it("P0.B (caso Pedro EC60): implicitReadyHandoff entra em awaiting_approval quando ready=true e bot promete encaminhamento (sem travar em ready)", () => {
      const sdrEngineSrc = fs.readFileSync(
        path.resolve(process.cwd(), "src/lib/valentina/sdr-engine.ts"),
        "utf8",
      );
      expect(sdrEngineSrc).toContain(
        "hasPendingQuestion: implicitReadyHandoff ? false : hasPendingQuestion",
      );
    });

    it("P1.A (caso Flávio Corrêa): VTEX em WhatsApp entrega diretriz ai_context para price/shipping sem repetir frase robótica nem liberar oferta prematura", () => {
      const runtimeSrc = fs.readFileSync(
        path.resolve(process.cwd(), "src/lib/vtex/runtime.ts"),
        "utf8",
      );
      expect(runtimeSrc).toContain("DIRETRIZ DE POLÍTICA COMERCIAL NO WHATSAPP");
      expect(runtimeSrc).toContain('mode: "ai_context" as const');

      const prompt = buildTecfagFagnerPrompt({
        aiPersona: getAiPersona("tecfag"),
        knowledgeContext: "",
        vtexProductContext:
          "DIRETRIZ DE POLÍTICA COMERCIAL NO WHATSAPP (PRICE RESTRITO):\n- O cliente perguntou sobre valores.",
        conversationHistoryText: "",
        batchSummary: "qual o valor desta maquina",
        currentDataSummary: { "RAMO / O QUE EMBALA": "pães de queijo" },
        cnpjDirective: "",
        firstMessageRule: "",
        hasPreviousEmoji: false,
        hasPreviousAudio: false,
      });
      // Não deve desativar a trava de produtividade só por ter diretriz comercial VTEX
      expect(prompt).toContain("TRAVA DE SUGESTÃO DE MÁQUINA ATIVA NESTE TURNO");
    });

    it("P1.B (Sweep SQL): elimina falsos positivos de awaiting_ai (camila, Tarcisio Site, BRUNA Site, Carlos 👍🙏) mas preserva casos reais (Pedro preso em ready, Aloisio sem resposta)", () => {
      // BRUNA Site: Concluído (Informativo) -> skip
      expect(
        classifySweepPendingBucket({
          monitoringState: "ready",
          currentStep: "Concluído (Informativo)",
          subflow: "5B_CURRICULO",
          lastMessageSender: "bot",
          lastMessageContent: "Olá, BRUNA! Conseguiu ver minha última mensagem?",
        }),
      ).toBe("skip_closed_informative");

      // camila / Tarcisio Site: ready mas bot perguntou confirmação ou mandou follow-up -> awaiting_client
      expect(
        classifySweepPendingBucket({
          monitoringState: "ready",
          currentStep: "Em Qualificação",
          subflow: "1A_MAQUINAS",
          lastMessageSender: "bot",
          lastMessageContent: "Sua empresa é a GECAPS COMERCIO DE PRODUTOS NATURAIS LTDA, certo?",
        }),
      ).toBe("awaiting_client");

      expect(
        classifySweepPendingBucket({
          monitoringState: "ready",
          currentStep: "Em Qualificação",
          subflow: "1A_MAQUINAS",
          lastMessageSender: "bot",
          lastMessageContent: "Tarcisio, vou deixar nosso atendimento em aberto por aqui para não te incomodar.",
        }),
      ).toBe("awaiting_client");

      // Carlos: emoji final 👍🙏 após encerramento -> NÃO é awaiting_ai
      expect(
        classifySweepPendingBucket({
          monitoringState: "collecting",
          currentStep: "Encerrado (Sem interesse)",
          subflow: null,
          lastMessageSender: "client",
          lastMessageContent: "👍🙏",
        }),
      ).toBe("skip_closed_informative");

      // Pedro EC60 (real stuck em ready): bot afirmou registro sem pergunta -> CONTINUA alertando awaiting_ai!
      expect(
        classifySweepPendingBucket({
          monitoringState: "ready",
          currentStep: "Em Qualificação",
          subflow: "3_AT",
          lastMessageSender: "bot",
          lastMessageContent: "As informações do atendimento estão registradas. A equipe responsável poderá dar continuidade por aqui.",
        }),
      ).toBe("awaiting_ai_handoff_stuck");

      // Cliente real aguardando resposta (ex.: Aloisio Boff) -> CONTINUA alertando awaiting_ai!
      expect(
        classifySweepPendingBucket({
          monitoringState: "collecting",
          currentStep: "Em Qualificação",
          subflow: "1A_MAQUINAS",
          lastMessageSender: "client",
          lastMessageContent: "Nossa caixa mede 600 mm comprimento 400 mm largura 150 mm altura",
        }),
      ).toBe("awaiting_ai_client_waiting");
    });
  });
});
