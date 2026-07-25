export type GarminWeightConflict = {
  date: string;
  garminWeightKg: number;
  manualWeightKg: number;
};

type GarminWeightImportStatus = {
  received: number;
  imported: number;
  skippedManual: number;
  conflicts?: GarminWeightConflict[];
};

export function formatGarminWeightImportStatus(result: GarminWeightImportStatus, focusDate: string): string {
  const conflicts = Array.isArray(result.conflicts) ? result.conflicts : [];
  const conflict = conflicts.find((item) => item.date === focusDate) ?? conflicts.at(-1);

  if (conflict) {
    const additionalConflicts = Math.max(0, conflicts.length - 1);
    const additionalText = additionalConflicts > 0
      ? ` · ${additionalConflicts} ${additionalConflicts === 1 ? "weiterer Konflikt" : "weitere Konflikte"}`
      : "";
    return [
      `Garmin meldet am ${formatCompactDate(conflict.date)} ${formatWeight(conflict.garminWeightKg)} kg`,
      `manueller Wert ${formatWeight(conflict.manualWeightKg)} kg bleibt aktiv${additionalText}.`,
    ].join(" · ");
  }

  if (result.received === 0) {
    return "Garmin hat im gewählten Zeitraum keine Gewichtswerte geliefert.";
  }

  return `${result.imported} Garmin-Tage importiert${result.skippedManual > 0 ? ` · ${result.skippedManual} manuelle Werte beibehalten` : ""}.`;
}

function formatCompactDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  return match ? `${match[3]}.${match[2]}.` : date;
}

function formatWeight(weightKg: number): string {
  return weightKg.toLocaleString("de-DE", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}
