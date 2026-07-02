import assert from "node:assert/strict";
import {
  calculateActivityAdjustment,
  calculateAdaptiveMaintenance,
  calculateBmr,
  calculateConfidenceScore,
  calculateDailyGoal,
  calculateInitialTdee,
  calculateTargetDeficit,
  calculateWeeklyFeedback,
  calculateWorkoutCredit,
  normalizeAdaptiveGoalProfile,
  rollingWeightAverage,
} from "../server/adaptive-goals.js";

const profile = normalizeAdaptiveGoalProfile({
  enabled: true,
  age: 40,
  sex: "male",
  heightCm: 180,
  currentWeightKg: 90,
  targetWeightKg: 82,
  weeklyLossKg: 0.5,
  activityLevel: "light",
  garminEnabled: true,
});

assert.equal(calculateBmr(profile), 1830);
assert.equal(calculateInitialTdee(profile), 2516);
assert.equal(calculateTargetDeficit(profile), 550);

const strengthCredit = calculateWorkoutCredit({ activityType: "strength_training", calories: 400 });
assert.equal(strengthCredit, 160);
assert.ok(strengthCredit < 400);
assert.equal(calculateWorkoutCredit({ activityType: "running", calories: 500 }), 350);
assert.equal(calculateWorkoutCredit({ activityType: "cycling", calories: 500 }), 350);
assert.equal(calculateWorkoutCredit({ activityType: "walking", calories: 500 }), 400);

const garminTotal = calculateActivityAdjustment({
  summary: { totalKilocalories: 3100, bmrKilocalories: 1900, activeKilocalories: 900, steps: 12000 },
  activities: [{ activityType: "running", calories: 700 }],
});
assert.equal(garminTotal.strategy, "garmin-total-activity");
assert.equal(garminTotal.cappedBonus, 700);
assert.equal(garminTotal.stepBonus, 0);
assert.equal(garminTotal.workoutBonus, 0);

const ownBonus = calculateActivityAdjustment({
  summary: { steps: 9500 },
  activities: [
    { activityType: "walking", calories: 200 },
    { activityType: "strength_training", calories: 400 },
  ],
});
assert.equal(ownBonus.strategy, "steps-plus-workouts");
assert.ok(ownBonus.cappedBonus <= 650);
assert.ok(ownBonus.stepBonus >= 100 && ownBonus.stepBonus <= 200);

const dailyCalories = Array.from({ length: 21 }, (_, index) => ({
  date: addDays("2026-06-01", index),
  calories: 2500,
  entryCount: 3,
}));
const weightLogs = Array.from({ length: 22 }, (_, index) => ({
  date: addDays("2026-06-01", index),
  weightKg: 90 - (index / 21) * 1.5,
}));
const adaptive = calculateAdaptiveMaintenance(dailyCalories, weightLogs, "2026-06-22");
assert.equal(adaptive.available, true);
assert.ok(adaptive.adaptiveMaintenance >= 2850 && adaptive.adaptiveMaintenance <= 2950);
assert.equal(adaptive.completeDayCount, 21);
assert.equal(adaptive.weightLogCount, 22);
assert.equal(rollingWeightAverage(weightLogs, "2026-06-22")?.sampleCount, 7);

const dailyGoal = calculateDailyGoal({
  profile,
  adaptiveMaintenance: adaptive.adaptiveMaintenance,
  summary: { activeKilocalories: 300 },
});
assert.ok(dailyGoal.finalGoal >= dailyGoal.minimumCalorieGoal);
assert.equal(dailyGoal.targetDeficit, 550);
assert.equal(dailyGoal.breakdown.bmr, 1830);
assert.equal(dailyGoal.safety.wasAdjusted, false);

const aggressiveProfile = normalizeAdaptiveGoalProfile({
  ...profile,
  weeklyLossKg: 1.5,
  enforceSexMinimumCalories: true,
});
const guardedGoal = calculateDailyGoal({ profile: aggressiveProfile, adaptiveMaintenance: 2100 });
assert.equal(guardedGoal.safety.wasAdjusted, true);
assert.equal(guardedGoal.minimumCalorieGoal, 1800);
assert.ok(guardedGoal.safety.notice.includes("automatisch angepasst"));

const confidence = calculateConfidenceScore({ profile, dailyCalories, weightLogs, adaptiveResult: adaptive });
assert.equal(confidence.score, 100);
assert.ok(confidence.basis.includes("Garmin verbunden"));

const feedbackSlow = calculateWeeklyFeedback(profile, adaptive);
assert.equal(feedbackSlow.status, "too-slow");
assert.equal(feedbackSlow.adjustmentCalories, -150);

const insufficient = calculateAdaptiveMaintenance(dailyCalories.slice(0, 10), weightLogs, "2026-06-10");
assert.equal(insufficient.available, false);
assert.equal(calculateWeeklyFeedback(profile, insufficient).status, "insufficient-data");

const incompleteFood = calculateAdaptiveMaintenance(dailyCalories.map((day) => ({ ...day, entryCount: 1 })), weightLogs, "2026-06-22");
assert.equal(incompleteFood.available, false);
assert.equal(incompleteFood.completeDayCount, 0);

const missingWeights = calculateAdaptiveMaintenance(dailyCalories, weightLogs.slice(0, 9), "2026-06-22");
assert.equal(missingWeights.available, false);
assert.equal(missingWeights.requiredWeightLogCount, 10);

function addDays(date, days) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
