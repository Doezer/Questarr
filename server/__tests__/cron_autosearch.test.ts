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

vi.mock("../storage.js", () => ({
  storage: {
    getWantedGamesGroupedByUser: mockGetWantedGamesGroupedByUser,
    getUserGames: mockGetUserGames,
    getUserSettings: mockGetUserSettings,
    updateUserSettings: mockUpdateUserSettings,
    addNotification: mockAddNotification,
    // Other methods that might be called (though ideally we isolate the test enough)
    getEnabledDownloaders: vi.fn().mockResolvedValue([]),
  },
}));

// Mock search
const mockSearchAllIndexers = vi.fn();
vi.mock("../search.js", () => ({
  searchAllIndexers: mockSearchAllIndexers,
}));

// Mock socket
vi.mock("../socket.js", () => ({
  notifyUser: vi.fn(),
}));

// Mock downloaders
vi.mock("../downloaders.js", () => ({
  DownloaderManager: {
    addDownloadWithFallback: vi.fn(),
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
  });

  afterEach(() => {
    vi.useRealTimers();
  });

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
    mockSearchAllIndexers.mockResolvedValue({
      items: [
        {
          title: "Test Game Update v1.1",
          link: "https://example.com/update",
          pubDate: FIXED_PUB_DATE,
          seeders: 100,
          size: 1024,
        },
      ],
      errors: [],
      total: 1,
    });

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
    mockSearchAllIndexers.mockResolvedValue({
      items: [
        {
          title: "Test Game Update v1.1",
          link: "https://example.com/update",
          pubDate: FIXED_PUB_DATE,
          seeders: 100,
          size: 1024,
        },
      ],
      errors: [],
      total: 1,
    });

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
});
