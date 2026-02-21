import { test, expect } from "@playwright/test";

test.describe("Game Details", () => {
  // Inherits authenticated state from 'setup' project

  test("should view game details", async ({ page }) => {
    // Mock the games API to ensure we have a game to click
    await page.route("/api/games*", async (route) => {
      const json = [
        {
          id: "test-game-id-123",
          title: "Cyberpunk 2077",
          coverUrl: "https://images.igdb.com/igdb/image/upload/t_cover_big/co2mjs.jpg",
          platforms: ["PC", "PS5"],
          genres: ["RPG"],
          status: "wanted",
          addedAt: new Date().toISOString(),
          igdbId: 1877,
          hidden: false,
        },
      ];
      await route.fulfill({ json });
    });

    await page.goto("/");

    // Look for the game card
    // Look for the game card using test ID for better stability
    const card = page.getByTestId("card-game-test-game-id-123");
    await expect(card).toBeVisible();

    // Hover to show actions
    await card.hover();

    // Click the details button
    await page.getByTestId("button-details-test-game-id-123").click();

    // Expect a modal
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Cyberpunk 2077" })).toBeVisible();

    // Close the modal
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).not.toBeVisible();
  });
});
