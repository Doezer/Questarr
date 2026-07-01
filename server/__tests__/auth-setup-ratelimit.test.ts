import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import {
  mockConfig,
  createStorageMock,
  createIgdbMock,
  createAuthMock,
  createDbMock,
  createLoggerMocks,
  createRssMock,
  createTorznabMock,
  createProwlarrMock,
  createXrelMock,
  createDownloaderManagerMock,
  createSteamRoutesMock,
  createSearchMock,
  createConfigLoaderMock,
  createSocketMock,
} from "./fixtures/common-route-mocks.js";
import { registerRoutes } from "../routes.js";

// This file exercises /api/auth/setup in an isolated app/module registry so that
// repeatedly tripping its rate limiter here cannot bleed into api_routes.test.ts's
// shared authRateLimiter state (which also backs /api/auth/login). Mock factory bodies
// live in ./fixtures/common-route-mocks.ts, shared with api_routes.test.ts.
vi.mock("../storage.js", () => ({ storage: createStorageMock() }));
vi.mock("../igdb.js", () => ({ igdbClient: createIgdbMock() }));
vi.mock("../auth.js", () => createAuthMock());
vi.mock("../db.js", () => ({ db: createDbMock() }));
vi.mock("../logger.js", () => createLoggerMocks());
vi.mock("../rss.js", () => ({ rssService: createRssMock() }));
vi.mock("../torznab.js", () => ({ torznabClient: createTorznabMock() }));
vi.mock("../prowlarr.js", () => ({ prowlarrClient: createProwlarrMock() }));
vi.mock("../xrel.js", () => createXrelMock());
vi.mock("../downloaders.js", () => ({ DownloaderManager: createDownloaderManagerMock() }));
vi.mock("../steam-routes.js", () => ({ steamRoutes: createSteamRoutesMock() }));
vi.mock("../search.js", () => createSearchMock());
vi.mock("../config.js", () => ({ config: mockConfig }));
vi.mock("../config-loader.js", () => ({ configLoader: createConfigLoaderMock() }));
vi.mock("../socket.js", () => createSocketMock());

describe("POST /api/auth/setup rate limiting", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    await registerRoutes(app);
  });

  it("returns 429 after exceeding the auth rate limit", async () => {
    const payload = { username: "admin", password: "password123" };

    let lastStatus = 0;
    // authRateLimiter allows 20 requests per 15 minutes per IP; the 21st should be rejected.
    for (let i = 0; i < 21; i++) {
      const res = await request(app).post("/api/auth/setup").send(payload);
      lastStatus = res.status;
    }

    expect(lastStatus).toBe(429);
  });
});
