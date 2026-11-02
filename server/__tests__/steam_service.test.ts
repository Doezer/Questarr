import { describe, it, expect, vi, beforeEach } from "vitest";
import { steamService } from "../steam.js";
import { safeFetch } from "../ssrf.js";

vi.mock("../ssrf.js", () => ({
  safeFetch: vi.fn(),
}));

describe("steamService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getOwnedGames", () => {
    const id = "76561198000000000";
    it("uses HTTPS through safeFetch and returns deduplicated app IDs and titles", async () => {
      vi.mocked(safeFetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          response: {
            game_count: 2,
            games: [
              { appid: 10, name: "First", playtime_forever: 100 },
              { appid: 10, name: "First" },
            ],
          },
        }),
      } as Response);
      expect(await steamService.getOwnedGames("test-key", id)).toEqual([
        { steamAppId: 10, title: "First" },
      ]);
      expect(safeFetch).toHaveBeenCalledWith(
        expect.stringContaining("IPlayerService/GetOwnedGames"),
        expect.objectContaining({ requireHttps: true })
      );
      const requestUrl = new URL(String(vi.mocked(safeFetch).mock.calls[0]?.[0]));
      expect(requestUrl.searchParams.get("include_played_free_games")).toBe("true");
    });
    it("distinguishes an empty library from private or malformed data", async () => {
      vi.mocked(safeFetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ response: { game_count: 0 } }),
      } as Response);
      expect(await steamService.getOwnedGames("test-key", id)).toEqual([]);
      for (const response of [
        {},
        { game_count: 2 },
        { game_count: 1, games: [{ appid: "bad", name: "bad" }] },
      ]) {
        vi.mocked(safeFetch).mockResolvedValueOnce({
          ok: true,
          json: async () => ({ response }),
        } as Response);
        await expect(steamService.getOwnedGames("test-key", id)).rejects.toThrow(
          "Game details public"
        );
      }
    });
    it("validates the Steam ID and redacts network errors", async () => {
      await expect(steamService.getOwnedGames("test-key", "bad")).rejects.toThrow(
        "Invalid Steam ID"
      );
      expect(safeFetch).not.toHaveBeenCalled();
      vi.mocked(safeFetch).mockRejectedValueOnce(new Error("https://example.test?key=secret"));
      await expect(steamService.getOwnedGames("test-key", id)).rejects.toThrow(
        "Could not reach Steam"
      );
      vi.mocked(safeFetch).mockResolvedValueOnce({ ok: false, status: 403 } as Response);
      await expect(steamService.getOwnedGames("test-key", id)).rejects.toThrow("(403)");
    });
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

      vi.mocked(safeFetch).mockResolvedValueOnce({
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
      expect(safeFetch).toHaveBeenCalledTimes(1);
      // Should call the official IWishlistService endpoint
      expect(safeFetch).toHaveBeenCalledWith(
        expect.stringContaining("IWishlistService/GetWishlist")
      );
    });

    it("should map 403 API errors to actionable messages", async () => {
      vi.mocked(safeFetch).mockResolvedValueOnce({
        ok: false,
        status: 403,
      } as Response);

      await expect(steamService.getWishlist(steamId)).rejects.toThrow(
        "Steam API error: 403 Forbidden - your Steam profile or wishlist is private"
      );
    });

    it("should map 404 API errors to actionable messages", async () => {
      vi.mocked(safeFetch).mockResolvedValueOnce({
        ok: false,
        status: 404,
      } as Response);

      await expect(steamService.getWishlist(steamId)).rejects.toThrow(
        "Steam API error: 404 Not Found - the specified Steam ID does not exist"
      );
    });

    it("should map 429 API errors to actionable messages", async () => {
      vi.mocked(safeFetch).mockResolvedValueOnce({
        ok: false,
        status: 429,
      } as Response);

      await expect(steamService.getWishlist(steamId)).rejects.toThrow(
        "Steam API error: 429 Too Many Requests"
      );
    });

    it("should handle empty wishlist (no items)", async () => {
      vi.mocked(safeFetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ response: {} }),
      } as Response);

      const games = await steamService.getWishlist(steamId);
      expect(games).toHaveLength(0);
    });

    it("should handle empty response with items array", async () => {
      vi.mocked(safeFetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ response: { items: [] } }),
      } as Response);

      const games = await steamService.getWishlist(steamId);
      expect(games).toHaveLength(0);
    });
  });

  describe("getPlayerAchievements", () => {
    const steamId = "76561198000000000";

    function mockFetches(opts: {
      schema?: { ok: boolean; body: unknown };
      achievements: { ok: boolean; body: unknown };
      globalPercentages?: { ok: boolean; body: unknown };
    }) {
      vi.mocked(safeFetch).mockImplementation(async (url: string) => {
        if (url.includes("GetSchemaForGame")) {
          const { ok = true, body = {} } = opts.schema ?? {};
          return { ok, status: ok ? 200 : 500, json: async () => body } as Response;
        }
        if (url.includes("GetPlayerAchievements")) {
          return {
            ok: opts.achievements.ok,
            status: opts.achievements.ok ? 200 : 403,
            json: async () => opts.achievements.body,
          } as Response;
        }
        if (url.includes("GetGlobalAchievementPercentagesForApp")) {
          const { ok = true, body = {} } = opts.globalPercentages ?? {};
          return { ok, status: ok ? 200 : 500, json: async () => body } as Response;
        }
        throw new Error(`Unexpected URL: ${url}`);
      });
    }

    it("throws for an invalid Steam ID", async () => {
      await expect(steamService.getPlayerAchievements("key", "invalid", 111)).rejects.toThrow(
        "Invalid Steam ID format"
      );
    });

    it("merges schema, player achievements, and global percentages", async () => {
      mockFetches({
        schema: {
          ok: true,
          body: {
            game: {
              availableGameStats: {
                achievements: [
                  {
                    name: "ACH_1",
                    displayName: "First Steps",
                    icon: "i1",
                    icongray: "g1",
                    hidden: 0,
                  },
                ],
              },
            },
          },
        },
        achievements: {
          ok: true,
          body: {
            playerstats: {
              success: true,
              achievements: [{ apiname: "ACH_1", achieved: 1, unlocktime: 1700000000 }],
            },
          },
        },
        globalPercentages: {
          ok: true,
          body: { achievementpercentages: { achievements: [{ name: "ACH_1", percent: 42.5 }] } },
        },
      });

      const result = await steamService.getPlayerAchievements("key", steamId, 201);

      expect(result).toEqual([
        {
          apiName: "ACH_1",
          displayName: "First Steps",
          description: null,
          icon: "i1",
          iconGray: "g1",
          hidden: false,
          achieved: true,
          unlockedAt: 1700000000 * 1000,
          globalPercent: 42.5,
        },
      ]);
    });

    it("surfaces a private profile (success: false) as an empty list, not an error", async () => {
      mockFetches({
        achievements: {
          ok: false,
          body: { playerstats: { success: false, error: "Profile is private" } },
        },
      });

      const result = await steamService.getPlayerAchievements("key", steamId, 202);

      expect(result).toEqual([]);
    });

    it("throws for a genuine non-2xx error unrelated to profile privacy", async () => {
      mockFetches({
        achievements: { ok: false, body: {} },
      });

      await expect(steamService.getPlayerAchievements("key", steamId, 203)).rejects.toThrow(
        "Steam API error: 403"
      );
    });

    it("falls back to an empty percentage map when the global percentages request fails", async () => {
      mockFetches({
        achievements: {
          ok: true,
          body: {
            playerstats: {
              success: true,
              achievements: [{ apiname: "ACH_1", achieved: 0, unlocktime: 0 }],
            },
          },
        },
        globalPercentages: { ok: false, body: {} },
      });

      const result = await steamService.getPlayerAchievements("key", steamId, 204);

      expect(result[0]?.globalPercent).toBeNull();
      expect(result[0]?.achieved).toBe(false);
      expect(result[0]?.unlockedAt).toBeNull();
    });
  });
});
