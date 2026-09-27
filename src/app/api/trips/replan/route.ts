import { defaultTripDependencies } from "@/lib/trips/defaults";
import { replanTrip } from "@/lib/trips/graph";
import type { ReplanRequest } from "@/lib/trips/types";
import { isInTripBounds, validateTripRequest } from "@/lib/trips/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { status: "invalid", error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }
  if (!body || typeof body !== "object") {
    return Response.json(
      { status: "invalid", error: "A replan request is required." },
      { status: 400 },
    );
  }
  const input = body as Partial<ReplanRequest>;
  const validation = validateTripRequest(input.request);
  const observation = input.transitObservation;
  const validObservation =
    !observation ||
    (typeof observation.legId === "string" &&
      (observation.response === "arrived" ||
        observation.response === "not-arrived") &&
      Number.isFinite(Date.parse(observation.respondedAt || "")) &&
      Array.isArray(input.currentPlan?.legs) &&
      input.currentPlan.legs.some((leg) => leg.id === observation.legId));
  if (
    !validation.ok ||
    !isInTripBounds(input.currentPosition) ||
    !input.currentPlan ||
    !validObservation
  ) {
    return Response.json(
      {
        status: "invalid",
        error:
          !validation.ok
            ? validation.error
            : !validObservation
              ? "The transit observation is invalid."
              : "Current position and current plan are required.",
      },
      { status: 400 },
    );
  }
  const currentPosition = input.currentPosition;
  const currentPlan = input.currentPlan;
  const parsedLastDecisionAt = input.lastDecisionAt
    ? Date.parse(input.lastDecisionAt)
    : 0;
  try {
    const response = await replanTrip(
      validation.request,
      currentPlan,
      currentPosition,
      defaultTripDependencies(),
      Number.isFinite(parsedLastDecisionAt) ? parsedLastDecisionAt : 0,
      observation || null,
    );
    return Response.json(response, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json(
      {
        status: "unavailable",
        error: "The trip could not be rechecked right now.",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
