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
        "https://api.github.com/repos/Doezer/Questarr/releases/latest"
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

    it("should return null when fetch fails with non-ok response", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
      });

      const version = await fetchLatestQuestarrVersion();

      expect(version).toBeNull();
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
