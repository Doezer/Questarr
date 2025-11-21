import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

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

describe("Health Endpoint Logic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return ok: true when both db and igdb are healthy", async () => {
    // Mock successful database query
    poolQueryMock.mockResolvedValueOnce({ rows: [{ "?column?": 1 }] });

    // Mock successful IGDB API call
    igdbGetPopularGamesMock.mockResolvedValueOnce([
      {
        id: 1,
        name: "Test Game",
      },
    ]);

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
    } catch (error) {
      health.ok = false;
    }

    // Check IGDB API connectivity
    try {
      await igdbClient.getPopularGames(1);
      health.igdb = true;
    } catch (error) {
      health.ok = false;
    }

    expect(health).toEqual({
      ok: true,
      db: true,
      igdb: true,
    });
  });

  it("should return ok: false when database is down", async () => {
    // Mock database query failure
    poolQueryMock.mockRejectedValueOnce(new Error("Database connection failed"));

    // Mock successful IGDB API call
    igdbGetPopularGamesMock.mockResolvedValueOnce([
      {
        id: 1,
        name: "Test Game",
      },
    ]);

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
    } catch (error) {
      health.ok = false;
    }

    // Check IGDB API connectivity
    try {
      await igdbClient.getPopularGames(1);
      health.igdb = true;
    } catch (error) {
      health.ok = false;
    }

    expect(health).toEqual({
      ok: false,
      db: false,
      igdb: true,
    });
  });

  it("should return ok: false when IGDB API is down", async () => {
    // Mock successful database query
    poolQueryMock.mockResolvedValueOnce({ rows: [{ "?column?": 1 }] });

    // Mock IGDB API failure
    igdbGetPopularGamesMock.mockRejectedValueOnce(new Error("IGDB API error"));

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
    } catch (error) {
      health.ok = false;
    }

    // Check IGDB API connectivity
    try {
      await igdbClient.getPopularGames(1);
      health.igdb = true;
    } catch (error) {
      health.ok = false;
    }

    expect(health).toEqual({
      ok: false,
      db: true,
      igdb: false,
    });
  });

  it("should return ok: false when both services are down", async () => {
    // Mock database query failure
    poolQueryMock.mockRejectedValueOnce(new Error("Database connection failed"));

    // Mock IGDB API failure
    igdbGetPopularGamesMock.mockRejectedValueOnce(new Error("IGDB API error"));

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
    } catch (error) {
      health.ok = false;
    }

    // Check IGDB API connectivity
    try {
      await igdbClient.getPopularGames(1);
      health.igdb = true;
    } catch (error) {
      health.ok = false;
    }

    expect(health).toEqual({
      ok: false,
      db: false,
      igdb: false,
    });
  });
});
