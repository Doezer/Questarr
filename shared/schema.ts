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
  type: text("type", { enum: ["transmission", "rtorrent", "utorrent", "vuze", "qbittorrent"] }).notNull(),
  url: text("url").notNull(),
  username: text("username"),
  password: text("password"),
  enabled: boolean("enabled").notNull().default(true),
  priority: integer("priority").notNull().default(1),
  downloadPath: text("download_path"),
  category: text("category").default("games"),
  settings: text("settings"), // JSON string for client-specific settings
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Validation schemas using drizzle-zod for runtime validation
// Note: drizzle-zod 0.8.x uses zod/v4 internally, but schemas work at runtime
export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

// For insertGameSchema, we define it manually using plain zod to avoid zod/v4 compatibility issues
export const insertGameSchema = z.object({
  igdbId: z.number().nullable().optional(),
  title: z.string(),
  summary: z.string().nullable().optional(),
  coverUrl: z.string().nullable().optional(),
  releaseDate: z.string().nullable().optional(),
  rating: z.number().nullable().optional(),
  platforms: z.array(z.string()).nullable().optional(),
  genres: z.array(z.string()).nullable().optional(),
  screenshots: z.array(z.string()).nullable().optional(),
  status: z.enum(["wanted", "owned", "completed", "downloading"]).nullable().transform(val => val ?? "wanted"),
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
// and explicit interfaces for insert types to avoid zod/v4 compatibility issues
export type User = typeof users.$inferSelect;
export type InsertUser = {
  username: string;
  password: string;
};

export type Game = typeof games.$inferSelect & {
  // Additional fields for Discovery games
  isReleased?: boolean;
  releaseYear?: number | null;
};

export type InsertGame = {
  igdbId?: number | null;
  title: string;
  summary?: string | null;
  coverUrl?: string | null;
  releaseDate?: string | null;
  rating?: number | null;
  platforms?: string[] | null;
  genres?: string[] | null;
  screenshots?: string[] | null;
  status?: "wanted" | "owned" | "completed" | "downloading" | null;
};

export type UpdateGameStatus = z.infer<typeof updateGameStatusSchema>;

export type Indexer = typeof indexers.$inferSelect;
export type InsertIndexer = {
  name: string;
  url: string;
  apiKey: string;
  enabled?: boolean;
  priority?: number;
  categories?: string[] | null;
  rssEnabled?: boolean;
  autoSearchEnabled?: boolean;
};

export type Downloader = typeof downloaders.$inferSelect;
export type InsertDownloader = {
  name: string;
  type: "transmission" | "rtorrent" | "utorrent" | "vuze" | "qbittorrent";
  url: string;
  username?: string | null;
  password?: string | null;
  enabled?: boolean;
  priority?: number;
  downloadPath?: string | null;
  category?: string | null;
  settings?: string | null;
};

// Application configuration type
export interface Config {
  database: {
    connected: boolean;
    url?: string;
  };
  igdb: {
    configured: boolean;
    clientId?: string;
  };
  server: {
    port: number;
    host: string;
    nodeEnv: string;
  };
}
