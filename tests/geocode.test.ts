import assert from "node:assert/strict";
import test from "node:test";
import { parseResults } from "../src/lib/geocoding/parse";

function place(name: string, label: string, longitude: number, county = "New York County") {
  return {
    geometry: { type: "Point", coordinates: [longitude, 40.756] },
    properties: {
      name,
      label,
      county,
      region: "New York",
      region_a: "NY",
    },
  };
}

test("place search ranks an exact landmark above nearby names and removes duplicates", () => {
  const results = parseResults(
    {
      features: [
        place("Times Square Tower", "Times Square Tower, New York, NY, USA", -73.9868),
        place("One Times Square", "One Times Square, New York, NY, USA", -73.9865),
        place("Times Square", "Times Square, New York, NY, USA", -73.9860),
        place("Times Square", "Times Square, New York, NY, USA", -73.9861),
        place("Times Square", "Times Square, Washington, NJ, USA", -74.0564, "Bergen County"),
      ],
    },
    "Times Square",
  );

  assert.deepEqual(results.map(({ label }) => label), [
    "Times Square, New York, NY, USA",
    "Times Square Tower, New York, NY, USA",
    "One Times Square, New York, NY, USA",
  ]);
});

test("business names can match exactly while address results remain available", () => {
  const results = parseResults(
    {
      features: [
        place("Joe's Pizza of Park Slope", "Joe's Pizza of Park Slope, Brooklyn, NY, USA", -73.982, "Kings County"),
        place("Joe's Pizza", "Joe's Pizza, New York, NY, USA", -73.997),
      ],
    },
    "Joe's Pizza",
  );

  assert.equal(results[0]?.label, "Joe's Pizza, New York, NY, USA");
  assert.equal(results.length, 2);
});
