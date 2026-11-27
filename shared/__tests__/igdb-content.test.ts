import { describe, expect, it } from "vitest";
import { igdbContentSlotCategory, resolveIgdbContentSlotCategory } from "../igdb-content.js";

describe("IGDB content slot categories", () => {
  it.each([
    [1, "dlc"],
    [2, "dlc"],
    [4, "dlc"],
    [13, "packs"],
    [14, "update"],
    [5, "extra"],
    [6, "extra"],
    [7, "extra"],
  ] as const)("maps IGDB category %i to %s", (igdbCategory, expected) => {
    expect(igdbContentSlotCategory(igdbCategory)).toBe(expected);
  });

  it("preserves a cached Extra category when numeric IGDB metadata is missing", () => {
    expect(
      resolveIgdbContentSlotCategory({ cachedCategory: "extra", fallbackIgdbCategory: 2 })
    ).toBe("extra");
  });

  it("prefers live IGDB metadata over a stale cached category", () => {
    expect(
      resolveIgdbContentSlotCategory({
        liveGameType: 14,
        cachedIgdbCategory: 2,
        cachedCategory: "dlc",
        fallbackIgdbCategory: 2,
      })
    ).toBe("update");
  });
});
