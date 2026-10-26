import { describe, it, expect } from "vitest";
import { sortLibraryGames } from "../src/lib/game-sort";
import { type Game } from "../../shared/schema";

const makeGame = (id: string, releaseDate: string | null) => ({ id, releaseDate }) as Game;

describe("sortLibraryGames released-desc", () => {
  it("puts released games first, then upcoming (soonest first), then undated", () => {
    const games = [
      makeGame("none", null),
      makeGame("far", "2099-12-31"),
      makeGame("old", "2020-01-01"),
      makeGame("soon", "2098-01-01"),
      makeGame("new", "2024-01-01"),
    ];
    expect(sortLibraryGames(games, "released-desc").map((g) => g.id)).toEqual([
      "new",
      "old",
      "soon",
      "far",
      "none",
    ]);
  });
});
