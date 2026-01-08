import { describe, it, expect, beforeEach, vi } from "vitest";
import type { InsertGame } from "../../shared/schema";
import type { MemStorage as MemStorageType } from "../storage.js";

// Mock db.ts to avoid DATABASE_URL requirement
vi.mock("../db.js", () => ({
  pool: {},
  db: {},
}));

// Import after mocking
const { MemStorage } = await import("../storage.js");

describe("Storage - insertGame with status null to wanted", () => {
  let storage: MemStorageType;

  beforeEach(() => {
    storage = new MemStorage();
  });

  it('should preserve status when explicitly set to "owned"', async () => {
    // Create a game with status explicitly set to "owned"
    const gameData: InsertGame = {
      title: "Owned Game",
      igdbId: 67890,
      status: "owned",
      summary: "A game I own",
      coverUrl: "https://example.com/owned.jpg",
      releaseDate: "2024-02-01",
      rating: 9.0,
      platforms: ["Xbox Series X|S"],
      genres: ["RPG"],
      screenshots: [],
      hidden: null
    };

    // Add the game to storage
    const addedGame = await storage.addGame(gameData);

    // Verify the status was preserved
    expect(addedGame.status).toBe("owned");
    expect(addedGame.title).toBe("Owned Game");
  });

  it('should preserve status when explicitly set to "completed"', async () => {
    // Create a game with status explicitly set to "completed"
    const gameData: InsertGame = {
      title: "Completed Game",
      igdbId: 11111,
      status: "completed",
      summary: "A game I completed",
      coverUrl: "https://example.com/completed.jpg",
      releaseDate: "2023-12-01",
      rating: 8.0,
      platforms: ["Nintendo Switch"],
      genres: ["Platformer"],
      screenshots: [],
      hidden: null
    };

    // Add the game to storage
    const addedGame = await storage.addGame(gameData);

    // Verify the status was preserved
    expect(addedGame.status).toBe("completed");
  });

  it('should preserve status when explicitly set to "downloading"', async () => {
    // Create a game with status explicitly set to "downloading"
    const gameData: InsertGame = {
      title: "Downloading Game",
      igdbId: 22222,
      status: "downloading",
      summary: "A game being downloaded",
      coverUrl: "https://example.com/downloading.jpg",
      releaseDate: "2024-03-01",
      rating: 7.5,
      platforms: ["PC"],
      genres: ["Shooter"],
      screenshots: [],
      hidden: null
    };

    // Add the game to storage
    const addedGame = await storage.addGame(gameData);

    // Verify the status was preserved
    expect(addedGame.status).toBe("downloading");
  });
});
