import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../storage.js", () => ({
  storage: {
    getSystemConfig: vi.fn().mockResolvedValue(undefined),
    setSystemConfig: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock("../socket.js", () => ({ notifyUser: vi.fn() }));
vi.mock("../logger.js", () => {
  const l = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { igdbLogger: l };
});

import {
  executeTask,
  getTaskStatus,
  registerTask,
  resetTaskRegistry,
  startTaskScheduler,
  STARTUP_DELAY_MS,
} from "../task-registry.js";
import { storage } from "../storage.js";
import { notifyUser } from "../socket.js";

const HOUR = 60 * 60 * 1000;

describe("task registry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    resetTaskRegistry();
  });
  afterEach(() => {
    resetTaskRegistry();
    vi.useRealTimers();
  });

  it("records last run, duration and the next run after a success", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    registerTask({ name: "t", title: "T", description: "", intervalMs: HOUR, run });
    await executeTask("t", "manual");

    const status = getTaskStatus("t")!;
    expect(status.lastResult).toBe("success");
    expect(status.lastTrigger).toBe("manual");
    expect(status.running).toBe(false);
    expect(status.nextRunAt).toBe(status.lastFinishedAt! + HOUR);
    expect(storage.setSystemConfig).toHaveBeenCalledWith("task_state:t", expect.any(String));
    expect(notifyUser).toHaveBeenCalledWith("task:started", expect.anything());
    expect(notifyUser).toHaveBeenCalledWith("task:finished", expect.anything());
  });

  it("keeps the error and stays scheduled when a run fails", async () => {
    registerTask({
      name: "t",
      title: "T",
      description: "",
      intervalMs: HOUR,
      run: () => Promise.reject(new Error("boom")),
    });
    await executeTask("t", "schedule");
    const status = getTaskStatus("t")!;
    expect(status.lastResult).toBe("error");
    expect(status.lastError).toBe("boom");
    expect(status.nextRunAt).not.toBeNull();
  });

  it("refuses to run a task that is already running", async () => {
    let release!: () => void;
    registerTask({
      name: "t",
      title: "T",
      description: "",
      intervalMs: HOUR,
      run: () => new Promise<void>((r) => (release = r)),
    });
    const first = executeTask("t", "manual");
    expect(getTaskStatus("t")!.running).toBe(true);
    expect(await executeTask("t", "manual")).toBe("already_running");
    release();
    await first;
    expect(getTaskStatus("t")!.running).toBe(false);
  });

  it("reports unknown tasks", async () => {
    expect(await executeTask("nope", "manual")).toBe("unknown_task");
  });

  it("runs startup tasks after the startup delay and then on the interval", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    registerTask({
      name: "t",
      title: "T",
      description: "",
      intervalMs: HOUR,
      runOnStartup: true,
      run,
    });
    await startTaskScheduler();
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(STARTUP_DELAY_MS);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(HOUR);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("restores the persisted last run on startup", async () => {
    vi.mocked(storage.getSystemConfig).mockResolvedValueOnce(
      JSON.stringify({
        lastStartedAt: 1,
        lastFinishedAt: 5,
        lastDurationMs: 4,
        lastResult: "success",
        lastError: null,
        lastTrigger: "schedule",
      })
    );
    registerTask({ name: "t", title: "T", description: "", intervalMs: HOUR, run: async () => {} });
    await startTaskScheduler();
    expect(getTaskStatus("t")!.lastDurationMs).toBe(4);
  });
});
