import { describe, expect, it } from "vitest";
import {
  describeRecommendationReason,
  primaryRecommendationReason,
} from "@/lib/recommendation-reasons";

describe("recommendation reasons", () => {
  it("mentions the user's rating when a similar game was rated", () => {
    expect(describeRecommendationReason({ kind: "similar", label: "Hades", userRating: 9 })).toBe(
      "Because you rated Hades 9/10"
    );
    expect(describeRecommendationReason({ kind: "similar", label: "Hades", userRating: 8.5 })).toBe(
      "Because you rated Hades 8.5/10"
    );
    expect(describeRecommendationReason({ kind: "similar", label: "Hades" })).toBe(
      "Because you like Hades"
    );
  });

  it("uses the first reason as the primary one", () => {
    expect(primaryRecommendationReason(undefined)).toBeNull();
    expect(primaryRecommendationReason({ score: 1, reasons: [] })).toBeNull();
    expect(
      primaryRecommendationReason({ score: 1, reasons: [{ kind: "genre", label: "Roguelike" }] })
    ).toBe("You enjoy Roguelike games");
  });
});
