import { describe, expect, it } from "vitest";
import { DEFAULT_CUSTOM_FORMATS } from "../default-custom-formats.js";
import {
  DEFAULT_RELEASE_PROFILE,
  compileCustomFormats,
  evaluateRelease,
  validateFormatSpec,
  type CustomFormat,
} from "../release-scoring.js";

const formats: CustomFormat[] = DEFAULT_CUSTOM_FORMATS.map((f, i) => ({
  ...f,
  id: `f${i}`,
  enabled: true,
}));

const compiled = compileCustomFormats(formats);

function score(title: string) {
  return evaluateRelease(
    { title, downloadType: "torrent", seeders: 10 },
    { gameTitle: "Elden Ring" },
    DEFAULT_RELEASE_PROFILE,
    compiled
  );
}

describe("DEFAULT_CUSTOM_FORMATS", () => {
  it("has unique names and valid specs", () => {
    expect(new Set(DEFAULT_CUSTOM_FORMATS.map((f) => f.name)).size).toBe(
      DEFAULT_CUSTOM_FORMATS.length
    );
    for (const format of DEFAULT_CUSTOM_FORMATS) {
      for (const spec of format.specs) expect(validateFormatSpec(spec)).toBeNull();
    }
  });

  it.each([
    ["Elden.Ring.Crack.Only-GRP", "f0"],
    ["Elden Ring NoCD-GRP", "f0"],
    ["Elden Ring Demo", "f1"],
    ["Elden Ring Trainer +12", "f2"],
    ["Elden Ring Keygen-GRP", "f2"],
    ["Elden Ring Pre-Installed", "f3"],
    ["Elden Ring incl. all DLCs", "f4"],
    ["Elden Ring Goty Edition", "f4"],
  ])("%s matches %s", (title, id) => {
    expect(score(title)?.matchedFormats).toContain(id);
  });

  it("leaves a plain release alone", () => {
    expect(score("Elden.Ring.v1.10-RUNE")?.matchedFormats).toEqual([]);
  });

  it.each([
    "Elden Ring v1.2 + Crack",
    "Elden.Ring.incl.Crack-GRP",
    "Elden Ring [Crack]",
    "Elden Ring Portable",
    "Elden Ring Prologue",
  ])("leaves %s alone", (title) => {
    expect(score(title)?.matchedFormats).toEqual([]);
  });

  it("does not match inside other words", () => {
    expect(score("Elden Ring Crackdown Trials")?.matchedFormats).toEqual([]);
  });

  it("rejects a trainer", () => {
    expect(score("Elden Ring Trainer")?.accepted).toBe(false);
  });
});
