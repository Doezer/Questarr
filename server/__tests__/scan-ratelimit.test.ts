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
  createNewznabMock,
  createProwlarrMock,
  createXrelMock,
  createDownloaderManagerMock,
  createSteamRoutesMock,
  createSearchMock,
  createConfigLoaderMock,
  createSocketMock,
} from "./fixtures/common-route-mocks.js";
import { registerRoutes } from "../routes.js";
import { storage } from "../storage.js";
import { scanRateLimiter } from "../middleware.js";

vi.mock("../storage.js", () => ({ storage: createStorageMock() }));
vi.mock("../igdb.js", () => ({ igdbClient: createIgdbMock() }));
vi.mock("../auth.js", () => createAuthMock());
vi.mock("../db.js", () => ({ db: createDbMock() }));
vi.mock("../logger.js", () => createLoggerMocks());
vi.mock("../rss.js", () => ({ rssService: createRssMock() }));
vi.mock("../torznab.js", () => ({ torznabClient: createTorznabMock() }));
vi.mock("../newznab.js", () => ({ newznabClient: createNewznabMock() }));
vi.mock("../prowlarr.js", () => ({ prowlarrClient: createProwlarrMock() }));
vi.mock("../xrel.js", () => ({ xrelClient: createXrelMock() }));
vi.mock("../downloaders.js", () => ({ DownloaderManager: createDownloaderManagerMock() }));
vi.mock("../steam-routes.js", () => ({ steamRoutes: createSteamRoutesMock() }));
vi.mock("../search.js", () => createSearchMock());
vi.mock("../config.js", () => ({ config: mockConfig }));
vi.mock("../config-loader.js", () => ({ configLoader: createConfigLoaderMock() }));
vi.mock("../socket.js", () => createSocketMock());

const gameId = "123e4567-e89b-12d3-a456-426614174000";

describe("GET /api/games/:gameId/files rate limiting", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    // express-rate-limit keeps its hit counts in a module-level MemoryStore,
    // so each test must start from a clean quota for the mocked user:
    scanRateLimiter.resetKey("user:user-1");
    app = express();
    app.set("trust proxy", 1);
    app.use(express.json());
    await registerRoutes(app);

    // Every scan resolves to a 404 quickly; only the rate limiter behavior matters here.
    vi.mocked(storage.getGame).mockResolvedValue(undefined);
  });

  it("returns 429 after exceeding the per-user scan rate limit", async () => {
    let lastStatus = 0;
    // scanRateLimiter allows 10 requests per minute per user; the 11th should be rejected.
    for (let i = 0; i < 11; i++) {
      const response = await request(app).get(`/api/games/${gameId}/files`);
      lastStatus = response.status;
    }

    expect(lastStatus).toBe(429);
  });

  it("includes the standard rate limit headers", async () => {
    const response = await request(app).get(`/api/games/${gameId}/files`);

    expect(response.headers["ratelimit-limit"]).toBe("10");
    expect(response.headers["ratelimit-remaining"]).toBe("9");
  });
});
