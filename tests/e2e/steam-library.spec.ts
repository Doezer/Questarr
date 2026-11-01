import { expect, test } from "@playwright/test";
import type { SteamLibraryJobView } from "../../shared/steam-library";

test("imports 1,000 games with one action and restores background progress after navigation", async ({
  page,
}, testInfo) => {
  // Steam is mocked at the browser boundary. Server tests import 1,000 games against
  // real SQLite/PGlite storage and exercise checkpoints, ownership and retries.
  const games = Array.from({ length: 1000 }, (_, i) => ({
    steamAppId: i + 1,
    title: `Steam game ${String(i + 1).padStart(4, "0")}`,
    alreadyTracked: false,
  }));
  let job: SteamLibraryJobView | null = null;
  const posts: Array<{ appIds: number[] }> = [];
  await page.route("**/api/steam/library", (route) => route.fulfill({ json: { games } }));
  await page.route("**/api/steam/library/import/jobs/current", (route) =>
    route.fulfill({ json: { job } })
  );
  await page.route("**/api/steam/library/import/jobs", async (route) => {
    posts.push(route.request().postDataJSON() as { appIds: number[] });
    job = {
      id: "bulk-job",
      state: "running",
      total: 1000,
      processed: 50,
      added: 50,
      duplicates: 0,
      skipped: 0,
      failed: 0,
      canRetry: false,
      completedAppIds: games.slice(0, 50).map((game) => game.steamAppId),
      recentResults: [],
    };
    await route.fulfill({ status: 202, json: { job } });
  });
  await page.goto("/settings?tab=integrations");
  await page.getByRole("tab", { name: "Integrations", exact: true }).click();
  await page.getByRole("button", { name: "Preview owned games" }).click();
  const panel = page.getByRole("region", { name: "Import owned Steam games" });
  await expect(panel.getByText("1,000 games in Steam · 1,000 selected")).toBeVisible();
  await expect(panel.getByRole("checkbox")).toHaveCount(50);
  await panel.getByRole("button", { name: "Next", exact: true }).click();
  await expect(panel.getByText("Page 2 of 20")).toBeVisible();
  await expect(
    panel.getByRole("checkbox", { name: "Import Steam game 0051", exact: true })
  ).toBeChecked();
  await panel.getByRole("button", { name: "Previous", exact: true }).click();
  await panel.screenshot({ path: testInfo.outputPath("steam-owned-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await panel.screenshot({ path: testInfo.outputPath("steam-owned-mobile.png") });
  await page.evaluate(() => {
    document.documentElement.classList.remove("dark");
    document.documentElement.classList.add("light");
  });
  await panel.screenshot({ path: testInfo.outputPath("steam-owned-light.png") });
  await panel.getByRole("button", { name: "Import selected (1,000)", exact: true }).click();
  await expect(panel.getByText("Processed 50 of 1,000 games")).toBeVisible();
  expect(posts).toHaveLength(1);
  expect(posts[0]?.appIds).toHaveLength(1000);
  await page.reload();
  await expect(page.getByText("Processed 50 of 1,000 games")).toBeVisible();
  await expect(page.getByRole("button", { name: "Preview owned games" })).toBeDisabled();
  await page
    .getByRole("status", { name: "Steam import status" })
    .screenshot({ path: testInfo.outputPath("steam-bulk-progress.png") });
  job = {
    ...job!,
    state: "completed",
    processed: 1000,
    added: 1000,
    completedAppIds: games.map((game) => game.steamAppId),
  };
  await expect(page.getByText("Import complete", { exact: true })).toBeVisible({ timeout: 10_000 });
  expect(posts).toHaveLength(1);
});

test("shows a failed preview and lets the user retry", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/steam/library/import/jobs/current", (route) =>
    route.fulfill({ json: { job: null } })
  );
  await page.route("**/api/steam/library", async (route) => {
    calls++;
    await route.fulfill(
      calls === 1
        ? { status: 502, json: { error: "Steam is unavailable" } }
        : { json: { games: [] } }
    );
  });
  await page.goto("/settings?tab=integrations");
  await page.getByRole("tab", { name: "Integrations", exact: true }).click();
  await page.getByRole("button", { name: "Preview owned games" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Steam is unavailable" })).toBeVisible();
  await page.getByRole("button", { name: "Preview owned games" }).click();
  await expect(page.getByText("0 games in Steam · 0 selected")).toBeVisible();
});
