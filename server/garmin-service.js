import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Garmin from "@gooin/garmin-connect";

const { GarminConnect } = Garmin;
const here = dirname(fileURLToPath(import.meta.url));
const dataDirectory = process.env.FOOD_TRACKER_DATA_DIR || join(here, "..", "data");
const tokenDir = join(dataDirectory, "garmin-tokens");
const garminRequestTimeoutMs = 20_000;
const garminRetryDelaysMs = [500, 1_500];

let clientPromise;
let clientIdentity = "";

export async function getGarminDailySummary(dateString, credentials = {}) {
  const date = normalizeDate(dateString);
  const username = String(credentials.username ?? "").trim();
  const garminPass = String(credentials.authValue ?? "").trim();

  if (!username || !garminPass) {
    return {
      configured: false,
      date,
      source: "garmin-connect",
      fetchedAt: new Date().toISOString(),
    };
  }

  try {
    return await withGarminRetry(async () => {
      const client = await getGarminClient(username, garminPass);
      const profile = await client.getUserProfile();
      const displayName = pickDisplayName(profile);
      if (!displayName) throw new Error("Garmin profile has no display name");

      const summary = await client.client.get(
        `https://connectapi.garmin.com/usersummary-service/usersummary/daily/${encodeURIComponent(displayName)}`,
        { params: { calendarDate: date } },
      );

      return normalizeGarminSummary(summary, date);
    });
  } catch (error) {
    clientPromise = undefined;
    return {
      configured: true,
      date,
      source: "garmin-connect",
      error: error instanceof Error ? error.message : "Garmin sync failed",
      fetchedAt: new Date().toISOString(),
    };
  }
}

export async function getGarminActivitiesForWeek(weekStartString, credentials = {}) {
  const weekStart = normalizeDate(weekStartString);
  const weekEnd = addDays(weekStart, 6);
  const username = String(credentials.username ?? "").trim();
  const garminPass = String(credentials.authValue ?? "").trim();

  if (!username || !garminPass) {
    return {
      configured: false,
      weekStart,
      weekEnd,
      source: "garmin-connect",
      activities: [],
      fetchedAt: new Date().toISOString(),
    };
  }

  try {
    return await withGarminRetry(async () => {
      const client = await getGarminClient(username, garminPass);
      const activities = await client.getActivities(0, 100);
      const normalizedActivities = activities
        .map(normalizeGarminActivity)
        .filter((activity) => activity.date >= weekStart && activity.date <= weekEnd)
        .sort((left, right) => left.startTimeLocal.localeCompare(right.startTimeLocal));

      return {
        configured: true,
        weekStart,
        weekEnd,
        source: "garmin-connect",
        activities: normalizedActivities,
        fetchedAt: new Date().toISOString(),
      };
    });
  } catch (error) {
    clientPromise = undefined;
    return {
      configured: true,
      weekStart,
      weekEnd,
      source: "garmin-connect",
      activities: [],
      error: error instanceof Error ? error.message : "Garmin activity sync failed",
      fetchedAt: new Date().toISOString(),
    };
  }
}

export async function getGarminWeightRange(startDateString, endDateString, credentials = {}) {
  const startDate = normalizeDate(startDateString);
  const endDate = normalizeDate(endDateString);
  const username = String(credentials.username ?? "").trim();
  const garminPass = String(credentials.authValue ?? "").trim();

  if (!username || !garminPass) {
    return {
      configured: false,
      startDate,
      endDate,
      source: "garmin-connect",
      weights: [],
      fetchedAt: new Date().toISOString(),
    };
  }

  try {
    return await withGarminRetry(async () => {
      const client = await getGarminClient(username, garminPass);
      const payload = await client.getWeightRange(startDate, endDate, true);
      return normalizeGarminWeightRange(payload, startDate, endDate);
    });
  } catch (error) {
    clientPromise = undefined;
    return {
      configured: true,
      startDate,
      endDate,
      source: "garmin-connect",
      weights: [],
      error: error instanceof Error ? error.message : "Garmin weight sync failed",
      fetchedAt: new Date().toISOString(),
    };
  }
}

export async function withGarminRetry(operation, options = {}) {
  const retryDelaysMs = options.retryDelaysMs ?? garminRetryDelaysMs;
  const timeoutMs = options.timeoutMs ?? garminRequestTimeoutMs;
  let lastError;

  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    try {
      return await withTimeout(() => operation(attempt + 1), timeoutMs);
    } catch (error) {
      lastError = error;
      clientPromise = undefined;
      if (attempt >= retryDelaysMs.length || !isTransientGarminError(error)) throw error;
      await wait(retryDelaysMs[attempt]);
    }
  }

  throw lastError;
}

function withTimeout(operation, timeoutMs) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return operation();

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new Error(`Garmin request timed out after ${timeoutMs} ms`);
      error.code = "ETIMEDOUT";
      reject(error);
    }, timeoutMs);

    Promise.resolve()
      .then(operation)
      .then(resolve, reject)
      .finally(() => clearTimeout(timer));
  });
}

function isTransientGarminError(error) {
  const status = Number(error?.response?.status ?? error?.status ?? error?.statusCode);
  if (status === 408 || status === 425 || status === 429 || status >= 500) return true;

  const code = String(error?.code ?? "").toUpperCase();
  if (["ECONNABORTED", "ECONNRESET", "EHOSTUNREACH", "ENETUNREACH", "ETIMEDOUT"].includes(code)) return true;

  return /timeout|timed out|temporar|rate limit|socket hang up|network/i.test(String(error?.message ?? error ?? ""));
}

function wait(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, delayMs)));
}

async function getGarminClient(username, password) {
  const identity = username;
  if (!clientPromise || clientIdentity !== identity) {
    clientIdentity = identity;
    clientPromise = createGarminClient(username, password);
  }

  return clientPromise;
}

async function createGarminClient(username, password) {
  mkdirSync(tokenDir, { recursive: true });
  const client = new GarminConnect({ username, password });
  const hasStoredToken = existsSync(join(tokenDir, "oauth1_token.json")) && existsSync(join(tokenDir, "oauth2_token.json"));

  if (hasStoredToken) {
    try {
      await client.loadTokenByFile(tokenDir);
      await client.getUserProfile();
      return client;
    } catch {
      // Token reuse can fail after Garmin rotates auth state. Fall back to login.
    }
  }

  await client.login();
  await client.exportTokenToFile(tokenDir);
  return client;
}

function normalizeDate(value) {
  const raw = String(value ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return new Date().toISOString().slice(0, 10);
}

function pickDisplayName(profile) {
  return String(profile?.displayName ?? profile?.userName ?? profile?.profileId ?? "").trim();
}

function normalizeGarminSummary(summary, date) {
  const activeKilocalories = finiteNumber(summary?.activeKilocalories);
  const bmrKilocalories = finiteNumber(summary?.bmrKilocalories);
  const totalKilocalories = finiteNumber(summary?.totalKilocalories)
    ?? (activeKilocalories !== undefined && bmrKilocalories !== undefined ? activeKilocalories + bmrKilocalories : undefined);

  return {
    configured: true,
    date,
    source: "garmin-connect",
    totalKilocalories,
    activeKilocalories,
    bmrKilocalories,
    steps: finiteNumber(summary?.totalSteps) ?? finiteNumber(summary?.steps),
    totalSteps: finiteNumber(summary?.totalSteps) ?? finiteNumber(summary?.steps),
    consumedKilocalories: finiteNumber(summary?.consumedKilocalories),
    remainingKilocalories: finiteNumber(summary?.remainingKilocalories),
    fetchedAt: new Date().toISOString(),
  };
}

function normalizeGarminActivity(activity) {
  const startTimeLocal = String(activity?.startTimeLocal ?? "");
  const date = /^\d{4}-\d{2}-\d{2}/.test(startTimeLocal)
    ? startTimeLocal.slice(0, 10)
    : normalizeDate(activity?.calendarDate);

  return {
    activityId: String(activity?.activityId ?? ""),
    activityName: String(activity?.activityName ?? activity?.activityType?.typeKey ?? "Garmin Aktivitaet").trim(),
    activityType: String(activity?.activityType?.typeKey ?? activity?.activityType ?? "activity").trim(),
    date,
    startTimeLocal: startTimeLocal || `${date}T00:00:00`,
    durationSeconds: finiteNumber(activity?.duration) ?? finiteNumber(activity?.movingDuration),
    movingDurationSeconds: finiteNumber(activity?.movingDuration),
    distanceMeters: finiteNumber(activity?.distance),
    calories: finiteNumber(activity?.calories),
    averageHeartRate: finiteNumber(activity?.averageHR),
    maxHeartRate: finiteNumber(activity?.maxHR),
  };
}

export function normalizeGarminWeightRange(payload, startDate, endDate) {
  const byDate = new Map();
  const summaries = Array.isArray(payload?.dailyWeightSummaries) ? payload.dailyWeightSummaries : [];

  for (const summary of summaries) {
    const metrics = Array.isArray(summary?.allWeightMetrics) ? summary.allWeightMetrics : [];
    const latestMetric = summary?.latestWeight ?? metrics.at(-1) ?? summary?.totalAverage;
    addNormalizedWeight(byDate, latestMetric, summary?.summaryDate, startDate, endDate);
  }

  const dayMetrics = Array.isArray(payload?.dateWeightList) ? payload.dateWeightList : [];
  for (const metric of dayMetrics) {
    addNormalizedWeight(byDate, metric, metric?.calendarDate, startDate, endDate);
  }

  if (dayMetrics.length === 0 && payload?.totalAverage) {
    addNormalizedWeight(byDate, payload.totalAverage, payload?.startDate ?? payload?.endDate, startDate, endDate);
  }

  return {
    configured: true,
    startDate,
    endDate,
    source: "garmin-connect",
    weights: [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date)),
    fetchedAt: new Date().toISOString(),
  };
}

function addNormalizedWeight(byDate, metric, fallbackDate, startDate, endDate) {
  const date = normalizeWeightDate(fallbackDate ?? metric?.calendarDate);
  const weightKg = normalizeWeightKg(metric?.weight ?? metric?.weightKg);
  if (!date || weightKg === undefined || date < startDate || date > endDate) return;

  byDate.set(date, {
    date,
    weightKg,
    source: "garmin",
    externalId: metric?.samplePk === undefined ? "" : String(metric.samplePk),
  });
}

function normalizeWeightDate(value) {
  const raw = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
}

function normalizeWeightKg(value) {
  const rawWeight = Number(value);
  if (!Number.isFinite(rawWeight)) return undefined;
  const weightKg = rawWeight >= 35 && rawWeight <= 250 ? rawWeight : rawWeight / 1000;
  if (weightKg < 35 || weightKg > 250) return undefined;
  return Math.round(weightKg * 10) / 10;
}

function addDays(date, days) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : undefined;
}
