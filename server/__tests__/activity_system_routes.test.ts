import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../storage.js", () => ({
  storage: {
    getDownloadEvents: vi.fn(),
    removeAllReleaseBlacklists: vi.fn(),
    getSystemConfig: vi.fn().mockResolvedValue(undefined),
    setSystemConfig: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock("../socket.js", () => ({ notifyUser: vi.fn() }));
vi.mock("../logger.js", () => {
  const l = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { logger: l, igdbLogger: l, routesLogger: l };
});

import { activityRouter } from "../routes/activity.js";
import { systemRouter } from "../routes/system.js";
import { registerTask, resetTaskRegistry } from "../task-registry.js";
import { storage } from "../storage.js";

function makeApp(authenticated = true) {
  const app = express();
  app.use((req, _res, next) => {
    if (authenticated) req.user = { id: "u1" } as never;
    next();
  });
  app.use("/api/activity", activityRouter);
  app.use("/api/system", systemRouter);
  return app;
}

describe("activity routes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires authentication", async () => {
    await request(makeApp(false)).get("/api/activity/history").expect(401);
  });

  it("passes filters and paging to the storage layer", async () => {
    vi.mocked(storage.getDownloadEvents).mockResolvedValue({ events: [], total: 0 });
    await request(makeApp())
      .get("/api/activity/history?eventType=failed&search=zelda&limit=10&offset=20")
      .expect(200, { events: [], total: 0 });
    expect(storage.getDownloadEvents).toHaveBeenCalledWith("u1", {
      eventType: "failed",
      search: "zelda",
      limit: 10,
      offset: 20,
    });
  });

  it("rejects an unknown event type and an oversized page", async () => {
    await request(makeApp()).get("/api/activity/history?eventType=nope").expect(400);
    await request(makeApp()).get("/api/activity/history?limit=9999").expect(400);
  });

  it("reports a storage failure as 500", async () => {
    vi.mocked(storage.getDownloadEvents).mockRejectedValue(new Error("db"));
    await request(makeApp()).get("/api/activity/history").expect(500);
  });

  it("unblocks everything for the user", async () => {
    vi.mocked(storage.removeAllReleaseBlacklists).mockResolvedValue(3);
    await request(makeApp()).delete("/api/activity/blocklist").expect(200, { removed: 3 });
    expect(storage.removeAllReleaseBlacklists).toHaveBeenCalledWith("u1");
  });

  it("reports a failed unblock-all as 500", async () => {
    vi.mocked(storage.removeAllReleaseBlacklists).mockRejectedValue(new Error("db"));
    await request(makeApp()).delete("/api/activity/blocklist").expect(500);
  });
});

describe("system task routes", () => {
  beforeEach(() => {
    resetTaskRegistry();
  });

  it("lists tasks, runs one with 202, and refuses a second run while it is running", async () => {
    let release!: () => void;
    registerTask({
      name: "slow",
      title: "Slow",
      description: "",
      intervalMs: 60_000,
      run: () => new Promise<void>((r) => (release = r)),
    });
    const app = makeApp();

    const list = await request(app).get("/api/system/tasks").expect(200);
    expect(list.body.tasks.map((t: { name: string }) => t.name)).toEqual(["slow"]);

    await request(app).post("/api/system/tasks/slow/run").expect(202);
    await request(app).post("/api/system/tasks/slow/run").expect(409);
    release();
    await request(app).post("/api/system/tasks/missing/run").expect(404);
    resetTaskRegistry();
  });
});
