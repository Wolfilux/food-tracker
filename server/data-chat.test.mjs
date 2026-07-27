import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import test from "node:test";
import { normalizeAnalysisQueryPlan } from "./analysis-query.js";

test("builds bounded server-side aggregates and rejects a foreign user scope", async (context) => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "food-tracker-data-chat-"));
  process.env.FOOD_TRACKER_DATA_DIR = dataDirectory;
  context.after(async () => {
    delete process.env.FOOD_TRACKER_DATA_DIR;
    await rm(dataDirectory, { recursive: true, force: true });
  });
  const databaseModule = await import(`./food-db.js?data-chat-test=${Date.now()}`);

  databaseModule.createEntry({
    foodName: "Skyr mit Beeren",
    quantityValue: 250,
    quantityUnit: "g",
    caloriesPer100g: 90,
    proteinPer100g: 11,
    carbsPer100g: 6,
    fatPer100g: 1,
    consumedAt: "2026-06-08T08:15",
  });
  databaseModule.createEntry({
    foodName: "Pizza",
    quantityValue: 400,
    quantityUnit: "g",
    caloriesPer100g: 250,
    proteinPer100g: 10,
    carbsPer100g: 30,
    fatPer100g: 10,
    consumedAt: "2026-06-14T21:45",
  });
  databaseModule.createEntry({
    foodName: "Nicht im Zeitraum",
    quantityValue: 100,
    quantityUnit: "g",
    caloriesPer100g: 100,
    consumedAt: "2026-07-01T12:00",
  });
  databaseModule.saveAdaptiveWeightLog({ date: "2026-06-08", weightKg: 82.4 });
  databaseModule.saveAdaptiveWeightLog({ date: "2026-06-14", weightKg: 81.9 });

  const plan = normalizeAnalysisQueryPlan({
    periods: [{ label: "Testwoche", from: "2026-06-08", to: "2026-06-14" }],
    focus: ["nutrition", "weight", "habits"],
    includeDailyDetails: true,
  }, {
    anchorWeekStart: "2026-06-08",
    today: "2026-07-27",
  });
  const result = databaseModule.buildAnalysisDataContext(plan, { userKey: "default" });

  assert.equal(result.dataPresence.entryCount, 2);
  assert.equal(result.dataPresence.weightCount, 2);
  assert.equal(result.periods[0].summary.loggedDays, 2);
  assert.equal(result.periods[0].summary.weight.changeKg, -0.5);
  assert.equal(result.periods[0].summary.averagesPerLoggedDay.targetDaysMissing, 0);
  assert.equal(result.periods[0].dataCoverage.garmin.status, "not_configured");
  assert.equal(result.periods[0].summary.activity.daysAvailable, 0);
  assert.equal(result.periods[0].summary.activity.daysMissing, 7);
  assert.equal(result.periods[0].days.length, 7);
  assert.deepEqual(
    result.periods[0].foodPatterns.topFoods.map((food) => food.name).sort(),
    ["Pizza", "Skyr mit Beeren"],
  );
  assert.equal(JSON.stringify(result).includes("Nicht im Zeitraum"), false);
  assert.throws(
    () => databaseModule.buildAnalysisDataContext(plan, { userKey: "another-user" }),
    /Unzulässiger Datenbereich/,
  );

  databaseModule.saveGarminConfig({
    username: "tracker@example.com",
    authValue: "test-session",
    autoSyncMinutes: 0,
  });
  const missingGarminContext = databaseModule.buildAnalysisDataContext(plan, { userKey: "default" });
  assert.equal(missingGarminContext.periods[0].dataCoverage.garmin.status, "configured");
  assert.deepEqual(missingGarminContext.periods[0].dataCoverage.garmin.activityWeeksMissing, ["2026-06-08"]);
  assert.equal(missingGarminContext.periods[0].summary.activity.daysMissing, 7);
  assert.equal(missingGarminContext.periods[0].summary.averagesPerLoggedDay.targetDaysAvailable, 0);
  assert.equal(missingGarminContext.periods[0].summary.averagesPerLoggedDay.targetDaysMissing, 2);
  assert.equal(missingGarminContext.periods[0].days[0].calorieTargetAvailable, false);

  databaseModule.getFoodDatabase().prepare([
    "INSERT INTO garmin_week_activities (week_start, week_end, activities_json, fetched_at)",
    "VALUES (?, ?, ?, ?)",
  ].join("\n")).run("2026-05-04", "2026-05-10", "[]", "2026-05-11T00:00:00.000Z");
  const emptyActivityPlan = normalizeAnalysisQueryPlan({
    periods: [{ label: "Leere Garmin-Woche", from: "2026-05-04", to: "2026-05-10" }],
    focus: ["activity"],
    includeDailyDetails: true,
  }, {
    anchorWeekStart: "2026-05-04",
    today: "2026-07-27",
  });
  const emptyActivityContext = databaseModule.buildAnalysisDataContext(emptyActivityPlan, { userKey: "default" });
  assert.equal(emptyActivityContext.dataPresence.activityCount, 0);
  assert.equal(emptyActivityContext.dataPresence.activityDaysAvailable, 7);
  assert.equal(emptyActivityContext.dataPresence.hasAnyData, true);

  const goalOnlyPlan = normalizeAnalysisQueryPlan({
    periods: [{ label: "Ohne Logs", from: "2026-05-11", to: "2026-05-17" }],
    focus: ["goals"],
    includeDailyDetails: false,
  }, {
    anchorWeekStart: "2026-05-11",
    today: "2026-07-27",
  });
  const goalOnlyContext = databaseModule.buildAnalysisDataContext(goalOnlyPlan, { userKey: "default" });
  assert.equal(goalOnlyContext.dataPresence.entryCount, 0);
  assert.equal(goalOnlyContext.dataPresence.goalDataAvailable, true);
  assert.equal(goalOnlyContext.dataPresence.hasAnyData, true);
  assert.equal(goalOnlyContext.goal.baseCalorieGoal, 2200);

  databaseModule.saveAiConfig({
    provider: "openai",
    model: "gpt-4o-mini",
    apiKey: "sk-test-data-chat",
  });
  databaseModule.saveAnalysisAiConfig({
    provider: "openai",
    model: "gpt-4o-mini",
  });
  const originalFetch = globalThis.fetch;
  let requestBody;
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(String(options?.body ?? "{}"));
    return new globalThis.Response(JSON.stringify({
      choices: [{ message: { content: "Im Juni sind zwei protokollierte Tage vorhanden." } }],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const answer = await databaseModule.answerAnalysisQuestion({
      question: "Wie war meine Ernährung im Juni?",
      weekStart: "2026-07-20",
      history: [],
      userKey: "another-user",
    }, { userKey: "default" });

    assert.match(answer.answer, /^Ausgewerteter Zeitraum: Juni 2026:/);
    assert.equal(answer.period.periods[0].from, "2026-06-01");
    assert.equal(answer.period.periods[0].to, "2026-06-30");
    assert.equal(answer.period.defaulted, false);
    const prompt = requestBody.messages.at(-1).content;
    assert.match(prompt, /Skyr mit Beeren/);
    assert.equal(prompt.includes("Nicht im Zeitraum"), false);
    assert.equal(prompt.includes("another-user"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
