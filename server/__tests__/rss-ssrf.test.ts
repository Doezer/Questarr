import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import { registerRoutes } from "../routes.js";
import { storage } from "../storage.js";
import { rssService } from "../rss.js";

// Mock dependencies
vi.mock("../storage.js");
vi.mock("../rss.js");
vi.mock("../igdb.js");
vi.mock("../db.js");
vi.mock("../torznab.js");
vi.mock("../downloaders.js");
vi.mock("../prowlarr.js");
vi.mock("../steam-routes.js", () => ({
  steamRoutes: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../auth.js", () => ({
  authenticateToken: (
    req: import("express").Request & { user?: unknown },
    res: import("express").Response,
    next: import("express").NextFunction
  ) => {
    req.user = { id: 1, username: "testuser" };
    next();
  },
  hashPassword: vi.fn(),
  comparePassword: vi.fn(),
  generateToken: vi.fn(),
}));

vi.mock("../logger.js", () => ({
  routesLogger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: () => ({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    }),
  },
  igdbLogger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../middleware.js", () => ({
  igdbRateLimiter: (
    req: import("express").Request,
    res: import("express").Response,
    next: import("express").NextFunction
  ) => next(),
  sensitiveEndpointLimiter: (
    req: import("express").Request,
    res: import("express").Response,
    next: import("express").NextFunction
  ) => next(),
  authRateLimiter: (
    req: import("express").Request,
    res: import("express").Response,
    next: import("express").NextFunction
  ) => next(),
  validateRequest: (
    req: import("express").Request,
    res: import("express").Response,
    next: import("express").NextFunction
  ) => next(),
  sanitizeSearchQuery: [],
  sanitizeGameId: [],
  sanitizeIgdbId: [],
  sanitizeGameStatus: [],
  sanitizeGameData: [],
  sanitizeIndexerData: [],
  sanitizeIndexerUpdateData: [],
  sanitizeDownloaderData: [],
  sanitizeDownloaderUpdateData: [],
  sanitizeDownloaderDownloadData: [],
  sanitizeIndexerSearchQuery: [],
}));

describe("RSS Routes SSRF", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    await registerRoutes(app);
  });

  // Since the app defaults to allowing private IPs (for self-hosted services),
  // we check that it BLOCKS known dangerous metadata IPs.
  it("should prevent SSRF by blocking metadata service", async () => {
    const unsafeFeed = {
      name: "Metadata Feed",
      url: "http://169.254.169.254/latest/meta-data/",
      type: "custom",
      enabled: true,
    };

    // Mock storage success to ensure route handler is the one blocking
    vi.mocked(storage.addRssFeed).mockResolvedValue({
      ...unsafeFeed,
      id: "2",
    } as unknown as import("../../shared/schema").RssFeed);
    vi.mocked(rssService.refreshFeed).mockResolvedValue(undefined);

    const res = await request(app).post("/api/rss/feeds").send(unsafeFeed);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/unsafe/i);
  });

  it("should allow safe public URLs", async () => {
    const safeFeed = {
      name: "Safe Feed",
      url: "http://example.com/rss",
      type: "custom",
      enabled: true,
    };

    vi.mocked(storage.addRssFeed).mockResolvedValue({
      ...safeFeed,
      id: "3",
    } as unknown as import("../../shared/schema").RssFeed);
    vi.mocked(rssService.refreshFeed).mockResolvedValue(undefined);

    const res = await request(app).post("/api/rss/feeds").send(safeFeed);

    expect(res.status).toBe(201);
  });

  it("should prevent SSRF by blocking metadata service on feed update (PUT)", async () => {
    const unsafeUpdate = {
      url: "http://169.254.169.254/latest/meta-data/",
      enabled: true,
    };

    // Note: mock for storage.updateRssFeed should be established if it's used
    vi.mocked(storage.updateRssFeed).mockResolvedValue({
      id: "2",
      ...unsafeUpdate,
    } as unknown as import("../../shared/schema").RssFeed);
    vi.mocked(storage.getRssFeed).mockResolvedValue({
      id: "2",
      name: "Existing",
      url: "http://safe.com",
    } as unknown as import("../../shared/schema").RssFeed);

    const res = await request(app).put("/api/rss/feeds/2").send(unsafeUpdate);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/unsafe/i);
  });

  it("should allow safe public URLs on feed update (PUT)", async () => {
    const safeUpdate = {
      url: "http://example.com/rss/new",
      enabled: true,
    };

    vi.mocked(storage.updateRssFeed).mockResolvedValue({
      id: "3",
      ...safeUpdate,
    } as unknown as import("../../shared/schema").RssFeed);
    vi.mocked(storage.getRssFeed).mockResolvedValue({
      id: "3",
      name: "Existing",
      url: "http://safe.com",
    } as unknown as import("../../shared/schema").RssFeed);
    vi.mocked(rssService.refreshFeed).mockResolvedValue(undefined);

    const res = await request(app).put("/api/rss/feeds/3").send(safeUpdate);

    // Depending on the implementation, it might return 200 or 201, typical for update is 200
    // We just want to ensure it doesn't return 400 for unsafe URL
    expect(res.status).not.toBe(400);
  });
});
