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

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export const insertGameSchema = createInsertSchema(games).omit({
  addedAt: true,
  id: true,
  completedAt: true,
}).extend({
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

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
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
