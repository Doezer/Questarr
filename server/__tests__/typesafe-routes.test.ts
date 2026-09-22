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

// Mock factory bodies live in ./fixtures/common-route-mocks.ts, shared across route suites.
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
vi.mock("../ssrf.js", () => ({ isSafeUrl: vi.fn().mockResolvedValue(true), safeFetch: vi.fn() }));

vi.mock("../typesafe.js", () => ({
  typesafeClient: {
    isConfigured: vi.fn().mockResolvedValue(false),
    configure: vi.fn(),
    invalidate: vi.fn(),
    analyzeRelease: vi.fn().mockResolvedValue(null),
  },
  TYPESAFE_URL_CONFIG_KEY: "typesafe.apiUrl",
  TYPESAFE_KEY_CONFIG_KEY: "typesafe.apiKey",
  TYPESAFE_MODEL_CONFIG_KEY: "typesafe.model",
}));

vi.mock("../credential-crypto.js", () => ({
  encryptCredential: vi.fn(async (value: string) => `enc:v1:${value}`),
  decryptCredential: vi.fn(async (value: string) => value),
}));

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
    it("saves the API key (encrypted) and URL atomically, then configures the client", async () => {
      const storageMock = await getStorageMock();
      const typesafeMock = await getTypesafeMock();
      vi.mocked(storageMock.setSystemConfigBatch).mockResolvedValue(undefined);

      const res = await request(app)
        .post("/api/settings/typesafe")
        .send({ apiUrl: "https://api.typesafe.ai/v1/systemone", apiKey: "my-key" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(storageMock.setSystemConfigBatch).toHaveBeenCalledWith([
        { key: "typesafe.apiUrl", value: "https://api.typesafe.ai/v1/systemone" },
        { key: "typesafe.apiKey", value: "enc:v1:my-key" },
        { key: "typesafe.model", value: "" },
      ]);
      expect(typesafeMock.configure).toHaveBeenCalledWith(
        "https://api.typesafe.ai/v1/systemone",
        "my-key",
        null
      );
    });

    it("saves the model alongside the URL and key", async () => {
      const storageMock = await getStorageMock();
      const typesafeMock = await getTypesafeMock();
      vi.mocked(storageMock.setSystemConfigBatch).mockResolvedValue(undefined);

      const res = await request(app).post("/api/settings/typesafe").send({
        apiUrl: "https://openrouter.ai/api/alpha/decisions",
        apiKey: "my-key",
        model: "typesafe/jev-1.13",
      });

      expect(res.status).toBe(200);
      expect(storageMock.setSystemConfigBatch).toHaveBeenCalledWith([
        { key: "typesafe.apiUrl", value: "https://openrouter.ai/api/alpha/decisions" },
        { key: "typesafe.apiKey", value: "enc:v1:my-key" },
        { key: "typesafe.model", value: "typesafe/jev-1.13" },
      ]);
      expect(typesafeMock.configure).toHaveBeenCalledWith(
        "https://openrouter.ai/api/alpha/decisions",
        "my-key",
        "typesafe/jev-1.13"
      );
    });

    it("returns 400 when model is not a string", async () => {
      const res = await request(app)
        .post("/api/settings/typesafe")
        .send({ apiKey: "my-key", model: 12345 });
      expect(res.status).toBe(400);
    });

    it("returns 400 when API key is empty and none is stored yet", async () => {
      const storageMock = await getStorageMock();
      vi.mocked(storageMock.getSystemConfig).mockResolvedValue(undefined);
      const res = await request(app).post("/api/settings/typesafe").send({ apiKey: "" });
      expect(res.status).toBe(400);
    });

    it("returns 400 when API key is missing and none is stored yet", async () => {
      const storageMock = await getStorageMock();
      vi.mocked(storageMock.getSystemConfig).mockResolvedValue(undefined);
      const res = await request(app).post("/api/settings/typesafe").send({});
      expect(res.status).toBe(400);
    });

    it("reuses the stored key and invalidates the client when apiKey is omitted on an update", async () => {
      const storageMock = await getStorageMock();
      const typesafeMock = await getTypesafeMock();
      vi.mocked(storageMock.getSystemConfig).mockResolvedValue("enc:v1:existing-key");
      vi.mocked(storageMock.setSystemConfigBatch).mockResolvedValue(undefined);

      const res = await request(app)
        .post("/api/settings/typesafe")
        .send({ model: "typesafe/jev-1.13" });

      expect(res.status).toBe(200);
      expect(storageMock.setSystemConfigBatch).toHaveBeenCalledWith([
        { key: "typesafe.apiUrl", value: "" },
        { key: "typesafe.apiKey", value: "enc:v1:existing-key" },
        { key: "typesafe.model", value: "typesafe/jev-1.13" },
      ]);
      expect(typesafeMock.configure).not.toHaveBeenCalled();
      expect(typesafeMock.invalidate).toHaveBeenCalled();
    });

    it("reuses the stored key when apiKey is an empty string on an update", async () => {
      const storageMock = await getStorageMock();
      const typesafeMock = await getTypesafeMock();
      vi.mocked(storageMock.getSystemConfig).mockResolvedValue("enc:v1:existing-key");
      vi.mocked(storageMock.setSystemConfigBatch).mockResolvedValue(undefined);

      const res = await request(app)
        .post("/api/settings/typesafe")
        .send({ apiKey: "", apiUrl: "https://api.typesafe.ai/v1/systemone" });

      expect(res.status).toBe(200);
      expect(storageMock.setSystemConfigBatch).toHaveBeenCalledWith([
        { key: "typesafe.apiUrl", value: "https://api.typesafe.ai/v1/systemone" },
        { key: "typesafe.apiKey", value: "enc:v1:existing-key" },
        { key: "typesafe.model", value: "" },
      ]);
      expect(typesafeMock.invalidate).toHaveBeenCalled();
    });

    it("returns 400 when API key is not a string", async () => {
      const res = await request(app).post("/api/settings/typesafe").send({ apiKey: 12345 });
      expect(res.status).toBe(400);
    });

    it("returns 400 when API URL is not a string", async () => {
      const res = await request(app)
        .post("/api/settings/typesafe")
        .send({ apiUrl: 12345, apiKey: "my-key" });
      expect(res.status).toBe(400);
    });

    it("returns 400 when the API URL is plain HTTP", async () => {
      const res = await request(app)
        .post("/api/settings/typesafe")
        .send({ apiUrl: "http://api.typesafe.ai/v1/systemone", apiKey: "my-key" });
      expect(res.status).toBe(400);
    });

    it("returns 400 when the API URL is malformed", async () => {
      const res = await request(app)
        .post("/api/settings/typesafe")
        .send({ apiUrl: "not a url", apiKey: "my-key" });
      expect(res.status).toBe(400);
    });

    it("returns 400 when the API URL fails the SSRF safety check", async () => {
      const { isSafeUrl } = await import("../ssrf.js");
      vi.mocked(isSafeUrl).mockResolvedValueOnce(false);

      const res = await request(app)
        .post("/api/settings/typesafe")
        .send({ apiUrl: "https://169.254.169.254/", apiKey: "my-key" });

      expect(res.status).toBe(400);
    });

    it("saves without a URL (falls back to the client's default)", async () => {
      const storageMock = await getStorageMock();
      vi.mocked(storageMock.setSystemConfigBatch).mockResolvedValue(undefined);

      const res = await request(app).post("/api/settings/typesafe").send({ apiKey: "my-key" });

      expect(res.status).toBe(200);
      expect(storageMock.setSystemConfigBatch).toHaveBeenCalledWith([
        { key: "typesafe.apiUrl", value: "" },
        { key: "typesafe.apiKey", value: "enc:v1:my-key" },
        { key: "typesafe.model", value: "" },
      ]);
    });
  });

  describe("DELETE /api/settings/typesafe", () => {
    it("clears stored config atomically and de-configures the client", async () => {
      const storageMock = await getStorageMock();
      const typesafeMock = await getTypesafeMock();
      vi.mocked(storageMock.setSystemConfigBatch).mockResolvedValue(undefined);

      const res = await request(app).delete("/api/settings/typesafe");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(storageMock.setSystemConfigBatch).toHaveBeenCalledWith([
        { key: "typesafe.apiUrl", value: "" },
        { key: "typesafe.apiKey", value: "" },
        { key: "typesafe.model", value: "" },
      ]);
      expect(typesafeMock.configure).toHaveBeenCalledWith(null, null, null);
    });
  });
});
