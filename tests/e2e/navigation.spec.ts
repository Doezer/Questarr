import { test, expect } from "@playwright/test";

test.describe("Navigation", () => {
  // Inherits authenticated state from 'setup' project

  test("should navigate to main pages", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Questarr|Dashboard/);

    // "Library" and "Discover" are collapsible groups in the sidebar; navigate via their children
    await page.getByTestId("nav-browse").click();
    await expect(page).toHaveURL("/discover");

    await page.getByTestId("nav-wishlist").click();
    await expect(page).toHaveURL("/wishlist");

    await page.getByTestId("nav-downloads").click();
    await expect(page).toHaveURL("/downloads");

    // The "All Games" child of the Library group is the "/" page.
    await page.getByTestId("nav-all-games").click();
    await expect(page).toHaveURL("/");

    // Discover is also a group (children: xREL.to Releases, RSS Feeds). The
    // group header only toggles; its children are the actual destinations.
    await page.getByTestId("nav-rss-feeds").click();
    await expect(page).toHaveURL("/rss");

    // Settings is a plain (non-group) item.
    await page.getByTestId("nav-settings").click();
    await expect(page).toHaveURL("/settings");
  });
});
