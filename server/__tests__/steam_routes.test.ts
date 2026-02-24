import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { Request, Response, NextFunction } from "express";
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
  const mockAuthenticate = vi.fn(
    () => (_req: Request, _res: Response, next: NextFunction) => next()
  );
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
    vi.spyOn(auth, "authenticateToken").mockImplementation(
      (req: Request, _res: Response, next: NextFunction) => {
        Object.assign(req, { user: { id: 1, username: "testuser" } });
        next();
        return Promise.resolve(undefined as unknown as Response);
      }
    );

    app.use(steamRoutes);
  });

  describe("PUT /api/user/steam-id", () => {
    it("should update Steam ID for valid input", async () => {
      const steamId = "76561198000000000";
      vi.mocked(storage.updateUserSteamId).mockResolvedValue(
        true as unknown as Awaited<ReturnType<typeof storage.updateUserSteamId>>
      );

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
      vi.mocked(syncUserSteamWishlist).mockResolvedValue(undefined);

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
  });

  describe("GET /api/auth/steam", () => {
    it("should initiate Steam auth flow", async () => {
      // Create a new app for this test to ensure middleware order
      const authApp = express();
      authApp.use(express.json());
      authApp.use((req, _res, next) => {
        Object.assign(req, { session: {} });
        next();
      });
      vi.spyOn(auth, "authenticateToken").mockImplementation(
        (req: Request, _res: Response, next: NextFunction) => {
          Object.assign(req, { user: { id: 1, username: "testuser" } });
          next();
          return Promise.resolve(undefined as unknown as Response);
        }
      );
      authApp.use(steamRoutes);

      await request(authApp).get("/api/auth/steam");

      expect(passport.authenticate).toHaveBeenCalledWith("steam", { session: false });
    });
  });
  describe("GET /api/auth/steam/return", () => {
    it("should redirect to settings on auth failure", async () => {
      // Mock authenticate to call failure callback
      vi.mocked(passport.authenticate).mockImplementationOnce(
        (
          _strategy: string | passport.Strategy | string[],
          _options: passport.AuthenticateOptions,
          callback?: (err: Error | null, user?: Express.User | false | null) => void
        ) =>
          (_req: Request, res: Response, _next: NextFunction) => {
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
        (
          _strategy: string | passport.Strategy | string[],
          _options: passport.AuthenticateOptions,
          callback?: (err: Error | null, user?: Express.User | false | null) => void
        ) =>
          (_req: Request, _res: Response, _next: NextFunction) => {
            if (callback) callback(null, { _json: { steamid: "123" } });
          }
      );

      const res = await request(app).get("/api/auth/steam/return");
      expect(res.status).toBe(302);
      expect(res.header.location).toContain("error=session_expired");
    });
  });
});
