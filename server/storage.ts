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
  type GameTorrent,
  type InsertGameTorrent,
  type Notification,
  type InsertNotification,
  users,
  games,
  indexers,
  downloaders,
  notifications,
  gameTorrents,
} from "../shared/schema.js";
import { randomUUID } from "crypto";
import { db } from "./db.js";
import { eq, ilike, or, sql, desc, and } from "drizzle-orm";

export interface IStorage {
  // User methods
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  // Game methods
  getGame(id: string): Promise<Game | undefined>;
  getGameByIgdbId(igdbId: number): Promise<Game | undefined>;
  getAllGames(): Promise<Game[]>;
  getGamesByStatus(status: string): Promise<Game[]>;
  searchGames(query: string): Promise<Game[]>;
  addGame(game: InsertGame): Promise<Game>;
  updateGameStatus(id: string, statusUpdate: UpdateGameStatus): Promise<Game | undefined>;
  updateGame(id: string, updates: Partial<Game>): Promise<Game | undefined>;
  removeGame(id: string): Promise<boolean>;

  // Indexer methods
  getAllIndexers(): Promise<Indexer[]>;
  getIndexer(id: string): Promise<Indexer | undefined>;
  getEnabledIndexers(): Promise<Indexer[]>;
  addIndexer(indexer: InsertIndexer): Promise<Indexer>;
  updateIndexer(id: string, updates: Partial<InsertIndexer>): Promise<Indexer | undefined>;
  removeIndexer(id: string): Promise<boolean>;

  // Downloader methods
  getAllDownloaders(): Promise<Downloader[]>;
  getDownloader(id: string): Promise<Downloader | undefined>;
  getEnabledDownloaders(): Promise<Downloader[]>;
  addDownloader(downloader: InsertDownloader): Promise<Downloader>;
  updateDownloader(id: string, updates: Partial<InsertDownloader>): Promise<Downloader | undefined>;
  removeDownloader(id: string): Promise<boolean>;

  // GameTorrent methods
  getDownloadingGameTorrents(): Promise<GameTorrent[]>;
  updateGameTorrentStatus(id: string, status: string): Promise<void>;
  addGameTorrent(gameTorrent: InsertGameTorrent): Promise<GameTorrent>;
  
  // Notification methods
  getNotifications(limit?: number): Promise<Notification[]>;
  getUnreadNotificationsCount(): Promise<number>;
  addNotification(notification: InsertNotification): Promise<Notification>;
  markNotificationAsRead(id: string): Promise<Notification | undefined>;
  markAllNotificationsAsRead(): Promise<void>;
  clearAllNotifications(): Promise<void>;
}

export class MemStorage implements IStorage {
  private users: Map<string, User>;
  private games: Map<string, Game>;
  private indexers: Map<string, Indexer>;
  private downloaders: Map<string, Downloader>;
  private notifications: Map<string, Notification>;
  private gameTorrents: Map<string, GameTorrent>;

  constructor() {
    this.users = new Map();
    this.games = new Map();
    this.indexers = new Map();
    this.downloaders = new Map();
    this.notifications = new Map();
    this.gameTorrents = new Map();
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
    const user: User = { ...insertUser, id };
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

  async getAllGames(): Promise<Game[]> {
    return Array.from(this.games.values()).sort(
      (a, b) => new Date(b.addedAt || 0).getTime() - new Date(a.addedAt || 0).getTime()
    );
  }

  async getGamesByStatus(status: string): Promise<Game[]> {
    return Array.from(this.games.values())
      .filter((game) => game.status === status)
      .sort((a, b) => new Date(b.addedAt || 0).getTime() - new Date(a.addedAt || 0).getTime());
  }

  async searchGames(query: string): Promise<Game[]> {
    const lowercaseQuery = query.toLowerCase();
    return Array.from(this.games.values())
      .filter(
        (game) =>
          game.title.toLowerCase().includes(lowercaseQuery) ||
          game.genres?.some((genre) => genre.toLowerCase().includes(lowercaseQuery)) ||
          game.platforms?.some((platform) => platform.toLowerCase().includes(lowercaseQuery))
      )
      .sort((a, b) => new Date(b.addedAt || 0).getTime() - new Date(a.addedAt || 0).getTime());
  }

  async addGame(insertGame: InsertGame): Promise<Game> {
    const id = randomUUID();
    const game: Game = {
      ...insertGame,
      id,
      status: insertGame.status || "wanted",
      summary: insertGame.summary || null,
      coverUrl: insertGame.coverUrl || null,
      releaseDate: insertGame.releaseDate || null,
      rating: insertGame.rating || null,
      platforms: insertGame.platforms || null,
      genres: insertGame.genres || null,
      screenshots: insertGame.screenshots || null,
      igdbId: insertGame.igdbId || null,
      originalReleaseDate: insertGame.originalReleaseDate || null,
      releaseStatus: insertGame.releaseStatus || "upcoming",
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

  async removeGame(id: string): Promise<boolean> {
    return this.games.delete(id);
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

  // GameTorrent methods
  async getDownloadingGameTorrents(): Promise<GameTorrent[]> {
    return Array.from(this.gameTorrents.values()).filter(
      (gt) => gt.status === "downloading"
    );
  }

  async updateGameTorrentStatus(id: string, status: string): Promise<void> {
    const gt = this.gameTorrents.get(id);
    if (gt) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.gameTorrents.set(id, { ...gt, status: status as any });
    }
  }

  async addGameTorrent(insertGameTorrent: InsertGameTorrent): Promise<GameTorrent> {
    const id = randomUUID();
    const gameTorrent: GameTorrent = {
      ...insertGameTorrent,
      id,
      status: insertGameTorrent.status || "downloading",
      addedAt: new Date(),
      completedAt: null,
    };
    this.gameTorrents.set(id, gameTorrent);
    return gameTorrent;
  }

  // Notification methods
  async getNotifications(limit: number = 50): Promise<Notification[]> {
    return Array.from(this.notifications.values())
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
      .slice(0, limit);
  }

  async getUnreadNotificationsCount(): Promise<number> {
    return Array.from(this.notifications.values()).filter((n) => !n.read).length;
  }

  async addNotification(insertNotification: InsertNotification): Promise<Notification> {
    const id = randomUUID();
    const notification: Notification = {
      id,
      userId: insertNotification.userId ?? null,
      type: insertNotification.type,
      title: insertNotification.title,
      message: insertNotification.message,
      read: false,
      createdAt: new Date(),
    };
    this.notifications.set(id, notification);
    return notification;
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

  async markAllNotificationsAsRead(): Promise<void> {
    Array.from(this.notifications.entries()).forEach(([id, notification]) => {
      if (!notification.read) {
        this.notifications.set(id, { ...notification, read: true });
      }
    });
  }

  async clearAllNotifications(): Promise<void> {
    this.notifications.clear();
  }
}

export class DatabaseStorage implements IStorage {
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
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
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

  async getAllGames(): Promise<Game[]> {
    return db
      .select()
      .from(games)
      .orderBy(sql`${games.addedAt} DESC`);
  }

  async getGamesByStatus(status: string): Promise<Game[]> {
    return (
      db
        .select()
        .from(games)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .where(eq(games.status, status as any))
        .orderBy(sql`${games.addedAt} DESC`)
    );
  }

  async searchGames(query: string): Promise<Game[]> {
    const searchTerm = `%${query.toLowerCase()}%`;
    return db
      .select()
      .from(games)
      .where(
        or(
          ilike(games.title, searchTerm),
          sql`EXISTS (SELECT 1 FROM unnest(${games.genres}) AS genre WHERE genre ILIKE ${searchTerm})`,
          sql`EXISTS (SELECT 1 FROM unnest(${games.platforms}) AS platform WHERE platform ILIKE ${searchTerm})`
        )
      )
      .orderBy(sql`${games.addedAt} DESC`);
  }

  async addGame(insertGame: InsertGame): Promise<Game> {
    const gameWithId = {
      id: randomUUID(),
      title: insertGame.title,
      igdbId: insertGame.igdbId ?? null,
      summary: insertGame.summary ?? null,
      coverUrl: insertGame.coverUrl ?? null,
      releaseDate: insertGame.releaseDate ?? null,
      rating: insertGame.rating ?? null,
      platforms: insertGame.platforms ?? null,
      genres: insertGame.genres ?? null,
      screenshots: insertGame.screenshots ?? null,
      status: insertGame.status ?? "wanted",
      originalReleaseDate: insertGame.originalReleaseDate ?? null,
      releaseStatus: insertGame.releaseStatus ?? "upcoming",
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

  async updateGame(id: string, updates: Partial<Game>): Promise<Game | undefined> {
    const [updatedGame] = await db
      .update(games)
      .set(updates)
      .where(eq(games.id, id))
      .returning();

    return updatedGame || undefined;
  }

  async removeGame(id: string): Promise<boolean> {
    const _result = await db.delete(games).where(eq(games.id, id));
    // For Drizzle, we assume success if no error is thrown
    return true;
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
    const [indexer] = await db.insert(indexers).values(insertIndexer).returning();
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
    const [downloader] = await db.insert(downloaders).values(insertDownloader).returning();
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

  // GameTorrent methods
  async getDownloadingGameTorrents(): Promise<GameTorrent[]> {
    return db
      .select()
      .from(gameTorrents)
      .where(eq(gameTorrents.status, "downloading"));
  }

  async updateGameTorrentStatus(id: string, status: string): Promise<void> {
    await db
      .update(gameTorrents)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .set({ status: status as any, completedAt: status === "completed" ? new Date() : null })
      .where(eq(gameTorrents.id, id));
  }

  async addGameTorrent(insertGameTorrent: InsertGameTorrent): Promise<GameTorrent> {
    const [gameTorrent] = await db.insert(gameTorrents).values(insertGameTorrent).returning();
    return gameTorrent;
  }

  // Notification methods
  async getNotifications(limit: number = 50): Promise<Notification[]> {
    return db
      .select()
      .from(notifications)
      .orderBy(desc(notifications.createdAt))
      .limit(limit);
  }

  async getUnreadNotificationsCount(): Promise<number> {
    const [result] = await db
      .select({ count: sql<number>`count(*)` })
      .from(notifications)
      .where(eq(notifications.read, false));
    return result.count;
  }

  async addNotification(insertNotification: InsertNotification): Promise<Notification> {
    const [notification] = await db.insert(notifications).values(insertNotification).returning();
    return notification;
  }

  async markNotificationAsRead(id: string): Promise<Notification | undefined> {
    const [updatedNotification] = await db
      .update(notifications)
      .set({ read: true })
      .where(eq(notifications.id, id))
      .returning();
    return updatedNotification || undefined;
  }

  async markAllNotificationsAsRead(): Promise<void> {
    await db.update(notifications).set({ read: true }).where(eq(notifications.read, false));
  }

  async clearAllNotifications(): Promise<void> {
    await db.delete(notifications);
  }
}

export const storage = new DatabaseStorage();
