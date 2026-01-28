import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, real, blob } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
});

export const userSettings = sqliteTable("user_settings", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull()
    .unique(),
  autoSearchEnabled: integer("auto_search_enabled", { mode: "boolean" }).notNull().default(true),
  autoDownloadEnabled: integer("auto_download_enabled", { mode: "boolean" })
    .notNull()
    .default(false),
  notifyMultipleDownloads: integer("notify_multiple_downloads", { mode: "boolean" })
    .notNull()
    .default(true),
  notifyUpdates: integer("notify_updates", { mode: "boolean" }).notNull().default(true),
  searchIntervalHours: integer("search_interval_hours").notNull().default(6),
  igdbRateLimitPerSecond: integer("igdb_rate_limit_per_second").notNull().default(3),
  downloadRules: text("download_rules"),
  lastAutoSearch: integer("last_auto_search", { mode: "timestamp" }),
  xrelSceneReleases: integer("xrel_scene_releases", { mode: "boolean" }).notNull().default(true),
  xrelP2pReleases: integer("xrel_p2p_releases", { mode: "boolean" }).notNull().default(false),
  updatedAt: integer("updated_at", { mode: "timestamp" }).default(
    sql`(strftime('%s', 'now') * 1000)`
  ),
});

export const systemConfig = sqliteTable("system_config", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).default(
    sql`(strftime('%s', 'now') * 1000)`
  ),
});

export const games = sqliteTable("games", {
  id: text("id").primaryKey(),
  userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
  igdbId: integer("igdb_id"),
  title: text("title").notNull(),
  summary: text("summary"),
  coverUrl: text("cover_url"),
  releaseDate: text("release_date"),
  rating: real("rating"),
  platforms: text("platforms", { mode: "json" }).$type<string[]>(),
  genres: text("genres", { mode: "json" }).$type<string[]>(),
  publishers: text("publishers", { mode: "json" }).$type<string[]>(),
  developers: text("developers", { mode: "json" }).$type<string[]>(),
  screenshots: text("screenshots", { mode: "json" }).$type<string[]>(),
  status: text("status").notNull().default("wanted"), // Enum validation handled by Zod
  originalReleaseDate: text("original_release_date"),
  releaseStatus: text("release_status").default("upcoming"), // Enum validation handled by Zod
  hidden: integer("hidden", { mode: "boolean" }).default(false),
  addedAt: integer("added_at", { mode: "timestamp" }).default(sql`(strftime('%s', 'now') * 1000)`),
  completedAt: integer("completed_at", { mode: "timestamp" }),
});

export const indexers = sqliteTable("indexers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  apiKey: text("api_key").notNull(),
  protocol: text("protocol").notNull().default("torznab"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  priority: integer("priority").notNull().default(1),
  categories: text("categories", { mode: "json" }).$type<string[]>().default([]),
  rssEnabled: integer("rss_enabled", { mode: "boolean" }).notNull().default(true),
  autoSearchEnabled: integer("auto_search_enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp" }).default(
    sql`(strftime('%s', 'now') * 1000)`
  ),
  updatedAt: integer("updated_at", { mode: "timestamp" }).default(
    sql`(strftime('%s', 'now') * 1000)`
  ),
});

export const downloaders = sqliteTable("downloaders", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(), // Enum validation handled by Zod
  url: text("url").notNull(),
  port: integer("port"),
  useSsl: integer("use_ssl", { mode: "boolean" }).default(false),
  urlPath: text("url_path"),
  username: text("username"),
  password: text("password"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  priority: integer("priority").notNull().default(1),
  downloadPath: text("download_path"),
  category: text("category").default("games"),
  label: text("label").default("Questarr"),
  addStopped: integer("add_stopped", { mode: "boolean" }).default(false),
  removeCompleted: integer("remove_completed", { mode: "boolean" }).default(false),
  postImportCategory: text("post_import_category"),
  settings: text("settings"),
  createdAt: integer("created_at", { mode: "timestamp" }).default(
    sql`(strftime('%s', 'now') * 1000)`
  ),
  updatedAt: integer("updated_at", { mode: "timestamp" }).default(
    sql`(strftime('%s', 'now') * 1000)`
  ),
});

// Track downloads associated with games for completion monitoring
export const gameDownloads = sqliteTable("game_downloads", {
  id: text("id").primaryKey(),
  gameId: text("game_id")
    .notNull()
    .references(() => games.id, { onDelete: "cascade" }),
  downloaderId: text("downloader_id")
    .notNull()
    .references(() => downloaders.id, { onDelete: "cascade" }),
  downloadType: text("download_type").notNull().default("torrent"),
  downloadHash: text("download_hash").notNull(),
  downloadTitle: text("download_title").notNull(),
  status: text("status").notNull().default("downloading"),
  addedAt: integer("added_at", { mode: "timestamp" }).default(sql`(strftime('%s', 'now') * 1000)`),
  completedAt: integer("completed_at", { mode: "timestamp" }),
});

// Legacy table name for backward compatibility during migration
export const legacy_gameDownloads = gameDownloads;

// Track xREL.to release notifications so we notify once per (game, release) and know which games have xREL listings
export const xrelNotifiedReleases = sqliteTable("xrel_notified_releases", {
  id: text("id").primaryKey(),
  gameId: text("game_id")
    .notNull()
    .references(() => games.id, { onDelete: "cascade" }),
  xrelReleaseId: text("xrel_release_id").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).default(
    sql`(strftime('%s', 'now') * 1000)`
  ),
});

export const notifications = sqliteTable("notifications", {
  id: text("id").primaryKey(),
  userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  read: integer("read", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp" }).default(
    sql`(strftime('%s', 'now') * 1000)`
  ),
});

// Validation schemas using drizzle-zod for runtime validation
export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  passwordHash: true,
});

export const insertGameSchema = createInsertSchema(games, {
  status: (schema) =>
    schema
      .nullable()
      .optional()
      .transform((val) => val ?? "wanted"),
  hidden: (schema) =>
    schema
      .nullable()
      .optional()
      .transform((val) => val ?? false),
}).omit({
  id: true,
  addedAt: true,
  completedAt: true,
});

export const updateGameStatusSchema = z.object({
  status: z.enum(["wanted", "owned", "completed", "downloading"]),
  completedAt: z.date().optional(),
});

export const updateGameHiddenSchema = z.object({
  hidden: z.boolean(),
});

export const insertIndexerSchema = createInsertSchema(indexers).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertDownloaderSchema = createInsertSchema(downloaders).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertGameDownloadSchema = createInsertSchema(gameDownloads).omit({
  id: true,
  addedAt: true,
  completedAt: true,
});

// Legacy schema name for backward compatibility
export const insertGameDownloadLegacySchema = insertGameDownloadSchema;

export const insertNotificationSchema = createInsertSchema(notifications).omit({
  id: true,
  createdAt: true,
  read: true,
});

// Download rules schema for auto-download filtering
export const downloadRulesSchema = z.object({
  minSeeders: z.number().int().min(0).default(0),
  sortBy: z.enum(["seeders", "date", "size"]).default("seeders"),
  visibleCategories: z
    .array(z.enum(["main", "update", "dlc", "extra"]))
    .default(["main", "update", "dlc", "extra"]),
});

export type DownloadRules = z.infer<typeof downloadRulesSchema>;

export const insertXrelNotifiedReleaseSchema = createInsertSchema(xrelNotifiedReleases).omit({
  id: true,
  createdAt: true,
});

export const insertUserSettingsSchema = createInsertSchema(userSettings).omit({
  id: true,
  updatedAt: true,
});

export const updateUserSettingsSchema = createInsertSchema(userSettings)
  .omit({
    id: true,
    userId: true,
    updatedAt: true,
  })
  .partial();

export const updatePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: z.string().min(6, "New password must be at least 6 characters"),
    confirmPassword: z.string().min(1, "Confirm password is required"),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export type UpdatePassword = z.infer<typeof updatePasswordSchema>;

// Type definitions - using Drizzle's table inference for select types
export type User = typeof users.$inferSelect;
export type InsertUser = (typeof insertUserSchema)["_output"];

export type Game = typeof games.$inferSelect & {
  // Additional fields for Discovery games
  isReleased?: boolean;
  releaseYear?: number | null;
  // Set by API when game has been seen on xREL.to (wanted games)
  hasXrelRelease?: boolean;
};

export type InsertGame = (typeof insertGameSchema)["_output"];

export type UpdateGameStatus = (typeof updateGameStatusSchema)["_output"];

export type Indexer = typeof indexers.$inferSelect;
export type InsertIndexer = (typeof insertIndexerSchema)["_output"];

export type Downloader = typeof downloaders.$inferSelect;
export type InsertDownloader = (typeof insertDownloaderSchema)["_output"];

export type GameDownload = typeof gameDownloads.$inferSelect;
export type InsertGameDownload = (typeof insertGameDownloadSchema)["_output"];

export type XrelNotifiedRelease = typeof xrelNotifiedReleases.$inferSelect;
export type InsertXrelNotifiedRelease = (typeof insertXrelNotifiedReleaseSchema)["_output"];

// Legacy type names for backward compatibility
export type GameDownloadLegacy = GameDownload;
export type InsertGameDownloadLegacy = InsertGameDownload;

export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = (typeof insertNotificationSchema)["_output"];

export type UserSettings = typeof userSettings.$inferSelect;
export type InsertUserSettings = (typeof insertUserSettingsSchema)["_output"];
export type UpdateUserSettings = (typeof updateUserSettingsSchema)["_output"];

// Application configuration type
export interface Config {
  igdb: {
    configured: boolean;
    source?: "env" | "database";
    clientId?: string;
  };
  xrel?: {
    apiBase: string;
  };
}

// Download-related types shared between frontend and backend
export interface DownloadFile {
  name: string;
  size: number;
  progress: number; // 0-100
  priority: "off" | "low" | "normal" | "high";
  wanted: boolean;
}

export interface DownloadTracker {
  url: string;
  tier: number;
  status: "working" | "updating" | "error" | "inactive";
  seeders?: number;
  leechers?: number;
  lastAnnounce?: string;
  nextAnnounce?: string;
  error?: string;
}

export interface DownloadStatus {
  id: string;
  name: string;
  downloadType?: "torrent" | "usenet"; // Type of download
  status: "downloading" | "seeding" | "completed" | "paused" | "error" | "repairing" | "unpacking";
  progress: number; // 0-100
  downloadSpeed?: number; // bytes per second
  uploadSpeed?: number; // bytes per second (torrents only)
  eta?: number; // seconds
  size?: number; // total bytes
  downloaded?: number; // bytes downloaded
  // Protocol-specific fields
  seeders?: number;
  leechers?: number;
  ratio?: number;
  // Usenet-specific fields
  repairStatus?: "good" | "repairing" | "failed"; // Par2 repair status
  unpackStatus?: "unpacking" | "completed" | "failed"; // Extract/unpack status
  age?: number; // Age in days
  // Common fields
  error?: string;
  category?: string;
}

export interface DownloadDetails extends DownloadStatus {
  hash?: string;
  addedDate?: string;
  completedDate?: string;
  downloadDir?: string;
  comment?: string;
  creator?: string;
  files: DownloadFile[];
  trackers: DownloadTracker[];
  totalPeers?: number;
  connectedPeers?: number;
}

export interface SearchResultItem {
  title: string;
  link: string;
  pubDate: string;
  description?: string;
  category?: string;
  size?: number;
  seeders?: number;
  leechers?: number;
  downloadVolumeFactor?: number;
  uploadVolumeFactor?: number;
  guid?: string;
  comments?: string;
  attributes?: { [key: string]: string };
  indexerId?: string;
  indexerName?: string;
}

export interface SearchResult {
  items: SearchResultItem[];
  total?: number;
  offset?: number;
  errors?: string[];
}
