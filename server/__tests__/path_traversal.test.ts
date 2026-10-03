import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import express from "express";
import fs from "fs";
import os from "os";
import path from "path";

// Use vi.hoisted to create the mock object
const { mockConfig } = vi.hoisted(() => {
  return {
    mockConfig: {
      server: {
        isProduction: false,
        allowedOrigins: [],
      },
      rawg: { apiKey: undefined },
      nexusmods: {
        apiKey: undefined,
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
  dialect: "sqlite",
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

vi.mock("../rawg.js", () => ({
  rawgClient: {
    isConfigured: vi.fn().mockResolvedValue(false),
    searchGames: vi.fn().mockResolvedValue([]),
    formatGame: vi.fn((g: unknown) => g),
    getPopularGames: vi.fn().mockResolvedValue([]),
    getRecentReleases: vi.fn().mockResolvedValue([]),
    getUpcomingReleases: vi.fn().mockResolvedValue([]),
    getGamesByGenre: vi.fn().mockResolvedValue([]),
    getGamesByPlatform: vi.fn().mockResolvedValue([]),
    getGenres: vi.fn().mockResolvedValue([]),
    getPlatforms: vi.fn().mockResolvedValue([]),
    getGameById: vi.fn(),
    getGamesByIds: vi.fn().mockResolvedValue([]),
    getGamesForRefresh: vi.fn().mockResolvedValue(new Map()),
    batchSearchGames: vi.fn().mockResolvedValue(new Map()),
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
  optionalAuthenticateToken: (
    _req: express.Request,
    _res: express.Response,
    next: express.NextFunction
  ) => {
    next();
  },
}));

vi.mock("../steam-routes.js", () => ({
  steamRoutes: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../steam-routes.js", () => ({
  steamRoutes: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const { mockValidateCertFiles } = vi.hoisted(() => ({
  mockValidateCertFiles: vi.fn(),
}));

vi.mock("../ssl.js", () => ({
  validateCertFiles: mockValidateCertFiles,
}));

// Import registerRoutes AFTER mocking
import { registerRoutes } from "../routes.js";
import { configLoader } from "../config-loader.js";

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

  it("validates the root-contained cert/key paths, not the raw request values", async () => {
    mockValidateCertFiles.mockResolvedValue({ valid: false, error: "stop here" });
    const app = await createApp();
    const root = fs.realpathSync(process.cwd());

    const response = await request(app).patch("/api/settings/ssl").send({
      enabled: true,
      port: 9898,
      certPath: "config/ssl/server.crt",
      keyPath: "config/ssl/server.key",
    });

    expect(response.status).toBe(400);
    expect(mockValidateCertFiles).toHaveBeenCalledWith(
      path.resolve(root, "config/ssl/server.crt"),
      path.resolve(root, "config/ssl/server.key")
    );
  });

  it("saves the root-contained cert/key paths after successful validation", async () => {
    mockValidateCertFiles.mockResolvedValue({ valid: true });
    const saveConfig = vi.spyOn(configLoader, "saveConfig").mockResolvedValue(undefined);
    try {
      const app = await createApp();
      const root = fs.realpathSync(process.cwd());

      const response = await request(app).patch("/api/settings/ssl").send({
        enabled: true,
        port: 9898,
        certPath: "config/ssl/server.crt",
        keyPath: "config/ssl/server.key",
      });

      expect(response.status).toBe(200);
      expect(saveConfig).toHaveBeenCalledWith({
        ssl: expect.objectContaining({
          certPath: path.resolve(root, "config/ssl/server.crt"),
          keyPath: path.resolve(root, "config/ssl/server.key"),
        }),
      });
    } finally {
      saveConfig.mockRestore();
    }
  });

  it("rejects a cert path that is a symlink inside the root pointing outside it", async () => {
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "questarr-ssl-outside-"));
    const insideDir = fs.mkdtempSync(path.join(process.cwd(), ".tmp-ssl-symlink-"));
    try {
      fs.writeFileSync(path.join(outsideDir, "secret.pem"), "not a cert");
      fs.symlinkSync(path.join(outsideDir, "secret.pem"), path.join(insideDir, "cert.pem"));
      fs.symlinkSync(outsideDir, path.join(insideDir, "linked-dir"));
      const app = await createApp();

      const fileLink = await request(app)
        .patch("/api/settings/ssl")
        .send({
          enabled: true,
          port: 9898,
          certPath: path.relative(process.cwd(), path.join(insideDir, "cert.pem")),
          keyPath: "config/ssl/server.key",
        });
      expect(fileLink.status).toBe(403);
      expect(fileLink.body.error).toMatch(/Access to cert path is not allowed/);

      const dirLink = await request(app)
        .patch("/api/settings/ssl")
        .send({
          enabled: false,
          port: 9898,
          certPath: path.relative(process.cwd(), path.join(insideDir, "linked-dir", "new.pem")),
        });
      expect(dirLink.status).toBe(403);

      const missingUnderLink = await request(app)
        .patch("/api/settings/ssl")
        .send({
          enabled: false,
          port: 9898,
          certPath: path.relative(
            process.cwd(),
            path.join(insideDir, "linked-dir", "not-yet", "new.pem")
          ),
        });
      expect(missingUnderLink.status).toBe(403);
      expect(mockValidateCertFiles).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(insideDir, { recursive: true, force: true });
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });
});
