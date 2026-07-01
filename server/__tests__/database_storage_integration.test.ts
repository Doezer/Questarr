import { describe, it, expect, beforeEach, vi } from "vitest";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import { users, downloaders, indexers, type InsertGame } from "../../shared/schema";
import { randomUUID } from "crypto";
import type { DatabaseStorage } from "../storage";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

describe("DatabaseStorage Integration", () => {
  let db: BetterSQLite3Database<Record<string, unknown>>;
  let storage: DatabaseStorage;

  beforeEach(async () => {
    // Set env var for in-memory DB
    process.env.SQLITE_DB_PATH = ":memory:";

    // Reset modules to ensure clean import of db and storage
    vi.resetModules();

    // Import db and storage dynamically
    const dbModule = await import("../db.js");
    db = dbModule.db;

    const storageModule = await import("../storage.js");
    storage = storageModule.storage as DatabaseStorage;

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
      passwordHash: "hash",
    });

    // 2. Insert games with different statuses
    const game1: InsertGame = {
      title: "Wanted Game",
      status: "wanted",
      userId: userId,
      hidden: false,
    };

    const game2: InsertGame = {
      title: "Owned Game",
      status: "owned",
      userId: userId,
      hidden: false,
    };

    const game3: InsertGame = {
      title: "Completed Game",
      status: "completed",
      userId: userId,
      hidden: false,
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
    const statuses = activeGames
      .map((g: { status: string | null }) => g.status)
      .sort((a, b) => (a ?? "").localeCompare(b ?? ""));
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

  it("getDownloadSummaryByGame should aggregate downloads in the database layer", async () => {
    // Insert required parent records to satisfy FK constraints
    const userId = randomUUID();
    await db.insert(users).values({ id: userId, username: "dl_test_user", passwordHash: "hash" });

    const gameA = await storage.addGame({
      title: "Game A",
      status: "wanted",
      userId,
      hidden: false,
    });
    const gameB = await storage.addGame({
      title: "Game B",
      status: "wanted",
      userId,
      hidden: false,
    });

    const downloaderId = randomUUID();
    await db
      .insert(downloaders)
      .values({ id: downloaderId, name: "Test Client", type: "torrent", url: "http://localhost" });

    // Two downloads for game-a (different statuses and types)
    await storage.addGameDownload({
      gameId: gameA.id,
      downloaderId,
      downloadType: "torrent",
      downloadHash: randomUUID(),
      downloadTitle: "Game.A-GROUP",
      status: "downloading",
    });
    await storage.addGameDownload({
      gameId: gameA.id,
      downloaderId,
      downloadType: "usenet",
      downloadHash: randomUUID(),
      downloadTitle: "Game.A-GROUP",
      status: "completed",
    });
    // One download for game-b
    await storage.addGameDownload({
      gameId: gameB.id,
      downloaderId,
      downloadType: "torrent",
      downloadHash: randomUUID(),
      downloadTitle: "Game.B-GROUP",
      status: "failed",
    });

    const summary = await storage.getDownloadSummaryByGame(userId);

    expect(Object.keys(summary)).toHaveLength(2);

    // game-a: downloading has higher priority than completed
    expect(summary[gameA.id].count).toBe(2);
    expect(summary[gameA.id].topStatus).toBe("downloading");
    expect(summary[gameA.id].downloadTypes).toContain("torrent");
    expect(summary[gameA.id].downloadTypes).toContain("usenet");

    // game-b: single failed download
    expect(summary[gameB.id].count).toBe(1);
    expect(summary[gameB.id].topStatus).toBe("failed");
    expect(summary[gameB.id].downloadTypes).toContain("torrent");
  });

  it("getTrackedDownloadKeys returns downloaderId:downloadHash keys for all game downloads", async () => {
    const userId = randomUUID();
    await db.insert(users).values({ id: userId, username: "user_" + userId, passwordHash: "hash" });

    const game = await storage.addGame({
      title: "Tracked Game",
      status: "wanted",
      userId,
      hidden: false,
    } as InsertGame);

    const downloaderId = randomUUID();
    await db
      .insert(downloaders)
      .values({ id: downloaderId, name: "Client", type: "torrent", url: "http://localhost" });

    await storage.addGameDownload({
      gameId: game.id,
      downloaderId,
      downloadType: "torrent",
      downloadHash: "hash-x",
      downloadTitle: "Tracked Game-GROUP",
      status: "downloading",
    });

    const keys = await storage.getTrackedDownloadKeys();
    expect(keys.has(`${downloaderId}:hash-x`)).toBe(true);
    expect(keys.size).toBe(1);
  });

  describe("credential encryption at rest", () => {
    it("encrypts an indexer's apiKey in the DB but returns it decrypted", async () => {
      const added = await storage.addIndexer({
        name: "Test Indexer",
        url: "http://localhost:9000",
        apiKey: "fixture-value-alpha",
      });
      expect(added.apiKey).toBe("fixture-value-alpha");

      const [rawRow] = await db.select().from(indexers).where(eq(indexers.id, added.id));
      expect(rawRow.apiKey).not.toBe("fixture-value-alpha");
      expect(rawRow.apiKey).toMatch(/^enc:v1:/);

      const fetched = await storage.getIndexer(added.id);
      expect(fetched?.apiKey).toBe("fixture-value-alpha");

      const allFetched = await storage.getAllIndexers();
      expect(allFetched.find((i) => i.id === added.id)?.apiKey).toBe("fixture-value-alpha");
    });

    it("re-encrypts the apiKey on updateIndexer", async () => {
      const added = await storage.addIndexer({
        name: "Test Indexer",
        url: "http://localhost:9000",
        apiKey: "fixture-value-before",
      });

      const updated = await storage.updateIndexer(added.id, { apiKey: "fixture-value-after" });
      expect(updated?.apiKey).toBe("fixture-value-after");

      const [rawRow] = await db.select().from(indexers).where(eq(indexers.id, added.id));
      expect(rawRow.apiKey).toMatch(/^enc:v1:/);
      expect(rawRow.apiKey).not.toBe("fixture-value-after");
    });

    it("reads a legacy plaintext apiKey row unchanged (no migration required)", async () => {
      const id = randomUUID();
      await db.insert(indexers).values({
        id,
        name: "Legacy Indexer",
        url: "http://localhost:9001",
        apiKey: "fixture-legacy-value",
      });

      const fetched = await storage.getIndexer(id);
      expect(fetched?.apiKey).toBe("fixture-legacy-value");
    });

    it("encrypts a downloader's username/password in the DB but returns them decrypted", async () => {
      const added = await storage.addDownloader({
        name: "Test Client",
        type: "qbittorrent",
        url: "http://localhost:8080",
        username: "fixture-login-name",
        password: "fixture-secret-value",
      });
      expect(added.username).toBe("fixture-login-name");
      expect(added.password).toBe("fixture-secret-value");

      const [rawRow] = await db.select().from(downloaders).where(eq(downloaders.id, added.id));
      expect(rawRow.username).toMatch(/^enc:v1:/);
      expect(rawRow.password).toMatch(/^enc:v1:/);

      const fetched = await storage.getDownloader(added.id);
      expect(fetched?.username).toBe("fixture-login-name");
      expect(fetched?.password).toBe("fixture-secret-value");
    });

    it("reads a legacy plaintext downloader row unchanged (no migration required)", async () => {
      const id = randomUUID();
      await db.insert(downloaders).values({
        id,
        name: "Legacy Client",
        type: "qbittorrent",
        url: "http://localhost:8081",
        username: "fixture-legacy-login",
        password: "fixture-legacy-secret",
      });

      const fetched = await storage.getDownloader(id);
      expect(fetched?.username).toBe("fixture-legacy-login");
      expect(fetched?.password).toBe("fixture-legacy-secret");
    });

    it("encrypts apiKey during syncIndexers", async () => {
      const result = await storage.syncIndexers([
        { name: "Synced Indexer", url: "http://localhost:9002", apiKey: "fixture-synced-value" },
      ]);
      expect(result.added).toBe(1);

      const [rawRow] = await db
        .select()
        .from(indexers)
        .where(eq(indexers.url, "http://localhost:9002"));
      expect(rawRow.apiKey).toMatch(/^enc:v1:/);

      const fetched = await storage.getIndexer(rawRow.id);
      expect(fetched?.apiKey).toBe("fixture-synced-value");
    });

    it("decrypts apiKey via getEnabledIndexers", async () => {
      await storage.addIndexer({
        name: "Enabled Indexer",
        url: "http://localhost:9003",
        apiKey: "fixture-enabled-value",
        enabled: true,
      });

      const enabled = await storage.getEnabledIndexers();
      expect(enabled.find((i) => i.url === "http://localhost:9003")?.apiKey).toBe(
        "fixture-enabled-value"
      );
    });

    it("decrypts username/password via getEnabledDownloaders", async () => {
      await storage.addDownloader({
        name: "Enabled Client",
        type: "qbittorrent",
        url: "http://localhost:8082",
        username: "fixture-enabled-login",
        password: "fixture-enabled-secret",
        enabled: true,
      });

      const enabled = await storage.getEnabledDownloaders();
      const found = enabled.find((d) => d.url === "http://localhost:8082");
      expect(found?.username).toBe("fixture-enabled-login");
      expect(found?.password).toBe("fixture-enabled-secret");
    });

    it("re-encrypts username/password on updateDownloader", async () => {
      const added = await storage.addDownloader({
        name: "Test Client",
        type: "qbittorrent",
        url: "http://localhost:8083",
        username: "fixture-login-before",
        password: "fixture-secret-before",
      });

      const updated = await storage.updateDownloader(added.id, {
        username: "fixture-login-after",
        password: "fixture-secret-after",
      });
      expect(updated?.username).toBe("fixture-login-after");
      expect(updated?.password).toBe("fixture-secret-after");

      const [rawRow] = await db.select().from(downloaders).where(eq(downloaders.id, added.id));
      expect(rawRow.username).toMatch(/^enc:v1:/);
      expect(rawRow.password).toMatch(/^enc:v1:/);
    });
  });
});
