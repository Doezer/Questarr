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

// Only mock the storage methods used by NexusMods routes
vi.mock("../storage.js", () => ({
  storage: {
    getSystemConfig: vi.fn(),
    setSystemConfig: vi.fn(),
    countUsers: vi.fn().mockResolvedValue(1),
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
    getConfigDir: vi.fn().mockReturnValue("/tmp/config"), // NOSONAR - test-only mock path
  },
}));
vi.mock("../socket.js", () => ({ notifyUser: vi.fn() }));
vi.mock("../ssrf.js", () => ({ isSafeUrl: vi.fn().mockResolvedValue(true), safeFetch: vi.fn() }));

// ── Tests ────────────────────────────────────────────────────────────────────

describe("NexusMods Routes", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    await registerRoutes(app);
  });

  // Helper: get the mocked nexusmods client
  async function getNexusMock() {
    const mod = await import("../nexusmods.js");
    return mod.nexusmodsClient;
  }

  // Helper: get the mocked storage
  async function getStorageMock() {
    const mod = await import("../storage.js");
    return mod.storage;
  }

  // ── GET /api/settings/nexusmods ─────────────────────────────────────────────

  describe("GET /api/settings/nexusmods", () => {
    it("returns configured: false when API key is not set", async () => {
      const storageMock = await getStorageMock();
      vi.mocked(storageMock.getSystemConfig).mockResolvedValue(undefined);
      const nexusMock = await getNexusMock();
      vi.mocked(nexusMock.isConfigured).mockReturnValue(false);

      const res = await request(app).get("/api/settings/nexusmods");
      expect(res.status).toBe(200);
      expect(res.body.configured).toBe(false);
    });

    it("returns configured: true and source: database when DB key is set", async () => {
      const storageMock = await getStorageMock();
      vi.mocked(storageMock.getSystemConfig).mockResolvedValue("db-api-key");
      const nexusMock = await getNexusMock();
      vi.mocked(nexusMock.isConfigured).mockReturnValue(true);

      const res = await request(app).get("/api/settings/nexusmods");
      expect(res.status).toBe(200);
      expect(res.body.configured).toBe(true);
      expect(res.body.source).toBe("database");
    });
  });

  // ── POST /api/settings/nexusmods ────────────────────────────────────────────

  describe("POST /api/settings/nexusmods", () => {
    it("saves API key and returns success", async () => {
      const storageMock = await getStorageMock();
      vi.mocked(storageMock.setSystemConfig).mockResolvedValue(undefined);

      const res = await request(app)
        .post("/api/settings/nexusmods")
        .send({ apiKey: "valid-api-key" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(storageMock.setSystemConfig).toHaveBeenCalledWith("nexusmods.apiKey", "valid-api-key");
    });

    it("returns 400 when API key is empty", async () => {
      const res = await request(app).post("/api/settings/nexusmods").send({ apiKey: "" });
      expect(res.status).toBe(400);
    });

    it("returns 400 when API key is missing", async () => {
      const res = await request(app).post("/api/settings/nexusmods").send({});
      expect(res.status).toBe(400);
    });
  });

  // ── GET /api/nexusmods/game-domain ──────────────────────────────────────────

  describe("GET /api/nexusmods/game-domain", () => {
    it("returns configured: false when not configured", async () => {
      const nexusMock = await getNexusMock();
      vi.mocked(nexusMock.isConfigured).mockReturnValue(false);

      const res = await request(app)
        .get("/api/nexusmods/game-domain")
        .query({ title: "Witcher 3" });

      expect(res.status).toBe(200);
      expect(res.body.configured).toBe(false);
      expect(res.body.domain).toBeNull();
    });

    it("returns domain when configured and game found", async () => {
      const nexusMock = await getNexusMock();
      vi.mocked(nexusMock.isConfigured).mockReturnValue(true);
      vi.mocked(nexusMock.findGameDomain).mockResolvedValue("witcher3");

      const res = await request(app)
        .get("/api/nexusmods/game-domain")
        .query({ title: "The Witcher 3" });

      expect(res.status).toBe(200);
      expect(res.body.configured).toBe(true);
      expect(res.body.domain).toBe("witcher3");
    });

    it("returns domain: null when configured but game not found", async () => {
      const nexusMock = await getNexusMock();
      vi.mocked(nexusMock.isConfigured).mockReturnValue(true);
      vi.mocked(nexusMock.findGameDomain).mockResolvedValue(null);

      const res = await request(app)
        .get("/api/nexusmods/game-domain")
        .query({ title: "UnknownGame12345" });

      expect(res.status).toBe(200);
      expect(res.body.configured).toBe(true);
      expect(res.body.domain).toBeNull();
    });

    it("returns 400 when title param is missing", async () => {
      const res = await request(app).get("/api/nexusmods/game-domain");
      expect(res.status).toBe(400);
    });
  });

  // ── GET /api/nexusmods/trending-mods ────────────────────────────────────────

  describe("GET /api/nexusmods/trending-mods", () => {
    const mockMods = [
      {
        mod_id: 1,
        name: "Mod A",
        summary: "Summary",
        picture_url: "https://example.com/img.jpg",
        mod_downloads: 1000,
        mod_unique_downloads: 800,
        endorsement_count: 500,
        version: "1.0",
        updated_timestamp: 1700000000,
        domain_name: "witcher3",
        user: { name: "Author" },
      },
    ];

    it("returns trending mods for a valid domain", async () => {
      const nexusMock = await getNexusMock();
      vi.mocked(nexusMock.getTrendingMods).mockResolvedValue(mockMods);

      const res = await request(app)
        .get("/api/nexusmods/trending-mods")
        .query({ domain: "witcher3" });

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].mod_id).toBe(1);
    });

    it("returns 400 when domain param is missing", async () => {
      const res = await request(app).get("/api/nexusmods/trending-mods");
      expect(res.status).toBe(400);
    });

    it("respects limit query param", async () => {
      const nexusMock = await getNexusMock();
      vi.mocked(nexusMock.getTrendingMods).mockResolvedValue(mockMods);

      await request(app)
        .get("/api/nexusmods/trending-mods")
        .query({ domain: "witcher3", limit: "5" });

      expect(nexusMock.getTrendingMods).toHaveBeenCalledWith("witcher3", 5);
    });
  });
});
