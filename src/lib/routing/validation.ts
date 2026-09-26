import type { Coordinate, RouteRequest } from "./types";

export const NYC_ROUTE_BOUNDS = {
  west: -74.35,
  south: 40.43,
  east: -73.6,
  north: 40.99,
};

const MAX_AVOID_CLOSURES = 40;

export type RouteValidationResult =
  | { ok: true; request: RouteRequest; departure: number }
  | { ok: false; error: string };

function validCoordinate(value: unknown): value is Coordinate {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((part) => typeof part === "number" && Number.isFinite(part))
  );
}

function inNewYorkCity([longitude, latitude]: Coordinate) {
  return (
    longitude >= NYC_ROUTE_BOUNDS.west &&
    longitude <= NYC_ROUTE_BOUNDS.east &&
    latitude >= NYC_ROUTE_BOUNDS.south &&
    latitude <= NYC_ROUTE_BOUNDS.north
  );
}

export function validateRouteRequest(body: unknown): RouteValidationResult {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "A JSON route request is required." };
  }
  const value = body as Partial<RouteRequest>;
  if (value.mode !== "foot-walking") {
    return { ok: false, error: "Only walking routes are supported." };
  }
  if (!validCoordinate(value.origin) || !inNewYorkCity(value.origin)) {
    return {
      ok: false,
      error: "The origin must be a coordinate inside the NYC pilot area.",
    };
  }
  if (
    !validCoordinate(value.destination) ||
    !inNewYorkCity(value.destination)
  ) {
    return {
      ok: false,
      error: "The destination must be a coordinate inside the NYC pilot area.",
    };
  }
  if (value.origin[0] === value.destination[0] && value.origin[1] === value.destination[1]) {
    return { ok: false, error: "Origin and destination must be different." };
  }
  if (typeof value.departureTime !== "string") {
    return { ok: false, error: "A departure time is required." };
  }
  const departure = Date.parse(value.departureTime);
  if (!Number.isFinite(departure)) {
    return { ok: false, error: "Departure time must be a valid ISO date." };
  }
  const avoidClosureIds = value.avoidClosureIds || [];
  if (
    !Array.isArray(avoidClosureIds) ||
    avoidClosureIds.length > MAX_AVOID_CLOSURES ||
    avoidClosureIds.some(
      (id) => typeof id !== "string" || id.length === 0 || id.length > 120,
    )
  ) {
    return { ok: false, error: "The requested obstacle list is invalid." };
  }
  return {
    ok: true,
    request: {
      origin: value.origin,
      destination: value.destination,
      departureTime: new Date(departure).toISOString(),
      mode: "foot-walking",
      avoidClosureIds,
    },
    departure,
  };
}

export function inRouteBounds(coordinate: Coordinate) {
  return validCoordinate(coordinate) && inNewYorkCity(coordinate);
}
