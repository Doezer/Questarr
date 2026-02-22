import { describe, it, expect } from "vitest";
import {
  normalizeTitle,
  cleanReleaseName,
  titleMatches,
  releaseMatchesGame,
  parseReleaseMetadata,
} from "../title-utils.js";

describe("title-utils", () => {
  describe("normalizeTitle", () => {
    it("should normalize titles correctly", () => {
      expect(normalizeTitle("The Witcher 3: Wild Hunt")).toBe("the witcher 3 wild hunt");
      expect(normalizeTitle("Game!   Title?")).toBe("game title");
      expect(normalizeTitle("   Leading and Trailing   ")).toBe("leading and trailing");
    });

    it("should handle empty strings", () => {
      expect(normalizeTitle("")).toBe("");
    });
  });

  describe("cleanReleaseName", () => {
    it("should clean release names by removing tags", () => {
      expect(cleanReleaseName("Game.Name.2023.1080p.BluRay.x264-GROUP")).toBe("Game Name");
      expect(cleanReleaseName("Title_With_Underscores_v1.0-GROUP")).toBe("Title With Underscores");
      expect(cleanReleaseName("Title.With.Dots.PROPER.REPACK-GROUP")).toBe("Title With Dots");
    });

    it("should remove common version patterns", () => {
      expect(cleanReleaseName("Game.v1.2.3-GROUP")).toBe("Game");
      expect(cleanReleaseName("Game.Build.123-GROUP")).toBe("Game");
    });

    it("should handle bracketed content correctly", () => {
      expect(cleanReleaseName("Game (2023) [1080p]")).toBe("Game");
      expect(cleanReleaseName("Game (Special Edition)")).toBe("Game (Special Edition)");
    });

    it("should replace 'and' with '&' for better matching", () => {
      expect(cleanReleaseName("Tales And Tactics")).toBe("Tales & Tactics");
    });

    it("should remove years in range 1975-2040", () => {
      expect(cleanReleaseName("Game 2024")).toBe("Game");
      expect(cleanReleaseName("Game 1900")).toBe("Game 1900");
    });
  });

  describe("titleMatches", () => {
    it("should match identical and case-insensitive titles", () => {
      expect(titleMatches("Game Title", "game title")).toBe(true);
      expect(titleMatches("Game Title", "Game  Title")).toBe(true);
    });

    it("should match partial titles within word boundaries", () => {
      expect(titleMatches("The Witcher 3", "The Witcher 3: Wild Hunt")).toBe(true);
      expect(titleMatches("The Witcher 3: Wild Hunt", "The Witcher 3")).toBe(true);
    });

    it("should not match unrelated titles", () => {
      expect(titleMatches("Fable", "Fabletown")).toBe(false);
      expect(titleMatches("Game A", "Game B")).toBe(false);
    });

    it("should require exact match for short titles", () => {
      expect(titleMatches("It", "It Follows")).toBe(false);
      expect(titleMatches("Sty", "Style")).toBe(false);
    });
  });

  describe("releaseMatchesGame", () => {
    it("should match release name against game title", () => {
      expect(releaseMatchesGame("Game.Name.2023.1080p-GROUP", "Game Name")).toBe(true);
      expect(releaseMatchesGame("Stalker.2.Heart.of.Chornobyl-GROUP", "Stalker 2")).toBe(true);
    });

    it("should handle stopwords and numbers in fallback matching", () => {
      expect(releaseMatchesGame("The.Witcher.3.Wild.Hunt-GROUP", "Witcher 3")).toBe(true);
      expect(releaseMatchesGame("Stalker.2-GROUP", "Stalker 2")).toBe(true);
    });

    it("should not match if meaningful words are missing", () => {
      expect(releaseMatchesGame("Witcher.2-GROUP", "Stalker 2")).toBe(false);
      expect(releaseMatchesGame("Game.Name-GROUP", "Other Game")).toBe(false);
    });
  });

  describe("parseReleaseMetadata", () => {
    it("should extract metadata from release name", () => {
      const meta = parseReleaseMetadata("Game.Name.v1.2.GOG.Linux.Multi8-GROUP");
      expect(meta.gameTitle).toBe("Game Name");
      expect(meta.version).toBe("v1.2");
      expect(meta.group).toBe("GROUP");
      expect(meta.platform).toBe("Linux");
      expect(meta.drm).toBe("GOG");
      expect(meta.languages).toContain("Multi");
    });

    it("should detect scene status", () => {
      expect(parseReleaseMetadata("Game-GROUP").isScene).toBe(true);
      expect(parseReleaseMetadata("Game-P2P").isScene).toBe(false);
      expect(parseReleaseMetadata("Game-CRACK").isScene).toBe(false);
    });

    it("should handle bracketed groups", () => {
      expect(parseReleaseMetadata("[GROUP] Game Name").group).toBe("GROUP");
    });

    it("should detect various platforms", () => {
      expect(parseReleaseMetadata("Game.PS5-GROUP").platform).toBe("PS5");
      expect(parseReleaseMetadata("Game.Win64-GROUP").platform).toBe("PC");
    });
    it("should parse Mac platform and DRM-Free tags", () => {
      const release = "Shadow.of.the.Tomb.Raider.MacOS.DRM-Free";
      const metadata = parseReleaseMetadata(release);
      expect(metadata.platform).toBe("Mac");
      expect(metadata.drm).toBe("DRM-Free");
    });
  });
});
