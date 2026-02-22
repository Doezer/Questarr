import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { checkGameUpdates } from "../cron.js";
import { storage } from "../storage.js";
import { igdbClient } from "../igdb.js";
import type { Game } from "../../shared/schema.js";

// Mock dependencies
vi.mock("../storage.js", () => ({
  storage: {
    getAllGames: vi.fn(),
    updateGame: vi.fn(),
    updateGamesBatch: vi.fn(),
    addNotificationsBatch: vi.fn(),
  },
}));

vi.mock("../igdb.js", () => ({
  igdbClient: {
    getGamesByIds: vi.fn(),
  },
}));

vi.mock("../logger.js", () => ({
  igdbLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../socket.js", () => ({
  notifyUser: vi.fn(),
}));

describe("checkGameUpdates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2023-06-01T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should batch updates and notifications for multiple games", async () => {
    const mockGames: Partial<Game>[] = [
      {
        id: "game-1",
        title: "Game 1",
        igdbId: 1001,
        releaseDate: "2023-01-01",
        releaseStatus: "upcoming",
        originalReleaseDate: "2023-01-01",
      },
      {
        id: "game-2",
        title: "Game 2",
        igdbId: 1002,
        releaseDate: "2099-01-01",
        releaseStatus: "released",
        originalReleaseDate: "2099-01-01",
      },
      {
        id: "game-3",
        title: "Game 3",
        igdbId: 1003,
        releaseDate: "2023-06-15", // Delayed 14 days (threshold 7)
        releaseStatus: "upcoming",
        originalReleaseDate: "2023-06-01", // original was today
      },
    ];

    vi.mocked(storage.getAllGames).mockResolvedValue(mockGames as Game[]);

    const mockIgdbGames = [
      {
        id: 1001,
        first_release_date: Math.floor(new Date("2023-01-01").getTime() / 1000),
      },
      {
        id: 1002,
        first_release_date: Math.floor(new Date("2099-01-01").getTime() / 1000),
      },
      {
        id: 1003,
        first_release_date: Math.floor(new Date("2023-06-15").getTime() / 1000), // Delayed
      },
    ];
    vi.mocked(igdbClient.getGamesByIds).mockResolvedValue(mockIgdbGames as never);

    vi.mocked(storage.addNotificationsBatch).mockResolvedValue([
      { id: "notif-1" },
      { id: "notif-2" },
    ] as never);

    await checkGameUpdates();

    const batchCalls = vi.mocked(storage.updateGamesBatch).mock.calls;
    const notificationCalls = vi.mocked(storage.addNotificationsBatch).mock.calls;

    expect(batchCalls.length).toBe(1);

    const updates = batchCalls[0][0];
    expect(updates).toHaveLength(3);

    const game1Update = updates.find((u) => u.id === "game-1");
    const game2Update = updates.find((u) => u.id === "game-2");
    const game3Update = updates.find((u) => u.id === "game-3");

    expect(game1Update?.data.releaseStatus).toBe("released");
    expect(game2Update?.data.releaseStatus).toBe("upcoming");
    expect(game3Update?.data.releaseStatus).toBe("delayed");

    expect(notificationCalls.length).toBe(1);
    expect(notificationCalls[0][0]).toHaveLength(2); // 1 for release, 1 for delayed
  });

  it("should initialize originalReleaseDate if missing", async () => {
    const mockGames: Partial<Game>[] = [
      {
        id: "game-1",
        title: "Game 1",
        igdbId: 1001,
        releaseDate: "2023-05-01",
        originalReleaseDate: null as never,
      },
      {
        id: "game-2",
        title: "Game 2",
        igdbId: 1002,
        releaseDate: null as never,
        originalReleaseDate: null as never,
      },
    ];
    vi.mocked(storage.getAllGames).mockResolvedValue(mockGames as Game[]);

    const mockIgdbGames = [
      { id: 1001, first_release_date: Math.floor(new Date("2023-05-01").getTime() / 1000) },
      { id: 1002, first_release_date: Math.floor(new Date("2023-08-01").getTime() / 1000) },
    ];
    vi.mocked(igdbClient.getGamesByIds).mockResolvedValue(mockIgdbGames as never);

    await checkGameUpdates();

    const batchCalls = vi.mocked(storage.updateGamesBatch).mock.calls;
    expect(batchCalls.length).toBe(1);

    const updates = batchCalls[0][0];
    const game1Update = updates.find((u) => u.id === "game-1");
    const game2Update = updates.find((u) => u.id === "game-2");

    expect(game1Update?.data.originalReleaseDate).toBe("2023-05-01");
    expect(game2Update?.data.originalReleaseDate).toBe("2023-08-01");
    expect(game2Update?.data.releaseDate).toBe("2023-08-01");
  });

  it("should handle network errors from IGDB gracefully", async () => {
    const mockGames: Partial<Game>[] = [{ id: "game-1", igdbId: 1001 }];
    vi.mocked(storage.getAllGames).mockResolvedValue(mockGames as Game[]);

    const error = new Error("fetch failed") as Error & { code?: string };
    error.code = "ENOTFOUND";
    vi.mocked(igdbClient.getGamesByIds).mockRejectedValue(error);

    await expect(checkGameUpdates()).resolves.not.toThrow();

    expect(vi.mocked(storage.updateGamesBatch)).not.toHaveBeenCalled();
  });

  it("should handle notification batch failure gracefully", async () => {
    const mockGames: Partial<Game>[] = [
      {
        id: "game-1",
        igdbId: 1001,
        releaseDate: "2023-01-01",
        releaseStatus: "upcoming",
        originalReleaseDate: "2023-01-01",
      },
    ];
    vi.mocked(storage.getAllGames).mockResolvedValue(mockGames as Game[]);
    vi.mocked(igdbClient.getGamesByIds).mockResolvedValue([
      {
        id: 1001,
        first_release_date: Math.floor(new Date("2023-01-01").getTime() / 1000),
      },
    ] as never);

    vi.mocked(storage.addNotificationsBatch).mockRejectedValue(new Error("DB Error"));

    await expect(checkGameUpdates()).resolves.not.toThrow();

    expect(vi.mocked(storage.updateGamesBatch)).toHaveBeenCalled();
    expect(vi.mocked(storage.addNotificationsBatch)).toHaveBeenCalled();
  });
});
