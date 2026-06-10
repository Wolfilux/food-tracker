import { FormEvent, KeyboardEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BarcodeFormat, BrowserMultiFormatReader, type IScannerControls } from "@zxing/browser";
import {
  Activity,
  BarChart3,
  Barcode,
  Camera,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Copy,
  Database,
  Download,
  Flame,
  ImagePlus,
  KeyRound,
  Loader2,
  Mail,
  MessageSquareText,
  Pencil,
  Plus,
  RefreshCw,
  Scale,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Star,
  Target,
  Trash2,
  Upload,
  Utensils,
  X,
} from "lucide-react";

type Unit = "g" | "kg";
type AppView = "tracker" | "analysis" | "settings";
type EntryMode = "search" | "barcode" | "photo" | "text" | "meal";

type FoodEntry = {
  id: string;
  foodKey?: string;
  mealId?: string;
  mealName?: string;
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
  imageDataUrl?: string;
};

type FoodDraft = Omit<FoodEntry, "id" | "createdAt">;

type MealTemplateItem = Omit<FoodDraft, "consumedAt" | "mealId" | "mealName" | "aiUsage">;

type SingleEntryGroup = { kind: "single"; entry: FoodEntry };

type MealEntryGroup = {
  kind: "meal";
  id: string;
  name: string;
  consumedAt: string;
  calories: number;
  entries: FoodEntry[];
  imageDataUrl?: string;
};

type EntryGroup = SingleEntryGroup | MealEntryGroup;

type MealTemplate = {
  id: string;
  name: string;
  createdAt: string;
  items: MealTemplateItem[];
};

type DisplayMealTemplate = MealTemplate & {
  source: "template" | "history";
};

type FoodSearchResult = {
  id: string;
  name: string;
  brand: string;
  caloriesPer100g: number;
  proteinPer100g: number;
  carbsPer100g: number;
  fatPer100g: number;
  imageUrl?: string;
  usageCount?: number;
  source: string;
};

type CommonFood = Omit<FoodSearchResult, "usageCount"> & {
  aliases: string[];
};

type NutritionGoal = "fat-loss" | "muscle-gain" | "maintenance" | "recomposition" | "weight-gain";

type NutritionConfig = {
  calorieGoal: number;
  calorieGoalOffset: number;
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

type WeeklyEmailConfig = {
  targetEmail: string;
};

type WeeklyEmailConfigDraft = WeeklyEmailConfig;

type GarminConfig = {
  username: string;
  hasCredential: boolean;
  keyHint: string;
  autoSyncMinutes: number;
};

type GarminConfigDraft = {
  username: string;
  authValue: string;
  autoSyncMinutes: number;
};

type ImportResult = {
  entriesImported: number;
  nutritionConfigImported: boolean;
  aiConfigImported: boolean;
  warnings: string[];
};

type GarminDailySummary = {
  configured: boolean;
  date: string;
  source: string;
  totalKilocalories?: number;
  activeKilocalories?: number;
  bmrKilocalories?: number;
  consumedKilocalories?: number;
  remainingKilocalories?: number;
  error?: string;
  fetchedAt?: string;
};

type WeeklyAiSignal = {
  label: "gut" | "okay" | "schlecht";
  score: number;
  message: string;
};

type WeeklyAiAnalysis = {
  weekStart: string;
  weekEnd: string;
  goalLabel: string;
  totals: {
    calories: number;
    calorieTarget: number;
    protein: number;
    proteinTarget: number;
    carbs: number;
    carbsTarget: number;
    fat: number;
    fatTarget: number;
    entryCount: number;
  };
  signal: WeeklyAiSignal;
  aiText: string;
  provider: string;
  model: string;
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
  matchedFood?: FoodSearchResult;
  items?: FoodImageAnalysisItem[];
};

type FoodImageAnalysisItem = Omit<FoodImageAnalysis, "provider" | "model" | "aiUsage" | "items"> & {
  matchedFood?: FoodSearchResult;
};

type MacroPreset = {
  label: string;
  protein: number;
  carbs: number;
  fat: number;
  note: string;
};

const createEmptyDraft = (): FoodDraft => ({
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

const defaultNutritionConfig: NutritionConfig = {
  calorieGoal: 2200,
  calorieGoalOffset: 0,
  goal: "maintenance",
};
const minimumCalorieGoal = 800;
const mealFavoritesStorageKey = "food-tracker:meal-favorites";
const mealTemplateFavoritesStorageKey = "food-tracker-template-favorites";

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
    },
  ],
};

const defaultGarminConfig: GarminConfig = {
  username: "",
  hasCredential: false,
  keyHint: "",
  autoSyncMinutes: 0,
};

const defaultWeeklyEmailConfig: WeeklyEmailConfig = {
  targetEmail: "",
};

const garminAutoSyncOptions = [
  { value: 0, label: "Aus" },
  { value: 15, label: "Alle 15 Minuten" },
  { value: 30, label: "Alle 30 Minuten" },
  { value: 45, label: "Alle 45 Minuten" },
  { value: 60, label: "Alle 60 Minuten" },
] as const;

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

type CalorieTimingCheckpoint = {
  time: string;
  percent: number;
};

const calorieTimingCheckpoints: CalorieTimingCheckpoint[] = [
  { time: "10:00", percent: 0.25 },
  { time: "14:00", percent: 0.55 },
  { time: "18:00", percent: 0.8 },
  { time: "21:00", percent: 1 },
];

const entryModes: Array<{ id: EntryMode; label: string; icon: ReactNode }> = [
  { id: "search", label: "Suchen", icon: <Search size={17} aria-hidden="true" /> },
  { id: "barcode", label: "Barcode", icon: <Barcode size={17} aria-hidden="true" /> },
  { id: "photo", label: "Foto", icon: <Camera size={17} aria-hidden="true" /> },
  { id: "text", label: "Beschreiben", icon: <MessageSquareText size={17} aria-hidden="true" /> },
  { id: "meal", label: "Vorlagen", icon: <Utensils size={17} aria-hidden="true" /> },
];

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
  const [entryMode, setEntryMode] = useState<EntryMode>("search");
  const [entries, setEntries] = useState<FoodEntry[]>([]);
  const [mealTemplates, setMealTemplates] = useState<MealTemplate[]>([]);
  const [selectedDate, setSelectedDate] = useState(todayLocal());
  const [nutritionConfig, setNutritionConfig] = useState<NutritionConfig>(defaultNutritionConfig);
  const [aiConfig, setAiConfig] = useState<AiConfig>(defaultAiConfig);
  const [aiDraft, setAiDraft] = useState<AiConfigDraft>({
    provider: defaultAiConfig.provider,
    model: defaultAiConfig.model,
    apiKey: "",
  });
  const [analysisAiConfig, setAnalysisAiConfig] = useState<AiConfig>(defaultAiConfig);
  const [analysisAiDraft, setAnalysisAiDraft] = useState<AiConfigDraft>({
    provider: defaultAiConfig.provider,
    model: defaultAiConfig.model,
    apiKey: "",
  });
  const [weeklyEmailConfig, setWeeklyEmailConfig] = useState<WeeklyEmailConfig>(defaultWeeklyEmailConfig);
  const [weeklyEmailDraft, setWeeklyEmailDraft] = useState<WeeklyEmailConfigDraft>(defaultWeeklyEmailConfig);
  const [garminConfig, setGarminConfig] = useState<GarminConfig>(defaultGarminConfig);
  const [garminDraft, setGarminDraft] = useState<GarminConfigDraft>({
    username: "",
    authValue: "",
    autoSyncMinutes: defaultGarminConfig.autoSyncMinutes,
  });
  const [isConfigLoaded, setConfigLoaded] = useState(false);
  const [draft, setDraft] = useState<FoodDraft>(createEmptyDraft);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [results, setResults] = useState<FoodSearchResult[]>([]);
  const [searchState, setSearchState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [barcodeValue, setBarcodeValue] = useState("");
  const [manualBarcode, setManualBarcode] = useState("");
  const [barcodeState, setBarcodeState] = useState<"idle" | "scanning" | "loading" | "done" | "error" | "unsupported">("idle");
  const [barcodeError, setBarcodeError] = useState("");
  const [photoPreview, setPhotoPreview] = useState("");
  const [photoAnalysis, setPhotoAnalysis] = useState<FoodImageAnalysis | null>(null);
  const [photoState, setPhotoState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [photoError, setPhotoError] = useState("");
  const [pendingEntryImageDataUrl, setPendingEntryImageDataUrl] = useState("");
  const [aiFoodText, setAiFoodText] = useState("");
  const [textAnalysis, setTextAnalysis] = useState<FoodImageAnalysis | null>(null);
  const [textAnalysisState, setTextAnalysisState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [textAnalysisError, setTextAnalysisError] = useState("");
  const [entryError, setEntryError] = useState("");
  const [selectedEntryIds, setSelectedEntryIds] = useState<string[]>([]);
  const [mealGroupNameDraft, setMealGroupNameDraft] = useState("");
  const [mealGroupingState, setMealGroupingState] = useState<"idle" | "saving">("idle");
  const [mealFavorites, setMealFavorites] = useState<string[]>(() => loadMealFavorites());
  const [mealTemplateFavorites, setMealTemplateFavorites] = useState<string[]>(() => loadMealTemplateFavorites());
  const [activeMealId, setActiveMealId] = useState<string | null>(null);
  const [editingMealId, setEditingMealId] = useState<string | null>(null);
  const [mealEditNameDraft, setMealEditNameDraft] = useState("");
  const [savingMealId, setSavingMealId] = useState<string | null>(null);
  const [editingMealTemplateId, setEditingMealTemplateId] = useState<string | null>(null);
  const [mealTemplateEditNameDraft, setMealTemplateEditNameDraft] = useState("");
  const [savingMealTemplateId, setSavingMealTemplateId] = useState<string | null>(null);
  const [mealNameDraft, setMealNameDraft] = useState("");
  const [mealBuilderItems, setMealBuilderItems] = useState<MealTemplateItem[]>([]);
  const [mealState, setMealState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [mealError, setMealError] = useState("");
  const [mealTemplateError, setMealTemplateError] = useState("");
  const [aiConfigError, setAiConfigError] = useState("");
  const [aiConfigState, setAiConfigState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [aiModelsState, setAiModelsState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [analysisAiConfigError, setAnalysisAiConfigError] = useState("");
  const [analysisAiConfigState, setAnalysisAiConfigState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [analysisAiModelsState, setAnalysisAiModelsState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [weeklyEmailConfigState, setWeeklyEmailConfigState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [weeklyEmailConfigError, setWeeklyEmailConfigError] = useState("");
  const [weeklyAiAnalysis, setWeeklyAiAnalysis] = useState<WeeklyAiAnalysis | null>(null);
  const [weeklyAiState, setWeeklyAiState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [weeklyAiError, setWeeklyAiError] = useState("");
  const [importExportState, setImportExportState] = useState<"idle" | "working" | "done" | "error">("idle");
  const [importExportMessage, setImportExportMessage] = useState("");
  const [garminSummary, setGarminSummary] = useState<GarminDailySummary | null>(null);
  const [weekGarminSummaries, setWeekGarminSummaries] = useState<Record<string, GarminDailySummary>>({});
  const [garminState, setGarminState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [weekGarminState, setWeekGarminState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [garminConfigState, setGarminConfigState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [garminConfigError, setGarminConfigError] = useState("");
  const [reanalyzingEntryId, setReanalyzingEntryId] = useState<string | null>(null);
  const [isAutocompleteOpen, setAutocompleteOpen] = useState(false);
  const [activeResultIndex, setActiveResultIndex] = useState(0);
  const quantityInputRef = useRef<HTMLInputElement>(null);
  const entryFormRef = useRef<HTMLFormElement>(null);
  const barcodeVideoRef = useRef<HTMLVideoElement>(null);
  const barcodeScannerControlsRef = useRef<IScannerControls | null>(null);
  const barcodeScanActiveRef = useRef(false);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const mealRefs = useRef<Record<string, HTMLElement | null>>({});
  const selectedWeekStart = useMemo(() => getWeekStart(selectedDate), [selectedDate]);
  const weekDates = useMemo(() => buildWeekDates(selectedWeekStart), [selectedWeekStart]);

  const dayEntries = useMemo(
    () => entries.filter((entry) => entry.consumedAt.slice(0, 10) === selectedDate),
    [entries, selectedDate],
  );

  const sortedEntries = useMemo(
    () => [...dayEntries].sort((left, right) => right.consumedAt.localeCompare(left.consumedAt)),
    [dayEntries],
  );

  const groupedEntries = useMemo(() => buildEntryGroups(sortedEntries), [sortedEntries]);
  const mealGroups = useMemo(() => groupedEntries.filter((group): group is MealEntryGroup => group.kind === "meal"), [groupedEntries]);
  const selectedEntries = useMemo(
    () => sortedEntries.filter((entry) => selectedEntryIds.includes(entry.id)),
    [selectedEntryIds, sortedEntries],
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
  const hasGarminCredentials = Boolean(garminConfig.username && garminConfig.hasCredential);
  const calorieGoalDetails = buildCalorieGoalDetails(garminSummary, nutritionConfig);
  const effectiveCalorieGoal = calorieGoalDetails.effectiveGoal;
  const macroTargets = useMemo(
    () => calculateMacroTargets(effectiveCalorieGoal, selectedPreset),
    [effectiveCalorieGoal, selectedPreset],
  );
  const progress = Math.min(100, Math.round((totals.calories / effectiveCalorieGoal) * 100));
  const calorieTimingPoints = useMemo(
    () => buildCalorieTimingPoints(dayEntries, effectiveCalorieGoal, calorieTimingCheckpoints),
    [dayEntries, effectiveCalorieGoal],
  );
  const heroCalorieBudget = useMemo(
    () => buildCurrentCalorieTimingBudget(dayEntries, effectiveCalorieGoal, calorieTimingCheckpoints, selectedDate),
    [dayEntries, effectiveCalorieGoal, selectedDate],
  );
  const weekAnalysis = useMemo(
    () => buildWeekAnalysis(weekDates, entries, nutritionConfig, selectedPreset, hasGarminCredentials ? weekGarminSummaries : {}),
    [entries, hasGarminCredentials, nutritionConfig, selectedPreset, weekDates, weekGarminSummaries],
  );
  const weekSummary = useMemo(
    () =>
      weekAnalysis.reduce(
        (sum, day) => ({
          calories: sum.calories + day.totals.calories,
          calorieTarget: sum.calorieTarget + day.calorieTarget,
          protein: sum.protein + day.totals.protein,
          proteinTarget: sum.proteinTarget + day.macroTargets.protein.grams,
          carbs: sum.carbs + day.totals.carbs,
          carbsTarget: sum.carbsTarget + day.macroTargets.carbs.grams,
          fat: sum.fat + day.totals.fat,
          fatTarget: sum.fatTarget + day.macroTargets.fat.grams,
        }),
        { calories: 0, calorieTarget: 0, protein: 0, proteinTarget: 0, carbs: 0, carbsTarget: 0, fat: 0, fatTarget: 0 },
      ),
    [weekAnalysis],
  );
  const displayedWeeklyAiAnalysis = weeklyAiAnalysis?.weekStart === selectedWeekStart ? weeklyAiAnalysis : null;
  const availableMealTemplates = useMemo(
    () => [
      ...mealTemplates.map((meal): DisplayMealTemplate => ({ ...meal, source: "template" })),
      ...buildHistoricalMealTemplates(entries, mealTemplates),
    ],
    [entries, mealTemplates],
  );
  const displayedMealTemplates = useMemo(
    () => {
      const query = normalizeFoodKey(mealNameDraft);
      const templates = query
        ? availableMealTemplates.filter((meal) => mealTemplateMatchesSearch(meal, query))
        : availableMealTemplates;

      return [...templates].sort((left, right) => {
        const leftFavorite = mealTemplateFavorites.includes(left.id);
        const rightFavorite = mealTemplateFavorites.includes(right.id);
        if (leftFavorite !== rightFavorite) return leftFavorite ? -1 : 1;
        if (left.source !== right.source) return left.source === "template" ? -1 : 1;
        return left.name.localeCompare(right.name, "de");
      });
    },
    [availableMealTemplates, mealNameDraft, mealTemplateFavorites],
  );
  const supportsBarcodeScanner = Boolean(navigator.mediaDevices?.getUserMedia);

  useEffect(() => {
    let isMounted = true;

    async function loadBackendState() {
      try {
        const [entriesResponse, configResponse, aiConfigResponse, analysisAiConfigResponse, weeklyEmailConfigResponse, garminConfigResponse, mealsResponse] = await Promise.all([
          fetchEntries(),
          fetchNutritionConfig(),
          fetchAiConfig(),
          fetchAnalysisAiConfig(),
          fetchWeeklyEmailConfig(),
          fetchGarminConfig(),
          fetchMealTemplates(),
        ]);
        if (!isMounted) return;
        setEntries(entriesResponse);
        setMealTemplates(mealsResponse);
        setNutritionConfig(configResponse);
        setAiConfig(aiConfigResponse);
        setAnalysisAiConfig(analysisAiConfigResponse);
        setWeeklyEmailConfig(weeklyEmailConfigResponse);
        setGarminConfig(garminConfigResponse);
        setGarminDraft({ username: garminConfigResponse.username, authValue: "", autoSyncMinutes: garminConfigResponse.autoSyncMinutes });
        setAiDraft({
          provider: aiConfigResponse.provider,
          model: aiConfigResponse.model,
          apiKey: "",
        });
        setAnalysisAiDraft({
          provider: analysisAiConfigResponse.provider,
          model: analysisAiConfigResponse.model,
          apiKey: "",
        });
        setWeeklyEmailDraft({ targetEmail: weeklyEmailConfigResponse.targetEmail });
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

  useEffect(() => {
    saveMealFavorites(mealFavorites);
  }, [mealFavorites]);

  useEffect(() => {
    saveMealTemplateFavorites(mealTemplateFavorites);
  }, [mealTemplateFavorites]);

  const refreshGarminSummary = useCallback(async () => {
    if (!hasGarminCredentials) {
      setGarminSummary(null);
      setGarminState("idle");
      return;
    }

    setGarminState("loading");
    try {
      const summary = await fetchGarminDailySummary(selectedDate, true);
      setGarminSummary(summary);
      setGarminState(summary.error ? "error" : "done");
    } catch {
      setGarminSummary(null);
      setGarminState("error");
    }
  }, [hasGarminCredentials, selectedDate]);

  useEffect(() => {
    if (!isConfigLoaded) return;
    const timeoutId = window.setTimeout(() => {
      if (!hasGarminCredentials) {
        setGarminSummary(null);
        setGarminState("idle");
        return;
      }

      setGarminState("loading");
      void fetchGarminDailySummary(selectedDate)
        .then((summary) => {
          setGarminSummary(summary);
          setGarminState(summary.error ? "error" : "done");
        })
        .catch(() => {
          setGarminSummary(null);
          setGarminState("error");
        });
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [hasGarminCredentials, isConfigLoaded, selectedDate]);

  useEffect(() => {
    if (!isConfigLoaded || activeView !== "analysis") return;
    if (!hasGarminCredentials) return;

    let isMounted = true;
    const timeoutId = window.setTimeout(() => {
      setWeekGarminState("loading");
      void Promise.all(weekDates.map((date) => fetchGarminDailySummary(date).catch((error) => ({
        configured: true,
        date,
        source: "garmin-connect",
        error: error instanceof Error ? error.message : "Garmin konnte nicht abgefragt werden.",
      } satisfies GarminDailySummary))))
        .then((summaries) => {
          if (!isMounted) return;
          setWeekGarminSummaries((currentSummaries) => ({
            ...currentSummaries,
            ...Object.fromEntries(summaries.map((summary) => [summary.date, summary])),
          }));
          setWeekGarminState(summaries.some((summary) => summary.error) ? "error" : "done");
        })
        .catch(() => {
          if (isMounted) setWeekGarminState("error");
        });
    }, 0);

    return () => {
      isMounted = false;
      window.clearTimeout(timeoutId);
    };
  }, [activeView, hasGarminCredentials, isConfigLoaded, weekDates]);

  const refreshWeekGarminSummaries = useCallback(async () => {
    if (!hasGarminCredentials) return;
    setWeekGarminState("loading");
    try {
      const summaries = await Promise.all(weekDates.map((date) => fetchGarminDailySummary(date, true).catch((error) => ({
        configured: true,
        date,
        source: "garmin-connect",
        error: error instanceof Error ? error.message : "Garmin konnte nicht abgefragt werden.",
      } satisfies GarminDailySummary))));
      setWeekGarminSummaries((currentSummaries) => ({
        ...currentSummaries,
        ...Object.fromEntries(summaries.map((summary) => [summary.date, summary])),
      }));
      setWeekGarminState(summaries.some((summary) => summary.error) ? "error" : "done");
    } catch {
      setWeekGarminState("error");
    }
  }, [hasGarminCredentials, weekDates]);

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

  useEffect(() => () => stopBarcodeScanner(), []);

  function stopBarcodeScanner() {
    barcodeScanActiveRef.current = false;
    barcodeScannerControlsRef.current?.stop();
    barcodeScannerControlsRef.current = null;
    if (barcodeVideoRef.current) barcodeVideoRef.current.srcObject = null;
  }

  async function startBarcodeScanner() {
    if (!supportsBarcodeScanner) {
      setBarcodeState("unsupported");
      setBarcodeError("Scanner wird von diesem Browser nicht unterstützt. Barcode bitte manuell eingeben.");
      return;
    }

    stopBarcodeScanner();
    setBarcodeError("");
    setBarcodeState("scanning");
    setBarcodeValue("");

    try {
      const video = barcodeVideoRef.current;
      if (!video) throw new Error("Scanner-Video ist nicht bereit.");

      barcodeScanActiveRef.current = true;
      const reader = new BrowserMultiFormatReader();
      reader.possibleFormats = [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E];
      let resolved = false;

      barcodeScannerControlsRef.current = await reader.decodeFromConstraints(
        { video: { facingMode: { ideal: "environment" } }, audio: false },
        video,
        (result, _error, controls) => {
          if (resolved || !barcodeScanActiveRef.current) return;
          const code = normalizeBarcodeInput(result?.getText() ?? "");
          if (!code) return;

          resolved = true;
          controls.stop();
          barcodeScannerControlsRef.current = null;
          barcodeScanActiveRef.current = false;
          const frameDataUrl = captureVideoFrame(video);
          if (frameDataUrl) setPendingEntryImageDataUrl(frameDataUrl);
          void lookupBarcode(code, frameDataUrl);
        },
      );
    } catch (error) {
      stopBarcodeScanner();
      setBarcodeState("error");
      setBarcodeError(error instanceof Error ? error.message : "Kamera konnte nicht gestartet werden.");
    }
  }

  async function lookupBarcode(rawBarcode: string, imageDataUrl = "") {
    const code = normalizeBarcodeInput(rawBarcode);
    if (!code) {
      setBarcodeState("error");
      setBarcodeError("Bitte 8 bis 14 Ziffern eingeben.");
      return;
    }

    setBarcodeValue(code);
    setBarcodeError("");
    setBarcodeState("loading");

    try {
      const food = await fetchFoodByBarcode(code);
      if (!food) {
        setBarcodeState("error");
        setBarcodeError("Kein Lebensmittel zu diesem Barcode gefunden.");
        return;
      }

      selectFood(food);
      setPendingEntryImageDataUrl(imageDataUrl);
      setBarcodeState("done");
    } catch (error) {
      setBarcodeState("error");
      setBarcodeError(error instanceof Error ? error.message : "Barcode konnte nicht gesucht werden.");
    }
  }

  async function saveEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const foodName = draft.foodName.trim();
    if (!foodName || draft.quantityValue <= 0 || draft.caloriesPer100g < 0 || !draft.consumedAt) return;

    setEntryError("");
    try {
      const payload = {
        ...draft,
        foodName,
        imageDataUrl: draft.imageDataUrl || (!editingEntryId ? pendingEntryImageDataUrl : ""),
      };
      const entry = editingEntryId
        ? await updateBackendEntry(editingEntryId, payload)
        : await createEntry(payload);
      setEntries((currentEntries) =>
        editingEntryId
          ? currentEntries.map((currentEntry) => (currentEntry.id === entry.id ? entry : currentEntry))
          : [entry, ...currentEntries],
      );
      setSelectedDate(entry.consumedAt.slice(0, 10));
      setDraft(createEmptyDraft());
      setPendingEntryImageDataUrl("");
      setEditingEntryId(null);
    } catch (error) {
      setEntryError(error instanceof Error ? error.message : "Eintrag konnte nicht gespeichert werden.");
    }
  }

  async function saveAiSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAiConfigError("");
    setAnalysisAiConfigError("");
    setAiConfigState("saving");
    setAnalysisAiConfigState("saving");
    try {
      const savedConfig = await saveAiConfig(aiDraft);
      const savedAnalysisConfig = await saveAnalysisAiConfig({
        provider: savedConfig.provider,
        model: analysisAiDraft.model,
        apiKey: "",
      });
      setAiConfig(savedConfig);
      setAnalysisAiConfig(savedAnalysisConfig);
      setAiDraft({ provider: savedConfig.provider, model: savedConfig.model, apiKey: "" });
      setAnalysisAiDraft({ provider: savedConfig.provider, model: savedAnalysisConfig.model, apiKey: "" });
      setAiConfigState("saved");
      setAnalysisAiConfigState("saved");
    } catch {
      setAiConfigError("Konfiguration konnte nicht gespeichert werden.");
      setAnalysisAiConfigError("Analyse-Konfiguration konnte nicht gespeichert werden.");
      setAiConfigState("error");
      setAnalysisAiConfigState("error");
    }
  }

  async function saveWeeklyEmailSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWeeklyEmailConfigError("");
    setWeeklyEmailConfigState("saving");
    try {
      const savedConfig = await saveWeeklyEmailConfig(weeklyEmailDraft);
      setWeeklyEmailConfig(savedConfig);
      setWeeklyEmailDraft({ targetEmail: savedConfig.targetEmail });
      setWeeklyEmailConfigState("saved");
    } catch (error) {
      setWeeklyEmailConfigError(error instanceof Error ? error.message : "Wochenmail konnte nicht gespeichert werden.");
      setWeeklyEmailConfigState("error");
    }
  }

  async function saveGarminSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setGarminConfigError("");
    setGarminConfigState("saving");
    try {
      const savedConfig = await saveGarminConfig(garminDraft);
      setGarminConfig(savedConfig);
      setGarminDraft({ username: savedConfig.username, authValue: "", autoSyncMinutes: savedConfig.autoSyncMinutes });
      setGarminConfigState("saved");
      if (savedConfig.username && savedConfig.hasCredential) {
        void fetchGarminDailySummary(selectedDate, true)
          .then((summary) => {
            setGarminSummary(summary);
            setGarminState(summary.error ? "error" : "done");
          })
          .catch(() => {
            setGarminSummary(null);
            setGarminState("error");
          });
      }
    } catch (error) {
      setGarminConfigError(error instanceof Error ? error.message : "Garmin-Konfiguration konnte nicht gespeichert werden.");
      setGarminConfigState("error");
    }
  }

  function updateAiProvider(provider: string) {
    const providerOption = aiConfig.providers.find((option) => option.id === provider);
    const analysisProviderOption = analysisAiConfig.providers.find((option) => option.id === provider);
    setAiDraft({
      ...aiDraft,
      provider,
      model: providerOption?.models[0] ?? aiDraft.model,
    });
    setAnalysisAiDraft({
      ...analysisAiDraft,
      provider,
      model: analysisProviderOption?.models[0] ?? analysisAiDraft.model,
    });
    setAiConfigState("idle");
    setAiConfigError("");
    setAiModelsState("idle");
    setAnalysisAiConfigState("idle");
    setAnalysisAiConfigError("");
    setAnalysisAiModelsState("idle");
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

      const models = mergeModelsWithCurrent(await fetchAiModels(aiDraft.provider, "photo"), aiDraft.model);
      const providers = nextConfig.providers.map((provider) =>
        provider.id === aiDraft.provider ? { ...provider, models } : provider,
      );
      const model = aiDraft.model || models[0];
      setAiConfig({ ...nextConfig, providers });
      setAiDraft((currentDraft) => ({ ...currentDraft, model }));
      setAiModelsState("done");
    } catch {
      setAiConfigError("Modellliste konnte nicht geladen werden.");
      setAiModelsState("error");
    }
  }

  async function refreshAnalysisAiModels() {
    setAnalysisAiModelsState("loading");
    try {
      const nextConfig = analysisAiConfig;
      let nextPhotoConfig = aiConfig;
      if (aiDraft.apiKey.trim()) {
        nextPhotoConfig = await saveAiConfig(aiDraft);
        setAiConfig(nextPhotoConfig);
        setAiDraft({ provider: nextPhotoConfig.provider, model: nextPhotoConfig.model, apiKey: "" });
      }

      const provider = nextPhotoConfig.provider;
      const models = mergeModelsWithCurrent(await fetchAiModels(provider, "analysis"), analysisAiDraft.model);
      const providers = nextConfig.providers.map((provider) =>
        provider.id === nextPhotoConfig.provider ? { ...provider, models } : provider,
      );
      const model = analysisAiDraft.model || models[0];
      setAnalysisAiConfig({ ...nextConfig, provider, providers });
      setAnalysisAiDraft((currentDraft) => ({ ...currentDraft, provider, model }));
      setAnalysisAiModelsState("done");
    } catch {
      setAnalysisAiConfigError("Analyse-Modellliste konnte nicht geladen werden.");
      setAnalysisAiModelsState("error");
    }
  }

  async function requestWeeklyAiAnalysis() {
    setWeeklyAiState("loading");
    setWeeklyAiError("");
    setWeeklyAiAnalysis(null);
    try {
      const analysis = await fetchWeeklyAiAnalysis(selectedWeekStart);
      setWeeklyAiAnalysis(analysis);
      setWeeklyAiState("done");
    } catch (error) {
      setWeeklyAiError(error instanceof Error ? error.message : "Wochenanalyse fehlgeschlagen.");
      setWeeklyAiState("error");
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

    setPhotoPreview(await readImageAsCompressedDataUrl(file));
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
    setDraft({ ...draft, ...draftFromAnalysis(analysis), consumedAt: draft.consumedAt });
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
      const entriesToSave = draftsFromAnalysis(textAnalysis, draft.consumedAt);
      const savedEntries = entriesToSave.length > 1
        ? await createEntryGroup(textAnalysis.description, entriesToSave)
        : [await createEntry(entriesToSave[0])];
      if (entriesToSave.length > 1) await saveAnalysisTemplate(textAnalysis, entriesToSave);
      setEntries((currentEntries) => [...savedEntries, ...currentEntries]);
      setSelectedDate(savedEntries[0].consumedAt.slice(0, 10));
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
      const entriesToSave = draftsFromAnalysis(photoAnalysis, draft.consumedAt);
      const savedEntries = entriesToSave.length > 1
        ? await createEntryGroup(photoAnalysis.description, entriesToSave, photoPreview)
        : [await createEntry({ ...entriesToSave[0], imageDataUrl: photoPreview })];
      if (entriesToSave.length > 1) await saveAnalysisTemplate(photoAnalysis, entriesToSave);
      setEntries((currentEntries) => [...savedEntries, ...currentEntries]);
      setSelectedDate(savedEntries[0].consumedAt.slice(0, 10));
      setPhotoPreview("");
      setPendingEntryImageDataUrl("");
      setPhotoAnalysis(null);
      setPhotoState("idle");
      if (photoInputRef.current) photoInputRef.current.value = "";
    } catch (error) {
      setEntryError(error instanceof Error ? error.message : "Foto-Eintrag konnte nicht gespeichert werden.");
    }
  }

  async function saveAnalysisTemplate(analysis: FoodImageAnalysis, entriesToSave: FoodDraft[]) {
    const meal = await createMealTemplate({
      name: analysis.description,
      items: entriesToSave.map(templateItemFromDraft),
    });
    setMealTemplates((currentTemplates) => upsertMealTemplate(currentTemplates, meal));
  }

  function addDraftToMeal() {
    const foodName = draft.foodName.trim();
    if (!foodName || draft.quantityValue <= 0 || draft.caloriesPer100g < 0) return;
    setMealBuilderItems((items) => [...items, templateItemFromDraft({ ...draft, foodName })]);
    setMealNameDraft((name) => name || foodName);
    setMealState("idle");
    setMealError("");
  }

  function removeMealBuilderItem(indexToRemove: number) {
    setMealBuilderItems((items) => items.filter((_, index) => index !== indexToRemove));
  }

  async function saveMealBuilder(addToDay: boolean) {
    const name = mealNameDraft.trim();
    if (!name || mealBuilderItems.length === 0) return;
    setMealState("saving");
    setMealError("");
    try {
      const meal = await createMealTemplate({ name, items: mealBuilderItems });
      setMealTemplates((currentTemplates) => upsertMealTemplate(currentTemplates, meal));
      if (addToDay) {
        const savedEntries = await addMealTemplateToDay(meal);
        setEntries((currentEntries) => [...savedEntries, ...currentEntries]);
        setSelectedDate(savedEntries[0].consumedAt.slice(0, 10));
      }
      setMealNameDraft("");
      setMealBuilderItems([]);
      setMealState("saved");
    } catch (error) {
      setMealError(error instanceof Error ? error.message : "Mahlzeit konnte nicht gespeichert werden.");
      setMealState("error");
    }
  }

  async function addMealTemplateToDay(meal: MealTemplate) {
    const consumedAt = draft.consumedAt || nowLocal();
    const entriesToSave = meal.items.map((item) => ({ ...item, consumedAt }));
    return createEntryGroup(meal.name, entriesToSave);
  }

  async function applyMealTemplate(meal: MealTemplate) {
    setEntryError("");
    try {
      const savedEntries = await addMealTemplateToDay(meal);
      setEntries((currentEntries) => [...savedEntries, ...currentEntries]);
      setSelectedDate(savedEntries[0].consumedAt.slice(0, 10));
    } catch (error) {
      setEntryError(error instanceof Error ? error.message : "Mahlzeit konnte nicht gespeichert werden.");
    }
  }

  function toggleEntrySelection(entryId: string) {
    setSelectedEntryIds((currentIds) => (
      currentIds.includes(entryId)
        ? currentIds.filter((id) => id !== entryId)
        : [...currentIds, entryId]
    ));
    setEntryError("");
  }

  async function groupSelectedEntries() {
    const mealName = mealGroupNameDraft.trim();
    if (selectedEntries.length < 2 || !mealName || mealGroupingState === "saving") return;

    const mealId = createClientId();
    setEntryError("");
    setMealGroupingState("saving");
    try {
      const updatedEntries = await Promise.all(selectedEntries.map((entry) => updateBackendEntry(entry.id, {
        ...draftFromEntry(entry),
        mealId,
        mealName,
      })));
      const updatedEntriesById = new Map(updatedEntries.map((entry) => [entry.id, entry]));
      setEntries((currentEntries) => currentEntries.map((entry) => updatedEntriesById.get(entry.id) ?? entry));
      setSelectedEntryIds([]);
      setMealGroupNameDraft("");
    } catch (error) {
      setEntryError(error instanceof Error ? error.message : "Eintraege konnten nicht gruppiert werden.");
    } finally {
      setMealGroupingState("idle");
    }
  }

  function scrollToMeal(mealId: string) {
    setActiveMealId(mealId);
    const mealElement = mealRefs.current[mealId];
    if (!mealElement) return;
    mealElement.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => mealElement.focus({ preventScroll: true }), 220);
  }

  function scrollMealByStep(step: number) {
    if (mealGroups.length === 0) return;
    const currentIndex = activeMealId ? mealGroups.findIndex((group) => group.id === activeMealId) : -1;
    const fallbackIndex = step > 0 ? -1 : 0;
    const nextIndex = (currentIndex >= 0 ? currentIndex : fallbackIndex) + step;
    const boundedIndex = Math.min(Math.max(nextIndex, 0), mealGroups.length - 1);
    scrollToMeal(mealGroups[boundedIndex].id);
  }

  function toggleMealFavorite(group: MealEntryGroup) {
    const favoriteKey = mealFavoriteKey(group);
    setMealFavorites((currentFavorites) => (
      currentFavorites.includes(favoriteKey)
        ? currentFavorites.filter((key) => key !== favoriteKey)
        : [...currentFavorites, favoriteKey]
    ));
  }

  function toggleMealTemplateFavorite(meal: MealTemplate) {
    setMealTemplateFavorites((currentFavorites) => (
      currentFavorites.includes(meal.id)
        ? currentFavorites.filter((id) => id !== meal.id)
        : [...currentFavorites, meal.id]
    ));
  }

  function startMealTemplateEdit(meal: MealTemplate) {
    setEditingMealTemplateId(meal.id);
    setMealTemplateEditNameDraft(meal.name);
    setMealTemplateError("");
  }

  function cancelMealTemplateEdit() {
    setEditingMealTemplateId(null);
    setMealTemplateEditNameDraft("");
  }

  async function saveMealTemplateName(meal: MealTemplate) {
    if (savingMealTemplateId === meal.id) return;
    const mealName = mealTemplateEditNameDraft.trim();
    if (!mealName) {
      cancelMealTemplateEdit();
      return;
    }
    if (mealName === meal.name) {
      cancelMealTemplateEdit();
      return;
    }

    setSavingMealTemplateId(meal.id);
    setMealTemplateError("");
    try {
      const updatedMeal = await updateMealTemplateName(meal.id, mealName);
      setMealTemplates((currentTemplates) => upsertMealTemplate(currentTemplates, updatedMeal));
      cancelMealTemplateEdit();
    } catch (error) {
      setMealTemplateError(error instanceof Error ? error.message : "Mahlzeit konnte nicht gespeichert werden.");
    } finally {
      setSavingMealTemplateId(null);
    }
  }

  function startMealEdit(group: MealEntryGroup) {
    setEditingMealId(group.id);
    setMealEditNameDraft(group.name);
    setEntryError("");
  }

  async function saveMealName(group: MealEntryGroup) {
    const mealName = mealEditNameDraft.trim();
    if (!mealName || savingMealId) return;
    setSavingMealId(group.id);
    setEntryError("");
    try {
      const updatedEntries = await Promise.all(group.entries.map((entry) => updateBackendEntry(entry.id, {
        ...draftFromEntry(entry),
        mealId: group.id,
        mealName,
      })));
      const updatedEntriesById = new Map(updatedEntries.map((entry) => [entry.id, entry]));
      setEntries((currentEntries) => currentEntries.map((entry) => updatedEntriesById.get(entry.id) ?? entry));
      setEditingMealId(null);
      setMealEditNameDraft("");
    } catch (error) {
      setEntryError(error instanceof Error ? error.message : "Mahlzeit konnte nicht gespeichert werden.");
    } finally {
      setSavingMealId(null);
    }
  }

  async function removeMealTemplate(id: string) {
    try {
      await deleteMealTemplate(id);
      setMealTemplates((templates) => templates.filter((template) => template.id !== id));
      setMealTemplateFavorites((favorites) => favorites.filter((favoriteId) => favoriteId !== id));
      if (editingMealTemplateId === id) cancelMealTemplateEdit();
    } catch (error) {
      setMealTemplateError(error instanceof Error ? error.message : "Mahlzeit konnte nicht geloescht werden.");
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
    if (editingEntryId === id) cancelEdit();
  }

  async function duplicateEntry(entry: FoodEntry) {
    setEntryError("");
    try {
      const duplicatedEntry = await createEntry({
        foodKey: entry.foodKey,
        foodName: entry.foodName,
        quantityValue: entry.quantityValue,
        quantityUnit: entry.quantityUnit,
        caloriesPer100g: entry.caloriesPer100g,
        proteinPer100g: entry.proteinPer100g,
        carbsPer100g: entry.carbsPer100g,
        fatPer100g: entry.fatPer100g,
        consumedAt: nowLocal(),
        source: entry.source ?? "manual",
        aiUsage: entry.aiUsage,
        imageDataUrl: entry.imageDataUrl,
      });
      setEntries((currentEntries) => [duplicatedEntry, ...currentEntries]);
      setSelectedDate(duplicatedEntry.consumedAt.slice(0, 10));
    } catch (error) {
      setEntryError(error instanceof Error ? error.message : "Eintrag konnte nicht dupliziert werden.");
    }
  }

  function editEntry(entry: FoodEntry) {
    setDraft({
      foodKey: entry.foodKey,
      mealId: entry.mealId,
      mealName: entry.mealName,
      foodName: entry.foodName,
      quantityValue: entry.quantityValue,
      quantityUnit: entry.quantityUnit,
      caloriesPer100g: entry.caloriesPer100g,
      proteinPer100g: entry.proteinPer100g,
      carbsPer100g: entry.carbsPer100g,
      fatPer100g: entry.fatPer100g,
      consumedAt: entry.consumedAt,
      source: entry.source ?? "manual",
      aiUsage: entry.aiUsage,
      imageDataUrl: entry.imageDataUrl,
    });
    setPendingEntryImageDataUrl("");
    setEditingEntryId(entry.id);
    setEntryError("");
    setAutocompleteOpen(false);
    entryFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => quantityInputRef.current?.select(), 220);
  }

  function cancelEdit() {
    setEditingEntryId(null);
    setDraft(createEmptyDraft());
    setPendingEntryImageDataUrl("");
    setEntryError("");
  }

  async function reanalyzeEntryImage(entry: FoodEntry) {
    if (!entry.imageDataUrl || reanalyzingEntryId) return;
    setEntryError("");
    setReanalyzingEntryId(entry.id);
    try {
      const analysis = await analyzeFoodPhoto(entry.imageDataUrl);
      const updatedEntry = await updateBackendEntry(entry.id, {
        ...draftFromAnalysis(analysis),
        consumedAt: entry.consumedAt,
        imageDataUrl: entry.imageDataUrl,
      });
      setEntries((currentEntries) => currentEntries.map((currentEntry) => (
        currentEntry.id === updatedEntry.id ? updatedEntry : currentEntry
      )));
    } catch (error) {
      setEntryError(error instanceof Error ? error.message : "Neu-Erkennung fehlgeschlagen.");
    } finally {
      setReanalyzingEntryId(null);
    }
  }

  async function reanalyzeMealImage(group: MealEntryGroup) {
    if (!group.imageDataUrl || reanalyzingEntryId) return;
    setEntryError("");
    setReanalyzingEntryId(group.id);
    try {
      const analysis = await analyzeFoodPhoto(group.imageDataUrl);
      const mealName = analysis.description || group.name;
      const nextDrafts = draftsFromAnalysis(analysis, group.consumedAt).map((nextDraft) => ({
        ...nextDraft,
        mealId: group.id,
        mealName,
        imageDataUrl: group.imageDataUrl,
      }));
      const savedEntries: FoodEntry[] = [];

      for (let index = 0; index < nextDrafts.length; index += 1) {
        const existingEntry = group.entries[index];
        const savedEntry = existingEntry
          ? await updateBackendEntry(existingEntry.id, nextDrafts[index])
          : await createEntry(nextDrafts[index]);
        savedEntries.push(savedEntry);
      }

      for (const staleEntry of group.entries.slice(nextDrafts.length)) {
        await deleteBackendEntry(staleEntry.id);
      }

      setEntries((currentEntries) => [
        ...savedEntries,
        ...currentEntries.filter((currentEntry) => currentEntry.mealId !== group.id),
      ]);
      if (savedEntries[0]) setSelectedDate(savedEntries[0].consumedAt.slice(0, 10));
    } catch (error) {
      setEntryError(error instanceof Error ? error.message : "Neu-Erkennung fehlgeschlagen.");
    } finally {
      setReanalyzingEntryId(null);
    }
  }

  async function exportData() {
    setImportExportState("working");
    setImportExportMessage("");
    try {
      const payload = await fetchExportData();
      const date = new Date().toISOString().slice(0, 10);
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `food-tracker-export-${date}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      setImportExportState("done");
      setImportExportMessage("Export erstellt. API-Key ist nicht enthalten.");
    } catch (error) {
      setImportExportState("error");
      setImportExportMessage(error instanceof Error ? error.message : "Export fehlgeschlagen.");
    }
  }

  async function importData(file: File | null) {
    if (!file) return;
    if (!window.confirm("Import ersetzt alle aktuellen Eintraege. Fortfahren?")) {
      if (importInputRef.current) importInputRef.current.value = "";
      return;
    }

    setImportExportState("working");
    setImportExportMessage("");
    try {
      const result = await importBackupFile(file);
      const [entriesResponse, configResponse, aiConfigResponse] = await Promise.all([
        fetchEntries(),
        fetchNutritionConfig(),
        fetchAiConfig(),
      ]);
      setEntries(entriesResponse);
      setNutritionConfig(configResponse);
      setAiConfig(aiConfigResponse);
      setAiDraft({ provider: aiConfigResponse.provider, model: aiConfigResponse.model, apiKey: "" });
      setSelectedDate(todayLocal());
      setImportExportState("done");
      setImportExportMessage([
        `${result.entriesImported.toLocaleString("de-DE")} Eintraege importiert.`,
        result.nutritionConfigImported ? "Ziele uebernommen." : "",
        result.aiConfigImported ? "AI-Modell uebernommen." : "",
        ...(result.warnings ?? []),
      ].filter(Boolean).join(" "));
    } catch (error) {
      setImportExportState("error");
      setImportExportMessage(error instanceof Error ? error.message : "Import fehlgeschlagen.");
    } finally {
      if (importInputRef.current) importInputRef.current.value = "";
    }
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
        <div className="goal-card" aria-label="Tagesfortschritt Kalorien">
          <div className="goal-card__top">
            <Target size={22} aria-hidden="true" />
            <span>{calorieGoalDetails.usesGarminActiveCalories ? "Ziel + Garmin aktiv" : "Tagesziel"}</span>
          </div>
          <strong>{totals.calories.toLocaleString()} kcal</strong>
          <div className="progress-track">
            <span style={{ width: `${progress}%` }} />
          </div>
          <small>{progress}% von {effectiveCalorieGoal.toLocaleString()} kcal</small>
          <small className={heroCalorieBudget.remainingCalories < 0 ? "goal-card__timing delta--over" : "goal-card__timing delta--under"}>
            Bis {heroCalorieBudget.time}: {heroCalorieBudget.remainingCalories >= 0
              ? `${heroCalorieBudget.remainingCalories.toLocaleString("de-DE")} kcal frei`
              : `${Math.abs(heroCalorieBudget.remainingCalories).toLocaleString("de-DE")} kcal drueber`}
          </small>
          <small className="goal-card__note">
            Basis {calorieGoalDetails.baseGoal.toLocaleString("de-DE")} kcal
            {calorieGoalDetails.usesGarminActiveCalories ? ` · Aktiv +${calorieGoalDetails.activeCalories.toLocaleString("de-DE")} kcal` : ""}
            {nutritionConfig.calorieGoalOffset !== 0 ? ` · ${formatCalorieGoalOffset(nutritionConfig.calorieGoalOffset)}` : " · kein Offset"}
          </small>
          {garminSummary?.configured && (
            <small className={garminSummary.error ? "goal-card__note goal-card__note--error" : "goal-card__note"}>
              {garminSummary.error
                ? "Garmin Sync fehlgeschlagen"
                : `Aktiv ${formatOptionalCalories(garminSummary.activeKilocalories)}`}
            </small>
          )}
        </div>
      </section>

      <nav className="view-tabs" aria-label="App-Ansichten">
        <button className={activeView === "tracker" ? "view-tab view-tab--active" : "view-tab"} type="button" onClick={() => setActiveView("tracker")}>
          <Utensils size={17} aria-hidden="true" />
          Protokoll
        </button>
        <button className={activeView === "analysis" ? "view-tab view-tab--active" : "view-tab"} type="button" onClick={() => setActiveView("analysis")}>
          <BarChart3 size={17} aria-hidden="true" />
          Analyse
        </button>
        <button className={activeView === "settings" ? "view-tab view-tab--active" : "view-tab"} type="button" onClick={() => setActiveView("settings")}>
          <Settings size={17} aria-hidden="true" />
          Konfiguration
        </button>
      </nav>

      {activeView === "analysis" && (
        <section className="analysis-page" aria-label="Wochenanalyse">
          <section className="analysis-toolbar">
            <div>
              <p className="eyebrow eyebrow--dark">
                <CalendarDays size={16} aria-hidden="true" />
                Wochenansicht
              </p>
              <h2>{formatWeekRange(weekDates)}</h2>
              <span>{weekAnalysis.reduce((sum, day) => sum + day.entryCount, 0)} Einträge · {formatSignedNumber(weekSummary.calories - weekSummary.calorieTarget)} kcal Woche</span>
            </div>
            <div className="week-actions">
              <button className="secondary-button" type="button" aria-label="Vorherige Woche" onClick={() => setSelectedDate(addDays(selectedWeekStart, -7))}>
                <ChevronLeft size={18} aria-hidden="true" />
              </button>
              <button className="secondary-button" type="button" onClick={() => setSelectedDate(todayLocal())}>
                Heute
              </button>
              <button className="secondary-button" type="button" aria-label="Nächste Woche" onClick={() => setSelectedDate(addDays(selectedWeekStart, 7))}>
                <ChevronRight size={18} aria-hidden="true" />
              </button>
              {hasGarminCredentials && (
                <button className="secondary-button" type="button" disabled={weekGarminState === "loading"} onClick={() => void refreshWeekGarminSummaries()}>
                  {weekGarminState === "loading" ? <Loader2 className="spin" size={18} aria-hidden="true" /> : <RefreshCw size={18} aria-hidden="true" />}
                  Garmin
                </button>
              )}
              <button className="secondary-button secondary-button--dark" type="button" disabled={weeklyAiState === "loading" || !analysisAiConfig.hasApiKey} onClick={() => void requestWeeklyAiAnalysis()}>
                {weeklyAiState === "loading" ? <Loader2 className="spin" size={18} aria-hidden="true" /> : <Sparkles size={18} aria-hidden="true" />}
                KI
              </button>
            </div>
          </section>

          <section className="analysis-summary-grid" aria-label="Wochensummen">
            <AnalysisSummaryMetric label="Kalorien" actual={weekSummary.calories} target={weekSummary.calorieTarget} suffix="kcal" />
            <AnalysisSummaryMetric label="Protein" actual={weekSummary.protein} target={weekSummary.proteinTarget} suffix="g" />
            <AnalysisSummaryMetric label="Kohlenhydrate" actual={weekSummary.carbs} target={weekSummary.carbsTarget} suffix="g" />
            <AnalysisSummaryMetric label="Fett" actual={weekSummary.fat} target={weekSummary.fatTarget} suffix="g" />
          </section>

          <CalorieTimingPlan
            date={selectedDate}
            calorieGoal={effectiveCalorieGoal}
            points={calorieTimingPoints}
            totalCalories={totals.calories}
            usesGarminActiveCalories={calorieGoalDetails.usesGarminActiveCalories}
            calorieGoalOffset={nutritionConfig.calorieGoalOffset}
          />

          <section className={displayedWeeklyAiAnalysis ? `weekly-ai-card weekly-ai-card--${displayedWeeklyAiAnalysis.signal.label}` : "weekly-ai-card"} aria-live="polite">
            <div className="weekly-ai-card__head">
              <div>
                <span>KI-Wochenanalyse</span>
                <strong>
                  {displayedWeeklyAiAnalysis
                    ? `${trafficLightLabel(displayedWeeklyAiAnalysis.signal.label)} · ${displayedWeeklyAiAnalysis.signal.score}/100`
                    : analysisAiConfig.hasApiKey ? "Bereit" : "Analyse-Key fehlt"}
                </strong>
              </div>
              <small>{displayedWeeklyAiAnalysis ? `${displayedWeeklyAiAnalysis.provider}/${displayedWeeklyAiAnalysis.model}` : analysisAiConfig.model}</small>
            </div>
            {displayedWeeklyAiAnalysis ? (
              <>
                <p>{displayedWeeklyAiAnalysis.signal.message}</p>
                <p>{displayedWeeklyAiAnalysis.aiText}</p>
              </>
            ) : (
              <p>{weeklyAiState === "error" ? weeklyAiError : "Die Einschaetzung nutzt die Wochensummen, Tagesausreisser und Makroziele."}</p>
            )}
            {weeklyAiState === "error" && <small className="config-status config-status--error">{weeklyAiError}</small>}
          </section>

          <section className="weekly-chart-grid" aria-label="Wochendiagramme">
            <WeeklyBarChart
              title="Kalorien"
              suffix="kcal"
              points={weekAnalysis.map((day) => ({
                date: day.date,
                actual: day.totals.calories,
                target: day.calorieTarget,
                entryCount: day.entryCount,
                hasError: Boolean(day.garminError),
              }))}
            />
            <WeeklyBarChart
              title="Protein"
              suffix="g"
              points={weekAnalysis.map((day) => ({
                date: day.date,
                actual: day.totals.protein,
                target: day.macroTargets.protein.grams,
                entryCount: day.entryCount,
              }))}
            />
            <WeeklyBarChart
              title="Kohlenhydrate"
              suffix="g"
              points={weekAnalysis.map((day) => ({
                date: day.date,
                actual: day.totals.carbs,
                target: day.macroTargets.carbs.grams,
                entryCount: day.entryCount,
              }))}
            />
            <WeeklyBarChart
              title="Fett"
              suffix="g"
              points={weekAnalysis.map((day) => ({
                date: day.date,
                actual: day.totals.fat,
                target: day.macroTargets.fat.grams,
                entryCount: day.entryCount,
              }))}
            />
          </section>

        </section>
      )}

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
                min={minimumCalorieGoal}
                step={50}
                value={nutritionConfig.calorieGoal}
                onChange={(calorieGoal) => setNutritionConfig({ ...nutritionConfig, calorieGoal })}
              />
              <NumberInput
                label="Defizit/Überschuss"
                min={-5000}
                step={50}
                value={nutritionConfig.calorieGoalOffset}
                onChange={(calorieGoalOffset) => setNutritionConfig({ ...nutritionConfig, calorieGoalOffset })}
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
              <p className="config-status config-status--wide">
                Tagesziel: {effectiveCalorieGoal.toLocaleString("de-DE")} kcal aus Basisziel
                {calorieGoalDetails.usesGarminActiveCalories ? ` + ${calorieGoalDetails.activeCalories.toLocaleString("de-DE")} kcal Garmin aktiv` : ""}
                {nutritionConfig.calorieGoalOffset !== 0 ? ` mit ${formatCalorieGoalOffset(nutritionConfig.calorieGoalOffset)}` : " ohne Offset"}.
              </p>
            </div>
            <div className="macro-target-grid" aria-label="Calculated macro targets">
              <MacroTarget label="Kohlenhydrate" grams={macroTargets.carbs.grams} calories={macroTargets.carbs.calories} percent={selectedPreset.carbs} />
              <MacroTarget label="Protein" grams={macroTargets.protein.grams} calories={macroTargets.protein.calories} percent={selectedPreset.protein} />
              <MacroTarget label="Fett" grams={macroTargets.fat.grams} calories={macroTargets.fat.calories} percent={selectedPreset.fat} />
            </div>
          </section>
          <form className="config-panel config-panel--page garmin-panel" aria-label="Garmin Connect configuration" onSubmit={saveGarminSettings}>
            <div className="config-copy">
              <p className="eyebrow eyebrow--dark">
                <Activity size={16} aria-hidden="true" />
                Garmin
              </p>
              <h2>Tagesverbrauch</h2>
              <p>Speichert den Garmin-Login verschluesselt und nutzt den echten Tagesverbrauch als Kalorienziel.</p>
            </div>
            <div className="config-controls">
              <label>
                Garmin Benutzer
                <input
                  type="email"
                  value={garminDraft.username}
                  onChange={(event) => {
                    setGarminDraft({ ...garminDraft, username: event.target.value });
                    setGarminConfigState("idle");
                  }}
                  placeholder="you@example.com"
                  autoComplete="username"
                />
              </label>
              <label>
                Garmin Passwort
                <input
                  type="password"
                  value={garminDraft.authValue}
                  onChange={(event) => {
                    setGarminDraft({ ...garminDraft, authValue: event.target.value });
                    setGarminConfigState("idle");
                  }}
                  placeholder={garminConfig.hasCredential ? `Gespeichert: ${garminConfig.keyHint}` : "Passwort einmalig eintragen"}
                  autoComplete="current-password"
                />
              </label>
              <label>
                Auto-Abruf
                <select
                  value={garminDraft.autoSyncMinutes}
                  onChange={(event) => {
                    setGarminDraft({ ...garminDraft, autoSyncMinutes: Number(event.target.value) });
                    setGarminConfigState("idle");
                  }}
                >
                  {garminAutoSyncOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <button className="primary-button" type="submit" disabled={garminConfigState === "saving"}>
                {garminConfigState === "saving" ? <Loader2 className="spin" size={18} aria-hidden="true" /> : <ShieldCheck size={18} aria-hidden="true" />}
                Garmin speichern
              </button>
            </div>
            <div className="backup-note garmin-status-card">
              <strong>{calorieGoalDetails.usesGarminActiveCalories ? `+${calorieGoalDetails.activeCalories.toLocaleString("de-DE")} kcal aktiv` : hasGarminCredentials ? "Garmin bereit" : "Nicht verbunden"}</strong>
              <span>
                {!hasGarminCredentials
                  ? "Garmin Benutzer und Passwort speichern."
                  : garminSummary?.error
                  ? "Sync fehlgeschlagen. Credentials oder Garmin MFA pruefen."
                  : garminSummary?.configured
                    ? `Aktiv ${formatOptionalCalories(garminSummary.activeKilocalories)} · Ruhe ignoriert`
                    : "Garmin kann jetzt abgefragt werden."}
              </span>
              {garminSummary?.fetchedAt && <small>Letzter Abruf {formatTime(garminSummary.fetchedAt)}</small>}
              {hasGarminCredentials && (
                <small>
                  Server-Auto-Abruf {garminConfig.autoSyncMinutes === 0 ? "aus" : `alle ${garminConfig.autoSyncMinutes} Minuten`}
                </small>
              )}
            </div>
            <div className="config-controls">
              <button className="secondary-button" type="button" disabled={garminState === "loading"} onClick={() => void refreshGarminSummary()}>
                {garminState === "loading" ? <Loader2 className="spin" size={18} aria-hidden="true" /> : <Activity size={18} aria-hidden="true" />}
                Garmin abrufen
              </button>
              <p className={garminState === "error" ? "config-status config-status--error" : "config-status"}>
                {garminConfigState === "saved" && "Garmin-Konfiguration gespeichert."}
                {garminConfigState === "error" && (garminConfigError || "Garmin-Konfiguration konnte nicht gespeichert werden.")}
                {garminState === "loading" && "Garmin wird abgefragt."}
                {garminState === "done" && (garminSummary?.configured ? "Garmin-Abruf bereit." : "Garmin ist noch nicht konfiguriert.")}
                {garminState === "error" && "Garmin-Abruf nicht erfolgreich."}
                {garminState === "idle" && "Noch nicht abgefragt."}
              </p>
            </div>
          </form>
          <form className="config-panel config-panel--page ai-config-panel" aria-label="AI configuration" onSubmit={saveAiSettings}>
            <div className="config-copy">
              <p className="eyebrow eyebrow--dark">
                <KeyRound size={16} aria-hidden="true" />
                KI
              </p>
              <h2>KI-Konfiguration</h2>
              <p>Ein API-Key fuer Foto- und Wochenanalyse. Die Modelle bleiben getrennt.</p>
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
                Foto-Modell
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
                Analyse-Modell
                <select value={analysisAiDraft.model} onChange={(event) => {
                  setAnalysisAiDraft({ ...analysisAiDraft, provider: aiDraft.provider, model: event.target.value });
                  setAnalysisAiConfigState("idle");
                }}>
                  {(analysisAiConfig.providers.find((provider) => provider.id === aiDraft.provider)?.models ?? []).map((model) => (
                    <option value={model} key={model}>{model}</option>
                  ))}
                </select>
              </label>
              <button className="secondary-button" type="button" disabled={analysisAiModelsState === "loading"} onClick={() => void refreshAnalysisAiModels()}>
                {analysisAiModelsState === "loading" ? <Loader2 className="spin" size={18} aria-hidden="true" /> : <Sparkles size={18} aria-hidden="true" />}
                Analysemodelle abrufen
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
              <button className="primary-button" type="submit" disabled={aiConfigState === "saving" || analysisAiConfigState === "saving"}>
                {aiConfigState === "saving" || analysisAiConfigState === "saving" ? <Loader2 className="spin" size={18} aria-hidden="true" /> : <ShieldCheck size={18} aria-hidden="true" />}
                KI-Konfiguration speichern
              </button>
              <p className={aiConfigState === "error" || analysisAiConfigState === "error" ? "config-status config-status--error" : "config-status"}>
                {aiConfigState === "saved" && analysisAiConfigState === "saved" && "Gespeichert."}
                {(aiConfigState === "error" || analysisAiConfigState === "error") && (aiConfigError || analysisAiConfigError || "Konnte nicht gespeichert werden.")}
                {aiConfigState === "idle" && analysisAiConfigState === "idle" && (aiConfig.hasApiKey ? `Key hinterlegt: ${aiConfig.keyHint}` : "Noch kein Key hinterlegt.")}
              </p>
              <p className={aiModelsState === "error" ? "config-status config-status--error" : "config-status"}>
                {aiModelsState === "done" && "Foto-Modellliste aktualisiert."}
                {aiModelsState === "error" && (aiConfigError || "Live-Abruf fehlgeschlagen. Fallback-Liste bleibt aktiv.")}
                {aiModelsState === "idle" && "Foto-Live-Abruf zeigt nur Modelle mit Bild-Input."}
              </p>
              <p className={analysisAiModelsState === "error" ? "config-status config-status--error" : "config-status"}>
                {analysisAiModelsState === "done" && "Analyse-Modellliste aktualisiert."}
                {analysisAiModelsState === "error" && (analysisAiConfigError || "Live-Abruf fehlgeschlagen. Fallback-Liste bleibt aktiv.")}
                {analysisAiModelsState === "idle" && "Live-Abruf erlaubt Text-Input/Text-Output Modelle."}
              </p>
            </div>
          </form>
          <form className="config-panel config-panel--page weekly-email-panel" aria-label="Weekly email configuration" onSubmit={saveWeeklyEmailSettings}>
            <div className="config-copy">
              <p className="eyebrow eyebrow--dark">
                <Mail size={16} aria-hidden="true" />
                E-Mail
              </p>
              <h2>Wochenmail</h2>
              <p>Versand laeuft montags um 01:00 Uhr fuer die vorige Woche.</p>
            </div>
            <div className="config-controls">
              <label>
                Zieladresse
                <input
                  type="email"
                  value={weeklyEmailDraft.targetEmail}
                  onChange={(event) => {
                    setWeeklyEmailDraft({ targetEmail: event.target.value });
                    setWeeklyEmailConfigState("idle");
                  }}
                  placeholder="you@example.com"
                  autoComplete="email"
                />
              </label>
              <button className="primary-button" type="submit" disabled={weeklyEmailConfigState === "saving"}>
                {weeklyEmailConfigState === "saving" ? <Loader2 className="spin" size={18} aria-hidden="true" /> : <ShieldCheck size={18} aria-hidden="true" />}
                Wochenmail speichern
              </button>
              <p className={weeklyEmailConfigState === "error" ? "config-status config-status--error" : "config-status"}>
                {weeklyEmailConfigState === "saved" && "Gespeichert."}
                {weeklyEmailConfigState === "error" && (weeklyEmailConfigError || "Konnte nicht gespeichert werden.")}
                {weeklyEmailConfigState === "idle" && (weeklyEmailConfig.targetEmail ? `Ziel: ${weeklyEmailConfig.targetEmail}` : "Noch keine Zieladresse hinterlegt.")}
              </p>
            </div>
          </form>
          <section className="config-panel config-panel--page backup-panel" aria-label="Backup import export">
            <div className="config-copy">
              <p className="eyebrow eyebrow--dark">
                <Database size={16} aria-hidden="true" />
                Backup
              </p>
              <h2>Export & Import</h2>
              <p>JSON-Backup fuer Tagesprotokoll, Ziele und AI-Modell. API-Keys bleiben lokal.</p>
            </div>
            <div className="config-controls backup-actions">
              <button className="secondary-button" type="button" disabled={importExportState === "working"} onClick={() => void exportData()}>
                {importExportState === "working" ? <Loader2 className="spin" size={18} aria-hidden="true" /> : <Download size={18} aria-hidden="true" />}
                Daten exportieren
              </button>
              <button className="secondary-button" type="button" disabled={importExportState === "working"} onClick={() => importInputRef.current?.click()}>
                <Upload size={18} aria-hidden="true" />
                Backup importieren
              </button>
              <input
                ref={importInputRef}
                className="backup-file-input"
                type="file"
                accept="application/json,.json"
                onChange={(event) => void importData(event.target.files?.[0] ?? null)}
              />
            </div>
            <div className="backup-note">
              <strong>Import ersetzt alle aktuellen Eintraege.</strong>
              <span>Vorher am besten kurz exportieren.</span>
              <p className={importExportState === "error" ? "config-status config-status--error" : "config-status"}>
                {importExportMessage || "Bereit."}
              </p>
            </div>
          </section>
        </section>
      )}

      {activeView === "tracker" && (
        <>
      <section className="metric-grid" aria-label="Tagessummen">
        <Metric icon={<Flame />} label="Kalorien" value={totals.calories} suffix="kcal" />
        <Metric icon={<Scale />} label="Menge" value={Math.round(totals.grams)} suffix="g" />
        <MacroMetric label="Protein" target={macroTargets.protein.grams} actual={totals.protein} />
        <MacroMetric label="Kohlenhydrate" target={macroTargets.carbs.grams} actual={totals.carbs} />
        <MacroMetric label="Fett" target={macroTargets.fat.grams} actual={totals.fat} />
      </section>

      <section className="workspace-grid">
        <form ref={entryFormRef} className={editingEntryId ? "entry-form entry-form--editing" : "entry-form"} onSubmit={saveEntry}>
          <div className="entry-form__heading">
            <h2>{editingEntryId ? "Eintrag bearbeiten" : "Neuer Eintrag"}</h2>
            {editingEntryId && (
              <button className="secondary-button secondary-button--compact" type="button" onClick={cancelEdit}>
                <X size={17} aria-hidden="true" />
                Abbrechen
              </button>
            )}
          </div>
          <nav className="entry-mode-tabs" aria-label="Erfassungsart">
            {entryModes.map((mode) => (
              <button
                className={entryMode === mode.id ? "entry-mode-tab entry-mode-tab--active" : "entry-mode-tab"}
                type="button"
                key={mode.id}
                aria-pressed={entryMode === mode.id}
                onClick={() => {
                  if (mode.id !== "barcode") stopBarcodeScanner();
                  setEntryMode(mode.id);
                }}
              >
                {mode.icon}
                {mode.label}
              </button>
            ))}
          </nav>
          {entryMode === "barcode" && (
          <section className="barcode-panel" aria-label="Barcode scannen">
            <div className="search-panel__heading">
              <Barcode size={18} aria-hidden="true" />
              <span>1. Barcode scannen</span>
              <small>{supportsBarcodeScanner ? "Kamera" : "Manuell"}</small>
            </div>
            <div className="barcode-actions">
              <button className="secondary-button" type="button" disabled={!supportsBarcodeScanner || barcodeState === "scanning" || barcodeState === "loading"} onClick={() => void startBarcodeScanner()}>
                {barcodeState === "scanning" ? <Loader2 className="spin" size={18} aria-hidden="true" /> : <Camera size={18} aria-hidden="true" />}
                Scannen
              </button>
              <button className="secondary-button" type="button" disabled={barcodeState !== "scanning"} onClick={() => {
                stopBarcodeScanner();
                setBarcodeState("idle");
              }}>
                <X size={18} aria-hidden="true" />
                Stop
              </button>
            </div>
            <div className={barcodeState === "scanning" ? "barcode-preview barcode-preview--active" : "barcode-preview"}>
              <video ref={barcodeVideoRef} muted playsInline aria-label="Barcode Kamera-Vorschau" />
              {barcodeState !== "scanning" && (
                <span>
                  <Barcode size={28} aria-hidden="true" />
                  Produktcode erfassen
                </span>
              )}
            </div>
            <div className="barcode-manual">
              <label>
                Barcode
                <div className="search-input">
                  <input
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={manualBarcode}
                    onChange={(event) => setManualBarcode(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void lookupBarcode(manualBarcode);
                      }
                    }}
                    placeholder="EAN oder UPC"
                  />
                  <button type="button" aria-label="Barcode suchen" disabled={barcodeState === "loading"} onClick={() => void lookupBarcode(manualBarcode)}>
                    {barcodeState === "loading" ? <Loader2 className="spin" size={18} aria-hidden="true" /> : <Search size={18} aria-hidden="true" />}
                  </button>
                </div>
              </label>
            </div>
            {barcodeValue && <p className="photo-note">Barcode {barcodeValue}</p>}
            {barcodeState === "done" && <p className="photo-note">Lebensmittel übernommen. Nur noch Menge prüfen und speichern.</p>}
            {barcodeError && <p className="photo-note photo-note--error">{barcodeError}</p>}
          </section>
          )}
          {entryMode === "photo" && (
          <section className="photo-panel" aria-label="Fotoanalyse">
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
                {photoAnalysis.matchedFood && <small>Datenbank-Match: {photoAnalysis.matchedFood.name} · {photoAnalysis.matchedFood.source}</small>}
                {photoAnalysis.items && <AnalysisItems items={photoAnalysis.items} />}
                {photoAnalysis.aiUsage && <small>Usage-Rohwerte werden mit dem Eintrag gespeichert.</small>}
              </div>
            )}
          </section>
          )}
          {entryMode === "text" && (
          <section className="ai-text-panel" aria-label="Essen beschreiben">
            <div className="search-panel__heading">
              <MessageSquareText size={18} aria-hidden="true" />
              <span>Essen beschreiben</span>
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
                {textAnalysis.matchedFood && <small>Datenbank-Match: {textAnalysis.matchedFood.name} · {textAnalysis.matchedFood.source}</small>}
                {textAnalysis.items && <AnalysisItems items={textAnalysis.items} />}
                {textAnalysis.aiUsage && <small>Usage-Rohwerte werden mit dem Eintrag gespeichert.</small>}
              </div>
            )}
          </section>
          )}
          {entryMode === "meal" && (
          <section className="meal-panel" aria-label="Mahlzeiten-Vorlagen">
            <div className="search-panel__heading">
              <Utensils size={18} aria-hidden="true" />
              <span>Mahlzeiten</span>
              <small>{displayedMealTemplates.length}/{availableMealTemplates.length} Vorlagen</small>
            </div>
            <label>
              Name / Vorlage suchen
              <input value={mealNameDraft} onChange={(event) => setMealNameDraft(event.target.value)} placeholder="z.B. Standard-Fruehstueck oder Haferflocken" />
            </label>
            <div className="photo-actions">
              <button className="secondary-button" type="button" disabled={!draft.foodName.trim()} onClick={addDraftToMeal}>
                <Plus size={18} aria-hidden="true" />
                Zur Vorlage hinzufügen
              </button>
              <button className="secondary-button" type="button" disabled={!mealNameDraft.trim() || mealBuilderItems.length === 0 || mealState === "saving"} onClick={() => void saveMealBuilder(false)}>
                {mealState === "saving" ? <Loader2 className="spin" size={18} aria-hidden="true" /> : <Database size={18} aria-hidden="true" />}
                Vorlage speichern
              </button>
              <button className="secondary-button secondary-button--dark" type="button" disabled={!mealNameDraft.trim() || mealBuilderItems.length === 0 || mealState === "saving"} onClick={() => void saveMealBuilder(true)}>
                <Plus size={18} aria-hidden="true" />
                Vorlage heute eintragen
              </button>
            </div>
            {mealBuilderItems.length > 0 && (
              <div className="meal-builder-list">
                {mealBuilderItems.map((item, index) => (
                  <span key={`${item.foodName}-${index}`}>
                    {item.foodName} · {formatQuantity(item)}
                    <button type="button" aria-label={`${item.foodName} entfernen`} onClick={() => removeMealBuilderItem(index)}>
                      <X size={14} aria-hidden="true" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            {mealError && <p className="photo-note photo-note--error">{mealError}</p>}
            {mealTemplateError && <p className="photo-note photo-note--error">{mealTemplateError}</p>}
            {mealState === "saved" && <p className="photo-note">Mahlzeit gespeichert.</p>}
            {mealNameDraft.trim() && displayedMealTemplates.length === 0 && (
              <p className="photo-note">Keine Vorlage passt zu "{mealNameDraft.trim()}".</p>
            )}
            {displayedMealTemplates.length > 0 && (
              <div className="meal-template-list">
                {displayedMealTemplates.map((meal) => {
                  const isFavorite = mealTemplateFavorites.includes(meal.id);
                  const isEditing = editingMealTemplateId === meal.id;
                  const isSavedTemplate = meal.source === "template";

                  return (
                  <article className="meal-template-card" key={meal.id}>
                    <div className="meal-template-card__main">
                      <div className="meal-template-card__title-row">
                        <button
                          type="button"
                          className={isFavorite ? "meal-template-card__icon meal-template-card__icon--favorite" : "meal-template-card__icon"}
                          onClick={() => toggleMealTemplateFavorite(meal)}
                          aria-label={`${meal.name} ${isFavorite ? "aus Favoriten entfernen" : "als Favorit markieren"}`}
                          title={isFavorite ? "Favorit" : "Als Favorit markieren"}
                        >
                          <Star size={16} aria-hidden="true" />
                        </button>
                        {isEditing ? (
                          <input
                            className="meal-template-card__input"
                            value={mealTemplateEditNameDraft}
                            onChange={(event) => setMealTemplateEditNameDraft(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                void saveMealTemplateName(meal);
                              }
                              if (event.key === "Escape") {
                                event.preventDefault();
                                cancelMealTemplateEdit();
                              }
                            }}
                            onBlur={() => void saveMealTemplateName(meal)}
                            autoFocus
                          />
                        ) : (
                          <strong onDoubleClick={() => {
                            if (isSavedTemplate) startMealTemplateEdit(meal);
                          }}>{meal.name}</strong>
                        )}
                        {isSavedTemplate && (
                          <button
                            type="button"
                            className="meal-template-card__icon"
                            onClick={() => startMealTemplateEdit(meal)}
                            aria-label={`${meal.name} bearbeiten`}
                            title="Vorlage bearbeiten"
                          >
                            <Pencil size={15} aria-hidden="true" />
                          </button>
                        )}
                      </div>
                      <small>{meal.items.length} Lebensmittel · {mealCalories(meal.items).toLocaleString("de-DE")} kcal{meal.source === "history" ? " · Verlauf" : ""}</small>
                    </div>
                    <div className="food-actions">
                      <button type="button" aria-label={`${meal.name} eintragen`} onClick={() => void applyMealTemplate(meal)}>
                        <Plus size={16} aria-hidden="true" />
                      </button>
                      {isSavedTemplate && (
                        <button type="button" aria-label={`${meal.name} loeschen`} onClick={() => void removeMealTemplate(meal.id)}>
                          <Trash2 size={16} aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  </article>
                );
                })}
              </div>
            )}
          </section>
          )}
          {entryMode === "search" && (
          <section className="search-panel search-panel--embedded" aria-label="Lebensmittelsuche">
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
                  <button type="button" aria-label="Lebensmittel suchen" onMouseDown={(event) => event.preventDefault()} onClick={() => {
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
                      {(result.usageCount ?? 0) > 0 ? ` · ${result.usageCount}x genutzt` : ""}
                    </small>
                  </span>
                </button>
              ))}
            </div>
          </section>
          )}
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
            {editingEntryId ? <Pencil size={18} aria-hidden="true" /> : <Plus size={18} aria-hidden="true" />}
            {editingEntryId ? "Änderungen speichern" : "4. Speichern"}
          </button>
          {entryError && <p className="form-error">{entryError}</p>}
        </form>

        <section className="entry-list" aria-label="Tagesprotokoll Einträge">
        <div className="section-heading">
          <div className="section-heading__copy">
            <h2>{selectedDate === todayLocal() ? "Heute" : formatDateLabel(selectedDate)}</h2>
            <span>{dayEntries.length} Einträge · {totals.calories.toLocaleString("de-DE")} kcal</span>
          </div>
          <label className="date-filter">
            Tag
            <input
              type="date"
              value={selectedDate}
              onChange={(event) => {
                setSelectedDate(event.target.value || todayLocal());
                setSelectedEntryIds([]);
                setActiveMealId(null);
                setEditingMealId(null);
                setMealEditNameDraft("");
              }}
            />
          </label>
        </div>
        {mealGroups.length > 0 && (
          <nav className="meal-navigation" aria-label="Mahlzeiten im Tagesprotokoll">
            <button
              className="meal-navigation__step"
              type="button"
              onClick={() => scrollMealByStep(-1)}
              disabled={mealGroups.length < 2 || activeMealId === mealGroups[0]?.id}
              aria-label="Vorherige Mahlzeit"
            >
              <ChevronLeft size={16} aria-hidden="true" />
            </button>
            <div className="meal-navigation__list">
              {mealGroups.map((group, index) => {
                const isActive = activeMealId === group.id;
                return (
                  <button
                    className={isActive ? "meal-navigation__item meal-navigation__item--active" : "meal-navigation__item"}
                    type="button"
                    key={group.id}
                    onClick={() => scrollToMeal(group.id)}
                    aria-current={isActive ? "true" : undefined}
                  >
                    <span>{index + 1}</span>
                    <strong>{group.name}</strong>
                    <small>{group.calories.toLocaleString("de-DE")} kcal</small>
                  </button>
                );
              })}
            </div>
            <button
              className="meal-navigation__step"
              type="button"
              onClick={() => scrollMealByStep(1)}
              disabled={mealGroups.length < 2 || activeMealId === mealGroups[mealGroups.length - 1]?.id}
              aria-label="Nächste Mahlzeit"
            >
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          </nav>
        )}
        {sortedEntries.length > 0 && (
          <div className={selectedEntries.length > 0 ? "entry-grouping entry-grouping--active" : "entry-grouping"}>
            <div className="entry-grouping__summary">
              <Check size={16} aria-hidden="true" />
              <span>{selectedEntries.length} ausgewählt</span>
              {selectedEntries.length > 0 && (
                <button className="link-button" type="button" onClick={() => setSelectedEntryIds([])}>
                  Auswahl löschen
                </button>
              )}
            </div>
            <div className="entry-grouping__controls">
              <label>
                Mahlzeitname
                <input
                  value={mealGroupNameDraft}
                  onChange={(event) => setMealGroupNameDraft(event.target.value)}
                  placeholder="z.B. Mittagessen"
                />
              </label>
              <button
                className="secondary-button secondary-button--dark"
                type="button"
                disabled={selectedEntries.length < 2 || !mealGroupNameDraft.trim() || mealGroupingState === "saving"}
                onClick={() => void groupSelectedEntries()}
              >
                {mealGroupingState === "saving" ? <Loader2 className="spin" size={18} aria-hidden="true" /> : <Utensils size={18} aria-hidden="true" />}
                Zu Mahlzeit zusammenfassen
              </button>
            </div>
          </div>
        )}
        {sortedEntries.length === 0 && <p className="empty-state">Noch keine Einträge fuer diesen Tag.</p>}
        {groupedEntries.map((group) => group.kind === "single" ? (
          <FoodEntryRow
            entry={group.entry}
            key={group.entry.id}
            onDuplicate={(entry) => void duplicateEntry(entry)}
            onEdit={editEntry}
            onDelete={(id) => void deleteEntry(id)}
            onReanalyze={(entry) => void reanalyzeEntryImage(entry)}
            isReanalyzing={reanalyzingEntryId === group.entry.id}
            canReanalyze={aiConfig.hasApiKey}
            isSelected={selectedEntryIds.includes(group.entry.id)}
            onToggleSelected={toggleEntrySelection}
          />
        ) : (
          <article
            className={activeMealId === group.id ? "meal-row meal-row--active" : "meal-row"}
            key={group.id}
            ref={(element) => {
              mealRefs.current[group.id] = element;
            }}
            tabIndex={-1}
          >
            <div className="meal-row__heading">
              <div>
                <span className="time-tag">{formatDateTime(group.consumedAt)}</span>
                {editingMealId === group.id ? (
                  <div className="meal-row__edit">
                    <label>
                      Mahlzeitname
                      <input
                        value={mealEditNameDraft}
                        onChange={(event) => setMealEditNameDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") void saveMealName(group);
                          if (event.key === "Escape") {
                            setEditingMealId(null);
                            setMealEditNameDraft("");
                          }
                        }}
                        autoFocus
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => void saveMealName(group)}
                      disabled={!mealEditNameDraft.trim() || savingMealId === group.id}
                      aria-label="Mahlzeitname speichern"
                    >
                      {savingMealId === group.id ? <Loader2 className="spin" size={17} aria-hidden="true" /> : <Check size={17} aria-hidden="true" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingMealId(null);
                        setMealEditNameDraft("");
                      }}
                      aria-label="Bearbeitung abbrechen"
                    >
                      <X size={17} aria-hidden="true" />
                    </button>
                  </div>
                ) : (
                  <h3>{group.name}</h3>
                )}
                <p>{group.entries.length} Lebensmittel · {group.calories.toLocaleString("de-DE")} kcal</p>
                {group.imageDataUrl && (
                  <div className="meal-row__image">
                    <img src={group.imageDataUrl} alt="" />
                    <button
                      className="secondary-button secondary-button--compact"
                      type="button"
                      disabled={!aiConfig.hasApiKey || reanalyzingEntryId === group.id}
                      onClick={() => void reanalyzeMealImage(group)}
                      title={aiConfig.hasApiKey ? "Mahlzeitbild mit aktuellem Foto-Modell neu erkennen" : "API-Key zuerst in der Konfiguration speichern"}
                    >
                      {reanalyzingEntryId === group.id ? <Loader2 className="spin" size={16} aria-hidden="true" /> : <RefreshCw size={16} aria-hidden="true" />}
                      Neu erkennen
                    </button>
                  </div>
                )}
              </div>
              <div className="meal-row__actions">
                <button
                  type="button"
                  className={mealFavorites.includes(mealFavoriteKey(group)) ? "meal-row__icon meal-row__icon--favorite" : "meal-row__icon"}
                  onClick={() => toggleMealFavorite(group)}
                  aria-label={`${group.name} ${mealFavorites.includes(mealFavoriteKey(group)) ? "aus Favoriten entfernen" : "als Favorit markieren"}`}
                  title={mealFavorites.includes(mealFavoriteKey(group)) ? "Favorit" : "Als Favorit markieren"}
                >
                  <Star size={17} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="meal-row__icon"
                  onClick={() => startMealEdit(group)}
                  aria-label={`${group.name} bearbeiten`}
                  title="Mahlzeit bearbeiten"
                >
                  <Pencil size={17} aria-hidden="true" />
                </button>
                <strong>{group.calories.toLocaleString("de-DE")} kcal</strong>
              </div>
            </div>
            <div className="meal-row__items">
              {group.entries.map((entry) => (
                <FoodEntryRow
                  entry={entry}
                  key={entry.id}
                  onDuplicate={(entry) => void duplicateEntry(entry)}
                  onEdit={editEntry}
                  onDelete={(id) => void deleteEntry(id)}
                  onReanalyze={(entry) => void reanalyzeEntryImage(entry)}
                  isReanalyzing={reanalyzingEntryId === entry.id}
                  canReanalyze={aiConfig.hasApiKey}
                  isSelected={selectedEntryIds.includes(entry.id)}
                  onToggleSelected={toggleEntrySelection}
                  compact
                />
              ))}
            </div>
          </article>
        ))}
        </section>
      </section>
        </>
      )}
    </main>
  );
}

function AnalysisSummaryMetric({ label, actual, target, suffix }: { label: string; actual: number; target: number; suffix: string }) {
  const roundedActual = Math.round(actual);
  const roundedTarget = Math.round(target);
  const delta = roundedActual - roundedTarget;

  return (
    <article className="analysis-summary-card">
      <span>{label}</span>
      <strong>{roundedActual.toLocaleString("de-DE")} <small>{suffix}</small></strong>
      <p className={delta > 0 ? "delta delta--over" : delta < 0 ? "delta delta--under" : "delta"}>
        {formatSignedNumber(delta)} {suffix} vs. Ziel
      </p>
    </article>
  );
}

type WeeklyChartPoint = {
  date: string;
  actual: number;
  target: number;
  entryCount: number;
  hasError?: boolean;
};

type CalorieTimingPoint = CalorieTimingCheckpoint & {
  targetCalories: number;
  actualCalories: number;
  delta: number;
};

type CurrentCalorieTimingBudget = CalorieTimingPoint & {
  remainingCalories: number;
};

function CalorieTimingPlan({
  date,
  calorieGoal,
  points,
  totalCalories,
  usesGarminActiveCalories,
  calorieGoalOffset,
}: {
  date: string;
  calorieGoal: number;
  points: CalorieTimingPoint[];
  totalCalories: number;
  usesGarminActiveCalories: boolean;
  calorieGoalOffset: number;
}) {
  const dayDelta = Math.round(totalCalories - calorieGoal);
  const fillWidth = calorieGoal > 0 ? Math.min(100, Math.round((totalCalories / calorieGoal) * 100)) : 0;

  return (
    <article className="calorie-timing-card" aria-label="Kalorien-Tageslinie">
      <div className="calorie-timing-card__head">
        <div>
          <span className="eyebrow eyebrow--dark">
            <Clock3 size={16} aria-hidden="true" />
            Tageslinie
          </span>
          <strong>{formatDateLabel(date)} · {calorieGoal.toLocaleString("de-DE")} kcal</strong>
        </div>
        <small>{usesGarminActiveCalories ? "Basis + Garmin aktiv" : "Konfiguriertes Ziel"} · {calorieGoalOffset !== 0 ? formatCalorieGoalOffset(calorieGoalOffset) : "kein Offset"}</small>
      </div>
      <div className="calorie-timing-rail" aria-hidden="true">
        <span className="calorie-timing-rail__fill" style={{ width: `${fillWidth}%` }} />
        {points.map((point) => (
          <span
            className="calorie-timing-rail__marker"
            key={point.time}
            style={{ left: `${Math.round(point.percent * 100)}%` }}
          />
        ))}
      </div>
      <div className="calorie-timing-grid" role="list">
        {points.map((point) => (
          <div className="calorie-timing-point" role="listitem" key={point.time}>
            <span>bis {point.time}</span>
            <strong>{point.targetCalories.toLocaleString("de-DE")} kcal</strong>
            <small className={point.delta > 0 ? "delta delta--over" : point.delta < 0 ? "delta delta--under" : "delta"}>
              {point.actualCalories.toLocaleString("de-DE")} gegessen · {formatSignedNumber(point.delta)}
            </small>
          </div>
        ))}
      </div>
      <p className={dayDelta > 0 ? "calorie-timing-note delta--over" : dayDelta < 0 ? "calorie-timing-note delta--under" : "calorie-timing-note"}>
        {totalCalories.toLocaleString("de-DE")} kcal erfasst · {formatSignedNumber(dayDelta)} kcal zum Tagesziel
      </p>
    </article>
  );
}

function WeeklyBarChart({ title, suffix, points }: { title: string; suffix: string; points: WeeklyChartPoint[] }) {
  const chartMax = Math.max(1, ...points.flatMap((point) => [point.actual, point.target])) * 1.12;
  const totalDelta = Math.round(points.reduce((sum, point) => sum + point.actual - point.target, 0));

  return (
    <article className="weekly-chart-card">
      <div className="weekly-chart-card__head">
        <span>{title}</span>
        <strong className={totalDelta > 0 ? "delta delta--over" : totalDelta < 0 ? "delta delta--under" : "delta"}>
          {formatSignedNumber(totalDelta)} {suffix}
        </strong>
      </div>
      <div className="weekly-bar-chart" role="list" aria-label={`${title} Mo bis So`}>
        {points.map((point) => {
          const actual = Math.round(point.actual);
          const target = Math.round(point.target);
          const delta = actual - target;
          const actualHeight = Math.max(3, Math.round((point.actual / chartMax) * 100));
          const targetPosition = Math.min(100, Math.max(0, Math.round((point.target / chartMax) * 100)));
          const isOver = delta > 0;

          return (
            <div className="weekly-bar-day" role="listitem" key={`${title}-${point.date}`}>
              <div
                className={isOver ? "weekly-bar weekly-bar--over" : "weekly-bar weekly-bar--under"}
                aria-label={`${formatWeekdayShort(point.date)}: ${actual} von ${target} ${suffix}`}
              >
                <span className="weekly-bar__fill" style={{ height: `${actualHeight}%` }} />
                <span className="weekly-bar__target" style={{ bottom: `${targetPosition}%` }} />
              </div>
              <div className="weekly-bar-day__label">
                <strong>{formatWeekdayShort(point.date)}</strong>
                <span className="weekly-bar-day__values">
                  <small>{actual.toLocaleString("de-DE")}</small>
                  <small>Z {target.toLocaleString("de-DE")}</small>
                </span>
                <em className={isOver ? "delta delta--over" : delta < 0 ? "delta delta--under" : "delta"}>
                  {formatSignedNumber(delta)}
                </em>
                {point.hasError && <small className="weekly-bar-day__error">Garmin</small>}
              </div>
            </div>
          );
        })}
      </div>
      <div className="weekly-chart-legend" aria-hidden="true">
        <span><i className="weekly-chart-legend__under" />unter Ziel</span>
        <span><i className="weekly-chart-legend__over" />über Ziel</span>
        <span><i className="weekly-chart-legend__target" />Ziel</span>
      </div>
    </article>
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

function AnalysisItems({ items }: { items: FoodImageAnalysisItem[] }) {
  if (items.length < 2) return null;
  return (
    <div className="analysis-items">
      {items.map((item, index) => (
        <span key={`${item.description}-${index}`}>
          {item.description} · {item.estimatedGrams} g · {item.calories} kcal
          {item.matchedFood ? ` · DB: ${item.matchedFood.name}` : ""}
        </span>
      ))}
    </div>
  );
}

function FoodEntryRow({
  entry,
  onDuplicate,
  onEdit,
  onDelete,
  onReanalyze,
  isReanalyzing,
  canReanalyze,
  isSelected,
  onToggleSelected,
  compact = false,
}: {
  entry: FoodEntry;
  onDuplicate: (entry: FoodEntry) => void;
  onEdit: (entry: FoodEntry) => void;
  onDelete: (id: string) => void;
  onReanalyze: (entry: FoodEntry) => void;
  isReanalyzing: boolean;
  canReanalyze: boolean;
  isSelected: boolean;
  onToggleSelected: (id: string) => void;
  compact?: boolean;
}) {
  const entryCalories = caloriesFor(entry);
  const rowMacros = [
    ["P", macroFor(entry, entry.proteinPer100g)],
    ["C", macroFor(entry, entry.carbsPer100g)],
    ["F", macroFor(entry, entry.fatPer100g)],
  ] as const;

  return (
    <article className={`${compact ? "food-row food-row--compact" : "food-row"}${isSelected ? " food-row--selected" : ""}`}>
      <label className="entry-select" aria-label={`${entry.foodName} auswählen`}>
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => onToggleSelected(entry.id)}
        />
        <span aria-hidden="true"><Check size={14} /></span>
      </label>
      {!compact && <time className="entry-time" dateTime={entry.consumedAt}>{formatTime(entry.consumedAt)}</time>}
      <div className="food-row__main">
        <div className="food-row__titleline">
          <h3>{entry.foodName}</h3>
          <strong>{entryCalories.toLocaleString()} kcal</strong>
        </div>
        {!compact && entry.imageDataUrl && (
          <div className="food-row__image">
            <img src={entry.imageDataUrl} alt="" />
            <button
              className="secondary-button secondary-button--compact"
              type="button"
              disabled={!canReanalyze || isReanalyzing}
              onClick={() => onReanalyze(entry)}
              title={canReanalyze ? "Gespeichertes Bild mit aktuellem Foto-Modell neu erkennen" : "API-Key zuerst in der Konfiguration speichern"}
            >
              {isReanalyzing ? <Loader2 className="spin" size={16} aria-hidden="true" /> : <RefreshCw size={16} aria-hidden="true" />}
              Neu erkennen
            </button>
          </div>
        )}
        <p className="food-row__meta">
          {formatQuantity(entry)} · {entry.caloriesPer100g.toLocaleString()} kcal / 100g
        </p>
        <p className="macro-line">
          {rowMacros.map(([label, value]) => (
            <span key={label}>{label} {formatMacro(value)}g</span>
          ))}
        </p>
      </div>
      <div className="food-actions food-actions--inline">
        <button type="button" aria-label={entry.foodName + " mit aktueller Uhrzeit duplizieren"} onClick={() => onDuplicate(entry)}>
          <Copy size={17} aria-hidden="true" />
        </button>
        <button type="button" aria-label={entry.foodName + " bearbeiten"} onClick={() => onEdit(entry)}>
          <Pencil size={17} aria-hidden="true" />
        </button>
        <button type="button" aria-label={entry.foodName + " löschen"} onClick={() => onDelete(entry.id)}>
          <Trash2 size={17} aria-hidden="true" />
        </button>
      </div>
    </article>
  );
}

function buildEntryGroups(entries: FoodEntry[]): EntryGroup[] {
  const groups: EntryGroup[] = [];
  const mealMap = new Map<string, FoodEntry[]>();

  for (const entry of entries) {
    if (!entry.mealId) {
      groups.push({ kind: "single", entry });
      continue;
    }
    const mealEntries = mealMap.get(entry.mealId) ?? [];
    mealEntries.push(entry);
    mealMap.set(entry.mealId, mealEntries);
    if (mealEntries.length === 1) {
      groups.push({
        kind: "meal",
        id: entry.mealId,
        name: entry.mealName || "Mahlzeit",
        consumedAt: entry.consumedAt,
        calories: 0,
        entries: mealEntries,
      });
    }
  }

  return groups.map((group) => {
    if (group.kind === "single") return group;
    const entriesForMeal = mealMap.get(group.id) ?? group.entries;
    return {
      ...group,
      consumedAt: entriesForMeal[0]?.consumedAt ?? group.consumedAt,
      calories: entriesForMeal.reduce((sum, entry) => sum + caloriesFor(entry), 0),
      entries: entriesForMeal,
      imageDataUrl: entriesForMeal.find((entry) => entry.imageDataUrl)?.imageDataUrl,
    };
  });
}

function loadMealFavorites() {
  if (typeof window === "undefined") return [];
  try {
    const rawFavorites = window.localStorage.getItem(mealFavoritesStorageKey);
    const parsedFavorites = rawFavorites ? JSON.parse(rawFavorites) : [];
    return Array.isArray(parsedFavorites) ? parsedFavorites.filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [];
  }
}

function saveMealFavorites(favorites: string[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(mealFavoritesStorageKey, JSON.stringify([...new Set(favorites)]));
}

function loadMealTemplateFavorites() {
  if (typeof window === "undefined") return [];
  try {
    const rawFavorites = window.localStorage.getItem(mealTemplateFavoritesStorageKey);
    const parsedFavorites = rawFavorites ? JSON.parse(rawFavorites) : [];
    return Array.isArray(parsedFavorites) ? parsedFavorites.filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [];
  }
}

function saveMealTemplateFavorites(favorites: string[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(mealTemplateFavoritesStorageKey, JSON.stringify([...new Set(favorites)]));
}

function mealFavoriteKey(group: MealEntryGroup) {
  return `meal:${group.id}`;
}

type DayTotals = {
  calories: number;
  grams: number;
  protein: number;
  carbs: number;
  fat: number;
};

type WeekAnalysisDay = {
  date: string;
  entryCount: number;
  totals: DayTotals;
  calorieTarget: number;
  macroTargets: ReturnType<typeof calculateMacroTargets>;
  garminError?: string;
};

function buildWeekAnalysis(
  dates: string[],
  entries: FoodEntry[],
  nutritionConfig: NutritionConfig,
  preset: MacroPreset,
  garminSummaries: Record<string, GarminDailySummary>,
): WeekAnalysisDay[] {
  return dates.map((date) => {
    const dayEntriesForDate = entries.filter((entry) => entry.consumedAt.slice(0, 10) === date);
    const totals = summarizeEntries(dayEntriesForDate);
    const garminSummaryForDate = garminSummaries[date];
    const calorieTarget = buildCalorieGoalDetails(garminSummaryForDate, nutritionConfig).effectiveGoal;

    return {
      date,
      entryCount: dayEntriesForDate.length,
      totals,
      calorieTarget,
      macroTargets: calculateMacroTargets(calorieTarget, preset),
      garminError: garminSummaryForDate?.error,
    };
  });
}

function buildCalorieTimingPoints(
  entries: FoodEntry[],
  calorieGoal: number,
  checkpoints: CalorieTimingCheckpoint[],
): CalorieTimingPoint[] {
  return checkpoints.map((checkpoint) => {
    const actualCalories = entries
      .filter((entry) => entry.consumedAt.slice(11, 16) <= checkpoint.time)
      .reduce((sum, entry) => sum + caloriesFor(entry), 0);
    const targetCalories = Math.round(calorieGoal * checkpoint.percent);

    return {
      ...checkpoint,
      actualCalories,
      targetCalories,
      delta: Math.round(actualCalories - targetCalories),
    };
  });
}

function buildCurrentCalorieTimingBudget(
  entries: FoodEntry[],
  calorieGoal: number,
  checkpoints: CalorieTimingCheckpoint[],
  selectedDate: string,
): CurrentCalorieTimingBudget {
  const now = new Date();
  const currentTime = selectedDate === todayLocal()
    ? `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`
    : "21:00";
  const checkpoint = checkpoints.find((point) => currentTime <= point.time) ?? checkpoints[checkpoints.length - 1];
  const targetCalories = Math.round(calorieGoal * checkpoint.percent);
  const actualCalories = entries
    .filter((entry) => entry.consumedAt.slice(11, 16) <= currentTime)
    .reduce((sum, entry) => sum + caloriesFor(entry), 0);
  const delta = Math.round(actualCalories - targetCalories);

  return {
    ...checkpoint,
    targetCalories,
    actualCalories,
    delta,
    remainingCalories: Math.round(targetCalories - actualCalories),
  };
}

function buildCalorieGoalDetails(garminSummary: GarminDailySummary | null | undefined, nutritionConfig: NutritionConfig) {
  const activeCalories = garminSummary?.configured && Number.isFinite(garminSummary.activeKilocalories)
    ? Math.round(garminSummary.activeKilocalories ?? 0)
    : 0;
  const usesGarminActiveCalories = Boolean(garminSummary?.configured && Number.isFinite(garminSummary.activeKilocalories));
  const baseGoal = nutritionConfig.calorieGoal;
  const effectiveGoal = Math.max(minimumCalorieGoal, Math.round(baseGoal + activeCalories + nutritionConfig.calorieGoalOffset));

  return {
    activeCalories,
    baseGoal,
    effectiveGoal,
    usesGarminActiveCalories,
  };
}

function formatCalorieGoalOffset(offset: number) {
  return offset > 0 ? `+${offset.toLocaleString("de-DE")} kcal Überschuss` : `${offset.toLocaleString("de-DE")} kcal Defizit`;
}

function summarizeEntries(entries: FoodEntry[]): DayTotals {
  return entries.reduce(
    (sum, entry) => ({
      calories: sum.calories + caloriesFor(entry),
      grams: sum.grams + gramsFor(entry),
      protein: sum.protein + macroFor(entry, entry.proteinPer100g),
      carbs: sum.carbs + macroFor(entry, entry.carbsPer100g),
      fat: sum.fat + macroFor(entry, entry.fatPer100g),
    }),
    { calories: 0, grams: 0, protein: 0, carbs: 0, fat: 0 },
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

async function createEntryGroup(mealName: string, entries: FoodDraft[], imageDataUrl = ""): Promise<FoodEntry[]> {
  const response = await fetch("/api/entries", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mealName, entries, imageDataUrl }),
  });
  const data = (await response.json()) as { entries?: FoodEntry[]; error?: string };
  if (!response.ok || !data.entries) throw new Error(data.error ?? "Mahlzeit konnte nicht gespeichert werden.");
  return data.entries.map(normalizeBackendEntry);
}

async function fetchMealTemplates(): Promise<MealTemplate[]> {
  const response = await fetch("/api/meals");
  if (!response.ok) throw new Error("Meals request failed");
  const data = (await response.json()) as { meals?: MealTemplate[] };
  return (data.meals ?? []).map(normalizeMealTemplate);
}

async function createMealTemplate(input: { name: string; items: MealTemplateItem[] }): Promise<MealTemplate> {
  const response = await fetch("/api/meals", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = (await response.json()) as { meal?: MealTemplate; error?: string };
  if (!response.ok || !data.meal) throw new Error(data.error ?? "Mahlzeit konnte nicht gespeichert werden.");
  return normalizeMealTemplate(data.meal);
}

async function updateMealTemplateName(id: string, name: string): Promise<MealTemplate> {
  const response = await fetch(`/api/meals/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const data = (await response.json()) as { meal?: MealTemplate; error?: string };
  if (!response.ok || !data.meal) throw new Error(data.error ?? "Mahlzeit konnte nicht gespeichert werden.");
  return normalizeMealTemplate(data.meal);
}

async function deleteMealTemplate(id: string) {
  const response = await fetch(`/api/meals/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!response.ok) throw new Error("Mahlzeit konnte nicht geloescht werden.");
}

async function updateBackendEntry(id: string, draft: FoodDraft): Promise<FoodEntry> {
  const response = await fetch(`/api/entries/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(draft),
  });
  if (!response.ok) throw new Error("Entry could not be updated");
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

async function fetchAnalysisAiConfig(): Promise<AiConfig> {
  const response = await fetch("/api/config/analysis-ai");
  if (!response.ok) throw new Error("Analysis AI config request failed");
  const data = (await response.json()) as Partial<AiConfig>;
  return normalizeAiConfig(data);
}

async function saveAnalysisAiConfig(config: AiConfigDraft): Promise<AiConfig> {
  const response = await fetch("/api/config/analysis-ai", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(config),
  });
  const data = (await response.json()) as Partial<AiConfig> & { error?: string };
  if (!response.ok) throw new Error(data.error ?? "Analysis AI config could not be saved");
  return normalizeAiConfig(data);
}

async function fetchWeeklyEmailConfig(): Promise<WeeklyEmailConfig> {
  const response = await fetch("/api/config/weekly-email");
  if (!response.ok) throw new Error("Weekly email config request failed");
  const data = (await response.json()) as Partial<WeeklyEmailConfig>;
  return normalizeWeeklyEmailConfig(data);
}

async function saveWeeklyEmailConfig(config: WeeklyEmailConfigDraft): Promise<WeeklyEmailConfig> {
  const response = await fetch("/api/config/weekly-email", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(config),
  });
  const data = (await response.json()) as Partial<WeeklyEmailConfig> & { error?: string };
  if (!response.ok) throw new Error(data.error ?? "Wochenmail konnte nicht gespeichert werden.");
  return normalizeWeeklyEmailConfig(data);
}

async function fetchGarminConfig(): Promise<GarminConfig> {
  const response = await fetch("/api/config/garmin");
  if (!response.ok) throw new Error("Garmin config request failed");
  const data = (await response.json()) as Partial<GarminConfig>;
  return normalizeGarminConfig(data);
}

async function saveGarminConfig(config: GarminConfigDraft): Promise<GarminConfig> {
  const response = await fetch("/api/config/garmin", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(config),
  });
  const data = (await response.json()) as Partial<GarminConfig> & { error?: string };
  if (!response.ok) throw new Error(data.error ?? "Garmin-Konfiguration konnte nicht gespeichert werden.");
  return normalizeGarminConfig(data);
}

async function fetchAiModels(provider: string, capability: "photo" | "analysis" = "photo"): Promise<string[]> {
  const params = new URLSearchParams({ provider });
  params.set("capability", capability);
  const response = await fetch(`/api/ai/models?${params.toString()}`);
  const data = (await response.json()) as { models?: string[]; error?: string };
  if (!response.ok || !Array.isArray(data.models)) throw new Error(data.error ?? "Modelle konnten nicht geladen werden.");
  return data.models;
}

async function fetchWeeklyAiAnalysis(weekStart: string): Promise<WeeklyAiAnalysis> {
  const response = await fetch("/api/ai/weekly-analysis", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ weekStart }),
  });
  const data = (await response.json()) as { analysis?: WeeklyAiAnalysis; error?: string };
  if (!response.ok || !data.analysis) throw new Error(data.error ?? "Wochenanalyse fehlgeschlagen.");
  return normalizeWeeklyAiAnalysis(data.analysis);
}

async function fetchGarminDailySummary(date: string, refresh = false): Promise<GarminDailySummary> {
  const params = new URLSearchParams({ date });
  if (refresh) params.set("refresh", "1");
  const response = await fetch(`/api/garmin/daily-summary?${params.toString()}`);
  const data = (await response.json()) as { summary?: GarminDailySummary };
  if (!response.ok || !data.summary) throw new Error("Garmin konnte nicht abgefragt werden.");
  return normalizeGarminDailySummary(data.summary);
}

async function fetchExportData(): Promise<unknown> {
  const response = await fetch("/api/export");
  if (!response.ok) throw new Error("Export konnte nicht erstellt werden.");
  return response.json();
}

async function importBackupFile(file: File): Promise<ImportResult> {
  if (!file.name.toLowerCase().endsWith(".json")) {
    throw new Error("Bitte eine JSON-Datei auswaehlen.");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(await file.text()) as unknown;
  } catch {
    throw new Error("Die Datei ist kein gueltiges JSON-Backup.");
  }
  const response = await fetch("/api/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await response.json()) as { result?: ImportResult; error?: string };
  if (!response.ok || !data.result) throw new Error(data.error ?? "Import fehlgeschlagen.");
  return data.result;
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

async function fetchFoodByBarcode(barcode: string): Promise<FoodSearchResult | null> {
  const params = new URLSearchParams({ code: barcode });
  const response = await fetch(`/api/foods/barcode?${params.toString()}`);
  if (!response.ok) throw new Error("Barcode request failed");
  const data = (await response.json()) as { food?: FoodSearchResult | null };
  return data.food ?? null;
}

function draftFromAnalysis(analysis: FoodImageAnalysis): FoodDraft {
  const matchedFood = analysis.matchedFood;
  if (matchedFood) {
    return {
      foodKey: matchedFood.id,
      foodName: matchedFood.brand ? `${matchedFood.name} · ${matchedFood.brand}` : matchedFood.name,
      quantityValue: analysis.estimatedGrams,
      quantityUnit: "g",
      caloriesPer100g: matchedFood.caloriesPer100g,
      proteinPer100g: matchedFood.proteinPer100g,
      carbsPer100g: matchedFood.carbsPer100g,
      fatPer100g: matchedFood.fatPer100g,
      consumedAt: nowLocal(),
      source: matchedFood.source + " via AI",
      aiUsage: analysis.aiUsage,
    };
  }

  return {
    foodName: analysis.description,
    quantityValue: analysis.estimatedGrams,
    quantityUnit: "g",
    caloriesPer100g: analysis.caloriesPer100g,
    proteinPer100g: analysis.proteinPer100g,
    carbsPer100g: analysis.carbsPer100g,
    fatPer100g: analysis.fatPer100g,
    consumedAt: nowLocal(),
    source: "AI " + analysis.provider + "/" + analysis.model,
    aiUsage: analysis.aiUsage,
  };
}

function draftFromEntry(entry: FoodEntry): FoodDraft {
  return {
    foodKey: entry.foodKey,
    foodName: entry.foodName,
    quantityValue: entry.quantityValue,
    quantityUnit: entry.quantityUnit,
    caloriesPer100g: entry.caloriesPer100g,
    proteinPer100g: entry.proteinPer100g,
    carbsPer100g: entry.carbsPer100g,
    fatPer100g: entry.fatPer100g,
    consumedAt: entry.consumedAt,
    source: entry.source ?? "manual",
    aiUsage: entry.aiUsage,
    mealId: entry.mealId,
    mealName: entry.mealName,
    imageDataUrl: entry.imageDataUrl,
  };
}

function draftsFromAnalysis(analysis: FoodImageAnalysis, consumedAt: string): FoodDraft[] {
  const itemDrafts = (analysis.items ?? []).map((item) => draftFromAnalysis({
    ...item,
    provider: analysis.provider,
    model: analysis.model,
    aiUsage: analysis.aiUsage,
  }));
  const drafts = itemDrafts.length > 1 ? itemDrafts : [draftFromAnalysis(analysis)];
  return drafts.map((entry) => ({ ...entry, consumedAt }));
}

function createClientId() {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function templateItemFromDraft(draft: FoodDraft): MealTemplateItem {
  return {
    foodKey: draft.foodKey,
    foodName: draft.foodName,
    quantityValue: draft.quantityValue,
    quantityUnit: draft.quantityUnit,
    caloriesPer100g: draft.caloriesPer100g,
    proteinPer100g: draft.proteinPer100g,
    carbsPer100g: draft.carbsPer100g,
    fatPer100g: draft.fatPer100g,
    source: draft.source ?? "manual",
  };
}

function upsertMealTemplate(templates: MealTemplate[], meal: MealTemplate) {
  const nextTemplates = templates.filter((template) => template.id !== meal.id);
  return [...nextTemplates, meal].sort((left, right) => left.name.localeCompare(right.name, "de"));
}

function buildHistoricalMealTemplates(entries: FoodEntry[], savedTemplates: MealTemplate[]): DisplayMealTemplate[] {
  const savedSignatures = new Set(savedTemplates.map(mealTemplateSignature));
  const groups = new Map<string, FoodEntry[]>();

  for (const entry of entries) {
    if (!entry.mealId || !entry.mealName) continue;
    const groupEntries = groups.get(entry.mealId) ?? [];
    groupEntries.push(entry);
    groups.set(entry.mealId, groupEntries);
  }

  return [...groups.entries()]
    .map(([mealId, groupEntries]) => {
      const sortedGroupEntries = [...groupEntries].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
      const name = sortedGroupEntries.find((entry) => entry.mealName)?.mealName ?? "Mahlzeit";
      const meal: DisplayMealTemplate = {
        id: `history:${mealId}`,
        name,
        createdAt: sortedGroupEntries.reduce((latest, entry) => entry.createdAt > latest ? entry.createdAt : latest, sortedGroupEntries[0]?.createdAt ?? new Date().toISOString()),
        items: sortedGroupEntries.map((entry) => templateItemFromDraft(draftFromEntry(entry))),
        source: "history",
      };
      return meal;
    })
    .filter((meal) => meal.items.length > 0 && !savedSignatures.has(mealTemplateSignature(meal)))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function mealTemplateSignature(meal: Pick<MealTemplate, "name" | "items">) {
  const items = meal.items
    .map((item) => normalizeFoodKey(item.foodName))
    .sort((left, right) => left.localeCompare(right, "de"))
    .join("|");
  return `${normalizeFoodKey(meal.name)}::${items}`;
}

function mealCalories(items: Array<Pick<FoodEntry, "quantityUnit" | "quantityValue" | "caloriesPer100g">>) {
  return items.reduce((sum, item) => sum + caloriesFor(item), 0);
}

function mealTemplateMatchesSearch(meal: MealTemplate, normalizedQuery: string) {
  const searchableText = [
    meal.name,
    ...meal.items.map((item) => item.foodName),
    ...meal.items.map((item) => item.foodKey),
  ].join(" ");
  const normalizedText = normalizeFoodKey(searchableText);
  if (normalizedText.includes(normalizedQuery)) return true;

  const compactText = compactSearchKey(normalizedText);
  const compactQuery = compactSearchKey(normalizedQuery);
  if (compactQuery && compactText.includes(compactQuery)) return true;
  if (compactSearchVariants(compactQuery).some((variant) => compactText.includes(variant))) return true;

  const queryTokens = normalizedQuery.split(" ").filter(Boolean);
  return queryTokens.length > 1 && queryTokens.every((token) => normalizedText.includes(token));
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
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactSearchKey(value: string) {
  return value.replace(/\s+/g, "");
}

function compactSearchVariants(value: string) {
  const variants = new Set([value]);
  for (const suffix of ["en", "er", "es", "e", "n", "s"]) {
    if (value.length > suffix.length + 3 && value.endsWith(suffix)) {
      variants.add(value.slice(0, -suffix.length));
    }
  }
  return [...variants].filter((variant) => variant.length >= 3);
}

function normalizeBarcodeInput(value: unknown) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 14 ? digits : "";
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
    const usageDelta = (right.usageCount ?? 0) - (left.usageCount ?? 0);
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
  const calorieGoalOffset = Number(config?.calorieGoalOffset ?? defaultNutritionConfig.calorieGoalOffset);
  return {
    calorieGoal: Number.isFinite(calorieGoal) && calorieGoal >= minimumCalorieGoal ? calorieGoal : defaultNutritionConfig.calorieGoal,
    calorieGoalOffset: Number.isFinite(calorieGoalOffset) ? Math.min(5000, Math.max(-5000, Math.round(calorieGoalOffset))) : defaultNutritionConfig.calorieGoalOffset,
    goal: isNutritionGoal(config?.goal) ? config.goal : defaultNutritionConfig.goal,
  };
}

function normalizeAiConfig(config: Partial<AiConfig> | undefined): AiConfig {
  const rawProviders = Array.isArray(config?.providers) && config.providers.length > 0
    ? config.providers
    : defaultAiConfig.providers;
  const provider = rawProviders.some((option) => option.id === config?.provider)
    ? String(config?.provider)
    : defaultAiConfig.provider;
  const currentModels = rawProviders.find((option) => option.id === provider)?.models ?? defaultAiConfig.providers[0].models;
  const modelFromConfig = typeof config?.model === "string" && config.model.trim() ? config.model.trim() : "";
  const models = mergeModelsWithCurrent(currentModels, modelFromConfig);
  const model = modelFromConfig || models[0];
  const providers = rawProviders.map((option) =>
    option.id === provider ? { ...option, models } : option,
  );

  return {
    provider,
    model,
    hasApiKey: Boolean(config?.hasApiKey),
    keyHint: String(config?.keyHint ?? ""),
    providers,
  };
}

function mergeModelsWithCurrent(models: string[], currentModel: string) {
  const safeCurrentModel = currentModel.trim();
  return [
    ...(safeCurrentModel ? [safeCurrentModel] : []),
    ...models,
  ].filter((model, index, allModels) => model && allModels.indexOf(model) === index);
}

function normalizeWeeklyEmailConfig(config: Partial<WeeklyEmailConfig> | undefined): WeeklyEmailConfig {
  return {
    targetEmail: String(config?.targetEmail ?? ""),
  };
}

function normalizeWeeklyAiAnalysis(analysis: WeeklyAiAnalysis): WeeklyAiAnalysis {
  const signalLabel = ["gut", "okay", "schlecht"].includes(analysis.signal?.label)
    ? analysis.signal.label
    : "okay";

  return {
    ...analysis,
    weekStart: String(analysis.weekStart ?? selectedFallbackWeekStart()),
    weekEnd: String(analysis.weekEnd ?? selectedFallbackWeekStart()),
    goalLabel: String(analysis.goalLabel ?? "Normal"),
    signal: {
      label: signalLabel as WeeklyAiSignal["label"],
      score: Number(analysis.signal?.score ?? 0),
      message: String(analysis.signal?.message ?? ""),
    },
    aiText: String(analysis.aiText ?? ""),
    provider: String(analysis.provider ?? ""),
    model: String(analysis.model ?? ""),
  };
}

function selectedFallbackWeekStart() {
  return getWeekStart(todayLocal());
}

function normalizeGarminConfig(config: Partial<GarminConfig> | undefined): GarminConfig {
  const autoSyncMinutes = Number(config?.autoSyncMinutes);
  return {
    username: String(config?.username ?? ""),
    hasCredential: Boolean(config?.hasCredential),
    keyHint: String(config?.keyHint ?? ""),
    autoSyncMinutes: [0, 15, 30, 45, 60].includes(autoSyncMinutes) ? autoSyncMinutes : 0,
  };
}

function normalizeGarminDailySummary(summary: Partial<GarminDailySummary>): GarminDailySummary {
  return {
    configured: Boolean(summary.configured),
    date: String(summary.date ?? todayLocal()),
    source: String(summary.source ?? "garmin-connect"),
    totalKilocalories: optionalNumber(summary.totalKilocalories),
    activeKilocalories: optionalNumber(summary.activeKilocalories),
    bmrKilocalories: optionalNumber(summary.bmrKilocalories),
    consumedKilocalories: optionalNumber(summary.consumedKilocalories),
    remainingKilocalories: optionalNumber(summary.remainingKilocalories),
    error: summary.error ? String(summary.error) : undefined,
    fetchedAt: summary.fetchedAt ? String(summary.fetchedAt) : undefined,
  };
}

function normalizeMealTemplate(meal: MealTemplate): MealTemplate {
  return {
    id: String(meal.id),
    name: String(meal.name ?? "Mahlzeit"),
    createdAt: String(meal.createdAt ?? new Date().toISOString()),
    items: Array.isArray(meal.items) ? meal.items.map(normalizeMealTemplateItem).filter(Boolean) : [],
  };
}

function optionalNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function normalizeMealTemplateItem(item: MealTemplateItem): MealTemplateItem {
  return {
    foodKey: item.foodKey ? String(item.foodKey) : undefined,
    foodName: String(item.foodName ?? "Lebensmittel"),
    quantityValue: Number(item.quantityValue ?? 100),
    quantityUnit: item.quantityUnit === "kg" ? "kg" : "g",
    caloriesPer100g: Number(item.caloriesPer100g ?? 0),
    proteinPer100g: Number(item.proteinPer100g ?? 0),
    carbsPer100g: Number(item.carbsPer100g ?? 0),
    fatPer100g: Number(item.fatPer100g ?? 0),
    source: item.source ? String(item.source) : "manual",
  };
}

function normalizeBackendEntry(entry: FoodEntry): FoodEntry {
  return {
    ...entry,
    proteinPer100g: Number(entry.proteinPer100g ?? 0),
    carbsPer100g: Number(entry.carbsPer100g ?? 0),
    fatPer100g: Number(entry.fatPer100g ?? 0),
    mealId: entry.mealId || undefined,
    mealName: entry.mealName || undefined,
    imageDataUrl: entry.imageDataUrl || undefined,
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

function NumberInput({ label, min, step, value, onChange, inputRef }: { label: string; min: number; step: number; value: number; onChange: (value: number) => void; inputRef?: { current: HTMLInputElement | null } }) {
  const internalInputRef = useRef<HTMLInputElement | null>(null);
  const activeInputRef = inputRef ?? internalInputRef;
  const [inputValue, setInputValue] = useState(() => String(value));

  useEffect(() => {
    if (document.activeElement !== activeInputRef.current) {
      setInputValue(String(value));
    }
  }, [activeInputRef, value]);

  function updateDraftValue(rawValue: string) {
    setInputValue(rawValue);
    const numericValue = Number(rawValue);
    if (rawValue.trim() === "" || rawValue === "-" || !Number.isFinite(numericValue)) return;
    onChange(numericValue);
  }

  function normalizeDraftValue() {
    const numericValue = Number(inputValue);
    if (inputValue.trim() === "" || inputValue === "-" || !Number.isFinite(numericValue)) {
      setInputValue(String(value));
      return;
    }
    setInputValue(String(numericValue));
    onChange(numericValue);
  }

  return (
    <label>
      {label}
      <input
        ref={activeInputRef}
        min={min}
        step={step}
        type="number"
        value={inputValue}
        onBlur={normalizeDraftValue}
        onChange={(event) => updateDraftValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}

function getWeekStart(date: string) {
  const dateObject = new Date(`${date}T12:00:00`);
  const day = dateObject.getDay() || 7;
  dateObject.setDate(dateObject.getDate() - day + 1);
  return dateObject.toISOString().slice(0, 10);
}

function buildWeekDates(weekStart: string) {
  return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
}

function addDays(date: string, days: number) {
  const dateObject = new Date(`${date}T12:00:00`);
  dateObject.setDate(dateObject.getDate() + days);
  return dateObject.toISOString().slice(0, 10);
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("de-DE", {
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

function formatWeekdayShort(value: string) {
  return new Intl.DateTimeFormat("de-DE", { weekday: "short" }).format(new Date(`${value}T12:00:00`)).replace(".", "");
}

function formatWeekRange(dates: string[]) {
  const first = dates[0] ?? todayLocal();
  const last = dates[dates.length - 1] ?? first;
  const formatter = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit" });
  return `${formatter.format(new Date(`${first}T12:00:00`))} - ${formatter.format(new Date(`${last}T12:00:00`))}`;
}

function formatQuantity(entry: Pick<FoodEntry, "quantityValue" | "quantityUnit">) {
  return `${entry.quantityValue.toLocaleString("de-DE")} ${entry.quantityUnit}`;
}

function formatMacro(value: number) {
  return (Math.round(value * 10) / 10).toLocaleString("de-DE");
}

function formatOptionalCalories(value: number | undefined) {
  return value === undefined ? "n/a" : `${value.toLocaleString("de-DE")} kcal`;
}

function formatSignedNumber(value: number) {
  const rounded = Math.round(value);
  return `${rounded > 0 ? "+" : ""}${rounded.toLocaleString("de-DE")}`;
}

function confidenceLabel(value: FoodImageAnalysis["confidence"]) {
  if (value === "high") return "hoch";
  if (value === "low") return "niedrig";
  return "mittel";
}

function trafficLightLabel(value: WeeklyAiSignal["label"]) {
  if (value === "gut") return "Gut";
  if (value === "schlecht") return "Schlecht";
  return "Okay";
}

function readImageAsCompressedDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const scale = Math.min(1, 1280 / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const context = canvas.getContext("2d");
        if (!context) {
          reject(new Error("Bild konnte nicht verarbeitet werden."));
          return;
        }
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.78));
      };
      image.onerror = () => reject(new Error("Bild konnte nicht gelesen werden."));
      image.src = String(reader.result ?? "");
    };
    reader.onerror = () => reject(new Error("Bild konnte nicht gelesen werden."));
    reader.readAsDataURL(file);
  });
}

function captureVideoFrame(video: HTMLVideoElement) {
  if (!video.videoWidth || !video.videoHeight) return "";
  const scale = Math.min(1, 960 / Math.max(video.videoWidth, video.videoHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
  canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) return "";
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.72);
}

export default App;
