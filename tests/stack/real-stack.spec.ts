import { test, expect, type Page } from "@playwright/test";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  INDEXER,
  LIBRARY_ROOT,
  PAYLOAD_FILE,
  QBITTORRENT,
  RELEASES,
  SABNZBD,
  TRANSMISSION,
  type ReleaseKey,
} from "./services";

// One account, one library, one set of clients: the journeys build on each other in order.
test.describe.configure({ mode: "serial" });

// Production keeps its rate limits (600 API requests per minute per IP), so status checks
// poll gently rather than every few hundred milliseconds.
const POLL = { intervals: [3_000], timeout: 30_000 };

let page: Page;
const downloaderIds: Partial<Record<ReleaseKey, string>> = {};
const gameIds: Partial<Record<ReleaseKey, string>> = {};

async function api<T = unknown>(method: string, url: string, data?: unknown): Promise<T> {
  const csrf = (await page.context().cookies()).find((c) => c.name === "questarr_csrf")?.value;
  const response = await page.request.fetch(url, {
    method,
    data,
    headers: csrf ? { "X-CSRF-Token": csrf } : {},
  });
  const body = await response.text();
  if (!response.ok()) throw new Error(`${method} ${url} -> ${response.status()}: ${body}`);
  return (body ? JSON.parse(body) : undefined) as T;
}

/** Every file below `dir`, as paths relative to it. */
function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)));
}

interface GameRow {
  id: string;
  title: string;
  status: string;
}

async function gameStatus(key: ReleaseKey): Promise<string | undefined> {
  const games = await api<GameRow[]>("GET", "/api/games");
  return games.find((g) => g.id === gameIds[key])?.status;
}

/** Opens the game from its library card, then its download dialog, and grabs the release. */
async function grabFromLibrary(key: ReleaseKey): Promise<void> {
  const release = RELEASES[key];
  await page.goto("/");
  await page.getByLabel(`View details for ${release.game}`, { exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Download", exact: true }).click();
  const grab = page.getByRole("button", {
    name: `Download ${release.title.replace(/[._]/g, " ")}`,
    exact: true,
  });
  await expect(grab).toBeVisible({ timeout: 30_000 });
  const added = page.waitForResponse(
    (r) => r.url().endsWith("/api/downloads") && r.request().method() === "POST"
  );
  await grab.click();
  const response = await added;
  expect(response.ok(), await response.text()).toBe(true);
}

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
});

test.afterAll(async () => {
  await page.close();
});

test("first-run setup creates the admin account", async () => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/setup$/);
  await page.fill('input[name="username"]', "admin");
  await page.fill('input[name="password"]', "password123");
  await page.fill('input[name="confirmPassword"]', "password123");
  const igdbId = page.locator('input[name="igdbClientId"]');
  if (await igdbId.isVisible()) {
    await igdbId.fill("dummyclientid0000000000000000");
    await page.fill('input[name="igdbClientSecret"]', "dummyclientsecret000000000000");
  }
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/auth/setup") && r.status() === 200),
    page.getByRole("button", { name: "Create Account" }).click(),
  ]);
  await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
});

test("indexers and download clients connect", async () => {
  const torznab = await api<{ id: string }>("POST", "/api/indexers", {
    name: "Stack Torznab",
    url: `http://127.0.0.1:${INDEXER.port}/api`,
    apiKey: INDEXER.apiKey,
    protocol: "torznab",
    categories: ["4050"],
    priority: 1,
    allowInsecureLan: true,
  });
  const newznab = await api<{ id: string }>("POST", "/api/indexers", {
    name: "Stack Newznab",
    url: `http://127.0.0.1:${INDEXER.port}/newznab/api`,
    apiKey: INDEXER.apiKey,
    protocol: "newznab",
    categories: ["4050"],
    priority: 2,
    allowInsecureLan: true,
  });
  for (const id of [torznab.id, newznab.id]) {
    const result = await api<{ success: boolean; message?: string }>(
      "POST",
      `/api/indexers/${id}/test`
    );
    expect(result.success, JSON.stringify(result)).toBe(true);
  }

  const clients = {
    qbittorrent: {
      name: "Stack qBittorrent",
      type: "qbittorrent",
      url: `http://127.0.0.1:${QBITTORRENT.port}`,
      username: QBITTORRENT.username,
      password: QBITTORRENT.password,
      downloadPath: QBITTORRENT.downloads,
      priority: 1,
    },
    transmission: {
      name: "Stack Transmission",
      type: "transmission",
      url: `http://127.0.0.1:${TRANSMISSION.port}`,
      username: TRANSMISSION.username,
      password: TRANSMISSION.password,
      downloadPath: TRANSMISSION.downloads,
      priority: 2,
    },
    sabnzbd: {
      name: "Stack SABnzbd",
      type: "sabnzbd",
      url: `http://127.0.0.1:${SABNZBD.port}`,
      // Questarr keeps the SABnzbd API key in the username field.
      username: SABNZBD.apiKey,
      priority: 3,
    },
  } as const;
  for (const [key, client] of Object.entries(clients) as [ReleaseKey, object][]) {
    const created = await api<{ id: string }>("POST", "/api/downloaders", {
      ...client,
      enabled: true,
      allowInsecureLan: true,
    });
    downloaderIds[key] = created.id;
    const result = await api<{ success: boolean; message?: string }>(
      "POST",
      `/api/downloaders/${created.id}/test`
    );
    expect(result.success, `${key}: ${JSON.stringify(result)}`).toBe(true);
  }

  await api("PATCH", "/api/settings", {
    enablePostProcessing: true,
    libraryRoot: LIBRARY_ROOT,
    transferMode: "copy",
  });

  for (const [key, release] of Object.entries(RELEASES) as [
    ReleaseKey,
    (typeof RELEASES)[ReleaseKey],
  ][]) {
    const game = await api<{ id: string }>("POST", "/api/games", {
      title: release.game,
      igdbId: 990_000 + Object.keys(RELEASES).indexOf(key),
      status: "wanted",
      platforms: ["PC (Microsoft Windows)"],
      genres: ["Adventure"],
      releaseDate: "2020-01-15",
    });
    gameIds[key] = game.id;
  }
});

for (const key of ["qbittorrent", "transmission"] as const) {
  test(`${key}: grab from the library, download, import into the library`, async () => {
    // Only the client under test takes torrents, so the grab cannot fall back elsewhere.
    for (const other of ["qbittorrent", "transmission"] as const) {
      await api("PATCH", `/api/downloaders/${downloaderIds[other]}`, { enabled: other === key });
    }

    await grabFromLibrary(key);
    await expect.poll(() => gameStatus(key), POLL).toBe("downloading");

    // The download check runs every minute; import follows completion in the same tick.
    await expect
      .poll(() => gameStatus(key), { timeout: 4 * 60 * 1000, intervals: [5_000] })
      .toBe("owned");
    // Imported as <libraryRoot>/<platform>/<game>/ with the payload intact.
    await expect
      .poll(() => listFiles(LIBRARY_ROOT), { timeout: 30_000 })
      .toContain(path.join("PC", RELEASES[key].game, PAYLOAD_FILE));
  });
}

test("sabnzbd: grab a usenet release and see it queued in the client", async () => {
  await grabFromLibrary("sabnzbd");
  await expect.poll(() => gameStatus("sabnzbd"), POLL).toBe("downloading");
  const queue = await fetch(
    `http://127.0.0.1:${SABNZBD.port}/api?mode=queue&output=json&apikey=${SABNZBD.apiKey}`
  ).then((r) => r.json() as Promise<{ queue: { slots: { filename: string }[] } }>);
  expect(queue.queue.slots.map((s) => s.filename)).toContain(RELEASES.sabnzbd.title);

  const downloads = await api<{ name?: string; title?: string }[]>(
    "GET",
    `/api/downloaders/${downloaderIds.sabnzbd}/downloads`
  );
  expect(downloads.map((d) => d.name ?? d.title)).toContain(RELEASES.sabnzbd.title);
});
