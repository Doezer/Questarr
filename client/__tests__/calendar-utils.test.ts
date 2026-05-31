import { describe, expect, it } from "vitest";

import { formatDate, getDaysInMonth, getWeekDays } from "../src/pages/calendar";

describe("calendar date helpers", () => {
  it("formats dates as yyyy-mm-dd", () => {
    expect(formatDate(new Date("2026-05-28T12:00:00.000Z"))).toBe("2026-05-28");
  });

  it("returns a monday-first week even when starting from sunday", () => {
    const week = getWeekDays(new Date("2026-06-07T12:00:00.000Z"));
    expect(week).toHaveLength(7);
    expect(formatDate(week[0])).toBe("2026-06-01");
    expect(formatDate(week[6])).toBe("2026-06-07");
  });

  it("pads month grids with adjacent-month dates", () => {
    const days = getDaysInMonth(2026, 1);
    expect(formatDate(days[0])).toBe("2026-01-26");
    expect(formatDate(days.at(-1)!)).toBe("2026-03-01");
  });
});
