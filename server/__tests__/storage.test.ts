import { describe, it, expect, beforeEach, vi } from "vitest";
import type { InsertGame } from "../../shared/schema";
import type { MemStorage as MemStorageType } from "../storage.js";

// Mock db.ts to avoid SQLite connection
vi.mock("../db.js", () => ({
  pool: {},
  db: {},
}));

// Import after mocking
import type { InsertGame, InsertUser, InsertIndexer, InsertDownloader } from "../../shared/schema";
import type { MemStorage as MemStorageType } from "../storage.js";

// Mock native modules to prevent loading
vi.mock("better-sqlite3", () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      pragma: vi.fn(),
    })),
  };
});

// Mock db to avoid Drizzle connection
vi.mock("../db", () => {
  return {
    pool: {},
    db: {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      returning: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      transaction: vi.fn((cb) => cb({
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockReturnThis(),
        returning: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
      })),
    },
  };
});

// Import after mocking
const { MemStorage } = await import("../storage.js");

describe("MemStorage", () => {
  let storage: MemStorageType;

  beforeEach(() => {
    storage = new MemStorage();
  });

  describe("User Management", () => {
    it("should create and retrieve a user", async () => {
      const userData: InsertUser = {
        username: "testuser",
        passwordHash: "hashedpassword",
      };

      const user = await storage.registerSetupUser(userData);
      expect(user.id).toBeDefined();
      expect(user.username).toBe(userData.username);
      expect(user.passwordHash).toBe(userData.passwordHash);

      const retrievedUser = await storage.getUser(user.id);
      expect(retrievedUser).toEqual(user);

      const retrievedByName = await storage.getUserByUsername(userData.username);
      expect(retrievedByName).toEqual(user);
    });

    it("should return undefined for non-existent user", async () => {
      const user = await storage.getUser("non-existent-id");
      expect(user).toBeUndefined();
    });
  });

  describe("Game Management", () => {
    it("should add and retrieve games", async () => {
      const gameData: InsertGame = {
        title: "Test Game",
        igdbId: 12345,
        status: "wanted",
        summary: "Test Summary",
        rating: 8.5,
        platforms: ["PC"],
        genres: ["Action"],
        screenshots: [],
        hidden: false,
        userId: "user-1"
      };

      const game = await storage.addGame(gameData);
      expect(game.id).toBeDefined();
      expect(game.title).toBe(gameData.title);
      expect(game.status).toBe("wanted");

      const retrievedGame = await storage.getGame(game.id);
      expect(retrievedGame).toEqual(game);
    });

    it('should preserve status when explicitly set to "owned"', async () => {
      const gameData: InsertGame = {
        title: "Owned Game",
        igdbId: 67890,
        status: "owned",
        hidden: null,
        userId: "user-1"
      };
      const addedGame = await storage.addGame(gameData);
      expect(addedGame.status).toBe("owned");
    });

    it("should update game status", async () => {
      const gameData: InsertGame = { title: "Game", igdbId: 1, status: "wanted", userId: "user-1" };
      const game = await storage.addGame(gameData);

      const updated = await storage.updateGameStatus(game.id, { status: "downloading" });
      expect(updated?.status).toBe("downloading");

      const retrieved = await storage.getGame(game.id);
      expect(retrieved?.status).toBe("downloading");
    });

    it("should remove a game", async () => {
      const gameData: InsertGame = { title: "Game to Remove", igdbId: 2, status: "wanted", userId: "user-1" };
      const game = await storage.addGame(gameData);

      const result = await storage.removeGame(game.id);
      expect(result).toBe(true);

      const retrieved = await storage.getGame(game.id);
      expect(retrieved).toBeUndefined();
    });

    it("should return null/false when updating/removing non-existent game", async () => {
      const updated = await storage.updateGameStatus("fake-id", { status: "downloading" });
      expect(updated).toBeUndefined(); // MemStorage returns undefined for not found

      const removed = await storage.removeGame("fake-id");
      expect(removed).toBe(false);
    });
  });

  describe("Indexer Management", () => {
    it("should create, retreive and sync indexers", async () => {
      const indexerData: InsertIndexer = {
        name: "Test Indexer",
        url: "http://example.com",
        apiKey: "key",
        protocol: "torznab",
        enabled: true,
        priority: 1
      };

      // MemStorage needs syncIndexers to be consistent with IStorage
      // But for MemStorage specific tests we might valid add/get logic if exposed?
      // MemStorage interface usually has CRUD. Let's assume standard behavior.

      // syncIndexers is the main way to add in bulk
      const result = await storage.syncIndexers([indexerData as any]); // partial match
      expect(result.added).toBe(1);

      const indexers = await storage.getAllIndexers();
      expect(indexers).toHaveLength(1);
      expect(indexers[0].name).toBe("Test Indexer");
    });
  });

  describe("Downloader Management", () => {
    it("should CRUD downloaders", async () => {
      const dlData: InsertDownloader = {
        name: "Transmission",
        type: "transmission",
        url: "http://localhost:9091",
        enabled: true,
        priority: 1
      };

      const downloader = await storage.addDownloader(dlData); // Changed createDownloader to addDownloader
      expect(downloader.id).toBeDefined();

      const all = await storage.getAllDownloaders(); // Changed getDownloaders to getAllDownloaders
      expect(all).toHaveLength(1);

      const updated = await storage.updateDownloader(downloader.id, { enabled: false });
      expect(updated?.enabled).toBe(false);

      await storage.removeDownloader(downloader.id); // Changed deleteDownloader to removeDownloader
      expect(await storage.getAllDownloaders()).toHaveLength(0);
    });
  });

  describe("System Config", () => {
    it("should set and get system config", async () => {
      await storage.setSystemConfig("test.key", "test-value");
      const value = await storage.getSystemConfig("test.key");
      expect(value).toBe("test-value");
    });

    it("should return undefined for missing config", async () => {
      const value = await storage.getSystemConfig("missing.key");
      expect(value).toBeUndefined();
    });
  });
});
