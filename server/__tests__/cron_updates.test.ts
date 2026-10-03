import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { checkGameUpdates } from "../cron.js";
import { storage } from "../storage.js";
import { rawgClient } from "../rawg.js";
import type { Game } from "../../shared/schema.js";
import type { RawgGame } from "../rawg.js";

// Mock dependencies
vi.mock("../storage.js", () => ({
  storage: {
    getAllGames: vi.fn(),
    getUserSettings: vi.fn(),
    updateGame: vi.fn(),
    updateGamesBatch: vi.fn(),
    addNotificationsBatch: vi.fn(),
  },
}));

vi.mock("../rawg.js", () => ({
  rawgClient: {
    isConfigured: vi.fn().mockResolvedValue(true),
    getGameById: vi.fn(),
  },
}));

vi.mock("../logger.js", () => {
  const mockChildLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  return {
    logger: {
      child: vi.fn(() => mockChildLogger),
    },
    routesLogger: mockChildLogger,
    expressLogger: mockChildLogger,
    downloadersLogger: mockChildLogger,
    torznabLogger: mockChildLogger,
    searchLogger: mockChildLogger,
  };
});

vi.mock("../socket.js", () => ({
  notifyUser: vi.fn(),
}));

describe("checkGameUpdates (RAWG)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2023-06-01T12:00:00Z"));
    vi.mocked(rawgClient.isConfigured).mockResolvedValue(true);
    vi.mocked(storage.getUserSettings).mockResolvedValue(null as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("skips the check entirely when RAWG is not configured", async () => {
    vi.mocked(rawgClient.isConfigured).mockResolvedValue(false);

    await checkGameUpdates();

    expect(storage.getAllGames).not.toHaveBeenCalled();
    expect(rawgClient.getGameById).not.toHaveBeenCalled();
  });

  it("only checks upcoming games that have a RAWG id", async () => {
    const mockGames: Partial<Game>[] = [
      {
        id: "game-1",
        title: "Game 1",
        rawgId: 1001,
        releaseDate: "2023-07-01",
        releaseStatus: "upcoming",
        originalReleaseDate: "2023-07-01",
      },
      {
        id: "game-2",
        title: "Game 2",
        rawgId: 1002,
        releaseDate: "2020-01-01",
        releaseStatus: "released",
      },
      {
        id: "game-3",
        title: "Game 3",
        releaseDate: "2023-07-01",
        releaseStatus: "upcoming",
      },
      {
        id: "game-4",
        title: "Game 4",
        rawgId: 1004,
        releaseDate: "2023-07-01",
        releaseStatus: "upcoming",
        hidden: true,
      },
    ];
    vi.mocked(storage.getAllGames).mockResolvedValue(mockGames as Game[]);
    vi.mocked(rawgClient.getGameById).mockResolvedValue(null);

    await checkGameUpdates();

    expect(rawgClient.getGameById).toHaveBeenCalledTimes(1);
    expect(rawgClient.getGameById).toHaveBeenCalledWith(1001);
  });

  it("marks released games, flags delays, and sends one notification each", async () => {
    const mockGames: Partial<Game>[] = [
      {
        id: "game-1",
        title: "Game 1",
        rawgId: 1001,
        releaseDate: "2023-01-01",
        releaseStatus: "upcoming",
        originalReleaseDate: "2023-01-01",
      },
      {
        id: "game-3",
        title: "Game 3",
        rawgId: 1003,
        releaseDate: "2023-06-15", // Delayed 14 days (threshold 7)
        releaseStatus: "upcoming",
        originalReleaseDate: "2023-06-01", // original was today
      },
      {
        id: "game-4",
        title: "Game 4",
        rawgId: 1004,
        releaseDate: "2023-06-18", // 3 days after original — still upcoming
        releaseStatus: "upcoming",
        originalReleaseDate: "2023-06-15",
      },
    ];
    vi.mocked(storage.getAllGames).mockResolvedValue(mockGames as Game[]);

    vi.mocked(rawgClient.getGameById).mockImplementation(async (id: number) => {
      const dates: Record<number, string> = {
        1001: "2023-01-01", // in the past -> released
        1003: "2023-06-20", // delayed
        1004: "2023-06-18", // minor slip, still upcoming
      };
      return { id, released: dates[id] } as RawgGame;
    });

    vi.mocked(storage.addNotificationsBatch).mockImplementation(
      async (notifications: unknown[]) =>
        notifications.map((_, i) => ({ id: `notif-${i}` })) as never
    );

    await checkGameUpdates();

    const batchCalls = vi.mocked(storage.updateGamesBatch).mock.calls;
    const notificationCalls = vi.mocked(storage.addNotificationsBatch).mock.calls;

    expect(batchCalls.length).toBe(1);
    const updates = batchCalls[0][0];
    const game1Update = updates.find((u) => u.id === "game-1");
    const game3Update = updates.find((u) => u.id === "game-3");
    const game4Update = updates.find((u) => u.id === "game-4");

    expect(game1Update?.data.releaseStatus).toBe("released");
    expect(game3Update?.data.releaseStatus).toBe("delayed");
    expect(game3Update?.data.releaseDate).toBe("2023-06-20");
    // game-4: same date, same status — nothing to update.
    expect(game4Update).toBeUndefined();

    expect(notificationCalls.length).toBe(1);
    expect(notificationCalls[0][0]).toHaveLength(2); // 1 released, 1 delayed
  });

  it("initializes originalReleaseDate when it is missing", async () => {
    const mockGames: Partial<Game>[] = [
      {
        id: "game-1",
        title: "Game 1",
        rawgId: 1001,
        releaseDate: "2023-08-01",
        releaseStatus: "upcoming",
        originalReleaseDate: null as never,
      },
      {
        id: "game-2",
        title: "Game 2",
        rawgId: 1002,
        releaseDate: null as never,
        releaseStatus: "upcoming",
        originalReleaseDate: null as never,
      },
    ];
    vi.mocked(storage.getAllGames).mockResolvedValue(mockGames as Game[]);

    vi.mocked(rawgClient.getGameById).mockImplementation(async (id: number) => {
      const dates: Record<number, string> = {
        1001: "2023-08-01",
        1002: "2023-09-01",
      };
      return { id, released: dates[id] } as RawgGame;
    });

    await checkGameUpdates();

    const updates = vi.mocked(storage.updateGamesBatch).mock.calls[0][0];
    const game1Update = updates.find((u) => u.id === "game-1");
    const game2Update = updates.find((u) => u.id === "game-2");

    // game-1: date and status unchanged, so only the original date is recorded.
    expect(game1Update?.data.originalReleaseDate).toBe("2023-08-01");
    expect(game1Update?.data.releaseDate).toBeUndefined();
    // game-2: no stored date — both fields come from RAWG.
    expect(game2Update?.data.originalReleaseDate).toBe("2023-09-01");
    expect(game2Update?.data.releaseDate).toBe("2023-09-01");
  });

  it("updates the earlyAccess flag from RAWG tags for undated games", async () => {
    const mockGames: Partial<Game>[] = [
      {
        id: "game-ea",
        title: "Early Access Game",
        rawgId: 2001,
        earlyAccess: false,
        releaseDate: null as never,
        releaseStatus: "upcoming",
        originalReleaseDate: null as never,
      },
    ];
    vi.mocked(storage.getAllGames).mockResolvedValue(mockGames as Game[]);
    vi.mocked(rawgClient.getGameById).mockResolvedValue({
      id: 2001,
      released: null,
      tags: [{ id: 1, name: "Early Access" }],
    } as RawgGame);

    await checkGameUpdates();

    const updates = vi.mocked(storage.updateGamesBatch).mock.calls[0][0];
    const update = updates.find((u) => u.id === "game-ea");
    expect(update?.data.earlyAccess).toBe(true);
  });

  it("handles per-game RAWG errors gracefully", async () => {
    const mockGames: Partial<Game>[] = [
      {
        id: "game-1",
        title: "Game 1",
        rawgId: 1001,
        releaseDate: "2023-01-01",
        releaseStatus: "upcoming",
        originalReleaseDate: "2023-01-01",
      },
      {
        id: "game-2",
        title: "Game 2",
        rawgId: 1002,
        releaseDate: "2023-02-01",
        releaseStatus: "upcoming",
        originalReleaseDate: "2023-02-01",
      },
    ];
    vi.mocked(storage.getAllGames).mockResolvedValue(mockGames as Game[]);

    vi.mocked(rawgClient.getGameById).mockImplementation(async (id: number) => {
      if (id === 1001) throw new Error("429 rate limited");
      return { id, released: "2023-02-01" } as RawgGame;
    });

    await expect(checkGameUpdates()).resolves.not.toThrow();

    // Only the healthy game is processed.
    const updates = vi.mocked(storage.updateGamesBatch).mock.calls[0]?.[0];
    expect(updates?.some((u) => u.id === "game-1")).toBe(false);
  });

  it("handles notification batch failure gracefully", async () => {
    const mockGames: Partial<Game>[] = [
      {
        id: "game-1",
        title: "Game 1",
        rawgId: 1001,
        releaseDate: "2023-01-01",
        releaseStatus: "upcoming",
        originalReleaseDate: "2023-01-01",
      },
    ];
    vi.mocked(storage.getAllGames).mockResolvedValue(mockGames as Game[]);
    vi.mocked(rawgClient.getGameById).mockResolvedValue({
      id: 1001,
      released: "2023-01-01",
    } as RawgGame);

    vi.mocked(storage.addNotificationsBatch).mockRejectedValue(new Error("DB Error"));

    await expect(checkGameUpdates()).resolves.not.toThrow();

    expect(vi.mocked(storage.updateGamesBatch)).toHaveBeenCalled();
    expect(vi.mocked(storage.addNotificationsBatch)).toHaveBeenCalled();
  });
});
