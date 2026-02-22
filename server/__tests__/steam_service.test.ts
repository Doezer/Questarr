import { describe, it, expect, vi, beforeEach } from "vitest";
import { steamService } from "../steam.js";

describe("steamService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock global fetch
    global.fetch = vi.fn();
  });

  describe("validateSteamId", () => {
    it("should return true for valid Steam IDs", () => {
      expect(steamService.validateSteamId("76561198000000000")).toBe(true);
      expect(steamService.validateSteamId("76561234567890123")).toBe(true);
    });

    it("should return false for invalid Steam IDs", () => {
      expect(steamService.validateSteamId("12345678901234567")).toBe(false);
      expect(steamService.validateSteamId("765611980000")).toBe(false);
      expect(steamService.validateSteamId("765611980000000000")).toBe(false);
      expect(steamService.validateSteamId("not-a-number")).toBe(false);
    });
  });

  describe("getWishlist", () => {
    const steamId = "76561198000000000";

    it("should throw error for invalid Steam ID", async () => {
      await expect(steamService.getWishlist("invalid")).rejects.toThrow("Invalid Steam ID format");
    });

    it("should fetch wishlist games correctly", async () => {
      const mockData = {
        "101": { name: "Game 1", added: 1600000000, priority: 1, reviews_total: "100" },
        "102": { name: "Game 2", added: 1600000001, priority: 2, reviews_total: "200" },
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockData,
      } as Response);

      // Return empty on second page
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({}),
      } as Response);

      const games = await steamService.getWishlist(steamId);

      expect(games).toHaveLength(2);
      expect(games[0]).toEqual({
        steamAppId: 101,
        title: "Game 1",
        addedAt: 1600000000,
        priority: 1,
      });
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it("should handle private profiles (403)", async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 403,
      } as Response);

      await expect(steamService.getWishlist(steamId)).rejects.toThrow(
        "Steam profile is private or inaccessible"
      );
    });

    it("should handle Steam API internal errors (500)", async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 500,
      } as Response);

      await expect(steamService.getWishlist(steamId)).rejects.toThrow(
        "Steam profile is private or inaccessible"
      );
    });

    it("should handle other API errors", async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 404,
      } as Response);

      await expect(steamService.getWishlist(steamId)).rejects.toThrow("Steam API error: 404");
    });

    it("should handle empty response", async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [],
      } as Response);

      const games = await steamService.getWishlist(steamId);
      expect(games).toHaveLength(0);
    });
  });
});
