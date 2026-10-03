import { test, expect } from "@playwright/test";
import { patchUserSettings, uniqueId } from "./helpers";

test.describe("Release name blacklist journey", () => {
  test.describe.configure({ mode: "serial" });

  test("saves case-insensitive terms and lets the user remove them again", async ({ page }) => {
    const term = `E2E-BLACKLIST-${uniqueId()}`;
    const initialResponse = await page.request.get("/api/settings");
    expect(initialResponse.ok()).toBe(true);
    const initialBlacklist =
      ((await initialResponse.json()).releaseNameBlacklist as string | null) ?? "[]";
    const initialTerms = JSON.parse(initialBlacklist) as string[];

    try {
      await page.goto("/settings");
      await page.getByRole("tab", { name: "Discovery & Downloads" }).click();

      const blacklistInput = page.getByLabel("Blacklisted Terms");
      await blacklistInput.fill(term.toLowerCase());
      await blacklistInput.press("Enter");
      await expect(page.getByText(term.toLowerCase(), { exact: true })).toBeVisible();

      await page.getByRole("button", { name: "Save Blacklist" }).click();
      await expect(page.getByText("Release Name Blacklist Saved", { exact: true })).toBeVisible();

      // Assert the server persisted the term alongside any pre-existing entries.
      const savedSettings = await page.request.get("/api/settings");
      expect(savedSettings.ok()).toBe(true);
      expect((await savedSettings.json()).releaseNameBlacklist).toBe(
        JSON.stringify([...initialTerms, term.toLowerCase()])
      );

      await page.getByRole("button", { name: `Remove ${term.toLowerCase()}` }).click();
      await expect(page.getByText(term.toLowerCase(), { exact: true })).toHaveCount(0);
      await page.getByRole("button", { name: "Save Blacklist" }).click();
      await expect(page.getByText("Release Name Blacklist Saved", { exact: true })).toBeVisible();

      const restoredSettings = await page.request.get("/api/settings");
      expect(restoredSettings.ok()).toBe(true);
      expect((await restoredSettings.json()).releaseNameBlacklist).toBe(
        JSON.stringify(initialTerms)
      );
    } finally {
      await patchUserSettings(page, { releaseNameBlacklist: initialBlacklist });
    }
  });
});
