import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { registerRoutes } from "../routes.js";
import type { Tag, InsertTag, InsertGameTag, User, Game } from "../../shared/schema.js";
import { randomUUID } from "crypto";

const TEST_USER_ID = "user-1";

// Helper to create a test tag
function createTestTag(overrides: Partial<InsertTag> = {}): InsertTag & { userId: string } {
  return {
    id: randomUUID(),
    userId: TEST_USER_ID,
    name: `Test Tag ${randomUUID().slice(0, 8)}`,
    color: "#FF0000",
    ...overrides,
  };
}

// Helper to create a test game
function createTestGame(): Game {
  return {
    id: randomUUID(),
    userId: TEST_USER_ID,
    title: `Test Game ${randomUUID().slice(0, 8)}`,
    igdbId: 12345,
    status: "wanted" as const,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    hidden: false,
    userRating: null,
    installedVersion: null,
    customCover: null,
  };
}

// Mock config
vi.mock("../config.js", () => ({
  config: {
    server: { isProduction: false, allowedOrigins: [] },
    igdb: { isConfigured: false },
    nexusmods: { apiKey: undefined },
    auth: { jwtSecret: "test-secret" },
    database: { url: "test.db" },
    ssl: { enabled: false, port: 5000, certPath: "", keyPath: "", redirectHttp: false },
  },
}));

// Mock auth with proper pattern
vi.mock("../auth.js", async () => {
  const actual = await vi.importActual<typeof import("../auth.js")>("../auth.js");
  return {
    ...actual,
    authenticateToken: (
      req: express.Request,
      _res: express.Response,
      next: express.NextFunction
    ) => {
      (req as express.Request).user = { id: TEST_USER_ID, username: "testuser" } as User;
      next();
    },
    generateApiKey: vi.fn().mockReturnValue("test-api-key"),
    generateToken: vi.fn().mockResolvedValue("mock-token"),
    comparePassword: vi.fn().mockResolvedValue(true),
    hashPassword: vi.fn().mockResolvedValue("hashed-password"),
  };
});

// Mock storage
vi.mock("../storage.js", () => ({
  storage: {
    getTags: vi.fn().mockResolvedValue([]),
    getTag: vi.fn().mockResolvedValue(null),
    createTag: vi.fn().mockResolvedValue(null),
    updateTag: vi.fn().mockResolvedValue(null),
    deleteTag: vi.fn().mockResolvedValue(true),
    getGameTags: vi.fn().mockResolvedValue([]),
    getGamesByTag: vi.fn().mockResolvedValue([]),
    getTagsByIds: vi.fn().mockResolvedValue([]),
    getGamesByIds: vi.fn().mockResolvedValue([]),
    addTagToGame: vi.fn().mockResolvedValue(null),
    removeTagFromGame: vi.fn().mockResolvedValue(true),
    getGame: vi.fn().mockResolvedValue(null),
    getUserByUsername: vi.fn().mockResolvedValue(null),
    getUser: vi.fn().mockResolvedValue(null),
    countUsers: vi.fn().mockResolvedValue(1),
    getSystemConfig: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock db
vi.mock("../db.js", () => ({
  dialect: "sqlite",
  pool: {},
  db: {},
}));

// Mock logger
vi.mock("../logger.js", () => ({
  routesLogger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  },
  logger: { info: vi.fn(), error: vi.fn(), child: vi.fn().mockReturnThis() },
  downloadersLogger: { info: vi.fn(), error: vi.fn(), child: vi.fn().mockReturnThis() },
}));

// Mock igdb
vi.mock("../igdb.js", () => ({
  igdbClient: {
    getGame: vi.fn(),
    searchGames: vi.fn(),
    formatGameData: vi.fn((g) => g),
    getPopularGames: vi.fn().mockResolvedValue([]),
    getRecentReleases: vi.fn().mockResolvedValue([]),
    getUpcomingReleases: vi.fn().mockResolvedValue([]),
    getRecommendations: vi.fn().mockResolvedValue([]),
    getGamesByGenre: vi.fn().mockResolvedValue([]),
    getGamesByPlatform: vi.fn().mockResolvedValue([]),
    getGenres: vi.fn().mockResolvedValue([]),
    getPlatforms: vi.fn().mockResolvedValue([]),
    getGameById: vi.fn(),
    getGamesByIds: vi.fn().mockResolvedValue([]),
    batchSearchGames: vi.fn().mockResolvedValue(new Map()),
  },
}));

// Mock rss
vi.mock("../rss.js", () => ({
  rssService: {},
}));

// Mock torznab
vi.mock("../torznab.js", () => ({
  torznabClient: {},
}));

// Mock newznab
vi.mock("../newznab.js", () => ({
  newznabClient: {},
}));

// Mock prowlarr
vi.mock("../prowlarr.js", () => ({
  prowlarrClient: {},
}));

// Mock xrel
vi.mock("../xrel.js", () => ({
  xrelClient: {},
}));

// Mock apprise
vi.mock("../apprise.js", async () => ({
  appriseClient: {},
  readAppriseSettings: vi.fn().mockResolvedValue({}),
}));

// Mock downloaders
vi.mock("../downloaders.js", () => ({
  DownloaderManager: class {},
}));

// Mock steam-routes
vi.mock("../steam-routes.js", () => {
  const express = require("express");
  const router = express.Router();
  return {
    steamRoutes: router,
  };
});

// Mock search
vi.mock("../search.js", () => ({
  searchAllIndexers: vi.fn(),
}));

// Mock config-loader
vi.mock("../config-loader.js", () => ({
  configLoader: {
    get: vi.fn(),
    set: vi.fn(),
    load: vi.fn(),
    save: vi.fn(),
  },
}));

// Mock socket
vi.mock("../socket.js", () => ({
  socketService: {},
}));

// Mock fs-extra
vi.mock("fs-extra", () => ({
  default: {
    remove: vi.fn(),
    pathExists: vi.fn(),
    readdir: vi.fn(),
  },
}));

// Mock better-sqlite3
vi.mock("better-sqlite3", () => ({
  default: vi.fn().mockImplementation(() => ({
    pragma: vi.fn(),
  })),
}));

// Mock node modules
vi.mock("node:net", () => ({
  default: {
    Socket: class {},
  },
}));

vi.mock("node:dns", () => ({
  default: {
    lookup: vi.fn(),
  },
}));

vi.mock("node:child_process", () => ({
  default: {
    exec: vi.fn(),
  },
}));

// Mock ssrf
vi.mock("../ssrf.js", () => ({
  isSafeUrl: vi.fn().mockReturnValue(true),
}));

describe("Tag Routes", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();

    const { storage } = await import("../storage.js");
    // Reset mocks
    vi.mocked(storage.getTags).mockResolvedValue([]);
    vi.mocked(storage.getTag).mockResolvedValue(null);
    vi.mocked(storage.createTag).mockResolvedValue(null);
    vi.mocked(storage.updateTag).mockResolvedValue(null);
    vi.mocked(storage.deleteTag).mockResolvedValue(true);
    vi.mocked(storage.getGameTags).mockResolvedValue([]);
    vi.mocked(storage.getGamesByTag).mockResolvedValue([]);
    vi.mocked(storage.getTagsByIds).mockResolvedValue([]);
    vi.mocked(storage.getGamesByIds).mockResolvedValue([]);
    vi.mocked(storage.addTagToGame).mockResolvedValue(null);
    vi.mocked(storage.removeTagFromGame).mockResolvedValue(true);
    vi.mocked(storage.getGame).mockResolvedValue(null);
    vi.mocked(storage.countUsers).mockResolvedValue(1);
    vi.mocked(storage.getSystemConfig).mockResolvedValue(undefined);

    app = express();
    app.set("trust proxy", 1);
    app.use(express.json());
    await registerRoutes(app);
  });

  describe("GET /api/tags", () => {
    it("should return empty array when no tags exist", async () => {
      const { storage } = await import("../storage.js");
      vi.mocked(storage.getTags).mockResolvedValueOnce([]);

      const response = await request(app).get("/api/tags").expect(200);

      expect(response.body).toEqual([]);
      expect(storage.getTags).toHaveBeenCalledWith(TEST_USER_ID);
    });

    it("should return all tags for the user", async () => {
      const { storage } = await import("../storage.js");
      const tags = [createTestTag(), createTestTag()];
      vi.mocked(storage.getTags).mockResolvedValueOnce(tags);

      const response = await request(app).get("/api/tags").expect(200);

      expect(response.body).toEqual(tags);
      expect(storage.getTags).toHaveBeenCalledWith(TEST_USER_ID);
    });

    it("should return 500 on storage error", async () => {
      const { storage } = await import("../storage.js");
      vi.mocked(storage.getTags).mockRejectedValueOnce(new Error("Storage error"));

      const response = await request(app).get("/api/tags").expect(500);

      expect(response.body.error).toBe("Failed to get tags");
    });
  });

  describe("GET /api/tags/:tagId", () => {
    it("should return a specific tag", async () => {
      const { storage } = await import("../storage.js");
      const tag = createTestTag();
      vi.mocked(storage.getTag).mockResolvedValueOnce(tag);

      const response = await request(app).get(`/api/tags/${tag.id}`).expect(200);

      expect(response.body).toEqual(tag);
      expect(storage.getTag).toHaveBeenCalledWith(tag.id, TEST_USER_ID);
    });

    it("should return 404 for non-existent tag", async () => {
      const { storage } = await import("../storage.js");
      vi.mocked(storage.getTag).mockResolvedValueOnce(undefined);

      const response = await request(app).get(`/api/tags/${randomUUID()}`).expect(404);

      expect(response.body.error).toBe("Tag not found");
    });

    it("should return 500 on storage error", async () => {
      const { storage } = await import("../storage.js");
      vi.mocked(storage.getTag).mockRejectedValueOnce(new Error("Storage error"));

      const response = await request(app).get(`/api/tags/${randomUUID()}`).expect(500);

      expect(response.body.error).toBe("Failed to get tag");
    });
  });

  describe("POST /api/tags", () => {
    it("should create a new tag", async () => {
      const { storage } = await import("../storage.js");
      const newTag = createTestTag({ name: "New Tag", color: "#00FF00" });
      vi.mocked(storage.createTag).mockResolvedValueOnce(newTag);

      const response = await request(app)
        .post("/api/tags")
        .send({ name: "New Tag", color: "#00FF00" })
        .expect(201);

      expect(response.body).toEqual(newTag);
      expect(storage.createTag).toHaveBeenCalledWith({
        userId: TEST_USER_ID,
        name: "New Tag",
        color: "#00FF00",
      });
    });

    it("should create a tag without color", async () => {
      const { storage } = await import("../storage.js");
      const newTag = createTestTag({ name: "New Tag", color: undefined });
      vi.mocked(storage.createTag).mockResolvedValueOnce(newTag);

      const response = await request(app).post("/api/tags").send({ name: "New Tag" }).expect(201);

      expect(response.body).toEqual(newTag);
    });

    it("should return 400 for missing name", async () => {
      const response = await request(app).post("/api/tags").send({ color: "#FF0000" }).expect(400);

      expect(response.body.error).toContain("name");
    });

    it("should return 500 on storage error", async () => {
      const { storage } = await import("../storage.js");
      vi.mocked(storage.createTag).mockRejectedValueOnce(new Error("Storage error"));

      const response = await request(app).post("/api/tags").send({ name: "New Tag" }).expect(500);

      expect(response.body.error).toBe("Failed to create tag");
    });
  });

  describe("PATCH /api/tags/:tagId", () => {
    it("should update tag name", async () => {
      const { storage } = await import("../storage.js");
      const existingTag = createTestTag();
      const updatedTag = { ...existingTag, name: "Updated Name" };
      vi.mocked(storage.getTag).mockResolvedValueOnce(existingTag);
      vi.mocked(storage.updateTag).mockResolvedValueOnce(updatedTag);

      const response = await request(app)
        .patch(`/api/tags/${existingTag.id}`)
        .send({ name: "Updated Name" })
        .expect(200);

      expect(response.body).toEqual(updatedTag);
      expect(storage.updateTag).toHaveBeenCalledWith(existingTag.id, TEST_USER_ID, {
        name: "Updated Name",
      });
    });

    it("should update tag color", async () => {
      const { storage } = await import("../storage.js");
      const existingTag = createTestTag();
      const updatedTag = { ...existingTag, color: "#0000FF" };
      vi.mocked(storage.getTag).mockResolvedValueOnce(existingTag);
      vi.mocked(storage.updateTag).mockResolvedValueOnce(updatedTag);

      const response = await request(app)
        .patch(`/api/tags/${existingTag.id}`)
        .send({ color: "#0000FF" })
        .expect(200);

      expect(response.body).toEqual(updatedTag);
    });

    it("should update both name and color", async () => {
      const { storage } = await import("../storage.js");
      const existingTag = createTestTag();
      const updatedTag = { ...existingTag, name: "Updated", color: "#FFFF00" };
      vi.mocked(storage.getTag).mockResolvedValueOnce(existingTag);
      vi.mocked(storage.updateTag).mockResolvedValueOnce(updatedTag);

      const response = await request(app)
        .patch(`/api/tags/${existingTag.id}`)
        .send({ name: "Updated", color: "#FFFF00" })
        .expect(200);

      expect(response.body).toEqual(updatedTag);
    });

    it("should allow clearing color with null", async () => {
      const { storage } = await import("../storage.js");
      const existingTag = createTestTag();
      const updatedTag = { ...existingTag, color: null };
      vi.mocked(storage.getTag).mockResolvedValueOnce(existingTag);
      vi.mocked(storage.updateTag).mockResolvedValueOnce(updatedTag);

      const response = await request(app)
        .patch(`/api/tags/${existingTag.id}`)
        .send({ color: null })
        .expect(200);

      expect(response.body).toEqual(updatedTag);
    });

    it("should return 400 for empty body", async () => {
      const response = await request(app).patch(`/api/tags/${randomUUID()}`).send({}).expect(400);

      expect(response.body.error).toBe("At least one field (name or color) must be provided");
    });

    it("should return 404 for non-existent tag", async () => {
      const { storage } = await import("../storage.js");
      vi.mocked(storage.getTag).mockResolvedValueOnce(undefined);

      const response = await request(app)
        .patch(`/api/tags/${randomUUID()}`)
        .send({ name: "Updated" })
        .expect(404);

      expect(response.body.error).toBe("Tag not found");
    });

    it("should return 500 on storage error", async () => {
      const { storage } = await import("../storage.js");
      vi.mocked(storage.updateTag).mockRejectedValueOnce(new Error("Storage error"));

      const response = await request(app)
        .patch(`/api/tags/${randomUUID()}`)
        .send({ name: "Updated" })
        .expect(500);

      expect(response.body.error).toBe("Failed to update tag");
    });
  });

  describe("DELETE /api/tags/:tagId", () => {
    it("should delete a tag", async () => {
      const { storage } = await import("../storage.js");
      vi.mocked(storage.deleteTag).mockResolvedValueOnce(true);

      const response = await request(app).delete(`/api/tags/${randomUUID()}`).expect(200);

      expect(response.body.success).toBe(true);
      expect(storage.deleteTag).toHaveBeenCalledWith(expect.any(String), TEST_USER_ID);
    });

    it("should return 404 for non-existent tag", async () => {
      const { storage } = await import("../storage.js");
      vi.mocked(storage.deleteTag).mockResolvedValueOnce(false);

      const response = await request(app).delete(`/api/tags/${randomUUID()}`).expect(404);

      expect(response.body.error).toBe("Tag not found");
    });

    it("should return 500 on storage error", async () => {
      const { storage } = await import("../storage.js");
      vi.mocked(storage.deleteTag).mockRejectedValueOnce(new Error("Storage error"));

      const response = await request(app).delete(`/api/tags/${randomUUID()}`).expect(500);

      expect(response.body.error).toBe("Failed to delete tag");
    });
  });

  describe("GET /api/games/:gameId/tags", () => {
    it("should return tags for a game", async () => {
      const { storage } = await import("../storage.js");
      const game = createTestGame();
      const gameTags = [
        { id: randomUUID(), gameId: game.id, tagId: randomUUID(), addedAt: Date.now() },
        { id: randomUUID(), gameId: game.id, tagId: randomUUID(), addedAt: Date.now() },
      ];
      const tags = [
        {
          id: gameTags[0].tagId,
          userId: TEST_USER_ID,
          name: "Tag 1",
          color: "#FF0000",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        {
          id: gameTags[1].tagId,
          userId: TEST_USER_ID,
          name: "Tag 2",
          color: "#00FF00",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ];

      vi.mocked(storage.getGame).mockResolvedValueOnce(game);
      vi.mocked(storage.getGameTags).mockResolvedValueOnce(gameTags);
      vi.mocked(storage.getTagsByIds).mockResolvedValueOnce(tags);

      const response = await request(app).get(`/api/games/${game.id}/tags`).expect(200);

      expect(response.body).toHaveLength(2);
      expect(storage.getGame).toHaveBeenCalledWith(game.id);
      expect(storage.getGameTags).toHaveBeenCalledWith(game.id);
    });

    it("should return 404 for non-existent game", async () => {
      const { storage } = await import("../storage.js");
      vi.mocked(storage.getGame).mockResolvedValueOnce(null);

      const response = await request(app).get(`/api/games/${randomUUID()}/tags`).expect(404);

      expect(response.body.error).toBe("Game not found");
    });

    it("should return 500 on storage error", async () => {
      const { storage } = await import("../storage.js");
      vi.mocked(storage.getGameTags).mockRejectedValueOnce(new Error("Storage error"));

      const response = await request(app).get(`/api/games/${randomUUID()}/tags`).expect(500);

      expect(response.body.error).toBe("Failed to get game tags");
    });
  });

  describe("POST /api/games/:gameId/tags", () => {
    it("should add a tag to a game", async () => {
      const { storage } = await import("../storage.js");
      const game = createTestGame();
      const tag = createTestTag();
      const gameTag = {
        id: randomUUID(),
        gameId: game.id,
        tagId: tag.id,
        addedAt: Date.now(),
      };

      vi.mocked(storage.getGame).mockResolvedValueOnce(game);
      vi.mocked(storage.getTag).mockResolvedValueOnce(tag);
      vi.mocked(storage.getGameTags).mockResolvedValueOnce([]);
      vi.mocked(storage.addTagToGame).mockResolvedValueOnce(gameTag);

      const response = await request(app)
        .post(`/api/games/${game.id}/tags`)
        .send({ tagId: tag.id })
        .expect(201);

      expect(response.body).toEqual(gameTag);
      expect(storage.getGame).toHaveBeenCalledWith(game.id);
      expect(storage.getTag).toHaveBeenCalledWith(tag.id, TEST_USER_ID);
      expect(storage.addTagToGame).toHaveBeenCalledWith({ gameId: game.id, tagId: tag.id });
    });

    it("should return 404 for non-existent game", async () => {
      const { storage } = await import("../storage.js");
      vi.mocked(storage.getGame).mockResolvedValueOnce(null);

      const response = await request(app)
        .post(`/api/games/${randomUUID()}/tags`)
        .send({ tagId: randomUUID() })
        .expect(404);

      expect(response.body.error).toBe("Game not found");
    });

    it("should return 404 for non-existent tag", async () => {
      const { storage } = await import("../storage.js");
      const game = createTestGame();
      vi.mocked(storage.getGame).mockResolvedValueOnce(game);
      vi.mocked(storage.getTag).mockResolvedValueOnce(undefined);

      const response = await request(app)
        .post(`/api/games/${game.id}/tags`)
        .send({ tagId: randomUUID() })
        .expect(404);

      expect(response.body.error).toBe("Tag not found");
    });

    it("should return 409 for duplicate tag", async () => {
      const { storage } = await import("../storage.js");
      const game = createTestGame();
      const tag = createTestTag();
      const existingGameTag = {
        id: randomUUID(),
        gameId: game.id,
        tagId: tag.id,
        addedAt: Date.now(),
      };

      vi.mocked(storage.getGame).mockResolvedValueOnce(game);
      vi.mocked(storage.getTag).mockResolvedValueOnce(tag);
      vi.mocked(storage.getGameTags).mockResolvedValueOnce([existingGameTag]);

      const response = await request(app)
        .post(`/api/games/${game.id}/tags`)
        .send({ tagId: tag.id })
        .expect(409);

      expect(response.body.error).toBe("Tag already added to this game");
    });

    it("should return 500 on storage error", async () => {
      const { storage } = await import("../storage.js");
      vi.mocked(storage.addTagToGame).mockRejectedValueOnce(new Error("Storage error"));

      const response = await request(app)
        .post(`/api/games/${randomUUID()}/tags`)
        .send({ tagId: randomUUID() })
        .expect(500);

      expect(response.body.error).toBe("Failed to add tag to game");
    });
  });

  describe("DELETE /api/games/:gameId/tags/:tagId", () => {
    it("should remove a tag from a game", async () => {
      const { storage } = await import("../storage.js");
      const game = createTestGame();
      const tag = createTestTag();

      vi.mocked(storage.getTag).mockResolvedValueOnce(tag);
      vi.mocked(storage.removeTagFromGame).mockResolvedValueOnce(true);

      const response = await request(app)
        .delete(`/api/games/${game.id}/tags/${tag.id}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(storage.getTag).toHaveBeenCalledWith(tag.id, TEST_USER_ID);
      expect(storage.removeTagFromGame).toHaveBeenCalledWith(game.id, tag.id);
    });

    it("should return 404 for non-existent tag", async () => {
      const { storage } = await import("../storage.js");
      vi.mocked(storage.getTag).mockResolvedValueOnce(undefined);

      const response = await request(app)
        .delete(`/api/games/${randomUUID()}/tags/${randomUUID()}`)
        .expect(404);

      expect(response.body.error).toBe("Tag not found");
    });

    it("should return 404 for tag not on game", async () => {
      const { storage } = await import("../storage.js");
      const tag = createTestTag();
      vi.mocked(storage.getTag).mockResolvedValueOnce(tag);
      vi.mocked(storage.removeTagFromGame).mockResolvedValueOnce(false);

      const response = await request(app)
        .delete(`/api/games/${randomUUID()}/tags/${tag.id}`)
        .expect(404);

      expect(response.body.error).toBe("Tag not found on this game");
    });

    it("should return 500 on storage error", async () => {
      const { storage } = await import("../storage.js");
      vi.mocked(storage.removeTagFromGame).mockRejectedValueOnce(new Error("Storage error"));

      const response = await request(app)
        .delete(`/api/games/${randomUUID()}/tags/${randomUUID()}`)
        .expect(500);

      expect(response.body.error).toBe("Failed to remove tag from game");
    });
  });

  describe("GET /api/tags/:tagId/games", () => {
    it("should return games for a tag", async () => {
      const { storage } = await import("../storage.js");
      const tag = createTestTag();
      const gameIds = [randomUUID(), randomUUID()];
      const games = gameIds.map((id) => createTestGame());
      games[0].id = gameIds[0];
      games[1].id = gameIds[1];

      vi.mocked(storage.getTag).mockResolvedValueOnce(tag);
      vi.mocked(storage.getGamesByTag).mockResolvedValueOnce(gameIds);
      vi.mocked(storage.getGamesByIds).mockResolvedValueOnce(games);

      const response = await request(app).get(`/api/tags/${tag.id}/games`).expect(200);

      expect(response.body).toEqual(games);
      expect(storage.getTag).toHaveBeenCalledWith(tag.id, TEST_USER_ID);
      expect(storage.getGamesByTag).toHaveBeenCalledWith(tag.id, TEST_USER_ID);
    });

    it("should return 404 for non-existent tag", async () => {
      const { storage } = await import("../storage.js");
      vi.mocked(storage.getTag).mockResolvedValueOnce(undefined);

      const response = await request(app).get(`/api/tags/${randomUUID()}/games`).expect(404);

      expect(response.body.error).toBe("Tag not found");
    });

    it("should return 500 on storage error", async () => {
      const { storage } = await import("../storage.js");
      vi.mocked(storage.getGamesByTag).mockRejectedValueOnce(new Error("Storage error"));

      const response = await request(app).get(`/api/tags/${randomUUID()}/games`).expect(500);

      expect(response.body.error).toBe("Failed to get games by tag");
    });
  });
});
