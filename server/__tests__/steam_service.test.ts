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

    it("should fetch wishlist games correctly via IWishlistService", async () => {
      const mockApiResponse = {
        response: {
          items: [
            { appid: 101, priority: 1, date_added: 1600000000 },
            { appid: 102, priority: 2, date_added: 1600000001 },
          ],
        },
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockApiResponse,
      } as Response);

      const games = await steamService.getWishlist(steamId);

      expect(games).toHaveLength(2);
      expect(games[0]).toEqual({
        steamAppId: 101,
        title: "Steam App 101",
        addedAt: 1600000000,
        priority: 1,
      });
      expect(games[1]).toEqual({
        steamAppId: 102,
        title: "Steam App 102",
        addedAt: 1600000001,
        priority: 2,
      });
      // New API uses a single request (no pagination)
      expect(fetch).toHaveBeenCalledTimes(1);
      // Should call the official IWishlistService endpoint
      expect(fetch).toHaveBeenCalledWith(expect.stringContaining("IWishlistService/GetWishlist"));
    });

    it("should handle API errors", async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 403,
      } as Response);

      await expect(steamService.getWishlist(steamId)).rejects.toThrow("Steam API error: 403");
    });

    it("should handle other API errors", async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 404,
      } as Response);

      await expect(steamService.getWishlist(steamId)).rejects.toThrow("Steam API error: 404");
    });

    it("should handle empty wishlist (no items)", async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ response: {} }),
      } as Response);

      const games = await steamService.getWishlist(steamId);
      expect(games).toHaveLength(0);
    });

    it("should handle empty response with items array", async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ response: { items: [] } }),
      } as Response);

      const games = await steamService.getWishlist(steamId);
      expect(games).toHaveLength(0);
    });
  });
});
