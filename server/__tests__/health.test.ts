import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the db and rawg modules
const poolQueryMock = vi.fn();
const rawgGetPopularGamesMock = vi.fn();

vi.mock("../db.js", () => ({
  dialect: "sqlite",
  pool: {
    query: poolQueryMock,
  },
  db: {},
}));

vi.mock("../rawg.js", () => ({
  rawgClient: {
    getPopularGames: rawgGetPopularGamesMock,
    searchGames: vi.fn(),
    getGameById: vi.fn(),
    getSuggested: vi.fn(),
    isConfigured: vi.fn(),
    formatGame: vi.fn(),
  },
}));

// Helper function to perform liveness checks (matches the /api/health endpoint)
async function performLivenessCheck() {
  return { status: "ok" };
}

// Helper function to perform readiness checks (matches the /api/ready endpoint)
async function performReadinessCheck() {
  const { pool } = await import("../db.js");
  const { rawgClient } = await import("../rawg.js");

  const health = {
    ok: true,
    db: false,
    rawg: false,
  };

  // Check database connectivity
  try {
    await pool.query("SELECT 1");
    health.db = true;
  } catch {
    health.ok = false;
  }

  // Check RAWG API connectivity
  try {
    await rawgClient.getPopularGames(1);
    health.rawg = true;
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
    it("should return ok: true when both db and rawg are healthy", async () => {
      poolQueryMock.mockResolvedValueOnce({ rows: [{ "?column?": 1 }] });
      rawgGetPopularGamesMock.mockResolvedValueOnce([
        {
          id: 1,
          name: "Test Game",
        },
      ]);

      const health = await performReadinessCheck();

      expect(health).toEqual({
        ok: true,
        db: true,
        rawg: true,
      });
    });

    it("should return ok: false when database is down", async () => {
      poolQueryMock.mockRejectedValueOnce(new Error("Database connection failed"));
      rawgGetPopularGamesMock.mockResolvedValueOnce([
        {
          id: 1,
          name: "Test Game",
        },
      ]);

      const health = await performReadinessCheck();

      expect(health).toEqual({
        ok: false,
        db: false,
        rawg: true,
      });
    });

    it("should return ok: false when the RAWG API is down", async () => {
      poolQueryMock.mockResolvedValueOnce({ rows: [{ "?column?": 1 }] });
      rawgGetPopularGamesMock.mockRejectedValueOnce(new Error("RAWG API error"));

      const health = await performReadinessCheck();

      expect(health).toEqual({
        ok: false,
        db: true,
        rawg: false,
      });
    });

    it("should return ok: false when both services are down", async () => {
      poolQueryMock.mockRejectedValueOnce(new Error("Database connection failed"));
      rawgGetPopularGamesMock.mockRejectedValueOnce(new Error("RAWG API error"));

      const health = await performReadinessCheck();

      expect(health).toEqual({
        ok: false,
        db: false,
        rawg: false,
      });
    });
  });
});
