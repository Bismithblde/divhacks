import type { Feature, LineString, MultiPolygon } from "geojson";
import type { ClosureFeature } from "@/lib/closures/types";
import type { EventAccessOverride } from "@/lib/events/types";

export type Coordinate = [number, number];
export type RouteMode = "foot-walking" | "driving-car";
export type TravelMode = RouteMode | "transit-walk";

export type RouteRequest = {
  origin: Coordinate;
  destination: Coordinate;
  departureTime: string;
  mode: RouteMode;
  avoidClosureIds?: string[];
  accessOverrides?: Array<{
    closureId: string;
    access: EventAccessOverride;
  }>;
};

export type RouteWarning = {
  code:
    | "uncertain-pedestrian-impact"
    | "incomplete-coverage"
    | "approximate-obstacle"
    | "interruption-fallback"
    | "provider-limited"
    | "user-access-override";
  message: string;
  closureIds?: string[];
};

export type AvoidedClosure = Pick<
  ClosureFeature["properties"],
  "id" | "title" | "kind" | "start" | "end" | "sourceUrl"
>;

export type RouteFeature = Feature<
  LineString,
  {
    provider: string;
    durationSeconds: number;
    distanceMeters: number;
    instructions?: RouteInstruction[];
  }
>;

export type RouteInstruction = {
  instruction: string;
  distanceMeters: number;
  durationSeconds: number;
  wayPoints?: [number, number];
};

export type RouteMapLine = {
  id: string;
  route: RouteFeature;
  mode: "WALK" | "BUS" | "SUBWAY" | "DRIVE";
  selected?: boolean;
};

export type RouteResponse = {
  status: "ok" | "unavailable" | "no-route" | "invalid";
  routeStatus?: "clear" | "fallback";
  route?: RouteFeature;
  durationSeconds?: number;
  distanceMeters?: number;
  alternative?: RouteAlternative;
  crossedClosures?: AvoidedClosure[];
  avoidedClosures: AvoidedClosure[];
  warnings: RouteWarning[];
  error?: string;
  meta: {
    provider: string;
    requestedAt: string;
    departureTime: string;
    coverage: string;
    dataComplete: boolean;
    verificationAttempts: number;
  };
};

export type RouteAlternative = {
  label: "faster-with-disruptions";
  route: RouteFeature;
  durationSeconds: number;
  distanceMeters: number;
  crossedClosures: AvoidedClosure[];
  timeSavedSeconds: number;
};

export type AvoidancePolygon = {
  type: "MultiPolygon";
  coordinates: MultiPolygon["coordinates"];
};

export type ClassifiedObstacles = {
  hard: ClosureFeature[];
  warnings: RouteWarning[];
};
