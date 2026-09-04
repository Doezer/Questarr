import { describe, expect, it } from "vitest";
import { getArchivePasswordFromSettings, setArchivePasswordInSettings } from "@/pages/downloaders";

describe("SABnzbd archive password settings helpers", () => {
  describe("getArchivePasswordFromSettings", () => {
    it("returns the stored archive password", () => {
      expect(getArchivePasswordFromSettings(JSON.stringify({ archivePassword: "404" }))).toBe(
        "404"
      );
    });

    it("returns an empty string when settings JSON has no archivePassword", () => {
      expect(getArchivePasswordFromSettings(JSON.stringify({ initialState: "stopped" }))).toBe("");
    });

    it.each([
      ["a number", 404],
      ["a boolean", true],
      ["an object", { value: "404" }],
    ])("returns an empty string when archivePassword is %s", (_label, archivePassword) => {
      expect(getArchivePasswordFromSettings(JSON.stringify({ archivePassword }))).toBe("");
    });

    it.each([
      ["no settings stored", undefined],
      ["null settings", null],
      ["empty string settings", ""],
      ["malformed JSON", "not-json"],
      ["JSON null", "null"],
      ["a JSON array", "[]"],
      ["a JSON array with content", '["archivePassword","404"]'],
    ])("returns an empty string for %s", (_label, input) => {
      expect(getArchivePasswordFromSettings(input)).toBe("");
    });
  });

  describe("setArchivePasswordInSettings", () => {
    it.each([
      ["empty settings", undefined],
      ["malformed JSON", "not-json"],
      ["JSON null", "null"],
      ["a JSON array", "[]"],
    ])("starts fresh from %s", (_label, input) => {
      expect(JSON.parse(setArchivePasswordInSettings(input, "404"))).toEqual({
        archivePassword: "404",
      });
    });

    it("preserves other keys already present in settings", () => {
      const result = setArchivePasswordInSettings(
        JSON.stringify({ initialState: "stopped" }),
        "404"
      );
      expect(JSON.parse(result)).toEqual({ initialState: "stopped", archivePassword: "404" });
    });

    it("removes the archive password when set to an empty string", () => {
      const result = setArchivePasswordInSettings(
        JSON.stringify({ archivePassword: "404", initialState: "stopped" }),
        ""
      );
      expect(JSON.parse(result)).toEqual({ initialState: "stopped" });
    });
  });
});
