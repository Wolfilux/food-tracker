import assert from "node:assert/strict";
import test from "node:test";
import {
  hasAnalysisTimeReference,
  hasUnresolvedAnalysisTimeReference,
  inferDefaultAnalysisPlan,
  normalizeAnalysisQueryPlan,
  resolveExplicitAnalysisPlan,
} from "./analysis-query.js";

const options = {
  anchorWeekStart: "2026-07-20",
  today: "2026-07-27",
  availableFrom: "2026-01-03",
  availableTo: "2026-07-27",
};

test("resolves the last four weeks relative to the selected analysis week", () => {
  const plan = resolveExplicitAnalysisPlan("Was lief in den letzten 4 Wochen schief?", options);

  assert.deepEqual(plan.periods.map(({ label, from, to }) => ({ label, from, to })), [{
    label: "Letzte 4 Wochen",
    from: "2026-06-29",
    to: "2026-07-26",
  }]);
  assert.equal(plan.includeDailyDetails, true);
  assert.equal(plan.defaulted, false);
});

test("adds the preceding rolling range when the question asks for a comparison", () => {
  const plan = resolveExplicitAnalysisPlan(
    "Vergleiche die letzten 4 Wochen mit den 4 Wochen davor",
    options,
  );

  assert.deepEqual(plan.periods.map(({ label, from, to }) => ({ label, from, to })), [
    { label: "Letzte 4 Wochen", from: "2026-06-29", to: "2026-07-26" },
    { label: "4 Wochen davor", from: "2026-06-01", to: "2026-06-28" },
  ]);
});

test("honors a differently sized preceding rolling range", () => {
  const plan = resolveExplicitAnalysisPlan(
    "Vergleiche die letzten 4 Wochen mit den 8 Wochen davor",
    options,
  );
  const adjectivePlan = resolveExplicitAnalysisPlan(
    "Vergleiche die letzten 4 Wochen mit den vorhergehenden 8 Wochen",
    options,
  );

  assert.deepEqual(plan.periods.map(({ label, from, to }) => ({ label, from, to })), [
    { label: "Letzte 4 Wochen", from: "2026-06-29", to: "2026-07-26" },
    { label: "8 Wochen davor", from: "2026-05-04", to: "2026-06-28" },
  ]);
  assert.deepEqual(adjectivePlan.periods, plan.periods);
});

test("preserves multiple explicit rolling ranges in one comparison", () => {
  const plan = resolveExplicitAnalysisPlan(
    "Vergleiche die letzten 4 Wochen mit den letzten 8 Wochen",
    options,
  );

  assert.deepEqual(plan.periods.map(({ label, from, to }) => ({ label, from, to })), [
    { label: "Letzte 4 Wochen", from: "2026-06-29", to: "2026-07-26" },
    { label: "Letzte 8 Wochen", from: "2026-06-01", to: "2026-07-26" },
  ]);
});

test("resolves named months and month comparisons", () => {
  const june = resolveExplicitAnalysisPlan("Wie war meine Ernährung im Juni?", options);
  assert.deepEqual(june.periods.map(({ from, to }) => ({ from, to })), [{
    from: "2026-06-01",
    to: "2026-06-30",
  }]);

  const comparison = resolveExplicitAnalysisPlan("Vergleiche April und Juni", options);
  assert.deepEqual(comparison.periods.map(({ from, to }) => ({ from, to })), [
    { from: "2026-04-01", to: "2026-04-30" },
    { from: "2026-06-01", to: "2026-06-30" },
  ]);
  assert.equal(comparison.includeDailyDetails, false);
});

test("keeps named months in mixed month and week comparisons", () => {
  const rolling = resolveExplicitAnalysisPlan("Vergleiche die letzten 4 Wochen mit Juni", options);
  const isoWeek = resolveExplicitAnalysisPlan("Vergleiche KW 20 mit Juni", options);

  assert.deepEqual(rolling.periods.map(({ from, to }) => ({ from, to })), [
    { from: "2026-06-29", to: "2026-07-26" },
    { from: "2026-06-01", to: "2026-06-30" },
  ]);
  assert.deepEqual(isoWeek.periods.map(({ from, to }) => ({ from, to })), [
    { from: "2026-05-11", to: "2026-05-17" },
    { from: "2026-06-01", to: "2026-06-30" },
  ]);
});

test("keeps intervening months in a continuous named-month range", () => {
  const plan = resolveExplicitAnalysisPlan("Wie lief es von Januar bis März?", options);
  const barePlan = resolveExplicitAnalysisPlan("Wie lief es Januar bis März?", options);
  const comparison = resolveExplicitAnalysisPlan("Vergleiche Januar bis März mit Juni", options);
  const rangeComparison = resolveExplicitAnalysisPlan(
    "Vergleiche Januar bis März mit April bis Juni",
    options,
  );

  assert.deepEqual(plan.periods.map(({ label, from, to }) => ({ label, from, to })), [{
    label: "Januar 2026 bis März 2026",
    from: "2026-01-01",
    to: "2026-03-31",
  }]);
  assert.deepEqual(barePlan.periods, plan.periods);
  assert.deepEqual(comparison.periods.map(({ from, to }) => ({ from, to })), [
    { from: "2026-01-01", to: "2026-03-31" },
    { from: "2026-06-01", to: "2026-06-30" },
  ]);
  assert.deepEqual(rangeComparison.periods.map(({ from, to }) => ({ from, to })), [
    { from: "2026-01-01", to: "2026-03-31" },
    { from: "2026-04-01", to: "2026-06-30" },
  ]);
});

test("propagates explicit years across named-month ranges and comparisons", () => {
  const range = resolveExplicitAnalysisPlan("Wie lief es von Januar 2025 bis März?", options);
  const comparison = resolveExplicitAnalysisPlan("Vergleiche Juni 2025 und Juli", options);
  const reverseComparison = resolveExplicitAnalysisPlan("Vergleiche Juli 2025 mit Juni", options);
  const yearBoundaryComparison = resolveExplicitAnalysisPlan("Vergleiche Dezember und Januar 2026", options);
  const forwardYearBoundaryComparison = resolveExplicitAnalysisPlan("Vergleiche Dezember 2025 und Januar", options);
  const previousDecemberComparison = resolveExplicitAnalysisPlan(
    "Vergleiche Januar 2026 mit dem vorherigen Dezember",
    options,
  );
  const yearBoundary = resolveExplicitAnalysisPlan("Wie lief es von November 2025 bis Februar?", options);
  const reverseExplicitBoundary = resolveExplicitAnalysisPlan("Wie lief es von November bis Februar 2026?", options);

  assert.deepEqual(range.periods.map(({ label, from, to }) => ({ label, from, to })), [{
    label: "Januar 2025 bis März 2025",
    from: "2025-01-01",
    to: "2025-03-31",
  }]);
  assert.deepEqual(comparison.periods.map(({ from, to }) => ({ from, to })), [
    { from: "2025-06-01", to: "2025-06-30" },
    { from: "2025-07-01", to: "2025-07-31" },
  ]);
  assert.deepEqual(reverseComparison.periods.map(({ from, to }) => ({ from, to })), [
    { from: "2025-07-01", to: "2025-07-31" },
    { from: "2025-06-01", to: "2025-06-30" },
  ]);
  assert.deepEqual(yearBoundaryComparison.periods.map(({ from, to }) => ({ from, to })), [
    { from: "2025-12-01", to: "2025-12-31" },
    { from: "2026-01-01", to: "2026-01-31" },
  ]);
  assert.deepEqual(forwardYearBoundaryComparison.periods.map(({ from, to }) => ({ from, to })), [
    { from: "2025-12-01", to: "2025-12-31" },
    { from: "2026-01-01", to: "2026-01-31" },
  ]);
  assert.deepEqual(previousDecemberComparison.periods.map(({ from, to }) => ({ from, to })), [
    { from: "2026-01-01", to: "2026-01-31" },
    { from: "2025-12-01", to: "2025-12-31" },
  ]);
  assert.deepEqual(yearBoundary.periods.map(({ from, to }) => ({ from, to })), [{
    from: "2025-11-01",
    to: "2026-02-28",
  }]);
  assert.deepEqual(reverseExplicitBoundary.periods.map(({ from, to }) => ({ from, to })), [{
    from: "2025-11-01",
    to: "2026-02-28",
  }]);
});

test("resolves since January without exceeding the annual query limit", () => {
  const plan = resolveExplicitAnalysisPlan("Wie hat sich mein Gewicht seit Januar entwickelt?", options);
  const comparison = resolveExplicitAnalysisPlan("Vergleiche die Entwicklung seit Januar mit Juni", options);

  assert.deepEqual(plan.periods.map(({ from, to }) => ({ from, to })), [{
    from: "2026-01-01",
    to: "2026-07-26",
  }]);
  assert.equal(plan.focus.includes("weight"), true);
  assert.equal(plan.focus.includes("nutrition"), true);
  assert.equal(plan.focus.includes("activity"), true);
  assert.equal(plan.includeDailyDetails, false);
  assert.deepEqual(comparison.periods.map(({ from, to }) => ({ from, to })), [
    { from: "2026-01-01", to: "2026-07-26" },
    { from: "2026-06-01", to: "2026-06-30" },
  ]);
});

test("resolves selected and previous weeks as separate comparison periods", () => {
  const plan = resolveExplicitAnalysisPlan("Vergleiche diese Woche mit der letzten Woche", options);

  assert.deepEqual(plan.periods.map(({ label, from, to }) => ({ label, from, to })), [
    { label: "Ausgewählte Woche", from: "2026-07-20", to: "2026-07-26" },
    { label: "Vorherige Woche", from: "2026-07-13", to: "2026-07-19" },
  ]);
});

test("clamps a future selected week to the current partial week", () => {
  const plan = resolveExplicitAnalysisPlan("Wie läuft diese Woche?", {
    ...options,
    anchorWeekStart: "2026-08-03",
    today: "2026-07-29",
  });

  assert.deepEqual(plan.periods.map(({ from, to }) => ({ from, to })), [{
    from: "2026-07-27",
    to: "2026-07-29",
  }]);
});

test("keeps the selected week when comparing it with a named month", () => {
  const plan = resolveExplicitAnalysisPlan("Vergleiche Juni mit dieser Woche", options);

  assert.deepEqual(plan.periods.map(({ label, from, to }) => ({ label, from, to })), [
    { label: "Juni 2026", from: "2026-06-01", to: "2026-06-30" },
    { label: "Ausgewählte Woche", from: "2026-07-20", to: "2026-07-26" },
  ]);
});

test("resolves the two preceding singular weeks for a davor comparison", () => {
  const plan = resolveExplicitAnalysisPlan("Vergleiche letzte Woche mit der Woche davor", options);

  assert.deepEqual(plan.periods.map(({ label, from, to }) => ({ label, from, to })), [
    { label: "Vorherige Woche", from: "2026-07-13", to: "2026-07-19" },
    { label: "Woche davor", from: "2026-07-06", to: "2026-07-12" },
  ]);
});

test("rejects ISO week 53 when it does not exist in the requested year", () => {
  assert.throws(
    () => resolveExplicitAnalysisPlan("Was war in KW 53/2025?", options),
    /KW 53\/2025 existiert nicht/,
  );
  const valid = resolveExplicitAnalysisPlan("Was war in KW 53/2026?", {
    ...options,
    today: "2027-01-04",
  });
  assert.equal(valid.periods[0].from, "2026-12-28");
});

test("uses the selected ISO week-year for a bare calendar week", () => {
  const plan = resolveExplicitAnalysisPlan("Was war in KW 1?", {
    ...options,
    anchorWeekStart: "2025-12-29",
    today: "2026-01-04",
  });

  assert.deepEqual(plan.periods.map(({ from, to }) => ({ from, to })), [{
    from: "2025-12-29",
    to: "2026-01-04",
  }]);
});

test("uses eight weeks for an unclear weight trend and four weeks otherwise", () => {
  const weightPlan = inferDefaultAnalysisPlan("Warum habe ich zugenommen?", options);
  const generalPlan = inferDefaultAnalysisPlan("Was kann ich verbessern?", options);
  const burnedCaloriesPlan = resolveExplicitAnalysisPlan(
    "Wie viele Kalorien habe ich im Juni verbrannt?",
    options,
  );

  assert.equal(weightPlan.totalDays, 56);
  assert.equal(weightPlan.defaulted, true);
  assert.equal(weightPlan.includeDailyDetails, false);
  assert.equal(generalPlan.totalDays, 28);
  assert.equal(generalPlan.defaulted, true);
  assert.equal(generalPlan.includeDailyDetails, true);
  assert.equal(burnedCaloriesPlan.focus.includes("activity"), true);
  assert.equal(hasAnalysisTimeReference("Warum habe ich zugenommen?"), false);
  assert.equal(hasAnalysisTimeReference("Wie war es im letzten Quartal?"), true);
  assert.equal(hasUnresolvedAnalysisTimeReference("Vergleiche Juni mit dieser Woche"), false);
  assert.equal(hasUnresolvedAnalysisTimeReference("Vergleiche Januar bis März mit Juni"), false);
  assert.equal(hasUnresolvedAnalysisTimeReference("Vergleiche letzte Woche mit der Woche davor"), false);
  assert.equal(hasUnresolvedAnalysisTimeReference("Vergleiche Juni mit dem Vorjahr"), true);
  assert.equal(hasUnresolvedAnalysisTimeReference("Vergleiche gestern mit der letzten Woche"), true);
  assert.equal(hasAnalysisTimeReference("Wie war es in den letzten 3 Monaten?"), true);
  assert.equal(hasUnresolvedAnalysisTimeReference("Wie war es in den letzten 3 Monaten?"), true);
});

test("validates tool periods, total size, future dates and daily-detail limits", () => {
  const bounded = normalizeAnalysisQueryPlan({
    periods: [{ label: "Bis heute", from: "2026-07-01", to: "2026-08-31" }],
    focus: ["weight"],
    includeDailyDetails: true,
  }, options);
  assert.equal(bounded.periods[0].to, "2026-07-27");
  assert.equal(bounded.focus.includes("nutrition"), true);
  assert.equal(bounded.focus.includes("activity"), true);

  const long = normalizeAnalysisQueryPlan({
    periods: [{ label: "Lang", from: "2026-01-01", to: "2026-07-27" }],
    focus: ["nutrition"],
    includeDailyDetails: true,
  }, options);
  assert.equal(long.includeDailyDetails, false);

  assert.throws(() => normalizeAnalysisQueryPlan({
    periods: [{ label: "Zu lang", from: "2025-01-01", to: "2026-07-27" }],
    focus: ["nutrition"],
    includeDailyDetails: false,
  }, options), /366 Tage/);

  assert.throws(() => normalizeAnalysisQueryPlan({
    periods: [{ label: "Zukunft", from: "2026-08-01", to: "2026-08-31" }],
    focus: ["nutrition"],
    includeDailyDetails: false,
  }, options), /Zukunft/);
});
