import { describe, it, expect } from "vitest";
import {
  compareVersions,
  extractVersionFromReleaseName,
  isReleasePossiblyNewer,
  parseVersion,
} from "../version-utils";

describe("extractVersionFromReleaseName", () => {
  it.each([
    ["Cyberpunk.2077.v2.12-GOG", "v2.12"],
    ["Hades.II.v123456-RUNE", "v123456"],
    ["setup_baldurs_gate_3_v4.1.1.6072089_(64bit)_(74309).exe", "v4.1.1.6072089"],
    ["Elden Ring [v 1.10] [FitGirl Repack]", "v1.10"],
    ["Starfield.Update.1.7.23-RUNE", "v1.7.23"],
    ["Starfield.Update.v1.7.29-RUNE", "v1.7.29"],
    ["Valheim.Build.12345678-P2P", "Build 12345678"],
    ["Game build_998 Linux", "Build 998"],
  ])("finds the version in %s", (name, expected) => {
    expect(extractVersionFromReleaseName(name)).toBe(expected);
  });

  it.each([
    "Test.Game-RUNE",
    "Some.Game.Update.2-CODEX", // second update pack, not a version
    "Game.x64v2.Edition", // "v2" glued to a word
    "Game.dev1.2.Repack",
  ])("finds nothing in %s", (name) => {
    expect(extractVersionFromReleaseName(name)).toBeNull();
  });
});

describe("parseVersion", () => {
  it("accepts user-typed forms", () => {
    expect(parseVersion("1.2.3")).toEqual({ kind: "version", parts: [1, 2, 3] });
    expect(parseVersion(" V1.05 ")).toEqual({ kind: "version", parts: [1, 5] });
    expect(parseVersion("Build 42")).toEqual({ kind: "build", parts: [42] });
  });

  it("rejects free text", () => {
    expect(parseVersion("latest")).toBeNull();
    expect(parseVersion("1.2 hotfix")).toBeNull();
    expect(parseVersion("")).toBeNull();
    expect(parseVersion(null)).toBeNull();
  });
});

describe("compareVersions", () => {
  it("compares dotted versions segment by segment", () => {
    expect(compareVersions("v1.10", "v1.9")).toBe(1);
    expect(compareVersions("1.2", "v1.2.0")).toBe(0);
    expect(compareVersions("v1.2", "1.2.1")).toBe(-1);
  });

  it("compares build numbers and bare numbers", () => {
    expect(compareVersions("Build 200", "build 100")).toBe(1);
    expect(compareVersions("v123457", "v123456")).toBe(1);
  });

  it("returns null across numbering schemes", () => {
    expect(compareVersions("Build 200", "v1.2")).toBeNull();
    expect(compareVersions("v20231005", "v1.2")).toBeNull();
    expect(compareVersions("latest", "v1.2")).toBeNull();
  });
});

describe("isReleasePossiblyNewer", () => {
  it("is true when nothing is known", () => {
    expect(isReleasePossiblyNewer("Game.Update.v1.1-RUNE", null)).toBe(true);
    expect(isReleasePossiblyNewer("Game.Update-RUNE", "v1.2")).toBe(true);
    expect(isReleasePossiblyNewer("Game.Update.v1.1-RUNE", "latest")).toBe(true);
  });

  it("is false for an equal or older release", () => {
    expect(isReleasePossiblyNewer("Game.Update.v1.1-RUNE", "v1.1")).toBe(false);
    expect(isReleasePossiblyNewer("Game.Update.v1.1-RUNE", "1.2")).toBe(false);
  });

  it("is true for a newer release", () => {
    expect(isReleasePossiblyNewer("Game.Update.v1.3-RUNE", "1.2")).toBe(true);
  });
});
