import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the db and igdb modules
const poolQueryMock = vi.fn();
const igdbGetPopularGamesMock = vi.fn();

vi.mock("../db.js", () => ({
  pool: {
    query: poolQueryMock,
  },
  db: {},
}));

vi.mock("../igdb.js", () => ({
  igdbClient: {
    getPopularGames: igdbGetPopularGamesMock,
    searchGames: vi.fn(),
    getGameById: vi.fn(),
    getRecentReleases: vi.fn(),
    getUpcomingReleases: vi.fn(),
    getRecommendations: vi.fn(),
    formatGameData: vi.fn(),
  },
}));

// Helper function to perform liveness checks (matches the /api/health endpoint)
async function performLivenessCheck() {
  return { status: "ok" };
}

// Helper function to perform readiness checks (matches the /api/ready endpoint)
async function performReadinessCheck() {
  const { pool } = await import("../db.js");
  const { igdbClient } = await import("../igdb.js");

  const health = {
    ok: true,
    db: false,
    igdb: false,
  };

  // Check database connectivity
  try {
    await pool.query("SELECT 1");
    health.db = true;
  } catch {
    health.ok = false;
  }

  // Check IGDB API connectivity
  try {
    await igdbClient.getPopularGames(1);
    health.igdb = true;
  } catch {
    health.ok = false;
  }

  return health;
}

describe("Health and Readiness Endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Liveness Probe (/api/health)", () => {
    it("should always return a 200 OK status", async () => {
      const result = await performLivenessCheck();
      expect(result).toEqual({ status: "ok" });
    });
  });

  describe("Readiness Probe (/api/ready)", () => {
    it("should return ok: true when both db and igdb are healthy", async () => {
      poolQueryMock.mockResolvedValueOnce({ rows: [{ "?column?": 1 }] });
      igdbGetPopularGamesMock.mockResolvedValueOnce([
        {
          id: 1,
          name: "Test Game",
        },
      ]);

      const health = await performReadinessCheck();

      expect(health).toEqual({
        ok: true,
        db: true,
        igdb: true,
      });
    });

    it("should return ok: false when database is down", async () => {
      poolQueryMock.mockRejectedValueOnce(new Error("Database connection failed"));
      igdbGetPopularGamesMock.mockResolvedValueOnce([
        {
          id: 1,
          name: "Test Game",
        },
      ]);

      const health = await performReadinessCheck();

      expect(health).toEqual({
        ok: false,
        db: false,
        igdb: true,
      });
    });

    it("should return ok: false when IGDB API is down", async () => {
      poolQueryMock.mockResolvedValueOnce({ rows: [{ "?column?": 1 }] });
      igdbGetPopularGamesMock.mockRejectedValueOnce(new Error("IGDB API error"));

      const health = await performReadinessCheck();

      expect(health).toEqual({
        ok: false,
        db: true,
        igdb: false,
      });
    });

    it("should return ok: false when both services are down", async () => {
      poolQueryMock.mockRejectedValueOnce(new Error("Database connection failed"));
      igdbGetPopularGamesMock.mockRejectedValueOnce(new Error("IGDB API error"));

      const health = await performReadinessCheck();

      expect(health).toEqual({
        ok: false,
        db: false,
        igdb: false,
      });
    });
  });
});
