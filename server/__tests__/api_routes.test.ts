import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import { registerRoutes, parseCategories } from "../routes.js";
import { storage } from "../storage.js";
import { igdbClient, type IGDBGame } from "../igdb.js";
import { type Game, type User, type Indexer, type Downloader } from "../../shared/schema.js";
import { DownloaderManager } from "../downloaders.js";
import { torznabClient } from "../torznab.js";
import { rssService } from "../rss.js";
import { prowlarrClient } from "../prowlarr.js";

// Use vi.hoisted to create the mock object
const { mockConfig } = vi.hoisted(() => {
  return {
    mockConfig: {
      server: {
        isProduction: false,
        allowedOrigins: [],
      },
      igdb: {
        isConfigured: true,
        clientId: "test-id",
        clientSecret: "test-secret",
      },
      auth: {
        jwtSecret: "test-secret",
      },
      database: {
        url: "test.db",
      },
      ssl: {
        enabled: false,
        port: 5000,
        certPath: "",
        keyPath: "",
        redirectHttp: false,
      },
    },
  };
});

// Mock dependencies
vi.mock("../storage.js", () => ({
  storage: {
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
    clearAllNotifications: vi.fn(),
    syncIndexers: vi.fn().mockResolvedValue({ added: 0, updated: 0 }),
    addGameDownload: vi.fn(),
    getAllRssFeeds: vi.fn().mockResolvedValue([]),
    addRssFeed: vi.fn(),
    updateRssFeed: vi.fn(),
    removeRssFeed: vi.fn(),
    getAllRssFeedItems: vi.fn().mockResolvedValue([]),
    updateUserSteamId: vi.fn(),
  },
}));

vi.mock("../igdb.js", () => ({
  igdbClient: {
    searchGames: vi.fn().mockResolvedValue([]),
    formatGameData: vi.fn((game) => game),
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

vi.mock("../auth.js", async () => {
  const actual = await vi.importActual("../auth.js");
  return {
    ...actual,
    authenticateToken: (req: Request, res: Response, next: NextFunction) => {
      (req as Request).user = { id: "user-1", username: "testuser" } as unknown as User;
      next();
    },
    generateToken: vi.fn().mockResolvedValue("mock-token"),
    comparePassword: vi.fn().mockResolvedValue(true),
    hashPassword: vi.fn().mockResolvedValue("hashed-password"),
  };
});

vi.mock("../db.js", () => ({
  db: {
    select: vi.fn(),
    from: vi.fn(),
    where: vi.fn(),
    get: vi.fn(),
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
  ALLOWED_XREL_DOMAINS: ["api.xrel.to", "xrel-api.nfos.to"],
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

vi.mock("../config.js", () => ({
  config: mockConfig,
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

vi.mock("../socket.js", () => ({
  notifyUser: vi.fn(),
}));

describe("API Routes - Extended Coverage", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    await registerRoutes(app);
  });

  // ─── parseCategories helper ───
  describe("parseCategories", () => {
    it("should return undefined for falsy input", () => {
      expect(parseCategories(null)).toBeUndefined();
      expect(parseCategories(undefined)).toBeUndefined();
      expect(parseCategories("")).toBeUndefined();
    });

    it("should parse comma-separated string", () => {
      expect(parseCategories("1000,2000,3000")).toEqual(["1000", "2000", "3000"]);
    });

    it("should parse array input", () => {
      expect(parseCategories(["1000", "2000"])).toEqual(["1000", "2000"]);
    });

    it("should filter empty strings", () => {
      expect(parseCategories("1000,,2000")).toEqual(["1000", "2000"]);
    });

    it("should return undefined for non-string/non-array input", () => {
      expect(parseCategories(12345)).toBeUndefined();
    });
  });

  // ─── Auth routes ───
  describe("Auth routes", () => {
    describe("GET /api/auth/status", () => {
      it("should return hasUsers true when users exist", async () => {
        vi.mocked(storage.countUsers).mockResolvedValue(1);
        const res = await request(app).get("/api/auth/status");
        expect(res.status).toBe(200);
        expect(res.body.hasUsers).toBe(true);
      });

      it("should return hasUsers false when no users", async () => {
        vi.mocked(storage.countUsers).mockResolvedValue(0);
        const res = await request(app).get("/api/auth/status");
        expect(res.status).toBe(200);
        expect(res.body.hasUsers).toBe(false);
      });

      it("should return 500 on error", async () => {
        vi.mocked(storage.countUsers).mockRejectedValue(new Error("DB error"));
        const res = await request(app).get("/api/auth/status");
        expect(res.status).toBe(500);
      });
    });

    describe("POST /api/auth/setup", () => {
      it("should return 403 when users already exist", async () => {
        vi.mocked(storage.countUsers).mockResolvedValue(1);
        const res = await request(app)
          .post("/api/auth/setup")
          .send({ username: "admin", password: "password123" });
        expect(res.status).toBe(403);
      });

      it("should create first user and return token", async () => {
        vi.mocked(storage.countUsers).mockResolvedValue(0);
        vi.mocked(storage.registerSetupUser).mockResolvedValue({
          id: "user-1",
          username: "admin",
        } as any);

        const res = await request(app)
          .post("/api/auth/setup")
          .send({ username: "admin", password: "password123" });

        expect(res.status).toBe(200);
        expect(res.body.token).toBe("mock-token");
        expect(res.body.user.username).toBe("admin");
      });

      it("should return 400 for missing username", async () => {
        vi.mocked(storage.countUsers).mockResolvedValue(0);
        const res = await request(app).post("/api/auth/setup").send({ password: "password123" });
        expect(res.status).toBe(400);
      });

      it("should return 400 for short username", async () => {
        vi.mocked(storage.countUsers).mockResolvedValue(0);
        const res = await request(app)
          .post("/api/auth/setup")
          .send({ username: "ab", password: "password123" });
        expect(res.status).toBe(400);
        expect(res.body.error).toContain("at least 3 characters");
      });

      it("should return 400 for short password", async () => {
        vi.mocked(storage.countUsers).mockResolvedValue(0);
        const res = await request(app)
          .post("/api/auth/setup")
          .send({ username: "admin", password: "12345" });
        expect(res.status).toBe(400);
        expect(res.body.error).toContain("at least 6 characters");
      });

      it("should return 400 for too-long username", async () => {
        vi.mocked(storage.countUsers).mockResolvedValue(0);
        const res = await request(app)
          .post("/api/auth/setup")
          .send({ username: "a".repeat(51), password: "password123" });
        expect(res.status).toBe(400);
        expect(res.body.error).toContain("at most 50 characters");
      });

      it("should return 400 for non-string types", async () => {
        vi.mocked(storage.countUsers).mockResolvedValue(0);
        const res = await request(app)
          .post("/api/auth/setup")
          .send({ username: 123, password: "password123" });
        expect(res.status).toBe(400);
      });

      it("should save IGDB credentials if provided", async () => {
        vi.mocked(storage.countUsers).mockResolvedValue(0);
        vi.mocked(storage.registerSetupUser).mockResolvedValue({
          id: "user-1",
          username: "admin",
        } as any);

        const res = await request(app).post("/api/auth/setup").send({
          username: "admin",
          password: "password123",
          igdbClientId: "igdb-id",
          igdbClientSecret: "igdb-secret",
        });

        expect(res.status).toBe(200);
        expect(storage.setSystemConfig).toHaveBeenCalledWith("igdb.clientId", "igdb-id");
        expect(storage.setSystemConfig).toHaveBeenCalledWith("igdb.clientSecret", "igdb-secret");
      });

      it("should handle duplicative setup race condition", async () => {
        vi.mocked(storage.countUsers).mockResolvedValue(0);
        vi.mocked(storage.registerSetupUser).mockRejectedValue(
          new Error("Setup already completed")
        );

        const res = await request(app)
          .post("/api/auth/setup")
          .send({ username: "admin", password: "password123" });
        expect(res.status).toBe(403);
      });
    });

    describe("GET /api/auth/me", () => {
      it("should return current user info", async () => {
        const res = await request(app).get("/api/auth/me");
        expect(res.status).toBe(200);
        expect(res.body.id).toBe("user-1");
        expect(res.body.username).toBe("testuser");
      });
    });
  });

  // ─── Health check ───
  describe("GET /api/health", () => {
    it("should return ok", async () => {
      const res = await request(app).get("/api/health");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ok");
    });
  });

  // ─── Game routes ───
  describe("GET /api/games", () => {
    it("should return user games", async () => {
      const mockGames = [{ id: "game-1", title: "Test Game", userId: "user-1" }];
      vi.mocked(storage.getUserGames).mockResolvedValue(mockGames as unknown as Game[]);

      const response = await request(app).get("/api/games");

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockGames);
    });

    it("should handle search query", async () => {
      const mockGames = [{ id: "game-1", title: "Test Game", userId: "user-1" }];
      vi.mocked(storage.searchUserGames).mockResolvedValue(mockGames as unknown as Game[]);

      const response = await request(app).get("/api/games?search=Test");
      expect(response.status).toBe(200);
      expect(storage.searchUserGames).toHaveBeenCalledWith("user-1", "Test", false);
    });

    it("should handle status filter", async () => {
      vi.mocked(storage.getUserGames).mockResolvedValue([]);
      const response = await request(app).get("/api/games?status=wanted");
      expect(response.status).toBe(200);
      expect(storage.getUserGames).toHaveBeenCalledWith("user-1", false, ["wanted"]);
    });

    it("should handle includeHidden flag", async () => {
      vi.mocked(storage.getUserGames).mockResolvedValue([]);
      const response = await request(app).get("/api/games?includeHidden=true");
      expect(response.status).toBe(200);
      expect(storage.getUserGames).toHaveBeenCalledWith("user-1", true, undefined);
    });

    it("should return 500 on error", async () => {
      vi.mocked(storage.getUserGames).mockRejectedValue(new Error("DB error"));
      const response = await request(app).get("/api/games");
      expect(response.status).toBe(500);
    });
  });

  describe("GET /api/games/status/:status", () => {
    it("should return games by status", async () => {
      vi.mocked(storage.getUserGamesByStatus).mockResolvedValue([]);
      const response = await request(app).get("/api/games/status/wanted");
      expect(response.status).toBe(200);
    });
  });

  describe("POST /api/games", () => {
    it("should add a new game", async () => {
      const newGame = { title: "New Game", igdbId: 12345, platform: "PC" };
      const savedGame = { ...newGame, id: "game-new", userId: "user-1" };

      vi.mocked(storage.getUserGames).mockResolvedValue([]);
      vi.mocked(storage.addGame).mockResolvedValue(savedGame as unknown as Game);

      const response = await request(app).post("/api/games").send(newGame);
      expect(response.status).toBe(201);
      expect(response.body).toEqual(savedGame);
    });

    it("should prevent duplicate games", async () => {
      const gameData = { title: "Dup Game", igdbId: 100, platform: "PC" };
      const existingGame = { ...gameData, id: "game-100", userId: "user-1" };
      vi.mocked(storage.getUserGames).mockResolvedValue([existingGame as unknown as Game]);

      const response = await request(app).post("/api/games").send(gameData);
      expect(response.status).toBe(409);
    });
  });

  describe("PATCH /api/games/:id/status", () => {
    it("should update game status", async () => {
      const gameId = "123e4567-e89b-12d3-a456-426614174000";
      const updatedGame = { id: gameId, status: "completed" };
      vi.mocked(storage.updateGameStatus).mockResolvedValue(updatedGame as unknown as Game);

      const response = await request(app)
        .patch(`/api/games/${gameId}/status`)
        .send({ status: "completed" });
      expect(response.status).toBe(200);
    });

    it("should return 404 for non-existent game", async () => {
      const gameId = "123e4567-e89b-12d3-a456-426614174099";
      vi.mocked(storage.updateGameStatus).mockResolvedValue(undefined);

      const response = await request(app)
        .patch(`/api/games/${gameId}/status`)
        .send({ status: "completed" });
      expect(response.status).toBe(404);
    });
  });

  describe("PATCH /api/games/:id/hidden", () => {
    it("should update hidden status", async () => {
      const gameId = "123e4567-e89b-12d3-a456-426614174000";
      const updatedGame = { id: gameId, hidden: true };
      vi.mocked(storage.updateGameHidden).mockResolvedValue(updatedGame as unknown as Game);

      const response = await request(app)
        .patch(`/api/games/${gameId}/hidden`)
        .send({ hidden: true });
      expect(response.status).toBe(200);
    });
  });

  describe("DELETE /api/games/:id", () => {
    it("should remove game", async () => {
      const gameId = "123e4567-e89b-12d3-a456-426614174000";
      vi.mocked(storage.removeGame).mockResolvedValue(true);

      const response = await request(app).delete(`/api/games/${gameId}`);
      expect(response.status).toBe(204);
    });

    it("should return 404 if game not found", async () => {
      const gameId = "123e4567-e89b-12d3-a456-426614174099";
      vi.mocked(storage.removeGame).mockResolvedValue(false);

      const response = await request(app).delete(`/api/games/${gameId}`);
      expect(response.status).toBe(404);
    });
  });

  // ─── IGDB routes ───
  describe("IGDB routes", () => {
    describe("GET /api/igdb/search", () => {
      it("should return search results", async () => {
        const mockResults = [{ id: 1, name: "Zelda" }];
        vi.mocked(igdbClient.searchGames).mockResolvedValue(mockResults as unknown as IGDBGame[]);

        const response = await request(app).get("/api/igdb/search?q=Zelda");
        expect(response.status).toBe(200);
      });

      it("should require query parameter", async () => {
        const response = await request(app).get("/api/igdb/search");
        expect(response.status).toBe(400);
      });
    });

    describe("GET /api/igdb/popular", () => {
      it("should return popular games", async () => {
        vi.mocked(igdbClient.getPopularGames).mockResolvedValue([]);
        const response = await request(app).get("/api/igdb/popular");
        expect(response.status).toBe(200);
      });
    });

    describe("GET /api/igdb/recent", () => {
      it("should return recent releases", async () => {
        vi.mocked(igdbClient.getRecentReleases).mockResolvedValue([]);
        const response = await request(app).get("/api/igdb/recent");
        expect(response.status).toBe(200);
      });
    });

    describe("GET /api/igdb/upcoming", () => {
      it("should return upcoming releases", async () => {
        vi.mocked(igdbClient.getUpcomingReleases).mockResolvedValue([]);
        const response = await request(app).get("/api/igdb/upcoming");
        expect(response.status).toBe(200);
      });
    });

    describe("GET /api/igdb/genre/:genre", () => {
      it("should return games by genre", async () => {
        vi.mocked(igdbClient.getGamesByGenre).mockResolvedValue([]);
        const response = await request(app).get("/api/igdb/genre/Action");
        expect(response.status).toBe(200);
      });
    });

    describe("GET /api/igdb/platform/:platform", () => {
      it("should return games by platform", async () => {
        vi.mocked(igdbClient.getGamesByPlatform).mockResolvedValue([]);
        const response = await request(app).get("/api/igdb/platform/PC");
        expect(response.status).toBe(200);
      });
    });

    describe("GET /api/igdb/genres", () => {
      it("should return genres", async () => {
        vi.mocked(igdbClient.getGenres).mockResolvedValue([]);
        const response = await request(app).get("/api/igdb/genres");
        expect(response.status).toBe(200);
      });
    });

    describe("GET /api/igdb/platforms", () => {
      it("should return platforms", async () => {
        vi.mocked(igdbClient.getPlatforms).mockResolvedValue([]);
        const response = await request(app).get("/api/igdb/platforms");
        expect(response.status).toBe(200);
      });
    });

    describe("GET /api/igdb/game/:id", () => {
      it("should return game details", async () => {
        const mockGame = { id: 1, name: "Zelda" };
        vi.mocked(igdbClient.getGameById).mockResolvedValue(mockGame as unknown as IGDBGame);

        const response = await request(app).get("/api/igdb/game/1");
        expect(response.status).toBe(200);
      });

      it("should return 404 for missing game", async () => {
        vi.mocked(igdbClient.getGameById).mockResolvedValue(null as any);
        const response = await request(app).get("/api/igdb/game/9999");
        expect(response.status).toBe(404);
      });
    });
  });

  // ─── Indexer routes ───
  describe("Indexer routes", () => {
    describe("GET /api/indexers", () => {
      it("should return all indexers", async () => {
        vi.mocked(storage.getAllIndexers).mockResolvedValue([]);
        const response = await request(app).get("/api/indexers");
        expect(response.status).toBe(200);
      });

      it("should return 500 on error", async () => {
        vi.mocked(storage.getAllIndexers).mockRejectedValue(new Error("DB error"));
        const response = await request(app).get("/api/indexers");
        expect(response.status).toBe(500);
      });
    });

    describe("GET /api/indexers/enabled", () => {
      it("should return enabled indexers", async () => {
        vi.mocked(storage.getEnabledIndexers).mockResolvedValue([]);
        const response = await request(app).get("/api/indexers/enabled");
        expect(response.status).toBe(200);
      });
    });

    describe("GET /api/indexers/:id", () => {
      it("should return single indexer", async () => {
        const mockIndexer = { id: "idx-1", name: "Test Indexer" };
        vi.mocked(storage.getIndexer).mockResolvedValue(mockIndexer as unknown as Indexer);

        const response = await request(app).get("/api/indexers/idx-1");
        expect(response.status).toBe(200);
        expect(response.body).toEqual(mockIndexer);
      });

      it("should return 404 for missing indexer", async () => {
        vi.mocked(storage.getIndexer).mockResolvedValue(undefined as any);
        const response = await request(app).get("/api/indexers/nonexistent");
        expect(response.status).toBe(404);
      });
    });

    describe("DELETE /api/indexers/:id", () => {
      it("should delete indexer", async () => {
        vi.mocked(storage.removeIndexer).mockResolvedValue(true);
        const response = await request(app).delete("/api/indexers/idx-1");
        expect(response.status).toBe(204);
      });

      it("should return 404 for missing indexer", async () => {
        vi.mocked(storage.removeIndexer).mockResolvedValue(false);
        const response = await request(app).delete("/api/indexers/nonexistent");
        expect(response.status).toBe(404);
      });
    });

    describe("POST /api/indexers/:id/test", () => {
      it("should test existing indexer", async () => {
        vi.mocked(storage.getIndexer).mockResolvedValue({ id: "idx-1" } as unknown as Indexer);
        const response = await request(app).post("/api/indexers/idx-1/test");
        expect(response.status).toBe(200);
      });

      it("should return 404 for missing indexer", async () => {
        vi.mocked(storage.getIndexer).mockResolvedValue(null as any);
        const response = await request(app).post("/api/indexers/nonexistent/test");
        expect(response.status).toBe(404);
      });
    });

    describe("GET /api/indexers/:id/categories", () => {
      it("should return categories", async () => {
        vi.mocked(storage.getIndexer).mockResolvedValue({ id: "idx-1" } as unknown as Indexer);
        vi.mocked(torznabClient.getCategories).mockResolvedValue([]);
        const response = await request(app).get("/api/indexers/idx-1/categories");
        expect(response.status).toBe(200);
      });

      it("should return 404 for missing indexer", async () => {
        vi.mocked(storage.getIndexer).mockResolvedValue(null as any);
        const response = await request(app).get("/api/indexers/nonexistent/categories");
        expect(response.status).toBe(404);
      });
    });

    describe("GET /api/indexers/:id/search", () => {
      it("should search specific indexer", async () => {
        vi.mocked(storage.getIndexer).mockResolvedValue({ id: "idx-1" } as unknown as Indexer);
        const response = await request(app).get("/api/indexers/idx-1/search?query=test");
        expect(response.status).toBe(200);
      });

      it("should require query parameter", async () => {
        const response = await request(app).get("/api/indexers/idx-1/search");
        expect(response.status).toBe(400);
      });

      it("should return 404 for missing indexer", async () => {
        vi.mocked(storage.getIndexer).mockResolvedValue(null as any);
        const response = await request(app).get("/api/indexers/nonexistent/search?query=test");
        expect(response.status).toBe(404);
      });
    });
  });

  // ─── Downloader routes ───
  describe("Downloader routes", () => {
    describe("GET /api/downloaders", () => {
      it("should return all downloaders", async () => {
        vi.mocked(storage.getAllDownloaders).mockResolvedValue([]);
        const response = await request(app).get("/api/downloaders");
        expect(response.status).toBe(200);
      });
    });

    describe("GET /api/downloaders/enabled", () => {
      it("should return enabled downloaders", async () => {
        vi.mocked(storage.getEnabledDownloaders).mockResolvedValue([]);
        const response = await request(app).get("/api/downloaders/enabled");
        expect(response.status).toBe(200);
      });
    });

    describe("GET /api/downloaders/storage", () => {
      it("should return storage info", async () => {
        vi.mocked(storage.getEnabledDownloaders).mockResolvedValue([
          { id: "dl-1", name: "Test DL" } as unknown as Downloader,
        ]);
        const response = await request(app).get("/api/downloaders/storage");
        expect(response.status).toBe(200);
      });
    });

    describe("GET /api/downloaders/:id", () => {
      it("should return single downloader", async () => {
        const mockDl = { id: "dl-1", name: "Test DL" };
        vi.mocked(storage.getDownloader).mockResolvedValue(mockDl as unknown as Downloader);

        const response = await request(app).get("/api/downloaders/dl-1");
        expect(response.status).toBe(200);
      });

      it("should return 404 for missing downloader", async () => {
        vi.mocked(storage.getDownloader).mockResolvedValue(undefined as any);
        const response = await request(app).get("/api/downloaders/nonexistent");
        expect(response.status).toBe(404);
      });
    });

    describe("DELETE /api/downloaders/:id", () => {
      it("should delete downloader", async () => {
        vi.mocked(storage.removeDownloader).mockResolvedValue(true);
        const response = await request(app).delete("/api/downloaders/dl-1");
        expect(response.status).toBe(204);
      });

      it("should return 404 for missing downloader", async () => {
        vi.mocked(storage.removeDownloader).mockResolvedValue(false);
        const response = await request(app).delete("/api/downloaders/nonexistent");
        expect(response.status).toBe(404);
      });
    });

    describe("POST /api/downloaders/:id/test", () => {
      it("should test existing downloader", async () => {
        vi.mocked(storage.getDownloader).mockResolvedValue({
          id: "dl-1",
        } as unknown as Downloader);
        const response = await request(app).post("/api/downloaders/dl-1/test");
        expect(response.status).toBe(200);
      });

      it("should return 404 for missing downloader", async () => {
        vi.mocked(storage.getDownloader).mockResolvedValue(null as any);
        const response = await request(app).post("/api/downloaders/nonexistent/test");
        expect(response.status).toBe(404);
      });
    });

    describe("GET /api/downloaders/:id/downloads", () => {
      it("should return downloads", async () => {
        vi.mocked(storage.getDownloader).mockResolvedValue({
          id: "dl-1",
        } as unknown as Downloader);
        const response = await request(app).get("/api/downloaders/dl-1/downloads");
        expect(response.status).toBe(200);
      });

      it("should return 404 for missing downloader", async () => {
        vi.mocked(storage.getDownloader).mockResolvedValue(null as any);
        const response = await request(app).get("/api/downloaders/nonexistent/downloads");
        expect(response.status).toBe(404);
      });
    });

    describe("GET /api/downloaders/:id/downloads/:downloadId", () => {
      it("should return download status", async () => {
        vi.mocked(storage.getDownloader).mockResolvedValue({
          id: "dl-1",
        } as unknown as Downloader);
        vi.mocked(DownloaderManager.getDownloadStatus).mockResolvedValue({ id: "d-1" } as any);

        const response = await request(app).get("/api/downloaders/dl-1/downloads/d-1");
        expect(response.status).toBe(200);
      });

      it("should return 404 for missing download", async () => {
        vi.mocked(storage.getDownloader).mockResolvedValue({
          id: "dl-1",
        } as unknown as Downloader);
        vi.mocked(DownloaderManager.getDownloadStatus).mockResolvedValue(null as any);

        const response = await request(app).get("/api/downloaders/dl-1/downloads/d-missing");
        expect(response.status).toBe(404);
      });
    });

    describe("POST /api/downloaders/:id/downloads/:downloadId/pause", () => {
      it("should pause download", async () => {
        vi.mocked(storage.getDownloader).mockResolvedValue({
          id: "dl-1",
        } as unknown as Downloader);
        const response = await request(app).post("/api/downloaders/dl-1/downloads/d-1/pause");
        expect(response.status).toBe(200);
      });

      it("should return 404 for missing downloader", async () => {
        vi.mocked(storage.getDownloader).mockResolvedValue(null as any);
        const response = await request(app).post(
          "/api/downloaders/nonexistent/downloads/d-1/pause"
        );
        expect(response.status).toBe(404);
      });
    });

    describe("POST /api/downloaders/:id/downloads/:downloadId/resume", () => {
      it("should resume download", async () => {
        vi.mocked(storage.getDownloader).mockResolvedValue({
          id: "dl-1",
        } as unknown as Downloader);
        const response = await request(app).post("/api/downloaders/dl-1/downloads/d-1/resume");
        expect(response.status).toBe(200);
      });

      it("should return 404 for missing downloader", async () => {
        vi.mocked(storage.getDownloader).mockResolvedValue(null as any);
        const response = await request(app).post(
          "/api/downloaders/nonexistent/downloads/d-1/resume"
        );
        expect(response.status).toBe(404);
      });
    });

    describe("DELETE /api/downloaders/:id/downloads/:downloadId", () => {
      it("should remove download", async () => {
        vi.mocked(storage.getDownloader).mockResolvedValue({
          id: "dl-1",
        } as unknown as Downloader);
        const response = await request(app).delete("/api/downloaders/dl-1/downloads/d-1");
        expect(response.status).toBe(200);
      });

      it("should return 404 for missing downloader", async () => {
        vi.mocked(storage.getDownloader).mockResolvedValue(null as any);
        const response = await request(app).delete("/api/downloaders/nonexistent/downloads/d-1");
        expect(response.status).toBe(404);
      });
    });
  });

  // ─── Aggregated downloads ───
  describe("GET /api/downloads", () => {
    it("should return aggregated downloads", async () => {
      vi.mocked(storage.getEnabledDownloaders).mockResolvedValue([]);
      const response = await request(app).get("/api/downloads");
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ downloads: [], errors: [] });
    });

    it("should handle downloader errors gracefully", async () => {
      vi.mocked(storage.getEnabledDownloaders).mockResolvedValue([
        { id: "dl-1", name: "Failing DL" } as unknown as Downloader,
      ]);
      vi.mocked(DownloaderManager.getAllDownloads).mockRejectedValue(
        new Error("Connection failed")
      );

      const response = await request(app).get("/api/downloads");
      expect(response.status).toBe(200);
      expect(response.body.errors).toHaveLength(1);
      expect(response.body.errors[0].downloaderId).toBe("dl-1");
    });
  });

  // ─── Notification routes ───
  describe("Notification routes", () => {
    describe("GET /api/notifications", () => {
      it("should return notifications", async () => {
        vi.mocked(storage.getNotifications).mockResolvedValue([]);
        const response = await request(app).get("/api/notifications");
        expect(response.status).toBe(200);
      });

      it("should return 500 on error", async () => {
        vi.mocked(storage.getNotifications).mockRejectedValue(new Error("DB error"));
        const response = await request(app).get("/api/notifications");
        expect(response.status).toBe(500);
      });
    });

    describe("GET /api/notifications/unread-count", () => {
      it("should return unread count", async () => {
        vi.mocked(storage.getUnreadNotificationsCount).mockResolvedValue(5);
        const response = await request(app).get("/api/notifications/unread-count");
        expect(response.status).toBe(200);
        expect(response.body.count).toBe(5);
      });
    });

    describe("PUT /api/notifications/:id/read", () => {
      it("should mark notification as read", async () => {
        vi.mocked(storage.markNotificationAsRead).mockResolvedValue({
          id: "n-1",
          read: true,
        } as any);
        const response = await request(app).put("/api/notifications/n-1/read");
        expect(response.status).toBe(200);
      });

      it("should return 404 for missing notification", async () => {
        vi.mocked(storage.markNotificationAsRead).mockResolvedValue(null as any);
        const response = await request(app).put("/api/notifications/nonexistent/read");
        expect(response.status).toBe(404);
      });
    });

    describe("PUT /api/notifications/read-all", () => {
      it("should mark all as read", async () => {
        const response = await request(app).put("/api/notifications/read-all");
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
      });
    });

    describe("DELETE /api/notifications", () => {
      it("should clear all notifications", async () => {
        const response = await request(app).delete("/api/notifications");
        expect(response.status).toBe(204);
      });
    });
  });

  // ─── Config routes ───
  describe("GET /api/config", () => {
    it("should return config with DB credentials", async () => {
      vi.mocked(storage.getSystemConfig)
        .mockResolvedValueOnce("db-client-id")
        .mockResolvedValueOnce("db-secret")
        .mockResolvedValueOnce(null as any); // xrel_api_base

      const response = await request(app).get("/api/config");
      expect(response.status).toBe(200);
      expect(response.body.igdb.configured).toBe(true);
      expect(response.body.igdb.source).toBe("database");
    });

    it("should fallback to env credentials", async () => {
      vi.mocked(storage.getSystemConfig).mockResolvedValue(null as any);

      const response = await request(app).get("/api/config");
      expect(response.status).toBe(200);
      expect(response.body.igdb.configured).toBe(true);
      expect(response.body.igdb.source).toBe("env");
    });
  });

  // ─── IGDB settings ───
  describe("IGDB settings", () => {
    describe("GET /api/settings/igdb", () => {
      it("should return IGDB settings from DB", async () => {
        vi.mocked(storage.getSystemConfig)
          .mockResolvedValueOnce("db-client-id")
          .mockResolvedValueOnce("db-secret");

        const response = await request(app).get("/api/settings/igdb");
        expect(response.status).toBe(200);
        expect(response.body.configured).toBe(true);
        expect(response.body.source).toBe("database");
      });
    });

    describe("POST /api/settings/igdb", () => {
      it("should update IGDB credentials", async () => {
        vi.mocked(storage.getSystemConfig).mockResolvedValue("existing-secret");
        const response = await request(app)
          .post("/api/settings/igdb")
          .send({ clientId: "new-id", clientSecret: "new-secret" });
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
      });

      it("should return 400 when clientId is missing", async () => {
        const response = await request(app).post("/api/settings/igdb").send({});
        expect(response.status).toBe(400);
      });

      it("should handle masked secret update", async () => {
        vi.mocked(storage.getSystemConfig).mockResolvedValue("existing-secret");
        const response = await request(app)
          .post("/api/settings/igdb")
          .send({ clientId: "my-id", clientSecret: "********" });
        expect(response.status).toBe(200);
        // Should NOT save the masked value
        expect(storage.setSystemConfig).toHaveBeenCalledWith("igdb.clientId", "my-id");
        expect(storage.setSystemConfig).not.toHaveBeenCalledWith("igdb.clientSecret", "********");
      });
    });
  });

  // ─── User Settings ───
  describe("User settings", () => {
    describe("GET /api/settings", () => {
      it("should return user settings", async () => {
        vi.mocked(storage.getUserSettings).mockResolvedValue({ id: "s-1" } as any);
        const response = await request(app).get("/api/settings");
        expect(response.status).toBe(200);
      });

      it("should create default settings if they don't exist", async () => {
        vi.mocked(storage.getUserSettings).mockResolvedValue(null as any);
        vi.mocked(storage.createUserSettings).mockResolvedValue({ id: "s-new" } as any);

        const response = await request(app).get("/api/settings");
        expect(response.status).toBe(200);
        expect(storage.createUserSettings).toHaveBeenCalled();
      });
    });

    describe("PATCH /api/settings", () => {
      it("should update user settings", async () => {
        vi.mocked(storage.getUserSettings).mockResolvedValue({ id: "s-1" } as any);
        vi.mocked(storage.updateUserSettings).mockResolvedValue({ id: "s-1" } as any);

        const response = await request(app).patch("/api/settings").send({});
        expect(response.status).toBe(200);
      });
    });
  });

  // ─── RSS routes ───
  describe("RSS routes", () => {
    describe("GET /api/rss/feeds", () => {
      it("should return RSS feeds", async () => {
        vi.mocked(storage.getAllRssFeeds).mockResolvedValue([]);
        const response = await request(app).get("/api/rss/feeds");
        expect(response.status).toBe(200);
      });

      it("should return 500 on error", async () => {
        vi.mocked(storage.getAllRssFeeds).mockRejectedValue(new Error("DB error"));
        const response = await request(app).get("/api/rss/feeds");
        expect(response.status).toBe(500);
      });
    });

    describe("PUT /api/rss/feeds/:id", () => {
      it("should update RSS feed", async () => {
        vi.mocked(storage.updateRssFeed).mockResolvedValue({ id: "feed-1" } as any);
        const response = await request(app)
          .put("/api/rss/feeds/feed-1")
          .send({ name: "Updated feed" });
        expect(response.status).toBe(200);
      });

      it("should return 404 for missing feed", async () => {
        vi.mocked(storage.updateRssFeed).mockResolvedValue(null as any);
        const response = await request(app)
          .put("/api/rss/feeds/nonexistent")
          .send({ name: "Updated" });
        expect(response.status).toBe(404);
      });
    });

    describe("DELETE /api/rss/feeds/:id", () => {
      it("should delete RSS feed", async () => {
        vi.mocked(storage.removeRssFeed).mockResolvedValue(true);
        const response = await request(app).delete("/api/rss/feeds/feed-1");
        expect(response.status).toBe(200);
      });

      it("should return 404 for missing feed", async () => {
        vi.mocked(storage.removeRssFeed).mockResolvedValue(false);
        const response = await request(app).delete("/api/rss/feeds/nonexistent");
        expect(response.status).toBe(404);
      });
    });

    describe("GET /api/rss/items", () => {
      it("should return RSS items", async () => {
        vi.mocked(storage.getAllRssFeedItems).mockResolvedValue([]);
        const response = await request(app).get("/api/rss/items");
        expect(response.status).toBe(200);
      });
    });

    describe("POST /api/rss/refresh", () => {
      it("should refresh all feeds", async () => {
        const response = await request(app).post("/api/rss/refresh");
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
      });

      it("should return 500 on error", async () => {
        vi.mocked(rssService.refreshFeeds).mockRejectedValue(new Error("RSS error"));
        const response = await request(app).post("/api/rss/refresh");
        expect(response.status).toBe(500);
      });
    });
  });

  // ─── Indexer test route ───
  describe("POST /api/indexers/test", () => {
    it("should return 400 for missing url/apiKey", async () => {
      const response = await request(app).post("/api/indexers/test").send({});
      expect(response.status).toBe(400);
    });
  });

  // ─── Downloader test route ───
  describe("POST /api/downloaders/test", () => {
    it("should return 400 for missing type/url", async () => {
      const response = await request(app).post("/api/downloaders/test").send({});
      expect(response.status).toBe(400);
    });
  });

  // ─── Download details route ───
  describe("GET /api/downloaders/:id/downloads/:downloadId/details", () => {
    it("should return download details", async () => {
      vi.mocked(storage.getDownloader).mockResolvedValue({ id: "dl-1" } as unknown as Downloader);
      vi.mocked(DownloaderManager.getDownloadDetails).mockResolvedValue({ id: "d-1" } as any);

      const response = await request(app).get("/api/downloaders/dl-1/downloads/d-1/details");
      expect(response.status).toBe(200);
    });

    it("should return 404 for missing downloader", async () => {
      vi.mocked(storage.getDownloader).mockResolvedValue(null as any);
      const response = await request(app).get("/api/downloaders/nonexistent/downloads/d-1/details");
      expect(response.status).toBe(404);
    });

    it("should return 404 for missing download details", async () => {
      vi.mocked(storage.getDownloader).mockResolvedValue({ id: "dl-1" } as unknown as Downloader);
      vi.mocked(DownloaderManager.getDownloadDetails).mockResolvedValue(null as any);

      const response = await request(app).get("/api/downloaders/dl-1/downloads/d-missing/details");
      expect(response.status).toBe(404);
    });
  });

  // ─── Prowlarr sync ───
  describe("POST /api/indexers/prowlarr/sync", () => {
    it("should return 400 for missing url/apiKey", async () => {
      const response = await request(app).post("/api/indexers/prowlarr/sync").send({});
      expect(response.status).toBe(400);
    });
  });
});
