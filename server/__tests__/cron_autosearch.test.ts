import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Game, UserSettings } from "@shared/schema";

// --- Mocks ---
// Mock logger to avoid noise and missing exports
vi.mock("../logger.js", () => ({
  logger: { child: vi.fn().mockReturnThis() },
  igdbLogger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  searchLogger: {
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
  torznabLogger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  routesLogger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  expressLogger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  downloadersLogger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock storage
const mockGetWantedGamesGroupedByUser = vi.fn();
const mockGetUserSettings = vi.fn();
const mockUpdateUserSettings = vi.fn();
const mockAddNotification = vi.fn();

vi.mock("../storage.js", () => ({
  storage: {
    getWantedGamesGroupedByUser: mockGetWantedGamesGroupedByUser,
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

  const baseGame: Game = {
    id: "game-1",
    userId: userId,
    igdbId: 1001,
    title: "Test Game",
    status: "wanted",
    releaseStatus: "released",
    hidden: false,
    addedAt: new Date(),
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
    updatedAt: new Date(),
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock setup:
    // - 1 user with 1 wanted game (released)
    // - User has auto search enabled
    mockGetWantedGamesGroupedByUser.mockResolvedValue(new Map([[userId, [baseGame]]]));
    mockGetUserSettings.mockResolvedValue(baseSettings);
    mockSearchAllIndexers.mockResolvedValue({ items: [], errors: [], total: 0 });
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
});
