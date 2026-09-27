import test from "node:test";
import assert from "node:assert/strict";
import type { ClosureFeature } from "../src/lib/closures/types";
import {
  buildAvoidancePolygons,
  classifyObstacles,
  coordinateInObstacle,
  routeIntersectsObstacles,
} from "../src/lib/routing/obstacles";
import type { RouteFeature } from "../src/lib/routing/types";
import { validateRouteRequest } from "../src/lib/routing/validation";
import {
  findLeastDisruptionRoute,
  findRoute,
} from "../src/lib/routing/provider";

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

  const driving = validateRouteRequest({
    origin: [-73.99, 40.73],
    destination: [-73.97, 40.74],
    departureTime: "2026-09-26T12:00:00-04:00",
    mode: "driving-car",
  });
  assert.equal(driving.ok, true);
  if (driving.ok) assert.equal(driving.request.mode, "driving-car");

  const invalid = validateRouteRequest({
    origin: [-74.5, 40.73],
    destination: [-73.97, 40.74],
    departureTime: "2026-09-26T12:00:00Z",
    mode: "foot-walking",
  });
  assert.equal(invalid.ok, false);
});

test("scheduled closures are kept off the walking route", () => {
  const uncertain = closure("uncertain");
  const confirmed = closure("confirmed", "blocked");
  const open = closure("open", "open");
  const classified = classifyObstacles([uncertain, confirmed, open], ["open"]);
  assert.deepEqual(
    classified.hard.map((feature) => feature.properties.id),
    ["uncertain", "confirmed", "open"],
  );
  assert.equal(classified.warnings[0]?.code, "approximate-obstacle");
});

test("vehicle-clear sidewalk permits do not block driving routes", () => {
  const sidewalk = closure("sidewalk");
  sidewalk.properties.pedestrianImpact = "blocked";
  sidewalk.properties.vehicleImpact = "clear";
  assert.deepEqual(
    classifyObstacles([sidewalk], [], "driving-car").hard,
    [],
  );
  assert.deepEqual(
    classifyObstacles([sidewalk], [], "foot-walking").hard.map(
      (feature) => feature.properties.id,
    ),
    ["sidewalk"],
  );
});

test("session access overrides affect only the selected travel mode", () => {
  const event = closure("event");
  const roadsClosed = [
    { closureId: "event", access: "roads-closed" as const },
  ];
  const driving = classifyObstacles(
    [event],
    [],
    "driving-car",
    roadsClosed,
  );
  const walking = classifyObstacles(
    [event],
    [],
    "foot-walking",
    roadsClosed,
  );
  assert.deepEqual(
    driving.hard.map((feature) => feature.properties.id),
    ["event"],
  );
  assert.deepEqual(walking.hard, []);
  assert.equal(driving.warnings[0]?.code, "user-access-override");
  assert.equal(walking.warnings[0]?.code, "user-access-override");

  const sidewalkClosed = [
    { closureId: "event", access: "sidewalk-closed" as const },
  ];
  assert.deepEqual(
    classifyObstacles([event], [], "driving-car", sidewalkClosed).hard,
    [],
  );
  assert.deepEqual(
    classifyObstacles([event], [], "foot-walking", sidewalkClosed).hard.map(
      (feature) => feature.properties.id,
    ),
    ["event"],
  );
});

test("route validation bounds and preserves session access overrides", () => {
  const result = validateRouteRequest({
    origin: [-73.99, 40.73],
    destination: [-73.97, 40.74],
    departureTime: "2026-09-26T12:00:00-04:00",
    mode: "foot-walking",
    accessOverrides: [
      { closureId: "event-1", access: "sidewalk-crowded" },
    ],
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.request.accessOverrides, [
      { closureId: "event-1", access: "sidewalk-crowded" },
    ]);
  }
  assert.equal(
    validateRouteRequest({
      origin: [-73.99, 40.73],
      destination: [-73.97, 40.74],
      departureTime: "2026-09-26T12:00:00-04:00",
      mode: "foot-walking",
      accessOverrides: [{ closureId: "event-1", access: "invented" }],
    }).ok,
    false,
  );
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

test("endpoint checks follow the street geometry instead of its full bounding box", () => {
  const diagonal = closure("diagonal");
  diagonal.geometry = {
    type: "LineString",
    coordinates: [
      [-74.0, 40.7],
      [-73.9, 40.8],
    ],
  };
  assert.equal(coordinateInObstacle([-73.95, 40.75], diagonal), true);
  assert.equal(coordinateInObstacle([-73.95, 40.8], diagonal), false);
});

test("a destination on a closure ends at the nearest open point", async () => {
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
                [-74.0, 40.72],
                [-73.985, 40.729],
              ],
            },
            properties: { summary: { duration: 500, distance: 700 } },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  try {
    const result = await findRoute(
      {
        origin: [-74.0, 40.72],
        destination: [-73.985, 40.73],
        departureTime: "2026-09-26T16:00:00.000Z",
        mode: "foot-walking",
      },
      [closure("blocked", "blocked")],
    );
    assert.equal(result.destinationAdjusted, true);
    assert.equal(result.verified, true);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENROUTESERVICE_API_KEY;
    else process.env.OPENROUTESERVICE_API_KEY = originalKey;
  }
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
    const result = await findRoute(
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
    assert.deepEqual(result.avoided, []);
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
    const result = await findRoute(
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

test("fallback routing chooses the route with the fewest interruptions", async () => {
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
                [-74.0, 40.73],
                [-73.97, 40.73],
              ],
            },
            properties: { summary: { duration: 400, distance: 900 } },
          },
          {
            type: "Feature",
            geometry: {
              type: "LineString",
              coordinates: [
                [-74.0, 40.72],
                [-73.97, 40.72],
              ],
            },
            properties: { summary: { duration: 700, distance: 1100 } },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );

  try {
    const result = await findLeastDisruptionRoute(
      {
        origin: [-74.0, 40.73],
        destination: [-73.97, 40.73],
        departureTime: "2026-09-26T16:00:00.000Z",
        mode: "foot-walking",
      },
      [closure("blocked", "blocked")],
    );
    assert.equal(result?.crossed.length, 0);
    assert.equal(result?.route.properties.durationSeconds, 700);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENROUTESERVICE_API_KEY;
    else process.env.OPENROUTESERVICE_API_KEY = originalKey;
  }
});

test("driving routing uses the car profile", async () => {
  const originalKey = process.env.OPENROUTESERVICE_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.OPENROUTESERVICE_API_KEY = "test-key";
  let requestedUrl = "";
  let requestedBody: Record<string, unknown> = {};
  globalThis.fetch = async (input, init) => {
    requestedUrl = String(input);
    requestedBody = JSON.parse(String(init?.body || "{}")) as Record<
      string,
      unknown
    >;
    return new Response(
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
            properties: { summary: { duration: 480, distance: 2200 } },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  try {
    const result = await findRoute(
      {
        origin: [-73.99, 40.73],
        destination: [-73.97, 40.74],
        departureTime: "2026-09-26T16:00:00.000Z",
        mode: "driving-car",
      },
      [],
    );
    assert.match(requestedUrl, /directions\/driving-car\/geojson$/);
    assert.equal(requestedBody.alternative_routes, undefined);
    assert.equal(result.route.properties.durationSeconds, 480);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENROUTESERVICE_API_KEY;
    else process.env.OPENROUTESERVICE_API_KEY = originalKey;
  }
});
