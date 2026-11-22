import { describe, expect, it } from "vitest";
import {
  distinctValues,
  filterRouletteGames,
  matchesMood,
  pickWeighted,
  rouletteWeight,
  type RouletteFilters,
  type RouletteGame,
} from "../backlog-roulette";

function game(id: string, extra: Partial<RouletteGame> = {}): RouletteGame {
  return { id, hidden: false, status: "owned", ...extra } as RouletteGame;
}

const open: RouletteFilters = {
  pool: "owned",
  maxHours: null,
  genre: null,
  platform: null,
  mood: "any",
  installedOnly: false,
};

describe("filterRouletteGames", () => {
  it("drops hidden games and other pools", () => {
    const games = [game("a"), game("h", { hidden: true }), game("w", { status: "wanted" })];
    expect(filterRouletteGames(games, open).map((g) => g.id)).toEqual(["a"]);
    expect(filterRouletteGames(games, { ...open, pool: "all" }).map((g) => g.id)).toEqual([
      "a",
      "w",
    ]);
  });

  it("filters by length, genre, platform and installed state", () => {
    const games = [
      game("short", { timeToBeatNormally: 4, genres: ["Puzzle"], platforms: ["PC"] }),
      game("long", { timeToBeatNormally: 40, genres: ["RPG"], platforms: ["PC"] }),
      game("unknown", { genres: ["Puzzle"], platforms: ["Switch"], libraryPath: "/g/x" }),
    ];
    const ids = (f: Partial<RouletteFilters>) =>
      filterRouletteGames(games, { ...open, ...f }).map((g) => g.id);
    expect(ids({ maxHours: 5 })).toEqual(["short"]);
    expect(ids({ genre: "Puzzle" })).toEqual(["short", "unknown"]);
    expect(ids({ platform: "Switch" })).toEqual(["unknown"]);
    expect(ids({ installedOnly: true })).toEqual(["unknown"]);
  });
});

describe("matchesMood", () => {
  it("recognises relaxing, short and co-op games", () => {
    expect(matchesMood(game("p", { genres: ["Puzzle"] }), "relaxing")).toBe(true);
    expect(matchesMood(game("h", { genres: ["Puzzle"], themes: ["Horror"] }), "relaxing")).toBe(
      false
    );
    expect(matchesMood(game("s", { timeToBeatNormally: 3 }), "short")).toBe(true);
    expect(matchesMood(game("n"), "short")).toBe(false);
    expect(matchesMood(game("c", { gameModes: ["Co-operative"] }), "coop")).toBe(true);
    expect(matchesMood(game("x"), "coop")).toBe(false);
  });
});

describe("rouletteWeight", () => {
  const now = Date.parse("2026-11-22T00:00:00Z");
  it("is uniform for random", () => {
    expect(rouletteWeight(game("a"), "random", now)).toBe(1);
  });
  it("favours games that waited longer", () => {
    const old = game("o", { addedAt: new Date("2025-11-22T00:00:00Z") });
    const fresh = game("f", { addedAt: new Date("2026-11-21T00:00:00Z") });
    expect(rouletteWeight(old, "oldest", now)).toBeGreaterThan(
      rouletteWeight(fresh, "oldest", now)
    );
  });
  it("favours shorter games, unknown lengths last", () => {
    const w = (h?: number) => rouletteWeight(game("g", { timeToBeatNormally: h }), "quick", now);
    expect(w(2)).toBeGreaterThan(w(20));
    expect(w(20)).toBeGreaterThan(w(undefined));
  });
  it("favours higher ratings, user rating first", () => {
    const w = (extra: Partial<RouletteGame>) => rouletteWeight(game("g", extra), "rated", now);
    expect(w({ rating: 90 })).toBeGreaterThan(w({ rating: 60 }));
    expect(w({ userRating: 9, rating: 20 })).toBeGreaterThan(w({ rating: 80 }));
  });
});

describe("pickWeighted", () => {
  it("returns undefined for no items and follows the ticket index for equal weights", () => {
    expect(
      pickWeighted(
        [],
        () => 1,
        () => 0
      )
    ).toBeUndefined();
    // Equal weights give 1000 tickets each: 0-999 a, 1000-1999 b, 2000-2999 c.
    expect(
      pickWeighted(
        ["a", "b", "c"],
        () => 1,
        () => 0
      )
    ).toBe("a");
    expect(
      pickWeighted(
        ["a", "b", "c"],
        () => 1,
        () => 1000
      )
    ).toBe("b");
    expect(
      pickWeighted(
        ["a", "b", "c"],
        () => 1,
        () => 2999
      )
    ).toBe("c");
  });
  it("asks for a draw below the total ticket count", () => {
    let seen = 0;
    pickWeighted(
      ["a", "b"],
      () => 1,
      (limit) => ((seen = limit), 0)
    );
    expect(seen).toBe(2000);
  });
  it("follows the weights", () => {
    const weights: Record<string, number> = { a: 1, b: 9 };
    // a gets ~111 tickets, b gets 1000.
    expect(
      pickWeighted(
        ["a", "b"],
        (k) => weights[k] ?? 0,
        () => 50
      )
    ).toBe("a");
    expect(
      pickWeighted(
        ["a", "b"],
        (k) => weights[k] ?? 0,
        () => 500
      )
    ).toBe("b");
  });
  it("falls back to uniform when no weight is usable", () => {
    expect(
      pickWeighted(
        ["a", "b"],
        () => NaN,
        (limit) => limit - 1
      )
    ).toBe("b");
  });
});

describe("distinctValues", () => {
  it("returns sorted unique values", () => {
    const games = [game("a", { genres: ["RPG", "Puzzle"] }), game("b", { genres: ["RPG"] })];
    expect(distinctValues(games, "genres")).toEqual(["Puzzle", "RPG"]);
  });
});
