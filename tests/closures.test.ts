import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeFeature,
  SOURCES,
  activeAt,
  overlaps,
  validGeometry,
  inBounds,
} from "../src/lib/closures/normalize";
import {
  newYorkDateTimeInput,
  newYorkHourWindow,
  TIMELINE_HOURS,
} from "../src/lib/closures/time";
import { parseEventLocation } from "../src/lib/closures/centerline";
import { normalizePermittedEvent } from "../src/lib/closures/permitted-events";

const rawEvent = {
  geometry: {
    type: "LineString",
    coordinates: [
      [-73.98, 40.75],
      [-73.97, 40.76],
    ],
  },
  properties: {
    OBJECTID: 12,
    EventName: "Parade",
    R_EventStartDate: 20000,
    R_EventEndDate: 30000,
    R_EventSetupStartDate: 10000,
    R_EventBreakDownEndDate: 40000,
  },
};
test("event footprint includes setup and breakdown but does not claim pedestrian closure", () => {
  const f = normalizeFeature(rawEvent, SOURCES[0])!;
  assert.equal(f.properties.start, 10000);
  assert.equal(f.properties.end, 40000);
  assert.equal(f.properties.pedestrianImpact, "unknown");
  assert.equal(f.properties.id, "events-12");
  assert.equal(f.properties.eventStart, 20000);
});
test("time windows include overlapping schedules and exclude expired and later closures", () => {
  const f = normalizeFeature(rawEvent, SOURCES[0])!;
  assert.equal(overlaps(f, 15000, 25000), true);
  assert.equal(overlaps(f, 40001, 50000), false);
  assert.equal(overlaps(f, 1, 9999), false);
});
test("live disruption filtering only includes closures active at the selected instant", () => {
  const f = normalizeFeature(rawEvent, SOURCES[0])!;
  assert.equal(activeAt(f, 10000), true);
  assert.equal(activeAt(f, 25000), true);
  assert.equal(activeAt(f, 40001), false);
});
test("timeline advances in hourly NYC-local steps across the seven-day window", () => {
  const now = Date.parse("2026-09-26T19:30:00.000Z");
  const current = newYorkHourWindow(0, now);
  const next = newYorkHourWindow(1, now);
  assert.equal(current.start, now);
  assert.equal(current.end - current.start, 60 * 60 * 1000);
  assert.match(current.label, /^Now · /);
  assert.match(next.label, /^Today · /);
  assert.equal(newYorkDateTimeInput(24, now), "2026-09-27T15:30");
  assert.equal(TIMELINE_HOURS, 168);
});
test("rejects malformed coordinates, missing timestamps, inverted schedules and missing IDs", () => {
  assert.equal(
    validGeometry({ type: "Point", coordinates: [40.75, -73.98] }),
    false,
  );
  assert.equal(
    validGeometry({
      type: "LineString",
      coordinates: [
        [NaN, 40.75],
        [-73.9, 40.7],
      ],
    }),
    false,
  );
  assert.equal(
    normalizeFeature({ ...rawEvent, properties: { OBJECTID: 12 } }, SOURCES[0]),
    null,
  );
  assert.equal(
    normalizeFeature(
      {
        ...rawEvent,
        properties: {
          OBJECTID: 12,
          R_EventStartDate: 40000,
          R_EventEndDate: 10000,
        },
      },
      SOURCES[0],
    ),
    null,
  );
  assert.equal(
    normalizeFeature(
      {
        ...rawEvent,
        properties: { ...rawEvent.properties, OBJECTID: undefined },
      },
      SOURCES[0],
    ),
    null,
  );
});
test("construction intersections retain point geometry and source-specific IDs", () => {
  const f = normalizeFeature(
    {
      geometry: { type: "Point", coordinates: [-73.98, 40.75] },
      properties: {
        OBJECTID: 12,
        OnStreetName: "BROADWAY",
        FromStreetName: "WEST 42 STREET",
        Borough_Code: "M",
        Work_Start_Date: 10000,
        Work_End_Date: 30000,
      },
    },
    SOURCES[2],
  )!;
  assert.equal(f.geometry.type, "Point");
  assert.equal(f.properties.title, "Broadway");
  assert.equal(f.properties.borough, "Manhattan");
  assert.equal(f.properties.id, "intersections-12");
  assert.equal(inBounds(f, [-74, 40.7, -73.9, 40.8]), true);
  assert.equal(inBounds(f, [-74, 40.5, -73.9, 40.6]), false);
});
test("permitted events parse street ranges and preserve vehicle impact", () => {
  const locations = parseEventLocation(
    "WEST 38 STREET between BROADWAY and 5 AVENUE, 6 AVENUE between WEST 38 STREET and WEST 27 STREET",
  );
  assert.deepEqual(locations, [
    { street: "WEST 38 STREET", from: "BROADWAY", to: "5 AVENUE" },
    {
      street: "6 AVENUE",
      from: "WEST 38 STREET",
      to: "WEST 27 STREET",
    },
  ]);
  const feature = normalizePermittedEvent(
    {
      event_id: "event-1",
      event_name: "Parade",
      start_date_time: "2026-10-06T08:00:00.000",
      end_date_time: "2026-10-06T18:00:00.000",
      event_borough: "Manhattan",
      event_location: locations[0].street,
      street_closure_type: "Full Street Closure",
    },
    {
      type: "MultiLineString",
      coordinates: [[[-73.99, 40.75], [-73.98, 40.75]]],
    },
  )!;
  assert.equal(feature.properties.id, "permitted-events-event-1");
  assert.equal(feature.properties.vehicleImpact, "blocked");
  assert.equal(feature.properties.pedestrianImpact, "unknown");
  const sidewalk = normalizePermittedEvent(
    {
      event_id: "event-2",
      start_date_time: "2026-10-06T08:00:00.000",
      end_date_time: "2026-10-06T18:00:00.000",
      street_closure_type: "Full Sidewalk Closure",
    },
    feature.geometry,
  )!;
  assert.equal(sidewalk.properties.vehicleImpact, "clear");
  assert.equal(sidewalk.properties.pedestrianImpact, "blocked");
});
