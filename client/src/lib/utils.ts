import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { type Game, type InsertGame } from "@shared/schema";
import type { z } from "zod";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
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
 * Checks if a game ID is a temporary ID from IGDB discovery results.
 * Temporary IDs are prefixed with 'igdb-' followed by numeric digits.
 */
export function isDiscoveryId(id: string | number | null | undefined): boolean {
  if (typeof id !== "string") return false;
  return id.startsWith("igdb-");
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
    releaseDate: game.releaseDate || null,
    rating: game.rating,
    platforms: game.platforms,
    genres: game.genres,
    screenshots: game.screenshots,
    status: game.status,
    hidden: game.hidden || false,
  };
}

export type EnabledPriorityNamed = {
  enabled: boolean;
  priority: number;
  name: string;
};

/**
 * Comparator for objects with enabled, priority, and name fields.
 *
 * Sorts items in the following order:
 * - Enabled items first (enabled: true before enabled: false)
 * - Then by priority in ascending order (lower numbers first)
 * - Then by name in alphabetical order (case-insensitive)
 *
 * @typeParam T - An object type that includes enabled, priority, and name fields.
 * @param a - The first value to compare.
 * @param b - The second value to compare.
 * @returns A negative number if a should come before b, a positive number if a should come after b, or 0 if they are considered equal.
 */
export function compareEnabledPriorityName<T extends EnabledPriorityNamed>(a: T, b: T): number {
  if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;

  const priorityDiff = a.priority - b.priority;
  if (priorityDiff !== 0) return priorityDiff;

  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

/**
 * Ensures a URL is using HTTP or HTTPS protocols to prevent XSS attacks (e.g. via javascript: protocol).
 * Returns the original URL if safe, otherwise returns "#".
 */
export function safeUrl(url: string, fallback = "#"): string {
  try {
    const origin = typeof window !== "undefined" ? window.location.origin : "http://localhost";
    const parsedUrl = new URL(url, origin);
    if (parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:") {
      return url;
    }
  } catch {
    // Ignore invalid URLs
  }
  return fallback;
}
