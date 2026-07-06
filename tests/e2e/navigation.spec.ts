import { test, expect } from "@playwright/test";

test.describe("Navigation", () => {
  // Inherits authenticated state from 'setup' project

  test("should navigate to main pages", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Questarr|Dashboard/);

    await page.getByTestId("nav-discover").click();
    await expect(page).toHaveURL("/discover");

    await page.getByTestId("nav-library").click();
    await expect(page).toHaveURL("/");

    await page.getByTestId("nav-settings").click();
    await expect(page).toHaveURL("/settings");
  });
});
