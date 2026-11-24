import { describe, expect, it } from "vitest";
import {
  currentPeriod,
  generateQuests,
  monthBacklogProgress,
  questProgress,
  unlockedMedals,
  type QuestGameInput,
} from "../quests";

const NOW = new Date("2026-11-18T12:00:00Z"); // a Wednesday
const week = currentPeriod("week", NOW);
const month = currentPeriod("month", NOW);

const game = (id: string, over: Partial<QuestGameInput> = {}): QuestGameInput => ({
  id,
  status: "owned",
  ...over,
});

describe("currentPeriod", () => {
  it("starts the week on Monday and the month on the 1st", () => {
    expect(week.start).toBe("2026-11-16");
    expect(week.endDay - week.startDay).toBe(7);
    expect(month.start).toBe("2026-11-01");
    expect(month.endDay - month.startDay).toBe(30);
  });
});

describe("generateQuests", () => {
  it("offers nothing for an empty backlog", () => {
    expect(generateQuests("u", [], week)).toEqual([]);
    expect(generateQuests("u", [game("a", { status: "completed" })], month)).toEqual([]);
  });

  it("never gives a sprint to a game without a Time to Beat", () => {
    const quests = generateQuests("u", [game("a"), game("b", { timeToBeatNormally: 12 })], week);
    expect(quests.map((q) => q.kind)).toEqual(["backlog_cleanup"]);
  });

  it("picks the sprint game from the short ones", () => {
    const games = [game("a", { timeToBeatNormally: 3 }), game("b", { timeToBeatNormally: 40 })];
    const sprint = generateQuests("u", games, week).find((q) => q.kind === "weekend_sprint");
    expect(sprint?.gameId).toBe("a");
  });

  it("is stable for a user and period", () => {
    const games = Array.from({ length: 8 }, (_, i) =>
      game(`g${i}`, {
        timeToBeatNormally: 2 + i / 10,
        releaseDate: "1999-01-01",
        addedAt: new Date("2020-01-01"),
      })
    );
    expect(generateQuests("u", games, month)).toEqual(generateQuests("u", games, month));
    expect(generateQuests("u", games, month).length).toBeLessThanOrEqual(2);
  });

  it("needs three old games for a Backlog Slayer", () => {
    const old = (id: string) => game(id, { addedAt: new Date("2020-01-01") });
    const kinds = (games: QuestGameInput[]) =>
      Array.from({ length: 30 }, (_, i) => generateQuests(`u${i}`, games, month)).flatMap((q) =>
        q.map((d) => d.kind)
      );
    expect(kinds([old("a"), old("b")])).not.toContain("backlog_slayer");
    expect(kinds([old("a"), old("b"), old("c")])).toContain("backlog_slayer");
  });
});

describe("questProgress", () => {
  const at = (iso: string) => new Date(iso);
  it("follows the sprint game being completed in the week", () => {
    const q = {
      kind: "weekend_sprint" as const,
      period: "week" as const,
      periodStart: week.start,
      gameId: "a",
    };
    const games = [game("a")];
    expect(questProgress(q, games, [], [])).toBe(0);
    expect(
      questProgress(
        q,
        games,
        [{ gameId: "a", status: "completed", at: at("2026-11-10T10:00:00Z") }],
        []
      )
    ).toBe(0);
    expect(
      questProgress(
        q,
        games,
        [
          { gameId: "a", status: "owned", at: at("2026-11-01T10:00:00Z") },
          { gameId: "a", status: "completed", at: at("2026-11-17T10:00:00Z") },
        ],
        []
      )
    ).toBe(1);
  });

  it("counts old games played or completed in the month", () => {
    const q = {
      kind: "backlog_slayer" as const,
      period: "month" as const,
      periodStart: month.start,
      gameId: null,
    };
    const old = new Date("2020-01-01");
    const games = [game("a", { addedAt: old }), game("b", { addedAt: old }), game("c")];
    const sessions = [
      { gameId: "a", startedAt: at("2026-11-05T10:00:00Z") },
      { gameId: "a", startedAt: at("2026-11-06T10:00:00Z") },
      { gameId: "c", startedAt: at("2026-11-06T10:00:00Z") },
    ];
    const events = [
      { gameId: "b", status: "owned", at: at("2026-11-01T10:00:00Z") },
      { gameId: "b", status: "completed", at: at("2026-11-07T10:00:00Z") },
    ];
    expect(questProgress(q, games, events, sessions)).toBe(2);
  });

  it("counts retro games only", () => {
    const q = {
      kind: "retro_explorer" as const,
      period: "month" as const,
      periodStart: month.start,
      gameId: null,
    };
    const games = [
      game("a", { releaseDate: "1998-05-01" }),
      game("b", { releaseDate: "2010-01-01" }),
    ];
    const sessions = [
      { gameId: "a", startedAt: at("2026-11-05T10:00:00Z") },
      { gameId: "b", startedAt: at("2026-11-05T10:00:00Z") },
    ];
    expect(questProgress(q, games, [], sessions)).toBe(1);
  });
});

describe("completions that count", () => {
  const q = {
    kind: "backlog_cleanup" as const,
    period: "week" as const,
    periodStart: week.start,
    gameId: null,
  };
  const at = (iso: string) => new Date(iso);
  it("ignores games added as completed or taken from the wishlist", () => {
    const events = [
      { gameId: "a", status: "completed", at: at("2026-11-17T10:00:00Z") },
      { gameId: "b", status: "wanted", at: at("2026-11-01T10:00:00Z") },
      { gameId: "b", status: "completed", at: at("2026-11-17T11:00:00Z") },
      { gameId: "c", status: "playing", at: at("2026-11-01T10:00:00Z") },
      { gameId: "c", status: "completed", at: at("2026-11-17T12:00:00Z") },
    ];
    expect(questProgress(q, [], events, [])).toBe(1);
  });
});

describe("sessions that count", () => {
  const at = (iso: string) => new Date(iso);
  const q = {
    kind: "retro_explorer" as const,
    period: "month" as const,
    periodStart: month.start,
    gameId: null,
  };
  const games = [game("a", { status: "completed", releaseDate: "1998-05-01" })];
  const events = [
    { gameId: "a", status: "owned", at: at("2026-10-01T10:00:00Z") },
    { gameId: "a", status: "completed", at: at("2026-11-10T10:00:00Z") },
  ];
  it("credits play before the completion, not a replay after it", () => {
    const before = [{ gameId: "a", startedAt: at("2026-11-05T10:00:00Z") }];
    const after = [{ gameId: "a", startedAt: at("2026-11-12T10:00:00Z") }];
    expect(questProgress(q, games, events, before)).toBe(1);
    expect(questProgress({ ...q }, games, [events[0]!], after)).toBe(1);
    const replayOnly = [{ gameId: "a", startedAt: at("2026-11-12T10:00:00Z") }];
    const done = [
      { gameId: "a", status: "owned", at: at("2026-09-01T10:00:00Z") },
      { gameId: "a", status: "completed", at: at("2026-10-10T10:00:00Z") },
    ];
    expect(questProgress(q, games, done, replayOnly)).toBe(0);
  });
});

describe("monthBacklogProgress", () => {
  it("counts only completions out of the backlog", () => {
    const at = (iso: string) => new Date(iso);
    const games = [
      game("a", { status: "completed" }),
      game("b", { status: "completed" }),
      game("c"),
      game("d"),
    ];
    const events = [
      { gameId: "a", status: "owned", at: at("2026-10-01T10:00:00Z") },
      { gameId: "a", status: "completed", at: at("2026-11-05T10:00:00Z") },
      { gameId: "b", status: "completed", at: at("2026-11-06T10:00:00Z") },
    ];
    expect(monthBacklogProgress(games, events, NOW)).toEqual({
      completed: 1,
      total: 3,
      percent: 33,
    });
    expect(monthBacklogProgress([], [], NOW)).toBeNull();
  });
});

describe("unlockedMedals", () => {
  it("unlocks medals from completed quests", () => {
    expect(unlockedMedals([])).toEqual([]);
    expect(unlockedMedals(["backlog_slayer"])).toEqual(["backlog_slayer"]);
    expect(
      unlockedMedals([
        "weekend_sprint",
        "backlog_cleanup",
        "backlog_cleanup",
        "backlog_cleanup",
        "backlog_cleanup",
      ])
    ).toEqual(["sprinter", "regular"]);
  });
});
