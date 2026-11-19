import { describe, expect, it } from "vitest";
import { localDay, presetBounds } from "../src/lib/play-range";

describe("play range helpers", () => {
  const now = new Date(2026, 10, 19, 23, 30); // 19 Nov 2026, local time

  it("formats a day on the viewer's own calendar", () => {
    expect(localDay(now)).toBe("2026-11-19");
    expect(localDay(new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  it("has no bounds for all time", () => {
    expect(presetBounds("all", now, { from: "", to: "" })).toEqual({});
  });

  it("counts today as the last day of a preset", () => {
    expect(presetBounds("7d", now, { from: "", to: "" })).toEqual({
      from: "2026-11-13",
      to: "2026-11-19",
    });
    expect(presetBounds("30d", now, { from: "", to: "" }).from).toBe("2026-10-21");
    expect(presetBounds("year", now, { from: "", to: "" }).from).toBe("2025-11-20");
  });

  it("uses only the custom bounds that are filled in", () => {
    expect(presetBounds("custom", now, { from: "2026-01-01", to: "" })).toEqual({
      from: "2026-01-01",
    });
    expect(presetBounds("custom", now, { from: "", to: "2026-02-01" })).toEqual({
      to: "2026-02-01",
    });
    expect(presetBounds("custom", now, { from: "", to: "" })).toEqual({});
  });
});
