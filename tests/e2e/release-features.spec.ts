import { test, expect } from "@playwright/test";
import { patchUserSettings } from "./helpers";

test.describe("v1.5 release feature journeys", () => {
  test.describe.configure({ mode: "serial" });

  test("shows persisted DLC and expansion metadata in game details", async ({ page }) => {
    await page.route("/api/games*", async (route) => {
      await route.fulfill({
        json: [
          {
            id: "expansion-game",
            title: "Base Quest",
            status: "owned",
            addedAt: new Date().toISOString(),
            platforms: ["PC"],
            genres: [],
            hidden: false,
            expansions: [
              {
                id: 42,
                name: "Base Quest: Winter Expansion",
                coverUrl: "",
                releaseDate: "2025-02-01",
                category: "dlc",
                igdbUrl: "https://www.igdb.com/games/base-quest-winter",
              },
            ],
          },
        ],
      });
    });

    await page.goto("/");
    await page.getByTestId("card-game-expansion-game").click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("tab", { name: /DLC/ }).click();
    const expansion = dialog.getByTestId("dlc-42");
    await expect(expansion).toBeVisible();
    await expect(expansion).toContainText("Base Quest: Winter Expansion");
    await expect(expansion).toContainText("2025");
    await expect(expansion).toContainText("DLC");
    await expect(expansion).toHaveAttribute("href", "https://www.igdb.com/games/base-quest-winter");
  });

  test("saves platform preference and content filters", async ({ page }) => {
    const initialResponse = await page.request.get("/api/settings");
    expect(initialResponse.ok()).toBe(true);
    const initialSettings = (await initialResponse.json()) as {
      hideAdultContent: boolean;
      hideAgeRestrictedContent: boolean;
      preferredPlatform: string | null;
    };

    try {
      await page.goto("/settings");
      // Content filters are on Appearance; platform preference is on Discovery & Downloads.
      await page.getByRole("tab", { name: "Appearance" }).click();

      const adultFilter = page.getByLabel("Hide erotic content");
      if (await adultFilter.isChecked()) await adultFilter.click();
      const ageFilter = page.getByLabel("Hide age-restricted content");
      if (await ageFilter.isChecked()) await ageFilter.click();
      await page.getByRole("button", { name: "Save Content Filtering" }).click();
      await expect(
        page.getByText("Content filtering preferences have been saved.", { exact: true })
      ).toBeVisible();

      const settingsAfterFilters = await page.request.get("/api/settings");
      expect(await settingsAfterFilters.json()).toMatchObject({
        hideAdultContent: false,
        hideAgeRestrictedContent: false,
      });

      await page.getByRole("tab", { name: "Discovery & Downloads" }).click();
      await page.getByLabel("Preferred Platform").click();
      await page.getByRole("option", { name: "PS5", exact: true }).click();
      await page.getByRole("button", { name: "Save Auto-Search" }).click();
      await expect(
        page.getByText("Your auto-search preferences have been saved.", { exact: true })
      ).toBeVisible();

      const settingsAfterPlatform = await page.request.get("/api/settings");
      expect((await settingsAfterPlatform.json()).preferredPlatform).toBe("PS5");
    } finally {
      await patchUserSettings(page, initialSettings);
    }
  });

  test("links an orphaned download to a library game", async ({ page }) => {
    let linked = false;
    await page.route("/api/imports/pending", async (route) => {
      await route.fulfill({
        json: linked
          ? []
          : [
              {
                id: "orphaned-download",
                gameTitle: "Missing Game",
                downloadTitle: "Missing.Game.Release",
                status: "game_link_required",
                createdAt: new Date().toISOString(),
                errorMessage: "The original game was removed.",
              },
            ],
      });
    });
    await page.route("/api/games?*", async (route) => {
      await route.fulfill({
        json: [
          {
            id: "replacement-game",
            title: "Replacement Game",
            platforms: [],
            genres: [],
            hidden: false,
          },
        ],
      });
    });
    await page.route("/api/imports/orphaned-download/link", async (route) => {
      expect(route.request().postDataJSON()).toEqual({ gameId: "replacement-game" });
      linked = true;
      await route.fulfill({ json: { success: true } });
    });

    await page.goto("/");
    await page.getByRole("button", { name: "Link Game" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Replacement Game" }).click();
    await dialog.getByRole("button", { name: "Link Game" }).click();
    await expect(page.getByText("Game Linked", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Link Game" })).toHaveCount(0);
  });

  test("adds a root folder and starts its scan", async ({ page }) => {
    const rootFolder = {
      id: "root-folder",
      path: "/tmp/questarr-e2e-library",
      name: "E2E library",
      enabled: true,
      allowDelete: false,
      accessible: true,
      diskFreeBytes: 1024,
      diskTotalBytes: 2048,
    };
    let folders: (typeof rootFolder)[] = [];
    await page.route("/api/root-folders", async (route) => {
      if (route.request().method() === "POST") {
        expect(route.request().postDataJSON()).toMatchObject({
          path: rootFolder.path,
          name: rootFolder.name,
        });
        folders = [rootFolder];
        await route.fulfill({ status: 201, json: rootFolder });
        return;
      }
      await route.fulfill({ json: folders });
    });
    await page.route("/api/library/scan/status", async (route) => route.fulfill({ json: [] }));
    await page.route("/api/library/scan/unmatched", async (route) => route.fulfill({ json: [] }));
    await page.route("/api/library/scan", async (route) => {
      expect(route.request().postDataJSON()).toEqual({ rootFolderId: rootFolder.id });
      await route.fulfill({ status: 202, json: { accepted: true, rootFolderId: rootFolder.id } });
    });

    await page.goto("/library-import");
    await page.getByRole("button", { name: "Add Folder" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Path").fill(rootFolder.path);
    await dialog.getByLabel("Label (optional)").fill(rootFolder.name);
    await dialog.getByRole("button", { name: "Add Root Folder" }).click();
    await expect(page.getByText("Root Folder Added", { exact: true })).toBeVisible();
    await expect(page.getByText(rootFolder.path, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: `Scan ${rootFolder.path}` }).click();
    await expect(page.getByText("Scan Started", { exact: true })).toBeVisible();
  });
});
