import { describe, it, expect, beforeEach, vi } from "vitest";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import {
  users,
  type InsertGame,
  type InsertDownloader,
  type InsertGameDownload,
} from "../../shared/schema";
import { randomUUID } from "crypto";
import type { DatabaseStorage } from "../storage";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

describe("DatabaseStorage Extended Coverage", () => {
  let db: BetterSQLite3Database<Record<string, unknown>>;
  let storage: DatabaseStorage;

  beforeEach(async () => {
    process.env.SQLITE_DB_PATH = ":memory:";
    vi.resetModules();

    const dbModule = await import("../db.js");
    db = dbModule.db;

    const storageModule = await import("../storage.js");
    storage = storageModule.storage as DatabaseStorage;

    await migrate(db, { migrationsFolder: "migrations" });
  });

  async function createUser() {
    const userId = randomUUID();
    await db.insert(users).values({
      id: userId,
      username: "testuser_" + userId,
      passwordHash: "hash",
    });
    return userId;
  }

  describe("Path mappings", () => {
    it("supports full CRUD", async () => {
      const created = await storage.addPathMapping({
        remotePath: "/downloads",
        localPath: "/mnt/downloads",
        remoteHost: null,
      });
      expect(created.id).toBeDefined();

      const fetched = await storage.getPathMapping(created.id);
      expect(fetched?.remotePath).toBe("/downloads");

      const all = await storage.getPathMappings();
      expect(all).toHaveLength(1);

      const updated = await storage.updatePathMapping(created.id, { localPath: "/mnt/new" });
      expect(updated?.localPath).toBe("/mnt/new");

      const removed = await storage.removePathMapping(created.id);
      expect(removed).toBe(true);
      expect(await storage.getPathMappings()).toHaveLength(0);
    });

    it("returns undefined for a missing mapping id", async () => {
      expect(await storage.getPathMapping(randomUUID())).toBeUndefined();
      expect(await storage.removePathMapping(randomUUID())).toBe(false);
    });
  });

  describe("Platform mappings", () => {
    it("supports full CRUD and lookup by igdb platform id", async () => {
      const created = await storage.addPlatformMapping({
        igdbPlatformId: 6,
        sourcePlatformName: "PC",
      });
      expect(created.id).toBeDefined();

      const byPlatformId = await storage.getPlatformMapping(6);
      expect(byPlatformId?.sourcePlatformName).toBe("PC");

      const updated = await storage.updatePlatformMapping(created.id, {
        sourcePlatformName: "Windows PC",
      });
      expect(updated?.sourcePlatformName).toBe("Windows PC");

      const removed = await storage.removePlatformMapping(created.id);
      expect(removed).toBe(true);
    });

    it("seeds default mappings only when the table is empty", async () => {
      const first = await storage.seedPlatformMappingsIfEmpty([
        { igdbPlatformId: 6, sourcePlatformName: "PC" },
        { igdbPlatformId: 48, sourcePlatformName: "PS4" },
      ]);
      expect(first).toEqual({ seeded: true, count: 2 });

      const second = await storage.seedPlatformMappingsIfEmpty([
        { igdbPlatformId: 130, sourcePlatformName: "Switch" },
      ]);
      expect(second).toEqual({ seeded: false, count: 2 });
    });
  });

  describe("Users", () => {
    it("creates, fetches, and lists users", async () => {
      const created = await storage.createUser({ username: "alice", passwordHash: "hash" });
      expect(created.id).toBeDefined();

      const byId = await storage.getUser(created.id);
      expect(byId?.username).toBe("alice");

      const byUsername = await storage.getUserByUsername("alice");
      expect(byUsername?.id).toBe(created.id);

      const all = await storage.getAllUsers();
      expect(all.some((u) => u.id === created.id)).toBe(true);

      const count = await storage.countUsers();
      expect(count).toBe(1);
    });

    it("updates a user's password and steam id", async () => {
      const created = await storage.createUser({ username: "bob", passwordHash: "old" });

      const withPassword = await storage.updateUserPassword(created.id, "new-hash");
      expect(withPassword?.passwordHash).toBe("new-hash");

      const withSteam = await storage.updateUserSteamId(created.id, "76561198000000000");
      expect(withSteam?.steamId64).toBe("76561198000000000");
    });

    it("registerSetupUser creates the first user and rejects subsequent calls", async () => {
      const first = await storage.registerSetupUser({ username: "admin", passwordHash: "hash" });
      expect(first.username).toBe("admin");

      await expect(
        storage.registerSetupUser({ username: "second", passwordHash: "hash" })
      ).rejects.toThrow("Setup already completed");
    });
  });

  describe("Games", () => {
    it("adds, fetches, and updates a game's status, hidden, rating, and notes", async () => {
      const userId = await createUser();
      const gameData: InsertGame = {
        title: "Test Game",
        status: "wanted",
        userId,
        hidden: false,
        igdbId: 123,
      };
      const game = await storage.addGame(gameData);
      expect(game.id).toBeDefined();

      expect((await storage.getGame(game.id))?.title).toBe("Test Game");
      expect((await storage.getGameByIgdbId(123))?.id).toBe(game.id);

      const statusUpdated = await storage.updateGameStatus(game.id, { status: "completed" });
      expect(statusUpdated?.status).toBe("completed");
      expect(statusUpdated?.completedAt).toBeTruthy();

      const hiddenUpdated = await storage.updateGameHidden(game.id, true);
      expect(hiddenUpdated?.hidden).toBe(true);

      const ratingUpdated = await storage.updateGameUserRating(game.id, userId, 8.5);
      expect(ratingUpdated?.userRating).toBe(8.5);

      const notesUpdated = await storage.updateGameNotes(game.id, userId, "Great game");
      expect(notesUpdated?.notes).toBe("Great game");

      await storage.updateGameSearchResultsAvailable(game.id, true);
      const refetched = await storage.getGame(game.id);
      expect(refetched?.searchResultsAvailable).toBe(true);

      const genericUpdate = await storage.updateGame(game.id, { title: "Renamed Game" });
      expect(genericUpdate?.title).toBe("Renamed Game");

      const removed = await storage.removeGame(game.id);
      expect(removed).toBe(true);
      expect(await storage.getGame(game.id)).toBeUndefined();
    });

    it("filters getUserGames by status list and hidden state", async () => {
      const userId = await createUser();
      await storage.addGame({ title: "Wanted", status: "wanted", userId, hidden: false });
      await storage.addGame({ title: "Owned", status: "owned", userId, hidden: false });
      await storage.addGame({ title: "Hidden Owned", status: "owned", userId, hidden: true });

      const wantedOnly = await storage.getUserGames(userId, false, ["wanted"]);
      expect(wantedOnly.map((g) => g.title)).toEqual(["Wanted"]);

      const withHidden = await storage.getUserGames(userId, true);
      expect(withHidden).toHaveLength(3);

      const byStatus = await storage.getUserGamesByStatus(userId, "owned", true);
      expect(byStatus.map((g) => g.title).sort()).toEqual(["Hidden Owned", "Owned"]);
    });

    it("searchUserGames matches by title case-insensitively", async () => {
      const userId = await createUser();
      await storage.addGame({ title: "The Witcher 3", status: "wanted", userId, hidden: false });
      await storage.addGame({ title: "Portal 2", status: "wanted", userId, hidden: false });

      const results = await storage.searchUserGames(userId, "witcher");
      expect(results.map((g) => g.title)).toEqual(["The Witcher 3"]);
    });

    it("getAllGames returns games across users", async () => {
      const userA = await createUser();
      const userB = await createUser();
      await storage.addGame({ title: "Game A", status: "wanted", userId: userA, hidden: false });
      await storage.addGame({ title: "Game B", status: "wanted", userId: userB, hidden: false });

      const all = await storage.getAllGames();
      expect(all.length).toBeGreaterThanOrEqual(2);
    });

    it("updateGamesBatch applies multiple updates transactionally", async () => {
      const userId = await createUser();
      const g1 = await storage.addGame({ title: "G1", status: "wanted", userId, hidden: false });
      const g2 = await storage.addGame({ title: "G2", status: "wanted", userId, hidden: false });

      await storage.updateGamesBatch([
        { id: g1.id, data: { title: "G1 Updated" } },
        { id: g2.id, data: { title: "G2 Updated" } },
      ]);

      expect((await storage.getGame(g1.id))?.title).toBe("G1 Updated");
      expect((await storage.getGame(g2.id))?.title).toBe("G2 Updated");
    });

    it("assignOrphanGamesToUser assigns games with a null userId", async () => {
      const userId = await createUser();
      await storage.addGame({ title: "Orphan", status: "wanted", userId: null, hidden: false });

      const assignedCount = await storage.assignOrphanGamesToUser(userId);
      expect(assignedCount).toBe(1);

      const userGames = await storage.getUserGames(userId, true);
      expect(userGames.map((g) => g.title)).toContain("Orphan");
    });

    it("getWantedGamesGroupedByUser groups wanted, non-hidden games by user", async () => {
      const userA = await createUser();
      const userB = await createUser();
      await storage.addGame({ title: "Wanted A", status: "wanted", userId: userA, hidden: false });
      await storage.addGame({ title: "Wanted B", status: "wanted", userId: userB, hidden: false });
      await storage.addGame({
        title: "Hidden Wanted",
        status: "wanted",
        userId: userA,
        hidden: true,
      });
      await storage.addGame({ title: "Owned A", status: "owned", userId: userA, hidden: false });

      const grouped = await storage.getWantedGamesGroupedByUser();
      expect(grouped.get(userA)?.map((g) => g.title)).toEqual(["Wanted A"]);
      expect(grouped.get(userB)?.map((g) => g.title)).toEqual(["Wanted B"]);
    });
  });

  describe("GameDownload: unlinked reviews and relinking", () => {
    async function setup() {
      const userId = await createUser();
      const game = await storage.addGame({
        title: "Original Game",
        igdbId: 6000,
        status: "wanted",
        hidden: false,
        userId,
      } as InsertGame);
      const downloader = await storage.addDownloader({
        name: "qBit",
        type: "qbittorrent",
        url: "http://localhost:8080",
        apiKey: "",
        enabled: true,
        priority: 1,
      } as InsertDownloader);
      return { userId, game, downloader };
    }

    it("getUnlinkedImportReviews returns only game_link_required downloads", async () => {
      const { game, downloader } = await setup();

      const unlinked = await storage.addGameDownload({
        gameId: game.id,
        downloaderId: downloader.id,
        downloadHash: "hash-unlinked",
        downloadTitle: "Orphaned-GROUP",
        status: "game_link_required",
        downloadType: "torrent",
        fileSize: null,
      } as InsertGameDownload);
      await storage.addGameDownload({
        gameId: game.id,
        downloaderId: downloader.id,
        downloadHash: "hash-reviewing",
        downloadTitle: "Reviewing-GROUP",
        status: "manual_review_required",
        downloadType: "torrent",
        fileSize: null,
      } as InsertGameDownload);

      const results = await storage.getUnlinkedImportReviews();
      expect(results.map((d) => d.id)).toEqual([unlinked?.id]);
    });

    it("relinkGameDownload reattaches the game and returns to manual_review_required", async () => {
      const { userId, game, downloader } = await setup();
      const correctGame = await storage.addGame({
        title: "Correct Game",
        igdbId: 6001,
        status: "wanted",
        hidden: false,
        userId,
      } as InsertGame);

      const download = await storage.addGameDownload({
        gameId: game.id,
        downloaderId: downloader.id,
        downloadHash: "hash-relink",
        downloadTitle: "NeedsLink-GROUP",
        status: "game_link_required",
        downloadType: "torrent",
        fileSize: null,
      } as InsertGameDownload);

      const updated = await storage.relinkGameDownload(download!.id, correctGame.id);
      expect(updated?.gameId).toBe(correctGame.id);
      expect(updated?.status).toBe("manual_review_required");
      expect(await storage.getUnlinkedImportReviews()).toHaveLength(0);
    });

    it("relinkGameDownload is a no-op once already relinked (race-safe)", async () => {
      const { userId, game, downloader } = await setup();
      const firstGame = await storage.addGame({
        title: "First Winner",
        igdbId: 6002,
        status: "wanted",
        hidden: false,
        userId,
      } as InsertGame);
      const secondGame = await storage.addGame({
        title: "Second Attempt",
        igdbId: 6003,
        status: "wanted",
        hidden: false,
        userId,
      } as InsertGame);

      const download = await storage.addGameDownload({
        gameId: game.id,
        downloaderId: downloader.id,
        downloadHash: "hash-race",
        downloadTitle: "Race-GROUP",
        status: "game_link_required",
        downloadType: "torrent",
        fileSize: null,
      } as InsertGameDownload);

      await storage.relinkGameDownload(download!.id, firstGame.id);
      const second = await storage.relinkGameDownload(download!.id, secondGame.id);

      expect(second).toBeUndefined();
      const current = await storage.getGameDownload(download!.id);
      expect(current?.gameId).toBe(firstGame.id);
    });

    it("completeUnlinkedGameDownload dismisses a game_link_required download as completed", async () => {
      const { game, downloader } = await setup();

      const download = await storage.addGameDownload({
        gameId: game.id,
        downloaderId: downloader.id,
        downloadHash: "hash-skip",
        downloadTitle: "Skip-GROUP",
        status: "game_link_required",
        downloadType: "torrent",
        fileSize: null,
      } as InsertGameDownload);

      const updated = await storage.completeUnlinkedGameDownload(download!.id);
      expect(updated?.status).toBe("completed");
      expect(updated?.completedAt).not.toBeNull();
      expect(await storage.getUnlinkedImportReviews()).toHaveLength(0);
    });

    it("completeUnlinkedGameDownload is a no-op once already relinked (race-safe)", async () => {
      const { userId, game, downloader } = await setup();
      const correctGame = await storage.addGame({
        title: "Relinked First",
        igdbId: 6004,
        status: "wanted",
        hidden: false,
        userId,
      } as InsertGame);

      const download = await storage.addGameDownload({
        gameId: game.id,
        downloaderId: downloader.id,
        downloadHash: "hash-skip-race",
        downloadTitle: "SkipRace-GROUP",
        status: "game_link_required",
        downloadType: "torrent",
        fileSize: null,
      } as InsertGameDownload);

      // Simulates a concurrent POST /:id/link winning the race first.
      await storage.relinkGameDownload(download!.id, correctGame.id);

      const result = await storage.completeUnlinkedGameDownload(download!.id);
      expect(result).toBeUndefined();

      // The relink must survive untouched — not clobbered back to "completed".
      const current = await storage.getGameDownload(download!.id);
      expect(current?.status).toBe("manual_review_required");
      expect(current?.gameId).toBe(correctGame.id);
    });
  });

  describe("Import task history", () => {
    it("creates a task, starts it, updates it, and adds items", async () => {
      const userId = await createUser();
      const task = await storage.createImportTask({
        userId,
        taskType: "manual_scan",
        triggeredBy: "manual",
      });
      expect(task.status).toBe("pending");

      await storage.startImportTask(task.id);
      const started = await storage.getImportTask(task.id);
      expect(started?.status).toBe("in_progress");
      expect(started?.startedAt).toBeTruthy();

      await storage.updateImportTask(task.id, { status: "completed" });
      const completed = await storage.getImportTask(task.id);
      expect(completed?.status).toBe("completed");

      const item = await storage.addImportTaskItem({
        taskId: task.id,
        itemName: "Game One",
        result: "imported",
        gameId: null,
        gameTitle: "Game One",
        errorMessage: null,
      });
      expect(item.id).toBeDefined();

      const items = await storage.getImportTaskItems(task.id);
      expect(items.map((i) => i.itemName)).toEqual(["Game One"]);
    });

    it("addImportTaskItemsBatch inserts multiple items and returns [] for an empty batch", async () => {
      const userId = await createUser();
      const task = await storage.createImportTask({
        userId,
        taskType: "manual_scan",
        triggeredBy: "system",
      });

      const empty = await storage.addImportTaskItemsBatch([]);
      expect(empty).toEqual([]);

      const inserted = await storage.addImportTaskItemsBatch([
        {
          taskId: task.id,
          itemName: "Item A",
          result: "imported",
          gameId: null,
          gameTitle: null,
          errorMessage: null,
        },
        {
          taskId: task.id,
          itemName: "Item B",
          result: "failed",
          gameId: null,
          gameTitle: null,
          errorMessage: "boom",
        },
      ]);
      expect(inserted).toHaveLength(2);

      const items = await storage.getImportTaskItems(task.id);
      expect(items.map((i) => i.itemName).sort()).toEqual(["Item A", "Item B"]);
    });

    it("getImportTasks lists tasks scoped to a user with limit/offset", async () => {
      const userId = await createUser();
      await storage.createImportTask({ userId, taskType: "manual_scan", triggeredBy: "manual" });
      await storage.createImportTask({ userId, taskType: "manual_scan", triggeredBy: "manual" });

      const tasks = await storage.getImportTasks(userId, 1, 0);
      expect(tasks).toHaveLength(1);
    });

    it("getImportTask returns undefined for a missing id", async () => {
      expect(await storage.getImportTask(randomUUID())).toBeUndefined();
    });

    it("deleteImportTasksOlderThan removes only completed tasks past the cutoff", async () => {
      const userId = await createUser();
      const oldTask = await storage.createImportTask({
        userId,
        taskType: "manual_scan",
        triggeredBy: "manual",
      });
      await storage.updateImportTask(oldTask.id, { status: "completed" });

      const inProgressTask = await storage.createImportTask({
        userId,
        taskType: "manual_scan",
        triggeredBy: "manual",
      });
      await storage.startImportTask(inProgressTask.id);

      const deletedCount = await storage.deleteImportTasksOlderThan(Date.now() + 1000 * 60 * 60);
      expect(deletedCount).toBe(1);

      expect(await storage.getImportTask(oldTask.id)).toBeUndefined();
      expect(await storage.getImportTask(inProgressTask.id)).toBeDefined();
    });
  });
});
