import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { formatGarminWeightImportStatus } from "../src/garmin-weight-status.ts";

test("shows the Garmin value when a protected manual value conflicts", () => {
  assert.equal(
    formatGarminWeightImportStatus({
      received: 1,
      imported: 0,
      skippedManual: 1,
      conflicts: [
        { date: "2026-07-25", garminWeightKg: 114.3, manualWeightKg: 125 },
      ],
    }, "2026-07-25"),
    "Garmin meldet am 25.07. 114,3 kg · manueller Wert 125,0 kg bleibt aktiv.",
  );
});

test("keeps the normal import summary when no conflict exists", () => {
  assert.equal(
    formatGarminWeightImportStatus({
      received: 3,
      imported: 3,
      skippedManual: 0,
      conflicts: [],
    }, "2026-07-25"),
    "3 Garmin-Tage importiert.",
  );
});

test("keeps the empty Garmin response understandable", () => {
  assert.equal(
    formatGarminWeightImportStatus({
      received: 0,
      imported: 0,
      skippedManual: 0,
      conflicts: [],
    }, "2026-07-25"),
    "Garmin hat im gewählten Zeitraum keine Gewichtswerte geliefert.",
  );
});

test("the prominent Garmin refresh imports weight and renders its status", async () => {
  const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");

  assert.match(appSource, /importGarminWeights\(selectedDate, selectedDate\)/);
  assert.match(appSource, /goal-card__garmin-status/);
  assert.match(appSource, /formatGarminWeightImportStatus\(weightResult, selectedDate\)/);
  assert.match(appSource, /adoptGarminWeight\(garminWeightConflict\)/);
  assert.match(appSource, /kg von Garmin übernehmen/);
  assert.match(appSource, /importGarminWeights\(conflict\.date, conflict\.date, true\)/);
});
