import { describe, it, expect } from "vitest";
import { __testing } from "../library-scanner.js";

const { scoreMatch, isIgnoredFile } = __testing;

describe("library-scanner scoreMatch", () => {
  it("scores an exact title match as 1", () => {
    expect(scoreMatch("The Witcher 3", "The Witcher 3")).toBe(1);
  });

  it("scores a close but not identical title highly", () => {
    const score = scoreMatch("Witcher 3 Wild Hunt", "The Witcher 3: Wild Hunt");
    expect(score).toBeGreaterThan(0.5);
  });

  it("scores unrelated titles low", () => {
    const score = scoreMatch("Stardew Valley", "Doom Eternal");
    expect(score).toBeLessThan(0.3);
  });

  it("returns 0 for empty input", () => {
    expect(scoreMatch("", "Doom Eternal")).toBe(0);
    expect(scoreMatch("Doom Eternal", "")).toBe(0);
  });
});

describe("library-scanner isIgnoredFile", () => {
  it("ignores nfo/checksum/artwork files", () => {
    expect(isIgnoredFile("readme.nfo")).toBe(true);
    expect(isIgnoredFile("game.sfv")).toBe(true);
    expect(isIgnoredFile("cover.jpg")).toBe(true);
  });

  it("does not ignore installers or archives", () => {
    expect(isIgnoredFile("setup.exe")).toBe(false);
    expect(isIgnoredFile("game.iso")).toBe(false);
    expect(isIgnoredFile("game.zip")).toBe(false);
  });
});
