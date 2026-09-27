import {
  findRoute,
  RouteProviderError,
} from "@/lib/routing/provider";
import { classifyObstacles } from "@/lib/routing/obstacles";
import { loadMobilitySnapshot } from "./mobility";
import { explainPlan } from "./explanation";
import { OpenTripPlannerRouter } from "@/lib/transit/otp";
import type { RouteMode, RouteRequest } from "@/lib/routing/types";
import type { TripPlannerDependencies, WalkingRouter } from "./types";

function createRoutingRouter(mode: RouteMode): WalkingRouter {
  return {
    async route(
      origin,
      destination,
      departureTime,
      obstacles,
      accessOverrides,
    ) {
      const request: RouteRequest = {
        origin,
        destination,
        departureTime,
        mode,
      };
      const classified =
        mode === "foot-walking"
          ? classifyObstacles(obstacles, [], mode, accessOverrides)
          : { hard: [], warnings: [] };
      try {
        const result = await findRoute(request, classified.hard);
        return {
          route: result.route,
          status: "clear",
          avoidedClosureIds: result.avoided.map(
            (feature) => feature.properties.id,
          ),
          warnings: classified.warnings.map((warning) => ({
            code:
              warning.code === "approximate-obstacle"
                ? ("walking-access-uncertain" as const)
                : ("incomplete-coverage" as const),
            message: warning.message,
            source: "NYC closure feeds",
          })),
        };
      } catch (error) {
        if (error instanceof RouteProviderError) throw error;
        throw new Error(
          `${mode === "driving-car" ? "Driving" : "Walking"} route could not be verified.`,
        );
      }
    },
  };
}

const walkingRouter = createRoutingRouter("foot-walking");
const drivingRouter = createRoutingRouter("driving-car");

export function defaultTripDependencies(): TripPlannerDependencies {
  return {
    transitRouter: new OpenTripPlannerRouter(),
    walkingRouter,
    drivingRouter,
    loadSnapshot: loadMobilitySnapshot,
    explain: async (plan, alternatives, warnings, deadline) => {
      return explainPlan(
        plan,
        undefined,
        "continue",
        alternatives,
        warnings,
        deadline,
      );
    },
  };
}

