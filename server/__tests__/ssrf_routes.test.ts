import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import express from "express";

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
vi.mock("../db.js", () => ({
  db: { get: vi.fn() },
  pool: { query: vi.fn() },
}));

vi.mock("../storage.js", () => ({
  storage: {
    countUsers: vi.fn().mockResolvedValue(1),
    getSystemConfig: vi.fn(),
    syncIndexers: vi.fn().mockResolvedValue({ added: 0, updated: 0 }),
    getUser: vi.fn(),
    getIndexer: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock("../igdb.js", () => ({
  igdbClient: {
    getPopularGames: vi.fn(),
  },
}));

vi.mock("../torznab.js", () => ({
  torznabClient: {
    testConnection: vi.fn().mockResolvedValue({ success: true, message: "Connected" }),
  },
}));

vi.mock("../prowlarr.js", () => ({
  prowlarrClient: {
    getIndexers: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../rss.js", () => ({
  rssService: {
    refreshFeed: vi.fn(),
    refreshFeeds: vi.fn(),
  },
}));

vi.mock("../config.js", () => ({
  config: mockConfig,
}));

// Mock auth middleware to bypass authentication for these tests
vi.mock("../auth.js", () => ({
  hashPassword: vi.fn(),
  comparePassword: vi.fn(),
  generateToken: vi.fn(),
  authenticateToken: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    (req as express.Request & { user: { id: string; username: string } }).user = {
      id: "test-user-id",
      username: "testuser",
    };
    next();
  },
}));

// Import registerRoutes AFTER mocking
import { registerRoutes } from "../routes.js";

describe("SSRF Vulnerability in Routes", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetModules();
  });

  const createApp = async () => {
    app = express();
    app.use(express.json());
    await registerRoutes(app);
    return app;
  };

  const UNSAFE_URL = "http://169.254.169.254/latest/meta-data/";

  it("should allow unsafe URL in /api/indexers/prowlarr/sync (VULNERABILITY)", async () => {
    const app = await createApp();

    const response = await request(app)
      .post("/api/indexers/prowlarr/sync")
      .send({ url: UNSAFE_URL, apiKey: "abc" });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/Invalid or unsafe URL/);
  });

  it("should block unsafe URL in /api/indexers/test", async () => {
    const app = await createApp();

    const response = await request(app).post("/api/indexers/test").send({
      url: UNSAFE_URL,
      apiKey: "abc",
      name: "Test Indexer",
    });

    // Expect 400 (Vulnerability fixed)
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/Invalid or unsafe URL/);
  });
});
