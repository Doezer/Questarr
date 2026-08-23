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
import { setScanBudgets, resetScanBudgets } from "../scan-limits.js";
import type { Game, GameFile, GameDownload, ImportConfig } from "../../shared/schema.js";

vi.mock("../storage.js", () => ({ storage: createStorageMock() }));
vi.mock("../igdb.js", () => ({ igdbClient: createIgdbMock() }));
vi.mock("../auth.js", () => createAuthMock());
vi.mock("../db.js", () => ({ db: createDbMock() }));
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

    it("returns 500 when an unexpected filesystem error occurs (e.g. permission denied)", async () => {
      const libraryRoot = path.join(tempRoot, "library");
      const gameDir = path.join(libraryRoot, "PC", "Test Game");
      await fs.mkdir(gameDir, { recursive: true });

      vi.mocked(storage.getGame).mockResolvedValue(
        makeGame({ libraryPath: gameDir }) as unknown as Awaited<ReturnType<typeof storage.getGame>>
      );
      vi.mocked(storage.getImportConfig).mockResolvedValue({
        libraryRoot,
      } as unknown as ImportConfig);

      const eacces = Object.assign(new Error("permission denied"), { code: "EACCES" });
      const readdirSpy = vi.spyOn(fs, "readdir").mockRejectedValue(eacces);

      const response = await request(app).get(`/api/games/${gameId}/files`);

      expect(response.status).toBe(500);
      readdirSpy.mockRestore();
    });

    it("recursively lists files, inheriting category from dlc/extra/packs parent folders", async () => {
      const libraryRoot = path.join(tempRoot, "library");
      const gameDir = path.join(libraryRoot, "PC", "Test Game");
      await fs.mkdir(path.join(gameDir, "dlc"), { recursive: true });
      await fs.mkdir(path.join(gameDir, "packs"), { recursive: true });
      await fs.writeFile(path.join(gameDir, "game.exe"), "main");
      await fs.writeFile(path.join(gameDir, "dlc", "content.bin"), "dlc-file");
      await fs.writeFile(path.join(gameDir, "packs", "content.bin"), "pack-file");

      vi.mocked(storage.getGame).mockResolvedValue(
        makeGame({ libraryPath: gameDir }) as unknown as Awaited<ReturnType<typeof storage.getGame>>
      );
      vi.mocked(storage.getImportConfig).mockResolvedValue({
        libraryRoot,
      } as unknown as ImportConfig);

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
      const libraryRoot = path.join(tempRoot, "library");
      const gameDir = path.join(libraryRoot, "PC", "Test Game");
      await fs.mkdir(gameDir, { recursive: true });
      await fs.writeFile(path.join(gameDir, "Bonus Content Pack.zip"), "pack");

      vi.mocked(storage.getGame).mockResolvedValue(
        makeGame({ libraryPath: gameDir }) as unknown as Awaited<ReturnType<typeof storage.getGame>>
      );
      vi.mocked(storage.getImportConfig).mockResolvedValue({
        libraryRoot,
      } as unknown as ImportConfig);

      const response = await request(app).get(`/api/games/${gameId}/files`);

      expect(response.status).toBe(200);
      const files = response.body.files as Array<{ name: string; category: string }>;
      expect(files.find((f) => f.name === "Bonus Content Pack.zip")?.category).toBe("extra");
    });

    it("returns an empty file list when the stored library path escapes the configured library root", async () => {
      const libraryRoot = path.join(tempRoot, "library");
      const outsideDir = path.join(tempRoot, "outside", "Test Game");
      await fs.mkdir(libraryRoot, { recursive: true });
      await fs.mkdir(outsideDir, { recursive: true });
      await fs.writeFile(path.join(outsideDir, "game.exe"), "main");

      vi.mocked(storage.getGame).mockResolvedValue(
        makeGame({ libraryPath: outsideDir }) as unknown as Awaited<
          ReturnType<typeof storage.getGame>
        >
      );
      vi.mocked(storage.getImportConfig).mockResolvedValue({
        libraryRoot,
      } as unknown as ImportConfig);

      const response = await request(app).get(`/api/games/${gameId}/files`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ files: [], truncated: false });
    });

    it("caps the number of returned files and reports truncation", async () => {
      const libraryRoot = path.join(tempRoot, "library");
      const gameDir = path.join(libraryRoot, "PC", "Test Game");
      await fs.mkdir(gameDir, { recursive: true });
      // One more file than the cap so the walk must stop early:
      for (let i = 0; i < 4; i++) {
        await fs.writeFile(path.join(gameDir, `file-${i}.bin`), "x");
      }

      vi.mocked(storage.getGame).mockResolvedValue(
        makeGame({ libraryPath: gameDir }) as unknown as Awaited<ReturnType<typeof storage.getGame>>
      );
      vi.mocked(storage.getImportConfig).mockResolvedValue({
        libraryRoot,
      } as unknown as ImportConfig);
      setScanBudgets({ maxFiles: 3 });

      const response = await request(app).get(`/api/games/${gameId}/files`);

      expect(response.status).toBe(200);
      const files = response.body.files as Array<{ name: string }>;
      expect(files).toHaveLength(3);
      expect(response.body.truncated).toBe(true);
    });

    it("reports truncation=false when every file fits within the budgets", async () => {
      const libraryRoot = path.join(tempRoot, "library");
      const gameDir = path.join(libraryRoot, "PC", "Test Game");
      await fs.mkdir(gameDir, { recursive: true });
      await fs.writeFile(path.join(gameDir, "game.exe"), "main");

      vi.mocked(storage.getGame).mockResolvedValue(
        makeGame({ libraryPath: gameDir }) as unknown as Awaited<ReturnType<typeof storage.getGame>>
      );
      vi.mocked(storage.getImportConfig).mockResolvedValue({
        libraryRoot,
      } as unknown as ImportConfig);

      const response = await request(app).get(`/api/games/${gameId}/files`);

      expect(response.status).toBe(200);
      expect(response.body.files).toHaveLength(1);
      expect(response.body.truncated).toBe(false);
    });

    it("stops the walk once the wall-clock budget is exhausted", async () => {
      const libraryRoot = path.join(tempRoot, "library");
      const gameDir = path.join(libraryRoot, "PC", "Test Game");
      await fs.mkdir(gameDir, { recursive: true });
      await fs.writeFile(path.join(gameDir, "game.exe"), "main");

      vi.mocked(storage.getGame).mockResolvedValue(
        makeGame({ libraryPath: gameDir }) as unknown as Awaited<ReturnType<typeof storage.getGame>>
      );
      vi.mocked(storage.getImportConfig).mockResolvedValue({
        libraryRoot,
      } as unknown as ImportConfig);
      // A zero (actually already-expired) budget trips the deadline
      // before the first entry is visited:
      setScanBudgets({ timeBudgetMs: -1 });

      const response = await request(app).get(`/api/games/${gameId}/files`);

      expect(response.status).toBe(200);
      expect(response.body.files).toEqual([]);
      expect(response.body.truncated).toBe(true);
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
          createdAt: new Date("2024-01-01T00:00:00.000Z"),
        } as GameFile,
      ]);

      const response = await request(app).get(`/api/games/${gameId}/content`);

      expect(response.status).toBe(200);
      const mainSlot = response.body.slots.find((s: { category: string }) => s.category === "main");
      expect(mainSlot.present).toBe(true);
      expect(mainSlot.files).toHaveLength(1);
      const dlcSlot = response.body.slots.find((s: { category: string }) => s.category === "dlc");
      expect(dlcSlot.present).toBe(false);
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
      vi.mocked(storage.addGameFile).mockResolvedValue({
        id: "gf-1",
        ...validBody,
        downloadId: null,
        fileSize: null,
        createdAt: new Date(),
      } as GameFile);

      const response = await request(app).post("/api/game-files").send(validBody);

      expect(response.status).toBe(201);
      expect(storage.addGameFile).toHaveBeenCalled();
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
