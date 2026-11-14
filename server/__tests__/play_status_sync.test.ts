import { describe, it, expect } from "vitest";
import { decidePlayStatus, mapPlayniteStatus, toSyncSource } from "../play-status-sync.js";

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
