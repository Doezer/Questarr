import { describe, it, expect } from "vitest";
import { gameMatchesCollectionRules, isEmptyCollectionRules } from "../collection-rules.js";

const game = {
  title: "Doom Eternal",
  status: "downloaded",
  platforms: ["PC (Microsoft Windows)", "Xbox One"],
  genres: ["Shooter"],
  rating: 8.8,
  userRating: 9,
  releaseDate: "2020-03-20T00:00:00Z",
};

describe("gameMatchesCollectionRules", () => {
  it("matches when every set criterion holds", () => {
    expect(
      gameMatchesCollectionRules(game, {
        statuses: ["downloaded", "completed"],
        genres: ["shooter"],
        platforms: ["xbox one"],
        minRating: 8,
        minUserRating: 8.5,
        releaseYearFrom: 2020,
        releaseYearTo: 2020,
        titleContains: "ETERNAL",
      })
    ).toBe(true);
  });

  it.each([
    ["status", { statuses: ["wanted"] }],
    ["genre", { genres: ["Puzzle"] }],
    ["platform", { platforms: ["Nintendo Switch"] }],
    ["rating", { minRating: 9 }],
    ["user rating", { minUserRating: 9.5 }],
    ["year from", { releaseYearFrom: 2021 }],
    ["year to", { releaseYearTo: 2019 }],
    ["title", { titleContains: "quake" }],
  ])("rejects a game failing the %s rule", (_name, rules) => {
    expect(gameMatchesCollectionRules(game, rules)).toBe(false);
  });

  it("rejects unrated or undated games when a rating or year rule is set", () => {
    const bare = { ...game, rating: null, userRating: null, releaseDate: null };
    expect(gameMatchesCollectionRules(bare, { minRating: 1 })).toBe(false);
    expect(gameMatchesCollectionRules(bare, { minUserRating: 1 })).toBe(false);
    expect(gameMatchesCollectionRules(bare, { releaseYearFrom: 1990 })).toBe(false);
  });

  it("treats rules without criteria as empty", () => {
    expect(isEmptyCollectionRules({})).toBe(true);
    expect(isEmptyCollectionRules(null)).toBe(true);
    expect(isEmptyCollectionRules({ genres: [] })).toBe(true);
    expect(isEmptyCollectionRules({ minRating: 0 })).toBe(false);
  });
});
