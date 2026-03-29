import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Game, UserSettings } from "@shared/schema";

// --- Mocks ---
const createMockLogger = () => ({
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

// Mock logger to avoid noise and missing exports
vi.mock("../logger.js", () => ({
  logger: { child: vi.fn().mockReturnThis() },
  igdbLogger: createMockLogger(),
  searchLogger: createMockLogger(),
  torznabLogger: createMockLogger(),
  routesLogger: createMockLogger(),
  expressLogger: createMockLogger(),
  downloadersLogger: createMockLogger(),
}));

// Mock storage
const mockGetWantedGamesGroupedByUser = vi.fn();
const mockGetUserGames = vi.fn();
const mockGetUserSettings = vi.fn();
const mockUpdateUserSettings = vi.fn();
const mockAddNotification = vi.fn();
const mockUpdateGameSearchResultsAvailable = vi.fn();
const mockUpdateGameStatus = vi.fn();
const mockAddGameDownload = vi.fn();
const mockGetEnabledDownloaders = vi.fn().mockResolvedValue([]);

vi.mock("../storage.js", () => ({
  storage: {
    getWantedGamesGroupedByUser: mockGetWantedGamesGroupedByUser,
    getUserGames: mockGetUserGames,
    getUserSettings: mockGetUserSettings,
    updateUserSettings: mockUpdateUserSettings,
    addNotification: mockAddNotification,
    updateGameSearchResultsAvailable: mockUpdateGameSearchResultsAvailable,
    updateGameStatus: mockUpdateGameStatus,
    addGameDownload: mockAddGameDownload,
    getEnabledDownloaders: mockGetEnabledDownloaders,
    getReleaseBlacklistSet: vi.fn().mockResolvedValue(new Set()),
  },
}));

// Mock search
const mockSearchAllIndexers = vi.fn();
vi.mock("../search.js", () => ({
  searchAllIndexers: mockSearchAllIndexers,
  filterBlacklistedReleases: (items: { title: string }[], blacklisted: Set<string>) =>
    blacklisted.size > 0 ? items.filter((item) => !blacklisted.has(item.title)) : items,
}));

// Mock socket
vi.mock("../socket.js", () => ({
  notifyUser: vi.fn(),
}));

// Mock downloaders
const mockAddDownloadWithFallback = vi.fn();
vi.mock("../downloaders.js", () => ({
  DownloaderManager: {
    addDownloadWithFallback: mockAddDownloadWithFallback,
  },
}));

// Mock igdb
vi.mock("../igdb.js", () => ({
  igdbClient: {
    getGamesByIds: vi.fn(),
  },
}));

// Mock xrel
vi.mock("../xrel.js", () => ({
  xrelClient: {
    getLatestReleases: vi.fn(),
  },
  DEFAULT_XREL_BASE: "http://example.com",
}));

// Import the function under test
// We need to use dynamic import or require because of the hoisting of vi.mock
const { checkAutoSearch } = await import("../cron.js");

describe("Cron - checkAutoSearch", () => {
  const userId = "user-123";
  const FIXED_NOW = new Date("2026-01-01T12:00:00.000Z");
  const FIXED_PUB_DATE = "2026-01-01T10:00:00.000Z";

  const baseGame: Game = {
    id: "game-1",
    userId: userId,
    igdbId: 1001,
    title: "Test Game",
    status: "wanted",
    releaseStatus: "released",
    hidden: false,
    addedAt: new Date(FIXED_NOW),
    completedAt: null,
    // Optional fields
    summary: null,
    coverUrl: null,
    releaseDate: null,
    rating: null,
    platforms: [],
    genres: [],
    publishers: [],
    developers: [],
    screenshots: [],
    originalReleaseDate: null,
  };

  const baseSettings: UserSettings = {
    id: "settings-1",
    userId: userId,
    autoSearchEnabled: true,
    autoDownloadEnabled: false,
    notifyMultipleDownloads: false,
    notifyUpdates: false,
    searchIntervalHours: 6, // Default interval
    igdbRateLimitPerSecond: 3,
    downloadRules: null,
    lastAutoSearch: null, // Never searched before, so should run immediately
    xrelSceneReleases: true,
    xrelP2pReleases: false,
    autoSearchUnreleased: false, // Default: false
    preferredReleaseGroups: null,
    filterByPreferredGroups: false,
    steamSyncFailures: 0,
    updatedAt: new Date(FIXED_NOW),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);

    // Default mock setup:
    // - 1 user with 1 wanted game (released)
    // - User has auto search enabled
    mockGetWantedGamesGroupedByUser.mockResolvedValue(new Map([[userId, [baseGame]]]));
    mockGetUserGames.mockResolvedValue([]);
    mockGetUserSettings.mockResolvedValue(baseSettings);
    mockSearchAllIndexers.mockResolvedValue({ items: [], errors: [], total: 0 });
    mockGetEnabledDownloaders.mockResolvedValue([]);
    mockAddNotification.mockResolvedValue({ id: "notif-1" });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const UPDATE_ITEM = {
    title: "Test Game Update v1.1",
    link: "https://example.com/update",
    pubDate: FIXED_PUB_DATE,
    seeders: 100,
    size: 1024,
  };

  it("should search for released games when autoSearchUnreleased is false (default)", async () => {
    // Setup: Game is released. Settings default (autoSearchUnreleased = false).
    const game = { ...baseGame, releaseStatus: "released" as const };
    mockGetWantedGamesGroupedByUser.mockResolvedValue(new Map([[userId, [game]]]));

    await checkAutoSearch();

    expect(mockSearchAllIndexers).toHaveBeenCalledWith(
      expect.objectContaining({
        query: game.title,
      })
    );
  });

  it("should NOT search for unreleased games when autoSearchUnreleased is false", async () => {
    // Setup: Game is unreleased (upcoming). Settings default (autoSearchUnreleased = false).
    const game = { ...baseGame, releaseStatus: "upcoming" as const };
    mockGetWantedGamesGroupedByUser.mockResolvedValue(new Map([[userId, [game]]]));

    await checkAutoSearch();

    expect(mockSearchAllIndexers).not.toHaveBeenCalled();
  });

  it("should search for released games when autoSearchUnreleased is true", async () => {
    // Setup: Game is released. Settings enabled (autoSearchUnreleased = true).
    const game = { ...baseGame, releaseStatus: "released" as const };
    const settings = { ...baseSettings, autoSearchUnreleased: true };

    mockGetWantedGamesGroupedByUser.mockResolvedValue(new Map([[userId, [game]]]));
    mockGetUserSettings.mockResolvedValue(settings);

    await checkAutoSearch();

    expect(mockSearchAllIndexers).toHaveBeenCalledWith(
      expect.objectContaining({
        query: game.title,
      })
    );
  });

  it("should search for unreleased games when autoSearchUnreleased is true", async () => {
    // Setup: Game is unreleased (upcoming). Settings enabled (autoSearchUnreleased = true).
    const game = { ...baseGame, releaseStatus: "upcoming" as const };
    const settings = { ...baseSettings, autoSearchUnreleased: true };

    mockGetWantedGamesGroupedByUser.mockResolvedValue(new Map([[userId, [game]]]));
    mockGetUserSettings.mockResolvedValue(settings);

    await checkAutoSearch();

    expect(mockSearchAllIndexers).toHaveBeenCalledWith(
      expect.objectContaining({
        query: game.title,
      })
    );
  });

  it("should search for delayed games when autoSearchUnreleased is true", async () => {
    // Setup: Game is delayed. Settings enabled (autoSearchUnreleased = true).
    const game = { ...baseGame, releaseStatus: "delayed" as const };
    const settings = { ...baseSettings, autoSearchUnreleased: true };

    mockGetWantedGamesGroupedByUser.mockResolvedValue(new Map([[userId, [game]]]));
    mockGetUserSettings.mockResolvedValue(settings);

    await checkAutoSearch();

    expect(mockSearchAllIndexers).toHaveBeenCalledWith(
      expect.objectContaining({
        query: game.title,
      })
    );
  });

  it("should NOT search for delayed games when autoSearchUnreleased is false", async () => {
    // Setup: Game is delayed. Settings disabled (autoSearchUnreleased = false).
    const game = { ...baseGame, releaseStatus: "delayed" as const };
    const settings = { ...baseSettings, autoSearchUnreleased: false };

    mockGetWantedGamesGroupedByUser.mockResolvedValue(new Map([[userId, [game]]]));
    mockGetUserSettings.mockResolvedValue(settings);

    await checkAutoSearch();

    expect(mockSearchAllIndexers).not.toHaveBeenCalled();
  });

  it("should respect search interval", async () => {
    // Setup: Last search was very recent.
    const settings = {
      ...baseSettings,
      lastAutoSearch: new Date(), // Just now
      searchIntervalHours: 6,
    };
    mockGetUserSettings.mockResolvedValue(settings);

    await checkAutoSearch();

    expect(mockSearchAllIndexers).not.toHaveBeenCalled();
  });

  it("should search if interval has passed", async () => {
    // Setup: Last search was long ago.
    const lastSearch = new Date();
    lastSearch.setHours(lastSearch.getHours() - 7); // 7 hours ago

    const settings = {
      ...baseSettings,
      lastAutoSearch: lastSearch,
      searchIntervalHours: 6,
    };
    mockGetUserSettings.mockResolvedValue(settings);

    await checkAutoSearch();

    expect(mockSearchAllIndexers).toHaveBeenCalled();
  });

  it("should not notify updates for wanted games", async () => {
    const game = { ...baseGame, status: "wanted" as const, releaseStatus: "released" as const };
    const settings = { ...baseSettings, notifyUpdates: true };

    mockGetWantedGamesGroupedByUser.mockResolvedValue(new Map([[userId, [game]]]));
    mockGetUserSettings.mockResolvedValue(settings);
    mockSearchAllIndexers.mockResolvedValue({ items: [UPDATE_ITEM], errors: [], total: 1 });

    await checkAutoSearch();

    expect(mockAddNotification).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: "Game Updates Available" })
    );
  });

  it("should notify updates for owned games", async () => {
    const game = { ...baseGame, status: "owned" as const, releaseStatus: "released" as const };
    const settings = { ...baseSettings, notifyUpdates: true };

    mockGetWantedGamesGroupedByUser.mockResolvedValue(new Map([[userId, []]]));
    mockGetUserGames.mockResolvedValue([game]);
    mockGetUserSettings.mockResolvedValue(settings);
    mockSearchAllIndexers.mockResolvedValue({ items: [UPDATE_ITEM], errors: [], total: 1 });

    await checkAutoSearch();

    expect(mockAddNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId,
        title: "Game Updates Available",
        message: expect.stringContaining(game.title),
      })
    );
  });

  it("should still notify game availability for wanted games when main results exist", async () => {
    const game = { ...baseGame, status: "wanted" as const, releaseStatus: "released" as const };
    const settings = { ...baseSettings, notifyUpdates: true, autoDownloadEnabled: false };

    mockGetWantedGamesGroupedByUser.mockResolvedValue(new Map([[userId, [game]]]));
    mockGetUserSettings.mockResolvedValue(settings);
    mockSearchAllIndexers.mockResolvedValue({
      items: [
        {
          title: "Test Game MULTi",
          link: "https://example.com/main",
          pubDate: FIXED_PUB_DATE,
          seeders: 120,
          size: 10_000,
        },
        {
          title: "Test Game Update v1.1",
          link: "https://example.com/update",
          pubDate: FIXED_PUB_DATE,
          seeders: 100,
          size: 2_000,
        },
      ],
      errors: [],
      total: 2,
    });

    await checkAutoSearch();

    expect(mockAddNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId,
        title: "Game Available",
        message: expect.stringContaining(game.title),
      })
    );
    expect(mockAddNotification).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: "Game Updates Available" })
    );
  });

  it("should mark search results available when single main result found and auto-download disabled", async () => {
    const game = { ...baseGame, status: "wanted" as const, releaseStatus: "released" as const };
    const settings = { ...baseSettings, autoDownloadEnabled: false };

    mockGetWantedGamesGroupedByUser.mockResolvedValue(new Map([[userId, [game]]]));
    mockGetUserSettings.mockResolvedValue(settings);
    mockSearchAllIndexers.mockResolvedValue({
      items: [
        {
          title: "Test Game",
          link: "https://example.com/download",
          pubDate: FIXED_PUB_DATE,
          seeders: 50,
          size: 10_000,
        },
      ],
      errors: [],
      total: 1,
    });

    await checkAutoSearch();

    expect(mockUpdateGameSearchResultsAvailable).toHaveBeenCalledWith(game.id, true);
  });

  it("should mark search results available when multiple main results found with notifyMultipleDownloads", async () => {
    const game = { ...baseGame, status: "wanted" as const, releaseStatus: "released" as const };
    const settings = {
      ...baseSettings,
      autoDownloadEnabled: false,
      notifyMultipleDownloads: true,
    };

    mockGetWantedGamesGroupedByUser.mockResolvedValue(new Map([[userId, [game]]]));
    mockGetUserSettings.mockResolvedValue(settings);
    mockSearchAllIndexers.mockResolvedValue({
      items: [
        {
          title: "Test Game",
          link: "https://example.com/1",
          pubDate: FIXED_PUB_DATE,
          seeders: 50,
          size: 10_000,
        },
        {
          title: "Test Game v2",
          link: "https://example.com/2",
          pubDate: FIXED_PUB_DATE,
          seeders: 30,
          size: 8_000,
        },
      ],
      errors: [],
      total: 2,
    });

    await checkAutoSearch();

    expect(mockUpdateGameSearchResultsAvailable).toHaveBeenCalledWith(game.id, true);
  });

  describe("Preferred Release Groups Filtering", () => {
    const SKIDROW_ITEM = {
      title: "Test Game SKIDROW",
      link: "https://example.com/skidrow",
      pubDate: FIXED_PUB_DATE,
      seeders: 50,
      size: 10_000,
      group: "SKIDROW",
    };
    const CODEX_ITEM = {
      title: "Test Game CODEX",
      link: "https://example.com/codex",
      pubDate: FIXED_PUB_DATE,
      seeders: 80,
      size: 10_000,
      group: "CODEX",
    };
    const TWO_MAIN_ITEMS = { items: [CODEX_ITEM, SKIDROW_ITEM], errors: [], total: 2 };

    let wantedGame: Game;
    beforeEach(() => {
      wantedGame = { ...baseGame, status: "wanted" as const, releaseStatus: "released" as const };
      mockGetWantedGamesGroupedByUser.mockResolvedValue(new Map([[userId, [wantedGame]]]));
    });

    it("should filter to preferred group when matching items exist (multiple→single triggers availability)", async () => {
      const settings = {
        ...baseSettings,
        preferredReleaseGroups: '["SKIDROW"]',
        autoDownloadEnabled: false,
        notifyMultipleDownloads: false,
      };

      mockGetUserSettings.mockResolvedValue(settings);
      // Two main items (no update keywords), only SKIDROW matches preferred group
      mockSearchAllIndexers.mockResolvedValue(TWO_MAIN_ITEMS);

      await checkAutoSearch();

      // After filtering to 1 SKIDROW item, single-result path fires
      expect(mockAddNotification).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Game Available" })
      );
      expect(mockUpdateGameSearchResultsAvailable).toHaveBeenCalledWith(wantedGame.id, true);
    });

    it("should fall back to all items when no items match preferred groups", async () => {
      const settings = {
        ...baseSettings,
        preferredReleaseGroups: '["PLAZA"]',
        autoDownloadEnabled: false,
        notifyMultipleDownloads: true,
      };

      mockGetUserSettings.mockResolvedValue(settings);
      // Two items, neither matches PLAZA → fallback to both
      mockSearchAllIndexers.mockResolvedValue(TWO_MAIN_ITEMS);

      await checkAutoSearch();

      // Fallback: 2 items used, notifyMultipleDownloads → "Multiple Results Found"
      expect(mockAddNotification).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Multiple Results Found" })
      );
    });

    it("should not filter when preferredReleaseGroups is an empty array", async () => {
      const settings = {
        ...baseSettings,
        preferredReleaseGroups: "[]",
        autoDownloadEnabled: false,
        notifyMultipleDownloads: true,
      };

      mockGetUserSettings.mockResolvedValue(settings);
      mockSearchAllIndexers.mockResolvedValue(TWO_MAIN_ITEMS);

      await checkAutoSearch();

      // Empty array → no filter → 2 items → "Multiple Results Found"
      expect(mockAddNotification).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Multiple Results Found" })
      );
    });

    it("should handle malformed JSON in preferredReleaseGroups gracefully", async () => {
      const settings = {
        ...baseSettings,
        preferredReleaseGroups: "not-valid-json",
        autoDownloadEnabled: false,
      };

      mockGetUserSettings.mockResolvedValue(settings);
      mockSearchAllIndexers.mockResolvedValue({ items: [SKIDROW_ITEM], errors: [], total: 1 });

      // Should not throw; should still process the game normally
      await expect(checkAutoSearch()).resolves.not.toThrow();
      expect(mockAddNotification).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Game Available" })
      );
    });

    it("should treat non-array JSON as no filter (use all items)", async () => {
      const settings = {
        ...baseSettings,
        preferredReleaseGroups: '"SKIDROW"', // valid JSON but a string, not array
        autoDownloadEnabled: false,
        notifyMultipleDownloads: true,
      };

      mockGetUserSettings.mockResolvedValue(settings);
      mockSearchAllIndexers.mockResolvedValue(TWO_MAIN_ITEMS);

      await checkAutoSearch();

      // Non-array → preferredGroups stays [] → no filter → 2 items
      expect(mockAddNotification).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Multiple Results Found" })
      );
    });

    it("should include group name in Download Started notification", async () => {
      const settings = { ...baseSettings, autoDownloadEnabled: true };
      const mockDownloader = { id: "dl-1", name: "qBittorrent", type: "torrent", enabled: true };

      mockGetUserSettings.mockResolvedValue(settings);
      mockGetEnabledDownloaders.mockResolvedValue([mockDownloader]);
      mockAddDownloadWithFallback.mockResolvedValue({
        success: true,
        id: "hash-abc",
        downloaderId: "dl-1",
      });
      mockSearchAllIndexers.mockResolvedValue({
        items: [{ ...SKIDROW_ITEM, downloadType: "torrent" }],
        errors: [],
        total: 1,
      });

      await checkAutoSearch();

      expect(mockAddNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Download Started",
          message: expect.stringContaining("[SKIDROW]"),
        })
      );
    });

    it("should not include group suffix in Download Started notification when item has no group", async () => {
      const settings = { ...baseSettings, autoDownloadEnabled: true };
      const mockDownloader = { id: "dl-1", name: "qBittorrent", type: "torrent", enabled: true };

      mockGetUserSettings.mockResolvedValue(settings);
      mockGetEnabledDownloaders.mockResolvedValue([mockDownloader]);
      mockAddDownloadWithFallback.mockResolvedValue({
        success: true,
        id: "hash-abc",
        downloaderId: "dl-1",
      });
      mockSearchAllIndexers.mockResolvedValue({
        items: [
          {
            title: "Test Game",
            link: "https://example.com/dl",
            pubDate: FIXED_PUB_DATE,
            seeders: 50,
            size: 10_000,
            downloadType: "torrent",
            // no group field
          },
        ],
        errors: [],
        total: 1,
      });

      await checkAutoSearch();

      expect(mockAddNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Download Started",
          message: expect.not.stringContaining("["),
        })
      );
    });

    it("should filter owned-game update items by preferred groups", async () => {
      const ownedGame = {
        ...baseGame,
        status: "owned" as const,
        releaseStatus: "released" as const,
      };
      const settings = {
        ...baseSettings,
        preferredReleaseGroups: '["SKIDROW"]',
        notifyUpdates: true,
        autoDownloadEnabled: false,
      };

      mockGetWantedGamesGroupedByUser.mockResolvedValue(new Map([[userId, []]]));
      mockGetUserGames.mockResolvedValue([ownedGame]);
      mockGetUserSettings.mockResolvedValue(settings);
      // Return update items (title contains "Update") — only SKIDROW matches
      mockSearchAllIndexers.mockResolvedValue({
        items: [
          {
            title: "Test Game Update v1.1 CODEX",
            link: "https://example.com/update-codex",
            pubDate: FIXED_PUB_DATE,
            seeders: 80,
            size: 2_000,
            group: "CODEX",
          },
          {
            title: "Test Game Update v1.1 SKIDROW",
            link: "https://example.com/update-skidrow",
            pubDate: FIXED_PUB_DATE,
            seeders: 50,
            size: 2_000,
            group: "SKIDROW",
          },
        ],
        errors: [],
        total: 2,
      });

      await checkAutoSearch();

      expect(mockAddNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Game Updates Available",
          // Filtered to 1 SKIDROW update
          message: expect.stringContaining("1 update"),
        })
      );
    });
  });
});
