import type { GeocodeResponse } from "@/lib/geocoding/types";
import {
  parseResults,
  type ProviderResponse,
} from "@/lib/geocoding/parse";
import { NYC_ROUTE_BOUNDS } from "@/lib/routing/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OPENROUTESERVICE_GEOCODE_URL =
  "https://api.heigit.org/pelias/v1/search";
const MAX_QUERY_LENGTH = 120;
const PROVIDER_RESULTS = 12;
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
    size: String(PROVIDER_RESULTS),
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
      { results: parseResults(body, query) } satisfies GeocodeResponse,
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
