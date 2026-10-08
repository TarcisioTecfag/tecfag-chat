import { describe, expect, it } from "bun:test";
import {
  BASELINE_DEPARA_PERSONNALITE,
  BASELINE_DEPARA_SEMI_MAQUINAS,
  BASELINE_DEPARA_DEALS,
  DEPARA_TIERS,
  formatDeparaCurrency,
  formatDeparaMeta,
  formatDealCurrencyDetail,
  getBaselineDeparaDeals,
} from "../src/lib/commercial/depara-data";

describe("Commercial De-Para (Slide 2 - War Room)", () => {
  it("deve conter as 5 faixas de maturidade oficiais com labels e cores corretas", () => {
    expect(DEPARA_TIERS).toHaveLength(5);
    expect(DEPARA_TIERS.map((t) => t.key)).toEqual([
      "tier_3d",
      "tier_15d",
      "tier_30d",
      "tier_60d",
      "tier_90d",
    ]);

    expect(DEPARA_TIERS[0].daysLabel).toBe("3 DIAS");
    expect(DEPARA_TIERS[0].thresholdLabel).toBe("≤ R$ 8.5k");
    expect(DEPARA_TIERS[0].colWidth).toBe("w-[10%]");

    expect(DEPARA_TIERS[1].daysLabel).toBe("15 DIAS");
    expect(DEPARA_TIERS[1].thresholdLabel).toBe("≤ R$ 50k");
    expect(DEPARA_TIERS[1].colWidth).toBe("w-[13%]");

    expect(DEPARA_TIERS[2].daysLabel).toBe("30 DIAS");
    expect(DEPARA_TIERS[2].thresholdLabel).toBe("≤ R$ 200k");
    expect(DEPARA_TIERS[2].colWidth).toBe("w-[16%]");

    expect(DEPARA_TIERS[3].daysLabel).toBe("60 DIAS");
    expect(DEPARA_TIERS[3].thresholdLabel).toBe("≤ R$ 600k");
    expect(DEPARA_TIERS[3].colWidth).toBe("w-[20%]");

    expect(DEPARA_TIERS[4].daysLabel).toBe("90 DIAS");
    expect(DEPARA_TIERS[4].thresholdLabel).toBe("> R$ 600k");
    expect(DEPARA_TIERS[4].colWidth).toBe("w-[24%]");
  });


  it("deve conter os totais e consultores exatos do TIME PERSONNALITÉ (Foto 1)", () => {
    expect(BASELINE_DEPARA_PERSONNALITE.teamName).toBe("TIME PERSONNALITÉ");
    expect(BASELINE_DEPARA_PERSONNALITE.metaTotal).toBe(2_940_000);
    expect(BASELINE_DEPARA_PERSONNALITE.maduroTotal).toBe(14_780_000);
    expect(BASELINE_DEPARA_PERSONNALITE.promessaTotal).toBe(1_480_000);

    const sellers = BASELINE_DEPARA_PERSONNALITE.sellers;
    expect(sellers).toHaveLength(4);

    // Diana
    const diana = sellers.find((s) => s.sellerId === "diana-gimenes")!;
    expect(diana).toBeDefined();
    expect(diana.metaValue).toBe(1_000_000);
    expect(diana.conversionPercent).toBe(50);
    expect(diana.realizedValue).toBe(291_000);
    expect(diana.realizedPercent).toBe(29);
    expect(diana.tiers.tier_3d.formatted).toBe("0 MIL");
    expect(diana.tiers.tier_15d.formatted).toBe("262 MIL");
    expect(diana.tiers.tier_30d.formatted).toBe("1,87 MILHÕES");
    expect(diana.tiers.tier_60d.formatted).toBe("789 MIL");
    expect(diana.tiers.tier_90d.formatted).toBe("0 MIL");
    expect(diana.tasksCount).toBe(12);
    expect(diana.totalMaduroValue).toBe(2_930_000);
    expect(diana.totalMaduroPercent).toBe(293);

    // Jhordan
    const jhordan = sellers.find((s) => s.sellerId === "jhordan-rueda")!;
    expect(jhordan.totalMaduroValue).toBe(6_100_000);
    expect(jhordan.totalMaduroPercent).toBe(1051);
    expect(jhordan.tasksCount).toBe(2);

    // Marcelo
    const marcelo = sellers.find((s) => s.sellerId === "marcelo-nardelli")!;
    expect(marcelo.totalMaduroValue).toBe(2_610_000);
    expect(marcelo.totalMaduroPercent).toBe(296);
    expect(marcelo.tasksCount).toBe(3);

    // Rosenvaldo
    const rosenvaldo = sellers.find((s) => s.sellerId === "rosenvaldo-lucas")!;
    expect(rosenvaldo.totalMaduroValue).toBe(3_140_000);
    expect(rosenvaldo.totalMaduroPercent).toBe(654);
    expect(rosenvaldo.tasksCount).toBe(17);
  });

  it("deve conter os totais e consultores exatos do TIME SEMI (MÁQUINAS) (Foto 1)", () => {
    expect(BASELINE_DEPARA_SEMI_MAQUINAS.teamName).toBe("TIME SEMI (MÁQUINAS)");
    expect(BASELINE_DEPARA_SEMI_MAQUINAS.metaTotal).toBe(1_890_000);
    expect(BASELINE_DEPARA_SEMI_MAQUINAS.maduroTotal).toBe(19_260_000);
    expect(BASELINE_DEPARA_SEMI_MAQUINAS.promessaTotal).toBe(1_930_000);

    const sellers = BASELINE_DEPARA_SEMI_MAQUINAS.sellers;
    expect(sellers).toHaveLength(6);

    // Andreia
    const andreia = sellers.find((s) => s.sellerId === "andreia-camargo")!;
    expect(andreia.totalMaduroValue).toBe(3_240_000);
    expect(andreia.totalMaduroPercent).toBe(1081);
    expect(andreia.tasksCount).toBe(15);

    // Beatriz
    const beatriz = sellers.find((s) => s.sellerId === "beatriz-ribeiro")!;
    expect(beatriz.totalMaduroValue).toBe(8_410_000);
    expect(beatriz.totalMaduroPercent).toBe(2473);
    expect(beatriz.tasksCount).toBe(17);

    // Denise
    const denise = sellers.find((s) => s.sellerId === "denise-gomes")!;
    expect(denise.totalMaduroValue).toBe(1_160_000);
    expect(denise.totalMaduroPercent).toBe(342);
    expect(denise.tasksCount).toBe(4);

    // Melissa
    const melissa = sellers.find((s) => s.sellerId === "melissa-gomes")!;
    expect(melissa.totalMaduroValue).toBe(990_000);
    expect(melissa.totalMaduroPercent).toBe(291);
    expect(melissa.tasksCount).toBe(5);

    // Mercado Livre / Deborah
    const ml = sellers.find((s) => s.sellerId === "mercado-livre")!;
    expect(ml.totalMaduroValue).toBe(3_110_000);
    expect(ml.totalMaduroPercent).toBe(1142);
    expect(ml.tasksCount).toBe(19);

    // Victor
    const victor = sellers.find((s) => s.sellerId === "victor-goes")!;
    expect(victor.totalMaduroValue).toBe(2_350_000);
    expect(victor.totalMaduroPercent).toBe(690);
    expect(victor.tasksCount).toBe(5);
  });

  it("deve conter as negociações reais da Foto 2 (Diana - 3 DIAS)", () => {
    const deals3d = BASELINE_DEPARA_DEALS.filter(
      (d) => d.sellerId === "diana-gimenes" && d.tierKey === "tier_3d"
    );
    expect(deals3d).toHaveLength(3);
    expect(deals3d[0].title).toBe("Droga Vita");
    expect(deals3d[0].value).toBe(3_000);
    expect(deals3d[1].title).toContain("MACANUDA INDUSTRIA");
    expect(deals3d[2].title).toContain("0018359 -rosqueadora");
  });

  it("deve conter as negociações reais da Foto 3 (Diana - 15 DIAS com atraso)", () => {
    const deals15d = BASELINE_DEPARA_DEALS.filter(
      (d) => d.sellerId === "diana-gimenes" && d.tierKey === "tier_15d"
    );
    expect(deals15d.length).toBeGreaterThanOrEqual(10);

    const cleberlei = deals15d.find((d) => d.title.includes("0024129 - EMPACOTADORA"));
    expect(cleberlei).toBeDefined();
    expect(cleberlei?.isDelayed).toBe(true);
    expect(cleberlei?.value).toBe(40_000);

    const paulo = deals15d.find((d) => d.title.includes("PAULO MAURICIO"));
    expect(paulo).toBeDefined();
    expect(paulo?.value).toBe(50_000);
  });

  it("deve formatar valores monetários abreviados corretamente", () => {
    expect(formatDeparaCurrency(0)).toBe("0 MIL");
    expect(formatDeparaCurrency(262_000)).toBe("262 MIL");
    expect(formatDeparaCurrency(1_870_000)).toContain("1,87 MILHÕES");

    expect(formatDeparaMeta(1_000_000)).toBe("R$ 1.00M");
    expect(formatDeparaMeta(291_000)).toBe("R$ 291k");

    expect(formatDealCurrencyDetail(3_000)).toBe("R$ 3,00 mil");
    expect(formatDealCurrencyDetail(50_000)).toBe("R$ 50,00 mil");
    expect(formatDealCurrencyDetail(1_000_000)).toBe("R$ 1,00M");
  });

  it("deve obter deals de um consultor específico via getBaselineDeparaDeals", () => {
    const dianaDeals = getBaselineDeparaDeals("diana-gimenes");
    expect(dianaDeals.length).toBeGreaterThan(0);
    expect(dianaDeals.every((d) => d.sellerId === "diana-gimenes")).toBe(true);

    const fallbackDeals = getBaselineDeparaDeals("jhordan-rueda");
    expect(fallbackDeals.length).toBeGreaterThan(0);
    expect(fallbackDeals.every((d) => d.sellerId === "jhordan-rueda")).toBe(true);
  });
});
