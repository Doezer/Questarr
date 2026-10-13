import { test, expect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { patchUserSettings } from "./helpers";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "../../shared/schema";

test.describe("v1.5 changes since RC1", () => {
  test("explains incomplete ClamAV scans and large-file limits", async ({ page }, testInfo) => {
    await page.goto("/settings");
    await page.getByRole("tab", { name: "Import", exact: true }).click();
    await page.getByRole("tab", { name: "Security & Scanning", exact: true }).click();
    await expect(page.getByText(/A download ClamAV can't fully scan/)).toBeVisible();
    await page.getByText(/A download ClamAV can't fully scan/).scrollIntoViewIfNeeded();
    for (const limit of ["StreamMaxLength", "MaxFileSize", "MaxScanSize"]) {
      await expect(page.getByText(limit, { exact: true })).toBeVisible();
    }
    await page.screenshot({ path: testInfo.outputPath("security-scan-guidance.png") });
  });
  test("refreshes RSS releases without losing the enabled feed configuration", async ({ page }) => {
    const feed = {
      id: "release-feed",
      name: "Release feed",
      url: "https://feed.example/rss",
      type: "custom",
      enabled: true,
      status: "ok",
    };
    let refreshed = false;
    await page.route("/api/rss/feeds", (route) => route.fulfill({ json: [feed] }));
    await page.route("/api/rss/items", (route) =>
      route.fulfill({
        json: refreshed
          ? [
              {
                id: "rss-release",
                title: "Portal Release",
                sourceName: feed.name,
                link: "https://feed.example/portal",
                pubDate: new Date().toISOString(),
              },
            ]
          : [],
      })
    );
    await page.route("/api/rss/refresh", async (route) => {
      expect(route.request().method()).toBe("POST");
      refreshed = true;
      await route.fulfill({ json: { success: true } });
    });
    await page.goto("/rss");
    await expect(
      page.getByText("No RSS items found. Make sure you have enabled feeds and refreshed.")
    ).toBeVisible();
    await page.getByRole("button", { name: "Refresh Feeds", exact: true }).click();
    await expect(page.getByText("Portal Release", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("link", { name: "View original article for Portal Release" })
    ).toHaveAttribute("href", "https://feed.example/portal");
    await page.getByRole("button", { name: "Manage Feeds", exact: true }).click();
    const row = page.getByRole("dialog").getByRole("row").filter({ hasText: feed.name });
    await expect(row.getByRole("switch")).toBeChecked();
  });

  test.describe("viewer timezone", () => {
    test.use({ timezoneId: "Pacific/Honolulu" });

    test("year calendar mutes past months and releases by the viewer's local day", async ({
      page,
    }) => {
      await page.clock.setFixedTime(new Date("2026-05-29T12:00:00Z"));
      const base = {
        status: "wanted",
        addedAt: "2026-01-01",
        platforms: [],
        genres: [],
        hidden: false,
      };
      await page.route("/api/games*", (route) =>
        route.fulfill({
          json: [
            { ...base, id: "past-month", title: "April Release", releaseDate: "2026-04-10" },
            {
              ...base,
              id: "past-day",
              title: "Yesterday Release",
              releaseDate: "2026-05-29T08:00:00Z",
            },
            { ...base, id: "today", title: "Today Release", releaseDate: "2026-05-30T01:00:00Z" },
            { ...base, id: "future", title: "Future Release", releaseDate: "2026-06-10" },
          ],
        })
      );
      await page.goto("/calendar");
      await expect(
        page.getByRole("heading", { name: "April", exact: true }).locator("../..")
      ).toHaveClass(/opacity-50/);
      await expect(page.getByRole("button", { name: /Yesterday Release/ })).toHaveClass(
        /opacity-50/
      );
      await expect(page.getByRole("button", { name: /Today Release/ })).not.toHaveClass(
        /opacity-50/
      );
      await expect(page.getByRole("button", { name: /Future Release/ })).not.toHaveClass(
        /opacity-50/
      );
      await expect(
        page.getByRole("heading", { name: "June", exact: true }).locator("../..")
      ).not.toHaveClass(/opacity-50/);
    });
  });

  test("Library Import scans on add, enable, path change and enabling post-processing", async ({
    page,
  }) => {
    const folderPath = await mkdtemp(path.join(os.tmpdir(), "questarr-e2e-root-"));
    const changedPath = await mkdtemp(path.join(os.tmpdir(), "questarr-e2e-changed-root-"));
    const settingsResponse = await page.request.get("/api/settings");
    expect(settingsResponse.ok()).toBe(true);
    const initialSettings = await settingsResponse.json();
    let folderId: string | undefined;
    const csrf = (await page.context().cookies()).find((c) => c.name === "questarr_csrf")!.value;
    try {
      await page.goto("/");
      await page.getByTestId("nav-library-import").click();
      await expect(
        page.getByRole("heading", { name: "Library Import", exact: true })
      ).toBeVisible();
      await page.getByRole("button", { name: "Add Folder" }).click();
      const dialog = page.getByRole("dialog", { name: "Add Root Folder" });
      await dialog.getByLabel("Path", { exact: true }).fill(folderPath);
      const created = page.waitForResponse(
        (r) => r.url().endsWith("/api/root-folders") && r.request().method() === "POST"
      );
      await dialog.getByRole("button", { name: "Add Root Folder", exact: true }).click();
      const response = await created;
      expect(response.status()).toBe(201);
      folderId = (await response.json()).id;
      await expect(page.getByText("Root Folder Added", { exact: true })).toBeVisible();
      await expect(
        page.getByRole("switch", { name: `Allow deleting files in ${folderPath}` })
      ).not.toBeChecked();

      const scan = async () => {
        const response = await page.request.get("/api/library/scan/status");
        expect(response.ok()).toBe(true);
        const progress = await response.json();
        return progress.find((entry: { rootFolderId: string }) => entry.rootFolderId === folderId);
      };
      await expect.poll(async () => (await scan())?.status).toBe("completed");
      const firstScan = await scan();
      expect(firstScan.totalCandidates).toBe(0);
      const enabled = page.getByRole("switch", { name: `Enable ${folderPath}`, exact: true });
      await enabled.click();
      await expect(enabled).not.toBeChecked();
      await enabled.click();
      await expect(enabled).toBeChecked();
      await expect
        .poll(async () => {
          const next = await scan();
          return next?.status === "completed" && next.startedAt !== firstScan.startedAt;
        })
        .toBe(true);
      await page.reload();
      await expect(page.getByText(folderPath, { exact: true }).first()).toBeVisible();
      const beforePathChange = await scan();
      const changed = await page.request.patch(`/api/root-folders/${folderId}`, {
        headers: { "X-CSRF-Token": csrf },
        data: { path: changedPath },
      });
      expect(changed.ok()).toBe(true);
      await expect
        .poll(async () => {
          const next = await scan();
          return (
            next?.status === "completed" &&
            next.rootFolderPath === changedPath &&
            next.startedAt !== beforePathChange.startedAt
          );
        })
        .toBe(true);
      await patchUserSettings(page, { enablePostProcessing: false });
      const beforeSettingsChange = await scan();
      await page.goto("/settings");
      await page.getByRole("tab", { name: "Import", exact: true }).click();
      await page
        .getByText("Enable Post-Processing", { exact: true })
        .locator("../..")
        .getByRole("switch")
        .click();
      await page.getByRole("button", { name: "Save Changes", exact: true }).click();
      await expect(
        page.getByText("Import configuration updated. Scanning your root folders for games now.", {
          exact: true,
        })
      ).toBeVisible();
      await expect
        .poll(async () => {
          const next = await scan();
          return next?.status === "completed" && next.startedAt !== beforeSettingsChange.startedAt;
        })
        .toBe(true);
    } finally {
      if (folderId) {
        const deleted = await page.request.delete(`/api/root-folders/${folderId}`, {
          headers: { "X-CSRF-Token": csrf },
        });
        expect(deleted.status()).toBe(204);
      }
      await rm(folderPath, { recursive: true, force: true });
      await rm(changedPath, { recursive: true, force: true });
      await patchUserSettings(page, { enablePostProcessing: initialSettings.enablePostProcessing });
    }
  });

  test("searches IGDB by another name for an unmatched folder and confirms the match", async ({
    page,
  }) => {
    const entry = {
      rootFolderId: "review-root",
      rootFolderPath: "/games",
      folderName: "Release.Name-GROUP",
      absolutePath: "/games/Release.Name-GROUP",
      candidates: [],
    };
    let matched = false;
    let attempts = 0;
    await page.route("/api/root-folders", (route) => route.fulfill({ json: [] }));
    await page.route("/api/library/scan/status", (route) => route.fulfill({ json: [] }));
    await page.route("/api/library/scan/unmatched", (route) =>
      route.fulfill({ json: matched ? [] : [entry] })
    );
    await page.route("/api/library/scan/unmatched/search", async (route) => {
      expect(route.request().postDataJSON()).toEqual({
        rootFolderId: entry.rootFolderId,
        folderName: entry.folderName,
        query: "Portal",
      });
      attempts += 1;
      await route.fulfill(
        attempts === 1
          ? { status: 500, json: { error: "IGDB search failed" } }
          : { json: [{ igdbId: 71, name: "Portal", releaseYear: 2007 }] }
      );
    });
    await page.route("/api/library/scan/unmatched/match", async (route) => {
      expect(route.request().postDataJSON()).toEqual({
        rootFolderId: entry.rootFolderId,
        folderName: entry.folderName,
        igdbId: 71,
      });
      matched = true;
      await route.fulfill({ json: { gameId: "portal", filesAdded: 1 } });
    });
    await page.goto("/library-import");
    await expect(page.getByText("No IGDB matches found.", { exact: true })).toBeVisible();
    await page.getByLabel(`Search IGDB for ${entry.folderName}`).fill("Portal");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page.getByText("Search Failed", { exact: true })).toBeVisible();
    await expect(page.getByText(entry.folderName, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page.getByRole("button", { name: "Portal (2007)", exact: true }).click();
    await expect(page.getByText("Game Matched", { exact: true })).toBeVisible();
    await expect(page.getByText(entry.folderName, { exact: true })).toHaveCount(0);
  });

  test("persists independent update-notification preferences for shelved and completed games", async ({
    page,
  }) => {
    const initialResponse = await page.request.get("/api/settings");
    expect(initialResponse.ok()).toBe(true);
    const initial = await initialResponse.json();
    try {
      await patchUserSettings(page, {
        notificationPreferences: JSON.stringify(DEFAULT_NOTIFICATION_PREFERENCES),
      });
      await page.goto("/settings");
      await page.getByRole("tab", { name: "Notifications", exact: true }).click();
      const shelved = page.getByLabel("Notify for shelved games", { exact: true });
      const completed = page.getByLabel("Notify for completed games", { exact: true });
      await expect(shelved).toBeChecked();
      await expect(completed).toBeChecked();
      await shelved.click();
      await expect
        .poll(
          async () =>
            JSON.parse(
              (await (await page.request.get("/api/settings")).json()).notificationPreferences
            ).gameUpdates.includeShelved
        )
        .toBe(false);
      await expect(completed).toBeChecked();
      await completed.click();
      await expect
        .poll(
          async () =>
            JSON.parse(
              (await (await page.request.get("/api/settings")).json()).notificationPreferences
            ).gameUpdates.includeCompleted
        )
        .toBe(false);
      await page.reload();
      await page.getByRole("tab", { name: "Notifications", exact: true }).click();
      await expect(shelved).not.toBeChecked();
      await expect(completed).not.toBeChecked();
      const saved = await (await page.request.get("/api/settings")).json();
      const preferences = JSON.parse(saved.notificationPreferences);
      expect(preferences.gameUpdates).toMatchObject({
        inApp: true,
        apprise: true,
        includeShelved: false,
        includeCompleted: false,
      });
      expect(preferences.gameReleased).toEqual(DEFAULT_NOTIFICATION_PREFERENCES.gameReleased);
    } finally {
      await patchUserSettings(page, { notificationPreferences: initial.notificationPreferences });
    }
  });

  test("reuses saved Prowlarr defaults, validates priority and clears the saved key for another URL", async ({
    page,
  }) => {
    const saved = {
      url: "http://prowlarr:9696",
      apiKey: "********",
      allowInsecureLan: true,
      priority: 3,
      categories: ["4050"],
    };
    await page.route("/api/indexers/prowlarr/settings", (route) => route.fulfill({ json: saved }));
    await page.route("/api/indexers/prowlarr/sync", async (route) => {
      expect(route.request().postDataJSON()).toEqual({
        url: "https://prowlarr.example",
        apiKey: "replacement-test-key",
        allowInsecureLan: false,
        priority: 4,
        categories: ["4050"],
      });
      await route.fulfill({
        json: { success: true, message: "Synced test indexers", results: [] },
      });
    });
    await page.goto("/indexers");
    await page.getByTestId("button-sync-prowlarr").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Prowlarr URL")).toHaveValue(saved.url);
    await expect(dialog.getByLabel("API Key", { exact: true })).toHaveValue(saved.apiKey);
    await expect(
      dialog.getByText("Using the saved key. Type a new one to replace it.")
    ).toBeVisible();
    await expect(page.getByTestId("multi-select-prowlarr-categories")).toContainText("PC > Games");
    const sync = page.getByTestId("button-sync-prowlarr-confirm");
    await dialog.getByLabel("Priority", { exact: true }).fill("101");
    await expect(sync).toBeDisabled();
    await dialog.getByLabel("Priority", { exact: true }).fill("4");
    await dialog.getByLabel("Allow insecure LAN connection", { exact: true }).click();
    await expect(page.getByTestId("text-prowlarr-insecure-lan-warning")).toBeVisible();
    await dialog.getByLabel("Prowlarr URL").fill("https://prowlarr.example");
    await expect(dialog.getByLabel("API Key", { exact: true })).toHaveValue("");
    await expect(sync).toBeDisabled();
    await dialog.getByLabel("API Key", { exact: true }).fill("replacement-test-key");
    await sync.click();
    await expect(dialog).not.toBeVisible();
    await page.reload();
    await page.getByTestId("button-sync-prowlarr").click();
    await expect(dialog.getByLabel("Prowlarr URL")).toHaveValue(saved.url);
  });

  test("keeps HTTP consent revoked after a failed sync and reopening the dialog", async ({
    page,
  }, testInfo) => {
    const saved = {
      url: "http://prowlarr:9696",
      apiKey: "********",
      allowInsecureLan: true,
      priority: 3,
      categories: ["4050"],
    };
    let settingsReads = 0;
    let indexerReads = 0;
    let syncAttempts = 0;
    await page.route("/api/indexers/prowlarr/settings", (route) => {
      settingsReads++;
      return route.fulfill({ json: saved });
    });
    await page.route("/api/indexers", (route) => {
      indexerReads++;
      return route.fulfill({ json: [] });
    });
    await page.route("/api/indexers/prowlarr/sync", async (route) => {
      syncAttempts++;
      expect(route.request().postDataJSON().allowInsecureLan).not.toBe(true);
      expect(route.request().postDataJSON().apiKey).toBe(saved.apiKey);
      saved.allowInsecureLan = false;
      await route.fulfill({ status: 500, json: { error: "HTTP credentials require HTTPS" } });
    });
    await page.goto("/indexers");
    await page.getByTestId("button-sync-prowlarr").click();
    const consent = page.getByTestId("checkbox-prowlarr-insecure-lan");
    await expect(consent).toBeChecked();
    await page.getByLabel("Prowlarr URL").fill(`${saved.url}/`);
    await expect(page.getByLabel("API Key", { exact: true })).toHaveValue(saved.apiKey);
    await consent.click();
    await page.screenshot({ path: testInfo.outputPath("prowlarr-equivalent-url.png") });
    const initialIndexerReads = indexerReads;
    await page.getByTestId("button-sync-prowlarr-confirm").click();
    await expect(page.getByText("Sync failed", { exact: true })).toBeVisible();
    await expect.poll(() => settingsReads).toBe(2);
    await expect.poll(() => indexerReads).toBeGreaterThan(initialIndexerReads);
    await page.getByTestId("button-cancel-prowlarr").click();
    await page.getByTestId("button-sync-prowlarr").click();
    await expect(consent).not.toBeChecked();
    await expect(page.getByTestId("text-prowlarr-insecure-lan-warning")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("prowlarr-revocation.png") });
    // A subsequent attempt must not silently send the previous opt-in again.
    await page.getByTestId("button-sync-prowlarr-confirm").click();
    await expect.poll(() => syncAttempts).toBe(2);
    await expect(consent).not.toBeChecked();
  });

  test("round-trips masked Apprise login credentials and warns about HTTP", async ({ page }) => {
    const saved = {
      configured: true,
      mode: "api",
      apiUrl: "https://apprise.example",
      key: "test-config",
      urls: "",
      username: "questarr",
      password: "********",
    };
    let saves = 0;
    await page.route("/api/settings/apprise", async (route) => {
      if (route.request().method() === "POST") {
        expect(route.request().postDataJSON()).toMatchObject({
          mode: "api",
          username: "questarr",
          password: saved.password,
        });
        saves += 1;
        await route.fulfill({ json: { success: true } });
      } else {
        await route.fulfill({ json: saved });
      }
    });
    await page.goto("/settings");
    await page.getByRole("tab", { name: "Notifications", exact: true }).click();
    await expect(page.locator("#apprise-password")).toHaveValue(saved.password);
    await page.locator("#apprise-api-url").fill("http://apprise:8000");
    await expect(page.getByText(/This API URL uses http:\/\//)).toBeVisible();
    await page.locator("#apprise-api-url").fill(saved.apiUrl);
    await expect(page.getByText(/This API URL uses http:\/\//)).toHaveCount(0);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(() => saves).toBe(1);
    await page.reload();
    await page.getByRole("tab", { name: "Notifications", exact: true }).click();
    await expect(page.locator("#apprise-username")).toHaveValue(saved.username);
    await expect(page.locator("#apprise-password")).toHaveValue(saved.password);
    await page.getByLabel("Mode", { exact: true }).click();
    await page.getByRole("option", { name: "CLI", exact: true }).click();
    await expect(page.locator("#apprise-password")).toHaveCount(0);
    await page.getByLabel("Mode", { exact: true }).click();
    await page.getByRole("option", { name: "API", exact: true }).click();
    await expect(page.locator("#apprise-password")).toHaveValue(saved.password);
  });
});
