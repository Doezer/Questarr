import { describe, expect, it } from "vitest";
import {
  buildTasteProfile,
  gameAffinityWeight,
  rankRecommendations,
  ratingMultiplier,
  scoreCandidate,
  topFeatures,
  type TasteGame,
} from "../recommendations";

const hades: TasteGame = {
  igdbId: 1,
  title: "Hades",
  status: "completed",
  userRating: 9.5,
  genres: ["Roguelike", "Action"],
  themes: ["Fantasy"],
  developers: ["Supergiant"],
  gameModes: ["Single player"],
};
const sims: TasteGame = {
  igdbId: 2,
  title: "The Sims",
  status: "playing",
  userRating: 2,
  genres: ["Simulator"],
  themes: ["Sandbox"],
  developers: ["Maxis"],
};

describe("gameAffinityWeight", () => {
  it("weights liked completed games above shelved ones, and low ratings negatively", () => {
    expect(ratingMultiplier(10)).toBe(2);
    expect(ratingMultiplier(5)).toBe(0);
    expect(ratingMultiplier(null)).toBe(1);
    expect(gameAffinityWeight({ status: "completed", userRating: 9 })).toBeGreaterThan(
      gameAffinityWeight({ status: "shelved", userRating: 9 })
    );
    expect(gameAffinityWeight({ status: "playing", userRating: 2 })).toBeLessThan(0);
  });
});

describe("buildTasteProfile", () => {
  it("is empty for an empty library", () => {
    expect(buildTasteProfile([]).empty).toBe(true);
  });

  it("is not empty when only developers or themes carry a positive signal", () => {
    const profile = buildTasteProfile([
      { title: "No id", status: "completed", themes: ["Fantasy"], developers: ["Supergiant"] },
    ]);
    expect(profile.anchors).toEqual([]);
    expect(profile.empty).toBe(false);
    expect(
      buildTasteProfile([{ title: "Modes", status: "completed", gameModes: ["Co-op"] }]).empty
    ).toBe(true);
    expect(
      buildTasteProfile([{ title: "Meh", status: "owned", userRating: 5, genres: ["A"] }]).empty
    ).toBe(true);
  });

  it("normalizes affinities, keeps anchors and pushes disliked features negative", () => {
    const profile = buildTasteProfile([hades, sims]);
    expect(profile.genres.get("Roguelike")).toBe(1);
    expect(profile.genres.get("Simulator")).toBeLessThan(0);
    expect(profile.anchors.map((a) => a.title)).toEqual(["Hades"]);
    expect(topFeatures(profile, "genres", 5)).toEqual(["Action", "Roguelike"].sort());
    expect(profile.empty).toBe(false);
  });
});

describe("scoreCandidate / rankRecommendations", () => {
  const profile = buildTasteProfile([hades, sims]);

  it("explains a similar game first, then the matching features", () => {
    const rec = scoreCandidate(
      {
        igdbId: 10,
        title: "Dead Cells",
        genres: ["Roguelike"],
        developers: ["Supergiant"],
        similarToIgdbIds: [1],
        aggregatedRating: 90,
      },
      profile
    );
    expect(rec.score).toBeGreaterThan(0);
    expect(rec.reasons[0]).toMatchObject({ kind: "similar", label: "Hades", userRating: 9.5 });
    expect(rec.reasons.length).toBeLessThanOrEqual(3);
  });

  it("scores disliked features below zero and drops them from the ranking", () => {
    const candidates = [
      { igdbId: 11, title: "Sims 5", genres: ["Simulator"], developers: ["Maxis"] },
      { igdbId: 12, title: "Roguelike B", genres: ["Roguelike"] },
      { igdbId: 13, title: "Roguelike A", genres: ["Roguelike"], aggregatedRating: 95 },
      { igdbId: 14, title: "Owned", genres: ["Roguelike"] },
      { igdbId: 12, title: "Duplicate", genres: ["Roguelike"] },
    ];
    const ranked = rankRecommendations(candidates, profile, {
      excludeIgdbIds: new Set([14]),
      limit: 10,
    });
    expect(ranked.map((r) => r.candidate.igdbId)).toEqual([13, 12]);
  });

  it("honours the limit", () => {
    const candidates = [1, 2, 3].map((i) => ({
      igdbId: 100 + i,
      title: `G${i}`,
      genres: ["Roguelike"],
    }));
    expect(rankRecommendations(candidates, profile, { limit: 2 })).toHaveLength(2);
  });
});
