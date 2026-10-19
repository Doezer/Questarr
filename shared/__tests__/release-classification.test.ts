import { describe, it, expect } from "vitest";
import { classifyReleaseByRules } from "../release-classification.js";

const classify = (title: string, gameTitle?: string) =>
  classifyReleaseByRules({ title, ...(gameTitle ? { gameTitle } : {}) });

describe("classifyReleaseByRules", () => {
  describe("content markers", () => {
    it.each([
      ["Baldurs.Gate.Siege.of.Dragonspear.Update.v2.1-BAT", "patch", "patch.update-word"],
      ["Game.Day.One.Patch-RUNE", "patch", "patch.patch-word"],
      ["Baldurs.Gate.3.v4.1.1.1311526_patch6_HF1.EA-CaviaR", "patch", "patch.patch-word"],
      ["Game.v1.0.2.to.v1.0.5-GRP", "patch", "patch.version-range"],
      ["Game.Hotfix.2-GRP", "patch", "patch.hotfix"],
      ["Game.DLC.Pack.Costumes-GRP", "dlc", "dlc.dlc-word"],
      ["Game.Season.Pass-GRP", "dlc", "dlc.season-pass"],
      ["Game.Digital.Deluxe.Upgrade-GRP", "dlc", "dlc.upgrade"],
      ["Game.Skin.Pack-GRP", "dlc", "dlc.content-pack"],
      ["Game.Standalone.Expansion-X", "expansion", "expansion.expansion-word"],
      ["Game The Frozen Expansion [rarbg]", "expansion", "expansion.expansion-word"],
    ])("%s is %s", (title, expected, ruleId) => {
      const result = classify(title);
      expect(result.class).toBe(expected);
      expect(result.ruleIds).toContain(ruleId);
      expect(result.source).toBe("rules");
      expect(result.confidence).toBeNull();
    });

    it("reads separators the way scene names write them", () => {
      expect(classify("Game_Name_Add-On_Pack-GRP").class).toBe("dlc");
      expect(classify("Game Name update v1.2 ").class).toBe("patch");
    });

    it("ignores words that only appear in the scene group", () => {
      const result = classify("Dishonored-UPDATE", "Dishonored");
      expect(result.class).toBe("full_game");
    });
  });

  describe("things that are not a game package", () => {
    it.each([
      ["Game.OST-GRP", "soundtrack"],
      ["Game.Soundtrack.FLAC-GRP", "soundtrack"],
      ["Game.Artbook-GRP", "other_artifact"],
      ["Game.Demo-GRP", "demo"],
      ["Game.Crack.Only-SKIDROW", "crack_only"],
      ["Game.Fix-SKIDROW", "crack_only"],
      ["Game.NoCD-GRP", "crack_only"],
    ])("%s is unknown with the %s flag", (title, flag) => {
      const result = classify(title, "Game");
      expect(result.class).toBe("unknown");
      expect(result.flags).toContain(flag);
    });
  });

  describe("conflicting evidence", () => {
    it.each([
      "Game.DLC.Update.v1.2-GRP",
      "Game.Expansion.Patch-GRP",
      "Game.Season.Pass.Expansion-GRP",
    ])("%s is unknown, not a guess between classes", (title) => {
      const result = classify(title);
      expect(result.class).toBe("unknown");
      expect(result.ruleIds?.[0]).toBe("unknown.conflict");
    });

    it("keeps the rules that fired in the explanation", () => {
      expect(classify("Game.DLC.Update-GRP").ruleIds).toEqual([
        "unknown.conflict",
        "patch.update-word",
        "dlc.dlc-word",
      ]);
    });

    it("lets a marker outweigh a game-title match", () => {
      expect(classify("Dishonored.Update.v1.4-CODEX", "Dishonored").class).toBe("patch");
    });
  });

  describe("full games", () => {
    it("recognises a bundle statement", () => {
      for (const title of [
        "Game.Incl.All.DLC-GRP",
        "Game v1.2 + 12 DLCs-GRP",
        "Game.Including.Update.5.and.DLC-GRP",
        "Game.with.Soundtrack-GRP",
      ]) {
        const result = classify(title);
        expect(result.class, title).toBe("full_game");
        expect(result.ruleIds).toEqual(["full-game.bundle"]);
      }
    });

    it("still sees content that is outside the bundle statement", () => {
      expect(classify("Game.DLC.Incl.Update.5-GRP").class).toBe("dlc");
    });

    it("needs the game title for a plain name, which may be an edition of the game", () => {
      expect(classify("Dishonored.Deluxe.Edition-GOG", "Dishonored")).toMatchObject({
        class: "full_game",
        ruleIds: ["full-game.bare-title"],
      });
      expect(classify("Elden.Ring.Complete.Edition-FLT", "Elden Ring").class).toBe("full_game");
      expect(classify("Skyrim.Special.Edition-CODEX", "Skyrim").class).toBe("full_game");
    });

    it("notes a repack without letting it decide the class", () => {
      expect(classify("Dishonored-FitGirl.Repack", "Dishonored").flags).toEqual(["repack"]);
      expect(classify("Game.DLC.Repack-GRP").class).toBe("dlc");
    });
  });

  describe("never defaults to a full game", () => {
    it.each([
      "Some.Game-RUNE",
      "Dishonored.Death.of.the.Outsider-CODEX",
      "Dishonored.2-CODEX",
      "Game-GRP",
      "",
    ])("%s is unknown without evidence", (title) => {
      const result = classify(title);
      expect(result.class).toBe("unknown");
      expect(result.ruleIds).toEqual(["unknown.no-evidence"]);
    });

    it("does not call a different game, a sequel or a spinoff a full game", () => {
      expect(classify("Dishonored.2-CODEX", "Dishonored").class).toBe("unknown");
      expect(classify("Dishonored.Death.of.the.Outsider-CODEX", "Dishonored").class).toBe(
        "unknown"
      );
      expect(classify("Another.Game-CODEX", "Dishonored").class).toBe("unknown");
    });
  });
});
