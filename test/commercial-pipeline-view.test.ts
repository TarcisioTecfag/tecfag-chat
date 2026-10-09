import { describe, expect, it } from "bun:test";
import {
  BASELINE_PERSONNALITE,
  BASELINE_SEMI_MAQUINAS,
  formatAbbreviatedCurrency,
  formatDealValue,
  formatPercentage,
  formatTeamSummary,
  getBaselineDeals,
  PIPELINE_STAGES,
} from "../src/lib/commercial/pipeline-data";

describe("Commercial War Room - Tela 1 (Oportunidades & Pipeline por Fase)", () => {
  it("contém todas as 7 etapas oficiais na ordem exata do funil RD CRM", () => {
    const keys = PIPELINE_STAGES.map((s) => s.key);
    expect(keys).toEqual([
      "requalificacao",
      "esfriando",
      "leads_recebidos",
      "abordagem_comercial",
      "qualificado",
      "proposta_enviada",
      "fechamento",
    ]);

    expect(PIPELINE_STAGES[0].bracketLabel).toBe("[REQUALIFICAÇÃO]");
    expect(PIPELINE_STAGES[1].bracketLabel).toBe("[ESFRIANDO]");
    expect(PIPELINE_STAGES[2].bracketLabel).toBe("[LEADS RECEBIDOS]");
    expect(PIPELINE_STAGES[3].bracketLabel).toBe("[ABORDAGEM COMERCIAL]");
    expect(PIPELINE_STAGES[4].bracketLabel).toBe("[QUALIFICADO]");
    expect(PIPELINE_STAGES[5].bracketLabel).toBe("[PROPOSTA ENVIADA]");
    expect(PIPELINE_STAGES[6].bracketLabel).toBe("[FECHAMENTO]");
  });

  it("formata valores monetários abreviados para a tabela do War Room", () => {
    expect(formatAbbreviatedCurrency(0)).toBe("—");
    expect(formatAbbreviatedCurrency(781_000)).toBe("R$ 781k");
    expect(formatAbbreviatedCurrency(22_000)).toBe("R$ 22k");
    expect(formatAbbreviatedCurrency(3_000)).toBe("R$ 3k");
    expect(formatAbbreviatedCurrency(1_300_000)).toBe("R$ 1.3M");
    expect(formatAbbreviatedCurrency(40_000_000)).toBe("R$ 40.0M");
    expect(formatAbbreviatedCurrency(60_050_000, true)).toBe("R$ 60.05M");
  });

  it("formata porcentagens de célula com suporte a <1%", () => {
    expect(formatPercentage(0)).toBe("—");
    expect(formatPercentage(0.5)).toBe("<1%");
    expect(formatPercentage(18)).toBe("18%");
    expect(formatPercentage(49.2)).toBe("49%");
    expect(formatPercentage(100)).toBe("100%");
  });

  it("formata valores monetários no modal de negociações", () => {
    expect(formatDealValue(0)).toBe("R$ 0,00");
    expect(formatDealValue(3000)).toBe("R$ 3.0 mil");
    expect(formatDealValue(1_500_000)).toBe("R$ 1.5M");
  });

  it("formata o resumo de cards e valor total da equipe", () => {
    const summary = formatTeamSummary(1307, 60_050_000);
    expect(summary.cards).toBe("Total: 1307 cards");
    expect(summary.value).toBe("Valor: R$ 60.05M");
  });

  it("valida integridade matemática da equipe Personnalité (Foto 1)", () => {
    expect(BASELINE_PERSONNALITE.totalCards).toBe(1307);
    expect(BASELINE_PERSONNALITE.totalValue).toBe(60_050_000);

    const diana = BASELINE_PERSONNALITE.sellers.find((s) => s.sellerName === "Diana Gimenes");
    expect(diana).toBeDefined();
    expect(diana?.totalCards).toBe(321);
    expect(diana?.stages.abordagem_comercial.count).toBe(42);
    expect(diana?.stages.esfriando.count).toBe(214);
    expect(diana?.stages.esfriando.value).toBe(781_000);
    expect(diana?.stages.esfriando.percent).toBe(18);

    const jhordan = BASELINE_PERSONNALITE.sellers.find((s) => s.sellerName === "Jhordan Rueda");
    expect(jhordan?.totalCards).toBe(841);
    expect(jhordan?.stages.esfriando.count).toBe(624);

    const murrelo = BASELINE_PERSONNALITE.sellers.find((s) => s.sellerName === "Murrelo Nardelli");
    expect(murrelo?.totalCards).toBe(36);
    expect(murrelo?.stages.leads_recebidos.value).toBe(40_000_000);

    const rosenvaldo = BASELINE_PERSONNALITE.sellers.find((s) => s.sellerName === "Rosenvaldo Lucas");
    expect(rosenvaldo?.totalCards).toBe(109);
    expect(rosenvaldo?.stages.proposta_enviada.value).toBe(7_200_000);
  });

  it("valida integridade matemática da equipe Semi / Máquinas (Foto 1)", () => {
    expect(BASELINE_SEMI_MAQUINAS.totalCards).toBe(2988);
    expect(BASELINE_SEMI_MAQUINAS.totalValue).toBe(20_700_000);

    const andreia = BASELINE_SEMI_MAQUINAS.sellers.find((s) => s.sellerName === "Andreia Camargo");
    expect(andreia?.totalCards).toBe(444);
    expect(andreia?.stages.abordagem_comercial.count).toBe(290);

    const beatriz = BASELINE_SEMI_MAQUINAS.sellers.find((s) => s.sellerName === "Beatriz Ribeiro");
    expect(beatriz?.totalCards).toBe(398);
    expect(beatriz?.stages.esfriando.count).toBe(86);

    const denise = BASELINE_SEMI_MAQUINAS.sellers.find((s) => s.sellerName === "Denise Gomes");
    expect(denise?.totalCards).toBe(635);
    expect(denise?.stages.qualificado.count).toBe(242);

    const melissa = BASELINE_SEMI_MAQUINAS.sellers.find((s) => s.sellerName === "Melissa Gomes");
    expect(melissa?.totalCards).toBe(618);
    expect(melissa?.stages.abordagem_comercial.count).toBe(386);

    const deborah = BASELINE_SEMI_MAQUINAS.sellers.find((s) => s.sellerName.includes("Deborah"));
    expect(deborah?.totalCards).toBe(340);
    expect(deborah?.stages.leads_recebidos.count).toBe(114);

    const victor = BASELINE_SEMI_MAQUINAS.sellers.find((s) => s.sellerName === "Victor Goes");
    expect(victor?.totalCards).toBe(553);
    expect(victor?.stages.proposta_enviada.count).toBe(84);
  });

  it("retorna negociações fiéis para o modal da Diana Gimenes em Abordagem Comercial (Foto 2)", () => {
    const deals = getBaselineDeals("op-tf-diana.gimenes.93", "abordagem_comercial");
    expect(deals.length).toBe(42);

    // Primeiro deal: Droga Vita
    expect(deals[0].title).toBe("Droga Vita");
    expect(deals[0].funnelName).toBe("FUNIL MÁQUINAS");
    expect(deals[0].responsibleName).toBe("Diana Gimenes");
    expect(deals[0].value).toBe(3000);
    expect(deals[0].daysOpen).toBe(27);
    expect(deals[0].createdAt).toBe("10 de set. de 2026");
    expect(deals[0].stageName).toBe("Abordagem Comercial");

    // Segundo deal: Maicon Buisn Werplotz
    expect(deals[1].title).toBe("Maicon Buisn Werplotz");
    expect(deals[1].daysOpen).toBe(44);

    // Demais deals do print oficial
    expect(deals.some((d) => d.title === "Thomaz dias machado")).toBe(true);
    expect(deals.some((d) => d.title === "FAGNER | Teppey")).toBe(true);
    expect(deals.some((d) => d.title === "Rodrigo")).toBe(true);
    expect(deals.some((d) => d.title === "FAGNER | Eric silva")).toBe(true);
    expect(deals.some((d) => d.title === "FAGNER | Marcelo Soares")).toBe(true);
    expect(deals.some((d) => d.title === "milton Marçal")).toBe(true);
    expect(deals.some((d) => d.title === "Gabriel Silva")).toBe(true);
    expect(deals.some((d) => d.title === "FAGNER | Jéssica")).toBe(true);
  });
});
