import type { FeatureCollection } from "geojson";
import type { RouteRequest, RouteFeature } from "./types";
import {
  buildAvoidancePolygons,
  routeIntersectsObstacles,
} from "./obstacles";
import type { ClosureFeature } from "@/lib/closures/types";

const OPENROUTESERVICE_URL =
  "https://api.openrouteservice.org/v2/directions/foot-walking/geojson";
const REQUEST_TIMEOUT_MS = 20_000;

export class RouteProviderError extends Error {
  constructor(
    message: string,
    public readonly code: "unavailable" | "no-route" | "invalid",
  ) {
    super(message);
  }
}

type ProviderFeatureCollection = FeatureCollection & {
  features?: Array<{
    type: "Feature";
    geometry?: { type?: string; coordinates?: unknown };
    properties?: {
      summary?: { duration?: number; distance?: number };
    };
  }>;
};

function parseRoutes(body: ProviderFeatureCollection): RouteFeature[] {
  return (body.features || [])
    .filter(
      (feature) =>
        feature.geometry?.type === "LineString" &&
        Array.isArray(feature.geometry.coordinates) &&
        typeof feature.properties?.summary?.duration === "number" &&
        typeof feature.properties?.summary?.distance === "number",
    )
    .map((feature) => {
      const geometry = feature.geometry as {
        type: "LineString";
        coordinates: [number, number][];
      };
      return {
        type: "Feature" as const,
        geometry: {
          type: "LineString" as const,
          coordinates: geometry.coordinates,
        },
        properties: {
          provider: "openrouteservice",
          durationSeconds: feature.properties!.summary!.duration!,
          distanceMeters: feature.properties!.summary!.distance!,
        },
      };
    })
    .sort(
      (a, b) =>
        a.properties.durationSeconds - b.properties.durationSeconds,
    );
}

async function requestRoutes(
  request: RouteRequest,
  obstacles: ClosureFeature[],
  bufferMeters: number,
): Promise<RouteFeature[]> {
  const key = process.env.OPENROUTESERVICE_API_KEY;
  if (!key) {
    throw new RouteProviderError(
      "Walking routing is not configured on this server.",
      "unavailable",
    );
  }
  const polygon = buildAvoidancePolygons(obstacles, bufferMeters);
  const payload: Record<string, unknown> = {
    coordinates: [request.origin, request.destination],
    instructions: false,
    alternative_routes: {
      target_count: 2,
      weight_factor: 1.4,
      share_factor: 0.6,
    },
  };
  if (polygon.coordinates.length) {
    payload.options = { avoid_polygons: polygon };
  }

  let response: Response;
  try {
    response = await fetch(OPENROUTESERVICE_URL, {
      method: "POST",
      headers: {
        Authorization: key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    throw new RouteProviderError(
      "The walking routing provider could not be reached.",
      "unavailable",
    );
  }
  if (response.status === 404 || response.status === 406) {
    throw new RouteProviderError(
      "The routing provider could not find a walking route.",
      "no-route",
    );
  }
  if (!response.ok) {
    throw new RouteProviderError(
      "The walking routing provider returned an error.",
      "unavailable",
    );
  }
  let body: ProviderFeatureCollection;
  try {
    body = (await response.json()) as ProviderFeatureCollection;
  } catch {
    throw new RouteProviderError(
      "The routing provider returned unreadable route data.",
      "invalid",
    );
  }
  const routes = parseRoutes(body);
  if (!routes.length) {
    throw new RouteProviderError(
      "The routing provider returned no walking route.",
      "no-route",
    );
  }
  return routes;
}

export async function findWalkingRoute(
  request: RouteRequest,
  hardObstacles: ClosureFeature[],
) {
  const buffers = hardObstacles.length ? [12, 24] : [0];
  let verificationAttempts = 0;
  let lastRoutes: RouteFeature[] = [];
  for (const buffer of buffers) {
    verificationAttempts += 1;
    const routes = await requestRoutes(request, hardObstacles, buffer);
    lastRoutes = routes;
    const clear = routes.find(
      (route) => !routeIntersectsObstacles(route, hardObstacles, buffer),
    );
    if (clear) return { route: clear, verificationAttempts };
  }
  if (lastRoutes.length) {
    throw new RouteProviderError(
      "The returned walking routes could not be verified around the selected obstacles.",
      "no-route",
    );
  }
  throw new RouteProviderError(
    "No verified walking route is available.",
    "no-route",
  );
}
