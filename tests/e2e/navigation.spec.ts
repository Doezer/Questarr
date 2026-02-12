import { test, expect } from "@playwright/test";

test.describe("Navigation", () => {
  // Inherits authenticated state from 'setup' project

  test("should navigate to main pages", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Questarr|Dashboard/);

    await page.getByRole("button", { name: /Discover/i }).click();
    await expect(page).toHaveURL("/discover");

    await page.getByRole("button", { name: /Library/i }).click();
    await expect(page).toHaveURL("/library");

    await page.getByRole("button", { name: /Settings/i }).click();
    await expect(page).toHaveURL("/settings");
  });
});
