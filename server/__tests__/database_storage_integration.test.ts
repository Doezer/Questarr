import { describe, it, expect, beforeEach, vi } from "vitest";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { users, games, type InsertGame } from "../../shared/schema";
import { randomUUID } from "crypto";

describe("DatabaseStorage Integration", () => {
  let db: any;
  let storage: any;

  beforeEach(async () => {
    // Set env var for in-memory DB
    process.env.SQLITE_DB_PATH = ":memory:";

    // Reset modules to ensure clean import of db and storage
    vi.resetModules();

    // Import db and storage dynamically
    const dbModule = await import("../db.js");
    db = dbModule.db;

    const storageModule = await import("../storage.js");
    storage = storageModule.storage;

    // Run migrations to setup schema
    // migrations folder is relative to project root, which is where vitest runs
    try {
      await migrate(db, { migrationsFolder: "migrations" });
    } catch (e) {
      console.error("Migration failed", e);
      throw e;
    }
  });

  it("getUserGames should filter by status correctly", async () => {
    // 1. Create a user
    const userId = randomUUID();
    await db.insert(users).values({
      id: userId,
      username: "testuser_" + userId,
      passwordHash: "hash"
    });

    // 2. Insert games with different statuses
    const game1: InsertGame = {
      title: "Wanted Game",
      status: "wanted",
      userId: userId,
      hidden: false
    };

    const game2: InsertGame = {
      title: "Owned Game",
      status: "owned",
      userId: userId,
      hidden: false
    };

    const game3: InsertGame = {
      title: "Completed Game",
      status: "completed",
      userId: userId,
      hidden: false
    };

    // Use storage.addGame to ensure consistency, but direct insert is fine too if we are testing read
    // But let's use storage.addGame if possible to simulate real usage
    // However, storage.addGame might not allow setting ID easily if it generates random one.
    // Let's use db.insert for control.

    // Note: Schema requires ID. storage.addGame generates it.
    // Let's rely on storage.addGame for simplicity if it works with the mocked/real db.
    await storage.addGame(game1);
    await storage.addGame(game2);
    await storage.addGame(game3);

    // 3. Test filtering: specific status
    const wantedGames = await storage.getUserGames(userId, false, ["wanted"]);
    expect(wantedGames).toHaveLength(1);
    expect(wantedGames[0].status).toBe("wanted");
    expect(wantedGames[0].title).toBe("Wanted Game");

    // 4. Test filtering: multiple statuses
    const activeGames = await storage.getUserGames(userId, false, ["owned", "completed"]);
    expect(activeGames).toHaveLength(2);
    const statuses = activeGames.map((g: any) => g.status).sort();
    expect(statuses).toEqual(["completed", "owned"]);

    // 5. Test filtering: no status filter (should return all)
    const allGames = await storage.getUserGames(userId, false);
    expect(allGames).toHaveLength(3);

    // 6. Test filtering: empty status array (should return empty list or all? logic says inArray([], ...) is false)
    // "statuses && statuses.length > 0" -> if empty, passes undefined -> returns all?
    // Let's check logic:
    // statuses && statuses.length > 0 ? inArray(...) : undefined
    // So if empty array, it returns all.
    const emptyFilterGames = await storage.getUserGames(userId, false, []);
    expect(emptyFilterGames).toHaveLength(3);
  });
});
