import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { activeTestDialects, setupTestDb, type TestDb } from "./helpers/db-harness.js";

describe.each(activeTestDialects())("backlog quests on %s", (dialect) => {
  let ctx: TestDb;
  let syncQuests: typeof import("../quest-service.js").syncQuests;

  beforeAll(async () => {
    ctx = await setupTestDb(dialect);
    ({ syncQuests } = await import("../quest-service.js"));
  }, 60_000);

  afterAll(async () => {
    await ctx?.teardown();
  });

  it("offers no quest for an empty backlog, then generates and completes them", async () => {
    const storage = ctx.storage;
    const user = await storage.registerSetupUser({ username: "quester", passwordHash: "h" });

    const empty = await syncQuests(user.id, 0);
    expect(empty.enabled).toBe(true);
    expect(empty.current).toEqual([]);
    expect(empty.backlogProgress).toBeNull();

    const game = await storage.addGame({
      userId: user.id,
      title: "Short Game",
      status: "owned",
      timeToBeatNormally: 3,
    } as never);

    const first = await syncQuests(user.id, 0);
    const kinds = first.current.map((q) => q.kind);
    expect(kinds).toContain("backlog_cleanup");
    expect(first.current.every((q) => q.status === "active")).toBe(true);
    // The same period gives the same quests, without duplicating them.
    const again = await syncQuests(user.id, 0);
    expect(again.current.map((q) => q.id).sort()).toEqual(first.current.map((q) => q.id).sort());

    await storage.updateGameStatus(game.id, { status: "completed" });
    const done = await syncQuests(user.id, 0);
    const cleanup = done.current.find((q) => q.kind === "backlog_cleanup");
    expect(cleanup?.status).toBe("completed");
    expect(cleanup?.progress).toBe(1);
    expect(done.backlogProgress?.completed).toBe(1);
    expect(done.backlogProgress?.percent).toBe(100);
  });

  it("returns nothing when quests are switched off", async () => {
    const storage = ctx.storage;
    const [user] = await storage.getAllUsers();
    await storage.createUserSettings({ userId: user!.id, questsEnabled: false } as never);
    const off = await syncQuests(user!.id, 0);
    expect(off).toMatchObject({ enabled: false, current: [], history: [] });
  });
});
