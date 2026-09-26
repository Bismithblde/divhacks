import type { FeatureCollection } from "geojson";
import type {
  Coordinate,
  RouteMode,
  RouteRequest,
  RouteFeature,
} from "./types";
import {
  buildAvoidancePolygons,
  clipObstacleToRoute,
  coordinateInObstacle,
  nearestOpenPoint,
  routeIntersectsObstacles,
} from "./obstacles";
import type { ClosureFeature } from "@/lib/closures/types";

const OPENROUTESERVICE_URL: Record<RouteMode, string> = {
  "foot-walking":
    "https://api.openrouteservice.org/v2/directions/foot-walking/geojson",
  "driving-car":
    "https://api.openrouteservice.org/v2/directions/driving-car/geojson",
};
const REQUEST_TIMEOUT_MS = 20_000;
const CROSSING_METERS = 12;
const AVOID_BUFFER_METERS = 18;
const MAX_AVOID_POLYGONS = 80;
const MAX_ACCEPTED_DISRUPTIONS = 2;

function modeLabel(mode: RouteMode) {
  return mode === "driving-car" ? "driving" : "walking";
}

function impactIsBlocked(obstacle: ClosureFeature, mode: RouteMode) {
  return mode === "driving-car"
    ? obstacle.properties.vehicleImpact === "blocked"
    : obstacle.properties.pedestrianImpact === "blocked";
}

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
      `${modeLabel(request.mode)} routing is not configured on this server.`,
      "unavailable",
    );
  }
  const polygon = buildAvoidancePolygons(obstacles, bufferMeters);
  const payload: Record<string, unknown> = {
    coordinates: [request.origin, request.destination],
    instructions: false,
  };
  if (request.mode === "foot-walking") {
    payload.alternative_routes = {
      target_count: 2,
      weight_factor: 1.4,
      share_factor: 0.6,
    };
  }
  if (polygon.coordinates.length) {
    payload.options = { avoid_polygons: polygon };
  }

  let response: Response;
  try {
    response = await fetch(OPENROUTESERVICE_URL[request.mode], {
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
      `The ${modeLabel(request.mode)} routing provider could not be reached.`,
      "unavailable",
    );
  }
  if (response.status === 404 || response.status === 406) {
    throw new RouteProviderError(
      `The routing provider could not find a ${modeLabel(request.mode)} route.`,
      "no-route",
    );
  }
  if (!response.ok) {
    throw new RouteProviderError(
      response.status === 400
        ? `No ${modeLabel(request.mode)} route stays off the scheduled closures.`
        : `The ${modeLabel(request.mode)} routing provider returned an error.`,
      response.status === 400 ? "no-route" : "unavailable",
    );
  }
  let body: ProviderFeatureCollection;
  try {
    body = (await response.json()) as ProviderFeatureCollection;
  } catch {
    throw new RouteProviderError(
      `The ${modeLabel(request.mode)} routing provider returned unreadable route data.`,
      "invalid",
    );
  }
  const routes = parseRoutes(body);
  if (!routes.length) {
    throw new RouteProviderError(
      `The routing provider returned no ${modeLabel(request.mode)} route.`,
      "no-route",
    );
  }
  return routes;
}

function crossings(
  route: RouteFeature,
  obstacles: ClosureFeature[],
  request: RouteRequest,
) {
  const coordinates = route.geometry.coordinates as Coordinate[];
  return obstacles.filter((obstacle) => {
    for (let index = 1; index < coordinates.length; index += 1) {
      const start = coordinates[index - 1];
      const end = coordinates[index];
      const leavingOrigin =
        index === 1 &&
        coordinateInObstacle(request.origin, obstacle, CROSSING_METERS);
      const arriving =
        index === coordinates.length - 1 &&
        coordinateInObstacle(request.destination, obstacle, CROSSING_METERS);
      if (leavingOrigin || arriving) continue;
      const piece: RouteFeature = {
        ...route,
        geometry: { type: "LineString", coordinates: [start, end] },
      };
      if (routeIntersectsObstacles(piece, [obstacle], CROSSING_METERS)) {
        return true;
      }
    }
    return false;
  });
}

function avoidableClosures(
  obstacles: ClosureFeature[],
  route: RouteFeature,
  request: RouteRequest,
) {
  const clipped = obstacles
    .map((obstacle) =>
      clipObstacleToRoute(obstacle, route, 350, [
        request.origin,
        request.destination,
      ]),
    )
    .filter((obstacle): obstacle is ClosureFeature => obstacle !== null);
  const kept: ClosureFeature[] = [];
  for (const obstacle of clipped) {
    const polygons = buildAvoidancePolygons(
      [...kept, obstacle],
      AVOID_BUFFER_METERS,
    );
    if (polygons.coordinates.length > MAX_AVOID_POLYGONS) break;
    kept.push(obstacle);
  }
  return kept;
}

export async function findRoute(
  request: RouteRequest,
  hardObstacles: ClosureFeature[],
): Promise<{
  route: RouteFeature;
  verificationAttempts: number;
  verified: boolean;
  avoided: ClosureFeature[];
  destinationAdjusted: boolean;
}> {
  const openDestination = nearestOpenPoint(
    request.destination,
    hardObstacles,
  );
  if (!openDestination) {
    throw new RouteProviderError(
      `That point is inside a scheduled ${modeLabel(request.mode)} disruption. Choose a point on an open street.`,
      "no-route",
    );
  }
  const destinationAdjusted =
    openDestination[0] !== request.destination[0] ||
    openDestination[1] !== request.destination[1];
  const walkingRequest = { ...request, destination: openDestination };
  let verificationAttempts = 1;
  let routes = await requestRoutes(walkingRequest, [], 0);
  if (!hardObstacles.length) {
    return {
      route: routes[0],
      verificationAttempts,
      verified: true,
      avoided: [],
      destinationAdjusted,
    };
  }

  const clearBaseline = routes.find(
    (route) => crossings(route, hardObstacles, walkingRequest).length === 0,
  );
  if (clearBaseline) {
    return {
      route: clearBaseline,
      verificationAttempts,
      verified: true,
      avoided: [],
      destinationAdjusted,
    };
  }

  let avoidSet: ClosureFeature[] = [];
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const guide = routes[0];
    const hits = crossings(guide, hardObstacles, walkingRequest);
    avoidSet = [
      ...new Map(
        [...avoidSet, ...hits].map(
          (obstacle) => [obstacle.properties.id, obstacle] as const,
        ),
      ).values(),
    ];
    const avoid = avoidableClosures(avoidSet, guide, walkingRequest);
    if (!avoid.length) break;
    verificationAttempts += 1;
    routes = await requestRoutes(walkingRequest, avoid, AVOID_BUFFER_METERS);
    const clear = routes.find(
      (route) => crossings(route, hardObstacles, walkingRequest).length === 0,
    );
    if (clear) {
      return {
        route: clear,
        verificationAttempts,
        verified: true,
        avoided: avoidSet,
        destinationAdjusted,
      };
    }
  }
  const remaining = crossings(routes[0], hardObstacles, walkingRequest);
  const names = [
    ...new Set(remaining.map((obstacle) => obstacle.properties.title)),
  ].slice(0, 3);
  throw new RouteProviderError(
    names.length
      ? `No ${modeLabel(request.mode)} route stays off the scheduled closure on ${names.join(", ")}.`
      : `No ${modeLabel(request.mode)} route stays off the scheduled closures between these points.`,
    "no-route",
  );
}

export async function findFasterDisruptionRoute(
  request: RouteRequest,
  obstacles: ClosureFeature[],
) {
  if (
    obstacles.some((obstacle) =>
      coordinateInObstacle(request.destination, obstacle),
    )
  )
    return null;
  const routes = await requestRoutes(request, [], 0);
  const candidates = routes
    .map((route) => ({
      route,
      crossed: crossings(route, obstacles, request),
    }))
    .filter(
      ({ crossed }) =>
        crossed.length > 0 &&
        crossed.length <= MAX_ACCEPTED_DISRUPTIONS &&
        crossed.every(
          (obstacle) => !impactIsBlocked(obstacle, request.mode),
        ),
    )
    .sort(
      (a, b) =>
        a.route.properties.durationSeconds -
        b.route.properties.durationSeconds,
    );
  const candidate = candidates[0];
  return candidate
    ? { route: candidate.route, crossed: candidate.crossed }
    : null;
}

export async function findLeastDisruptionRoute(
  request: RouteRequest,
  obstacles: ClosureFeature[],
) {
  if (
    obstacles.some((obstacle) =>
      coordinateInObstacle(request.destination, obstacle),
    )
  ) {
    return null;
  }
  const routes = await requestRoutes(request, [], 0);
  const candidates = routes
    .map((route) => ({
      route,
      crossed: crossings(route, obstacles, request),
    }))
    .sort((a, b) => {
      const countDifference = a.crossed.length - b.crossed.length;
      if (countDifference) return countDifference;
      const blockedDifference =
        b.crossed.filter(
          (obstacle) => impactIsBlocked(obstacle, request.mode),
        ).length -
        a.crossed.filter(
          (obstacle) => impactIsBlocked(obstacle, request.mode),
        ).length;
      return (
        blockedDifference ||
        a.route.properties.durationSeconds -
          b.route.properties.durationSeconds
      );
    });
  const candidate = candidates[0];
  return candidate
    ? { route: candidate.route, crossed: candidate.crossed }
    : null;
}
