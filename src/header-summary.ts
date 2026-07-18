export const headerCalorieLabels = ["Basis", "Aktiv", "Defizit", "Gesamt"] as const;

export type HeaderCalorieMetric = {
  label: (typeof headerCalorieLabels)[number];
  value: number;
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
