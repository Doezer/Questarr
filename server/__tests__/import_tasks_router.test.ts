import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const { mockStorage } = vi.hoisted(() => ({
  mockStorage: {
    getImportTasks: vi.fn(),
    getImportTask: vi.fn(),
    getImportTaskItems: vi.fn(),
  },
}));

vi.mock("../storage.js", () => ({ storage: mockStorage }));

import { importTasksRouter } from "../routes/import-tasks.js";

function createApp(userId = "user-1") {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as express.Request & { user?: { id: string } }).user = { id: userId };
    next();
  });
  app.use("/api/import-tasks", importTasksRouter);
  return app;
}

const makeTask = (overrides = {}) => ({
  id: "task-1",
  userId: "user-1",
  taskType: "steam_wishlist",
  status: "completed",
  triggeredBy: "cron",
  totalItems: 2,
  addedItems: 1,
  skippedItems: 1,
  failedItems: 0,
  errorMessage: null,
  startedAt: null,
  completedAt: null,
  createdAt: Date.now(),
  ...overrides,
});

describe("importTasksRouter GET /", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns task list with default limit/offset", async () => {
    const tasks = [makeTask()];
    mockStorage.getImportTasks.mockResolvedValue(tasks);

    const res = await request(createApp()).get("/api/import-tasks");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(tasks);
    expect(mockStorage.getImportTasks).toHaveBeenCalledWith("user-1", 50, 0);
  });

  it("clamps limit to 100 max", async () => {
    mockStorage.getImportTasks.mockResolvedValue([]);

    await request(createApp()).get("/api/import-tasks?limit=999&offset=10");

    expect(mockStorage.getImportTasks).toHaveBeenCalledWith("user-1", 100, 10);
  });

  it("clamps limit to 1 min", async () => {
    mockStorage.getImportTasks.mockResolvedValue([]);

    await request(createApp()).get("/api/import-tasks?limit=-1");

    expect(mockStorage.getImportTasks).toHaveBeenCalledWith("user-1", 1, 0);
  });

  it("clamps negative offset to 0", async () => {
    mockStorage.getImportTasks.mockResolvedValue([]);

    await request(createApp()).get("/api/import-tasks?offset=-5");

    expect(mockStorage.getImportTasks).toHaveBeenCalledWith("user-1", 50, 0);
  });
});

describe("importTasksRouter GET /:id", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns task with items", async () => {
    const task = makeTask();
    const items = [{ id: "item-1", taskId: "task-1", result: "added" }];
    mockStorage.getImportTask.mockResolvedValue(task);
    mockStorage.getImportTaskItems.mockResolvedValue(items);

    const res = await request(createApp()).get("/api/import-tasks/task-1");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ...task, items });
  });

  it("returns 404 when task does not exist", async () => {
    mockStorage.getImportTask.mockResolvedValue(undefined);

    const res = await request(createApp()).get("/api/import-tasks/no-such-task");

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Task not found");
  });

  it("returns 404 when task belongs to a different user", async () => {
    mockStorage.getImportTask.mockResolvedValue(makeTask({ userId: "other-user" }));

    const res = await request(createApp("user-1")).get("/api/import-tasks/task-1");

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Task not found");
  });
});
