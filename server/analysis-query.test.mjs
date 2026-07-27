import assert from "node:assert/strict";
import test from "node:test";
import {
  hasAnalysisTimeReference,
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

test("keeps intervening months in a continuous named-month range", () => {
  const plan = resolveExplicitAnalysisPlan("Wie lief es von Januar bis März?", options);

  assert.deepEqual(plan.periods.map(({ label, from, to }) => ({ label, from, to })), [{
    label: "Januar 2026 bis März 2026",
    from: "2026-01-01",
    to: "2026-03-31",
  }]);
});

test("resolves since January without exceeding the annual query limit", () => {
  const plan = resolveExplicitAnalysisPlan("Wie hat sich mein Gewicht seit Januar entwickelt?", options);

  assert.deepEqual(plan.periods.map(({ from, to }) => ({ from, to })), [{
    from: "2026-01-01",
    to: "2026-07-26",
  }]);
  assert.equal(plan.focus.includes("weight"), true);
  assert.equal(plan.focus.includes("nutrition"), true);
  assert.equal(plan.focus.includes("activity"), true);
  assert.equal(plan.includeDailyDetails, false);
});

test("resolves selected and previous weeks as separate comparison periods", () => {
  const plan = resolveExplicitAnalysisPlan("Vergleiche diese Woche mit der letzten Woche", options);

  assert.deepEqual(plan.periods.map(({ label, from, to }) => ({ label, from, to })), [
    { label: "Ausgewählte Woche", from: "2026-07-20", to: "2026-07-26" },
    { label: "Vorherige Woche", from: "2026-07-13", to: "2026-07-19" },
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

test("uses eight weeks for an unclear weight trend and four weeks otherwise", () => {
  const weightPlan = inferDefaultAnalysisPlan("Warum habe ich zugenommen?", options);
  const generalPlan = inferDefaultAnalysisPlan("Was kann ich verbessern?", options);

  assert.equal(weightPlan.totalDays, 56);
  assert.equal(weightPlan.defaulted, true);
  assert.equal(weightPlan.includeDailyDetails, false);
  assert.equal(generalPlan.totalDays, 28);
  assert.equal(generalPlan.defaulted, true);
  assert.equal(generalPlan.includeDailyDetails, true);
  assert.equal(hasAnalysisTimeReference("Warum habe ich zugenommen?"), false);
  assert.equal(hasAnalysisTimeReference("Wie war es im letzten Quartal?"), true);
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
