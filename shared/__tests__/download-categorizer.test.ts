import { describe, it, expect } from "vitest";
import {
  categorizeDownload,
  groupDownloadsByCategory,
  getCategoryLabel,
  getCategoryDescription,
} from "../download-categorizer.js";

describe("download-categorizer", () => {
  describe("categorizeDownload", () => {
    it("detects main game with default confidence", () => {
      const result = categorizeDownload("Some.Game.Title");
      expect(result.category).toBe("main");
      expect(result.confidence).toBe(0.5);
    });

    it("detects main game with higher confidence when Repack keyword is present", () => {
      const result = categorizeDownload("Game.Name.2023.Repack-GROUP");
      expect(result.category).toBe("main");
      expect(result.confidence).toBe(0.9);
    });

    it("detects main game with higher confidence when full keyword is present", () => {
      const result = categorizeDownload("Game.Full.Edition-GROUP");
      expect(result.category).toBe("main");
      expect(result.confidence).toBe(0.9);
    });

    it("detects update via 'update' keyword", () => {
      const result = categorizeDownload("Game.Update.v1.0-GROUP");
      expect(result.category).toBe("update");
      expect(result.confidence).toBe(0.8);
    });

    it("detects update via 'patch' keyword", () => {
      const result = categorizeDownload("Game.Patch.1.2-GROUP");
      expect(result.category).toBe("update");
      expect(result.confidence).toBe(0.8);
    });

    it("detects update via 'hotfix' keyword", () => {
      const result = categorizeDownload("Game.Hotfix-GROUP");
      expect(result.category).toBe("update");
      expect(result.confidence).toBe(0.8);
    });

    it("classifies version-number-only releases as main (version alone is ambiguous)", () => {
      // "Game.v1.2.3-GROUP" could be an initial release — only explicit keywords like
      // "update" or "patch" reliably distinguish updates from full releases.
      const result = categorizeDownload("Game.v1.2.3-GROUP");
      expect(result.category).toBe("main");
    });

    it("detects update via crackfix keyword", () => {
      const result = categorizeDownload("Game.Crackfix-GROUP");
      expect(result.category).toBe("update");
      expect(result.confidence).toBe(0.8);
    });

    it("detects DLC via 'DLC' keyword", () => {
      const result = categorizeDownload("Game.DLC.Pack-GROUP");
      expect(result.category).toBe("dlc");
      expect(result.confidence).toBe(0.85);
    });

    it("detects DLC via 'expansion' keyword", () => {
      const result = categorizeDownload("Game.Expansion.Pack-GROUP");
      expect(result.category).toBe("dlc");
      expect(result.confidence).toBe(0.85);
    });

    it("detects DLC via 'season pass' keyword", () => {
      const result = categorizeDownload("Game Season Pass-GROUP");
      expect(result.category).toBe("dlc");
      expect(result.confidence).toBe(0.85);
    });

    it("detects DLC via 'deluxe' keyword", () => {
      const result = categorizeDownload("Game.Deluxe.Edition-GROUP");
      expect(result.category).toBe("dlc");
      expect(result.confidence).toBe(0.85);
    });

    it("detects DLC via 'goty' keyword", () => {
      const result = categorizeDownload("Game.GOTY.Edition-GROUP");
      expect(result.category).toBe("dlc");
      expect(result.confidence).toBe(0.85);
    });

    it("detects extra via 'OST' keyword", () => {
      const result = categorizeDownload("Game.OST-GROUP");
      expect(result.category).toBe("extra");
      expect(result.confidence).toBe(0.9);
    });

    it("detects extra via 'soundtrack' keyword", () => {
      const result = categorizeDownload("Game.Official.Soundtrack");
      expect(result.category).toBe("extra");
      expect(result.confidence).toBe(0.9);
    });

    it("detects extra via 'artbook' keyword", () => {
      const result = categorizeDownload("Game.Digital.Artbook");
      expect(result.category).toBe("extra");
      expect(result.confidence).toBe(0.9);
    });

    it("detects extra via 'bonus' keyword", () => {
      const result = categorizeDownload("Game.Bonus.Content-GROUP");
      expect(result.category).toBe("extra");
      expect(result.confidence).toBe(0.9);
    });

    it("extras take priority over DLC when both keywords present", () => {
      // OST keyword appears before DLC pattern in priority order
      const result = categorizeDownload("Game.DLC.OST-GROUP");
      expect(result.category).toBe("extra");
    });

    it("is case-insensitive for keyword matching", () => {
      expect(categorizeDownload("game.ost").category).toBe("extra");
      expect(categorizeDownload("GAME.DLC").category).toBe("dlc");
      expect(categorizeDownload("game.UPDATE").category).toBe("update");
    });
  });

  describe("groupDownloadsByCategory", () => {
    it("groups downloads into correct categories", () => {
      const downloads = [
        { title: "Game.Repack-GROUP" },
        { title: "Game.Update.v2-GROUP" },
        { title: "Game.DLC-GROUP" },
        { title: "Game.OST-GROUP" },
      ];

      const groups = groupDownloadsByCategory(downloads);

      expect(groups.main).toHaveLength(1);
      expect(groups.update).toHaveLength(1);
      expect(groups.dlc).toHaveLength(1);
      expect(groups.extra).toHaveLength(1);
    });

    it("returns all empty arrays for empty input", () => {
      const groups = groupDownloadsByCategory([]);
      expect(groups.main).toEqual([]);
      expect(groups.update).toEqual([]);
      expect(groups.dlc).toEqual([]);
      expect(groups.extra).toEqual([]);
    });

    it("preserves original download objects in groups", () => {
      const download = { title: "Game.Repack-GROUP", id: "dl-1", extra: "data" };
      const groups = groupDownloadsByCategory([download]);
      expect(groups.main[0]).toBe(download);
    });

    it("puts multiple downloads of the same category in the same group", () => {
      const downloads = [
        { title: "Game.Part1.DLC-GROUP" },
        { title: "Game.Part2.DLC-GROUP" },
        { title: "Game Season Pass-GROUP" }, // space required for "season pass" regex
      ];
      const groups = groupDownloadsByCategory(downloads);
      expect(groups.dlc).toHaveLength(3);
    });
  });

  describe("getCategoryLabel", () => {
    it("returns correct label for each category", () => {
      expect(getCategoryLabel("main")).toBe("Main Game");
      expect(getCategoryLabel("update")).toBe("Updates & Patches");
      expect(getCategoryLabel("dlc")).toBe("DLC & Expansions");
      expect(getCategoryLabel("extra")).toBe("Extras");
    });
  });

  describe("getCategoryDescription", () => {
    it("returns correct description for each category", () => {
      expect(getCategoryDescription("main")).toBe("Full game downloads");
      expect(getCategoryDescription("update")).toBe(
        "Game updates, patches, hotfixes, and crackfixes"
      );
      expect(getCategoryDescription("dlc")).toBe(
        "Downloadable content, expansions, and season passes"
      );
      expect(getCategoryDescription("extra")).toBe(
        "Soundtracks, artbooks, and other bonus content"
      );
    });
  });
});
