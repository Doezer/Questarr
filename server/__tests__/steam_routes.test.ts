import { beforeEach, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { steamRoutes } from "../steam-routes.js";
import { storage } from "../storage.js";
import { steamService } from "../steam.js";
import { syncUserSteamWishlist } from "../cron.js";

vi.mock("../storage.js", () => ({
  storage: {
    updateUserSteamId: vi.fn(),
  },
}));

vi.mock("../steam.js", () => ({
  steamService: {
    validateSteamId: vi.fn(),
  },
}));

vi.mock("../cron.js", () => ({
  syncUserSteamWishlist: vi.fn(),
}));

vi.mock("../auth.js", () => ({
  authenticateToken: (req: Request, _res: Response, next: NextFunction) => {
    req.user = { id: "user-1", username: "tester" };
    next();
  },
}));

describe("steamRoutes", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use(steamRoutes);
  });

  describe("PUT /api/user/steam-id", () => {
    it("returns 400 when steamId is missing", async () => {
      const response = await request(app).put("/api/user/steam-id").send({});

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: "Steam ID is required" });
    });

    it("returns 400 when steamId format is invalid", async () => {
      vi.mocked(steamService.validateSteamId).mockReturnValue(false);

      const response = await request(app).put("/api/user/steam-id").send({ steamId: "123" });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("Invalid Steam ID format");
      expect(storage.updateUserSteamId).not.toHaveBeenCalled();
    });

    it("updates steamId for valid requests", async () => {
      vi.mocked(steamService.validateSteamId).mockReturnValue(true);
      vi.mocked(storage.updateUserSteamId).mockResolvedValue(undefined);

      const steamId = "76561198000000000";
      const response = await request(app).put("/api/user/steam-id").send({ steamId });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true, steamId });
      expect(storage.updateUserSteamId).toHaveBeenCalledWith("user-1", steamId);
    });

    it("returns 500 when storage update fails", async () => {
      vi.mocked(steamService.validateSteamId).mockReturnValue(true);
      vi.mocked(storage.updateUserSteamId).mockRejectedValue(new Error("db failure"));

      const response = await request(app)
        .put("/api/user/steam-id")
        .send({ steamId: "76561198000000000" });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: "Failed to set Steam ID" });
    });

    it("should return 500 when updateUserSteamId throws", async () => {
      vi.mocked(storage.updateUserSteamId).mockRejectedValue(new Error("DB error"));

      const res = await request(app)
        .put("/api/user/steam-id")
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
          { title: "Game 1", igdbId: 1001, steamAppId: 101 },
          { title: "Game 2", igdbId: 1002, steamAppId: 102 },
        ],
      });

      const response = await request(app).post("/api/steam/wishlist/sync");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.addedCount).toBe(2);
      expect(syncUserSteamWishlist).toHaveBeenCalledWith("user-1");
    });

    it("returns 500 when sync throws", async () => {
      vi.mocked(syncUserSteamWishlist).mockRejectedValue(new Error("unexpected"));

      const response = await request(app).post("/api/steam/wishlist/sync");

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: "Sync failed" });
    });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: "Sync failed" });
    });
  });
});
