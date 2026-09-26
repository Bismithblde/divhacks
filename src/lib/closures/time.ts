export const NYC_TIME_ZONE = "America/New_York";

type DateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const partsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: NYC_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

const labelFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: NYC_TIME_ZONE,
  weekday: "short",
  month: "short",
  day: "numeric",
});
const timeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: NYC_TIME_ZONE,
  hour: "numeric",
  minute: "2-digit",
});
const hourAriaFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: NYC_TIME_ZONE,
  weekday: "long",
  month: "long",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function dateParts(value: Date | number): DateParts {
  const parts = Object.fromEntries(
    partsFormatter
      .formatToParts(value)
      .filter(({ type }) => type !== "literal")
      .map(({ type, value: part }) => [type, Number(part)]),
  ) as Record<string, number>;
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

function timeZoneOffset(value: Date): number {
  const parts = dateParts(value);
  return (
    Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    ) - value.getTime()
  );
}

export type NewYorkHourWindow = {
  start: number;
  end: number;
  label: string;
  ariaLabel: string;
};

export function newYorkHourWindow(
  hourOffset: number,
  now = Date.now(),
): NewYorkHourWindow {
  const start = now + hourOffset * 60 * 60 * 1000;
  const end = start + 60 * 60 * 1000;
  const current = dateParts(now);
  const selected = dateParts(start);
  const sameDay =
    current.year === selected.year &&
    current.month === selected.month &&
    current.day === selected.day;
  const tomorrow = new Date(now + 24 * 60 * 60 * 1000);
  const tomorrowParts = dateParts(tomorrow);
  const isTomorrow =
    tomorrowParts.year === selected.year &&
    tomorrowParts.month === selected.month &&
    tomorrowParts.day === selected.day;
  const dayLabel =
    hourOffset === 0
      ? "Now"
      : sameDay
        ? "Today"
        : isTomorrow
          ? "Tomorrow"
          : labelFormatter.format(new Date(start));
  return {
    start,
    end,
    label: `${dayLabel} · ${timeFormatter.format(new Date(start))}`,
    ariaLabel: `${hourAriaFormatter.format(new Date(start))} Eastern time`,
  };
}

export function newYorkDateTimeInput(
  hourOffset = 0,
  now = Date.now(),
): string {
  const selected = dateParts(now + hourOffset * 60 * 60 * 1000);
  return `${selected.year.toString().padStart(4, "0")}-${selected.month
    .toString()
    .padStart(2, "0")}-${selected.day.toString().padStart(2, "0")}T${selected.hour
    .toString()
    .padStart(2, "0")}:${selected.minute.toString().padStart(2, "0")}`;
}

export function newYorkDateTimeToIso(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match.map(Number);
  const utcDay = Date.UTC(year, month - 1, day);
  const offset = timeZoneOffset(new Date(utcDay + 4 * 60 * 60 * 1000));
  const timestamp =
    utcDay - offset + (hour * 60 + minute) * 60 * 1000;
  return new Date(timestamp).toISOString();
}

export const TIMELINE_HOURS = 7 * 24;
