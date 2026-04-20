import {
  type User,
  type InsertUser,
  type Game,
  type InsertGame,
  type UpdateGameStatus,
  type Indexer,
  type InsertIndexer,
  type Downloader,
  type InsertDownloader,
  type GameDownload,
  type InsertGameDownload,
  type DownloadSummary,
  type Notification,
  type InsertNotification,
  type UserSettings,
  type InsertUserSettings,
  type UpdateUserSettings,
  type XrelNotifiedRelease,
  type InsertXrelNotifiedRelease,
  type RssFeed,
  type InsertRssFeed,
  type RssFeedItem,
  type InsertRssFeedItem,
  type ReleaseBlacklist,
  type InsertReleaseBlacklist,
  users,
  games,
  indexers,
  downloaders,
  notifications,
  gameDownloads,
  userSettings,
  systemConfig,
  xrelNotifiedReleases,
  rssFeeds,
  rssFeedItems,
  pathMappings,
  platformMappings,
  type PathMapping,
  type InsertPathMapping,
  type PlatformMapping,
  type InsertPlatformMapping,
  type ImportConfig,
  type RomMConfig,
  type RomMConfigInput,
  importConfigSchema,
  rommConfigSchema,
  ROMM_MULTI_FILE_PLACEMENT,
  releaseBlacklist,
} from "../shared/schema.js";
import { randomUUID } from "crypto";
import { db } from "./db.js";
import { eq, like, or, sql, desc, and, not, inArray, type SQL } from "drizzle-orm";
import { categorizeDownload } from "../shared/download-categorizer.js";

const isUpdateDownload = (title: string): boolean =>
  categorizeDownload(title).category === "update";

const STATUS_PRIORITY: Record<string, number> = {
  failed: 4,
  downloading: 3,
  paused: 2,
  completed: 1,
};

function resolveTopStatus(
  a: DownloadSummary["topStatus"],
  b: DownloadSummary["topStatus"]
): DownloadSummary["topStatus"] {
  return (STATUS_PRIORITY[a] ?? 0) >= (STATUS_PRIORITY[b] ?? 0) ? a : b;
}

function normalizeSlugArray(value: unknown): string[] | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!Array.isArray(value)) return undefined;
  return value.map((entry) => String(entry ?? "").trim()).filter((entry) => entry.length > 0);
}

function buildImportConfigFromSettings(
  settings?: Pick<
    UserSettings,
    | "enablePostProcessing"
    | "autoUnpack"
    | "renamePattern"
    | "overwriteExisting"
    | "transferMode"
    | "importPlatformIds"
    | "ignoredExtensions"
    | "minFileSize"
    | "libraryRoot"
  >
): ImportConfig {
  const parsed = importConfigSchema.safeParse({
    enablePostProcessing: settings?.enablePostProcessing ?? false,
    autoUnpack: settings?.autoUnpack ?? false,
    renamePattern: settings?.renamePattern ?? "{Title} ({Region})",
    overwriteExisting: settings?.overwriteExisting ?? false,
    transferMode: settings?.transferMode ?? "hardlink",
    importPlatformIds: settings?.importPlatformIds ?? [],
    ignoredExtensions: settings?.ignoredExtensions ?? [],
    minFileSize: settings?.minFileSize ?? 0,
    libraryRoot: settings?.libraryRoot ?? "/data",
  });

  if (parsed.success) return parsed.data;

  return {
    enablePostProcessing: settings?.enablePostProcessing ?? false,
    autoUnpack: settings?.autoUnpack ?? false,
    renamePattern: settings?.renamePattern ?? "{Title} ({Region})",
    overwriteExisting: settings?.overwriteExisting ?? false,
    transferMode: "hardlink",
    importPlatformIds: settings?.importPlatformIds ?? [],
    ignoredExtensions: settings?.ignoredExtensions ?? [],
    minFileSize: settings?.minFileSize ?? 0,
    libraryRoot: settings?.libraryRoot ?? "/data",
  };
}

function buildRomMConfigFromSettings(
  settings?: Pick<
    UserSettings,
    | "rommEnabled"
    | "rommLibraryRoot"
    | "rommPlatformRoutingMode"
    | "rommPlatformBindings"
    | "rommMoveMode"
    | "rommConflictPolicy"
    | "rommFolderNamingTemplate"
    | "rommSingleFilePlacement"
    | "rommIncludeRegionLanguageTags"
    | "rommAllowedSlugs"
    | "rommBindingMissingBehavior"
  >
): RomMConfig {
  const candidate: RomMConfigInput = {
    enabled: Boolean(settings?.rommEnabled),
    libraryRoot: settings?.rommLibraryRoot ?? "/data",
    platformRoutingMode:
      (settings?.rommPlatformRoutingMode as RomMConfigInput["platformRoutingMode"]) ??
      "slug-subfolder",
    platformBindings: settings?.rommPlatformBindings ?? {},
    moveMode: (settings?.rommMoveMode as RomMConfigInput["moveMode"]) ?? "move",
    conflictPolicy: (settings?.rommConflictPolicy as RomMConfigInput["conflictPolicy"]) ?? "rename",
    folderNamingTemplate: settings?.rommFolderNamingTemplate ?? "{title}",
    singleFilePlacement:
      (settings?.rommSingleFilePlacement as RomMConfigInput["singleFilePlacement"]) ?? "root",
    multiFilePlacement: ROMM_MULTI_FILE_PLACEMENT,
    includeRegionLanguageTags: settings?.rommIncludeRegionLanguageTags ?? false,
    allowedSlugs: settings?.rommAllowedSlugs ?? undefined,
    bindingMissingBehavior:
      (settings?.rommBindingMissingBehavior as RomMConfigInput["bindingMissingBehavior"]) ??
      "fallback",
  };

  const parsed = rommConfigSchema.safeParse(candidate);
  if (parsed.success) return parsed.data;

  return {
    enabled: false,
    libraryRoot: settings?.rommLibraryRoot ?? "/data",
    platformRoutingMode: "slug-subfolder",
    platformBindings: settings?.rommPlatformBindings ?? {},
    moveMode: "move",
    conflictPolicy: "rename",
    folderNamingTemplate: settings?.rommFolderNamingTemplate ?? "{title}",
    singleFilePlacement: "root",
    multiFilePlacement: ROMM_MULTI_FILE_PLACEMENT,
    includeRegionLanguageTags: settings?.rommIncludeRegionLanguageTags ?? false,
    allowedSlugs: settings?.rommAllowedSlugs ?? undefined,
    bindingMissingBehavior: "fallback",
  };
}

export interface IStorage {
  // System Config methods
  getSystemConfig(key: string): Promise<string | undefined>;
  setSystemConfig(key: string, value: string): Promise<void>;

  // User methods
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUserPassword(userId: string, passwordHash: string): Promise<User | undefined>;
  registerSetupUser(user: InsertUser): Promise<User>;
  updateUserSteamId(userId: string, steamId: string): Promise<User | undefined>;
  getAllUsers(): Promise<User[]>;
  countUsers(): Promise<number>;

  // Game methods
  getGame(id: string): Promise<Game | undefined>;
  getGameByIgdbId(igdbId: number): Promise<Game | undefined>;
  getUserGames(userId: string, includeHidden?: boolean, statuses?: string[]): Promise<Game[]>;
  getAllGames(): Promise<Game[]>; // Keep for admin/debug or global search? Or maybe deprecated.
  getUserGamesByStatus(userId: string, status: string, includeHidden?: boolean): Promise<Game[]>;
  searchUserGames(userId: string, query: string, includeHidden?: boolean): Promise<Game[]>;
  addGame(game: InsertGame): Promise<Game>;
  updateGameStatus(id: string, statusUpdate: UpdateGameStatus): Promise<Game | undefined>;
  updateGameHidden(id: string, hidden: boolean): Promise<Game | undefined>;
  updateGameUserRating(
    id: string,
    userId: string,
    userRating: number | null
  ): Promise<Game | undefined>;
  updateGameSearchResultsAvailable(gameId: string, available: boolean): Promise<void>;
  updateGame(id: string, updates: Partial<Game>): Promise<Game | undefined>;
  updateGamesBatch(updates: { id: string; data: Partial<Game> }[]): Promise<void>;
  removeGame(id: string): Promise<boolean>;
  assignOrphanGamesToUser(userId: string): Promise<number>;

  // Indexer methods
  getAllIndexers(): Promise<Indexer[]>;
  getIndexer(id: string): Promise<Indexer | undefined>;
  getEnabledIndexers(): Promise<Indexer[]>;
  addIndexer(indexer: InsertIndexer): Promise<Indexer>;
  updateIndexer(id: string, updates: Partial<InsertIndexer>): Promise<Indexer | undefined>;
  removeIndexer(id: string): Promise<boolean>;
  syncIndexers(
    indexers: Partial<Indexer>[]
  ): Promise<{ added: number; updated: number; failed: number; errors: string[] }>;

  // Downloader methods
  getAllDownloaders(): Promise<Downloader[]>;
  getDownloader(id: string): Promise<Downloader | undefined>;
  getEnabledDownloaders(): Promise<Downloader[]>;
  addDownloader(downloader: InsertDownloader): Promise<Downloader>;
  updateDownloader(id: string, updates: Partial<InsertDownloader>): Promise<Downloader | undefined>;
  removeDownloader(id: string): Promise<boolean>;

  // GameDownload methods
  getDownloadingGameDownloads(): Promise<GameDownload[]>;
  getPendingImportReviews(): Promise<GameDownload[]>;
  getGameDownload(id: string, userId?: string): Promise<GameDownload | undefined>;
  getDownloadsByGameId(
    gameId: string
  ): Promise<(GameDownload & { downloaderName: string | null })[]>;
  updateGameDownloadStatus(id: string, status: string): Promise<void>;
  addGameDownload(gameDownload: InsertGameDownload): Promise<GameDownload>;
  removeGameDownload(id: string, gameId: string): Promise<boolean>;
  getDownloadSummaryByGame(userId: string): Promise<Record<string, DownloadSummary>>;
  getTrackedDownloadKeys(): Promise<Set<string>>;

  // Notification methods
  getNotifications(userId: string, limit?: number): Promise<Notification[]>;
  getUnreadNotificationsCount(userId: string): Promise<number>;
  addNotification(notification: InsertNotification): Promise<Notification>;
  addNotificationsBatch(notifications: InsertNotification[]): Promise<Notification[]>;
  markNotificationAsRead(id: string): Promise<Notification | undefined>;
  markAllNotificationsAsRead(userId: string): Promise<void>;
  deleteReadNotifications(userId: string): Promise<void>;
  // RSS Feed methods
  getAllRssFeeds(): Promise<RssFeed[]>;
  getRssFeed(id: string): Promise<RssFeed | undefined>;
  addRssFeed(feed: InsertRssFeed): Promise<RssFeed>;
  updateRssFeed(id: string, updates: Partial<RssFeed>): Promise<RssFeed | undefined>;
  removeRssFeed(id: string): Promise<boolean>;
  getRssFeedItem(id: string): Promise<RssFeedItem | undefined>;
  getRssFeedItems(feedId: string): Promise<RssFeedItem[]>;
  getAllRssFeedItems(limit?: number): Promise<RssFeedItem[]>;
  addRssFeedItem(item: InsertRssFeedItem): Promise<RssFeedItem>;
  getRssFeedItemByGuid(guid: string): Promise<RssFeedItem | undefined>;
  updateRssFeedItem(
    id: string,
    updates: Partial<InsertRssFeedItem>
  ): Promise<RssFeedItem | undefined>;

  // UserSettings methods
  getUserSettings(userId: string): Promise<UserSettings | undefined>;
  createUserSettings(settings: InsertUserSettings): Promise<UserSettings>;
  updateUserSettings(
    userId: string,
    updates: UpdateUserSettings
  ): Promise<UserSettings | undefined>;

  // xREL notified releases (for notifications + "on xREL" indicator)
  addXrelNotifiedRelease(insert: InsertXrelNotifiedRelease): Promise<XrelNotifiedRelease>;
  hasXrelNotifiedRelease(gameId: string, xrelReleaseId: string): Promise<boolean>;
  getGameIdsWithXrelReleases(): Promise<string[]>;
  getWantedGamesGroupedByUser(): Promise<Map<string, Game[]>>;

  // Path Mapping methods
  getPathMappings(): Promise<PathMapping[]>;
  getPathMapping(id: string): Promise<PathMapping | undefined>;
  addPathMapping(mapping: InsertPathMapping): Promise<PathMapping>;
  updatePathMapping(
    id: string,
    updates: Partial<InsertPathMapping>
  ): Promise<PathMapping | undefined>;
  removePathMapping(id: string): Promise<boolean>;

  // Platform Mapping methods
  getPlatformMappings(): Promise<PlatformMapping[]>;
  getPlatformMapping(igdbPlatformId: number): Promise<PlatformMapping | undefined>;
  addPlatformMapping(mapping: InsertPlatformMapping): Promise<PlatformMapping>;
  seedPlatformMappingsIfEmpty(
    mappings: InsertPlatformMapping[]
  ): Promise<{ seeded: boolean; count: number }>;
  updatePlatformMapping(
    id: string,
    updates: Partial<InsertPlatformMapping>
  ): Promise<PlatformMapping | undefined>;
  removePlatformMapping(id: string): Promise<boolean>;

  // Config Accessors (Helper methods)
  getImportConfig(userId?: string): Promise<ImportConfig>;
  getRomMConfig(userId?: string): Promise<RomMConfig>;

  // Release blacklist methods
  addReleaseBlacklist(entry: InsertReleaseBlacklist): Promise<ReleaseBlacklist>;
  getReleaseBlacklist(gameId: string): Promise<ReleaseBlacklist[]>;
  getAllReleaseBlacklists(userId: string): Promise<(ReleaseBlacklist & { gameTitle: string })[]>;
  removeReleaseBlacklist(id: string, gameId: string): Promise<boolean>;
  getReleaseBlacklistSet(gameId: string): Promise<Set<string>>;
}

export class MemStorage implements IStorage {
  private users: Map<string, User>;
  private games: Map<string, Game>;
  private indexers: Map<string, Indexer>;
  private downloaders: Map<string, Downloader>;
  private notifications: Map<string, Notification>;
  private gameDownloads: Map<string, GameDownload>;
  private userSettings: Map<string, UserSettings>;
  private systemConfig: Map<string, string>;
  private xrelNotified: Map<string, XrelNotifiedRelease>;
  private rssFeeds: Map<string, RssFeed>;
  private rssFeedItems: Map<string, RssFeedItem>;
  private pathMappings: Map<string, PathMapping>;
  private platformMappings: Map<string, PlatformMapping>;
  private releaseBlacklists: Map<string, ReleaseBlacklist>;

  constructor() {
    this.users = new Map();
    this.games = new Map();
    this.indexers = new Map();
    this.downloaders = new Map();
    this.notifications = new Map();
    this.gameDownloads = new Map();
    this.userSettings = new Map();
    this.systemConfig = new Map();
    this.xrelNotified = new Map();
    this.rssFeeds = new Map();
    this.rssFeedItems = new Map();
    this.pathMappings = new Map();
    this.platformMappings = new Map();
    this.releaseBlacklists = new Map();
  }

  // System Config methods
  async getSystemConfig(key: string): Promise<string | undefined> {
    return this.systemConfig.get(key);
  }

  async setSystemConfig(key: string, value: string): Promise<void> {
    this.systemConfig.set(key, value);
  }

  // User methods
  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find((user) => user.username === username);
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const user: User = { ...insertUser, id, steamId64: null };
    this.users.set(id, user);
    return user;
  }

  async updateUserPassword(userId: string, passwordHash: string): Promise<User | undefined> {
    const user = this.users.get(userId);
    if (!user) return undefined;
    const updatedUser = { ...user, passwordHash };
    this.users.set(userId, updatedUser);
    return updatedUser;
  }

  async updateUserSteamId(userId: string, steamId: string): Promise<User | undefined> {
    const user = this.users.get(userId);
    if (!user) return undefined;
    const updatedUser = { ...user, steamId64: steamId };
    this.users.set(userId, updatedUser);
    return updatedUser;
  }

  async getAllUsers(): Promise<User[]> {
    return Array.from(this.users.values());
  }

  async countUsers(): Promise<number> {
    return this.users.size;
  }

  async registerSetupUser(insertUser: InsertUser): Promise<User> {
    if (this.users.size > 0) {
      throw new Error("Setup already completed");
    }
    const id = randomUUID();
    const user: User = { ...insertUser, id, steamId64: null };
    this.users.set(id, user);
    return user;
  }

  // Game methods
  async getGame(id: string): Promise<Game | undefined> {
    return this.games.get(id);
  }

  async getGameByIgdbId(igdbId: number): Promise<Game | undefined> {
    return Array.from(this.games.values()).find((game) => game.igdbId === igdbId);
  }

  async getUserGames(userId: string, includeHidden = false, statuses?: string[]): Promise<Game[]> {
    return Array.from(this.games.values())
      .filter(
        (game) =>
          game.userId === userId &&
          (includeHidden || !game.hidden) &&
          (!statuses || statuses.includes(game.status))
      )
      .sort((a, b) => new Date(b.addedAt || 0).getTime() - new Date(a.addedAt || 0).getTime());
  }

  async getAllGames(): Promise<Game[]> {
    return Array.from(this.games.values()).sort(
      (a, b) => new Date(b.addedAt || 0).getTime() - new Date(a.addedAt || 0).getTime()
    );
  }

  async getUserGamesByStatus(
    userId: string,
    status: string,
    includeHidden = false
  ): Promise<Game[]> {
    return Array.from(this.games.values())
      .filter(
        (game) =>
          game.userId === userId && game.status === status && (includeHidden || !game.hidden)
      )
      .sort((a, b) => new Date(b.addedAt || 0).getTime() - new Date(a.addedAt || 0).getTime());
  }

  async searchUserGames(userId: string, query: string, includeHidden = false): Promise<Game[]> {
    const lowercaseQuery = query.toLowerCase();
    return Array.from(this.games.values())
      .filter(
        (game) =>
          game.userId === userId &&
          (includeHidden || !game.hidden) &&
          (game.title.toLowerCase().includes(lowercaseQuery) ||
            game.genres?.some((genre) => genre.toLowerCase().includes(lowercaseQuery)) ||
            game.platforms?.some((platform) => platform.toLowerCase().includes(lowercaseQuery)))
      )
      .sort((a, b) => new Date(b.addedAt || 0).getTime() - new Date(a.addedAt || 0).getTime());
  }

  async addGame(insertGame: InsertGame): Promise<Game> {
    const id = randomUUID();
    const game: Game = {
      ...insertGame,
      id,
      userId: insertGame.userId || null,
      status: insertGame.status || "wanted",
      hidden: insertGame.hidden ?? false, // Convert boolean to number or keep as boolean depending on memory usage
      summary: insertGame.summary || null,
      coverUrl: insertGame.coverUrl || null,
      releaseDate: insertGame.releaseDate || null,
      rating: insertGame.rating || null,
      platforms: insertGame.platforms || null,
      genres: insertGame.genres || null,
      publishers: insertGame.publishers || null,
      developers: insertGame.developers || null,
      screenshots: insertGame.screenshots || null,
      igdbId: insertGame.igdbId || null,
      steamAppId: insertGame.steamAppId || null,
      source: insertGame.source ?? null,
      igdbWebsites: insertGame.igdbWebsites || null,
      aggregatedRating: insertGame.aggregatedRating ?? null,
      originalReleaseDate: insertGame.originalReleaseDate || null,
      releaseStatus: insertGame.releaseStatus || "upcoming",
      earlyAccess: insertGame.earlyAccess ?? false,
      searchResultsAvailable: false,
      userRating: null,
      addedAt: new Date(),
      completedAt: null,
    };
    this.games.set(id, game);
    return game;
  }

  async updateGameStatus(id: string, statusUpdate: UpdateGameStatus): Promise<Game | undefined> {
    const game = this.games.get(id);
    if (!game) return undefined;

    const updatedGame: Game = {
      ...game,
      status: statusUpdate.status,
      completedAt: statusUpdate.status === "completed" ? new Date() : null,
    };

    this.games.set(id, updatedGame);
    return updatedGame;
  }

  async updateGameHidden(id: string, hidden: boolean): Promise<Game | undefined> {
    const game = this.games.get(id);
    if (!game) return undefined;

    const updatedGame: Game = {
      ...game,
      hidden: hidden,
    };

    this.games.set(id, updatedGame);
    return updatedGame;
  }

  async updateGameUserRating(
    id: string,
    userId: string,
    userRating: number | null
  ): Promise<Game | undefined> {
    const game = this.games.get(id);
    if (!game || game.userId !== userId) return undefined;

    const updatedGame: Game = { ...game, userRating };
    this.games.set(id, updatedGame);
    return updatedGame;
  }

  async updateGameSearchResultsAvailable(gameId: string, available: boolean): Promise<void> {
    const game = this.games.get(gameId);
    if (game) {
      game.searchResultsAvailable = available;
      this.games.set(gameId, game);
    }
  }

  async updateGame(id: string, updates: Partial<Game>): Promise<Game | undefined> {
    const game = this.games.get(id);
    if (!game) return undefined;

    const updatedGame: Game = {
      ...game,
      ...updates,
    };

    this.games.set(id, updatedGame);
    return updatedGame;
  }

  async updateGamesBatch(updates: { id: string; data: Partial<Game> }[]): Promise<void> {
    for (const update of updates) {
      await this.updateGame(update.id, update.data);
    }
  }

  async removeGame(id: string): Promise<boolean> {
    return this.games.delete(id);
  }

  async assignOrphanGamesToUser(userId: string): Promise<number> {
    let count = 0;
    Array.from(this.games.values()).forEach((game) => {
      if (!game.userId) {
        const updatedGame = { ...game, userId };
        this.games.set(game.id, updatedGame);
        count++;
      }
    });
    return count;
  }

  async getWantedGamesGroupedByUser(): Promise<Map<string, Game[]>> {
    const gamesByUser = new Map<string, Game[]>();
    for (const game of Array.from(this.games.values())) {
      if (game.userId && game.status === "wanted" && !game.hidden) {
        const list = gamesByUser.get(game.userId) || [];
        list.push(game);
        gamesByUser.set(game.userId, list);
      }
    }
    return gamesByUser;
  }

  // Indexer methods
  async getAllIndexers(): Promise<Indexer[]> {
    return Array.from(this.indexers.values()).sort((a, b) => a.priority - b.priority);
  }

  async getIndexer(id: string): Promise<Indexer | undefined> {
    return this.indexers.get(id);
  }

  async getEnabledIndexers(): Promise<Indexer[]> {
    return Array.from(this.indexers.values())
      .filter((indexer) => indexer.enabled)
      .sort((a, b) => a.priority - b.priority);
  }

  async addIndexer(insertIndexer: InsertIndexer): Promise<Indexer> {
    const id = randomUUID();
    const indexer: Indexer = {
      id,
      name: insertIndexer.name,
      url: insertIndexer.url,
      apiKey: insertIndexer.apiKey,
      protocol: insertIndexer.protocol ?? "torznab",
      enabled: insertIndexer.enabled ?? true,
      priority: insertIndexer.priority ?? 1,
      categories: insertIndexer.categories ?? [],
      rssEnabled: insertIndexer.rssEnabled ?? true,
      autoSearchEnabled: insertIndexer.autoSearchEnabled ?? true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.indexers.set(id, indexer);
    return indexer;
  }

  async updateIndexer(id: string, updates: Partial<InsertIndexer>): Promise<Indexer | undefined> {
    const indexer = this.indexers.get(id);
    if (!indexer) return undefined;

    const updatedIndexer: Indexer = {
      ...indexer,
      ...updates,
      updatedAt: new Date(),
    };

    this.indexers.set(id, updatedIndexer);
    return updatedIndexer;
  }

  async removeIndexer(id: string): Promise<boolean> {
    return this.indexers.delete(id);
  }

  async syncIndexers(
    indexersToSync: Partial<Indexer>[]
  ): Promise<{ added: number; updated: number; failed: number; errors: string[] }> {
    const results = {
      added: 0,
      updated: 0,
      failed: 0,
      errors: [] as string[],
    };

    for (const idx of indexersToSync) {
      try {
        if (!idx.name || !idx.url || !idx.apiKey) {
          results.failed++;
          results.errors.push(`Skipping ${idx.name || "unknown"} - missing required fields`);
          continue;
        }

        const existing = Array.from(this.indexers.values()).find((e) => e.url === idx.url);

        if (existing) {
          // Explicitly update only allowed fields
          const updatedIndexer: Indexer = {
            ...existing,
            name: idx.name || existing.name,
            url: idx.url || existing.url,
            apiKey: idx.apiKey || existing.apiKey,
            protocol: idx.protocol || existing.protocol,
            enabled: idx.enabled ?? existing.enabled,
            priority: idx.priority ?? existing.priority,
            categories: idx.categories || existing.categories,
            rssEnabled: idx.rssEnabled ?? existing.rssEnabled,
            autoSearchEnabled: idx.autoSearchEnabled ?? existing.autoSearchEnabled,
            updatedAt: new Date(),
          };
          this.indexers.set(existing.id, updatedIndexer);
          results.updated++;
        } else {
          const id = randomUUID();
          const newIndexer: Indexer = {
            id,
            name: idx.name,
            url: idx.url,
            apiKey: idx.apiKey,
            protocol: idx.protocol ?? "torznab",
            enabled: idx.enabled ?? true,
            priority: idx.priority ?? 1,
            categories: idx.categories ?? [],
            rssEnabled: idx.rssEnabled ?? true,
            autoSearchEnabled: idx.autoSearchEnabled ?? true,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          this.indexers.set(id, newIndexer);
          results.added++;
        }
      } catch (error) {
        results.failed++;
        results.errors.push(
          `Failed to sync ${idx.name}: ${error instanceof Error ? error.message : "Unknown error"}`
        );
      }
    }

    return results;
  }

  // Downloader methods
  async getAllDownloaders(): Promise<Downloader[]> {
    return Array.from(this.downloaders.values()).sort((a, b) => a.priority - b.priority);
  }

  async getDownloader(id: string): Promise<Downloader | undefined> {
    return this.downloaders.get(id);
  }

  async getEnabledDownloaders(): Promise<Downloader[]> {
    return Array.from(this.downloaders.values())
      .filter((downloader) => downloader.enabled)
      .sort((a, b) => a.priority - b.priority);
  }

  async addDownloader(insertDownloader: InsertDownloader): Promise<Downloader> {
    const id = randomUUID();
    const downloader: Downloader = {
      id,
      name: insertDownloader.name,
      type: insertDownloader.type,
      url: insertDownloader.url,
      port: insertDownloader.port ?? null,
      useSsl: insertDownloader.useSsl ?? false,
      urlPath: insertDownloader.urlPath ?? null,
      username: insertDownloader.username ?? null,
      password: insertDownloader.password ?? null,
      enabled: insertDownloader.enabled ?? true,
      priority: insertDownloader.priority ?? 1,
      downloadPath: insertDownloader.downloadPath ?? null,
      category: insertDownloader.category ?? "games",
      label: insertDownloader.label ?? "Questarr",
      addStopped: insertDownloader.addStopped ?? false,
      removeCompleted: insertDownloader.removeCompleted ?? false,
      postImportCategory: insertDownloader.postImportCategory ?? null,
      settings: insertDownloader.settings ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.downloaders.set(id, downloader);
    return downloader;
  }

  async updateDownloader(
    id: string,
    updates: Partial<InsertDownloader>
  ): Promise<Downloader | undefined> {
    const downloader = this.downloaders.get(id);
    if (!downloader) return undefined;

    const updatedDownloader: Downloader = {
      ...downloader,
      ...updates,
      updatedAt: new Date(),
    };

    this.downloaders.set(id, updatedDownloader);
    return updatedDownloader;
  }

  async removeDownloader(id: string): Promise<boolean> {
    return this.downloaders.delete(id);
  }

  // GameDownload methods
  async getDownloadingGameDownloads(): Promise<GameDownload[]> {
    return Array.from(this.gameDownloads.values()).filter(
      (d) => !["completed", "error", "imported", "manual_review_required"].includes(d.status)
    );
  }

  async getPendingImportReviews(): Promise<GameDownload[]> {
    return Array.from(this.gameDownloads.values()).filter(
      (d) => d.status === "manual_review_required"
    );
  }

  async getGameDownload(id: string, userId?: string): Promise<GameDownload | undefined> {
    const download = this.gameDownloads.get(id);
    if (download && userId !== undefined) {
      const game = this.games.get(download.gameId);
      if (!game || game.userId !== userId) return undefined;
    }
    return download;
  }

  async getDownloadsByGameId(
    gameId: string
  ): Promise<(GameDownload & { downloaderName: string | null })[]> {
    return Array.from(this.gameDownloads.values())
      .filter((gd) => gd.gameId === gameId)
      .map((gd) => ({
        ...gd,
        downloaderName: this.downloaders.get(gd.downloaderId)?.name ?? null,
      }));
  }

  async updateGameDownloadStatus(id: string, status: string): Promise<void> {
    const gd = this.gameDownloads.get(id);
    if (gd) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.gameDownloads.set(id, { ...gd, status: status as any });
    }
  }

  async addGameDownload(insertGameDownload: InsertGameDownload): Promise<GameDownload> {
    const id = randomUUID();
    const gameDownload: GameDownload = {
      ...insertGameDownload,
      id,
      status: insertGameDownload.status || "downloading",
      downloadType: insertGameDownload.downloadType || "torrent",
      fileSize: insertGameDownload.fileSize ?? null,
      addedAt: new Date(),
      completedAt: null,
    };
    this.gameDownloads.set(id, gameDownload);
    return gameDownload;
  }

  async removeGameDownload(id: string, gameId: string): Promise<boolean> {
    const gd = this.gameDownloads.get(id);
    if (!gd || gd.gameId !== gameId) return false;
    return this.gameDownloads.delete(id);
  }

  async getTrackedDownloadKeys(): Promise<Set<string>> {
    const keys = new Set<string>();
    for (const gd of Array.from(this.gameDownloads.values())) {
      keys.add(`${gd.downloaderId}:${gd.downloadHash}`);
    }
    return keys;
  }

  async getDownloadSummaryByGame(userId: string): Promise<Record<string, DownloadSummary>> {
    const userGameIds = new Set(
      Array.from(this.games.values())
        .filter((g) => g.userId === userId)
        .map((g) => g.id)
    );
    const result: Record<string, DownloadSummary> = {};
    for (const gd of Array.from(this.gameDownloads.values())) {
      const gameId = gd.gameId;
      if (!userGameIds.has(gameId)) continue;
      const status = gd.status as DownloadSummary["topStatus"];
      const downloadType = (gd.downloadType ?? "torrent") as "torrent" | "usenet";
      const isUpdate = isUpdateDownload(gd.downloadTitle);
      if (!result[gameId]) {
        result[gameId] = {
          topStatus: status,
          count: 1,
          downloadTypes: [downloadType],
          hasUpdateDownload: isUpdate,
        };
      } else {
        result[gameId].topStatus = resolveTopStatus(result[gameId].topStatus, status);
        result[gameId].count += 1;
        if (!result[gameId].downloadTypes.includes(downloadType)) {
          result[gameId].downloadTypes.push(downloadType);
        }
        if (isUpdate) result[gameId].hasUpdateDownload = true;
      }
    }
    return result;
  }

  // Notification methods
  async getNotifications(userId: string, limit: number = 50): Promise<Notification[]> {
    return Array.from(this.notifications.values())
      .filter((n) => n.userId === userId)
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
      .slice(0, limit);
  }

  async getUnreadNotificationsCount(userId: string): Promise<number> {
    return Array.from(this.notifications.values()).filter((n) => n.userId === userId && !n.read)
      .length;
  }

  async addNotification(insertNotification: InsertNotification): Promise<Notification> {
    const id = randomUUID();
    const notification: Notification = {
      id,
      userId: insertNotification.userId ?? null,
      type: insertNotification.type,
      title: insertNotification.title,
      message: insertNotification.message,
      link: insertNotification.link ?? null,
      read: false,
      createdAt: new Date(),
    };
    this.notifications.set(id, notification);
    return notification;
  }

  async addNotificationsBatch(insertNotifications: InsertNotification[]): Promise<Notification[]> {
    const result: Notification[] = [];
    for (const insert of insertNotifications) {
      result.push(await this.addNotification(insert));
    }
    return result;
  }

  async markNotificationAsRead(id: string): Promise<Notification | undefined> {
    const notification = this.notifications.get(id);
    if (!notification) return undefined;

    const updatedNotification: Notification = {
      ...notification,
      read: true,
    };
    this.notifications.set(id, updatedNotification);
    return updatedNotification;
  }

  async markAllNotificationsAsRead(userId: string): Promise<void> {
    Array.from(this.notifications.entries()).forEach(([id, notification]) => {
      if (notification.userId === userId && !notification.read) {
        this.notifications.set(id, { ...notification, read: true });
      }
    });
  }

  async deleteReadNotifications(userId: string): Promise<void> {
    Array.from(this.notifications.entries()).forEach(([id, notification]) => {
      if (notification.userId === userId && notification.read) {
        this.notifications.delete(id);
      }
    });
  }

  // RSS Feed methods
  async getAllRssFeeds(): Promise<RssFeed[]> {
    return Array.from(this.rssFeeds.values());
  }

  async getRssFeed(id: string): Promise<RssFeed | undefined> {
    return this.rssFeeds.get(id);
  }

  async addRssFeed(feed: InsertRssFeed): Promise<RssFeed> {
    const id = randomUUID();
    const newFeed: RssFeed = {
      ...feed,
      id,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastCheck: null,
      status: "ok",
      errorMessage: null,
      type: feed.type || "custom",
      enabled: feed.enabled ?? true,
      mapping: feed.mapping || null,
    };
    this.rssFeeds.set(id, newFeed);
    return newFeed;
  }

  async updateRssFeed(id: string, updates: Partial<RssFeed>): Promise<RssFeed | undefined> {
    const feed = this.rssFeeds.get(id);
    if (!feed) return undefined;
    const updatedFeed = { ...feed, ...updates, updatedAt: new Date() };
    this.rssFeeds.set(id, updatedFeed);
    return updatedFeed;
  }

  async removeRssFeed(id: string): Promise<boolean> {
    return this.rssFeeds.delete(id);
  }

  async getRssFeedItem(id: string): Promise<RssFeedItem | undefined> {
    return this.rssFeedItems.get(id);
  }

  async getRssFeedItems(feedId: string): Promise<RssFeedItem[]> {
    return Array.from(this.rssFeedItems.values())
      .filter((item) => item.feedId === feedId)
      .sort((a, b) => (b.pubDate?.getTime() ?? 0) - (a.pubDate?.getTime() ?? 0));
  }

  async getAllRssFeedItems(limit: number = 100): Promise<RssFeedItem[]> {
    return Array.from(this.rssFeedItems.values())
      .sort((a, b) => (b.pubDate?.getTime() ?? 0) - (a.pubDate?.getTime() ?? 0))
      .slice(0, limit);
  }

  async addRssFeedItem(item: InsertRssFeedItem): Promise<RssFeedItem> {
    const id = randomUUID();
    const newItem: RssFeedItem = {
      ...item,
      id,
      createdAt: new Date(),
      igdbGameId: item.igdbGameId ?? null,
      igdbGameName: item.igdbGameName ?? null,
      coverUrl: item.coverUrl ?? null,
      pubDate: item.pubDate ?? null,
      sourceName: item.sourceName ?? null,
    };
    this.rssFeedItems.set(id, newItem);
    return newItem;
  }

  async getRssFeedItemByGuid(guid: string): Promise<RssFeedItem | undefined> {
    return Array.from(this.rssFeedItems.values()).find((item) => item.guid === guid);
  }

  async updateRssFeedItem(
    id: string,
    updates: Partial<InsertRssFeedItem>
  ): Promise<RssFeedItem | undefined> {
    const item = this.rssFeedItems.get(id);
    if (!item) return undefined;
    const updatedItem = { ...item, ...updates };
    this.rssFeedItems.set(id, updatedItem);
    return updatedItem;
  }

  // UserSettings methods
  async getUserSettings(userId: string): Promise<UserSettings | undefined> {
    return Array.from(this.userSettings.values()).find((settings) => settings.userId === userId);
  }

  async createUserSettings(insertSettings: InsertUserSettings): Promise<UserSettings> {
    const id = randomUUID();
    const normalizedAllowedSlugs = normalizeSlugArray(insertSettings.rommAllowedSlugs);
    const settings: UserSettings = {
      id,
      userId: insertSettings.userId,
      autoSearchEnabled: insertSettings.autoSearchEnabled ?? true,
      autoDownloadEnabled: insertSettings.autoDownloadEnabled ?? false,
      notifyMultipleDownloads: insertSettings.notifyMultipleDownloads ?? true,
      notifyUpdates: insertSettings.notifyUpdates ?? true,
      searchIntervalHours: insertSettings.searchIntervalHours ?? 6,
      igdbRateLimitPerSecond: insertSettings.igdbRateLimitPerSecond ?? 3,
      downloadRules: insertSettings.downloadRules ?? null,
      lastAutoSearch: insertSettings.lastAutoSearch ?? null,
      xrelSceneReleases: insertSettings.xrelSceneReleases ?? true,
      xrelP2pReleases: insertSettings.xrelP2pReleases ?? false,
      autoSearchUnreleased: insertSettings.autoSearchUnreleased ?? false,
      steamSyncFailures: 0,

      // Import Engine Defaults
      enablePostProcessing: insertSettings.enablePostProcessing ?? false,
      autoUnpack: insertSettings.autoUnpack ?? false,
      renamePattern: insertSettings.renamePattern ?? "{Title} ({Region})",
      overwriteExisting: insertSettings.overwriteExisting ?? false,
      transferMode: insertSettings.transferMode ?? "hardlink",
      importPlatformIds: insertSettings.importPlatformIds ?? [],
      ignoredExtensions: insertSettings.ignoredExtensions ?? [],
      minFileSize: insertSettings.minFileSize ?? 0,
      libraryRoot: insertSettings.libraryRoot ?? "/data",

      // RomM Defaults
      rommEnabled: insertSettings.rommEnabled ?? false,
      rommLibraryRoot: insertSettings.rommLibraryRoot ?? "/data",
      rommPlatformRoutingMode: insertSettings.rommPlatformRoutingMode ?? "slug-subfolder",
      rommPlatformBindings: insertSettings.rommPlatformBindings ?? {},
      rommPlatformAliases: insertSettings.rommPlatformAliases ?? {},
      rommMoveMode: insertSettings.rommMoveMode ?? "move",
      rommConflictPolicy: insertSettings.rommConflictPolicy ?? "rename",
      rommFolderNamingTemplate: insertSettings.rommFolderNamingTemplate ?? "{title}",
      rommSingleFilePlacement: insertSettings.rommSingleFilePlacement ?? "root",
      rommMultiFilePlacement: insertSettings.rommMultiFilePlacement ?? "subfolder",
      rommIncludeRegionLanguageTags: insertSettings.rommIncludeRegionLanguageTags ?? false,
      rommAllowedSlugs: normalizedAllowedSlugs ?? null,
      rommBindingMissingBehavior: insertSettings.rommBindingMissingBehavior ?? "fallback",
      rommAllowAbsoluteBindings: insertSettings.rommAllowAbsoluteBindings ?? false,

      preferredReleaseGroups: insertSettings.preferredReleaseGroups ?? null,
      filterByPreferredGroups: insertSettings.filterByPreferredGroups ?? false,
      preferredPlatform: insertSettings.preferredPlatform ?? null,
      updatedAt: new Date(),
    };
    this.userSettings.set(id, settings);
    return settings;
  }

  async updateUserSettings(
    userId: string,
    updates: UpdateUserSettings
  ): Promise<UserSettings | undefined> {
    const existing = await this.getUserSettings(userId);
    if (!existing) return undefined;

    const { rommAllowedSlugs: _rawAllowedSlugs, ...restUpdates } = updates;
    const normalizedAllowedSlugs = normalizeSlugArray(updates.rommAllowedSlugs);
    const updated: UserSettings = {
      ...existing,
      ...restUpdates,
      ...(normalizedAllowedSlugs !== undefined ? { rommAllowedSlugs: normalizedAllowedSlugs } : {}),
      updatedAt: new Date(),
    };
    this.userSettings.set(existing.id, updated);
    return updated;
  }

  async addXrelNotifiedRelease(insert: InsertXrelNotifiedRelease): Promise<XrelNotifiedRelease> {
    const id = randomUUID();
    const row: XrelNotifiedRelease = {
      id,
      gameId: insert.gameId,
      xrelReleaseId: insert.xrelReleaseId,
      createdAt: new Date(),
    };
    this.xrelNotified.set(`${insert.gameId}:${insert.xrelReleaseId}`, row);
    return row;
  }

  async hasXrelNotifiedRelease(gameId: string, xrelReleaseId: string): Promise<boolean> {
    return this.xrelNotified.has(`${gameId}:${xrelReleaseId}`);
  }

  async getGameIdsWithXrelReleases(): Promise<string[]> {
    const ids = new Set<string>();
    Array.from(this.xrelNotified.values()).forEach((r) => ids.add(r.gameId));
    return Array.from(ids);
  }

  // Path Mapping methods
  async getPathMappings(): Promise<PathMapping[]> {
    return Array.from(this.pathMappings.values());
  }

  async getPathMapping(id: string): Promise<PathMapping | undefined> {
    return this.pathMappings.get(id);
  }

  async addPathMapping(insertMapping: InsertPathMapping): Promise<PathMapping> {
    const id = randomUUID();
    const mapping: PathMapping = {
      ...insertMapping,
      id,
      remoteHost: insertMapping.remoteHost ?? null,
    };
    this.pathMappings.set(id, mapping);
    return mapping;
  }

  async updatePathMapping(
    id: string,
    updates: Partial<InsertPathMapping>
  ): Promise<PathMapping | undefined> {
    const existing = this.pathMappings.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...updates };
    this.pathMappings.set(id, updated);
    return updated;
  }

  async removePathMapping(id: string): Promise<boolean> {
    return this.pathMappings.delete(id);
  }

  // Platform Mapping methods
  async getPlatformMappings(): Promise<PlatformMapping[]> {
    return Array.from(this.platformMappings.values());
  }

  async getPlatformMapping(igdbPlatformId: number): Promise<PlatformMapping | undefined> {
    return Array.from(this.platformMappings.values()).find(
      (m) => m.igdbPlatformId === igdbPlatformId
    );
  }

  async addPlatformMapping(insertMapping: InsertPlatformMapping): Promise<PlatformMapping> {
    const id = randomUUID();
    const mapping: PlatformMapping = { ...insertMapping, id };
    this.platformMappings.set(id, mapping);
    return mapping;
  }

  async seedPlatformMappingsIfEmpty(
    mappings: InsertPlatformMapping[]
  ): Promise<{ seeded: boolean; count: number }> {
    if (this.platformMappings.size > 0) {
      return { seeded: false, count: this.platformMappings.size };
    }

    for (const mapping of mappings) {
      await this.addPlatformMapping(mapping);
    }

    return { seeded: true, count: this.platformMappings.size };
  }

  async updatePlatformMapping(
    id: string,
    updates: Partial<InsertPlatformMapping>
  ): Promise<PlatformMapping | undefined> {
    const existing = this.platformMappings.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...updates };
    this.platformMappings.set(id, updated);
    return updated;
  }

  async removePlatformMapping(id: string): Promise<boolean> {
    return this.platformMappings.delete(id);
  }

  // Config Accessors
  async getImportConfig(userId?: string): Promise<ImportConfig> {
    const scopedSettings = userId
      ? Array.from(this.userSettings.values()).find((s) => s.userId === userId)
      : this.userSettings.values().next().value;
    return buildImportConfigFromSettings(scopedSettings);
  }

  async getRomMConfig(userId?: string): Promise<RomMConfig> {
    const scopedSettings = userId
      ? Array.from(this.userSettings.values()).find((s) => s.userId === userId)
      : this.userSettings.values().next().value;
    return buildRomMConfigFromSettings(scopedSettings);
  }

  async addReleaseBlacklist(entry: InsertReleaseBlacklist): Promise<ReleaseBlacklist> {
    const existing = Array.from(this.releaseBlacklists.values()).find(
      (r) => r.gameId === entry.gameId && r.releaseTitle === entry.releaseTitle
    );
    if (existing) return existing;
    const id = randomUUID();
    const record: ReleaseBlacklist = {
      id,
      gameId: entry.gameId,
      releaseTitle: entry.releaseTitle,
      indexerName: entry.indexerName ?? null,
      createdAt: new Date(),
    };
    this.releaseBlacklists.set(id, record);
    return record;
  }

  async getReleaseBlacklist(gameId: string): Promise<ReleaseBlacklist[]> {
    return Array.from(this.releaseBlacklists.values())
      .filter((r) => r.gameId === gameId)
      .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
  }

  async getAllReleaseBlacklists(
    userId: string
  ): Promise<(ReleaseBlacklist & { gameTitle: string })[]> {
    const userGames = Array.from(this.games.values()).filter((g) => g.userId === userId);
    const gameMap = new Map(userGames.map((g) => [g.id, g.title]));
    return Array.from(this.releaseBlacklists.values())
      .filter((r) => gameMap.has(r.gameId))
      .map((r) => ({ ...r, gameTitle: gameMap.get(r.gameId)! }))
      .sort((a, b) => {
        const titleCmp = a.gameTitle.localeCompare(b.gameTitle);
        return titleCmp !== 0
          ? titleCmp
          : (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0);
      });
  }

  async removeReleaseBlacklist(id: string, gameId: string): Promise<boolean> {
    const entry = this.releaseBlacklists.get(id);
    if (!entry || entry.gameId !== gameId) return false;
    this.releaseBlacklists.delete(id);
    return true;
  }

  async getReleaseBlacklistSet(gameId: string): Promise<Set<string>> {
    const titles = Array.from(this.releaseBlacklists.values())
      .filter((r) => r.gameId === gameId)
      .map((r) => r.releaseTitle);
    return new Set(titles);
  }
}

export class DatabaseStorage implements IStorage {
  // System Config methods
  async getSystemConfig(key: string): Promise<string | undefined> {
    const [config] = await db.select().from(systemConfig).where(eq(systemConfig.key, key));
    return config?.value;
  }

  async setSystemConfig(key: string, value: string): Promise<void> {
    await db
      .insert(systemConfig)
      .values({ key, value })
      .onConflictDoUpdate({
        target: systemConfig.key,
        set: { value, updatedAt: new Date() },
      });
  }

  // Path Mapping methods
  async getPathMappings(): Promise<PathMapping[]> {
    return db.select().from(pathMappings);
  }

  async getPathMapping(id: string): Promise<PathMapping | undefined> {
    const [mapping] = await db.select().from(pathMappings).where(eq(pathMappings.id, id));
    return mapping || undefined;
  }

  async addPathMapping(insertMapping: InsertPathMapping): Promise<PathMapping> {
    const id = randomUUID();
    const [mapping] = await db
      .insert(pathMappings)
      .values({ ...insertMapping, id })
      .returning();
    return mapping;
  }

  async updatePathMapping(
    id: string,
    updates: Partial<InsertPathMapping>
  ): Promise<PathMapping | undefined> {
    const [updated] = await db
      .update(pathMappings)
      .set(updates)
      .where(eq(pathMappings.id, id))
      .returning();
    return updated || undefined;
  }

  async removePathMapping(id: string): Promise<boolean> {
    const deleted = await db.delete(pathMappings).where(eq(pathMappings.id, id)).returning();
    return deleted.length > 0;
  }

  // Platform Mapping methods
  async getPlatformMappings(): Promise<PlatformMapping[]> {
    return db.select().from(platformMappings);
  }

  async getPlatformMapping(igdbPlatformId: number): Promise<PlatformMapping | undefined> {
    const [mapping] = await db
      .select()
      .from(platformMappings)
      .where(eq(platformMappings.igdbPlatformId, igdbPlatformId));
    return mapping || undefined;
  }

  async addPlatformMapping(insertMapping: InsertPlatformMapping): Promise<PlatformMapping> {
    const id = randomUUID();
    const [mapping] = await db
      .insert(platformMappings)
      .values({ ...insertMapping, id })
      .returning();
    return mapping;
  }

  async seedPlatformMappingsIfEmpty(
    mappings: InsertPlatformMapping[]
  ): Promise<{ seeded: boolean; count: number }> {
    return db.transaction((tx) => {
      const [existing] = tx
        .select({ count: sql<number>`count(*)` })
        .from(platformMappings)
        .all();
      if (existing.count > 0) {
        return { seeded: false, count: existing.count };
      }

      for (const mapping of mappings) {
        tx.insert(platformMappings)
          .values({ ...mapping, id: randomUUID() })
          .run();
      }

      const [seeded] = tx
        .select({ count: sql<number>`count(*)` })
        .from(platformMappings)
        .all();
      return { seeded: true, count: seeded.count };
    });
  }

  async updatePlatformMapping(
    id: string,
    updates: Partial<InsertPlatformMapping>
  ): Promise<PlatformMapping | undefined> {
    const [updated] = await db
      .update(platformMappings)
      .set(updates)
      .where(eq(platformMappings.id, id))
      .returning();
    return updated || undefined;
  }

  async removePlatformMapping(id: string): Promise<boolean> {
    const deleted = await db
      .delete(platformMappings)
      .where(eq(platformMappings.id, id))
      .returning();
    return deleted.length > 0;
  }

  // Config Accessors
  async getImportConfig(userId?: string): Promise<ImportConfig> {
    const [settings] = userId
      ? await db.select().from(userSettings).where(eq(userSettings.userId, userId)).limit(1)
      : await db.select().from(userSettings).limit(1);
    return buildImportConfigFromSettings(settings);
  }

  async getRomMConfig(userId?: string): Promise<RomMConfig> {
    const [settings] = userId
      ? await db.select().from(userSettings).where(eq(userSettings.userId, userId)).limit(1)
      : await db.select().from(userSettings).limit(1);
    return buildRomMConfigFromSettings(settings);
  }

  // User methods
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    // Manually generate UUID for SQLite
    const id = randomUUID();
    const [user] = await db
      .insert(users)
      .values({ ...insertUser, id })
      .returning();
    return user;
  }

  async updateUserPassword(userId: string, passwordHash: string): Promise<User | undefined> {
    const [user] = await db
      .update(users)
      .set({ passwordHash })
      .where(eq(users.id, userId))
      .returning();
    return user;
  }

  async updateUserSteamId(userId: string, steamId: string): Promise<User | undefined> {
    const [user] = await db
      .update(users)
      .set({ steamId64: steamId })
      .where(eq(users.id, userId))
      .returning();
    return user;
  }

  async getAllUsers(): Promise<User[]> {
    return db.select().from(users);
  }

  async countUsers(): Promise<number> {
    const [result] = await db.select({ count: sql<number>`count(*)` }).from(users);
    return result.count;
  }

  async registerSetupUser(insertUser: InsertUser): Promise<User> {
    return db.transaction((tx) => {
      const [result] = tx
        .select({ count: sql<number>`count(*)` })
        .from(users)
        .all();

      if (result.count > 0) {
        throw new Error("Setup already completed");
      }

      // Manually generate UUID for SQLite
      const id = randomUUID();
      const [user] = tx
        .insert(users)
        .values({ ...insertUser, id, steamId64: null })
        .returning()
        .all();
      return user;
    });
  }

  // Game methods
  async getGame(id: string): Promise<Game | undefined> {
    const [game] = await db.select().from(games).where(eq(games.id, id));
    return game || undefined;
  }

  async getGameByIgdbId(igdbId: number): Promise<Game | undefined> {
    const [game] = await db.select().from(games).where(eq(games.igdbId, igdbId));
    return game || undefined;
  }

  async getUserGames(userId: string, includeHidden = false, statuses?: string[]): Promise<Game[]> {
    return db
      .select()
      .from(games)
      .where(
        and(
          eq(games.userId, userId),
          includeHidden ? undefined : eq(games.hidden, false),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          statuses && statuses.length > 0 ? inArray(games.status, statuses as any[]) : undefined
        )
      )
      .orderBy(sql`${games.addedAt} DESC`);
  }

  async getAllGames(): Promise<Game[]> {
    return db
      .select()
      .from(games)
      .orderBy(sql`${games.addedAt} DESC`);
  }

  async getUserGamesByStatus(
    userId: string,
    status: string,
    includeHidden = false
  ): Promise<Game[]> {
    return db
      .select()
      .from(games)
      .where(
        and(
          eq(games.userId, userId),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          eq(games.status, status as any),
          includeHidden ? undefined : eq(games.hidden, false)
        )
      )
      .orderBy(sql`${games.addedAt} DESC`);
  }

  async searchUserGames(userId: string, query: string, includeHidden = false): Promise<Game[]> {
    const searchTerm = `%${query.toLowerCase()}%`;
    return db
      .select()
      .from(games)
      .where(
        and(
          eq(games.userId, userId),
          includeHidden ? undefined : eq(games.hidden, false),
          or(
            like(sql`lower(${games.title})`, searchTerm),
            like(sql`lower(${games.genres})`, searchTerm),
            like(sql`lower(${games.platforms})`, searchTerm)
          )
        )
      )
      .orderBy(sql`${games.addedAt} DESC`);
  }

  async addGame(insertGame: InsertGame): Promise<Game> {
    const gameWithId = {
      id: randomUUID(),
      userId: insertGame.userId ?? null,
      title: insertGame.title,
      igdbId: insertGame.igdbId ?? null,
      summary: insertGame.summary ?? null,
      coverUrl: insertGame.coverUrl ?? null,
      releaseDate: insertGame.releaseDate ?? null,
      rating: insertGame.rating ?? null,
      platforms: insertGame.platforms ?? null,
      genres: insertGame.genres ?? null,
      publishers: insertGame.publishers ?? null,
      developers: insertGame.developers ?? null,
      screenshots: insertGame.screenshots ?? null,
      steamAppId: insertGame.steamAppId ?? null,
      source: insertGame.source ?? null,
      igdbWebsites: insertGame.igdbWebsites ?? null,
      aggregatedRating: insertGame.aggregatedRating ?? null,
      status: insertGame.status ?? "wanted",
      hidden: insertGame.hidden ?? false,
      originalReleaseDate: insertGame.originalReleaseDate ?? null,
      releaseStatus: insertGame.releaseStatus ?? "upcoming",
      earlyAccess: insertGame.earlyAccess ?? false,
      addedAt: new Date(),
    };

    const [game] = await db.insert(games).values(gameWithId).returning();
    return game;
  }

  async updateGameStatus(id: string, statusUpdate: UpdateGameStatus): Promise<Game | undefined> {
    const [updatedGame] = await db
      .update(games)
      .set({
        status: statusUpdate.status,
        completedAt: statusUpdate.status === "completed" ? new Date() : null,
      })
      .where(eq(games.id, id))
      .returning();

    return updatedGame || undefined;
  }

  async updateGameHidden(id: string, hidden: boolean): Promise<Game | undefined> {
    const [updatedGame] = await db
      .update(games)
      .set({ hidden })
      .where(eq(games.id, id))
      .returning();
    return updatedGame || undefined;
  }

  async updateGameUserRating(
    id: string,
    userId: string,
    userRating: number | null
  ): Promise<Game | undefined> {
    const [updatedGame] = await db
      .update(games)
      .set({ userRating })
      .where(and(eq(games.id, id), eq(games.userId, userId)))
      .returning();
    return updatedGame || undefined;
  }

  async updateGameSearchResultsAvailable(gameId: string, available: boolean): Promise<void> {
    await db.update(games).set({ searchResultsAvailable: available }).where(eq(games.id, gameId));
  }

  async updateGame(id: string, updates: Partial<Game>): Promise<Game | undefined> {
    const [updatedGame] = await db.update(games).set(updates).where(eq(games.id, id)).returning();

    return updatedGame || undefined;
  }

  async updateGamesBatch(updates: { id: string; data: Partial<Game> }[]): Promise<void> {
    db.transaction((tx) => {
      for (const update of updates) {
        tx.update(games).set(update.data).where(eq(games.id, update.id)).run();
      }
    });
  }

  async removeGame(id: string): Promise<boolean> {
    const _result = await db.delete(games).where(eq(games.id, id));
    return true;
  }

  async assignOrphanGamesToUser(userId: string): Promise<number> {
    const result = await db
      .update(games)
      .set({ userId })
      .where(sql`${games.userId} IS NULL`)
      .returning();
    return result.length;
  }

  async getWantedGamesGroupedByUser(): Promise<Map<string, Game[]>> {
    const wantedGames = await db
      .select()
      .from(games)
      .where(
        and(eq(games.status, "wanted"), eq(games.hidden, false), sql`${games.userId} IS NOT NULL`)
      );

    const gamesByUser = new Map<string, Game[]>();
    for (const game of wantedGames) {
      if (game.userId) {
        const list = gamesByUser.get(game.userId) || [];
        list.push(game);
        gamesByUser.set(game.userId, list);
      }
    }
    return gamesByUser;
  }

  // Indexer methods
  async getAllIndexers(): Promise<Indexer[]> {
    return db.select().from(indexers).orderBy(indexers.priority);
  }

  async getIndexer(id: string): Promise<Indexer | undefined> {
    const [indexer] = await db.select().from(indexers).where(eq(indexers.id, id));
    return indexer || undefined;
  }

  async getEnabledIndexers(): Promise<Indexer[]> {
    return db.select().from(indexers).where(eq(indexers.enabled, true)).orderBy(indexers.priority);
  }

  async addIndexer(insertIndexer: InsertIndexer): Promise<Indexer> {
    // Generate UUID manually
    const id = randomUUID();
    const [indexer] = await db
      .insert(indexers)
      .values({ ...insertIndexer, id })
      .returning();
    return indexer;
  }

  async updateIndexer(id: string, updates: Partial<InsertIndexer>): Promise<Indexer | undefined> {
    const [updatedIndexer] = await db
      .update(indexers)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(indexers.id, id))
      .returning();

    return updatedIndexer || undefined;
  }

  async removeIndexer(id: string): Promise<boolean> {
    await db.delete(indexers).where(eq(indexers.id, id));
    return true;
  }

  async syncIndexers(
    indexersToSync: Partial<Indexer>[]
  ): Promise<{ added: number; updated: number; failed: number; errors: string[] }> {
    const results = {
      added: 0,
      updated: 0,
      failed: 0,
      errors: [] as string[],
    };

    db.transaction((tx) => {
      // Fetch all existing indexers within the transaction to compare against
      const existingIndexers = tx.select().from(indexers).all();
      const existingMap = new Map(existingIndexers.map((i) => [i.url, i]));

      for (const idx of indexersToSync) {
        try {
          if (!idx.name || !idx.url || !idx.apiKey) {
            results.failed++;
            results.errors.push(`Skipping ${idx.name || "unknown"} - missing required fields`);
            continue;
          }

          const existing = existingMap.get(idx.url);

          if (existing) {
            // Explicitly set allowed fields for update to prevent mass assignment
            tx.update(indexers)
              .set({
                name: idx.name,
                url: idx.url,
                apiKey: idx.apiKey,
                protocol: idx.protocol,
                enabled: idx.enabled,
                priority: idx.priority,
                categories: idx.categories,
                rssEnabled: idx.rssEnabled,
                autoSearchEnabled: idx.autoSearchEnabled,
                updatedAt: new Date(),
              })
              .where(eq(indexers.id, existing.id))
              .run();
            results.updated++;
          } else {
            const id = randomUUID();
            // Default values for missing optional fields
            const newIndexer = {
              id,
              name: idx.name,
              url: idx.url,
              apiKey: idx.apiKey,
              protocol: idx.protocol ?? "torznab",
              enabled: idx.enabled ?? true,
              priority: idx.priority ?? 1,
              categories: idx.categories ?? [],
              rssEnabled: idx.rssEnabled ?? true,
              autoSearchEnabled: idx.autoSearchEnabled ?? true,
              createdAt: new Date(),
              updatedAt: new Date(),
            };

            tx.insert(indexers).values(newIndexer).run();
            results.added++;
          }
        } catch (error) {
          results.failed++;
          results.errors.push(
            `Failed to sync ${idx.name}: ${error instanceof Error ? error.message : "Unknown error"}`
          );
        }
      }
    });

    return results;
  }

  // Downloader methods
  async getAllDownloaders(): Promise<Downloader[]> {
    return db.select().from(downloaders).orderBy(downloaders.priority);
  }

  async getDownloader(id: string): Promise<Downloader | undefined> {
    const [downloader] = await db.select().from(downloaders).where(eq(downloaders.id, id));
    return downloader || undefined;
  }

  async getEnabledDownloaders(): Promise<Downloader[]> {
    return db
      .select()
      .from(downloaders)
      .where(eq(downloaders.enabled, true))
      .orderBy(downloaders.priority);
  }

  async addDownloader(insertDownloader: InsertDownloader): Promise<Downloader> {
    const id = randomUUID();
    const [downloader] = await db
      .insert(downloaders)
      .values({ ...insertDownloader, id })
      .returning();
    return downloader;
  }

  async updateDownloader(
    id: string,
    updates: Partial<InsertDownloader>
  ): Promise<Downloader | undefined> {
    const [updatedDownloader] = await db
      .update(downloaders)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(downloaders.id, id))
      .returning();

    return updatedDownloader || undefined;
  }

  async removeDownloader(id: string): Promise<boolean> {
    await db.delete(downloaders).where(eq(downloaders.id, id));
    return true;
  }

  // GameDownload methods
  async getDownloadingGameDownloads(): Promise<GameDownload[]> {
    return db
      .select()
      .from(gameDownloads)
      .where(
        not(
          inArray(gameDownloads.status, [
            "completed",
            "error",
            "imported",
            "manual_review_required",
          ])
        )
      );
  }

  async getPendingImportReviews(): Promise<GameDownload[]> {
    return db
      .select()
      .from(gameDownloads)
      .where(eq(gameDownloads.status, "manual_review_required"));
  }

  async getGameDownload(id: string, userId?: string): Promise<GameDownload | undefined> {
    if (userId !== undefined) {
      const [download] = await db
        .select({ gameDownloads })
        .from(gameDownloads)
        .innerJoin(games, eq(gameDownloads.gameId, games.id))
        .where(and(eq(gameDownloads.id, id), eq(games.userId, userId)));
      return download?.gameDownloads;
    }
    const [download] = await db.select().from(gameDownloads).where(eq(gameDownloads.id, id));
    return download;
  }

  async getDownloadsByGameId(
    gameId: string
  ): Promise<(GameDownload & { downloaderName: string | null })[]> {
    const rows = await db
      .select({
        id: gameDownloads.id,
        gameId: gameDownloads.gameId,
        downloaderId: gameDownloads.downloaderId,
        downloadType: gameDownloads.downloadType,
        downloadHash: gameDownloads.downloadHash,
        downloadTitle: gameDownloads.downloadTitle,
        status: gameDownloads.status,
        fileSize: gameDownloads.fileSize,
        addedAt: gameDownloads.addedAt,
        completedAt: gameDownloads.completedAt,
        downloaderName: downloaders.name,
      })
      .from(gameDownloads)
      .leftJoin(downloaders, eq(gameDownloads.downloaderId, downloaders.id))
      .where(eq(gameDownloads.gameId, gameId))
      .orderBy(desc(gameDownloads.addedAt));
    return rows;
  }

  async updateGameDownloadStatus(id: string, status: string): Promise<void> {
    await db
      .update(gameDownloads)
      .set({
        status: status as InsertGameDownload["status"],
        completedAt: status === "completed" ? new Date() : null,
      })
      .where(eq(gameDownloads.id, id));
  }

  async addGameDownload(insertGameDownload: InsertGameDownload): Promise<GameDownload> {
    const id = randomUUID();
    const [gameDownload] = await db
      .insert(gameDownloads)
      .values({ ...insertGameDownload, id })
      .returning();
    return gameDownload;
  }

  async removeGameDownload(id: string, gameId: string): Promise<boolean> {
    const result = await db
      .delete(gameDownloads)
      .where(and(eq(gameDownloads.id, id), eq(gameDownloads.gameId, gameId)))
      .returning();
    return result.length > 0;
  }

  async getTrackedDownloadKeys(): Promise<Set<string>> {
    const rows = await db
      .select({
        downloaderId: gameDownloads.downloaderId,
        downloadHash: gameDownloads.downloadHash,
      })
      .from(gameDownloads);
    return new Set(rows.map((r) => `${r.downloaderId}:${r.downloadHash}`));
  }

  async getDownloadSummaryByGame(userId: string): Promise<Record<string, DownloadSummary>> {
    const rows = await db
      .select({
        gameId: gameDownloads.gameId,
        count: sql<number>`count(*)`,
        topStatus: sql<string>`
          CASE
            WHEN sum(CASE WHEN ${gameDownloads.status} = 'failed' THEN 1 ELSE 0 END) > 0 THEN 'failed'
            WHEN sum(CASE WHEN ${gameDownloads.status} = 'downloading' THEN 1 ELSE 0 END) > 0 THEN 'downloading'
            WHEN sum(CASE WHEN ${gameDownloads.status} = 'paused' THEN 1 ELSE 0 END) > 0 THEN 'paused'
            ELSE 'completed'
          END
        `,
        downloadTypes: sql<string>`group_concat(DISTINCT ${gameDownloads.downloadType})`,
        hasUpdateDownload: sql<number>`max(CASE
          WHEN ${gameDownloads.downloadTitle} LIKE '%update%'
            OR ${gameDownloads.downloadTitle} LIKE '%patch%'
            OR ${gameDownloads.downloadTitle} LIKE '%hotfix%'
            OR ${gameDownloads.downloadTitle} LIKE '%crackfix%'
            OR ${gameDownloads.downloadTitle} LIKE '%fix%'
          THEN 1 ELSE 0 END)`,
      })
      .from(gameDownloads)
      .innerJoin(games, eq(gameDownloads.gameId, games.id))
      .where(eq(games.userId, userId))
      .groupBy(gameDownloads.gameId);

    return Object.fromEntries(
      rows.map((row) => {
        return [
          row.gameId,
          {
            topStatus: row.topStatus as DownloadSummary["topStatus"],
            count: row.count,
            downloadTypes: (row.downloadTypes ?? "torrent").split(",").filter(Boolean) as (
              | "torrent"
              | "usenet"
            )[],
            hasUpdateDownload: row.hasUpdateDownload > 0,
          },
        ];
      })
    );
  }

  // Notification methods
  async getNotifications(userId: string, limit: number = 50): Promise<Notification[]> {
    return db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt))
      .limit(limit);
  }

  async getUnreadNotificationsCount(userId: string): Promise<number> {
    const [result] = await db
      .select({ count: sql<number>`count(*)` })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.read, false)));
    return result.count;
  }

  async addNotification(insertNotification: InsertNotification): Promise<Notification> {
    const id = randomUUID();
    const [notification] = await db
      .insert(notifications)
      .values({ ...insertNotification, id })
      .returning();
    return notification;
  }

  async addNotificationsBatch(insertNotifications: InsertNotification[]): Promise<Notification[]> {
    if (insertNotifications.length === 0) return [];
    const values = insertNotifications.map((insertNotification) => ({
      ...insertNotification,
      id: randomUUID(),
    }));
    return db.insert(notifications).values(values).returning();
  }

  async markNotificationAsRead(id: string): Promise<Notification | undefined> {
    const [updatedNotification] = await db
      .update(notifications)
      .set({ read: true })
      .where(eq(notifications.id, id))
      .returning();
    return updatedNotification || undefined;
  }

  async markAllNotificationsAsRead(userId: string): Promise<void> {
    await db
      .update(notifications)
      .set({ read: true })
      .where(and(eq(notifications.userId, userId), eq(notifications.read, false)));
  }

  async deleteReadNotifications(userId: string): Promise<void> {
    await db
      .delete(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.read, true)));
  }

  // RSS Feed methods
  async getAllRssFeeds(): Promise<RssFeed[]> {
    return db.select().from(rssFeeds);
  }

  async getRssFeed(id: string): Promise<RssFeed | undefined> {
    const [feed] = await db.select().from(rssFeeds).where(eq(rssFeeds.id, id));
    return feed;
  }

  async addRssFeed(feed: InsertRssFeed): Promise<RssFeed> {
    const id = randomUUID();
    const [newFeed] = await db
      .insert(rssFeeds)
      .values({ ...feed, id })
      .returning();
    return newFeed;
  }

  async updateRssFeed(id: string, updates: Partial<RssFeed>): Promise<RssFeed | undefined> {
    const [updated] = await db
      .update(rssFeeds)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(rssFeeds.id, id))
      .returning();
    return updated;
  }

  async removeRssFeed(id: string): Promise<boolean> {
    const [deleted] = await db.delete(rssFeeds).where(eq(rssFeeds.id, id)).returning();
    return !!deleted;
  }

  async getRssFeedItem(id: string): Promise<RssFeedItem | undefined> {
    const [item] = await db.select().from(rssFeedItems).where(eq(rssFeedItems.id, id));
    return item;
  }

  async getRssFeedItems(feedId: string): Promise<RssFeedItem[]> {
    return db
      .select()
      .from(rssFeedItems)
      .where(eq(rssFeedItems.feedId, feedId))
      .orderBy(desc(rssFeedItems.pubDate));
  }

  async getAllRssFeedItems(limit: number = 100): Promise<RssFeedItem[]> {
    return db.select().from(rssFeedItems).orderBy(desc(rssFeedItems.pubDate)).limit(limit);
  }

  async addRssFeedItem(item: InsertRssFeedItem): Promise<RssFeedItem> {
    const id = randomUUID();
    const [newItem] = await db
      .insert(rssFeedItems)
      .values({ ...item, id })
      .returning();
    return newItem;
  }

  async getRssFeedItemByGuid(guid: string): Promise<RssFeedItem | undefined> {
    const [item] = await db.select().from(rssFeedItems).where(eq(rssFeedItems.guid, guid));
    return item;
  }

  async updateRssFeedItem(
    id: string,
    updates: Partial<InsertRssFeedItem>
  ): Promise<RssFeedItem | undefined> {
    const [updated] = await db
      .update(rssFeedItems)
      .set(updates)
      .where(eq(rssFeedItems.id, id))
      .returning();
    return updated;
  }

  // UserSettings methods
  async getUserSettings(userId: string): Promise<UserSettings | undefined> {
    const [settings] = await db.select().from(userSettings).where(eq(userSettings.userId, userId));
    return settings || undefined;
  }

  async createUserSettings(insertSettings: InsertUserSettings): Promise<UserSettings> {
    const id = randomUUID();
    const { rommAllowedSlugs: _rawAllowedSlugs, ...restInsertSettings } = insertSettings;
    const normalizedAllowedSlugs = normalizeSlugArray(insertSettings.rommAllowedSlugs);
    const [settings] = await db
      .insert(userSettings)
      .values({
        ...restInsertSettings,
        enablePostProcessing: insertSettings.enablePostProcessing ?? false,
        ...(normalizedAllowedSlugs !== undefined
          ? { rommAllowedSlugs: normalizedAllowedSlugs }
          : {}),
        id,
      })
      .returning();
    return settings;
  }

  async updateUserSettings(
    userId: string,
    updates: UpdateUserSettings
  ): Promise<UserSettings | undefined> {
    const { rommAllowedSlugs: _rawAllowedSlugs, ...restUpdates } = updates;
    const normalizedAllowedSlugs = normalizeSlugArray(updates.rommAllowedSlugs);
    const [updated] = await db
      .update(userSettings)
      .set({
        ...restUpdates,
        ...(normalizedAllowedSlugs !== undefined
          ? { rommAllowedSlugs: normalizedAllowedSlugs }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(userSettings.userId, userId))
      .returning();
    return updated || undefined;
  }

  async addXrelNotifiedRelease(insert: InsertXrelNotifiedRelease): Promise<XrelNotifiedRelease> {
    const id = randomUUID();
    const [row] = await db
      .insert(xrelNotifiedReleases)
      .values({ ...insert, id })
      .returning();
    return row;
  }

  async hasXrelNotifiedRelease(gameId: string, xrelReleaseId: string): Promise<boolean> {
    const rows = await db
      .select()
      .from(xrelNotifiedReleases)
      .where(
        and(
          eq(xrelNotifiedReleases.gameId, gameId),
          eq(xrelNotifiedReleases.xrelReleaseId, xrelReleaseId)
        )
      );
    return rows.length > 0;
  }

  async getGameIdsWithXrelReleases(): Promise<string[]> {
    const rows = await db
      .selectDistinct({ gameId: xrelNotifiedReleases.gameId })
      .from(xrelNotifiedReleases);
    return rows.map((r) => r.gameId);
  }

  async addReleaseBlacklist(entry: InsertReleaseBlacklist): Promise<ReleaseBlacklist> {
    const id = randomUUID();
    const [row] = await db
      .insert(releaseBlacklist)
      .values({
        id,
        gameId: entry.gameId,
        releaseTitle: entry.releaseTitle,
        indexerName: entry.indexerName ?? null,
        createdAt: new Date(),
      })
      .onConflictDoNothing()
      .returning();
    if (!row) {
      const [existing] = await db
        .select()
        .from(releaseBlacklist)
        .where(
          and(
            eq(releaseBlacklist.gameId, entry.gameId),
            eq(releaseBlacklist.releaseTitle, entry.releaseTitle)
          )
        );
      return existing;
    }
    return row;
  }

  async getReleaseBlacklist(gameId: string): Promise<ReleaseBlacklist[]> {
    return db
      .select()
      .from(releaseBlacklist)
      .where(eq(releaseBlacklist.gameId, gameId))
      .orderBy(desc(releaseBlacklist.createdAt));
  }

  async getAllReleaseBlacklists(
    userId: string
  ): Promise<(ReleaseBlacklist & { gameTitle: string })[]> {
    return db
      .select({
        id: releaseBlacklist.id,
        gameId: releaseBlacklist.gameId,
        releaseTitle: releaseBlacklist.releaseTitle,
        indexerName: releaseBlacklist.indexerName,
        createdAt: releaseBlacklist.createdAt,
        gameTitle: games.title,
      })
      .from(releaseBlacklist)
      .innerJoin(games, eq(releaseBlacklist.gameId, games.id))
      .where(eq(games.userId, userId))
      .orderBy(games.title, desc(releaseBlacklist.createdAt));
  }

  async removeReleaseBlacklist(id: string, gameId: string): Promise<boolean> {
    const result = await db
      .delete(releaseBlacklist)
      .where(and(eq(releaseBlacklist.id, id), eq(releaseBlacklist.gameId, gameId)));
    return result.changes > 0;
  }

  async getReleaseBlacklistSet(gameId: string): Promise<Set<string>> {
    const rows = await db
      .select({ releaseTitle: releaseBlacklist.releaseTitle })
      .from(releaseBlacklist)
      .where(eq(releaseBlacklist.gameId, gameId));
    return new Set(rows.map((r) => r.releaseTitle));
  }
}

export const storage = new DatabaseStorage();
