import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchLatestQuestarrVersion } from "../src/lib/versionService";

describe("Version Service", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("fetchLatestQuestarrVersion", () => {
    it("should fetch and return the latest version from GitHub releases", async () => {
      const mockVersion = "1.2.3";
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ tag_name: `v${mockVersion}` }),
      });

      const version = await fetchLatestQuestarrVersion();

      expect(version).toBe(mockVersion);
      expect(global.fetch).toHaveBeenCalledWith(
        "https://api.github.com/repos/Doezer/Questarr/releases/latest",
        {
          headers: {
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
        }
      );
    });

    it("should handle tag_name without v prefix", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ tag_name: "2.0.0" }),
      });

      const version = await fetchLatestQuestarrVersion();

      expect(version).toBe("2.0.0");
    });

    it("should return null and log rate-limit context on 403 response", async () => {
      const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        headers: {
          get: (header: string) => {
            if (header === "x-ratelimit-remaining") return "0";
            if (header === "x-ratelimit-reset") return "123456";
            return null;
          },
        },
      });

      const version = await fetchLatestQuestarrVersion();

      expect(version).toBeNull();
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        "GitHub Releases API rate-limited or forbidden while checking latest Questarr version.",
        {
          status: 403,
          rateLimitRemaining: "0",
          rateLimitReset: "123456",
        }
      );

      consoleWarnSpy.mockRestore();
    });

    it("should return null and log 404 response", async () => {
      const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        headers: {
          get: () => null,
        },
      });

      const version = await fetchLatestQuestarrVersion();

      expect(version).toBeNull();
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        "GitHub Releases API returned 404 while checking latest Questarr version."
      );

      consoleWarnSpy.mockRestore();
    });

    it("should return null and log generic non-ok response", async () => {
      const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        headers: {
          get: () => null,
        },
      });

      const version = await fetchLatestQuestarrVersion();

      expect(version).toBeNull();
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        "GitHub Releases API request failed while checking latest Questarr version.",
        {
          status: 500,
          statusText: "Internal Server Error",
        }
      );

      consoleWarnSpy.mockRestore();
    });

    it("should return null when tag_name is missing from response", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({}),
      });

      const version = await fetchLatestQuestarrVersion();

      expect(version).toBeNull();
    });

    it("should return null and log error when fetch throws", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const mockError = new Error("Network error");
      global.fetch = vi.fn().mockRejectedValue(mockError);

      const version = await fetchLatestQuestarrVersion();

      expect(version).toBeNull();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Failed to fetch latest Questarr version:",
        mockError
      );

      consoleErrorSpy.mockRestore();
    });

    it("should return null when JSON parsing fails", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => {
          throw new Error("Invalid JSON");
        },
      });

      const version = await fetchLatestQuestarrVersion();

      expect(version).toBeNull();
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });
  });
});
