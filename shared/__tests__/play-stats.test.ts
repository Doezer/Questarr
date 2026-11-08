import { describe, expect, it } from "vitest";
import {
  computePlayStats,
  isValidTimeZone,
  sessionMinutes,
  type PlaySessionInput,
} from "../play-stats.js";

const at = (iso: string) => new Date(iso);
const session = (gameId: string, start: string, minutes: number): PlaySessionInput => ({
  gameId,
  startedAt: at(start),
  endedAt: new Date(at(start).getTime() + minutes * 60_000),
});

const games = [
  { id: "a", title: "Alpha", genres: ["RPG"], platforms: ["PC"], timeToBeatNormally: 20 },
  { id: "b", title: "Beta", genres: ["RPG", "Indie"], platforms: ["Switch"] },
];
const NOW = at("2026-11-05T12:00:00Z"); // a Thursday

describe("sessionMinutes", () => {
  it("rounds to whole minutes and never goes negative", () => {
    expect(sessionMinutes(at("2026-01-01T10:00:00Z"), at("2026-01-01T10:30:20Z"))).toBe(30);
    expect(sessionMinutes(at("2026-01-01T10:00:00Z"), at("2026-01-01T09:00:00Z"))).toBe(0);
  });
});

describe("computePlayStats", () => {
  it("is empty without sessions", () => {
    const stats = computePlayStats([], games, NOW);
    expect(stats.totalMinutes).toBe(0);
    expect(stats.longestSession).toBeNull();
    expect(stats.currentStreakDays).toBe(0);
    expect(stats.topGames).toEqual([]);
    expect(stats.perWeek).toHaveLength(12);
    expect(stats.perMonth).toHaveLength(12);
  });

  it("totals per game, genre and platform and compares with time to beat", () => {
    const stats = computePlayStats(
      [
        session("a", "2026-11-03T20:00:00Z", 90),
        session("a", "2026-11-04T20:00:00Z", 30),
        session("b", "2026-11-04T10:00:00Z", 60),
      ],
      games,
      NOW
    );
    expect(stats.totalMinutes).toBe(180);
    expect(stats.sessionCount).toBe(3);
    expect(stats.topGames[0]).toMatchObject({ gameId: "a", minutes: 120, timeToBeatHours: 20 });
    expect(stats.topGames[1]).toMatchObject({ gameId: "b", minutes: 60, timeToBeatHours: null });
    expect(stats.topGenres[0]).toEqual({ name: "RPG", minutes: 180 });
    expect(stats.topPlatforms.map((p) => p.name)).toEqual(["PC", "Switch"]);
    expect(stats.longestSession).toEqual({ gameId: "a", title: "Alpha", minutes: 90 });
  });

  it("counts a session that rounds to zero minutes without adding time", () => {
    const stats = computePlayStats(
      [session("a", "2026-11-04T20:00:00Z", 0), session("a", "2026-11-04T21:00:00Z", 30)],
      games,
      NOW
    );
    expect(stats.sessionCount).toBe(2);
    expect(stats.totalMinutes).toBe(30);
    expect(stats.topGames[0]).toMatchObject({ gameId: "a", minutes: 30, sessions: 2 });
    // A game with only zero-minute sessions stays out of "Most played".
    const onlyZero = computePlayStats([session("b", "2026-11-04T20:00:00Z", 0)], games, NOW);
    expect(onlyZero.sessionCount).toBe(1);
    expect(onlyZero.topGames).toEqual([]);
    expect(stats.longestSession?.minutes).toBe(30);
  });

  it("leaves a running timer out of the totals", () => {
    const stats = computePlayStats(
      [{ gameId: "a", startedAt: at("2026-11-05T10:00:00Z"), endedAt: null }],
      games,
      NOW
    );
    expect(stats.totalMinutes).toBe(0);
    expect(stats.sessionCount).toBe(0);
  });

  it("buckets by week starting Monday and by month", () => {
    const stats = computePlayStats(
      [
        session("a", "2026-11-02T08:00:00Z", 60), // Monday, this week
        session("a", "2026-11-01T08:00:00Z", 30), // Sunday, previous week, same month
        session("a", "2026-10-15T08:00:00Z", 45),
      ],
      games,
      NOW
    );
    const last = stats.perWeek.at(-1);
    expect(last).toEqual({ start: "2026-11-02", minutes: 60 });
    expect(stats.perWeek.at(-2)).toEqual({ start: "2026-10-26", minutes: 30 });
    expect(stats.perMonth.at(-1)).toEqual({ start: "2026-11-01", minutes: 90 });
    expect(stats.perMonth.at(-2)).toEqual({ start: "2026-10-01", minutes: 45 });
  });

  it("buckets in the viewer's local time", () => {
    // 23:30 UTC on Sunday is already Monday for someone at UTC+2 (offset -120).
    const stats = computePlayStats([session("a", "2026-11-01T23:30:00Z", 60)], games, NOW, -120);
    expect(stats.perWeek.at(-1)).toEqual({ start: "2026-11-02", minutes: 60 });
  });

  it("applies daylight saving time per session with an IANA zone", () => {
    // 00:30 in Paris on 20 July (UTC+2) and on 20 January (UTC+1), both near midnight.
    const summer = session("a", "2026-07-19T22:30:00Z", 30);
    const winter = session("a", "2026-01-19T23:30:00Z", 30);
    const now = at("2026-07-25T12:00:00Z");
    const paris = computePlayStats([summer, winter], games, now, "Europe/Paris");
    // Both sessions started on the 20th local, so they fall in the weeks of Monday 20 Jul / 19 Jan.
    expect(paris.perWeek.at(-1)).toEqual({ start: "2026-07-20", minutes: 30 });
    expect(paris.perMonth.find((m) => m.start === "2026-01-01")?.minutes).toBe(30);
    // A fixed winter offset (-60) would push the summer session back to the 19th.
    const fixed = computePlayStats([summer], games, now, -60);
    expect(fixed.perWeek.at(-1)).toEqual({ start: "2026-07-20", minutes: 0 });
    expect(fixed.perWeek.at(-2)).toEqual({ start: "2026-07-13", minutes: 30 });
    // Zones without DST keep a constant offset.
    const tokyo = computePlayStats([summer], games, now, "Asia/Tokyo");
    expect(tokyo.perWeek.at(-1)).toEqual({ start: "2026-07-20", minutes: 30 });
  });

  it("keeps a streak across the daylight saving change", () => {
    // Paris moved to winter time on 25 October 2026: three evenings in a row around it.
    const days = ["2026-10-24T21:30:00Z", "2026-10-25T21:30:00Z", "2026-10-26T21:30:00Z"];
    const stats = computePlayStats(
      days.map((d) => session("a", d, 30)),
      games,
      at("2026-10-27T10:00:00Z"),
      "Europe/Paris"
    );
    expect(stats.longestStreakDays).toBe(3);
    expect(stats.currentStreakDays).toBe(3);
  });

  it("falls back to the numeric offset when the zone name is unknown", () => {
    const s = session("a", "2026-11-04T23:30:00Z", 30);
    const byName = computePlayStats([s], games, NOW, "Not/AZone");
    const byOffset = computePlayStats([s], games, NOW, 0);
    expect(byName.perWeek).toEqual(byOffset.perWeek);
  });

  it("validates IANA zone names", () => {
    expect(isValidTimeZone("Europe/Paris")).toBe(true);
    expect(isValidTimeZone("America/New_York")).toBe(true);
    expect(isValidTimeZone("Not/AZone")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });

  it("counts a streak ending today or yesterday, and the best streak", () => {
    const stats = computePlayStats(
      [
        session("a", "2026-11-05T09:00:00Z", 10),
        session("a", "2026-11-04T09:00:00Z", 10),
        session("a", "2026-11-03T09:00:00Z", 10),
        session("a", "2026-10-20T09:00:00Z", 10),
        session("a", "2026-10-19T09:00:00Z", 10),
        session("a", "2026-10-18T09:00:00Z", 10),
        session("a", "2026-10-17T09:00:00Z", 10),
      ],
      games,
      NOW
    );
    expect(stats.currentStreakDays).toBe(3);
    expect(stats.longestStreakDays).toBe(4);

    const yesterday = computePlayStats([session("a", "2026-11-04T09:00:00Z", 10)], games, NOW);
    expect(yesterday.currentStreakDays).toBe(1);
    const lapsed = computePlayStats([session("a", "2026-11-02T09:00:00Z", 10)], games, NOW);
    expect(lapsed.currentStreakDays).toBe(0);
  });
});
