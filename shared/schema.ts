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

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export const insertGameSchema = createInsertSchema(games).omit({
  addedAt: true,
  id: true,
});

export const updateGameStatusSchema = z.object({
  status: z.enum(["wanted", "owned", "completed", "downloading"]),
  completedAt: z.date().optional(),
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
