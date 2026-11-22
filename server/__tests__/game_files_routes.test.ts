import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import os from "os";
import path from "path";
import fs from "fs/promises";
import {
  mockConfig,
  createStorageMock,
  createIgdbMock,
  createAuthMock,
  createDbMock,
  createDbModuleMock,
  createLoggerMocks,
  createRssMock,
  createTorznabMock,
  createNewznabMock,
  createProwlarrMock,
  createXrelMock,
  createAppriseMock,
  createDownloaderManagerMock,
  createSteamRoutesMock,
  createSearchMock,
  createConfigLoaderMock,
  createSocketMock,
} from "./fixtures/common-route-mocks.js";
import { registerRoutes } from "../routes.js";
import { storage } from "../storage.js";
import { igdbClient } from "../igdb.js";
import { importManager } from "../services/index.js";
import { setScanBudgets, resetScanBudgets } from "../scan-limits.js";
import type { Game, GameFile, GameDownload, ImportConfig } from "../../shared/schema.js";

vi.mock("../storage.js", () => ({ storage: createStorageMock() }));
vi.mock("../igdb.js", () => ({ igdbClient: createIgdbMock() }));
vi.mock("../auth.js", () => createAuthMock());
vi.mock("../db.js", () => createDbModuleMock());
vi.mock("../logger.js", () => createLoggerMocks());
vi.mock("../rss.js", () => ({ rssService: createRssMock() }));
vi.mock("../torznab.js", () => ({ torznabClient: createTorznabMock() }));
vi.mock("../newznab.js", () => ({ newznabClient: createNewznabMock() }));
vi.mock("../prowlarr.js", () => ({ prowlarrClient: createProwlarrMock() }));
vi.mock("../xrel.js", () => createXrelMock());
vi.mock("../apprise.js", async () => createAppriseMock());
vi.mock("../downloaders.js", () => ({ DownloaderManager: createDownloaderManagerMock() }));
vi.mock("../steam-routes.js", () => ({ steamRoutes: createSteamRoutesMock() }));
vi.mock("../search.js", () => createSearchMock());

vi.mock("../middleware.js", async () => {
  const actual = await vi.importActual<typeof import("../middleware.js")>("../middleware.js");
  return {
    ...actual,
    sensitiveEndpointLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
    authRateLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
    scanRateLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  };
});

vi.mock("../config.js", () => ({ config: mockConfig }));
vi.mock("../config-loader.js", () => ({ configLoader: createConfigLoaderMock() }));
vi.mock("../socket.js", () => createSocketMock());

// Auth mock (see fixtures/common-route-mocks.ts) attaches req.user = { id: "user-1", ... }.
const OWNER_ID = "user-1";
const gameId = "123e4567-e89b-12d3-a456-426614174000";
const otherGameId = "223e4567-e89b-12d3-a456-426614174000";

function makeGame(overrides: Partial<Game> = {}): Game {
  return {
    id: gameId,
    userId: OWNER_ID,
    title: "Test Game",
    libraryPath: null,
    ...overrides,
  } as Game;
}

function scanFixturePaths(root: string): { libraryRoot: string; gameDir: string } {
  const libraryRoot = path.join(root, "library");
  const gameDir = path.join(libraryRoot, "PC", "Test Game");
  return { libraryRoot, gameDir };
}

function mockScanLibrary(gameDir: string, libraryRoot: string): void {
  vi.mocked(storage.getGame).mockResolvedValue(
    makeGame({ libraryPath: gameDir }) as unknown as Awaited<ReturnType<typeof storage.getGame>>
  );
  vi.mocked(storage.getImportConfig).mockResolvedValue({
    libraryRoot,
  } as unknown as ImportConfig);
}

describe("Game file routes", () => {
  let app: express.Express;
  let tempRoot: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = express();
    app.set("trust proxy", 1);
    app.use(express.json());
    await registerRoutes(app);

    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "questarr-scan-"));
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
    resetScanBudgets();
  });

  describe("GET /api/games/:gameId/files", () => {
    it("returns 404 when the game does not exist", async () => {
      vi.mocked(storage.getGame).mockResolvedValue(undefined);

      const response = await request(app).get(`/api/games/${gameId}/files`);

      expect(response.status).toBe(404);
    });

    it("returns 403 when the game belongs to another user", async () => {
      vi.mocked(storage.getGame).mockResolvedValue(
        makeGame({ userId: "someone-else" }) as unknown as Awaited<
          ReturnType<typeof storage.getGame>
        >
      );

      const response = await request(app).get(`/api/games/${gameId}/files`);

      expect(response.status).toBe(403);
    });

    it("returns an empty file list when the game has no library path", async () => {
      vi.mocked(storage.getGame).mockResolvedValue(
        makeGame({ libraryPath: null }) as unknown as Awaited<ReturnType<typeof storage.getGame>>
      );

      const response = await request(app).get(`/api/games/${gameId}/files`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ files: [], truncated: false });
    });

    it("returns a standalone file when the stored library path points to a file", async () => {
      const { libraryRoot } = scanFixturePaths(tempRoot);
      const filePath = path.join(libraryRoot, "PC", "Test Game.iso");
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, "game");
      mockScanLibrary(filePath, libraryRoot);

      const response = await request(app).get(`/api/games/${gameId}/files`);

      expect(response.status).toBe(200);
      expect(response.body.files).toEqual([
        expect.objectContaining({
          name: "Test Game.iso",
          path: await fs.realpath(filePath),
          category: "main",
          size: 4,
        }),
      ]);
      expect(response.body.truncated).toBe(false);
    });

    it("returns 500 when an unexpected filesystem error occurs (e.g. permission denied)", async () => {
      const { libraryRoot, gameDir } = scanFixturePaths(tempRoot);
      await fs.mkdir(gameDir, { recursive: true });
      mockScanLibrary(gameDir, libraryRoot);

      const eacces = Object.assign(new Error("permission denied"), { code: "EACCES" });
      const readdirSpy = vi.spyOn(fs, "readdir").mockRejectedValue(eacces);

      const response = await request(app).get(`/api/games/${gameId}/files`);

      expect(response.status).toBe(500);
      readdirSpy.mockRestore();
    });

    it("recursively lists files, inheriting category from dlc/extra/packs parent folders", async () => {
      const { libraryRoot, gameDir } = scanFixturePaths(tempRoot);
      await fs.mkdir(path.join(gameDir, "dlc"), { recursive: true });
      await fs.mkdir(path.join(gameDir, "packs"), { recursive: true });
      await fs.writeFile(path.join(gameDir, "game.exe"), "main");
      await fs.writeFile(path.join(gameDir, "dlc", "content.bin"), "dlc-file");
      await fs.writeFile(path.join(gameDir, "packs", "content.bin"), "pack-file");
      mockScanLibrary(gameDir, libraryRoot);

      const response = await request(app).get(`/api/games/${gameId}/files`);

      expect(response.status).toBe(200);
      const files = response.body.files as Array<{ name: string; category: string }>;
      expect(files).toHaveLength(3);
      expect(files.find((f) => f.name === "game.exe")?.category).toBe("main");
      expect(files.find((f) => f.name === "content.bin" && f.category === "dlc")).toBeTruthy();
      // A "packs" folder inherits the packs convention, but is normalized to "extra" since
      // that's the only persistable category it maps to (see POST /api/game-files).
      expect(files.find((f) => f.name === "content.bin" && f.category === "extra")).toBeTruthy();
    });

    it("normalizes a filename-based 'packs' classification to 'extra'", async () => {
      const { libraryRoot, gameDir } = scanFixturePaths(tempRoot);
      await fs.mkdir(gameDir, { recursive: true });
      await fs.writeFile(path.join(gameDir, "Bonus Content Pack.zip"), "pack");
      mockScanLibrary(gameDir, libraryRoot);

      const response = await request(app).get(`/api/games/${gameId}/files`);

      expect(response.status).toBe(200);
      const files = response.body.files as Array<{ name: string; category: string }>;
      expect(files.find((f) => f.name === "Bonus Content Pack.zip")?.category).toBe("extra");
    });

    it("returns an empty file list when the stored library path escapes the configured library root", async () => {
      const { libraryRoot } = scanFixturePaths(tempRoot);
      const outsideDir = path.join(tempRoot, "outside", "Test Game");
      await fs.mkdir(libraryRoot, { recursive: true });
      await fs.mkdir(outsideDir, { recursive: true });
      await fs.writeFile(path.join(outsideDir, "game.exe"), "main");
      mockScanLibrary(outsideDir, libraryRoot);

      const response = await request(app).get(`/api/games/${gameId}/files`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ files: [], truncated: false });
    });

    it("caps the number of returned files and reports truncation", async () => {
      const { libraryRoot, gameDir } = scanFixturePaths(tempRoot);
      await fs.mkdir(gameDir, { recursive: true });
      // One more file than the cap so the walk must stop early:
      for (let i = 0; i < 4; i++) {
        await fs.writeFile(path.join(gameDir, `file-${i}.bin`), "x");
      }
      mockScanLibrary(gameDir, libraryRoot);
      setScanBudgets({ maxFiles: 3 });

      const response = await request(app).get(`/api/games/${gameId}/files`);

      expect(response.status).toBe(200);
      const files = response.body.files as Array<{ name: string }>;
      expect(files).toHaveLength(3);
      expect(response.body.truncated).toBe(true);
    });

    it("reports truncation=false when every file fits within the budgets", async () => {
      const { libraryRoot, gameDir } = scanFixturePaths(tempRoot);
      await fs.mkdir(gameDir, { recursive: true });
      await fs.writeFile(path.join(gameDir, "game.exe"), "main");
      mockScanLibrary(gameDir, libraryRoot);

      const response = await request(app).get(`/api/games/${gameId}/files`);

      expect(response.status).toBe(200);
      expect(response.body.files).toHaveLength(1);
      expect(response.body.truncated).toBe(false);
    });

    it("stops the walk once the wall-clock budget is exhausted", async () => {
      const { libraryRoot, gameDir } = scanFixturePaths(tempRoot);
      await fs.mkdir(gameDir, { recursive: true });
      await fs.writeFile(path.join(gameDir, "game.exe"), "main");
      mockScanLibrary(gameDir, libraryRoot);
      // A zero (actually already-expired) budget trips the deadline
      // before the first entry is visited:
      setScanBudgets({ timeBudgetMs: -1 });

      const response = await request(app).get(`/api/games/${gameId}/files`);

      expect(response.status).toBe(200);
      expect(response.body.files).toEqual([]);
      expect(response.body.truncated).toBe(true);
    });
  });

  describe("PATCH /api/games/:gameId/files/category", () => {
    async function setupGameFile(): Promise<string> {
      const { libraryRoot, gameDir } = scanFixturePaths(tempRoot);
      await fs.mkdir(gameDir, { recursive: true });
      const filePath = path.join(gameDir, "Game.Name.Update.2.zip");
      await fs.writeFile(filePath, "update");
      mockScanLibrary(gameDir, libraryRoot);
      return fs.realpath(filePath);
    }

    it("records a new file with the chosen category and marks it as overridden", async () => {
      const filePath = await setupGameFile();
      vi.mocked(storage.addGameFile).mockResolvedValue({ id: "gf-new" } as GameFile);

      const response = await request(app)
        .patch(`/api/games/${gameId}/files/category`)
        .send({ path: filePath, category: "dlc" });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ path: filePath, category: "dlc" });
      expect(storage.addGameFile).toHaveBeenCalledWith(
        expect.objectContaining({ gameId, filePath, category: "dlc", downloadId: null })
      );
      expect(storage.updateGameFileCategory).toHaveBeenCalledWith("gf-new", "dlc");
    });

    it("updates the existing record when the file is already tracked", async () => {
      const filePath = await setupGameFile();
      vi.mocked(storage.getGameFiles).mockResolvedValueOnce([
        { id: "gf-1", gameId, filePath, category: "update", categoryOverridden: false } as GameFile,
      ]);

      const response = await request(app)
        .patch(`/api/games/${gameId}/files/category`)
        .send({ path: filePath, category: "main" });

      expect(response.status).toBe(200);
      expect(storage.addGameFile).not.toHaveBeenCalled();
      expect(storage.updateGameFileCategory).toHaveBeenCalledWith("gf-1", "main");
    });

    it("rejects a path outside the game's folder", async () => {
      await setupGameFile();
      const outside = path.join(tempRoot, "outside.bin");
      await fs.writeFile(outside, "x");

      const response = await request(app)
        .patch(`/api/games/${gameId}/files/category`)
        .send({ path: outside, category: "dlc" });

      expect(response.status).toBe(404);
      expect(storage.updateGameFileCategory).not.toHaveBeenCalled();
    });

    it("rejects a symlink in the game's folder that points outside it", async () => {
      const filePath = await setupGameFile();
      const outside = path.join(tempRoot, "outside.bin");
      await fs.writeFile(outside, "x");
      const link = path.join(path.dirname(filePath), "link.bin");
      await fs.symlink(outside, link);

      const response = await request(app)
        .patch(`/api/games/${gameId}/files/category`)
        .send({ path: link, category: "dlc" });

      expect(response.status).toBe(404);
      expect(storage.updateGameFileCategory).not.toHaveBeenCalled();
    });

    it("rejects an unknown category", async () => {
      const filePath = await setupGameFile();

      const response = await request(app)
        .patch(`/api/games/${gameId}/files/category`)
        .send({ path: filePath, category: "unknown" });

      expect(response.status).toBe(400);
    });

    it("returns 403 when the game belongs to another user", async () => {
      const filePath = await setupGameFile();
      vi.mocked(storage.getGame).mockResolvedValue(
        makeGame({ userId: "someone-else" }) as unknown as Awaited<
          ReturnType<typeof storage.getGame>
        >
      );

      const response = await request(app)
        .patch(`/api/games/${gameId}/files/category`)
        .send({ path: filePath, category: "dlc" });

      expect(response.status).toBe(403);
    });

    it("makes the scan report the overridden category", async () => {
      const filePath = await setupGameFile();
      vi.mocked(storage.getGameFiles).mockResolvedValueOnce([
        { id: "gf-1", gameId, filePath, category: "dlc", categoryOverridden: true } as GameFile,
      ]);

      const response = await request(app).get(`/api/games/${gameId}/files`);

      expect(response.status).toBe(200);
      expect(response.body.files).toEqual([
        expect.objectContaining({ path: filePath, category: "dlc" }),
      ]);
    });

    it("keeps the folder/filename guess for tracked files the user never changed", async () => {
      const filePath = await setupGameFile();
      vi.mocked(storage.getGameFiles).mockResolvedValueOnce([
        { id: "gf-1", gameId, filePath, category: "dlc", categoryOverridden: false } as GameFile,
      ]);

      const response = await request(app).get(`/api/games/${gameId}/files`);

      expect(response.body.files).toEqual([
        expect.objectContaining({ path: filePath, category: "update" }),
      ]);
    });
  });

  describe("GET /api/games/:gameId/content", () => {
    it("groups game files by category into slots", async () => {
      vi.mocked(storage.getGame).mockResolvedValue(
        makeGame() as unknown as Awaited<ReturnType<typeof storage.getGame>>
      );
      vi.mocked(storage.getGameFiles).mockResolvedValue([
        {
          id: "gf-1",
          gameId,
          downloadId: null,
          originalName: "game.exe",
          storedName: "game.exe",
          category: "main",
          filePath: "/library/game.exe",
          fileSize: 100,
          igdbContentId: null,
          createdAt: new Date("2024-01-01T00:00:00.000Z"),
        } as GameFile,
      ]);

      const response = await request(app).get(`/api/games/${gameId}/content`);

      expect(response.status).toBe(200);
      const mainSlot = response.body.slots.find((s: { category: string }) => s.category === "main");
      expect(mainSlot.present).toBe(true);
      expect(mainSlot.files).toHaveLength(1);
      expect(mainSlot.files[0].igdbContentId).toBeNull();
      const dlcSlot = response.body.slots.find((s: { category: string }) => s.category === "dlc");
      expect(dlcSlot.present).toBe(false);
    });

    it("uses live IGDB videos when stored game videos are empty", async () => {
      vi.mocked(storage.getGame).mockResolvedValue(
        makeGame({ igdbId: 42, videos: [] }) as unknown as Awaited<
          ReturnType<typeof storage.getGame>
        >
      );
      vi.mocked(storage.getGameFiles).mockResolvedValue([]);
      vi.mocked(igdbClient.getGameEditions).mockResolvedValue({
        base: {
          id: 42,
          name: "Test Game",
          videos: [{ video_id: "abc123XYZ", name: "Trailer" }],
        },
        editions: [],
      });

      const response = await request(app).get(`/api/games/${gameId}/content`);

      expect(response.status).toBe(200);
      expect(response.body.videos).toEqual([{ videoId: "abc123XYZ", name: "Trailer" }]);
    });

    it("does not assign a generic update to an unrelated IGDB expansion", async () => {
      const expansionId = 2001;
      vi.mocked(storage.getGame).mockResolvedValue(
        makeGame({
          expansions: [
            {
              id: expansionId,
              name: "Verified Expansion",
              category: "dlc",
              coverUrl: "",
              releaseDate: "",
            },
          ],
        }) as unknown as Awaited<ReturnType<typeof storage.getGame>>
      );
      vi.mocked(storage.getGameFiles).mockResolvedValue([
        {
          id: "gf-update",
          gameId,
          downloadId: null,
          originalName: "Game Update v1.zip",
          storedName: "Game Update v1.zip",
          category: "update",
          filePath: "/library/update/Game Update v1.zip",
          fileSize: 100,
          igdbContentId: null,
          createdAt: new Date(),
        } as GameFile,
      ]);

      const response = await request(app).get(`/api/games/${gameId}/content`);

      expect(response.status).toBe(200);
      const expansionSlot = response.body.slots.find(
        (slot: { igdbId?: number }) => slot.igdbId === expansionId
      );
      const updateSlot = response.body.slots.find(
        (slot: { category: string; igdbId?: number }) =>
          slot.category === "update" && slot.igdbId === undefined
      );
      expect(expansionSlot).toMatchObject({ present: false, files: [] });
      expect(updateSlot).toMatchObject({ present: true, files: [{ id: "gf-update" }] });
    });

    it("keeps an explicitly linked file out of every other generic slot", async () => {
      const expansionId = 2001;
      vi.mocked(storage.getGame).mockResolvedValue(
        makeGame({
          expansions: [
            {
              id: expansionId,
              name: "Verified Expansion",
              category: "dlc",
              coverUrl: "",
              releaseDate: "",
            },
          ],
        }) as unknown as Awaited<ReturnType<typeof storage.getGame>>
      );
      vi.mocked(storage.getGameFiles).mockResolvedValue([
        {
          id: "gf-linked",
          gameId,
          downloadId: null,
          originalName: "Expansion.zip",
          storedName: "Expansion.zip",
          category: "update",
          filePath: "/library/update/Expansion.zip",
          fileSize: 100,
          igdbContentId: expansionId,
          createdAt: new Date(),
        } as GameFile,
      ]);

      const response = await request(app).get(`/api/games/${gameId}/content`);

      expect(response.status).toBe(200);
      expect(
        response.body.slots.find((slot: { igdbId?: number }) => slot.igdbId === expansionId)
      ).toMatchObject({ present: true, files: [{ id: "gf-linked" }] });
      expect(
        response.body.slots.find(
          (slot: { category: string; igdbId?: number }) =>
            slot.category === "update" && slot.igdbId === undefined
        )
      ).toMatchObject({ present: false, files: [] });
    });

    it("keeps live IGDB update and expansion slots distinct from generic files", async () => {
      vi.mocked(storage.getGame).mockResolvedValue(
        makeGame({ igdbId: 42, expansions: [] }) as unknown as Awaited<
          ReturnType<typeof storage.getGame>
        >
      );
      vi.mocked(igdbClient.getGameEditions).mockResolvedValue({
        base: {
          id: 42,
          name: "Test Game",
          expansions: [
            {
              id: 2001,
              name: "Verified Expansion",
              summary: "A verified expansion.",
              rating: 80,
              aggregated_rating: 75,
            },
          ],
          dlcs: [{ id: 3001, name: "Official Update", game_type: 14 }],
        },
        editions: [],
      });
      vi.mocked(storage.getGameFiles).mockResolvedValue([
        {
          id: "gf-update",
          gameId,
          downloadId: null,
          originalName: "Game Update v1.zip",
          storedName: "Game Update v1.zip",
          category: "update",
          filePath: "/library/update/Game Update v1.zip",
          fileSize: 100,
          igdbContentId: null,
          createdAt: new Date(),
        } as GameFile,
      ]);

      const response = await request(app).get(`/api/games/${gameId}/content`);

      expect(response.status).toBe(200);
      expect(
        response.body.slots.find((slot: { igdbId?: number }) => slot.igdbId === 2001)
      ).toMatchObject({
        category: "dlc",
        igdbCategory: 2,
        summary: "A verified expansion.",
        rating: 80,
        aggregatedRating: 75,
        present: false,
        files: [],
      });
      expect(
        response.body.slots.find((slot: { igdbId?: number }) => slot.igdbId === 3001)
      ).toMatchObject({
        category: "update",
        igdbCategory: 14,
        present: false,
        files: [],
      });
      expect(
        response.body.slots.find(
          (slot: { category: string; igdbId?: number }) =>
            slot.category === "update" && slot.igdbId === undefined
        )
      ).toMatchObject({ present: true, files: [{ id: "gf-update" }] });
    });

    it("restores legacy IGDB content groups and linked library-game state", async () => {
      const expandedGameId = 4101;
      const parentGameId = 4201;
      const linkedGameId = "323e4567-e89b-12d3-a456-426614174000";
      vi.mocked(storage.getGame).mockResolvedValue(
        makeGame({ igdbId: 42, expansions: [] }) as unknown as Awaited<
          ReturnType<typeof storage.getGame>
        >
      );
      vi.mocked(storage.getUserGames).mockResolvedValue([
        makeGame({ id: linkedGameId, igdbId: parentGameId, title: "Linked Expansion" }),
      ] as unknown as Game[]);
      vi.mocked(igdbClient.getGameEditions).mockResolvedValue({
        base: {
          id: 42,
          name: "Test Game",
          expanded_games: [{ id: expandedGameId, name: "Expanded Story", category: 2 }],
        },
        editions: [],
        parentGames: [{ id: parentGameId, name: "Linked Expansion", category: 2 }],
        expandedGames: [{ id: expandedGameId, name: "Expanded Story", category: 2 }],
      });
      vi.mocked(storage.getGameFiles).mockResolvedValue([
        {
          id: "gf-linked",
          gameId,
          downloadId: null,
          originalName: "Linked Expansion.zip",
          storedName: "Linked Expansion.zip",
          category: "dlc",
          filePath: "/library/dlc/Linked Expansion.zip",
          fileSize: 100,
          igdbContentId: parentGameId,
          createdAt: new Date(),
        } as GameFile,
      ]);

      const response = await request(app).get(`/api/games/${gameId}/content`);

      expect(response.status).toBe(200);
      expect(
        response.body.slots.find((slot: { igdbId?: number }) => slot.igdbId === expandedGameId)
      ).toMatchObject({ category: "dlc", present: false, files: [] });
      expect(
        response.body.slots.find((slot: { igdbId?: number }) => slot.igdbId === parentGameId)
      ).toMatchObject({
        category: "dlc",
        gameId: linkedGameId,
        present: true,
        files: [{ id: "gf-linked" }],
      });
    });
  });

  describe("PATCH /api/game-files/:id/content", () => {
    const fileId = "423e4567-e89b-12d3-a456-426614174000";

    it("associates a file with a specific IGDB content item", async () => {
      vi.mocked(storage.getGameFile).mockResolvedValue({
        id: fileId,
        gameId,
        category: "dlc",
      } as GameFile);
      vi.mocked(storage.getGame).mockResolvedValue(
        makeGame({
          expansions: [
            {
              id: 9876,
              name: "Verified Expansion",
              category: "dlc",
              coverUrl: "",
              releaseDate: "",
            },
          ],
        }) as unknown as Awaited<ReturnType<typeof storage.getGame>>
      );
      vi.mocked(storage.updateGameFileContentId).mockResolvedValue({
        id: fileId,
        gameId,
        igdbContentId: 9876,
      } as GameFile);

      const response = await request(app)
        .patch(`/api/game-files/${fileId}/content`)
        .send({ igdbContentId: 9876 });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ id: fileId, gameId, igdbContentId: 9876 });
      expect(storage.updateGameFileContentId).toHaveBeenCalledWith(fileId, 9876);
    });

    it("rejects associating an update file with an expansion", async () => {
      vi.mocked(storage.getGameFile).mockResolvedValue({
        id: fileId,
        gameId,
        category: "update",
      } as GameFile);
      vi.mocked(storage.getGame).mockResolvedValue(
        makeGame({
          expansions: [
            {
              id: 9876,
              name: "Verified Expansion",
              category: "dlc",
              coverUrl: "",
              releaseDate: "",
            },
          ],
        }) as unknown as Awaited<ReturnType<typeof storage.getGame>>
      );

      const response = await request(app)
        .patch(`/api/game-files/${fileId}/content`)
        .send({ igdbContentId: 9876 });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("category does not match");
      expect(storage.updateGameFileContentId).not.toHaveBeenCalled();
    });

    it("clears an association when the client sends null", async () => {
      vi.mocked(storage.getGameFile).mockResolvedValue({
        id: fileId,
        gameId,
      } as GameFile);
      vi.mocked(storage.getGame).mockResolvedValue(
        makeGame() as unknown as Awaited<ReturnType<typeof storage.getGame>>
      );
      vi.mocked(storage.updateGameFileContentId).mockResolvedValue({
        id: fileId,
        gameId,
        igdbContentId: null,
      } as GameFile);

      const response = await request(app)
        .patch(`/api/game-files/${fileId}/content`)
        .send({ igdbContentId: null });

      expect(response.status).toBe(200);
      expect(response.body.igdbContentId).toBeNull();
      expect(storage.updateGameFileContentId).toHaveBeenCalledWith(fileId, null);
    });

    it("does not mutate a file belonging to another user", async () => {
      vi.mocked(storage.getGameFile).mockResolvedValue({
        id: fileId,
        gameId,
      } as GameFile);
      vi.mocked(storage.getGame).mockResolvedValue(
        makeGame({ userId: "someone-else" }) as unknown as Awaited<
          ReturnType<typeof storage.getGame>
        >
      );

      const response = await request(app)
        .patch(`/api/game-files/${fileId}/content`)
        .send({ igdbContentId: 9876 });

      expect(response.status).toBe(403);
      expect(storage.updateGameFileContentId).not.toHaveBeenCalled();
    });

    it("rejects non-positive IGDB content ids", async () => {
      const response = await request(app)
        .patch(`/api/game-files/${fileId}/content`)
        .send({ igdbContentId: 0 });

      expect(response.status).toBe(400);
      expect(storage.updateGameFileContentId).not.toHaveBeenCalled();
    });

    it("rejects an IGDB content id that is not linked to the game", async () => {
      vi.mocked(storage.getGameFile).mockResolvedValue({
        id: fileId,
        gameId,
      } as GameFile);
      vi.mocked(storage.getGame).mockResolvedValue(
        makeGame({
          expansions: [
            {
              id: 9876,
              name: "Verified Expansion",
              category: "dlc",
              coverUrl: "",
              releaseDate: "",
            },
          ],
        }) as unknown as Awaited<ReturnType<typeof storage.getGame>>
      );

      const response = await request(app)
        .patch(`/api/game-files/${fileId}/content`)
        .send({ igdbContentId: 54321 });

      expect(response.status).toBe(400);
      expect(storage.updateGameFileContentId).not.toHaveBeenCalled();
    });
  });

  describe("POST /api/games/:gameId/manual-import", () => {
    it("records the exact IGDB content association for a slot import", async () => {
      vi.mocked(storage.getGame).mockResolvedValue(
        makeGame({
          igdbId: 42,
          expansions: [],
        }) as unknown as Awaited<ReturnType<typeof storage.getGame>>
      );
      vi.mocked(igdbClient.getGameEditions).mockResolvedValue({
        base: {
          id: 42,
          name: "Test Game",
          expansions: [{ id: 2001, name: "Verified Expansion", game_type: 2 }],
          dlcs: [],
        },
        editions: [],
      });
      vi.mocked(storage.getGameFiles).mockResolvedValue([]);
      vi.mocked(storage.addGameFile).mockResolvedValue({
        id: "gf-slot",
        gameId,
        filePath: "/library/PC/Test Game/dlc/expansion.bin",
        category: "dlc",
        igdbContentId: 2001,
      } as GameFile);
      const importSpy = vi.spyOn(importManager, "manualImportFile").mockResolvedValue({
        destDir: "/library/PC/Test Game",
        newPath: "/library/PC/Test Game/dlc/expansion.bin",
        fileSize: 123,
        modeUsed: "move",
      });

      const response = await request(app).post(`/api/games/${gameId}/manual-import`).send({
        filePath: "/downloads/expansion.bin",
        category: "dlc",
        transferMode: "copy",
        igdbContentId: 2001,
      });

      expect(response.status).toBe(201);
      expect(storage.addGameFile).toHaveBeenCalledWith(
        expect.objectContaining({
          gameId,
          category: "dlc",
          igdbContentId: 2001,
          filePath: "/library/PC/Test Game/dlc/expansion.bin",
        })
      );
      expect(importSpy).toHaveBeenCalledWith(
        "/downloads/expansion.bin",
        expect.objectContaining({ id: gameId }),
        expect.objectContaining({ category: "dlc" })
      );
      expect(importSpy.mock.calls[0]?.[2]).not.toHaveProperty("igdbContentId");
      importSpy.mockRestore();
    });

    it("rejects non-move transfer modes for Scan Disk imports", async () => {
      vi.mocked(storage.getGame).mockResolvedValue(
        makeGame({ igdbId: 42, expansions: [] }) as unknown as Awaited<
          ReturnType<typeof storage.getGame>
        >
      );
      const importSpy = vi.spyOn(importManager, "manualImportFile");

      const response = await request(app).post(`/api/games/${gameId}/manual-import`).send({
        filePath: "/library/PC/Test Game/update.bin",
        category: "update",
        transferMode: "copy",
        scanDisk: true,
      });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("move transfer mode");
      expect(importSpy).not.toHaveBeenCalled();
      importSpy.mockRestore();
    });

    it("rejects an IGDB expansion when the selected category is update", async () => {
      vi.mocked(storage.getGame).mockResolvedValue(
        makeGame({ igdbId: 42, expansions: [] }) as unknown as Awaited<
          ReturnType<typeof storage.getGame>
        >
      );
      vi.mocked(igdbClient.getGameEditions).mockResolvedValue({
        base: {
          id: 42,
          name: "Test Game",
          expansions: [{ id: 2001, name: "Verified Expansion", game_type: 2 }],
          dlcs: [],
        },
        editions: [],
      });
      const importSpy = vi.spyOn(importManager, "manualImportFile");

      const response = await request(app).post(`/api/games/${gameId}/manual-import`).send({
        filePath: "/downloads/update.bin",
        category: "update",
        igdbContentId: 2001,
      });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("category does not match");
      expect(importSpy).not.toHaveBeenCalled();
      importSpy.mockRestore();
    });

    it("rejects an IGDB content id that belongs to a different game", async () => {
      vi.mocked(storage.getGame).mockResolvedValue(
        makeGame({ igdbId: 42, expansions: [] }) as unknown as Awaited<
          ReturnType<typeof storage.getGame>
        >
      );
      vi.mocked(igdbClient.getGameEditions).mockResolvedValue({
        base: {
          id: 42,
          name: "Test Game",
          expansions: [{ id: 2001, name: "Verified Expansion", game_type: 2 }],
          dlcs: [],
        },
        editions: [],
      });
      const importSpy = vi.spyOn(importManager, "manualImportFile");

      const response = await request(app).post(`/api/games/${gameId}/manual-import`).send({
        filePath: "/downloads/other.bin",
        category: "dlc",
        igdbContentId: 9999,
      });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("does not belong to this game");
      expect(importSpy).not.toHaveBeenCalled();
      importSpy.mockRestore();
    });

    it("rejects imports for a game owned by another user", async () => {
      vi.mocked(storage.getGame).mockResolvedValue(
        makeGame({ userId: "other-user", igdbId: 42 }) as unknown as Awaited<
          ReturnType<typeof storage.getGame>
        >
      );
      const importSpy = vi.spyOn(importManager, "manualImportFile");

      const response = await request(app)
        .post(`/api/games/${gameId}/manual-import`)
        .send({ filePath: "/downloads/game.bin", category: "main" });

      expect(response.status).toBe(403);
      expect(importSpy).not.toHaveBeenCalled();
      importSpy.mockRestore();
    });
  });

  describe("GET /api/game-files/by-download/:downloadId", () => {
    const downloadId = "323e4567-e89b-12d3-a456-426614174000";

    it("returns 404 when the download does not exist for this user", async () => {
      vi.mocked(storage.getGameDownload).mockResolvedValue(undefined);

      const response = await request(app).get(`/api/game-files/by-download/${downloadId}`);

      expect(response.status).toBe(404);
    });

    it("returns files linked to the download", async () => {
      vi.mocked(storage.getGameDownload).mockResolvedValue({
        id: downloadId,
        gameId,
      } as unknown as GameDownload);
      vi.mocked(storage.getGameFilesByDownload).mockResolvedValue([
        { id: "gf-1", gameId, downloadId } as GameFile,
      ]);

      const response = await request(app).get(`/api/game-files/by-download/${downloadId}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
    });
  });

  describe("POST /api/game-files", () => {
    const validBody = {
      gameId,
      originalName: "game.exe",
      storedName: "game.exe",
      category: "main",
      filePath: "/library/game.exe",
    };

    it("creates a game file for an owned game", async () => {
      vi.mocked(storage.getGame).mockResolvedValue(
        makeGame() as unknown as Awaited<ReturnType<typeof storage.getGame>>
      );
      const filePath = path.join(tempRoot, "library", "game.exe");
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, "game");
      vi.mocked(storage.getImportConfig).mockResolvedValue({
        libraryRoot: path.join(tempRoot, "library"),
      } as unknown as ImportConfig);
      vi.mocked(storage.addGameFile).mockResolvedValue({
        id: "gf-1",
        ...validBody,
        downloadId: null,
        fileSize: null,
        createdAt: new Date(),
      } as GameFile);

      const response = await request(app)
        .post("/api/game-files")
        .send({ ...validBody, filePath });

      expect(response.status).toBe(201);
      expect(storage.addGameFile).toHaveBeenCalled();
    });

    it("rejects a game file path that points to a directory", async () => {
      vi.mocked(storage.getGame).mockResolvedValue(
        makeGame() as unknown as Awaited<ReturnType<typeof storage.getGame>>
      );
      const libraryRoot = path.join(tempRoot, "library");
      const directoryPath = path.join(libraryRoot, "PC", "Test Game");
      await fs.mkdir(directoryPath, { recursive: true });
      vi.mocked(storage.getImportConfig).mockResolvedValue({
        libraryRoot,
      } as unknown as ImportConfig);

      const response = await request(app)
        .post("/api/game-files")
        .send({ ...validBody, filePath: directoryPath });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("Game file path must point to a file");
      expect(storage.addGameFile).not.toHaveBeenCalled();
    });

    it("rejects a game file path outside the configured library root", async () => {
      vi.mocked(storage.getGame).mockResolvedValue(
        makeGame() as unknown as Awaited<ReturnType<typeof storage.getGame>>
      );
      const libraryRoot = path.join(tempRoot, "library");
      const outsidePath = path.join(tempRoot, "outside", "game.exe");
      await fs.mkdir(path.dirname(outsidePath), { recursive: true });
      await fs.writeFile(outsidePath, "game");
      vi.mocked(storage.getImportConfig).mockResolvedValue({
        libraryRoot,
      } as unknown as ImportConfig);

      const response = await request(app)
        .post("/api/game-files")
        .send({ ...validBody, filePath: outsidePath });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("Game file path must be inside the game library");
      expect(storage.addGameFile).not.toHaveBeenCalled();
    });

    it("rejects a category outside the known enum (e.g. packs)", async () => {
      const response = await request(app)
        .post("/api/game-files")
        .send({ ...validBody, category: "packs" });

      expect(response.status).toBe(400);
      expect(storage.addGameFile).not.toHaveBeenCalled();
    });

    it("returns 403 when the game does not belong to the requesting user", async () => {
      vi.mocked(storage.getGame).mockResolvedValue(
        makeGame({ userId: "someone-else" }) as unknown as Awaited<
          ReturnType<typeof storage.getGame>
        >
      );

      const response = await request(app).post("/api/game-files").send(validBody);

      expect(response.status).toBe(403);
      expect(storage.addGameFile).not.toHaveBeenCalled();
    });

    it("returns 404 when downloadId does not belong to the target game", async () => {
      const downloadId = "323e4567-e89b-12d3-a456-426614174000";
      vi.mocked(storage.getGame).mockResolvedValue(
        makeGame() as unknown as Awaited<ReturnType<typeof storage.getGame>>
      );
      vi.mocked(storage.getGameDownload).mockResolvedValue({
        id: downloadId,
        gameId: otherGameId,
      } as unknown as GameDownload);

      const response = await request(app)
        .post("/api/game-files")
        .send({ ...validBody, downloadId });

      expect(response.status).toBe(404);
      expect(storage.addGameFile).not.toHaveBeenCalled();
    });
  });

  describe("DELETE /api/game-files/:id", () => {
    const fileId = "423e4567-e89b-12d3-a456-426614174000";

    it("returns 404 when the game file does not exist", async () => {
      vi.mocked(storage.getGameFile).mockResolvedValue(undefined);

      const response = await request(app).delete(`/api/game-files/${fileId}`);

      expect(response.status).toBe(404);
    });

    it("returns 403 when the parent game belongs to another user", async () => {
      vi.mocked(storage.getGameFile).mockResolvedValue({
        id: fileId,
        gameId,
      } as GameFile);
      vi.mocked(storage.getGame).mockResolvedValue(
        makeGame({ userId: "someone-else" }) as unknown as Awaited<
          ReturnType<typeof storage.getGame>
        >
      );

      const response = await request(app).delete(`/api/game-files/${fileId}`);

      expect(response.status).toBe(403);
      expect(storage.removeGameFile).not.toHaveBeenCalled();
    });

    it("deletes an owned game file", async () => {
      vi.mocked(storage.getGameFile).mockResolvedValue({
        id: fileId,
        gameId,
      } as GameFile);
      vi.mocked(storage.getGame).mockResolvedValue(
        makeGame() as unknown as Awaited<ReturnType<typeof storage.getGame>>
      );
      vi.mocked(storage.removeGameFile).mockResolvedValue(true);

      const response = await request(app).delete(`/api/game-files/${fileId}`);

      expect(response.status).toBe(200);
      expect(storage.removeGameFile).toHaveBeenCalledWith(fileId);
    });
  });
});
