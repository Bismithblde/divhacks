import { test, expect, type Page } from "@playwright/test";

const destination = {
  id: "way-times-square",
  label: "Times Square, New York, NY",
  coordinate: [-73.9855, 40.758] as [number, number],
};

function step(id: string, instruction: string, start: string, end: string) {
  return {
    id,
    kind: "walk",
    mode: "WALK",
    instruction,
    from: {
      name: "Current location",
      coordinate: [-73.985, 40.735],
    },
    to: {
      name: "14 St Station",
      coordinate: [-73.99, 40.737],
    },
    startTime: start,
    endTime: end,
    durationSeconds: Math.max(1, (Date.parse(end) - Date.parse(start)) / 1000),
    status: "realtime",
  };
}

function routeOption(
  id: string,
  routeName: string,
  mode: "SUBWAY" | "BUS",
  departure: string,
  arrival: string,
) {
  const walkStart = new Date(Date.parse(departure) - 5 * 60_000).toISOString();
  return {
    id,
    legs: [
      {
        id: `${id}-walk`,
        mode: "WALK",
        from: {
          name: "Current location",
          coordinate: [-73.985, 40.735],
        },
        to: {
          name: "14 St Station",
          coordinate: [-73.99, 40.737],
        },
        startTime: walkStart,
        endTime: departure,
        durationSeconds: 300,
        status: "realtime",
        steps: [step(`${id}-walk-step`, "Walk to 14 St Station.", walkStart, departure)],
      },
      {
        id: `${id}-${mode.toLowerCase()}`,
        mode,
        from: {
          name: "14 St Station",
          coordinate: [-73.99, 40.737],
        },
        to: {
          name: "Times Sq Station",
          coordinate: destination.coordinate,
        },
        startTime: departure,
        endTime: arrival,
        durationSeconds: (Date.parse(arrival) - Date.parse(departure)) / 1000,
        routeName,
        status: "realtime",
        steps: [
          {
            id: `${id}-board`,
            kind: "board",
            mode,
            instruction: `Board ${routeName} at 14 St Station.`,
            from: {
              name: "14 St Station",
              coordinate: [-73.99, 40.737],
            },
            to: {
              name: "14 St Station",
              coordinate: [-73.99, 40.737],
            },
            startTime: departure,
            endTime: departure,
            durationSeconds: 0,
            routeName,
            status: "realtime",
          },
          {
            id: `${id}-ride`,
            kind: "ride",
            mode,
            instruction: `Take ${routeName} to Times Sq Station.`,
            from: {
              name: "14 St Station",
              coordinate: [-73.99, 40.737],
            },
            to: {
              name: "Times Sq Station",
              coordinate: destination.coordinate,
            },
            startTime: departure,
            endTime: arrival,
            durationSeconds: (Date.parse(arrival) - Date.parse(departure)) / 1000,
            routeName,
            status: "realtime",
          },
        ],
      },
    ],
    departureTime: walkStart,
    arrivalTime: arrival,
    durationSeconds: (Date.parse(arrival) - Date.parse(walkStart)) / 1000,
    transfers: 0,
    walkingSeconds: 300,
    waitingSeconds: 0,
    status: "realtime",
    alerts: [],
    provider: "e2e",
    sourceFetchedAt: new Date().toISOString(),
    verified: true,
    blockedLegIds: [],
    avoidedClosureIds: [],
    warnings: [],
    arrivalBufferSeconds: 600,
    score: 1,
    switchingCostSeconds: 0,
    riskPenaltySeconds: 0,
    steps: [
      step(
        `${id}-summary-walk`,
        "Walk to 14 St Station.",
        walkStart,
        departure,
      ),
      {
        id: `${id}-summary-ride`,
        kind: "ride",
        mode,
        instruction: `Take ${routeName} to Times Sq Station.`,
        from: {
          name: "14 St Station",
          coordinate: [-73.99, 40.737],
        },
        to: {
          name: "Times Sq Station",
          coordinate: destination.coordinate,
        },
        startTime: departure,
        endTime: arrival,
        durationSeconds: (Date.parse(arrival) - Date.parse(departure)) / 1000,
        routeName,
        status: "realtime",
      },
    ],
  };
}

function planFixture(missed = false) {
  const now = Date.now();
  const departure = new Date(
    now + (missed ? -4 : 6) * 60_000,
  ).toISOString();
  const arrival = new Date(
    now + (missed ? 20 : 28) * 60_000,
  ).toISOString();
  const plan = routeOption("subway-plan", "L", "SUBWAY", departure, arrival);
  const bus = routeOption(
    "bus-plan",
    "M15",
    "BUS",
    new Date(now + 8 * 60_000).toISOString(),
    new Date(now + 25 * 60_000).toISOString(),
  );
  return {
    status: "ok",
    plan,
    alternatives: [bus],
    explanation: {
      headline: "Take the L",
      action: "continue",
      reason: "This is the best verified route.",
      steps: ["Walk to 14 St Station.", "Take the L."],
      caveats: [],
      provider: "deterministic-template",
    },
    warnings: [],
    meta: {
      requestedAt: new Date().toISOString(),
      planner: "e2e",
      snapshotId: "e2e-snapshot",
      feeds: [],
      attempts: { transit: 1, walking: 1 },
    },
  };
}

async function mockBase(page: Page) {
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
          coverage: "E2E",
        },
      }),
    });
  });
  await page.route("**/api/geocode?*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: [destination] }),
    });
  });
}

async function chooseDestination(page: Page) {
  await page.getByRole("combobox", { name: "Where to go?" }).fill("Times Square");
  await page.getByRole("button", { name: destination.label, exact: true }).click();
}

test("plans transit alternatives and exposes ordered steps", async ({ page }) => {
  await mockBase(page);
  await page.route("**/api/trips/plan", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(planFixture()),
    });
  });
  await page.goto("/");
  await chooseDestination(page);
  const collapsePanel = page.getByRole("button", {
    name: "Collapse closure panel",
    exact: true,
  });
  if (await collapsePanel.isVisible()) await collapsePanel.click();
  const hideSidebar = page.getByRole("button", {
    name: "Hide closures sidebar",
    exact: true,
  });
  if (await hideSidebar.count()) await hideSidebar.click();
  await page.getByRole("button", { name: "Find take transit", exact: true }).click();
  await expect(page.locator(".closure-panel")).toHaveClass(/expanded/);
  await expect(page.locator(".closure-panel")).not.toHaveClass(/sidebar-collapsed/);
  await expect(page.getByTestId("route-options")).toBeVisible();
  await expect(page.getByText("2 options", { exact: true })).toBeVisible();
  await expect(page.getByTestId("route-steps")).toBeVisible();
  await expect(
    page.getByText("Take L to Times Sq Station.", { exact: true }),
  ).toBeVisible();
  await page.locator(".route-option-card").nth(1).click();
  await expect(page.getByText("Take M15 to Times Sq Station.", { exact: true })).toBeVisible();
});

test("uses one search while switching between walk and drive", async ({ page }) => {
  await mockBase(page);
  const modes: string[] = [];
  await page.route("**/api/routes", async (route) => {
    const body = JSON.parse(route.request().postData() || "{}") as { mode?: string };
    modes.push(body.mode || "");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "ok",
        route: {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [[-73.985, 40.735], destination.coordinate],
          },
          properties: {
            provider: "e2e",
            durationSeconds: 600,
            distanceMeters: 1200,
            instructions: [
              {
                instruction: "Head north on Broadway.",
                distanceMeters: 1200,
                durationSeconds: 600,
                wayPoints: [0, 1],
              },
            ],
          },
        },
        durationSeconds: 600,
        distanceMeters: 1200,
        alternative: {
          label: "faster-with-disruptions",
          route: {
            type: "Feature",
            geometry: {
              type: "LineString",
              coordinates: [[-73.985, 40.735], [-73.984, 40.75], destination.coordinate],
            },
            properties: {
              provider: "e2e",
              durationSeconds: 300,
              distanceMeters: 700,
            },
          },
          durationSeconds: 300,
          distanceMeters: 700,
          crossedClosures: [],
          timeSavedSeconds: 300,
        },
        avoidedClosures: [],
        warnings: [],
        meta: {
          provider: "e2e",
          requestedAt: new Date().toISOString(),
          departureTime: new Date().toISOString(),
          coverage: "E2E",
          dataComplete: true,
          verificationAttempts: 1,
        },
      }),
    });
  });
  await page.goto("/");
  await chooseDestination(page);
  await page.getByRole("button", { name: "Travel mode: take transit", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Walk", exact: true }).click();
  await page.getByRole("button", { name: "Find walk", exact: true }).click();
  await expect(page.getByTestId("route-options")).toBeVisible();
  await expect(page.getByText("2 options", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Travel mode: walk", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Drive", exact: true }).click();
  await page.getByRole("button", { name: "Find drive", exact: true }).click();
  await expect(page.getByText("Drive", { exact: true })).toBeVisible();
  await expect.poll(() => modes).toEqual(["foot-walking", "driving-car"]);
});

test("starts a trip, detects a missed train, and offers a switch", async ({ page }) => {
  await mockBase(page);
  await page.route("**/api/trips/plan", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(planFixture(true)),
    });
  });
  await page.route("**/api/trips/replan", async (route) => {
    const replacement = routeOption(
      "bus-replacement",
      "M15",
      "BUS",
      new Date(Date.now() + 5 * 60_000).toISOString(),
      new Date(Date.now() + 22 * 60_000).toISOString(),
    );
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        action: "switch",
        reasonCode: "missed-departure",
        options: [
          {
            id: "keep-current",
            action: "keep-current",
            label: "Keep current route",
            description: "Continue waiting.",
            option: planFixture(true).plan,
          },
          {
            id: replacement.id,
            action: "switch",
            label: "Switch route",
            description: "Arrive around the next available time.",
            recommended: true,
            option: replacement,
          },
        ],
        alternatives: [replacement],
        warnings: [],
        explanation: {
          headline: "Your train was missed",
          action: "switch",
          reason: "A bus gets you there sooner than waiting.",
          steps: ["Walk to the M15."],
          caveats: [],
          provider: "deterministic-template",
        },
        meta: {
          requestedAt: new Date().toISOString(),
          planner: "e2e",
          snapshotId: "e2e",
          feeds: [],
          attempts: { transit: 1, walking: 1 },
        },
      }),
    });
  });
  await page.goto("/");
  await chooseDestination(page);
  await page.getByRole("button", { name: "Find take transit", exact: true }).click();
  await page.getByRole("button", { name: "Start this route", exact: true }).click();
  await expect(page.getByTestId("active-trip")).toBeVisible();
  await expect(page.getByTestId("active-trip")).toContainText("Trip in progress");
  await expect(page.getByTestId("trip-adjustment")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "Your train was missed" })).toBeVisible();
  await page.locator(".trip-adjustment-option").filter({ hasText: "Switch route" }).click();
  await expect(page.getByTestId("trip-adjustment")).toHaveCount(0);
  expect(
    await page.evaluate(() => sessionStorage.getItem("blockednyc.active-trip.v1")),
  ).toContain("bus-replacement");
});

test("shows a safe failure when transit planning is unavailable", async ({ page }) => {
  await mockBase(page);
  await page.route("**/api/trips/plan", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        status: "unavailable",
        alternatives: [],
        warnings: [],
        error: "Live transit planning is unavailable.",
      }),
    });
  });
  await page.goto("/");
  await chooseDestination(page);
  await page.getByRole("button", { name: "Find take transit", exact: true }).click();
  await expect(page.locator(".route-error")).toContainText(
    "Live transit planning is unavailable.",
  );
  await expect(page.getByTestId("route-options")).toHaveCount(0);
});

test("keeps the map workspace within a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await mockBase(page);
  await page.route("**/api/trips/plan", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(planFixture()),
    });
  });
  await page.goto("/");
  await chooseDestination(page);
  await page.getByRole("button", { name: "Find take transit", exact: true }).click();
  await expect(page.getByTestId("route-options")).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
});
