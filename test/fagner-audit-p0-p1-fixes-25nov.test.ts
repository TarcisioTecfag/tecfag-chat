import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { getAiPersona } from "../src/lib/ai-persona";
import { captureSiteContext } from "../src/lib/livechat/site-context";
import {
  evaluateIndustrialClientMessages,
  industrialClientMessages,
  startsWithOrphanAnaphoricConnector,
  stripLeadingOrphanAnaphoricConnector,
} from "../src/lib/triage/industrial-handoff";
import { finalizeIndustrialOpeningMessages } from "../src/lib/triage/industrial-opening-policy";
import {
  buildIndustrialFollowUpJudgePrompt,
} from "../src/lib/triage/industrial-followup-ai";
import { resolveIndustrialRoute } from "../src/lib/triage/industrial-policy";
import {
  buildIndustrialReplyRewritePrompt,
  prioritizeMissingFieldsForConversation,
  sanitizeRewrittenIndustrialMessages,
} from "../src/lib/triage/industrial-reply-rewriter";
import {
  buildIndustrialFollowUpText,
  hasPartialCollectedData,
} from "../src/lib/triage/industrial-silence-policy";
import { evaluateKnownCompanyConfirmation } from "../src/lib/triage/known-client-lookup";
import { buildTecfagFagnerPrompt } from "../src/lib/valentina/sdr-tecfag-prompt";
import { defaultVtexSettings } from "../src/lib/vtex/contract";
import { runVtexStoreTurn } from "../src/lib/vtex/runtime";
import {
  deriveVtexQuery,
  extractSitePageProduct,
  formatVtexAiContext,
} from "../src/lib/vtex/turn";

describe("Correções P0/P1 Auditoria Fagner 25/11/2026 (Fabio/Döhler, Ranieri, Fabrícia, Tailís)", () => {
  const dohlerPageContext = captureSiteContext(
    {
      entry: {
        url: "https://www.tecfag.com.br/rosqueadeira-de-tampas-de-plastico---dk50z/p?utm_source=google-shopping&utm_medium=cpc&utm_campaign=black-november-semi",
        title: "Rosqueadeira Pneumática de Tampas DK50Z | Tecfag - Tecfag",
        referrer: "https://www.google.com/",
      },
      page: {
        url: "https://www.tecfag.com.br/rosqueadeira-de-tampas-de-plastico---dk50z/p?utm_source=google-shopping&utm_medium=cpc&utm_campaign=black-november-semi",
        title: "Rosqueadeira Pneumática de Tampas DK50Z | Tecfag - Tecfag",
      },
      product: null,
    },
    "https://www.tecfag.com.br",
    new Date("2026-11-25T17:12:34.000Z"),
    false,
  );

  it("1A — Caso Fabio/Döhler: extrai produto de siteContext.page.url (/p) e consulta VTEX para 'qual torque desta rosqueadeira?' sem sequestrar saudações", () => {
    const pageProd = extractSitePageProduct(dohlerPageContext);
    expect(pageProd).not.toBeNull();
    expect(pageProd?.url).toContain("/rosqueadeira-de-tampas-de-plastico---dk50z/p");
    expect(pageProd?.title).toContain("DK50Z");

    const q1 = deriveVtexQuery("qual torque desta rosqueadeira?", dohlerPageContext);
    expect(q1).not.toBeNull();
    expect(q1?.intent).toBe("details");
    expect(q1?.isImplicitSitePage).toBe(true);
    expect(q1?.query?.kind).toBe("url");
    expect(q1?.query?.value).toContain("dk50z/p");

    const q2 = deriveVtexQuery(
      "so preciso da informacao do torque em kgf-cm ou n.m",
      dohlerPageContext,
    );
    expect(q2).not.toBeNull();
    expect(q2?.intent).toBe("details");
    expect(q2?.isImplicitSitePage).toBe(true);

    // Saudação pura ou home nunca dispara consulta implícita
    expect(deriveVtexQuery("Oi", dohlerPageContext)).toBeNull();
    expect(deriveVtexQuery("Bom dia", dohlerPageContext)).toBeNull();
    const homeCtx = captureSiteContext(
      {
        page: { url: "https://www.tecfag.com.br/", title: "Tecfag" },
      },
      "https://www.tecfag.com.br",
      new Date(),
      false,
    );
    expect(extractSitePageProduct(homeCtx)).toBeNull();
  });

  it("1A — formatVtexAiContext prioriza especificação aderente à pergunta ('Torque') e runVtexStoreTurn não sequestra em not_found implícito", async () => {
    const mockResult = {
      status: "matched" as const,
      source: "vtex" as const,
      checkedAt: "2026-11-25T17:12:34.000Z",
      channel: "livechat" as const,
      selectedSkuId: "147",
      shipping: [],
      shippingStatus: "not_requested" as const,
      quantity: 1,
      products: [
        {
          id: "50",
          name: "Rosqueadeira Pneumática de Tampas DK50Z",
          url: "https://www.tecfag.com.br/rosqueadeira-de-tampas-de-plastico---dk50z/p",
          description: "Rosqueadeira manual pneumática.",
          specifications: {
            Peso: "1,2 kg",
            "Pressão de Ar": "4 a 6 kgf/cm²",
            Torque: "5 a 35 kgf.cm",
            "Diâmetro da Tampa": "10 a 50 mm",
          },
          skus: [
            {
              id: "147",
              name: "Padrão",
              reference: "DK50Z",
              sellerId: "1",
              priceCents: null,
              available: true,
            },
          ],
        },
      ],
    };

    const ctxText = formatVtexAiContext(
      mockResult,
      "livechat",
      "qual torque desta rosqueadeira?",
    );
    expect(ctxText).not.toBeNull();
    expect(ctxText!.indexOf("Torque: 5 a 35 kgf.cm")).toBeGreaterThan(-1);
    expect(ctxText!.indexOf("Torque: 5 a 35 kgf.cm")).toBeLessThan(
      ctxText!.indexOf("Peso: 1,2 kg"),
    );

    const mockDb = {
      select: () => ({
        from: () => ({
          where: async () => [
            {
              enabled: 1,
              config: {
                revision: 1,
                settings: {
                  ...defaultVtexSettings(),
                  enabled: true,
                  account: "tecfag",
                  storefrontOrigin: "https://www.tecfag.com.br",
                },
              },
            },
          ],
        }),
      }),
    } as any;

    const notFoundTurn = await runVtexStoreTurn(mockDb, "tecfag", {
      text: "qual torque desta rosqueadeira?",
      channel: "livechat",
      siteContext: dohlerPageContext,
      fetch: async () => Response.json([]),
    });
    expect(notFoundTurn).toBeNull();
  });

  it("1B — Impede balão órfão iniciando com 'Enquanto isso...' após remoção de balão prematuro ou apresentação", () => {
    expect(
      startsWithOrphanAnaphoricConnector(
        "Enquanto isso, você poderia me adiantar para qual tipo de frasco e tampa seria a aplicação?",
      ),
    ).toBe(true);
    expect(
      stripLeadingOrphanAnaphoricConnector(
        "Enquanto isso, você poderia me adiantar para qual tipo de frasco e tampa seria a aplicação?",
      ),
    ).toBe("Você poderia me adiantar para qual tipo de frasco e tampa seria a aplicação?");

    const route = resolveIndustrialRoute({
      text: "qual torque desta rosqueadeira?",
      collectedData: {
        "NOME COMPLETO": { value: "Fabio", status: "filled" },
        "MÁQUINA / PEÇA / INTERESSE": { value: "Rosqueadeira", status: "filled" },
      },
    });

    const evaluated = evaluateIndustrialClientMessages({
      result: { status: "collecting", operator: null, deal: null },
      route,
      data: {
        "NOME COMPLETO": { value: "Fabio", status: "filled" },
        "MÁQUINA / PEÇA / INTERESSE": { value: "Rosqueadeira", status: "filled" },
      },
      messages: [
        "Já estou encaminhando para nossa equipe técnica verificar.",
        "Enquanto isso, você poderia me adiantar para qual tipo de frasco e tampa seria a aplicação?",
      ],
    });
    expect(evaluated.needsGeminiRewrite).toBe(true);
    expect(evaluated.rewriteMode).toBe("collecting_missing_fields");

    // Também detecta conector órfão quando vem sozinho no 1º balão sem promessa de encaminhamento
    const evaluatedDirectOrphan = evaluateIndustrialClientMessages({
      result: { status: "collecting", operator: null, deal: null },
      route,
      data: {
        "NOME COMPLETO": { value: "Fabio", status: "filled" },
        "MÁQUINA / PEÇA / INTERESSE": { value: "Rosqueadeira", status: "filled" },
      },
      messages: [
        "Enquanto isso, você poderia me adiantar para qual tipo de frasco e tampa seria a aplicação?",
      ],
    });
    expect(evaluatedDirectOrphan.needsGeminiRewrite).toBe(true);
    expect(evaluatedDirectOrphan.rewriteMode).toBe("collecting_missing_fields");

    // Defesa síncrona também remove "Enquanto isso, " se usado diretamente
    const syncRes = industrialClientMessages({
      result: { status: "collecting", operator: null, deal: null },
      route,
      data: {
        "NOME COMPLETO": { value: "Fabio", status: "filled" },
        "MÁQUINA / PEÇA / INTERESSE": { value: "Rosqueadeira", status: "filled" },
      },
      messages: [
        "Já estou encaminhando para nossa equipe técnica verificar.",
        "Enquanto isso, você poderia me adiantar para qual tipo de frasco e tampa seria a aplicação?",
      ],
    });
    expect(syncRes[0]).not.toMatch(/^Enquanto isso/i);

    const openingCleaned = finalizeIndustrialOpeningMessages({
      plan: {
        mode: "ongoing",
        isFirstMessage: false,
        hasRecentOwnSdrOutbound: false,
        recentOwnSdrMessagePreview: null,
        firstMessageRule: "",
      },
      aiMessages: [
        "Olá, Fabio! Sou o Fagner, assistente virtual do Grupo Tecfag.",
        "Enquanto isso, para qual tipo de frasco seria a aplicação?",
      ],
      batchTexts: ["qual torque desta rosqueadeira?"],
      hasMediaInBatch: false,
      hasStoreTurn: false,
      isClientDeclinedTurn: false,
      historyMessages: [],
      priorMessages: [],
      aiPersona: getAiPersona("tecfag"),
      greeting: "Boa tarde!",
    });
    expect(openingCleaned.messagesToSend).toEqual([
      "Para qual tipo de frasco seria a aplicação?",
    ]);
  });

  it("1C — Prioriza aplicação/produção antes de documento no rewriter e inclui escape hatch técnico", () => {
    expect(
      prioritizeMissingFieldsForConversation(["document", "production", "application"]),
    ).toEqual(["application", "production", "document"]);

    const prompt = buildIndustrialReplyRewritePrompt({
      tenantId: "tecfag",
      conversationId: "conv-lc-c069ce2f",
      aiPersona: getAiPersona("tecfag"),
      rewriteMode: "collecting_missing_fields",
      conversationHistoryText: "[Cliente]: qual torque desta rosqueadeira?",
      batchSummary: "so preciso da informacao do torque em kgf-cm ou n.m",
      collectedData: {
        "NOME COMPLETO": { value: "Fabio", status: "filled" },
        "MÁQUINA / PEÇA / INTERESSE": { value: "Rosqueadeira DK50Z", status: "filled" },
      },
      missingFields: ["document", "application", "production"],
    });
    expect(prompt).toContain("APENAS o próximo dado faltante (qual produto/aplicação");
    expect(prompt).toContain("especificação técnica objetiva");
    expect(prompt).toContain("NUNCA cole uma pergunta abrupta de CNPJ/CPF");

    expect(
      sanitizeRewrittenIndustrialMessages(
        "collecting_missing_fields",
        ["Enquanto isso, qual é o seu frasco?"],
        false,
      ),
    ).toEqual(["Qual é o seu frasco?"]);
  });

  it("1D — Resgate de lead parcial comercial no Site e isolamento total de Valem", () => {
    expect(
      hasPartialCollectedData({
        "NOME COMPLETO": { value: "Fabio", status: "filled" },
        "MÁQUINA / PEÇA / INTERESSE": { value: "Rosqueadeira DK50Z", status: "filled" },
      }),
    ).toBe(true);
    expect(
      hasPartialCollectedData({
        "NOME COMPLETO": { value: "Guilherme", status: "filled" },
      }),
    ).toBe(false);

    const engineSrc = fs.readFileSync(
      path.join(process.cwd(), "src/lib/valentina/sdr-engine.ts"),
      "utf8",
    );
    expect(engineSrc).toContain("isSitePartialCommercialClosing");
    expect(engineSrc).toContain("Encerrado (Lead Parcial Site)");

    const prompt = buildTecfagFagnerPrompt({
      aiPersona: getAiPersona("tecfag"),
      knowledgeContext: "",
      conversationHistoryText: "",
      batchSummary: "qual torque desta rosqueadeira?",
      currentDataSummary: { "NOME COMPLETO": "Fabio" },
      cnpjDirective: "",
      firstMessageRule: "",
      hasPreviousEmoji: false,
      hasPreviousAudio: false,
      siteContext: dohlerPageContext,
    });
    expect(prompt).toContain("(/p em page.url)");
    expect(prompt).toContain("especificação técnica objetiva");
  });

  it("2 — Caso Ranieri/Apetit: follow-up AI/fallback traduz 'name' corretamente e nunca pede EMPRESA já coletada", () => {
    const collectedRanieri = {
      EMPRESA: { value: "Ranieri Trabalho na Apetit", status: "filled" },
      "SETOR / FUNIL DE DESTINO": { value: "Assistência Técnica", status: "filled" },
      "MÁQUINA / PEÇA / INTERESSE": {
        value: "Assistência técnica para seladora contínua",
        status: "filled",
      },
    };

    const judgePrompt = buildIndustrialFollowUpJudgePrompt({
      tenantId: "tecfag",
      conversationId: "conv-rdc-554391844901",
      personaName: "Fagner",
      personaCompany: "Grupo Tecfag",
      personaGender: "male",
      stage: 1,
      channel: "whatsapp",
      silenceMinutes: 65,
      now: new Date("2026-11-25T16:05:00.000Z"),
      subflow: "3_AT",
      targetFunnel: "Assistência Técnica",
      collectedData: collectedRanieri,
      missingFields: ["name"],
      recentMessages: [
        {
          senderType: "client",
          sentAt: new Date("2026-11-25T13:03:00.000Z"),
          content: "Ô, Fábio, nossa seladora está com problema na fita teflon.",
        },
        {
          senderType: "bot",
          sentAt: new Date("2026-11-25T13:05:00.000Z"),
          content: "Não localizei Fábio aqui na nossa equipe.",
        },
      ],
    });
    expect(judgePrompt).toContain("nome completo da pessoa (NÃO peça o nome da empresa)");
    expect(judgePrompt).toContain("PROIBIDO pedir qualquer dado que já conste em DADOS JÁ COLETADOS");

    const fallbackName = buildIndustrialFollowUpText({
      personaName: "Fagner",
      stage: 1,
      collectedData: collectedRanieri,
      metadata: { missingFields: ["name"] },
    });
    expect(fallbackName).toContain("como você se chama");
    expect(fallbackName).not.toContain("nome da empresa");

    const fallbackDoc = buildIndustrialFollowUpText({
      personaName: "Fagner",
      stage: 1,
      collectedData: collectedRanieri,
      metadata: { missingFields: ["document"] },
    });
    expect(fallbackDoc).toContain("CNPJ ou CPF");
    expect(fallbackDoc).not.toContain("só o nome da empresa");
  });

  it("3 — Caso Fabrícia/Cristhian: preposições masculinas reconhecidas e known-client-db ignora fluxo in_progress atual", () => {
    const status = evaluateKnownCompanyConfirmation({
      clientText: "Meu nome é Fabrícia e falo do Instituto Mário Penna",
      knownClient: {
        companyName: "Instituto Mário Penna",
        document: null,
        source: "crm_account",
      },
      currentData: {},
    });
    expect(status).toBe("confirmed");

    const knownDbSrc = fs.readFileSync(
      path.join(process.cwd(), "src/lib/triage/known-client-db.ts"),
      "utf8",
    );
    expect(knownDbSrc).toContain("isCurrentInProgressFlow");
    expect(knownDbSrc).toContain("isOnlyUnverifiedCurrentCycleCompany");
  });

  it("4 — Caso Tailís/WEVJ: e-mail 'manutencao@...' e oferta comercial p/ equipe de manutenção NÃO caem em 3_AT", () => {
    const routeTailis = resolveIndustrialRoute({
      text: "Enviar apresentação das seladoras da oferta de Black Friday (Pratic Seal TC20 e DGYF500A) para o e-mail do Jeferson (manutencao@capsexpress.com.br).",
      collectedData: {
        EMPRESA: { value: "WEVJ IND. DE SUPLEMENTOS LTDA", status: "filled" },
        "NOME COMPLETO": { value: "Tailís", status: "filled" },
        "RAMO / O QUE EMBALA": { value: "Suplementos", status: "filled" },
      },
    });
    expect(routeTailis.subflow).toBe("MAQUINAS");
    expect(routeTailis.targetFunnel).toBe("Máquinas");

    const routeTailisTextoEmail = resolveIndustrialRoute({
      text: "Pode enviar a apresentação da oferta Black Friday das seladoras para o pessoal da manutenção avaliar orçamento.",
      collectedData: {},
    });
    expect(routeTailisTextoEmail.subflow).toBe("MAQUINAS");

    // Manutenção real continua indo normalmente para 3_AT
    const routeRealSupport = resolveIndustrialRoute({
      text: "Minha seladora está com defeito e precisa de manutenção urgente",
      collectedData: {},
    });
    expect(routeRealSupport.subflow).toBe("3_AT");
    expect(routeRealSupport.targetFunnel).toBe("Assistência Técnica");
  });
});
