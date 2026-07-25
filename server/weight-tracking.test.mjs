import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import test from "node:test";
import { normalizeGarminWeightRange } from "./garmin-service.js";

test("normalizes Garmin range weights from grams to chronological kilograms", () => {
  const result = normalizeGarminWeightRange({
    dailyWeightSummaries: [
      {
        summaryDate: "2026-07-24",
        latestWeight: { samplePk: 24, calendarDate: "2026-07-24", weight: 82450 },
      },
      {
        summaryDate: "2026-07-22",
        latestWeight: { samplePk: 22, calendarDate: "2026-07-22", weight: 83120 },
      },
      {
        summaryDate: "2026-07-23",
        latestWeight: { samplePk: 23, calendarDate: "2026-07-23", weight: 1200 },
      },
    ],
  }, "2026-07-20", "2026-07-25");

  assert.deepEqual(result.weights, [
    { date: "2026-07-22", weightKg: 83.1, source: "garmin", externalId: "22" },
    { date: "2026-07-24", weightKg: 82.5, source: "garmin", externalId: "24" },
  ]);
});

test("normalizes Garmin range weights when the API returns kilograms", () => {
  const result = normalizeGarminWeightRange({
    dailyWeightSummaries: [
      {
        summaryDate: "2026-07-24",
        latestWeight: { samplePk: 24, calendarDate: "2026-07-24", weight: 114.34 },
      },
      {
        summaryDate: "2026-07-25",
        allWeightMetrics: [
          { samplePk: 25, calendarDate: "2026-07-25", weight: 114.28 },
        ],
      },
    ],
  }, "2026-07-20", "2026-07-25");

  assert.deepEqual(result.weights, [
    { date: "2026-07-24", weightKg: 114.3, source: "garmin", externalId: "24" },
    { date: "2026-07-25", weightKg: 114.3, source: "garmin", externalId: "25" },
  ]);
});

test("normalizes Garmin day-view weight lists as a fallback payload shape", () => {
  const result = normalizeGarminWeightRange({
    startDate: "2026-07-24",
    endDate: "2026-07-24",
    dateWeightList: [
      { samplePk: 23, calendarDate: "2026-07-23", weight: 115100 },
      { samplePk: 24, calendarDate: "2026-07-24", weight: 114300 },
    ],
    totalAverage: { weight: 114400 },
  }, "2026-07-24", "2026-07-24");

  assert.deepEqual(result.weights, [
    { date: "2026-07-24", weightKg: 114.3, source: "garmin", externalId: "24" },
  ]);
});

test("persists chronological weight entries and protects manual values from Garmin", async (context) => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "food-tracker-weight-"));
  context.after(async () => {
    await rm(dataDirectory, { recursive: true });
  });
  process.env.FOOD_TRACKER_DATA_DIR = dataDirectory;

  const databaseModule = await import(`./food-db.js?weight-test=${Date.now()}`);
  databaseModule.saveAdaptiveWeightLog({
    date: "2026-07-24",
    weightKg: 82.5,
    source: "garmin",
    externalId: "garmin-24",
  });
  databaseModule.saveAdaptiveWeightLog({
    date: "2026-07-22",
    weightKg: 83.1,
    source: "garmin",
    externalId: "garmin-22",
  });
  databaseModule.saveAdaptiveWeightLog({
    date: "2026-07-24",
    weightKg: 82.4,
  });
  const skipped = databaseModule.saveAdaptiveWeightLog({
    date: "2026-07-24",
    weightKg: 82.3,
    source: "garmin",
    externalId: "garmin-new",
  });

  assert.equal(skipped.skipped, "manual-entry");
  assert.deepEqual(databaseModule.listWeightEntries().map(({ date, weightKg, source }) => ({ date, weightKg, source })), [
    { date: "2026-07-22", weightKg: 83.1, source: "garmin" },
    { date: "2026-07-24", weightKg: 82.4, source: "manual" },
  ]);
  assert.throws(
    () => databaseModule.saveAdaptiveWeightLog({ date: "2026-02-30", weightKg: 82 }),
    /Invalid weight date/,
  );
  assert.throws(
    () => databaseModule.saveAdaptiveWeightLog({ date: "2026-07-25", weightKg: 300 }),
    /Invalid weight/,
  );
});
