import { test, expect } from "@playwright/test";

test("loads and caches a compact event story on demand", async ({ page }) => {
  const now = Date.now();
  let summaryRequests = 0;
  await page.route("**/api/closures?*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            id: "event-story",
            geometry: {
              type: "LineString",
              coordinates: [
                [-73.997, 40.72],
                [-73.995, 40.722],
              ],
            },
            properties: {
              id: "event-story",
              title: "San Gennaro Festival",
              location: "Mulberry Street",
              borough: "Manhattan",
              kind: "event",
              category: "Street Festival",
              start: now - 60_000,
              end: now + 3_600_000,
              eventStart: now + 300_000,
              eventEnd: now + 2_400_000,
              permitStatus: "Scheduled",
              source: "Test",
              sourceUrl: "https://example.com/event",
              pedestrianImpact: "unknown",
              vehicleImpact: "blocked",
            },
          },
        ],
        meta: {
          fetchedAt: new Date(now).toISOString(),
          start: now,
          end: now + 604_800_000,
          days: 7,
          sources: [
            {
              id: "test",
              label: "Test",
              url: "https://example.com",
              status: "ok",
              updatedAt: new Date(now).toISOString(),
              fetchedAt: new Date(now).toISOString(),
              total: 1,
              unmapped: 0,
            },
          ],
          complete: true,
          coverage: "Test",
        },
      }),
    });
  });
  await page.route("**/api/events/summarize", async (route) => {
    summaryRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        tags: ["Food festival", "Road closure"],
        keywords: ["food", "festival"],
        about: ["A neighborhood festival likely centered on Italian culture."],
        roadImpact: "fully-closed",
        pedestrianImpact: "crowded",
        confidence: "medium",
        roadReason: "The permit lists a full street closure.",
        pedestrianReason: "Festival activity may crowd sidewalks.",
        provider: "gemini",
      }),
    });
  });

  await page.goto("/map");
  const expandPanel = page.getByRole("button", { name: "Expand closure panel" });
  if (await expandPanel.isVisible()) await expandPanel.click();
  await page.getByText("San Gennaro Festival", { exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Event brief" }),
  ).toBeVisible();
  await expect(page.getByText("Food festival", { exact: true })).toBeVisible();
  await expect(page.getByText("Likely fully closed")).toBeVisible();
  await page.getByLabel("Routing assumption").selectOption("sidewalk-crowded");
  await expect(page.getByText(/Session-only override active/)).toBeVisible();

  await page.getByRole("button", { name: "All closures" }).click();
  await page.getByText("San Gennaro Festival", { exact: true }).click();
  await expect(page.getByText("Food festival", { exact: true })).toBeVisible();
  expect(summaryRequests).toBe(1);
});
