import test from "node:test";
import assert from "node:assert/strict";
import type { TripPlannerDependencies, TransitItinerary } from "../src/lib/trips/types";
import { planTrip, replanTrip } from "../src/lib/trips/graph";
import { deterministicExplanation, chooseDecision, scoreItinerary } from "../src/lib/trips/scoring";
import { validateTripRequest } from "../src/lib/trips/validation";
import { explainPlan } from "../src/lib/trips/explanation";
import { MtaBusTimeClient, OpenTripPlannerRouter } from "../src/lib/transit/otp";

const origin: [number, number] = [-73.985, 40.735];
const destination: [number, number] = [-73.97, 40.75];
const departure = "2026-09-26T12:00:00.000Z";

function leg(
  mode: "WALK" | "SUBWAY" | "BUS",
  start: string,
  end: string,
  name?: string,
) {
  return {
    id: `${mode}-${start}`,
    mode,
    from: { name: mode === "WALK" ? "Origin" : "Current stop", coordinate: origin },
    to: { name: mode === "WALK" ? "Destination" : "Next stop", coordinate: destination },
    startTime: start,
    endTime: end,
    durationSeconds: (Date.parse(end) - Date.parse(start)) / 1000,
    routeName: name,
    status: "realtime" as const,
    geometry: {
      type: "LineString" as const,
      coordinates: [origin, destination],
    },
  };
}

function itinerary(
  id: string,
  arrival: string,
  routeName = "L",
): TransitItinerary {
  const trainStart = "2026-09-26T12:05:00.000Z";
  const trainEnd = "2026-09-26T12:25:00.000Z";
  return {
    id,
    legs: [leg("SUBWAY", trainStart, trainEnd, routeName)],
    departureTime: trainStart,
    arrivalTime: arrival,
    durationSeconds: (Date.parse(arrival) - Date.parse(departure)) / 1000,
    transfers: 0,
    walkingSeconds: 0,
    waitingSeconds: 5 * 60,
    status: "realtime",
    alerts: [],
    provider: "test",
    sourceFetchedAt: new Date().toISOString(),
  };
}

function dependencies(candidates: TransitItinerary[]): TripPlannerDependencies {
  return {
    transitRouter: {
      async plan() {
        return candidates;
      },
    },
    walkingRouter: {
      async route(start, end) {
        return {
          route: {
            type: "Feature" as const,
            geometry: { type: "LineString" as const, coordinates: [start, end] },
            properties: {
              provider: "test",
              durationSeconds: 12 * 60,
              distanceMeters: 1000,
            },
          },
          status: "clear" as const,
          avoidedClosureIds: [],
          warnings: [],
        };
      },
    },
    loadSnapshot: async () => ({
      id: "test-snapshot",
      capturedAt: new Date().toISOString(),
      closures: [],
      feeds: [
        {
          id: "test",
          label: "Test realtime",
          status: "live" as const,
          fetchedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      complete: true,
    }),
    explain: async (plan, alternatives, warnings, deadline) =>
      explainPlan(plan, undefined, "continue", alternatives, warnings, deadline),
  };
}

test("trip validation accepts an arrival deadline and rejects invalid coordinates", () => {
  const futureDeadline = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const valid = validateTripRequest({
    origin,
    destination,
    timing: { type: "arrive-by", time: futureDeadline },
    mode: "transit-walk",
  });
  assert.equal(valid.ok, true);
  const driving = validateTripRequest({
    origin,
    destination,
    timing: {
      type: "arrive-by",
      time: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    },
    mode: "driving-car",
  });
  assert.equal(driving.ok, true);
  if (driving.ok) assert.equal(driving.request.mode, "driving-car");
  const invalid = validateTripRequest({
    origin: [-75, 40.7],
    destination,
    timing: { type: "arrive-by", time: futureDeadline },
  });
  assert.equal(invalid.ok, false);
  const expired = validateTripRequest({
    origin,
    destination,
    timing: {
      type: "arrive-by",
      time: new Date(Date.now() - 60 * 1000).toISOString(),
    },
    mode: "transit-walk",
  });
  assert.equal(expired.ok, false);
});

test("scoring prefers an on-time option over a shorter late option", () => {
  const deadline = Date.parse("2026-09-26T13:00:00.000Z");
  const late = scoreItinerary(
    {
      ...itinerary("late", "2026-09-26T13:10:00.000Z"),
      verified: true,
      blockedLegIds: [],
      avoidedClosureIds: [],
      warnings: [],
    },
    deadline,
  );
  const onTime = scoreItinerary(
    {
      ...itinerary("on-time", "2026-09-26T12:55:00.000Z"),
      verified: true,
      blockedLegIds: [],
      avoidedClosureIds: [],
      warnings: [],
    },
    deadline,
  );
  assert.equal(onTime.score < late.score, true);
});

test("replanning recommends switching when the current service misses the deadline", () => {
  const current = {
    ...itinerary("current", "2026-09-26T13:12:00.000Z"),
    verified: true,
    blockedLegIds: [],
    avoidedClosureIds: [],
    warnings: [],
  };
  const alternate = {
    ...itinerary("alternate", "2026-09-26T12:56:00.000Z", "M15"),
    verified: true,
    blockedLegIds: [],
    avoidedClosureIds: [],
    warnings: [],
  };
  const decision = chooseDecision(
    scoreItinerary(current, Date.parse("2026-09-26T13:00:00.000Z")),
    [scoreItinerary(alternate, Date.parse("2026-09-26T13:00:00.000Z"))],
  );
  assert.equal(decision.action, "switch");
  assert.equal(decision.reasonCode, "current-plan-misses-deadline");
});

test("replanning keeps the current route when the improvement is below the switch margin", () => {
  const current = {
    ...itinerary("current", "2026-09-26T12:55:00.000Z"),
    verified: true,
    blockedLegIds: [],
    avoidedClosureIds: [],
    warnings: [],
  };
  const alternate = {
    ...itinerary("alternate", "2026-09-26T12:52:00.000Z", "M15"),
    verified: true,
    blockedLegIds: [],
    avoidedClosureIds: [],
    warnings: [],
  };
  const decision = chooseDecision(
    scoreItinerary(current, null),
    [scoreItinerary(alternate, null)],
  );
  assert.equal(decision.action, "stay");
  assert.equal(decision.reasonCode, "current-plan-still-best");
});

test("replanning respects a cooldown to prevent route oscillation", () => {
  const current = {
    ...itinerary("current", "2026-09-26T13:05:00.000Z"),
    verified: true,
    blockedLegIds: [],
    avoidedClosureIds: [],
    warnings: [],
  };
  const alternate = {
    ...itinerary("alternate", "2026-09-26T12:45:00.000Z", "M15"),
    verified: true,
    blockedLegIds: [],
    avoidedClosureIds: [],
    warnings: [],
  };
  const decision = chooseDecision(
    scoreItinerary(current, null),
    [scoreItinerary(alternate, null)],
    Date.now(),
    Date.now() - 30_000,
  );
  assert.equal(decision.action, "stay");
  assert.equal(decision.reasonCode, "current-plan-still-best");
});

test("LangGraph returns a grounded plan and deterministic explanation without an LLM key", async () => {
  const response = await planTrip(
    {
      origin,
      destination,
      timing: { type: "arrive-by", time: "2026-09-26T13:00:00.000Z" },
      mode: "transit-walk",
      constraints: { maxTransfers: 3 },
    },
    dependencies([itinerary("subway-1", "2026-09-26T12:50:00.000Z")]),
  );
  assert.equal(response?.status, "ok");
  assert.equal(response?.plan?.id, "subway-1");
  assert.equal(response?.explanation?.provider, "deterministic-template");
  assert.equal(response?.meta.planner, "langgraph-trip-autopilot");
});

test("driving trips use the driving router and produce a drive leg", async () => {
  const deps = dependencies([]);
  let called = false;
  deps.drivingRouter = {
    async route(start, end) {
      called = true;
      return {
        route: {
          type: "Feature" as const,
          geometry: { type: "LineString" as const, coordinates: [start, end] },
          properties: {
            provider: "driving-test",
            durationSeconds: 8 * 60,
            distanceMeters: 2200,
          },
        },
        status: "clear" as const,
        avoidedClosureIds: [],
        warnings: [],
      };
    },
  };
  const response = await planTrip(
    {
      origin,
      destination,
      timing: { type: "arrive-by", time: "2026-09-26T13:00:00.000Z" },
      mode: "driving-car",
      constraints: {},
    },
    deps,
  );
  assert.equal(called, true);
  assert.equal(response?.status, "ok");
  assert.equal(response?.plan?.id, "direct-driving");
  assert.equal(response?.plan?.legs[0]?.mode, "DRIVE");
});

test("replanTrip recalculates from the current position and returns an alternate", async () => {
  const current = {
    ...itinerary("current", "2026-09-26T13:12:00.000Z"),
    verified: true,
    blockedLegIds: [],
    avoidedClosureIds: [],
    warnings: [],
  };
  const result = await replanTrip(
    {
      origin,
      destination,
      timing: { type: "arrive-by", time: "2026-09-26T13:00:00.000Z" },
      mode: "transit-walk",
      constraints: {},
    },
    current,
    origin,
    dependencies([itinerary("alternate", "2026-09-26T12:54:00.000Z", "M15")]),
  );
  assert.equal(result.action, "switch");
  assert.equal(result.recommendedOption?.id, "alternate");
});

test("deterministic explanation remains honest when there is no plan", () => {
  const explanation = deterministicExplanation(
    { action: "recheck", warnings: [] },
    null,
  );
  assert.equal(explanation.provider, "deterministic-template");
  assert.match(explanation.headline, /No verified plan/);
});

test("OTP adapter normalizes realtime subway legs", async () => {
  const originalBase = process.env.OTP_BASE_URL;
  const originalFetch = globalThis.fetch;
  process.env.OTP_BASE_URL = "http://otp.test";
  let requestBody = "";
  globalThis.fetch = async (_input, init) => {
    requestBody = String(init?.body || "");
    return new Response(
      JSON.stringify({
        data: {
          planConnection: {
            edges: [
              {
                node: {
                  startTime: "2026-09-26T12:05:00.000Z",
                  endTime: "2026-09-26T12:35:00.000Z",
                  legs: [
                    {
                      mode: "SUBWAY",
                      startTime: "2026-09-26T12:05:00.000Z",
                      endTime: "2026-09-26T12:35:00.000Z",
                      duration: 1800,
                      realTime: true,
                      from: { name: "14 St", lat: 40.735, lon: -73.99 },
                      to: { name: "Times Sq", lat: 40.758, lon: -73.985 },
                      route: { shortName: "L", color: "A7A9AC" },
                    },
                  ],
                },
              },
            ],
          },
        },
      }),
      { status: 200 },
    );
  };
  try {
    const result = await new OpenTripPlannerRouter().plan({
      origin,
      destination,
      timing: { type: "leave-now" },
      constraints: {},
    });
    assert.equal(result[0]?.legs[0]?.routeName, "L");
    assert.equal(result[0]?.status, "realtime");
    assert.match(requestBody, /planConnection/);
    assert.match(requestBody, /CoordinateValue!/);
    assert.match(requestBody, /PlanDateTimeInput!/);
    assert.match(requestBody, /alertDescriptionText/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBase === undefined) delete process.env.OTP_BASE_URL;
    else process.env.OTP_BASE_URL = originalBase;
  }
});

test("Bus Time adapter falls back honestly without a key and parses live predictions", async () => {
  const originalKey = process.env.MTA_BUS_TIME_API_KEY;
  const originalFetch = globalThis.fetch;
  delete process.env.MTA_BUS_TIME_API_KEY;
  const unavailable = await new MtaBusTimeClient().stopPredictions("308214", "B63");
  assert.equal(unavailable.status, "unavailable");
  assert.equal(unavailable.freshness.status, "scheduled");
  process.env.MTA_BUS_TIME_API_KEY = "fixture-key";
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        Siri: {
          ServiceDelivery: {
            StopMonitoringDelivery: [
              {
                MonitoredStopVisit: [
                  {
                    MonitoredVehicleJourney: {
                      PublishedLineName: "B63",
                      VehicleRef: "1234",
                      MonitoredCall: {
                        ExpectedArrivalTime: "2026-09-26T12:20:00-04:00",
                        Extensions: { Distances: { StopsFromCall: 2 } },
                      },
                    },
                  },
                ],
              },
            ],
          },
        },
      }),
      { status: 200 },
    );
  try {
    const live = await new MtaBusTimeClient().stopPredictions("308214", "B63");
    assert.equal(live.status, "live");
    assert.equal(live.predictions[0]?.routeName, "B63");
    assert.equal(live.predictions[0]?.stopsAway, 2);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.MTA_BUS_TIME_API_KEY;
    else process.env.MTA_BUS_TIME_API_KEY = originalKey;
  }
});
