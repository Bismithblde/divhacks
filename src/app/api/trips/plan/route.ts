import { defaultTripDependencies } from "@/lib/trips/defaults";
import { planTrip } from "@/lib/trips/graph";
import { validateTripRequest } from "@/lib/trips/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      {
        status: "invalid",
        alternatives: [],
        warnings: [],
        error: "Request body must be valid JSON.",
        meta: {
          requestedAt: new Date().toISOString(),
          planner: "langgraph-trip-autopilot",
          snapshotId: null,
          feeds: [],
          attempts: { transit: 0, walking: 0 },
        },
      },
      { status: 400 },
    );
  }
  const validation = validateTripRequest(body);
  if (!validation.ok) {
    return Response.json(
      {
        status: "invalid",
        alternatives: [],
        warnings: [],
        error: validation.error,
        meta: {
          requestedAt: new Date().toISOString(),
          planner: "langgraph-trip-autopilot",
          snapshotId: null,
          feeds: [],
          attempts: { transit: 0, walking: 0 },
        },
      },
      { status: 400 },
    );
  }
  try {
    const response = await planTrip(
      validation.request,
      defaultTripDependencies(),
    );
    return Response.json(response, {
      status:
        response?.status === "invalid"
          ? 400
          : response?.status === "unavailable"
            ? 503
            : 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json(
      {
        status: "unavailable",
        alternatives: [],
        warnings: [
          {
            code: "provider-limited",
            message:
              "Trip planning is temporarily unavailable. Please try again.",
          },
        ],
        error: "Trip planning could not be completed.",
        meta: {
          requestedAt: new Date().toISOString(),
          planner: "langgraph-trip-autopilot",
          snapshotId: null,
          feeds: [],
          attempts: { transit: 0, walking: 0 },
        },
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
