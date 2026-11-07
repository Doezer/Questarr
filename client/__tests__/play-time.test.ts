import { describe, expect, it } from "vitest";
import { formatElapsed, formatMinutes, sessionLengthMinutes } from "../src/lib/play-time";

describe("formatMinutes", () => {
  it.each([
    [0, "0m"],
    [45, "45m"],
    [60, "1h"],
    [125, "2h 05m"],
    [-5, "0m"],
    [89.6, "1h 30m"],
  ])("formats %s as %s", (input, expected) => {
    expect(formatMinutes(input)).toBe(expected);
  });
});

describe("formatElapsed", () => {
  it("formats hours, minutes and seconds", () => {
    expect(formatElapsed(0)).toBe("0:00:00");
    expect(formatElapsed(429_000)).toBe("0:07:09");
    expect(formatElapsed(3_723_000)).toBe("1:02:03");
    expect(formatElapsed(-1000)).toBe("0:00:00");
  });
});

describe("sessionLengthMinutes", () => {
  it("is zero while a session is running", () => {
    expect(sessionLengthMinutes("2026-11-05T10:00:00Z", null)).toBe(0);
  });
  it("counts whole minutes between start and end", () => {
    expect(sessionLengthMinutes("2026-11-05T10:00:00Z", "2026-11-05T11:30:00Z")).toBe(90);
    expect(sessionLengthMinutes(new Date("2026-11-05T10:00:00Z"), "2026-11-05T09:00:00Z")).toBe(0);
  });
});
