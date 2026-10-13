import { test, expect } from "@playwright/test";

test.describe("Settings organization", () => {
  test("saves platform preferences from Appearance", async ({ page }) => {
    const response = await page.request.get("/api/settings");
    expect(response.ok()).toBe(true);
    const settings = { ...(await response.json()), importPlatformIds: [6] };
    let saves = 0;
    await page.route("/api/settings", async (route) => {
      if (route.request().method() === "PATCH") {
        expect(route.request().postDataJSON()).toEqual({ importPlatformIds: [6, 41] });
        settings.importPlatformIds = [6, 41];
        saves++;
      }
      await route.fulfill({ json: settings });
    });
    await page.route("/api/igdb/platforms", (route) =>
      route.fulfill({
        json: [
          { id: 6, name: "PC" },
          { id: 41, name: "Wii U" },
        ],
      })
    );
    await page.goto("/settings");
    await expect(page.getByRole("tab", { name: "Platforms", exact: true })).toHaveCount(0);
    await page.getByRole("tab", { name: "Appearance", exact: true }).click();
    const platforms = page.getByText("Platforms", { exact: true }).locator("../../..");
    await expect(platforms.getByRole("checkbox", { name: "PC", exact: true })).toBeChecked();
    await platforms.getByRole("checkbox", { name: "Wii U", exact: true }).click();
    await platforms.getByRole("button", { name: "Save Changes", exact: true }).click();
    await expect.poll(() => saves).toBe(1);
    await page.reload();
    await page.getByRole("tab", { name: "Appearance", exact: true }).click();
    await expect(page.getByRole("checkbox", { name: "Wii U", exact: true })).toBeChecked();
  });

  test("retries release loading and removes a release without saving term edits", async ({
    page,
  }, testInfo) => {
    const response = await page.request.get("/api/settings");
    expect(response.ok()).toBe(true);
    let terms = "[]";
    let termSaves = 0;
    await page.route("/api/settings", async (route) => {
      if (route.request().method() === "PATCH") {
        terms = route.request().postDataJSON().releaseNameBlacklist;
        termSaves++;
      }
      await route.fulfill({ json: { ...(await response.json()), releaseNameBlacklist: terms } });
    });
    let reads = 0;
    let removed = false;
    await page.route("/api/blacklist", (route) => {
      reads++;
      return route.fulfill(
        reads === 1
          ? { status: 500, json: { error: "Fixture failure" } }
          : {
              json: removed
                ? []
                : [
                    {
                      id: "release-1",
                      gameId: "game-1",
                      gameTitle: "Space Quest",
                      releaseTitle: "Space.Quest-GROUP",
                      indexerName: "Test indexer",
                      createdAt: null,
                    },
                  ],
            }
      );
    });
    await page.route("/api/games/game-1/blacklist/release-1", async (route) => {
      expect(route.request().method()).toBe("DELETE");
      removed = true;
      await route.fulfill({ status: 204 });
    });
    await page.goto("/settings");
    await page.getByRole("tab", { name: "Discovery & Downloads", exact: true }).click();
    await expect(page.getByText("Release Blacklist", { exact: true })).toBeVisible();
    await expect(page.getByText("Could not load blacklisted releases.")).toBeVisible();
    await expect(page.getByText("No blacklisted releases.")).toHaveCount(0);
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(page.getByText("Space.Quest-GROUP", { exact: true })).toBeVisible();
    await page.getByPlaceholder("e.g. HYPERVISOR, CAM, SAMPLE...").fill("unwanted");
    await page.getByPlaceholder("e.g. HYPERVISOR, CAM, SAMPLE...").press("Enter");
    await page.getByText("Release Blacklist", { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath("settings-release-blacklist.png") });
    await page.getByRole("button", { name: "Remove Space.Quest-GROUP from blacklist" }).click();
    await expect(page.getByText("No blacklisted releases.")).toBeVisible();
    expect(termSaves).toBe(0);
    await expect(page.getByText("unwanted", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Save Blacklist", exact: true }).click();
    await expect.poll(() => termSaves).toBe(1);
    expect(JSON.parse(terms)).toEqual(["unwanted"]);
  });

  test("keeps all Import sub-tabs on screen at phone width", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/settings");
    await page.getByRole("tab", { name: "Import", exact: true }).click();
    for (const name of ["General Config", "Path Mappings", "Security & Scanning", "Help"]) {
      const tab = page.getByRole("tab", { name, exact: true });
      await expect(tab).toBeVisible();
      const bounds = await tab.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
      await tab.click();
      await expect(tab).toHaveAttribute("aria-selected", "true");
    }
    await page.getByRole("tab", { name: "General Config", exact: true }).click();
    await page.screenshot({ path: testInfo.outputPath("settings-mobile-import.png") });
  });
});
