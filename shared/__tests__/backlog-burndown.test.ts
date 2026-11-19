import { describe, expect, it } from "vitest";
import { computeBacklogBurndown, type BacklogEventInput } from "../backlog-burndown.js";

const at = (iso: string) => new Date(iso);
const NOW = at("2026-11-19T12:00:00Z"); // a Thursday
const event = (gameId: string, status: string, iso: string): BacklogEventInput => ({
  gameId,
  status,
  at: at(iso),
});
const session = (gameId: string, iso: string, minutes: number) => ({
  gameId,
  startedAt: at(iso),
  endedAt: new Date(at(iso).getTime() + minutes * 60_000),
});

describe("computeBacklogBurndown", () => {
  const games = [
    { id: "a", status: "completed", timeToBeatNormally: 10 },
    { id: "b", status: "playing", timeToBeatNormally: 20 },
    { id: "c", status: "owned", timeToBeatNormally: null },
    { id: "d", status: "wanted", timeToBeatNormally: 5 },
  ];
  const events = [
    event("a", "owned", "2026-10-01T10:00:00Z"),
    event("a", "completed", "2026-11-10T10:00:00Z"),
    event("b", "owned", "2026-10-15T10:00:00Z"),
    event("b", "playing", "2026-11-12T10:00:00Z"),
    event("c", "owned", "2026-11-17T10:00:00Z"),
    event("d", "wanted", "2026-11-01T10:00:00Z"),
  ];
  const sessions = [
    session("a", "2026-10-20T20:00:00Z", 300),
    session("b", "2026-11-13T20:00:00Z", 120),
    session("b", "2026-11-18T20:00:00Z", 60),
  ];

  const stats = computeBacklogBurndown(games, events, sessions, NOW);
  const week = (start: string) => stats.perWeek.find((b) => b.start === start);

  it("counts today's backlog from the games and flags the ones without an estimate", () => {
    expect(stats.current.backlog).toBe(2);
    expect(stats.current.withoutEstimate).toBe(1);
    // b: 20 h to beat, 3 h played.
    expect(stats.current.remainingHours).toBe(17);
  });

  it("builds twelve weekly and monthly buckets, oldest first", () => {
    expect(stats.perWeek).toHaveLength(12);
    expect(stats.perMonth).toHaveLength(12);
    expect(stats.perWeek.at(-1)?.start).toBe("2026-11-16");
    expect(stats.perMonth.at(-1)?.start).toBe("2026-11-01");
  });

  it("follows the backlog size through additions and completions", () => {
    // Week of 12 Oct: a is owned; b arrives on the 15th.
    expect(week("2026-10-12")).toMatchObject({ backlog: 2, added: 1, completed: 0 });
    // Week of 9 Nov: a is completed on the 10th, so only b is left (it starts playing on the 12th).
    expect(week("2026-11-09")).toMatchObject({ backlog: 1, completed: 1 });
    // Moving from owned to playing does not add to the backlog a second time.
    expect(week("2026-11-09")?.added).toBe(0);
    // Week of 16 Nov: c arrives on the 17th.
    expect(week("2026-11-16")).toMatchObject({ backlog: 2, added: 1, completed: 0 });
  });

  it("subtracts the time already played from the remaining hours of each bucket", () => {
    // End of the week of 9 Nov: b has 20 h to beat and 2 h played (13 Nov).
    expect(week("2026-11-09")?.remainingHours).toBe(18);
    // Week of 16 Nov: 3 h played on b.
    expect(week("2026-11-16")?.remainingHours).toBe(17);
  });

  it("projects when the remaining hours run out at the last 28 days' pace", () => {
    // 3 h played over 28 days.
    expect(stats.projection.hoursPerDay).toBeCloseTo(0.11, 2);
    // 17 h / (3/28 h per day) = 158.67 days, rounded up to 159.
    expect(stats.projection.clearedOn).toBe("2027-04-27");
  });

  it("has no projection without recent play or without time left", () => {
    const idle = computeBacklogBurndown(games, events, [], NOW);
    expect(idle.projection).toEqual({ hoursPerDay: 0, clearedOn: null });
    const done = computeBacklogBurndown(
      [{ id: "a", status: "completed", timeToBeatNormally: 10 }],
      [],
      sessions,
      NOW
    );
    expect(done.current).toEqual({ backlog: 0, remainingHours: 0, withoutEstimate: 0 });
    expect(done.projection.clearedOn).toBeNull();
  });

  it("ignores events of games that no longer exist and a timer still running", () => {
    const result = computeBacklogBurndown(
      games,
      [...events, event("ghost", "owned", "2026-11-01T10:00:00Z")],
      [...sessions, { gameId: "b", startedAt: at("2026-11-19T10:00:00Z"), endedAt: null }],
      NOW
    );
    expect(result.perWeek.at(-1)?.backlog).toBe(2);
    expect(result.current.remainingHours).toBe(17);
  });

  it("puts an event on the viewer's local day", () => {
    // 23:30 UTC on the 8th is already the 9th (Monday) in Paris.
    const paris = computeBacklogBurndown(
      [{ id: "x", status: "owned", timeToBeatNormally: null }],
      [event("x", "owned", "2026-11-08T23:30:00Z")],
      [],
      NOW,
      "Europe/Paris"
    );
    expect(paris.perWeek.find((b) => b.start === "2026-11-09")?.added).toBe(1);
    const utc = computeBacklogBurndown(
      [{ id: "x", status: "owned", timeToBeatNormally: null }],
      [event("x", "owned", "2026-11-08T23:30:00Z")],
      [],
      NOW,
      "UTC"
    );
    expect(utc.perWeek.find((b) => b.start === "2026-11-02")?.added).toBe(1);
  });
});
