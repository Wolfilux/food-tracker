import { FormEvent, ReactNode, useMemo, useState } from "react";
import { Apple, CalendarDays, Flame, Plus, ShieldCheck, Target, Trash2, Utensils } from "lucide-react";

type MealEntry = {
  id: string;
  name: string;
  category: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  createdAt: string;
};

type MealDraft = Omit<MealEntry, "id" | "createdAt">;

const STORAGE_KEY = "food-tracker.entries.v1";

const initialEntries: MealEntry[] = [
  {
    id: "seed-1",
    name: "Greek yogurt, berries",
    category: "Breakfast",
    calories: 260,
    protein: 24,
    carbs: 28,
    fat: 5,
    createdAt: new Date().toISOString(),
  },
  {
    id: "seed-2",
    name: "Chicken rice bowl",
    category: "Lunch",
    calories: 520,
    protein: 42,
    carbs: 58,
    fat: 14,
    createdAt: new Date().toISOString(),
  },
];

function loadEntries(): MealEntry[] {
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
  const [entries, setEntries] = useState<MealEntry[]>(loadEntries);
  const [draft, setDraft] = useState<MealDraft>({
    name: "",
    category: "Snack",
    calories: 180,
    protein: 12,
    carbs: 20,
    fat: 6,
  });

  const totals = useMemo(
    () =>
      entries.reduce(
        (sum, entry) => ({
          calories: sum.calories + entry.calories,
          protein: sum.protein + entry.protein,
          carbs: sum.carbs + entry.carbs,
          fat: sum.fat + entry.fat,
        }),
        { calories: 0, protein: 0, carbs: 0, fat: 0 },
      ),
    [entries],
  );

  const calorieGoal = 2200;
  const progress = Math.min(100, Math.round((totals.calories / calorieGoal) * 100));

  function persist(nextEntries: MealEntry[]) {
    setEntries(nextEntries);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextEntries));
  }

  function addMeal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.name.trim()) return;

    persist([
      {
        ...draft,
        id: crypto.randomUUID(),
        name: draft.name.trim(),
        createdAt: new Date().toISOString(),
      },
      ...entries,
    ]);
    setDraft({ ...draft, name: "" });
  }

  function deleteMeal(id: string) {
    persist(entries.filter((entry) => entry.id !== id));
  }

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <div className="hero-copy">
          <p className="eyebrow">
            <ShieldCheck size={16} aria-hidden="true" />
            local-first nutrition log
          </p>
          <h1>Food Tracker</h1>
          <p className="intro">
            A clean starting point for tracking meals, calories, and macros without sending private nutrition data anywhere.
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
          <small>{progress}% of {calorieGoal.toLocaleString()} kcal</small>
        </div>
      </section>

      <section className="metric-grid" aria-label="Nutrition totals">
        <Metric icon={<Flame />} label="Calories" value={totals.calories} suffix="kcal" />
        <Metric icon={<Apple />} label="Protein" value={totals.protein} suffix="g" />
        <Metric icon={<Utensils />} label="Carbs" value={totals.carbs} suffix="g" />
        <Metric icon={<CalendarDays />} label="Fat" value={totals.fat} suffix="g" />
      </section>

      <section className="workspace-grid">
        <form className="entry-form" onSubmit={addMeal}>
          <h2>Add meal</h2>
          <label>
            Food
            <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="e.g. Oat bowl" />
          </label>
          <label>
            Category
            <select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })}>
              <option>Breakfast</option>
              <option>Lunch</option>
              <option>Dinner</option>
              <option>Snack</option>
            </select>
          </label>
          <div className="number-grid">
            <NumberInput label="Calories" value={draft.calories} onChange={(calories) => setDraft({ ...draft, calories })} />
            <NumberInput label="Protein" value={draft.protein} onChange={(protein) => setDraft({ ...draft, protein })} />
            <NumberInput label="Carbs" value={draft.carbs} onChange={(carbs) => setDraft({ ...draft, carbs })} />
            <NumberInput label="Fat" value={draft.fat} onChange={(fat) => setDraft({ ...draft, fat })} />
          </div>
          <button className="primary-button" type="submit">
            <Plus size={18} aria-hidden="true" />
            Add entry
          </button>
        </form>

        <section className="entry-list" aria-label="Meal entries">
          <div className="section-heading">
            <h2>Today</h2>
            <span>{entries.length} entries</span>
          </div>
          {entries.map((entry) => (
            <article className="meal-row" key={entry.id}>
              <div>
                <span className="meal-tag">{entry.category}</span>
                <h3>{entry.name}</h3>
                <p>{entry.protein}g protein / {entry.carbs}g carbs / {entry.fat}g fat</p>
              </div>
              <div className="meal-actions">
                <strong>{entry.calories} kcal</strong>
                <button type="button" aria-label={`Delete ${entry.name}`} onClick={() => deleteMeal(entry.id)}>
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

function Metric({ icon, label, value, suffix }: { icon: ReactNode; label: string; value: number; suffix: string }) {
  return (
    <article className="metric-card">
      <span className="metric-icon" aria-hidden="true">{icon}</span>
      <p>{label}</p>
      <strong>{value.toLocaleString()} <small>{suffix}</small></strong>
    </article>
  );
}

function NumberInput({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label>
      {label}
      <input min="0" type="number" value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

export default App;
