import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../db.js", () => ({ pool: {}, db: {} }));
vi.mock("better-sqlite3", () => ({
  default: vi.fn().mockImplementation(() => ({ pragma: vi.fn() })),
}));
vi.mock("../db", () => ({
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
  },
}));

const { MemStorage } = await import("../storage.js");

import type { MemStorage as MemStorageType } from "../storage.js";
import type {
  InsertGame,
  InsertUser,
  InsertIndexer,
  InsertDownloader,
  InsertGameDownload,
  InsertRssFeed,
} from "../../shared/schema.js";

function makeUser(overrides: Partial<InsertUser> = {}): InsertUser {
  return { username: "user1", passwordHash: "hash1", ...overrides };
}

function makeGame(overrides: Partial<InsertGame> = {}): InsertGame {
  return {
    title: "Test Game",
    userId: "u1",
    status: "wanted",
    igdbId: null,
    ...overrides,
  };
}

function makeIndexer(overrides: Partial<InsertIndexer> = {}): InsertIndexer {
  return {
    name: "Indexer",
    url: "http://indexer.test",
    apiKey: "key123",
    ...overrides,
  };
}

function makeDownloader(overrides: Partial<InsertDownloader> = {}): InsertDownloader {
  return {
    name: "qBit",
    type: "qbittorrent",
    url: "http://qbit.test",
    ...overrides,
  };
}

describe("MemStorage - User methods", () => {
  let storage: MemStorageType;

  beforeEach(() => {
    storage = new MemStorage();
  });

  it("updateUserPassword returns updated user", async () => {
    const user = await storage.registerSetupUser(makeUser());
    const updated = await storage.updateUserPassword(user.id, "newHash");
    expect(updated?.passwordHash).toBe("newHash");
  });

  it("updateUserPassword returns undefined for missing user", async () => {
    const result = await storage.updateUserPassword("nonexistent", "hash");
    expect(result).toBeUndefined();
  });

  it("updateUserSteamId returns updated user", async () => {
    const user = await storage.registerSetupUser(makeUser());
    const updated = await storage.updateUserSteamId(user.id, "76561198123456789");
    expect(updated?.steamId64).toBe("76561198123456789");
  });

  it("updateUserSteamId returns undefined for missing user", async () => {
    const result = await storage.updateUserSteamId("nonexistent", "steamId");
    expect(result).toBeUndefined();
  });

  it("getAllUsers returns all users", async () => {
    await storage.registerSetupUser(makeUser({ username: "alpha" }));
    const users = await storage.getAllUsers();
    expect(users).toHaveLength(1);
    expect(users[0].username).toBe("alpha");
  });

  it("countUsers returns correct count", async () => {
    expect(await storage.countUsers()).toBe(0);
    await storage.registerSetupUser(makeUser());
    expect(await storage.countUsers()).toBe(1);
  });

  it("registerSetupUser throws when called after setup is complete", async () => {
    await storage.registerSetupUser(makeUser({ username: "first" }));
    await expect(storage.registerSetupUser(makeUser({ username: "second" }))).rejects.toThrow(
      "Setup already completed"
    );
  });

  it("createUser does not throw when users already exist", async () => {
    await storage.registerSetupUser(makeUser({ username: "first" }));
    const user = await storage.createUser(makeUser({ username: "second" }));
    expect(user.username).toBe("second");
    expect(await storage.countUsers()).toBe(2);
  });
});

describe("MemStorage - Game query methods", () => {
  let storage: MemStorageType;

  beforeEach(async () => {
    storage = new MemStorage();
    await storage.registerSetupUser(makeUser());
  });

  it("getGameByIgdbId returns game matching igdbId", async () => {
    await storage.addGame(makeGame({ igdbId: 42, userId: "u1" }));
    const found = await storage.getGameByIgdbId(42);
    expect(found?.igdbId).toBe(42);
  });

  it("getGameByIgdbId returns undefined for missing igdbId", async () => {
    const result = await storage.getGameByIgdbId(99);
    expect(result).toBeUndefined();
  });

  it("getUserGames filters by userId", async () => {
    await storage.addGame(makeGame({ userId: "u1", title: "A" }));
    await storage.addGame(makeGame({ userId: "u2", title: "B" }));
    const games = await storage.getUserGames("u1");
    expect(games).toHaveLength(1);
    expect(games[0].title).toBe("A");
  });

  it("getUserGames excludes hidden games by default", async () => {
    await storage.addGame(makeGame({ userId: "u1", hidden: true }));
    await storage.addGame(makeGame({ userId: "u1", hidden: false, title: "Visible" }));
    const games = await storage.getUserGames("u1");
    expect(games).toHaveLength(1);
    expect(games[0].title).toBe("Visible");
  });

  it("getUserGames includes hidden games when flag is set", async () => {
    await storage.addGame(makeGame({ userId: "u1", hidden: true, title: "Hidden" }));
    const games = await storage.getUserGames("u1", true);
    expect(games).toHaveLength(1);
  });

  it("getUserGames filters by statuses", async () => {
    await storage.addGame(makeGame({ userId: "u1", status: "wanted", title: "W" }));
    await storage.addGame(makeGame({ userId: "u1", status: "owned", title: "O" }));
    const games = await storage.getUserGames("u1", false, ["wanted"]);
    expect(games).toHaveLength(1);
    expect(games[0].title).toBe("W");
  });

  it("getAllGames returns all games", async () => {
    await storage.addGame(makeGame({ userId: "u1", title: "X" }));
    await storage.addGame(makeGame({ userId: "u2", title: "Y" }));
    const games = await storage.getAllGames();
    expect(games).toHaveLength(2);
  });

  it("getUserGamesByStatus returns games matching status", async () => {
    await storage.addGame(makeGame({ userId: "u1", status: "owned", title: "Owned" }));
    await storage.addGame(makeGame({ userId: "u1", status: "wanted", title: "Wanted" }));
    const games = await storage.getUserGamesByStatus("u1", "owned");
    expect(games).toHaveLength(1);
    expect(games[0].title).toBe("Owned");
  });

  it("searchUserGames finds games by title substring", async () => {
    await storage.addGame(makeGame({ userId: "u1", title: "Dark Souls" }));
    await storage.addGame(makeGame({ userId: "u1", title: "Elden Ring" }));
    const results = await storage.searchUserGames("u1", "dark");
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Dark Souls");
  });

  it("searchUserGames is case-insensitive", async () => {
    await storage.addGame(makeGame({ userId: "u1", title: "Dark Souls" }));
    const results = await storage.searchUserGames("u1", "DARK");
    expect(results).toHaveLength(1);
  });

  it("searchUserGames excludes hidden by default", async () => {
    await storage.addGame(makeGame({ userId: "u1", title: "Hidden Game", hidden: true }));
    const results = await storage.searchUserGames("u1", "hidden");
    expect(results).toHaveLength(0);
  });
});

describe("MemStorage - Game update methods", () => {
  let storage: MemStorageType;
  let gameId: string;

  beforeEach(async () => {
    storage = new MemStorage();
    await storage.registerSetupUser(makeUser());
    const game = await storage.addGame(makeGame({ userId: "u1", title: "My Game" }));
    gameId = game.id;
  });

  it("updateGameStatus returns undefined for missing game", async () => {
    const result = await storage.updateGameStatus("nonexistent", { status: "owned" });
    expect(result).toBeUndefined();
  });

  it("updateGameStatus sets completedAt when status is completed", async () => {
    const updated = await storage.updateGameStatus(gameId, { status: "completed" });
    expect(updated?.completedAt).not.toBeNull();
  });

  it("updateGameStatus clears completedAt when status is not completed", async () => {
    await storage.updateGameStatus(gameId, { status: "completed" });
    const updated = await storage.updateGameStatus(gameId, { status: "owned" });
    expect(updated?.completedAt).toBeNull();
  });

  it("updateGameHidden returns undefined for missing game", async () => {
    const result = await storage.updateGameHidden("nonexistent", true);
    expect(result).toBeUndefined();
  });

  it("updateGameHidden sets hidden flag", async () => {
    const updated = await storage.updateGameHidden(gameId, true);
    expect(updated?.hidden).toBe(true);
  });

  it("updateGameUserRating returns undefined for missing game", async () => {
    const result = await storage.updateGameUserRating("nonexistent", "u1", 8);
    expect(result).toBeUndefined();
  });

  it("updateGameUserRating returns undefined when userId does not match", async () => {
    const result = await storage.updateGameUserRating(gameId, "other-user", 8);
    expect(result).toBeUndefined();
  });

  it("updateGameUserRating sets userRating", async () => {
    const updated = await storage.updateGameUserRating(gameId, "u1", 9.5);
    expect(updated?.userRating).toBe(9.5);
  });

  it("updateGameNotes returns undefined for missing game", async () => {
    const result = await storage.updateGameNotes("nonexistent", "u1", "notes");
    expect(result).toBeUndefined();
  });

  it("updateGameNotes sets notes", async () => {
    const updated = await storage.updateGameNotes(gameId, "u1", "Great game!");
    expect(updated?.notes).toBe("Great game!");
  });

  it("updateGameSearchResultsAvailable sets the flag", async () => {
    await storage.updateGameSearchResultsAvailable(gameId, true);
    const game = await storage.getGame(gameId);
    expect(game?.searchResultsAvailable).toBe(true);
  });

  it("updateGame applies partial updates", async () => {
    const updated = await storage.updateGame(gameId, { title: "Updated Title" });
    expect(updated?.title).toBe("Updated Title");
  });

  it("updateGame returns undefined for missing game", async () => {
    const result = await storage.updateGame("nonexistent", { title: "X" });
    expect(result).toBeUndefined();
  });

  it("updateGamesBatch updates multiple games", async () => {
    const g2 = await storage.addGame(makeGame({ userId: "u1", title: "Game 2" }));
    await storage.updateGamesBatch([
      { id: gameId, data: { title: "Batch Updated" } },
      { id: g2.id, data: { title: "Game 2 Updated" } },
    ]);
    expect((await storage.getGame(gameId))?.title).toBe("Batch Updated");
    expect((await storage.getGame(g2.id))?.title).toBe("Game 2 Updated");
  });

  it("removeGame returns true and game is gone", async () => {
    expect(await storage.removeGame(gameId)).toBe(true);
    expect(await storage.getGame(gameId)).toBeUndefined();
  });

  it("removeGame returns false for missing game", async () => {
    expect(await storage.removeGame("nonexistent")).toBe(false);
  });

  it("assignOrphanGamesToUser assigns games with no userId", async () => {
    await storage.addGame({ title: "Orphan", status: "wanted" });
    const count = await storage.assignOrphanGamesToUser("u1");
    expect(count).toBe(1);
  });

  it("getWantedGamesGroupedByUser groups wanted non-hidden games", async () => {
    const isolated = new MemStorage();
    await isolated.registerSetupUser(makeUser());
    await isolated.addGame(makeGame({ userId: "u1", status: "wanted", title: "W1" }));
    await isolated.addGame(makeGame({ userId: "u1", status: "owned", title: "O1" }));
    await isolated.addGame(makeGame({ userId: "u1", status: "wanted", hidden: true, title: "H" }));
    const grouped = await isolated.getWantedGamesGroupedByUser();
    expect(grouped.get("u1")).toHaveLength(1);
    expect(grouped.get("u1")?.[0].title).toBe("W1");
  });
});

describe("MemStorage - Indexer methods", () => {
  let storage: MemStorageType;

  beforeEach(() => {
    storage = new MemStorage();
  });

  it("updateIndexer returns updated indexer", async () => {
    const indexer = await storage.addIndexer(makeIndexer());
    const updated = await storage.updateIndexer(indexer.id, { name: "New Name" });
    expect(updated?.name).toBe("New Name");
  });

  it("updateIndexer returns undefined for missing indexer", async () => {
    const result = await storage.updateIndexer("nonexistent", { name: "X" });
    expect(result).toBeUndefined();
  });

  it("removeIndexer returns true and indexer is gone", async () => {
    const indexer = await storage.addIndexer(makeIndexer());
    expect(await storage.removeIndexer(indexer.id)).toBe(true);
    expect(await storage.getIndexer(indexer.id)).toBeUndefined();
  });

  it("getEnabledIndexers returns only enabled indexers", async () => {
    await storage.addIndexer(makeIndexer({ name: "Enabled", enabled: true }));
    await storage.addIndexer(makeIndexer({ name: "Disabled", enabled: false }));
    const enabled = await storage.getEnabledIndexers();
    expect(enabled).toHaveLength(1);
    expect(enabled[0].name).toBe("Enabled");
  });

  it("syncIndexers adds new indexers", async () => {
    const result = await storage.syncIndexers([
      { name: "Idx1", url: "http://idx1.test", apiKey: "k1" },
    ]);
    expect(result.added).toBe(1);
    expect(result.updated).toBe(0);
  });

  it("syncIndexers updates existing indexers by URL", async () => {
    await storage.addIndexer(makeIndexer({ url: "http://idx.test" }));
    const result = await storage.syncIndexers([
      { name: "Updated Name", url: "http://idx.test", apiKey: "newkey" },
    ]);
    expect(result.updated).toBe(1);
    expect(result.added).toBe(0);
  });

  it("syncIndexers counts failed for missing required fields", async () => {
    const result = await storage.syncIndexers([{ name: "Bad", url: "http://x" }] as never[]); // NOSONAR
    expect(result.failed).toBe(1);
    expect(result.errors).toHaveLength(1);
  });
});

describe("MemStorage - Downloader methods", () => {
  let storage: MemStorageType;

  beforeEach(() => {
    storage = new MemStorage();
  });

  it("updateDownloader returns updated downloader", async () => {
    const dl = await storage.addDownloader(makeDownloader());
    const updated = await storage.updateDownloader(dl.id, { name: "Updated" });
    expect(updated?.name).toBe("Updated");
  });

  it("updateDownloader returns undefined for missing downloader", async () => {
    const result = await storage.updateDownloader("nonexistent", { name: "X" });
    expect(result).toBeUndefined();
  });

  it("removeDownloader returns true and downloader is gone", async () => {
    const dl = await storage.addDownloader(makeDownloader());
    expect(await storage.removeDownloader(dl.id)).toBe(true);
    expect(await storage.getDownloader(dl.id)).toBeUndefined();
  });

  it("getEnabledDownloaders returns only enabled", async () => {
    await storage.addDownloader(makeDownloader({ name: "Enabled", enabled: true }));
    await storage.addDownloader(makeDownloader({ name: "Disabled", enabled: false }));
    const enabled = await storage.getEnabledDownloaders();
    expect(enabled).toHaveLength(1);
    expect(enabled[0].name).toBe("Enabled");
  });
});

describe("MemStorage - Notification methods", () => {
  let storage: MemStorageType;

  beforeEach(() => {
    storage = new MemStorage();
  });

  it("addNotificationsBatch adds multiple notifications", async () => {
    const results = await storage.addNotificationsBatch([
      { userId: "u1", type: "info", title: "N1", message: "msg1" },
      { userId: "u1", type: "warning", title: "N2", message: "msg2" },
    ]);
    expect(results).toHaveLength(2);
    expect(await storage.getUnreadNotificationsCount("u1")).toBe(2);
  });

  it("markNotificationAsRead marks only matching notification", async () => {
    const n = await storage.addNotification({
      userId: "u1",
      type: "info",
      title: "T",
      message: "M",
    });
    const updated = await storage.markNotificationAsRead(n.id, "u1");
    expect(updated?.read).toBe(true);
  });

  it("markNotificationAsRead returns undefined for wrong userId", async () => {
    const n = await storage.addNotification({
      userId: "u1",
      type: "info",
      title: "T",
      message: "M",
    });
    const result = await storage.markNotificationAsRead(n.id, "other");
    expect(result).toBeUndefined();
  });

  it("markAllNotificationsAsRead marks all user notifications", async () => {
    await storage.addNotification({ userId: "u1", type: "info", title: "A", message: "M" });
    await storage.addNotification({ userId: "u1", type: "info", title: "B", message: "M" });
    await storage.markAllNotificationsAsRead("u1");
    expect(await storage.getUnreadNotificationsCount("u1")).toBe(0);
  });

  it("deleteReadNotifications removes only read notifications", async () => {
    const n1 = await storage.addNotification({
      userId: "u1",
      type: "info",
      title: "A",
      message: "M",
    });
    await storage.addNotification({ userId: "u1", type: "info", title: "B", message: "M" });
    await storage.markNotificationAsRead(n1.id, "u1");
    await storage.deleteReadNotifications("u1");
    const remaining = await storage.getNotifications("u1");
    expect(remaining).toHaveLength(1);
    expect(remaining[0].title).toBe("B");
  });
});

describe("MemStorage - Path mapping CRUD", () => {
  let storage: MemStorageType;

  beforeEach(() => {
    storage = new MemStorage();
  });

  it("addPathMapping and getPathMappings", async () => {
    const mapping = await storage.addPathMapping({
      remotePath: "/downloads",
      localPath: "/mnt/downloads",
    });
    expect(mapping.id).toBeDefined();
    const all = await storage.getPathMappings();
    expect(all).toHaveLength(1);
  });

  it("getPathMapping returns mapping by id", async () => {
    const m = await storage.addPathMapping({ remotePath: "/dl", localPath: "/local" });
    const found = await storage.getPathMapping(m.id);
    expect(found?.id).toBe(m.id);
  });

  it("getPathMapping returns undefined for missing id", async () => {
    const result = await storage.getPathMapping("nonexistent");
    expect(result).toBeUndefined();
  });

  it("updatePathMapping updates an existing mapping", async () => {
    const m = await storage.addPathMapping({ remotePath: "/dl", localPath: "/local" });
    const updated = await storage.updatePathMapping(m.id, { localPath: "/new/local" });
    expect(updated?.localPath).toBe("/new/local");
  });

  it("updatePathMapping preserves remoteHost when not in updates", async () => {
    const m = await storage.addPathMapping({
      remotePath: "/dl",
      localPath: "/local",
      remoteHost: "server.local",
    });
    const updated = await storage.updatePathMapping(m.id, { localPath: "/new" });
    expect(updated?.remoteHost).toBe("server.local");
  });

  it("updatePathMapping sets remoteHost to null when explicitly null", async () => {
    const m = await storage.addPathMapping({
      remotePath: "/dl",
      localPath: "/local",
      remoteHost: "server.local",
    });
    const updated = await storage.updatePathMapping(m.id, { remoteHost: null });
    expect(updated?.remoteHost).toBeNull();
  });

  it("updatePathMapping returns undefined for missing mapping", async () => {
    const result = await storage.updatePathMapping("nonexistent", { localPath: "/new" });
    expect(result).toBeUndefined();
  });

  it("removePathMapping returns true and deletes mapping", async () => {
    const m = await storage.addPathMapping({ remotePath: "/dl", localPath: "/local" });
    expect(await storage.removePathMapping(m.id)).toBe(true);
    expect(await storage.getPathMappings()).toHaveLength(0);
  });

  it("removePathMapping returns false for missing id", async () => {
    expect(await storage.removePathMapping("nonexistent")).toBe(false);
  });
});

describe("MemStorage - Platform mapping CRUD", () => {
  let storage: MemStorageType;

  beforeEach(() => {
    storage = new MemStorage();
  });

  it("addPlatformMapping and getPlatformMappings", async () => {
    await storage.addPlatformMapping({ igdbPlatformId: 6, sourcePlatformName: "pc" });
    const all = await storage.getPlatformMappings();
    expect(all).toHaveLength(1);
    expect(all[0].sourcePlatformName).toBe("pc");
  });

  it("getPlatformMapping finds by igdbPlatformId", async () => {
    await storage.addPlatformMapping({ igdbPlatformId: 6, sourcePlatformName: "pc" });
    const found = await storage.getPlatformMapping(6);
    expect(found?.sourcePlatformName).toBe("pc");
  });

  it("getPlatformMapping returns undefined for missing igdbPlatformId", async () => {
    const result = await storage.getPlatformMapping(999);
    expect(result).toBeUndefined();
  });

  it("updatePlatformMapping updates existing mapping", async () => {
    const m = await storage.addPlatformMapping({ igdbPlatformId: 6, sourcePlatformName: "pc" });
    const updated = await storage.updatePlatformMapping(m.id, { sourcePlatformName: "windows" });
    expect(updated?.sourcePlatformName).toBe("windows");
  });

  it("updatePlatformMapping returns undefined for missing id", async () => {
    const result = await storage.updatePlatformMapping("nonexistent", { sourcePlatformName: "x" });
    expect(result).toBeUndefined();
  });

  it("removePlatformMapping returns true and deletes mapping", async () => {
    const m = await storage.addPlatformMapping({ igdbPlatformId: 6, sourcePlatformName: "pc" });
    expect(await storage.removePlatformMapping(m.id)).toBe(true);
    expect(await storage.getPlatformMappings()).toHaveLength(0);
  });

  it("seedPlatformMappingsIfEmpty seeds when empty", async () => {
    const result = await storage.seedPlatformMappingsIfEmpty([
      { igdbPlatformId: 6, sourcePlatformName: "pc" },
      { igdbPlatformId: 9, sourcePlatformName: "ps3" },
    ]);
    expect(result.seeded).toBe(true);
    expect(result.count).toBe(2);
  });

  it("seedPlatformMappingsIfEmpty skips when already populated", async () => {
    await storage.addPlatformMapping({ igdbPlatformId: 6, sourcePlatformName: "pc" });
    const result = await storage.seedPlatformMappingsIfEmpty([
      { igdbPlatformId: 9, sourcePlatformName: "ps3" },
    ]);
    expect(result.seeded).toBe(false);
    expect(result.count).toBe(1);
  });
});

describe("MemStorage - getImportConfig", () => {
  let storage: MemStorageType;

  beforeEach(() => {
    storage = new MemStorage();
  });

  it("returns default config when no settings exist", async () => {
    const config = await storage.getImportConfig();
    expect(config).toMatchObject({
      enablePostProcessing: false,
      transferMode: "hardlink",
    });
  });

  it("returns config from scoped user settings when userId provided", async () => {
    await storage.createUserSettings({
      userId: "u1",
      libraryRoot: "/my/library",
      transferMode: "move",
    });
    const config = await storage.getImportConfig("u1");
    expect(config.libraryRoot).toBe("/my/library");
    expect(config.transferMode).toBe("move");
  });

  it("returns first settings when no userId provided and settings exist", async () => {
    await storage.createUserSettings({ userId: "u1", libraryRoot: "/first/library" });
    const config = await storage.getImportConfig();
    expect(config.libraryRoot).toBe("/first/library");
  });
});

describe("MemStorage - getPendingImportReviews", () => {
  let storage: MemStorageType;

  beforeEach(async () => {
    storage = new MemStorage();
    await storage.registerSetupUser(makeUser());
  });

  it("returns downloads with manual_review_required for the user", async () => {
    const game = await storage.addGame(makeGame({ userId: "u1" }));
    const dl = await storage.addGameDownload({
      gameId: game.id,
      downloaderId: "d1",
      downloadHash: "abc",
      downloadTitle: "My Game",
      downloadType: "torrent",
      status: "manual_review_required",
    } as never); // NOSONAR

    const pending = await storage.getPendingImportReviews("u1");
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe(dl.id);
  });

  it("excludes downloads not in manual_review_required status", async () => {
    const game = await storage.addGame(makeGame({ userId: "u1" }));
    await storage.addGameDownload({
      gameId: game.id,
      downloaderId: "d1",
      downloadHash: "abc",
      downloadTitle: "My Game",
      downloadType: "torrent",
      status: "completed",
    } as never); // NOSONAR

    const pending = await storage.getPendingImportReviews("u1");
    expect(pending).toHaveLength(0);
  });

  it("excludes downloads belonging to another user's games", async () => {
    const game = await storage.addGame(makeGame({ userId: "u2" }));
    await storage.addGameDownload({
      gameId: game.id,
      downloaderId: "d1",
      downloadHash: "abc",
      downloadTitle: "Other User Game",
      downloadType: "torrent",
      status: "manual_review_required",
    } as never); // NOSONAR

    const pending = await storage.getPendingImportReviews("u1");
    expect(pending).toHaveLength(0);
  });
});

describe("MemStorage - Release blacklist CRUD", () => {
  let storage: MemStorageType;
  let gameId: string;

  beforeEach(async () => {
    storage = new MemStorage();
    await storage.registerSetupUser(makeUser());
    const game = await storage.addGame(makeGame({ userId: "u1" }));
    gameId = game.id;
  });

  it("addReleaseBlacklist creates entry", async () => {
    const entry = await storage.addReleaseBlacklist({
      gameId,
      releaseTitle: "Game.SKIDROW",
    });
    expect(entry.id).toBeDefined();
    expect(entry.gameId).toBe(gameId);
  });

  it("addReleaseBlacklist returns existing entry on duplicate", async () => {
    const first = await storage.addReleaseBlacklist({ gameId, releaseTitle: "Game.SKIDROW" });
    const second = await storage.addReleaseBlacklist({ gameId, releaseTitle: "Game.SKIDROW" });
    expect(second.id).toBe(first.id);
  });

  it("getReleaseBlacklist returns entries for gameId", async () => {
    await storage.addReleaseBlacklist({ gameId, releaseTitle: "Release1" });
    await storage.addReleaseBlacklist({ gameId, releaseTitle: "Release2" });
    const entries = await storage.getReleaseBlacklist(gameId);
    expect(entries).toHaveLength(2);
  });

  it("getAllReleaseBlacklists returns entries with gameTitle for user", async () => {
    await storage.addReleaseBlacklist({ gameId, releaseTitle: "BadRelease" });
    const all = await storage.getAllReleaseBlacklists("u1");
    expect(all).toHaveLength(1);
    expect(all[0].gameTitle).toBe("Test Game");
  });

  it("removeReleaseBlacklist deletes the entry", async () => {
    const entry = await storage.addReleaseBlacklist({ gameId, releaseTitle: "Release1" });
    expect(await storage.removeReleaseBlacklist(entry.id, gameId)).toBe(true);
    expect(await storage.getReleaseBlacklist(gameId)).toHaveLength(0);
  });

  it("removeReleaseBlacklist returns false for wrong gameId", async () => {
    const entry = await storage.addReleaseBlacklist({ gameId, releaseTitle: "Release1" });
    expect(await storage.removeReleaseBlacklist(entry.id, "wrong-game")).toBe(false);
  });

  it("getReleaseBlacklistSet returns set of titles for gameId", async () => {
    await storage.addReleaseBlacklist({ gameId, releaseTitle: "R1" });
    await storage.addReleaseBlacklist({ gameId, releaseTitle: "R2" });
    const set = await storage.getReleaseBlacklistSet(gameId);
    expect(set.has("R1")).toBe(true);
    expect(set.has("R2")).toBe(true);
    expect(set.size).toBe(2);
  });
});
