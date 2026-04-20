import { describe, it, expect } from "vitest";
import { sortGames } from "../src/pages/wishlist";
import { type Game } from "../../shared/schema";

function makeGame(overrides: Partial<Game> = {}): Game {
  return {
    id: "1",
    igdbId: 1,
    title: "Game",
    status: "wanted",
    coverUrl: null,
    releaseDate: null,
    addedAt: null,
    summary: null,
    rating: null,
    platforms: null,
    genres: null,
    screenshots: null,
    steamAppId: null,
    ...overrides,
  } as Game;
}

describe("sortGames", () => {
  describe("release-asc", () => {
    it("sorts by release date ascending", () => {
      const a = makeGame({ id: "a", releaseDate: "2022-01-01" });
      const b = makeGame({ id: "b", releaseDate: "2024-06-15" });
      expect(sortGames([b, a], "release-asc").map((g) => g.id)).toEqual(["a", "b"]);
    });

    it("pushes games with no release date to the end", () => {
      const a = makeGame({ id: "a", releaseDate: "2022-01-01" });
      const noDate = makeGame({ id: "noDate", releaseDate: null });
      expect(sortGames([noDate, a], "release-asc").map((g) => g.id)).toEqual(["a", "noDate"]);
    });

    it("is stable when both games have no release date (returns 0)", () => {
      const a = makeGame({ id: "a", releaseDate: null });
      const b = makeGame({ id: "b", releaseDate: null });
      const result = sortGames([a, b], "release-asc");
      expect(result.map((g) => g.id)).toEqual(["a", "b"]);
    });
  });

  describe("release-desc", () => {
    it("sorts by release date descending", () => {
      const a = makeGame({ id: "a", releaseDate: "2022-01-01" });
      const b = makeGame({ id: "b", releaseDate: "2024-06-15" });
      expect(sortGames([a, b], "release-desc").map((g) => g.id)).toEqual(["b", "a"]);
    });

    it("is stable when both games have no release date (returns 0)", () => {
      const a = makeGame({ id: "a", releaseDate: null });
      const b = makeGame({ id: "b", releaseDate: null });
      const result = sortGames([a, b], "release-desc");
      expect(result.map((g) => g.id)).toEqual(["a", "b"]);
    });
  });

  describe("added-desc", () => {
    it("sorts by addedAt descending", () => {
      const old = makeGame({ id: "old", addedAt: new Date("2023-01-01") });
      const recent = makeGame({ id: "recent", addedAt: new Date("2024-06-15") });
      expect(sortGames([old, recent], "added-desc").map((g) => g.id)).toEqual(["recent", "old"]);
    });

    it("is stable when both games have no addedAt (returns 0)", () => {
      const a = makeGame({ id: "a", addedAt: null });
      const b = makeGame({ id: "b", addedAt: null });
      const result = sortGames([a, b], "added-desc");
      expect(result.map((g) => g.id)).toEqual(["a", "b"]);
    });
  });

  describe("title-asc", () => {
    it("sorts by title alphabetically", () => {
      const z = makeGame({ id: "z", title: "Zelda" });
      const a = makeGame({ id: "a", title: "Abe's Odyssey" });
      expect(sortGames([z, a], "title-asc").map((g) => g.id)).toEqual(["a", "z"]);
    });
  });

  it("does not mutate the original array", () => {
    const games = [makeGame({ id: "b", title: "B" }), makeGame({ id: "a", title: "A" })];
    const original = [...games];
    sortGames(games, "title-asc");
    expect(games.map((g) => g.id)).toEqual(original.map((g) => g.id));
  });
});
