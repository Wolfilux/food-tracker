export const adaptiveMinimumCalorieGoal = 1200;
export const kcalPerKgBodyWeight = 7700;

export const defaultAdaptiveGoalProfile = {
  enabled: false,
  age: 35,
  sex: "male",
  heightCm: 180,
  currentWeightKg: 90,
  targetWeightKg: 82,
  weeklyLossKg: 0.5,
  activityLevel: "light",
  garminEnabled: false,
  trainingTypes: [],
  manualOverrideCalories: 0,
  maxDeficitPercent: 30,
  useBodyWeightDeficitLimit: false,
  enforceSexMinimumCalories: false,
  workoutCreditFactors: {
    strength: 0.4,
    running: 0.7,
    cycling: 0.7,
    walking: 0.8,
    default: 0.35,
  },
};

const activityFactors = new Map([
  ["sedentary", 1.2],
  ["light", 1.375],
  ["moderate", 1.55],
  ["active", 1.725],
  ["very-active", 1.9],
]);

const workoutCreditRanges = [
  { key: "walking", match: /walk|hike|gehen|wandern/i },
  { key: "running", match: /run|lauf/i },
  { key: "cycling", match: /bike|cycling|rad|ride/i },
  { key: "strength", match: /strength|kraft|weight|weights|crossfit|training/i },
];

export function normalizeAdaptiveGoalProfile(input = {}, fallback = defaultAdaptiveGoalProfile) {
  const sex = ["male", "female", "other"].includes(input.sex) ? input.sex : fallback.sex;
  const activityLevel = activityFactors.has(input.activityLevel) ? input.activityLevel : fallback.activityLevel;
  const trainingTypes = Array.isArray(input.trainingTypes)
    ? input.trainingTypes.map((value) => String(value).trim()).filter(Boolean).slice(0, 12)
    : fallback.trainingTypes;

  return {
    enabled: Boolean(input.enabled),
    age: clampInteger(input.age, 13, 100, fallback.age),
    sex,
    heightCm: clampNumber(input.heightCm, 120, 230, fallback.heightCm),
    currentWeightKg: clampNumber(input.currentWeightKg, 35, 250, fallback.currentWeightKg),
    targetWeightKg: clampNumber(input.targetWeightKg, 35, 250, fallback.targetWeightKg),
    weeklyLossKg: clampNumber(input.weeklyLossKg, 0.1, 1.5, fallback.weeklyLossKg),
    activityLevel,
    garminEnabled: Boolean(input.garminEnabled),
    trainingTypes,
    manualOverrideCalories: clampInteger(input.manualOverrideCalories, 0, 10000, fallback.manualOverrideCalories),
    maxDeficitPercent: clampNumber(input.maxDeficitPercent, 5, 50, fallback.maxDeficitPercent ?? defaultAdaptiveGoalProfile.maxDeficitPercent),
    useBodyWeightDeficitLimit: Boolean(input.useBodyWeightDeficitLimit),
    enforceSexMinimumCalories: Boolean(input.enforceSexMinimumCalories),
    workoutCreditFactors: normalizeWorkoutCreditFactors(input.workoutCreditFactors, fallback.workoutCreditFactors),
  };
}

export function calculateBmr(profile) {
  const sexOffset = profile.sex === "female" ? -161 : profile.sex === "male" ? 5 : -78;
  return Math.round(10 * profile.currentWeightKg + 6.25 * profile.heightCm - 5 * profile.age + sexOffset);
}

export function calculateInitialTdee(profile) {
  return Math.round(calculateBmr(profile) * (activityFactors.get(profile.activityLevel) ?? 1.375));
}

export function calculateTargetDeficit(profile) {
  return Math.round((profile.weeklyLossKg * kcalPerKgBodyWeight) / 7);
}

export function calculateActivityAdjustment({ summary, activities = [], workoutCreditFactors } = {}) {
  const totalCalories = finiteNumber(summary?.totalKilocalories);
  const bmrCalories = finiteNumber(summary?.bmrKilocalories);
  const activeCalories = finiteNumber(summary?.activeKilocalories);
  const steps = finiteNumber(summary?.steps) ?? finiteNumber(summary?.totalSteps) ?? 0;
  const workoutBonus = activities.reduce((sum, activity) => sum + calculateWorkoutCredit(activity, workoutCreditFactors), 0);
  const stepBonus = calculateStepBonus(steps);
  const cappedOwnCalculation = Math.min(650, Math.round(stepBonus + workoutBonus));

  if (totalCalories !== undefined && bmrCalories !== undefined) {
    return {
      strategy: "garmin-total-activity",
      steps,
      stepBonus: 0,
      workoutBonus: 0,
      rawBonus: Math.max(0, totalCalories - bmrCalories),
      cappedBonus: Math.min(700, Math.max(0, totalCalories - bmrCalories)),
      cap: 700,
      note: "Garmin-Gesamtaktivitaet genutzt; Schritte und Workouts werden nur angezeigt, nicht addiert.",
    };
  }

  if (activeCalories !== undefined) {
    return {
      strategy: "garmin-active-calories",
      steps,
      stepBonus: 0,
      workoutBonus: 0,
      rawBonus: Math.max(0, activeCalories),
      cappedBonus: Math.min(650, Math.max(0, activeCalories)),
      cap: 650,
      note: "Garmin aktive Kalorien genutzt; eigene Schritt- und Trainingsboni nicht addiert.",
    };
  }

  return {
    strategy: "steps-plus-workouts",
    steps,
    stepBonus,
    workoutBonus,
    rawBonus: Math.round(stepBonus + workoutBonus),
    cappedBonus: cappedOwnCalculation,
    cap: 650,
    note: "Eigene vorsichtige Berechnung aus Schritten plus anteiligen Trainingskalorien.",
  };
}

export function calculateDailyGoal({ profile, adaptiveMaintenance, summary, activities = [] }) {
  const bmr = calculateBmr(profile);
  const initialTdee = calculateInitialTdee(profile);
  const maintenance = Math.round(adaptiveMaintenance ?? initialTdee);
  const requestedDeficit = calculateTargetDeficit(profile);
  const safety = calculateSafetyLimits(profile, bmr, maintenance, requestedDeficit);
  const targetDeficit = safety.deficit;
  const activity = profile.garminEnabled
    ? calculateActivityAdjustment({ summary, activities, workoutCreditFactors: profile.workoutCreditFactors })
    : calculateActivityAdjustment({ activities: [], workoutCreditFactors: profile.workoutCreditFactors });
  const basisTarget = Math.max(safety.minimumGoal, maintenance - targetDeficit);
  const recommendedToday = Math.max(safety.minimumGoal, Math.round(basisTarget + activity.cappedBonus));
  const finalGoal = profile.manualOverrideCalories > 0 ? profile.manualOverrideCalories : recommendedToday;

  return {
    bmr,
    initialTdee,
    adaptiveMaintenance: maintenance,
    maintenance,
    activityCalories: Math.max(0, maintenance - bmr),
    activityFactor: activityFactors.get(profile.activityLevel) ?? 1.375,
    requestedDeficit,
    targetDeficit,
    targetLossKgPerWeek: profile.weeklyLossKg,
    basisTarget,
    activityAdjustment: activity.cappedBonus,
    recommendedToday,
    finalGoal,
    hasManualOverride: profile.manualOverrideCalories > 0,
    minimumCalorieGoal: safety.minimumGoal,
    safety,
    breakdown: {
      bmr,
      activityCalories: Math.max(0, maintenance - bmr),
      maintenance,
      deficit: targetDeficit,
      recommendedCalorieGoal: recommendedToday,
      formula: "Grundumsatz + Aktivitaet = Erhaltungsbedarf - Defizit = Kalorienziel",
    },
    activity,
  };
}

export function calculateAdaptiveMaintenance(dailyCalories, weightLogs, today, options = {}) {
  const validDays = dailyCalories.filter((day) => day.calories > 0);
  const completeDays = dailyCalories.filter((day) => Number(day.entryCount ?? 0) >= (options.minimumEntriesPerCompleteDay ?? 2));
  const sortedWeights = [...weightLogs]
    .filter((log) => Number.isFinite(log.weightKg))
    .sort((left, right) => left.date.localeCompare(right.date));

  if (validDays.length < 14) {
    return {
      available: false,
      validDayCount: validDays.length,
      requiredDayCount: 14,
      completeDayCount: completeDays.length,
      weightLogCount: sortedWeights.length,
      message: "Noch zu wenige valide Tracking-Tage fuer automatische Anpassung.",
    };
  }

  if (completeDays.length < 14) {
    return {
      available: false,
      validDayCount: validDays.length,
      requiredDayCount: 14,
      completeDayCount: completeDays.length,
      weightLogCount: sortedWeights.length,
      message: "Food Tracking ist noch nicht vollstaendig genug fuer automatische Anpassung.",
    };
  }

  if (sortedWeights.length < 10) {
    return {
      available: false,
      validDayCount: validDays.length,
      requiredDayCount: 14,
      completeDayCount: completeDays.length,
      weightLogCount: sortedWeights.length,
      requiredWeightLogCount: 10,
      message: "Mindestens 10 Gewichtseintraege sind fuer die adaptive Berechnung noetig.",
    };
  }

  const latestDate = today ?? validDays[validDays.length - 1]?.date;
  const startDate = validDays[0]?.date;
  const latestAverage = rollingWeightAverage(sortedWeights, latestDate);
  const startAverageDate = addDays(startDate, 6);
  const startAverage = rollingWeightAverage(sortedWeights, startAverageDate);

  if (!latestAverage || !startAverage || latestAverage.sampleCount < 3 || startAverage.sampleCount < 3) {
    return {
      available: false,
      validDayCount: validDays.length,
      requiredDayCount: 14,
      completeDayCount: completeDays.length,
      weightLogCount: sortedWeights.length,
      message: "Gewichtsdaten sind lueckenhaft; automatische Anpassung pausiert.",
    };
  }

  const observedDays = Math.max(1, daysBetween(startDate, latestAverage.date));
  const weightDeltaKg = latestAverage.averageKg - startAverage.averageKg;
  const calorieDeltaPerDay = Math.round((-weightDeltaKg * kcalPerKgBodyWeight) / observedDays);
  const averageCalories = Math.round(validDays.reduce((sum, day) => sum + day.calories, 0) / validDays.length);

  return {
    available: true,
    validDayCount: validDays.length,
    completeDayCount: completeDays.length,
    weightLogCount: sortedWeights.length,
    observedDays,
    averageCalories,
    startAverage,
    latestAverage,
    weightDeltaKg: round(weightDeltaKg, 2),
    calorieDeltaPerDay,
    adaptiveMaintenance: Math.max(adaptiveMinimumCalorieGoal, averageCalories + calorieDeltaPerDay),
    message: "Adaptiver Erhaltungsbedarf aus vollstaendigem Tracking und 7-Tage-Gewichtstrend berechnet.",
  };
}

export function calculateWeeklyFeedback(profile, adaptiveResult) {
  if (!adaptiveResult.available) {
    return {
      status: "insufficient-data",
      adjustmentCalories: 0,
      message: adaptiveResult.message,
    };
  }

  const observedLossPerWeek = adaptiveResult.weightDeltaKg < 0
    ? Math.abs(adaptiveResult.weightDeltaKg) / adaptiveResult.observedDays * 7
    : -Math.abs(adaptiveResult.weightDeltaKg) / adaptiveResult.observedDays * 7;
  const delta = observedLossPerWeek - profile.weeklyLossKg;

  if (Math.abs(delta) <= 0.12) {
    return {
      status: "on-track",
      adjustmentCalories: 0,
      observedLossKgPerWeek: round(observedLossPerWeek, 2),
      message: "Gewichtstrend passt zum Ziel; keine Anpassung vorgeschlagen.",
    };
  }

  const adjustmentCalories = delta < 0 ? -150 : 150;
  return {
    status: delta < 0 ? "too-slow" : "too-fast",
    adjustmentCalories,
    observedLossKgPerWeek: round(observedLossPerWeek, 2),
    message: delta < 0
      ? "Abnahme ist langsamer als geplant; moderate Reduzierung vorgeschlagen."
      : "Abnahme ist schneller als geplant; moderate Erhoehung vorgeschlagen.",
  };
}

export function calculateStepBonus(steps) {
  if (!Number.isFinite(steps) || steps < 4000) return 0;
  if (steps <= 6000) return Math.round((steps - 4000) / 2000 * 50);
  if (steps <= 10000) return 50 + Math.round((steps - 6000) / 4000 * 150);
  return Math.min(350, 200 + Math.round((steps - 10000) / 1000 * 35));
}

export function calculateWorkoutCredit(activity, workoutCreditFactors) {
  const calories = finiteNumber(activity?.calories) ?? 0;
  if (calories <= 0) return 0;
  const descriptor = `${activity?.activityType ?? ""} ${activity?.activityName ?? ""}`;
  const matchedRange = workoutCreditRanges.find((range) => range.match.test(descriptor));
  const factors = normalizeWorkoutCreditFactors(workoutCreditFactors, defaultAdaptiveGoalProfile.workoutCreditFactors);
  const factor = matchedRange ? factors[matchedRange.key] : factors.default;
  return Math.round(calories * factor);
}

export function calculateConfidenceScore({ profile, dailyCalories = [], weightLogs = [], adaptiveResult } = {}) {
  const validDayCount = adaptiveResult?.validDayCount ?? dailyCalories.filter((day) => day.calories > 0).length;
  const completeDayCount = adaptiveResult?.completeDayCount ?? dailyCalories.filter((day) => Number(day.entryCount ?? 0) >= 2).length;
  const recentWeightLogs = weightLogs.filter((log) => Number.isFinite(log.weightKg)).length;
  const factors = [
    { key: "garmin", label: profile?.garminEnabled ? "Garmin verbunden" : "Garmin nicht verbunden", points: profile?.garminEnabled ? 20 : 0, max: 20 },
    { key: "tracking-days", label: `${validDayCount} Trackingtage`, points: Math.min(25, Math.round(validDayCount / 14 * 25)), max: 25 },
    { key: "complete-food", label: `${completeDayCount} vollstaendige Food-Tage`, points: Math.min(25, Math.round(completeDayCount / 14 * 25)), max: 25 },
    { key: "weight-logs", label: `${recentWeightLogs} Gewichtseintraege`, points: Math.min(30, Math.round(recentWeightLogs / 10 * 30)), max: 30 },
  ];
  return {
    score: Math.max(0, Math.min(100, factors.reduce((sum, factor) => sum + factor.points, 0))),
    factors,
    basis: factors.map((factor) => factor.label).join(", "),
  };
}

export function buildCoachMode({ profile, dailyGoal, adaptiveResult, confidence }) {
  const lossKgPerWeek = adaptiveResult?.available && adaptiveResult.observedDays > 0
    ? Math.max(-2, Math.min(2, (-adaptiveResult.weightDeltaKg / adaptiveResult.observedDays) * 7))
    : profile.weeklyLossKg;
  const stepCalories = calculateStepBonus(4000);
  const stagnating = adaptiveResult?.available && Math.abs(adaptiveResult.weightDeltaKg) < 0.2;
  const suggestions = [
    `4.000 zusaetzliche Schritte erlauben heute ca. ${stepCalories.toLocaleString("de-DE")} kcal mehr.`,
  ];

  if (stagnating) {
    suggestions.push("Bei laengerer Stagnation: Kalorien leicht reduzieren, Aktivitaet erhoehen, Protein priorisieren und haeufiger wiegen.");
  } else if ((confidence?.score ?? 0) < 70) {
    suggestions.push("Mehr vollstaendige Food-Tage und regelmaessige Gewichtseintraege verbessern die naechste Wochenanpassung.");
  } else {
    suggestions.push("Aktuelles Ziel beibehalten und die naechste Wochenpruefung abwarten.");
  }

  return {
    projectedLossKgPerWeek: round(lossKgPerWeek, 2),
    message: `Mit deinem aktuellen Verhalten wirst du voraussichtlich ${round(lossKgPerWeek, 2).toLocaleString("de-DE")} kg pro Woche verlieren.`,
    dailyTarget: dailyGoal.finalGoal,
    suggestions,
  };
}

export function rollingWeightAverage(weightLogs, date) {
  const start = addDays(date, -6);
  const samples = weightLogs.filter((log) => log.date >= start && log.date <= date);
  if (samples.length === 0) return null;
  return {
    date,
    averageKg: round(samples.reduce((sum, log) => sum + log.weightKg, 0) / samples.length, 2),
    sampleCount: samples.length,
  };
}

function daysBetween(startDate, endDate) {
  return Math.round((Date.parse(`${endDate}T12:00:00Z`) - Date.parse(`${startDate}T12:00:00Z`)) / 86_400_000);
}

function addDays(date, days) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function clampInteger(value, min, max, fallback) {
  return Math.round(clampNumber(value, min, max, fallback));
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : undefined;
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function calculateSafetyLimits(profile, bmr, maintenance, requestedDeficit) {
  const percentLimit = Math.round(maintenance * ((profile.maxDeficitPercent ?? 30) / 100));
  const bodyWeightLimit = Math.round((profile.currentWeightKg * 0.01 * kcalPerKgBodyWeight) / 7);
  const maxDeficit = profile.useBodyWeightDeficitLimit ? bodyWeightLimit : percentLimit;
  const minimums = [adaptiveMinimumCalorieGoal, Math.ceil(bmr * 0.8)];
  if (profile.enforceSexMinimumCalories) {
    if (profile.sex === "male") minimums.push(1800);
    if (profile.sex === "female") minimums.push(1400);
  }
  const minimumGoal = Math.max(...minimums);
  const minimumAdjustedDeficit = Math.max(0, maintenance - minimumGoal);
  const deficit = Math.min(requestedDeficit, maxDeficit, minimumAdjustedDeficit);
  const wasAdjusted = deficit < requestedDeficit;

  return {
    requestedDeficit,
    maxDeficit,
    maxDeficitPercent: profile.maxDeficitPercent ?? 30,
    bodyWeightDeficitLimit: bodyWeightLimit,
    useBodyWeightDeficitLimit: profile.useBodyWeightDeficitLimit,
    minimumGoal,
    minimumGoalFromBmr: Math.ceil(bmr * 0.8),
    enforceSexMinimumCalories: profile.enforceSexMinimumCalories,
    deficit,
    wasAdjusted,
    notice: wasAdjusted
      ? "Das gewuenschte Defizit ueberschreitet den empfohlenen Bereich. Das Kalorienziel wurde automatisch angepasst."
      : "",
  };
}

function normalizeWorkoutCreditFactors(input = {}, fallback = defaultAdaptiveGoalProfile.workoutCreditFactors) {
  return {
    strength: clampNumber(input?.strength, 0, 1, fallback?.strength ?? 0.4),
    running: clampNumber(input?.running, 0, 1, fallback?.running ?? 0.7),
    cycling: clampNumber(input?.cycling, 0, 1, fallback?.cycling ?? 0.7),
    walking: clampNumber(input?.walking, 0, 1, fallback?.walking ?? 0.8),
    default: clampNumber(input?.default, 0, 1, fallback?.default ?? 0.35),
  };
}
