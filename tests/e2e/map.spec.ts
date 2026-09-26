import { test, expect } from "@playwright/test";
import type { ClosureResponse } from "../../src/lib/closures/types";

test("real NYC feeds render; filter, inspect, search, and change time window", async ({
  page,
}, testInfo) => {
  const exceptions: string[] = [];
  page.on("pageerror", (e) => exceptions.push(e.message));
  let loadedTiles = 0;
  page.on("response", (r) => {
    if (
      r.ok() &&
      r.url().includes("tiles.openfreemap.org/planet/") &&
      r.url().endsWith(".pbf")
    )
      loadedTiles++;
  });
  const responsePromise = page.waitForResponse((r) =>
    r.url().includes("/api/closures?days=7"),
  );
  await page.goto("/");
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  const body: ClosureResponse = await response.json();
  expect(body.features.length).toBeGreaterThan(0);
  expect(body.meta.complete).toBe(true);
  expect(body.meta.sources).toHaveLength(3);
  for (const s of body.meta.sources) {
    expect(s.status).toBe("ok");
    expect(s.unmapped).toBe(0);
    expect(s.total).toBeGreaterThan(0);
  }
  const map = page.getByTestId("closure-map");
  await expect(map).toHaveAttribute("data-ready", "true", { timeout: 45000 });
  await expect(map).toHaveAttribute(
    "data-feature-count",
    /\d+/,
  );
  const currentCount = Number(await map.getAttribute("data-feature-count"));
  expect(currentCount).toBeGreaterThan(0);
  await expect(page.locator(".map-loading")).toHaveCount(0);
  // Wait for actual tile responses, not just an empty WebGL canvas.
  await expect.poll(() => loadedTiles).toBeGreaterThan(0);
  await page.waitForLoadState("networkidle");
  await page.screenshot({
    path: `.impeccable/review/${testInfo.project.name}.png`,
    fullPage: true,
  });
  if (testInfo.project.name === "mobile")
    await page
      .getByRole("button", { name: "Expand closure panel", exact: true })
      .click();
  await page.getByRole("button", { name: /^Events/ }).click();
  const eventCount = Number(await map.getAttribute("data-feature-count"));
  expect(eventCount).toBeGreaterThanOrEqual(0);
  await page.getByRole("button", { name: /^Construction/ }).click();
  const constructionCount = Number(
    await map.getAttribute("data-feature-count"),
  );
  expect(constructionCount).toBeGreaterThanOrEqual(0);
  expect(eventCount + constructionCount).toBe(currentCount);
  await page.getByRole("button", { name: /^All [\d,]+/ }).click();
  await expect(map).toHaveAttribute(
    "data-feature-count",
    String(currentCount),
  );
  const first = page.locator(".closure-row").first();
  const title = await first.locator("strong").innerText();
  await first.click();
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Walking access unconfirmed")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "View official source" }),
  ).toHaveAttribute("href", /services6\.arcgis\.com/);
  await page.getByRole("button", { name: "All closures", exact: true }).click();
  // The selected street remains at the center after returning to the list.
  await page.waitForTimeout(650);
  const canvas = page.locator(".maplibregl-canvas");
  const box = await canvas.boundingBox();
  await canvas.click({ position: { x: box!.width / 2, y: box!.height / 2 } });
  await expect(
    page.getByText("Walking access unconfirmed", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "All closures", exact: true }).click();
  await page.getByLabel("Find a street or event").fill("no-such-street-zzzz");
  await expect(
    page.getByRole("heading", { name: "No matching closures" }),
  ).toBeVisible();
  await expect(map).toHaveAttribute("data-feature-count", "0");
  await page.getByRole("button", { name: "Reset filters" }).click();
  await expect(map).toHaveAttribute(
    "data-feature-count",
    String(currentCount),
  );
  const moreMap = page.getByRole("button", { name: "More map", exact: true });
  if (await moreMap.count()) await moreMap.click();
  const timeline = page.getByTestId("closure-timeline");
  await expect(timeline).toHaveValue("0");
  await timeline.press("ArrowRight");
  await expect(timeline).toHaveValue("1");
  await expect(page.getByText(/^Tomorrow ·/)).toBeVisible();
  await page.getByRole("button", { name: "Data sources", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Data sources", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Connected", { exact: true })).toHaveCount(3);
  await expect(
    page.getByText("All records processed", { exact: false }),
  ).toHaveCount(3);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(exceptions).toEqual([]);
});

test("requests location on load and displays an in-coverage position", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 40.735, longitude: -73.985 });
  await page.goto("/");
  await expect(page.getByTestId("closure-map")).toHaveAttribute(
    "data-location-visible",
    "true",
    { timeout: 45000 },
  );
});

test("searches an NYC destination and places it on the map", async ({ page }) => {
  await page.route("**/api/geocode?*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: [
          {
            id: "way/columbia",
            label: "Columbia University, New York, NY",
            coordinate: [-73.9626, 40.8075],
          },
        ],
      }),
    });
  });
  await page.goto("/");
  await expect(page.getByTestId("closure-map")).toHaveAttribute(
    "data-ready",
    "true",
    { timeout: 45000 },
  );
  if (await page.getByRole("button", { name: "Expand closure panel", exact: true }).count())
    await page.getByRole("button", { name: "Expand closure panel", exact: true }).click();
  await page
    .getByLabel("Or search an NYC address or place")
    .fill("Columbia University");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: "Columbia University, New York, NY",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Columbia University, New York, NY",
      exact: true,
    })
    .click();
  await expect(
    page.getByText("To Columbia University, New York, NY", { exact: true }),
  ).toBeVisible();
});

test("selects a destination and renders a verified walking route", async ({
  page,
}) => {
  await page.route("**/api/routes", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "ok",
        route: {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [-73.9626, 40.8075],
              [-73.97, 40.79],
            ],
          },
          properties: {
            provider: "test",
            durationSeconds: 600,
            distanceMeters: 1200,
          },
        },
        durationSeconds: 600,
        distanceMeters: 1200,
        avoidedClosures: [],
        warnings: [
          {
            code: "uncertain-pedestrian-impact",
            message:
              "Some scheduled closures may affect the trip, but walking access has not been confirmed.",
          },
        ],
        meta: {
          provider: "test",
          requestedAt: new Date().toISOString(),
          departureTime: new Date().toISOString(),
          coverage: "Test coverage",
          dataComplete: true,
          verificationAttempts: 1,
        },
      }),
    });
  });
  await page.goto("/");
  await expect(page.getByTestId("closure-map")).toHaveAttribute(
    "data-ready",
    "true",
    { timeout: 45000 },
  );
  if (await page.getByRole("button", { name: "Expand closure panel", exact: true }).count())
    await page.getByRole("button", { name: "Expand closure panel", exact: true }).click();
  await page.getByRole("button", { name: "Choose destination on map", exact: true }).click();
  const canvas = page.locator(".maplibregl-canvas");
  const box = await canvas.boundingBox();
  await canvas.click({ position: { x: box!.width / 2, y: box!.height / 2 } });
  await expect(page.getByText(/^To /)).toBeVisible();
  await page.getByRole("button", { name: "Find fastest clear walk", exact: true }).click();
  await expect(page.getByText("About 10 min walking")).toBeVisible();
  await expect(page.getByText(/walking access has not been confirmed/)).toBeVisible();
});

test("does not render a route when walking directions are unavailable", async ({
  page,
}) => {
  await page.route("**/api/routes", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "no-route",
        error: "No verified walking route is available.",
        avoidedClosures: [],
        warnings: [],
        meta: {
          provider: "test",
          requestedAt: new Date().toISOString(),
          departureTime: new Date().toISOString(),
          coverage: "Test coverage",
          dataComplete: true,
          verificationAttempts: 2,
        },
      }),
    });
  });
  await page.goto("/");
  await expect(page.getByTestId("closure-map")).toHaveAttribute(
    "data-ready",
    "true",
    { timeout: 45000 },
  );
  if (await page.getByRole("button", { name: "Expand closure panel", exact: true }).count())
    await page.getByRole("button", { name: "Expand closure panel", exact: true }).click();
  await page.getByRole("button", { name: "Choose destination on map", exact: true }).click();
  const canvas = page.locator(".maplibregl-canvas");
  const box = await canvas.boundingBox();
  await canvas.click({ position: { x: box!.width / 2, y: box!.height / 2 } });
  await page.getByRole("button", { name: "Find fastest clear walk", exact: true }).click();
  await expect(page.locator(".route-error")).toHaveText(
    "No verified walking route is available.",
  );
  await expect(page.locator(".route-result")).toHaveCount(0);
});

test("failed feed gives a retry flow rather than claiming clear streets", async ({
  page,
}) => {
  let failed = true;
  await page.route("**/api/closures?*", async (route) => {
    if (failed)
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "unavailable" }),
      });
    else await route.continue();
  });
  await page.goto("/");
  await expect(page.locator(".inline-alert.error")).toContainText(
    "Couldn’t load closures",
  );
  await expect(
    page.getByRole("heading", { name: "No matching closures" }),
  ).toHaveCount(0);
  failed = false;
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.locator(".closure-row").first()).toBeVisible({
    timeout: 45000,
  });
  await expect(page.locator(".inline-alert.error")).toHaveCount(0);
});

test('partial coverage remains visible and source details identify the outage', async ({ page }) => {
  await page.route('**/api/closures?*', async route => {
    const response = await route.fetch();
    const body: ClosureResponse = await response.json();
    body.features = body.features.filter(f => f.properties.source !== 'Event street closures');
    body.meta.complete = false;
    body.meta.sources[0] = { ...body.meta.sources[0], status: 'unavailable', total: 0, updatedAt: null, fetchedAt: null, message: 'This city feed could not be loaded. Retry shortly.' };
    await route.fulfill({ response, json: body });
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Closure data may be incomplete' })).toBeVisible();
  await page.getByRole('button', { name: 'Closure data may be incomplete' }).click();
  await expect(page.locator('.source-state.unavailable')).toHaveText('Unavailable');
  await expect(page.getByText('This city feed could not be loaded. Retry shortly.')).toBeVisible();
});

test('map controls work and out-of-coverage geolocation gives useful feedback', async ({ page, context },testInfo) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({latitude:41.8,longitude:-87.6});
  await page.goto('/');
  await expect(page.getByTestId('closure-map')).toHaveAttribute('data-ready','true',{timeout:45000});
  const scale=page.locator('.maplibregl-ctrl-scale');
  const initial=await scale.textContent();
  await page.getByRole('button',{name:'Zoom in',exact:true}).click();
  await expect(scale).not.toHaveText(initial!);
  await page.getByRole('button',{name:'Show my location'}).click();
  await expect(page.getByText('You’re outside NYC. This map currently covers the five boroughs.')).toBeVisible();
  await page.getByRole('button',{name:'Dismiss',exact:true}).click();
  await expect(page.locator('.map-notice')).toHaveCount(0);
  await page.getByRole('button',{name:'Reset map to Columbia demo location'}).click();
  await expect(scale).not.toHaveText(initial!);
  if(testInfo.project.name==='mobile') {
    await page.getByRole('button',{name:/^Show all/}).click();
    await page.setViewportSize({width:320,height:700});
    await expect(page.getByRole('button',{name:/^Construction/})).toBeInViewport();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  } else await page.getByRole('button',{name:/^Show all/}).click();
});
