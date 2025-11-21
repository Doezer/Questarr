import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { type Game, type InsertGame } from "@shared/schema"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
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
