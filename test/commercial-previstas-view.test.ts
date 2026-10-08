import { describe, expect, it } from "bun:test";
import {
  BASELINE_PREVISTAS_PERSONNALITE,
  BASELINE_PREVISTAS_SEMI_MAQUINAS,
  BASELINE_PREVISTAS_DEALS,
  PREVISTAS_TIERS,
  getBaselinePrevistasDeals,
} from "../src/lib/commercial/previstas-data";

describe("Commercial Previstas (Slide 3 - War Room)", () => {
  it("deve conter as 5 faixas de horizonte oficiais com larguras escalonadas por cor", () => {
    expect(PREVISTAS_TIERS).toHaveLength(5);
    expect(PREVISTAS_TIERS.map((t) => t.key)).toEqual([
      "tier_hoje",
      "tier_15d",
      "tier_30d",
      "tier_60d",
      "tier_90d",
    ]);

    expect(PREVISTAS_TIERS[0].daysLabel).toBe("HOJE");
    expect(PREVISTAS_TIERS[0].subLabel).toBe("Prontos / Atrasados");
    expect(PREVISTAS_TIERS[0].colWidth).toBe("w-[10%]");

    expect(PREVISTAS_TIERS[1].daysLabel).toBe("15 DIAS");
    expect(PREVISTAS_TIERS[1].subLabel).toBe("A Faturar");
    expect(PREVISTAS_TIERS[1].colWidth).toBe("w-[13%]");

    expect(PREVISTAS_TIERS[2].daysLabel).toBe("30 DIAS");
    expect(PREVISTAS_TIERS[2].subLabel).toBe("A Faturar");
    expect(PREVISTAS_TIERS[2].colWidth).toBe("w-[16%]");

    expect(PREVISTAS_TIERS[3].daysLabel).toBe("60 DIAS");
    expect(PREVISTAS_TIERS[3].subLabel).toBe("A Faturar");
    expect(PREVISTAS_TIERS[3].colWidth).toBe("w-[20%]");

    expect(PREVISTAS_TIERS[4].daysLabel).toBe("90 DIAS");
    expect(PREVISTAS_TIERS[4].subLabel).toBe("A Faturar");
    expect(PREVISTAS_TIERS[4].colWidth).toBe("w-[24%]");
  });

  it("deve conter os totais e consultores exatos do TIME PERSONNALITÉ (Foto 1 - Slide 3)", () => {
    expect(BASELINE_PREVISTAS_PERSONNALITE.teamName).toBe("TIME PERSONNALITÉ");
    expect(BASELINE_PREVISTAS_PERSONNALITE.metaTotal).toBe(2_940_000);
    expect(BASELINE_PREVISTAS_PERSONNALITE.aFaturarTotal).toBe(20_050_000);
    expect(BASELINE_PREVISTAS_PERSONNALITE.promessaTotal).toBe(2_000_000);

    const sellers = BASELINE_PREVISTAS_PERSONNALITE.sellers;
    expect(sellers).toHaveLength(4);

    // Diana
    const diana = sellers.find((s) => s.sellerId === "diana-gimenes")!;
    expect(diana).toBeDefined();
    expect(diana.metaValue).toBe(1_000_000);
    expect(diana.conversionPercent).toBe(50);
    expect(diana.realizedValue).toBe(291_000);
    expect(diana.realizedPercent).toBe(29);
    expect(diana.tiers.tier_hoje.formatted).toBe("2,93 MILHÕES");
    expect(diana.tiers.tier_15d.formatted).toBe("297 MIL");
    expect(diana.tiers.tier_30d.formatted).toBe("260 MIL");
    expect(diana.tiers.tier_60d.formatted).toBe("250 MIL");
    expect(diana.tiers.tier_90d.formatted).toBe("0 MIL");
    expect(diana.totalAFaturarValue).toBe(3_940_000);
    expect(diana.totalAFaturarPercent).toBe(394);

    // Jhordan
    const jhordan = sellers.find((s) => s.sellerId === "jhordan-rueda")!;
    expect(jhordan.totalAFaturarValue).toBe(6_170_000);
    expect(jhordan.totalAFaturarPercent).toBe(1064);

    // Marcelo
    const marcelo = sellers.find((s) => s.sellerId === "marcelo-nardelli")!;
    expect(marcelo.totalAFaturarValue).toBe(2_780_000);
    expect(marcelo.totalAFaturarPercent).toBe(316);

    // Rosenvaldo
    const rosenvaldo = sellers.find((s) => s.sellerId === "rosenvaldo-lucas")!;
    expect(rosenvaldo.totalAFaturarValue).toBe(7_160_000);
    expect(rosenvaldo.totalAFaturarPercent).toBe(1492);
  });

  it("deve conter os totais e consultores exatos do TIME SEMI (MÁQUINAS) (Foto 1 - Slide 3)", () => {
    expect(BASELINE_PREVISTAS_SEMI_MAQUINAS.teamName).toBe("TIME SEMI (MÁQUINAS)");
    expect(BASELINE_PREVISTAS_SEMI_MAQUINAS.metaTotal).toBe(1_890_000);
    expect(BASELINE_PREVISTAS_SEMI_MAQUINAS.aFaturarTotal).toBe(20_190_000);
    expect(BASELINE_PREVISTAS_SEMI_MAQUINAS.promessaTotal).toBe(2_020_000);

    const sellers = BASELINE_PREVISTAS_SEMI_MAQUINAS.sellers;
    expect(sellers).toHaveLength(6);

    // Andreia
    const andreia = sellers.find((s) => s.sellerId === "andreia-camargo")!;
    expect(andreia.totalAFaturarValue).toBe(3_360_000);
    expect(andreia.totalAFaturarPercent).toBe(1119);

    // Beatriz
    const beatriz = sellers.find((s) => s.sellerId === "beatriz-ribeiro")!;
    expect(beatriz.totalAFaturarValue).toBe(8_960_000);
    expect(beatriz.totalAFaturarPercent).toBe(2634);

    // Denise
    const denise = sellers.find((s) => s.sellerId === "denise-gomes")!;
    expect(denise.totalAFaturarValue).toBe(1_260_000);
    expect(denise.totalAFaturarPercent).toBe(371);

    // Melissa
    const melissa = sellers.find((s) => s.sellerId === "melissa-gomes")!;
    expect(melissa.totalAFaturarValue).toBe(1_080_000);
    expect(melissa.totalAFaturarPercent).toBe(319);

    // Mercado Livre / Deborah
    const ml = sellers.find((s) => s.sellerId === "mercado-livre")!;
    expect(ml.totalAFaturarValue).toBe(3_110_000);
    expect(ml.totalAFaturarPercent).toBe(1352);

    // Victor
    const victor = sellers.find((s) => s.sellerId === "victor-goes")!;
    expect(victor.totalAFaturarValue).toBe(2_430_000);
    expect(victor.totalAFaturarPercent).toBe(716);
  });

  it("deve conter as negociações previstas das Fotos 2 e 3 (Diana - HOJE)", () => {
    const hojeDeals = BASELINE_PREVISTAS_DEALS.filter(
      (d) => d.sellerId === "diana-gimenes" && d.horizonKey === "tier_hoje"
    );
    expect(hojeDeals.length).toBeGreaterThanOrEqual(9);

    // Deal 1: Flowpack (atrasada)
    const deal1 = hojeDeals.find((d) => d.code === "0021202")!;
    expect(deal1).toBeDefined();
    expect(deal1.title).toContain("FLOWPACK - SOUZA E MAIA");
    expect(deal1.value).toBe(70_000);
    expect(deal1.ageDays).toBe(219);
    expect(deal1.isDelayed).toBe(true);

    // Deal 2: Fortaleza Quimica (atrasada)
    const deal2 = hojeDeals.find((d) => d.code === "0017247")!;
    expect(deal2).toBeDefined();
    expect(deal2.value).toBe(230_000);
    expect(deal2.ageDays).toBe(218);
    expect(deal2.isDelayed).toBe(true);

    // Deal 3: Contadora (atrasada)
    const deal3 = hojeDeals.find((d) => d.code === "0016479")!;
    expect(deal3).toBeDefined();
    expect(deal3.value).toBe(139_000);
    expect(deal3.ageDays).toBe(197);
    expect(deal3.isDelayed).toBe(true);

    // Validação matemática da seleção da Foto 3: 70k + 230k + 139k = 439k
    const selectedSum = deal1.value + deal2.value + deal3.value;
    expect(selectedSum).toBe(439_000);

    // Deal 4: Roberto (diretriz concluída)
    const deal4 = hojeDeals.find((d) => d.code === "0020354")!;
    expect(deal4).toBeDefined();
    expect(deal4.hasDirectiveCompleted).toBe(true);
    expect(deal4.value).toBe(169_000);
  });

  it("deve obter deals de um consultor específico via getBaselinePrevistasDeals", () => {
    const dianaDeals = getBaselinePrevistasDeals("diana-gimenes");
    expect(dianaDeals.length).toBeGreaterThan(0);
    expect(dianaDeals.every((d) => d.sellerId === "diana-gimenes")).toBe(true);

    const fallbackDeals = getBaselinePrevistasDeals("jhordan-rueda");
    expect(fallbackDeals.length).toBeGreaterThan(0);
    expect(fallbackDeals.every((d) => d.sellerId === "jhordan-rueda")).toBe(true);
  });
});
