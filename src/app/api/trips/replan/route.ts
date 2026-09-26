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
  if (
    !validation.ok ||
    !isInTripBounds(input.currentPosition) ||
    !input.currentPlan
  ) {
    return Response.json(
      {
        status: "invalid",
        error:
          !validation.ok
            ? validation.error
            : "Current position and current plan are required.",
      },
      { status: 400 },
    );
  }
  const currentPosition = input.currentPosition;
  const currentPlan = input.currentPlan;
  try {
    const response = await replanTrip(
      validation.request,
      currentPlan,
      currentPosition,
      defaultTripDependencies(),
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
