import {
  deduplicateClosureFeatures,
  getClosureSources,
} from "@/lib/closures/provider";
import { overlaps, inBounds } from "@/lib/closures/normalize";
import type { ClosureResponse } from "@/lib/closures/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const days = Number(params.get("days") || "1");
  if (![1, 7, 30].includes(days))
    return Response.json(
      { error: "days must be 1, 7, or 30" },
      { status: 400 },
    );
  let bounds: number[] | undefined;
  if (params.has("bbox")) {
    bounds = params.get("bbox")!.split(",").map(Number);
    if (
      bounds.length !== 4 ||
      !bounds.every(Number.isFinite) ||
      bounds[0] < -180 ||
      bounds[2] > 180 ||
      bounds[1] < -90 ||
      bounds[3] > 90 ||
      bounds[0] >= bounds[2] ||
      bounds[1] >= bounds[3]
    )
      return Response.json(
        { error: "bbox must be west,south,east,north" },
        { status: 400 },
      );
  }
  // Rolling window is explicit in the UI: coming 24 hours / 7 days / 30 days.
  const start = Date.now(),
    end = start + days * 86_400_000;
  const snapshots = await getClosureSources();
  const sources = snapshots.map((s) => s.status);
  const features = deduplicateClosureFeatures(
    snapshots.flatMap((s) => s.features),
  )
    .filter((f) => overlaps(f, start, end) && (!bounds || inBounds(f, bounds)));
  const available = sources.some((s) => s.status !== "unavailable");
  const body: ClosureResponse = {
    type: "FeatureCollection",
    features,
    meta: {
      fetchedAt: new Date().toISOString(),
      start,
      end,
      days,
      sources,
      complete: sources.every((s) => s.status === "ok" && s.unmapped === 0),
      coverage:
        "NYC official event and construction closure schedules. Not a complete record of emergency closures or spontaneous events. Pedestrian access is not confirmed.",
    },
  };
  return Response.json(body, {
    status: available ? 200 : 503,
    headers: {
      "Cache-Control":
        available && body.meta.complete
          ? "public, max-age=60, s-maxage=60, must-revalidate"
          : "no-store",
    },
  });
}
