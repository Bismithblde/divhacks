import {
  deduplicateClosureFeatures,
  getClosureSources,
} from "@/lib/closures/provider";
import { overlaps } from "@/lib/closures/normalize";
import type { ClosureFeature } from "@/lib/closures/types";
import { classifyObstacles } from "@/lib/routing/obstacles";
import {
  findFasterDisruptionRoute,
  findLeastDisruptionRoute,
  findRoute,
  RouteProviderError,
} from "@/lib/routing/provider";
import type { RouteMode, RouteResponse } from "@/lib/routing/types";
import { validateRouteRequest } from "@/lib/routing/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_JOURNEY_WINDOW_MS = 2 * 60 * 60 * 1000;
const MIN_ALTERNATIVE_SAVED_SECONDS = 10 * 60;
const MIN_ALTERNATIVE_SAVED_RATIO = 0.2;
function modeLabel(mode: RouteMode) {
  return mode === "driving-car" ? "driving" : "walking";
}

function coverageFor(mode: RouteMode) {
  return mode === "driving-car"
    ? "NYC official event and construction schedules. Vehicle access is not fully confirmed, and emergency or spontaneous closures may be missing."
    : "NYC official event and construction schedules. Pedestrian access is not fully confirmed, and emergency or spontaneous closures may be missing.";
}

function baseMeta(
  departureTime: string,
  mode: RouteMode = "foot-walking",
): RouteResponse["meta"] {
  return {
    provider: "openrouteservice",
    requestedAt: new Date().toISOString(),
    departureTime,
    coverage: coverageFor(mode),
    dataComplete: false,
    verificationAttempts: 0,
  };
}

function unavailableResponse(
  departureTime: string,
  mode: RouteMode,
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
          `${modeLabel(mode)} directions are unavailable until a server-side routing provider is configured.`,
      },
    ],
    meta: baseMeta(departureTime, mode),
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
    const mode =
      (body as { mode?: unknown })?.mode === "driving-car"
        ? "driving-car"
        : "foot-walking";
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
          mode,
        ),
      } satisfies RouteResponse,
      { status: 400 },
    );
  }
  if (!process.env.OPENROUTESERVICE_API_KEY) {
    return Response.json(
      unavailableResponse(
        validation.request.departureTime,
        validation.request.mode,
        `${modeLabel(validation.request.mode)} routing is not configured. Add OPENROUTESERVICE_API_KEY on the server.`,
      ),
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const snapshots = await getClosureSources();
  const features = deduplicateClosureFeatures(
    snapshots.flatMap((snapshot) => snapshot.features),
  );
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
    validation.request.mode,
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

  const meta = baseMeta(
    validation.request.departureTime,
    validation.request.mode,
  );
  meta.dataComplete = dataComplete;
  try {
    const [clearResult, fasterResult] = await Promise.allSettled([
      findRoute(validation.request, classified.hard),
      validation.request.mode === "foot-walking"
        ? findFasterDisruptionRoute(validation.request, relevant)
        : Promise.resolve(null),
    ]);
    if (clearResult.status === "rejected") {
      throw clearResult.reason;
    }
    const result = clearResult.value;
    const faster =
      fasterResult.status === "fulfilled" ? fasterResult.value : null;
    const timeSavedSeconds = faster
      ? result.route.properties.durationSeconds -
        faster.route.properties.durationSeconds
      : 0;
    const qualifiesAsAlternative =
      faster &&
      timeSavedSeconds >= MIN_ALTERNATIVE_SAVED_SECONDS &&
      timeSavedSeconds >=
        result.route.properties.durationSeconds * MIN_ALTERNATIVE_SAVED_RATIO;
    const alternative = qualifiesAsAlternative
      ? {
          label: "faster-with-disruptions" as const,
          route: faster.route,
          durationSeconds: faster.route.properties.durationSeconds,
          distanceMeters: faster.route.properties.distanceMeters,
          crossedClosures: avoidedClosures(faster.crossed),
          timeSavedSeconds,
        }
      : undefined;
    const response: RouteResponse = {
      status: "ok",
      routeStatus: "clear",
      route: result.route,
      durationSeconds: result.route.properties.durationSeconds,
      distanceMeters: result.route.properties.distanceMeters,
      alternative,
      crossedClosures: [],
      avoidedClosures: avoidedClosures(result.avoided),
      warnings: result.destinationAdjusted
        ? [
            ...warnings,
            {
              code: "uncertain-pedestrian-impact" as const,
              message:
                `The place you chose is on a scheduled closure, so the ${modeLabel(validation.request.mode)} route ends at the nearest open point.`,
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
            `The ${modeLabel(validation.request.mode)} route could not be verified.`,
            "invalid",
          );
    if (providerError.code === "no-route") {
      try {
        const fallback = await findLeastDisruptionRoute(
          validation.request,
          classified.hard,
        );
        if (fallback) {
          const crossedClosures = avoidedClosures(fallback.crossed);
          const disruptionCount = crossedClosures.length;
          const fallbackResponse: RouteResponse = {
            status: "ok",
            routeStatus: "fallback",
            route: fallback.route,
            durationSeconds: fallback.route.properties.durationSeconds,
            distanceMeters: fallback.route.properties.distanceMeters,
            crossedClosures,
            avoidedClosures: [],
            warnings: [
              ...warnings,
              {
                code: "interruption-fallback",
                message: `No fully clear ${modeLabel(validation.request.mode)} route was verified. This fallback crosses ${disruptionCount} mapped disruption${disruptionCount === 1 ? "" : "s"}; review it before continuing.`,
                closureIds: crossedClosures.map((closure) => closure.id),
              },
            ],
            meta: {
              ...meta,
              verificationAttempts: 1,
            },
          };
          return Response.json(fallbackResponse, {
            headers: { "Cache-Control": "no-store" },
          });
        }
      } catch {
        // Preserve the original no-route result if the fallback call fails.
      }
    }
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
