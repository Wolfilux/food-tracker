export const appTimeZone = "Europe/Berlin";

const berlinDateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: appTimeZone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function partValue(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) {
  return parts.find((part) => part.type === type)?.value ?? "";
}

export function toBerlinDateTimeInputValue(date = new Date()) {
  const parts = berlinDateTimeFormatter.formatToParts(date);
  return [
    partValue(parts, "year"),
    "-",
    partValue(parts, "month"),
    "-",
    partValue(parts, "day"),
    "T",
    partValue(parts, "hour"),
    ":",
    partValue(parts, "minute"),
  ].join("");
}

export const nowLocal = () => toBerlinDateTimeInputValue();
export const todayLocal = () => nowLocal().slice(0, 10);

export function formatDateTime(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})/.exec(String(value));
  if (!match) return String(value);
  return `${match[3]}.${match[2]}., ${match[4]}`;
}

export function formatTime(value: string) {
  const match = /T(\d{2}:\d{2})/.exec(String(value));
  return match?.[1] ?? String(value);
}
