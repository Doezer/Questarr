import { expect, test } from "@playwright/test";

test("previews owned games, preserves tracked entries and imports an explicit selection", async ({
  page,
}, testInfo) => {
  // Steam credentials are deliberately not needed by browser tests. Real router/storage
  // behavior is exercised separately by steam_library.test.ts for both database dialects.
  await page.route("**/api/steam/library", (route) =>
    route.fulfill({
      json: {
        games: [
          { steamAppId: 400, title: "Portal", alreadyTracked: false },
          { steamAppId: 620, title: "Portal 2", alreadyTracked: true },
          { steamAppId: 413150, title: "Stardew Valley", alreadyTracked: false },
        ],
      },
    })
  );
  let posted: unknown;
  await page.route("**/api/steam/library/import", async (route) => {
    posted = route.request().postDataJSON();
    await route.fulfill({
      json: { results: [{ steamAppId: 400, title: "Portal", outcome: "added" }] },
    });
  });
  await page.goto("/settings?tab=integrations");
  // Settings currently defaults to General; choose the tab for older routes too.
  await page.getByRole("tab", { name: "Integrations", exact: true }).click();
  await page.getByRole("button", { name: "Preview owned games" }).click();
  const tracked = page.getByRole("checkbox", { name: "Import Portal 2", exact: true });
  await expect(tracked).toBeDisabled();
  await page.getByRole("checkbox", { name: "Import Portal", exact: true }).check();
  await expect(page.getByText("3 games in Steam · 1 selected")).toBeVisible();
  await page.getByLabel("Filter owned Steam games").fill("Portal");
  await expect(page.getByRole("checkbox", { name: "Import Stardew Valley" })).toHaveCount(0);
  await page.getByRole("heading", { name: "Import owned Steam games" }).scrollIntoViewIfNeeded();
  const panel = page.getByRole("region", { name: "Import owned Steam games" });
  await panel.screenshot({ path: testInfo.outputPath("steam-owned-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("heading", { name: "Import owned Steam games" }).scrollIntoViewIfNeeded();
  await panel.screenshot({ path: testInfo.outputPath("steam-owned-mobile.png") });
  await page.evaluate(() => {
    document.documentElement.classList.remove("dark");
    document.documentElement.classList.add("light");
  });
  await panel.screenshot({ path: testInfo.outputPath("steam-owned-light.png") });
  await page.getByRole("button", { name: "Import selected (1)", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Portal: Added as Owned" })
  ).toBeVisible();
  expect(posted).toEqual({ appIds: [400] });
  await expect(page.getByRole("checkbox", { name: "Import Portal", exact: true })).toBeDisabled();
});

test("shows a failed preview and lets the user retry", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/steam/library", async (route) => {
    calls++;
    await route.fulfill(
      calls === 1
        ? { status: 502, json: { error: "Steam is unavailable" } }
        : { json: { games: [] } }
    );
  });
  await page.goto("/settings");
  await page.getByRole("tab", { name: "Integrations", exact: true }).click();
  await page.getByRole("button", { name: "Preview owned games" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Steam is unavailable" })).toBeVisible();
  await page.getByRole("button", { name: "Preview owned games" }).click();
  await expect(page.getByText("0 games in Steam · 0 selected")).toBeVisible();
});
