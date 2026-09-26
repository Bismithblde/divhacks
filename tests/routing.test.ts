import test from "node:test";
import assert from "node:assert/strict";
import type { ClosureFeature } from "../src/lib/closures/types";
import {
  buildAvoidancePolygons,
  classifyObstacles,
  routeIntersectsObstacles,
} from "../src/lib/routing/obstacles";
import type { RouteFeature } from "../src/lib/routing/types";
import { validateRouteRequest } from "../src/lib/routing/validation";
import { findWalkingRoute } from "../src/lib/routing/provider";

function closure(
  id: string,
  pedestrianImpact: ClosureFeature["properties"]["pedestrianImpact"] = "unknown",
): ClosureFeature {
  return {
    type: "Feature",
    id,
    geometry: {
      type: "LineString",
      coordinates: [
        [-73.99, 40.73],
        [-73.98, 40.73],
      ],
    },
    properties: {
      id,
      title: "Test closure",
      location: "Test street",
      borough: "Manhattan",
      kind: "event",
      category: "Parade",
      start: Date.parse("2026-09-26T12:00:00Z"),
      end: Date.parse("2026-09-26T18:00:00Z"),
      eventStart: null,
      eventEnd: null,
      permitStatus: "Scheduled",
      source: "Test",
      sourceUrl: "https://example.com/source",
      pedestrianImpact,
    },
  };
}

test("route validation normalizes departure and rejects out-of-coverage points", () => {
  const valid = validateRouteRequest({
    origin: [-73.99, 40.73],
    destination: [-73.97, 40.74],
    departureTime: "2026-09-26T12:00:00-04:00",
    mode: "foot-walking",
  });
  assert.equal(valid.ok, true);
  if (valid.ok) assert.equal(valid.request.departureTime, "2026-09-26T16:00:00.000Z");

  const invalid = validateRouteRequest({
    origin: [-74.5, 40.73],
    destination: [-73.97, 40.74],
    departureTime: "2026-09-26T12:00:00Z",
    mode: "foot-walking",
  });
  assert.equal(invalid.ok, false);
});

test("only confirmed or explicitly selected closures become hard obstacles", () => {
  const uncertain = closure("uncertain");
  const confirmed = closure("confirmed", "blocked");
  const classified = classifyObstacles(
    [uncertain, confirmed],
    ["uncertain"],
  );
  assert.deepEqual(
    classified.hard.map((feature) => feature.properties.id),
    ["uncertain", "confirmed"],
  );
  assert.equal(classified.warnings[0]?.code, "approximate-obstacle");
});

test("avoidance polygons and route verification catch a route through a closure", () => {
  const obstacle = closure("blocked", "blocked");
  const polygons = buildAvoidancePolygons([obstacle]);
  assert.equal(polygons.type, "MultiPolygon");
  assert.equal(polygons.coordinates.length, 1);

  const route: RouteFeature = {
    type: "Feature",
    geometry: {
      type: "LineString",
      coordinates: [
        [-74.0, 40.73],
        [-73.97, 40.73],
      ],
    },
    properties: {
      provider: "test",
      durationSeconds: 600,
      distanceMeters: 900,
    },
  };
  assert.equal(routeIntersectsObstacles(route, [obstacle]), true);
});

test("walking routing selects the fastest returned route", async () => {
  const originalKey = process.env.OPENROUTESERVICE_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.OPENROUTESERVICE_API_KEY = "test-key";
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: {
              type: "LineString",
              coordinates: [
                [-73.99, 40.73],
                [-73.97, 40.74],
              ],
            },
            properties: { summary: { duration: 900, distance: 800 } },
          },
          {
            type: "Feature",
            geometry: {
              type: "LineString",
              coordinates: [
                [-73.99, 40.73],
                [-73.97, 40.74],
              ],
            },
            properties: { summary: { duration: 600, distance: 1100 } },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );

  try {
    const result = await findWalkingRoute(
      {
        origin: [-73.99, 40.73],
        destination: [-73.97, 40.74],
        departureTime: "2026-09-26T16:00:00.000Z",
        mode: "foot-walking",
      },
      [],
    );
    assert.equal(result.route.properties.durationSeconds, 600);
    assert.equal(result.route.properties.distanceMeters, 1100);
    assert.equal(result.verificationAttempts, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENROUTESERVICE_API_KEY;
    else process.env.OPENROUTESERVICE_API_KEY = originalKey;
  }
});

test("walking routing retries when the provider returns a route through a hard obstacle", async () => {
  const originalKey = process.env.OPENROUTESERVICE_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.OPENROUTESERVICE_API_KEY = "test-key";
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    const coordinates =
      calls === 1
        ? [
            [-74.0, 40.73],
            [-73.97, 40.73],
          ]
        : [
            [-74.0, 40.72],
            [-73.97, 40.72],
          ];
    return new Response(
      JSON.stringify({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "LineString", coordinates },
            properties: { summary: { duration: 700, distance: 950 } },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  try {
    const result = await findWalkingRoute(
      {
        origin: [-74.0, 40.73],
        destination: [-73.97, 40.73],
        departureTime: "2026-09-26T16:00:00.000Z",
        mode: "foot-walking",
      },
      [closure("blocked", "blocked")],
    );
    assert.equal(calls, 2);
    assert.equal(result.verificationAttempts, 2);
    assert.equal(result.route.geometry.coordinates[0][1], 40.72);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENROUTESERVICE_API_KEY;
    else process.env.OPENROUTESERVICE_API_KEY = originalKey;
  }
});
