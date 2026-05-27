import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import {
  Database,
  Flame,
  Loader2,
  Plus,
  Scale,
  Search,
  ShieldCheck,
  Target,
  Trash2,
  Utensils,
  Wheat,
} from "lucide-react";

type Unit = "g" | "kg";

type FoodEntry = {
  id: string;
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
};

type FoodDraft = Omit<FoodEntry, "id" | "createdAt">;

type OpenFoodFactsProduct = {
  code?: string;
  product_name?: string;
  generic_name?: string;
  brands?: string;
  image_front_small_url?: string;
  nutriments?: {
    "energy-kcal_100g"?: number;
    proteins_100g?: number;
    carbohydrates_100g?: number;
    fat_100g?: number;
  };
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
};

const STORAGE_KEY = "food-tracker.entries.v2";
const dailyGoal = 2200;

const nowLocal = () => new Date().toISOString().slice(0, 16);

const initialEntries: FoodEntry[] = [
  {
    id: "seed-1",
    foodName: "Skyr natur",
    quantityValue: 250,
    quantityUnit: "g",
    caloriesPer100g: 62,
    proteinPer100g: 11,
    carbsPer100g: 4,
    fatPer100g: 0.2,
    consumedAt: nowLocal(),
    createdAt: new Date().toISOString(),
    source: "manual",
  },
  {
    id: "seed-2",
    foodName: "Banane",
    quantityValue: 120,
    quantityUnit: "g",
    caloriesPer100g: 89,
    proteinPer100g: 1.1,
    carbsPer100g: 23,
    fatPer100g: 0.3,
    consumedAt: nowLocal(),
    createdAt: new Date().toISOString(),
    source: "manual",
  },
];

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

function normalizeEntry(entry: FoodEntry): FoodEntry {
  return {
    ...entry,
    proteinPer100g: Number(entry.proteinPer100g ?? 0),
    carbsPer100g: Number(entry.carbsPer100g ?? 0),
    fatPer100g: Number(entry.fatPer100g ?? 0),
  };
}

function loadEntries(): FoodEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return initialEntries;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(normalizeEntry) : initialEntries;
  } catch {
    return initialEntries;
  }
}

function App() {
  const [entries, setEntries] = useState<FoodEntry[]>(loadEntries);
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
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FoodSearchResult[]>([]);
  const [searchState, setSearchState] = useState<"idle" | "loading" | "done" | "error">("idle");

  const sortedEntries = useMemo(
    () => [...entries].sort((left, right) => right.consumedAt.localeCompare(left.consumedAt)),
    [entries],
  );

  const totals = useMemo(
    () =>
      entries.reduce(
        (sum, entry) => ({
          calories: sum.calories + caloriesFor(entry),
          grams: sum.grams + gramsFor(entry),
          protein: sum.protein + macroFor(entry, entry.proteinPer100g),
          carbs: sum.carbs + macroFor(entry, entry.carbsPer100g),
          fat: sum.fat + macroFor(entry, entry.fatPer100g),
        }),
        { calories: 0, grams: 0, protein: 0, carbs: 0, fat: 0 },
      ),
    [entries],
  );

  const progress = Math.min(100, Math.round((totals.calories / dailyGoal) * 100));
  const draftCalories = caloriesFor(draft);

  const searchFoods = useCallback(async (searchTerm = query.trim(), signal?: AbortSignal) => {
    const trimmedQuery = searchTerm.trim();
    if (!trimmedQuery) return;

    setSearchState("loading");
    setResults([]);

    const params = new URLSearchParams({
      search_terms: trimmedQuery,
      search_simple: "1",
      action: "process",
      json: "1",
      page_size: "8",
      fields: "code,product_name,generic_name,brands,image_front_small_url,nutriments",
    });

    try {
      const response = await fetch(`https://world.openfoodfacts.org/cgi/search.pl?${params.toString()}`, { signal });
      if (!response.ok) throw new Error("Open Food Facts request failed");
      const data = (await response.json()) as { products?: OpenFoodFactsProduct[] };
      const nextResults = (data.products ?? [])
        .map(toFoodResult)
        .filter((result): result is FoodSearchResult => Boolean(result));
      setResults(nextResults);
      setSearchState("done");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setSearchState("error");
    }
  }, [query]);

  useEffect(() => {
    const trimmedQuery = query.trim();
    if (trimmedQuery.length < 2) return;

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      void searchFoods(trimmedQuery, controller.signal);
    }, 350);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [query, searchFoods]);

  function persist(nextEntries: FoodEntry[]) {
    setEntries(nextEntries);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextEntries));
  }

  function addEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const foodName = draft.foodName.trim();
    if (!foodName || draft.quantityValue <= 0 || draft.caloriesPer100g < 0 || !draft.consumedAt) return;

    persist([
      {
        ...draft,
        id: crypto.randomUUID(),
        foodName,
        createdAt: new Date().toISOString(),
      },
      ...entries,
    ]);
    setDraft({ ...draft, foodName: "", consumedAt: nowLocal() });
  }

  function selectFood(result: FoodSearchResult) {
    setDraft({
      ...draft,
      foodName: result.brand ? `${result.name} · ${result.brand}` : result.name,
      caloriesPer100g: result.caloriesPer100g,
      proteinPer100g: result.proteinPer100g,
      carbsPer100g: result.carbsPer100g,
      fatPer100g: result.fatPer100g,
      source: "Open Food Facts",
    });
  }

  function deleteEntry(id: string) {
    persist(entries.filter((entry) => entry.id !== id));
  }

  function updateQuery(value: string) {
    setQuery(value);
    if (value.trim().length < 2) {
      setResults([]);
      setSearchState("idle");
    }
  }

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <div className="hero-copy">
          <p className="eyebrow">
            <ShieldCheck size={16} aria-hidden="true" />
            local-first calorie log
          </p>
          <h1>Food Tracker</h1>
          <p className="intro">
            Time-based calorie tracking with Open Food Facts lookup, local browser storage, and manual fallback.
          </p>
        </div>
        <div className="goal-card" aria-label="Daily calorie progress">
          <div className="goal-card__top">
            <Target size={22} aria-hidden="true" />
            <span>Daily target</span>
          </div>
          <strong>{totals.calories.toLocaleString()} kcal</strong>
          <div className="progress-track">
            <span style={{ width: `${progress}%` }} />
          </div>
          <small>{progress}% of {dailyGoal.toLocaleString()} kcal</small>
        </div>
      </section>

      <section className="metric-grid" aria-label="Daily totals">
        <Metric icon={<Flame />} label="Calories" value={totals.calories} suffix="kcal" />
        <Metric icon={<Scale />} label="Food weight" value={Math.round(totals.grams)} suffix="g" />
        <Metric icon={<Wheat />} label="Protein" value={Math.round(totals.protein)} suffix="g" />
        <Metric icon={<Utensils />} label="Carbs / fat" value={`${Math.round(totals.carbs)} / ${Math.round(totals.fat)}`} suffix="g" />
      </section>

      <section className="workspace-grid">
        <form className="entry-form" onSubmit={addEntry}>
          <h2>Add entry</h2>
          <div className="search-panel">
            <div className="search-panel__heading">
              <Database size={18} aria-hidden="true" />
              <span>Open Food Facts</span>
            </div>
            <div className="food-search">
              <label>
                Search food database
                <div className="search-input">
                  <input
                    value={query}
                    onChange={(event) => updateQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void searchFoods();
                      }
                    }}
                    placeholder="Type to search, e.g. Skyr"
                  />
                  <button type="button" aria-label="Search food database" onClick={() => void searchFoods()}>
                    {searchState === "loading" ? <Loader2 className="spin" size={18} aria-hidden="true" /> : <Search size={18} aria-hidden="true" />}
                  </button>
                </div>
              </label>
            </div>
            <div className="result-list" aria-live="polite">
              {searchState === "error" && <p className="search-note">Database currently unavailable. Manual entry still works.</p>}
              {searchState === "done" && results.length === 0 && <p className="search-note">No usable nutrition values found.</p>}
              {results.map((result) => (
                <button className="result-item" type="button" key={result.id} onClick={() => selectFood(result)}>
                  {result.imageUrl ? <img src={result.imageUrl} alt="" /> : <span className="result-placeholder"><Utensils size={18} aria-hidden="true" /></span>}
                  <span>
                    <strong>{result.name}</strong>
                    <small>{result.brand || "Open Food Facts"} · {result.caloriesPer100g} kcal / 100g</small>
                  </span>
                </button>
              ))}
            </div>
          </div>
          <label>
            Food
            <input value={draft.foodName} onChange={(event) => setDraft({ ...draft, foodName: event.target.value })} placeholder="e.g. Skyr natur" />
          </label>
          <label>
            Time
            <input type="datetime-local" value={draft.consumedAt} onChange={(event) => setDraft({ ...draft, consumedAt: event.target.value })} />
          </label>
          <div className="quantity-grid">
            <NumberInput label="Quantity" min={0.001} step={0.001} value={draft.quantityValue} onChange={(quantityValue) => setDraft({ ...draft, quantityValue })} />
            <label>
              Unit
              <select value={draft.quantityUnit} onChange={(event) => setDraft({ ...draft, quantityUnit: event.target.value as Unit })}>
                <option value="g">g</option>
                <option value="kg">kg</option>
              </select>
            </label>
          </div>
          <NumberInput label="Calories per 100g" min={0} step={1} value={draft.caloriesPer100g} onChange={(caloriesPer100g) => setDraft({ ...draft, caloriesPer100g })} />
          <div className="macro-grid">
            <NumberInput label="Protein / 100g" min={0} step={0.1} value={draft.proteinPer100g} onChange={(proteinPer100g) => setDraft({ ...draft, proteinPer100g })} />
            <NumberInput label="Carbs / 100g" min={0} step={0.1} value={draft.carbsPer100g} onChange={(carbsPer100g) => setDraft({ ...draft, carbsPer100g })} />
            <NumberInput label="Fat / 100g" min={0} step={0.1} value={draft.fatPer100g} onChange={(fatPer100g) => setDraft({ ...draft, fatPer100g })} />
          </div>
          <div className="calculation-strip">
            <span>{draft.source === "Open Food Facts" ? "Database values" : "Calculated entry"}</span>
            <strong>{draftCalories.toLocaleString()} kcal</strong>
          </div>
          <button className="primary-button" type="submit">
            <Plus size={18} aria-hidden="true" />
            Add entry
          </button>
        </form>

        <section className="entry-list" aria-label="Food entries">
          <div className="section-heading">
            <h2>Today</h2>
            <span>{entries.length} entries</span>
          </div>
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
      </section>
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

function toFoodResult(product: OpenFoodFactsProduct): FoodSearchResult | null {
  const nutriments = product.nutriments ?? {};
  const name = (product.product_name || product.generic_name || "").trim();
  const calories = Math.round(Number(nutriments["energy-kcal_100g"] ?? 0));

  if (!name || calories <= 0) return null;

  return {
    id: product.code || `${name}-${product.brands || "unknown"}`,
    name,
    brand: product.brands?.split(",")[0]?.trim() ?? "",
    caloriesPer100g: calories,
    proteinPer100g: roundMacro(nutriments.proteins_100g),
    carbsPer100g: roundMacro(nutriments.carbohydrates_100g),
    fatPer100g: roundMacro(nutriments.fat_100g),
    imageUrl: product.image_front_small_url,
  };
}

function roundMacro(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.round(parsed * 10) / 10 : 0;
}

function NumberInput({ label, min, step, value, onChange }: { label: string; min: number; step: number; value: number; onChange: (value: number) => void }) {
  return (
    <label>
      {label}
      <input min={min} step={step} type="number" value={value} onChange={(event) => onChange(Number(event.target.value))} />
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

function formatQuantity(entry: FoodEntry) {
  return `${entry.quantityValue.toLocaleString("de-DE")} ${entry.quantityUnit}`;
}

function formatMacro(value: number) {
  return (Math.round(value * 10) / 10).toLocaleString("de-DE");
}

export default App;
