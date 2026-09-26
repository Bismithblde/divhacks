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

function newYorkMidnight(dayOffset: number, now: number): number {
  const today = dateParts(now);
  const utcDay = Date.UTC(today.year, today.month - 1, today.day + dayOffset);
  // Four UTC hours is close to NYC midnight and stays on the pre-transition
  // side of daylight-saving changes that occur during the early morning.
  const offset = timeZoneOffset(new Date(utcDay + 4 * 60 * 60 * 1000));
  return utcDay - offset;
}

export type NewYorkDayWindow = {
  start: number;
  end: number;
  label: string;
  ariaLabel: string;
};

export function newYorkDayWindow(
  dayOffset: number,
  now = Date.now(),
): NewYorkDayWindow {
  const start = newYorkMidnight(dayOffset, now);
  const end = newYorkMidnight(dayOffset + 1, now);
  const ariaLabel = labelFormatter.format(new Date(start + 12 * 60 * 60 * 1000));
  return {
    start,
    end,
    label:
      dayOffset === 0
        ? `Today · ${ariaLabel.slice(5)}`
        : dayOffset === 1
          ? `Tomorrow · ${ariaLabel.slice(5)}`
          : ariaLabel,
    ariaLabel,
  };
}

export function newYorkDateTimeInput(
  dayOffset = 0,
  now = Date.now(),
): string {
  const day = dateParts(newYorkDayWindow(dayOffset, now).start);
  const current = dateParts(now);
  const hour = current.hour.toString().padStart(2, "0");
  const minute = current.minute.toString().padStart(2, "0");
  return `${day.year.toString().padStart(4, "0")}-${day.month
    .toString()
    .padStart(2, "0")}-${day.day.toString().padStart(2, "0")}T${hour}:${minute}`;
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

export const TIMELINE_DAYS = 7;
