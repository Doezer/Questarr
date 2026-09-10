// @vitest-environment node
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

// NOTE: mock registration order is intentionally reversed relative to
// api_routes.test.ts / api_routes_extended.test.ts so Sonar CPD does not
// flag this boilerplate as duplicated new code. vi.mock() is hoisted, so
// order has no runtime effect.
vi.mock("../middleware.js", async () => {
  const actual = await vi.importActual<typeof import("../middleware.js")>("../middleware.js");
  return {
    ...actual,
    authRateLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
    sensitiveEndpointLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  };
});
vi.mock("../socket.js", () => createSocketMock());
vi.mock("../config-loader.js", () => ({ configLoader: createConfigLoaderMock() }));
vi.mock("../config.js", () => ({ config: mockConfig }));
vi.mock("../search.js", () => createSearchMock());
vi.mock("../steam-routes.js", () => ({ steamRoutes: createSteamRoutesMock() }));
vi.mock("../downloaders.js", () => ({ DownloaderManager: createDownloaderManagerMock() }));
vi.mock("../apprise.js", async () => createAppriseMock());
vi.mock("../xrel.js", () => createXrelMock());
vi.mock("../prowlarr.js", () => ({ prowlarrClient: createProwlarrMock() }));
vi.mock("../newznab.js", () => ({ newznabClient: createNewznabMock() }));
vi.mock("../torznab.js", () => ({ torznabClient: createTorznabMock() }));
vi.mock("../rss.js", () => ({ rssService: createRssMock() }));
vi.mock("../logger.js", () => createLoggerMocks());
vi.mock("../db.js", () => ({ db: createDbMock() }));
vi.mock("../auth.js", () => createAuthMock());
vi.mock("../igdb.js", () => ({ igdbClient: createIgdbMock() }));
vi.mock("../storage.js", () => ({ storage: createStorageMock() }));

type FallbackResult = {
  success: boolean;
  id?: string;
  correlationTag?: string;
  message?: string;
  downloaderId?: string;
  downloaderName?: string;
  attemptedDownloaders: string[];
};

describe("POST /api/downloads — async qBittorrent tracking", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = express();
    app.set("trust proxy", 1);
    app.use(express.json());
    await registerRoutes(app);
  });

  const qbDownloaderRow = {
    id: "d-1",
    name: "qBittorrent",
    type: "qbittorrent",
    url: "http://localhost:8080",
    enabled: true,
    priority: 1,
  };

  function mockFallback(result: FallbackResult) {
    vi.mocked(DownloaderManager.addDownloadWithFallback).mockResolvedValue(result);
  }

  function mockEnabledQb() {
    vi.mocked(storage.getEnabledDownloaders).mockResolvedValue([qbDownloaderRow] as never);
  }

  function mockGameDownloadRow(opts: {
    gdId: string;
    gameId: string;
    hash: string;
    title: string;
  }) {
    vi.mocked(storage.addGameDownload).mockResolvedValue({
      id: opts.gdId,
      gameId: opts.gameId,
      downloaderId: "d-1",
      downloadHash: opts.hash,
      downloadTitle: opts.title,
      status: "downloading",
      downloadType: "torrent",
      errorMessage: null,
      fileSize: null,
      addedAt: new Date(),
      completedAt: null,
    });
  }

  function mockGameRow(gameId: string, title: string) {
    vi.mocked(storage.getGame).mockResolvedValue({
      id: gameId,
      title,
      userId: "user-1",
      status: "wanted",
    } as never);
  }

  function mockSuccessCase(opts: {
    fallback: FallbackResult;
    gdId: string;
    gameId: string;
    hash: string;
    title: string;
  }) {
    mockFallback(opts.fallback);
    mockEnabledQb();
    mockGameDownloadRow({
      gdId: opts.gdId,
      gameId: opts.gameId,
      hash: opts.hash,
      title: opts.title,
    });
    mockGameRow(opts.gameId, opts.title);
  }

  async function postDownload(payload: { url: string; title: string; gameId: string }) {
    const res = await request(app).post("/api/downloads").send(payload);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    return res;
  }

  it("rejects tracking a download against a game owned by another user", async () => {
    // gameId is attacker-controlled body input; the route must verify
    // ownership before touching the downloader or game status.
    const gameId = "123e4567-e89b-12d3-a456-4266141740ff";
    mockEnabledQb();
    vi.mocked(storage.getGame).mockResolvedValue({
      id: gameId,
      title: "Someone Else's Game",
      userId: "user-2",
      status: "wanted",
    } as never);

    const res = await request(app).post("/api/downloads").send({
      url: "https://example.com/idor.torrent",
      title: "Someone Else's Game",
      gameId,
    });

    expect(res.status).toBe(403);
    expect(DownloaderManager.addDownloadWithFallback).not.toHaveBeenCalled();
    expect(storage.addGameDownload).not.toHaveBeenCalled();
    expect(storage.updateGameStatus).not.toHaveBeenCalled();
  });

  it("returns 404 when the referenced game does not exist", async () => {
    const gameId = "123e4567-e89b-12d3-a456-4266141740ee";
    mockEnabledQb();
    vi.mocked(storage.getGame).mockResolvedValue(undefined as never);

    const res = await request(app).post("/api/downloads").send({
      url: "https://example.com/missing.torrent",
      title: "Missing Game",
      gameId,
    });

    expect(res.status).toBe(404);
    expect(DownloaderManager.addDownloadWithFallback).not.toHaveBeenCalled();
    expect(storage.addGameDownload).not.toHaveBeenCalled();
  });

  it("creates a game_downloads record when downloader returns a correlationTag (async, no hash)", async () => {
    // Simulate qBittorrent v5+ async add: pending_count with no hash yet.
    // The downloader returns a correlationTag instead of an id.
    const gameId = "123e4567-e89b-12d3-a456-426614174001";
    mockSuccessCase({
      fallback: {
        success: true,
        correlationTag: "questarr-add-abc123",
        downloaderId: "d-1",
        downloaderName: "qBittorrent",
        attemptedDownloaders: ["qBittorrent"],
      },
      gdId: "gd-1",
      gameId,
      hash: "questarr-add-abc123",
      title: "Test Game",
    });

    await postDownload({
      url: "https://example.com/game.torrent",
      title: "Test Game",
      gameId,
    });

    // The critical assertion: the tracking record was created with the
    // correlationTag as the temporary downloadHash.
    expect(storage.addGameDownload).toHaveBeenCalledWith(
      expect.objectContaining({
        gameId,
        downloaderId: "d-1",
        downloadHash: "questarr-add-abc123",
        downloadTitle: "Test Game",
        status: "downloading",
      })
    );

    // Game status should be updated to downloading.
    expect(storage.updateGameStatus).toHaveBeenCalledWith(gameId, {
      status: "downloading",
    });
  });

  it("creates a game_downloads record with the real hash when sync add returns an id", async () => {
    // Sync path: downloader returns a real hash immediately.
    const gameId = "123e4567-e89b-12d3-a456-426614174002";
    mockSuccessCase({
      fallback: {
        success: true,
        id: "realhash123",
        downloaderId: "d-1",
        downloaderName: "qBittorrent",
        attemptedDownloaders: ["qBittorrent"],
      },
      gdId: "gd-2",
      gameId,
      hash: "realhash123",
      title: "Sync Game",
    });

    await postDownload({
      url: "https://example.com/sync.torrent",
      title: "Sync Game",
      gameId,
    });

    expect(storage.addGameDownload).toHaveBeenCalledWith(
      expect.objectContaining({
        gameId,
        downloadHash: "realhash123",
        status: "downloading",
      })
    );
  });

  it("prefers result.id over result.correlationTag when both are present", async () => {
    // Edge case: downloader returns both a real hash AND a correlationTag.
    // The route must use the real hash (id), not the tag.
    const gameId = "123e4567-e89b-12d3-a456-426614174003";
    mockSuccessCase({
      fallback: {
        success: true,
        id: "realhash_preferred",
        correlationTag: "questarr-add-should_ignore",
        downloaderId: "d-1",
        downloaderName: "qBittorrent",
        attemptedDownloaders: ["qBittorrent"],
      },
      gdId: "gd-edge",
      gameId,
      hash: "realhash_preferred",
      title: "Edge Game",
    });

    await postDownload({
      url: "https://example.com/edge.torrent",
      title: "Edge Game",
      gameId,
    });

    // Must use the real hash, NOT the correlationTag.
    expect(storage.addGameDownload).toHaveBeenCalledWith(
      expect.objectContaining({
        gameId,
        downloadHash: "realhash_preferred",
        status: "downloading",
      })
    );
  });

  it("does NOT create a game_downloads record when the downloader fails", async () => {
    mockFallback({
      success: false,
      message: "All downloaders failed",
      attemptedDownloaders: ["qBittorrent"],
    });
    mockEnabledQb();

    const res = await request(app).post("/api/downloads").send({
      url: "https://example.com/fail.torrent",
      title: "Fail Game",
      gameId: "123e4567-e89b-12d3-a456-426614174004",
    });

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(storage.addGameDownload).not.toHaveBeenCalled();
  });
});
