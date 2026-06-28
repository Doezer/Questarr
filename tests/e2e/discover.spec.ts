import { test, expect } from "@playwright/test";

test.describe("Discover journey", () => {
  // Inherits authenticated state from 'setup' project

  test("should open the Discover page and display the heading", async ({ page }) => {
    await page.goto("/discover");

    await expect(page.getByRole("heading", { name: /Discover/i })).toBeVisible();
  });
});
