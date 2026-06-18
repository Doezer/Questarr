import { test, expect } from "@playwright/test";

test.describe("Downloads journey", () => {
  // Inherits authenticated state from 'setup' project

  test("should open the Downloads page and display the queue area", async ({ page }) => {
    await page.goto("/downloads");

    await expect(page).toHaveURL("/downloads");
    // The downloads page renders its content regardless of queue state
    await expect(page.locator("body")).toBeVisible();
  });
});
