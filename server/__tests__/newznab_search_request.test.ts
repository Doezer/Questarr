import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import express from "express";
import request from "supertest";
import {
  mockConfig,
  createStorageMock,
  createIgdbMock,
  createAuthMock,
  createDbModuleMock,
  createLoggerMocks,
  createRssMock,
  createTorznabMock,
  createProwlarrMock,
  createXrelMock,
  createAppriseMock,
  createDownloaderManagerMock,
  createSteamRoutesMock,
  createConfigLoaderMock,
  createSocketMock,
} from "./fixtures/common-route-mocks.js";
import type { Indexer } from "../../shared/schema.js";

// Full UI -> server -> Newznab regression: boot the real aggregated search route
// and the real Newznab client, and inspect the outgoing HTTP request. Deliberately
// does NOT mock ../search.js or ../newznab.js so the whole path is exercised.
vi.mock("../storage.js", () => ({ storage: createStorageMock() }));
vi.mock("../igdb.js", () => ({ igdbClient: createIgdbMock() }));
vi.mock("../auth.js", () => createAuthMock());
vi.mock("../db.js", () => createDbModuleMock());
vi.mock("../logger.js", () => createLoggerMocks());
vi.mock("../rss.js", () => ({ rssService: createRssMock() }));
vi.mock("../torznab.js", () => ({ torznabClient: createTorznabMock() }));
vi.mock("../prowlarr.js", () => ({ prowlarrClient: createProwlarrMock() }));
vi.mock("../xrel.js", () => createXrelMock());
vi.mock("../apprise.js", async () => createAppriseMock());
vi.mock("../downloaders.js", () => ({ DownloaderManager: createDownloaderManagerMock() }));
vi.mock("../steam-routes.js", () => ({ steamRoutes: createSteamRoutesMock() }));
vi.mock("../config.js", () => ({ config: mockConfig }));
vi.mock("../config-loader.js", () => ({ configLoader: createConfigLoaderMock() }));
vi.mock("../socket.js", () => createSocketMock());
vi.mock("../typesafe.js", () => ({
  typesafeClient: { isConfigured: vi.fn().mockResolvedValue(false), analyzeRelease: vi.fn() },
}));
vi.mock("../ssrf.js", () => ({ isSafeUrl: vi.fn(), safeFetch: vi.fn() }));
vi.mock("../middleware.js", async () => {
  const actual = await vi.importActual<typeof import("../middleware.js")>("../middleware.js");
  return {
    ...actual,
    sensitiveEndpointLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
    authRateLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  };
});

import { registerRoutes } from "../routes.js";
import { storage } from "../storage.js";
import { isSafeUrl, safeFetch } from "../ssrf.js";

const emptySearchXml = `<?xml version="1.0"?><rss><channel></channel></rss>`;

const makeNewznabIndexer = (categories: string[]): Indexer =>
  ({
    id: "nz-1",
    name: "My Newznab",
    url: "http://example.com/api",
    apiKey: "secret",
    protocol: "newznab",
    enabled: true,
    priority: 1,
    categories,
    rssEnabled: true,
    autoSearchEnabled: true,
    allowInsecureLan: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  }) as Indexer;

describe("Newznab two-category search request (UI -> server -> Newznab)", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    (isSafeUrl as Mock).mockResolvedValue(true);
    (safeFetch as Mock).mockResolvedValue({ ok: true, text: async () => emptySearchXml });
    app = express();
    app.use(express.json());
    await registerRoutes(app);
  });

  it("sends both configured categories in the Newznab `cat` param", async () => {
    vi.mocked(storage.getEnabledIndexers).mockResolvedValue([
      makeNewznabIndexer(["4050", "1000"]),
    ] as never);

    const res = await request(app).get("/api/search?query=Some+Game");
    expect(res.status).toBe(200);

    const [url] = (safeFetch as Mock).mock.calls[0] as [string];
    expect(url).toContain("cat=4050,1000");
    expect(new URL(url).searchParams.get("cat")?.split(",")).toEqual(["4050", "1000"]);
  });

  it("keeps single-category searches unchanged", async () => {
    vi.mocked(storage.getEnabledIndexers).mockResolvedValue([
      makeNewznabIndexer(["4050"]),
    ] as never);

    const res = await request(app).get("/api/search?query=Some+Game");
    expect(res.status).toBe(200);

    const [url] = (safeFetch as Mock).mock.calls[0] as [string];
    expect(url).toContain("cat=4050");
    expect(new URL(url).searchParams.get("cat")).toBe("4050");
  });

  it("does not rewrite a comma in the user's search query", async () => {
    vi.mocked(storage.getEnabledIndexers).mockResolvedValue([
      makeNewznabIndexer(["4050", "1000"]),
    ] as never);

    const res = await request(app).get("/api/search?query=Hello%2C+World");
    expect(res.status).toBe(200);

    const [url] = (safeFetch as Mock).mock.calls[0] as [string];
    // cat separators stay literal...
    expect(url).toContain("cat=4050,1000");
    // ...while the comma inside q keeps its normal URL encoding.
    expect(url).toContain("q=Hello%2C+World");
    expect(url).not.toContain("q=Hello,+World");
    expect(new URL(url).searchParams.get("q")).toBe("Hello, World");
  });
});
