import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { type Game, type InsertGame } from "@shared/schema"
import type { z } from "zod"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Formats bytes to a human-readable string (e.g., "1.5 GB")
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

/**
 * Creates a type-safe wrapper for zodResolver to work with drizzle-zod 0.8.x schemas.
 * 
 * drizzle-zod 0.8.x uses zod/v4 types internally, which are not directly compatible
 * with the standard zod types expected by @hookform/resolvers. This helper provides
 * the necessary type assertion while maintaining type safety for the output type.
 * 
 * @param schema - A drizzle-zod schema or any zod-compatible schema
 * @returns The schema cast to a standard zod type for use with zodResolver
 */
export function asZodType<T>(schema: unknown): z.ZodType<T> {
  return schema as z.ZodType<T>;
}

/**
 * Maps a Game object to an InsertGame object by filtering out fields
 * that should not be sent to the POST /api/games endpoint.
 * 
 * Removes:
 * - id: Generated server-side
 * - isReleased: Client-only field for Discovery games
 * - inCollection: Client-only field for search results
 * - releaseYear: Client-only field for Discovery games
 * - addedAt: Generated server-side
 * - completedAt: Generated server-side
 */
export function mapGameToInsertGame(game: Game): InsertGame {
  // Pick only the fields that are part of InsertGame schema
  return {
    igdbId: game.igdbId,
    title: game.title,
    summary: game.summary,
    coverUrl: game.coverUrl,
    releaseDate: game.releaseDate,
    rating: game.rating,
    platforms: game.platforms,
    genres: game.genres,
    screenshots: game.screenshots,
    status: game.status,
  };
}
