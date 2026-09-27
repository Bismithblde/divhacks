import { test, expect, type Page } from "@playwright/test";

test.describe.skip("superseded planning-first journeys", () => {

const destination = {
  id: "way-times-square",
  label: "Times Square, New York, NY",
  coordinate: [-73.9855, 40.758] as [number, number],
};

function times() {
  const now = Date.now();
  return {
    departure: new Date(now + 8 * 60_000).toISOString(),
    arrival: new Date(now + 34 * 60_000).toISOString(),
  };
}

function planFixture() {
  const { departure, arrival } = times();
  return {
    status: "ok",
    plan: {
      id: "subway-plan",
      legs: [
        {
          id: "walk-to-station",
          mode: "WALK",
          from: { name: "Current location", coordinate: [-73.985, 40.735] },
          to: { name: "14 St Station", coordinate: [-73.99, 40.737] },
          startTime: departure,
          endTime: new Date(Date.parse(departure) + 5 * 60_000).toISOString(),
          durationSeconds: 300,
          status: "realtime",
        },
        {
          id: "subway-l",
          mode: "SUBWAY",
          from: { name: "14 St Station", coordinate: [-73.99, 40.737] },
          to: { name: "Times Sq Station", coordinate: destination.coordinate },
          startTime: new Date(Date.parse(departure) + 7 * 60_000).toISOString(),
          endTime: arrival,
          durationSeconds: 1_200,
          routeName: "L",
          status: "realtime",
          realtimeSource: "MTA GTFS-Realtime via OTP",
        },
      ],
      departureTime: departure,
      arrivalTime: arrival,
      durationSeconds: 2_040,
      transfers: 0,
      walkingSeconds: 300,
      waitingSeconds: 120,
      status: "realtime",
      alerts: [],
      provider: "open-trip-planner",
      sourceFetchedAt: new Date().toISOString(),
      verified: true,
      blockedLegIds: [],
      avoidedClosureIds: [],
      warnings: [],
      arrivalBufferSeconds: 6 * 60,
      score: 1,
      switchingCostSeconds: 0,
      riskPenaltySeconds: 0,
    },
    alternatives: [],
    explanation: {
      headline: "Take the L",
      action: "continue",
      reason: "This is the best verified option with a 6-minute buffer.",
      steps: ["Use L.", "0 transfers · 5 min walking."],
      caveats: [],
      provider: "deterministic-template",
    },
    warnings: [],
    meta: {
      requestedAt: new Date().toISOString(),
      planner: "langgraph-trip-autopilot",
      snapshotId: "e2e-snapshot",
      feeds: [],
      attempts: { transit: 1, walking: 1 },
    },
  };
}

async function mockSearch(page: Page) {
  await page.route("**/api/geocode?*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: [destination] }),
    });
  });
}

async function chooseDestination(page: Page) {
  await page.getByRole("combobox", { name: "Where are you going?" }).fill("Times Square");
  await expect(
    page.getByRole("button", { name: destination.label, exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: destination.label, exact: true }).click();
}

test("plans a deadline trip and explains the realtime itinerary", async ({ page }) => {
  await mockSearch(page);
  const requests: unknown[] = [];
  await page.route("**/api/trips/plan", async (route) => {
    requests.push(JSON.parse(route.request().postData() || "{}"));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(planFixture()),
    });
  });
  await page.goto("/map");
  await expect(page.getByRole("heading", { name: "Get there without guessing." })).toBeVisible();
  await chooseDestination(page);
  await page.getByRole("button", { name: "Get me there", exact: true }).click();
  await expect(page.getByTestId("trip-plan")).toBeVisible();
  await expect(page.getByText("Take the L", { exact: true })).toBeVisible();
  await expect(page.getByText("6 min", { exact: false })).toHaveCount(1);
  await expect(page.getByText("Live estimates", { exact: true })).toBeVisible();
  expect((requests[0] as { mode?: string }).mode).toBe("transit-walk");
  expect((requests[0] as { timing?: { type?: string } }).timing?.type).toBe("arrive-by");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
});

test("rechecks after a missed train and recommends switching", async ({ page }) => {
  await mockSearch(page);
  await page.route("**/api/trips/plan", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(planFixture()),
    });
  });
  await page.route("**/api/trips/replan", async (route) => {
    const body = JSON.parse(route.request().postData() || "{}");
    expect(body.currentPlan.id).toBe("subway-plan");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        action: "switch",
        reasonCode: "service-cancelled",
        recommendedOption: {
          ...planFixture().plan,
          id: "bus-alternative",
          arrivalTime: new Date(Date.now() + 25 * 60_000).toISOString(),
          legs: [
            {
              ...planFixture().plan.legs[0],
              id: "walk-to-bus",
            },
            {
              ...planFixture().plan.legs[1],
              id: "bus-m15",
              mode: "BUS",
              routeName: "M15",
            },
          ],
        },
        alternatives: [],
        warnings: [
          {
            code: "stale-transit",
            message: "The train service was cancelled; the bus prediction is 2 minutes old.",
          },
        ],
        explanation: {
          headline: "Switch to the M15",
          action: "switch",
          reason: "The train was cancelled. The M15 gets you there sooner.",
          steps: ["Walk to the M15 stop."],
          caveats: ["Bus prediction is 2 minutes old."],
          provider: "deterministic-template",
        },
        meta: {
          requestedAt: new Date().toISOString(),
          planner: "langgraph-trip-autopilot",
          snapshotId: "replan-snapshot",
          feeds: [],
          attempts: { transit: 1, walking: 1 },
        },
      }),
    });
  });
  await page.goto("/map");
  await chooseDestination(page);
  await page.getByRole("button", { name: "Get me there", exact: true }).click();
  await page.getByRole("button", { name: /Recheck my trip/ }).click();
  await expect(page.getByTestId("trip-decision")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Switch to the M15" })).toBeVisible();
  await expect(page.getByText(/train was cancelled/)).toBeVisible();
  await expect(page.getByText(/Bus prediction is 2 minutes old/)).toHaveCount(1);
});

test("keeps the user informed when trip planning is unavailable", async ({ page }) => {
  await mockSearch(page);
  await page.route("**/api/trips/plan", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        status: "unavailable",
        alternatives: [],
        warnings: [
          {
            code: "provider-limited",
            message: "Live transit planning is unavailable.",
          },
        ],
        error: "Live transit planning is unavailable.",
      }),
    });
  });
  await page.goto("/map");
  await chooseDestination(page);
  await page.getByRole("button", { name: "Get me there", exact: true }).click();
  await expect(page.locator(".autopilot-alert[role='alert']")).toContainText(
    "Live transit planning is unavailable.",
  );
  await expect(page.getByTestId("trip-plan")).toHaveCount(0);
});

test("requires a real destination before requesting a trip plan", async ({ page }) => {
  await page.goto("/map");
  await page.getByRole("button", { name: "Get me there", exact: true }).click();
  await expect(page.locator(".autopilot-alert[role='alert']")).toContainText(
    "Choose a destination from the search results.",
  );
  await expect(page.getByTestId("trip-plan")).toHaveCount(0);
});

test("stays usable on a narrow mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await mockSearch(page);
  await page.route("**/api/trips/plan", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(planFixture()),
    });
  });
  await page.goto("/map");
  await chooseDestination(page);
  await page.getByRole("button", { name: "Get me there", exact: true }).click();
  await expect(page.getByTestId("trip-plan")).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
});

test("keeps the detailed disruption map available as a secondary workflow", async ({ page }) => {
  await page.route("**/api/closures?*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        type: "FeatureCollection",
        features: [],
        meta: {
          fetchedAt: new Date().toISOString(),
          start: Date.now(),
          end: Date.now() + 7 * 24 * 60 * 60 * 1000,
          days: 7,
          sources: [],
          complete: true,
          coverage: "Test coverage",
        },
      }),
    });
  });
  await page.goto("/map");
  await page.getByRole("button", { name: "Explore disruptions", exact: true }).click();
  await expect(page.getByRole("button", { name: "Back to Trip Autopilot" })).toBeVisible();
  await expect(page.getByTestId("closure-map")).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
});
});
