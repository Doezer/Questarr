import { describe, expect, it, vi } from "vitest";
import {
  clearRecommendationsCache,
  getCachedRecommendations,
  recommendationLibrarySignature,
} from "../recommendations-cache.js";

const game = {
  id: "g1",
  igdbId: 1,
  status: "owned",
  userRating: null,
  hidden: false,
  genres: ["A"],
  themes: ["B"],
  developers: ["Dev"],
  gameModes: ["Single player"],
};

describe("recommendationLibrarySignature", () => {
  it("is stable for an unchanged library, whatever the order", () => {
    const other = { ...game, id: "g2", igdbId: 2 };
    expect(recommendationLibrarySignature([game, other])).toBe(
      recommendationLibrarySignature([other, game])
    );
  });

  it.each([
    ["status", { status: "completed" }],
    ["rating", { userRating: 9 }],
    ["hidden", { hidden: true }],
    ["genres", { genres: ["C"] }],
    ["themes", { themes: ["C"] }],
    ["developers", { developers: ["Other"] }],
    ["game modes", { gameModes: ["Co-op"] }],
  ])("changes when the %s change", (_label, patch) => {
    expect(recommendationLibrarySignature([{ ...game, ...patch }])).not.toBe(
      recommendationLibrarySignature([game])
    );
  });
});

describe("getCachedRecommendations", () => {
  it("reuses the result for the same signature and recomputes when it changes", async () => {
    clearRecommendationsCache();
    const compute = vi.fn().mockResolvedValue([{ id: "x" }]);
    await getCachedRecommendations("u1", "sig-a", compute);
    await getCachedRecommendations("u1", "sig-a", compute);
    expect(compute).toHaveBeenCalledTimes(1);
    await getCachedRecommendations("u1", "sig-b", compute);
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("does not keep an empty result", async () => {
    clearRecommendationsCache();
    const compute = vi.fn().mockResolvedValue([]);
    await getCachedRecommendations("u2", "sig", compute);
    await getCachedRecommendations("u2", "sig", compute);
    expect(compute).toHaveBeenCalledTimes(2);
  });
});
