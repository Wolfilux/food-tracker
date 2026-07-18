import assert from "node:assert/strict";
import test from "node:test";
import {
  buildHeaderCalorieMetrics,
  formatHeaderCalorieValue,
  formatHeaderDate,
  headerCalorieLabels,
} from "../src/header-summary.ts";

test("zeigt das ausgewählte Datum vollständig auf Deutsch", () => {
  assert.equal(formatHeaderDate("2026-07-18"), "Samstag, 18. Juli 2026");
});

test("liefert exakt Basis, Aktiv, Defizit und Gesamt in dieser Reihenfolge", () => {
  const metrics = buildHeaderCalorieMetrics({
    baseCalories: 2500,
    activeCalories: 350,
    deficitCalories: -550,
    totalCalories: 2300,
  });

  assert.deepEqual(metrics.map(({ label }) => label), [...headerCalorieLabels]);
  assert.deepEqual(metrics.map(({ value }) => value), [2500, 350, -550, 2300]);
  assert.deepEqual(metrics.map(formatHeaderCalorieValue), [
    "2.500 kcal",
    "+350 kcal",
    "-550 kcal",
    "2.300 kcal",
  ]);
});
