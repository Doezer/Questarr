import { storage } from "./storage.js";
import { igdbLogger } from "./logger.js";
import { scanAllEnabledRootFolders } from "./library-scanner.js";

/** systemConfig keys: the interval in minutes (absent or "0" = off) and the last run time. */
export const LIBRARY_RESCAN_INTERVAL_KEY = "library_rescan_interval_minutes";
const LIBRARY_RESCAN_LAST_RUN_KEY = "library_rescan_last_run_at";

/** Intervals offered in the UI, in minutes. 0 turns the schedule off. */
export const LIBRARY_RESCAN_INTERVALS_MINUTES = [0, 60, 360, 720, 1440, 10080] as const;

/** How often the task wakes up to check whether a rescan is due. */
export const LIBRARY_RESCAN_TICK_MS = 15 * 60 * 1000;

export async function getLibraryRescanIntervalMinutes(): Promise<number> {
  const raw = await storage.getSystemConfig(LIBRARY_RESCAN_INTERVAL_KEY);
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : 0;
}

export async function setLibraryRescanIntervalMinutes(minutes: number): Promise<void> {
  await storage.setSystemConfig(LIBRARY_RESCAN_INTERVAL_KEY, String(minutes));
}

/**
 * Task body: rescans every enabled root folder once the configured interval has elapsed
 * since the last scheduled run. A rescan only queries IGDB for new or unresolved folders
 * (linked and ignored ones are skipped), so a frequent schedule stays cheap.
 */
export async function runScheduledLibraryRescan(now: number = Date.now()): Promise<boolean> {
  const minutes = await getLibraryRescanIntervalMinutes();
  if (minutes === 0) return false;

  const lastRaw = await storage.getSystemConfig(LIBRARY_RESCAN_LAST_RUN_KEY);
  const last = Number(lastRaw);
  if (Number.isFinite(last) && last > 0 && now - last < minutes * 60 * 1000) return false;

  const users = await storage.getAllUsers();
  const owner = users[0];
  if (!owner) return false;
  if ((await storage.getEnabledRootFolders()).length === 0) return false;

  await storage.setSystemConfig(LIBRARY_RESCAN_LAST_RUN_KEY, String(now));
  igdbLogger.info({ minutes }, "Scheduled library rescan starting");
  await scanAllEnabledRootFolders(owner.id);
  return true;
}
