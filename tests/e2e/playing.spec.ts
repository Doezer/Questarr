import { test, expect } from "@playwright/test";
import { seedGame, uniqueId } from "./helpers";

test.describe("Playing journey", () => {
  // Inherits authenticated state from 'setup' project

  test("moves a game to Playing and keeps a journal note for it", async ({ page }) => {
    const id = uniqueId();
    const title = `Journal Quest ${id}`;
    await page.goto("/");
    const game = await seedGame(page, { title, igdbId: id });

    await page.goto("/");
    const card = page.getByTestId(`card-game-${game.id}`);
    await expect(card).toBeVisible();

    // Change the status from the card's own picker.
    await card.getByRole("button", { name: `Change status for ${title}` }).click();
    await page.getByRole("button", { name: "playing", exact: true }).click();
    await expect(card.getByText("Status: Playing")).toBeVisible();

    // The game now shows up on the Playing page.
    await page.goto("/playing");
    const playingCard = page.getByTestId(`card-game-${game.id}`);
    await expect(playingCard).toBeVisible();

    // Write a note in the game's journal.
    await playingCard.click();
    await expect(page).toHaveURL(new RegExp(`/games/${game.id}$`));
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await page.getByRole("textbox", { name: "New journal note" }).fill("Beat the first boss");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByText("Beat the first boss")).toBeVisible();

    // The note is stored server-side, and the game has its own address to reopen.
    await page.reload();
    await expect(page.getByText("Beat the first boss")).toBeVisible();
  });
});
