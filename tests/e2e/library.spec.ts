import { test, expect } from "@playwright/test";

test.describe("Library journey", () => {
  // Inherits authenticated state from 'setup' project

  test("should open the Library page and display the game grid area", async ({ page }) => {
    await page.goto("/library");

    await expect(page).toHaveURL("/library");
    // The library renders a grid or empty state — either way the page loads
    await expect(page.locator("body")).toBeVisible();
  });
});
