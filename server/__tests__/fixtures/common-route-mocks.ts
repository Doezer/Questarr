import { vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import type { User } from "../../../shared/schema.js";

/**
 * Shared mock factories for tests that boot the full app via `registerRoutes()`
 * (server/routes.ts), which requires every module it imports to be mocked.
 *
 * IMPORTANT: `vi.mock(...)` calls themselves must stay as literal top-level statements in
 * each test file — Vitest's hoisting/interception is per-file static analysis, so a
 * `vi.mock` executed indirectly through an imported helper does not reliably intercept the
 * host file's own static imports. Import the factories below and call them from each test
 * file's own `vi.mock(...)` calls; don't move the `vi.mock(...)` calls here.
 */

export const mockConfig = {
  server: {
    isProduction: false,
    allowedOrigins: [] as string[],
  },
  igdb: {
    isConfigured: true,
    clientId: "test-id",
    clientSecret: "test-secret",
  },
  nexusmods: {
    apiKey: undefined as string | undefined,
  },
  auth: {
    jwtSecret: "test-secret",
  },
  database: {
    url: "test.db",
  },
  ssl: {
    enabled: false,
    port: 5000,
    certPath: "",
    keyPath: "",
    redirectHttp: false,
  },
};

export function createStorageMock() {
  return {
    getUserGames: vi.fn().mockResolvedValue([]),
    getUserGamesByStatus: vi.fn().mockResolvedValue([]),
    searchUserGames: vi.fn().mockResolvedValue([]),
    addGame: vi.fn(),
    removeGame: vi.fn(),
    getUser: vi.fn(),
    getUserByUsername: vi.fn(),
    countUsers: vi.fn().mockResolvedValue(1),
    registerSetupUser: vi.fn(),
    setSystemConfig: vi.fn(),
    getSystemConfig: vi.fn(),
    assignOrphanGamesToUser: vi.fn(),
    getUserSettings: vi.fn().mockResolvedValue({}),
    createUserSettings: vi.fn().mockResolvedValue({}),
    updateUserSettings: vi.fn().mockResolvedValue({}),
    updateGameStatus: vi.fn(),
    updateGameHidden: vi.fn(),
    updateGameUserRating: vi.fn(),
    updateGameSearchResultsAvailable: vi.fn().mockResolvedValue(undefined),
    updateUserPassword: vi.fn(),
    updateGamesBatch: vi.fn(),
    getAllGames: vi.fn().mockResolvedValue([]),
    getAllIndexers: vi.fn().mockResolvedValue([]),
    getEnabledIndexers: vi.fn().mockResolvedValue([]),
    getIndexer: vi.fn(),
    addIndexer: vi.fn(),
    updateIndexer: vi.fn(),
    removeIndexer: vi.fn(),
    getAllDownloaders: vi.fn().mockResolvedValue([]),
    getEnabledDownloaders: vi.fn().mockResolvedValue([]),
    getDownloader: vi.fn(),
    addDownloader: vi.fn(),
    updateDownloader: vi.fn(),
    removeDownloader: vi.fn(),
    getNotifications: vi.fn().mockResolvedValue([]),
    getUnreadNotificationsCount: vi.fn().mockResolvedValue(0),
    addNotification: vi.fn(),
    markNotificationAsRead: vi.fn(),
    markAllNotificationsAsRead: vi.fn(),
    deleteReadNotifications: vi.fn().mockResolvedValue(undefined),
    syncIndexers: vi.fn().mockResolvedValue({ added: 0, updated: 0 }),
    addGameDownload: vi.fn(),
    getDownloadsByGameId: vi.fn().mockResolvedValue([]),
    getDownloadSummaryByGame: vi.fn().mockResolvedValue({}),
    getTrackedDownloadKeys: vi.fn().mockResolvedValue(new Set()),
    getTrackedDownloadGameStatuses: vi.fn().mockResolvedValue(new Map()),
    getGameByIgdbId: vi.fn(),
    createImportTask: vi.fn(),
    startImportTask: vi.fn(),
    updateImportTask: vi.fn(),
    addImportTaskItemsBatch: vi.fn(),
    getAllRssFeeds: vi.fn().mockResolvedValue([]),
    addRssFeed: vi.fn(),
    updateRssFeed: vi.fn(),
    removeRssFeed: vi.fn(),
    getAllRssFeedItems: vi.fn().mockResolvedValue([]),
    updateUserSteamId: vi.fn(),
    getGame: vi.fn(),
    addReleaseBlacklist: vi.fn(),
    getReleaseBlacklist: vi.fn().mockResolvedValue([]),
    getAllReleaseBlacklists: vi.fn().mockResolvedValue([]),
    removeReleaseBlacklist: vi.fn(),
    getReleaseBlacklistSet: vi.fn().mockResolvedValue(new Set()),
  };
}

export function createIgdbMock() {
  return {
    searchGames: vi.fn().mockResolvedValue([]),
    formatGameData: vi.fn((game) => game),
    getPopularGames: vi.fn().mockResolvedValue([]),
    getRecentReleases: vi.fn().mockResolvedValue([]),
    getUpcomingReleases: vi.fn().mockResolvedValue([]),
    getRecommendations: vi.fn().mockResolvedValue([]),
    getGamesByGenre: vi.fn().mockResolvedValue([]),
    getGamesByPlatform: vi.fn().mockResolvedValue([]),
    getGenres: vi.fn().mockResolvedValue([]),
    getPlatforms: vi.fn().mockResolvedValue([]),
    getGameById: vi.fn(),
    getGamesByIds: vi.fn().mockResolvedValue([]),
    batchSearchGames: vi.fn().mockResolvedValue(new Map()),
  };
}

export async function createAuthMock() {
  const actual = await vi.importActual<typeof import("../../auth.js")>("../../auth.js");
  return {
    ...actual,
    authenticateToken: (req: Request, res: Response, next: NextFunction) => {
      (req as Request).user = { id: "user-1", username: "testuser" } as unknown as User;
      next();
    },
    generateToken: vi.fn().mockResolvedValue("mock-token"),
    comparePassword: vi.fn().mockResolvedValue(true),
    hashPassword: vi.fn().mockResolvedValue("hashed-password"),
  };
}

export function createDbMock() {
  return {
    select: vi.fn(),
    from: vi.fn(),
    where: vi.fn(),
    get: vi.fn(),
  };
}

export function createLoggerMocks() {
  return {
    routesLogger: {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn().mockReturnThis(),
    },
    logger: {
      info: vi.fn(),
      error: vi.fn(),
      child: vi.fn().mockReturnThis(),
    },
    expressLogger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn().mockReturnThis(),
    },
    downloadersLogger: {
      info: vi.fn(),
      error: vi.fn(),
      child: vi.fn().mockReturnThis(),
    },
  };
}

export function createRssMock() {
  return {
    start: vi.fn(),
    stop: vi.fn(),
    refreshFeed: vi.fn().mockResolvedValue(undefined),
    refreshFeeds: vi.fn().mockResolvedValue(undefined),
  };
}

export function createTorznabMock() {
  return {
    testConnection: vi.fn().mockResolvedValue({ success: true }),
    searchGames: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    getCategories: vi.fn().mockResolvedValue([]),
  };
}

export function createNewznabMock() {
  return {
    testConnection: vi.fn().mockResolvedValue({ success: true, message: "ok" }),
    search: vi.fn().mockResolvedValue([]),
    getCategories: vi.fn().mockResolvedValue([]),
  };
}

export function createProwlarrMock() {
  return {
    getIndexers: vi.fn().mockResolvedValue([]),
  };
}

export function createXrelMock() {
  return {
    xrelClient: {
      getLatestGames: vi.fn().mockResolvedValue({ list: [], total: 0 }),
      searchReleases: vi.fn().mockResolvedValue([]),
    },
    DEFAULT_XREL_BASE: "https://api.xrel.to",
    ALLOWED_XREL_DOMAINS: ["api.xrel.to", "xrel-api.nfos.to"],
  };
}

export async function createAppriseMock() {
  const actual = await vi.importActual<typeof import("../../apprise.js")>("../../apprise.js");
  return {
    ...actual,
    appriseClient: {
      configure: vi.fn(),
      getMode: vi.fn().mockReturnValue("api"),
      isConfigured: vi.fn().mockReturnValue(true),
      send: vi.fn().mockResolvedValue(undefined),
      test: vi.fn().mockResolvedValue({ success: true }),
    },
  };
}

export function createDownloaderManagerMock() {
  return {
    initialize: vi.fn(),
    testDownloader: vi.fn().mockResolvedValue({ success: true }),
    getAllDownloads: vi.fn().mockResolvedValue([]),
    getDownloadStatus: vi.fn(),
    getDownloadDetails: vi.fn(),
    addDownload: vi.fn().mockResolvedValue({ success: true }),
    addDownloadWithFallback: vi
      .fn()
      .mockResolvedValue({ success: true, id: "dl-1", downloaderId: "d-1" }),
    pauseDownload: vi.fn().mockResolvedValue({ success: true }),
    resumeDownload: vi.fn().mockResolvedValue({ success: true }),
    removeDownload: vi.fn().mockResolvedValue({ success: true }),
    getFreeSpace: vi.fn().mockResolvedValue(1000000000),
  };
}

export function createSteamRoutesMock() {
  return (_req: unknown, _res: unknown, next: () => void) => next();
}

export function createSearchMock() {
  return {
    searchAllIndexers: vi.fn().mockResolvedValue({ items: [], total: 0, errors: [] }),
    filterBlacklistedReleases: (items: { title: string }[], blacklisted: Set<string>) =>
      blacklisted.size > 0 ? items.filter((item) => !blacklisted.has(item.title)) : items,
  };
}

export function createConfigLoaderMock() {
  return {
    getSslConfig: vi.fn().mockReturnValue({
      enabled: false,
      port: 5000,
      certPath: "",
      keyPath: "",
      redirectHttp: false,
    }),
    saveConfig: vi.fn(),
    getConfigDir: vi.fn().mockReturnValue("/tmp/config"),
  };
}

export function createSocketMock() {
  return {
    notifyUser: vi.fn(),
  };
}
