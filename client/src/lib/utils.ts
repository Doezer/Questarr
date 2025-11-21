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
 * - addedAt: Generated server-side
 * - completedAt: Generated server-side
 */
export function mapGameToInsertGame(game: Game): InsertGame {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { id, isReleased, addedAt, completedAt, ...insertData } = game;
  return insertData as InsertGame;
}
