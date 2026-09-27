import { expect, test } from "@playwright/test";

test("presents the Wrap landing page and its primary conversion path", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "When New York changes, Wrap." }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Start planning" })).toHaveAttribute(
    "href",
    "/auth?mode=signup",
  );
  const storyHeading = page.getByRole("heading", { name: "One trip. Three plot twists." });
  await storyHeading.scrollIntoViewIfNeeded();
  await expect(storyHeading).toBeVisible();
  await expect(page.locator(".landing-route-selected")).toBeVisible();
  await page.getByRole("link", { name: "Start planning" }).click();
  await expect(page).toHaveURL(/\/auth\?mode=signup/);
  await expect(page.getByRole("tab", { name: "Create account" })).toHaveAttribute("aria-selected", "true");
});

test("offers sign-in and sign-up modes on the auth page", async ({ page }) => {
  await page.goto("/auth?mode=signup");

  await expect(page.getByRole("link", { name: "Back home" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Create account" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("tab", { name: "Sign in" })).toHaveAttribute(
    "aria-selected",
    "false",
  );
});


test("keeps landing navigation and the example preview usable on narrow screens", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  const actions = page.locator(".landing-nav-actions");
  await expect(actions).toBeVisible();
  const bounds = await actions.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
  await expect(page.getByText("Example route", { exact: true })).toBeVisible();
  await expect(page.locator(".landing-live-card")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await page.locator(".landing-nav").getByRole("link", { name: "Get started" }).click();
  await expect(page).toHaveURL(/\/auth\?mode=signup/);
  expect(errors).toEqual([]);
});

test("scrolls the route story through a closure, a delay, and a new next step", async ({ page }) => {
  await page.goto("/");
  const stage = page.locator(".landing-story-stage");
  for (const step of [1, 2, 3]) {
    const chapter = page.locator(`[data-story-chapter="${step - 1}"]`);
    if ((page.viewportSize()?.width ?? 1440) <= 700) {
      const top = await chapter.evaluate(
        (element) => element.getBoundingClientRect().top + window.scrollY - window.innerHeight * 0.47,
      );
      await page.evaluate((target) => window.scrollTo(0, target), top);
      await page.waitForTimeout(900);
      await page.evaluate(() => window.scrollBy(0, 100));
    } else {
      await chapter.scrollIntoViewIfNeeded();
    }
    await expect(stage).toHaveAttribute("data-step", String(step));
    await expect(page.locator(`[data-scene="${step - 1}"]`)).toBeVisible();
    const selectedRoute = page.locator(
      [".landing-story-route-direct", ".landing-story-route-walk", ".landing-story-route-bus"][step - 1],
    );
    await expect
      .poll(() => selectedRoute.evaluate((element) => Number(getComputedStyle(element).opacity)))
      .toBeGreaterThan(0.9);
    if ((page.viewportSize()?.width ?? 1440) <= 700) {
      const stageBounds = await stage.boundingBox();
      const chapterBounds = await page
        .locator(`[data-story-chapter="${step - 1}"] .landing-story-chapter-copy`)
        .boundingBox();
      expect(chapterBounds!.y).toBeGreaterThanOrEqual(stageBounds!.y + stageBounds!.height);
    }
  }
});
