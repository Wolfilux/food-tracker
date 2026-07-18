import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildHeaderCalorieMetrics,
  buildHeaderCalorieProgress,
  formatHeaderCalorieValue,
  formatHeaderDate,
  headerCalorieLabels,
} from "../src/header-summary.ts";

test("zeigt das ausgewählte Datum vollständig auf Deutsch", () => {
  assert.equal(formatHeaderDate("2026-07-18"), "Samstag, 18. Juli 2026");
});

test("berechnet offene Kalorien und Fortschritt für einen laufenden Tag", () => {
  assert.deepEqual(buildHeaderCalorieProgress(1250.4, 2300), {
    consumedCalories: 1250,
    goalCalories: 2300,
    remainingCalories: 1050,
    progressPercent: 54,
    isOverGoal: false,
  });
});

test("begrenzt die Progressbar bei Überschreitung und markiert das Tagesziel als überschritten", () => {
  assert.deepEqual(buildHeaderCalorieProgress(2450, 2300), {
    consumedCalories: 2450,
    goalCalories: 2300,
    remainingCalories: -150,
    progressPercent: 100,
    isOverGoal: true,
  });
});

test("behandelt ein ungültiges Nullziel ohne Division durch null", () => {
  assert.deepEqual(buildHeaderCalorieProgress(0, 0), {
    consumedCalories: 0,
    goalCalories: 0,
    remainingCalories: 0,
    progressPercent: 0,
    isOverGoal: false,
  });
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

test("behält Fortschrittsanzeige und Swipe-Navigation im Hero", async () => {
  const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");

  assert.match(appSource, /<span>Offen<\/span>/);
  assert.match(appSource, /role="progressbar"/);
  assert.match(appSource, /headerCalorieMetrics\.map/);
  assert.match(appSource, /onPointerDown=\{handleHeroPointerDown\}/);
  assert.match(appSource, /onPointerUp=\{finishHeroSwipe\}/);
});

test("stellt den Fortschritt im Mobile-Layout ohne horizontales Raster dar", async () => {
  const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  const mobileStyles = styles.slice(styles.indexOf("@media (max-width: 560px)"));

  assert.match(styles, /\.hero-panel\s*\{[\s\S]*?touch-action:\s*pan-y;/);
  assert.match(mobileStyles, /\.goal-card__progress-summary\s*\{[\s\S]*?grid-template-columns:\s*auto 1fr;/);
  assert.match(mobileStyles, /\.goal-card__progress-summary small\s*\{[\s\S]*?grid-column:\s*1 \/ -1;/);
});
