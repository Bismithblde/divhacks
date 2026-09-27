import {
  geometryBounds,
  normalizeFeature,
  SOURCE_ROOT,
  SOURCES,
  type SourceDefinition,
} from "./normalize";
import { loadPermittedEventSource } from "./permitted-events";
import type { ClosureFeature, SourceStatus } from "./types";

const TTL = 5 * 60_000;
const CHUNK_SIZE = 100;
type Snapshot = {
  features: ClosureFeature[];
  status: SourceStatus;
  cachedAt: number;
};
const cache = new Map<string, Snapshot>();
const inFlight = new Map<string, Promise<Snapshot>>();

export async function readJson(url: string) {
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`City feed returned ${response.status}`);
  const data = await response.json();
  if (data.error)
    throw new Error(`City feed error: ${data.error.code || "unknown"}`);
  return data;
}

// Freeze the ID set first, then fetch every batch: never silently accept the
// ArcGIS default record cap. A feed republish during a read triggers a retry.
export async function fetchSource(source: SourceDefinition): Promise<Snapshot> {
  const base = `${SOURCE_ROOT}${source.path}`;
  const [metadata, index] = await Promise.all([
    readJson(`${base}?f=json`),
    readJson(
      `${base}/query?${new URLSearchParams({ f: "json", where: "1=1", returnIdsOnly: "true" })}`,
    ),
  ]);
  if (!Array.isArray(index.objectIds))
    throw new Error("City feed returned no record index");
  const ids = [...new Set<number>(index.objectIds)];
  if (ids.length > 100_000)
    throw new Error("City feed exceeds the supported record count");
  const raw = [];
  // Three simultaneous batches bound upstream load while keeping cold starts short.
  for (let offset = 0; offset < ids.length; offset += CHUNK_SIZE * 3) {
    const pages = await Promise.all(
      [0, 1, 2].map(async (batch) => {
        const slice = ids.slice(
          offset + batch * CHUNK_SIZE,
          offset + (batch + 1) * CHUNK_SIZE,
        );
        if (!slice.length) return [];
        const q = new URLSearchParams({
          f: "geojson",
          objectIds: slice.join(","),
          outFields: "*",
          outSR: "4326",
          geometryPrecision: "6",
          returnGeometry: "true",
        });
        const data = await readJson(`${base}/query?${q}`);
        if (
          !Array.isArray(data.features) ||
          data.properties?.exceededTransferLimit ||
          data.exceededTransferLimit
        )
          throw new Error("City feed returned an incomplete page");
        return data.features;
      }),
    );
    raw.push(...pages.flat());
  }
  const returnedIds = new Set(raw.map((f) => f.properties?.OBJECTID));
  if (
    returnedIds.size !== ids.length ||
    !ids.every((id) => returnedIds.has(id))
  )
    throw new Error("City feed changed while loading; retry required");
  const after = await readJson(`${base}?f=json`);
  if (
    metadata.editingInfo?.dataLastEditDate !==
    after.editingInfo?.dataLastEditDate
  )
    throw new Error("City feed was republished while loading");
  const features = raw
    .map((f) => normalizeFeature(f, source))
    .filter((f): f is ClosureFeature => f !== null);
  const fetchedAt = new Date().toISOString();
  const updated = metadata.editingInfo?.dataLastEditDate;
  return {
    features,
    cachedAt: Date.now(),
    status: {
      id: source.id,
      label: source.label,
      url: base,
      status: "ok",
      fetchedAt,
      updatedAt:
        typeof updated === "number" ? new Date(updated).toISOString() : null,
      total: ids.length,
      unmapped: raw.length - features.length,
    },
  };
}
async function load(source: SourceDefinition): Promise<Snapshot> {
  const previous = cache.get(source.id);
  if (previous && Date.now() - previous.cachedAt < TTL) return previous;
  const pending = inFlight.get(source.id);
  if (pending) return pending;
  const job = (async (): Promise<Snapshot> => {
    try {
      let snapshot: Snapshot;
      try {
        snapshot = await fetchSource(source);
      } catch {
        snapshot = await fetchSource(source);
      }
      cache.set(source.id, snapshot);
      return snapshot;
    } catch (error) {
      console.error(
        `Closure source ${source.id}:`,
        error instanceof Error ? error.message : "unavailable",
      );
      return {
        features: [],
        cachedAt: 0,
        status: {
          id: source.id,
          label: source.label,
          url: `${SOURCE_ROOT}${source.path}`,
          status: "unavailable",
          updatedAt: null,
          fetchedAt: null,
          total: 0,
          unmapped: 0,
          message: "This city feed could not be loaded. Retry shortly.",
        },
      } satisfies Snapshot;
    } finally {
      inFlight.delete(source.id);
    }
  })();
  inFlight.set(source.id, job);
  return job;
}
export async function getClosureSources() {
  return Promise.all([
    ...SOURCES.map(load),
    loadPermittedEventSource(),
  ]);
}

function comparableText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function boxesOverlap(first: ClosureFeature, second: ClosureFeature) {
  const [firstWest, firstSouth, firstEast, firstNorth] = geometryBounds(
    first.geometry,
  );
  const [secondWest, secondSouth, secondEast, secondNorth] = geometryBounds(
    second.geometry,
  );
  return (
    firstEast >= secondWest &&
    secondEast >= firstWest &&
    firstNorth >= secondSouth &&
    secondNorth >= firstSouth
  );
}

function duplicateOfPrimary(
  feature: ClosureFeature,
  primary: ClosureFeature[],
) {
  if (feature.properties.source !== "NYC permitted events") return false;
  const title = comparableText(feature.properties.title);
  const location = comparableText(feature.properties.location);
  return primary.some((candidate) => {
    if (
      candidate.properties.kind !== "event" ||
      !boxesOverlap(feature, candidate) ||
      candidate.properties.end < feature.properties.start ||
      feature.properties.end < candidate.properties.start
    )
      return false;
    const sameTitle =
      title.length > 4 &&
      title === comparableText(candidate.properties.title);
    const sameLocation =
      location.length > 8 &&
      location === comparableText(candidate.properties.location);
    return sameTitle || sameLocation;
  });
}

export function deduplicateClosureFeatures(features: ClosureFeature[]) {
  const primary = features.filter(
    (feature) => feature.properties.source !== "NYC permitted events",
  );
  return features.filter(
    (feature) => !duplicateOfPrimary(feature, primary),
  );
}
