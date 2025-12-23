import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, real, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const games = pgTable("games", {
  id: varchar("id").primaryKey(),
  igdbId: integer("igdb_id").unique(),
  title: text("title").notNull(),
  summary: text("summary"),
  coverUrl: text("cover_url"),
  releaseDate: text("release_date"),
  rating: real("rating"),
  platforms: text("platforms").array(),
  genres: text("genres").array(),
  screenshots: text("screenshots").array(),
  status: text("status", { enum: ["wanted", "owned", "completed", "downloading"] }).notNull().default("wanted"),
  addedAt: timestamp("added_at").defaultNow(),
  completedAt: timestamp("completed_at"),
});

export const indexers = pgTable("indexers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  url: text("url").notNull(),
  apiKey: text("api_key").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  priority: integer("priority").notNull().default(1),
  categories: text("categories").array().default([]), // Torznab categories to search
  rssEnabled: boolean("rss_enabled").notNull().default(true),
  autoSearchEnabled: boolean("auto_search_enabled").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const downloaders = pgTable("downloaders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  type: text("type", { enum: ["transmission", "rtorrent", "qbittorrent"] }).notNull(),
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
  label: text("label").default("GameRadarr"), // Deprecated - use category instead
  addStopped: boolean("add_stopped").default(false), // Add torrents in stopped/paused state
  removeCompleted: boolean("remove_completed").default(false), // Remove torrents after completion
  postImportCategory: text("post_import_category"), // Category to set after download completes
  settings: text("settings"), // JSON string for additional client-specific settings
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Validation schemas using drizzle-zod for runtime validation
export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export const insertGameSchema = createInsertSchema(games, {
  status: (schema) => schema.nullable().optional().transform((val) => val ?? "wanted"),
}).omit({
  id: true,
  addedAt: true,
  completedAt: true,
});

export const updateGameStatusSchema = z.object({
  status: z.enum(["wanted", "owned", "completed", "downloading"]),
  completedAt: z.date().optional(),
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

// Type definitions - using Drizzle's table inference for select types
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;

export type Game = typeof games.$inferSelect & {
  // Additional fields for Discovery games
  isReleased?: boolean;
  releaseYear?: number | null;
};

export type InsertGame = z.infer<typeof insertGameSchema>;

export type UpdateGameStatus = z.infer<typeof updateGameStatusSchema>;

export type Indexer = typeof indexers.$inferSelect;
export type InsertIndexer = z.infer<typeof insertIndexerSchema>;

export type Downloader = typeof downloaders.$inferSelect;
export type InsertDownloader = z.infer<typeof insertDownloaderSchema>;

// Application configuration type
export interface Config {
  igdb: {
    configured: boolean;
  };
}

// Torrent-related types shared between frontend and backend
export interface TorrentFile {
  name: string;
  size: number;
  progress: number; // 0-100
  priority: 'off' | 'low' | 'normal' | 'high';
  wanted: boolean;
}

export interface TorrentTracker {
  url: string;
  tier: number;
  status: 'working' | 'updating' | 'error' | 'inactive';
  seeders?: number;
  leechers?: number;
  lastAnnounce?: string;
  nextAnnounce?: string;
  error?: string;
}

export interface DownloadStatus {
  id: string;
  name: string;
  status: 'downloading' | 'seeding' | 'completed' | 'paused' | 'error';
  progress: number; // 0-100
  downloadSpeed?: number; // bytes per second
  uploadSpeed?: number; // bytes per second
  eta?: number; // seconds
  size?: number; // total bytes
  downloaded?: number; // bytes downloaded
  seeders?: number;
  leechers?: number;
  ratio?: number;
  error?: string;
}

export interface TorrentDetails extends DownloadStatus {
  hash?: string;
  addedDate?: string;
  completedDate?: string;
  downloadDir?: string;
  comment?: string;
  creator?: string;
  files: TorrentFile[];
  trackers: TorrentTracker[];
  totalPeers?: number;
  connectedPeers?: number;
}
