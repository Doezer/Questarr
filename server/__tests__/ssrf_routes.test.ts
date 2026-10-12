import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import express from "express";
import dns from "dns/promises";

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
vi.mock("../credential-crypto.js", () => ({
  encryptCredential: vi.fn(async (value: string) => value),
  decryptCredential: vi.fn(async (value: string) => value),
}));
vi.mock("../db.js", () => ({
  dialect: "sqlite",
  db: { get: vi.fn() },
  pool: { query: vi.fn() },
}));

vi.mock("../storage.js", () => ({
  storage: {
    countUsers: vi.fn().mockResolvedValue(1),
    getSystemConfig: vi.fn(),
    setSystemConfigBatch: vi.fn(),
    getAllIndexers: vi.fn().mockResolvedValue([]),
    updateIndexer: vi.fn(),
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

// Import registerRoutes AFTER mocking
import { registerRoutes } from "../routes.js";
import { storage } from "../storage.js";
import { prowlarrClient } from "../prowlarr.js";
import type { Indexer } from "../../shared/schema.js";

describe("SSRF Vulnerability in Routes", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  const createApp = async () => {
    app = express();
    app.use(express.json());
    await registerRoutes(app);
    return app;
  };

  const UNSAFE_URL = "http://169.254.169.254/latest/meta-data/";

  it("revokes old HTTP indexers before a replacement HTTPS sync overwrites saved settings", async () => {
    const oldUrl = "http://prowlarr.invalid:9696/base";
    const newUrl = "https://replacement.invalid/new-base";
    const settings = new Map([
      ["prowlarr.url", oldUrl],
      ["prowlarr.apiKey", "old-key"],
      ["prowlarr.syncDefaults", JSON.stringify({ allowInsecureLan: true })],
    ]);
    vi.mocked(storage.getSystemConfig).mockImplementation(async (key) => settings.get(key));
    vi.mocked(storage.setSystemConfigBatch).mockImplementation(async (entries) => {
      for (const { key, value } of entries) settings.set(key, value);
    });
    vi.mocked(storage.getAllIndexers).mockResolvedValue([
      { id: "old", url: `${oldUrl}/1/api`, apiKey: "old-key", allowInsecureLan: true },
      {
        id: "unrelated",
        url: "http://other:9696/1/api",
        apiKey: "old-key",
        allowInsecureLan: true,
      },
    ] as Indexer[]);
    vi.spyOn(dns, "lookup").mockResolvedValue([{ address: "10.0.0.2", family: 4 }] as never);
    vi.mocked(prowlarrClient.getIndexers).mockImplementationOnce(async () => {
      expect(storage.updateIndexer).toHaveBeenCalledExactlyOnceWith("old", {
        allowInsecureLan: false,
      });
      expect(JSON.parse(settings.get("prowlarr.syncDefaults")!).allowInsecureLan).toBe(false);
      return [];
    });
    const app = await createApp();
    const response = await request(app)
      .post("/api/indexers/prowlarr/sync")
      .send({ url: newUrl, apiKey: "new-key", allowInsecureLan: false });
    expect(response.status).toBe(200);
    expect(settings.get("prowlarr.url")).toBe(newUrl);
    expect(settings.get("prowlarr.apiKey")).toBe("new-key");
    expect(storage.syncIndexers).toHaveBeenCalled();
    vi.mocked(storage.getSystemConfig).mockReset();
    vi.mocked(storage.getAllIndexers).mockResolvedValue([]);
  });

  it.each([
    "http://PROWLARR.invalid:9696/base/",
    "prowlarr.invalid:9696/base",
    "http://prowlarr.invalid:9696/base///",
  ])("revokes with the saved-key placeholder for equivalent connection %s", async (url) => {
    const savedUrl = "http://prowlarr.invalid:9696/base";
    const settings = new Map([
      ["prowlarr.url", savedUrl],
      ["prowlarr.apiKey", "abc"],
      ["prowlarr.syncDefaults", JSON.stringify({ allowInsecureLan: true })],
    ]);
    vi.mocked(storage.getSystemConfig).mockImplementation(async (key) => settings.get(key));
    vi.mocked(storage.setSystemConfigBatch).mockImplementation(async (entries) => {
      for (const { key, value } of entries) settings.set(key, value);
    });
    vi.mocked(storage.getAllIndexers).mockResolvedValue([
      { id: "saved-indexer", url: `${savedUrl}/1/api`, apiKey: "abc", allowInsecureLan: true },
    ] as Indexer[]);
    vi.spyOn(dns, "lookup").mockResolvedValue([{ address: "10.0.0.2", family: 4 }] as never);
    vi.mocked(prowlarrClient.getIndexers).mockRejectedValueOnce(new Error("HTTP requires consent"));
    const app = await createApp();
    const response = await request(app)
      .post("/api/indexers/prowlarr/sync")
      .send({ url, apiKey: "********", allowInsecureLan: false });

    expect(response.status).toBe(500);
    expect(prowlarrClient.getIndexers).toHaveBeenCalledWith(url, "abc", expect.anything());
    expect(storage.updateIndexer).toHaveBeenCalledWith("saved-indexer", {
      allowInsecureLan: false,
    });
    expect(JSON.parse(settings.get("prowlarr.syncDefaults")!)).toEqual({
      allowInsecureLan: false,
      categories: [],
    });
    vi.mocked(storage.getSystemConfig).mockReset();
    vi.mocked(storage.getAllIndexers).mockResolvedValue([]);
  });

  it.each([
    "http://another.invalid:9696/base",
    "http://prowlarr.invalid:9696/other",
    "https://prowlarr.invalid:9696/base",
  ])("rejects saved-key reuse for a different connection %s", async (url) => {
    const settings = new Map([
      ["prowlarr.url", "http://prowlarr.invalid:9696/base"],
      ["prowlarr.apiKey", "abc"],
      ["prowlarr.syncDefaults", JSON.stringify({ allowInsecureLan: true })],
    ]);
    vi.mocked(storage.getSystemConfig).mockImplementation(async (key) => settings.get(key));
    const app = await createApp();
    const response = await request(app)
      .post("/api/indexers/prowlarr/sync")
      .send({ url, apiKey: "********", allowInsecureLan: false });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Enter the Prowlarr API key again for this URL");
    expect(storage.setSystemConfigBatch).not.toHaveBeenCalled();
    expect(storage.updateIndexer).not.toHaveBeenCalled();
    expect(prowlarrClient.getIndexers).not.toHaveBeenCalled();
    vi.mocked(storage.getSystemConfig).mockReset();
  });

  it.each(["http://[", "http://:9696", "http://prowlarr:bad"])(
    "returns 400 without changing saved consent when opting out with malformed URL %s",
    async (url) => {
      const settings = new Map([
        ["prowlarr.url", "http://prowlarr:9696"],
        ["prowlarr.apiKey", "abc"],
        ["prowlarr.syncDefaults", JSON.stringify({ allowInsecureLan: true })],
      ]);
      vi.mocked(storage.getSystemConfig).mockImplementation(async (key) => settings.get(key));
      const app = await createApp();
      const response = await request(app)
        .post("/api/indexers/prowlarr/sync")
        .send({ url, apiKey: "abc", allowInsecureLan: false });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("Invalid or unsafe URL");
      expect(storage.setSystemConfigBatch).not.toHaveBeenCalled();
      expect(storage.updateIndexer).not.toHaveBeenCalled();
      expect(prowlarrClient.getIndexers).not.toHaveBeenCalled();
      expect(storage.syncIndexers).not.toHaveBeenCalled();
    }
  );

  it("should allow unsafe URL in /api/indexers/prowlarr/sync (VULNERABILITY)", async () => {
    const app = await createApp();

    const response = await request(app)
      .post("/api/indexers/prowlarr/sync")
      .send({ url: UNSAFE_URL, apiKey: "abc" });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/Invalid or unsafe URL/);
  });

  it.each([
    { url: "http://127.0.0.1:9696", dnsResult: null, status: 500 },
    { url: "http://removed-prowlarr.invalid:9696", dnsResult: "throw", status: 500 },
    { url: "http://empty-prowlarr.invalid:9696", dnsResult: "empty", status: 400 },
    { url: "http://unsafe-prowlarr.invalid:9696", dnsResult: "unsafe", status: 400 },
  ])("persists HTTP opt-out when sync fails for $url", async ({ url, dnsResult, status }) => {
    const settings = new Map([
      ["prowlarr.url", url],
      ["prowlarr.apiKey", "abc"],
      [
        "prowlarr.syncDefaults",
        JSON.stringify({ allowInsecureLan: true, priority: 4, categories: ["4050"] }),
      ],
    ]);
    vi.mocked(storage.getSystemConfig).mockImplementation(async (key) => settings.get(key));
    vi.mocked(storage.setSystemConfigBatch).mockImplementation(async (entries) => {
      for (const { key, value } of entries) settings.set(key, value);
    });
    vi.mocked(storage.getAllIndexers).mockResolvedValue([
      { id: "saved-indexer", url: `${url}/1/api`, apiKey: "abc", allowInsecureLan: true },
    ] as Indexer[]);
    if (dnsResult) {
      vi.spyOn(dns, "lookup").mockImplementationOnce(async () => {
        // Exercise the real URL validator and prove local revocation happens first.
        expect(JSON.parse(settings.get("prowlarr.syncDefaults")!)).toMatchObject({
          allowInsecureLan: false,
        });
        if (dnsResult === "throw") {
          throw Object.assign(new Error("Prowlarr hostname no longer resolves"), {
            code: "ENOTFOUND",
          });
        }
        return dnsResult === "empty" ? [] : [{ address: "169.254.169.254", family: 4 }];
      });
    }
    if (!dnsResult || dnsResult === "throw") {
      vi.mocked(prowlarrClient.getIndexers).mockRejectedValueOnce(
        new Error("Refusing credential-bearing HTTP")
      );
    }
    const app = await createApp();
    const response = await request(app)
      .post("/api/indexers/prowlarr/sync")
      .send({ url, apiKey: "********", allowInsecureLan: false });
    expect(response.status).toBe(status);
    if (dnsResult) {
      expect(dns.lookup).toHaveBeenCalledWith(new URL(url).hostname, { all: true });
    }
    if (status === 400) {
      expect(prowlarrClient.getIndexers).not.toHaveBeenCalled();
    }
    expect(JSON.parse(settings.get("prowlarr.syncDefaults")!)).toMatchObject({
      allowInsecureLan: false,
      priority: 4,
      categories: ["4050"],
    });
    expect(storage.updateIndexer).toHaveBeenCalledWith("saved-indexer", {
      allowInsecureLan: false,
    });
    expect(storage.syncIndexers).not.toHaveBeenCalled();
    vi.mocked(storage.getSystemConfig).mockReset();
    vi.mocked(storage.getAllIndexers).mockResolvedValue([]);
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
