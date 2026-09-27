import { NYC_ROUTE_BOUNDS } from "@/lib/routing/validation";
import type { GeocodeResult } from "./types";

type ProviderFeature = {
  type?: string;
  id?: string;
  geometry?: {
    type?: string;
    coordinates?: unknown;
  };
  properties?: {
    label?: unknown;
    name?: unknown;
    street?: unknown;
    housenumber?: unknown;
    locality?: unknown;
    borough?: unknown;
    county?: unknown;
    region?: unknown;
    region_a?: unknown;
    confidence?: unknown;
  };
};

export type ProviderResponse = {
  features?: ProviderFeature[];
};

const MAX_RESULTS = 5;
const NYC_COUNTIES = new Set([
  "new york",
  "kings",
  "queens",
  "bronx",
  "richmond",
]);
const NYC_BOROUGHS = new Set([
  "manhattan",
  "brooklyn",
  "queens",
  "bronx",
  "staten island",
]);

function isCoordinate(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every(
      (part) => typeof part === "number" && Number.isFinite(part),
    )
  );
}

function inNewYorkCity([longitude, latitude]: [number, number]) {
  return (
    longitude >= NYC_ROUTE_BOUNDS.west &&
    longitude <= NYC_ROUTE_BOUNDS.east &&
    latitude >= NYC_ROUTE_BOUNDS.south &&
    latitude <= NYC_ROUTE_BOUNDS.north
  );
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function hasNycAddress(properties: NonNullable<ProviderFeature["properties"]>) {
  const region = stringValue(properties.region).toLowerCase();
  const regionAbbreviation = stringValue(properties.region_a).toLowerCase();
  if (
    (region && region !== "new york") ||
    (regionAbbreviation && regionAbbreviation !== "ny")
  ) {
    return false;
  }
  const county = stringValue(properties.county)
    .toLowerCase()
    .replace(/ county$/, "");
  if (county) return NYC_COUNTIES.has(county);
  const borough = stringValue(properties.borough).toLowerCase();
  if (borough) return NYC_BOROUGHS.has(borough);
  const locality = stringValue(properties.locality).toLowerCase();
  return locality === "new york" || NYC_BOROUGHS.has(locality);
}

function resultLabel(feature: ProviderFeature) {
  const properties = feature.properties || {};
  const label = stringValue(properties.label);
  if (label) return label;
  const street = stringValue(properties.street);
  const houseNumber = stringValue(properties.housenumber);
  const locality =
    stringValue(properties.locality) ||
    stringValue(properties.county) ||
    stringValue(properties.region);
  return [houseNumber, street, locality].filter(Boolean).join(", ");
}

function searchName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function relevance(name: string, query: string) {
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  if (name.includes(query)) return 2;
  return 3;
}

export function parseResults(
  body: ProviderResponse,
  query: string,
): GeocodeResult[] {
  const normalizedQuery = searchName(query);
  const seenLabels = new Set<string>();
  return (body.features || [])
    .map((feature, index) => {
      const coordinate = feature.geometry?.coordinates;
      const label = resultLabel(feature);
      if (
        feature.geometry?.type !== "Point" ||
        !isCoordinate(coordinate) ||
        !inNewYorkCity(coordinate) ||
        !hasNycAddress(feature.properties || {}) ||
        !label
      ) {
        return null;
      }
      const name = stringValue(feature.properties?.name) || label.split(",")[0];
      return {
        result: {
          id: stringValue(feature.id) || `${coordinate[0]},${coordinate[1]}`,
          label,
          coordinate,
        },
        rank: relevance(searchName(name), normalizedQuery),
        index,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .filter(({ result }) => {
      const key = searchName(result.label);
      if (seenLabels.has(key)) return false;
      seenLabels.add(key);
      return true;
    })
    .map(({ result }) => result)
    .slice(0, MAX_RESULTS);
}
