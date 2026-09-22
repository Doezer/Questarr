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

// Only mock the storage methods used by TypeSafe settings routes
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

vi.mock("../typesafe.js", () => ({
  typesafeClient: {
    isConfigured: vi.fn().mockResolvedValue(false),
    configure: vi.fn(),
    analyzeRelease: vi.fn().mockResolvedValue(null),
  },
  TYPESAFE_URL_CONFIG_KEY: "typesafe.apiUrl",
  TYPESAFE_KEY_CONFIG_KEY: "typesafe.apiKey",
}));

vi.mock("../credential-crypto.js", () => ({
  encryptCredential: vi.fn(async (value: string) => `enc:v1:${value}`),
  decryptCredential: vi.fn(async (value: string) => value),
}));

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
  expressLogger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  },
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
  enrichWithAiAnalysis: (items: unknown[]) => Promise.resolve(items),
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

describe("TypeSafe Settings Routes", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    await registerRoutes(app);
  });

  async function getStorageMock() {
    const mod = await import("../storage.js");
    return mod.storage;
  }

  async function getTypesafeMock() {
    const mod = await import("../typesafe.js");
    return mod.typesafeClient;
  }

  describe("GET /api/settings/typesafe", () => {
    it("returns configured: false when no key is stored", async () => {
      const storageMock = await getStorageMock();
      vi.mocked(storageMock.getSystemConfig).mockResolvedValue(undefined);

      const res = await request(app).get("/api/settings/typesafe");
      expect(res.status).toBe(200);
      expect(res.body.configured).toBe(false);
      expect(res.body.apiUrl).toBeUndefined();
    });

    it("returns configured: true and the stored URL when a key is present", async () => {
      const storageMock = await getStorageMock();
      vi.mocked(storageMock.getSystemConfig).mockImplementation(async (key: string) => {
        if (key === "typesafe.apiUrl") return "https://api.typesafe.ai/v1/systemone";
        if (key === "typesafe.apiKey") return "enc:v1:abc";
        return undefined;
      });

      const res = await request(app).get("/api/settings/typesafe");
      expect(res.status).toBe(200);
      expect(res.body.configured).toBe(true);
      expect(res.body.apiUrl).toBe("https://api.typesafe.ai/v1/systemone");
    });
  });

  describe("POST /api/settings/typesafe", () => {
    it("saves the API key (encrypted) and URL, then configures the client", async () => {
      const storageMock = await getStorageMock();
      const typesafeMock = await getTypesafeMock();
      vi.mocked(storageMock.setSystemConfig).mockResolvedValue(undefined);

      const res = await request(app)
        .post("/api/settings/typesafe")
        .send({ apiUrl: "https://api.typesafe.ai/v1/systemone", apiKey: "my-key" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(storageMock.setSystemConfig).toHaveBeenCalledWith(
        "typesafe.apiUrl",
        "https://api.typesafe.ai/v1/systemone"
      );
      expect(storageMock.setSystemConfig).toHaveBeenCalledWith("typesafe.apiKey", "enc:v1:my-key");
      expect(typesafeMock.configure).toHaveBeenCalledWith(
        "https://api.typesafe.ai/v1/systemone",
        "my-key"
      );
    });

    it("returns 400 when API key is empty", async () => {
      const res = await request(app).post("/api/settings/typesafe").send({ apiKey: "" });
      expect(res.status).toBe(400);
    });

    it("returns 400 when API key is missing", async () => {
      const res = await request(app).post("/api/settings/typesafe").send({});
      expect(res.status).toBe(400);
    });

    it("returns 400 when the API URL is unsafe", async () => {
      const { isSafeUrl } = await import("../ssrf.js");
      vi.mocked(isSafeUrl).mockResolvedValueOnce(false);

      const res = await request(app)
        .post("/api/settings/typesafe")
        .send({ apiUrl: "http://169.254.169.254/", apiKey: "my-key" });

      expect(res.status).toBe(400);
    });

    it("saves without a URL (falls back to the client's default)", async () => {
      const storageMock = await getStorageMock();
      vi.mocked(storageMock.setSystemConfig).mockResolvedValue(undefined);

      const res = await request(app).post("/api/settings/typesafe").send({ apiKey: "my-key" });

      expect(res.status).toBe(200);
      expect(storageMock.setSystemConfig).toHaveBeenCalledWith("typesafe.apiUrl", "");
    });
  });

  describe("DELETE /api/settings/typesafe", () => {
    it("clears stored config and de-configures the client", async () => {
      const storageMock = await getStorageMock();
      const typesafeMock = await getTypesafeMock();
      vi.mocked(storageMock.setSystemConfig).mockResolvedValue(undefined);

      const res = await request(app).delete("/api/settings/typesafe");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(storageMock.setSystemConfig).toHaveBeenCalledWith("typesafe.apiUrl", "");
      expect(storageMock.setSystemConfig).toHaveBeenCalledWith("typesafe.apiKey", "");
      expect(typesafeMock.configure).toHaveBeenCalledWith(null, null);
    });
  });
});
