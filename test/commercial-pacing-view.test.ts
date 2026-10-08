import { describe, expect, it } from "bun:test";
import {
  BASELINE_PACING_PERSONNALITE,
  BASELINE_PACING_SEMI_MAQUINAS,
  BASELINE_PACING_DEALS,
  GLOBAL_PACING_KPIS,
  formatPacingCurrency,
  getBaselinePacingDeals,
} from "../src/lib/commercial/pacing-data";

describe("Commercial Pacing & Cockpit de Metas (Slide 4 - War Room)", () => {
  it("deve conter os KPIs globais do topo do Cockpit (Foto 1 - Slide 4)", () => {
    expect(GLOBAL_PACING_KPIS.businessDaysRemaining).toBe(17);
    expect(GLOBAL_PACING_KPIS.businessDaysTotal).toBe(22);
    expect(GLOBAL_PACING_KPIS.businessDaysElapsed).toBe(5);
    expect(Math.round(GLOBAL_PACING_KPIS.elapsedPercent)).toBe(23); // ~22.7%
    expect(GLOBAL_PACING_KPIS.metaGlobal).toBe(4_830_000);
    expect(GLOBAL_PACING_KPIS.globalPercent).toBe(22.3);
    expect(GLOBAL_PACING_KPIS.companyPacingDaily).toBe(221_000);
    expect(GLOBAL_PACING_KPIS.companyRealizedToday).toBe(0);
  });

  it("deve conter os totais e consultores exatos do TIME PERSONNALITÉ (Fotos 1 e 3)", () => {
    expect(BASELINE_PACING_PERSONNALITE.teamName).toBe("TIME PERSONNALITÉ");
    expect(BASELINE_PACING_PERSONNALITE.metaTotal).toBe(2_940_000);
    expect(BASELINE_PACING_PERSONNALITE.fechadoTotal).toBe(840_000);
    expect(BASELINE_PACING_PERSONNALITE.fechadoPercent).toBe(28.5);
    expect(BASELINE_PACING_PERSONNALITE.ritmoDiarioTotal).toBe(134_000);

    const sellers = BASELINE_PACING_PERSONNALITE.sellers;
    expect(sellers).toHaveLength(4);

    // Diana (Recuperar)
    const diana = sellers.find((s) => s.sellerId === "diana-gimenes")!;
    expect(diana).toBeDefined();
    expect(diana.pacingStatus).toBe("recuperar");
    expect(diana.metaMonthly).toBe(1_000_000);
    expect(diana.realizedMonthly).toBe(10_000);
    expect(diana.realizedPercent).toBe(0.9);
    expect(diana.remainingMonthly).toBe(990_000);
    expect(diana.dailyGoal).toBe(58_300);
    expect(diana.dailyRealized).toBe(0);
    expect(diana.weeklyGoal).toBe(291_500);
    expect(diana.weeklyRealized).toBe(9_000);
    expect(diana.weeklyRealizedPercent).toBe(3);
    expect(diana.habeisCount).toBe(35);
    expect(diana.habeisValue).toBe(2_930_000);

    // Jhordan (No Alvo)
    const jhordan = sellers.find((s) => s.sellerId === "jhordan-rueda")!;
    expect(jhordan.pacingStatus).toBe("alvo");
    expect(jhordan.realizedPercent).toBe(25.1);
    expect(jhordan.dailyGoal).toBe(26_400);
    expect(jhordan.weeklyGoal).toBe(174_000);
    expect(jhordan.weeklyRealized).toBe(148_000);
    expect(jhordan.weeklyRealizedPercent).toBe(111);
    expect(jhordan.habeisCount).toBe(117);

    // Marcelo (Acelerado)
    const marcelo = sellers.find((s) => s.sellerId === "marcelo-nardelli")!;
    expect(marcelo.pacingStatus).toBe("acelerado");
    expect(marcelo.realizedPercent).toBe(71.6);
    expect(marcelo.dailyGoal).toBe(40_000);
    expect(marcelo.weeklyGoal).toBe(200_000);
    expect(marcelo.weeklyRealized).toBe(630_000);
    expect(marcelo.weeklyRealizedPercent).toBe(315);
    expect(marcelo.habeisCount).toBe(9);
    expect(marcelo.habeisValue).toBe(2_610_000);

    // Rosenvaldo (Recuperar)
    const rosenvaldo = sellers.find((s) => s.sellerId === "rosenvaldo-lucas")!;
    expect(rosenvaldo.pacingStatus).toBe("recuperar");
    expect(rosenvaldo.realizedPercent).toBe(10.7);
    expect(rosenvaldo.dailyGoal).toBe(25_200);
    expect(rosenvaldo.weeklyGoal).toBe(124_000);
    expect(rosenvaldo.weeklyRealized).toBe(52_000);
    expect(rosenvaldo.weeklyRealizedPercent).toBe(41);
    expect(rosenvaldo.habeisCount).toBe(21);
  });

  it("deve conter os totais e consultores exatos do TIME SEMI (MÁQUINAS) (Fotos 1 e 3)", () => {
    expect(BASELINE_PACING_SEMI_MAQUINAS.teamName).toBe("TIME SEMI (MÁQUINAS)");
    expect(BASELINE_PACING_SEMI_MAQUINAS.metaTotal).toBe(1_890_000);
    expect(BASELINE_PACING_SEMI_MAQUINAS.fechadoTotal).toBe(230_000);
    expect(BASELINE_PACING_SEMI_MAQUINAS.fechadoPercent).toBe(12.3);
    expect(BASELINE_PACING_SEMI_MAQUINAS.ritmoDiarioTotal).toBe(98_000);

    const sellers = BASELINE_PACING_SEMI_MAQUINAS.sellers;
    expect(sellers).toHaveLength(6);

    // Andreia
    const andreia = sellers.find((s) => s.sellerId === "andreia-camargo")!;
    expect(andreia.pacingStatus).toBe("recuperar");
    expect(andreia.dailyGoal).toBe(18_200);
    expect(andreia.weeklyGoal).toBe(81_000);
    expect(andreia.weeklyRealized).toBe(25_000);
    expect(andreia.weeklyRealizedPercent).toBe(31);
    expect(andreia.habeisCount).toBe(119);

    // Beatriz
    const beatriz = sellers.find((s) => s.sellerId === "beatriz-ribeiro")!;
    expect(beatriz.pacingStatus).toBe("recuperar");
    expect(beatriz.dailyGoal).toBe(18_000);
    expect(beatriz.weeklyGoal).toBe(90_100);
    expect(beatriz.weeklyRealized).toBe(34_000);
    expect(beatriz.weeklyRealizedPercent).toBe(38);
    expect(beatriz.habeisCount).toBe(133);

    // MERCADO (No Alvo)
    const mercado = sellers.find((s) => s.sellerId === "mercado-livre")!;
    expect(mercado.pacingStatus).toBe("alvo");
    expect(mercado.dailyGoal).toBe(10_500);
    expect(mercado.weeklyGoal).toBe(52_300);
    expect(mercado.weeklyRealized).toBe(54_000);
    expect(mercado.weeklyRealizedPercent).toBe(103);
    expect(mercado.habeisCount).toBe(134);

    // Denise
    const denise = sellers.find((s) => s.sellerId === "denise-gomes")!;
    expect(denise.pacingStatus).toBe("recuperar");
    expect(denise.dailyGoal).toBe(17_700);
    expect(denise.weeklyGoal).toBe(88_700);
    expect(denise.weeklyRealized).toBe(39_000);
    expect(denise.weeklyRealizedPercent).toBe(44);
    expect(denise.habeisCount).toBe(98);

    // Melissa
    const melissa = sellers.find((s) => s.sellerId === "melissa-gomes")!;
    expect(melissa.pacingStatus).toBe("recuperar");
    expect(melissa.dailyGoal).toBe(17_000);
    expect(melissa.weeklyGoal).toBe(85_000);
    expect(melissa.weeklyRealized).toBe(51_000);
    expect(melissa.weeklyRealizedPercent).toBe(60);
    expect(melissa.habeisCount).toBe(84);

    // Victor
    const victor = sellers.find((s) => s.sellerId === "victor-goes")!;
    expect(victor.pacingStatus).toBe("recuperar");
    expect(victor.dailyGoal).toBe(18_200);
    expect(victor.weeklyGoal).toBe(91_100);
    expect(victor.weeklyRealized).toBe(38_000);
    expect(victor.weeklyRealizedPercent).toBe(41);
    expect(victor.habeisCount).toBe(131);
  });

  it("deve conter as negociações reais da Foto 2 (Marcelo Nardelli)", () => {
    expect(BASELINE_PACING_DEALS).toHaveLength(9);

    const deal1 = BASELINE_PACING_DEALS.find((d) => d.code === "0016186")!;
    expect(deal1.title).toContain("Linha de Envase Própolis- Apisnutri");
    expect(deal1.value).toBe(484_000);
    expect(deal1.ageDays).toBe(289);
    expect(deal1.horizonKey).toBe("tier_60d");

    const dealAqua = BASELINE_PACING_DEALS.find((d) => d.code === "005856")!;
    expect(dealAqua.title).toContain("AQUA DO BRASIL");
    expect(dealAqua.value).toBe(1_260_000);
    expect(dealAqua.ageDays).toBe(223);
    expect(dealAqua.horizonKey).toBe("tier_90d");

    const dealDiretriz = BASELINE_PACING_DEALS.find((d) => d.code === "0019647")!;
    expect(dealDiretriz.hasDirectiveCompleted).toBe(true);

    const dealCafe = BASELINE_PACING_DEALS.find((d) => d.title === "Café Serra do Piloto")!;
    expect(dealCafe.hasDirectiveCompleted).toBe(true);
    expect(dealCafe.crmStage).toBe("Abordagem Comercial");
  });

  it("deve formatar valores monetários corretamente para o Cockpit", () => {
    expect(formatPacingCurrency(2_940_000)).toBe("R$ 2,94M");
    expect(formatPacingCurrency(58_300)).toBe("R$ 58,3k");
    expect(formatPacingCurrency(10_000)).toBe("R$ 10k");
    expect(formatPacingCurrency(0)).toBe("R$ 0");
  });
});
