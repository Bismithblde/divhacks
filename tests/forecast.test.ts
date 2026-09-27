import test from "node:test";
import assert from "node:assert/strict";
import {
  describeRule,
  detectRecurringSeries,
  normalizeSeriesName,
  predictionsBetween,
  ruleDate,
  type HistoricalOccurrence,
} from "../src/lib/forecast/recurrence";

function occurrence(
  name: string,
  date: string,
  overrides: Partial<HistoricalOccurrence> = {},
): HistoricalOccurrence {
  return {
    name,
    borough: "Manhattan",
    location: "CENTRAL PARK WEST between WEST 77 STREET and WEST 81 STREET",
    start: `${date}T08:30`,
    end: `${date}T12:00`,
    closureType: "Full Street Closure",
    ...overrides,
  };
}

// Macy's parade days, each with a setup permit the day before.
const THANKSGIVINGS = [
  "2017-11-23", "2018-11-22", "2019-11-28", "2021-11-25",
  "2022-11-24", "2023-11-23", "2024-11-28", "2025-11-27",
];

function parade() {
  return THANKSGIVINGS.flatMap((date, index) => {
    const edition = 91 + index;
    const [year, month, day] = date.split("-").map(Number);
    const eve = new Date(Date.UTC(year, month - 1, day - 1))
      .toISOString()
      .slice(0, 10);
    return [
      occurrence(`${edition}th Annual Macys Thanksgiving Day Parade`, eve, {
        start: `${eve}T20:00`,
        end: `${eve}T23:00`,
      }),
      occurrence(`${edition}th Annual Macys Thanksgiving Day Parade`, date),
      occurrence(`${edition}th Annual Macys Thanksgiving Day Parade`, date, {
        location: "6 AVENUE between WEST 59 STREET and WEST 34 STREET",
      }),
    ];
  });
}

test("rule dates follow weekday and fixed calendar rules", () => {
  const thanksgiving = { type: "nth-weekday", month: 11, weekday: 4, nth: 4 } as const;
  assert.equal(ruleDate(thanksgiving, 2026), "2026-11-26");
  assert.equal(ruleDate(thanksgiving, 2018), "2018-11-22");
  assert.equal(
    ruleDate({ type: "last-weekday", month: 5, weekday: 1 }, 2026),
    "2026-05-25",
  );
  assert.equal(ruleDate({ type: "fixed", month: 2, day: 29 }, 2026), null);
  assert.equal(describeRule(thanksgiving), "4th Thursday of November");
});

test("event names group across years and edition numbers", () => {
  assert.equal(
    normalizeSeriesName("99th Annual Macys Thanksgiving Day Parade"),
    normalizeSeriesName("Macy's Thanksgiving Day Parade 2019"),
  );
});

test("detects a fourth-Thursday event and its day-before setup", () => {
  const [series] = detectRecurringSeries(parade(), { asOf: "2026-09-26" });
  assert.ok(series);
  assert.equal(series.title, "Macys Thanksgiving Day Parade");
  assert.equal(series.ruleLabel, "4th Thursday of November");
  assert.equal(series.confidence, "high");
  assert.equal(series.daysBefore, 1);
  assert.equal(series.daysAfter, 0);
  assert.equal(series.startTime, "08:30");
  assert.equal(series.locations.length, 2);

  const [prediction] = predictionsBetween([series], "2026-11-26", "2026-11-26");
  assert.equal(prediction.date, "2026-11-26");
  assert.equal(prediction.from, "2026-11-25");
  assert.equal(predictionsBetween([series], "2026-11-27", "2026-12-31").length, 0);
});

test("fixed-date events keep their date", () => {
  const rows = [2019, 2021, 2022, 2023, 2024, 2025].map((year) =>
    occurrence("Independence Day Block Party", `${year}-07-04`),
  );
  const [series] = detectRecurringSeries(rows, { asOf: "2026-09-26" });
  assert.equal(series.ruleLabel, "Every July 4");
});

test("skips weekly events, one-offs, and events that stopped", () => {
  const weekly = [2023, 2024, 2025].flatMap((year) =>
    ["06-03", "06-10", "06-17", "06-24", "07-01", "07-08"].map((day) =>
      occurrence("Saturday Play Street", `${year}-${day}`),
    ),
  );
  const oneOff = [occurrence("Film Premiere", "2024-03-02")];
  const stopped = [2014, 2015, 2016, 2017].map((year) =>
    occurrence("Old Street Fair", `${year}-09-12`),
  );
  assert.deepEqual(
    detectRecurringSeries([...weekly, ...oneOff, ...stopped], {
      asOf: "2026-09-26",
    }),
    [],
  );
});

test("a missed 2020 does not count against an event", () => {
  const rows = [2017, 2018, 2019, 2021, 2022].map((year) =>
    occurrence("Harbor Festival", `${year}-06-15`),
  );
  const [series] = detectRecurringSeries(rows, { asOf: "2022-12-31" });
  assert.equal(series.yearsExpected, 5);
});
