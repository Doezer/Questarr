import { test, expect } from "@playwright/test";

test.describe("Search journey", () => {
  // Inherits authenticated state from 'setup' project

  test("should open the Search page and display the search input", async ({ page }) => {
    await page.goto("/search");

    await expect(page.getByRole("heading", { name: /Search/i })).toBeVisible();
    await expect(page.getByPlaceholder("Enter game title...")).toBeVisible();
  });
});
