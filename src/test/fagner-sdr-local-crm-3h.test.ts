import { describe, expect, it } from "vitest";
import { getAiPersona, isSdrTenant } from "../lib/ai-persona";
import {
  isDealWithinThreeHoursWindow,
  SDR_DEAL_REUSE_WINDOW_MS,
} from "../lib/valentina/sdr-crm-local";
import {
  buildTecfagFagnerPrompt,
  resolveTecfagStageAndFunnel,
  TECFAG_SDR_DEFAULT_FIELDS,
} from "../lib/valentina/sdr-tecfag-prompt";

describe("Fagner SDR (Tecfag) — Persona, Fluxos, Kanban SDR e Regra de 3 Horas do CRM Local", () => {
  it("ativa SDR para tecfag e valem com personas isoladas", () => {
    expect(isSdrTenant("tecfag")).toBe(true);
    expect(isSdrTenant("valem")).toBe(true);
    expect(isSdrTenant("desconhecido")).toBe(false);

    const fagner = getAiPersona("tecfag");
    expect(fagner.name).toBe("Fagner");
    expect(fagner.company).toBe("Grupo Tecfag");
    expect(fagner.segment.toLowerCase()).toContain("máquinas industriais");

    const valentina = getAiPersona("valem");
    expect(valentina.name).toBe("Valentina");
    expect(valentina.company).toBe("Valem Valvulas e Embalagens");
  });

  it("valida a janela estrita de 3 horas para vínculo vs criação de card no CRM Local", () => {
    const now = new Date("2026-10-19T12:00:00.000Z");
    expect(SDR_DEAL_REUSE_WINDOW_MS).toBe(3 * 60 * 60 * 1000);

    // Criado há 45 minutos (dentro das 3h -> vincula ao card existente)
    const deal45mAgo = new Date(now.getTime() - 45 * 60 * 1000);
    expect(isDealWithinThreeHoursWindow(deal45mAgo, now)).toBe(true);

    // Criado exatamente há 3 horas (no limite -> ainda vincula)
    const dealExact3h = new Date(now.getTime() - 3 * 60 * 60 * 1000);
    expect(isDealWithinThreeHoursWindow(dealExact3h, now)).toBe(true);

    // Criado há 3 horas e 1 segundo (passou de 3h -> cria novo card)
    const dealOver3h = new Date(now.getTime() - (3 * 60 * 60 * 1000 + 1000));
    expect(isDealWithinThreeHoursWindow(dealOver3h, now)).toBe(false);

    // Criado há 5 horas (passou de 3h -> cria novo card)
    const deal5hAgo = new Date(now.getTime() - 5 * 60 * 60 * 1000);
    expect(isDealWithinThreeHoursWindow(deal5hAgo, now)).toBe(false);

    // Sem data -> falso
    expect(isDealWithinThreeHoursWindow(null, now)).toBe(false);
  });

  it("projeta subfluxos industriais nas 9 colunas do Kanban sem promoção lexical de Personnalité", () => {
    // 1. Máquinas
    expect(
      resolveTecfagStageAndFunnel({
        collectedData: {
          "MÁQUINA / PEÇA / INTERESSE": { value: "Seladora Contínua Automática" },
        },
      }),
    ).toEqual({
      funnelStage: "maquinas",
      targetFunnel: "Máquinas",
    });

    // 2. Menção de campanha/linha não substitui a classificação por catálogo.
    expect(
      resolveTecfagStageAndFunnel({
        collectedData: {
          "MÁQUINA / PEÇA / INTERESSE": { value: "Sachês impressos linha Personnalité" },
        },
      }),
    ).toEqual({
      funnelStage: "maquinas",
      targetFunnel: "Máquinas",
    });

    // 3. Peças
    expect(
      resolveTecfagStageAndFunnel({
        collectedData: {
          "MÁQUINA / PEÇA / INTERESSE": { value: "Fita de teflon e resistência de reposição" },
        },
      }),
    ).toEqual({
      funnelStage: "pecas",
      targetFunnel: "Peças",
    });

    // 4. Assistência Técnica
    expect(
      resolveTecfagStageAndFunnel({
        collectedData: {
          "MÁQUINA / PEÇA / INTERESSE": { value: "Manutenção e suporte técnico na envasadora" },
        },
      }),
    ).toEqual({
      funnelStage: "assistencia_tecnica",
      targetFunnel: "Assistência Técnica",
    });

    // 5. Pós-Venda Rastreio
    expect(
      resolveTecfagStageAndFunnel({
        collectedData: {
          "MÁQUINA / PEÇA / INTERESSE": { value: "Quero o código de rastreio da transportadora" },
        },
      }),
    ).toEqual({
      funnelStage: "pos_venda",
      targetFunnel: "Pós-Venda Rastreio",
    });

    // 6. Pós-Venda - NF do Pedido
    expect(
      resolveTecfagStageAndFunnel({
        aiFunnelStage: "pos_venda",
        collectedData: {
          "MÁQUINA / PEÇA / INTERESSE": { value: "Pós-venda NF do pedido 4512" },
        },
      }),
    ).toEqual({
      funnelStage: "pos_venda",
      targetFunnel: "Pós-Venda - NF do Pedido",
    });

    // 7. Financeiro Boleto vs Nota Fiscal
    expect(
      resolveTecfagStageAndFunnel({
        collectedData: {
          "MÁQUINA / PEÇA / INTERESSE": { value: "Preciso da 2a via do boleto" },
        },
      }),
    ).toEqual({
      funnelStage: "financeiro",
      targetFunnel: "Fin. Boleto",
    });

    expect(
      resolveTecfagStageAndFunnel({
        collectedData: {
          "MÁQUINA / PEÇA / INTERESSE": { value: "Financeiro envio de XML da Nota Fiscal" },
        },
      }),
    ).toEqual({
      funnelStage: "financeiro",
      targetFunnel: "Fin. Nota Fiscal",
    });
  });

  it("gera o prompt industrial do Fagner com os 7 campos da Tecfag e suporte a [SEND_IMAGE]", () => {
    const persona = getAiPersona("tecfag");
    const prompt = buildTecfagFagnerPrompt({
      aiPersona: persona,
      knowledgeContext: "📚 BASE DE CONHECIMENTO: Seladora Contínua [SEND_IMAGE:/knowledge-media/seladora.jpg]",
      conversationHistoryText: "",
      batchSummary: 'Cliente: "Preciso de uma seladora para café"',
      currentDataSummary: {},
      cnpjDirective: "",
      firstMessageRule: "Apresente-se",
      hasPreviousEmoji: false,
      hasPreviousAudio: false,
    });

    for (const field of TECFAG_SDR_DEFAULT_FIELDS) {
      expect(prompt).toContain(field);
    }
    expect(prompt).toContain("[SEND_IMAGE:/knowledge-media/...");
    expect(prompt).toContain("Pós-Venda Rastreio");
    expect(prompt).toContain("Fin. Boleto");
    expect(prompt).toContain("Personnalité");
  });

  it("garante zero dados mockados no Rodízio e mapeamento correto dos 6 setores reais", async () => {
    const {
      getEmptyRodizioData,
      getBenchmarkRodizioData,
      getOperatorSector,
    } = await import("../components/valentina/rodizio-dashboard-data");

    const empty = getEmptyRodizioData();
    expect(empty.stats.totalLeads).toBe(0);
    expect(empty.stats.triageDone).toBe(0);
    expect(empty.stats.triageRate).toBe(0);
    expect(empty.stats.syncedToCrm).toBe(0);
    expect(empty.stats.activeSessions).toBe(0);
    expect(empty.operators).toEqual([]);
    expect(empty.byDay).toEqual([]);
    expect(empty.byFunnel).toEqual([]);
    expect(empty.deals).toEqual([]);

    const legacyCall = getBenchmarkRodizioData("tecfag");
    expect(legacyCall.stats.totalLeads).toBe(0);
    expect(legacyCall.operators).toEqual([]);
    expect(legacyCall.deals).toEqual([]);

    expect(
      getOperatorSector({
        id: "ai-triage-tecfag",
        name: "Fagner (Triagem IA)",
        sector: "sdr",
        count: 1,
        baseCount: 1,
        compensation: 0,
        funnels: ["triagem"],
      }),
    ).toBe("sdr");

    expect(
      getOperatorSector({
        id: "op-1",
        name: "Operador Personnalité",
        sector: "Personnalité",
        count: 2,
        baseCount: 2,
        compensation: 0,
        funnels: ["Personnalité"],
      }),
    ).toBe("personalite");

    expect(
      getOperatorSector({
        id: "op-2",
        name: "Operador Peças",
        sector: "Peças",
        count: 3,
        baseCount: 3,
        compensation: 0,
        funnels: ["Peças"],
      }),
    ).toBe("pecas");

    expect(
      getOperatorSector({
        id: "op-3",
        name: "Operador Pós-Venda",
        sector: "Assistência Técnica",
        count: 1,
        baseCount: 1,
        compensation: 0,
        funnels: ["Assistência Técnica"],
      }),
    ).toBe("pos venda");
  });
});
