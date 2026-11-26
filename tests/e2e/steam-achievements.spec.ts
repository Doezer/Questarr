import { expect, test } from "@playwright/test";
import { openSettingsSection, seedGame, uniqueId } from "./helpers";

interface Status {
  available: boolean;
  enabled: boolean;
  lastSyncAt: string | null;
  lastGamesSynced: number;
  lastNewUnlocks: number;
  lastError: string | null;
}

test("turns the Steam achievements sync on and shows progress on the card and Stats", async ({
  page,
}, testInfo) => {
  const game = await seedGame(page, { title: "Hades", igdbId: uniqueId(), status: "playing" });

  // Steam and the stored progress are mocked at the browser boundary; the server tests cover
  // the sync rules and the storage.
  let status: Status = {
    available: true,
    enabled: false,
    lastSyncAt: null,
    lastGamesSynced: 0,
    lastNewUnlocks: 0,
    lastError: null,
  };
  let synced = false;
  await page.route("**/api/steam/achievements", async (route) => {
    if (route.request().method() === "PUT") {
      status = { ...status, enabled: route.request().postDataJSON().enabled };
    }
    await route.fulfill({ json: status });
  });
  await page.route("**/api/steam/achievements/sync", async (route) => {
    synced = true;
    status = {
      ...status,
      lastSyncAt: new Date().toISOString(),
      lastGamesSynced: 1,
      lastNewUnlocks: 2,
    };
    await route.fulfill({ json: { result: { gamesSynced: 1, newUnlocks: 2 }, status } });
  });
  await page.route("**/api/achievements/progress", async (route) => {
    await route.fulfill({
      json: synced
        ? {
            progress: [
              {
                gameId: game.id,
                title: game.title,
                provider: "steam",
                unlocked: 31,
                total: 49,
                rarestName: "Escaped the Underworld",
                rarestPercent: 3.4,
                lastUnlockedAt: new Date().toISOString(),
              },
            ],
            summary: {
              games: 1,
              completedGames: 0,
              unlocked: 31,
              total: 49,
              completionRate: 63.3,
              rarest: {
                gameId: game.id,
                title: game.title,
                name: "Escaped the Underworld",
                percent: 3.4,
              },
            },
          }
        : {
            progress: [],
            summary: {
              games: 0,
              completedGames: 0,
              unlocked: 0,
              total: 0,
              completionRate: 0,
              rarest: null,
            },
          },
    });
  });

  await page.goto("/settings?tab=integrations");
  await openSettingsSection(page, "Connections");
  const panel = page.getByRole("region", { name: "Steam achievements" });
  const toggle = panel.getByRole("switch", { name: "Sync Steam achievements" });
  await expect(toggle).toBeEnabled();
  await expect(toggle).not.toBeChecked();
  await panel.screenshot({ path: testInfo.outputPath("steam-achievements-off.png") });

  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect(panel.getByText(/Not synced yet/)).toBeVisible();

  await panel.getByRole("button", { name: "Sync now" }).click();
  await expect(panel.getByText(/1 game checked, 2 new unlocks/)).toBeVisible();
  await panel.screenshot({ path: testInfo.outputPath("steam-achievements-on.png") });

  await page.goto("/stats");
  await expect(page.getByRole("heading", { name: "Achievements" })).toBeVisible();
  await expect(page.getByTestId("text-stats-value-achievement-rate")).toHaveText("63.3%");
  await page.getByRole("region", { name: "Achievements" }).screenshot({
    path: testInfo.outputPath("achievements-stats.png"),
  });

  await page.goto("/playing");
  await expect(page.getByTestId(`text-achievements-${game.id}`)).toHaveText("63%");
  await page.screenshot({ path: testInfo.outputPath("achievements-card.png") });
});
