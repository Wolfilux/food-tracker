import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { seedFoods } from "./food-data.js";

const here = dirname(fileURLToPath(import.meta.url));
const dbPath = join(here, "..", "data", "food-tracker.sqlite");
const secretPath = join(here, "..", "data", "food-tracker.secret.key");
const defaultNutritionConfig = {
  calorieGoal: 2200,
  goal: "maintenance",
};
const defaultAiConfig = {
  provider: "openai",
  model: "gpt-5.5-mini",
};
const nutritionGoals = new Set(["fat-loss", "muscle-gain", "maintenance", "recomposition", "weight-gain"]);
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
      "openai/gpt-5.4-nano",
      "openai/gpt-5.4-mini",
      "openai/gpt-5.4-pro",
      "openai/gpt-5.4",
      "openai/gpt-5.4-image-2",
      "openai/gpt-5-mini",
      "openai/gpt-5",
      "openai/gpt-4.1-mini",
      "openai/gpt-4o-mini",
      "google/gemini-2.5-flash",
      "google/gemini-2.5-pro",
      "anthropic/claude-sonnet-4",
      "anthropic/claude-opus-4",
      "anthropic/claude-3.7-sonnet",
      "meta-llama/llama-4-maverick",
      "meta-llama/llama-4-scout",
      "qwen/qwen2.5-vl-72b-instruct",
      "mistralai/mistral-medium-3",
    ],
  }],
]);

let db;

export function getFoodDatabase() {
  if (!db) {
    mkdirSync(dirname(dbPath), { recursive: true });
    db = new DatabaseSync(dbPath);
    initializeDatabase(db);
  }

  return db;
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

  return dedupeFoodRows(rows).map((row) => ({
    id: row.id,
    name: row.name,
    brand: row.brand,
    caloriesPer100g: row.calories_per_100g,
    proteinPer100g: row.protein_per_100g,
    carbsPer100g: row.carbs_per_100g,
    fatPer100g: row.fat_per_100g,
    imageUrl: row.image_url || undefined,
    source: row.source,
  }));
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

    if (url.pathname === "/api/ai/models" && request.method === "GET") {
      try {
        const provider = url.searchParams.get("provider") ?? getAiConfigRecord().provider;
        sendJson(response, { models: await fetchProviderModels(provider) });
      } catch (error) {
        sendJson(response, { error: error.message }, 400);
      }
      return;
    }

    if (url.pathname === "/api/entries") {
      if (request.method === "GET") {
        sendJson(response, { entries: listEntries() });
        return;
      }

      if (request.method === "POST") {
        try {
          const entry = createEntry(await readJsonBody(request));
          sendJson(response, { entry }, 201);
        } catch (error) {
          sendJson(response, { error: error.message }, 400);
        }
        return;
      }
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
    .prepare("SELECT calorie_goal, goal FROM nutrition_config WHERE id = 'default'")
    .get();

  if (!row) return defaultNutritionConfig;

  return {
    calorieGoal: row.calorie_goal,
    goal: row.goal,
  };
}

export function saveNutritionConfig(input) {
  const calorieGoal = Number(input?.calorieGoal);
  const goal = String(input?.goal ?? "");

  if (!Number.isFinite(calorieGoal) || calorieGoal < 800 || calorieGoal > 10000) {
    throw new Error("Invalid calorie goal");
  }

  if (!nutritionGoals.has(goal)) {
    throw new Error("Invalid nutrition goal");
  }

  getFoodDatabase()
    .prepare([
      "INSERT INTO nutrition_config (id, calorie_goal, goal, updated_at)",
      "VALUES ('default', ?, ?, datetime('now'))",
      "ON CONFLICT(id) DO UPDATE SET",
      "  calorie_goal = excluded.calorie_goal,",
      "  goal = excluded.goal,",
      "  updated_at = excluded.updated_at",
    ].join("\n"))
    .run(Math.round(calorieGoal), goal);

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

export function listEntries() {
  const rows = getFoodDatabase()
    .prepare([
      "SELECT",
      "  id, food_key, food_name, quantity_value, quantity_unit, calories_per_100g,",
      "  protein_per_100g, carbs_per_100g, fat_per_100g, consumed_at, created_at, source, ai_usage_json",
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
      "  protein_per_100g, carbs_per_100g, fat_per_100g, consumed_at, created_at, source, ai_usage_json",
      ")",
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
    );

  return entry;
}

export function deleteEntry(id) {
  getFoodDatabase().prepare("DELETE FROM entries WHERE id = ?").run(id);
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
    "CREATE TABLE IF NOT EXISTS nutrition_config (",
    "  id TEXT PRIMARY KEY,",
    "  calorie_goal INTEGER NOT NULL,",
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
    "CREATE TABLE IF NOT EXISTS entries (",
    "  id TEXT PRIMARY KEY,",
    "  food_key TEXT,",
    "  food_name TEXT NOT NULL,",
    "  quantity_value REAL NOT NULL,",
    "  quantity_unit TEXT NOT NULL CHECK (quantity_unit IN ('g', 'kg')),",
    "  calories_per_100g REAL NOT NULL,",
    "  protein_per_100g REAL NOT NULL DEFAULT 0,",
    "  carbs_per_100g REAL NOT NULL DEFAULT 0,",
    "  fat_per_100g REAL NOT NULL DEFAULT 0,",
    "  consumed_at TEXT NOT NULL,",
    "  created_at TEXT NOT NULL,",
    "  source TEXT NOT NULL DEFAULT 'manual',",
    "  ai_usage_json TEXT NOT NULL DEFAULT ''",
    ");",
    "CREATE INDEX IF NOT EXISTS idx_entries_consumed_at ON entries(consumed_at DESC);",
  ].join("\n"));

  addColumnIfMissing(database, "foods", "image_url", "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(database, "entries", "ai_usage_json", "TEXT NOT NULL DEFAULT ''");
  seedFoodRecords(database);
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
            "Schaetze sichtbares Essen auf dem Foto. Wenn unsicher, nutze konservative Naehrwerte.",
            "Schema: {description:string, estimatedGrams:number, calories:number, protein:number, carbs:number, fat:number, confidence:'low'|'medium'|'high'}",
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

  return {
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
  };
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
            "Schaetze ein beschriebenes Essen als eine verzehrte Portion.",
            "Wenn Mengen fehlen, nutze realistische Alltagsportionen und bleibe konservativ.",
            "Schema: {description:string, estimatedGrams:number, calories:number, protein:number, carbs:number, fat:number, confidence:'low'|'medium'|'high'}",
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

  return {
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
  };
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

async function fetchProviderModels(providerId) {
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
      ? parseOpenRouterModels(payload)
      : parseOpenAiModels(payload);
    return mergeModels(remoteModels, fallbackModels);
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

function parseOpenRouterModels(payload) {
  const models = Array.isArray(payload?.data) ? payload.data : [];
  return models
    .filter((model) => {
      const modalities = model?.architecture?.input_modalities;
      return !Array.isArray(modalities) || modalities.includes("image");
    })
    .map((model) => String(model?.id ?? ""))
    .filter(isSafeModelId)
    .sort(compareModelIds);
}

function mergeModels(primary, fallback) {
  return Array.from(new Set([...fallback, ...primary])).slice(0, 80);
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
    "  protein_per_100g, carbs_per_100g, fat_per_100g, image_url, source, priority",
    ")",
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
  const quantityUnit = input?.quantityUnit === "kg" ? "kg" : "g";
  const caloriesPer100g = Number(input?.caloriesPer100g);
  const proteinPer100g = Number(input?.proteinPer100g ?? 0);
  const carbsPer100g = Number(input?.carbsPer100g ?? 0);
  const fatPer100g = Number(input?.fatPer100g ?? 0);
  const consumedAt = String(input?.consumedAt ?? "");

  if (!foodName) throw new Error("Food name is required");
  if (!Number.isFinite(quantityValue) || quantityValue <= 0) throw new Error("Invalid quantity");
  if (!Number.isFinite(caloriesPer100g) || caloriesPer100g < 0) throw new Error("Invalid calories");
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
