import { test, expect } from "@playwright/test";

test.describe("Discover journey", () => {
  // Inherits authenticated state from 'setup' project

  test("should open the Discover page and display the heading", async ({ page }) => {
    await page.goto("/discover");

    await expect(page.getByRole("heading", { name: /Discover/i })).toBeVisible();
  });
});

test.describe("Discover details release actions", () => {
  for (const scenario of ["download", "existing", "blacklist", "send"] as const) {
    test(`uses a library record for ${scenario}`, async ({ page }, testInfo) => {
      const libraryId = "0f8fad5b-d9cb-469f-a165-70867728950e";
      const game = {
        id: "igdb-990001",
        igdbId: 990001,
        title: "Release Quest",
        status: "wanted",
        platforms: ["PC"],
        genres: [],
        hidden: false,
        coverUrl: "",
        addedAt: new Date().toISOString(),
      };
      const release = {
        title: "Release.Quest-GROUP",
        link: "magnet:?xt=urn:btih:0123456789012345678901234567890123456789",
        guid: "release-quest",
        indexerName: "Test indexer",
        seeders: 50,
        size: 1024 * 1024 * 1024,
        pubDate: new Date().toISOString(),
      };
      let adds = 0;
      let actionRequests = 0;
      let blacklisted = false;
      const searches: string[] = [];
      await page.route("/api/igdb/**", (route) => {
        const url = route.request().url();
        return route.fulfill({ json: /genres|platforms/.test(url) ? [] : [game] });
      });
      await page.route("/api/games?*", (route) => route.fulfill({ json: [] }));
      await page.route("/api/games", async (route) => {
        if (route.request().method() !== "POST") return route.fulfill({ json: [] });
        adds++;
        expect(route.request().postDataJSON()).toMatchObject({ igdbId: 990001, status: "wanted" });
        const added = { ...game, id: libraryId };
        await route.fulfill({
          status: scenario === "existing" ? 409 : 201,
          json: scenario === "existing" ? { error: "Already in collection", game: added } : added,
        });
      });
      await page.route("/api/indexers/enabled", (route) => route.fulfill({ json: [] }));
      await page.route("/api/downloaders/enabled", (route) =>
        route.fulfill({
          json: [
            { id: "first", name: "First torrent client", type: "qbittorrent", enabled: true },
            { id: "second", name: "Second torrent client", type: "transmission", enabled: true },
          ],
        })
      );
      await page.route("/api/search?*", (route) => {
        searches.push(new URL(route.request().url()).searchParams.get("gameId") ?? "");
        return route.fulfill({
          json: { items: blacklisted ? [] : [release], total: blacklisted ? 0 : 1 },
        });
      });
      await page.route(`/api/games/${libraryId}/blacklist`, async (route) => {
        actionRequests++;
        expect(route.request().postDataJSON()).toMatchObject({ releaseTitle: release.title });
        blacklisted = true;
        await route.fulfill({ json: { success: true } });
      });
      const downloadEndpoint =
        scenario === "send" ? "/api/downloaders/second/downloads" : "/api/downloads";
      await page.route(downloadEndpoint, async (route) => {
        if (route.request().method() !== "POST") return route.fulfill({ json: [] });
        actionRequests++;
        expect(route.request().postDataJSON()).toMatchObject({
          gameId: libraryId,
          title: release.title,
        });
        expect(adds).toBe(1);
        await route.fulfill({ json: { success: true, message: "Release sent" } });
      });
      await page.goto("/discover");
      await page.getByTestId(`card-game-${game.id}`).first().click();
      await page.getByTestId("button-download-game").click();
      const dialog = page.getByRole("dialog").last();
      await expect(dialog.getByText(release.title, { exact: true })).toBeVisible();
      if (scenario === "blacklist" || scenario === "send") {
        await dialog.getByRole("button", { name: "More options" }).click();
        if (scenario === "blacklist") {
          await page.getByRole("menuitem", { name: "Blacklist release" }).click();
          await expect.poll(() => searches.includes(libraryId)).toBe(true);
          await expect(dialog.getByText(release.title, { exact: true })).not.toBeVisible();
        } else {
          // Use the submenu's keyboard navigation inside the nested details dialog.
          await page.getByRole("menuitem", { name: "Send to downloader" }).hover();
          const target = page.getByRole("menuitem", { name: "Second torrent client" });
          await expect(target).toBeVisible();
          await target.press("Enter");
          await expect(
            page.getByText("Download sent to Second torrent client", { exact: true })
          ).toBeVisible();
        }
      } else {
        await dialog
          .getByRole("button", { name: "Download Release Quest-GROUP", exact: true })
          .click();
      }
      await expect.poll(() => actionRequests).toBe(1);
      expect(adds).toBe(1);
      if (scenario === "blacklist") {
        await page.screenshot({ path: testInfo.outputPath("discover-blacklist.png") });
      }
    });
  }
});

test.describe("Discover details library actions", () => {
  for (const scenario of [
    "hide-new",
    "hide-existing",
    "rating",
    "rating-filter",
    "remove",
  ] as const) {
    test(`refreshes the library identity for ${scenario}`, async ({ page }, testInfo) => {
      const libraryId = "0f8fad5b-d9cb-469f-a165-70867728950e";
      const game = {
        id: "igdb-990002",
        igdbId: 990002,
        title: "Discovery Actions Quest",
        status: "wanted",
        platforms: ["PC"],
        genres: [],
        hidden: false,
        coverUrl: "",
        userRating: null as number | null,
        addedAt: new Date().toISOString(),
      };
      let library =
        scenario === "hide-existing" || scenario === "remove" ? [{ ...game, id: libraryId }] : [];
      let writes = 0;
      let reads = 0;
      await page.addInitScript((hideWanted) => {
        localStorage.setItem("discoverHideOwned", "false");
        localStorage.setItem("discoverHideWanted", JSON.stringify(hideWanted));
      }, scenario === "rating-filter");
      await page.route("/api/igdb/**", (route) =>
        route.fulfill({ json: /genres|platforms/.test(route.request().url()) ? [] : [game] })
      );
      await page.route("/api/games?*", (route) => {
        reads++;
        return route.fulfill({ json: library });
      });
      await page.route("/api/games", (route) => {
        if (route.request().method() !== "POST") return route.fulfill({ json: library });
        const data = route.request().postDataJSON();
        expect(data).toMatchObject({ igdbId: game.igdbId, status: "wanted" });
        library = [{ ...game, ...data, id: libraryId }];
        if (scenario === "hide-new") {
          expect(data.hidden).toBe(true);
          writes++;
        }
        return route.fulfill({ status: 201, json: library[0] });
      });
      await page.route(`/api/games/${libraryId}/hidden`, (route) => {
        expect(route.request().postDataJSON()).toEqual({ hidden: true });
        library = library.map((g) => ({ ...g, hidden: true }));
        writes++;
        return route.fulfill({ json: library[0] });
      });
      await page.route(`/api/games/${libraryId}/user-rating`, (route) => {
        expect(route.request().postDataJSON()).toEqual({ userRating: 8 });
        library = library.map((g) => ({ ...g, userRating: 8 }));
        writes++;
        return route.fulfill({ json: library[0] });
      });
      await page.route(`/api/games/${libraryId}?deleteFiles=false`, (route) => {
        expect(route.request().method()).toBe("DELETE");
        library = [];
        writes++;
        return route.fulfill({ json: { success: true } });
      });

      await page.goto("/discover");
      await page.getByTestId(`card-game-${game.id}`).first().click();
      const modal = page.getByRole("dialog").first();
      await expect.poll(() => reads).toBeGreaterThan(0);
      const initialReads = reads;
      if (scenario.startsWith("hide")) {
        await modal.getByRole("button", { name: "Hide", exact: true }).click();
        await expect(modal).not.toBeVisible();
        await expect(page.getByTestId(`card-game-${game.id}`)).toHaveCount(0);
      } else if (scenario.startsWith("rating")) {
        await expect(modal.getByRole("button", { name: "Remove", exact: true })).toHaveCount(0);
        await modal.getByRole("tab", { name: /links/i }).click();
        await modal.getByRole("button", { name: "Rate 4 out of 5" }).click();
        if (scenario === "rating-filter") {
          // Hide wanted was already enabled: adding via rating must refresh the carousel.
          await expect(page.getByTestId(`card-game-${game.id}`)).toHaveCount(0);
        } else {
          await expect(modal.getByRole("button", { name: "Remove", exact: true })).toBeVisible();
          await page.screenshot({ path: testInfo.outputPath("discover-rating.png") });
        }
      } else {
        await modal.getByRole("button", { name: "Remove", exact: true }).click();
        await page
          .getByRole("alertdialog")
          .getByRole("button", { name: "Remove", exact: true })
          .click();
        await expect(modal).not.toBeVisible();
        await expect(page.getByTestId(`card-game-${game.id}`).first()).toBeVisible();
      }
      await expect.poll(() => writes).toBe(1);
      await expect.poll(() => reads).toBeGreaterThan(initialReads);
    });
  }
});
