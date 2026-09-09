import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
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
import { DownloaderManager } from "../downloaders.js";

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
vi.mock("../config.js", () => ({ config: mockConfig }));
vi.mock("../config-loader.js", () => ({ configLoader: createConfigLoaderMock() }));
vi.mock("../socket.js", () => createSocketMock());
vi.mock("../middleware.js", async () => {
  const actual = await vi.importActual<typeof import("../middleware.js")>("../middleware.js");
  return {
    ...actual,
    sensitiveEndpointLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
    authRateLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  };
});

describe("POST /api/downloads — async qBittorrent tracking", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = express();
    app.set("trust proxy", 1);
    app.use(express.json());
    await registerRoutes(app);
  });

  it("creates a game_downloads record when downloader returns a correlationTag (async, no hash)", async () => {
    // Simulate qBittorrent v5+ async add: pending_count with no hash yet.
    // The downloader returns a correlationTag instead of an id.
    vi.mocked(DownloaderManager.addDownloadWithFallback).mockResolvedValue({
      success: true,
      correlationTag: "questarr-add-abc123",
      downloaderId: "d-1",
      downloaderName: "qBittorrent",
      attemptedDownloaders: ["qBittorrent"],
    });
    vi.mocked(storage.getEnabledDownloaders).mockResolvedValue([
      {
        id: "d-1",
        name: "qBittorrent",
        type: "qbittorrent",
        url: "http://localhost:8080",
        enabled: true,
        priority: 1,
      } as any,
    ]);
    vi.mocked(storage.addGameDownload).mockResolvedValue({
      id: "gd-1",
      gameId: "game-1",
      downloaderId: "d-1",
      downloadHash: "questarr-add-abc123",
      downloadTitle: "Test Game",
      status: "downloading",
      downloadType: "torrent",
      errorMessage: null,
      fileSize: null,
      addedAt: new Date(),
      completedAt: null,
    });
    vi.mocked(storage.getGame).mockResolvedValue({
      id: "game-1",
      title: "Test Game",
      userId: "user-1",
      status: "wanted",
    } as any);

    const res = await request(app).post("/api/downloads").send({
      url: "https://example.com/game.torrent",
      title: "Test Game",
      gameId: "game-1",
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // The critical assertion: the tracking record was created with the
    // correlationTag as the temporary downloadHash.
    expect(storage.addGameDownload).toHaveBeenCalledWith(
      expect.objectContaining({
        gameId: "game-1",
        downloaderId: "d-1",
        downloadHash: "questarr-add-abc123",
        downloadTitle: "Test Game",
        status: "downloading",
      })
    );

    // Game status should be updated to downloading.
    expect(storage.updateGameStatus).toHaveBeenCalledWith("game-1", { status: "downloading" });
  });

  it("creates a game_downloads record with the real hash when sync add returns an id", async () => {
    // Sync path: downloader returns a real hash immediately.
    vi.mocked(DownloaderManager.addDownloadWithFallback).mockResolvedValue({
      success: true,
      id: "realhash123",
      downloaderId: "d-1",
      downloaderName: "qBittorrent",
      attemptedDownloaders: ["qBittorrent"],
    });
    vi.mocked(storage.getEnabledDownloaders).mockResolvedValue([
      {
        id: "d-1",
        name: "qBittorrent",
        type: "qbittorrent",
        url: "http://localhost:8080",
        enabled: true,
        priority: 1,
      } as any,
    ]);
    vi.mocked(storage.addGameDownload).mockResolvedValue({
      id: "gd-2",
      gameId: "game-2",
      downloaderId: "d-1",
      downloadHash: "realhash123",
      downloadTitle: "Sync Game",
      status: "downloading",
      downloadType: "torrent",
      errorMessage: null,
      fileSize: null,
      addedAt: new Date(),
      completedAt: null,
    });
    vi.mocked(storage.getGame).mockResolvedValue({
      id: "game-2",
      title: "Sync Game",
      userId: "user-1",
      status: "wanted",
    } as any);

    const res = await request(app).post("/api/downloads").send({
      url: "https://example.com/sync.torrent",
      title: "Sync Game",
      gameId: "game-2",
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    expect(storage.addGameDownload).toHaveBeenCalledWith(
      expect.objectContaining({
        gameId: "game-2",
        downloadHash: "realhash123",
        status: "downloading",
      })
    );
  });

  it("does NOT create a game_downloads record when the downloader fails", async () => {
    vi.mocked(DownloaderManager.addDownloadWithFallback).mockResolvedValue({
      success: false,
      message: "All downloaders failed",
      attemptedDownloaders: ["qBittorrent"],
    });
    vi.mocked(storage.getEnabledDownloaders).mockResolvedValue([
      {
        id: "d-1",
        name: "qBittorrent",
        type: "qbittorrent",
        url: "http://localhost:8080",
        enabled: true,
        priority: 1,
      } as any,
    ]);

    const res = await request(app).post("/api/downloads").send({
      url: "https://example.com/fail.torrent",
      title: "Fail Game",
      gameId: "game-3",
    });

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(storage.addGameDownload).not.toHaveBeenCalled();
  });
});
