import { test, expect } from "@playwright/test";
import { seedGame, uniqueId } from "./helpers";

test.describe("Backlog roulette", () => {
  test("draws owned games, rerolls, opens details and saves Mark as Playing", async ({ page }) => {
    const id = uniqueId();
    const prefix = `Roulette ${id}`;
    await page.goto("/");
    const first = await seedGame(page, { title: `${prefix} Portal`, igdbId: id, status: "owned" });
    const second = await seedGame(page, {
      title: `${prefix} Hades`,
      igdbId: id + 1,
      status: "owned",
    });
    await seedGame(page, { title: `${prefix} Wanted`, igdbId: id + 2 });
    await page.reload();
    await page.getByPlaceholder("Search your library...").fill(prefix);
    await expect(page.getByTestId(`card-game-${first.id}`)).toBeVisible();
    const pick = page.getByRole("button", { name: "Pick a game", exact: true });
    await expect(pick).toBeEnabled();
    await pick.click();
    const dialog = page.getByRole("dialog", { name: "Backlog roulette" });
    await expect(dialog.getByText("Chosen from 2 matching games.")).toBeVisible();
    const title = dialog.getByTestId("roulette-title");
    const initial = await title.textContent();
    expect([first.title, second.title]).toContain(initial);
    await dialog.getByRole("button", { name: "Roll again" }).click();
    await expect(title).not.toHaveText(initial!);
    const chosen = await title.textContent();
    await page.screenshot({ path: "docs/pr-evidence/backlog-roulette-desktop.png" });
    await dialog.getByRole("button", { name: "View game" }).click();
    await expect(
      page.getByRole("dialog").getByRole("heading", { name: chosen!, exact: true })
    ).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await pick.click();
    const startedTitle = await dialog.getByTestId("roulette-title").textContent();
    const started = startedTitle === first.title ? first : second;
    const statusUrl = `**/api/games/${started.id}/status`;
    await page.route(statusUrl, (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Test failure" }),
      })
    );
    await dialog.getByRole("button", { name: "Mark as Playing" }).click();
    await expect(page.getByText("Failed to update game status")).toBeVisible();
    await expect(dialog.getByTestId("roulette-title")).toHaveText(startedTitle!);
    await page.unroute(statusUrl);
    const saved = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/games/${started.id}/status`) &&
        response.request().method() === "PATCH"
    );
    await dialog.getByRole("button", { name: "Mark as Playing" }).click();
    expect((await saved).ok()).toBe(true);
    await expect(dialog).not.toBeVisible();
    await page.goto("/playing");
    await expect(page.getByTestId(`card-game-${started.id}`)).toBeVisible();
    await page.reload();
    await expect(page.getByTestId(`card-game-${started.id}`)).toBeVisible();
  });

  test("handles an empty owned pool, filters, mobile layout and light theme", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const id = uniqueId();
    const title = `Roulette mobile ${id}`;
    await page.goto("/");
    const game = await seedGame(page, { title, igdbId: id });
    await page.reload();
    await page.getByPlaceholder("Search your library...").fill(title);
    await expect(page.getByTestId(`card-game-${game.id}`)).toBeVisible();
    const pick = page.getByRole("button", { name: "Pick a game", exact: true });
    await expect(pick).toBeEnabled();
    await pick.click();
    const dialog = page.getByRole("dialog", { name: "Backlog roulette" });
    await expect(dialog.getByText("No games in this draw")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Roll again" })).toBeDisabled();
    await dialog.getByRole("combobox", { name: "Pick from" }).click();
    await page.getByRole("option", { name: "All visible games" }).click();
    await expect(dialog.getByTestId("roulette-title")).toHaveText(title);
    await expect(dialog.getByText("Chosen from 1 matching game.")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Roll again" })).toBeDisabled();
    await expect(dialog.getByRole("button", { name: "Mark as Playing" })).toHaveCount(0);
    const bounds = await dialog.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
    await page.screenshot({ path: "docs/pr-evidence/backlog-roulette-mobile.png" });
    await page.keyboard.press("Escape");
    await page.evaluate(() => localStorage.setItem("theme", "light"));
    await page.reload();
    await page.getByPlaceholder("Search your library...").fill(title);
    await expect(pick).toBeEnabled();
    await pick.click();
    await dialog.getByRole("combobox", { name: "Pick from" }).click();
    await page.getByRole("option", { name: "All visible games" }).click();
    await expect(dialog.getByTestId("roulette-title")).toHaveText(title);
    await expect(page.locator("html")).toHaveClass(/light/);
    await page.screenshot({ path: "docs/pr-evidence/backlog-roulette-light.png" });
  });
});
