import { expect, test, type Page } from "@playwright/test";

function forecastFor(date: string) {
  return {
    status: "ok",
    from: date,
    to: date,
    predictions: [
      {
        id: `forecast-columbia-block-party-${date}`,
        title: "Columbia Block Party",
        borough: "Manhattan",
        date,
        start: `${date}T12:00:00-04:00`,
        end: `${date}T19:00:00-04:00`,
        pattern: "Last Saturday of September",
        confidence: "high",
        yearsObserved: [2023, 2024, 2025],
        yearsExpected: 3,
        closureType: "Full Street Closure",
        pedestrianImpact: "unknown",
        vehicleImpact: "blocked",
        locations: ["BROADWAY between 114 STREET and 116 STREET"],
        geometry: {
          type: "LineString",
          coordinates: [
            [-73.9626, 40.8075],
            [-73.962, 40.81],
          ],
        },
      },
    ],
    meta: {
      kind: "prediction",
      disclaimer:
        "Predicted from past NYC permits, not a confirmed closure.",
      generatedAt: new Date().toISOString(),
      source: "https://data.cityofnewyork.us/resource/bkfu-528j.json",
      historyFrom: "2023-01-01",
      historyTo: "2025-12-31",
    },
  };
}

async function mockClosures(page: Page) {
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
}

async function showPredictions(page: Page) {
  const expandPanel = page.getByRole("button", {
    name: "Expand closure panel",
    exact: true,
  });
  if (await expandPanel.isVisible()) await expandPanel.click();
  await page
    .locator('.filter-chips button')
    .filter({ hasText: "Predicted" })
    .click();
  if ((page.viewportSize()?.width ?? 1440) <= 760) {
    await expect(page.getByTestId("closure-map")).toHaveAttribute(
      "data-ready",
      "true",
      { timeout: 45_000 },
    );
    await expect(page.locator(".map-legend")).toBeHidden();
    const panel = await page.locator(".closure-panel").boundingBox();
    const attribution = await page
      .locator(".maplibregl-ctrl-attrib")
      .boundingBox();
    expect(panel).not.toBeNull();
    expect(attribution).not.toBeNull();
    expect(attribution!.y + attribution!.height).toBeLessThanOrEqual(panel!.y);
  }
}

test("shows prediction evidence, selected streets, and honest no-match state", async ({
  page,
}) => {
  await mockClosures(page);
  await page.route("**/api/forecast?*", async (route) => {
    const date = new URL(route.request().url()).searchParams.get("date")!;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(forecastFor(date)),
    });
  });

  await page.goto("/map");
  await showPredictions(page);

  const predictionFilter = page
    .locator(".filter-chips button")
    .filter({ hasText: "Predicted" });
  await expect(predictionFilter).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("closure-timeline")).toBeHidden();
  await expect(page.getByText("Predictions, not permits", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Columbia Block Party/ }),
  ).toBeVisible();

  await page.getByLabel("Find a street or event").fill("not-a-real-prediction");
  await expect(
    page.getByRole("heading", { name: "No predicted closures for this day" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clear search" }).click();

  if ((page.viewportSize()?.width ?? 1440) <= 760) {
    await page.setViewportSize({ width: 320, height: 700 });
  }
  await page.getByRole("button", { name: /Columbia Block Party/ }).click();
  const detailHeading = page.getByRole("heading", {
    name: "Columbia Block Party",
    exact: true,
  });
  await expect(detailHeading).toBeVisible();
  if ((page.viewportSize()?.width ?? 1440) <= 760) {
    await expect(detailHeading).toBeInViewport();
    await expect(page.locator(".navbar")).toBeInViewport();
  }
  await expect(page.getByText("Not a confirmed closure", { exact: true })).toBeVisible();
  await expect(page.getByText("Seen 3 of 3 years", { exact: false })).toBeVisible();
  await expect(page.getByText("Streets from the most recent year", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "View permit history" }),
  ).toHaveAttribute("href", "https://data.cityofnewyork.us/d/bkfu-528j");
});

test("recovers from an unavailable forecast with a retry action", async ({ page }) => {
  await mockClosures(page);
  let attempts = 0;
  await page.route("**/api/forecast?*", async (route) => {
    attempts += 1;
    const date = new URL(route.request().url()).searchParams.get("date")!;
    if (attempts === 1) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Forecast service temporarily unavailable." }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(forecastFor(date)),
    });
  });

  await page.goto("/map");
  await showPredictions(page);
  await expect(page.locator(".closure-panel .inline-alert[role='alert']")).toContainText(
    "Forecast service temporarily unavailable.",
  );
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /Columbia Block Party/ }),
  ).toBeVisible();
  expect(attempts).toBe(2);
});
