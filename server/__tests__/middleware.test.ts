import { describe, it, expect, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import {
  validateRequest,
  sanitizeSearchQuery,
  sanitizeGameId,
  sanitizeIgdbId,
  sanitizeGameStatus,
  sanitizeGameData,
  sanitizeIndexerData,
  sanitizeDownloaderData,
  sanitizeTorrentData,
  sanitizeIndexerSearchQuery,
} from "../middleware";

// Mock request and response objects
const createMockRequest = (overrides: Partial<Request> = {}): Partial<Request> => ({
  query: {},
  params: {},
  body: {},
  ...overrides,
});

const createMockResponse = (): Partial<Response> => {
  const res: Record<string, unknown> = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res as Partial<Response>;
};

const createMockNext = (): NextFunction => vi.fn();

describe("Middleware - Input Sanitization", () => {
  describe("sanitizeSearchQuery", () => {
    it("should allow valid search query", async () => {
      const req = createMockRequest({ query: { q: "valid search" } });
      const res = createMockResponse();
      const next = createMockNext();

      // Execute all sanitization validators
      for (const validator of sanitizeSearchQuery) {
        await validator(req as Request, res as Response, next);
      }

      // Execute validateRequest
      validateRequest(req as Request, res as Response, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it("should reject search query that is too long", async () => {
      const longQuery = "a".repeat(201);
      const req = createMockRequest({ query: { q: longQuery } });
      const res = createMockResponse();
      const next = createMockNext();

      for (const validator of sanitizeSearchQuery) {
        await validator(req as Request, res as Response, next);
      }

      validateRequest(req as Request, res as Response, next);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("should reject torrent with absolute download path", async () => {
      const req = createMockRequest({
        body: {
          url: "https://example.com/torrent.torrent",
          title: "Test",
          downloadPath: "/etc/passwd",
        },
      });
      const res = createMockResponse();
      const next = createMockNext();

      for (const validator of sanitizeTorrentData) {
        await validator(req as Request, res as Response, next);
      }

      validateRequest(req as Request, res as Response, next);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("should reject torrent with path traversal", async () => {
      const req = createMockRequest({
        body: {
          url: "https://example.com/torrent.torrent",
          title: "Test",
          downloadPath: "../../../root",
        },
      });
      const res = createMockResponse();
      const next = createMockNext();

      for (const validator of sanitizeTorrentData) {
        await validator(req as Request, res as Response, next);
      }

      validateRequest(req as Request, res as Response, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: "Validation failed",
        })
      );
    });

    it("should trim and sanitize search query", async () => {
      const req = createMockRequest({ query: { q: "  search query  " } });
      const res = createMockResponse();
      const next = createMockNext();

      for (const validator of sanitizeSearchQuery) {
        await validator(req as Request, res as Response, next);
      }

      expect(req.query?.q).toBe("search query");
    });
  });

  describe("sanitizeGameId", () => {
    it("should allow valid UUID", async () => {
      const validUuid = "123e4567-e89b-12d3-a456-426614174000";
      const req = createMockRequest({ params: { id: validUuid } });
      const res = createMockResponse();
      const next = createMockNext();

      for (const validator of sanitizeGameId) {
        await validator(req as Request, res as Response, next);
      }

      validateRequest(req as Request, res as Response, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it("should reject invalid UUID", async () => {
      const invalidUuid = "not-a-uuid";
      const req = createMockRequest({ params: { id: invalidUuid } });
      const res = createMockResponse();
      const next = createMockNext();

      for (const validator of sanitizeGameId) {
        await validator(req as Request, res as Response, next);
      }

      validateRequest(req as Request, res as Response, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: "Validation failed",
        })
      );
    });
  });

  describe("sanitizeIgdbId", () => {
    it("should allow valid IGDB ID", async () => {
      const req = createMockRequest({ params: { id: "12345" } });
      const res = createMockResponse();
      const next = createMockNext();

      for (const validator of sanitizeIgdbId) {
        await validator(req as Request, res as Response, next);
      }

      validateRequest(req as Request, res as Response, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it("should reject negative IGDB ID", async () => {
      const req = createMockRequest({ params: { id: "-1" } });
      const res = createMockResponse();
      const next = createMockNext();

      for (const validator of sanitizeIgdbId) {
        await validator(req as Request, res as Response, next);
      }

      validateRequest(req as Request, res as Response, next);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("should reject non-numeric IGDB ID", async () => {
      const req = createMockRequest({ params: { id: "abc" } });
      const res = createMockResponse();
      const next = createMockNext();

      for (const validator of sanitizeIgdbId) {
        await validator(req as Request, res as Response, next);
      }

      validateRequest(req as Request, res as Response, next);

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe("sanitizeGameStatus", () => {
    it("should allow valid game status", async () => {
      const validStatuses = ["wanted", "owned", "completed", "downloading"];

      for (const status of validStatuses) {
        const req = createMockRequest({ body: { status } });
        const res = createMockResponse();
        const next = createMockNext();

        for (const validator of sanitizeGameStatus) {
          await validator(req as Request, res as Response, next);
        }

        validateRequest(req as Request, res as Response, next);

        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
      }
    });

    it("should reject invalid game status", async () => {
      const req = createMockRequest({ body: { status: "invalid-status" } });
      const res = createMockResponse();
      const next = createMockNext();

      for (const validator of sanitizeGameStatus) {
        await validator(req as Request, res as Response, next);
      }

      validateRequest(req as Request, res as Response, next);

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe("sanitizeGameData", () => {
    it("should allow valid game data", async () => {
      const validGameData = {
        title: "Test Game",
        igdbId: 12345,
        summary: "A test game summary",
        coverUrl: "https://example.com/cover.jpg",
        releaseDate: "2024-01-01",
        rating: 8.5,
        platforms: ["PC", "PlayStation 5"],
        genres: ["Action", "Adventure"],
      };

      const req = createMockRequest({ body: validGameData });
      const res = createMockResponse();
      const next = createMockNext();

      for (const validator of sanitizeGameData) {
        await validator(req as Request, res as Response, next);
      }

      validateRequest(req as Request, res as Response, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it("should reject game with missing title", async () => {
      const req = createMockRequest({ body: { summary: "No title" } });
      const res = createMockResponse();
      const next = createMockNext();

      for (const validator of sanitizeGameData) {
        await validator(req as Request, res as Response, next);
      }

      validateRequest(req as Request, res as Response, next);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("should reject game with invalid rating", async () => {
      const req = createMockRequest({
        body: { title: "Test", rating: 15 },
      });
      const res = createMockResponse();
      const next = createMockNext();

      for (const validator of sanitizeGameData) {
        await validator(req as Request, res as Response, next);
      }

      validateRequest(req as Request, res as Response, next);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("should reject game with invalid URL", async () => {
      const req = createMockRequest({
        body: { title: "Test", coverUrl: "not-a-url" },
      });
      const res = createMockResponse();
      const next = createMockNext();

      for (const validator of sanitizeGameData) {
        await validator(req as Request, res as Response, next);
      }

      validateRequest(req as Request, res as Response, next);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("should reject game with invalid date format", async () => {
      const req = createMockRequest({
        body: { title: "Test", releaseDate: "2024/01/01" },
      });
      const res = createMockResponse();
      const next = createMockNext();

      for (const validator of sanitizeGameData) {
        await validator(req as Request, res as Response, next);
      }

      validateRequest(req as Request, res as Response, next);

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe("sanitizeIndexerData", () => {
    it("should allow valid indexer data", async () => {
      const validIndexerData = {
        name: "Test Indexer",
        url: "https://example.com/indexer",
        apiKey: "test-api-key",
        enabled: true,
      };

      const req = createMockRequest({ body: validIndexerData });
      const res = createMockResponse();
      const next = createMockNext();

      for (const validator of sanitizeIndexerData) {
        await validator(req as Request, res as Response, next);
      }

      validateRequest(req as Request, res as Response, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it("should reject indexer with invalid URL", async () => {
      const req = createMockRequest({
        body: { name: "Test", url: "not-a-url" },
      });
      const res = createMockResponse();
      const next = createMockNext();

      for (const validator of sanitizeIndexerData) {
        await validator(req as Request, res as Response, next);
      }

      validateRequest(req as Request, res as Response, next);

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe("sanitizeDownloaderData", () => {
    it("should allow valid downloader data", async () => {
      const validDownloaderData = {
        name: "Test Downloader",
        type: "qbittorrent",
        url: "https://example.com:8080",
        username: "admin",
        password: "password",
        enabled: true,
      };

      const req = createMockRequest({ body: validDownloaderData });
      const res = createMockResponse();
      const next = createMockNext();

      for (const validator of sanitizeDownloaderData) {
        await validator(req as Request, res as Response, next);
      }

      validateRequest(req as Request, res as Response, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it("should reject downloader with invalid type", async () => {
      const req = createMockRequest({
        body: {
          name: "Test",
          type: "invalid-type",
          url: "https://example.com",
        },
      });
      const res = createMockResponse();
      const next = createMockNext();

      for (const validator of sanitizeDownloaderData) {
        await validator(req as Request, res as Response, next);
      }

      validateRequest(req as Request, res as Response, next);

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe("sanitizeTorrentData", () => {
    it("should allow valid torrent data", async () => {
      const validTorrentData = {
        url: "https://example.com/torrent.torrent",
        title: "Test Torrent",
        category: "games",
        downloadPath: "downloads/games",
        priority: 5,
      };

      const req = createMockRequest({ body: validTorrentData });
      const res = createMockResponse();
      const next = createMockNext();

      for (const validator of sanitizeTorrentData) {
        await validator(req as Request, res as Response, next);
      }

      validateRequest(req as Request, res as Response, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it("should reject torrent with invalid URL", async () => {
      const req = createMockRequest({
        body: { url: "not-a-url", title: "Test" },
      });
      const res = createMockResponse();
      const next = createMockNext();

      for (const validator of sanitizeTorrentData) {
        await validator(req as Request, res as Response, next);
      }

      validateRequest(req as Request, res as Response, next);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("should reject torrent with invalid priority", async () => {
      const req = createMockRequest({
        body: {
          url: "https://example.com/torrent.torrent",
          title: "Test",
          priority: 15,
        },
      });
      const res = createMockResponse();
      const next = createMockNext();

      for (const validator of sanitizeTorrentData) {
        await validator(req as Request, res as Response, next);
      }

      validateRequest(req as Request, res as Response, next);

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe("sanitizeIndexerSearchQuery", () => {
    it("should allow valid search query", async () => {
      const req = createMockRequest({ query: { query: "game search" } });
      const res = createMockResponse();
      const next = createMockNext();

      for (const validator of sanitizeIndexerSearchQuery) {
        await validator(req as Request, res as Response, next);
      }

      validateRequest(req as Request, res as Response, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it("should reject search query that is too long", async () => {
      const longQuery = "a".repeat(201);
      const req = createMockRequest({ query: { query: longQuery } });
      const res = createMockResponse();
      const next = createMockNext();

      for (const validator of sanitizeIndexerSearchQuery) {
        await validator(req as Request, res as Response, next);
      }

      validateRequest(req as Request, res as Response, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: "Validation failed",
        })
      );
    });

    it("should reject limit greater than 100", async () => {
      const req = createMockRequest({ query: { query: "test", limit: "150" } });
      const res = createMockResponse();
      const next = createMockNext();

      for (const validator of sanitizeIndexerSearchQuery) {
        await validator(req as Request, res as Response, next);
      }

      validateRequest(req as Request, res as Response, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: "Validation failed",
        })
      );
    });

    it("should reject limit less than 1", async () => {
      const req = createMockRequest({ query: { query: "test", limit: "0" } });
      const res = createMockResponse();
      const next = createMockNext();

      for (const validator of sanitizeIndexerSearchQuery) {
        await validator(req as Request, res as Response, next);
      }

      validateRequest(req as Request, res as Response, next);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("should reject negative offset", async () => {
      const req = createMockRequest({ query: { query: "test", offset: "-5" } });
      const res = createMockResponse();
      const next = createMockNext();

      for (const validator of sanitizeIndexerSearchQuery) {
        await validator(req as Request, res as Response, next);
      }

      validateRequest(req as Request, res as Response, next);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("should allow valid limit and offset", async () => {
      const req = createMockRequest({ query: { query: "test", limit: "50", offset: "10" } });
      const res = createMockResponse();
      const next = createMockNext();

      for (const validator of sanitizeIndexerSearchQuery) {
        await validator(req as Request, res as Response, next);
      }

      validateRequest(req as Request, res as Response, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it("should convert limit and offset to integers", async () => {
      const req = createMockRequest({ query: { query: "test", limit: "50", offset: "10" } });
      const res = createMockResponse();
      const next = createMockNext();

      for (const validator of sanitizeIndexerSearchQuery) {
        await validator(req as Request, res as Response, next);
      }

      expect(req.query?.limit).toBe(50);
      expect(req.query?.offset).toBe(10);
    });
  });
});
