import { describe, it, expect, beforeEach, vi } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import type { User } from "../../shared/schema.js";

// ─── Hoisted mocks ───

vi.mock("better-sqlite3", () => ({
  default: vi.fn().mockImplementation(() => ({ pragma: vi.fn() })),
}));

vi.mock("../db.js", () => ({ pool: {}, db: {} }));
vi.mock("../db", () => ({
  pool: {},
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
  },
}));

vi.mock("../storage.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../storage.js")>();
  return {
    ...actual,
    storage: {
      getDownloadSummaryByGame: vi.fn().mockResolvedValue({}),
      getUserGames: vi.fn().mockResolvedValue([]),
      getUserGamesByStatus: vi.fn().mockResolvedValue([]),
      searchUserGames: vi.fn().mockResolvedValue([]),
      addGame: vi.fn(),
      removeGame: vi.fn(),
      getUser: vi.fn(),
      getUserByUsername: vi.fn(),
      countUsers: vi.fn().mockResolvedValue(1),
      registerSetupUser: vi.fn(),
      setSystemConfig: vi.fn(),
      getSystemConfig: vi.fn(),
      assignOrphanGamesToUser: vi.fn(),
      getUserSettings: vi.fn().mockResolvedValue({}),
      createUserSettings: vi.fn().mockResolvedValue({}),
      updateUserSettings: vi.fn().mockResolvedValue({}),
      updateGameStatus: vi.fn(),
      updateGameHidden: vi.fn(),
      updateUserPassword: vi.fn(),
      updateGamesBatch: vi.fn(),
      getAllGames: vi.fn().mockResolvedValue([]),
      getAllIndexers: vi.fn().mockResolvedValue([]),
      getEnabledIndexers: vi.fn().mockResolvedValue([]),
      getIndexer: vi.fn(),
      addIndexer: vi.fn(),
      updateIndexer: vi.fn(),
      removeIndexer: vi.fn(),
      getAllDownloaders: vi.fn().mockResolvedValue([]),
      getEnabledDownloaders: vi.fn().mockResolvedValue([]),
      getDownloader: vi.fn(),
      addDownloader: vi.fn(),
      updateDownloader: vi.fn(),
      removeDownloader: vi.fn(),
      getNotifications: vi.fn().mockResolvedValue([]),
      getUnreadNotificationsCount: vi.fn().mockResolvedValue(0),
      addNotification: vi.fn(),
      markNotificationAsRead: vi.fn(),
      markAllNotificationsAsRead: vi.fn(),
      syncIndexers: vi.fn().mockResolvedValue({ added: 0, updated: 0 }),
      addGameDownload: vi.fn(),
      getDownloadingGameDownloads: vi.fn().mockResolvedValue([]),
      updateGameDownloadStatus: vi.fn(),
      getAllRssFeeds: vi.fn().mockResolvedValue([]),
      addRssFeed: vi.fn(),
      updateRssFeed: vi.fn(),
      removeRssFeed: vi.fn(),
      getAllRssFeedItems: vi.fn().mockResolvedValue([]),
      updateUserSteamId: vi.fn(),
      addXrelNotifiedRelease: vi.fn(),
      hasXrelNotifiedRelease: vi.fn().mockResolvedValue(false),
      getGameIdsWithXrelReleases: vi.fn().mockResolvedValue([]),
      getWantedGamesGroupedByUser: vi.fn().mockResolvedValue(new Map()),
      getRssFeed: vi.fn(),
      getRssFeedItem: vi.fn(),
      getRssFeedItems: vi.fn().mockResolvedValue([]),
      getRssFeedItemByGuid: vi.fn(),
      addRssFeedItem: vi.fn(),
      updateRssFeedItem: vi.fn(),
      addNotificationsBatch: vi.fn().mockResolvedValue([]),
      getGame: vi.fn(),
      updateGame: vi.fn(),
    },
  };
});

vi.mock("../auth.js", async () => {
  const actual = await vi.importActual("../auth.js");
  return {
    ...actual,
    authenticateToken: (req: Request, res: Response, next: NextFunction) => {
      const auth = req.headers.authorization;
      if (!auth || !auth.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      (req as Request & { user: unknown }).user = {
        id: "user-1",
        username: "testuser",
      } as unknown as User;
      next();
    },
  };
});

vi.mock("../logger.js", () => ({
  routesLogger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  },
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  },
  downloadersLogger: {
    info: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  },
}));

vi.mock("../rss.js", () => ({
  rssService: {
    start: vi.fn(),
    stop: vi.fn(),
    refreshFeed: vi.fn().mockResolvedValue(undefined),
    refreshFeeds: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../torznab.js", () => ({
  torznabClient: {
    testConnection: vi.fn().mockResolvedValue({ success: true }),
    searchGames: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    getCategories: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../prowlarr.js", () => ({
  prowlarrClient: {
    getIndexers: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../xrel.js", () => ({
  xrelClient: {
    getLatestGames: vi.fn().mockResolvedValue({ list: [], total: 0 }),
    searchReleases: vi.fn().mockResolvedValue([]),
  },
  DEFAULT_XREL_BASE: "https://api.xrel.to",
  ALLOWED_XREL_DOMAINS: ["api.xrel.to"],
}));

vi.mock("../downloaders.js", () => ({
  DownloaderManager: {
    initialize: vi.fn(),
    testDownloader: vi.fn().mockResolvedValue({ success: true }),
    getAllDownloads: vi.fn().mockResolvedValue([]),
    getDownloadStatus: vi.fn(),
    getDownloadDetails: vi.fn(),
    addDownload: vi.fn().mockResolvedValue({ success: true }),
    addDownloadWithFallback: vi
      .fn()
      .mockResolvedValue({ success: true, id: "dl-1", downloaderId: "d-1" }),
    pauseDownload: vi.fn().mockResolvedValue({ success: true }),
    resumeDownload: vi.fn().mockResolvedValue({ success: true }),
    removeDownload: vi.fn().mockResolvedValue({ success: true }),
    getFreeSpace: vi.fn().mockResolvedValue(1000000000),
  },
}));

vi.mock("../steam-routes.js", () => ({
  steamRoutes: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../search.js", () => ({
  searchAllIndexers: vi.fn().mockResolvedValue({ items: [], total: 0, errors: [] }),
}));

vi.mock("../igdb.js", () => ({
  igdbClient: {
    searchGames: vi.fn().mockResolvedValue([]),
    formatGameData: vi.fn((game: unknown) => game),
    getPopularGames: vi.fn().mockResolvedValue([]),
    getRecentReleases: vi.fn().mockResolvedValue([]),
    getUpcomingReleases: vi.fn().mockResolvedValue([]),
    getRecommendations: vi.fn().mockResolvedValue([]),
    getGamesByGenre: vi.fn().mockResolvedValue([]),
    getGamesByPlatform: vi.fn().mockResolvedValue([]),
    getGenres: vi.fn().mockResolvedValue([]),
    getPlatforms: vi.fn().mockResolvedValue([]),
    getGameById: vi.fn(),
    getGamesByIds: vi.fn().mockResolvedValue([]),
    batchSearchGames: vi.fn().mockResolvedValue(new Map()),
  },
}));

vi.mock("../config.js", () => ({
  config: {
    server: { isProduction: false, allowedOrigins: [] },
    igdb: { isConfigured: false, clientId: "test-id", clientSecret: "test-secret" },
    auth: { jwtSecret: "test-secret" },
    database: { url: "test.db" },
    ssl: { enabled: false, port: 5000, certPath: "", keyPath: "", redirectHttp: false },
  },
}));

vi.mock("../config-loader.js", () => ({
  configLoader: {
    getSslConfig: vi.fn().mockReturnValue({
      enabled: false,
      port: 5000,
      certPath: "",
      keyPath: "",
      redirectHttp: false,
    }),
    saveConfig: vi.fn(),
    getConfigDir: vi.fn().mockReturnValue("/tmp/config"), // NOSONAR - test-only
  },
}));

vi.mock("../socket.js", () => ({
  notifyUser: vi.fn(),
}));

// ─── Imports after mocks ───
const { MemStorage } = await import("../storage.js");
const { registerRoutes } = await import("../routes.js");
const { storage } = await import("../storage.js");

import type { MemStorage as MemStorageType } from "../storage.js";
import type { InsertGameDownload, DownloadSummary } from "../../shared/schema.js";

const USER_ID = "test-user-1";

const makeDownload = (overrides: Partial<InsertGameDownload> = {}): InsertGameDownload => ({
  gameId: "game-1",
  downloaderId: "dl-1",
  downloadType: "torrent",
  downloadHash: "abc123",
  downloadTitle: "Test.Game-GROUP",
  status: "downloading",
  ...overrides,
});

// Seed game IDs that tests use directly into MemStorage's internal map (test-only).
function seedGames(memStorage: MemStorageType, gameIds: string[], userId: string = USER_ID): void {
  const gamesMap = (memStorage as unknown as { games: Map<string, { id: string; userId: string }> })
    .games;
  for (const id of gameIds) {
    gamesMap.set(id, { id, userId } as unknown as { id: string; userId: string });
  }
}

// ─── Storage unit tests ───
describe("getDownloadSummaryByGame (MemStorage)", () => {
  let memStorage: MemStorageType;

  beforeEach(() => {
    memStorage = new MemStorage();
    seedGames(memStorage, ["game-1", "game-2"]);
  });

  it("returns empty object when no downloads exist", async () => {
    const summary = await memStorage.getDownloadSummaryByGame(USER_ID);
    expect(summary).toEqual({});
  });

  it("returns correct singleton for a game with a single download", async () => {
    await memStorage.addGameDownload(
      makeDownload({ status: "downloading", downloadType: "torrent" })
    );
    const summary = await memStorage.getDownloadSummaryByGame(USER_ID);
    expect(summary["game-1"]).toEqual({
      topStatus: "downloading",
      count: 1,
      downloadTypes: ["torrent"],
      hasUpdateDownload: false,
    });
  });

  it("aggregates count correctly", async () => {
    await memStorage.addGameDownload(makeDownload({ downloadHash: "hash-1", status: "completed" }));
    await memStorage.addGameDownload(makeDownload({ downloadHash: "hash-2", status: "completed" }));
    await memStorage.addGameDownload(makeDownload({ downloadHash: "hash-3", status: "completed" }));
    const summary = await memStorage.getDownloadSummaryByGame(USER_ID);
    expect(summary["game-1"].count).toBe(3);
  });

  it("deduplicates downloadTypes", async () => {
    await memStorage.addGameDownload(
      makeDownload({ downloadHash: "hash-1", downloadType: "torrent" })
    );
    await memStorage.addGameDownload(
      makeDownload({ downloadHash: "hash-2", downloadType: "usenet" })
    );
    await memStorage.addGameDownload(
      makeDownload({ downloadHash: "hash-3", downloadType: "torrent" })
    );
    const summary = await memStorage.getDownloadSummaryByGame(USER_ID);
    expect(summary["game-1"].downloadTypes).toHaveLength(2);
    expect(summary["game-1"].downloadTypes).toContain("torrent");
    expect(summary["game-1"].downloadTypes).toContain("usenet");
  });

  it("resolves topStatus with correct priority: failed > downloading > paused > completed", async () => {
    await memStorage.addGameDownload(makeDownload({ downloadHash: "hash-1", status: "completed" }));
    expect((await memStorage.getDownloadSummaryByGame(USER_ID))["game-1"].topStatus).toBe(
      "completed"
    );

    await memStorage.addGameDownload(makeDownload({ downloadHash: "hash-2", status: "paused" }));
    expect((await memStorage.getDownloadSummaryByGame(USER_ID))["game-1"].topStatus).toBe("paused");

    await memStorage.addGameDownload(
      makeDownload({ downloadHash: "hash-3", status: "downloading" })
    );
    expect((await memStorage.getDownloadSummaryByGame(USER_ID))["game-1"].topStatus).toBe(
      "downloading"
    );

    await memStorage.addGameDownload(makeDownload({ downloadHash: "hash-4", status: "failed" }));
    expect((await memStorage.getDownloadSummaryByGame(USER_ID))["game-1"].topStatus).toBe("failed");
  });

  it("does not downgrade topStatus when a lower-priority status is added", async () => {
    await memStorage.addGameDownload(makeDownload({ downloadHash: "hash-1", status: "failed" }));
    expect((await memStorage.getDownloadSummaryByGame(USER_ID))["game-1"].topStatus).toBe("failed");

    await memStorage.addGameDownload(
      makeDownload({ downloadHash: "hash-2", status: "downloading" })
    );
    expect((await memStorage.getDownloadSummaryByGame(USER_ID))["game-1"].topStatus).toBe("failed");

    await memStorage.addGameDownload(makeDownload({ downloadHash: "hash-3", status: "paused" }));
    expect((await memStorage.getDownloadSummaryByGame(USER_ID))["game-1"].topStatus).toBe("failed");

    await memStorage.addGameDownload(makeDownload({ downloadHash: "hash-4", status: "completed" }));
    expect((await memStorage.getDownloadSummaryByGame(USER_ID))["game-1"].topStatus).toBe("failed");
  });

  it("handles multiple games independently", async () => {
    await memStorage.addGameDownload(
      makeDownload({ gameId: "game-1", downloadHash: "hash-1", status: "downloading" })
    );
    await memStorage.addGameDownload(
      makeDownload({
        gameId: "game-2",
        downloadHash: "hash-2",
        status: "failed",
        downloadType: "usenet",
      })
    );
    const summary = await memStorage.getDownloadSummaryByGame(USER_ID);
    expect(summary["game-1"].topStatus).toBe("downloading");
    expect(summary["game-2"].topStatus).toBe("failed");
    expect(Object.keys(summary)).toHaveLength(2);
  });

  it("sets hasUpdateDownload when a download title matches update patterns", async () => {
    await memStorage.addGameDownload(
      makeDownload({ downloadHash: "hash-main", downloadTitle: "Test.Game-GROUP" })
    );
    await memStorage.addGameDownload(
      makeDownload({ downloadHash: "hash-upd", downloadTitle: "Test.Game.Update.v2-GROUP" })
    );
    const summary = await memStorage.getDownloadSummaryByGame(USER_ID);
    expect(summary["game-1"].hasUpdateDownload).toBe(true);
  });

  it("leaves hasUpdateDownload false when no update title exists", async () => {
    await memStorage.addGameDownload(
      makeDownload({ downloadHash: "hash-1", downloadTitle: "Test.Game-GROUP" })
    );
    await memStorage.addGameDownload(
      makeDownload({ downloadHash: "hash-2", downloadTitle: "Test.Game-DLC-GROUP" })
    );
    const summary = await memStorage.getDownloadSummaryByGame(USER_ID);
    expect(summary["game-1"].hasUpdateDownload).toBe(false);
  });
});

// ─── Integration tests ───
describe("GET /api/downloads/summary", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    await registerRoutes(app);
    // Reset default mock
    vi.mocked(storage.getDownloadSummaryByGame).mockResolvedValue({});
  });

  it("returns 401 without auth token", async () => {
    const res = await request(app).get("/api/downloads/summary");
    expect(res.status).toBe(401);
  });

  it("returns {} when no downloads exist", async () => {
    vi.mocked(storage.getDownloadSummaryByGame).mockResolvedValue({});
    const res = await request(app)
      .get("/api/downloads/summary")
      .set("Authorization", "Bearer mock-token");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({});
  });

  it("returns correct summary map when downloads exist", async () => {
    const mockSummary: Record<string, DownloadSummary> = {
      "game-1": {
        topStatus: "downloading",
        count: 2,
        downloadTypes: ["torrent"],
        hasUpdateDownload: false,
      },
      "game-2": {
        topStatus: "completed",
        count: 1,
        downloadTypes: ["usenet"],
        hasUpdateDownload: false,
      },
    };
    vi.mocked(storage.getDownloadSummaryByGame).mockResolvedValue(mockSummary);
    const res = await request(app)
      .get("/api/downloads/summary")
      .set("Authorization", "Bearer mock-token");
    expect(res.status).toBe(200);
    expect(res.body["game-1"].topStatus).toBe("downloading");
    expect(res.body["game-1"].count).toBe(2);
    expect(res.body["game-2"].topStatus).toBe("completed");
  });
});
