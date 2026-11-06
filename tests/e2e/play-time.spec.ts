import { test, expect } from "@playwright/test";
import { seedGame, uniqueId } from "./helpers";

test.describe("Play time journey", () => {
  // Inherits authenticated state from 'setup' project

  test("times a session, adds one by hand, and shows the hours on Statistics", async ({ page }) => {
    const id = uniqueId();
    const title = `Timed Quest ${id}`;
    await page.goto("/");
    const game = await seedGame(page, {
      title,
      igdbId: id,
      status: "playing",
      timeToBeatNormally: 10,
    });

    // Start the timer from the game's card on the Playing page.
    await page.goto("/playing");
    const card = page.getByTestId(`card-game-${game.id}`);
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: `Start timer for ${title}` }).click();
    const stop = card.getByRole("button", { name: `Stop timer for ${title}` });
    await expect(stop).toContainText(/\d:\d\d:\d\d/);

    // The timer survives a reload, since it lives on the server.
    await page.reload();
    await expect(
      page
        .getByTestId(`card-game-${game.id}`)
        .getByRole("button", { name: `Stop timer for ${title}` })
    ).toBeVisible();

    // Stop it and open the game: the Playtime section lists the session.
    const stopped = page.waitForResponse(
      (res) => /\/api\/play-sessions\/[^/]+\/stop$/.test(res.url()) && res.ok()
    );
    await page
      .getByTestId(`card-game-${game.id}`)
      .getByRole("button", { name: `Stop timer for ${title}` })
      .click();
    await stopped;
    await page.goto(`/games/${game.id}`);
    const playtime = page.getByTestId("section-playtime");
    await expect(playtime.getByText("1 session")).toBeVisible();

    // Add an hour and a half by hand.
    await playtime.getByLabel("Hours").fill("1");
    await playtime.getByLabel("Minutes").fill("30");
    await playtime.getByRole("button", { name: "Add session" }).click();
    await expect(playtime.getByText("2 sessions")).toBeVisible();
    // The timed session lasted seconds, so the total is the hour and a half.
    await expect(playtime.getByTestId("text-playtime-total")).toHaveText("1h 30m");

    // Statistics now has a Play time section with this game in Most played.
    await page.goto("/stats");
    const stats = page.getByTestId("play-time-stats");
    await expect(stats.getByRole("heading", { name: "Play time" })).toBeVisible();
    await expect(stats.getByRole("link", { name: title })).toBeVisible();
    await expect(stats.getByRole("listitem").filter({ hasText: title })).toContainText(
      "1h 30m / ~10h"
    );
  });
});
