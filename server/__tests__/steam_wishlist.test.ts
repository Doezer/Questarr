import { describe, it, expect, vi, beforeEach } from "vitest";
import { syncUserSteamWishlist, checkSteamWishlist } from "../cron.js";
import { storage } from "../storage.js";
import { steamService } from "../steam.js";
import { rawgClient } from "../rawg.js";
import type { Game, ImportTask, User, UserSettings } from "../../shared/schema.js";
import type { RawgGame } from "../rawg.js";

// Mock dependencies
vi.mock("../storage.js");
vi.mock("../steam.js");
vi.mock("../rawg.js");
vi.mock("../logger.js", () => {
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };
  return {
    logger: mockLogger,
    routesLogger: mockLogger,
    expressLogger: mockLogger,
    downloadersLogger: mockLogger,
    torznabLogger: mockLogger,
    searchLogger: mockLogger,
  };
});

vi.mock("../socket.js", () => ({
  notifyUser: vi.fn(),
}));

vi.mock("../apprise.js", () => ({
  appriseClient: { send: vi.fn() },
}));

vi.mock("../services/index.js", () => ({
  importManager: { processImport: vi.fn() },
}));

function setupUser(steamSyncFailures = 0, settingsOverrides: Partial<UserSettings> = {}) {
  vi.mocked(storage.getUser).mockResolvedValue({
    id: "user-1",
    steamId64: "76561198000000000",
  } as unknown as User);
  vi.mocked(storage.getUserSettings).mockResolvedValue({
    steamSyncFailures,
    ...settingsOverrides,
  } as unknown as UserSettings);
  vi.mocked(storage.createImportTask).mockResolvedValue({
    id: "task-1",
  } as unknown as ImportTask);
  vi.mocked(storage.addNotification).mockImplementation(
    async (n) => ({ id: "notif-1", ...n }) as never
  );
}

function makeFormattedGame(title: string, rawgId: number) {
  return {
    title,
    rawgId,
    rawgSlug: `slug-${rawgId}`,
    coverUrl: "",
    summary: "",
    releaseDate: "",
    rating: 0,
    platforms: [],
    genres: [],
    themes: [],
    isAdultContent: false,
    isAgeRestricted: false,
    developers: [],
    publishers: [],
    screenshots: [],
    isReleased: true,
  };
}

describe("syncUserSteamWishlist (RAWG resolution)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(storage.getUserGames).mockResolvedValue([] as Game[]);
    vi.mocked(storage.startImportTask).mockResolvedValue(undefined);
    vi.mocked(storage.updateImportTask).mockResolvedValue(undefined);
    vi.mocked(storage.addImportTaskItemsBatch).mockResolvedValue([] as never);
  });

  it("returns early when the user has no Steam ID", async () => {
    vi.mocked(storage.getUser).mockResolvedValue(undefined as never);

    const result = await syncUserSteamWishlist("user-1");

    expect(result).toBeUndefined();
    expect(steamService.getWishlist).not.toHaveBeenCalled();
  });

  it("refuses to sync after repeated failures", async () => {
    setupUser(3);

    const result = await syncUserSteamWishlist("user-1");

    expect(result).toMatchObject({ success: false });
    expect(steamService.getWishlist).not.toHaveBeenCalled();
  });

  it("resolves wishlist App IDs through RAWG and adds new games", async () => {
    setupUser(0);
    vi.mocked(steamService.getWishlist).mockResolvedValue([
      { steamAppId: 201, name: "New Game" },
    ] as never);
    vi.mocked(rawgClient.getGameBySteamAppId).mockResolvedValue({
      id: 2001,
      name: "New Game",
    } as RawgGame);
    vi.mocked(rawgClient.formatGame).mockReturnValue(makeFormattedGame("New Game", 2001));

    const result = await syncUserSteamWishlist("user-1");

    expect(result).toMatchObject({ success: true, addedCount: 1 });
    expect(rawgClient.getGameBySteamAppId).toHaveBeenCalledWith(201);
    expect(storage.addGame).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        title: "New Game",
        rawgId: 2001,
        steamAppId: 201,
        status: "wanted",
        source: "steam",
      })
    );
    // Successful resolution -> clean completion, no failed import items.
    expect(storage.addImportTaskItemsBatch).not.toHaveBeenCalled();
    expect(storage.updateImportTask).toHaveBeenCalledWith(
      "task-1",
      expect.objectContaining({ status: "completed", failedItems: 0, addedItems: 1 })
    );
    expect(storage.addNotification).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Steam Wishlist Synced" })
    );
  });

  it("links an existing library game instead of adding a duplicate", async () => {
    setupUser(0);
    const existing = {
      id: "game-1",
      userId: "user-1",
      rawgId: 1001,
      steamAppId: null,
    } as unknown as Game;
    vi.mocked(storage.getUserGames).mockResolvedValue([existing]);
    vi.mocked(steamService.getWishlist).mockResolvedValue([
      { steamAppId: 101, name: "Existing Game" },
    ] as never);
    vi.mocked(rawgClient.getGameBySteamAppId).mockResolvedValue({
      id: 1001,
      name: "Existing Game",
    } as RawgGame);
    vi.mocked(rawgClient.formatGame).mockReturnValue(makeFormattedGame("Existing Game", 1001));

    const result = await syncUserSteamWishlist("user-1");

    expect(result).toMatchObject({ success: true, addedCount: 0 });
    expect(storage.updateGame).toHaveBeenCalledWith(
      "game-1",
      expect.objectContaining({ steamAppId: 101 })
    );
    expect(storage.addGame).not.toHaveBeenCalled();
  });

  it("skips wishlist games already in the library by Steam App ID", async () => {
    setupUser(0);
    const existing = {
      id: "game-1",
      userId: "user-1",
      rawgId: 1001,
      steamAppId: 101,
    } as unknown as Game;
    vi.mocked(storage.getUserGames).mockResolvedValue([existing]);
    vi.mocked(steamService.getWishlist).mockResolvedValue([
      { steamAppId: 101, name: "Existing Game" },
    ] as never);

    const result = await syncUserSteamWishlist("user-1");

    expect(result).toMatchObject({ success: true, addedCount: 0 });
    expect(rawgClient.getGameBySteamAppId).not.toHaveBeenCalled();
    expect(storage.updateImportTask).toHaveBeenCalledWith(
      "task-1",
      expect.objectContaining({ status: "completed", skippedItems: 1 })
    );
  });

  it("records unresolvable App IDs as failed import items", async () => {
    setupUser(0);
    vi.mocked(steamService.getWishlist).mockResolvedValue([
      { steamAppId: 301, name: "Unknown Game" },
    ] as never);
    vi.mocked(rawgClient.getGameBySteamAppId).mockResolvedValue(null);

    const result = await syncUserSteamWishlist("user-1");

    expect(result).toMatchObject({ success: true, addedCount: 0 });
    expect(storage.addImportTaskItemsBatch).toHaveBeenCalledWith([
      expect.objectContaining({
        taskId: "task-1",
        itemName: "Steam App 301",
        result: "failed",
        errorMessage: "No RAWG match found",
      }),
    ]);
    expect(storage.updateImportTask).toHaveBeenCalledWith(
      "task-1",
      expect.objectContaining({ status: "completed_with_errors", failedItems: 1 })
    );
  });

  it("increments the failure counter and marks the task failed on Steam errors", async () => {
    setupUser(0);
    vi.mocked(steamService.getWishlist).mockRejectedValue(new Error("Steam API error"));

    const result = await syncUserSteamWishlist("user-1");

    expect(result).toMatchObject({ success: false });
    expect(storage.updateUserSettings).toHaveBeenCalledWith("user-1", {
      steamSyncFailures: 1,
    });
    expect(storage.updateImportTask).toHaveBeenCalledWith(
      "task-1",
      expect.objectContaining({ status: "failed" })
    );
  });
});

describe("checkSteamWishlist (scheduled auto-sync)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips users without Steam IDs or auto-sync enabled", async () => {
    vi.mocked(storage.getAllUsers).mockResolvedValue([
      { id: "user-a" } as unknown as User,
      { id: "user-b", steamId64: "1" } as unknown as User,
    ]);
    vi.mocked(storage.getUserSettings).mockResolvedValue({
      steamSyncEnabled: false,
    } as unknown as UserSettings);

    await checkSteamWishlist();

    expect(steamService.getWishlist).not.toHaveBeenCalled();
  });

  it("syncs users whose sync interval has elapsed and records the timestamp", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2023-06-01T12:00:00Z"));
    try {
      vi.mocked(storage.getAllUsers).mockResolvedValue([
        { id: "user-1", steamId64: "76561198000000001" } as unknown as User,
      ]);
      vi.mocked(storage.getUserSettings).mockResolvedValue({
        steamSyncEnabled: true,
        steamSyncIntervalHours: 24,
        lastSteamSync: "2023-05-30T12:00:00.000Z",
        steamSyncFailures: 0,
      } as unknown as UserSettings);
      vi.mocked(storage.getUser).mockResolvedValue({
        id: "user-1",
        steamId64: "76561198000000001",
      } as unknown as User);
      vi.mocked(storage.getUserGames).mockResolvedValue([] as Game[]);
      vi.mocked(storage.createImportTask).mockResolvedValue({ id: "task-1" } as never);
      vi.mocked(steamService.getWishlist).mockResolvedValue([] as never);

      await checkSteamWishlist();

      expect(steamService.getWishlist).toHaveBeenCalledWith("76561198000000001");
      expect(storage.updateUserSettings).toHaveBeenCalledWith(
        "user-1",
        expect.objectContaining({ lastSteamSync: expect.any(Date) })
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
