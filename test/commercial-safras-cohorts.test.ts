import { describe, expect, it } from "bun:test";
import {
  DEFAULT_SAFRAS_TIERS_CONFIG,
  BASELINE_SAFRAS_MONTHS,
  BASELINE_SAFRAS_SUMMARY,
  BASELINE_UNCLASSIFIED_DEALS,
  formatBrlK,
  getBaselineSafrasCohortsData,
  getBaselineUnclassifiedDeals,
} from "@/lib/commercial/safras-cohorts-data";

describe("Commercial Safras & Régua De-Para (CWR Slide 9 / Maturity Cohorts)", () => {
  it("deve conter exatamente 5 faixas oficiais na Régua De-Para com cores correspondentes", () => {
    expect(DEFAULT_SAFRAS_TIERS_CONFIG).toHaveLength(5);

    expect(DEFAULT_SAFRAS_TIERS_CONFIG[0].label).toBe("3 DIAS");
    expect(DEFAULT_SAFRAS_TIERS_CONFIG[0].days).toBe(3);
    expect(DEFAULT_SAFRAS_TIERS_CONFIG[0].maxValue).toBe(8600);
    expect(DEFAULT_SAFRAS_TIERS_CONFIG[0].color).toBe("#ef4444");

    expect(DEFAULT_SAFRAS_TIERS_CONFIG[1].label).toBe("15 DIAS");
    expect(DEFAULT_SAFRAS_TIERS_CONFIG[1].days).toBe(15);
    expect(DEFAULT_SAFRAS_TIERS_CONFIG[1].maxValue).toBe(50000);
    expect(DEFAULT_SAFRAS_TIERS_CONFIG[1].color).toBe("#f59e0b");

    expect(DEFAULT_SAFRAS_TIERS_CONFIG[2].label).toBe("30 DIAS");
    expect(DEFAULT_SAFRAS_TIERS_CONFIG[2].days).toBe(30);
    expect(DEFAULT_SAFRAS_TIERS_CONFIG[2].maxValue).toBe(200000);
    expect(DEFAULT_SAFRAS_TIERS_CONFIG[2].color).toBe("#3b82f6");

    expect(DEFAULT_SAFRAS_TIERS_CONFIG[3].label).toBe("60 DIAS");
    expect(DEFAULT_SAFRAS_TIERS_CONFIG[3].days).toBe(60);
    expect(DEFAULT_SAFRAS_TIERS_CONFIG[3].maxValue).toBe(600000);
    expect(DEFAULT_SAFRAS_TIERS_CONFIG[3].color).toBe("#8b5cf6");

    expect(DEFAULT_SAFRAS_TIERS_CONFIG[4].label).toBe("90 DIAS");
    expect(DEFAULT_SAFRAS_TIERS_CONFIG[4].days).toBe(90);
    expect(DEFAULT_SAFRAS_TIERS_CONFIG[4].maxValue).toBeNull();
    expect(DEFAULT_SAFRAS_TIERS_CONFIG[4].color).toBe("#10b981");
  });

  it("deve conter a série temporal dos últimos 6 meses com outubro como mês atual", () => {
    expect(BASELINE_SAFRAS_MONTHS).toHaveLength(6);

    const monthKeys = BASELINE_SAFRAS_MONTHS.map((m) => m.monthKey);
    expect(monthKeys).toEqual([
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
      "2026-10",
    ]);

    const currentMonth = BASELINE_SAFRAS_MONTHS.find((m) => m.isCurrentMonth);
    expect(currentMonth).toBeDefined();
    expect(currentMonth?.monthKey).toBe("2026-10");
    expect(currentMonth?.monthName).toBe("Outubro");

    for (const month of BASELINE_SAFRAS_MONTHS) {
      expect(month.tiers).toHaveLength(5);
      expect(month.totalCards).toBe(month.unclassifiedCount + month.classifiedCount);
      expect(month.totalValue).toBeGreaterThan(0);
    }
  });

  it("deve validar a integridade matemática dos totais de cards e faturamento", () => {
    const sumTotalCards = BASELINE_SAFRAS_MONTHS.reduce((acc, m) => acc + m.totalCards, 0);
    const sumClassified = BASELINE_SAFRAS_MONTHS.reduce((acc, m) => acc + m.classifiedCount, 0);
    const sumUnclassified = BASELINE_SAFRAS_MONTHS.reduce((acc, m) => acc + m.unclassifiedCount, 0);
    const sumTotalValue = BASELINE_SAFRAS_MONTHS.reduce((acc, m) => acc + m.totalValue, 0);

    expect(sumTotalCards).toBe(BASELINE_SAFRAS_SUMMARY.totalCardsAllMonths);
    expect(sumClassified).toBe(BASELINE_SAFRAS_SUMMARY.totalClassifiedAllMonths);
    expect(sumUnclassified).toBe(BASELINE_SAFRAS_SUMMARY.totalUnclassifiedAllMonths);
    expect(sumTotalValue).toBe(BASELINE_SAFRAS_SUMMARY.totalValueAllMonths);
  });

  it("deve conter oportunidades sem classificação reais para o modal drilldown", () => {
    const dealsOct = getBaselineUnclassifiedDeals("2026-10");
    expect(dealsOct.length).toBeGreaterThan(0);

    for (const deal of dealsOct) {
      expect(deal.id).toBeDefined();
      expect(deal.name).toBeDefined();
      expect(deal.userName).toBeDefined();
      expect(["PERSONNALITE", "MAQUINAS"]).toContain(deal.team);
      expect(deal.totalPrice).toBe(0);
      expect(deal.dealCreatedAt).toBeDefined();
    }
  });

  it("deve formatar valores monetários abreviados corretamente (formatBrlK)", () => {
    expect(formatBrlK(39800000)).toMatch(/39/);
    expect(formatBrlK(39800000)).toMatch(/M/);
    expect(formatBrlK(620000)).toMatch(/620/);
    expect(formatBrlK(620000)).toMatch(/k/);
    expect(formatBrlK(850)).toBe("R$ 850");
  });

  it("deve retornar o payload padrão completo via getBaselineSafrasCohortsData", () => {
    const payload = getBaselineSafrasCohortsData();
    expect(payload.success).toBe(true);
    expect(payload.tiersConfig).toHaveLength(5);
    expect(payload.months).toHaveLength(6);
    expect(payload.summary.totalCardsAllMonths).toBeGreaterThan(0);
    expect(payload.summary.totalClassifiedAllMonths).toBeGreaterThan(0);
    expect(payload.summary.totalUnclassifiedAllMonths).toBeGreaterThan(0);
    expect(payload.summary.totalValueAllMonths).toBeGreaterThan(0);
  });
});
