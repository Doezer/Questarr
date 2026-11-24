import { expect, test } from "@playwright/test";
import { openSettingsSection } from "./helpers";

interface Status {
  available: boolean;
  enabled: boolean;
  username: string | null;
  lastSyncAt: string | null;
  lastGamesSynced: number;
  lastNewUnlocks: number;
  lastError: string | null;
}

test("saves a RetroAchievements account, turns the sync on and runs it", async ({
  page,
}, testInfo) => {
  // RetroAchievements is mocked at the browser boundary; the server tests cover the matching,
  // the encrypted key and the sync rules.
  let status: Status = {
    available: false,
    enabled: false,
    username: null,
    lastSyncAt: null,
    lastGamesSynced: 0,
    lastNewUnlocks: 0,
    lastError: null,
  };
  await page.route("**/api/retroachievements", async (route) => {
    if (route.request().method() === "PUT") {
      status = { ...status, enabled: route.request().postDataJSON().enabled };
    }
    await route.fulfill({ json: status });
  });
  await page.route("**/api/retroachievements/credentials", async (route) => {
    status = { ...status, available: true, username: route.request().postDataJSON().username };
    await route.fulfill({ json: status });
  });
  await page.route("**/api/retroachievements/sync", async (route) => {
    status = {
      ...status,
      lastSyncAt: new Date().toISOString(),
      lastGamesSynced: 4,
      lastNewUnlocks: 0,
    };
    await route.fulfill({ json: { result: { gamesSynced: 4, newUnlocks: 0 }, status } });
  });

  await page.goto("/settings?tab=integrations");
  await openSettingsSection(page, "Connections");
  const panel = page.getByRole("region", { name: "RetroAchievements" });
  await expect(panel.getByRole("switch", { name: "Sync RetroAchievements" })).toBeDisabled();
  await panel.screenshot({ path: testInfo.outputPath("retroachievements-empty.png") });

  await panel.getByLabel("RetroAchievements username").fill("Doezer");
  await panel.getByLabel("Web API key").fill("abcdefghijklmnop1234");
  await panel.getByRole("button", { name: "Save account" }).click();
  const toggle = panel.getByRole("switch", { name: "Sync RetroAchievements" });
  await expect(toggle).toBeEnabled();

  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect(panel.getByText(/Not synced yet/)).toBeVisible();

  await panel.getByRole("button", { name: "Sync now" }).click();
  await expect(panel.getByText(/4 games matched, no new unlocks/)).toBeVisible();
  await panel.screenshot({ path: testInfo.outputPath("retroachievements-on.png") });
});
