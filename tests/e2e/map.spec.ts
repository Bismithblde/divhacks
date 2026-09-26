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
    r.url().includes("/api/closures?days=1"),
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
    String(body.features.length),
  );
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
  const events = body.features.filter((f) => f.properties.kind === "event");
  await page.getByRole("button", { name: /^Events/ }).click();
  await expect(map).toHaveAttribute(
    "data-feature-count",
    String(events.length),
  );
  await page.getByRole("button", { name: /^Construction/ }).click();
  await expect(map).toHaveAttribute(
    "data-feature-count",
    String(body.features.length - events.length),
  );
  await page.getByRole("button", { name: /^All [\d,]+/ }).click();
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
    String(body.features.length),
  );
  const longer = page.waitForResponse((r) =>
    r.url().includes("/api/closures?days=7"),
  );
  await page.getByLabel("Closure time window").selectOption("7");
  const seven: ClosureResponse = await (await longer).json();
  await expect(map).toHaveAttribute(
    "data-feature-count",
    String(seven.features.length),
  );
  expect(seven.features.length).toBeGreaterThanOrEqual(body.features.length);
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
  await page.getByRole('button',{name:'Reset map to Manhattan'}).click();
  await expect(scale).toHaveText(initial!);
  if(testInfo.project.name==='mobile') {
    await page.getByRole('button',{name:'Show all',exact:true}).click();
    await page.setViewportSize({width:320,height:700});
    await expect(page.getByRole('button',{name:/^Construction/})).toBeInViewport();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  } else await page.getByRole('button',{name:'Show all closures',exact:true}).click();
});
