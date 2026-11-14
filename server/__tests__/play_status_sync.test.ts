import { describe, it, expect } from "vitest";
import {
  decidePlayStatus,
  libraryTitlesAgree,
  mapPlayniteStatus,
  recordedMinutes,
  toSyncSource,
} from "../play-status-sync.js";

describe("mapPlayniteStatus", () => {
  it.each([
    ["Not Played", "owned"],
    ["Plan to Play", "owned"],
    ["Played", "owned"],
    ["Playing", "playing"],
    ["On Hold", "shelved"],
    ["Abandoned", "shelved"],
    ["Beaten", "completed"],
    ["Completed", "completed"],
    ["  beaten ", "completed"],
    ["ON   HOLD", "shelved"],
  ])("maps %s to %s", (input, expected) => {
    expect(mapPlayniteStatus(input)).toBe(expected);
  });

  it("returns undefined for an unknown status", () => {
    expect(mapPlayniteStatus("Speedrunning")).toBeUndefined();
  });

  it.each(["constructor", "__proto__", "toString", "hasOwnProperty"])(
    "does not resolve the inherited property %s",
    (input) => {
      expect(mapPlayniteStatus(input)).toBeUndefined();
    }
  );
});

describe("toSyncSource", () => {
  it("keeps known platforms and falls back to playnite", () => {
    expect(toSyncSource("GOG")).toBe("gog");
    expect(toSyncSource("epic")).toBe("epic");
    expect(toSyncSource("Itch.io")).toBe("playnite");
    expect(toSyncSource(undefined)).toBe("playnite");
  });
});

describe("decidePlayStatus", () => {
  const opts = { promoteWanted: false };

  it("never overwrites a curated status set by hand", () => {
    for (const status of ["playing", "shelved", "completed"]) {
      expect(decidePlayStatus({ status, statusSyncSource: null }, "completed", opts)).toEqual({
        action: "skip",
        reason: "manual_status",
      });
    }
  });

  it("replaces a status that an earlier sync wrote", () => {
    expect(
      decidePlayStatus({ status: "playing", statusSyncSource: "gog" }, "completed", opts)
    ).toEqual({ action: "apply" });
  });

  it("applies to an owned game and reports no change when equal", () => {
    expect(decidePlayStatus({ status: "owned", statusSyncSource: null }, "playing", opts)).toEqual({
      action: "apply",
    });
    expect(decidePlayStatus({ status: "owned", statusSyncSource: null }, "owned", opts)).toEqual({
      action: "unchanged",
    });
  });

  it("leaves wanted games alone unless promotion is requested, and downloads always", () => {
    expect(decidePlayStatus({ status: "wanted", statusSyncSource: null }, "owned", opts)).toEqual({
      action: "skip",
      reason: "wanted",
    });
    expect(
      decidePlayStatus({ status: "wanted", statusSyncSource: null }, "owned", {
        promoteWanted: true,
      })
    ).toEqual({ action: "apply" });
    expect(
      decidePlayStatus({ status: "downloading", statusSyncSource: null }, "owned", {
        promoteWanted: true,
      })
    ).toEqual({ action: "skip", reason: "downloading" });
  });
});

describe("libraryTitlesAgree", () => {
  it.each([
    ["Hades", "Hades", true],
    ["The Witcher 3: Wild Hunt - Game of the Year Edition", "The Witcher 3: Wild Hunt", true],
    ["Prey (2017)", "Prey", false],
    ["Hades II Deluxe Edition", "Hades", false],
    ["Divinity: Original Sin 2 - Definitive Edition", "Divinity: Original Sin", false],
    ["Divinity: Original Sin - Enhanced Edition", "Divinity: Original Sin", true],
    ["Blade Runner Director's Cut", "Blade Runner", true],
    ["Hades", "Hades II", false],
    ["Fallout", "Fallout 2", false],
    ["Fallout", "Fallout: New Vegas", false],
    ["", "Hades", false],
  ])("%s vs %s", (a, b, expected) => {
    expect(libraryTitlesAgree(a, b)).toBe(expected);
  });
});

describe("recordedMinutes", () => {
  it("sums finished sessions and ignores a running one", () => {
    const t = new Date("2026-01-01T10:00:00Z");
    const later = (m: number) => new Date(t.getTime() + m * 60_000);
    expect(
      recordedMinutes([
        { startedAt: t, endedAt: later(30) },
        { startedAt: t, endedAt: later(45) },
        { startedAt: t, endedAt: null },
      ])
    ).toBe(75);
  });
});
