import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Garmin from "@gooin/garmin-connect";

const { GarminConnect } = Garmin;
const here = dirname(fileURLToPath(import.meta.url));
const tokenDir = join(here, "..", "data", "garmin-tokens");

let clientPromise;

export async function getGarminDailySummary(dateString) {
  const date = normalizeDate(dateString);
  const username = process.env.GARMIN_USERNAME?.trim();
  const garminPass = process.env.GARMIN_PASSWORD?.trim();

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

    const summary = await client.get(
      `https://connect.garmin.com/modern/proxy/usersummary-service/usersummary/daily/${encodeURIComponent(displayName)}`,
      { calendarDate: date },
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

async function getGarminClient(username, password) {
  if (!clientPromise) {
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
  return String(profile?.userName ?? profile?.displayName ?? profile?.profileId ?? "").trim();
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

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : undefined;
}
