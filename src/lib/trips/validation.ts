import { NYC_ROUTE_BOUNDS } from "@/lib/routing/validation";
import type {
  Coordinate,
  TripConstraints,
  TripRequest,
  TripTiming,
} from "./types";

const MAX_WALKING_MINUTES = 180;
const MAX_TRANSFERS = 12;

function coordinate(value: unknown): value is Coordinate {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every(
      (part) => typeof part === "number" && Number.isFinite(part),
    )
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

function validTime(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function parseTiming(value: unknown): TripTiming | null {
  if (!value || typeof value !== "object") return null;
  const timing = value as { type?: unknown; time?: unknown };
  if (timing.type === "leave-now") return { type: "leave-now" };
  if (
    (timing.type === "depart-at" || timing.type === "arrive-by") &&
    validTime(timing.time)
  ) {
    return {
      type: timing.type,
      time: new Date(timing.time).toISOString(),
    };
  }
  return null;
}

function parseConstraints(value: unknown): TripConstraints {
  if (!value || typeof value !== "object") return {};
  const input = value as Record<string, unknown>;
  const constraints: TripConstraints = {};
  if (
    typeof input.maxWalkingMinutes === "number" &&
    Number.isInteger(input.maxWalkingMinutes) &&
    input.maxWalkingMinutes >= 0 &&
    input.maxWalkingMinutes <= MAX_WALKING_MINUTES
  ) {
    constraints.maxWalkingMinutes = input.maxWalkingMinutes;
  }
  if (
    typeof input.maxTransfers === "number" &&
    Number.isInteger(input.maxTransfers) &&
    input.maxTransfers >= 0 &&
    input.maxTransfers <= MAX_TRANSFERS
  ) {
    constraints.maxTransfers = input.maxTransfers;
  }
  if (typeof input.avoidStairs === "boolean")
    constraints.avoidStairs = input.avoidStairs;
  if (typeof input.allowScheduledDisruptions === "boolean")
    constraints.allowScheduledDisruptions = input.allowScheduledDisruptions;
  return constraints;
}

export type TripValidationResult =
  | { ok: true; request: TripRequest; departure: number; deadline: number | null }
  | { ok: false; error: string };

export function validateTripRequest(body: unknown): TripValidationResult {
  if (!body || typeof body !== "object")
    return { ok: false, error: "A trip request is required." };
  const value = body as Record<string, unknown>;
  if (!coordinate(value.origin) || !inNewYorkCity(value.origin))
    return {
      ok: false,
      error: "The origin must be a coordinate inside the NYC pilot area.",
    };
  if (!coordinate(value.destination) || !inNewYorkCity(value.destination))
    return {
      ok: false,
      error: "The destination must be a coordinate inside the NYC pilot area.",
    };
  if (
    value.origin[0] === value.destination[0] &&
    value.origin[1] === value.destination[1]
  ) {
    return { ok: false, error: "Origin and destination must be different." };
  }
  const timing = parseTiming(value.timing);
  if (!timing)
    return {
      ok: false,
      error: "Choose leave now, a departure time, or an arrival deadline.",
    };
  if (
    value.mode !== "foot-walking" &&
    value.mode !== "transit-walk" &&
    value.mode !== "driving-car"
  ) {
    return {
      ok: false,
      error: "Choose walking, transit, or driving as the travel mode.",
    };
  }
  const mode = value.mode;
  const now = Date.now();
  const departure =
    timing.type === "depart-at"
      ? Date.parse(timing.time)
      : timing.type === "arrive-by"
        ? now
        : now;
  const deadline = timing.type === "arrive-by" ? Date.parse(timing.time) : null;
  if (deadline !== null && deadline <= now)
    return { ok: false, error: "The arrival deadline must be in the future." };
  return {
    ok: true,
    request: {
      origin: value.origin,
      destination: value.destination,
      destinationLabel:
        typeof value.destinationLabel === "string"
          ? value.destinationLabel.slice(0, 160)
          : undefined,
      timing,
      mode,
      constraints: parseConstraints(value.constraints),
    },
    departure,
    deadline,
  };
}

export function timingDeadline(timing: TripTiming): number | null {
  return timing.type === "arrive-by" ? Date.parse(timing.time) : null;
}

export function timingDeparture(timing: TripTiming, now = Date.now()): number {
  return timing.type === "depart-at" ? Date.parse(timing.time) : now;
}

export function isInTripBounds(value: unknown): value is Coordinate {
  return coordinate(value) && inNewYorkCity(value);
}
