import { describe, expect, it } from "vitest";
import type { DownloadCategory } from "../download-categorizer";
import { decideUpgrade, extractPatchBaseVersion, type UpgradeCandidate } from "../upgrade-decision";
import { extractVersionFromReleaseName } from "../version-utils";

function candidate(
  title: string,
  score = 100,
  category: DownloadCategory = "main"
): UpgradeCandidate<string> {
  return { item: title, title, category, score };
}

function skipCodes(decision: ReturnType<typeof decideUpgrade<string>>): Record<string, string> {
  return Object.fromEntries(decision.skipped.map((s) => [s.candidate.title, s.code]));
}

describe("version extraction across release styles (auto-upgrade corpus)", () => {
  // Names shaped like what scene groups, GOG rips and repackers publish. Auto-upgrade trusts
  // the version read here, so a wrong read is worse than no read: null is always acceptable.
  it.each<[string, string | null]>([
    // Scene
    ["Hades.II.v1.0.2-RUNE", "v1.0.2"],
    ["Baldurs.Gate.3.v4.1.1.6072089-RUNE", "v4.1.1.6072089"],
    ["Stardew.Valley.v1.6.15-TENOKE", "v1.6.15"],
    ["Satisfactory.Build.365306-TENOKE", "Build 365306"],
    ["Elden.Ring.Shadow.of.the.Erdtree-RUNE", null],
    ["DOOM.Eternal-CODEX", null],
    // Scene updates
    ["Hades.II.Update.v1.0.3-RUNE", "v1.0.3"],
    ["Game.Update.v1.0.to.v1.1-CODEX", "v1.1"],
    ["Game.Update.3-CODEX", null],
    // GOG
    ["Cyberpunk.2077.v2.12-GOG", "v2.12"],
    ["The.Witcher.3.Wild.Hunt.Complete.Edition.v4.04-GOG", "v4.04"],
    ["Disco_Elysium_v1.0.2_(64bit)_(58765)-GOG", "v1.0.2"],
    // Repackers
    ["Elden Ring [v 1.10] [FitGirl Repack]", "v1.10"],
    ["Cyberpunk 2077 (v2.12 + All DLCs, MULTi19) [FitGirl Repack]", "v2.12"],
    ["Hogwarts Legacy (Build 1126182 + DLCs) [DODI Repack]", "Build 1126182"],
    ["Red.Dead.Redemption.2.Build.1491.50.MULTi13-ElAmigos", null],
    ["Starfield [DODI Repack]", null],
    // Qualified versions are never read
    ["Game.v1.2.Beta-GOG", null],
    ["Game.v0.9.Early.Access-P2P", null],
    ["Game.Hotfix.v1.2-RUNE", null],
  ])("%s -> %s", (name, expected) => {
    expect(extractVersionFromReleaseName(name)).toBe(expected);
  });
});

describe("extractPatchBaseVersion", () => {
  it.each<[string, string | null]>([
    ["Game.Update.v1.0.to.v1.1-CODEX", "v1.0"],
    ["Game.Update.1.0.to.1.1-CODEX", "v1.0"],
    ["Game Patch v1.4.2 to v1.5", "v1.4.2"],
    ["Game.Update.Build.1000.to.Build.1200-RUNE", "Build 1000"],
    ["Game.Update.Build.1000.to.1200-RUNE", "Build 1000"],
    ["Game.Update.v1.1-CODEX", null],
    ["Road.to.Vostok.v1.0-RUNE", null],
    ["Game.v2.to.v3.Update", "v2"],
  ])("%s -> %s", (name, expected) => {
    expect(extractPatchBaseVersion(name)).toBe(expected);
  });
});

describe("decideUpgrade", () => {
  it("takes nothing without candidates", () => {
    expect(decideUpgrade([], { installedVersion: "v1.0" })).toEqual({
      action: "none",
      code: "no_candidates",
      skipped: [],
    });
  });

  it.each([null, undefined, "", "  ", "1.05 hotfix", "latest"])(
    "takes nothing when the installed version is %j",
    (installedVersion) => {
      const decision = decideUpgrade([candidate("Game.v9.9-GOG")], { installedVersion });
      expect(decision).toMatchObject({ action: "none", code: "installed_version_unknown" });
    }
  );

  it("grabs a provably newer full release", () => {
    const decision = decideUpgrade([candidate("Game.v1.2-GOG")], { installedVersion: "v1.1" });
    expect(decision).toMatchObject({
      action: "grab",
      kind: "version",
      fromVersion: "v1.1",
      toVersion: "v1.2",
      patch: false,
    });
  });

  it("picks the newest version even when an older one scores better", () => {
    const decision = decideUpgrade(
      [candidate("Game.v1.2-GOG", 300), candidate("Game.v1.3-RUNE", 120)],
      { installedVersion: "v1.1" }
    );
    expect(decision).toMatchObject({ action: "grab", toVersion: "v1.3" });
    if (decision.action === "grab") expect(decision.candidate.title).toBe("Game.v1.3-RUNE");
  });

  it("keeps the caller's order among releases of the same newest version", () => {
    const decision = decideUpgrade(
      [candidate("Game.v1.3-GOG", 300), candidate("Game.v1.3-RUNE", 120)],
      { installedVersion: "v1.1" }
    );
    if (decision.action !== "grab") throw new Error("expected a grab");
    expect(decision.candidate.title).toBe("Game.v1.3-GOG");
  });

  it("skips what cannot be proven newer, with a reason for each", () => {
    const decision = decideUpgrade(
      [
        candidate("Game-RUNE"),
        candidate("Game.v1.2.Beta-GOG"),
        candidate("Game.Build.5000-TENOKE"),
        candidate("Game.v1.0-GOG"),
        candidate("Game.v1.1-GOG"),
        candidate("Game.Soundtrack.v2.0", 100, "extra"),
        candidate("Game.DLC.Pack.v2.0", 100, "dlc"),
      ],
      { installedVersion: "v1.1" }
    );
    expect(decision).toMatchObject({ action: "none", code: "nothing_newer" });
    expect(skipCodes(decision)).toEqual({
      "Game-RUNE": "version_unreadable",
      "Game.v1.2.Beta-GOG": "version_unreadable",
      "Game.Build.5000-TENOKE": "version_not_comparable",
      "Game.v1.0-GOG": "older_version",
      "Game.v1.1-GOG": "same_version",
      "Game.Soundtrack.v2.0": "not_a_game_version",
      "Game.DLC.Pack.v2.0": "not_a_game_version",
    });
  });

  it("does not compare a date-like bare number with a dotted version", () => {
    const decision = decideUpgrade([candidate("Game.v20261005-P2P")], { installedVersion: "v1.2" });
    expect(skipCodes(decision)).toEqual({ "Game.v20261005-P2P": "version_not_comparable" });
  });

  it("compares build numbers with build numbers", () => {
    const decision = decideUpgrade([candidate("Game.Build.5000-TENOKE")], {
      installedVersion: "Build 4000",
    });
    expect(decision).toMatchObject({ action: "grab", toVersion: "Build 5000" });
  });

  describe("update patches", () => {
    it("takes a patch only when it starts from the installed version", () => {
      const decision = decideUpgrade([candidate("Game.Update.v1.1.to.v1.2-CODEX", 100, "update")], {
        installedVersion: "v1.1",
      });
      expect(decision).toMatchObject({ action: "grab", toVersion: "v1.2", patch: true });
    });

    it("treats v1.1 and v1.1.0 as the same base", () => {
      const decision = decideUpgrade(
        [candidate("Game.Update.v1.1.0.to.v1.2-CODEX", 100, "update")],
        { installedVersion: "v1.1" }
      );
      expect(decision).toMatchObject({ action: "grab", patch: true });
    });

    it("skips a patch from another base or with no base named", () => {
      const decision = decideUpgrade(
        [
          candidate("Game.Update.v1.0.to.v1.2-CODEX", 100, "update"),
          candidate("Game.Update.v1.3-CODEX", 100, "update"),
        ],
        { installedVersion: "v1.1" }
      );
      expect(decision).toMatchObject({ action: "none", code: "nothing_newer" });
      expect(skipCodes(decision)).toEqual({
        "Game.Update.v1.0.to.v1.2-CODEX": "patch_base_mismatch",
        "Game.Update.v1.3-CODEX": "patch_base_unknown",
      });
    });

    it("prefers the full release at the same version unless told otherwise", () => {
      const candidates = [
        candidate("Game.Update.v1.1.to.v1.2-CODEX", 200, "update"),
        candidate("Game.v1.2-GOG", 100),
      ];
      const full = decideUpgrade(candidates, { installedVersion: "v1.1" });
      expect(full).toMatchObject({ action: "grab", patch: false });
      const patch = decideUpgrade(candidates, { installedVersion: "v1.1", preferPatches: true });
      expect(patch).toMatchObject({ action: "grab", patch: true });
    });

    it("still prefers a newer full release over a patch to an older version", () => {
      const decision = decideUpgrade(
        [candidate("Game.Update.v1.1.to.v1.2-CODEX", 200, "update"), candidate("Game.v1.3-GOG")],
        { installedVersion: "v1.1", preferPatches: true }
      );
      expect(decision).toMatchObject({ action: "grab", toVersion: "v1.3", patch: false });
    });
  });

  describe("same version, better release (cutoff)", () => {
    const sameVersion = [candidate("Game.v1.1-GOG", 180), candidate("Game.v1.1-RUNE", 120)];

    it("does nothing when the installed score or the cutoff is unknown", () => {
      expect(decideUpgrade(sameVersion, { installedVersion: "v1.1" })).toMatchObject({
        action: "none",
        code: "nothing_newer",
      });
      expect(
        decideUpgrade(sameVersion, { installedVersion: "v1.1", installedScore: 50 })
      ).toMatchObject({ action: "none", code: "nothing_newer" });
      expect(
        decideUpgrade(sameVersion, { installedVersion: "v1.1", cutoffScore: 150 })
      ).toMatchObject({ action: "none", code: "nothing_newer" });
    });

    it("swaps for a better-scored release below the cutoff", () => {
      const decision = decideUpgrade(sameVersion, {
        installedVersion: "v1.1",
        installedScore: 100,
        cutoffScore: 150,
      });
      expect(decision).toMatchObject({
        action: "grab",
        kind: "quality",
        fromVersion: "v1.1",
        toVersion: "v1.1",
      });
      if (decision.action === "grab") expect(decision.candidate.title).toBe("Game.v1.1-GOG");
      expect(skipCodes(decision)).toEqual({ "Game.v1.1-RUNE": "same_version" });
    });

    it("stops once the installed release meets the cutoff", () => {
      const decision = decideUpgrade(sameVersion, {
        installedVersion: "v1.1",
        installedScore: 150,
        cutoffScore: 150,
      });
      expect(decision).toMatchObject({ action: "none", code: "cutoff_reached" });
    });

    it("needs the minimum gain", () => {
      const options = { installedVersion: "v1.1", installedScore: 170, cutoffScore: 500 };
      expect(decideUpgrade(sameVersion, { ...options, minScoreGain: 20 })).toMatchObject({
        action: "none",
        code: "nothing_newer",
      });
      expect(decideUpgrade(sameVersion, { ...options, minScoreGain: 10 })).toMatchObject({
        action: "grab",
        kind: "quality",
      });
      // An equal score is never a gain, even with a gain of 0 asked.
      expect(
        decideUpgrade([candidate("Game.v1.1-GOG", 170)], { ...options, minScoreGain: 0 })
      ).toMatchObject({ action: "none" });
    });

    it("a newer version still wins past the cutoff", () => {
      const decision = decideUpgrade([candidate("Game.v1.2-RUNE", 10)], {
        installedVersion: "v1.1",
        installedScore: 900,
        cutoffScore: 150,
      });
      expect(decision).toMatchObject({ action: "grab", kind: "version", toVersion: "v1.2" });
    });
  });
});
