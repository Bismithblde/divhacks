// One-off: downloads NYC's historical permitted-event archive, finds events
// that recur on the same calendar rule every year, and writes the result to
// src/data/forecast.json. The app only reads that file; re-run this (roughly
// yearly) when the city publishes more history, then commit the output.
//
//   npx tsx scripts/build-forecast.ts

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveEventLocations } from "../src/lib/closures/centerline";
import type { ClosureGeometry } from "../src/lib/closures/types";
import {
  detectRecurringSeries,
  type ForecastFile,
  type HistoricalOccurrence,
} from "../src/lib/forecast/recurrence";

const HISTORY_URL = "https://data.cityofnewyork.us/resource/bkfu-528j.json";
// The archive is sparse before 2013.
const HISTORY_FROM = "2013-01-01";
const PAGE_SIZE = 50_000;
const OUTPUT = path.join(process.cwd(), "src/data/forecast.json");

type HistoryRow = {
  event_name?: string;
  start_date_time?: string;
  end_date_time?: string;
  event_borough?: string;
  event_location?: string;
  street_closure_type?: string;
};

async function fetchPage(offset: number): Promise<HistoryRow[]> {
  const params = new URLSearchParams({
    $select:
      "event_name,start_date_time,end_date_time,event_borough,event_location,street_closure_type",
    $where: `street_closure_type != 'N/A' AND start_date_time >= '${HISTORY_FROM}T00:00:00'`,
    $order: ":id",
    $limit: String(PAGE_SIZE),
    $offset: String(offset),
  });
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await fetch(`${HISTORY_URL}?${params}`, {
        signal: AbortSignal.timeout(120_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return (await response.json()) as HistoryRow[];
    } catch (error) {
      if (attempt >= 3) throw error;
      console.warn(`  page at ${offset} failed (${String(error)}), retrying…`);
      await new Promise((resolve) => setTimeout(resolve, attempt * 5_000));
    }
  }
}

function toOccurrence(row: HistoryRow): HistoricalOccurrence | null {
  if (!row.event_name || !row.start_date_time || !row.end_date_time) return null;
  return {
    name: row.event_name.trim(),
    borough: (row.event_borough || "NYC").trim(),
    location: (row.event_location || "").trim(),
    // Socrata floating timestamps are already NYC local time.
    start: row.start_date_time.slice(0, 16),
    end: row.end_date_time.slice(0, 16),
    closureType: (row.street_closure_type || "").trim(),
  };
}

function roundGeometry(geometry: ClosureGeometry): ClosureGeometry {
  const round = (value: number) => Math.round(value * 1e5) / 1e5;
  const point = ([x, y]: number[]) => [round(x), round(y)];
  if (geometry.type === "Point") {
    return { ...geometry, coordinates: point(geometry.coordinates) };
  }
  if (geometry.type === "LineString") {
    return { ...geometry, coordinates: geometry.coordinates.map(point) };
  }
  return {
    ...geometry,
    coordinates: geometry.coordinates.map((line) => line.map(point)),
  };
}

function newYorkToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
  }).format(new Date());
}

async function main() {
  const occurrences: HistoricalOccurrence[] = [];
  let latest = "";
  for (let offset = 0; ; offset += PAGE_SIZE) {
    console.log(`Downloading rows ${offset.toLocaleString()}+ …`);
    const page = await fetchPage(offset);
    for (const row of page) {
      const occurrence = toOccurrence(row);
      if (!occurrence) continue;
      occurrences.push(occurrence);
      if (occurrence.start > latest) latest = occurrence.start;
    }
    if (page.length < PAGE_SIZE) break;
  }
  console.log(`Downloaded ${occurrences.length.toLocaleString()} closure permits.`);

  const asOf = newYorkToday();
  const series = detectRecurringSeries(occurrences, { asOf });
  console.log(`Found ${series.length} recurring events. Mapping streets…`);

  const geometries = await resolveEventLocations(
    series.map((entry) => ({
      location: entry.locations.join(", "),
      borough: entry.borough,
    })),
  );
  let mapped = 0;
  for (const [index, entry] of series.entries()) {
    const geometry = geometries[index];
    if (geometry) {
      entry.geometry = roundGeometry(geometry);
      mapped += 1;
    }
  }

  const output: ForecastFile = {
    generatedAt: new Date().toISOString(),
    source: HISTORY_URL,
    historyFrom: HISTORY_FROM,
    historyTo: latest.slice(0, 10),
    series,
  };
  await mkdir(path.dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, `${JSON.stringify(output)}\n`);
  console.log(
    `Wrote ${series.length} events (${mapped} with street geometry) to ${path.relative(process.cwd(), OUTPUT)}.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
