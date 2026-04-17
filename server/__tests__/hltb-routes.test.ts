import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import { registerRoutes } from "../routes.js";
import { type User } from "../../shared/schema.js";

// ── Hoisted mocks ────────────────────────────────────────────────────────────

const { mockConfig } = vi.hoisted(() => ({
  mockConfig: {
    server: { isProduction: false, allowedOrigins: [] },
    igdb: { isConfigured: false },
    auth: { jwtSecret: "test-secret" },
    database: { url: "test.db" },
    ssl: { enabled: false, port: 5000, certPath: "", keyPath: "", redirectHttp: false },
  },
}));

vi.mock("../config.js", () => ({ config: mockConfig }));

vi.mock("../storage.js", () => ({
  storage: {
    getSystemConfig: vi.fn(),
    setSystemConfig: vi.fn(),
    getUserGames: vi.fn().mockResolvedValue([]),
    getUserGamesByStatus: vi.fn().mockResolvedValue([]),
    searchUserGames: vi.fn().mockResolvedValue([]),
    addGame: vi.fn(),
    removeGame: vi.fn(),
    getUser: vi.fn(),
    getUserByUsername: vi.fn(),
    countUsers: vi.fn().mockResolvedValue(1),
    registerSetupUser: vi.fn(),
    assignOrphanGamesToUser: vi.fn(),
    getUserSettings: vi.fn().mockResolvedValue({}),
    createUserSettings: vi.fn().mockResolvedValue({}),
    updateUserSettings: vi.fn().mockResolvedValue({}),
    updateGameStatus: vi.fn(),
    updateGameHidden: vi.fn(),
    updateGameUserRating: vi.fn(),
    updateGameSearchResultsAvailable: vi.fn().mockResolvedValue(undefined),
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
    clearAllNotifications: vi.fn(),
    syncIndexers: vi.fn().mockResolvedValue({ added: 0, updated: 0 }),
    addGameDownload: vi.fn(),
    getDownloadsByGameId: vi.fn().mockResolvedValue([]),
    getDownloadSummaryByGame: vi.fn().mockResolvedValue({}),
    getTrackedDownloadKeys: vi.fn().mockResolvedValue(new Set()),
    getAllRssFeeds: vi.fn().mockResolvedValue([]),
    addRssFeed: vi.fn(),
    updateRssFeed: vi.fn(),
    removeRssFeed: vi.fn(),
    getAllRssFeedItems: vi.fn().mockResolvedValue([]),
    updateUserSteamId: vi.fn(),
    getGame: vi.fn(),
    addReleaseBlacklist: vi.fn(),
    getReleaseBlacklist: vi.fn().mockResolvedValue([]),
    getAllReleaseBlacklists: vi.fn().mockResolvedValue([]),
    removeReleaseBlacklist: vi.fn(),
    getReleaseBlacklistSet: vi.fn().mockResolvedValue(new Set()),
  },
}));

vi.mock("../auth.js", async () => {
  const actual = await vi.importActual("../auth.js");
  return {
    ...actual,
    authenticateToken: (req: Request, _res: Response, next: NextFunction) => {
      (req as Request).user = { id: "user-1", username: "testuser" } as unknown as User;
      next();
    },
    generateToken: vi.fn().mockResolvedValue("mock-token"),
    comparePassword: vi.fn().mockResolvedValue(true),
    hashPassword: vi.fn().mockResolvedValue("hashed-password"),
  };
});

vi.mock("../nexusmods.js", () => ({
  nexusmodsClient: {
    isConfigured: vi.fn().mockReturnValue(false),
    configure: vi.fn(),
    findGameDomain: vi.fn().mockResolvedValue(null),
    getTrendingMods: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../hltb.js", () => ({
  hltbClient: {
    lookup: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock("../igdb.js", () => ({
  igdbClient: {
    searchGames: vi.fn().mockResolvedValue([]),
    formatGameData: vi.fn((g) => g),
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

vi.mock("../logger.js", () => ({
  routesLogger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  },
  logger: { info: vi.fn(), error: vi.fn(), child: vi.fn().mockReturnThis() },
  downloadersLogger: { info: vi.fn(), error: vi.fn(), child: vi.fn().mockReturnThis() },
}));

vi.mock("../db.js", () => ({
  db: { select: vi.fn(), from: vi.fn(), where: vi.fn(), get: vi.fn() },
}));
vi.mock("../rss.js", () => ({
  rssService: { start: vi.fn(), stop: vi.fn(), refreshFeed: vi.fn(), refreshFeeds: vi.fn() },
}));
vi.mock("../torznab.js", () => ({
  torznabClient: {
    testConnection: vi.fn().mockResolvedValue({ success: true }),
    searchGames: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    getCategories: vi.fn().mockResolvedValue([]),
  },
}));
vi.mock("../prowlarr.js", () => ({
  prowlarrClient: { getIndexers: vi.fn().mockResolvedValue([]) },
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
  filterBlacklistedReleases: (items: unknown[]) => items,
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
    getConfigDir: vi.fn().mockReturnValue("/tmp/config"),
  },
}));
vi.mock("../socket.js", () => ({ notifyUser: vi.fn() }));
vi.mock("../ssrf.js", () => ({ isSafeUrl: vi.fn().mockResolvedValue(true), safeFetch: vi.fn() }));

// ── Tests ────────────────────────────────────────────────────────────────────

describe("HLTB Routes", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    await registerRoutes(app);
  });

  async function getHltbMock() {
    const mod = await import("../hltb.js");
    return mod.hltbClient;
  }

  describe("GET /api/hltb/lookup", () => {
    it("returns { data: null } when no match is found", async () => {
      const hltbMock = await getHltbMock();
      vi.mocked(hltbMock.lookup).mockResolvedValue(null);

      const res = await request(app).get("/api/hltb/lookup").query({ title: "UnknownGame" });

      expect(res.status).toBe(200);
      expect(res.body.data).toBeNull();
    });

    it("returns entry data when a match is found", async () => {
      const hltbMock = await getHltbMock();
      const mockEntry = {
        id: 36936,
        name: "Nioh",
        gameplayMain: 35,
        gameplayMainExtra: 61,
        gameplayCompletionist: 94,
        url: "https://howlongtobeat.com/game/36936",
      };
      vi.mocked(hltbMock.lookup).mockResolvedValue(mockEntry);

      const res = await request(app).get("/api/hltb/lookup").query({ title: "Nioh" });

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        id: 36936,
        name: "Nioh",
        gameplayMain: 35,
        url: "https://howlongtobeat.com/game/36936",
      });
    });

    it("returns 400 when title param is missing", async () => {
      const res = await request(app).get("/api/hltb/lookup");
      expect(res.status).toBe(400);
    });

    it("returns 400 when title param is empty string", async () => {
      const res = await request(app).get("/api/hltb/lookup").query({ title: "" });
      expect(res.status).toBe(400);
    });

    it("calls hltbClient.lookup with the provided title", async () => {
      const hltbMock = await getHltbMock();
      vi.mocked(hltbMock.lookup).mockResolvedValue(null);

      await request(app).get("/api/hltb/lookup").query({ title: "The Witcher 3" });

      expect(hltbMock.lookup).toHaveBeenCalledWith("The Witcher 3");
    });

    it("returns 500 when hltbClient.lookup throws", async () => {
      const hltbMock = await getHltbMock();
      vi.mocked(hltbMock.lookup).mockRejectedValue(new Error("Internal error"));

      const res = await request(app).get("/api/hltb/lookup").query({ title: "Nioh" });

      expect(res.status).toBe(500);
      expect(res.body.error).toBeDefined();
    });
  });
});
