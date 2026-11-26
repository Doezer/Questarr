import { test, expect } from "@playwright/test";
import { openSettingsSection, patchUserSettings } from "./helpers";

test.describe("Automatic upgrades of owned games (1.7.0)", () => {
  test.afterEach(async ({ page }) => {
    await page.goto("/");
    await patchUserSettings(page, { upgradePolicy: "notify" });
  });

  test("the default policy is Notify, and Download automatically is shown once chosen", async ({
    page,
  }) => {
    await page.goto("/");
    await patchUserSettings(page, { autoSearchEnabled: true, upgradePolicy: "notify" });
    await page.goto("/settings");
    await openSettingsSection(page, "Search & Downloads");

    const policy = page.locator("#upgrade-policy-default");
    await expect(policy).toContainText("Notify me");
    await policy.click();
    await expect(page.getByRole("option")).toHaveText([
      "Notify me",
      "Download automatically",
      "Off",
    ]);
    await page.keyboard.press("Escape");

    await patchUserSettings(page, { upgradePolicy: "auto" });
    await page.reload();
    await expect(page.locator("#upgrade-policy-default")).toContainText("Download automatically");

    // The better-scored swap and the best-release rules live in Download Rules.
    await expect(page.getByText("Replace owned releases with better-scored ones")).toBeVisible();
    await expect(page.getByText("Auto-download the best-scored release")).toBeVisible();
  });
});
