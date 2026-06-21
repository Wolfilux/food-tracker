import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Garmin from "@gooin/garmin-connect";

const { GarminConnect } = Garmin;
const here = dirname(fileURLToPath(import.meta.url));
const tokenDir = join(here, "..", "data", "garmin-tokens");

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
    const client = await getGarminClient(username, garminPass);
    const profile = await client.getUserProfile();
    const displayName = pickDisplayName(profile);
    if (!displayName) throw new Error("Garmin profile has no display name");

    const summary = await client.client.get(
      `https://connectapi.garmin.com/usersummary-service/usersummary/daily/${encodeURIComponent(displayName)}`,
      { params: { calendarDate: date } },
    );

    return normalizeGarminSummary(summary, date);
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

function addDays(date, days) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : undefined;
}
