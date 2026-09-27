import { transitCheckInPrompt } from "@/lib/trips/active";
import type { LegMode } from "@/lib/trips/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

const ROUTE_NAME = /^[\p{L}\p{N} ./'&+-]{1,32}$/u;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Valid JSON is required." }, { status: 400 });
  }
  const input = body as {
    kind?: unknown;
    mode?: unknown;
    routeName?: unknown;
  };
  const kind =
    input?.kind === "route-started" ? "route-started" : "transit-check-in";
  const mode =
    input?.mode === "BUS" || input?.mode === "SUBWAY"
      ? (input.mode as LegMode)
      : null;
  const routeName =
    typeof input?.routeName === "string" && ROUTE_NAME.test(input.routeName.trim())
      ? input.routeName.trim()
      : undefined;
  if (
    (kind === "transit-check-in" && !mode) ||
    (input?.routeName != null && !routeName)
  ) {
    return Response.json(
      { error: "A valid transit mode and route name are required." },
      { status: 400 },
    );
  }

  const text =
    kind === "route-started"
      ? "Route started."
      : transitCheckInPrompt({ mode: mode!, routeName });
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  if (!apiKey || !voiceId) {
    return Response.json(
      { error: "Trip audio is not configured." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`,
      {
        method: "POST",
        headers: {
          Accept: "audio/mpeg",
          "Content-Type": "application/json",
          "xi-api-key": apiKey,
        },
        body: JSON.stringify({
          text,
          model_id: process.env.ELEVENLABS_MODEL || "eleven_flash_v2_5",
          voice_settings: {
            stability: 0.55,
            similarity_boost: 0.75,
          },
        }),
        signal: request.signal,
      },
    );
  } catch {
    return Response.json(
      { error: "Trip audio is temporarily unavailable." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (!upstream.ok || !upstream.body) {
    return Response.json(
      { error: "Trip audio is temporarily unavailable." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": upstream.headers.get("content-type") || "audio/mpeg",
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
