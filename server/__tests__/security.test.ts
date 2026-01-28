import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import { registerRoutes } from "../routes.js";

// Mock dependencies
vi.mock("../db.js", () => ({
  db: {
    get: vi.fn(),
  },
  pool: {
    query: vi.fn(),
  },
}));

vi.mock("../storage.js", () => ({
  storage: {
    countUsers: vi.fn().mockResolvedValue(0),
    getSystemConfig: vi.fn(),
  },
}));

vi.mock("../igdb.js", () => ({
  igdbClient: {
    getPopularGames: vi.fn(),
  },
}));

vi.mock("../torznab.js", () => ({
  torznabClient: {},
}));

vi.mock("../prowlarr.js", () => ({
  prowlarrClient: {},
}));

describe("Security Headers", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = express();
    await registerRoutes(app);
  });

  it("should set Content-Security-Policy header", async () => {
    const response = await request(app).get("/api/auth/status");
    expect(response.headers["content-security-policy"]).toBeDefined();
    // Check for IGDB images
    expect(response.headers["content-security-policy"]).toContain("https://images.igdb.com");
  });

  it("should set X-Frame-Options header", async () => {
    const response = await request(app).get("/api/auth/status");
    expect(response.headers["x-frame-options"]).toBe("SAMEORIGIN");
  });

  it("should set X-Content-Type-Options header", async () => {
    const response = await request(app).get("/api/auth/status");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
  });
});
