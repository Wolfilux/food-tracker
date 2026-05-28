import { FormEvent, KeyboardEvent, ReactNode, Ref, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Camera,
  Database,
  Flame,
  ImagePlus,
  KeyRound,
  Loader2,
  MessageSquareText,
  Plus,
  Scale,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Target,
  Trash2,
  Utensils,
} from "lucide-react";

type Unit = "g" | "kg";
type AppView = "tracker" | "settings";

type FoodEntry = {
  id: string;
  foodKey?: string;
  foodName: string;
  quantityValue: number;
  quantityUnit: Unit;
  caloriesPer100g: number;
  proteinPer100g: number;
  carbsPer100g: number;
  fatPer100g: number;
  consumedAt: string;
  createdAt: string;
  source?: string;
  aiUsage?: AiUsageSnapshot;
};

type FoodDraft = Omit<FoodEntry, "id" | "createdAt">;

type FoodSearchResult = {
  id: string;
  name: string;
  brand: string;
  caloriesPer100g: number;
  proteinPer100g: number;
  carbsPer100g: number;
  fatPer100g: number;
  imageUrl?: string;
  usageCount: number;
  source: string;
};

type CommonFood = Omit<FoodSearchResult, "usageCount"> & {
  aliases: string[];
};

type NutritionGoal = "fat-loss" | "muscle-gain" | "maintenance" | "recomposition" | "weight-gain";

type NutritionConfig = {
  calorieGoal: number;
  goal: NutritionGoal;
};

type AiProviderOption = {
  id: string;
  label: string;
  models: string[];
};

type AiConfig = {
  provider: string;
  model: string;
  hasApiKey: boolean;
  keyHint: string;
  providers: AiProviderOption[];
};

type AiConfigDraft = {
  provider: string;
  model: string;
  apiKey: string;
};

type AiUsageSnapshot = {
  provider: string;
  model: string;
  responseId?: string;
  capturedAt: string;
  completionUsage?: unknown;
  generationStats?: unknown;
  costRaw?: unknown;
  currency?: string;
};

type FoodImageAnalysis = {
  description: string;
  estimatedGrams: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  caloriesPer100g: number;
  proteinPer100g: number;
  carbsPer100g: number;
  fatPer100g: number;
  confidence: "low" | "medium" | "high";
  provider: string;
  model: string;
  aiUsage?: AiUsageSnapshot;
};

type MacroPreset = {
  label: string;
  protein: number;
  carbs: number;
  fat: number;
  note: string;
};

const defaultNutritionConfig: NutritionConfig = {
  calorieGoal: 2200,
  goal: "maintenance",
};

const defaultAiConfig: AiConfig = {
  provider: "openai",
  model: "gpt-5.5-mini",
  hasApiKey: false,
  keyHint: "",
  providers: [
    {
      id: "openai",
      label: "OpenAI",
      models: ["gpt-5.5-mini", "gpt-5.5", "gpt-5.4-mini", "gpt-5.4", "gpt-5", "gpt-5-mini", "gpt-5-nano", "gpt-4.1-mini", "gpt-4.1", "gpt-4.1-nano", "gpt-4o-mini", "gpt-4o", "o4-mini"],
    },
    {
      id: "openrouter",
      label: "OpenRouter",
      models: [
        "openai/gpt-5.5-mini",
        "openai/gpt-5.5",
        "openai/gpt-5.4-mini",
        "openai/gpt-5.4",
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
    },
  ],
};

const macroPresets: Record<NutritionGoal, MacroPreset> = {
  "fat-loss": {
    label: "Fettabbau",
    protein: 0.35,
    carbs: 0.35,
    fat: 0.3,
    note: "Protein hoch, Fett ausreichend, Kohlenhydrate moderat.",
  },
  "muscle-gain": {
    label: "Muskelaufbau",
    protein: 0.25,
    carbs: 0.5,
    fat: 0.25,
    note: "Mehr Kohlenhydrate fuer Trainingsleistung, Protein solide.",
  },
  maintenance: {
    label: "Normal",
    protein: 0.2,
    carbs: 0.5,
    fat: 0.3,
    note: "Ausgewogene AMDR-nahe Standardverteilung.",
  },
  recomposition: {
    label: "Fettabbau/Muskelaufbau",
    protein: 0.3,
    carbs: 0.4,
    fat: 0.3,
    note: "Hoher Proteinanteil mit genug Kohlenhydraten fuer Training.",
  },
  "weight-gain": {
    label: "Gewichtszunahme",
    protein: 0.2,
    carbs: 0.55,
    fat: 0.25,
    note: "Kalorienfreundlich, kohlenhydratbetont, Fett moderat.",
  },
};
const COMMON_FOODS: CommonFood[] = [
  {
    id: "common:magerquark",
    name: "Magerquark",
    brand: "Standard",
    caloriesPer100g: 67,
    proteinPer100g: 12,
    carbsPer100g: 4,
    fatPer100g: 0.2,
    aliases: ["mager quark", "quark"],
    source: "Common food",
  },
  {
    id: "common:koerniger-frischkaese",
    name: "Körniger Frischkäse",
    brand: "Standard",
    caloriesPer100g: 98,
    proteinPer100g: 12,
    carbsPer100g: 3,
    fatPer100g: 4,
    aliases: ["körniger frischkäse", "koerniger frischkaese", "körni", "koerni", "hüttenkäse", "huettenkaese", "cottage cheese"],
    source: "Common food",
  },
  {
    id: "common:skyr-natur",
    name: "Skyr natur",
    brand: "Standard",
    caloriesPer100g: 62,
    proteinPer100g: 11,
    carbsPer100g: 4,
    fatPer100g: 0.2,
    aliases: ["skyr"],
    source: "Common food",
  },
  {
    id: "common:joghurt-natur",
    name: "Joghurt natur 1,5%",
    brand: "Standard",
    caloriesPer100g: 57,
    proteinPer100g: 4.3,
    carbsPer100g: 5.5,
    fatPer100g: 1.5,
    aliases: ["joghurt", "jogurt"],
    source: "Common food",
  },
  {
    id: "common:haferflocken",
    name: "Haferflocken",
    brand: "Standard",
    caloriesPer100g: 370,
    proteinPer100g: 13.5,
    carbsPer100g: 58.7,
    fatPer100g: 7,
    aliases: ["oats", "haf"],
    source: "Common food",
  },
  {
    id: "common:banane",
    name: "Banane",
    brand: "Standard",
    caloriesPer100g: 89,
    proteinPer100g: 1.1,
    carbsPer100g: 23,
    fatPer100g: 0.3,
    aliases: ["banana"],
    source: "Common food",
  },
  {
    id: "common:apfel",
    name: "Apfel",
    brand: "Standard",
    caloriesPer100g: 52,
    proteinPer100g: 0.3,
    carbsPer100g: 14,
    fatPer100g: 0.2,
    aliases: ["apple"],
    source: "Common food",
  },
  {
    id: "common:paprika-gruen",
    name: "Paprika grün",
    brand: "Standard",
    caloriesPer100g: 20,
    proteinPer100g: 0.9,
    carbsPer100g: 4.6,
    fatPer100g: 0.2,
    aliases: ["paprika", "paprika gruen", "grüne paprika", "gruene paprika", "paprikaschote"],
    source: "Common food",
  },
  {
    id: "common:paprika-rot",
    name: "Paprika rot",
    brand: "Standard",
    caloriesPer100g: 43,
    proteinPer100g: 1.3,
    carbsPer100g: 6.4,
    fatPer100g: 0.5,
    aliases: ["paprika", "rote paprika", "paprikaschote rot", "red bell pepper"],
    source: "Common food",
  },
  {
    id: "common:paprika-gelb",
    name: "Paprika gelb",
    brand: "Standard",
    caloriesPer100g: 27,
    proteinPer100g: 1,
    carbsPer100g: 5.3,
    fatPer100g: 0.2,
    aliases: ["paprika", "gelbe paprika", "paprikaschote gelb", "yellow bell pepper"],
    source: "Common food",
  },
  {
    id: "common:reis-gekocht",
    name: "Reis gekocht",
    brand: "Standard",
    caloriesPer100g: 130,
    proteinPer100g: 2.7,
    carbsPer100g: 28,
    fatPer100g: 0.3,
    aliases: ["reis", "rice"],
    source: "Common food",
  },
  {
    id: "common:nudeln-gekocht",
    name: "Nudeln gekocht",
    brand: "Standard",
    caloriesPer100g: 158,
    proteinPer100g: 5.8,
    carbsPer100g: 31,
    fatPer100g: 0.9,
    aliases: ["nudeln", "pasta"],
    source: "Common food",
  },
  {
    id: "common:kartoffeln",
    name: "Kartoffeln gekocht",
    brand: "Standard",
    caloriesPer100g: 86,
    proteinPer100g: 1.9,
    carbsPer100g: 20,
    fatPer100g: 0.1,
    aliases: ["kartoffel", "potato"],
    source: "Common food",
  },
  {
    id: "common:haehnchenbrust",
    name: "Hähnchenbrust",
    brand: "Standard",
    caloriesPer100g: 110,
    proteinPer100g: 23,
    carbsPer100g: 0,
    fatPer100g: 1.5,
    aliases: ["hähnchen", "haehnchen", "huhn", "chicken breast"],
    source: "Common food",
  },
  {
    id: "common:thunfisch",
    name: "Thunfisch im eigenen Saft",
    brand: "Standard",
    caloriesPer100g: 116,
    proteinPer100g: 25.5,
    carbsPer100g: 0,
    fatPer100g: 1,
    aliases: ["thunfisch", "tuna"],
    source: "Common food",
  },
  {
    id: "common:ei",
    name: "Ei",
    brand: "Standard",
    caloriesPer100g: 155,
    proteinPer100g: 13,
    carbsPer100g: 1.1,
    fatPer100g: 11,
    aliases: ["eier", "egg"],
    source: "Common food",
  },
];

const nowLocal = () => new Date().toISOString().slice(0, 16);
const todayLocal = () => nowLocal().slice(0, 10);

function gramsFor(entry: Pick<FoodEntry, "quantityUnit" | "quantityValue">) {
  return entry.quantityUnit === "kg" ? entry.quantityValue * 1000 : entry.quantityValue;
}

function caloriesFor(entry: Pick<FoodEntry, "quantityUnit" | "quantityValue" | "caloriesPer100g">) {
  return Math.round((gramsFor(entry) / 100) * entry.caloriesPer100g);
}

function macroFor(
  entry: Pick<FoodEntry, "quantityUnit" | "quantityValue">,
  valuePer100g: number,
) {
  return (gramsFor(entry) / 100) * valuePer100g;
}

function App() {
  const [activeView, setActiveView] = useState<AppView>("tracker");
  const [entries, setEntries] = useState<FoodEntry[]>([]);
  const [selectedDate, setSelectedDate] = useState(todayLocal());
  const [nutritionConfig, setNutritionConfig] = useState<NutritionConfig>(defaultNutritionConfig);
  const [aiConfig, setAiConfig] = useState<AiConfig>(defaultAiConfig);
  const [aiDraft, setAiDraft] = useState<AiConfigDraft>({
    provider: defaultAiConfig.provider,
    model: defaultAiConfig.model,
    apiKey: "",
  });
  const [isConfigLoaded, setConfigLoaded] = useState(false);
  const [draft, setDraft] = useState<FoodDraft>({
    foodName: "",
    quantityValue: 100,
    quantityUnit: "g",
    caloriesPer100g: 100,
    proteinPer100g: 0,
    carbsPer100g: 0,
    fatPer100g: 0,
    consumedAt: nowLocal(),
    source: "manual",
  });
  const [results, setResults] = useState<FoodSearchResult[]>([]);
  const [searchState, setSearchState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [photoPreview, setPhotoPreview] = useState("");
  const [photoAnalysis, setPhotoAnalysis] = useState<FoodImageAnalysis | null>(null);
  const [photoState, setPhotoState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [photoError, setPhotoError] = useState("");
  const [aiFoodText, setAiFoodText] = useState("");
  const [textAnalysis, setTextAnalysis] = useState<FoodImageAnalysis | null>(null);
  const [textAnalysisState, setTextAnalysisState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [textAnalysisError, setTextAnalysisError] = useState("");
  const [entryError, setEntryError] = useState("");
  const [aiConfigError, setAiConfigError] = useState("");
  const [aiConfigState, setAiConfigState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [aiModelsState, setAiModelsState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [isAutocompleteOpen, setAutocompleteOpen] = useState(false);
  const [activeResultIndex, setActiveResultIndex] = useState(0);
  const quantityInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const dayEntries = useMemo(
    () => entries.filter((entry) => entry.consumedAt.slice(0, 10) === selectedDate),
    [entries, selectedDate],
  );

  const sortedEntries = useMemo(
    () => [...dayEntries].sort((left, right) => right.consumedAt.localeCompare(left.consumedAt)),
    [dayEntries],
  );

  const totals = useMemo(
    () =>
      dayEntries.reduce(
        (sum, entry) => ({
          calories: sum.calories + caloriesFor(entry),
          grams: sum.grams + gramsFor(entry),
          protein: sum.protein + macroFor(entry, entry.proteinPer100g),
          carbs: sum.carbs + macroFor(entry, entry.carbsPer100g),
          fat: sum.fat + macroFor(entry, entry.fatPer100g),
        }),
        { calories: 0, grams: 0, protein: 0, carbs: 0, fat: 0 },
      ),
    [dayEntries],
  );

  const draftCalories = caloriesFor(draft);
  const usageMap = useMemo(() => buildUsageMap(entries), [entries]);
  const selectedPreset = macroPresets[nutritionConfig.goal];
  const macroTargets = useMemo(
    () => calculateMacroTargets(nutritionConfig.calorieGoal, selectedPreset),
    [nutritionConfig.calorieGoal, selectedPreset],
  );
  const progress = Math.min(100, Math.round((totals.calories / nutritionConfig.calorieGoal) * 100));

  useEffect(() => {
    let isMounted = true;

    async function loadBackendState() {
      try {
        const [entriesResponse, configResponse, aiConfigResponse] = await Promise.all([
          fetchEntries(),
          fetchNutritionConfig(),
          fetchAiConfig(),
        ]);
        if (!isMounted) return;
        setEntries(entriesResponse);
        setNutritionConfig(configResponse);
        setAiConfig(aiConfigResponse);
        setAiDraft({
          provider: aiConfigResponse.provider,
          model: aiConfigResponse.model,
          apiKey: "",
        });
      } finally {
        if (isMounted) setConfigLoaded(true);
      }
    }

    void loadBackendState();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!isConfigLoaded) return;
    const timeoutId = window.setTimeout(() => {
      void saveNutritionConfig(nutritionConfig).catch(() => undefined);
    }, 300);

    return () => window.clearTimeout(timeoutId);
  }, [isConfigLoaded, nutritionConfig]);

  const searchFoods = useCallback(async (searchTerm = draft.foodName.trim(), signal?: AbortSignal) => {
    const trimmedQuery = searchTerm.trim();
    if (trimmedQuery.length < 2) {
      setResults([]);
      setSearchState("idle");
      return;
    }

    setSearchState("loading");
    const localResults = findLocalFoodResults(trimmedQuery, entries, usageMap);
    setResults(localResults);
    setActiveResultIndex(0);

    try {
      const remoteResults = (await fetchFoodHits(trimmedQuery, signal)).map((result) => ({
        ...result,
        usageCount: Math.max(
          usageMap.get(normalizeFoodKey(result.id)) ?? 0,
          usageMap.get(normalizeFoodKey(result.name)) ?? 0,
        ),
      }));
      const nextResults = sortFoodResults(dedupeResults([...localResults, ...remoteResults]), trimmedQuery).slice(0, 12);
      setResults(nextResults);
      setActiveResultIndex(0);
      setSearchState("done");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setResults(localResults);
      setSearchState(localResults.length > 0 ? "done" : "error");
    }
  }, [draft.foodName, entries, usageMap]);

  useEffect(() => {
    const trimmedQuery = draft.foodName.trim();
    if (!isAutocompleteOpen || trimmedQuery.length < 2) {
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      void searchFoods(trimmedQuery, controller.signal);
    }, 250);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [draft.foodName, isAutocompleteOpen, searchFoods]);

  async function addEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const foodName = draft.foodName.trim();
    if (!foodName || draft.quantityValue <= 0 || draft.caloriesPer100g < 0 || !draft.consumedAt) return;

    setEntryError("");
    try {
      const entry = await createEntry({
        ...draft,
        foodName,
      });
      setEntries((currentEntries) => [entry, ...currentEntries]);
      setSelectedDate(entry.consumedAt.slice(0, 10));
      setDraft({ ...draft, foodName: "", consumedAt: nowLocal() });
    } catch (error) {
      setEntryError(error instanceof Error ? error.message : "Eintrag konnte nicht gespeichert werden.");
    }
  }

  async function saveAiSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAiConfigError("");
    setAiConfigState("saving");
    try {
      const savedConfig = await saveAiConfig(aiDraft);
      setAiConfig(savedConfig);
      setAiDraft({ provider: savedConfig.provider, model: savedConfig.model, apiKey: "" });
      setAiConfigState("saved");
    } catch {
      setAiConfigError("Konfiguration konnte nicht gespeichert werden.");
      setAiConfigState("error");
    }
  }

  function updateAiProvider(provider: string) {
    const providerOption = aiConfig.providers.find((option) => option.id === provider);
    setAiDraft({
      ...aiDraft,
      provider,
      model: providerOption?.models[0] ?? aiDraft.model,
    });
    setAiConfigState("idle");
    setAiConfigError("");
    setAiModelsState("idle");
  }

  async function refreshAiModels() {
    setAiModelsState("loading");
    try {
      let nextConfig = aiConfig;
      if (aiDraft.apiKey.trim()) {
        nextConfig = await saveAiConfig(aiDraft);
        setAiConfig(nextConfig);
        setAiDraft({ provider: nextConfig.provider, model: nextConfig.model, apiKey: "" });
      }

      const models = await fetchAiModels(aiDraft.provider);
      const providers = nextConfig.providers.map((provider) =>
        provider.id === aiDraft.provider ? { ...provider, models } : provider,
      );
      const model = models.includes(aiDraft.model) ? aiDraft.model : models[0];
      setAiConfig({ ...nextConfig, providers });
      setAiDraft((currentDraft) => ({ ...currentDraft, model }));
      setAiModelsState("done");
    } catch {
      setAiConfigError("Modellliste konnte nicht geladen werden.");
      setAiModelsState("error");
    }
  }

  async function handlePhotoSelected(file: File | null) {
    setPhotoAnalysis(null);
    setPhotoError("");
    setPhotoState("idle");
    if (!file) {
      setPhotoPreview("");
      return;
    }

    if (!file.type.startsWith("image/")) {
      setPhotoPreview("");
      setPhotoError("Bitte ein Bild auswaehlen.");
      setPhotoState("error");
      return;
    }

    if (file.size > 5_500_000) {
      setPhotoPreview("");
      setPhotoError("Bild ist zu gross. Bitte unter 5 MB bleiben.");
      setPhotoState("error");
      return;
    }

    setPhotoPreview(await readFileAsDataUrl(file));
  }

  async function analyzePhoto() {
    if (!photoPreview) return;
    setPhotoState("loading");
    setPhotoError("");

    try {
      const analysis = await analyzeFoodPhoto(photoPreview);
      setPhotoAnalysis(analysis);
      applyPhotoAnalysis(analysis);
      setPhotoState("done");
    } catch (error) {
      setPhotoError(error instanceof Error ? error.message : "Fotoanalyse fehlgeschlagen.");
      setPhotoState("error");
    }
  }

  function applyPhotoAnalysis(analysis: FoodImageAnalysis) {
    setDraft({
      ...draft,
      foodKey: undefined,
      foodName: analysis.description,
      quantityValue: analysis.estimatedGrams,
      quantityUnit: "g",
      caloriesPer100g: analysis.caloriesPer100g,
      proteinPer100g: analysis.proteinPer100g,
      carbsPer100g: analysis.carbsPer100g,
      fatPer100g: analysis.fatPer100g,
      source: `AI ${analysis.provider}/${analysis.model}`,
      aiUsage: analysis.aiUsage,
    });
  }

  async function analyzeFoodText() {
    const description = aiFoodText.trim();
    if (!description) return;
    setTextAnalysisState("loading");
    setTextAnalysisError("");
    setTextAnalysis(null);

    try {
      const analysis = await analyzeFoodDescription(description);
      setTextAnalysis(analysis);
      applyPhotoAnalysis(analysis);
      setTextAnalysisState("done");
    } catch (error) {
      setTextAnalysisError(error instanceof Error ? error.message : "Textanalyse fehlgeschlagen.");
      setTextAnalysisState("error");
    }
  }

  async function saveTextAnalysis() {
    if (!textAnalysis) return;
    setEntryError("");
    try {
      const entry = await createEntry({
        foodName: textAnalysis.description,
        quantityValue: textAnalysis.estimatedGrams,
        quantityUnit: "g",
        caloriesPer100g: textAnalysis.caloriesPer100g,
        proteinPer100g: textAnalysis.proteinPer100g,
        carbsPer100g: textAnalysis.carbsPer100g,
        fatPer100g: textAnalysis.fatPer100g,
        consumedAt: draft.consumedAt,
        source: `AI ${textAnalysis.provider}/${textAnalysis.model}`,
        aiUsage: textAnalysis.aiUsage,
      });
      setEntries((currentEntries) => [entry, ...currentEntries]);
      setSelectedDate(entry.consumedAt.slice(0, 10));
      setTextAnalysis(null);
      setAiFoodText("");
      setTextAnalysisState("idle");
    } catch (error) {
      setEntryError(error instanceof Error ? error.message : "AI-Text-Eintrag konnte nicht gespeichert werden.");
    }
  }

  async function savePhotoAnalysis() {
    if (!photoAnalysis) return;
    setEntryError("");
    try {
      const entry = await createEntry({
        foodName: photoAnalysis.description,
        quantityValue: photoAnalysis.estimatedGrams,
        quantityUnit: "g",
        caloriesPer100g: photoAnalysis.caloriesPer100g,
        proteinPer100g: photoAnalysis.proteinPer100g,
        carbsPer100g: photoAnalysis.carbsPer100g,
        fatPer100g: photoAnalysis.fatPer100g,
        consumedAt: draft.consumedAt,
        source: `AI ${photoAnalysis.provider}/${photoAnalysis.model}`,
        aiUsage: photoAnalysis.aiUsage,
      });
      setEntries((currentEntries) => [entry, ...currentEntries]);
      setSelectedDate(entry.consumedAt.slice(0, 10));
      setPhotoPreview("");
      setPhotoAnalysis(null);
      setPhotoState("idle");
      if (photoInputRef.current) photoInputRef.current.value = "";
    } catch (error) {
      setEntryError(error instanceof Error ? error.message : "Foto-Eintrag konnte nicht gespeichert werden.");
    }
  }

  function selectFood(result: FoodSearchResult) {
    setDraft({
      ...draft,
      foodKey: result.id,
      foodName: result.brand ? `${result.name} · ${result.brand}` : result.name,
      caloriesPer100g: result.caloriesPer100g,
      proteinPer100g: result.proteinPer100g,
      carbsPer100g: result.carbsPer100g,
      fatPer100g: result.fatPer100g,
      source: result.source,
    });
    setAutocompleteOpen(false);
    setActiveResultIndex(0);
    window.setTimeout(() => quantityInputRef.current?.select(), 0);
  }

  async function deleteEntry(id: string) {
    await deleteBackendEntry(id);
    setEntries(entries.filter((entry) => entry.id !== id));
  }

  function updateFoodName(value: string) {
    setDraft({ ...draft, foodName: value, foodKey: undefined, source: "manual" });
    setAutocompleteOpen(true);
    if (value.trim().length < 2) {
      setResults([]);
      setSearchState("idle");
      setActiveResultIndex(0);
    }
  }

  function handleFoodKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!isAutocompleteOpen || results.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveResultIndex((index) => Math.min(index + 1, results.length - 1));
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveResultIndex((index) => Math.max(index - 1, 0));
    }

    if (event.key === "Enter") {
      event.preventDefault();
      selectFood(results[activeResultIndex]);
    }

    if (event.key === "Escape") {
      setAutocompleteOpen(false);
    }
  }

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <div className="hero-copy">
          <p className="eyebrow">
            <ShieldCheck size={16} aria-hidden="true" />
            Tagesprotokoll
          </p>
          <h1>Food Tracker</h1>
        </div>
        <div className="goal-card" aria-label="Daily calorie progress">
          <div className="goal-card__top">
            <Target size={22} aria-hidden="true" />
            <span>Tagesziel</span>
          </div>
          <strong>{totals.calories.toLocaleString()} kcal</strong>
          <div className="progress-track">
            <span style={{ width: `${progress}%` }} />
          </div>
          <small>{progress}% of {nutritionConfig.calorieGoal.toLocaleString()} kcal</small>
        </div>
      </section>

      <nav className="view-tabs" aria-label="App views">
        <button className={activeView === "tracker" ? "view-tab view-tab--active" : "view-tab"} type="button" onClick={() => setActiveView("tracker")}>
          <Utensils size={17} aria-hidden="true" />
          Protokoll
        </button>
        <button className={activeView === "settings" ? "view-tab view-tab--active" : "view-tab"} type="button" onClick={() => setActiveView("settings")}>
          <Settings size={17} aria-hidden="true" />
          Konfiguration
        </button>
      </nav>

      {activeView === "settings" && (
        <section className="settings-page" aria-label="Nutrition configuration page">
          <section className="config-panel config-panel--page" aria-label="Nutrition configuration">
            <div className="config-copy">
              <p className="eyebrow eyebrow--dark">
                <Activity size={16} aria-hidden="true" />
                Ziele
              </p>
              <h2>Nährwerte</h2>
              <p>{selectedPreset.note}</p>
            </div>
            <div className="config-controls">
              <NumberInput
                label="Zielkalorien"
                min={800}
                step={50}
                value={nutritionConfig.calorieGoal}
                onChange={(calorieGoal) => setNutritionConfig({ ...nutritionConfig, calorieGoal })}
              />
              <label>
                Ziel
                <select
                  value={nutritionConfig.goal}
                  onChange={(event) => setNutritionConfig({ ...nutritionConfig, goal: event.target.value as NutritionGoal })}
                >
                  {Object.entries(macroPresets).map(([value, preset]) => (
                    <option value={value} key={value}>{preset.label}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="macro-target-grid" aria-label="Calculated macro targets">
              <MacroTarget label="Kohlenhydrate" grams={macroTargets.carbs.grams} calories={macroTargets.carbs.calories} percent={selectedPreset.carbs} />
              <MacroTarget label="Protein" grams={macroTargets.protein.grams} calories={macroTargets.protein.calories} percent={selectedPreset.protein} />
              <MacroTarget label="Fett" grams={macroTargets.fat.grams} calories={macroTargets.fat.calories} percent={selectedPreset.fat} />
            </div>
          </section>
          <form className="config-panel config-panel--page ai-config-panel" aria-label="AI photo analysis configuration" onSubmit={saveAiSettings}>
            <div className="config-copy">
              <p className="eyebrow eyebrow--dark">
                <KeyRound size={16} aria-hidden="true" />
                Foto
              </p>
              <h2>Fotoanalyse</h2>
            </div>
            <div className="config-controls">
              <label>
                Anbieter
                <select value={aiDraft.provider} onChange={(event) => updateAiProvider(event.target.value)}>
                  {aiConfig.providers.map((provider) => (
                    <option value={provider.id} key={provider.id}>{provider.label}</option>
                  ))}
                </select>
              </label>
              <label>
                Modell
                <select value={aiDraft.model} onChange={(event) => {
                  setAiDraft({ ...aiDraft, model: event.target.value });
                  setAiConfigState("idle");
                }}>
                  {(aiConfig.providers.find((provider) => provider.id === aiDraft.provider)?.models ?? []).map((model) => (
                    <option value={model} key={model}>{model}</option>
                  ))}
                </select>
              </label>
              <button className="secondary-button" type="button" disabled={aiModelsState === "loading"} onClick={() => void refreshAiModels()}>
                {aiModelsState === "loading" ? <Loader2 className="spin" size={18} aria-hidden="true" /> : <Sparkles size={18} aria-hidden="true" />}
                Modelle live abrufen
              </button>
            </div>
            <div className="config-controls">
              <label>
                API-Key
                <input
                  type="password"
                  value={aiDraft.apiKey}
                  onChange={(event) => {
                    setAiDraft({ ...aiDraft, apiKey: event.target.value });
                    setAiConfigState("idle");
                  }}
                  placeholder={aiConfig.hasApiKey ? `Gespeichert: ${aiConfig.keyHint}` : "Key einmalig eintragen"}
                  autoComplete="off"
                />
              </label>
              <button className="primary-button" type="submit" disabled={aiConfigState === "saving"}>
                {aiConfigState === "saving" ? <Loader2 className="spin" size={18} aria-hidden="true" /> : <ShieldCheck size={18} aria-hidden="true" />}
                AI-Konfiguration speichern
              </button>
              <p className={aiConfigState === "error" ? "config-status config-status--error" : "config-status"}>
                {aiConfigState === "saved" && "Gespeichert."}
                {aiConfigState === "error" && (aiConfigError || "Konnte nicht gespeichert werden.")}
                {aiConfigState === "idle" && (aiConfig.hasApiKey ? `Key hinterlegt: ${aiConfig.keyHint}` : "Noch kein Key hinterlegt.")}
              </p>
              <p className={aiModelsState === "error" ? "config-status config-status--error" : "config-status"}>
                {aiModelsState === "done" && "Modellliste aktualisiert."}
                {aiModelsState === "error" && (aiConfigError || "Live-Abruf fehlgeschlagen. Fallback-Liste bleibt aktiv.")}
                {aiModelsState === "idle" && "OpenAI braucht einen gespeicherten Key fuer den Live-Abruf."}
              </p>
            </div>
          </form>
        </section>
      )}

      {activeView === "tracker" && (
        <>
      <section className="workspace-grid">
        <form className="entry-form" onSubmit={addEntry}>
          <h2>Neuer Eintrag</h2>
          <section className="photo-panel" aria-label="Food photo analysis">
            <div className="search-panel__heading">
              <Camera size={18} aria-hidden="true" />
              <span>Foto analysieren</span>
              <small>{aiConfig.hasApiKey ? aiConfig.model : "Key fehlt"}</small>
            </div>
            <input
              ref={photoInputRef}
              className="photo-input"
              type="file"
              accept="image/*"
              onChange={(event) => void handlePhotoSelected(event.target.files?.[0] ?? null)}
            />
            <input
              ref={cameraInputRef}
              className="photo-input photo-input--hidden"
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(event) => void handlePhotoSelected(event.target.files?.[0] ?? null)}
            />
            <div className={photoPreview ? "photo-drop photo-drop--active" : "photo-drop"}>
              {photoPreview ? <img src={photoPreview} alt="Ausgewaehltes Essen" /> : <ImagePlus size={28} aria-hidden="true" />}
              <span>{photoPreview ? "Bild bereit fuer Analyse" : "Bild aus Album auswaehlen oder Kamera nutzen"}</span>
            </div>
            <div className="photo-actions">
              <button className="secondary-button" type="button" onClick={() => cameraInputRef.current?.click()}>
                <Camera size={18} aria-hidden="true" />
                Kamera
              </button>
              <button className="secondary-button" type="button" disabled={!photoPreview || photoState === "loading" || !aiConfig.hasApiKey} onClick={() => void analyzePhoto()}>
                {photoState === "loading" ? <Loader2 className="spin" size={18} aria-hidden="true" /> : <Sparkles size={18} aria-hidden="true" />}
                Analysieren
              </button>
              {photoAnalysis && (
                <button className="secondary-button secondary-button--dark" type="button" onClick={() => void savePhotoAnalysis()}>
                  <Plus size={18} aria-hidden="true" />
                  Ins Tagesprotokoll
                </button>
              )}
            </div>
            {photoError && <p className="photo-note photo-note--error">{photoError}</p>}
            {!aiConfig.hasApiKey && <p className="photo-note">API-Key zuerst in der Konfiguration speichern.</p>}
            {photoAnalysis && (
              <div className="analysis-card" aria-live="polite">
                <strong>{photoAnalysis.description}</strong>
                <span>{photoAnalysis.estimatedGrams} g · {photoAnalysis.calories} kcal · Sicherheit {confidenceLabel(photoAnalysis.confidence)}</span>
                <small>P {formatMacro(photoAnalysis.protein)}g · C {formatMacro(photoAnalysis.carbs)}g · F {formatMacro(photoAnalysis.fat)}g</small>
                {photoAnalysis.aiUsage && <small>Usage-Rohwerte werden mit dem Eintrag gespeichert.</small>}
              </div>
            )}
          </section>
          <section className="ai-text-panel" aria-label="AI text analysis">
            <div className="search-panel__heading">
              <MessageSquareText size={18} aria-hidden="true" />
              <span>AI-Text</span>
              <small>{aiConfig.hasApiKey ? aiConfig.model : "Key fehlt"}</small>
            </div>
            <label>
              Beschreibung
              <textarea
                value={aiFoodText}
                onChange={(event) => {
                  setAiFoodText(event.target.value);
                  setTextAnalysisState("idle");
                  setTextAnalysis(null);
                }}
                placeholder="Omelette mit Schinken, Zwiebeln und Champignons"
                rows={3}
              />
            </label>
            <div className="photo-actions">
              <button className="secondary-button" type="button" disabled={!aiFoodText.trim() || textAnalysisState === "loading" || !aiConfig.hasApiKey} onClick={() => void analyzeFoodText()}>
                {textAnalysisState === "loading" ? <Loader2 className="spin" size={18} aria-hidden="true" /> : <Sparkles size={18} aria-hidden="true" />}
                Schätzen
              </button>
              {textAnalysis && (
                <button className="secondary-button secondary-button--dark" type="button" onClick={() => void saveTextAnalysis()}>
                  <Plus size={18} aria-hidden="true" />
                  Ins Tagesprotokoll
                </button>
              )}
            </div>
            {textAnalysisError && <p className="photo-note photo-note--error">{textAnalysisError}</p>}
            {!aiConfig.hasApiKey && <p className="photo-note">API-Key zuerst in der Konfiguration speichern.</p>}
            {textAnalysis && (
              <div className="analysis-card" aria-live="polite">
                <strong>{textAnalysis.description}</strong>
                <span>{textAnalysis.estimatedGrams} g · {textAnalysis.calories} kcal · Sicherheit {confidenceLabel(textAnalysis.confidence)}</span>
                <small>P {formatMacro(textAnalysis.protein)}g · C {formatMacro(textAnalysis.carbs)}g · F {formatMacro(textAnalysis.fat)}g</small>
                {textAnalysis.aiUsage && <small>Usage-Rohwerte werden mit dem Eintrag gespeichert.</small>}
              </div>
            )}
          </section>
          <section className="search-panel search-panel--embedded" aria-label="Food search">
            <div className="search-panel__heading">
              <Database size={18} aria-hidden="true" />
              <span>1. Lebensmittel suchen</span>
              <small>Datenbank</small>
            </div>
            <div className="food-search autocomplete-shell">
              <label>
                Lebensmittel
                <div className="search-input">
                  <input
                    role="combobox"
                    aria-autocomplete="list"
                    aria-expanded={isAutocompleteOpen}
                    aria-controls="food-autocomplete-list"
                    aria-activedescendant={isAutocompleteOpen && results[activeResultIndex] ? `food-option-${results[activeResultIndex].id}` : undefined}
                    value={draft.foodName}
                    onChange={(event) => updateFoodName(event.target.value)}
                    onFocus={() => setAutocompleteOpen(true)}
                    onBlur={() => window.setTimeout(() => setAutocompleteOpen(false), 120)}
                    onKeyDown={handleFoodKeyDown}
                    placeholder="z.B. körniger Frischkäse, Milbona Skyr"
                  />
                  <button type="button" aria-label="Search food database" onMouseDown={(event) => event.preventDefault()} onClick={() => {
                    setAutocompleteOpen(true);
                    void searchFoods();
                  }}>
                    {searchState === "loading" ? <Loader2 className="spin" size={18} aria-hidden="true" /> : <Search size={18} aria-hidden="true" />}
                  </button>
                </div>
              </label>
            </div>
            <div className={isAutocompleteOpen ? "result-list result-list--open" : "result-list"} id="food-autocomplete-list" role="listbox" aria-live="polite">
              {searchState === "error" && <p className="search-note">Datenbank gerade nicht erreichbar. Manuelle Eingabe geht weiterhin.</p>}
              {searchState === "done" && results.length === 0 && <p className="search-note">Keine passenden Nährwerte gefunden. Du kannst unten manuell ergänzen.</p>}
              {results.map((result, index) => (
                <button
                  className={index === activeResultIndex ? "result-item result-item--active" : "result-item"}
                  type="button"
                  id={`food-option-${result.id}`}
                  role="option"
                  aria-selected={index === activeResultIndex}
                  key={result.id}
                  onMouseEnter={() => setActiveResultIndex(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectFood(result)}
                >
                  {result.imageUrl ? <img src={result.imageUrl} alt="" /> : <span className="result-placeholder"><Utensils size={18} aria-hidden="true" /></span>}
                  <span>
                    <strong>{result.name}</strong>
                    <small>
                      {result.brand || result.source} · {result.caloriesPer100g} kcal / 100g
                      {result.usageCount > 0 ? ` · used ${result.usageCount}x` : ""}
                    </small>
                  </span>
                </button>
              ))}
            </div>
          </section>
          <div className={draft.foodKey ? "selection-card selection-card--active" : "selection-card"} aria-live="polite">
            <span>2. Auswahl</span>
            <strong>{draft.foodName || "Noch kein Lebensmittel gewählt"}</strong>
            <small>{draft.foodKey ? `${draft.source ?? "Datenbank"} · ${draft.caloriesPer100g} kcal / 100g` : "Suche nutzen, Treffer anklicken, dann Gewicht eingeben."}</small>
          </div>
          <div className="quantity-grid">
            <NumberInput inputRef={quantityInputRef} label="3. Gewicht" min={0.001} step={0.001} value={draft.quantityValue} onChange={(quantityValue) => setDraft({ ...draft, quantityValue })} />
            <label>
              Einheit
              <select value={draft.quantityUnit} onChange={(event) => setDraft({ ...draft, quantityUnit: event.target.value as Unit })}>
                <option value="g">g</option>
                <option value="kg">kg</option>
              </select>
            </label>
          </div>
          <details className="manual-nutrition">
            <summary>Optionale Nährwerte</summary>
            <label>
              Zeitpunkt
              <input type="datetime-local" value={draft.consumedAt} onChange={(event) => setDraft({ ...draft, consumedAt: event.target.value })} />
            </label>
            <NumberInput label="Kalorien / 100g" min={0} step={1} value={draft.caloriesPer100g} onChange={(caloriesPer100g) => setDraft({ ...draft, caloriesPer100g })} />
            <div className="macro-grid">
              <NumberInput label="Protein / 100g" min={0} step={0.1} value={draft.proteinPer100g} onChange={(proteinPer100g) => setDraft({ ...draft, proteinPer100g })} />
              <NumberInput label="Kohlenhydrate / 100g" min={0} step={0.1} value={draft.carbsPer100g} onChange={(carbsPer100g) => setDraft({ ...draft, carbsPer100g })} />
              <NumberInput label="Fett / 100g" min={0} step={0.1} value={draft.fatPer100g} onChange={(fatPer100g) => setDraft({ ...draft, fatPer100g })} />
            </div>
          </details>
          <div className="calculation-strip">
            <span>{draft.source && draft.source !== "manual" ? "Datenbankwerte" : "Berechnet"}</span>
            <strong>{draftCalories.toLocaleString()} kcal</strong>
          </div>
          <button className="primary-button" type="submit">
            <Plus size={18} aria-hidden="true" />
            4. Speichern
          </button>
          {entryError && <p className="form-error">{entryError}</p>}
        </form>

      </section>

      <section className="metric-grid" aria-label="Daily totals">
        <Metric icon={<Flame />} label="Kalorien" value={totals.calories} suffix="kcal" />
        <Metric icon={<Scale />} label="Menge" value={Math.round(totals.grams)} suffix="g" />
        <MacroMetric label="Protein" target={macroTargets.protein.grams} actual={totals.protein} />
        <MacroMetric label="Kohlenhydrate" target={macroTargets.carbs.grams} actual={totals.carbs} />
        <MacroMetric label="Fett" target={macroTargets.fat.grams} actual={totals.fat} />
      </section>

      <section className="entry-list" aria-label="Food entries">
        <div className="section-heading">
          <h2>{selectedDate === todayLocal() ? "Heute" : formatDateLabel(selectedDate)}</h2>
          <label className="date-filter">
            Tag
            <input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value || todayLocal())} />
          </label>
          <span>{dayEntries.length} Einträge</span>
        </div>
        {sortedEntries.length === 0 && <p className="empty-state">Noch keine Einträge fuer diesen Tag.</p>}
        {sortedEntries.map((entry) => (
          <article className="food-row" key={entry.id}>
            <div>
              <span className="time-tag">{formatDateTime(entry.consumedAt)}</span>
              <h3>{entry.foodName}</h3>
              <p>
                {formatQuantity(entry)} / {entry.caloriesPer100g.toLocaleString()} kcal per 100g
              </p>
              <p className="macro-line">
                P {formatMacro(macroFor(entry, entry.proteinPer100g))}g · C {formatMacro(macroFor(entry, entry.carbsPer100g))}g · F {formatMacro(macroFor(entry, entry.fatPer100g))}g
              </p>
            </div>
            <div className="food-actions">
              <strong>{caloriesFor(entry).toLocaleString()} kcal</strong>
              <button type="button" aria-label={`Delete ${entry.foodName}`} onClick={() => deleteEntry(entry.id)}>
                <Trash2 size={17} aria-hidden="true" />
              </button>
            </div>
          </article>
        ))}
      </section>
        </>
      )}
    </main>
  );
}

function Metric({ icon, label, value, suffix }: { icon: ReactNode; label: string; value: number | string; suffix: string }) {
  return (
    <article className="metric-card">
      <span className="metric-icon" aria-hidden="true">{icon}</span>
      <p>{label}</p>
      <strong>{typeof value === "number" ? value.toLocaleString() : value} {suffix && <small>{suffix}</small>}</strong>
    </article>
  );
}

function MacroMetric({ label, target, actual }: { label: string; target: number; actual: number }) {
  const roundedActual = Math.round(actual);
  const progress = target > 0 ? Math.min(100, Math.round((actual / target) * 100)) : 0;

  return (
    <article className="metric-card macro-metric">
      <p>{label}</p>
      <div className="macro-metric__values">
        <span>
          <small>Ist</small>
          <strong>{roundedActual.toLocaleString("de-DE")} g</strong>
        </span>
        <span>
          <small>Ziel</small>
          <strong>{target.toLocaleString("de-DE")} g</strong>
        </span>
      </div>
      <div className="progress-track progress-track--small">
        <span style={{ width: `${progress}%` }} />
      </div>
    </article>
  );
}

function MacroTarget({ label, grams, calories, percent }: { label: string; grams: number; calories: number; percent: number }) {
  return (
    <article className="macro-target">
      <span>{label}</span>
      <strong>{grams.toLocaleString("de-DE")} g</strong>
      <small>{calories.toLocaleString("de-DE")} kcal · {Math.round(percent * 100)}%</small>
    </article>
  );
}

async function fetchEntries(): Promise<FoodEntry[]> {
  const response = await fetch("/api/entries");
  if (!response.ok) throw new Error("Entries request failed");
  const data = (await response.json()) as { entries?: FoodEntry[] };
  return (data.entries ?? []).map(normalizeBackendEntry);
}

async function createEntry(draft: FoodDraft): Promise<FoodEntry> {
  const response = await fetch("/api/entries", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(draft),
  });
  if (!response.ok) throw new Error("Entry could not be saved");
  const data = (await response.json()) as { entry: FoodEntry };
  return normalizeBackendEntry(data.entry);
}

async function deleteBackendEntry(id: string) {
  const response = await fetch(`/api/entries/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!response.ok) throw new Error("Entry could not be deleted");
}

async function fetchNutritionConfig(): Promise<NutritionConfig> {
  const response = await fetch("/api/config/nutrition");
  if (!response.ok) throw new Error("Nutrition config request failed");
  const data = (await response.json()) as { config?: Partial<NutritionConfig> };
  return normalizeNutritionConfig(data.config);
}

async function saveNutritionConfig(config: NutritionConfig) {
  const response = await fetch("/api/config/nutrition", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(config),
  });
  if (!response.ok) throw new Error("Nutrition config could not be saved");
}

async function fetchAiConfig(): Promise<AiConfig> {
  const response = await fetch("/api/config/ai");
  if (!response.ok) throw new Error("AI config request failed");
  const data = (await response.json()) as Partial<AiConfig>;
  return normalizeAiConfig(data);
}

async function saveAiConfig(config: AiConfigDraft): Promise<AiConfig> {
  const response = await fetch("/api/config/ai", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(config),
  });
  if (!response.ok) throw new Error("AI config could not be saved");
  const data = (await response.json()) as Partial<AiConfig>;
  return normalizeAiConfig(data);
}

async function fetchAiModels(provider: string): Promise<string[]> {
  const params = new URLSearchParams({ provider });
  const response = await fetch(`/api/ai/models?${params.toString()}`);
  const data = (await response.json()) as { models?: string[]; error?: string };
  if (!response.ok || !Array.isArray(data.models)) throw new Error(data.error ?? "Modelle konnten nicht geladen werden.");
  return data.models;
}

async function analyzeFoodPhoto(imageDataUrl: string): Promise<FoodImageAnalysis> {
  const response = await fetch("/api/ai/analyze-food", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ imageDataUrl }),
  });
  const data = (await response.json()) as { analysis?: FoodImageAnalysis; error?: string };
  if (!response.ok || !data.analysis) throw new Error(data.error ?? "Fotoanalyse fehlgeschlagen.");
  return data.analysis;
}

async function analyzeFoodDescription(description: string): Promise<FoodImageAnalysis> {
  const response = await fetch("/api/ai/analyze-text", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ description }),
  });
  const data = (await response.json()) as { analysis?: FoodImageAnalysis; error?: string };
  if (!response.ok || !data.analysis) throw new Error(data.error ?? "Textanalyse fehlgeschlagen.");
  return data.analysis;
}

async function fetchFoodHits(searchTerm: string, signal?: AbortSignal): Promise<FoodSearchResult[]> {
  const params = new URLSearchParams({ q: searchTerm, limit: "12" });
  const response = await fetch(`/api/foods/search?${params.toString()}`, { signal });
  if (!response.ok) throw new Error("Food database request failed");
  const data = (await response.json()) as { hits?: FoodSearchResult[] };
  return data.hits ?? [];
}

function findCommonFoodCompletion(searchTerm: string) {
  const normalized = normalizeFoodKey(searchTerm);
  if (normalized.length < 2) return null;
  const match = COMMON_FOODS.find((food) =>
    commonFoodSearchKeys(food).some((key) => key.startsWith(normalized)),
  );
  return match?.name ?? null;
}

function findLocalFoodResults(
  searchTerm: string,
  entries: FoodEntry[],
  usageMap: Map<string, number>,
): FoodSearchResult[] {
  const normalizedQuery = normalizeFoodKey(searchTerm);
  const seen = new Set<string>();
  const matches: FoodSearchResult[] = [];

  for (const entry of entries) {
    const key = normalizeFoodKey(entry.foodKey || entry.foodName);
    if (seen.has(key) || !normalizeFoodKey(entry.foodName).includes(normalizedQuery)) continue;
    seen.add(key);
    matches.push({
      id: entry.foodKey || `recent:${entry.foodName}`,
      name: entry.foodName,
      brand: "",
      caloriesPer100g: entry.caloriesPer100g,
      proteinPer100g: entry.proteinPer100g,
      carbsPer100g: entry.carbsPer100g,
      fatPer100g: entry.fatPer100g,
      usageCount: Math.max(
        usageMap.get(normalizeFoodKey(entry.foodKey)) ?? 0,
        usageMap.get(normalizeFoodKey(entry.foodName)) ?? 0,
      ),
      source: "Recent entry",
    });
  }

  return sortFoodResults(dedupeResults(matches), searchTerm).slice(0, 5);
}

function commonFoodSearchKeys(food: CommonFood) {
  return [food.name, food.brand, ...food.aliases].map(normalizeFoodKey);
}

function buildUsageMap(entries: FoodEntry[]) {
  const usageMap = new Map<string, number>();
  for (const entry of entries) {
    const keys = [entry.foodKey, entry.foodName].filter(Boolean);
    for (const key of keys) {
      const normalized = normalizeFoodKey(key);
      usageMap.set(normalized, (usageMap.get(normalized) ?? 0) + 1);
    }
  }
  return usageMap;
}

function normalizeFoodKey(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function dedupeResults(results: FoodSearchResult[]) {
  const seen = new Set<string>();
  return results.filter((result) => {
    const idKey = normalizeFoodKey(result.id);
    const displayKey = normalizeFoodKey(`${result.name} ${result.brand}`);
    if (seen.has(idKey) || seen.has(displayKey)) return false;
    seen.add(idKey);
    seen.add(displayKey);
    return true;
  });
}

function sortFoodResults(results: FoodSearchResult[], searchTerm: string) {
  const query = normalizeFoodKey(searchTerm);
  const completion = findCommonFoodCompletion(searchTerm);
  return [...results].sort((left, right) => {
    const usageDelta = right.usageCount - left.usageCount;
    if (usageDelta !== 0) return usageDelta;

    return relevanceScore(right, query, completion) - relevanceScore(left, query, completion);
  });
}

function relevanceScore(result: FoodSearchResult, query: string, completion: string | null) {
  const name = normalizeFoodKey(result.name);
  const brand = normalizeFoodKey(result.brand);
  const completedQuery = normalizeFoodKey(completion);
  let score = 0;
  if (name === query) score += 50;
  if (name.startsWith(query)) score += 30;
  if (name.includes(query)) score += 15;
  if (brand.includes(query)) score += 5;
  if (completedQuery) {
    if (name === completedQuery) score += 80;
    if (name.startsWith(completedQuery)) score += 55;
    if (name.includes(completedQuery)) score += 25;
    if (brand.startsWith(completedQuery)) score += 18;
  }
  if (result.source === "Common food") score += 25;
  if (result.source === "Recent entry") score += 8;
  return score;
}

function isNutritionGoal(value: unknown): value is NutritionGoal {
  return typeof value === "string" && value in macroPresets;
}

function normalizeNutritionConfig(config: Partial<NutritionConfig> | undefined): NutritionConfig {
  const calorieGoal = Number(config?.calorieGoal);
  return {
    calorieGoal: Number.isFinite(calorieGoal) && calorieGoal >= 800 ? calorieGoal : defaultNutritionConfig.calorieGoal,
    goal: isNutritionGoal(config?.goal) ? config.goal : defaultNutritionConfig.goal,
  };
}

function normalizeAiConfig(config: Partial<AiConfig> | undefined): AiConfig {
  const providers = Array.isArray(config?.providers) && config.providers.length > 0
    ? config.providers
    : defaultAiConfig.providers;
  const provider = providers.some((option) => option.id === config?.provider)
    ? String(config?.provider)
    : defaultAiConfig.provider;
  const models = providers.find((option) => option.id === provider)?.models ?? defaultAiConfig.providers[0].models;
  const model = models.includes(String(config?.model)) ? String(config?.model) : models[0];

  return {
    provider,
    model,
    hasApiKey: Boolean(config?.hasApiKey),
    keyHint: String(config?.keyHint ?? ""),
    providers,
  };
}

function normalizeBackendEntry(entry: FoodEntry): FoodEntry {
  return {
    ...entry,
    proteinPer100g: Number(entry.proteinPer100g ?? 0),
    carbsPer100g: Number(entry.carbsPer100g ?? 0),
    fatPer100g: Number(entry.fatPer100g ?? 0),
  };
}

function calculateMacroTargets(calorieGoal: number, preset: MacroPreset) {
  return {
    protein: macroTarget(calorieGoal, preset.protein, 4),
    carbs: macroTarget(calorieGoal, preset.carbs, 4),
    fat: macroTarget(calorieGoal, preset.fat, 9),
  };
}

function macroTarget(calorieGoal: number, share: number, caloriesPerGram: number) {
  const calories = Math.round(calorieGoal * share);
  return {
    calories,
    grams: Math.round(calories / caloriesPerGram),
  };
}

function NumberInput({ label, min, step, value, onChange, inputRef }: { label: string; min: number; step: number; value: number; onChange: (value: number) => void; inputRef?: Ref<HTMLInputElement> }) {
  return (
    <label>
      {label}
      <input ref={inputRef} min={min} step={step} type="number" value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDateLabel(value: string) {
  return new Intl.DateTimeFormat("de-DE", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  }).format(new Date(`${value}T12:00:00`));
}

function formatQuantity(entry: FoodEntry) {
  return `${entry.quantityValue.toLocaleString("de-DE")} ${entry.quantityUnit}`;
}

function formatMacro(value: number) {
  return (Math.round(value * 10) / 10).toLocaleString("de-DE");
}

function confidenceLabel(value: FoodImageAnalysis["confidence"]) {
  if (value === "high") return "hoch";
  if (value === "low") return "niedrig";
  return "mittel";
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Bild konnte nicht gelesen werden."));
    reader.readAsDataURL(file);
  });
}

export default App;
