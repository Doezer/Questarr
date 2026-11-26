import { describe, expect, it } from "vitest";
import {
  computePlayStats,
  isValidDateString,
  isValidTimeZone,
  sessionsInRange,
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
  it("counts steam_import in totals but not in streaks, longest session or weekly charts", () => {
    const stats = computePlayStats(
      [{ ...session("a", "2026-11-03T08:00:00Z", 600), source: "steam_import" }],
      games,
      NOW
    );
    expect(stats.totalMinutes).toBe(600);
    expect(stats.topGames[0]).toMatchObject({ gameId: "a", minutes: 600 });
    expect(stats.longestSession).toBeNull();
    expect(stats.currentStreakDays).toBe(0);
    expect(stats.perWeek.every((b) => b.minutes === 0)).toBe(true);
    expect(stats.perMonth.every((b) => b.minutes === 0)).toBe(true);
  });

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

describe("computePlayStats with estimated Steam sessions", () => {
  it("counts their minutes but keeps them out of the longest session and the streaks", () => {
    const estimated = { ...session("a", "2026-11-04T08:00:00Z", 600), source: "steam" };
    const real = { ...session("b", "2026-11-02T20:00:00Z", 45), source: "manual" };
    const stats = computePlayStats([estimated, real], games, NOW);
    expect(stats.totalMinutes).toBe(645);
    expect(stats.longestSession).toMatchObject({ gameId: "b", minutes: 45 });
    // Only the manual day counts: Nov 2 is neither today nor yesterday, so the run is over.
    expect(stats.currentStreakDays).toBe(0);
    expect(stats.longestStreakDays).toBe(1);
    expect(stats.topGames[0]).toMatchObject({ gameId: "a", minutes: 600 });
    expect(stats.perWeek.at(-1)?.minutes).toBe(645);
  });

  it("has no longest session when every session is estimated", () => {
    const stats = computePlayStats(
      [{ ...session("a", "2026-11-04T08:00:00Z", 90), source: "steam" }],
      games,
      NOW
    );
    expect(stats.totalMinutes).toBe(90);
    expect(stats.longestSession).toBeNull();
    expect(stats.longestStreakDays).toBe(0);
  });

  it("lists unfinished games with a goal, soonest first", () => {
    const stats = computePlayStats(
      [session("a", "2026-11-04T10:00:00Z", 120)],
      [
        { ...games[0]!, finishBy: "2026-12-01", status: "playing" },
        { ...games[1]!, finishBy: "2026-11-20", status: "playing" },
        { id: "c", title: "Gamma", finishBy: "2026-11-01", status: "completed" },
        { id: "d", title: "Delta" },
      ],
      NOW
    );
    expect(stats.goals.map((g) => g.gameId)).toEqual(["b", "a"]);
    expect(stats.goals[1]).toMatchObject({
      playedMinutes: 120,
      remainingMinutes: 1080,
      daysLeft: 26,
      status: "behind",
    });
    expect(stats.goals[0]).toMatchObject({ status: "no-estimate", timeToBeatHours: null });
  });
});

describe("computePlayStats range, heatmap and session statistics", () => {
  const sessions = [
    session("a", "2026-10-01T20:00:00Z", 30),
    session("a", "2026-11-03T20:00:00Z", 90),
    session("b", "2026-11-04T10:00:00Z", 60),
    { ...session("a", "2026-11-04T12:00:00Z", 600), source: "steam" },
  ];

  it("narrows totals, most played and tags to the range but not goals or streaks", () => {
    const all = computePlayStats(sessions, games, NOW);
    const ranged = computePlayStats(sessions, games, NOW, 0, {
      from: "2026-11-01",
      to: "2026-11-30",
    });
    expect(all.totalMinutes).toBe(780);
    expect(ranged.totalMinutes).toBe(750);
    expect(ranged.sessionCount).toBe(3);
    expect(ranged.topGames[0]).toMatchObject({ gameId: "a", minutes: 690 });
    expect(ranged.range).toEqual({ from: "2026-11-01", to: "2026-11-30" });
    expect(ranged.currentStreakDays).toBe(all.currentStreakDays);
    expect(ranged.perWeek).toEqual(all.perWeek);
  });

  it("keeps estimated sessions out of the heatmap and session statistics", () => {
    const stats = computePlayStats(sessions, games, NOW, 0, {
      from: "2026-11-01",
      to: "2026-11-05",
    });
    expect(stats.sessionStats.sampleSize).toBe(2);
    expect(stats.sessionStats.averageMinutes).toBe(75);
    expect(stats.sessionStats.medianMinutes).toBe(75);
    expect(stats.sessionStats.buckets.map((b) => b.count)).toEqual([0, 0, 2, 0, 0]);
    expect(stats.heatmap.days.map((d) => d.start)).toEqual([
      "2026-11-01",
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
      "2026-11-05",
    ]);
    expect(stats.heatmap.days.find((d) => d.start === "2026-11-04")?.minutes).toBe(60);
    // 3 Nov 2026 is a Tuesday, 4 Nov a Wednesday.
    expect(stats.heatmap.perWeekday).toEqual([0, 90, 60, 0, 0, 0, 0]);
    expect(stats.heatmap.perHour[20]).toBe(90);
    expect(stats.heatmap.perHour[10]).toBe(60);
  });

  it("counts a timer that rounds to zero minutes as a duration sample", () => {
    const stats = computePlayStats([session("a", "2026-11-04T10:00:00Z", 0.3)], games, NOW, 0, {
      from: "2026-11-01",
    });
    expect(stats.sessionStats.sampleSize).toBe(1);
    expect(stats.sessionStats.averageMinutes).toBe(0);
    expect(stats.sessionStats.buckets[0]?.count).toBe(1);
    expect(stats.totalMinutes).toBe(0);
  });

  it("caps the heatmap at 53 weeks and ends today when the range is open", () => {
    const stats = computePlayStats(sessions, games, NOW);
    expect(stats.heatmap.days.at(-1)?.start).toBe("2026-11-05");
    expect(stats.heatmap.days.length).toBeLessThanOrEqual(53 * 7);
    expect(stats.heatmap.days.length).toBeGreaterThan(52 * 7);
  });

  it("buckets days in the viewer's time zone", () => {
    const late = [session("a", "2026-11-03T23:30:00Z", 30)];
    const paris = computePlayStats(late, games, NOW, "Europe/Paris", {
      from: "2026-11-04",
      to: "2026-11-04",
    });
    expect(paris.totalMinutes).toBe(30);
    const utc = computePlayStats(late, games, NOW, "UTC", { from: "2026-11-04", to: "2026-11-04" });
    expect(utc.totalMinutes).toBe(0);
  });
});

describe("isValidDateString and sessionsInRange", () => {
  it("accepts only real calendar days", () => {
    expect(isValidDateString("2026-02-28")).toBe(true);
    expect(isValidDateString("2026-02-30")).toBe(false);
    expect(isValidDateString("2026-2-3")).toBe(false);
  });

  it("drops running timers and sessions outside the range", () => {
    const running: PlaySessionInput = {
      gameId: "a",
      startedAt: at("2026-11-03T10:00:00Z"),
      endedAt: null,
    };
    const kept = sessionsInRange(
      [running, session("a", "2026-11-03T20:00:00Z", 10), session("a", "2026-10-01T20:00:00Z", 10)],
      "UTC",
      { from: "2026-11-01" }
    );
    expect(kept).toHaveLength(1);
  });
});
