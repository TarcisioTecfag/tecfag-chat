import { describe, expect, it } from "bun:test";
import { deriveVtexQuery } from "../src/lib/vtex/turn";
import { machineCategories } from "../src/lib/triage/industrial-decisor";
import {
  INDUSTRIAL_AWAITING_APPROVAL_CLIENT_MESSAGE,
  industrialClientMessages,
} from "../src/lib/triage/industrial-handoff";
import { resolveIndustrialRoute } from "../src/lib/triage/industrial-policy";
import {
  evaluateIndustrialSilence,
  parseIndustrialSilenceConfig,
} from "../src/lib/triage/industrial-silence-policy";
import { buildTecfagFagnerPrompt } from "../src/lib/valentina/sdr-tecfag-prompt";
import { getAiPersona } from "../src/lib/ai-persona";

describe("Correção dos 5 problemas das triagens do Fagner (22/11/2026)", () => {
  it("Item 1: deriveVtexQuery NÃO dispara em frases genéricas com 'informações sobre', mas continua pedindo referência em preço/SKU/ficha técnica", () => {
    expect(
      deriveVtexQuery(
        "Pesquisei vocês no Google e gostaria de mais informações sobre os equipamentos Tecfag.",
        null,
      ),
    ).toBeNull();

    expect(
      deriveVtexQuery(
        "Estou interessado em fabricar biscoito de polvilho, gostaria de informações sobre a linha de produção",
        null,
      ),
    ).toBeNull();

    // Continua funcionando quando há intenção real de loja (preço, frete, SKU, ficha técnica)
    const priceNoProduct = deriveVtexQuery("Qual o preço dessa máquina?", null);
    expect(priceNoProduct).not.toBeNull();
    expect(priceNoProduct?.intent).toBe("price");
    expect(priceNoProduct?.query).toBeNull();

    const specsWithSku = deriveVtexQuery("Qual a ficha técnica do SKU 417?", null);
    expect(specsWithSku).not.toBeNull();
    expect(specsWithSku?.query).toMatchObject({ kind: "sku", value: "417" });
  });

  it("Item 2: machineCategories mapeia 'embalar a vácuo' / 'embaladora a vácuo' para 'seladora' (não 'empacotadora') e prompt proíbe negativa falsa", () => {
    const cats1 = machineCategories("máquina de embalar a vácuo");
    expect(cats1).toContain("seladora");
    expect(cats1).not.toContain("empacotadora");

    const cats2 = machineCategories("embaladora a vácuo para queijos");
    expect(cats2).toContain("seladora");
    expect(cats2).not.toContain("empacotadora");

    // Emulsificador a vácuo ou termoformadora NÃO devem ser forçados para seladora
    expect(machineCategories("emulsificador a vácuo")).not.toContain("seladora");
    expect(machineCategories("termoformadora a vácuo")).toContain("termoformadora");
    expect(machineCategories("termoformadora a vácuo")).not.toContain("seladora");
  });

  it("Item 3: prompt contém dados institucionais da Tecfag (Bauru/SP, importação, garantia) e industrialClientMessages preserva respostas informativas no turno de awaiting_approval", () => {
    const prompt = buildTecfagFagnerPrompt({
      aiPersona: getAiPersona("tecfag"),
      knowledgeContext: "",
      conversationHistoryText: "",
      batchSummary: "Que cidade vocês estão? Essa máquina é importada?",
      currentDataSummary: {},
      cnpjDirective: "",
      firstMessageRule: "",
      hasPreviousEmoji: false,
      hasPreviousAudio: false,
    });

    expect(prompt).toContain("Bauru/SP");
    expect(prompt).toContain("importados");
    expect(prompt).toContain("Seladora a Vácuo");
    expect(prompt).toContain('"RAMO / O QUE EMBALA"');
    expect(prompt).toContain('"VOLUME / PRODUÇÃO"');

    // industrialClientMessages preserva respostas objetivas ANTES da mensagem neutra de awaiting_approval,
    // mas bloqueia promessas falsas de transferência ou novas perguntas de coleta
    const msgs = industrialClientMessages({
      result: { status: "awaiting_approval", operator: null, deal: null },
      route: resolveIndustrialRoute({ text: "seladora a vácuo", collectedData: {} }),
      data: {},
      messages: [
        "Nossa matriz e centro de distribuição ficam em Bauru/SP, atendendo todo o Brasil.",
        "Sim, nossos equipamentos são importados e nacionalizados pela Tecfag com estoque e suporte próprio no Brasil.",
        "Estou te transferindo agora para Denise!", // deve ser filtrada
        "Qual seu CNPJ?", // pergunta deve ser filtrada
      ],
    });

    expect(msgs).toEqual([
      "Nossa matriz e centro de distribuição ficam em Bauru/SP, atendendo todo o Brasil.",
      "Sim, nossos equipamentos são importados e nacionalizados pela Tecfag com estoque e suporte próprio no Brasil.",
      INDUSTRIAL_AWAITING_APPROVAL_CLIENT_MESSAGE,
    ]);
  });

  it("Item 5d: política de silêncio NÃO marca no_response às 20h no fim de semana quando stage=0 e pauseOutsideSchedule=true", () => {
    const cfg = parseIndustrialSilenceConfig({});
    const botMsgTime = new Date("2026-11-21T22:50:00.000Z"); // Sábado 19:50 BRT
    const satNight = new Date("2026-11-21T23:25:00.000Z"); // Sábado 20:25 BRT (35 min depois, fora do expediente)

    const decision = evaluateIndustrialSilence({
      now: satNight,
      withinSchedule: false,
      flow: {
        id: "fs-sat-1",
        tenantId: "tecfag",
        conversationId: "conv-sat-1",
        startedAt: new Date("2026-11-21T22:31:00.000Z"),
        lastInteractionAt: botMsgTime,
        outcome: "in_progress",
        completedAt: null,
        followUpStage: 0,
        collectedData: {},
        metadata: { followUpStage: 0, funnelStage: "maquinas" },
      },
      conversation: {
        id: "conv-sat-1",
        queueState: "automacao",
        operatorId: null,
        contactId: "c-sat-1",
      },
      recentMessages: [
        { id: "m1", senderType: "client", sentAt: "2026-11-21T22:49:00.000Z", content: "2000 sacos/dia" },
        { id: "m2", senderType: "bot", sentAt: botMsgTime, content: "Qual seu nome completo?" },
      ],
      config: cfg,
    });

    // Fora do expediente e sem nenhum follow-up enviado (stage=0): NÃO marca no_response!
    expect(decision.action).toBe("none");
    expect(decision.reason).toBe("outside_business_schedule");
  });
});
