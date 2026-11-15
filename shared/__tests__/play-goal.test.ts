import { describe, expect, it } from "vitest";
import { computeGoalProgress, isValidFinishByDate, recentPlayMinutes } from "../play-goal.js";

const base = {
  today: "2026-11-14",
  gameStatus: "playing",
  playedMinutes: 600,
  recentMinutes: 14 * 60, // one hour a day
  timeToBeatHours: 20,
};

describe("isValidFinishByDate", () => {
  it("accepts real days and rejects the rest", () => {
    expect(isValidFinishByDate("2026-12-31")).toBe(true);
    expect(isValidFinishByDate("2028-02-29")).toBe(true);
    expect(isValidFinishByDate("2026-02-30")).toBe(false);
    expect(isValidFinishByDate("2026-1-5")).toBe(false);
    expect(isValidFinishByDate("tomorrow")).toBe(false);
  });
});

describe("computeGoalProgress", () => {
  it("is on track when the pace needed is within the recent pace", () => {
    // 10h left, 10 days (today included) → 1h/day, equal to the recent pace.
    const p = computeGoalProgress({ ...base, finishBy: "2026-11-23" });
    expect(p).toMatchObject({
      status: "on-track",
      daysLeft: 9,
      remainingMinutes: 600,
      neededMinutesPerDay: 60,
      recentMinutesPerDay: 60,
    });
  });

  it("is behind when more time per day is needed than lately played", () => {
    expect(computeGoalProgress({ ...base, finishBy: "2026-11-18" }).status).toBe("behind");
  });

  it("counts the target day itself", () => {
    const p = computeGoalProgress({ ...base, finishBy: "2026-11-14" });
    expect(p.daysLeft).toBe(0);
    expect(p.neededMinutesPerDay).toBe(600);
  });

  it("is overdue after the target day unless the game is completed", () => {
    const late = computeGoalProgress({ ...base, finishBy: "2026-11-10" });
    expect(late).toMatchObject({ status: "overdue", daysLeft: -4, neededMinutesPerDay: null });
    expect(
      computeGoalProgress({ ...base, finishBy: "2026-11-10", gameStatus: "completed" }).status
    ).toBe("done");
  });

  it("needs nothing once the Time to Beat is already played", () => {
    const p = computeGoalProgress({ ...base, finishBy: "2026-11-20", playedMinutes: 1500 });
    expect(p).toMatchObject({ status: "on-track", remainingMinutes: 0, neededMinutesPerDay: 0 });
  });

  it("only counts down without a Time to Beat estimate", () => {
    const p = computeGoalProgress({ ...base, finishBy: "2026-11-20", timeToBeatHours: null });
    expect(p).toMatchObject({ status: "no-estimate", remainingMinutes: null });
  });

  it("is behind when nothing was played lately", () => {
    expect(computeGoalProgress({ ...base, finishBy: "2026-11-20", recentMinutes: 0 }).status).toBe(
      "behind"
    );
  });
});

describe("recentPlayMinutes", () => {
  const now = new Date("2026-11-14T12:00:00Z");
  it("sums finished sessions that ended in the last 14 days", () => {
    const at = (iso: string) => new Date(iso);
    expect(
      recentPlayMinutes(
        [
          { startedAt: at("2026-11-13T10:00:00Z"), endedAt: at("2026-11-13T11:30:00Z") }, // 90
          { startedAt: at("2026-10-01T10:00:00Z"), endedAt: at("2026-10-01T12:00:00Z") }, // old
          { startedAt: at("2026-11-14T11:00:00Z"), endedAt: null }, // running
        ],
        now
      )
    ).toBe(90);
  });
});
