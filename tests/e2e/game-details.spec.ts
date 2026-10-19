import { test, expect } from "@playwright/test";

test.describe("Game Details", () => {
  // Inherits authenticated state from 'setup' project

  test("should view game details", async ({ page }) => {
    // Mock the games API to ensure we have a game to click
    const game = {
      id: "test-game-id-123",
      title: "Cyberpunk 2077",
      coverUrl: "https://images.igdb.com/igdb/image/upload/t_cover_big/co2mjs.jpg",
      platforms: ["PC", "PS5"],
      genres: ["RPG"],
      status: "wanted",
      addedAt: new Date().toISOString(),
      igdbId: 1877,
      hidden: false,
    };
    await page.route("**/api/games?*", (route) => route.fulfill({ json: [game] }));
    await page.route("**/api/games", (route) => route.fulfill({ json: [game] }));
    // The details page loads its game by id, so it can be opened straight from a URL.
    await page.route("**/api/games/test-game-id-123", (route) => route.fulfill({ json: game }));

    await page.goto("/");

    // Look for the game card
    // Look for the game card using test ID for better stability
    const card = page.getByTestId("card-game-test-game-id-123");
    await expect(card).toBeVisible();

    // The whole card opens the game's own page
    await card.click();
    await expect(page).toHaveURL(/\/games\/test-game-id-123$/);
    await expect(page.getByRole("heading", { level: 1, name: "Cyberpunk 2077" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Game sections" })).toBeVisible();

    // Back returns to the library
    await page.getByTestId("button-back").click();
    await expect(page).not.toHaveURL(/\/games\//);
  });

  test("opens a game directly from its URL, as in a new tab", async ({ page }) => {
    await page.route("**/api/games/test-game-id-123", (route) =>
      route.fulfill({
        json: {
          id: "test-game-id-123",
          title: "Cyberpunk 2077",
          platforms: ["PC"],
          genres: ["RPG"],
          status: "wanted",
          addedAt: new Date().toISOString(),
          hidden: false,
        },
      })
    );
    await page.goto("/games/test-game-id-123");
    await expect(page.getByRole("heading", { level: 1, name: "Cyberpunk 2077" })).toBeVisible();
    await expect(page).toHaveTitle(/Cyberpunk 2077/);
  });
});
