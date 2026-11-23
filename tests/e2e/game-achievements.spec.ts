import { expect, test } from "@playwright/test";
import { seedGame, uniqueId } from "./helpers";

const ACHIEVEMENTS = [
  {
    apiName: "ESCAPE",
    displayName: "Escaped the Underworld",
    description: "Leave the Underworld for the first time.",
    icon: "",
    iconGray: "",
    hidden: false,
    achieved: true,
    unlockedAt: Date.UTC(2026, 10, 2),
    globalPercent: 3.4,
  },
  {
    apiName: "FIRST_BLOOD",
    displayName: "First Blood",
    description: "Defeat your first enemy.",
    icon: "",
    iconGray: "",
    hidden: false,
    achieved: true,
    unlockedAt: Date.UTC(2026, 9, 28),
    globalPercent: 91.2,
  },
  {
    apiName: "SECRET",
    displayName: "Hidden path",
    description: null,
    icon: "",
    iconGray: "",
    hidden: true,
    achieved: false,
    unlockedAt: null,
    globalPercent: null,
  },
];

test("lists the Steam achievements in the game details and filters them", async ({
  page,
}, testInfo) => {
  const game = await seedGame(page, { title: "Hades", igdbId: uniqueId(), status: "playing" });

  // The game is linked to a Steam app and Steam answers are mocked at the browser boundary.
  await page.route(`**/api/games/${game.id}`, async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), steamAppId: 1145360 } });
  });
  await page.route(`**/api/games/${game.id}/achievements`, (route) =>
    route.fulfill({ json: { achievements: ACHIEVEMENTS } })
  );

  await page.goto(`/games/${game.id}`);
  const section = page.getByRole("region", { name: "Achievements" });
  await expect(section.getByText("Escaped the Underworld")).toBeVisible();
  await expect(section.getByText("2/3")).toBeVisible();
  await expect(section.getByText("Hidden achievement")).toBeVisible();
  await section.scrollIntoViewIfNeeded();
  await section.screenshot({ path: testInfo.outputPath("game-achievements.png") });

  await section.getByRole("radio", { name: "Show locked" }).click();
  await expect(section.getByText("Hidden path")).toBeVisible();
  await expect(section.getByText("Escaped the Underworld")).toBeHidden();
  await section.screenshot({ path: testInfo.outputPath("game-achievements-locked.png") });
});
