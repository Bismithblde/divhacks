import { getClosureSources } from "@/lib/closures/provider";
import { overlaps } from "@/lib/closures/normalize";
import type { ClosureFeature } from "@/lib/closures/types";
import { classifyObstacles } from "@/lib/routing/obstacles";
import {
  findWalkingRoute,
  RouteProviderError,
} from "@/lib/routing/provider";
import type { RouteResponse } from "@/lib/routing/types";
import { validateRouteRequest } from "@/lib/routing/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_JOURNEY_WINDOW_MS = 2 * 60 * 60 * 1000;
const COVERAGE =
  "NYC official event and construction schedules. Pedestrian access is not fully confirmed, and emergency or spontaneous closures may be missing.";

function baseMeta(departureTime: string): RouteResponse["meta"] {
  return {
    provider: "openrouteservice",
    requestedAt: new Date().toISOString(),
    departureTime,
    coverage: COVERAGE,
    dataComplete: false,
    verificationAttempts: 0,
  };
}

function unavailableResponse(
  departureTime: string,
  message: string,
): RouteResponse {
  return {
    status: "unavailable",
    error: message,
    avoidedClosures: [],
    warnings: [
      {
        code: "provider-limited",
        message:
          "Walking directions are unavailable until a server-side routing provider is configured.",
      },
    ],
    meta: baseMeta(departureTime),
  };
}

function avoidedClosures(features: ClosureFeature[]) {
  return features.map((feature) => ({
    id: feature.properties.id,
    title: feature.properties.title,
    kind: feature.properties.kind,
    start: feature.properties.start,
    end: feature.properties.end,
    sourceUrl: feature.properties.sourceUrl,
  }));
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      {
        status: "invalid",
        error: "Request body must be valid JSON.",
      } satisfies Partial<RouteResponse>,
      { status: 400 },
    );
  }
  const validation = validateRouteRequest(body);
  if (!validation.ok) {
    return Response.json(
      {
        status: "invalid",
        error: validation.error,
        avoidedClosures: [],
        warnings: [],
        meta: baseMeta(
          typeof (body as { departureTime?: unknown })?.departureTime ===
            "string"
            ? (body as { departureTime: string }).departureTime
            : "",
        ),
      } satisfies RouteResponse,
      { status: 400 },
    );
  }
  if (!process.env.OPENROUTESERVICE_API_KEY) {
    return Response.json(
      unavailableResponse(
        validation.request.departureTime,
        "Walking routing is not configured. Add OPENROUTESERVICE_API_KEY on the server.",
      ),
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const snapshots = await getClosureSources();
  const features = snapshots.flatMap((snapshot) => snapshot.features);
  const relevant = features.filter((feature) =>
    overlaps(
      feature,
      validation.departure,
      validation.departure + MAX_JOURNEY_WINDOW_MS,
    ),
  );
  const classified = classifyObstacles(
    relevant,
    validation.request.avoidClosureIds,
  );
  const dataComplete = snapshots.every(
    (snapshot) =>
      snapshot.status.status === "ok" && snapshot.status.unmapped === 0,
  );
  const warnings = [...classified.warnings];
  if (!dataComplete) {
    warnings.push({
      code: "incomplete-coverage",
      message:
        "Some closure feeds are unavailable or contain unmapped records. This route may not reflect every disruption.",
    });
  }

  const meta = baseMeta(validation.request.departureTime);
  meta.dataComplete = dataComplete;
  try {
    const result = await findWalkingRoute(
      validation.request,
      classified.hard,
    );
    const response: RouteResponse = {
      status: "ok",
      route: result.route,
      durationSeconds: result.route.properties.durationSeconds,
      distanceMeters: result.route.properties.distanceMeters,
      avoidedClosures: avoidedClosures(result.avoided),
      warnings: result.destinationAdjusted
        ? [
            ...warnings,
            {
              code: "uncertain-pedestrian-impact" as const,
              message:
                "The place you chose is on a scheduled closure, so the walk ends at the nearest open point.",
            },
          ]
        : warnings,
      meta: {
        ...meta,
        verificationAttempts: result.verificationAttempts,
      },
    };
    return Response.json(response, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const providerError =
      error instanceof RouteProviderError
        ? error
        : new RouteProviderError(
            "The walking route could not be verified.",
            "invalid",
          );
    const response: RouteResponse = {
      status:
        providerError.code === "no-route" ? "no-route" : "unavailable",
      error: providerError.message,
      avoidedClosures: [],
      warnings,
      meta,
    };
    return Response.json(response, {
      status: providerError.code === "no-route" ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
