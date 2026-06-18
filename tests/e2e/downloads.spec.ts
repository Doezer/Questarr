import { test, expect } from "@playwright/test";

test.describe("Downloads journey", () => {
  // Inherits authenticated state from 'setup' project

  test("should open the Downloads page and display the Downloads heading", async ({ page }) => {
    await page.goto("/downloads");

    await expect(page).toHaveURL("/downloads");
    await expect(page.getByRole("heading", { name: /Downloads/i })).toBeVisible();
  });
});
