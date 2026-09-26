import { NYC_ROUTE_BOUNDS } from "@/lib/routing/validation";
import type { GeocodeResponse, GeocodeResult } from "@/lib/geocoding/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OPENROUTESERVICE_GEOCODE_URL =
  "https://api.openrouteservice.org/geocode/search";
const MAX_QUERY_LENGTH = 120;
const MAX_RESULTS = 5;

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
    county?: unknown;
    region?: unknown;
    confidence?: unknown;
  };
};

type ProviderResponse = {
  features?: ProviderFeature[];
};

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

function parseResults(body: ProviderResponse): GeocodeResult[] {
  return (body.features || [])
    .map((feature) => {
      const coordinate = feature.geometry?.coordinates;
      const label = resultLabel(feature);
      if (
        feature.geometry?.type !== "Point" ||
        !isCoordinate(coordinate) ||
        !inNewYorkCity(coordinate) ||
        !label
      ) {
        return null;
      }
      return {
        id: stringValue(feature.id) || `${coordinate[0]},${coordinate[1]}`,
        label,
        coordinate,
      };
    })
    .filter((result): result is GeocodeResult => result !== null)
    .slice(0, MAX_RESULTS);
}

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim() || "";
  if (query.length < 2 || query.length > MAX_QUERY_LENGTH) {
    return Response.json(
      {
        results: [],
        error: "Search for at least 2 and no more than 120 characters.",
      } satisfies GeocodeResponse,
      { status: 400 },
    );
  }

  const key = process.env.OPENROUTESERVICE_API_KEY;
  if (!key) {
    return Response.json(
      {
        results: [],
        error:
          "Address search is not configured. Add OPENROUTESERVICE_API_KEY on the server.",
      } satisfies GeocodeResponse,
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const url = new URL(OPENROUTESERVICE_GEOCODE_URL);
  url.search = new URLSearchParams({
    api_key: key,
    text: query,
    size: String(MAX_RESULTS),
    "boundary.rect.min_lon": String(NYC_ROUTE_BOUNDS.west),
    "boundary.rect.min_lat": String(NYC_ROUTE_BOUNDS.south),
    "boundary.rect.max_lon": String(NYC_ROUTE_BOUNDS.east),
    "boundary.rect.max_lat": String(NYC_ROUTE_BOUNDS.north),
  }).toString();

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
  } catch {
    return Response.json(
      {
        results: [],
        error: "The address search provider could not be reached.",
      } satisfies GeocodeResponse,
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (!response.ok) {
    return Response.json(
      {
        results: [],
        error: "The address search provider returned an error.",
      } satisfies GeocodeResponse,
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const body = (await response.json()) as ProviderResponse;
    return Response.json(
      { results: parseResults(body) } satisfies GeocodeResponse,
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      {
        results: [],
        error: "The address search provider returned unreadable results.",
      } satisfies GeocodeResponse,
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
