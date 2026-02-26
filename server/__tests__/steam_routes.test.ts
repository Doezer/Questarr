import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { steamRoutes } from "../steam-routes.js";
import { storage } from "../storage.js";
import { syncUserSteamWishlist } from "../cron.js";
import * as auth from "../auth.js";
import passport from "passport";

// Mock dependencies
vi.mock("../storage.js");
vi.mock("../cron.js");
vi.mock("../auth.js");
vi.mock("passport", () => {
  const mockAuthenticate = vi.fn(() => (req: any, res: any, next: any) => next());
  return {
    default: {
      use: vi.fn(),
      authenticate: mockAuthenticate,
      serializeUser: vi.fn(),
      deserializeUser: vi.fn(),
      _strategies: {
        steam: {
          _options: {},
        },
      },
    },
  };
});

describe("steamRoutes", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());

    // Mock authenticateToken middleware
    vi.spyOn(auth, "authenticateToken").mockImplementation((req: any, res: any, next: any) => {
      (req as any).user = { id: 1, username: "testuser" };
      next();
      return Promise.resolve(undefined as any);
    });

    app.use(steamRoutes);
  });

  describe("PUT /api/user/steam-id", () => {
    it("should update Steam ID for valid input", async () => {
      const steamId = "76561198000000000";
      vi.mocked(storage.updateUserSteamId).mockResolvedValue(true as any);

      const res = await request(app).put("/api/user/steam-id").send({ steamId });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, steamId });
      expect(storage.updateUserSteamId).toHaveBeenCalledWith(1, steamId);
    });

    it("should return 400 for missing Steam ID", async () => {
      const res = await request(app).put("/api/user/steam-id").send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Steam ID is required");
    });

    it("should return 400 for invalid Steam ID format", async () => {
      const res = await request(app).put("/api/user/steam-id").send({ steamId: "invalid" });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("Invalid Steam ID format");
    });

    it("should return 500 when updateUserSteamId throws", async () => {
      vi.mocked(storage.updateUserSteamId).mockRejectedValue(new Error("DB error"));

      const res = await request(app)
        .put("/api/user/steam-id")
        .send({ steamId: "76561198000000000" });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Failed to set Steam ID");
    });
  });

  describe("POST /api/steam/wishlist/sync", () => {
    it("should trigger wishlist sync", async () => {
      vi.mocked(syncUserSteamWishlist).mockResolvedValue({
        success: true,
        addedCount: 5,
      });

      const res = await request(app).post("/api/steam/wishlist/sync");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(syncUserSteamWishlist).toHaveBeenCalledWith(1);
    });

    it("should handle sync failure when Steam ID is not linked", async () => {
      vi.mocked(syncUserSteamWishlist).mockResolvedValue(undefined as any);

      const res = await request(app).post("/api/steam/wishlist/sync");

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Steam ID not linked");
    });

    it("should handle other sync errors", async () => {
      vi.mocked(syncUserSteamWishlist).mockResolvedValue({
        success: false,
        message: "Steam profile private",
      });

      const res = await request(app).post("/api/steam/wishlist/sync");

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Steam profile private");
    });

    it("should return 500 when syncUserSteamWishlist throws", async () => {
      vi.mocked(syncUserSteamWishlist).mockRejectedValue(new Error("Network error"));

      const res = await request(app).post("/api/steam/wishlist/sync");

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Sync failed");
    });
  });

  describe("POST /api/auth/steam/init", () => {
    it("should store user ID in session", async () => {
      const initApp = express();
      initApp.use(express.json());
      initApp.use((req, res, next) => {
        (req as any).session = {};
        next();
      });
      vi.spyOn(auth, "authenticateToken").mockImplementation((req: any, res: any, next: any) => {
        (req as any).user = { id: 1, username: "testuser" };
        next();
        return Promise.resolve(undefined as any);
      });
      initApp.use(steamRoutes);

      const res = await request(initApp).post("/api/auth/steam/init");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
    });

    it("should return 500 when session is not available", async () => {
      const noSessionApp = express();
      noSessionApp.use(express.json());
      vi.spyOn(auth, "authenticateToken").mockImplementation((req: any, res: any, next: any) => {
        (req as any).user = { id: 1, username: "testuser" };
        next();
        return Promise.resolve(undefined as any);
      });
      noSessionApp.use(steamRoutes);

      const res = await request(noSessionApp).post("/api/auth/steam/init");

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Session configuration error");
    });
  });

  describe("GET /api/auth/steam", () => {
    it("should initiate Steam auth flow when session is initialized", async () => {
      const authApp = express();
      authApp.use(express.json());
      authApp.use((req, res, next) => {
        // Simulate session that was initialized by /init
        (req as any).session = { steam_auth_user_id: 1 };
        next();
      });
      authApp.use(steamRoutes);

      const res = await request(authApp).get("/api/auth/steam");

      expect(passport.authenticate).toHaveBeenCalledWith("steam", { session: false });
    });

    it("should return 401 when session is not initialized", async () => {
      const noInitApp = express();
      noInitApp.use(express.json());
      noInitApp.use((req, res, next) => {
        (req as any).session = {};
        next();
      });
      noInitApp.use(steamRoutes);

      const res = await request(noInitApp).get("/api/auth/steam");

      expect(res.status).toBe(401);
      expect(res.body.error).toContain("not initialized");
    });

    it("should return 401 when session is missing entirely", async () => {
      const noSessionApp = express();
      noSessionApp.use(express.json());
      // No session middleware
      noSessionApp.use(steamRoutes);

      const res = await request(noSessionApp).get("/api/auth/steam");

      expect(res.status).toBe(401);
      expect(res.body.error).toContain("not initialized");
    });
  });

  describe("GET /api/auth/steam/return", () => {
    it("should redirect to settings on auth failure", async () => {
      // Mock authenticate to call failure callback
      vi.mocked(passport.authenticate).mockImplementationOnce(
        (strategy: any, options: any, callback?: any) => (req: any, res: any, next: any) => {
          if (callback) {
            callback(new Error("Auth failed"), null);
          } else {
            res.redirect("/settings?error=steam_auth_failed");
          }
        }
      );

      const res = await request(app).get("/api/auth/steam/return");
      expect(res.status).toBe(302);
      expect(res.header.location).toContain("error=steam_auth_failed");
    });

    it("should handle missing session user ID", async () => {
      // Mock authenticate to succeed but profile but session is missing
      vi.mocked(passport.authenticate).mockImplementationOnce(
        (strategy: any, options: any, callback?: any) => (req: any, res: any, next: any) => {
          callback(null, { _json: { steamid: "123" } });
        }
      );

      const res = await request(app).get("/api/auth/steam/return");
      expect(res.status).toBe(302);
      expect(res.header.location).toContain("error=session_expired");
    });

    it("should redirect to success on successful auth return", async () => {
      // Mock authenticate to succeed with profile and session
      vi.mocked(passport.authenticate).mockImplementationOnce(
        (strategy: any, options: any, callback?: any) => (req: any, res: any, next: any) => {
          // Set session so userId is available
          (req as any).session = { steam_auth_user_id: 1 };
          callback(null, { _json: { steamid: "76561198000000000" } });
        }
      );
      vi.mocked(storage.updateUserSteamId).mockResolvedValue(undefined as any);

      const res = await request(app).get("/api/auth/steam/return");
      expect(res.status).toBe(302);
      expect(res.header.location).toContain("steam_linked=success");
      expect(storage.updateUserSteamId).toHaveBeenCalledWith(1, "76561198000000000");
    });

    it("should redirect to db_error when storage update fails", async () => {
      // Mock authenticate to succeed with profile and session
      vi.mocked(passport.authenticate).mockImplementationOnce(
        (strategy: any, options: any, callback?: any) => (req: any, res: any, next: any) => {
          (req as any).session = { steam_auth_user_id: 1 };
          callback(null, { _json: { steamid: "76561198000000000" } });
        }
      );
      vi.mocked(storage.updateUserSteamId).mockRejectedValue(new Error("DB write failed"));

      const res = await request(app).get("/api/auth/steam/return");
      expect(res.status).toBe(302);
      expect(res.header.location).toContain("error=db_error");
    });

    it("should handle null profile in auth callback", async () => {
      vi.mocked(passport.authenticate).mockImplementationOnce(
        (strategy: any, options: any, callback?: any) => (req: any, res: any, next: any) => {
          callback(null, null);
        }
      );

      const res = await request(app).get("/api/auth/steam/return");
      expect(res.status).toBe(302);
      expect(res.header.location).toContain("error=steam_auth_failed");
    });
  });
});
