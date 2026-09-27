import type { ClosureGeometry } from "@/lib/closures/types";

// Pure recurrence detection over historical permitted-event rows. Kept free of
// network and file access so the build script and API route can share it and
// tests can exercise it directly.

export type RecurrenceRule =
  | { type: "fixed"; month: number; day: number }
  | { type: "nth-weekday"; month: number; weekday: number; nth: number }
  | { type: "last-weekday"; month: number; weekday: number };

export type HistoricalOccurrence = {
  name: string;
  borough: string;
  location: string;
  /** NYC local time, "YYYY-MM-DDTHH:MM". */
  start: string;
  end: string;
  closureType: string;
};

export type ForecastSeries = {
  id: string;
  title: string;
  borough: string;
  rule: RecurrenceRule;
  ruleLabel: string;
  yearsObserved: number[];
  yearsExpected: number;
  confidence: "high" | "medium";
  startTime: string;
  endTime: string;
  /** Days the closure typically starts before / ends after the anchor date. */
  daysBefore: number;
  daysAfter: number;
  closureType: string;
  locations: string[];
  geometry: ClosureGeometry | null;
};

export type ForecastFile = {
  generatedAt: string;
  source: string;
  historyFrom: string;
  historyTo: string;
  series: ForecastSeries[];
};

export type DetectOptions = {
  /** Calendar date ("YYYY-MM-DD") the history was downloaded. */
  asOf: string;
  minYears?: number;
  minRatio?: number;
  /** Most recent year a series must still appear in to be forecast. */
  recentYears?: number;
};

const MONTHS = [
  "January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December",
];
const WEEKDAYS = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];
const ORDINALS = ["1st", "2nd", "3rd", "4th"];
// 2020 permits collapsed during COVID; missing that year is not evidence an
// event stopped recurring.
const SKIPPED_YEARS = new Set([2020]);
const MAX_RUNS_PER_YEAR = 2;
const DAY_MS = 24 * 60 * 60 * 1000;

function pad(value: number) {
  return value.toString().padStart(2, "0");
}

function toDateString(year: number, month: number, day: number) {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function parseDate(value: string) {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return { year, month, day };
}

function dayNumber(value: string) {
  const { year, month, day } = parseDate(value);
  return Date.UTC(year, month - 1, day) / DAY_MS;
}

function fromDayNumber(value: number) {
  const date = new Date(value * DAY_MS);
  return toDateString(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
  );
}

export function addDays(date: string, days: number) {
  return fromDayNumber(dayNumber(date) + days);
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function weekdayOf(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function ruleDate(rule: RecurrenceRule, year: number): string | null {
  if (rule.type === "fixed") {
    return rule.day <= daysInMonth(year, rule.month)
      ? toDateString(year, rule.month, rule.day)
      : null;
  }
  if (rule.type === "nth-weekday") {
    const first = weekdayOf(year, rule.month, 1);
    const day = 1 + ((rule.weekday - first + 7) % 7) + (rule.nth - 1) * 7;
    return day <= daysInMonth(year, rule.month)
      ? toDateString(year, rule.month, day)
      : null;
  }
  const last = daysInMonth(year, rule.month);
  const day = last - ((weekdayOf(year, rule.month, last) - rule.weekday + 7) % 7);
  return toDateString(year, rule.month, day);
}

export function describeRule(rule: RecurrenceRule) {
  const month = MONTHS[rule.month - 1];
  if (rule.type === "fixed") return `Every ${month} ${rule.day}`;
  const weekday = WEEKDAYS[rule.weekday];
  return rule.type === "last-weekday"
    ? `Last ${weekday} of ${month}`
    : `${ORDINALS[rule.nth - 1]} ${weekday} of ${month}`;
}

function ruleKey(rule: RecurrenceRule) {
  return rule.type === "fixed"
    ? `fixed:${rule.month}:${rule.day}`
    : rule.type === "nth-weekday"
      ? `nth:${rule.month}:${rule.weekday}:${rule.nth}`
      : `last:${rule.month}:${rule.weekday}`;
}

// Weekday rules win ties over fixed dates: with few years of history a
// holiday like Thanksgiving can land on the same date twice by coincidence.
const RULE_PRIORITY: Record<RecurrenceRule["type"], number> = {
  "nth-weekday": 0,
  "last-weekday": 1,
  fixed: 2,
};

export function candidateRules(date: string): RecurrenceRule[] {
  const { year, month, day } = parseDate(date);
  const weekday = weekdayOf(year, month, day);
  const nth = Math.ceil(day / 7);
  const rules: RecurrenceRule[] = [{ type: "fixed", month, day }];
  if (nth <= 4) rules.push({ type: "nth-weekday", month, weekday, nth });
  if (day + 7 > daysInMonth(year, month)) {
    rules.push({ type: "last-weekday", month, weekday });
  }
  return rules;
}

/** Groups names that differ only by year, edition number, or punctuation. */
export function normalizeSeriesName(name: string) {
  return name
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/\b(19|20)\d{2}\b/g, " ")
    .replace(/\b\d+(st|nd|rd|th)\b/g, " ")
    .replace(/\bannual\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function displayTitle(name: string) {
  const cleaned = name
    .replace(/\b(19|20)\d{2}\b/g, " ")
    .replace(/\b\d+(st|nd|rd|th)\s+(annual\s+)?/gi, " ")
    .replace(/^\s*annual\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || name.trim();
}

function slug(value: string) {
  return value.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

function mode<T>(values: T[]) {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function minutes(time: string) {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

function clock(total: number) {
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

function splitLocations(location: string) {
  return location
    .replace(/\s+/g, " ")
    .split(/\s*,\s*(?=[^,]+\s+between\s+)/i)
    .map((part) => part.trim())
    .filter(Boolean);
}

type Run = { first: number; last: number; rows: HistoricalOccurrence[] };

/** Collapses a year's permit rows into runs of consecutive days. */
function runsFor(rows: HistoricalOccurrence[]) {
  const byDay = new Map<number, HistoricalOccurrence[]>();
  for (const row of rows) {
    const day = dayNumber(row.start);
    byDay.set(day, [...(byDay.get(day) || []), row]);
  }
  const days = [...byDay.keys()].sort((a, b) => a - b);
  const runs: Run[] = [];
  for (const day of days) {
    const current = runs[runs.length - 1];
    if (current && day - current.last <= 1) {
      current.last = day;
      current.rows.push(...byDay.get(day)!);
    } else {
      runs.push({ first: day, last: day, rows: [...byDay.get(day)!] });
    }
  }
  return runs;
}

function detectOne(
  rows: HistoricalOccurrence[],
  options: Required<DetectOptions>,
): ForecastSeries | null {
  const byYear = new Map<number, HistoricalOccurrence[]>();
  for (const row of rows) {
    const year = parseDate(row.start).year;
    byYear.set(year, [...(byYear.get(year) || []), row]);
  }
  const runsByYear = new Map(
    [...byYear.entries()].map(([year, yearRows]) => [year, runsFor(yearRows)]),
  );
  // Weekly markets and play streets recur too often to be annual events.
  if (median([...runsByYear.values()].map((runs) => runs.length)) > MAX_RUNS_PER_YEAR) {
    return null;
  }

  const tallies = new Map<
    string,
    { rule: RecurrenceRule; years: Map<number, Run>; permits: number }
  >();
  for (const [year, runs] of runsByYear) {
    for (const run of runs) {
      for (let day = run.first; day <= run.last; day += 1) {
        const date = fromDayNumber(day);
        const permits = run.rows.filter((row) => dayNumber(row.start) === day).length;
        for (const rule of candidateRules(date)) {
          const key = ruleKey(rule);
          const tally = tallies.get(key) || { rule, years: new Map(), permits: 0 };
          if (!tally.years.has(year)) tally.years.set(year, run);
          tally.permits += permits;
          tallies.set(key, tally);
        }
      }
    }
  }
  const best = [...tallies.values()].sort(
    (a, b) =>
      b.years.size - a.years.size ||
      b.permits - a.permits ||
      RULE_PRIORITY[a.rule.type] - RULE_PRIORITY[b.rule.type],
  )[0];
  if (!best || best.years.size < options.minYears) return null;

  const observed = [...best.years.keys()].sort((a, b) => a - b);
  const lastYear = observed[observed.length - 1];
  const asOfYear = parseDate(options.asOf).year;
  if (lastYear < asOfYear - options.recentYears) return null;

  // Only count a year as expected once its date has passed; permits for
  // upcoming dates may simply not be filed yet.
  let expected = 0;
  for (let year = observed[0]; year <= asOfYear; year += 1) {
    const date = ruleDate(best.rule, year);
    if (SKIPPED_YEARS.has(year) && !best.years.has(year)) continue;
    if (best.years.has(year) || (date && date < options.asOf)) expected += 1;
  }
  const ratio = observed.length / expected;
  if (ratio < options.minRatio) return null;

  const anchors = observed.map((year) => {
    const run = best.years.get(year)!;
    const anchor = dayNumber(ruleDate(best.rule, year)!);
    const anchorRows = run.rows.filter((row) => dayNumber(row.start) === anchor);
    return { year, run, anchor, rows: anchorRows.length ? anchorRows : run.rows };
  });
  const latest = anchors[anchors.length - 1];
  const anchorRows = anchors.flatMap((entry) => entry.rows);
  const title = displayTitle(
    [...latest.run.rows].sort((a, b) => b.start.localeCompare(a.start))[0].name,
  );
  const borough = latest.run.rows[0].borough;
  const endMinutes = anchorRows.map((row) =>
    dayNumber(row.end) > dayNumber(row.start) ? 24 * 60 - 1 : minutes(row.end.slice(11, 16)),
  );

  return {
    id: slug(`${normalizeSeriesName(title)} ${borough}`.toLowerCase()),
    title,
    borough,
    rule: best.rule,
    ruleLabel: describeRule(best.rule),
    yearsObserved: observed,
    yearsExpected: expected,
    confidence: observed.length >= 5 && ratio >= 0.8 ? "high" : "medium",
    startTime: clock(median(anchorRows.map((row) => minutes(row.start.slice(11, 16))))),
    endTime: clock(median(endMinutes)),
    daysBefore: median(anchors.map((entry) => entry.anchor - entry.run.first)),
    daysAfter: median(anchors.map((entry) => entry.run.last - entry.anchor)),
    closureType: mode(anchorRows.map((row) => row.closureType)),
    // Routes change between years; the most recent one is the best guess.
    locations: [
      ...new Set(latest.run.rows.flatMap((row) => splitLocations(row.location))),
    ],
    geometry: null,
  };
}

export function detectRecurringSeries(
  occurrences: HistoricalOccurrence[],
  options: DetectOptions,
): ForecastSeries[] {
  const resolved: Required<DetectOptions> = {
    minYears: 3,
    minRatio: 0.6,
    recentYears: 2,
    ...options,
  };
  const groups = new Map<string, HistoricalOccurrence[]>();
  for (const occurrence of occurrences) {
    const name = normalizeSeriesName(occurrence.name);
    if (name.length < 3 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(occurrence.start)) {
      continue;
    }
    const key = `${name}|${occurrence.borough.toLowerCase()}`;
    groups.set(key, [...(groups.get(key) || []), occurrence]);
  }
  const series = [...groups.values()]
    .map((rows) => detectOne(rows, resolved))
    .filter((value): value is ForecastSeries => value !== null);
  // Distinct groups can collapse to the same slug; keep ids unique.
  const seen = new Map<string, number>();
  return series
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((entry) => {
      const count = seen.get(entry.id) || 0;
      seen.set(entry.id, count + 1);
      return count ? { ...entry, id: `${entry.id}-${count + 1}` } : entry;
    });
}

export type ForecastPrediction = {
  series: ForecastSeries;
  /** The recurring day itself, e.g. Thanksgiving. */
  date: string;
  /** First and last calendar day the closure is expected to cover. */
  from: string;
  to: string;
};

/** Series expected to be active on any day in [from, to] (inclusive). */
export function predictionsBetween(
  series: ForecastSeries[],
  from: string,
  to: string,
): ForecastPrediction[] {
  const firstYear = parseDate(from).year;
  const lastYear = parseDate(to).year;
  const predictions: ForecastPrediction[] = [];
  for (const entry of series) {
    for (let year = firstYear - 1; year <= lastYear + 1; year += 1) {
      const date = ruleDate(entry.rule, year);
      if (!date) continue;
      const start = addDays(date, -entry.daysBefore);
      const end = addDays(date, entry.daysAfter);
      if (start <= to && end >= from) {
        predictions.push({ series: entry, date, from: start, to: end });
      }
    }
  }
  return predictions.sort(
    (a, b) => a.date.localeCompare(b.date) || a.series.title.localeCompare(b.series.title),
  );
}
