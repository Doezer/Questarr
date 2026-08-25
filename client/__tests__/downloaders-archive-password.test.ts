import { describe, expect, it } from "vitest";
import {
  getArchivePasswordFromSettings,
  setArchivePasswordInSettings,
} from "../src/pages/downloaders";

describe("SABnzbd archive password settings helpers", () => {
  describe("getArchivePasswordFromSettings", () => {
    it("returns the stored archive password", () => {
      expect(getArchivePasswordFromSettings(JSON.stringify({ archivePassword: "404" }))).toBe(
        "404"
      );
    });

    it("returns an empty string when no settings are stored", () => {
      expect(getArchivePasswordFromSettings(undefined)).toBe("");
      expect(getArchivePasswordFromSettings(null)).toBe("");
      expect(getArchivePasswordFromSettings("")).toBe("");
    });

    it("returns an empty string when settings JSON has no archivePassword", () => {
      expect(getArchivePasswordFromSettings(JSON.stringify({ initialState: "stopped" }))).toBe("");
    });

    it("returns an empty string for malformed settings JSON", () => {
      expect(getArchivePasswordFromSettings("not-json")).toBe("");
    });
  });

  describe("setArchivePasswordInSettings", () => {
    it("adds the archive password to empty settings", () => {
      expect(JSON.parse(setArchivePasswordInSettings(undefined, "404"))).toEqual({
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

    it("recovers from malformed settings JSON by starting fresh", () => {
      expect(JSON.parse(setArchivePasswordInSettings("not-json", "404"))).toEqual({
        archivePassword: "404",
      });
    });
  });
});
