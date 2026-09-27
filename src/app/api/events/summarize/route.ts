import {
  eventSummaryInputSchema,
  generateEventSummary,
} from "@/lib/events/summary";
import type { EventSummary } from "@/lib/events/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FALLBACK_CACHE_TTL_MS = 30 * 1000;
const cache = new Map<
  string,
  { expiresAt: number; summary: EventSummary }
>();
const inFlight = new Map<string, Promise<EventSummary>>();

function cacheKey(input: {
  id: string;
  start: number;
  end: number;
  permitStatus: string;
}) {
  return `v2:${input.id}:${input.start}:${input.end}:${input.permitStatus}`;
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const parsed = eventSummaryInputSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "The event summary request is invalid." },
      { status: 400 },
    );
  }

  const key = cacheKey(parsed.data);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return Response.json(cached.summary, {
      headers: {
        "Cache-Control":
          cached.summary.provider === "gemini"
            ? "private, max-age=3600"
            : "no-store",
      },
    });
  }

  let pending = inFlight.get(key);
  if (!pending) {
    pending = generateEventSummary(parsed.data).finally(() => {
      inFlight.delete(key);
    });
    inFlight.set(key, pending);
  }
  const summary = await pending;
  cache.set(key, {
    summary,
    expiresAt:
      Date.now() +
      (summary.provider === "gemini" ? CACHE_TTL_MS : FALLBACK_CACHE_TTL_MS),
  });
  return Response.json(summary, {
    headers: {
      "Cache-Control":
        summary.provider === "gemini"
          ? "private, max-age=3600"
          : "no-store",
    },
  });
}
