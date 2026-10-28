import { randomUUID } from "node:crypto";
import { z } from "zod";
import { storage } from "./storage.js";
import { config } from "./config.js";
import { steamService } from "./steam.js";
import { importSteamLibraryBatch, steamLibraryImporting } from "./steam-library-import.js";
import { routesLogger } from "./logger.js";
import type { User } from "../shared/schema.js";
import type { SteamLibraryJobView } from "../shared/steam-library.js";

export const steamLibrarySelectionSchema = z
  .object({
    appIds: z
      .array(
        z
          .number()
          .int()
          .positive()
          .max(2 ** 31 - 1)
      )
      .min(1)
      .max(20_000),
  })
  .strict();

const jobSchema = z.object({
  id: z.string().uuid(),
  userId: z.string(),
  steamId: z.string(),
  appIds: steamLibrarySelectionSchema.shape.appIds,
  results: z
    .array(
      z.object({
        steamAppId: z.number().int().positive(),
        title: z.string().max(500),
        outcome: z.enum(["added", "duplicate", "not_found", "failed"]),
      })
    )
    .max(20_000),
  state: z.enum(["queued", "running", "completed", "failed"]),
  message: z.string().optional(),
});
type Job = z.infer<typeof jobSchema>;
const key = (userId: string) => `steam.library.import.${userId}`;
const active = (job: Job) => job.state === "queued" || job.state === "running";

export class SteamLibraryBusyError extends Error {}
class SteamLibraryJobError extends Error {}

async function readJob(userId: string): Promise<Job | null> {
  const value = await storage.getSystemConfig(key(userId));
  if (!value) return null;
  const job = jobSchema.parse(JSON.parse(value));
  if (
    job.userId !== userId ||
    job.results.length > job.appIds.length ||
    job.results.some((row, i) => row.steamAppId !== job.appIds[i])
  ) {
    throw new Error("Invalid Steam import checkpoint");
  }
  return job;
}

async function saveJob(job: Job): Promise<void> {
  await storage.setSystemConfig(key(job.userId), JSON.stringify(job));
}

function view(job: Job): SteamLibraryJobView {
  const counts = { added: 0, duplicates: 0, skipped: 0, failed: 0 };
  const completedAppIds: number[] = [];
  for (const row of job.results) {
    if (row.outcome === "added" || row.outcome === "duplicate") {
      completedAppIds.push(row.steamAppId);
      if (row.outcome === "added") counts.added++;
      else counts.duplicates++;
    } else if (row.outcome === "not_found") counts.skipped++;
    else counts.failed++;
  }
  return {
    id: job.id,
    state: job.state,
    total: job.appIds.length,
    processed: job.results.length,
    ...counts,
    completedAppIds,
    recentResults: job.results.slice(-10),
    canRetry:
      !active(job) &&
      (job.results.length < job.appIds.length || counts.failed + counts.skipped > 0),
    ...(job.message ? { message: job.message } : {}),
  };
}

export async function getSteamLibraryJob(userId: string): Promise<SteamLibraryJobView | null> {
  const job = await readJob(userId);
  // If a checkpoint write failed and its worker exited, expose an actionable retry
  // instead of showing a stale "running" state forever. GET does not mutate storage.
  if (job && active(job) && !steamLibraryImporting.has(userId)) {
    return view({
      ...job,
      state: "failed",
      message: "Import interrupted. Retry unfinished games.",
    });
  }
  return job ? view(job) : null;
}

async function runJob(job: Job): Promise<void> {
  try {
    job.state = "running";
    await saveJob(job);
    const user = await storage.getUser(job.userId);
    if (!config.steam.isConfigured || user?.steamId64 !== job.steamId) {
      throw new SteamLibraryJobError(
        "Your Steam configuration or linked account changed. Restore it or preview your library again."
      );
    }
    // Read Steam once per run, including after a restart, before performing any writes.
    const owned = await steamService.getOwnedGames(config.steam.apiKey!, job.steamId);
    const byId = new Map(owned.map((game) => [game.steamAppId, game]));
    if (job.appIds.slice(job.results.length).some((id) => !byId.has(id))) {
      throw new SteamLibraryJobError(
        "Your Steam library changed. Preview it again to select games that are still available."
      );
    }
    while (job.results.length < job.appIds.length) {
      const ids = job.appIds.slice(job.results.length, job.results.length + 50);
      const results = await importSteamLibraryBatch(
        job.userId,
        ids.map((id) => byId.get(id)!)
      );
      job.results.push(...results);
      // Checkpoint each batch. A crash within a batch is safe: the repeat deduplicates writes.
      await saveJob(job);
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    job.state = "completed";
    delete job.message;
    await saveJob(job);
  } catch (error) {
    job.state = "failed";
    job.message =
      error instanceof SteamLibraryJobError
        ? error.message
        : "Import interrupted. Check your Steam/IGDB connection and linked account, then retry unfinished games.";
    await saveJob(job);
  } finally {
    steamLibraryImporting.delete(job.userId);
  }
}

function launch(job: Job): void {
  setImmediate(() => {
    // Do not log provider exceptions: URLs can contain credentials.
    void runJob(job).catch(() => routesLogger.error("Could not save Steam import progress"));
  });
}

export async function startSteamLibraryJob(
  user: User,
  appIds: number[]
): Promise<SteamLibraryJobView> {
  if (steamLibraryImporting.has(user.id)) throw new SteamLibraryBusyError();
  steamLibraryImporting.add(user.id);
  try {
    const job: Job = {
      id: randomUUID(),
      userId: user.id,
      steamId: user.steamId64!,
      appIds: [...new Set(appIds)],
      results: [],
      state: "queued",
    };
    await saveJob(job);
    launch(job);
    return view(job);
  } catch (error) {
    steamLibraryImporting.delete(user.id);
    throw error;
  }
}

export async function retrySteamLibraryJob(user: User): Promise<SteamLibraryJobView | null> {
  const previous = await readJob(user.id);
  if (!previous) return null;
  if (steamLibraryImporting.has(user.id)) throw new SteamLibraryBusyError();
  const retryIds = previous.results
    .filter((row) => row.outcome === "failed" || row.outcome === "not_found")
    .map((row) => row.steamAppId);
  retryIds.push(...previous.appIds.slice(previous.results.length));
  return retryIds.length ? startSteamLibraryJob(user, retryIds) : null;
}

/** Resume saved imports at startup, independently of any browser session. */
export async function resumeSteamLibraryImports(): Promise<void> {
  for (const user of await storage.getAllUsers()) {
    try {
      const job = await readJob(user.id);
      if (job && active(job) && !steamLibraryImporting.has(user.id)) {
        steamLibraryImporting.add(user.id);
        launch(job);
      }
    } catch {
      routesLogger.error("Could not restore a saved Steam library import");
    }
  }
}
