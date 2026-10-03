import { beforeEach, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { steamRoutes } from "../steam-routes.js";
import { storage } from "../storage.js";
import { steamService } from "../steam.js";
import { syncUserSteamWishlist } from "../cron.js";
import { config } from "../config.js";
import type { User } from "../../shared/schema.js";

vi.mock("../storage.js", () => ({
  storage: {
    updateUserSteamId: vi.fn(),
    getGame: vi.fn(),
  },
}));

vi.mock("../steam.js", () => ({
  steamService: {
    validateSteamId: vi.fn(),
    getPlayerAchievements: vi.fn(),
  },
}));

vi.mock("../cron.js", () => ({
  syncUserSteamWishlist: vi.fn(),
}));

vi.mock("../config.js", () => ({
  config: { steam: { isConfigured: false, apiKey: undefined } },
}));

let currentUser: Partial<User> = { id: "user-1", username: "tester" };

vi.mock("../auth.js", () => ({
  authenticateToken: (req: Request, _res: Response, next: NextFunction) => {
    req.user = currentUser as User;
    next();
  },
}));

describe("steamRoutes", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    currentUser = { id: "user-1", username: "tester" };
    config.steam.isConfigured = false;
    config.steam.apiKey = undefined;
    app = express();
    app.use(express.json());
    app.use(steamRoutes);
  });

  describe("PATCH /api/user/steam-id", () => {
    it("returns 400 when steamId is missing", async () => {
      const response = await request(app).patch("/api/user/steam-id").send({});

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: "Steam ID is required" });
    });

    it("returns 400 when steamId format is invalid", async () => {
      vi.mocked(steamService.validateSteamId).mockReturnValue(false);

      const response = await request(app).patch("/api/user/steam-id").send({ steamId: "123" });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("Invalid Steam ID format");
      expect(storage.updateUserSteamId).not.toHaveBeenCalled();
    });

    it("updates steamId for valid requests", async () => {
      vi.mocked(steamService.validateSteamId).mockReturnValue(true);
      vi.mocked(storage.updateUserSteamId).mockResolvedValue(undefined);

      const steamId = "76561198000000000";
      const response = await request(app).patch("/api/user/steam-id").send({ steamId });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true, steamId });
      expect(storage.updateUserSteamId).toHaveBeenCalledWith("user-1", steamId);
    });

    it("returns 500 when storage update fails", async () => {
      vi.mocked(steamService.validateSteamId).mockReturnValue(true);
      vi.mocked(storage.updateUserSteamId).mockRejectedValue(new Error("db failure"));

      const response = await request(app)
        .patch("/api/user/steam-id")
        .send({ steamId: "76561198000000000" });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: "Failed to set Steam ID" });
    });
  });

  describe("POST /api/steam/wishlist/sync", () => {
    it("returns 400 when user has no linked steamId", async () => {
      vi.mocked(syncUserSteamWishlist).mockResolvedValue(undefined);

      const response = await request(app).post("/api/steam/wishlist/sync");

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: "Steam ID not linked" });
    });

    it("returns 400 when sync reports failure", async () => {
      vi.mocked(syncUserSteamWishlist).mockResolvedValue({
        success: false,
        message: "Steam profile is private",
      });

      const response = await request(app).post("/api/steam/wishlist/sync");

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: "Steam profile is private" });
    });

    it("returns 200 with successful sync payload", async () => {
      vi.mocked(syncUserSteamWishlist).mockResolvedValue({
        success: true,
        addedCount: 2,
        games: [
          { title: "Game 1", rawgId: 1001, steamAppId: 101 },
          { title: "Game 2", rawgId: 1002, steamAppId: 102 },
        ],
      });

      const response = await request(app).post("/api/steam/wishlist/sync");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.addedCount).toBe(2);
      expect(syncUserSteamWishlist).toHaveBeenCalledWith("user-1", "manual");
    });

    it("returns 500 when sync throws", async () => {
      vi.mocked(syncUserSteamWishlist).mockRejectedValue(new Error("unexpected"));

      const response = await request(app).post("/api/steam/wishlist/sync");

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: "Sync failed" });
    });
  });

  describe("GET /api/games/:id/achievements", () => {
    const gameId = "123e4567-e89b-12d3-a456-426614174000";

    it("returns an empty list with a reason when Steam isn't configured", async () => {
      const response = await request(app).get(`/api/games/${gameId}/achievements`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ achievements: [], reason: "not_configured" });
      expect(storage.getGame).not.toHaveBeenCalled();
    });

    it("returns 404 when the game does not belong to the requester", async () => {
      config.steam.isConfigured = true;
      vi.mocked(storage.getGame).mockResolvedValue({
        id: gameId,
        userId: "someone-else",
      } as unknown as Awaited<ReturnType<typeof storage.getGame>>);

      const response = await request(app).get(`/api/games/${gameId}/achievements`);

      expect(response.status).toBe(404);
    });

    it("returns an empty list when the game has no Steam App ID", async () => {
      config.steam.isConfigured = true;
      vi.mocked(storage.getGame).mockResolvedValue({
        id: gameId,
        userId: "user-1",
        steamAppId: null,
      } as unknown as Awaited<ReturnType<typeof storage.getGame>>);

      const response = await request(app).get(`/api/games/${gameId}/achievements`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ achievements: [], reason: "no_steam_app_id" });
    });

    it("returns an empty list when the user has no linked Steam ID", async () => {
      config.steam.isConfigured = true;
      currentUser = { id: "user-1", username: "tester", steamId64: undefined };
      vi.mocked(storage.getGame).mockResolvedValue({
        id: gameId,
        userId: "user-1",
        steamAppId: 12345,
      } as unknown as Awaited<ReturnType<typeof storage.getGame>>);

      const response = await request(app).get(`/api/games/${gameId}/achievements`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ achievements: [], reason: "no_steam_id" });
    });

    it("returns achievements when everything is configured", async () => {
      config.steam.isConfigured = true;
      config.steam.apiKey = "test-key";
      currentUser = { id: "user-1", username: "tester", steamId64: "76561198000000000" };
      vi.mocked(storage.getGame).mockResolvedValue({
        id: gameId,
        userId: "user-1",
        steamAppId: 12345,
      } as unknown as Awaited<ReturnType<typeof storage.getGame>>);
      vi.mocked(steamService.getPlayerAchievements).mockResolvedValue([
        { apiName: "ACH_1", achieved: true } as never,
      ]);

      const response = await request(app).get(`/api/games/${gameId}/achievements`);

      expect(response.status).toBe(200);
      expect(response.body.achievements).toHaveLength(1);
      expect(steamService.getPlayerAchievements).toHaveBeenCalledWith(
        "test-key",
        "76561198000000000",
        12345
      );
    });

    it("returns 500 when fetching achievements throws", async () => {
      config.steam.isConfigured = true;
      config.steam.apiKey = "test-key";
      currentUser = { id: "user-1", username: "tester", steamId64: "76561198000000000" };
      vi.mocked(storage.getGame).mockResolvedValue({
        id: gameId,
        userId: "user-1",
        steamAppId: 12345,
      } as unknown as Awaited<ReturnType<typeof storage.getGame>>);
      vi.mocked(steamService.getPlayerAchievements).mockRejectedValue(new Error("Steam API down"));

      const response = await request(app).get(`/api/games/${gameId}/achievements`);

      expect(response.status).toBe(500);
    });
  });
});
