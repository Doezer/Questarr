import { storage } from "./storage.js";
import { notifyUser } from "./socket.js";
import { igdbLogger } from "./logger.js";

export type TaskTrigger = "schedule" | "manual" | "startup";
export type TaskResult = "success" | "error";

export interface TaskDefinition {
  name: string;
  title: string;
  description: string;
  intervalMs: number;
  /** Run once shortly after startup, before the first interval elapses. */
  runOnStartup?: boolean;
  run: () => Promise<unknown>;
}

export interface TaskStatus {
  name: string;
  title: string;
  description: string;
  intervalMs: number;
  running: boolean;
  lastStartedAt: number | null;
  lastFinishedAt: number | null;
  lastDurationMs: number | null;
  lastResult: TaskResult | null;
  lastError: string | null;
  lastTrigger: TaskTrigger | null;
  nextRunAt: number | null;
}

type PersistedState = Pick<
  TaskStatus,
  "lastStartedAt" | "lastFinishedAt" | "lastDurationMs" | "lastResult" | "lastError" | "lastTrigger"
>;

interface Entry {
  def: TaskDefinition;
  state: TaskStatus;
  timer: NodeJS.Timeout | null;
}

export const STARTUP_DELAY_MS = 10_000;
const CONFIG_KEY_PREFIX = "task_state:";
const MAX_ERROR_LENGTH = 500;

const entries = new Map<string, Entry>();

function emptyState(def: TaskDefinition): TaskStatus {
  return {
    name: def.name,
    title: def.title,
    description: def.description,
    intervalMs: def.intervalMs,
    running: false,
    lastStartedAt: null,
    lastFinishedAt: null,
    lastDurationMs: null,
    lastResult: null,
    lastError: null,
    lastTrigger: null,
    nextRunAt: null,
  };
}

export function registerTask(def: TaskDefinition): void {
  const existing = entries.get(def.name);
  if (existing?.timer) clearTimeout(existing.timer);
  entries.set(def.name, { def, state: emptyState(def), timer: null });
}

export function getTaskStatuses(): TaskStatus[] {
  return [...entries.values()].map((e) => ({ ...e.state }));
}

export function getTaskStatus(name: string): TaskStatus | undefined {
  const entry = entries.get(name);
  return entry ? { ...entry.state } : undefined;
}

function schedule(entry: Entry, delayMs: number): void {
  if (entry.timer) clearTimeout(entry.timer);
  entry.state.nextRunAt = Date.now() + delayMs;
  entry.timer = setTimeout(() => {
    void executeTask(entry.def.name, "schedule");
  }, delayMs);
  // Never keep the process alive just for a task timer.
  entry.timer.unref?.();
}

async function persist(entry: Entry): Promise<void> {
  const { lastStartedAt, lastFinishedAt, lastDurationMs, lastResult, lastError, lastTrigger } =
    entry.state;
  const payload: PersistedState = {
    lastStartedAt,
    lastFinishedAt,
    lastDurationMs,
    lastResult,
    lastError,
    lastTrigger,
  };
  try {
    await storage.setSystemConfig(CONFIG_KEY_PREFIX + entry.def.name, JSON.stringify(payload));
  } catch (err) {
    igdbLogger.warn({ err, task: entry.def.name }, "Failed to persist task state");
  }
}

async function restore(entry: Entry): Promise<void> {
  try {
    const raw = await storage.getSystemConfig(CONFIG_KEY_PREFIX + entry.def.name);
    if (!raw) return;
    Object.assign(entry.state, JSON.parse(raw) as Partial<PersistedState>);
  } catch (err) {
    igdbLogger.warn({ err, task: entry.def.name }, "Failed to restore task state");
  }
}

/**
 * Runs a task unless it is already running. Resolves once the run is over; the next run is
 * scheduled interval-after-finish, so a slow run can never overlap itself.
 */
export async function executeTask(
  name: string,
  trigger: TaskTrigger
): Promise<"started" | "already_running" | "unknown_task"> {
  const entry = entries.get(name);
  if (!entry) return "unknown_task";
  if (entry.state.running) return "already_running";

  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = null;
  entry.state.running = true;
  entry.state.nextRunAt = null;
  entry.state.lastStartedAt = Date.now();
  entry.state.lastTrigger = trigger;
  try {
    notifyUser("task:started", { name, startedAt: entry.state.lastStartedAt, trigger });
  } catch (err) {
    igdbLogger.warn({ err, task: name }, "Failed to notify task start");
  }

  const startedAt = entry.state.lastStartedAt;
  try {
    await entry.def.run();
    entry.state.lastResult = "success";
    entry.state.lastError = null;
  } catch (err) {
    entry.state.lastResult = "error";
    entry.state.lastError = (err instanceof Error ? err.message : String(err)).slice(
      0,
      MAX_ERROR_LENGTH
    );
    igdbLogger.error({ err, task: name }, "Scheduled task failed");
  }
  entry.state.running = false;
  entry.state.lastFinishedAt = Date.now();
  entry.state.lastDurationMs = entry.state.lastFinishedAt - startedAt;
  schedule(entry, entry.def.intervalMs);
  await persist(entry);
  try {
    notifyUser("task:finished", { ...entry.state });
  } catch (err) {
    igdbLogger.warn({ err, task: name }, "Failed to notify task end");
  }
  return "started";
}

/** Starts every registered task: startup tasks after a short delay, the rest on their interval. */
export async function startTaskScheduler(): Promise<void> {
  for (const entry of entries.values()) {
    if (entry.timer) clearTimeout(entry.timer);
    await restore(entry);
    if (entry.def.runOnStartup) {
      entry.state.nextRunAt = Date.now() + STARTUP_DELAY_MS;
      entry.timer = setTimeout(() => {
        void executeTask(entry.def.name, "startup");
      }, STARTUP_DELAY_MS);
      entry.timer.unref?.();
    } else {
      schedule(entry, entry.def.intervalMs);
    }
  }
}

/** Test helper: forget every task and cancel their timers. */
export function resetTaskRegistry(): void {
  for (const entry of entries.values()) {
    if (entry.timer) clearTimeout(entry.timer);
  }
  entries.clear();
}
