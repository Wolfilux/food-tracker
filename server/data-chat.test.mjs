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
  assert.deepEqual(databaseModule.parseOpenRouterModels({
    data: [
      {
        id: "provider/tool-model",
        architecture: { input_modalities: ["text"], output_modalities: ["text"] },
        supported_parameters: ["tools"],
      },
      {
        id: "provider/text-only-model",
        architecture: { input_modalities: ["text"], output_modalities: ["text"] },
        supported_parameters: [],
      },
    ],
  }, "analysis"), ["provider/tool-model"]);

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

  assert.equal(result.energyCalculation.mode, "legacy");
  assert.equal(
    result.energyCalculation.formulas.calorieTarget,
    "max(800 kcal, baseCalorieGoal + allDayActiveCalories + calorieGoalOffset)",
  );
  assert.equal(result.energyCalculation.parameters.baseCalorieGoal, 2200);
  assert.equal(result.energyCalculation.results.calorieTarget, 2200);
  assert.equal(result.energyCalculation.results.estimatedEnergyBalanceCalories, undefined);
  assert.match(result.energyCalculation.uncertainties[0], /Basisziel ist nicht automatisch BMR, TDEE/);
  assert.equal(result.dataPresence.entryCount, 2);
  assert.equal(result.dataPresence.weightCount, 2);
  assert.equal(result.periods[0].summary.loggedDays, 2);
  assert.equal(result.periods[0].summary.weight.changeKg, -0.5);
  assert.equal(result.periods[0].summary.averagesPerLoggedDay.currentBenchmarkDaysMissing, 0);
  assert.equal(result.goal.basis, "current_configuration");
  assert.equal(result.goal.historicalGoalHistoryAvailable, false);
  assert.equal(result.periods[0].dataCoverage.garmin.status, "not_configured");
  assert.equal(result.periods[0].summary.activity.daysAvailable, 0);
  assert.equal(result.periods[0].summary.activity.daysMissing, 7);
  assert.equal(result.periods[0].dataCoverage.garmin.dailySummariesAvailable, 0);
  assert.equal(result.periods[0].dataCoverage.garmin.dailySummariesMissing, 7);
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

  const originalAdaptiveProfile = databaseModule.getAdaptiveGoalProfile();
  databaseModule.saveAdaptiveGoalProfile({
    ...originalAdaptiveProfile,
    enabled: true,
    garminEnabled: false,
    manualOverrideCalories: 1750,
  });
  const adaptiveBenchmarkContext = databaseModule.buildAnalysisDataContext(plan, { userKey: "default" });
  assert.equal(adaptiveBenchmarkContext.periods[0].summary.averagesPerLoggedDay.currentCalorieBenchmark, 1750);
  assert.equal(adaptiveBenchmarkContext.periods[0].days[0].currentCalorieBenchmark, 1750);
  databaseModule.saveAdaptiveGoalProfile({
    ...originalAdaptiveProfile,
    enabled: false,
    manualOverrideCalories: 0,
  });
  databaseModule.getFoodDatabase()
    .prepare("DELETE FROM adaptive_weight_logs WHERE date = ?")
    .run("2026-07-27");

  const partialWeekPlan = normalizeAnalysisQueryPlan({
    periods: [{ label: "Teilwochen", from: "2026-06-10", to: "2026-06-16" }],
    focus: ["nutrition"],
    includeDailyDetails: false,
  }, {
    anchorWeekStart: "2026-06-08",
    today: "2026-07-27",
  });
  const partialWeekContext = databaseModule.buildAnalysisDataContext(partialWeekPlan, { userKey: "default" });
  assert.deepEqual(
    partialWeekContext.periods[0].weeks.map(({ weekStart, weekEnd }) => ({ weekStart, weekEnd })),
    [
      { weekStart: "2026-06-10", weekEnd: "2026-06-14" },
      { weekStart: "2026-06-15", weekEnd: "2026-06-16" },
    ],
  );

  databaseModule.saveGarminConfig({
    username: "tracker@example.com",
    authValue: "test-session",
    autoSyncMinutes: 0,
  });
  const missingGarminContext = databaseModule.buildAnalysisDataContext(plan, { userKey: "default" });
  const missingGarminEnergy = databaseModule.buildEnergyCalculationContext("2026-06-09");
  assert.equal(missingGarminEnergy.garmin.configured, true);
  assert.equal(missingGarminEnergy.results.targetAvailable, false);
  assert.equal(missingGarminEnergy.results.calorieTarget, undefined);
  assert.equal(missingGarminContext.periods[0].dataCoverage.garmin.status, "configured");
  assert.deepEqual(missingGarminContext.periods[0].dataCoverage.garmin.activityWeeksMissing, ["2026-06-08"]);
  assert.equal(missingGarminContext.periods[0].summary.activity.daysMissing, 7);
  assert.equal(missingGarminContext.periods[0].summary.averagesPerLoggedDay.currentBenchmarkDaysAvailable, 0);
  assert.equal(missingGarminContext.periods[0].summary.averagesPerLoggedDay.currentBenchmarkDaysMissing, 2);
  assert.equal(missingGarminContext.periods[0].days[0].currentCalorieBenchmarkAvailable, false);

  databaseModule.getFoodDatabase().prepare([
    "INSERT OR REPLACE INTO garmin_daily_summary (date, summary_json, fetched_at)",
    "VALUES (?, ?, ?)",
  ].join("\n")).run(
    "2026-06-08",
    JSON.stringify({ date: "2026-06-08", configured: true, error: "Garmin sync failed" }),
    "2026-06-09T00:00:00.000Z",
  );
  const failedSummaryContext = databaseModule.buildAnalysisDataContext(plan, { userKey: "default" });
  assert.equal(failedSummaryContext.periods[0].dataCoverage.garmin.dailySummariesAvailable, 0);
  assert.equal(failedSummaryContext.periods[0].dataCoverage.garmin.dailySummariesMissing, 7);
  assert.equal(failedSummaryContext.periods[0].summary.activity.daysAvailable, 0);
  assert.equal(
    failedSummaryContext.periods[0].summary.averagesPerLoggedDay.currentBenchmarkDaysAvailable,
    0,
  );
  assert.equal(failedSummaryContext.periods[0].days[0].currentCalorieBenchmarkAvailable, false);

  databaseModule.getFoodDatabase().prepare([
    "INSERT OR REPLACE INTO garmin_daily_summary (date, summary_json, fetched_at)",
    "VALUES (?, ?, ?)",
  ].join("\n")).run(
    "2026-06-08",
    JSON.stringify({ date: "2026-06-08", configured: true, activeKilocalories: 500, steps: 8500 }),
    "2026-06-09T00:00:00.000Z",
  );
  const partialTargetContext = databaseModule.buildAnalysisDataContext(plan, { userKey: "default" });
  const partialTargetAverages = partialTargetContext.periods[0].summary.averagesPerLoggedDay;
  assert.equal(partialTargetAverages.currentBenchmarkDaysAvailable, 1);
  assert.equal(partialTargetAverages.currentBenchmarkDaysMissing, 1);
  assert.equal("currentCalorieBenchmark" in partialTargetAverages, false);
  assert.equal("currentProteinBenchmark" in partialTargetAverages, false);
  assert.equal("currentCarbsBenchmark" in partialTargetAverages, false);
  assert.equal("currentFatBenchmark" in partialTargetAverages, false);

  const dailySummaryActivityPlan = normalizeAnalysisQueryPlan({
    periods: [{ label: "Garmin-Tagessummary", from: "2026-06-08", to: "2026-06-14" }],
    focus: ["activity"],
    includeDailyDetails: true,
  }, {
    anchorWeekStart: "2026-06-08",
    today: "2026-07-27",
  });
  const dailySummaryActivityContext = databaseModule.buildAnalysisDataContext(
    dailySummaryActivityPlan,
    { userKey: "default" },
  );
  assert.equal(dailySummaryActivityContext.dataPresence.activityCount, 0);
  assert.equal(dailySummaryActivityContext.dataPresence.activityDaysAvailable, 1);
  assert.equal(dailySummaryActivityContext.dataPresence.hasAnyData, true);
  assert.equal("entryCount" in dailySummaryActivityContext.dataPresence, false);
  assert.equal("weightCount" in dailySummaryActivityContext.dataPresence, false);
  assert.equal("entryCount" in dailySummaryActivityContext.periods[0].dataCoverage, false);
  assert.equal("weightCount" in dailySummaryActivityContext.periods[0].dataCoverage, false);
  assert.equal("firstEntryDate" in dailySummaryActivityContext.periods[0].dataCoverage, false);
  assert.equal("lastEntryDate" in dailySummaryActivityContext.periods[0].dataCoverage, false);
  assert.equal(dailySummaryActivityContext.periods[0].summary.activity.workoutCalories, 0);
  assert.equal(dailySummaryActivityContext.periods[0].summary.activity.allDayActiveCalories, 500);
  assert.equal(
    dailySummaryActivityContext.periods[0].summary.activity.allDayActiveCaloriesDaysAvailable,
    1,
  );
  assert.equal(dailySummaryActivityContext.periods[0].summary.activity.steps, 8500);
  assert.equal(dailySummaryActivityContext.periods[0].summary.activity.daysMissing, 6);
  assert.equal(dailySummaryActivityContext.periods[0].days[0].workoutCalories, 0);
  assert.equal(dailySummaryActivityContext.periods[0].days[0].allDayActiveCalories, 500);
  assert.equal(dailySummaryActivityContext.periods[0].days[0].activitySteps, 8500);

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

  databaseModule.getFoodDatabase().prepare([
    "INSERT INTO garmin_week_activities (week_start, week_end, activities_json, fetched_at)",
    "VALUES (?, ?, ?, ?)",
  ].join("\n")).run(
    "2026-06-15",
    "2026-06-21",
    JSON.stringify([{
      date: "2026-06-18",
      activityName: "Lauf",
      calories: 300,
      durationSeconds: 3600,
    }]),
    "2026-06-18T12:00:00.000Z",
  );
  databaseModule.getFoodDatabase().prepare([
    "INSERT OR REPLACE INTO garmin_daily_summary (date, summary_json, fetched_at)",
    "VALUES (?, ?, ?)",
  ].join("\n")).run(
    "2026-06-18",
    JSON.stringify({ date: "2026-06-18", configured: true, activeKilocalories: 550, steps: 9200 }),
    "2026-06-18T23:00:00.000Z",
  );
  const partialActivityCachePlan = normalizeAnalysisQueryPlan({
    periods: [{ label: "Teilweise Garmin-Woche", from: "2026-06-15", to: "2026-06-21" }],
    focus: ["activity"],
    includeDailyDetails: true,
  }, {
    anchorWeekStart: "2026-06-15",
    today: "2026-07-27",
  });
  const partialActivityCacheContext = databaseModule.buildAnalysisDataContext(
    partialActivityCachePlan,
    { userKey: "default" },
  );
  assert.equal(partialActivityCacheContext.periods[0].summary.activity.daysAvailable, 4);
  assert.equal(partialActivityCacheContext.periods[0].summary.activity.daysMissing, 3);
  assert.equal(partialActivityCacheContext.periods[0].summary.activity.count, 1);
  assert.equal(partialActivityCacheContext.periods[0].summary.activity.workoutCalories, 300);
  assert.equal(partialActivityCacheContext.periods[0].summary.activity.allDayActiveCalories, 550);
  assert.equal(
    partialActivityCacheContext.periods[0].summary.activity.allDayActiveCaloriesDaysAvailable,
    1,
  );
  assert.equal(partialActivityCacheContext.periods[0].days[3].workoutCalories, 300);
  assert.equal(partialActivityCacheContext.periods[0].days[3].allDayActiveCalories, 550);
  assert.deepEqual(
    partialActivityCacheContext.periods[0].dataCoverage.garmin.activityWeeksPartial,
    ["2026-06-15"],
  );

  databaseModule.saveAdaptiveGoalProfile({
    ...originalAdaptiveProfile,
    enabled: true,
    garminEnabled: true,
    age: 40,
    sex: "male",
    heightCm: 180,
    currentWeightKg: 82,
    targetWeightKg: 75,
    weeklyLossKg: 0.5,
    activityLevel: "light",
    manualOverrideCalories: 0,
  });
  const adaptiveEnergy = databaseModule.buildEnergyCalculationContext("2026-06-18");
  assert.equal(adaptiveEnergy.mode, "adaptive");
  assert.equal(adaptiveEnergy.garmin.allDayActiveCalories, 550);
  assert.equal(adaptiveEnergy.garmin.workoutCalories, 300);
  assert.equal(adaptiveEnergy.results.activityStrategy, "garmin-active-calories");
  assert.equal(adaptiveEnergy.results.activityAdjustment, 550);
  assert.equal(
    adaptiveEnergy.results.recommendedToday,
    adaptiveEnergy.results.basisTarget + adaptiveEnergy.results.activityAdjustment,
  );
  assert.equal(
    adaptiveEnergy.results.estimatedMaintenanceToday,
    adaptiveEnergy.results.maintenance + adaptiveEnergy.results.activityAdjustment,
  );
  assert.match(adaptiveEnergy.garmin.doubleCountingRule, /nie addieren/);
  assert.equal(adaptiveEnergy.parameters.targetWeightKg, 75);
  assert.match(adaptiveEnergy.parameters.targetWeightRole, /nicht direkt/);

  const adaptiveFallbackEnergy = databaseModule.buildEnergyCalculationContext("2026-06-17");
  assert.equal(adaptiveFallbackEnergy.results.maintenanceSource, "initial_tdee_fallback");
  assert.equal(adaptiveFallbackEnergy.results.activityStrategy, "steps-plus-workouts");
  assert.equal(adaptiveFallbackEnergy.results.activityAdjustment, 0);
  assert.equal(adaptiveFallbackEnergy.adaptiveMaintenanceEvidence.available, false);
  assert.match(adaptiveFallbackEnergy.fallbacks.join(" "), /mindestens 14 Tage/);
  databaseModule.saveAdaptiveGoalProfile({
    ...originalAdaptiveProfile,
    enabled: false,
    manualOverrideCalories: 0,
  });
  databaseModule.getFoodDatabase()
    .prepare("DELETE FROM adaptive_weight_logs WHERE date = ?")
    .run("2026-07-27");

  const emptyNutritionPlan = normalizeAnalysisQueryPlan({
    periods: [{ label: "Ohne Logs", from: "2026-05-11", to: "2026-05-17" }],
    focus: ["nutrition"],
    includeDailyDetails: false,
  }, {
    anchorWeekStart: "2026-05-11",
    today: "2026-07-27",
  });
  const emptyNutritionContext = databaseModule.buildAnalysisDataContext(emptyNutritionPlan, { userKey: "default" });
  assert.equal(emptyNutritionContext.dataPresence.goalDataAvailable, false);
  assert.equal(emptyNutritionContext.dataPresence.hasAnyData, false);

  const goalOnlyPlan = normalizeAnalysisQueryPlan({
    periods: [{ label: "Ohne Logs", from: "2026-05-11", to: "2026-05-17" }],
    focus: ["goals"],
    includeDailyDetails: false,
  }, {
    anchorWeekStart: "2026-05-11",
    today: "2026-07-27",
  });
  const goalOnlyContext = databaseModule.buildAnalysisDataContext(goalOnlyPlan, { userKey: "default" });
  assert.equal("entryCount" in goalOnlyContext.dataPresence, false);
  assert.equal("weightCount" in goalOnlyContext.dataPresence, false);
  assert.equal("activityCount" in goalOnlyContext.dataPresence, false);
  assert.equal("entryCount" in goalOnlyContext.periods[0].dataCoverage, false);
  assert.equal("weightCount" in goalOnlyContext.periods[0].dataCoverage, false);
  assert.equal("activityCount" in goalOnlyContext.periods[0].dataCoverage, false);
  assert.equal("garmin" in goalOnlyContext.periods[0].dataCoverage, false);
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
  const requestBodies = [];
  globalThis.fetch = async (_url, options) => {
    const requestBody = JSON.parse(String(options?.body ?? "{}"));
    requestBodies.push(requestBody);
    if (requestBody.tools) {
      const followUpQuestion = requestBody.messages.at(-1)?.content ?? "";
      const periods = followUpQuestion.includes("Vergleich zur letzten Woche")
        ? [
          { label: "Juni 2026", from: "2026-06-01", to: "2026-06-30" },
          { label: "Vorherige Woche", from: "2026-07-13", to: "2026-07-19" },
        ]
        : followUpQuestion.includes("Vormonat")
        ? [{ label: "Vormonat", from: "2026-06-01", to: "2026-06-30" }]
        : followUpQuestion.includes("Vorwoche")
        ? [{ label: "Vorwoche", from: "2026-07-13", to: "2026-07-19" }]
        : followUpQuestion.includes("besser als letzte Woche")
        ? [
          { label: "Juni 2026", from: "2026-06-01", to: "2026-06-30" },
          { label: "Vorherige Woche", from: "2026-07-13", to: "2026-07-19" },
        ]
        : followUpQuestion.includes("gegenüber letzter Woche")
        ? [
          { label: "Juni 2026", from: "2026-06-01", to: "2026-06-30" },
          { label: "Vorherige Woche", from: "2026-07-13", to: "2026-07-19" },
        ]
        : followUpQuestion.includes("Vergleiche mit letzter Woche")
        ? [
          { label: "Ausgewählte Woche", from: "2026-07-20", to: "2026-07-26" },
          { label: "Vorherige Woche", from: "2026-07-13", to: "2026-07-19" },
        ]
        : followUpQuestion.includes("Vergleiche mit Mai")
        ? [
          { label: "Juni 2026", from: "2026-06-01", to: "2026-06-30" },
          { label: "Mai 2026", from: "2026-05-01", to: "2026-05-31" },
        ]
        : followUpQuestion.includes("letzten 4 Wochen")
        ? [
          { label: "Juni 2026", from: "2026-06-01", to: "2026-06-30" },
          { label: "Letzte 4 Wochen", from: "2026-06-29", to: "2026-07-26" },
        ]
        : [{ label: "Juni 2026", from: "2026-06-01", to: "2026-06-30" }];
      return new globalThis.Response(JSON.stringify({
        choices: [{
          message: {
            tool_calls: [{
              type: "function",
              function: {
                name: "query_tracker_data",
                arguments: JSON.stringify({
                  periods,
                  focus: ["nutrition", "weight"],
                  includeDailyDetails: true,
                }),
              },
            }],
          },
        }],
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
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
    const prompt = requestBodies.at(-1).messages.at(-1).content;
    assert.match(prompt, /Skyr mit Beeren/);
    assert.equal(prompt.includes("Nicht im Zeitraum"), false);
    assert.equal(prompt.includes("another-user"), false);

    requestBodies.length = 0;
    await databaseModule.answerAnalysisQuestion({
      question: "Wie wird mein Defizit berechnet?",
      weekStart: "2026-07-20",
      history: [],
    }, { userKey: "default" });
    assert.equal(requestBodies.length, 1);
    assert.match(requestBodies[0].messages[0].content, /Unterscheide Zieldefizit/);
    assert.match(requestBodies[0].messages[0].content, /workoutCalories niemals zu allDayActiveCalories/);
    assert.match(requestBodies[0].messages.at(-1).content, /"energyCalculation"/);
    assert.match(requestBodies[0].messages.at(-1).content, /"physiologicalDeficit"/);

    requestBodies.length = 0;
    await databaseModule.answerAnalysisQuestion({
      question: "Welche Annahmen nutzt du?",
      weekStart: "2026-07-20",
      history: [],
    }, { userKey: "default" });
    assert.equal(requestBodies.length, 1);
    assert.match(requestBodies[0].messages.at(-1).content, /"universalAssumptions"/);
    assert.match(requestBodies[0].messages.at(-1).content, /"fallbacks"/);
    assert.match(requestBodies[0].messages.at(-1).content, /"uncertainties"/);

    requestBodies.length = 0;
    const explicitQuestionWithArticle = await databaseModule.answerAnalysisQuestion({
      question: "Wie war das Gewicht im Juni?",
      weekStart: "2026-07-20",
      history: [
        { role: "user", content: "Wie war meine Ernährung im Mai?" },
        { role: "assistant", content: "Ausgewerteter Zeitraum: Mai 2026" },
      ],
    }, { userKey: "default" });

    assert.equal(requestBodies.length, 1);
    assert.equal("tools" in requestBodies[0], false);
    assert.equal(explicitQuestionWithArticle.period.periods[0].from, "2026-06-01");
    assert.equal(explicitQuestionWithArticle.period.periods[0].to, "2026-06-30");

    requestBodies.length = 0;
    const previousYearMonth = await databaseModule.answerAnalysisQuestion({
      question: "Wie war meine Ernährung im Juni letzten Jahres?",
      weekStart: "2026-07-20",
      history: [],
    }, { userKey: "default" });

    assert.equal(requestBodies.length, 0);
    assert.equal(previousYearMonth.period.periods[0].from, "2025-06-01");
    assert.equal(previousYearMonth.period.periods[0].to, "2025-06-30");

    requestBodies.length = 0;
    const explicitComparisonWithArticle = await databaseModule.answerAnalysisQuestion({
      question: "Vergleiche das Gewicht im Juni mit Mai",
      weekStart: "2026-07-20",
      history: [
        { role: "user", content: "Wie war meine Ernährung im April?" },
        { role: "assistant", content: "Ausgewerteter Zeitraum: April 2026" },
      ],
    }, { userKey: "default" });

    assert.equal(requestBodies.length, 1);
    assert.equal("tools" in requestBodies[0], false);
    assert.deepEqual(explicitComparisonWithArticle.period.periods.map(({ from, to }) => ({ from, to })), [
      { from: "2026-06-01", to: "2026-06-30" },
      { from: "2026-05-01", to: "2026-05-31" },
    ]);

    requestBodies.length = 0;
    const followUp = await databaseModule.answerAnalysisQuestion({
      question: "Und im Vergleich dazu?",
      weekStart: "2026-07-20",
      history: [
        { role: "user", content: "Wie war meine Ernährung im Juni?" },
        { role: "assistant", content: answer.answer },
      ],
    }, { userKey: "default" });

    assert.equal(requestBodies.length, 2);
    assert.equal(Array.isArray(requestBodies[0].tools), true);
    assert.match(requestBodies[0].messages.at(-2).content, /Ausgewerteter Zeitraum: Juni 2026/);
    assert.match(requestBodies[0].tools[0].function.description, /2026-05-04 bis 2026-07-01/);
    assert.equal(followUp.period.periods[0].from, "2026-06-01");
    assert.equal(followUp.period.defaulted, false);

    requestBodies.length = 0;
    const implicitComparison = await databaseModule.answerAnalysisQuestion({
      question: "Vergleiche mit Mai",
      weekStart: "2026-07-20",
      history: [
        { role: "user", content: "Wie war meine Ernährung im Juni?" },
        { role: "assistant", content: answer.answer },
      ],
    }, { userKey: "default" });

    assert.equal(requestBodies.length, 2);
    assert.equal(Array.isArray(requestBodies[0].tools), true);
    assert.deepEqual(implicitComparison.period.periods.map(({ from, to }) => ({ from, to })), [
      { from: "2026-06-01", to: "2026-06-30" },
      { from: "2026-05-01", to: "2026-05-31" },
    ]);

    requestBodies.length = 0;
    const standaloneComparison = await databaseModule.answerAnalysisQuestion({
      question: "Vergleiche mit letzter Woche",
      weekStart: "2026-07-20",
      history: [],
    }, { userKey: "default" });

    assert.equal(requestBodies.length, 1);
    assert.equal(Array.isArray(requestBodies[0].tools), true);
    assert.deepEqual(standaloneComparison.period.periods.map(({ from, to }) => ({ from, to })), [
      { from: "2026-07-20", to: "2026-07-26" },
      { from: "2026-07-13", to: "2026-07-19" },
    ]);

    requestBodies.length = 0;
    const conversationalComparison = await databaseModule.answerAnalysisQuestion({
      question: "Wie ist das im Vergleich zur letzten Woche?",
      weekStart: "2026-07-20",
      history: [
        { role: "user", content: "Wie war meine Ernährung im Juni?" },
        { role: "assistant", content: answer.answer },
      ],
    }, { userKey: "default" });

    assert.equal(requestBodies.length, 2);
    assert.equal(Array.isArray(requestBodies[0].tools), true);
    assert.deepEqual(conversationalComparison.period.periods.map(({ from, to }) => ({ from, to })), [
      { from: "2026-06-01", to: "2026-06-30" },
      { from: "2026-07-13", to: "2026-07-19" },
    ]);

    requestBodies.length = 0;
    const gegenueberComparison = await databaseModule.answerAnalysisQuestion({
      question: "Wie ist das gegenüber letzter Woche?",
      weekStart: "2026-07-20",
      history: [
        { role: "user", content: "Wie war meine Ernährung im Juni?" },
        { role: "assistant", content: answer.answer },
      ],
    }, { userKey: "default" });

    assert.equal(requestBodies.length, 2);
    assert.equal(Array.isArray(requestBodies[0].tools), true);
    assert.deepEqual(gegenueberComparison.period.periods.map(({ from, to }) => ({ from, to })), [
      { from: "2026-06-01", to: "2026-06-30" },
      { from: "2026-07-13", to: "2026-07-19" },
    ]);

    requestBodies.length = 0;
    const adjectiveComparison = await databaseModule.answerAnalysisQuestion({
      question: "War das besser als letzte Woche?",
      weekStart: "2026-07-20",
      history: [
        { role: "user", content: "Wie war meine Ernährung im Juni?" },
        { role: "assistant", content: answer.answer },
      ],
    }, { userKey: "default" });

    assert.equal(requestBodies.length, 2);
    assert.equal(Array.isArray(requestBodies[0].tools), true);
    assert.deepEqual(adjectiveComparison.period.periods.map(({ from, to }) => ({ from, to })), [
      { from: "2026-06-01", to: "2026-06-30" },
      { from: "2026-07-13", to: "2026-07-19" },
    ]);

    requestBodies.length = 0;
    const previousMonthQuestion = await databaseModule.answerAnalysisQuestion({
      question: "Was habe ich im Vormonat gegessen?",
      weekStart: "2026-07-20",
      history: [],
    }, { userKey: "default" });

    assert.equal(requestBodies.length, 2);
    assert.equal(Array.isArray(requestBodies[0].tools), true);
    assert.equal(previousMonthQuestion.period.periods[0].from, "2026-06-01");
    assert.equal(previousMonthQuestion.period.periods[0].to, "2026-06-30");

    requestBodies.length = 0;
    const previousWeekQuestion = await databaseModule.answerAnalysisQuestion({
      question: "Wie war die Vorwoche?",
      weekStart: "2026-07-20",
      history: [],
    }, { userKey: "default" });

    assert.equal(requestBodies.length, 1);
    assert.equal(Array.isArray(requestBodies[0].tools), true);
    assert.equal(previousWeekQuestion.period.periods[0].from, "2026-07-13");
    assert.equal(previousWeekQuestion.period.periods[0].to, "2026-07-19");

    requestBodies.length = 0;
    const explicitFollowUp = await databaseModule.answerAnalysisQuestion({
      question: "Vergleiche das mit den letzten 4 Wochen",
      weekStart: "2026-07-20",
      history: [
        { role: "user", content: "Wie war meine Ernährung im Juni?" },
        { role: "assistant", content: answer.answer },
      ],
    }, { userKey: "default" });

    assert.equal(requestBodies.length, 2);
    assert.equal(Array.isArray(requestBodies[0].tools), true);
    assert.deepEqual(explicitFollowUp.period.periods.map(({ from, to }) => ({ from, to })), [
      { from: "2026-06-01", to: "2026-06-30" },
      { from: "2026-06-29", to: "2026-07-26" },
    ]);

    requestBodies.length = 0;
    await databaseModule.answerAnalysisQuestion({
      question: "Vergleiche Juni mit dem Vorjahr",
      weekStart: "2026-07-20",
      history: [],
    }, { userKey: "default" });
    assert.equal(requestBodies.length, 2);
    assert.equal(Array.isArray(requestBodies[0].tools), true);

    let fallbackRequestCount = 0;
    globalThis.fetch = async (_url, options) => {
      fallbackRequestCount += 1;
      const requestBody = JSON.parse(String(options?.body ?? "{}"));
      if (requestBody.tools) {
        return new globalThis.Response(JSON.stringify({
          choices: [{ message: { content: "" } }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (fallbackRequestCount === 2) {
        return new globalThis.Response(JSON.stringify({
          choices: [{
            message: {
              content: JSON.stringify({
                periods: [{ label: "Gestern", from: "2026-07-26", to: "2026-07-26" }],
                focus: ["nutrition"],
                includeDailyDetails: true,
              }),
            },
          }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new globalThis.Response(JSON.stringify({
        choices: [{ message: { content: "Für gestern liegen keine Einträge vor." } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const textFallbackAnswer = await databaseModule.answerAnalysisQuestion({
      question: "Was habe ich gestern gegessen?",
      weekStart: "2026-07-20",
      history: [],
    }, { userKey: "default" });
    assert.equal(fallbackRequestCount, 2);
    assert.equal(textFallbackAnswer.period.periods[0].from, "2026-07-26");
    assert.match(textFallbackAnswer.answer, /keine Ernährungs-, Gewichts- oder Aktivitätsdaten/);

    globalThis.fetch = async () => new globalThis.Response(JSON.stringify({
      choices: [{ message: { content: "" } }],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    await assert.rejects(
      () => databaseModule.answerAnalysisQuestion({
        question: "Was habe ich gestern gegessen?",
        weekStart: "2026-07-20",
        history: [],
      }, { userKey: "default" }),
      /Zeitraum konnte nicht sicher aufgelöst/,
    );
    await assert.rejects(
      () => databaseModule.answerAnalysisQuestion({
        question: "Wie war Juni?",
        weekStart: "2026-07-20",
        history: [],
      }, { userKey: "default" }),
      /Zeitraum konnte nicht sicher aufgelöst/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
