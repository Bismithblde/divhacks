import {
  deduplicateClosureFeatures,
  getClosureSources,
} from "@/lib/closures/provider";
import type { MobilitySnapshot } from "./types";

export async function loadMobilitySnapshot(): Promise<MobilitySnapshot> {
  const snapshots = await getClosureSources();
  const closures = deduplicateClosureFeatures(
    snapshots.flatMap((snapshot) => snapshot.features),
  );
  const feeds = snapshots.map((snapshot) => ({
    id: snapshot.status.id,
    label: snapshot.status.label,
    status:
      snapshot.status.status === "ok"
        ? ("live" as const)
        : snapshot.status.status === "stale"
          ? ("stale" as const)
          : ("unavailable" as const),
    fetchedAt: snapshot.status.fetchedAt,
    updatedAt: snapshot.status.updatedAt,
    message: snapshot.status.message,
  }));
  const capturedAt = new Date().toISOString();
  const snapshotId = feeds
    .map(
      (feed) =>
        `${feed.id}:${feed.fetchedAt || "missing"}:${feed.updatedAt || "unknown"}`,
    )
    .join("|");
  return {
    id: snapshotId || `empty-${capturedAt}`,
    capturedAt,
    closures,
    feeds,
    complete: snapshots.every(
      (snapshot) =>
        snapshot.status.status === "ok" && snapshot.status.unmapped === 0,
    ),
  };
}
