// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  IGDB_ID_TO_CANONICAL_PLATFORM,
  canonicalPlatformsForIgdbIds,
  matchesSelectedIgdbPlatform,
  visibleIgdbPlatforms,
} from "../platforms";

const PLATFORMS = [
  { id: 130, name: "Nintendo Switch" },
  { id: 6, name: "PC (Microsoft Windows)" },
  { id: 167, name: "PlayStation 5" },
  { id: 508, name: "Nintendo Switch 2" },
];

describe("canonicalPlatformsForIgdbIds", () => {
  it("maps selected IGDB ids to release labels", () => {
    expect(canonicalPlatformsForIgdbIds([6, 130])).toEqual(["PC", "Switch"]);
  });

  it("returns labels in the order the ids were selected", () => {
    expect(canonicalPlatformsForIgdbIds([130, 6])).toEqual(["Switch", "PC"]);
  });

  it("ignores ids with no release label and dedupes", () => {
    expect(canonicalPlatformsForIgdbIds([508, 130, 130])).toEqual(["Switch"]);
  });

  it("treats a non-array payload as an empty selection", () => {
    expect(canonicalPlatformsForIgdbIds("oops")).toEqual([]);
    expect(canonicalPlatformsForIgdbIds(42)).toEqual([]);
    expect(canonicalPlatformsForIgdbIds({ a: 1 })).toEqual([]);
  });
});

describe("visibleIgdbPlatforms", () => {
  it("narrows the list to the selected platforms only", () => {
    expect(visibleIgdbPlatforms(PLATFORMS, [130, 167]).map((p) => p.id)).toEqual([130, 167]);
  });

  it("shows every platform when nothing is selected", () => {
    expect(visibleIgdbPlatforms(PLATFORMS, [])).toHaveLength(4);
  });

  it("does not throw on a non-array selection and shows everything", () => {
    expect(visibleIgdbPlatforms(PLATFORMS, 42)).toHaveLength(4);
  });

  it("keeps an unmapped selected id visible", () => {
    expect(visibleIgdbPlatforms(PLATFORMS, [508]).map((p) => p.id)).toEqual([508]);
  });
});

describe("matchesSelectedIgdbPlatform", () => {
  it("allows every release when nothing is selected", () => {
    expect(matchesSelectedIgdbPlatform("PS5", [])).toBe(true);
    expect(matchesSelectedIgdbPlatform(undefined, [])).toBe(true);
  });

  it("keeps releases matching a selected platform", () => {
    expect(matchesSelectedIgdbPlatform("Switch", [130])).toBe(true);
    expect(matchesSelectedIgdbPlatform("PS5", [167])).toBe(true);
  });

  it("drops releases outside the selection", () => {
    expect(matchesSelectedIgdbPlatform("PS5", [130])).toBe(false);
    expect(matchesSelectedIgdbPlatform("Switch", [6, 167])).toBe(false);
  });

  it("keeps untagged releases when PC is selected", () => {
    expect(matchesSelectedIgdbPlatform(undefined, [6])).toBe(true);
  });

  it("treats Xbox as covering Xbox Series releases", () => {
    expect(matchesSelectedIgdbPlatform("Xbox Series", [11])).toBe(true);
    expect(matchesSelectedIgdbPlatform("Xbox", [169])).toBe(false);
  });

  it("does not hide everything when the selection has no release label", () => {
    expect(matchesSelectedIgdbPlatform("Switch", [508])).toBe(true);
  });

  it("treats a non-array selection as no restriction", () => {
    expect(matchesSelectedIgdbPlatform("PS5", "oops")).toBe(true);
  });
});

describe("IGDB_ID_TO_CANONICAL_PLATFORM", () => {
  it("only maps ids to labels parseReleaseMetadata can emit", () => {
    const labels = Object.values(IGDB_ID_TO_CANONICAL_PLATFORM);
    expect(labels).toContain("PC");
    expect(labels).toContain("Switch");
    expect(new Set(labels).size).toBe(labels.length);
  });
});
