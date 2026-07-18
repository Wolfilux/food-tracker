export const headerCalorieLabels = ["Basis", "Aktiv", "Defizit", "Gesamt"] as const;

export type HeaderCalorieMetric = {
  label: (typeof headerCalorieLabels)[number];
  value: number;
};

export type HeaderCalorieProgress = {
  consumedCalories: number;
  goalCalories: number;
  remainingCalories: number;
  progressPercent: number;
  isOverGoal: boolean;
};

export function buildHeaderCalorieMetrics({
  baseCalories,
  activeCalories,
  deficitCalories,
  totalCalories,
}: {
  baseCalories: number;
  activeCalories: number;
  deficitCalories: number;
  totalCalories: number;
}): HeaderCalorieMetric[] {
  return [
    { label: "Basis", value: Math.round(baseCalories) },
    { label: "Aktiv", value: Math.round(activeCalories) },
    { label: "Defizit", value: Math.round(deficitCalories) },
    { label: "Gesamt", value: Math.round(totalCalories) },
  ];
}

export function formatHeaderDate(value: string) {
  return new Intl.DateTimeFormat("de-DE", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00`));
}

export function formatHeaderCalorieValue(metric: HeaderCalorieMetric) {
  const prefix = metric.label === "Aktiv" && metric.value > 0 ? "+" : "";
  return `${prefix}${metric.value.toLocaleString("de-DE")} kcal`;
}

export function buildHeaderCalorieProgress(consumedCalories: number, goalCalories: number): HeaderCalorieProgress {
  const consumed = Math.round(consumedCalories);
  const goal = Math.round(goalCalories);
  const remaining = goal - consumed;
  const progressPercent = goal > 0
    ? Math.max(0, Math.min(100, Math.round((consumed / goal) * 100)))
    : 0;

  return {
    consumedCalories: consumed,
    goalCalories: goal,
    remainingCalories: remaining,
    progressPercent,
    isOverGoal: remaining < 0,
  };
}
