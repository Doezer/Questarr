import { test, expect } from "@playwright/test";
import { apiSend, openSettingsSection } from "./helpers";

test.describe("Import settings for upgrades and add-ons (1.7.0)", () => {
  // Both options start from their defaults, and a failed run never leaves them changed.
  const resetDefaults = async (page: import("@playwright/test").Page) => {
    await page.goto("/");
    const reset = await apiSend(page, "PATCH", "/api/imports/config", {
      addonSubfolders: false,
      upgradeReplaceMode: "off",
    });
    expect(reset.ok()).toBe(true);
  };
  test.beforeEach(async ({ page }) => resetDefaults(page));
  test.afterEach(async ({ page }) => resetDefaults(page));

  test("saves the add-on subfolder switch and the previous-version choice, and keeps them after a reload", async ({
    page,
  }) => {
    await page.goto("/settings");
    await openSettingsSection(page, "Import");
    await page.getByRole("tab", { name: "General Config", exact: true }).click();

    // The options below the master switch are inert until post-processing is on.
    const master = page.getByRole("switch", { name: "Enable Post-Processing" });
    await expect(master).toBeVisible();
    const wasEnabled = await master.isChecked();
    if (!wasEnabled) await master.click();

    const subfolders = page.getByRole("switch", { name: "Updates and DLC in subfolders" });
    const replaceMode = page.locator("#upgradeReplaceMode");
    await expect(subfolders).toBeVisible();
    // Both are off by default, so imports behave as before.
    await expect(subfolders).not.toBeChecked();
    await expect(replaceMode).toContainText("Keep it");

    await subfolders.click();
    await replaceMode.click();
    await page.getByRole("option", { name: "Move it to .questarr-replaced" }).click();
    await page.getByRole("button", { name: "Save Changes" }).click();
    await expect(page.getByText("Settings Saved", { exact: false }).first()).toBeVisible();

    await page.reload();
    await page.getByRole("tab", { name: "General Config", exact: true }).click();
    await expect(page.getByRole("switch", { name: "Updates and DLC in subfolders" })).toBeChecked();
    await expect(page.locator("#upgradeReplaceMode")).toContainText(".questarr-replaced");

    // Put them back so later runs start from the defaults.
    await page.getByRole("switch", { name: "Updates and DLC in subfolders" }).click();
    await page.locator("#upgradeReplaceMode").click();
    await page.getByRole("option", { name: "Keep it" }).click();
    if (!wasEnabled) await page.getByRole("switch", { name: "Enable Post-Processing" }).click();
    await page.getByRole("button", { name: "Save Changes" }).click();
    await expect(page.getByText("Settings Saved", { exact: false }).first()).toBeVisible();
  });
});
