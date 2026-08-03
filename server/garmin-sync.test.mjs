import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import test from "node:test";
import { withGarminRetry } from "./garmin-service.js";

test("Garmin retries transient timeouts with a bounded backoff", async () => {
  let attempts = 0;
  const result = await withGarminRetry(
    async () => {
      attempts += 1;
      if (attempts < 3) {
        const error = new Error("request timed out");
        error.code = "ETIMEDOUT";
        throw error;
      }
      return "ok";
    },
    { retryDelaysMs: [0, 0], timeoutMs: 100 },
  );

  assert.equal(result, "ok");
  assert.equal(attempts, 3);
});

test("Garmin stops retrying after the configured timeout attempts", async () => {
  let attempts = 0;
  await assert.rejects(
    withGarminRetry(
      () => {
        attempts += 1;
        return new Promise(() => {});
      },
      { retryDelaysMs: [0], timeoutMs: 5 },
    ),
    /timed out/,
  );
  assert.equal(attempts, 2);
});

test("a timed-out refresh never overwrites a valid cached daily summary", async (context) => {
  const { databaseModule, dataDirectory } = await createGarminTestDatabase("cache");
  context.after(() => rm(dataDirectory, { recursive: true }));
  const date = "2026-08-03";
  const validSummary = buildSummary(date, "2026-08-03T05:00:00.000Z", 6_543);

  await databaseModule.readGarminDailySummary(date, {
    refresh: true,
    getGarminDailySummary: async () => validSummary,
  });
  const failedRefresh = await databaseModule.readGarminDailySummary(date, {
    refresh: true,
    getGarminDailySummary: async () => ({
      configured: true,
      date,
      source: "garmin-connect",
      error: "Garmin request timed out after 20000 ms",
      fetchedAt: "2026-08-03T05:05:00.000Z",
    }),
  });

  assert.match(failedRefresh.error, /timed out/);
  const cached = await databaseModule.readGarminDailySummary(date);
  assert.equal(cached.steps, 6_543);
  assert.equal(cached.fetchedAt, validSummary.fetchedAt);
  assert.equal(cached.error, undefined);
});

test("a daily-summary failure does not block activity or weight freshness", async (context) => {
  const { databaseModule, dataDirectory } = await createGarminTestDatabase("partial");
  context.after(() => rm(dataDirectory, { recursive: true }));
  const today = "2026-08-03";
  const fetchedAt = "2026-08-03T05:00:00.000Z";
  const nowMs = Date.parse(fetchedAt);
  const summaryCalls = [];
  const activityCalls = [];
  let weightCalls = 0;

  const firstReport = await databaseModule.runGarminScheduledSync({
    today,
    nowMs,
    logErrors: false,
    dependencies: {
      getGarminDailySummary: async (date) => {
        summaryCalls.push(date);
        return { configured: true, date, source: "garmin-connect", error: "temporary timeout", fetchedAt };
      },
      getGarminActivitiesForWeek: async (weekStart) => {
        activityCalls.push(weekStart);
        return buildActivityWeek(weekStart, fetchedAt);
      },
      getGarminWeightRange: async (startDate, endDate) => {
        weightCalls += 1;
        return {
          configured: true,
          startDate,
          endDate,
          source: "garmin-connect",
          weights: [{ date: today, weightKg: 82.4, source: "garmin", externalId: "weight-1" }],
          fetchedAt,
        };
      },
    },
  });

  assert.equal(firstReport.failed.length, 4);
  assert.deepEqual(activityCalls, ["2026-08-03", "2026-07-27"]);
  assert.equal(weightCalls, 1);
  assert.deepEqual(
    databaseModule.listWeightEntries().map(({ date, weightKg, source }) => ({ date, weightKg, source })),
    [{ date: today, weightKg: 82.4, source: "garmin" }],
  );

  const secondReport = await databaseModule.runGarminScheduledSync({
    today,
    nowMs: nowMs + 1_000,
    logErrors: false,
    dependencies: {
      getGarminDailySummary: async (date) => {
        summaryCalls.push(date);
        return buildSummary(date, fetchedAt, 7_000);
      },
      getGarminActivitiesForWeek: async () => {
        throw new Error("fresh activities must not be fetched again");
      },
      getGarminWeightRange: async () => {
        weightCalls += 1;
        throw new Error("fresh weight must not be fetched again");
      },
    },
  });

  assert.deepEqual(secondReport.attempted, [
    "daily-summary:2026-08-03",
    "daily-summary:2026-08-02",
    "daily-summary:2026-08-01",
    "daily-summary:2026-07-31",
  ]);
  assert.equal(secondReport.failed.length, 0);
  assert.equal(activityCalls.length, 2);
  assert.equal(weightCalls, 1);
});

test("scheduled sync backfills today plus three previous days without duplicate weeks", async (context) => {
  const { databaseModule, dataDirectory } = await createGarminTestDatabase("backfill");
  context.after(() => rm(dataDirectory, { recursive: true }));
  const today = "2026-08-03";
  const fetchedAt = "2026-08-03T06:00:00.000Z";
  const summaryDates = [];
  const activityWeeks = [];

  const report = await databaseModule.runGarminScheduledSync({
    today,
    nowMs: Date.parse(fetchedAt),
    logErrors: false,
    dependencies: {
      getGarminDailySummary: async (date) => {
        summaryDates.push(date);
        return buildSummary(date, fetchedAt, 1_000);
      },
      getGarminActivitiesForWeek: async (weekStart) => {
        activityWeeks.push(weekStart);
        return buildActivityWeek(weekStart, fetchedAt);
      },
      getGarminWeightRange: async (startDate, endDate) => ({
        configured: true,
        startDate,
        endDate,
        source: "garmin-connect",
        weights: [],
        fetchedAt,
      }),
    },
  });

  assert.deepEqual(summaryDates, ["2026-08-03", "2026-08-02", "2026-08-01", "2026-07-31"]);
  assert.deepEqual(activityWeeks, ["2026-08-03", "2026-07-27"]);
  assert.equal(new Set(report.attempted).size, report.attempted.length);
  assert.equal(report.failed.length, 0);
});

async function createGarminTestDatabase(label) {
  const dataDirectory = await mkdtemp(join(tmpdir(), `food-tracker-garmin-${label}-`));
  process.env.FOOD_TRACKER_DATA_DIR = dataDirectory;
  const databaseModule = await import(`./food-db.js?garmin-sync-test=${encodeURIComponent(dataDirectory)}`);
  databaseModule.saveGarminConfig({
    username: "garmin@example.test",
    authValue: "test-credential",
    autoSyncMinutes: 60,
  });
  return { databaseModule, dataDirectory };
}

function buildSummary(date, fetchedAt, steps) {
  return {
    configured: true,
    date,
    source: "garmin-connect",
    activeKilocalories: 500,
    steps,
    totalSteps: steps,
    fetchedAt,
  };
}

function buildActivityWeek(weekStart, fetchedAt) {
  return {
    configured: true,
    weekStart,
    weekEnd: addDays(weekStart, 6),
    source: "garmin-connect",
    activities: [],
    fetchedAt,
  };
}

function addDays(date, days) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
