import { expect, test } from "@playwright/test";
import { seedGame, uniqueId } from "./helpers";

test("creates a tag, puts it on a game and filters the library by it", async ({
  page,
}, testInfo) => {
  const suffix = String(uniqueId());
  const tagName = `Co-op ${suffix}`;
  const tagged = await seedGame(page, { title: `Tagged game ${suffix}`, igdbId: uniqueId() });
  const other = await seedGame(page, { title: `Other game ${suffix}`, igdbId: uniqueId() });

  // 1. Create the tag in Settings.
  await page.goto("/settings?tab=appearance");
  await page.getByRole("tab", { name: "Appearance", exact: true }).click();
  const card = page.locator("#tags-config");
  await card.getByLabel("New tag").fill(tagName);
  await card.getByRole("button", { name: "Add tag" }).click();
  await expect(card.getByRole("list", { name: "Your tags" })).toContainText(tagName);
  await card.screenshot({ path: testInfo.outputPath("tags-settings.png") });

  // 2. Put it on one game from the game's page.
  await page.goto(`/games/${tagged.id}`);
  const field = page.getByTestId("section-game-tags");
  await expect(field).toBeVisible();
  await field.getByRole("button", { name: tagName }).click();
  await expect(field.getByTestId(/^game-tag-/)).toContainText(tagName);
  await field.screenshot({ path: testInfo.outputPath("tags-game.png") });

  // 3. Filter the library by the tag.
  await page.goto("/");
  await page.getByRole("button", { name: "Toggle filters" }).click();
  await page.getByLabel("Tag", { exact: true }).click();
  await page.getByRole("option", { name: tagName }).click();
  await expect(page.getByTestId(`card-game-${tagged.id}`)).toBeVisible();
  await expect(page.getByTestId(`card-game-${other.id}`)).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("tags-library.png") });

  // 3b. The roulette can draw from one tag only.
  await page.goto("/");
  await page.getByRole("button", { name: "Pick a game" }).click();
  await page.getByRole("combobox", { name: "Pick from" }).click();
  await page.getByRole("option", { name: "All visible games", exact: true }).click();
  await page.getByRole("combobox", { name: "Tag", exact: true }).click();
  await page.getByRole("option", { name: tagName }).click();
  await expect(page.getByTestId("roulette-title")).toHaveText(tagged.title);
  await page.getByRole("dialog").screenshot({ path: testInfo.outputPath("tags-roulette.png") });
  await page.keyboard.press("Escape");

  // 4. Deleting the tag removes it everywhere.
  await page.goto("/settings?tab=appearance");
  await page.getByRole("tab", { name: "Appearance", exact: true }).click();
  await card.getByRole("button", { name: `Delete tag ${tagName}` }).click();
  await page.getByRole("button", { name: "Delete tag", exact: true }).click();
  await expect(card.getByText(tagName)).toHaveCount(0);
});
