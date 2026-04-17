import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import { registerRoutes, parseCategories } from "../routes.js";
import { storage } from "../storage.js";
import { searchAllIndexers } from "../search.js";
import { igdbClient, type IGDBGame } from "../igdb.js";
import { type Game, type User, type Indexer, type Downloader } from "../../shared/schema.js";
import { DownloaderManager } from "../downloaders.js";
import { torznabClient } from "../torznab.js";
import { rssService } from "../rss.js";
import { comparePassword } from "../auth.js";
import { db } from "../db.js";
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
    deleteReadNotifications: vi.fn().mockResolvedValue(undefined),
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
  expressLogger: {
    info: vi.fn(),
    warn: vi.fn(),
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
  filterBlacklistedReleases: (items: { title: string }[], blacklisted: Set<string>) =>
    blacklisted.size > 0 ? items.filter((item) => !blacklisted.has(item.title)) : items,
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
  const mockUserHashed = {
    id: "user-1",
    username: "testuser",
    passwordHash: "hashed",
  } as unknown as User;
  const mockUserOldHash = {
    id: "user-1",
    username: "testuser",
    passwordHash: "old-hash",
  } as unknown as User;

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

    describe("POST /api/auth/login", () => {
      it("should return 401 for invalid credentials", async () => {
        vi.mocked(storage.getUserByUsername).mockResolvedValue(mockUserHashed);
        vi.mocked(comparePassword).mockResolvedValue(false);

        const res = await request(app)
          .post("/api/auth/login")
          .send({ username: "testuser", password: "wrongpassword" });
        expect(res.status).toBe(401);
      });

      it("should return 400 when username is missing", async () => {
        const res = await request(app).post("/api/auth/login").send({ password: "password123" });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("Username and password are required and must be strings");
      });

      it("should return 400 when password is missing", async () => {
        const res = await request(app).post("/api/auth/login").send({ username: "testuser" });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("Username and password are required and must be strings");
      });

      it("should return 400 for non-string username", async () => {
        const res = await request(app)
          .post("/api/auth/login")
          .send({ username: 123, password: "password123" });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("Username and password are required and must be strings");
      });

      it("should trim username and password before authentication", async () => {
        vi.mocked(storage.getUserByUsername).mockResolvedValue(mockUserHashed);
        vi.mocked(storage.assignOrphanGamesToUser).mockResolvedValue(undefined);
        // Raw password fails (no stored hash with whitespace); trimmed password succeeds.
        vi.mocked(comparePassword)
          .mockResolvedValueOnce(false) // raw "  password123  "
          .mockResolvedValueOnce(true); // trimmed "password123"

        const res = await request(app)
          .post("/api/auth/login")
          .send({ username: "  testuser  ", password: "  password123  " });
        expect(res.status).toBe(200);
        expect(storage.getUserByUsername).toHaveBeenCalledWith("testuser");
        expect(comparePassword).toHaveBeenCalledWith("  password123  ", "hashed");
        expect(comparePassword).toHaveBeenCalledWith("password123", "hashed");
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

    describe("PATCH /api/auth/password", () => {
      it("should update password successfully", async () => {
        vi.mocked(storage.getUser).mockResolvedValue(mockUserOldHash);
        vi.mocked(comparePassword).mockResolvedValue(true);
        vi.mocked(storage.updateUserPassword).mockResolvedValue(undefined);

        const res = await request(app).patch("/api/auth/password").send({
          currentPassword: "oldpass1",
          newPassword: "newpass1",
          confirmPassword: "newpass1",
        });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
      });

      it("should return 404 when user not found", async () => {
        vi.mocked(storage.getUser).mockResolvedValue(null as unknown as User);

        const res = await request(app).patch("/api/auth/password").send({
          currentPassword: "oldpass1",
          newPassword: "newpass1",
          confirmPassword: "newpass1",
        });
        expect(res.status).toBe(404);
      });

      it("should return 401 for incorrect current password", async () => {
        vi.mocked(storage.getUser).mockResolvedValue(mockUserOldHash);
        vi.mocked(comparePassword).mockResolvedValue(false);

        const res = await request(app).patch("/api/auth/password").send({
          currentPassword: "wrongpass",
          newPassword: "newpass1",
          confirmPassword: "newpass1",
        });
        expect(res.status).toBe(401);
      });

      it("should return 400 for new password too short", async () => {
        const res = await request(app).patch("/api/auth/password").send({
          currentPassword: "oldpass1",
          newPassword: "abc",
          confirmPassword: "abc",
        });
        expect(res.status).toBe(400);
      });

      it("should return 400 when passwords do not match", async () => {
        const res = await request(app).patch("/api/auth/password").send({
          currentPassword: "oldpass1",
          newPassword: "newpass1",
          confirmPassword: "differentpass",
        });
        expect(res.status).toBe(400);
      });

      it("should trim whitespace from passwords before validation", async () => {
        vi.mocked(storage.getUser).mockResolvedValue(mockUserOldHash);
        vi.mocked(comparePassword).mockResolvedValue(true);
        vi.mocked(storage.updateUserPassword).mockResolvedValue(undefined);

        const res = await request(app).patch("/api/auth/password").send({
          currentPassword: "  oldpass1  ",
          newPassword: "  newpass1  ",
          confirmPassword: "  newpass1  ",
        });
        expect(res.status).toBe(200);
        expect(comparePassword).toHaveBeenCalledWith("oldpass1", "old-hash");
      });

      it("should return 500 on unexpected error", async () => {
        vi.mocked(storage.getUser).mockRejectedValue(new Error("DB error"));

        const res = await request(app).patch("/api/auth/password").send({
          currentPassword: "oldpass1",
          newPassword: "newpass1",
          confirmPassword: "newpass1",
        });
        expect(res.status).toBe(500);
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

  // ─── Ready check ───
  describe("GET /api/ready", () => {
    it("should return 200 when db and igdb are healthy", async () => {
      vi.mocked(db.get).mockResolvedValue({ result: 1 });
      vi.mocked(igdbClient.getPopularGames).mockResolvedValue([]);

      const res = await request(app).get("/api/ready");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ok");
    });

    it("should return 503 when db check fails", async () => {
      vi.mocked(db.get).mockRejectedValue(new Error("DB connection failed"));
      vi.mocked(igdbClient.getPopularGames).mockResolvedValue([]);

      const res = await request(app).get("/api/ready");
      expect(res.status).toBe(503);
      expect(res.body.status).toBe("error");
    });

    it("should return 503 when igdb check fails", async () => {
      vi.mocked(db.get).mockResolvedValue({ result: 1 });
      vi.mocked(igdbClient.getPopularGames).mockRejectedValue(new Error("IGDB error"));

      const res = await request(app).get("/api/ready");
      expect(res.status).toBe(503);
      expect(res.body.status).toBe("error");
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

  describe("PATCH /api/games/:id/user-rating", () => {
    const gameId = "123e4567-e89b-12d3-a456-426614174000";

    it("should set a valid rating scoped to the authenticated user", async () => {
      const updatedGame = { id: gameId, userRating: 8 };
      vi.mocked(storage.updateGameUserRating).mockResolvedValue(updatedGame as unknown as Game);

      const response = await request(app)
        .patch(`/api/games/${gameId}/user-rating`)
        .send({ userRating: 8 });
      expect(response.status).toBe(200);
      expect(response.body.userRating).toBe(8);
      expect(vi.mocked(storage.updateGameUserRating)).toHaveBeenCalledWith(gameId, "user-1", 8);
    });

    it("should accept a half-step rating (0.5 increment)", async () => {
      const updatedGame = { id: gameId, userRating: 7.5 };
      vi.mocked(storage.updateGameUserRating).mockResolvedValue(updatedGame as unknown as Game);

      const response = await request(app)
        .patch(`/api/games/${gameId}/user-rating`)
        .send({ userRating: 7.5 });
      expect(response.status).toBe(200);
    });

    it("should clear the rating with null", async () => {
      const updatedGame = { id: gameId, userRating: null };
      vi.mocked(storage.updateGameUserRating).mockResolvedValue(updatedGame as unknown as Game);

      const response = await request(app)
        .patch(`/api/games/${gameId}/user-rating`)
        .send({ userRating: null });
      expect(response.status).toBe(200);
      expect(response.body.userRating).toBeNull();
    });

    it("should return 400 for rating above 10", async () => {
      const response = await request(app)
        .patch(`/api/games/${gameId}/user-rating`)
        .send({ userRating: 11 });
      expect(response.status).toBe(400);
    });

    it("should return 400 for rating below 0", async () => {
      const response = await request(app)
        .patch(`/api/games/${gameId}/user-rating`)
        .send({ userRating: -1 });
      expect(response.status).toBe(400);
    });

    it("should return 400 for rating of 0 (minimum is 0.5)", async () => {
      const response = await request(app)
        .patch(`/api/games/${gameId}/user-rating`)
        .send({ userRating: 0 });
      expect(response.status).toBe(400);
    });

    it("should return 400 for non-0.5-increment rating", async () => {
      const response = await request(app)
        .patch(`/api/games/${gameId}/user-rating`)
        .send({ userRating: 7.3 });
      expect(response.status).toBe(400);
    });

    it("should return 404 if game not found (including cross-user access)", async () => {
      vi.mocked(storage.updateGameUserRating).mockResolvedValue(undefined);

      const response = await request(app)
        .patch(`/api/games/${gameId}/user-rating`)
        .send({ userRating: 5 });
      expect(response.status).toBe(404);
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

    it("should sanitize downloader error details in production", async () => {
      mockConfig.server.isProduction = true;
      try {
        vi.mocked(storage.getEnabledDownloaders).mockResolvedValue([
          { id: "dl-1", name: "Failing DL" } as unknown as Downloader,
        ]);
        vi.mocked(DownloaderManager.getAllDownloads).mockRejectedValue(
          new Error("Sensitive RPC failure")
        );

        const response = await request(app).get("/api/downloads");

        expect(response.status).toBe(200);
        expect(response.body.errors).toHaveLength(1);
        expect(response.body.errors[0]).toMatchObject({
          downloaderId: "dl-1",
          downloaderName: "Failing DL",
          error: "Internal Server Error",
        });
      } finally {
        mockConfig.server.isProduction = false;
      }
    });

    it("should mark downloads as trackedByQuestarr when hash matches with case-insensitive comparison", async () => {
      vi.mocked(storage.getEnabledDownloaders).mockResolvedValue([
        { id: "dl-1", name: "My rTorrent", category: "games" } as unknown as Downloader,
      ]);
      // Stored key uses lowercase (as saved by addDownload)
      vi.mocked(storage.getTrackedDownloadKeys).mockResolvedValue(new Set(["dl-1:abc123"]));
      // rTorrent returns hashes in UPPERCASE
      vi.mocked(DownloaderManager.getAllDownloads).mockResolvedValue([
        { id: "ABC123", name: "Game A", status: "downloading", progress: 50 } as never,
      ]);

      const response = await request(app).get("/api/downloads");

      expect(response.status).toBe(200);
      expect(response.body.downloads[0].trackedByQuestarr).toBe(true);
    });

    it("should mark downloads as trackedByQuestarr when hash matches a game download", async () => {
      vi.mocked(storage.getEnabledDownloaders).mockResolvedValue([
        { id: "dl-1", name: "My qBit", category: "games" } as unknown as Downloader,
      ]);
      vi.mocked(storage.getTrackedDownloadKeys).mockResolvedValue(new Set(["dl-1:abc123"]));
      vi.mocked(DownloaderManager.getAllDownloads).mockResolvedValue([
        { id: "abc123", name: "Game A", status: "downloading", progress: 50 } as never,
        { id: "xyz789", name: "Game B", status: "downloading", progress: 20 } as never,
      ]);

      const response = await request(app).get("/api/downloads");

      expect(response.status).toBe(200);
      const downloads = response.body.downloads;
      expect(downloads).toHaveLength(2);
      expect(downloads.find((d: { id: string }) => d.id === "abc123").trackedByQuestarr).toBe(true);
      expect(downloads.find((d: { id: string }) => d.id === "xyz789").trackedByQuestarr).toBe(
        false
      );
    });

    it("should include downloaderCategory from the downloader settings", async () => {
      vi.mocked(storage.getEnabledDownloaders).mockResolvedValue([
        { id: "dl-1", name: "My qBit", category: "games" } as unknown as Downloader,
      ]);
      vi.mocked(storage.getTrackedDownloadKeys).mockResolvedValue(new Set());
      vi.mocked(DownloaderManager.getAllDownloads).mockResolvedValue([
        { id: "abc123", name: "Game A", status: "downloading", progress: 50 } as never,
      ]);

      const response = await request(app).get("/api/downloads");

      expect(response.status).toBe(200);
      expect(response.body.downloads[0].downloaderCategory).toBe("games");
    });

    it("should omit downloaderCategory when the downloader has no category configured", async () => {
      vi.mocked(storage.getEnabledDownloaders).mockResolvedValue([
        { id: "dl-1", name: "My DL" } as unknown as Downloader,
      ]);
      vi.mocked(storage.getTrackedDownloadKeys).mockResolvedValue(new Set());
      vi.mocked(DownloaderManager.getAllDownloads).mockResolvedValue([
        { id: "abc123", name: "Game A", status: "downloading", progress: 50 } as never,
      ]);

      const response = await request(app).get("/api/downloads");

      expect(response.status).toBe(200);
      expect(response.body.downloads[0].downloaderCategory).toBeUndefined();
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
        expect(response.status).toBe(204);
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

  // ─── Release Blacklist routes ───
  describe("Release Blacklist routes", () => {
    const gameId = "123e4567-e89b-12d3-a456-426614174000";
    const mockGame = { id: gameId, userId: "user-1", title: "Test Game" };
    const blacklistEntry = {
      id: "bl-1",
      gameId,
      releaseTitle: "Test Game-SKIDROW",
      createdAt: new Date().toISOString(),
    };

    describe("POST /api/games/:gameId/blacklist", () => {
      it("should add a release to the blacklist", async () => {
        vi.mocked(storage.getGame).mockResolvedValue(mockGame as any);
        vi.mocked(storage.addReleaseBlacklist).mockResolvedValue(blacklistEntry as any);

        const response = await request(app)
          .post(`/api/games/${gameId}/blacklist`)
          .send({ releaseTitle: "Test Game-SKIDROW" });

        expect(response.status).toBe(201);
        expect(response.body).toMatchObject({ releaseTitle: "Test Game-SKIDROW" });
      });

      it("should return 400 for missing releaseTitle", async () => {
        vi.mocked(storage.getGame).mockResolvedValue(mockGame as any);

        const response = await request(app).post(`/api/games/${gameId}/blacklist`).send({});

        expect(response.status).toBe(400);
      });

      it("should return 403 when game belongs to another user", async () => {
        vi.mocked(storage.getGame).mockResolvedValue({ ...mockGame, userId: "other-user" } as any);

        const response = await request(app)
          .post(`/api/games/${gameId}/blacklist`)
          .send({ releaseTitle: "Test Game-SKIDROW" });

        expect(response.status).toBe(403);
      });

      it("should return 404 when game not found", async () => {
        vi.mocked(storage.getGame).mockResolvedValue(undefined as any);

        const response = await request(app)
          .post(`/api/games/${gameId}/blacklist`)
          .send({ releaseTitle: "Test Game-SKIDROW" });

        expect(response.status).toBe(404);
      });

      it("should return 400 when releaseTitle exceeds 500 characters", async () => {
        vi.mocked(storage.getGame).mockResolvedValue(mockGame as any);
        const response = await request(app)
          .post(`/api/games/${gameId}/blacklist`)
          .send({ releaseTitle: "a".repeat(501) });
        expect(response.status).toBe(400);
      });

      it("should return 500 on storage error", async () => {
        vi.mocked(storage.getGame).mockResolvedValue(mockGame as any);
        vi.mocked(storage.addReleaseBlacklist).mockRejectedValue(new Error("DB error"));
        const response = await request(app)
          .post(`/api/games/${gameId}/blacklist`)
          .send({ releaseTitle: "Test Game-SKIDROW" });
        expect(response.status).toBe(500);
      });
    });

    describe("GET /api/games/:gameId/blacklist", () => {
      it("should return blacklist entries for a game", async () => {
        vi.mocked(storage.getGame).mockResolvedValue(mockGame as any);
        vi.mocked(storage.getReleaseBlacklist).mockResolvedValue([blacklistEntry] as any);

        const response = await request(app).get(`/api/games/${gameId}/blacklist`);

        expect(response.status).toBe(200);
        expect(response.body).toHaveLength(1);
        expect(response.body[0].releaseTitle).toBe("Test Game-SKIDROW");
      });

      it("should return 403 when game belongs to another user", async () => {
        vi.mocked(storage.getGame).mockResolvedValue({ ...mockGame, userId: "other-user" } as any);

        const response = await request(app).get(`/api/games/${gameId}/blacklist`);

        expect(response.status).toBe(403);
      });

      it("should return 404 when game not found", async () => {
        vi.mocked(storage.getGame).mockResolvedValue(undefined as any);
        const response = await request(app).get(`/api/games/${gameId}/blacklist`);
        expect(response.status).toBe(404);
      });

      it("should return 500 on storage error", async () => {
        vi.mocked(storage.getGame).mockResolvedValue(mockGame as any);
        vi.mocked(storage.getReleaseBlacklist).mockRejectedValue(new Error("DB error"));
        const response = await request(app).get(`/api/games/${gameId}/blacklist`);
        expect(response.status).toBe(500);
      });
    });

    describe("DELETE /api/games/:gameId/blacklist/:id", () => {
      it("should remove a blacklist entry", async () => {
        vi.mocked(storage.getGame).mockResolvedValue(mockGame as any);
        vi.mocked(storage.removeReleaseBlacklist).mockResolvedValue(true);

        const response = await request(app).delete(`/api/games/${gameId}/blacklist/bl-1`);

        expect(response.status).toBe(204);
      });

      it("should return 404 when entry not found", async () => {
        vi.mocked(storage.getGame).mockResolvedValue(mockGame as any);
        vi.mocked(storage.removeReleaseBlacklist).mockResolvedValue(false);

        const response = await request(app).delete(`/api/games/${gameId}/blacklist/nonexistent`);

        expect(response.status).toBe(404);
      });

      it("should return 403 when game belongs to another user", async () => {
        vi.mocked(storage.getGame).mockResolvedValue({ ...mockGame, userId: "other-user" } as any);

        const response = await request(app).delete(`/api/games/${gameId}/blacklist/bl-1`);

        expect(response.status).toBe(403);
      });

      it("should return 404 when game not found", async () => {
        vi.mocked(storage.getGame).mockResolvedValue(undefined as any);
        const response = await request(app).delete(`/api/games/${gameId}/blacklist/bl-1`);
        expect(response.status).toBe(404);
      });

      it("should return 500 on storage error", async () => {
        vi.mocked(storage.getGame).mockResolvedValue(mockGame as any);
        vi.mocked(storage.removeReleaseBlacklist).mockRejectedValue(new Error("DB error"));
        const response = await request(app).delete(`/api/games/${gameId}/blacklist/bl-1`);
        expect(response.status).toBe(500);
      });
    });

    describe("GET /api/blacklist", () => {
      it("should return all blacklist entries for the user", async () => {
        const entries = [{ ...blacklistEntry, gameTitle: "Test Game" }];
        vi.mocked(storage.getAllReleaseBlacklists).mockResolvedValue(entries as any);

        const response = await request(app).get("/api/blacklist");

        expect(response.status).toBe(200);
        expect(response.body).toHaveLength(1);
        expect(response.body[0].gameTitle).toBe("Test Game");
      });

      it("should return empty array when no entries", async () => {
        vi.mocked(storage.getAllReleaseBlacklists).mockResolvedValue([]);

        const response = await request(app).get("/api/blacklist");

        expect(response.status).toBe(200);
        expect(response.body).toEqual([]);
      });

      it("should return 500 on storage error", async () => {
        vi.mocked(storage.getAllReleaseBlacklists).mockRejectedValue(new Error("DB error"));
        const response = await request(app).get("/api/blacklist");
        expect(response.status).toBe(500);
      });
    });
  });

  // ─── Search with blacklist filtering ───
  describe("GET /api/search - blacklist filtering", () => {
    it("should filter blacklisted releases when gameId belongs to user", async () => {
      const mockGame = { id: "game-1", userId: "user-1", title: "Test Game" };
      vi.mocked(storage.getGame).mockResolvedValue(mockGame as any);
      vi.mocked(storage.getReleaseBlacklistSet).mockResolvedValue(new Set(["Test Game-SKIDROW"]));
      vi.mocked(searchAllIndexers).mockResolvedValue({
        items: [
          {
            title: "Test Game-SKIDROW",
            link: "http://example.com/1",
            downloadType: "torrent" as const,
          },
          {
            title: "Test Game-CODEX",
            link: "http://example.com/2",
            downloadType: "torrent" as const,
          },
        ],
        total: 2,
        errors: [],
      });

      const response = await request(app).get("/api/search?query=Test+Game&gameId=game-1");

      expect(response.status).toBe(200);
      expect(response.body.items).toHaveLength(1);
      expect(response.body.items[0].title).toBe("Test Game-CODEX");
      expect(storage.getReleaseBlacklistSet).toHaveBeenCalledWith("game-1");
    });

    it("should include blacklistedCount in response when items are blacklisted", async () => {
      const mockGame = { id: "game-1", userId: "user-1", title: "Test Game" };
      vi.mocked(storage.getGame).mockResolvedValue(mockGame as any);
      vi.mocked(storage.getReleaseBlacklistSet).mockResolvedValue(
        new Set(["Test Game-SKIDROW", "Test Game-PLAZA"])
      );
      vi.mocked(searchAllIndexers).mockResolvedValue({
        items: [
          {
            title: "Test Game-SKIDROW",
            link: "http://example.com/1",
            downloadType: "torrent" as const,
          },
          {
            title: "Test Game-PLAZA",
            link: "http://example.com/2",
            downloadType: "torrent" as const,
          },
          {
            title: "Test Game-CODEX",
            link: "http://example.com/3",
            downloadType: "torrent" as const,
          },
        ],
        total: 3,
        errors: [],
      });

      const response = await request(app).get("/api/search?query=Test+Game&gameId=game-1");

      expect(response.status).toBe(200);
      expect(response.body.items).toHaveLength(1);
      expect(response.body.blacklistedCount).toBe(2);
    });

    it("should not filter when game belongs to another user", async () => {
      vi.mocked(storage.getGame).mockResolvedValue({
        id: "game-1",
        userId: "other-user",
        title: "Test Game",
      } as any);
      vi.mocked(searchAllIndexers).mockResolvedValue({
        items: [
          {
            title: "Test Game-SKIDROW",
            link: "http://example.com/1",
            downloadType: "torrent" as const,
          },
        ],
        total: 1,
        errors: [],
      });

      const response = await request(app).get("/api/search?query=Test+Game&gameId=game-1");

      expect(response.status).toBe(200);
      expect(response.body.items).toHaveLength(1);
      expect(storage.getReleaseBlacklistSet).not.toHaveBeenCalled();
    });
  });

  // ─── Discord Settings ───
  describe("Discord settings", () => {
    describe("GET /api/settings/discord", () => {
      it("should return configured: true when webhook URL is set", async () => {
        vi.mocked(storage.getSystemConfig).mockResolvedValue(
          "https://discord.com/api/webhooks/123/abc"
        );
        const response = await request(app).get("/api/settings/discord");
        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({
          configured: true,
          webhookUrl: "https://discord.com/api/webhooks/123/abc",
        });
      });

      it("should return configured: false when webhook URL is empty", async () => {
        vi.mocked(storage.getSystemConfig).mockResolvedValue("");
        const response = await request(app).get("/api/settings/discord");
        expect(response.status).toBe(200);
        expect(response.body).toEqual({ configured: false });
      });

      it("should return configured: false when webhook URL is null", async () => {
        vi.mocked(storage.getSystemConfig).mockResolvedValue(null);
        const response = await request(app).get("/api/settings/discord");
        expect(response.status).toBe(200);
        expect(response.body).toEqual({ configured: false });
      });

      it("should return 500 on storage error", async () => {
        vi.mocked(storage.getSystemConfig).mockRejectedValue(new Error("DB error"));
        const response = await request(app).get("/api/settings/discord");
        expect(response.status).toBe(500);
      });
    });

    describe("POST /api/settings/discord", () => {
      it("should save a valid discord.com webhook URL", async () => {
        vi.mocked(storage.setSystemConfig).mockResolvedValue(undefined);
        const response = await request(app)
          .post("/api/settings/discord")
          .send({ webhookUrl: "https://discord.com/api/webhooks/123/abc" });
        expect(response.status).toBe(200);
        expect(response.body).toEqual({ success: true });
        expect(storage.setSystemConfig).toHaveBeenCalledWith(
          "discord.webhookUrl",
          "https://discord.com/api/webhooks/123/abc"
        );
      });

      it("should save a valid discordapp.com webhook URL", async () => {
        vi.mocked(storage.setSystemConfig).mockResolvedValue(undefined);
        const response = await request(app)
          .post("/api/settings/discord")
          .send({ webhookUrl: "https://discordapp.com/api/webhooks/123/abc" });
        expect(response.status).toBe(200);
        expect(response.body).toEqual({ success: true });
      });

      it("should return 400 for an invalid webhook URL", async () => {
        const response = await request(app)
          .post("/api/settings/discord")
          .send({ webhookUrl: "https://evil.com/steal" });
        expect(response.status).toBe(400);
        expect(response.body.error).toMatch(/invalid/i);
        expect(storage.setSystemConfig).not.toHaveBeenCalled();
      });

      it("should clear the webhook URL when empty string is sent", async () => {
        vi.mocked(storage.setSystemConfig).mockResolvedValue(undefined);
        const response = await request(app).post("/api/settings/discord").send({ webhookUrl: "" });
        expect(response.status).toBe(200);
        expect(storage.setSystemConfig).toHaveBeenCalledWith("discord.webhookUrl", "");
      });

      it("should return 500 on storage error", async () => {
        vi.mocked(storage.setSystemConfig).mockRejectedValue(new Error("DB error"));
        const response = await request(app)
          .post("/api/settings/discord")
          .send({ webhookUrl: "https://discord.com/api/webhooks/123/abc" });
        expect(response.status).toBe(500);
      });
    });
  });

  // ─── Discord Share ───
  describe("POST /api/stats/discord-share", () => {
    const validImageDataUrl =
      "data:image/png;base64," + Buffer.from("fake-png-data").toString("base64");

    beforeEach(() => {
      vi.stubGlobal("fetch", vi.fn());
    });

    it("should return 400 when no webhook is configured", async () => {
      vi.mocked(storage.getSystemConfig).mockResolvedValue(null);
      const response = await request(app)
        .post("/api/stats/discord-share")
        .send({ image: validImageDataUrl });
      expect(response.status).toBe(400);
      expect(response.body.error).toMatch(/not configured/i);
    });

    it("should return 400 when webhook URL is invalid in DB", async () => {
      vi.mocked(storage.getSystemConfig).mockResolvedValue("https://evil.com/webhook");
      const response = await request(app)
        .post("/api/stats/discord-share")
        .send({ image: validImageDataUrl });
      expect(response.status).toBe(400);
      expect(response.body.error).toMatch(/invalid/i);
    });

    it("should return 400 when no image is provided", async () => {
      vi.mocked(storage.getSystemConfig).mockResolvedValue(
        "https://discord.com/api/webhooks/123/abc"
      );
      const response = await request(app).post("/api/stats/discord-share").send({});
      expect(response.status).toBe(400);
      expect(response.body.error).toMatch(/no image/i);
    });

    it("should return 400 for malformed image data", async () => {
      vi.mocked(storage.getSystemConfig).mockResolvedValue(
        "https://discord.com/api/webhooks/123/abc"
      );
      const response = await request(app)
        .post("/api/stats/discord-share")
        .send({ image: "not-a-valid-data-url" });
      expect(response.status).toBe(400);
      expect(response.body.error).toMatch(/invalid image/i);
    });

    it("should post to Discord and return success", async () => {
      vi.mocked(storage.getSystemConfig).mockResolvedValue(
        "https://discord.com/api/webhooks/123/abc"
      );
      vi.mocked(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
      });
      const response = await request(app)
        .post("/api/stats/discord-share")
        .send({ image: validImageDataUrl, message: "My stats" });
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true });
      expect(fetch).toHaveBeenCalledWith(
        "https://discord.com/api/webhooks/123/abc",
        expect.objectContaining({ method: "POST" })
      );
    });

    it("should return 502 when Discord rejects the request", async () => {
      vi.mocked(storage.getSystemConfig).mockResolvedValue(
        "https://discord.com/api/webhooks/123/abc"
      );
      vi.mocked(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 400,
        text: vi.fn().mockResolvedValue("Bad Request"),
      });
      const response = await request(app)
        .post("/api/stats/discord-share")
        .send({ image: validImageDataUrl });
      expect(response.status).toBe(502);
      expect(response.body.error).toMatch(/discord/i);
    });

    it("should return 500 on unexpected error", async () => {
      vi.mocked(storage.getSystemConfig).mockRejectedValue(new Error("DB error"));
      const response = await request(app)
        .post("/api/stats/discord-share")
        .send({ image: validImageDataUrl });
      expect(response.status).toBe(500);
    });
  });
  // ─── Release Blacklist routes ───
  describe("Release Blacklist routes", () => {
    const gameId = "123e4567-e89b-12d3-a456-426614174000";
    const mockGame = { id: gameId, userId: "user-1", title: "Test Game" };
    const blacklistEntry = {
      id: "bl-1",
      gameId,
      releaseTitle: "Test Game-SKIDROW",
      createdAt: new Date().toISOString(),
    };

    describe("POST /api/games/:gameId/blacklist", () => {
      it("should add a release to the blacklist", async () => {
        vi.mocked(storage.getGame).mockResolvedValue(mockGame as any);
        vi.mocked(storage.addReleaseBlacklist).mockResolvedValue(blacklistEntry as any);

        const response = await request(app)
          .post(`/api/games/${gameId}/blacklist`)
          .send({ releaseTitle: "Test Game-SKIDROW" });

        expect(response.status).toBe(201);
        expect(response.body).toMatchObject({ releaseTitle: "Test Game-SKIDROW" });
      });

      it("should return 400 for missing releaseTitle", async () => {
        vi.mocked(storage.getGame).mockResolvedValue(mockGame as any);

        const response = await request(app).post(`/api/games/${gameId}/blacklist`).send({});

        expect(response.status).toBe(400);
      });

      it("should return 403 when game belongs to another user", async () => {
        vi.mocked(storage.getGame).mockResolvedValue({ ...mockGame, userId: "other-user" } as any);

        const response = await request(app)
          .post(`/api/games/${gameId}/blacklist`)
          .send({ releaseTitle: "Test Game-SKIDROW" });

        expect(response.status).toBe(403);
      });

      it("should return 404 when game not found", async () => {
        vi.mocked(storage.getGame).mockResolvedValue(undefined as any);

        const response = await request(app)
          .post(`/api/games/${gameId}/blacklist`)
          .send({ releaseTitle: "Test Game-SKIDROW" });

        expect(response.status).toBe(404);
      });
    });

    describe("GET /api/games/:gameId/blacklist", () => {
      it("should return blacklist entries for a game", async () => {
        vi.mocked(storage.getGame).mockResolvedValue(mockGame as any);
        vi.mocked(storage.getReleaseBlacklist).mockResolvedValue([blacklistEntry] as any);

        const response = await request(app).get(`/api/games/${gameId}/blacklist`);

        expect(response.status).toBe(200);
        expect(response.body).toHaveLength(1);
        expect(response.body[0].releaseTitle).toBe("Test Game-SKIDROW");
      });

      it("should return 403 when game belongs to another user", async () => {
        vi.mocked(storage.getGame).mockResolvedValue({ ...mockGame, userId: "other-user" } as any);

        const response = await request(app).get(`/api/games/${gameId}/blacklist`);

        expect(response.status).toBe(403);
      });
    });

    describe("DELETE /api/games/:gameId/blacklist/:id", () => {
      it("should remove a blacklist entry", async () => {
        vi.mocked(storage.getGame).mockResolvedValue(mockGame as any);
        vi.mocked(storage.removeReleaseBlacklist).mockResolvedValue(true);

        const response = await request(app).delete(`/api/games/${gameId}/blacklist/bl-1`);

        expect(response.status).toBe(204);
      });

      it("should return 404 when entry not found", async () => {
        vi.mocked(storage.getGame).mockResolvedValue(mockGame as any);
        vi.mocked(storage.removeReleaseBlacklist).mockResolvedValue(false);

        const response = await request(app).delete(`/api/games/${gameId}/blacklist/nonexistent`);

        expect(response.status).toBe(404);
      });

      it("should return 403 when game belongs to another user", async () => {
        vi.mocked(storage.getGame).mockResolvedValue({ ...mockGame, userId: "other-user" } as any);

        const response = await request(app).delete(`/api/games/${gameId}/blacklist/bl-1`);

        expect(response.status).toBe(403);
      });
    });

    describe("GET /api/blacklist", () => {
      it("should return all blacklist entries for the user", async () => {
        const entries = [{ ...blacklistEntry, gameTitle: "Test Game" }];
        vi.mocked(storage.getAllReleaseBlacklists).mockResolvedValue(entries as any);

        const response = await request(app).get("/api/blacklist");

        expect(response.status).toBe(200);
        expect(response.body).toHaveLength(1);
        expect(response.body[0].gameTitle).toBe("Test Game");
      });

      it("should return empty array when no entries", async () => {
        vi.mocked(storage.getAllReleaseBlacklists).mockResolvedValue([]);

        const response = await request(app).get("/api/blacklist");

        expect(response.status).toBe(200);
        expect(response.body).toEqual([]);
      });
    });
  });

  // ─── GET /api/games/:id/downloads ───
  describe("GET /api/games/:id/downloads", () => {
    const gameId = "123e4567-e89b-12d3-a456-426614174000";
    const mockGame = { id: gameId, userId: "user-1", title: "Test Game" };

    it("should return downloads for a game", async () => {
      const mockDownloads = [
        {
          id: "dl-1",
          gameId,
          downloaderId: "d-1",
          downloaderName: "qBit",
          downloadHash: "abc",
          downloadTitle: "Game-SKIDROW",
          status: "downloading",
          downloadType: "torrent",
          fileSize: null,
          addedAt: new Date(),
          completedAt: null,
        },
      ];
      vi.mocked(storage.getGame).mockResolvedValue(mockGame as any);
      vi.mocked(storage.getDownloadsByGameId).mockResolvedValue(mockDownloads as any);

      const response = await request(app).get(`/api/games/${gameId}/downloads`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(response.body[0].downloaderName).toBe("qBit");
      expect(storage.getDownloadsByGameId).toHaveBeenCalledWith(gameId);
    });

    it("should return empty array when game has no downloads", async () => {
      vi.mocked(storage.getGame).mockResolvedValue(mockGame as any);
      vi.mocked(storage.getDownloadsByGameId).mockResolvedValue([]);

      const response = await request(app).get(`/api/games/${gameId}/downloads`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });

    it("should return 400 for an invalid (non-UUID) game id", async () => {
      const response = await request(app).get("/api/games/not-a-valid-id/downloads");
      expect(response.status).toBe(400);
    });

    it("should return 500 when storage throws", async () => {
      vi.mocked(storage.getGame).mockResolvedValue(mockGame as any);
      vi.mocked(storage.getDownloadsByGameId).mockRejectedValue(new Error("DB error"));

      const response = await request(app).get(`/api/games/${gameId}/downloads`);

      expect(response.status).toBe(500);
      expect(response.body.error).toMatch(/failed to fetch game downloads/i);
    });
  });
});
