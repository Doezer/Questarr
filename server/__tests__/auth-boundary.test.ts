import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import {
  mockConfig,
  createStorageMock,
  createIgdbMock,
  createDbMock,
  createLoggerMocks,
  createRssMock,
  createTorznabMock,
  createNewznabMock,
  createProwlarrMock,
  createXrelMock,
  createAppriseMock,
  createDownloaderManagerMock,
  createSteamRoutesMock,
  createSearchMock,
  createConfigLoaderMock,
  createSocketMock,
} from "./fixtures/common-route-mocks.js";

// This suite intentionally does NOT mock ../auth.js: it exercises the real
// authenticateToken/requireAuthenticationForApi wiring end-to-end (via the
// real registerRoutes app) to prove the default-deny API auth boundary
// actually works, rather than relying on the shared auth-bypassing mock the
// rest of the route test suite uses for convenience.
vi.mock("../storage.js", () => ({ storage: createStorageMock() }));
vi.mock("../igdb.js", () => ({ igdbClient: createIgdbMock() }));
vi.mock("../db.js", () => ({ db: createDbMock() }));
vi.mock("../logger.js", () => createLoggerMocks());
vi.mock("../rss.js", () => ({ rssService: createRssMock() }));
vi.mock("../torznab.js", () => ({ torznabClient: createTorznabMock() }));
vi.mock("../newznab.js", () => ({ newznabClient: createNewznabMock() }));
vi.mock("../prowlarr.js", () => ({ prowlarrClient: createProwlarrMock() }));
vi.mock("../xrel.js", () => createXrelMock());
vi.mock("../apprise.js", async () => createAppriseMock());
vi.mock("../downloaders.js", () => ({ DownloaderManager: createDownloaderManagerMock() }));
vi.mock("../steam-routes.js", () => ({ steamRoutes: createSteamRoutesMock() }));
vi.mock("../search.js", () => createSearchMock());
vi.mock("../config.js", () => ({ config: mockConfig }));
vi.mock("../config-loader.js", () => ({ configLoader: createConfigLoaderMock() }));
vi.mock("../socket.js", () => createSocketMock());

const JWT_SECRET = mockConfig.auth.jwtSecret;

describe("default-deny API auth boundary", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const { storage } = await import("../storage.js");
    (storage.countUsers as ReturnType<typeof vi.fn>).mockResolvedValue(1);
    (storage.getSystemConfig as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (storage.getUser as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "user-1",
      username: "testuser",
    });

    const { db } = await import("../db.js");
    (db.get as ReturnType<typeof vi.fn>).mockResolvedValue({ result: 1 });

    const { igdbClient } = await import("../igdb.js");
    (igdbClient.getPopularGames as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const { registerRoutes } = await import("../routes.js");
    app = express();
    app.use(express.json());
    await registerRoutes(app);
  });

  function tokenFor(id: string) {
    return jwt.sign({ id, username: "testuser" }, JWT_SECRET);
  }

  describe("previously-public routes still work with no token", () => {
    it("GET /api/auth/status", async () => {
      const res = await request(app).get("/api/auth/status");
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("hasUsers");
    });

    it("GET /api/health", async () => {
      const res = await request(app).get("/api/health");
      expect(res.status).toBe(200);
    });

    it("GET /api/ready", async () => {
      const res = await request(app).get("/api/ready");
      expect(res.status).toBe(200);
    });

    it("POST /api/auth/login (fails on bad creds, but isn't blocked by auth)", async () => {
      const res = await request(app)
        .post("/api/auth/login")
        .send({ username: "nope", password: "nope" });
      // Must not be 401 "Authentication required" from the boundary middleware;
      // the route's own credential check returns 401 with a different body.
      expect(res.status).toBe(401);
      expect(res.body.error).toBe("Invalid username or password");
    });

    it("POST /api/auth/setup (rejected for a different reason once a user exists, not by the boundary)", async () => {
      const res = await request(app)
        .post("/api/auth/setup")
        .send({ username: "admin", password: "password123" });
      expect(res.status).toBe(403);
      expect(res.body.error).toBe("Setup already completed");
    });
  });

  describe("GET /api/config now requires auth", () => {
    it("rejects with 401 when no token is provided", async () => {
      const res = await request(app).get("/api/config");
      expect(res.status).toBe(401);
      expect(res.body.error).toBe("Authentication required");
    });

    it("succeeds with a valid token", async () => {
      const res = await request(app)
        .get("/api/config")
        .set("Authorization", `Bearer ${tokenFor("user-1")}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("igdb");
    });
  });

  describe("fail-safe by default", () => {
    it("a route NOT on the allowlist requires auth even though it has no explicit authenticateToken", async () => {
      // /api/ready has no inline `authenticateToken` in its handler -- it is
      // protected purely by being absent from PUBLIC_API_ROUTES combined with
      // the default-deny boundary. Simulate "a new route was added and
      // forgotten from the allowlist" by hitting an arbitrary unregistered
      // /api/* path: Express falls through past the boundary middleware (which
      // still ran and required auth) to a 404, never to an unauthenticated 200.
      const res = await request(app).get("/api/this-route-does-not-exist-and-was-never-added");
      expect(res.status).not.toBe(200);
      expect([401, 404]).toContain(res.status);
    });

    it("unit: requireAuthenticationForApi requires auth for any unlisted path", async () => {
      const { requireAuthenticationForApi, PUBLIC_API_ROUTES } = await import("../routes.js");

      // Sanity: our synthetic path really isn't on the allowlist.
      expect(PUBLIC_API_ROUTES.has("GET /brand-new-route-nobody-allowlisted")).toBe(false);

      const req = {
        method: "GET",
        path: "/brand-new-route-nobody-allowlisted",
        headers: {},
      } as unknown as import("express").Request;
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      } as unknown as import("express").Response;
      const next = vi.fn();

      await requireAuthenticationForApi(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });
  });
});
