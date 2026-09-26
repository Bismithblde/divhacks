import type { LineString } from "geojson";
import type { Coordinate, RouteFeature } from "@/lib/routing/types";

export type { Coordinate } from "@/lib/routing/types";

export type TripTiming =
  | { type: "leave-now" }
  | { type: "depart-at"; time: string }
  | { type: "arrive-by"; time: string };

export type TripMode = "transit-walk" | "foot-walking" | "driving-car";
export type LegMode = "WALK" | "DRIVE" | "SUBWAY" | "BUS";
export type LegStatus = "scheduled" | "realtime" | "stale" | "unknown";

export type TripConstraints = {
  maxWalkingMinutes?: number;
  maxTransfers?: number;
  avoidStairs?: boolean;
  allowScheduledDisruptions?: boolean;
};

export type TripRequest = {
  origin: Coordinate;
  destination: Coordinate;
  destinationLabel?: string;
  timing: TripTiming;
  mode: TripMode;
  constraints: TripConstraints;
};

export type TripLeg = {
  id: string;
  mode: LegMode;
  from: {
    name: string;
    coordinate: Coordinate;
  };
  to: {
    name: string;
    coordinate: Coordinate;
  };
  fromStopId?: string;
  toStopId?: string;
  startTime: string;
  endTime: string;
  durationSeconds: number;
  geometry?: LineString;
  routeName?: string;
  routeColor?: string;
  status: LegStatus;
  delaySeconds?: number;
  alert?: string;
  realtimeSource?: string;
};

export type TripAlert = {
  id: string;
  severity: "info" | "warning" | "critical";
  message: string;
  source: string;
  updatedAt: string | null;
};

export type TransitItinerary = {
  id: string;
  legs: TripLeg[];
  departureTime: string;
  arrivalTime: string;
  durationSeconds: number;
  transfers: number;
  walkingSeconds: number;
  waitingSeconds: number;
  status: "scheduled" | "realtime" | "stale";
  alerts: TripAlert[];
  provider: string;
  sourceFetchedAt: string | null;
};

export type FeedFreshness = {
  id: string;
  label: string;
  status: "live" | "stale" | "unavailable" | "scheduled";
  fetchedAt: string | null;
  updatedAt: string | null;
  message?: string;
};

export type MobilitySnapshot = {
  id: string;
  capturedAt: string;
  closures: import("@/lib/closures/types").ClosureFeature[];
  feeds: FeedFreshness[];
  complete: boolean;
};

export type TripWarning = {
  code:
    | "incomplete-coverage"
    | "stale-transit"
    | "stale-bus"
    | "walking-access-uncertain"
    | "provider-limited"
    | "late-arrival"
    | "no-realtime-bus"
    | "no-realtime-subway";
  message: string;
  source?: string;
};

export type VerifiedItinerary = TransitItinerary & {
  verified: boolean;
  blockedLegIds: string[];
  avoidedClosureIds: string[];
  warnings: TripWarning[];
};

export type ScoredItinerary = VerifiedItinerary & {
  arrivalBufferSeconds: number | null;
  score: number;
  switchingCostSeconds: number;
  riskPenaltySeconds: number;
};

export type TripExplanation = {
  headline: string;
  action: "stay" | "switch" | "continue" | "recheck";
  reason: string;
  steps: string[];
  caveats: string[];
  provider: "grounded-model" | "deterministic-template";
};

export type TripPlanResponse = {
  status: "ok" | "needs-input" | "no-plan" | "unavailable" | "invalid";
  plan?: ScoredItinerary;
  alternatives: ScoredItinerary[];
  explanation?: TripExplanation;
  warnings: TripWarning[];
  error?: string;
  meta: {
    requestedAt: string;
    planner: string;
    snapshotId: string | null;
    feeds: FeedFreshness[];
    attempts: {
      transit: number;
      walking: number;
    };
  };
};

export type TripDecision = {
  action: "stay" | "switch" | "continue" | "replan";
  reasonCode:
    | "current-plan-still-best"
    | "alternate-arrives-earlier"
    | "current-plan-misses-deadline"
    | "service-cancelled"
    | "data-too-stale"
    | "no-feasible-alternative";
  currentOption?: ScoredItinerary;
  recommendedOption?: ScoredItinerary;
  alternatives: ScoredItinerary[];
  explanation?: TripExplanation;
  warnings: TripWarning[];
  meta?: TripPlanResponse["meta"];
};

export type ReplanRequest = {
  request: TripRequest;
  currentPosition: Coordinate;
  currentLegIndex: number;
  currentPlan: VerifiedItinerary;
};

export type WalkingRouteResult = {
  route: RouteFeature;
  status: "clear" | "fallback";
  avoidedClosureIds: string[];
  warnings: TripWarning[];
};

export type TransitPlanInput = {
  origin: Coordinate;
  destination: Coordinate;
  timing: TripTiming;
  constraints: TripConstraints;
};

export interface TransitRouter {
  plan(input: TransitPlanInput): Promise<TransitItinerary[]>;
}

export interface WalkingRouter {
  route(
    origin: Coordinate,
    destination: Coordinate,
    departureTime: string,
    obstacles: import("@/lib/closures/types").ClosureFeature[],
  ): Promise<WalkingRouteResult>;
}

export type TripPlannerDependencies = {
  transitRouter: TransitRouter;
  walkingRouter: WalkingRouter;
  drivingRouter?: WalkingRouter;
  loadSnapshot: () => Promise<MobilitySnapshot>;
  explain: (
    plan: ScoredItinerary,
    alternatives: ScoredItinerary[],
    warnings: TripWarning[],
    deadline: number | null,
  ) => Promise<TripExplanation>;
  now?: () => number;
};
