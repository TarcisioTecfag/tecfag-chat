import assert from "node:assert/strict";
import { test } from "node:test";
import {
  calculateBusinessPacing,
  classifyMaturity,
  saoPauloDay,
} from "../src/lib/commercial/metrics";

test("dia comercial usa São Paulo na virada UTC", () => {
  assert.equal(saoPauloDay(new Date("2026-10-08T01:30:00Z")), "2026-10-07");
});

test("pacing desconta feriado e inclui expediente extra no sábado", () => {
  const result = calculateBusinessPacing("2026-10", "2026-10-07", 100_000, 25_000, [
    { date: "2026-10-05", type: "holiday", affectsGoal: true },
    { date: "2026-10-03", type: "extra_work", affectsGoal: true },
  ]);
  assert.equal(result.businessDays, 22);
  assert.equal(result.elapsedDays, 4);
  assert.equal(result.remainingDays, 18);
  assert.equal(result.dailyRequired, 75_000 / 18);
  assert.equal(result.coveragePercent, 25);
});

test("maturidade escolhe faixa pelo valor e considera idade da negociação", () => {
  const now = new Date("2026-10-07T12:00:00Z");
  assert.deepEqual(classifyMaturity(20_000, new Date("2026-09-22T12:00:00Z"), now), {
    tierIndex: 2,
    tierDays: 15,
    ageDays: 15,
    daysRemaining: 0,
    isMature: true,
  });
  assert.equal(classifyMaturity(0, now, now), null);
});

test("ritmo não divide por zero quando não há dias comerciais", () => {
  const days = Array.from({ length: 28 }, (_, index) => ({
    date: `2026-02-${String(index + 1).padStart(2, "0")}`,
    type: "holiday" as const,
    affectsGoal: true,
  }));
  const result = calculateBusinessPacing("2026-02", "2026-02-14", 50_000, 0, days);
  assert.equal(result.businessDays, 0);
  assert.equal(result.remainingDays, 0);
  assert.equal(result.dailyRequired, 0);
});
