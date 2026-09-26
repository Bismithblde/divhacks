import { overlaps } from "@/lib/closures/normalize";
import { classifyObstacles, routeIntersectsObstacles } from "@/lib/routing/obstacles";
import type { ClosureFeature } from "@/lib/closures/types";
import type { RouteMode } from "@/lib/routing/types";
import type {
  ScoredItinerary,
  TripLeg,
  TripRequest,
  TripWarning,
  TransitItinerary,
  TripPlannerDependencies,
  VerifiedItinerary,
} from "./types";
import { compareItineraries } from "./scoring";
import { timingDeadline, timingDeparture } from "./validation";

function routeForLeg(leg: TripLeg) {
  if (!leg.geometry) return null;
  return {
    type: "Feature" as const,
    geometry: leg.geometry,
    properties: {
      provider: "open-trip-planner",
      durationSeconds: leg.durationSeconds,
      distanceMeters: 0,
    },
  };
}

function relevantClosures(
  closures: ClosureFeature[],
  itinerary: TransitItinerary,
) {
  const start = Date.parse(itinerary.departureTime);
  const end = Date.parse(itinerary.arrivalTime);
  return closures.filter((closure) => overlaps(closure, start, end));
}

function shiftItinerary(
  itinerary: TransitItinerary,
  legs: TripLeg[],
): TransitItinerary {
  const departure = Date.parse(legs[0].startTime);
  const arrival = Date.parse(legs[legs.length - 1].endTime);
  return {
    ...itinerary,
    legs,
    departureTime: new Date(departure).toISOString(),
    arrivalTime: new Date(arrival).toISOString(),
    durationSeconds: Math.max(0, Math.round((arrival - departure) / 1000)),
    walkingSeconds: legs
      .filter((leg) => leg.mode === "WALK")
      .reduce((total, leg) => total + leg.durationSeconds, 0),
  };
}

function snapshotWarnings(
  complete: boolean,
  classifiedWarnings: Array<{ code: string; message: string }>,
) {
  return [
    ...(complete
      ? []
      : [
          {
            code: "incomplete-coverage" as const,
            message:
              "Some NYC disruption feeds are unavailable or unmapped. This plan may miss a current obstruction.",
          },
        ]),
    ...classifiedWarnings.map((warning) => ({
      code: "walking-access-uncertain" as const,
      message: warning.message,
      source: "NYC closure feeds",
    })),
  ];
}

export async function verifyItinerary(
  itinerary: TransitItinerary,
  request: TripRequest,
  dependencies: TripPlannerDependencies,
  snapshot: import("./types").MobilitySnapshot,
): Promise<VerifiedItinerary> {
  const closures = relevantClosures(snapshot.closures, itinerary);
  const classified = classifyObstacles(closures, [], "foot-walking");
  const warnings: TripWarning[] = snapshotWarnings(
    snapshot.complete,
    classified.warnings,
  );
  const hard = classified.hard;
  const repaired: TripLeg[] = [];
  const blockedLegIds: string[] = [];
  const avoided = new Set<string>();
  for (const leg of itinerary.legs) {
    if (leg.mode !== "WALK") {
      repaired.push(leg);
      continue;
    }
    const route = routeForLeg(leg);
    const intersects = route
      ? routeIntersectsObstacles(route, hard)
      : false;
    if (!intersects) {
      if (!route) {
        warnings.push({
          code: "walking-access-uncertain",
          message:
            "A walking segment has no detailed geometry to verify against closures.",
          source: "OpenTripPlanner",
        });
      }
      repaired.push(leg);
      continue;
    }
    try {
      const repair = await dependencies.walkingRouter.route(
        leg.from.coordinate,
        leg.to.coordinate,
        leg.startTime,
        hard,
      );
      repair.avoidedClosureIds.forEach((id) => avoided.add(id));
      const end = Date.parse(leg.startTime) + repair.route.properties.durationSeconds * 1000;
      repaired.push({
        ...leg,
        endTime: new Date(end).toISOString(),
        durationSeconds: repair.route.properties.durationSeconds,
        geometry: repair.route.geometry,
        status: "realtime",
        realtimeSource: "OpenRouteService closure verification",
      });
      warnings.push(...repair.warnings);
    } catch {
      blockedLegIds.push(leg.id);
      repaired.push(leg);
      warnings.push({
        code: "provider-limited",
        message:
          "A walking transfer crossed a mapped disruption and could not be repaired.",
        source: "OpenRouteService",
      });
    }
  }
  const result = shiftItinerary(itinerary, repaired);
  return {
    ...result,
    verified: blockedLegIds.length === 0,
    blockedLegIds,
    avoidedClosureIds: [...avoided],
    warnings: warnings.filter(
      (warning, index, all) =>
        all.findIndex((item) => item.code === warning.code) === index,
    ),
    status:
      result.status === "stale" || warnings.some((warning) => warning.code === "incomplete-coverage")
        ? "stale"
        : result.status,
  };
}

export async function directWalkingCandidate(
  request: TripRequest,
  dependencies: TripPlannerDependencies,
  snapshot: import("./types").MobilitySnapshot,
): Promise<VerifiedItinerary> {
  return directRouteCandidate(request, dependencies, snapshot);
}

export async function directRouteCandidate(
  request: TripRequest,
  dependencies: TripPlannerDependencies,
  snapshot: import("./types").MobilitySnapshot,
): Promise<VerifiedItinerary> {
  const mode: RouteMode =
    request.mode === "driving-car" ? "driving-car" : "foot-walking";
  const router =
    mode === "driving-car"
      ? dependencies.drivingRouter
      : dependencies.walkingRouter;
  if (!router) throw new Error("Driving routing is not configured.");
  const departure = timingDeparture(request.timing, dependencies.now?.() || Date.now());
  const repair = await router.route(
    request.origin,
    request.destination,
    new Date(departure).toISOString(),
    snapshot.closures,
  );
  const end = departure + repair.route.properties.durationSeconds * 1000;
  const leg: TripLeg = {
    id: mode === "driving-car" ? "direct-drive" : "direct-walk",
    mode: mode === "driving-car" ? "DRIVE" : "WALK",
    from: { name: "Current location", coordinate: request.origin },
    to: {
      name: request.destinationLabel || "Destination",
      coordinate: request.destination,
    },
    startTime: new Date(departure).toISOString(),
    endTime: new Date(end).toISOString(),
    durationSeconds: repair.route.properties.durationSeconds,
    geometry: repair.route.geometry,
    status: repair.status === "clear" ? "realtime" : "stale",
    realtimeSource: "OpenRouteService",
  };
  const itinerary: TransitItinerary = {
    id: mode === "driving-car" ? "direct-driving" : "direct-walking",
    legs: [leg],
    departureTime: leg.startTime,
    arrivalTime: leg.endTime,
    durationSeconds: leg.durationSeconds,
    transfers: 0,
    walkingSeconds: leg.mode === "WALK" ? leg.durationSeconds : 0,
    waitingSeconds: 0,
    status: repair.status === "clear" ? "realtime" : "stale",
    alerts: [],
    provider: "openrouteservice",
    sourceFetchedAt: new Date().toISOString(),
  };
  if (mode === "driving-car") {
    return {
      ...itinerary,
      verified: true,
      blockedLegIds: [],
      avoidedClosureIds: repair.avoidedClosureIds,
      warnings: repair.warnings,
    };
  }
  const verified = await verifyItinerary(itinerary, request, dependencies, snapshot);
  return {
    ...verified,
    warnings: [...verified.warnings, ...repair.warnings],
  };
}

export function rankItineraries(
  itineraries: VerifiedItinerary[],
  request: TripRequest,
): ScoredItinerary[] {
  const deadline = timingDeadline(request.timing);
  return compareItineraries(
    itineraries.filter((itinerary) => itinerary.verified),
    deadline,
  );
}

export function warningsForPlan(
  selected: ScoredItinerary | undefined,
  snapshot: import("./types").MobilitySnapshot,
) {
  return [
    ...(selected?.warnings || []),
    ...snapshot.feeds
      .filter((feed) => feed.status === "stale" || feed.status === "unavailable")
      .map((feed) => ({
        code: "incomplete-coverage" as const,
        message: `${feed.label} is ${feed.status}; the plan may be incomplete.`,
        source: feed.label,
      })),
  ].filter(
    (warning, index, all) =>
      all.findIndex((item) => item.code === warning.code) === index,
  );
}
