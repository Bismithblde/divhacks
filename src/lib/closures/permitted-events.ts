import { newYorkDateTimeInput, newYorkDateTimeToIso } from "./time";
import { titleCase } from "./normalize";
import type { ClosureFeature, SourceStatus } from "./types";
import { resolveEventLocations } from "./centerline";

export const PERMITTED_EVENTS_URL =
  "https://data.cityofnewyork.us/resource/tvpp-9vvx.json";
const PERMITTED_EVENTS_METADATA_URL =
  "https://data.cityofnewyork.us/api/views/tvpp-9vvx.json";
const SOURCE_ID = "permitted-events";
const SOURCE_LABEL = "NYC permitted events";
const CACHE_TTL = 5 * 60_000;

export type PermittedEventRecord = {
  event_id?: unknown;
  event_name?: unknown;
  start_date_time?: unknown;
  end_date_time?: unknown;
  event_agency?: unknown;
  event_type?: unknown;
  event_borough?: unknown;
  event_location?: unknown;
  street_closure_type?: unknown;
};

type Snapshot = {
  features: ClosureFeature[];
  status: SourceStatus;
  cachedAt: number;
};

let cached: Snapshot | null = null;
let pending: Promise<Snapshot> | null = null;

function text(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function timestamp(value: unknown) {
  const raw = text(value);
  if (!raw) return null;
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw)) {
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const local = raw.replace(" ", "T").slice(0, 16);
  const iso = newYorkDateTimeToIso(local);
  if (!iso) return null;
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : null;
}

function sourceWindow() {
  const now = Date.now();
  const start = newYorkDateTimeInput(0, now);
  const end = newYorkDateTimeInput(24 * 31, now);
  return { start, end };
}

async function readJson(url: string) {
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Permitted-events feed returned ${response.status}`);
  return (await response.json()) as unknown;
}

function queryUrl() {
  const { start, end } = sourceWindow();
  const params = new URLSearchParams({
    $select:
      "event_id,event_name,start_date_time,end_date_time,event_agency,event_type,event_borough,event_location,street_closure_type",
    $where: `street_closure_type != 'N/A' AND end_date_time >= '${start}' AND start_date_time <= '${end}'`,
    $order: "start_date_time ASC",
    $limit: "50000",
  });
  return `${PERMITTED_EVENTS_URL}?${params}`;
}

export function impactFor(closureType: string): {
  pedestrianImpact: "unknown" | "blocked" | "open";
  vehicleImpact: "unknown" | "blocked" | "clear";
} {
  const normalized = closureType.toLowerCase();
  const pedestrianImpact =
    normalized.includes("sidewalk") || normalized === "pedestrian plaza"
      ? "blocked"
      : normalized === "curb lane only"
        ? "open"
        : "unknown";
  const vehicleImpact =
    normalized === "full street closure" ||
    normalized === "sidewalk and street closure"
      ? "blocked"
      : normalized.includes("sidewalk") ||
          normalized === "curb lane only" ||
          normalized === "pedestrian plaza"
        ? "clear"
        : "unknown";
  return { pedestrianImpact, vehicleImpact };
}

export function normalizePermittedEvent(
  record: PermittedEventRecord,
  geometry: ClosureFeature["geometry"] | null,
): ClosureFeature | null {
  const id = text(record.event_id);
  const start = timestamp(record.start_date_time);
  const end = timestamp(record.end_date_time);
  if (!id || !geometry || start === null || end === null || end < start)
    return null;
  const closureType = text(record.street_closure_type);
  const impacts = impactFor(closureType);
  const properties = {
    id: `${SOURCE_ID}-${id}`,
    title: text(record.event_name) || "Permitted street event",
    location: titleCase(record.event_location) || "Unmapped permitted event",
    borough: titleCase(record.event_borough) || "NYC",
    kind: "event" as const,
    category: text(record.event_type) || "Street event",
    start,
    end,
    eventStart: start,
    eventEnd: end,
    permitStatus: "Scheduled",
    source: SOURCE_LABEL,
    sourceUrl: PERMITTED_EVENTS_URL,
    pedestrianImpact: impacts.pedestrianImpact as
      | "unknown"
      | "blocked"
      | "open",
    vehicleImpact: impacts.vehicleImpact as
      | "unknown"
      | "blocked"
      | "clear",
  };
  return {
    type: "Feature",
    id: properties.id,
    geometry,
    properties,
  };
}

async function fetchSnapshot(): Promise<Snapshot> {
  const [raw, metadata] = await Promise.all([
    readJson(queryUrl()),
    readJson(PERMITTED_EVENTS_METADATA_URL).catch(() => null),
  ]);
  if (!Array.isArray(raw)) throw new Error("Permitted-events feed returned invalid data");
  const records = raw.filter(
    (record): record is PermittedEventRecord =>
      Boolean(record && typeof record === "object"),
  );
  const geometries = await resolveEventLocations(
    records.map((record) => ({
      location: text(record.event_location),
      borough: text(record.event_borough),
    })),
  );
  const features = records
    .map((record, index) => normalizePermittedEvent(record, geometries[index]))
    .filter((feature): feature is ClosureFeature => feature !== null);
  const fetchedAt = new Date().toISOString();
  const updated =
    metadata &&
    typeof metadata === "object" &&
    typeof (metadata as { rowsUpdatedAt?: unknown }).rowsUpdatedAt === "number"
      ? new Date(
          (metadata as { rowsUpdatedAt: number }).rowsUpdatedAt * 1000,
        ).toISOString()
      : null;
  return {
    features,
    cachedAt: Date.now(),
    status: {
      id: SOURCE_ID,
      label: SOURCE_LABEL,
      url: PERMITTED_EVENTS_URL,
      status: "ok",
      fetchedAt,
      updatedAt: updated,
      total: records.length,
      unmapped: records.length - features.length,
    },
  };
}

export async function loadPermittedEventSource(): Promise<Snapshot> {
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL) return cached;
  if (pending) return pending;
  pending = (async () => {
    try {
      const snapshot = await fetchSnapshot();
      cached = snapshot;
      return snapshot;
    } catch (error) {
      console.error(
        `Closure source ${SOURCE_ID}:`,
        error instanceof Error ? error.message : "unavailable",
      );
      return {
        features: [],
        cachedAt: 0,
        status: {
          id: SOURCE_ID,
          label: SOURCE_LABEL,
          url: PERMITTED_EVENTS_URL,
          status: "unavailable",
          fetchedAt: null,
          updatedAt: null,
          total: 0,
          unmapped: 0,
          message: "This permitted-events feed could not be loaded. Retry shortly.",
        },
      };
    } finally {
      pending = null;
    }
  })();
  return pending;
}
