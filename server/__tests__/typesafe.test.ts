import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../logger.js", () => ({
  logger: {
    child: vi.fn().mockReturnValue({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

vi.mock("../ssrf.js", () => ({
  safeFetch: vi.fn(),
}));

vi.mock("../storage.js", () => ({
  storage: {
    getSystemConfig: vi.fn(),
  },
}));

vi.mock("../credential-crypto.js", () => ({
  decryptCredential: vi.fn(async (value: string) => `decrypted:${value}`),
}));

import { safeFetch } from "../ssrf.js";
import { storage } from "../storage.js";
import { decryptCredential } from "../credential-crypto.js";

const mockSafeFetch = vi.mocked(safeFetch);
const mockGetSystemConfig = vi.mocked(storage.getSystemConfig);
const mockDecryptCredential = vi.mocked(decryptCredential);

function makeResponse(data: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: vi.fn().mockResolvedValue(data),
  };
}

describe("TypeSafeClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  async function getClient() {
    const mod = await import("../typesafe.js");
    return mod.typesafeClient;
  }

  describe("isConfigured()", () => {
    it("returns false when configure() was called with nulls", async () => {
      const client = await getClient();
      client.configure(null, null);
      expect(await client.isConfigured()).toBe(false);
    });

    it("returns true after configure() is called with a URL and key", async () => {
      const client = await getClient();
      client.configure("https://api.typesafe.ai/v1/systemone", "my-key");
      expect(await client.isConfigured()).toBe(true);
    });

    it("returns false when configure() is called with only whitespace", async () => {
      const client = await getClient();
      client.configure("   ", "   ");
      expect(await client.isConfigured()).toBe(false);
    });

    it("lazily loads and decrypts credentials from storage on first use", async () => {
      mockGetSystemConfig.mockImplementation(async (key: string) => {
        if (key === "typesafe.apiUrl") return "https://custom.example.com/v1/systemone";
        if (key === "typesafe.apiKey") return "enc:v1:abc";
        return undefined;
      });
      const client = await getClient();
      expect(await client.isConfigured()).toBe(true);
      expect(mockDecryptCredential).toHaveBeenCalledWith("enc:v1:abc");
    });

    it("returns false when storage has no stored key", async () => {
      mockGetSystemConfig.mockResolvedValue(undefined);
      const client = await getClient();
      expect(await client.isConfigured()).toBe(false);
      expect(mockDecryptCredential).not.toHaveBeenCalled();
    });

    it("only reads storage once across repeated calls", async () => {
      mockGetSystemConfig.mockResolvedValue(undefined);
      const client = await getClient();
      await client.isConfigured();
      await client.isConfigured();
      expect(mockGetSystemConfig).toHaveBeenCalledTimes(2); // url + key, once each
    });
  });

  describe("invalidate()", () => {
    it("forces the next call to re-read storage", async () => {
      mockGetSystemConfig.mockResolvedValue(undefined);
      const client = await getClient();
      await client.isConfigured();
      client.invalidate();
      await client.isConfigured();
      expect(mockGetSystemConfig).toHaveBeenCalledTimes(4);
    });
  });

  describe("analyzeRelease()", () => {
    it("returns null when not configured", async () => {
      const client = await getClient();
      client.configure(null, null);
      const result = await client.analyzeRelease({ releaseName: "Some.Game-GROUP" });
      expect(result).toBeNull();
      expect(mockSafeFetch).not.toHaveBeenCalled();
    });

    it("sends the expected request and parses a successful response", async () => {
      mockSafeFetch.mockResolvedValue(
        makeResponse({
          model: "jev-1.0.0",
          answers: {
            releaseType: { type: "choice", choice: "repack", confidence: 0.91 },
            sizeIsPlausible: { type: "noul", noul: 0.2 },
          },
        }) as unknown as Response
      );
      const client = await getClient();
      client.configure("https://api.typesafe.ai/v1/systemone", "test-key");

      const result = await client.analyzeRelease({
        releaseName: "Some.Game-FLT",
        sizeBytes: 5_000_000,
        platform: "PC",
      });

      expect(result).toEqual({
        releaseType: "repack",
        releaseTypeConfidence: 0.91,
        legitimacyScore: 0.2,
      });

      expect(mockSafeFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockSafeFetch.mock.calls[0];
      expect(url).toBe("https://api.typesafe.ai/v1/systemone");
      expect(options?.method).toBe("POST");
      expect(options?.requireHttps).toBe(true);
      const headers = options?.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer test-key");
      const body = JSON.parse(options?.body as string);
      expect(body.state).toContain("Some.Game-FLT");
      expect(body.state).toContain("PC");
      expect(body.questions.releaseType.type).toBe("choice");
      expect(body.questions.sizeIsPlausible.type).toBe("noul");
    });

    it("returns null and discards an unrecognized release type value", async () => {
      mockSafeFetch.mockResolvedValue(
        makeResponse({
          model: "jev-1.0.0",
          answers: {
            releaseType: { type: "choice", choice: "not_a_real_type", confidence: 0.5 },
          },
        }) as unknown as Response
      );
      const client = await getClient();
      client.configure("https://api.typesafe.ai/v1/systemone", "test-key");

      const result = await client.analyzeRelease({ releaseName: "Some.Game" });
      expect(result?.releaseType).toBeNull();
      expect(result?.releaseTypeConfidence).toBe(0.5);
    });

    it("returns null when the API responds with a non-ok status", async () => {
      mockSafeFetch.mockResolvedValue(makeResponse(null, false, 401) as unknown as Response);
      const client = await getClient();
      client.configure("https://api.typesafe.ai/v1/systemone", "bad-key");

      const result = await client.analyzeRelease({ releaseName: "Some.Game" });
      expect(result).toBeNull();
    });

    it("returns null when the fetch call throws (timeout, network error, etc.)", async () => {
      mockSafeFetch.mockRejectedValue(new Error("timeout"));
      const client = await getClient();
      client.configure("https://api.typesafe.ai/v1/systemone", "test-key");

      const result = await client.analyzeRelease({ releaseName: "Some.Game" });
      expect(result).toBeNull();
    });
  });
});
