import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import express from "express";
import path from "path";

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
    getUser: vi.fn(),
  },
}));

vi.mock("../igdb.js", () => ({
  igdbClient: {
    getPopularGames: vi.fn(),
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
  authenticateToken: (req: any, res: any, next: any) => {
    req.user = { id: "test-user-id", username: "testuser" };
    next();
  },
}));

// Import registerRoutes AFTER mocking
import { registerRoutes } from "../routes.js";

describe("Path Traversal Vulnerability in Routes", () => {
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

  it("should block path traversal in /api/system/filesystem", async () => {
    const app = await createApp();

    const response = await request(app).get("/api/system/filesystem?path=../../../../etc/passwd");

    expect(response.status).toBe(403);
    expect(response.body.error).toMatch(/Access to this path is not allowed/);
  });

  it("should block path traversal in /api/settings/ssl for certPath", async () => {
    const app = await createApp();

    const response = await request(app).patch("/api/settings/ssl").send({
      enabled: true,
      port: 9898,
      certPath: "../../../../etc/passwd",
      keyPath: "config/ssl/server.key",
    });

    expect(response.status).toBe(403);
    expect(response.body.error).toMatch(/Access to cert path is not allowed/);
  });

  it("should block path traversal in /api/settings/ssl for keyPath", async () => {
    const app = await createApp();

    const response = await request(app).patch("/api/settings/ssl").send({
      enabled: true,
      port: 9898,
      certPath: "config/ssl/server.crt",
      keyPath: "../../../../etc/passwd",
    });

    expect(response.status).toBe(403);
    expect(response.body.error).toMatch(/Access to key path is not allowed/);
  });
});
