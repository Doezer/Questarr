import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  varchar,
  integer,
  real,
  boolean,
  timestamp,
  serial,
  bigint,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
});

export const userSettings = pgTable("user_settings", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  userId: varchar("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull()
    .unique(),
  autoSearchEnabled: boolean("auto_search_enabled").notNull().default(true),
  autoDownloadEnabled: boolean("auto_download_enabled").notNull().default(false),
  notifyMultipleDownloads: boolean("notify_multiple_downloads").notNull().default(true),
  notifyUpdates: boolean("notify_updates").notNull().default(true),
  searchIntervalHours: integer("search_interval_hours").notNull().default(6),
  igdbRateLimitPerSecond: integer("igdb_rate_limit_per_second").notNull().default(3),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const systemConfig = pgTable("system_config", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const games = pgTable("games", {
  id: varchar("id").primaryKey(),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }),
  igdbId: integer("igdb_id"), // Removed unique constraint to allow multiple users to have the same game
  title: text("title").notNull(),
  summary: text("summary"),
  coverUrl: text("cover_url"),
  releaseDate: text("release_date"),
  rating: real("rating"),
  platforms: text("platforms").array(),
  genres: text("genres").array(),
  publishers: text("publishers").array(),
  developers: text("developers").array(),
  screenshots: text("screenshots").array(),
  status: text("status", { enum: ["wanted", "owned", "completed", "downloading"] })
    .notNull()
    .default("wanted"),
  originalReleaseDate: text("original_release_date"),
  releaseStatus: text("release_status", {
    enum: ["released", "upcoming", "delayed", "tbd"],
  }).default("upcoming"),
  hidden: boolean("hidden").default(false),
  addedAt: timestamp("added_at").defaultNow(),
  completedAt: timestamp("completed_at"),
});

export const indexers = pgTable("indexers", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  url: text("url").notNull(),
  apiKey: text("api_key").notNull(),
  protocol: text("protocol", { enum: ["torznab", "newznab"] })
    .notNull()
    .default("torznab"), // Protocol type
  enabled: boolean("enabled").notNull().default(true),
  priority: integer("priority").notNull().default(1),
  categories: text("categories").array().default([]), // Torznab/Newznab categories to search
  rssEnabled: boolean("rss_enabled").notNull().default(true),
  autoSearchEnabled: boolean("auto_search_enabled").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const downloaders = pgTable("downloaders", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  type: text("type", {
    enum: ["transmission", "rtorrent", "qbittorrent", "sabnzbd", "nzbget"],
  }).notNull(),
  url: text("url").notNull(), // Host URL (without port for rTorrent/qBittorrent)
  port: integer("port"), // Port number (used by rTorrent and qBittorrent)
  useSsl: boolean("use_ssl").default(false), // Use SSL/TLS connection
  urlPath: text("url_path"), // URL path to XMLRPC endpoint (rTorrent: typically "RPC2" or "plugins/rpc/rpc.php")
  username: text("username"),
  password: text("password"),
  enabled: boolean("enabled").notNull().default(true),
  priority: integer("priority").notNull().default(1),
  downloadPath: text("download_path"),
  category: text("category").default("games"), // Category/label in the downloader
  label: text("label").default("Questarr"), // Deprecated - use category instead
  addStopped: boolean("add_stopped").default(false), // Add torrents in stopped/paused state
  removeCompleted: boolean("remove_completed").default(false), // Remove torrents after completion
  postImportCategory: text("post_import_category"), // Category to set after download completes
  settings: text("settings"), // JSON string for additional client-specific settings
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Track downloads associated with games for completion monitoring
export const gameDownloads = pgTable("game_downloads", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  gameId: varchar("game_id")
    .notNull()
    .references(() => games.id, { onDelete: "cascade" }),
  downloaderId: varchar("downloader_id")
    .notNull()
    .references(() => downloaders.id, { onDelete: "cascade" }),
  downloadType: text("download_type", { enum: ["torrent", "usenet"] })
    .notNull()
    .default("torrent"),
  downloadHash: text("download_hash").notNull(), // Hash/ID from the downloader client (torrent hash or NZB ID)
  downloadTitle: text("download_title").notNull(),
  status: text("status", { enum: ["downloading", "completed", "failed", "paused"] })
    .notNull()
    .default("downloading"),
  addedAt: timestamp("added_at").defaultNow(),
  completedAt: timestamp("completed_at"),
});

// Legacy table name for backward compatibility during migration
export const legacy_gameDownloads = gameDownloads;

export const notifications = pgTable("notifications", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }), // Optional if we want global notifications too
  type: text("type", { enum: ["info", "success", "warning", "error", "delayed"] }).notNull(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  read: boolean("read").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

// Drizzle migrations tracking table (used in production)
// Including this in schema allows db:push to work in dev without conflicts
export const drizzleMigrations = pgTable("__drizzle_migrations", {
  id: serial("id").primaryKey(),
  hash: text("hash").notNull().unique(),
  createdAt: bigint("created_at", { mode: "number" }),
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

// Type definitions - using Drizzle's table inference for select types
export type User = typeof users.$inferSelect;
export type InsertUser = typeof insertUserSchema["_output"];

export type Game = typeof games.$inferSelect & {
  // Additional fields for Discovery games
  isReleased?: boolean;
  releaseYear?: number | null;
};

export type InsertGame = typeof insertGameSchema["_output"];

export type UpdateGameStatus = typeof updateGameStatusSchema["_output"];

export type Indexer = typeof indexers.$inferSelect;
export type InsertIndexer = typeof insertIndexerSchema["_output"];

export type Downloader = typeof downloaders.$inferSelect;
export type InsertDownloader = typeof insertDownloaderSchema["_output"];

export type GameDownload = typeof gameDownloads.$inferSelect;
export type InsertGameDownload = typeof insertGameDownloadSchema["_output"];

// Legacy type names for backward compatibility
export type GameDownloadLegacy = GameDownload;
export type InsertGameDownloadLegacy = InsertGameDownload;

export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = typeof insertNotificationSchema["_output"];

export type UserSettings = typeof userSettings.$inferSelect;
export type InsertUserSettings = typeof insertUserSettingsSchema["_output"];
export type UpdateUserSettings = typeof updateUserSettingsSchema["_output"];

// Application configuration type
export interface Config {
  igdb: {
    configured: boolean;
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
