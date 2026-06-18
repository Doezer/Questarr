import { test, expect } from "@playwright/test";

test.describe("Library journey", () => {
  // Inherits authenticated state from 'setup' project
  // Library is registered at "/" in the app router

  test("should open the Library page and display the My Library heading", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { name: /My Library/i })).toBeVisible();
  });
});
