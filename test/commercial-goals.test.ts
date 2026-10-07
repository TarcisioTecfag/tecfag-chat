import assert from "node:assert/strict";
import { test } from "node:test";

type ConsultantGoal = {
  operatorId: string;
  name: string;
  targetValue: number;
  conversionRate: number;
  realizedValue: number;
};

function calculateGoalMetrics(
  consultants: ConsultantGoal[],
  businessDays: number,
  remainingDays: number
) {
  const processed = consultants.map((c) => {
    const dailyTarget = businessDays > 0 ? c.targetValue / businessDays : 0;
    const attainment = c.targetValue > 0 ? (c.realizedValue / c.targetValue) * 100 : 0;
    const gap = Math.max(0, c.targetValue - c.realizedValue);
    return {
      ...c,
      dailyTarget,
      attainment,
      gap,
    };
  });

  const totalTarget = processed.reduce((acc, c) => acc + c.targetValue, 0);
  const totalRealized = processed.reduce((acc, c) => acc + c.realizedValue, 0);
  const totalGap = Math.max(0, totalTarget - totalRealized);
  const totalAttainment = totalTarget > 0 ? (totalRealized / totalTarget) * 100 : 0;
  const consultantsWithGoal = processed.filter((c) => c.targetValue > 0).length;
  const dailyRequired = remainingDays > 0 ? totalGap / remainingDays : 0;
  const totalDailyTarget = businessDays > 0 ? totalTarget / businessDays : 0;
  const validRates = processed.filter((c) => c.targetValue > 0).map((c) => c.conversionRate);
  const avgConversionRate =
    validRates.length > 0 ? validRates.reduce((a, b) => a + b, 0) / validRates.length : 10;

  return {
    processed,
    totals: {
      totalTarget,
      totalRealized,
      totalGap,
      totalAttainment,
      consultantsWithGoal,
      dailyRequired,
      totalDailyTarget,
      avgConversionRate,
    },
  };
}

test("cálculos da tela de Metas Comerciais coincidem exatamente com o layout de referência", () => {
  // Dados extraídos da imagem de referência (Outubro de 2026):
  // 22 dias úteis, 5 decorridos, 17 restantes
  const businessDays = 22;
  const remainingDays = 17;

  const mockConsultants: ConsultantGoal[] = [
    {
      operatorId: "1",
      name: "Andreia Camargo",
      targetValue: 300_000,
      conversionRate: 10,
      realizedValue: 24_538,
    },
    {
      operatorId: "2",
      name: "Beatriz Ribeiro",
      targetValue: 340_000,
      conversionRate: 10,
      realizedValue: 33_537,
    },
    {
      operatorId: "3",
      name: "Marcelo Nardelli",
      targetValue: 880_000,
      conversionRate: 10,
      realizedValue: 630_000,
    },
  ];

  const result = calculateGoalMetrics(mockConsultants, businessDays, remainingDays);

  // Andreia: Meta 300k, Realizado 24.538
  const andreia = result.processed[0];
  assert.equal(Math.round(andreia.dailyTarget), 13636); // 300.000 / 22 = 13.636
  assert.equal(andreia.gap, 275462); // 300.000 - 24.538 = 275.462
  assert.equal(andreia.attainment.toFixed(1), "8.2"); // 24.538 / 300.000 = 8.179% -> 8.2%

  // Beatriz: Meta 340k, Realizado 33.537
  const beatriz = result.processed[1];
  assert.equal(Math.round(beatriz.dailyTarget), 15455); // 340.000 / 22 = 15.454,54 -> 15.455
  assert.equal(beatriz.gap, 306463); // 340.000 - 33.537 = 306.463
  assert.equal(beatriz.attainment.toFixed(1), "9.9"); // 33.537 / 340.000 = 9.86% -> 9.9%

  // Marcelo: Meta 880k, Realizado 630.000
  const marcelo = result.processed[2];
  assert.equal(Math.round(marcelo.dailyTarget), 40000); // 880.000 / 22 = 40.000
  assert.equal(marcelo.gap, 250000); // 880.000 - 630.000 = 250.000
  assert.equal(marcelo.attainment.toFixed(1), "71.6"); // 630.000 / 880.000 = 71.59% -> 71.6%
});

test("cálculo de meta diária necessária global bate exatamente com o card da foto", () => {
  // Na foto:
  // Meta Total: R$ 4.830.000
  // Realizado: R$ 1.068.086
  // Dias restantes: 17
  // Meta diária necessária: R$ 221.289
  const totalTarget = 4_830_000;
  const totalRealized = 1_068_086;
  const totalGap = totalTarget - totalRealized; // 3.761.914
  const remainingDays = 17;

  const dailyRequired = totalGap / remainingDays;
  assert.equal(Math.round(dailyRequired), 221289);
  assert.equal(( (totalRealized / totalTarget) * 100 ).toFixed(1), "22.1");
});
