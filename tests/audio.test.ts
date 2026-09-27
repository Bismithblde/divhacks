import test from "node:test";
import assert from "node:assert/strict";
import { POST } from "../src/app/api/audio/transit-check-in/route";

function request(body: unknown) {
  return new Request("http://localhost/api/audio/transit-check-in", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("transit check-in audio rejects arbitrary route text", async () => {
  const response = await POST(
    request({ mode: "BUS", routeName: "<script>alert(1)</script>" }),
  );
  assert.equal(response.status, 400);
});

test("transit check-in audio reports when ElevenLabs is not configured", async () => {
  const originalKey = process.env.ELEVENLABS_API_KEY;
  const originalVoice = process.env.ELEVENLABS_VOICE_ID;
  delete process.env.ELEVENLABS_API_KEY;
  delete process.env.ELEVENLABS_VOICE_ID;
  try {
    const response = await POST(request({ mode: "SUBWAY", routeName: "L" }));
    assert.equal(response.status, 503);
  } finally {
    if (originalKey) process.env.ELEVENLABS_API_KEY = originalKey;
    if (originalVoice) process.env.ELEVENLABS_VOICE_ID = originalVoice;
  }
});

test("transit check-in audio keeps credentials server-side and returns private audio", async () => {
  const originalKey = process.env.ELEVENLABS_API_KEY;
  const originalVoice = process.env.ELEVENLABS_VOICE_ID;
  const originalFetch = globalThis.fetch;
  process.env.ELEVENLABS_API_KEY = "server-secret";
  process.env.ELEVENLABS_VOICE_ID = "voice-1";
  let upstreamBody = "";
  globalThis.fetch = async (_input, init) => {
    upstreamBody = String(init?.body || "");
    assert.equal(new Headers(init?.headers).get("xi-api-key"), "server-secret");
    return new Response(new Uint8Array([1, 2, 3]), {
      headers: { "Content-Type": "audio/mpeg" },
    });
  };
  try {
    const response = await POST(request({ mode: "BUS", routeName: "M15" }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, max-age=3600");
    assert.match(upstreamBody, /Is the M15 bus here\?/);
    assert.doesNotMatch(await response.text(), /server-secret/);
    const started = await POST(request({ kind: "route-started" }));
    assert.equal(started.status, 200);
    assert.match(upstreamBody, /Route started\./);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey) process.env.ELEVENLABS_API_KEY = originalKey;
    else delete process.env.ELEVENLABS_API_KEY;
    if (originalVoice) process.env.ELEVENLABS_VOICE_ID = originalVoice;
    else delete process.env.ELEVENLABS_VOICE_ID;
  }
});
