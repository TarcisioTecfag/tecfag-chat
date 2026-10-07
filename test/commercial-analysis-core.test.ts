import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildGoalCurve,
  directiveState,
  forecastTier,
  lastSixMonths,
  monthWindow,
  tmaBucket,
} from "../src/lib/commercial/analysis-core";

test("responsabilidade distingue atraso, hoje e execução registrada", () => {
  assert.equal(directiveState("pending", "2026-10-06", "2026-10-07"), "overdue");
  assert.equal(directiveState("pending", "2026-10-07", "2026-10-07"), "pending_today");
  assert.equal(directiveState("completed", "2026-10-06", "2026-10-07"), "completed");
});

test("previsão e SLA classificam bordas sem estimar eventos", () => {
  const days = [7, 15, 30, 60, 90];
  assert.equal(forecastTier(0, days), 1);
  assert.equal(forecastTier(15, days), 2);
  assert.equal(forecastTier(16, days), 3);
  assert.equal(forecastTier(120, days), 5);
  assert.equal(tmaBucket(300, [5, 15, 30]), 0);
  assert.equal(tmaBucket(301, [5, 15, 30]), 1);
  assert.equal(tmaBucket(1801, [5, 15, 30]), 3);
});

test("períodos atravessam janeiro sem perder mês", () => {
  assert.deepEqual(monthWindow("2026-01"), {
    start: "2026-01-01",
    nextStart: "2026-02-01",
    previousMonth: "2025-12",
  });
  assert.deepEqual(lastSixMonths("2026-02"), [
    "2025-09",
    "2025-10",
    "2025-11",
    "2025-12",
    "2026-01",
    "2026-02",
  ]);
});

test("Curva S usa expediente ajustado e ganhos reais, inclusive no sábado", () => {
  const curve = buildGoalCurve(
    "2026-10",
    "2026-10-07",
    2200,
    new Map([
      ["2026-10-03", { count: 1, value: 300 }],
      ["2026-10-06", { count: 1, value: 500 }],
      ["2026-10-07", { count: 1, value: 200 }],
    ]),
    [
      { date: "2026-10-03", type: "extra_work", affectsGoal: true },
      { date: "2026-10-05", type: "holiday", affectsGoal: true },
    ],
  );
  assert.equal(curve.pacing.businessDays, 22);
  assert.equal(curve.points[2].businessDay, true);
  assert.equal(curve.points[4].businessDay, false);
  assert.equal(curve.points[6].realizedCumulative, 1000);
  assert.equal(curve.points[6].expectedCumulative, 500);
  assert.deepEqual(curve.todayWon, { count: 1, value: 200 });
  assert.deepEqual(curve.weekWon, { count: 2, value: 700 });
  assert.equal(curve.weekTargetValue, 400);
  assert.equal(curve.weekGapValue, 0);
});
