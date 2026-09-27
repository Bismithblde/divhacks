import test from "node:test";
import assert from "node:assert/strict";
import {
  fallbackEventSummary,
  generateEventSummary,
  parseGeminiEventSummary,
} from "../src/lib/events/summary";
import type { EventSummaryInput } from "../src/lib/events/types";

const input: EventSummaryInput = {
  id: "event-100",
  title: "100th Annual Festival",
  category: "Street Festival",
  borough: "Manhattan",
  location: "Mulberry Street",
  start: 1000,
  end: 2000,
  eventStart: 1200,
  eventEnd: 1800,
  permitStatus: "Scheduled",
  pedestrianImpact: "unknown",
  vehicleImpact: "blocked",
};

test("event fallback stays compact and uses source-backed access facts", () => {
  const summary = fallbackEventSummary(input);
  assert.deepEqual(summary.tags, ["Street Festival", "Manhattan"]);
  assert.equal(summary.roadImpact, "fully-closed");
  assert.equal(summary.pedestrianImpact, "uncertain");
  assert.equal(summary.provider, "source");
  assert.deepEqual(summary.about, []);
});

test("Gemini event output rejects unsupported numbers and prose formatting", () => {
  const valid = {
    tags: ["Food festival", "Street event"],
    keywords: ["food", "festival"],
    about: ["A neighborhood festival likely centered on Italian culture."],
    roadImpact: "fully-closed",
    pedestrianImpact: "crowded",
    confidence: "medium",
    roadReason: "The official closure type blocks vehicles.",
    pedestrianReason: "Festival activity may crowd sidewalks.",
  };
  assert.equal(parseGeminiEventSummary(valid, input)?.provider, "gemini");
  assert.equal(
    parseGeminiEventSummary(
      { ...valid, about: ["Expect 500 people."] },
      input,
    ),
    null,
  );
  assert.equal(
    parseGeminiEventSummary({ ...valid, about: ["**Busy event**"] }, input),
    null,
  );
});

test("Gemini request uses structured JSON and falls back on provider errors", async () => {
  let requestBody = "";
  const summary = await generateEventSummary(input, {
    key: "test-key",
    model: "gemini-test",
    fetcher: async (_url, init) => {
      requestBody = String(init?.body || "");
      return new Response("unavailable", { status: 503 });
    },
  });
  const parsed = JSON.parse(requestBody) as {
    generationConfig?: { responseMimeType?: string; responseSchema?: unknown };
  };
  assert.equal(parsed.generationConfig?.responseMimeType, "application/json");
  assert.ok(parsed.generationConfig?.responseSchema);
  assert.equal(summary.provider, "source");
});
