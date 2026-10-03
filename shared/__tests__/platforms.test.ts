// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  RAWG_ID_TO_CANONICAL_PLATFORM,
  canonicalPlatformsForRawgIds,
  matchesSelectedPlatform,
  visiblePlatforms,
} from "../platforms";

// Verified RAWG platform ids (the /api/rawg/platforms namespace), including the
// unmapped "Nintendo Switch 2", which release titles cannot express.
const PLATFORMS = [
  { id: 7, name: "Nintendo Switch" },
  { id: 4, name: "PC" },
  { id: 187, name: "PlayStation 5" },
  { id: 508, name: "Nintendo Switch 2" },
];

describe("canonicalPlatformsForRawgIds", () => {
  it("maps selected RAWG ids to release labels", () => {
    expect(canonicalPlatformsForRawgIds([4, 7])).toEqual(["PC", "Switch"]);
  });

  it("returns labels in the order the ids were selected", () => {
    expect(canonicalPlatformsForRawgIds([7, 4])).toEqual(["Switch", "PC"]);
  });

  it("ignores ids with no release label and dedupes", () => {
    expect(canonicalPlatformsForRawgIds([508, 7, 7])).toEqual(["Switch"]);
  });

  it("treats a non-array payload as an empty selection", () => {
    expect(canonicalPlatformsForRawgIds("oops")).toEqual([]);
    expect(canonicalPlatformsForRawgIds(42)).toEqual([]);
    expect(canonicalPlatformsForRawgIds({ a: 1 })).toEqual([]);
  });
});

describe("visiblePlatforms", () => {
  it("narrows the list to the selected platforms only", () => {
    expect(visiblePlatforms(PLATFORMS, [7, 187]).map((p) => p.id)).toEqual([7, 187]);
  });

  it("shows every platform when nothing is selected", () => {
    expect(visiblePlatforms(PLATFORMS, [])).toHaveLength(4);
  });

  it("does not throw on a non-array selection and shows everything", () => {
    expect(visiblePlatforms(PLATFORMS, 42)).toHaveLength(4);
  });

  it("keeps an unmapped selected id visible", () => {
    expect(visiblePlatforms(PLATFORMS, [508]).map((p) => p.id)).toEqual([508]);
  });
});

describe("matchesSelectedPlatform", () => {
  it("allows every release when nothing is selected", () => {
    expect(matchesSelectedPlatform("PS5", [])).toBe(true);
    expect(matchesSelectedPlatform(undefined, [])).toBe(true);
  });

  it("keeps releases matching a selected platform", () => {
    expect(matchesSelectedPlatform("Switch", [7])).toBe(true);
    expect(matchesSelectedPlatform("PS5", [187])).toBe(true);
  });

  it("drops releases outside the selection", () => {
    expect(matchesSelectedPlatform("PS5", [7])).toBe(false);
    expect(matchesSelectedPlatform("Switch", [4, 187])).toBe(false);
  });

  it("keeps untagged releases when PC is selected", () => {
    expect(matchesSelectedPlatform(undefined, [4])).toBe(true);
  });

  it("treats Xbox as covering Xbox Series releases", () => {
    // The original Xbox (RAWG id 80) maps to the legacy "Xbox" umbrella so
    // selecting it still covers every Xbox generation, while selecting one
    // generation (Xbox Series, 186) does not reach back to the umbrella.
    expect(matchesSelectedPlatform("Xbox Series", [80])).toBe(true);
    expect(matchesSelectedPlatform("Xbox", [186])).toBe(false);
  });

  it("does not hide everything when the selection has no release label", () => {
    expect(matchesSelectedPlatform("Switch", [508])).toBe(true);
  });

  it("treats a non-array selection as no restriction", () => {
    expect(matchesSelectedPlatform("PS5", "oops")).toBe(true);
  });
});

describe("RAWG_ID_TO_CANONICAL_PLATFORM", () => {
  it("only maps ids to labels parseReleaseMetadata can emit", () => {
    const labels = Object.values(RAWG_ID_TO_CANONICAL_PLATFORM);
    expect(labels).toContain("PC");
    expect(labels).toContain("Switch");
    expect(new Set(labels).size).toBe(labels.length);
  });
});
