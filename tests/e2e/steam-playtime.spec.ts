import { expect, test } from "@playwright/test";

interface Status {
  available: boolean;
  enabled: boolean;
  lastSyncAt: string | null;
  lastSessionsAdded: number;
  lastMinutesAdded: number;
  lastError: string | null;
}

test("turns the Steam play-time sync on and runs it from the settings", async ({
  page,
}, testInfo) => {
  // Steam is mocked at the browser boundary; the server tests cover the sync rules.
  let status: Status = {
    available: true,
    enabled: false,
    lastSyncAt: null,
    lastSessionsAdded: 0,
    lastMinutesAdded: 0,
    lastError: null,
  };
  await page.route("**/api/steam/playtime", async (route) => {
    if (route.request().method() === "PUT") {
      status = { ...status, enabled: route.request().postDataJSON().enabled };
    }
    await route.fulfill({ json: status });
  });
  await page.route("**/api/steam/playtime/sync", async (route) => {
    status = {
      ...status,
      lastSyncAt: new Date().toISOString(),
      lastSessionsAdded: 2,
      lastMinutesAdded: 135,
    };
    await route.fulfill({
      json: { result: { sessionsAdded: 2, minutesAdded: 135, baselined: 0 }, status },
    });
  });

  await page.goto("/settings?tab=integrations");
  await page.getByRole("tab", { name: "Integrations", exact: true }).click();
  const panel = page.getByRole("region", { name: "Steam play time" });
  const toggle = panel.getByRole("switch", { name: "Sync Steam play time" });
  await expect(toggle).toBeEnabled();
  await expect(toggle).not.toBeChecked();
  await panel.screenshot({ path: testInfo.outputPath("steam-playtime-off.png") });

  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect(panel.getByText(/Not synced yet/)).toBeVisible();

  await panel.getByRole("button", { name: "Sync now" }).click();
  await expect(panel.getByText(/2 sessions, 2h 15m/)).toBeVisible();
  await expect(panel.getByText("Added 2 estimated sessions.")).toBeVisible();
  await panel.screenshot({ path: testInfo.outputPath("steam-playtime-on.png") });

  await page.setViewportSize({ width: 390, height: 844 });
  await panel.screenshot({ path: testInfo.outputPath("steam-playtime-mobile.png") });
});
