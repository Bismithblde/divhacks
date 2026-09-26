import type {
  ClosureFeature,
  ClosureGeometry,
  ClosureProperties,
} from "./types";

export type SourceDefinition = {
  id: string;
  label: string;
  path: string;
  kind: "event" | "construction";
};
export const SOURCE_ROOT =
  "https://services6.arcgis.com/yG5s3afENB5iO9fj/arcgis/rest/services/";
export const SOURCES: SourceDefinition[] = [
  {
    id: "events",
    label: "Event street closures",
    path: "Street_Closure_Events_PROD_view/FeatureServer/1",
    kind: "event",
  },
  {
    id: "blocks",
    label: "Construction blocks",
    path: "Street_Closure_Block_PROD_view/FeatureServer/4",
    kind: "construction",
  },
  {
    id: "intersections",
    label: "Construction intersections",
    path: "Street_Closure_Intersection_PROD_view/FeatureServer/3",
    kind: "construction",
  },
];
const BOROUGHS: Record<string, string> = {
  M: "Manhattan",
  B: "Brooklyn",
  K: "Brooklyn",
  X: "Bronx",
  Q: "Queens",
  S: "Staten Island",
};
const text = (value: unknown) =>
  typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
export function titleCase(value: unknown): string {
  const s = text(value);
  return s && s === s.toUpperCase()
    ? s
        .toLowerCase()
        .replace(/\b\w/g, (c) => c.toUpperCase())
        .replace(/\bDot\b/g, "DOT")
    : s;
}
function timestamp(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}
export function validGeometry(value: unknown): value is ClosureGeometry {
  if (!value || typeof value !== "object") return false;
  const g = value as ClosureGeometry;
  const point = (p: unknown): boolean =>
    Array.isArray(p) &&
    p.length >= 2 &&
    Number.isFinite(p[0]) &&
    Number.isFinite(p[1]) &&
    p[0] >= -74.3 &&
    p[0] <= -73.65 &&
    p[1] >= 40.45 &&
    p[1] <= 40.95;
  const line = (l: unknown): boolean =>
    Array.isArray(l) && l.length >= 2 && l.every(point);
  return g.type === "Point"
    ? point(g.coordinates)
    : g.type === "LineString"
      ? line(g.coordinates)
      : g.type === "MultiLineString" &&
        Array.isArray(g.coordinates) &&
        g.coordinates.length > 0 &&
        g.coordinates.every(line);
}
export function normalizeFeature(
  raw: unknown,
  source: SourceDefinition,
): ClosureFeature | null {
  if (!raw || typeof raw !== "object") return null;
  const f = raw as { geometry?: unknown; properties?: Record<string, unknown> };
  const p = f.properties;
  if (!p || !validGeometry(f.geometry) || !Number.isInteger(p.OBJECTID))
    return null;
  const isEvent = source.kind === "event";
  const eventStart = timestamp(p.R_EventStartDate),
    eventEnd = timestamp(p.R_EventEndDate);
  const starts = [eventStart, timestamp(p.R_EventSetupStartDate)].filter(
    (v): v is number => v !== null,
  );
  const ends = [eventEnd, timestamp(p.R_EventBreakDownEndDate)].filter(
    (v): v is number => v !== null,
  );
  const start = isEvent
    ? starts.length
      ? Math.min(...starts)
      : null
    : timestamp(p.Work_Start_Date);
  const end = isEvent
    ? ends.length
      ? Math.max(...ends)
      : null
    : timestamp(p.Work_End_Date);
  if (start === null || end === null || end < start) return null;
  const street = titleCase(p.OnStreetName),
    from = titleCase(p.FromStreetName),
    to = titleCase(p.ToStreetName);
  const properties: ClosureProperties = {
    id: `${source.id}-${p.OBJECTID}`,
    title: isEvent
      ? text(p.EventName) || "Permitted street event"
      : street || "Street construction",
    location: isEvent
      ? text(p.Location) || "City-mapped event footprint"
      : to
        ? `${from} to ${to}`
        : from
          ? `At ${from}`
          : "City-mapped street segment",
    borough: BOROUGHS[text(p.Borough_Code)] || "NYC",
    kind: source.kind,
    category: isEvent
      ? text(p.EventTypeDescription) || "Street event"
      : titleCase(p.Purpose) || "Construction",
    start,
    end,
    eventStart: isEvent ? eventStart : null,
    eventEnd: isEvent ? eventEnd : null,
    permitStatus: isEvent
      ? text(p.EventStatusName) || "Not supplied"
      : "Permit window",
    source: source.label,
    sourceUrl: `${SOURCE_ROOT}${source.path}`,
    pedestrianImpact: "unknown",
    vehicleImpact: "unknown",
  };
  return {
    type: "Feature",
    id: properties.id,
    geometry: f.geometry,
    properties,
  };
}
export function overlaps(feature: ClosureFeature, start: number, end: number) {
  return feature.properties.start < end && feature.properties.end >= start;
}
export function activeAt(feature: ClosureFeature, timestamp: number) {
  return (
    feature.properties.start <= timestamp &&
    feature.properties.end >= timestamp
  );
}
export function geometryBounds(
  geometry: ClosureGeometry,
): [number, number, number, number] {
  const points =
    geometry.type === "Point"
      ? [geometry.coordinates]
      : geometry.type === "LineString"
        ? geometry.coordinates
        : geometry.coordinates.flat();
  let west = Infinity,
    south = Infinity,
    east = -Infinity,
    north = -Infinity;
  for (const p of points) {
    west = Math.min(west, p[0]);
    south = Math.min(south, p[1]);
    east = Math.max(east, p[0]);
    north = Math.max(north, p[1]);
  }
  return [west, south, east, north];
}
export function inBounds(feature: ClosureFeature, bounds: number[]) {
  const [w, s, e, n] = geometryBounds(feature.geometry);
  return e >= bounds[0] && w <= bounds[2] && n >= bounds[1] && s <= bounds[3];
}
