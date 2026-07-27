const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export const analysisQueryLimits = Object.freeze({
  maxPeriods: 3,
  maxPeriodDays: 366,
  maxTotalDays: 400,
  maxDailyDetailDays: 42,
});

const monthNames = new Map([
  ["januar", 1],
  ["februar", 2],
  ["märz", 3],
  ["maerz", 3],
  ["april", 4],
  ["mai", 5],
  ["juni", 6],
  ["juli", 7],
  ["august", 8],
  ["september", 9],
  ["oktober", 10],
  ["november", 11],
  ["dezember", 12],
]);

const allowedFocus = new Set(["nutrition", "weight", "activity", "habits", "goals"]);

export function buildAnalysisQueryTool({ anchorWeekStart, today, availableFrom, availableTo }) {
  return {
    type: "function",
    function: {
      name: "query_tracker_data",
      description: [
        "Waehle nur die Tracker-Zeitraeume und Datenarten, die zur Nutzerfrage passen.",
        `Relative Angaben beziehen sich auf die in der UI gewaehlte Woche ${anchorWeekStart} bis ${addDays(anchorWeekStart, 6)}.`,
        `Heute ist ${today}. Vorhandene Daten reichen ungefaehr von ${availableFrom ?? "unbekannt"} bis ${availableTo ?? "unbekannt"}.`,
        "Maximal drei Zeitraeume, pro Zeitraum 366 Tage und zusammen 400 Tage.",
        "Fuer Trends lange Zeitraeume wochenweise zusammenfassen; Tagesdetails nur fuer insgesamt hoechstens 42 Tage anfordern.",
      ].join(" "),
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["periods", "focus", "includeDailyDetails"],
        properties: {
          periods: {
            type: "array",
            minItems: 1,
            maxItems: analysisQueryLimits.maxPeriods,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["label", "from", "to"],
              properties: {
                label: { type: "string", maxLength: 60 },
                from: { type: "string", description: "YYYY-MM-DD, inklusive" },
                to: { type: "string", description: "YYYY-MM-DD, inklusive" },
              },
            },
          },
          focus: {
            type: "array",
            minItems: 1,
            maxItems: 5,
            items: { type: "string", enum: [...allowedFocus] },
          },
          includeDailyDetails: {
            type: "boolean",
            description: "Nur true, wenn alle angefragten Zeitraeume zusammen hoechstens 42 Tage umfassen.",
          },
        },
      },
    },
  };
}

export function resolveExplicitAnalysisPlan(question, options) {
  const normalizedQuestion = normalizeQuestion(question);
  const today = normalizeDate(options.today, "Heute");
  const requestedAnchorWeekStart = normalizeDate(options.anchorWeekStart, "Ausgewählte Woche");
  const anchorWeekStart = requestedAnchorWeekStart > today
    ? startOfIsoWeek(today)
    : requestedAnchorWeekStart;
  const anchorEnd = minDate(addDays(anchorWeekStart, 6), today);
  const focus = inferFocus(normalizedQuestion);
  const periods = [];

  const weeksMatches = [...normalizedQuestion.matchAll(/\b(?:letzte[nr]?|vergangene[nr]?)\s+(\d{1,2})\s+wochen?\b(?!\s+davor)/g)];
  const precedingWeeksMatch = normalizedQuestion.match(/\b(?:letzte[nr]?\s+)?(\d{1,2})\s+wochen?\s+davor\b/)
    ?? normalizedQuestion.match(/\b(?:vorhergehende[nr]?|vorangegangene[nr]?)\s+(\d{1,2})\s+wochen?\b/);
  for (const [matchIndex, weeksMatch] of weeksMatches.slice(0, analysisQueryLimits.maxPeriods).entries()) {
    const weekCount = Number(weeksMatch[1]);
    if (weekCount >= 1 && weekCount <= 52) {
      const currentPeriod = {
        label: `Letzte ${weekCount} Wochen`,
        from: addDays(anchorEnd, -(weekCount * 7) + 1),
        to: anchorEnd,
      };
      periods.push(currentPeriod);
      if (matchIndex === 0 && /\b(?:davor|vorhergehende[nr]?|vorangegangene[nr]?)\b/.test(normalizedQuestion)) {
        const hasSingularPrecedingWeek = /\b(?:der|die)?\s*woche\s+davor\b/.test(normalizedQuestion);
        const precedingWeekCount = hasSingularPrecedingWeek
          ? 1
          : Number(precedingWeeksMatch?.[1] ?? weekCount);
        const previousTo = addDays(currentPeriod.from, -1);
        if (precedingWeekCount >= 1 && precedingWeekCount <= 52) {
          periods.push({
            label: `${precedingWeekCount} ${precedingWeekCount === 1 ? "Woche" : "Wochen"} davor`,
            from: addDays(previousTo, -(precedingWeekCount * 7) + 1),
            to: previousTo,
          });
        }
      }
    }
  }

  const isoWeeks = [...normalizedQuestion.matchAll(/\bkw\s*(\d{1,2})(?:\s*[/. -]\s*(20\d{2}))?\b/g)];
  for (const match of isoWeeks.slice(0, analysisQueryLimits.maxPeriods)) {
    const week = Number(match[1]);
    const year = Number(match[2] ?? addDays(anchorWeekStart, 3).slice(0, 4));
    if (week < 1 || week > 53) continue;
    const from = isoWeekStart(year, week);
    if (Number(addDays(from, 3).slice(0, 4)) !== year) {
      throw new Error(`KW ${week}/${year} existiert nicht.`);
    }
    periods.push({ label: `KW ${week}/${year}`, from, to: addDays(from, 6) });
  }

  const sinceMonthMatch = normalizedQuestion.match(
    /\bseit\s+(januar|februar|märz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember)(?:\s+(20\d{2})|\s+(?:des\s+)?(vorjahres|letzten\s+jahres|letztes\s+jahr|vergangenen\s+jahres|vergangenes\s+jahr|vorigen\s+jahres|voriges\s+jahr))?\b/,
  );
  if (sinceMonthMatch) {
    const month = monthNames.get(sinceMonthMatch[1]);
    let year = Number(sinceMonthMatch[2] ?? (
      sinceMonthMatch[3] ? Number(anchorEnd.slice(0, 4)) - 1 : anchorEnd.slice(0, 4)
    ));
    let from = firstDayOfMonth(year, month);
    if (!sinceMonthMatch[2] && !sinceMonthMatch[3] && from > anchorEnd) {
      year -= 1;
      from = firstDayOfMonth(year, month);
    }
    periods.push({
      label: `Seit ${capitalize(sinceMonthMatch[1])} ${year}`,
      from,
      to: anchorEnd,
    });
  }

  const sinceMonthIndex = sinceMonthMatch
    ? sinceMonthMatch.index + sinceMonthMatch[0].indexOf(sinceMonthMatch[1])
    : -1;
  const monthMatches = [...normalizedQuestion.matchAll(
    /\b(januar|februar|märz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember)(?:\s+(20\d{2})|\s+(?:des\s+)?(vorjahres|letzten\s+jahres|letztes\s+jahr|vergangenen\s+jahres|vergangenes\s+jahr|vorigen\s+jahres|voriges\s+jahr))?\b/g,
  )]
    .filter((match) => match.index !== sinceMonthIndex);
  const wantsMonths = monthMatches.length > 1
    || monthMatches.some((match) => match[2] || match[3])
    || /\b(?:im|in|aus|für|fuer|vergleiche?|gegenüber|gegenueber|versus|vs\.?)\b/.test(normalizedQuestion);
  if (wantsMonths) {
    const resolvedMonths = resolveMonthPeriods(monthMatches, anchorEnd);
    for (let index = 0; index < resolvedMonths.length; index += 1) {
      const current = resolvedMonths[index];
      const next = resolvedMonths[index + 1];
      const betweenMatches = next
        ? normalizedQuestion.slice(monthMatches[index].index + monthMatches[index][0].length, monthMatches[index + 1].index)
        : "";
      const prefix = normalizedQuestion.slice(0, monthMatches[index].index);
      const startsBetweenRange = index === 0 && /\bzwischen\s*$/.test(prefix) && /\bund\b/.test(betweenMatches);
      if (next && (/\bbis\b/.test(betweenMatches) || startsBetweenRange)) {
        if (current.from > next.from) {
          const currentHasExplicitYear = Boolean(monthMatches[index][2] || monthMatches[index][3]);
          const nextHasExplicitYear = Boolean(monthMatches[index + 1][2] || monthMatches[index + 1][3]);
          if (currentHasExplicitYear && !nextHasExplicitYear) {
            next.year += 1;
            next.from = firstDayOfMonth(next.year, next.month);
            next.to = lastDayOfMonth(next.year, next.month);
            next.label = `${capitalize(monthMatches[index + 1][1])} ${next.year}`;
          } else if (!currentHasExplicitYear && nextHasExplicitYear) {
            current.year -= 1;
            current.from = firstDayOfMonth(current.year, current.month);
            current.to = lastDayOfMonth(current.year, current.month);
            current.label = `${capitalize(monthMatches[index][1])} ${current.year}`;
          } else if (!currentHasExplicitYear && !nextHasExplicitYear) {
            current.year -= 1;
            current.from = firstDayOfMonth(current.year, current.month);
            current.to = lastDayOfMonth(current.year, current.month);
            current.label = `${capitalize(monthMatches[index][1])} ${current.year}`;
          }
        }
        periods.push({
          label: `${current.label} bis ${next.label}`,
          from: current.from,
          to: next.to,
        });
        index += 1;
      } else {
        periods.push({ label: current.label, from: current.from, to: current.to });
      }
    }
  }

  if (/\b(?:diese(?:r|n)?|aktuelle(?:r|n)?|ausgewählte(?:r|n)?|ausgewaehlte(?:r|n)?)\s+woche\b/.test(normalizedQuestion)) {
    periods.push({ label: "Ausgewählte Woche", from: anchorWeekStart, to: addDays(anchorWeekStart, 6) });
  }

  if (/\b(?:letzte[nr]?|vorherige[nr]?|vergangene[nr]?)\s+woche\b/.test(normalizedQuestion)) {
    const from = addDays(anchorWeekStart, -7);
    periods.push({ label: "Vorherige Woche", from, to: addDays(from, 6) });
    if (/\bdavor\b/.test(normalizedQuestion)) {
      const earlierFrom = addDays(from, -7);
      periods.push({ label: "Woche davor", from: earlierFrom, to: addDays(earlierFrom, 6) });
    }
  }

  if (periods.length === 0) return null;
  return normalizeAnalysisQueryPlan({
    periods: dedupePeriods(periods),
    focus,
    includeDailyDetails: periods.reduce((sum, period) => sum + inclusiveDays(period.from, period.to), 0)
      <= analysisQueryLimits.maxDailyDetailDays,
  }, options);
}

export function inferDefaultAnalysisPlan(question, options) {
  const today = normalizeDate(options.today, "Heute");
  const requestedAnchorWeekStart = normalizeDate(options.anchorWeekStart, "Ausgewählte Woche");
  const anchorWeekStart = requestedAnchorWeekStart > today
    ? startOfIsoWeek(today)
    : requestedAnchorWeekStart;
  const anchorEnd = minDate(addDays(anchorWeekStart, 6), today);
  const normalizedQuestion = normalizeQuestion(question);
  const focus = inferFocus(normalizedQuestion);
  const weightTrend = /\b(?:gewicht|zugenommen|abgenommen|abnahme|zunahme|waage|gewichtstrend|gewichtsverlauf)\b/.test(normalizedQuestion);
  const dayCount = weightTrend ? 56 : 28;
  return normalizeAnalysisQueryPlan({
    periods: [{
      label: weightTrend ? "Standard: letzte 8 Wochen" : "Standard: letzte 4 Wochen",
      from: addDays(anchorEnd, -dayCount + 1),
      to: anchorEnd,
    }],
    focus,
    includeDailyDetails: !weightTrend,
    defaulted: true,
  }, options);
}

export function hasAnalysisTimeReference(question) {
  const normalizedQuestion = normalizeQuestion(question);
  return /\b(?:heute|gestern|vorgestern|vorwoche|vormonat|vorquartal|woche|wochen|monat|monate|monaten|quartal|vorjahr(?:es)?|jahr(?:es|e|en)?|seit|zwischen|von|bis|davor|vorher|kw\s*\d|20\d{2}|januar|februar|märz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember)\b/.test(normalizedQuestion);
}

export function hasUnresolvedAnalysisTimeReference(question) {
  let remaining = normalizeQuestion(question);
  if (/\bkw\s*\d{1,2}(?:\s*[/. -]\s*20\d{2})?\s+bis\s+(?:kw\s*)?\d{1,2}\b/.test(remaining)) {
    return true;
  }
  const monthMatches = [...remaining.matchAll(
    /\b(januar|februar|märz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember)(?:\s+(20\d{2})|\s+(?:des\s+)?(vorjahres|letzten\s+jahres|letztes\s+jahr|vergangenen\s+jahres|vergangenes\s+jahr|vorigen\s+jahres|voriges\s+jahr))?\b/g,
  )];
  const hasDeterministicMonthContext = monthMatches.length > 1
    || monthMatches.some((match) => match[2] || match[3])
    || /\b(?:im|in|aus|für|fuer|vergleiche?|gegenüber|gegenueber|versus|vs\.?)\b/.test(remaining);
  const resolvedPatterns = [
    /\b(?:letzte[nr]?|vergangene[nr]?)\s+\d{1,2}\s+wochen?\b/g,
    /\b\d{1,2}\s+wochen?\s+davor\b/g,
    /\b(?:vorhergehende[nr]?|vorangegangene[nr]?)\s+\d{1,2}\s+wochen?\b/g,
    /\bkw\s*\d{1,2}(?:\s*[/. -]\s*20\d{2})?\b/g,
    /\bseit\s+(?:januar|februar|märz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember)(?:\s+20\d{2}|\s+(?:des\s+)?(?:vorjahres|letzten\s+jahres|letztes\s+jahr|vergangenen\s+jahres|vergangenes\s+jahr|vorigen\s+jahres|voriges\s+jahr))?\b/g,
    ...(hasDeterministicMonthContext ? [
      /\b(?:januar|februar|märz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember)(?:\s+20\d{2}|\s+(?:des\s+)?(?:vorjahres|letzten\s+jahres|letztes\s+jahr|vergangenen\s+jahres|vergangenes\s+jahr|vorigen\s+jahres|voriges\s+jahr))?\b/g,
    ] : []),
    /\b(?:diese(?:r|n)?|aktuelle(?:r|n)?|ausgewählte(?:r|n)?|ausgewaehlte(?:r|n)?)\s+woche\b/g,
    /\b(?:letzte[nr]?|vorherige[nr]?|vergangene[nr]?)\s+woche\b/g,
    /\bwoche\s+davor\b/g,
  ];
  for (const pattern of resolvedPatterns) remaining = remaining.replace(pattern, " ");
  remaining = remaining.replace(
    /\b(?:zwischen|von|bis|davor|vorhergehende[nr]?|vorangegangene[nr]?)\b/g,
    " ",
  );
  return hasAnalysisTimeReference(remaining);
}

export function normalizeAnalysisQueryPlan(input, options) {
  const today = normalizeDate(options.today, "Heute");
  const rawPeriods = Array.isArray(input?.periods) ? input.periods : [];
  if (rawPeriods.length < 1 || rawPeriods.length > analysisQueryLimits.maxPeriods) {
    throw new Error(`Die Datenabfrage muss 1 bis ${analysisQueryLimits.maxPeriods} Zeiträume enthalten.`);
  }

  const periods = rawPeriods.map((period, index) => {
    const from = normalizeDate(period?.from, `Start von Zeitraum ${index + 1}`);
    const requestedTo = normalizeDate(period?.to, `Ende von Zeitraum ${index + 1}`);
    const to = minDate(requestedTo, today);
    if (from > to) throw new Error(`Zeitraum ${index + 1} ist ungültig oder liegt vollständig in der Zukunft.`);
    const days = inclusiveDays(from, to);
    if (days > analysisQueryLimits.maxPeriodDays) {
      throw new Error(`Zeitraum ${index + 1} überschreitet ${analysisQueryLimits.maxPeriodDays} Tage.`);
    }
    return {
      label: String(period?.label ?? `Zeitraum ${index + 1}`).replace(/\s+/g, " ").trim().slice(0, 60)
        || `Zeitraum ${index + 1}`,
      from,
      to,
      days,
    };
  });
  const totalDays = periods.reduce((sum, period) => sum + period.days, 0);
  if (totalDays > analysisQueryLimits.maxTotalDays) {
    throw new Error(`Die Datenabfrage überschreitet insgesamt ${analysisQueryLimits.maxTotalDays} Tage.`);
  }

  const focus = [...new Set((Array.isArray(input?.focus) ? input.focus : [])
    .map((item) => String(item))
    .filter((item) => allowedFocus.has(item)))].slice(0, 5);
  if (focus.includes("weight") && !focus.includes("nutrition")) focus.push("nutrition");
  if (focus.includes("weight") && !focus.includes("activity")) focus.push("activity");

  return {
    periods,
    focus: focus.length > 0 ? focus : ["nutrition", "weight", "activity", "habits", "goals"],
    includeDailyDetails: input?.includeDailyDetails === true
      && totalDays <= analysisQueryLimits.maxDailyDetailDays,
    defaulted: input?.defaulted === true,
    periodLabel: formatAnalysisPeriodLabel(periods),
    totalDays,
  };
}

export function formatAnalysisPeriodLabel(periods) {
  return periods
    .map((period) => `${period.label}: ${formatDate(period.from)}–${formatDate(period.to)}`)
    .join(" · ");
}

function inferFocus(question) {
  const focus = [];
  if (/\b(?:gewicht|zugenommen|abgenommen|abnahme|zunahme|waage|trend|verlauf)\b/.test(question)) focus.push("weight");
  if (/\b(?:essen|ernährung|ernaehrung|kalorien|protein|kohlenhydrat|fett|makro|lebensmittel|mahlzeit)\b/.test(question)) focus.push("nutrition");
  if (/\b(?:sport|training|aktivität|aktivitaet|garmin|bewegung|verbrannt|verbraucht|kalorienverbrauch|energieverbrauch|aktivkalorien)\b/.test(question)) focus.push("activity");
  if (/\b(?:gewohnheit|muster|timing|uhrzeit|abends|snack)\b/.test(question)) focus.push("habits");
  if (/\b(?:ziel|erreichen|defizit|plan)\b/.test(question)) focus.push("goals");
  if (focus.length === 0) return ["nutrition", "weight", "activity", "habits", "goals"];
  if (focus.includes("weight") && !focus.includes("nutrition")) focus.push("nutrition");
  if (focus.includes("weight") && !focus.includes("activity")) focus.push("activity");
  return focus;
}

function dedupePeriods(periods) {
  const seen = new Set();
  return periods.filter((period) => {
    const key = `${period.from}:${period.to}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, analysisQueryLimits.maxPeriods);
}

function isoWeekStart(year, week) {
  const januaryFourth = new Date(Date.UTC(year, 0, 4, 12));
  const weekday = januaryFourth.getUTCDay() || 7;
  januaryFourth.setUTCDate(januaryFourth.getUTCDate() - weekday + 1 + ((week - 1) * 7));
  return januaryFourth.toISOString().slice(0, 10);
}

function startOfIsoWeek(date) {
  const parsed = new Date(`${date}T12:00:00Z`);
  const weekday = parsed.getUTCDay() || 7;
  parsed.setUTCDate(parsed.getUTCDate() - weekday + 1);
  return parsed.toISOString().slice(0, 10);
}

function firstDayOfMonth(year, month) {
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

function resolveMonthPeriods(matches, anchorEnd) {
  const anchorYear = Number(anchorEnd.slice(0, 4));
  const resolvedYears = matches.map((match) => (
    match[2] ? Number(match[2]) : match[3] ? anchorYear - 1 : undefined
  ));
  const knownYearIndex = resolvedYears.findIndex(Number.isFinite);
  if (knownYearIndex < 0) return matches.map((match) => resolveMonthPeriod(match, anchorEnd));

  for (let index = knownYearIndex + 1; index < matches.length; index += 1) {
    if (Number.isFinite(resolvedYears[index])) continue;
    const crossesIntoJanuary = monthNames.get(matches[index - 1][1]) === 12
      && monthNames.get(matches[index][1]) === 1;
    const betweenMatches = matches[index].input.slice(
      matches[index - 1].index + matches[index - 1][0].length,
      matches[index].index,
    );
    const requestsPreviousMonth = /\b(?:vorherige[nr]?|vorangegangene[nr]?|davor|zuvor)\b/.test(betweenMatches);
    const crossesBackIntoDecember = monthNames.get(matches[index - 1][1]) === 1
      && monthNames.get(matches[index][1]) === 12
      && requestsPreviousMonth;
    resolvedYears[index] = resolvedYears[index - 1]
      + (crossesIntoJanuary ? 1 : 0)
      - (crossesBackIntoDecember ? 1 : 0);
  }
  for (let index = knownYearIndex - 1; index >= 0; index -= 1) {
    if (Number.isFinite(resolvedYears[index])) continue;
    const crossesBackIntoDecember = monthNames.get(matches[index][1]) === 12
      && monthNames.get(matches[index + 1][1]) === 1;
    resolvedYears[index] = resolvedYears[index + 1] - (crossesBackIntoDecember ? 1 : 0);
  }
  return matches.map((match, index) => resolveMonthPeriod(match, anchorEnd, resolvedYears[index]));
}

function resolveMonthPeriod(match, anchorEnd, forcedYear) {
  const month = monthNames.get(match[1]);
  let year = Number(forcedYear ?? match[2] ?? anchorEnd.slice(0, 4));
  let from = firstDayOfMonth(year, month);
  if (!Number.isFinite(forcedYear) && !match[2] && from > anchorEnd) {
    year -= 1;
    from = firstDayOfMonth(year, month);
  }
  return {
    label: `${capitalize(match[1])} ${year}`,
    month,
    year,
    from,
    to: lastDayOfMonth(year, month),
  };
}

function lastDayOfMonth(year, month) {
  return new Date(Date.UTC(year, month, 0, 12)).toISOString().slice(0, 10);
}

function normalizeQuestion(value) {
  return String(value ?? "").toLocaleLowerCase("de-DE").replace(/\s+/g, " ").trim();
}

function normalizeDate(value, label) {
  const raw = String(value ?? "").trim();
  if (!datePattern.test(raw)) throw new Error(`${label} ist kein gültiges Datum.`);
  const parsed = new Date(`${raw}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) {
    throw new Error(`${label} ist kein gültiges Datum.`);
  }
  return raw;
}

function inclusiveDays(from, to) {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000) + 1;
}

function addDays(date, days) {
  const parsed = new Date(`${date}T12:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function minDate(left, right) {
  return left < right ? left : right;
}

function formatDate(date) {
  const [year, month, day] = date.split("-");
  return `${day}.${month}.${year}`;
}

function capitalize(value) {
  return value.charAt(0).toLocaleUpperCase("de-DE") + value.slice(1);
}
