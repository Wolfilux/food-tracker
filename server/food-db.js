import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import nodemailer from "nodemailer";
import { seedFoods } from "./food-data.js";
import { getGarminActivitiesForWeek, getGarminDailySummary } from "./garmin-service.js";

const here = dirname(fileURLToPath(import.meta.url));
const dbPath = join(here, "..", "data", "food-tracker.sqlite");
const secretPath = join(here, "..", "data", "food-tracker.secret.key");
const defaultNutritionConfig = {
  calorieGoal: 2200,
  calorieGoalOffset: 0,
  goal: "maintenance",
};
const minimumCalorieGoal = 800;
const defaultAiConfig = {
  provider: "openai",
  model: "gpt-5.5-mini",
};
const defaultAnalysisAiConfig = {
  provider: "openai",
  model: "gpt-5.5-mini",
};
const defaultWeeklyEmailConfig = {
  targetEmail: "",
};
const ethanolDensityGPerMl = 0.789;
const ethanolCaloriesPerGram = 7;
const nutritionGoals = new Set(["fat-loss", "muscle-gain", "maintenance", "recomposition", "weight-gain"]);
const nutritionGoalPresets = {
  "fat-loss": { label: "Fettabbau", protein: 0.35, carbs: 0.35, fat: 0.3 },
  "muscle-gain": { label: "Muskelaufbau", protein: 0.25, carbs: 0.5, fat: 0.25 },
  maintenance: { label: "Normal", protein: 0.2, carbs: 0.5, fat: 0.3 },
  recomposition: { label: "Fettabbau/Muskelaufbau", protein: 0.3, carbs: 0.4, fat: 0.3 },
  "weight-gain": { label: "Gewichtszunahme", protein: 0.2, carbs: 0.55, fat: 0.25 },
};
const aiProviders = new Map([
  ["openai", {
    label: "OpenAI",
    endpoint: "https://api.openai.com/v1/chat/completions",
    modelsEndpoint: "https://api.openai.com/v1/models",
    models: [
      "gpt-5.5-mini",
      "gpt-5.5",
      "gpt-5.4-mini",
      "gpt-5.4",
      "gpt-5",
      "gpt-5-mini",
      "gpt-5-nano",
      "gpt-4.1-mini",
      "gpt-4.1",
      "gpt-4.1-nano",
      "gpt-4o-mini",
      "gpt-4o",
      "o4-mini",
    ],
  }],
  ["openrouter", {
    label: "OpenRouter",
    endpoint: "https://openrouter.ai/api/v1/chat/completions",
    modelsEndpoint: "https://openrouter.ai/api/v1/models",
    models: [
      "openai/gpt-5.5-pro",
      "openai/gpt-5.5",
      "openai/gpt-5.4-image-2",
      "openai/gpt-5.4-mini",
      "openai/gpt-5.4",
      "openai/gpt-5-mini",
      "openai/gpt-5",
      "google/gemini-3.5-flash",
      "google/gemini-3.1-pro-preview",
      "google/gemini-3.1-flash-lite",
      "google/gemini-3-flash-preview",
      "google/gemini-2.5-flash",
      "google/gemini-2.5-flash-lite",
      "google/gemini-2.5-pro",
      "google/gemini-2.0-flash-001",
      "google/gemini-2.0-flash-lite-001",
      "anthropic/claude-sonnet-4",
      "anthropic/claude-opus-4",
      "anthropic/claude-3.7-sonnet",
      "meta-llama/llama-4-maverick",
      "meta-llama/llama-4-scout",
      "qwen/qwen2.5-vl-72b-instruct",
      "mistralai/mistral-medium-3-5",
    ],
  }],
]);

let db;
let garminSchedulerTimer;
let garminSchedulerRunning = false;
let weeklyEmailSchedulerTimer;
let weeklyEmailSchedulerRunning = false;

export function getFoodDatabase() {
  if (!db) {
    mkdirSync(dirname(dbPath), { recursive: true });
    db = new DatabaseSync(dbPath);
    initializeDatabase(db);
  }

  return db;
}

export function startGarminSyncScheduler() {
  getFoodDatabase();
  if (garminSchedulerTimer) return () => clearInterval(garminSchedulerTimer);

  const tick = () => {
    void runGarminScheduledSync().catch((error) => {
      console.warn("Garmin scheduled sync failed:", error instanceof Error ? error.message : error);
    });
  };

  garminSchedulerTimer = setInterval(tick, 60 * 1000);
  setTimeout(tick, 2000);
  return () => {
    clearInterval(garminSchedulerTimer);
    garminSchedulerTimer = undefined;
  };
}

export function startWeeklyEmailScheduler() {
  getFoodDatabase();
  if (weeklyEmailSchedulerTimer) return () => clearInterval(weeklyEmailSchedulerTimer);

  const tick = () => {
    void runWeeklyEmailScheduler().catch((error) => {
      console.warn("Weekly email scheduler failed:", error instanceof Error ? error.message : error);
    });
  };

  weeklyEmailSchedulerTimer = setInterval(tick, 60 * 1000);
  setTimeout(tick, 5000);
  return () => {
    clearInterval(weeklyEmailSchedulerTimer);
    weeklyEmailSchedulerTimer = undefined;
  };
}

export function searchFoods(query, limit = 12) {
  const normalizedQuery = normalizeFoodKey(query);
  if (normalizedQuery.length < 2) return [];

  return searchStoredFoods(normalizedQuery, limit);
}

export async function searchFoodsExpanded(query, limit = 12) {
  const normalizedQuery = normalizeFoodKey(query);
  if (normalizedQuery.length < 2) return [];

  const boundedLimit = Math.min(Math.max(Number(limit) || 12, 1), 30);
  const storedHits = searchStoredFoods(normalizedQuery, boundedLimit);
  if (normalizedQuery.length < 3) return storedHits;

  const externalHits = await fetchOpenFoodFacts(query, Math.max(20, boundedLimit));
  if (externalHits.length > 0) {
    upsertFoodRecords(externalHits, "OpenFoodFacts", 0);
    return dedupeFoodObjects([...storedHits, ...externalHits.map((food) => ({
      ...food,
      source: "OpenFoodFacts",
    }))]).slice(0, boundedLimit);
  }

  return storedHits;
}

export async function findFoodByBarcode(barcode) {
  const normalizedBarcode = normalizeBarcode(barcode);
  if (!normalizedBarcode) return null;

  const storedFood = getStoredFoodById(`off:${normalizedBarcode}`);
  if (storedFood) return storedFood;

  const externalFood = await fetchOpenFoodFactsBarcode(normalizedBarcode);
  if (!externalFood) return null;

  upsertFoodRecords([externalFood], "OpenFoodFacts", 0);
  return {
    ...externalFood,
    source: "OpenFoodFacts",
  };
}

function getStoredFoodById(id) {
  const row = getFoodDatabase()
    .prepare([
      "SELECT",
      "  id, name, brand, calories_per_100g, protein_per_100g, carbs_per_100g,",
      "  fat_per_100g, image_url, source, source_version, source_updated_at",
      "FROM foods",
      "WHERE id = ?",
    ].join("\n"))
    .get(id);

  return row ? foodRowToObject(row) : null;
}

function searchStoredFoods(normalizedQuery, limit = 12) {
  const database = getFoodDatabase();
  const startsWith = normalizedQuery + "%";
  const contains = "%" + normalizedQuery + "%";
  const rows = database.prepare([
    "WITH scored_foods AS (",
    "  SELECT",
    "    foods.id,",
    "    foods.name,",
    "    foods.brand,",
    "    foods.calories_per_100g,",
    "    foods.protein_per_100g,",
    "    foods.carbs_per_100g,",
    "    foods.fat_per_100g,",
    "    foods.image_url,",
    "    foods.source,",
    "    foods.source_version,",
    "    foods.source_updated_at,",
    "    foods.priority,",
    "    CASE",
    "      WHEN foods.normalized_name = ? THEN 100",
    "      WHEN foods.normalized_name LIKE ? THEN 80",
    "      WHEN aliases.normalized_alias LIKE ? THEN 70",
    "      WHEN foods.normalized_name LIKE ? THEN 45",
    "      WHEN aliases.normalized_alias LIKE ? THEN 35",
    "      ELSE 0",
    "    END AS relevance",
    "  FROM foods",
    "  LEFT JOIN food_aliases aliases ON aliases.food_id = foods.id",
    "  WHERE",
    "    foods.normalized_name LIKE ?",
    "    OR foods.normalized_brand LIKE ?",
    "    OR aliases.normalized_alias LIKE ?",
    ")",
    "SELECT",
    "  id,",
    "  name,",
    "  brand,",
    "  calories_per_100g,",
    "  protein_per_100g,",
    "  carbs_per_100g,",
    "  fat_per_100g,",
    "  image_url,",
    "  source,",
    "  source_version,",
    "  source_updated_at,",
    "  MAX(relevance) AS relevance,",
    "  MAX(priority) AS priority",
    "FROM scored_foods",
    "GROUP BY id",
    "ORDER BY relevance DESC, priority DESC, name ASC",
    "LIMIT ?",
  ].join("\n")).all(
    normalizedQuery,
    startsWith,
    startsWith,
    contains,
    contains,
    contains,
    contains,
    contains,
    limit,
  );

  return dedupeFoodRows(rows).map(foodRowToObject);
}

function foodRowToObject(row) {
  return {
    id: row.id,
    name: row.name,
    brand: row.brand,
    caloriesPer100g: row.calories_per_100g,
    proteinPer100g: row.protein_per_100g,
    carbsPer100g: row.carbs_per_100g,
    fatPer100g: row.fat_per_100g,
    imageUrl: row.image_url || undefined,
    source: row.source_version ? `${row.source} ${row.source_version}` : row.source,
    sourceVersion: row.source_version || undefined,
    sourceUpdatedAt: row.source_updated_at || undefined,
  };
}

export function createFoodApiMiddleware() {
  return async (request, response, next) => {
    const url = new globalThis.URL(request.url ?? "", "http://localhost");

    if (request.method === "GET" && url.pathname === "/api/foods/search") {
      const query = url.searchParams.get("q") ?? "";
      const limit = Number(url.searchParams.get("limit") ?? 12);
      sendJson(response, { hits: await searchFoodsExpanded(query, Number.isFinite(limit) ? limit : 12) });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/foods/barcode") {
      const barcode = url.searchParams.get("code") ?? "";
      sendJson(response, { food: await findFoodByBarcode(barcode) });
      return;
    }

    if (url.pathname === "/api/config/nutrition") {
      if (request.method === "GET") {
        sendJson(response, { config: getNutritionConfig() });
        return;
      }

      if (request.method === "PUT") {
        try {
          const config = saveNutritionConfig(await readJsonBody(request));
          sendJson(response, { config });
        } catch (error) {
          sendJson(response, { error: error.message }, 400);
        }
        return;
      }
    }

    if (url.pathname === "/api/config/ai") {
      if (request.method === "GET") {
        sendJson(response, getPublicAiConfig());
        return;
      }

      if (request.method === "PUT") {
        try {
          const config = saveAiConfig(await readJsonBody(request));
          sendJson(response, config);
        } catch (error) {
          sendJson(response, { error: error.message }, 400);
        }
        return;
      }
    }

    if (url.pathname === "/api/config/analysis-ai") {
      if (request.method === "GET") {
        sendJson(response, getPublicAnalysisAiConfig());
        return;
      }

      if (request.method === "PUT") {
        try {
          sendJson(response, saveAnalysisAiConfig(await readJsonBody(request)));
        } catch (error) {
          sendJson(response, { error: error.message }, 400);
        }
        return;
      }
    }

    if (url.pathname === "/api/ai/analyze-food" && request.method === "POST") {
      try {
        const analysis = await analyzeFoodImage(await readJsonBody(request, 8_000_000));
        sendJson(response, { analysis });
      } catch (error) {
        sendJson(response, { error: error.message }, 400);
      }
      return;
    }

    if (url.pathname === "/api/ai/analyze-text" && request.method === "POST") {
      try {
        const analysis = await analyzeFoodText(await readJsonBody(request));
        sendJson(response, { analysis });
      } catch (error) {
        sendJson(response, { error: error.message }, 400);
      }
      return;
    }

    if (url.pathname === "/api/ai/weekly-analysis" && request.method === "POST") {
      try {
        const analysis = await analyzeWeekManually(await readJsonBody(request));
        sendJson(response, { analysis });
      } catch (error) {
        sendJson(response, { error: error.message }, 400);
      }
      return;
    }

    if (url.pathname === "/api/ai/weekly-analysis" && request.method === "GET") {
      try {
        sendJson(response, { analysis: getStoredWeeklyAnalysis(url.searchParams.get("weekStart")) });
      } catch (error) {
        sendJson(response, { error: error.message }, 400);
      }
      return;
    }

    if (url.pathname === "/api/ai/calorie-ideas" && request.method === "POST") {
      try {
        const ideas = await suggestCalorieIdeas(await readJsonBody(request));
        sendJson(response, { ideas });
      } catch (error) {
        sendJson(response, { error: error.message }, 400);
      }
      return;
    }

    if (url.pathname === "/api/ai/models" && request.method === "GET") {
      try {
        const provider = url.searchParams.get("provider") ?? getAiConfigRecord().provider;
        const capability = url.searchParams.get("capability") === "analysis" ? "analysis" : "photo";
        sendJson(response, { models: await fetchProviderModels(provider, capability) });
      } catch (error) {
        sendJson(response, { error: error.message }, 400);
      }
      return;
    }

    if (url.pathname === "/api/config/weekly-email") {
      if (request.method === "GET") {
        sendJson(response, getWeeklyEmailConfig());
        return;
      }

      if (request.method === "PUT") {
        try {
          sendJson(response, saveWeeklyEmailConfig(await readJsonBody(request)));
        } catch (error) {
          sendJson(response, { error: error.message }, 400);
        }
        return;
      }
    }

    if (url.pathname === "/api/config/weekly-email/status" && request.method === "GET") {
      sendJson(response, getWeeklyEmailStatus());
      return;
    }

    if (url.pathname === "/api/garmin/daily-summary" && request.method === "GET") {
      sendJson(response, { summary: await readGarminDailySummary(url.searchParams.get("date"), {
        refresh: url.searchParams.get("refresh") === "1",
      }) });
      return;
    }

    if (url.pathname === "/api/garmin/activities" && request.method === "GET") {
      sendJson(response, { week: await readGarminActivitiesForWeek(url.searchParams.get("weekStart"), {
        refresh: url.searchParams.get("refresh") === "1",
      }) });
      return;
    }

    if (url.pathname === "/api/config/garmin") {
      if (request.method === "GET") {
        sendJson(response, getPublicGarminConfig());
        return;
      }

      if (request.method === "PUT") {
        try {
          sendJson(response, saveGarminConfig(await readJsonBody(request)));
        } catch (error) {
          sendJson(response, { error: error.message }, 400);
        }
        return;
      }
    }

    if (url.pathname === "/api/export" && request.method === "GET") {
      sendJson(response, buildExportPayload());
      return;
    }

    if (url.pathname === "/api/import" && request.method === "POST") {
      try {
        sendJson(response, { result: importFoodTrackerData(await readJsonBody(request, 30_000_000)) });
      } catch (error) {
        sendJson(response, { error: error.message }, 400);
      }
      return;
    }

    if (url.pathname === "/api/meals") {
      if (request.method === "GET") {
        sendJson(response, { meals: listMealTemplates() });
        return;
      }

      if (request.method === "POST") {
        try {
          const meal = createMealTemplate(await readJsonBody(request));
          sendJson(response, { meal }, 201);
        } catch (error) {
          sendJson(response, { error: error.message }, 400);
        }
        return;
      }
    }

    if (url.pathname === "/api/meal-favorites") {
      if (request.method === "GET") {
        sendJson(response, { favorites: listMealFavoriteKeys() });
        return;
      }

      if (request.method === "PUT") {
        try {
          const favorite = setMealFavorite(await readJsonBody(request));
          sendJson(response, { favorite });
        } catch (error) {
          sendJson(response, { error: error.message }, 400);
        }
        return;
      }
    }

    if (url.pathname.startsWith("/api/meals/") && request.method === "PATCH") {
      const id = decodeURIComponent(url.pathname.replace("/api/meals/", ""));
      try {
        const meal = updateMealTemplate(id, await readJsonBody(request));
        sendJson(response, { meal });
      } catch (error) {
        sendJson(response, { error: error.message }, 400);
      }
      return;
    }

    if (url.pathname.startsWith("/api/meals/") && request.method === "DELETE") {
      const id = decodeURIComponent(url.pathname.replace("/api/meals/", ""));
      deleteMealTemplate(id);
      sendJson(response, { ok: true });
      return;
    }

    if (url.pathname === "/api/entries") {
      if (request.method === "GET") {
        sendJson(response, { entries: listEntries() });
        return;
      }

      if (request.method === "POST") {
        try {
          const input = await readJsonBody(request, 8_000_000);
          if (Array.isArray(input?.entries)) {
            const entries = createEntries(input);
            sendJson(response, { entries }, 201);
          } else {
            const entry = createEntry(input);
            sendJson(response, { entry }, 201);
          }
        } catch (error) {
          sendJson(response, { error: error.message }, 400);
        }
        return;
      }
    }

    if (url.pathname.startsWith("/api/entries/") && request.method === "PATCH") {
      const id = decodeURIComponent(url.pathname.replace("/api/entries/", ""));
      try {
        const entry = updateEntry(id, await readJsonBody(request, 8_000_000));
        sendJson(response, { entry });
      } catch (error) {
        sendJson(response, { error: error.message }, 400);
      }
      return;
    }

    if (url.pathname.startsWith("/api/entries/") && request.method === "DELETE") {
      const id = decodeURIComponent(url.pathname.replace("/api/entries/", ""));
      deleteEntry(id);
      sendJson(response, { ok: true });
      return;
    }

    if (!url.pathname.startsWith("/api/")) {
      next();
      return;
    }

    sendJson(response, { error: "Not found" }, 404);
  };
}

export function getNutritionConfig() {
  const row = getFoodDatabase()
    .prepare("SELECT calorie_goal, calorie_goal_offset, goal FROM nutrition_config WHERE id = 'default'")
    .get();

  if (!row) return defaultNutritionConfig;

  return {
    calorieGoal: row.calorie_goal,
    calorieGoalOffset: row.calorie_goal_offset,
    goal: row.goal,
  };
}

export function saveNutritionConfig(input) {
  const calorieGoal = Number(input?.calorieGoal);
  const calorieGoalOffset = Number(input?.calorieGoalOffset ?? defaultNutritionConfig.calorieGoalOffset);
  const goal = String(input?.goal ?? "");

  if (!Number.isFinite(calorieGoal) || calorieGoal < minimumCalorieGoal || calorieGoal > 10000) {
    throw new Error("Invalid calorie goal");
  }

  if (!Number.isFinite(calorieGoalOffset) || calorieGoalOffset < -5000 || calorieGoalOffset > 5000) {
    throw new Error("Invalid calorie goal offset");
  }

  if (!nutritionGoals.has(goal)) {
    throw new Error("Invalid nutrition goal");
  }

  getFoodDatabase()
    .prepare([
      "INSERT INTO nutrition_config (id, calorie_goal, calorie_goal_offset, goal, updated_at)",
      "VALUES ('default', ?, ?, ?, datetime('now'))",
      "ON CONFLICT(id) DO UPDATE SET",
      "  calorie_goal = excluded.calorie_goal,",
      "  calorie_goal_offset = excluded.calorie_goal_offset,",
      "  goal = excluded.goal,",
      "  updated_at = excluded.updated_at",
    ].join("\n"))
    .run(Math.round(calorieGoal), Math.round(calorieGoalOffset), goal);

  return getNutritionConfig();
}

export function getPublicAiConfig() {
  const config = getAiConfigRecord();
  return {
    provider: config.provider,
    model: config.model,
    hasApiKey: Boolean(config.apiKey),
    keyHint: config.keyHint,
    providers: Array.from(aiProviders.entries()).map(([id, provider]) => ({
      id,
      label: provider.label,
      models: provider.models,
    })),
  };
}

export function saveAiConfig(input) {
  const provider = String(input?.provider ?? defaultAiConfig.provider);
  const providerDefinition = aiProviders.get(provider);
  if (!providerDefinition) throw new Error("Invalid AI provider");

  const model = String(input?.model ?? defaultAiConfig.model);
  if (!isSafeModelId(model)) throw new Error("Invalid AI model");

  const current = getAiConfigRecord();
  const apiKeyInput = typeof input?.apiKey === "string" ? input.apiKey.trim() : "";
  validateProviderKeyPair(provider, apiKeyInput || current.apiKey);
  const shouldClearKey = input?.clearApiKey === true;
  const encrypted = apiKeyInput ? encryptSecret(apiKeyInput) : null;
  const hasNewKey = Boolean(encrypted);
  const keyHint = apiKeyInput ? makeKeyHint(apiKeyInput) : shouldClearKey ? "" : current.keyHint;

  getFoodDatabase()
    .prepare([
      "INSERT INTO ai_config (id, provider, model, encrypted_api_key, api_key_iv, api_key_tag, key_hint, updated_at)",
      "VALUES ('default', ?, ?, ?, ?, ?, ?, datetime('now'))",
      "ON CONFLICT(id) DO UPDATE SET",
      "  provider = excluded.provider,",
      "  model = excluded.model,",
      "  encrypted_api_key = CASE WHEN ? THEN excluded.encrypted_api_key WHEN ? THEN '' ELSE ai_config.encrypted_api_key END,",
      "  api_key_iv = CASE WHEN ? THEN excluded.api_key_iv WHEN ? THEN '' ELSE ai_config.api_key_iv END,",
      "  api_key_tag = CASE WHEN ? THEN excluded.api_key_tag WHEN ? THEN '' ELSE ai_config.api_key_tag END,",
      "  key_hint = excluded.key_hint,",
      "  updated_at = excluded.updated_at",
    ].join("\n"))
    .run(
      provider,
      model,
      encrypted?.ciphertext ?? "",
      encrypted?.iv ?? "",
      encrypted?.tag ?? "",
      keyHint,
      hasNewKey ? 1 : 0,
      shouldClearKey ? 1 : 0,
      hasNewKey ? 1 : 0,
      shouldClearKey ? 1 : 0,
      hasNewKey ? 1 : 0,
      shouldClearKey ? 1 : 0,
    );

  return getPublicAiConfig();
}

export function getPublicAnalysisAiConfig() {
  const config = getAnalysisAiConfigRecord();
  return {
    provider: config.provider,
    model: config.model,
    hasApiKey: Boolean(config.apiKey),
    keyHint: config.keyHint,
    providers: Array.from(aiProviders.entries()).map(([id, provider]) => ({
      id,
      label: provider.label,
      models: provider.models,
    })),
  };
}

export function saveAnalysisAiConfig(input) {
  const sharedConfig = getAiConfigRecord();
  const provider = String(input?.provider ?? sharedConfig.provider ?? defaultAnalysisAiConfig.provider);
  const providerDefinition = aiProviders.get(provider);
  if (!providerDefinition) throw new Error("Invalid AI provider");

  const model = String(input?.model ?? defaultAnalysisAiConfig.model);
  if (!isSafeModelId(model)) throw new Error("Invalid AI model");

  const current = getAnalysisAiConfigRecord();
  validateProviderKeyPair(provider, sharedConfig.apiKey);

  getFoodDatabase()
    .prepare([
      "INSERT INTO analysis_ai_config (id, provider, model, encrypted_api_key, api_key_iv, api_key_tag, key_hint, updated_at)",
      "VALUES ('default', ?, ?, ?, ?, ?, ?, datetime('now'))",
      "ON CONFLICT(id) DO UPDATE SET",
      "  provider = excluded.provider,",
      "  model = excluded.model,",
      "  encrypted_api_key = CASE WHEN ? THEN excluded.encrypted_api_key WHEN ? THEN '' ELSE analysis_ai_config.encrypted_api_key END,",
      "  api_key_iv = CASE WHEN ? THEN excluded.api_key_iv WHEN ? THEN '' ELSE analysis_ai_config.api_key_iv END,",
      "  api_key_tag = CASE WHEN ? THEN excluded.api_key_tag WHEN ? THEN '' ELSE analysis_ai_config.api_key_tag END,",
      "  key_hint = excluded.key_hint,",
      "  updated_at = excluded.updated_at",
    ].join("\n"))
    .run(
      provider,
      model,
      "",
      "",
      "",
      current.keyHint,
      0,
      0,
      0,
      0,
      0,
      0,
    );

  return getPublicAnalysisAiConfig();
}

export function getWeeklyEmailConfig() {
  const row = getFoodDatabase()
    .prepare("SELECT target_email FROM weekly_email_config WHERE id = 'default'")
    .get();

  return {
    targetEmail: String(row?.target_email ?? defaultWeeklyEmailConfig.targetEmail),
  };
}

export function saveWeeklyEmailConfig(input) {
  const targetEmail = String(input?.targetEmail ?? "").trim();
  if (targetEmail && !/^\S+@\S+\.\S+$/.test(targetEmail)) throw new Error("Invalid email address");

  getFoodDatabase()
    .prepare([
      "INSERT INTO weekly_email_config (id, target_email, updated_at)",
      "VALUES ('default', ?, datetime('now'))",
      "ON CONFLICT(id) DO UPDATE SET",
      "  target_email = excluded.target_email,",
      "  updated_at = excluded.updated_at",
    ].join("\n"))
    .run(targetEmail);

  return getWeeklyEmailConfig();
}

export function getWeeklyEmailStatus() {
  const mailConfig = getWeeklyEmailConfig();
  const smtpConfig = getSmtpConfig();
  const aiConfig = getAnalysisAiConfigRecord();
  const lastSent = getFoodDatabase()
    .prepare("SELECT week_start, sent_at FROM weekly_email_log ORDER BY sent_at DESC LIMIT 1")
    .get();
  const readiness = [
    { key: "targetEmail", ok: Boolean(mailConfig.targetEmail), label: "Zieladresse" },
    { key: "smtp", ok: Boolean(smtpConfig.host && smtpConfig.port), label: "SMTP" },
    { key: "analysisAiKey", ok: Boolean(aiConfig.apiKey), label: "Analyse-Key" },
  ];

  return {
    enabled: readiness.every((item) => item.ok),
    readiness,
    schedule: "Montag 01:00 Europe/Berlin fuer die Vorwoche",
    lastSent: lastSent ? { weekStart: lastSent.week_start, sentAt: lastSent.sent_at } : null,
  };
}

export function getPublicGarminConfig() {
  const config = getGarminConfigRecord();
  return {
    username: config.username,
    hasCredential: Boolean(config.authValue),
    keyHint: config.keyHint,
    autoSyncMinutes: config.autoSyncMinutes,
  };
}

export function saveGarminConfig(input) {
  const username = String(input?.username ?? "").trim();
  const current = getGarminConfigRecord();
  const credentialInput = typeof input?.authValue === "string" ? input.authValue.trim() : "";
  const shouldClearCredential = input?.clearCredential === true;
  const autoSyncMinutes = normalizeGarminAutoSyncMinutes(input?.autoSyncMinutes, current.autoSyncMinutes);

  if (username && !/^\S+@\S+\.\S+$/.test(username)) {
    throw new Error("Invalid Garmin username");
  }

  const encrypted = credentialInput ? encryptSecret(credentialInput) : null;
  const hasNewCredential = Boolean(encrypted);
  const keyHint = credentialInput ? makeKeyHint(credentialInput) : shouldClearCredential ? "" : current.keyHint;

  getFoodDatabase()
    .prepare([
      "INSERT INTO garmin_config (id, username, encrypted_credential, credential_iv, credential_tag, key_hint, auto_sync_minutes, updated_at)",
      "VALUES ('default', ?, ?, ?, ?, ?, ?, datetime('now'))",
      "ON CONFLICT(id) DO UPDATE SET",
      "  username = excluded.username,",
      "  encrypted_credential = CASE WHEN ? THEN excluded.encrypted_credential WHEN ? THEN '' ELSE garmin_config.encrypted_credential END,",
      "  credential_iv = CASE WHEN ? THEN excluded.credential_iv WHEN ? THEN '' ELSE garmin_config.credential_iv END,",
      "  credential_tag = CASE WHEN ? THEN excluded.credential_tag WHEN ? THEN '' ELSE garmin_config.credential_tag END,",
      "  key_hint = excluded.key_hint,",
      "  auto_sync_minutes = excluded.auto_sync_minutes,",
      "  updated_at = excluded.updated_at",
    ].join("\n"))
    .run(
      username,
      encrypted?.ciphertext ?? "",
      encrypted?.iv ?? "",
      encrypted?.tag ?? "",
      keyHint,
      autoSyncMinutes,
      hasNewCredential ? 1 : 0,
      shouldClearCredential ? 1 : 0,
      hasNewCredential ? 1 : 0,
      shouldClearCredential ? 1 : 0,
      hasNewCredential ? 1 : 0,
      shouldClearCredential ? 1 : 0,
    );

  return getPublicGarminConfig();
}

export function listEntries() {
  const rows = getFoodDatabase()
    .prepare([
      "SELECT",
      "  id, food_key, food_name, quantity_value, quantity_unit, calories_per_100g,",
      "  protein_per_100g, carbs_per_100g, fat_per_100g, consumed_at, created_at, source, ai_usage_json,",
      "  meal_id, meal_name, image_data_url, alcohol_vol_percent, alcohol_grams, alcohol_calories",
      "FROM entries",
      "ORDER BY consumed_at DESC, created_at DESC",
    ].join("\n"))
    .all();

  return rows.map(entryFromRow);
}

export function createEntry(input) {
  const entry = validateEntry(input);
  getFoodDatabase()
    .prepare([
      "INSERT INTO entries (",
      "  id, food_key, food_name, quantity_value, quantity_unit, calories_per_100g,",
      "  protein_per_100g, carbs_per_100g, fat_per_100g, consumed_at, created_at, source, ai_usage_json,",
      "  meal_id, meal_name, image_data_url, alcohol_vol_percent, alcohol_grams, alcohol_calories",
      ")",
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ].join("\n"))
    .run(
      entry.id,
      entry.foodKey ?? null,
      entry.foodName,
      entry.quantityValue,
      entry.quantityUnit,
      entry.caloriesPer100g,
      entry.proteinPer100g,
      entry.carbsPer100g,
      entry.fatPer100g,
      entry.consumedAt,
      entry.createdAt,
      entry.source ?? "manual",
      JSON.stringify(entry.aiUsage ?? null),
      entry.mealId ?? null,
      entry.mealName ?? null,
      entry.imageDataUrl ?? "",
      entry.alcoholVolPercent ?? null,
      entry.alcoholGrams ?? 0,
      entry.alcoholCalories ?? 0,
    );

  return entry;
}

export function createEntries(input) {
  const entriesInput = Array.isArray(input?.entries) ? input.entries : [];
  if (entriesInput.length < 1) throw new Error("No entries supplied");
  if (entriesInput.length > 50) throw new Error("Too many entries");

  const mealName = String(input?.mealName ?? "").trim().slice(0, 120) || undefined;
  const mealId = entriesInput.length > 1 || mealName
    ? String(input?.mealId ?? randomUUID())
    : input?.mealId ? String(input.mealId) : undefined;
  const mealImageDataUrl = normalizeEntryImageDataUrl(input?.imageDataUrl);
  const entries = entriesInput.map((entryInput) => validateEntry({
    ...entryInput,
    mealId,
    mealName,
    imageDataUrl: mealImageDataUrl || entryInput?.imageDataUrl,
  }));

  const database = getFoodDatabase();
  database.exec("BEGIN IMMEDIATE");
  try {
    for (const entry of entries) {
      createEntry(entry);
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }

  return entries;
}

export function updateEntry(id, input) {
  const existing = getFoodDatabase()
    .prepare("SELECT created_at, meal_id, meal_name, image_data_url FROM entries WHERE id = ?")
    .get(id);
  if (!existing) throw new Error("Entry not found");

  const entry = validateEntry({
    ...input,
    id,
    createdAt: existing.created_at,
    mealId: input?.mealId ?? existing.meal_id,
    mealName: input?.mealName ?? existing.meal_name,
    imageDataUrl: input?.imageDataUrl ?? existing.image_data_url,
  });

  getFoodDatabase()
    .prepare([
      "UPDATE entries SET",
      "  food_key = ?,",
      "  food_name = ?,",
      "  quantity_value = ?,",
      "  quantity_unit = ?,",
      "  calories_per_100g = ?,",
      "  protein_per_100g = ?,",
      "  carbs_per_100g = ?,",
      "  fat_per_100g = ?,",
      "  consumed_at = ?,",
      "  source = ?,",
      "  ai_usage_json = ?,",
      "  meal_id = ?,",
      "  meal_name = ?,",
      "  image_data_url = ?,",
      "  alcohol_vol_percent = ?,",
      "  alcohol_grams = ?,",
      "  alcohol_calories = ?",
      "WHERE id = ?",
    ].join("\n"))
    .run(
      entry.foodKey ?? null,
      entry.foodName,
      entry.quantityValue,
      entry.quantityUnit,
      entry.caloriesPer100g,
      entry.proteinPer100g,
      entry.carbsPer100g,
      entry.fatPer100g,
      entry.consumedAt,
      entry.source ?? "manual",
      JSON.stringify(entry.aiUsage ?? null),
      entry.mealId ?? null,
      entry.mealName ?? null,
      entry.imageDataUrl ?? "",
      entry.alcoholVolPercent ?? null,
      entry.alcoholGrams ?? 0,
      entry.alcoholCalories ?? 0,
      id,
    );

  return entry;
}

export function deleteEntry(id) {
  getFoodDatabase().prepare("DELETE FROM entries WHERE id = ?").run(id);
}

export function listMealFavoriteKeys() {
  return getFoodDatabase()
    .prepare("SELECT signature FROM meal_favorites ORDER BY created_at ASC")
    .all()
    .map((row) => row.signature);
}

export function setMealFavorite(input) {
  const signature = validateMealFavoriteSignature(input?.signature);
  const favorite = Boolean(input?.favorite);
  const database = getFoodDatabase();

  if (favorite) {
    database
      .prepare("INSERT OR IGNORE INTO meal_favorites (signature, created_at) VALUES (?, ?)")
      .run(signature, new Date().toISOString());
  } else {
    database.prepare("DELETE FROM meal_favorites WHERE signature = ?").run(signature);
  }

  return { signature, favorite };
}

export function buildExportPayload() {
  const aiConfig = getPublicAiConfig();
  return {
    app: "food-tracker",
    version: 1,
    exportedAt: new Date().toISOString(),
    nutritionConfig: getNutritionConfig(),
    aiConfig: {
      provider: aiConfig.provider,
      model: aiConfig.model,
    },
    mealFavorites: listMealFavoriteKeys(),
    mealTemplates: listMealTemplates(),
    weeklyAiAnalyses: listStoredWeeklyAnalyses(),
    entries: listEntries(),
  };
}

export function importFoodTrackerData(input) {
  if (!input || typeof input !== "object") throw new Error("Invalid import file");
  if (input.app !== "food-tracker") throw new Error("Import file is not a Food Tracker export");
  if (Number(input.version ?? 0) !== 1) throw new Error("Unsupported import version");

  const entries = Array.isArray(input.entries) ? input.entries : null;
  if (!entries) throw new Error("Import file has no entries");
  if (entries.length > 10000) throw new Error("Import file contains too many entries");

  const database = getFoodDatabase();
  const warnings = [];
  let nutritionConfigImported = false;
  let aiConfigImported = false;

  database.exec("BEGIN IMMEDIATE");
  try {
    if (input.nutritionConfig) {
      saveNutritionConfig(input.nutritionConfig);
      nutritionConfigImported = true;
    }

    database.prepare("DELETE FROM entries").run();
    for (const entry of entries) {
      createEntry(entry);
    }

    if (Array.isArray(input.mealTemplates)) {
      database.prepare("DELETE FROM meal_template_items").run();
      database.prepare("DELETE FROM meal_templates").run();
      for (const meal of input.mealTemplates.slice(0, 500)) {
        saveMealTemplateRows(database, validateMealTemplate(meal));
      }
    }

    if (Array.isArray(input.mealFavorites)) {
      database.prepare("DELETE FROM meal_favorites").run();
      const insertFavorite = database.prepare("INSERT OR IGNORE INTO meal_favorites (signature, created_at) VALUES (?, ?)");
      const importedAt = new Date().toISOString();
      for (const favorite of input.mealFavorites.slice(0, 1000)) {
        insertFavorite.run(validateMealFavoriteSignature(favorite), importedAt);
      }
    }

    if (Array.isArray(input.weeklyAiAnalyses)) {
      database.prepare("DELETE FROM weekly_ai_analyses").run();
      for (const analysis of input.weeklyAiAnalyses.slice(0, 260)) {
        saveStoredWeeklyAnalysis(validateStoredWeeklyAnalysis(analysis), database);
      }
    }

    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }

  if (input.aiConfig) {
    aiConfigImported = importPublicAiConfig(input.aiConfig, warnings);
  }

  return {
    entriesImported: entries.length,
    nutritionConfigImported,
    aiConfigImported,
    warnings,
  };
}

function importPublicAiConfig(input, warnings) {
  const provider = String(input?.provider ?? "");
  const model = String(input?.model ?? "");
  const providerDefinition = aiProviders.get(provider);
  if (!providerDefinition || !isSafeModelId(model)) {
    warnings.push("AI-Konfiguration im Import war ungueltig und wurde uebersprungen.");
    return false;
  }

  const current = getAiConfigRecord();
  try {
    validateProviderKeyPair(provider, current.apiKey);
  } catch {
    warnings.push("AI-Provider/Modell wurde nicht importiert, weil der gespeicherte API-Key dazu nicht passt.");
    return false;
  }

  saveAiConfig({ provider, model });
  return true;
}

export function getStoredWeeklyAnalysis(weekStartInput) {
  const weekStart = normalizeWeekStart(weekStartInput ?? todayInBerlin());
  const row = getFoodDatabase()
    .prepare([
      "SELECT user_key, week_start, week_end, provider, model, analysis_json, created_at, updated_at",
      "FROM weekly_ai_analyses",
      "WHERE user_key = 'default' AND week_start = ?",
    ].join("\n"))
    .get(weekStart);

  return row ? weeklyAnalysisFromRow(row) : null;
}

export function listStoredWeeklyAnalyses() {
  return getFoodDatabase()
    .prepare([
      "SELECT user_key, week_start, week_end, provider, model, analysis_json, created_at, updated_at",
      "FROM weekly_ai_analyses",
      "WHERE user_key = 'default'",
      "ORDER BY week_start DESC",
    ].join("\n"))
    .all()
    .map(weeklyAnalysisFromRow)
    .filter(Boolean);
}

function saveStoredWeeklyAnalysis(analysis, database = getFoodDatabase()) {
  const normalized = validateStoredWeeklyAnalysis(analysis);
  const existing = database.prepare([
    "SELECT created_at",
    "FROM weekly_ai_analyses",
    "WHERE user_key = 'default' AND week_start = ?",
  ].join("\n")).get(normalized.weekStart);
  const now = new Date().toISOString();
  const createdAt = normalized.createdAt || existing?.created_at || now;
  const updatedAt = now;
  const persisted = {
    ...normalized,
    userKey: "default",
    createdAt,
    updatedAt,
  };

  database.prepare([
    "INSERT INTO weekly_ai_analyses (",
    "  user_key, week_start, week_end, provider, model, analysis_json, created_at, updated_at",
    ")",
    "VALUES ('default', ?, ?, ?, ?, ?, ?, ?)",
    "ON CONFLICT(user_key, week_start) DO UPDATE SET",
    "  week_end = excluded.week_end,",
    "  provider = excluded.provider,",
    "  model = excluded.model,",
    "  analysis_json = excluded.analysis_json,",
    "  updated_at = excluded.updated_at",
  ].join("\n")).run(
    persisted.weekStart,
    persisted.weekEnd,
    persisted.provider,
    persisted.model,
    JSON.stringify(persisted),
    createdAt,
    updatedAt,
  );

  return persisted;
}

function weeklyAnalysisFromRow(row) {
  try {
    const analysis = JSON.parse(row.analysis_json);
    return validateStoredWeeklyAnalysis({
      ...analysis,
      userKey: row.user_key || "default",
      weekStart: row.week_start,
      weekEnd: row.week_end,
      provider: row.provider || analysis.provider,
      model: row.model || analysis.model,
      createdAt: row.created_at || analysis.createdAt,
      updatedAt: row.updated_at || analysis.updatedAt,
    });
  } catch {
    return null;
  }
}

function validateStoredWeeklyAnalysis(input) {
  const weekStart = normalizeWeekStart(input?.weekStart ?? todayInBerlin());
  const weekEnd = /^\d{4}-\d{2}-\d{2}$/.test(String(input?.weekEnd ?? ""))
    ? String(input.weekEnd)
    : addDays(weekStart, 6);
  const signalLabel = ["gut", "okay", "schlecht"].includes(input?.signal?.label) ? input.signal.label : "okay";
  const sections = input?.aiSections && typeof input.aiSections === "object" ? input.aiSections : undefined;
  return {
    ...input,
    userKey: "default",
    weekStart,
    weekEnd,
    goalLabel: textValue(input?.goalLabel, "Normal", 80),
    signal: {
      label: signalLabel,
      score: clampNumber(input?.signal?.score, 0, 100),
      message: textValue(input?.signal?.message, "", 240),
    },
    aiText: textValue(input?.aiText, "", 6000),
    aiSections: sections ? {
      summary: textValue(sections.summary, "", 520),
      positives: normalizeTextList(sections.positives, 5, []),
      patterns: normalizeTextList(sections.patterns, 5, []),
      followUp: {
        status: ["umgesetzt", "teilweise", "nicht umgesetzt", "keine Vorwoche"].includes(sections.followUp?.status) ? sections.followUp.status : "keine Vorwoche",
        summary: textValue(sections.followUp?.summary, "", 420),
        evidence: normalizeTextList(sections.followUp?.evidence, 5, []),
      },
      recommendations: normalizeRecommendationList(sections.recommendations, []),
      timing: normalizeTextList(sections.timing, 5, []),
      macros: normalizeTextList(sections.macros, 5, []),
      alcohol: textValue(sections.alcohol, "", 420),
      garmin: textValue(sections.garmin, "", 520),
      nextWeekPlan: {
        meals: normalizeTextList(sections.nextWeekPlan?.meals, 7, []),
        activity: normalizeTextList(sections.nextWeekPlan?.activity, 5, []),
      },
    } : undefined,
    provider: textValue(input?.provider, "", 80),
    model: textValue(input?.model, "", 160),
    createdAt: input?.createdAt ? String(input.createdAt) : undefined,
    updatedAt: input?.updatedAt ? String(input.updatedAt) : undefined,
  };
}

export function listMealTemplates() {
  const database = getFoodDatabase();
  const meals = database.prepare([
    "SELECT id, name, created_at",
    "FROM meal_templates",
    "ORDER BY name ASC",
  ].join("\n")).all();

  const items = database.prepare([
    "SELECT",
    "  meal_id, position, food_key, food_name, quantity_value, quantity_unit, calories_per_100g,",
    "  protein_per_100g, carbs_per_100g, fat_per_100g, source",
    "FROM meal_template_items",
    "ORDER BY meal_id ASC, position ASC",
  ].join("\n")).all();

  const itemsByMeal = new Map();
  for (const row of items) {
    const list = itemsByMeal.get(row.meal_id) ?? [];
    list.push(mealTemplateItemFromRow(row));
    itemsByMeal.set(row.meal_id, list);
  }

  return meals.map((meal) => ({
    id: meal.id,
    name: meal.name,
    createdAt: meal.created_at,
    items: itemsByMeal.get(meal.id) ?? [],
  }));
}

export function createMealTemplate(input) {
  const meal = validateMealTemplate(input);
  const database = getFoodDatabase();
  database.exec("BEGIN IMMEDIATE");
  try {
    saveMealTemplateRows(database, meal);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }

  return meal;
}

function getMealTemplate(database, id) {
  const meal = database.prepare([
    "SELECT id, name, created_at",
    "FROM meal_templates",
    "WHERE id = ?",
  ].join("\n")).get(id);
  if (!meal) return null;

  const items = database.prepare([
    "SELECT",
    "  meal_id, position, food_key, food_name, quantity_value, quantity_unit, calories_per_100g,",
    "  protein_per_100g, carbs_per_100g, fat_per_100g, source",
    "FROM meal_template_items",
    "WHERE meal_id = ?",
    "ORDER BY position ASC",
  ].join("\n")).all(id);

  return {
    id: meal.id,
    name: meal.name,
    createdAt: meal.created_at,
    items: items.map(mealTemplateItemFromRow),
  };
}

function saveMealTemplateRows(database, meal) {
  database.prepare([
    "INSERT INTO meal_templates (id, name, created_at)",
    "VALUES (?, ?, ?)",
    "ON CONFLICT(id) DO UPDATE SET name = excluded.name",
  ].join("\n")).run(meal.id, meal.name, meal.createdAt);
  database.prepare("DELETE FROM meal_template_items WHERE meal_id = ?").run(meal.id);
  const statement = database.prepare([
    "INSERT INTO meal_template_items (",
    "  meal_id, position, food_key, food_name, quantity_value, quantity_unit, calories_per_100g,",
    "  protein_per_100g, carbs_per_100g, fat_per_100g, source",
    ")",
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ].join("\n"));
  meal.items.forEach((item, index) => {
    statement.run(
      meal.id,
      index,
      item.foodKey ?? null,
      item.foodName,
      item.quantityValue,
      item.quantityUnit,
      item.caloriesPer100g,
      item.proteinPer100g,
      item.carbsPer100g,
      item.fatPer100g,
      item.source ?? "manual",
    );
  });
}

export function updateMealTemplate(id, input) {
  const name = String(input?.name ?? "").trim().slice(0, 120);
  if (!name) throw new Error("Meal name is required");

  const database = getFoodDatabase();
  const existing = database.prepare("SELECT id FROM meal_templates WHERE id = ?").get(id);
  if (!existing) throw new Error("Meal not found");

  database.prepare("UPDATE meal_templates SET name = ? WHERE id = ?").run(name, id);
  const updatedMeal = getMealTemplate(database, id);
  if (!updatedMeal) throw new Error("Meal not found");
  return updatedMeal;
}

export function deleteMealTemplate(id) {
  getFoodDatabase().prepare("DELETE FROM meal_templates WHERE id = ?").run(id);
}

function initializeDatabase(database) {
  database.exec([
    "CREATE TABLE IF NOT EXISTS foods (",
    "  id TEXT PRIMARY KEY,",
    "  name TEXT NOT NULL,",
    "  normalized_name TEXT NOT NULL,",
    "  brand TEXT NOT NULL DEFAULT '',",
    "  normalized_brand TEXT NOT NULL DEFAULT '',",
    "  calories_per_100g REAL NOT NULL,",
    "  protein_per_100g REAL NOT NULL,",
    "  carbs_per_100g REAL NOT NULL,",
    "  fat_per_100g REAL NOT NULL,",
    "  image_url TEXT NOT NULL DEFAULT '',",
    "  source TEXT NOT NULL DEFAULT 'SQLite',",
    "  source_version TEXT NOT NULL DEFAULT '',",
    "  source_updated_at TEXT NOT NULL DEFAULT '',",
    "  priority INTEGER NOT NULL DEFAULT 0",
    ");",
    "CREATE TABLE IF NOT EXISTS food_aliases (",
    "  food_id TEXT NOT NULL REFERENCES foods(id) ON DELETE CASCADE,",
    "  alias TEXT NOT NULL,",
    "  normalized_alias TEXT NOT NULL,",
    "  PRIMARY KEY (food_id, normalized_alias)",
    ");",
    "CREATE INDEX IF NOT EXISTS idx_foods_normalized_name ON foods(normalized_name);",
    "CREATE INDEX IF NOT EXISTS idx_food_aliases_normalized_alias ON food_aliases(normalized_alias);",
    "CREATE TABLE IF NOT EXISTS food_source_imports (",
    "  source TEXT PRIMARY KEY,",
    "  source_version TEXT NOT NULL DEFAULT '',",
    "  source_url TEXT NOT NULL DEFAULT '',",
    "  imported_at TEXT NOT NULL,",
    "  record_count INTEGER NOT NULL DEFAULT 0",
    ");",
    "CREATE TABLE IF NOT EXISTS nutrition_config (",
    "  id TEXT PRIMARY KEY,",
    "  calorie_goal INTEGER NOT NULL,",
    "  calorie_goal_offset INTEGER NOT NULL DEFAULT 0,",
    "  goal TEXT NOT NULL,",
    "  updated_at TEXT NOT NULL DEFAULT (datetime('now'))",
    ");",
    "CREATE TABLE IF NOT EXISTS ai_config (",
    "  id TEXT PRIMARY KEY,",
    "  provider TEXT NOT NULL,",
    "  model TEXT NOT NULL,",
    "  encrypted_api_key TEXT NOT NULL DEFAULT '',",
    "  api_key_iv TEXT NOT NULL DEFAULT '',",
    "  api_key_tag TEXT NOT NULL DEFAULT '',",
    "  key_hint TEXT NOT NULL DEFAULT '',",
    "  updated_at TEXT NOT NULL DEFAULT (datetime('now'))",
    ");",
    "CREATE TABLE IF NOT EXISTS analysis_ai_config (",
    "  id TEXT PRIMARY KEY,",
    "  provider TEXT NOT NULL,",
    "  model TEXT NOT NULL,",
    "  encrypted_api_key TEXT NOT NULL DEFAULT '',",
    "  api_key_iv TEXT NOT NULL DEFAULT '',",
    "  api_key_tag TEXT NOT NULL DEFAULT '',",
    "  key_hint TEXT NOT NULL DEFAULT '',",
    "  updated_at TEXT NOT NULL DEFAULT (datetime('now'))",
    ");",
    "CREATE TABLE IF NOT EXISTS weekly_email_config (",
    "  id TEXT PRIMARY KEY,",
    "  target_email TEXT NOT NULL DEFAULT '',",
    "  updated_at TEXT NOT NULL DEFAULT (datetime('now'))",
    ");",
    "CREATE TABLE IF NOT EXISTS weekly_email_log (",
    "  week_start TEXT PRIMARY KEY,",
    "  sent_at TEXT NOT NULL",
    ");",
    "CREATE TABLE IF NOT EXISTS weekly_ai_analyses (",
    "  user_key TEXT NOT NULL DEFAULT 'default',",
    "  week_start TEXT NOT NULL,",
    "  week_end TEXT NOT NULL,",
    "  provider TEXT NOT NULL DEFAULT '',",
    "  model TEXT NOT NULL DEFAULT '',",
    "  analysis_json TEXT NOT NULL,",
    "  created_at TEXT NOT NULL,",
    "  updated_at TEXT NOT NULL,",
    "  PRIMARY KEY (user_key, week_start)",
    ");",
    "CREATE TABLE IF NOT EXISTS garmin_config (",
    "  id TEXT PRIMARY KEY,",
    "  username TEXT NOT NULL DEFAULT '',",
    "  encrypted_credential TEXT NOT NULL DEFAULT '',",
    "  credential_iv TEXT NOT NULL DEFAULT '',",
    "  credential_tag TEXT NOT NULL DEFAULT '',",
    "  key_hint TEXT NOT NULL DEFAULT '',",
    "  auto_sync_minutes INTEGER NOT NULL DEFAULT 0,",
    "  updated_at TEXT NOT NULL DEFAULT (datetime('now'))",
    ");",
    "CREATE TABLE IF NOT EXISTS garmin_daily_summary (",
    "  date TEXT PRIMARY KEY,",
    "  summary_json TEXT NOT NULL,",
    "  fetched_at TEXT NOT NULL",
    ");",
    "CREATE TABLE IF NOT EXISTS garmin_week_activities (",
    "  week_start TEXT PRIMARY KEY,",
    "  week_end TEXT NOT NULL,",
    "  activities_json TEXT NOT NULL,",
    "  fetched_at TEXT NOT NULL",
    ");",
    "CREATE TABLE IF NOT EXISTS entries (",
    "  id TEXT PRIMARY KEY,",
    "  food_key TEXT,",
    "  food_name TEXT NOT NULL,",
    "  quantity_value REAL NOT NULL,",
    "  quantity_unit TEXT NOT NULL CHECK (quantity_unit IN ('g', 'kg', 'ml')),",
    "  calories_per_100g REAL NOT NULL,",
    "  protein_per_100g REAL NOT NULL DEFAULT 0,",
    "  carbs_per_100g REAL NOT NULL DEFAULT 0,",
    "  fat_per_100g REAL NOT NULL DEFAULT 0,",
    "  consumed_at TEXT NOT NULL,",
    "  created_at TEXT NOT NULL,",
    "  source TEXT NOT NULL DEFAULT 'manual',",
    "  ai_usage_json TEXT NOT NULL DEFAULT '',",
    "  meal_id TEXT,",
    "  meal_name TEXT,",
    "  image_data_url TEXT NOT NULL DEFAULT '',",
    "  alcohol_vol_percent REAL,",
    "  alcohol_grams REAL NOT NULL DEFAULT 0,",
    "  alcohol_calories REAL NOT NULL DEFAULT 0",
    ");",
    "CREATE INDEX IF NOT EXISTS idx_entries_consumed_at ON entries(consumed_at DESC);",
    "CREATE TABLE IF NOT EXISTS meal_templates (",
    "  id TEXT PRIMARY KEY,",
    "  name TEXT NOT NULL,",
    "  created_at TEXT NOT NULL",
    ");",
    "CREATE TABLE IF NOT EXISTS meal_favorites (",
    "  signature TEXT PRIMARY KEY,",
    "  created_at TEXT NOT NULL",
    ");",
    "CREATE TABLE IF NOT EXISTS meal_template_items (",
    "  meal_id TEXT NOT NULL REFERENCES meal_templates(id) ON DELETE CASCADE,",
    "  position INTEGER NOT NULL,",
    "  food_key TEXT,",
    "  food_name TEXT NOT NULL,",
    "  quantity_value REAL NOT NULL,",
    "  quantity_unit TEXT NOT NULL CHECK (quantity_unit IN ('g', 'kg', 'ml')),",
    "  calories_per_100g REAL NOT NULL,",
    "  protein_per_100g REAL NOT NULL DEFAULT 0,",
    "  carbs_per_100g REAL NOT NULL DEFAULT 0,",
    "  fat_per_100g REAL NOT NULL DEFAULT 0,",
    "  source TEXT NOT NULL DEFAULT 'manual',",
    "  PRIMARY KEY (meal_id, position)",
    ");",
  ].join("\n"));

  addColumnIfMissing(database, "foods", "image_url", "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(database, "foods", "source_version", "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(database, "foods", "source_updated_at", "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(database, "entries", "ai_usage_json", "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(database, "entries", "meal_id", "TEXT");
  addColumnIfMissing(database, "entries", "meal_name", "TEXT");
  addColumnIfMissing(database, "entries", "image_data_url", "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(database, "entries", "alcohol_vol_percent", "REAL");
  addColumnIfMissing(database, "entries", "alcohol_grams", "REAL NOT NULL DEFAULT 0");
  addColumnIfMissing(database, "entries", "alcohol_calories", "REAL NOT NULL DEFAULT 0");
  migrateEntriesQuantityUnitCheck(database);
  migrateMealTemplateItemsQuantityUnitCheck(database);
  addColumnIfMissing(database, "nutrition_config", "calorie_goal_offset", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(database, "garmin_config", "encrypted_credential", "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(database, "garmin_config", "credential_iv", "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(database, "garmin_config", "credential_tag", "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(database, "garmin_config", "auto_sync_minutes", "INTEGER NOT NULL DEFAULT 0");
  database.exec("CREATE INDEX IF NOT EXISTS idx_weekly_ai_analyses_week_start ON weekly_ai_analyses(week_start DESC);");
  database.exec("CREATE INDEX IF NOT EXISTS idx_entries_meal_id ON entries(meal_id);");
  seedFoodRecords(database);
}

async function readGarminDailySummary(dateString, options = {}) {
  const date = normalizeGarminDate(dateString);
  const config = getGarminConfigRecord();

  if (!config.username || !config.authValue) {
    return {
      configured: false,
      date,
      source: "garmin-connect",
      fetchedAt: new Date().toISOString(),
    };
  }

  const cached = getGarminCachedSummary(date);
  if (cached && options.refresh !== true) return cached;

  return fetchAndStoreGarminDailySummary(date, config);
}

async function readGarminActivitiesForWeek(weekStartString, options = {}) {
  const weekStart = normalizeWeekStart(weekStartString ?? todayInBerlin());
  const config = getGarminConfigRecord();

  if (!config.username || !config.authValue) {
    return {
      configured: false,
      weekStart,
      weekEnd: addDays(weekStart, 6),
      source: "garmin-connect",
      activities: [],
      fetchedAt: new Date().toISOString(),
    };
  }

  const cached = getGarminCachedActivities(weekStart);
  if (cached && options.refresh !== true) return cached;

  return fetchAndStoreGarminActivities(weekStart, config);
}

async function runGarminScheduledSync() {
  if (garminSchedulerRunning) return;
  const config = getGarminConfigRecord();
  if (!config.username || !config.authValue || config.autoSyncMinutes === 0) return;

  const date = todayInBerlin();
  const cached = getGarminCachedSummary(date);
  if (cached?.fetchedAt && Date.now() - Date.parse(cached.fetchedAt) < config.autoSyncMinutes * 60 * 1000) return;

  garminSchedulerRunning = true;
  try {
    await Promise.all([
      fetchAndStoreGarminDailySummary(date, config),
      fetchAndStoreGarminActivities(getWeekStart(date), config),
    ]);
  } finally {
    garminSchedulerRunning = false;
  }
}

async function runWeeklyEmailScheduler() {
  if (weeklyEmailSchedulerRunning) return;
  const berlinNow = getBerlinDateTimeParts();
  if (berlinNow.weekday !== "Mon" || berlinNow.hour !== 1 || berlinNow.minute !== 0) return;

  const thisMonday = getWeekStart(berlinNow.date);
  const previousWeekStart = addDays(thisMonday, -7);
  if (hasWeeklyEmailBeenSent(previousWeekStart)) return;

  weeklyEmailSchedulerRunning = true;
  try {
    const result = await sendWeeklyAnalysisEmail(previousWeekStart);
    if (result.sent) markWeeklyEmailSent(previousWeekStart);
    if (result.skipped) console.info(`Weekly food email skipped: ${result.reason}`);
  } finally {
    weeklyEmailSchedulerRunning = false;
  }
}

async function analyzeWeekManually(input) {
  const weekStart = normalizeWeekStart(input?.weekStart ?? todayInBerlin());
  const summary = buildWeeklyAnalysis(weekStart);
  const ai = await generateWeeklyAiText(summary);
  const analysis = {
    ...summary,
    aiText: ai.text,
    aiSections: ai.sections,
    provider: ai.provider,
    model: ai.model,
    aiUsage: ai.aiUsage,
  };
  return saveStoredWeeklyAnalysis(analysis);
}

function buildWeeklyAnalysis(weekStartInput) {
  const weekStart = normalizeWeekStart(weekStartInput);
  const weekEnd = addDays(weekStart, 6);
  const entries = listEntriesForWeek(weekStart);
  const garminActivities = getGarminCachedActivities(weekStart)?.activities ?? [];
  const activitiesByDate = groupGarminActivitiesByDate(garminActivities);
  const nutritionConfig = getNutritionConfig();
  const preset = nutritionGoalPresets[nutritionConfig.goal] ?? nutritionGoalPresets.maintenance;
  const dates = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const days = dates.map((date) => {
    const dayEntries = entries.filter((entry) => entry.consumedAt.slice(0, 10) === date);
    const totals = summarizeEntryTotals(dayEntries);
    const activities = activitiesByDate.get(date) ?? [];
    const activityTotals = summarizeGarminActivities(activities);
    const garminSummary = getGarminCachedSummary(date);
    const calorieTarget = calculateEffectiveCalorieGoal(
      nutritionConfig.calorieGoal,
      nutritionConfig.calorieGoalOffset,
      garminSummary?.configured ? garminSummary.activeKilocalories : undefined,
    );
    const macroTargets = calculateMacroTargets(calorieTarget, preset);
    return {
      date,
      entryCount: dayEntries.length,
      totals,
      activities,
      activityTotals,
      calorieTarget,
      macroTargets,
    };
  });
  const loggedDays = days.filter((day) => day.entryCount > 0);
  const totals = loggedDays.reduce((sum, day) => ({
    calories: sum.calories + day.totals.calories,
    grams: sum.grams + day.totals.grams,
    protein: sum.protein + day.totals.protein,
    carbs: sum.carbs + day.totals.carbs,
    fat: sum.fat + day.totals.fat,
    alcoholCalories: sum.alcoholCalories + day.totals.alcoholCalories,
    activityCalories: sum.activityCalories + day.activityTotals.calories,
    activityDurationMinutes: sum.activityDurationMinutes + day.activityTotals.durationMinutes,
    activityCount: sum.activityCount + day.activityTotals.count,
    calorieTarget: sum.calorieTarget + day.calorieTarget,
    proteinTarget: sum.proteinTarget + day.macroTargets.protein.grams,
    carbsTarget: sum.carbsTarget + day.macroTargets.carbs.grams,
    fatTarget: sum.fatTarget + day.macroTargets.fat.grams,
    entryCount: sum.entryCount + day.entryCount,
  }), {
    calories: 0,
    grams: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    alcoholCalories: 0,
    activityCalories: 0,
    activityDurationMinutes: 0,
    activityCount: 0,
    calorieTarget: 0,
    proteinTarget: 0,
    carbsTarget: 0,
    fatTarget: 0,
    entryCount: 0,
  });
  const signal = calculateTrafficLight(days, totals);

  return {
    weekStart,
    weekEnd,
    goal: nutritionConfig.goal,
    goalLabel: preset.label,
    loggedDayCount: loggedDays.length,
    days,
    activities: garminActivities,
    totals,
    signal,
  };
}

async function sendWeeklyAnalysisEmail(weekStart) {
  const mailConfig = getWeeklyEmailConfig();
  const smtpConfig = getSmtpConfig();
  const aiConfig = getAnalysisAiConfigRecord();

  if (!mailConfig.targetEmail) return { skipped: true, reason: "no target email configured" };
  if (!smtpConfig.host || !smtpConfig.port) return { skipped: true, reason: "SMTP_HOST or SMTP_PORT missing" };
  if (!aiConfig.apiKey) return { skipped: true, reason: "analysis AI API key missing" };

  const analysis = await analyzeWeekManually({ weekStart });
  const transporter = nodemailer.createTransport({
    host: smtpConfig.host,
    port: smtpConfig.port,
    secure: smtpConfig.secure,
    auth: smtpConfig.user || smtpConfig.pass ? { user: smtpConfig.user, pass: smtpConfig.pass } : undefined,
  });
  await transporter.sendMail({
    from: smtpConfig.from,
    to: mailConfig.targetEmail,
    subject: `Food Tracker Wochenanalyse ${formatDate(analysis.weekStart)} - ${formatDate(analysis.weekEnd)}`,
    text: buildWeeklyEmailText(analysis),
    html: buildWeeklyEmailHtml(analysis),
  });

  return { sent: true };
}

async function generateWeeklyAiText(summary) {
  const config = getAnalysisAiConfigRecord();
  const provider = aiProviders.get(config.provider);
  if (!provider) throw new Error("Analysis AI provider is not configured");
  if (!config.apiKey) throw new Error("API key fehlt in der Analyse-Konfiguration");
  validateProviderKeyPair(config.provider, config.apiKey);
  const promptPayload = await buildWeeklyPromptPayload(summary);

  const response = await fetch(provider.endpoint, {
    method: "POST",
    headers: {
      authorization: "Bearer " + config.apiKey,
      "content-type": "application/json",
      ...(config.provider === "openrouter" ? {
        "HTTP-Referer": "http://localhost:5173",
        "X-Title": "Food Tracker",
      } : {}),
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.35,
      response_format: { type: "json_object" },
      ...(config.provider === "openrouter" ? { usage: { include: true } } : {}),
      messages: [
        {
          role: "system",
          content: [
            "Du bist ein pragmatischer deutschsprachiger Nutrition-Coach.",
            "Antworte ausschliesslich als JSON ohne Markdown.",
            "Erstelle eine klar strukturierte, tiefgreifende Wochenanalyse statt einer Textwand.",
            "Bewerte Zielunterstuetzung, Kalorien, Makros, Art der Lebensmittel, Mahlzeitenmuster, Essenszeiten, Ausgewogenheit, Alkohol und Garmin-Sportaktivitaeten.",
            "Leite Gewohnheiten aus Wiederholungen, Tageszeiten, Mahlzeitengroessen und Sport/Ernaehrungs-Zusammenspiel ab.",
            "Gib konkrete Lebensmittellisten: Fettquellen wie Olivenoel, Nuesse/Saaten, Avocado, fetter Fisch, Eier oder Milchprodukte wenn passend; Proteinquellen; ballaststoffreiche Carbs und Gemuese.",
            "Plane die kommende Woche mit einfachen Mahlzeiten und einem realistischen Sport-/Aktivitaetsplan aus Garmin-Historie und Ziel.",
            "Wenn previousAnalysis vorhanden ist, bewerte explizit, ob Empfehlungen und Wochenplan der Vorwoche in der aktuellen Woche umgesetzt wurden.",
            "Nutze fuer diese Follow-up-Bewertung nur aktuelle Wochendaten und die gespeicherte Vorwochenanalyse.",
            "Nutze Kalenderdaten nur als Tagesrhythmus/Frei-Besetzt-Kontext und erwaehne keine Termindetails.",
            "Keine medizinischen Diagnosen. Ton: normaler Ernaehrungs-Coach, direkt, freundlich, nicht streng.",
            "Schema: {summary:string, positives:string[], patterns:string[], followUp:{status:'umgesetzt'|'teilweise'|'nicht umgesetzt'|'keine Vorwoche',summary:string,evidence:string[]}, recommendations:[{title:string,details:string}], timing:string[], macros:string[], alcohol:string, garmin:string, nextWeekPlan:{meals:string[],activity:string[]}, text:string}.",
            "summary: 1-2 Saetze. Listen jeweils 2-5 kurze, konkrete Punkte. recommendations details maximal 180 Zeichen.",
          ].join(" "),
        },
        {
          role: "user",
          content: "Analysiere diese Woche: " + JSON.stringify(promptPayload),
        },
      ],
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(payload?.error?.message ?? "AI analysis failed"));

  const parsed = parseJsonObject(payload?.choices?.[0]?.message?.content);
  const sections = normalizeWeeklyAiSections(parsed, summary);
  const text = buildWeeklyAnalysisPlainText(sections);
  if (!text) throw new Error("AI response could not be understood");

  return {
    text: text.slice(0, 6000),
    sections,
    provider: config.provider,
    model: config.model,
    aiUsage: await buildAiUsageSnapshot(config, payload),
  };
}

async function buildWeeklyPromptPayload(summary) {
  return {
    weekStart: summary.weekStart,
    weekEnd: summary.weekEnd,
    goal: summary.goalLabel,
    signal: summary.signal,
    loggedDayCount: summary.loggedDayCount,
    totals: roundWeeklyNumbers(summary.totals),
    days: summary.days.map((day) => ({
      date: day.date,
      entryCount: day.entryCount,
      totals: roundWeeklyNumbers(day.totals),
      meals: buildDayMealPayload(day.date),
      timing: buildDayTimingPayload(day.date),
      foodProfile: buildDayFoodProfilePayload(day.date),
      activityTotals: roundWeeklyNumbers(day.activityTotals),
      activities: day.activities.map(compactGarminActivity),
      calorieTarget: Math.round(day.calorieTarget),
      macroTargets: {
        protein: day.macroTargets.protein.grams,
        carbs: day.macroTargets.carbs.grams,
        fat: day.macroTargets.fat.grams,
      },
    })),
    habits: buildWeeklyHabitPayload(summary.weekStart),
    activityTotals: roundWeeklyNumbers({
      calories: summary.totals.activityCalories,
      durationMinutes: summary.totals.activityDurationMinutes,
      count: summary.totals.activityCount,
    }),
    previousAnalysis: buildPreviousWeeklyAnalysisPromptPayload(summary.weekStart),
    calendarContext: await fetchCalendarContextForAnalysis(summary.weekEnd),
  };
}

function normalizeWeeklyAiSections(parsed, summary) {
  const nextWeekPlan = parsed?.nextWeekPlan && typeof parsed.nextWeekPlan === "object" ? parsed.nextWeekPlan : {};
  return {
    summary: textValue(parsed?.summary || parsed?.text, fallbackWeeklySummary(summary), 520),
    positives: normalizeTextList(parsed?.positives, 5, fallbackPositives(summary)),
    patterns: normalizeTextList(parsed?.patterns, 5, fallbackPatterns(summary)),
    followUp: normalizeFollowUp(parsed?.followUp, summary),
    recommendations: normalizeRecommendationList(parsed?.recommendations, fallbackRecommendations(summary)),
    timing: normalizeTextList(parsed?.timing, 5, fallbackTiming(summary)),
    macros: normalizeTextList(parsed?.macros, 5, fallbackMacros(summary)),
    alcohol: textValue(parsed?.alcohol, fallbackAlcohol(summary), 420),
    garmin: textValue(parsed?.garmin, fallbackGarmin(summary), 520),
    nextWeekPlan: {
      meals: normalizeTextList(nextWeekPlan.meals, 7, fallbackMealPlan(summary)),
      activity: normalizeTextList(nextWeekPlan.activity, 5, fallbackActivityPlan(summary)),
    },
  };
}

function normalizeTextList(value, limit, fallback = []) {
  const source = Array.isArray(value) ? value : [];
  const items = source.map((item) => textValue(item, "", 220)).filter(Boolean);
  return (items.length > 0 ? items : fallback).slice(0, limit);
}

function normalizeRecommendationList(value, fallback = []) {
  const source = Array.isArray(value) ? value : [];
  const recommendations = source.map((item) => {
    if (typeof item === "string") return { title: item.slice(0, 80), details: "" };
    return {
      title: textValue(item?.title, "", 80),
      details: textValue(item?.details, "", 220),
    };
  }).filter((item) => item.title || item.details);
  return (recommendations.length > 0 ? recommendations : fallback).slice(0, 5);
}

function textValue(value, fallback = "", limit = 300) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return (text || fallback).slice(0, limit);
}

function buildWeeklyAnalysisPlainText(sections) {
  return [
    "Kurzfazit",
    sections.summary,
    "",
    "Was gut lief",
    ...sections.positives.map((item) => "- " + item),
    "",
    "Muster und Stolperstellen",
    ...sections.patterns.map((item) => "- " + item),
    "",
    "Vorwochen-Follow-up",
    `${sections.followUp.status}: ${sections.followUp.summary}`,
    ...sections.followUp.evidence.map((item) => "- " + item),
    "",
    "Konkrete Empfehlungen",
    ...sections.recommendations.map((item) => `- ${item.title}${item.details ? ": " + item.details : ""}`),
    "",
    "Timing",
    ...sections.timing.map((item) => "- " + item),
    "",
    "Makros",
    ...sections.macros.map((item) => "- " + item),
    "",
    "Alkohol",
    sections.alcohol,
    "",
    "Garmin und Sport",
    sections.garmin,
    "",
    "Plan fuer kommende Woche - Essen",
    ...sections.nextWeekPlan.meals.map((item) => "- " + item),
    "",
    "Plan fuer kommende Woche - Aktivitaet",
    ...sections.nextWeekPlan.activity.map((item) => "- " + item),
  ].filter((line) => line !== null && line !== undefined).join("\n");
}

function normalizeFollowUp(value, summary) {
  const statusValues = new Set(["umgesetzt", "teilweise", "nicht umgesetzt", "keine Vorwoche"]);
  const status = statusValues.has(value?.status) ? value.status : (buildPreviousWeeklyAnalysisPromptPayload(summary.weekStart) ? "teilweise" : "keine Vorwoche");
  return {
    status,
    summary: textValue(value?.summary, fallbackFollowUp(summary), 420),
    evidence: normalizeTextList(value?.evidence, 5, []),
  };
}

function fallbackFollowUp(summary) {
  const previousAnalysis = buildPreviousWeeklyAnalysisPromptPayload(summary.weekStart);
  if (!previousAnalysis) return "Keine gespeicherte Vorwochenanalyse vorhanden, daher ist noch kein Umsetzungscheck moeglich.";
  return "Vorwochenempfehlungen wurden mit den aktuellen Wochendaten abgeglichen; Details sollten in der naechsten Analyse konkretisiert werden.";
}

function buildPreviousWeeklyAnalysisPromptPayload(weekStart) {
  const previous = getStoredWeeklyAnalysis(addDays(normalizeWeekStart(weekStart), -7));
  if (!previous) return null;
  return {
    weekStart: previous.weekStart,
    weekEnd: previous.weekEnd,
    signal: previous.signal,
    summary: previous.aiSections?.summary ?? previous.aiText?.slice(0, 700) ?? "",
    patterns: previous.aiSections?.patterns ?? [],
    recommendations: previous.aiSections?.recommendations ?? [],
    nextWeekPlan: previous.aiSections?.nextWeekPlan ?? { meals: [], activity: [] },
  };
}

function fallbackWeeklySummary(summary) {
  return `${summary.loggedDayCount} Tage wurden erfasst. Die Ampel steht auf ${summary.signal.label} mit ${summary.signal.score}/100 Punkten.`;
}

function fallbackPositives(summary) {
  const positives = [];
  if (summary.totals.protein >= summary.totals.proteinTarget * 0.85) positives.push("Protein lag nah am Wochenziel.");
  if (summary.totals.activityCount > 0) positives.push(`${Math.round(summary.totals.activityDurationMinutes)} Minuten Aktivitaet sind bereits ein guter Anker.`);
  if (summary.loggedDayCount >= 5) positives.push("Die meisten Tage sind erfasst, dadurch ist die Analyse belastbar.");
  return positives.length ? positives : ["Es gibt genug Daten, um konkrete Stellschrauben fuer die naechste Woche abzuleiten."];
}

function fallbackPatterns(summary) {
  const calorieDelta = Math.round(summary.totals.calories - summary.totals.calorieTarget);
  const patterns = [`Kalorien lagen insgesamt ${calorieDelta >= 0 ? "+" : ""}${calorieDelta} kcal zum Ziel.`];
  if (summary.totals.alcoholCalories > 0) patterns.push(`${Math.round(summary.totals.alcoholCalories)} kcal kamen aus Alkohol.`);
  if (summary.loggedDayCount < 7) patterns.push("Nicht alle Tage sind erfasst; fehlende Tage koennen die Wochenbilanz verzerren.");
  return patterns;
}

function fallbackRecommendations() {
  return [
    { title: "Fettquellen bewusst waehlen", details: "Olivenoel dosieren, Nuesse/Saaten portionieren, Avocado oder fetten Fisch gezielt statt nebenbei einbauen." },
    { title: "Protein pro Mahlzeit sichern", details: "Skyr, Quark, Eier, Huettenkaese, Fisch, Haehnchen, Tofu, Linsen oder Bohnen als festen Baustein planen." },
    { title: "Carbs ballaststoffreicher machen", details: "Haferflocken, Kartoffeln, Vollkornreis, Vollkornbrot, Bohnen und viel Gemuese bevorzugen." },
  ];
}

function fallbackTiming(summary) {
  const eveningCalories = summary.days.reduce((sum, day) => sum + Number(day.timing?.eveningCalories ?? 0), 0);
  return [
    eveningCalories > summary.totals.calories * 0.35
      ? "Ein groesserer Teil der Kalorien lag abends; tagsueber frueher Protein und Ballaststoffe einplanen."
      : "Timing wirkt nicht auffaellig; Mahlzeiten weiter regelmaessig erfassen.",
  ];
}

function fallbackMacros(summary) {
  return [
    `Protein: ${Math.round(summary.totals.protein)} g von ${Math.round(summary.totals.proteinTarget)} g.`,
    `Kohlenhydrate: ${Math.round(summary.totals.carbs)} g von ${Math.round(summary.totals.carbsTarget)} g.`,
    `Fett: ${Math.round(summary.totals.fat)} g von ${Math.round(summary.totals.fatTarget)} g.`,
  ];
}

function fallbackAlcohol(summary) {
  return summary.totals.alcoholCalories > 0
    ? `Alkohol war mit ${Math.round(summary.totals.alcoholCalories)} kcal sichtbar. Fuer Zieltreue am besten vorher ein Kalorienfenster setzen.`
    : "Kein relevanter Alkoholeintrag in dieser Woche.";
}

function fallbackGarmin(summary) {
  return summary.totals.activityCount > 0
    ? `${summary.totals.activityCount} Garmin-Einheiten mit ca. ${Math.round(summary.totals.activityDurationMinutes)} Minuten und ${Math.round(summary.totals.activityCalories)} aktiven kcal sind in der Analyse beruecksichtigt.`
    : "Keine Garmin-Aktivitaeten fuer diese Woche importiert; fuer genauere Sportempfehlungen Garmin aktualisieren.";
}

function fallbackMealPlan() {
  return [
    "Fruehstueck: Skyr oder Quark mit Beeren, Haferflocken und 10-15 g Nuesse/Saaten.",
    "Mittag: Reis- oder Kartoffel-Bowl mit Haehnchen, Tofu oder Bohnen plus viel Gemuese.",
    "Abend: Omelette, Fisch oder Huettenkaese mit Salat/Gemuese und dosierter Fettquelle wie Olivenoel oder Avocado.",
  ];
}

function fallbackActivityPlan(summary) {
  const hadActivities = summary.totals.activityCount > 0;
  return hadActivities
    ? ["2 lockere Einheiten aehnlich der letzten Woche wiederholen.", "1 zusaetzlicher Spaziergang oder lockere Zone-2-Einheit einplanen.", "Nach intensiveren Einheiten Protein und Carbs zeitnah einbauen."]
    : ["3 Spaziergaenge oder lockere Ausdauereinheiten von 25-40 Minuten einplanen.", "Optional 1 kurze Kraft-/Mobility-Einheit ergaenzen.", "Sportplan bewusst leicht halten, damit er realistisch bleibt."];
}

function buildDayMealPayload(date) {
  const entries = listEntriesForWeek(getWeekStart(date)).filter((entry) => entry.consumedAt.slice(0, 10) === date);
  const meals = new Map();
  for (const entry of entries) {
    const mealKey = entry.mealId || `${entry.consumedAt}:${entry.foodName}`;
    const meal = meals.get(mealKey) ?? {
      name: entry.mealName || entry.foodName,
      time: entry.consumedAt.slice(11, 16),
      items: [],
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
    };
    meal.items.push(entry.foodName);
    meal.calories += caloriesForEntry(entry);
    meal.protein += macroForEntry(entry, entry.proteinPer100g);
    meal.carbs += macroForEntry(entry, entry.carbsPer100g);
    meal.fat += macroForEntry(entry, entry.fatPer100g);
    meals.set(mealKey, meal);
  }

  return [...meals.values()].map((meal) => ({
    ...meal,
    calories: Math.round(meal.calories),
    protein: roundNutrition(meal.protein),
    carbs: roundNutrition(meal.carbs),
    fat: roundNutrition(meal.fat),
    items: meal.items.slice(0, 8),
  }));
}

function buildDayTimingPayload(date) {
  const meals = buildDayMealPayload(date);
  if (meals.length === 0) {
    return { firstMeal: null, lastMeal: null, mealCount: 0, eveningCalories: 0, largestMeal: null };
  }

  const largestMeal = meals.slice().sort((left, right) => right.calories - left.calories)[0];
  return {
    firstMeal: meals[0].time,
    lastMeal: meals[meals.length - 1].time,
    mealCount: meals.length,
    eveningCalories: Math.round(meals.filter((meal) => meal.time >= "18:00").reduce((sum, meal) => sum + meal.calories, 0)),
    largestMeal: largestMeal ? { name: largestMeal.name, time: largestMeal.time, calories: largestMeal.calories } : null,
  };
}

function buildDayFoodProfilePayload(date) {
  const entries = listEntriesForWeek(getWeekStart(date)).filter((entry) => entry.consumedAt.slice(0, 10) === date);
  const categories = {};
  for (const entry of entries) {
    const category = classifyFoodEntry(entry);
    categories[category] = (categories[category] ?? 0) + caloriesForEntry(entry);
  }

  return Object.fromEntries(Object.entries(categories).map(([category, calories]) => [category, Math.round(calories)]));
}

function buildWeeklyHabitPayload(weekStart) {
  const entries = listEntriesForWeek(weekStart);
  const foodCounts = new Map();
  const timeBuckets = { morning: 0, midday: 0, afternoon: 0, evening: 0, late: 0 };
  const categoryCalories = {};

  for (const entry of entries) {
    const foodKey = normalizeFoodKey(entry.foodName);
    foodCounts.set(foodKey, {
      name: entry.foodName,
      count: (foodCounts.get(foodKey)?.count ?? 0) + 1,
    });
    timeBuckets[classifyMealTime(entry.consumedAt.slice(11, 16))] += caloriesForEntry(entry);
    const category = classifyFoodEntry(entry);
    categoryCalories[category] = (categoryCalories[category] ?? 0) + caloriesForEntry(entry);
  }

  return {
    repeatedFoods: [...foodCounts.values()]
      .filter((food) => food.count > 1)
      .sort((left, right) => right.count - left.count)
      .slice(0, 8),
    timeBuckets: Object.fromEntries(Object.entries(timeBuckets).map(([key, value]) => [key, Math.round(value)])),
    categoryCalories: Object.fromEntries(Object.entries(categoryCalories).map(([key, value]) => [key, Math.round(value)])),
  };
}

function classifyFoodEntry(entry) {
  if (isAlcoholEntry(entry)) return "alcohol";
  const name = normalizeFoodKey(entry.foodName);
  if (/(skyr|quark|joghurt|huettenkaese|hüttenkäse|protein|haehnchen|hähnchen|thunfisch|ei|tofu|linsen|bohnen)/.test(name)) return "protein";
  if (/(apfel|banane|beeren|pfirsich|paprika|gemuese|gemüse|salat|tomate|gurke|brokkoli|karotte|obst)/.test(name)) return "fruit_vegetables";
  if (/(reis|nudel|pasta|kartoffel|brot|hafer|flocken|muesli|müsli|couscous|bulgur)/.test(name)) return "carbs_staples";
  if (/(nuss|nuesse|nüsse|oel|öl|butter|avocado|kaese|käse|sahne)/.test(name)) return "fat_rich";
  if (/(schokolade|keks|chips|pizza|burger|pommes|kuchen|eis|suess|süß|snack)/.test(name)) return "treats_processed";
  return "mixed_other";
}

function classifyMealTime(time) {
  if (time < "11:00") return "morning";
  if (time < "15:00") return "midday";
  if (time < "18:00") return "afternoon";
  if (time < "21:30") return "evening";
  return "late";
}

function groupGarminActivitiesByDate(activities) {
  const grouped = new Map();
  for (const activity of activities) {
    const date = String(activity.date ?? activity.startTimeLocal ?? "").slice(0, 10);
    if (!date) continue;
    const list = grouped.get(date) ?? [];
    list.push(activity);
    grouped.set(date, list);
  }
  return grouped;
}

function summarizeGarminActivities(activities) {
  return activities.reduce((sum, activity) => ({
    count: sum.count + 1,
    calories: sum.calories + Number(activity.calories ?? 0),
    durationMinutes: sum.durationMinutes + Number(activity.durationSeconds ?? activity.movingDurationSeconds ?? 0) / 60,
    distanceMeters: sum.distanceMeters + Number(activity.distanceMeters ?? 0),
  }), { count: 0, calories: 0, durationMinutes: 0, distanceMeters: 0 });
}

function compactGarminActivity(activity) {
  return {
    name: activity.activityName,
    type: activity.activityType,
    time: String(activity.startTimeLocal ?? "").slice(11, 16),
    calories: Math.round(Number(activity.calories ?? 0)),
    durationMinutes: Math.round(Number(activity.durationSeconds ?? activity.movingDurationSeconds ?? 0) / 60),
    distanceKm: roundNutrition(Number(activity.distanceMeters ?? 0) / 1000),
    averageHeartRate: activity.averageHeartRate,
  };
}

async function suggestCalorieIdeas(input) {
  const remainingCalories = clampNumber(input?.remainingCalories, -2000, 3000);
  const date = normalizeGarminDate(input?.date ?? todayInBerlin());
  if (!Number.isFinite(remainingCalories)) throw new Error("Invalid remaining calories");

  const fallbackIdeas = buildCalorieIdeaFallbacks(remainingCalories, date);
  const config = getAnalysisAiConfigRecord();
  const provider = aiProviders.get(config.provider);

  if (!provider || !config.apiKey || remainingCalories <= 80) {
    return fallbackIdeas;
  }

  try {
    validateProviderKeyPair(config.provider, config.apiKey);
    return await generateCalorieIdeasWithAi(provider, config, {
      date,
      remainingCalories: Math.round(remainingCalories),
      nutritionGoal: getNutritionConfig().goal,
      candidates: fallbackIdeas,
      recentFoods: buildRecentFoodIdeas(remainingCalories, 8),
      mealTemplates: buildMealTemplateIdeas(remainingCalories, 8),
    }, fallbackIdeas);
  } catch {
    return fallbackIdeas;
  }
}

async function generateCalorieIdeasWithAi(provider, config, promptPayload, fallbackIdeas) {
  const response = await fetch(provider.endpoint, {
    method: "POST",
    headers: {
      authorization: "Bearer " + config.apiKey,
      "content-type": "application/json",
      ...(config.provider === "openrouter" ? {
        "HTTP-Referer": "http://localhost:5173",
        "X-Title": "Food Tracker",
      } : {}),
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.25,
      response_format: { type: "json_object" },
      ...(config.provider === "openrouter" ? { usage: { include: true } } : {}),
      messages: [
        {
          role: "system",
          content: [
            "Du bist ein pragmatischer deutschsprachiger Nutrition-Coach.",
            "Antworte ausschliesslich als JSON ohne Markdown.",
            "Schlage kurze, schnelle Ideen vor, um Restkalorien sinnvoll aufzufuellen.",
            "Bevorzuge vorhandene Gewohnheiten, Mahlzeiten und Lebensmittel aus den Kandidaten.",
            "Ergaenze nur einfache alltagstaugliche Alternativen. Keine medizinischen Aussagen.",
            "Schema: {ideas:[{title:string, subtitle:string, calories:number, source:'habit'|'meal'|'quick'|'ai'}]}.",
            "Maximal 5 Ideen. title maximal 48 Zeichen, subtitle maximal 90 Zeichen.",
          ].join(" "),
        },
        {
          role: "user",
          content: "Erstelle Restkalorien-Ideen: " + JSON.stringify(promptPayload),
        },
      ],
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(payload?.error?.message ?? "AI ideas failed"));

  const parsed = parseJsonObject(payload?.choices?.[0]?.message?.content);
  const ideas = normalizeCalorieIdeas(parsed?.ideas, fallbackIdeas);
  return ideas.length > 0 ? ideas : fallbackIdeas;
}

function buildCalorieIdeaFallbacks(remainingCalories, date) {
  if (remainingCalories <= 0) {
    return [{
      title: "Ziel erreicht",
      subtitle: "Heute lieber leicht bleiben: Tee, Wasser oder Gemuese-Snack.",
      calories: 0,
      source: "quick",
    }];
  }

  if (remainingCalories <= 80) {
    return [{
      title: "Kleine Luecke",
      subtitle: "Obst, Rohkost oder einfach offen lassen.",
      calories: Math.max(0, Math.round(remainingCalories)),
      source: "quick",
    }];
  }

  const mealIdeas = buildMealTemplateIdeas(remainingCalories, 3);
  const recentIdeas = buildRecentFoodIdeas(remainingCalories, 4);
  const quickIdeas = buildQuickCalorieIdeas(remainingCalories, date);

  return dedupeCalorieIdeas([...mealIdeas, ...recentIdeas, ...quickIdeas]).slice(0, 5);
}

function buildMealTemplateIdeas(remainingCalories, limit = 5) {
  const favoriteKeys = new Set(listMealFavoriteKeys());
  return listMealTemplates()
    .map((meal) => {
      const calories = mealTemplateCalories(meal.items);
      const score = calorieFitScore(remainingCalories, calories) + (favoriteKeys.has(serverMealTemplateSignature(meal)) ? 24 : 0);
      return {
        idea: {
          title: meal.name,
          subtitle: `${meal.items.length} Lebensmittel aus deinen Vorlagen`,
          calories,
          source: "meal",
        },
        score,
      };
    })
    .filter(({ idea }) => idea.calories > 0 && idea.calories <= remainingCalories + 220)
    .sort((left, right) => right.score - left.score)
    .map(({ idea }) => idea)
    .slice(0, limit);
}

function buildRecentFoodIdeas(remainingCalories, limit = 5) {
  const usage = new Map();
  for (const entry of listEntries().slice(0, 500)) {
    if (entry.mealId) continue;
    const key = normalizeFoodKey(entry.foodKey || entry.foodName);
    if (!key || entry.caloriesPer100g <= 0) continue;
    const current = usage.get(key) ?? {
      entry,
      count: 0,
      latest: "",
    };
    current.count += 1;
    if (entry.consumedAt > current.latest) {
      current.entry = entry;
      current.latest = entry.consumedAt;
    }
    usage.set(key, current);
  }

  return [...usage.values()]
    .map(({ entry, count, latest }) => {
      const targetCalories = Math.min(Math.max(remainingCalories * 0.72, 140), remainingCalories);
      const grams = Math.round((targetCalories / entry.caloriesPer100g) * 100);
      const boundedGrams = Math.min(450, Math.max(40, grams));
      const calories = Math.round((boundedGrams / 100) * entry.caloriesPer100g);
      return {
        idea: {
          title: entry.foodName,
          subtitle: `${boundedGrams.toLocaleString("de-DE")} g · haeufig genutzt`,
          calories,
          source: "habit",
        },
        score: calorieFitScore(remainingCalories, calories) + Math.min(30, count * 5) + (latest ? 8 : 0),
      };
    })
    .filter(({ idea }) => idea.calories >= 80 && idea.calories <= remainingCalories + 160)
    .sort((left, right) => right.score - left.score)
    .map(({ idea }) => idea)
    .slice(0, limit);
}

function buildQuickCalorieIdeas(remainingCalories) {
  const quickIdeas = [
    { title: "Skyr, Banane, Haferflocken", subtitle: "Schnell, proteinreich, gut planbar", calories: 420 },
    { title: "Magerquark mit Beeren", subtitle: "Leicht, proteinreich, in 3 Minuten fertig", calories: 320 },
    { title: "Vollkornbrot mit Huettenkaese", subtitle: "Satt, salzig, ohne Kochen", calories: 360 },
    { title: "Omelette mit Gemuese", subtitle: "Warm, proteinreich, flexibel", calories: 430 },
    { title: "Joghurt, Apfel, Nuesse", subtitle: "Kleiner Snack mit Fett und Ballaststoffen", calories: 300 },
    { title: "Reis, Ei, TK-Gemuese", subtitle: "Einfache Bowl aus Vorrat", calories: 520 },
    { title: "Proteinshake und Obst", subtitle: "Sehr schnell nach Training oder spaet abends", calories: 260 },
  ];

  return quickIdeas
    .filter((idea) => idea.calories <= remainingCalories + 180)
    .sort((left, right) => calorieFitScore(remainingCalories, right.calories) - calorieFitScore(remainingCalories, left.calories))
    .map((idea) => ({ ...idea, source: "quick" }));
}

function normalizeCalorieIdeas(rawIdeas, fallbackIdeas) {
  if (!Array.isArray(rawIdeas)) return fallbackIdeas;
  return dedupeCalorieIdeas(rawIdeas.map((idea) => ({
    title: String(idea?.title ?? "").trim().slice(0, 60),
    subtitle: String(idea?.subtitle ?? "").trim().slice(0, 110),
    calories: Math.round(clampNumber(idea?.calories, 0, 3000)),
    source: ["habit", "meal", "quick", "ai"].includes(idea?.source) ? idea.source : "ai",
  })).filter((idea) => idea.title && idea.subtitle)).slice(0, 5);
}

function dedupeCalorieIdeas(ideas) {
  const seen = new Set();
  return ideas.filter((idea) => {
    const key = normalizeFoodKey(idea.title);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function calorieFitScore(remainingCalories, calories) {
  const distance = Math.abs(remainingCalories - calories);
  return Math.max(0, 100 - Math.round((distance / Math.max(remainingCalories, 1)) * 100));
}

function mealTemplateCalories(items) {
  return Math.round(items.reduce((sum, item) => sum + entryCalories(item), 0));
}

function entryCalories(entry) {
  return (entryGrams(entry) / 100) * Number(entry.caloriesPer100g ?? 0);
}

function entryGrams(entry) {
  const value = Number(entry.quantityValue ?? 0);
  return entry.quantityUnit === "kg" ? value * 1000 : value;
}

function serverMealTemplateSignature(meal) {
  const items = meal.items
    .map((item) => normalizeFoodKey(item.foodName))
    .sort((left, right) => left.localeCompare(right, "de"))
    .join("|");
  return `${normalizeFoodKey(meal.name)}::${items}`;
}

function roundWeeklyNumbers(value) {
  return Object.fromEntries(Object.entries(value).map(([key, numberValue]) => [
    key,
    Math.round(Number(numberValue) * 10) / 10,
  ]));
}

function calculateTrafficLight(days, totals) {
  const calorieTarget = Math.max(1, totals.calorieTarget);
  const calorieDeviation = Math.abs(totals.calories - totals.calorieTarget) / calorieTarget;
  const proteinRatio = totals.proteinTarget > 0 ? totals.protein / totals.proteinTarget : 1;
  const filledDays = days.filter((day) => day.entryCount > 0).length;
  const severeOutliers = days.filter((day) => {
    if (day.entryCount === 0) return false;
    const target = Math.max(1, day.calorieTarget);
    return Math.abs(day.totals.calories - target) / target > 0.35;
  }).length;

  let score = 100;
  score -= Math.min(35, calorieDeviation * 100);
  score -= proteinRatio < 0.85 ? Math.min(20, (0.85 - proteinRatio) * 100) : 0;
  score -= (7 - filledDays) * 8;
  score -= severeOutliers * 5;

  const label = score >= 78 ? "gut" : score >= 55 ? "okay" : "schlecht";
  const message = label === "gut"
    ? "Die Woche liegt nah am Ziel."
    : label === "okay"
      ? "Die Woche ist solide, hat aber klare Stellschrauben."
      : "Die Woche weicht deutlich von den Zielen ab.";

  return {
    label,
    score: Math.max(0, Math.min(100, Math.round(score))),
    message,
  };
}

function buildWeeklyEmailText(analysis) {
  const sectionsText = analysis.aiSections ? buildWeeklyAnalysisPlainText(analysis.aiSections) : analysis.aiText;
  return [
    `Food Tracker Wochenanalyse ${formatDate(analysis.weekStart)} - ${formatDate(analysis.weekEnd)}`,
    `Ampel: ${analysis.signal.label} (${analysis.signal.score}/100). ${analysis.signal.message}`,
    "",
    sectionsText,
    "",
    "Wochensummen",
    `Kalorien: ${Math.round(analysis.totals.calories)} von ${Math.round(analysis.totals.calorieTarget)} kcal`,
    `Protein: ${Math.round(analysis.totals.protein)} von ${Math.round(analysis.totals.proteinTarget)} g`,
    `Kohlenhydrate: ${Math.round(analysis.totals.carbs)} von ${Math.round(analysis.totals.carbsTarget)} g`,
    `Fett: ${Math.round(analysis.totals.fat)} von ${Math.round(analysis.totals.fatTarget)} g`,
  ].join("\n");
}

function buildWeeklyEmailHtml(analysis) {
  const charts = [
    ["Kalorien", "kcal", "calories", "calorieTarget"],
    ["Protein", "g", "protein", "proteinTarget"],
    ["Kohlenhydrate", "g", "carbs", "carbsTarget"],
    ["Fett", "g", "fat", "fatTarget"],
  ].map(([label, suffix, key, targetKey]) => buildEmailChart(analysis, label, suffix, key, targetKey)).join("");
  const signalColor = analysis.signal.label === "gut" ? "#236245" : analysis.signal.label === "okay" ? "#9a6b16" : "#a43d20";

  return `<!doctype html>
<html lang="de">
  <body style="margin:0;background:#f5efe2;color:#17211b;font-family:Arial,sans-serif;">
    <div style="max-width:760px;margin:0 auto;padding:24px;">
      <p style="margin:0 0 8px;color:#627064;font-weight:700;text-transform:uppercase;letter-spacing:.04em;">Food Tracker</p>
      <h1 style="margin:0 0 8px;font-size:28px;">Wochenanalyse ${escapeHtml(formatDate(analysis.weekStart))} - ${escapeHtml(formatDate(analysis.weekEnd))}</h1>
      <div style="margin:16px 0;padding:14px 16px;border-radius:8px;background:#fffaf0;border:1px solid rgba(23,33,27,.12);">
        <strong style="color:${signalColor};text-transform:uppercase;">${escapeHtml(analysis.signal.label)} · ${analysis.signal.score}/100</strong>
        <p style="margin:8px 0 0;">${escapeHtml(analysis.signal.message)}</p>
      </div>
      ${analysis.aiSections ? buildWeeklyEmailSectionsHtml(analysis.aiSections) : `<div style="margin:16px 0;padding:16px;border-radius:8px;background:#eef5f0;border:1px solid rgba(23,33,27,.12);line-height:1.5;">${escapeHtml(analysis.aiText).replace(/\n/g, "<br>")}</div>`}
      ${charts}
    </div>
  </body>
</html>`;
}

function buildWeeklyEmailSectionsHtml(sections) {
  return [
    buildEmailTextSection("Kurzfazit", sections.summary),
    buildEmailListSection("Was gut lief", sections.positives),
    buildEmailListSection("Muster und Stolperstellen", sections.patterns),
    buildEmailFollowUpSection(sections.followUp),
    buildEmailRecommendationSection(sections.recommendations),
    buildEmailListSection("Timing", sections.timing),
    buildEmailListSection("Makros", sections.macros),
    buildEmailTextSection("Alkohol", sections.alcohol),
    buildEmailTextSection("Garmin und Sport", sections.garmin),
    buildEmailListSection("Plan fuer kommende Woche: Essen", sections.nextWeekPlan?.meals ?? []),
    buildEmailListSection("Plan fuer kommende Woche: Aktivitaet", sections.nextWeekPlan?.activity ?? []),
  ].join("");
}

function buildEmailTextSection(title, text) {
  if (!text) return "";
  return `<section style="margin:14px 0;padding:16px;border-radius:8px;background:#eef5f0;border:1px solid rgba(23,33,27,.12);line-height:1.5;">
    <h2 style="margin:0 0 8px;font-size:18px;">${escapeHtml(title)}</h2>
    <p style="margin:0;">${escapeHtml(text)}</p>
  </section>`;
}

function buildEmailListSection(title, items) {
  if (!Array.isArray(items) || items.length === 0) return "";
  return `<section style="margin:14px 0;padding:16px;border-radius:8px;background:#fffaf0;border:1px solid rgba(23,33,27,.12);line-height:1.5;">
    <h2 style="margin:0 0 8px;font-size:18px;">${escapeHtml(title)}</h2>
    <ul style="margin:0;padding-left:20px;">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
  </section>`;
}

function buildEmailFollowUpSection(followUp) {
  if (!followUp?.summary) return "";
  return `<section style="margin:14px 0;padding:16px;border-radius:8px;background:#eef5f0;border:1px solid rgba(23,33,27,.12);line-height:1.5;">
    <h2 style="margin:0 0 8px;font-size:18px;">Vorwochen-Follow-up: ${escapeHtml(followUp.status)}</h2>
    <p style="margin:0 0 8px;">${escapeHtml(followUp.summary)}</p>
    ${Array.isArray(followUp.evidence) && followUp.evidence.length > 0 ? `<ul style="margin:0;padding-left:20px;">${followUp.evidence.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : ""}
  </section>`;
}

function buildEmailRecommendationSection(items) {
  if (!Array.isArray(items) || items.length === 0) return "";
  return `<section style="margin:14px 0;padding:16px;border-radius:8px;background:#fffaf0;border:1px solid rgba(23,33,27,.12);line-height:1.5;">
    <h2 style="margin:0 0 8px;font-size:18px;">Konkrete Empfehlungen</h2>
    ${items.map((item) => `<p style="margin:0 0 8px;"><strong>${escapeHtml(item.title)}</strong>${item.details ? `<br>${escapeHtml(item.details)}` : ""}</p>`).join("")}
  </section>`;
}

function buildEmailChart(analysis, label, suffix, key, targetKey) {
  const maxValue = Math.max(1, ...analysis.days.flatMap((day) => [
    Number(day.totals[key] ?? 0),
    key === "calories" ? day.calorieTarget : day.macroTargets[key].grams,
  ])) * 1.12;
  const bars = analysis.days.map((day) => {
    const actual = Number(day.totals[key] ?? 0);
    const target = key === "calories" ? day.calorieTarget : day.macroTargets[key].grams;
    const height = Math.max(3, Math.round((actual / maxValue) * 128));
    const targetBottom = Math.min(128, Math.max(0, Math.round((target / maxValue) * 128)));
    const isOver = actual > target;
    return `<td style="width:14.28%;padding:0 4px;vertical-align:bottom;text-align:center;">
      <div style="position:relative;height:128px;background:#ece7dc;border:1px solid rgba(23,33,27,.12);border-radius:7px;overflow:hidden;">
        <div style="position:absolute;left:0;right:0;bottom:0;height:${height}px;background:${isOver ? "#d5512a" : "#2f8d5b"};"></div>
        <div style="position:absolute;left:0;right:0;bottom:${targetBottom}px;height:2px;background:#17211b;"></div>
      </div>
      <div style="margin-top:6px;font-size:11px;font-weight:700;">${escapeHtml(formatWeekdayShort(day.date))}</div>
      <div style="font-size:10px;color:#627064;">${Math.round(actual)} / ${Math.round(target)}</div>
    </td>`;
  }).join("");
  const delta = Math.round(Number(analysis.totals[key]) - Number(analysis.totals[targetKey]));
  return `<section style="margin:16px 0;padding:16px;border-radius:8px;background:#fffaf0;border:1px solid rgba(23,33,27,.12);">
    <div style="display:flex;justify-content:space-between;gap:12px;margin-bottom:12px;">
      <strong>${escapeHtml(label)}</strong>
      <strong style="color:${delta > 0 ? "#a43d20" : delta < 0 ? "#236245" : "#627064"};">${delta > 0 ? "+" : ""}${delta} ${escapeHtml(suffix)}</strong>
    </div>
    <table role="presentation" style="width:100%;border-collapse:collapse;"><tr>${bars}</tr></table>
  </section>`;
}

async function fetchCalendarContextForAnalysis(weekEnd) {
  const config = getCalendarConfig();
  if (!config.enabled) return { enabled: false, reason: config.reason };

  const start = addDays(weekEnd, 1);
  const days = config.lookaheadDays;
  const end = addDays(start, days);
  try {
    const events = await fetchCalDavBusyEvents(config, start, end);
    return summarizeCalendarBusyContext(events, start, days);
  } catch (error) {
    return {
      enabled: true,
      available: false,
      reason: "calendar_fetch_failed",
      error: error instanceof Error ? error.message.slice(0, 120) : "Calendar fetch failed",
    };
  }
}

function getCalendarConfig() {
  const url = String(process.env.CALDAV_URL ?? process.env.SOGO_CALDAV_URL ?? "").trim();
  const user = String(process.env.CALDAV_USER ?? process.env.SOGO_CALDAV_USER ?? "").trim();
  const pass = String(process.env.CALDAV_PASS ?? process.env.SOGO_CALDAV_PASS ?? "");
  const lookaheadDays = Math.min(21, Math.max(7, Number(process.env.CALENDAR_LOOKAHEAD_DAYS ?? 14) || 14));
  if (!url || !user || !pass) {
    return { enabled: false, reason: "CALDAV_URL/CALDAV_USER/CALDAV_PASS missing", lookaheadDays };
  }
  return { enabled: true, url, user, pass, lookaheadDays };
}

async function fetchCalDavBusyEvents(config, startDate, endDate) {
  const startUtc = toCalDavUtc(startDate, "00:00:00");
  const endUtc = toCalDavUtc(endDate, "00:00:00");
  const body = `<?xml version="1.0" encoding="utf-8" ?>
<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop><D:getetag/><C:calendar-data/></D:prop>
  <C:filter>
    <C:comp-filter name="VCALENDAR">
      <C:comp-filter name="VEVENT">
        <C:time-range start="${startUtc}" end="${endUtc}"/>
      </C:comp-filter>
    </C:comp-filter>
  </C:filter>
</C:calendar-query>`;
  const response = await fetch(config.url, {
    method: "REPORT",
    headers: {
      authorization: "Basic " + Buffer.from(`${config.user}:${config.pass}`).toString("base64"),
      "content-type": "application/xml; charset=utf-8",
      depth: "1",
    },
    body,
  });
  if (!response.ok) throw new Error(`CalDAV ${response.status}`);
  const xml = await response.text();
  return parseCalendarDataBlocks(xml)
    .flatMap(parseIcsBusyEvents)
    .filter((event) => event.end > `${startDate}T00:00` && event.start < `${endDate}T00:00`);
}

function parseCalendarDataBlocks(xml) {
  const blocks = [];
  const pattern = /<(?:[^:>]+:)?calendar-data[^>]*>([\s\S]*?)<\/(?:[^:>]+:)?calendar-data>/gi;
  let match;
  while ((match = pattern.exec(xml))) {
    blocks.push(decodeXmlEntities(match[1]));
  }
  return blocks;
}

function parseIcsBusyEvents(ics) {
  const unfolded = String(ics ?? "").replace(/\r?\n[ \t]/g, "");
  const events = [];
  const pattern = /BEGIN:VEVENT([\s\S]*?)END:VEVENT/g;
  let match;
  while ((match = pattern.exec(unfolded))) {
    const eventText = match[1];
    if (/TRANSP(?:;[^:]*)?:TRANSPARENT/i.test(eventText)) continue;
    if (/STATUS(?:;[^:]*)?:CANCELLED/i.test(eventText)) continue;
    const start = parseIcsDateTime(readIcsProperty(eventText, "DTSTART"));
    const end = parseIcsDateTime(readIcsProperty(eventText, "DTEND")) || start;
    if (!start || !end) continue;
    events.push({ start, end, minutes: diffMinutes(start, end), partOfDay: classifyBusyPartOfDay(start.slice(11, 16)) });
  }
  return events;
}

function readIcsProperty(eventText, name) {
  const pattern = new RegExp(`^${name}(?:;[^:]*)?:(.+)$`, "im");
  return eventText.match(pattern)?.[1]?.trim() ?? "";
}

function parseIcsDateTime(value) {
  const raw = String(value ?? "").trim();
  if (/^\d{8}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T00:00`;
  const match = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?Z?$/);
  if (!match) return "";
  const [, year, month, day, hour, minute] = match;
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function summarizeCalendarBusyContext(events, startDate, days) {
  const dates = Array.from({ length: days }, (_, index) => addDays(startDate, index));
  const byDate = dates.map((date) => {
    const dayEvents = events.filter((event) => event.start.slice(0, 10) === date);
    const byPart = { morning: 0, midday: 0, afternoon: 0, evening: 0 };
    for (const event of dayEvents) byPart[event.partOfDay] += Math.max(0, event.minutes);
    return {
      date,
      busyBlocks: dayEvents.length,
      busyMinutes: Math.round(dayEvents.reduce((sum, event) => sum + Math.max(0, event.minutes), 0)),
      busyParts: Object.fromEntries(Object.entries(byPart).filter(([, minutes]) => minutes > 0)),
    };
  });
  return {
    enabled: true,
    available: true,
    privacy: "busy_blocks_only_no_titles",
    rangeStart: startDate,
    rangeEnd: addDays(startDate, days - 1),
    days: byDate,
  };
}

function toCalDavUtc(date, time) {
  return `${date.replace(/-/g, "")}T${time.replace(/:/g, "")}Z`;
}

function diffMinutes(start, end) {
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return 0;
  return Math.round((endMs - startMs) / 60000);
}

function classifyBusyPartOfDay(time) {
  if (time < "11:00") return "morning";
  if (time < "15:00") return "midday";
  if (time < "18:00") return "afternoon";
  return "evening";
}

function decodeXmlEntities(value) {
  return String(value ?? "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function getSmtpConfig() {
  const port = Number(process.env.SMTP_PORT ?? "");
  return {
    host: String(process.env.SMTP_HOST ?? "").trim(),
    port: Number.isFinite(port) ? port : 0,
    secure: String(process.env.SMTP_SECURE ?? "").toLowerCase() === "true",
    user: String(process.env.SMTP_USER ?? "").trim(),
    pass: String(process.env.SMTP_PASS ?? ""),
    from: String(process.env.SMTP_FROM ?? "Food Tracker <food-tracker@localhost>").trim(),
  };
}

function hasWeeklyEmailBeenSent(weekStart) {
  const row = getFoodDatabase()
    .prepare("SELECT week_start FROM weekly_email_log WHERE week_start = ?")
    .get(weekStart);
  return Boolean(row);
}

function markWeeklyEmailSent(weekStart) {
  getFoodDatabase()
    .prepare([
      "INSERT INTO weekly_email_log (week_start, sent_at)",
      "VALUES (?, datetime('now'))",
      "ON CONFLICT(week_start) DO UPDATE SET sent_at = excluded.sent_at",
    ].join("\n"))
    .run(weekStart);
}

function listEntriesForWeek(weekStart) {
  const weekEndExclusive = addDays(weekStart, 7);
  const rows = getFoodDatabase()
    .prepare([
      "SELECT",
      "  id, food_key, food_name, quantity_value, quantity_unit, calories_per_100g,",
      "  protein_per_100g, carbs_per_100g, fat_per_100g, consumed_at, created_at, source, ai_usage_json,",
      "  meal_id, meal_name, image_data_url, alcohol_vol_percent, alcohol_grams, alcohol_calories",
      "FROM entries",
      "WHERE substr(consumed_at, 1, 10) >= ? AND substr(consumed_at, 1, 10) < ?",
      "ORDER BY consumed_at ASC, created_at ASC",
    ].join("\n"))
    .all(weekStart, weekEndExclusive);
  return rows.map(entryFromRow);
}

function summarizeEntryTotals(entries) {
  return entries.reduce((sum, entry) => ({
    calories: sum.calories + caloriesForEntry(entry),
    grams: sum.grams + gramsForEntry(entry),
    protein: sum.protein + macroForEntry(entry, entry.proteinPer100g),
    carbs: sum.carbs + macroForEntry(entry, entry.carbsPer100g),
    fat: sum.fat + macroForEntry(entry, entry.fatPer100g),
    alcoholCalories: sum.alcoholCalories + alcoholCaloriesForEntry(entry),
  }), { calories: 0, grams: 0, protein: 0, carbs: 0, fat: 0, alcoholCalories: 0 });
}

function calculateMacroTargets(calorieGoal, preset) {
  return {
    protein: macroTarget(calorieGoal, preset.protein, 4),
    carbs: macroTarget(calorieGoal, preset.carbs, 4),
    fat: macroTarget(calorieGoal, preset.fat, 9),
  };
}

function calculateEffectiveCalorieGoal(baseCalorieGoal, calorieGoalOffset = 0, activeKilocalories = 0) {
  const activeCalories = Number.isFinite(activeKilocalories) ? activeKilocalories : 0;
  return Math.max(minimumCalorieGoal, Math.round(baseCalorieGoal + activeCalories + calorieGoalOffset));
}

function macroTarget(calorieGoal, share, caloriesPerGram) {
  const calories = Math.round(calorieGoal * share);
  return {
    calories,
    grams: Math.round(calories / caloriesPerGram),
  };
}

function gramsForEntry(entry) {
  return entry.quantityUnit === "kg" ? entry.quantityValue * 1000 : entry.quantityValue;
}

function caloriesForEntry(entry) {
  if (isAlcoholEntry(entry)) return alcoholCaloriesForEntry(entry);
  return Math.round((gramsForEntry(entry) / 100) * entry.caloriesPer100g);
}

function isAlcoholEntry(entry) {
  return entry.quantityUnit === "ml" && Number(entry.alcoholVolPercent ?? 0) > 0;
}

function alcoholGramsForEntry(entry) {
  if (!isAlcoholEntry(entry)) return 0;
  const storedGrams = Number(entry.alcoholGrams ?? 0);
  if (Number.isFinite(storedGrams) && storedGrams > 0) return storedGrams;
  return calculateAlcoholGrams(entry.quantityValue, entry.alcoholVolPercent);
}

function alcoholCaloriesForEntry(entry) {
  if (!isAlcoholEntry(entry)) return 0;
  const storedCalories = Number(entry.alcoholCalories ?? 0);
  if (Number.isFinite(storedCalories) && storedCalories > 0) return Math.round(storedCalories);
  return calculateAlcoholCalories(alcoholGramsForEntry(entry));
}

function calculateAlcoholGrams(quantityMl, volPercent) {
  return roundNutrition(Number(quantityMl) * (Number(volPercent) / 100) * ethanolDensityGPerMl);
}

function calculateAlcoholCalories(alcoholGrams) {
  return Math.round(Number(alcoholGrams) * ethanolCaloriesPerGram);
}

function macroForEntry(entry, valuePer100g) {
  return (gramsForEntry(entry) / 100) * valuePer100g;
}

function normalizeWeekStart(value) {
  const raw = String(value ?? "").trim();
  return getWeekStart(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : todayInBerlin());
}

function getWeekStart(date) {
  const dateObject = new Date(`${date}T12:00:00Z`);
  const day = dateObject.getUTCDay() || 7;
  dateObject.setUTCDate(dateObject.getUTCDate() - day + 1);
  return dateObject.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const dateObject = new Date(`${date}T12:00:00Z`);
  dateObject.setUTCDate(dateObject.getUTCDate() + days);
  return dateObject.toISOString().slice(0, 10);
}

function getBerlinDateTimeParts() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Berlin",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    weekday: values.weekday,
    hour: Number(values.hour),
    minute: Number(values.minute),
  };
}

function formatDate(value) {
  return new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" })
    .format(new Date(`${value}T12:00:00Z`));
}

function formatWeekdayShort(value) {
  return new Intl.DateTimeFormat("de-DE", { weekday: "short" })
    .format(new Date(`${value}T12:00:00Z`))
    .replace(".", "");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function fetchAndStoreGarminDailySummary(date, config = getGarminConfigRecord()) {
  const summary = await getGarminDailySummary(date, {
    username: config.username,
    authValue: config.authValue,
  });
  storeGarminDailySummary(summary);
  return summary;
}

async function fetchAndStoreGarminActivities(weekStart, config = getGarminConfigRecord()) {
  const activityWeek = await getGarminActivitiesForWeek(weekStart, {
    username: config.username,
    authValue: config.authValue,
  });
  storeGarminActivities(activityWeek);
  return activityWeek;
}

function getGarminCachedSummary(date) {
  const row = getFoodDatabase()
    .prepare("SELECT summary_json FROM garmin_daily_summary WHERE date = ?")
    .get(date);
  if (!row?.summary_json) return null;

  try {
    return JSON.parse(row.summary_json);
  } catch {
    return null;
  }
}

function storeGarminDailySummary(summary) {
  if (!summary?.date) return;
  getFoodDatabase()
    .prepare([
      "INSERT INTO garmin_daily_summary (date, summary_json, fetched_at)",
      "VALUES (?, ?, ?)",
      "ON CONFLICT(date) DO UPDATE SET",
      "  summary_json = excluded.summary_json,",
      "  fetched_at = excluded.fetched_at",
    ].join("\n"))
    .run(summary.date, JSON.stringify(summary), summary.fetchedAt ?? new Date().toISOString());
}

function getGarminCachedActivities(weekStart) {
  const row = getFoodDatabase()
    .prepare("SELECT week_start, week_end, activities_json, fetched_at FROM garmin_week_activities WHERE week_start = ?")
    .get(weekStart);
  if (!row?.activities_json) return null;

  try {
    return {
      configured: true,
      weekStart: row.week_start,
      weekEnd: row.week_end,
      source: "garmin-connect",
      activities: JSON.parse(row.activities_json),
      fetchedAt: row.fetched_at,
    };
  } catch {
    return null;
  }
}

function storeGarminActivities(activityWeek) {
  if (!activityWeek?.weekStart) return;
  if (activityWeek.error) return;
  getFoodDatabase()
    .prepare([
      "INSERT INTO garmin_week_activities (week_start, week_end, activities_json, fetched_at)",
      "VALUES (?, ?, ?, ?)",
      "ON CONFLICT(week_start) DO UPDATE SET",
      "  week_end = excluded.week_end,",
      "  activities_json = excluded.activities_json,",
      "  fetched_at = excluded.fetched_at",
    ].join("\n"))
    .run(
      activityWeek.weekStart,
      activityWeek.weekEnd ?? addDays(activityWeek.weekStart, 6),
      JSON.stringify(activityWeek.activities ?? []),
      activityWeek.fetchedAt ?? new Date().toISOString(),
    );
}

function normalizeGarminDate(value) {
  const raw = String(value ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return todayInBerlin();
}

function todayInBerlin() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

async function analyzeFoodImage(input) {
  const config = getAiConfigRecord();
  const provider = aiProviders.get(config.provider);
  if (!provider) throw new Error("AI provider is not configured");
  if (!config.apiKey) throw new Error("API key fehlt in der Konfiguration");
  validateProviderKeyPair(config.provider, config.apiKey);

  const imageDataUrl = String(input?.imageDataUrl ?? "");
  if (!imageDataUrl.startsWith("data:image/")) throw new Error("Bitte ein Bild hochladen");

  const response = await fetch(provider.endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      "content-type": "application/json",
      ...(config.provider === "openrouter" ? {
        "HTTP-Referer": "http://localhost:5173",
        "X-Title": "Food Tracker",
      } : {}),
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.1,
      response_format: { type: "json_object" },
      ...(config.provider === "openrouter" ? { usage: { include: true } } : {}),
      messages: [
        {
          role: "system",
          content: [
            "Du bist ein vorsichtiger Nutrition-Estimator.",
            "Antworte ausschliesslich als JSON ohne Markdown.",
            "Schaetze sichtbares Essen auf dem Foto. Teile es wenn moeglich in einzelne Lebensmittel auf.",
            "Wenn unsicher, nutze konservative Naehrwerte.",
            "Schema: {description:string, estimatedGrams:number, calories:number, protein:number, carbs:number, fat:number, confidence:'low'|'medium'|'high', items:[{description:string, estimatedGrams:number, calories:number, protein:number, carbs:number, fat:number, confidence:'low'|'medium'|'high'}]}",
            "calories/protein/carbs/fat sind Gesamtwerte fuer die geschaetzte Portion, nicht pro 100g.",
          ].join(" "),
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Analysiere dieses Essen fuer ein Tagesprotokoll. Gib kurze deutsche Beschreibung, ungefaehres Gewicht in Gramm, Kalorien und Makros zurueck." },
            { type: "image_url", image_url: { url: imageDataUrl } },
          ],
        },
      ],
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(payload?.error?.message ?? "AI analysis failed"));
  }

  const rawContent = payload?.choices?.[0]?.message?.content;
  const parsed = parseJsonObject(rawContent);
  const aiUsage = await buildAiUsageSnapshot(config, payload);
  const estimatedGrams = clampNumber(parsed.estimatedGrams, 1, 5000);
  const calories = clampNumber(parsed.calories, 0, 10000);
  const protein = clampNumber(parsed.protein, 0, 1000);
  const carbs = clampNumber(parsed.carbs, 0, 1000);
  const fat = clampNumber(parsed.fat, 0, 1000);

  if (!estimatedGrams || !Number.isFinite(calories)) throw new Error("AI response could not be understood");

  return withFoodDatabaseMatch({
    description: String(parsed.description ?? "Foto-Eintrag").trim().slice(0, 160) || "Foto-Eintrag",
    estimatedGrams: Math.round(estimatedGrams),
    calories: Math.round(calories),
    protein: roundNutrition(protein),
    carbs: roundNutrition(carbs),
    fat: roundNutrition(fat),
    caloriesPer100g: roundNutrition((calories / estimatedGrams) * 100),
    proteinPer100g: roundNutrition((protein / estimatedGrams) * 100),
    carbsPer100g: roundNutrition((carbs / estimatedGrams) * 100),
    fatPer100g: roundNutrition((fat / estimatedGrams) * 100),
    confidence: ["low", "medium", "high"].includes(parsed.confidence) ? parsed.confidence : "medium",
    provider: config.provider,
    model: config.model,
    aiUsage,
    items: normalizeAnalysisItems(parsed.items),
  });
}

async function analyzeFoodText(input) {
  const description = String(input?.description ?? "").trim();
  if (description.length < 3) throw new Error("Bitte Essen beschreiben");
  if (description.length > 800) throw new Error("Beschreibung ist zu lang");

  const config = getAiConfigRecord();
  const provider = aiProviders.get(config.provider);
  if (!provider) throw new Error("AI provider is not configured");
  if (!config.apiKey) throw new Error("API key fehlt in der Konfiguration");
  validateProviderKeyPair(config.provider, config.apiKey);

  const response = await fetch(provider.endpoint, {
    method: "POST",
    headers: {
      authorization: "Bearer " + config.apiKey,
      "content-type": "application/json",
      ...(config.provider === "openrouter" ? {
        "HTTP-Referer": "http://localhost:5173",
        "X-Title": "Food Tracker",
      } : {}),
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.1,
      response_format: { type: "json_object" },
      ...(config.provider === "openrouter" ? { usage: { include: true } } : {}),
      messages: [
        {
          role: "system",
          content: [
            "Du bist ein vorsichtiger Nutrition-Estimator.",
            "Antworte ausschliesslich als JSON ohne Markdown.",
            "Schaetze ein beschriebenes Essen als eine verzehrte Portion. Teile es wenn moeglich in einzelne Lebensmittel auf.",
            "Wenn Mengen fehlen, nutze realistische Alltagsportionen und bleibe konservativ.",
            "Schema: {description:string, estimatedGrams:number, calories:number, protein:number, carbs:number, fat:number, confidence:'low'|'medium'|'high', items:[{description:string, estimatedGrams:number, calories:number, protein:number, carbs:number, fat:number, confidence:'low'|'medium'|'high'}]}",
            "calories/protein/carbs/fat sind Gesamtwerte fuer die geschaetzte Portion, nicht pro 100g.",
          ].join(" "),
        },
        {
          role: "user",
          content: "Schaetze dieses Essen fuer ein Tagesprotokoll: " + description,
        },
      ],
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(payload?.error?.message ?? "AI analysis failed"));
  }

  const rawContent = payload?.choices?.[0]?.message?.content;
  const parsed = parseJsonObject(rawContent);
  const estimatedGrams = clampNumber(parsed.estimatedGrams, 1, 5000);
  const calories = clampNumber(parsed.calories, 0, 10000);
  const protein = clampNumber(parsed.protein, 0, 1000);
  const carbs = clampNumber(parsed.carbs, 0, 1000);
  const fat = clampNumber(parsed.fat, 0, 1000);
  const aiUsage = await buildAiUsageSnapshot(config, payload);

  if (!estimatedGrams || !Number.isFinite(calories)) throw new Error("AI response could not be understood");

  return withFoodDatabaseMatch({
    description: String(parsed.description ?? "AI-Eintrag").trim().slice(0, 160) || "AI-Eintrag",
    estimatedGrams: Math.round(estimatedGrams),
    calories: Math.round(calories),
    protein: roundNutrition(protein),
    carbs: roundNutrition(carbs),
    fat: roundNutrition(fat),
    caloriesPer100g: roundNutrition((calories / estimatedGrams) * 100),
    proteinPer100g: roundNutrition((protein / estimatedGrams) * 100),
    carbsPer100g: roundNutrition((carbs / estimatedGrams) * 100),
    fatPer100g: roundNutrition((fat / estimatedGrams) * 100),
    confidence: ["low", "medium", "high"].includes(parsed.confidence) ? parsed.confidence : "medium",
    provider: config.provider,
    model: config.model,
    aiUsage,
    items: normalizeAnalysisItems(parsed.items),
  });
}

async function withFoodDatabaseMatch(analysis) {
  const matchedFood = await findBestFoodDatabaseMatch(analysis.description);
  const items = [];
  for (const rawItem of Array.isArray(analysis.items) ? analysis.items.slice(0, 12) : []) {
    const item = normalizeAnalysisItem(rawItem);
    if (!item) continue;
    const itemMatch = await findBestFoodDatabaseMatch(item.description);
    items.push(itemMatch ? { ...item, matchedFood: itemMatch } : item);
  }

  return {
    ...analysis,
    ...(matchedFood ? { matchedFood } : {}),
    ...(items.length > 1 ? { items } : {}),
  };
}

async function findBestFoodDatabaseMatch(description) {
  const query = String(description ?? "").trim();
  if (query.length < 3) return null;

  const hits = await searchFoodsExpanded(query, 8);
  const rankedHits = hits
    .map((hit) => ({ hit, score: foodMatchScore(query, hit) }))
    .filter(({ score }) => score >= 42)
    .sort((left, right) => right.score - left.score);

  return rankedHits[0]?.hit ?? null;
}

function foodMatchScore(query, hit) {
  const normalizedQuery = normalizeFoodKey(query);
  const name = normalizeFoodKey(hit.name);
  const brand = normalizeFoodKey(hit.brand);
  const display = normalizeFoodKey(String(hit.name ?? "") + " " + String(hit.brand ?? ""));
  if (!normalizedQuery || !name) return 0;

  let score = 0;
  if (name === normalizedQuery || display === normalizedQuery) score += 90;
  if (name.startsWith(normalizedQuery) || display.startsWith(normalizedQuery)) score += 65;
  if (normalizedQuery.includes(name)) score += 45;
  if (brand && normalizedQuery.includes(brand)) score += 15;

  const queryTokens = meaningfulFoodTokens(normalizedQuery);
  const displayTokens = meaningfulFoodTokens(display);
  if (queryTokens.length && displayTokens.length) {
    const shared = queryTokens.filter((token) => displayTokens.includes(token)).length;
    score += Math.round((shared / queryTokens.length) * 35);
  }

  if (hit.source === "OpenFoodFacts") score += 8;
  if (hit.source === "Common food") score += 5;
  return score;
}

function meaningfulFoodTokens(value) {
  const stopWords = new Set(["mit", "und", "oder", "der", "die", "das", "ein", "eine", "einer", "portion", "ca"]);
  return value
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !stopWords.has(token));
}

async function buildAiUsageSnapshot(config, payload) {
  const responseId = typeof payload?.id === "string" ? payload.id : "";
  const completionUsage = sanitizeJsonValue(payload?.usage);
  const generationStats = config.provider === "openrouter" && responseId
    ? await fetchOpenRouterGenerationStats(config, responseId)
    : null;

  return {
    provider: config.provider,
    model: config.model,
    responseId,
    capturedAt: new Date().toISOString(),
    completionUsage,
    generationStats,
    costRaw: extractRawCost(config.provider, generationStats),
    currency: config.provider === "openrouter" ? "openrouter-credits" : "",
  };
}

async function fetchOpenRouterGenerationStats(config, responseId) {
  try {
    const url = new URL("https://openrouter.ai/api/v1/generation");
    url.searchParams.set("id", responseId);
    const response = await fetch(url, {
      headers: {
        authorization: "Bearer " + config.apiKey,
        accept: "application/json",
      },
    });
    if (!response.ok) return null;
    const payload = await response.json();
    return sanitizeJsonValue(payload?.data ?? payload);
  } catch {
    return null;
  }
}

function sanitizeJsonValue(value) {
  if (value === null || value === undefined) return null;
  return JSON.parse(JSON.stringify(value));
}

function extractRawCost(provider, generationStats) {
  if (provider !== "openrouter" || !generationStats) return null;
  const totalCost = generationStats.total_cost ?? generationStats.totalCost;
  return totalCost === undefined ? null : totalCost;
}

async function fetchProviderModels(providerId, capability = "photo") {
  const provider = aiProviders.get(providerId);
  if (!provider) throw new Error("Invalid AI provider");

  const fallbackModels = provider.models;
  try {
    const headers = { accept: "application/json" };
    if (providerId === "openai") {
      const config = getAiConfigRecord();
      if (!config.apiKey) throw new Error("API key fehlt in der Konfiguration");
      headers.authorization = `Bearer ${config.apiKey}`;
    }
    if (providerId === "openrouter") {
      const config = getAiConfigRecord();
      if (config.apiKey) headers.authorization = `Bearer ${config.apiKey}`;
    }

    const response = await fetch(provider.modelsEndpoint, { headers });
    if (!response.ok) throw new Error("Model request failed");
    const payload = await response.json();
    const remoteModels = providerId === "openrouter"
      ? parseOpenRouterModels(payload, capability)
      : parseOpenAiModels(payload);
    return remoteModels.length > 0 ? remoteModels : fallbackModels;
  } catch (error) {
    if (providerId === "openai" && String(error?.message ?? "").includes("API key fehlt")) throw error;
    return fallbackModels;
  }
}

function parseOpenAiModels(payload) {
  const models = Array.isArray(payload?.data) ? payload.data : [];
  return models
    .map((model) => String(model?.id ?? ""))
    .filter((model) => isSafeModelId(model) && /^(gpt-|o\d|chatgpt)/.test(model))
    .sort(compareModelIds);
}

function parseOpenRouterModels(payload, capability = "photo") {
  const models = Array.isArray(payload?.data) ? payload.data : [];
  return models
    .filter((model) => {
      const inputModalities = model?.architecture?.input_modalities;
      const outputModalities = model?.architecture?.output_modalities;
      const supportsImageInput = Array.isArray(inputModalities) && inputModalities.includes("image");
      const supportsTextInput = !Array.isArray(inputModalities) || inputModalities.includes("text");
      const supportsTextOutput = !Array.isArray(outputModalities) || outputModalities.includes("text");
      return capability === "analysis"
        ? supportsTextInput && supportsTextOutput
        : supportsImageInput && supportsTextOutput;
    })
    .map((model) => String(model?.id ?? ""))
    .filter(isSafeModelId)
    .filter((model, index, allModels) => allModels.indexOf(model) === index)
    .slice(0, 250);
}

function isSafeModelId(value) {
  return /^[a-zA-Z0-9._:/+-]{2,120}$/.test(String(value ?? ""));
}

function compareModelIds(left, right) {
  return right.localeCompare(left, "en", { numeric: true, sensitivity: "base" });
}

function getAiConfigRecord() {
  const row = getFoodDatabase()
    .prepare("SELECT provider, model, encrypted_api_key, api_key_iv, api_key_tag, key_hint FROM ai_config WHERE id = 'default'")
    .get();

  if (!row) {
    return { ...defaultAiConfig, apiKey: "", keyHint: "" };
  }

  return {
    provider: row.provider,
    model: row.model,
    apiKey: decryptSecret(row.encrypted_api_key, row.api_key_iv, row.api_key_tag),
    keyHint: row.key_hint,
  };
}

function getAnalysisAiConfigRecord() {
  const sharedConfig = getAiConfigRecord();
  const row = getFoodDatabase()
    .prepare("SELECT provider, model FROM analysis_ai_config WHERE id = 'default'")
    .get();

  if (!row || row.provider !== sharedConfig.provider) {
    return { ...sharedConfig, model: getDefaultAnalysisModel(sharedConfig.provider) };
  }

  return {
    provider: sharedConfig.provider,
    model: row.model,
    apiKey: sharedConfig.apiKey,
    keyHint: sharedConfig.keyHint,
  };
}

function getDefaultAnalysisModel(providerId) {
  return aiProviders.get(providerId)?.models[0] ?? defaultAnalysisAiConfig.model;
}

function getGarminConfigRecord() {
  const row = getFoodDatabase()
    .prepare("SELECT username, encrypted_credential, credential_iv, credential_tag, key_hint, auto_sync_minutes FROM garmin_config WHERE id = 'default'")
    .get();

  if (!row) {
    return { username: "", authValue: "", keyHint: "", autoSyncMinutes: 0 };
  }

  return {
    username: row.username,
    authValue: decryptSecret(row.encrypted_credential, row.credential_iv, row.credential_tag),
    keyHint: row.key_hint,
    autoSyncMinutes: normalizeGarminAutoSyncMinutes(row.auto_sync_minutes, 0),
  };
}

function normalizeGarminAutoSyncMinutes(value, fallback = 0) {
  const number = Number(value);
  if ([0, 15, 30, 45, 60].includes(number)) return number;
  return [0, 15, 30, 45, 60].includes(fallback) ? fallback : 0;
}

function getSecretKey() {
  mkdirSync(dirname(secretPath), { recursive: true });
  if (!existsSync(secretPath)) {
    writeFileSync(secretPath, randomBytes(32).toString("base64"), { mode: 0o600 });
  }

  return Buffer.from(readFileSync(secretPath, "utf8").trim(), "base64");
}

function encryptSecret(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getSecretKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

function decryptSecret(ciphertext, iv, tag) {
  if (!ciphertext || !iv || !tag) return "";
  try {
    const decipher = createDecipheriv("aes-256-gcm", getSecretKey(), Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return "";
  }
}

function makeKeyHint(value) {
  return value.length <= 8 ? "gespeichert" : `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function validateProviderKeyPair(provider, apiKey) {
  if (!apiKey) return;
  if (provider === "openai" && apiKey.startsWith("sk-or-")) {
    throw new Error("OpenRouter-Key erkannt. Bitte Provider OpenRouter speichern.");
  }
  if (provider === "openrouter" && !apiKey.startsWith("sk-or-")) {
    throw new Error("OpenRouter erwartet einen OpenRouter-Key.");
  }
}

function parseJsonObject(value) {
  if (typeof value !== "string") throw new Error("AI response is empty");
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("AI response is not JSON");
  return JSON.parse(value.slice(start, end + 1));
}

function clampNumber(value, min, max) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return 0;
  return Math.min(max, Math.max(min, numberValue));
}

function seedFoodRecords(database) {
  upsertFoodRecordsInto(database, seedFoods, "SQLite", seedFoods.length);
}

function upsertFoodRecords(foods, source, basePriority = 0) {
  const database = getFoodDatabase();
  upsertFoodRecordsInto(database, foods, source, basePriority);
}

function upsertFoodRecordsInto(database, foods, source, basePriority = 0) {
  const insertFood = database.prepare([
    "INSERT INTO foods (",
    "  id, name, normalized_name, brand, normalized_brand, calories_per_100g,",
    "  protein_per_100g, carbs_per_100g, fat_per_100g, image_url, source,",
    "  source_version, source_updated_at, priority",
    ")",
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    "ON CONFLICT(id) DO UPDATE SET",
    "  name = excluded.name,",
    "  normalized_name = excluded.normalized_name,",
    "  brand = excluded.brand,",
    "  normalized_brand = excluded.normalized_brand,",
    "  calories_per_100g = excluded.calories_per_100g,",
    "  protein_per_100g = excluded.protein_per_100g,",
    "  carbs_per_100g = excluded.carbs_per_100g,",
    "  fat_per_100g = excluded.fat_per_100g,",
    "  image_url = excluded.image_url,",
    "  source = excluded.source,",
    "  source_version = excluded.source_version,",
    "  source_updated_at = excluded.source_updated_at,",
    "  priority = excluded.priority",
  ].join("\n"));
  const deleteAliases = database.prepare("DELETE FROM food_aliases WHERE food_id = ?");
  const insertAlias = database.prepare([
    "INSERT OR IGNORE INTO food_aliases (food_id, alias, normalized_alias)",
    "VALUES (?, ?, ?)",
  ].join("\n"));

  database.exec("BEGIN");
  try {
    for (const [index, food] of foods.entries()) {
      insertFood.run(
        food.id,
        food.name,
        normalizeFoodKey(food.name),
        food.brand,
        normalizeFoodKey(food.brand),
        food.caloriesPer100g,
        food.proteinPer100g,
        food.carbsPer100g,
        food.fatPer100g,
        food.imageUrl ?? "",
        source,
        food.sourceVersion ?? "",
        food.sourceUpdatedAt ?? "",
        Math.max(0, basePriority - index),
      );
      deleteAliases.run(food.id);
      for (const alias of [food.name, food.brand, ...(food.aliases ?? [])]) {
        insertAlias.run(food.id, alias, normalizeFoodKey(alias));
      }
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function addColumnIfMissing(database, table, column, definition) {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all();
  if (columns.some((row) => row.name === column)) return;
  database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function migrateEntriesQuantityUnitCheck(database) {
  const table = database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'entries'").get();
  if (!table?.sql || table.sql.includes("'ml'")) return;

  database.exec([
    "ALTER TABLE entries RENAME TO entries_legacy_unit_check;",
    "CREATE TABLE entries (",
    "  id TEXT PRIMARY KEY,",
    "  food_key TEXT,",
    "  food_name TEXT NOT NULL,",
    "  quantity_value REAL NOT NULL,",
    "  quantity_unit TEXT NOT NULL CHECK (quantity_unit IN ('g', 'kg', 'ml')),",
    "  calories_per_100g REAL NOT NULL,",
    "  protein_per_100g REAL NOT NULL DEFAULT 0,",
    "  carbs_per_100g REAL NOT NULL DEFAULT 0,",
    "  fat_per_100g REAL NOT NULL DEFAULT 0,",
    "  consumed_at TEXT NOT NULL,",
    "  created_at TEXT NOT NULL,",
    "  source TEXT NOT NULL DEFAULT 'manual',",
    "  ai_usage_json TEXT NOT NULL DEFAULT '',",
    "  meal_id TEXT,",
    "  meal_name TEXT,",
    "  image_data_url TEXT NOT NULL DEFAULT '',",
    "  alcohol_vol_percent REAL,",
    "  alcohol_grams REAL NOT NULL DEFAULT 0,",
    "  alcohol_calories REAL NOT NULL DEFAULT 0",
    ");",
    "INSERT INTO entries (",
    "  id, food_key, food_name, quantity_value, quantity_unit, calories_per_100g,",
    "  protein_per_100g, carbs_per_100g, fat_per_100g, consumed_at, created_at, source, ai_usage_json,",
    "  meal_id, meal_name, image_data_url, alcohol_vol_percent, alcohol_grams, alcohol_calories",
    ")",
    "SELECT",
    "  id, food_key, food_name, quantity_value, quantity_unit, calories_per_100g,",
    "  protein_per_100g, carbs_per_100g, fat_per_100g, consumed_at, created_at, source, ai_usage_json,",
    "  meal_id, meal_name, image_data_url, alcohol_vol_percent, alcohol_grams, alcohol_calories",
    "FROM entries_legacy_unit_check;",
    "DROP TABLE entries_legacy_unit_check;",
  ].join("\n"));
}

function migrateMealTemplateItemsQuantityUnitCheck(database) {
  const table = database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'meal_template_items'").get();
  if (!table?.sql || table.sql.includes("'ml'")) return;

  database.exec([
    "ALTER TABLE meal_template_items RENAME TO meal_template_items_legacy_unit_check;",
    "CREATE TABLE meal_template_items (",
    "  meal_id TEXT NOT NULL REFERENCES meal_templates(id) ON DELETE CASCADE,",
    "  position INTEGER NOT NULL,",
    "  food_key TEXT,",
    "  food_name TEXT NOT NULL,",
    "  quantity_value REAL NOT NULL,",
    "  quantity_unit TEXT NOT NULL CHECK (quantity_unit IN ('g', 'kg', 'ml')),",
    "  calories_per_100g REAL NOT NULL,",
    "  protein_per_100g REAL NOT NULL DEFAULT 0,",
    "  carbs_per_100g REAL NOT NULL DEFAULT 0,",
    "  fat_per_100g REAL NOT NULL DEFAULT 0,",
    "  source TEXT NOT NULL DEFAULT 'manual',",
    "  PRIMARY KEY (meal_id, position)",
    ");",
    "INSERT INTO meal_template_items (",
    "  meal_id, position, food_key, food_name, quantity_value, quantity_unit, calories_per_100g,",
    "  protein_per_100g, carbs_per_100g, fat_per_100g, source",
    ")",
    "SELECT",
    "  meal_id, position, food_key, food_name, quantity_value, quantity_unit, calories_per_100g,",
    "  protein_per_100g, carbs_per_100g, fat_per_100g, source",
    "FROM meal_template_items_legacy_unit_check;",
    "DROP TABLE meal_template_items_legacy_unit_check;",
  ].join("\n"));
}

async function fetchOpenFoodFacts(query, limit) {
  const url = new URL("https://world.openfoodfacts.org/cgi/search.pl");
  url.searchParams.set("search_terms", query);
  url.searchParams.set("search_simple", "1");
  url.searchParams.set("action", "process");
  url.searchParams.set("json", "1");
  url.searchParams.set("page_size", String(Math.min(Math.max(limit, 1), 50)));
  url.searchParams.set("fields", [
    "code",
    "product_name",
    "generic_name",
    "brands",
    "nutriments",
    "image_front_small_url",
    "image_url",
  ].join(","));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4500);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "FoodTracker/0.1 (+https://local.food-tracker.invalid)",
        accept: "application/json",
      },
    });
    if (!response.ok) return [];

    const payload = await response.json();
    const products = Array.isArray(payload?.products) ? payload.products : [];
    return products.map(openFoodFactsProductToFood).filter(Boolean);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchOpenFoodFactsBarcode(barcode) {
  const url = new URL(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json`);
  url.searchParams.set("fields", [
    "code",
    "product_name",
    "generic_name",
    "brands",
    "nutriments",
    "image_front_small_url",
    "image_url",
  ].join(","));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4500);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "FoodTracker/0.1 (+https://local.food-tracker.invalid)",
        accept: "application/json",
      },
    });
    if (!response.ok) return null;

    const payload = await response.json();
    if (Number(payload?.status) !== 1) return null;
    return openFoodFactsProductToFood(payload?.product);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function openFoodFactsProductToFood(product) {
  const code = String(product?.code ?? "").trim();
  const name = String(product?.product_name || product?.generic_name || "").trim();
  if (!code || !name) return null;

  const nutriments = product?.nutriments ?? {};
  const calories = numberFromNutrition(nutriments["energy-kcal_100g"])
    ?? kjToKcal(numberFromNutrition(nutriments.energy_100g));
  const protein = numberFromNutrition(nutriments.proteins_100g);
  const carbs = numberFromNutrition(nutriments.carbohydrates_100g);
  const fat = numberFromNutrition(nutriments.fat_100g);

  if (![calories, protein, carbs, fat].every((value) => Number.isFinite(value) && value >= 0)) {
    return null;
  }

  const brand = firstBrand(product?.brands);
  const genericName = String(product?.generic_name ?? "").trim();
  const aliases = [
    name,
    genericName,
    brand,
    brand && name ? `${brand} ${name}` : "",
    name && brand ? `${name} ${brand}` : "",
  ].filter(Boolean);

  return {
    id: `off:${code}`,
    name,
    brand,
    caloriesPer100g: roundNutrition(calories),
    proteinPer100g: roundNutrition(protein),
    carbsPer100g: roundNutrition(carbs),
    fatPer100g: roundNutrition(fat),
    imageUrl: String(product?.image_front_small_url || product?.image_url || "").trim(),
    aliases,
  };
}

function normalizeBarcode(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 14 ? digits : "";
}

function numberFromNutrition(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function kjToKcal(value) {
  return Number.isFinite(value) ? value / 4.184 : null;
}

function firstBrand(value) {
  if (Array.isArray(value)) return String(value[0] ?? "").trim();
  return String(value ?? "").split(",")[0]?.trim() ?? "";
}

function roundNutrition(value) {
  return Math.round(value * 10) / 10;
}

function dedupeFoodRows(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    const displayKey = normalizeFoodKey(`${row.name} ${row.brand}`);
    if (seen.has(displayKey)) return false;
    seen.add(displayKey);
    return true;
  });
}

function dedupeFoodObjects(foods) {
  const seen = new Set();
  return foods.filter((food) => {
    const displayKey = normalizeFoodKey(`${food.name} ${food.brand}`);
    if (seen.has(displayKey)) return false;
    seen.add(displayKey);
    return true;
  });
}

function validateEntry(input) {
  const foodName = String(input?.foodName ?? "").trim();
  const quantityValue = Number(input?.quantityValue);
  const quantityUnit = input?.quantityUnit === "kg" || input?.quantityUnit === "ml" ? input.quantityUnit : "g";
  const alcoholVolPercent = input?.alcoholVolPercent === undefined || input?.alcoholVolPercent === null || input?.alcoholVolPercent === ""
    ? undefined
    : Number(input.alcoholVolPercent);
  const alcoholGrams = alcoholVolPercent ? calculateAlcoholGrams(quantityValue, alcoholVolPercent) : 0;
  const alcoholCalories = alcoholVolPercent ? calculateAlcoholCalories(alcoholGrams) : 0;
  const caloriesPer100g = alcoholVolPercent && quantityUnit === "ml"
    ? roundNutrition((alcoholCalories / quantityValue) * 100)
    : Number(input?.caloriesPer100g);
  const proteinPer100g = Number(input?.proteinPer100g ?? 0);
  const carbsPer100g = Number(input?.carbsPer100g ?? 0);
  const fatPer100g = Number(input?.fatPer100g ?? 0);
  const consumedAt = String(input?.consumedAt ?? "");
  const mealId = input?.mealId ? String(input.mealId).trim().slice(0, 80) : undefined;
  const mealName = input?.mealName ? String(input.mealName).trim().slice(0, 120) : undefined;
  const imageDataUrl = normalizeEntryImageDataUrl(input?.imageDataUrl);

  if (!foodName) throw new Error("Food name is required");
  if (!Number.isFinite(quantityValue) || quantityValue <= 0) throw new Error("Invalid quantity");
  if (!Number.isFinite(caloriesPer100g) || caloriesPer100g < 0) throw new Error("Invalid calories");
  if (alcoholVolPercent !== undefined && quantityUnit !== "ml") throw new Error("Alcohol entries require ml");
  if (alcoholVolPercent !== undefined && (!Number.isFinite(alcoholVolPercent) || alcoholVolPercent <= 0 || alcoholVolPercent > 100)) {
    throw new Error("Invalid alcohol volume percent");
  }
  if (![proteinPer100g, carbsPer100g, fatPer100g].every((value) => Number.isFinite(value) && value >= 0)) {
    throw new Error("Invalid macro values");
  }
  if (!consumedAt) throw new Error("Consumed time is required");

  return {
    id: String(input?.id ?? randomUUID()),
    foodKey: input?.foodKey ? String(input.foodKey) : undefined,
    foodName,
    quantityValue,
    quantityUnit,
    caloriesPer100g,
    proteinPer100g,
    carbsPer100g,
    fatPer100g,
    consumedAt,
    createdAt: String(input?.createdAt ?? new Date().toISOString()),
    source: input?.source ? String(input.source) : "manual",
    aiUsage: normalizeAiUsage(input?.aiUsage),
    mealId,
    mealName,
    imageDataUrl,
    alcoholVolPercent,
    alcoholGrams,
    alcoholCalories,
  };
}

function entryFromRow(row) {
  return {
    id: row.id,
    foodKey: row.food_key ?? undefined,
    foodName: row.food_name,
    quantityValue: row.quantity_value,
    quantityUnit: row.quantity_unit,
    caloriesPer100g: row.calories_per_100g,
    proteinPer100g: row.protein_per_100g,
    carbsPer100g: row.carbs_per_100g,
    fatPer100g: row.fat_per_100g,
    consumedAt: row.consumed_at,
    createdAt: row.created_at,
    source: row.source,
    aiUsage: parseStoredJson(row.ai_usage_json),
    mealId: row.meal_id ?? undefined,
    mealName: row.meal_name ?? undefined,
    imageDataUrl: row.image_data_url || undefined,
    alcoholVolPercent: row.alcohol_vol_percent ?? undefined,
    alcoholGrams: row.alcohol_grams ?? 0,
    alcoholCalories: row.alcohol_calories ?? 0,
  };
}

function normalizeEntryImageDataUrl(value) {
  const imageDataUrl = String(value ?? "").trim();
  if (!imageDataUrl) return "";
  if (!imageDataUrl.startsWith("data:image/")) throw new Error("Invalid entry image");
  if (imageDataUrl.length > 7_000_000) throw new Error("Entry image is too large");
  return imageDataUrl;
}

function validateMealTemplate(input) {
  const name = String(input?.name ?? "").trim().slice(0, 120);
  if (!name) throw new Error("Meal name is required");
  const rawItems = Array.isArray(input?.items) ? input.items : [];
  if (rawItems.length < 1) throw new Error("Meal needs at least one item");
  if (rawItems.length > 50) throw new Error("Meal has too many items");

  return {
    id: String(input?.id ?? randomUUID()),
    name,
    createdAt: String(input?.createdAt ?? new Date().toISOString()),
    items: rawItems.map((item) => {
      const entry = validateEntry({
        ...item,
        consumedAt: item?.consumedAt ?? new Date().toISOString().slice(0, 16),
      });
      return {
        foodKey: entry.foodKey,
        foodName: entry.foodName,
        quantityValue: entry.quantityValue,
        quantityUnit: entry.quantityUnit,
        caloriesPer100g: entry.caloriesPer100g,
        proteinPer100g: entry.proteinPer100g,
        carbsPer100g: entry.carbsPer100g,
        fatPer100g: entry.fatPer100g,
        source: entry.source,
      };
    }),
  };
}

function mealTemplateItemFromRow(row) {
  return {
    foodKey: row.food_key ?? undefined,
    foodName: row.food_name,
    quantityValue: row.quantity_value,
    quantityUnit: row.quantity_unit,
    caloriesPer100g: row.calories_per_100g,
    proteinPer100g: row.protein_per_100g,
    carbsPer100g: row.carbs_per_100g,
    fatPer100g: row.fat_per_100g,
    source: row.source,
  };
}

function validateMealFavoriteSignature(value) {
  const signature = String(value ?? "").trim().slice(0, 500);
  if (!signature || !signature.includes("::")) throw new Error("Invalid meal favorite");
  return signature;
}

function normalizeAnalysisItems(items) {
  if (!Array.isArray(items)) return [];
  return items.map(normalizeAnalysisItem).filter(Boolean).slice(0, 12);
}

function normalizeAnalysisItem(rawItem) {
  const estimatedGrams = clampNumber(rawItem?.estimatedGrams, 1, 5000);
  const calories = clampNumber(rawItem?.calories, 0, 10000);
  const protein = clampNumber(rawItem?.protein, 0, 1000);
  const carbs = clampNumber(rawItem?.carbs, 0, 1000);
  const fat = clampNumber(rawItem?.fat, 0, 1000);
  if (!estimatedGrams || !Number.isFinite(calories)) return null;

  return {
    description: String(rawItem?.description ?? "Lebensmittel").trim().slice(0, 120) || "Lebensmittel",
    estimatedGrams: Math.round(estimatedGrams),
    calories: Math.round(calories),
    protein: roundNutrition(protein),
    carbs: roundNutrition(carbs),
    fat: roundNutrition(fat),
    caloriesPer100g: roundNutrition((calories / estimatedGrams) * 100),
    proteinPer100g: roundNutrition((protein / estimatedGrams) * 100),
    carbsPer100g: roundNutrition((carbs / estimatedGrams) * 100),
    fatPer100g: roundNutrition((fat / estimatedGrams) * 100),
    confidence: ["low", "medium", "high"].includes(rawItem?.confidence) ? rawItem.confidence : "medium",
  };
}

function normalizeAiUsage(value) {
  if (!value || typeof value !== "object") return undefined;
  return sanitizeJsonValue(value);
}

function parseStoredJson(value) {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function readJsonBody(request, maxBytes = 1_000_000) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > maxBytes) {
        reject(new Error("Request body too large"));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response, payload, statusCode = 200) {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

function normalizeFoodKey(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
