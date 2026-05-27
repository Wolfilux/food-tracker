import { FormEvent, ReactNode, useMemo, useState } from "react";
import { Clock3, Flame, Plus, Scale, ShieldCheck, Target, Trash2, Utensils } from "lucide-react";

type Unit = "g" | "kg";

type FoodEntry = {
  id: string;
  foodName: string;
  quantityValue: number;
  quantityUnit: Unit;
  caloriesPer100g: number;
  consumedAt: string;
  createdAt: string;
};

type FoodDraft = Omit<FoodEntry, "id" | "createdAt">;

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
    consumedAt: nowLocal(),
    createdAt: new Date().toISOString(),
  },
  {
    id: "seed-2",
    foodName: "Banane",
    quantityValue: 120,
    quantityUnit: "g",
    caloriesPer100g: 89,
    consumedAt: nowLocal(),
    createdAt: new Date().toISOString(),
  },
];

function gramsFor(entry: Pick<FoodEntry, "quantityUnit" | "quantityValue">) {
  return entry.quantityUnit === "kg" ? entry.quantityValue * 1000 : entry.quantityValue;
}

function caloriesFor(entry: Pick<FoodEntry, "quantityUnit" | "quantityValue" | "caloriesPer100g">) {
  return Math.round((gramsFor(entry) / 100) * entry.caloriesPer100g);
}

function loadEntries(): FoodEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return initialEntries;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : initialEntries;
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
    consumedAt: nowLocal(),
  });

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
        }),
        { calories: 0, grams: 0 },
      ),
    [entries],
  );

  const progress = Math.min(100, Math.round((totals.calories / dailyGoal) * 100));
  const draftCalories = caloriesFor(draft);

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

  function deleteEntry(id: string) {
    persist(entries.filter((entry) => entry.id !== id));
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
            Time-based calorie tracking with local browser storage and simple per-100g math.
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
        <Metric icon={<Utensils />} label="Entries" value={entries.length} suffix="today" />
        <Metric icon={<Clock3 />} label="Latest" value={latestHour(sortedEntries)} suffix="" />
      </section>

      <section className="workspace-grid">
        <form className="entry-form" onSubmit={addEntry}>
          <h2>Add entry</h2>
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
          <div className="calculation-strip">
            <span>Calculated entry</span>
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

function latestHour(entries: FoodEntry[]) {
  if (!entries.length) return "--:--";
  return new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" }).format(new Date(entries[0].consumedAt));
}

export default App;
