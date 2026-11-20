import { z } from "zod";
import { storage } from "./storage.js";
import { routesLogger as logger } from "./logger.js";

/** What the Playnite extension can send: completion statuses, a library import, play time totals. */
export const PLAYNITE_SYNC_KINDS = ["playStatus", "libraryImport", "playTime"] as const;
export type PlayniteSyncKind = (typeof PLAYNITE_SYNC_KINDS)[number];

const entrySchema = z.object({
  /** When the last request that worked arrived (ISO). */
  at: z.string().nullable().default(null),
  /** Counters of that request, as the route reported them (received, updated, skipped...). */
  counts: z.record(z.string(), z.number()).default({}),
  /** The last failure, cleared by the next request that works. */
  error: z.object({ at: z.string(), message: z.string() }).nullable().default(null),
});

export type PlayniteSyncEntry = z.infer<typeof entrySchema>;
export type PlayniteSyncState = Record<PlayniteSyncKind, PlayniteSyncEntry>;

// One document per kind and user, so two kinds arriving together never overwrite each other.
const key = (kind: PlayniteSyncKind, userId: string) => `playnite.sync.${kind}.${userId}`;

async function read(kind: PlayniteSyncKind, userId: string): Promise<PlayniteSyncEntry> {
  const raw = await storage.getSystemConfig(key(kind, userId));
  if (!raw) return entrySchema.parse({});
  try {
    return entrySchema.parse(JSON.parse(raw));
  } catch {
    return entrySchema.parse({});
  }
}

async function write(kind: PlayniteSyncKind, userId: string, entry: PlayniteSyncEntry) {
  await storage.setSystemConfig(key(kind, userId), JSON.stringify(entry));
}

/** Remembers a request that worked. Never throws: the sync itself must not fail because of it. */
export async function recordPlayniteSync(
  userId: string,
  kind: PlayniteSyncKind,
  counts: Record<string, number>
): Promise<void> {
  try {
    await write(kind, userId, { at: new Date().toISOString(), counts, error: null });
  } catch (error) {
    logger.warn({ error, kind }, "Could not record the Playnite sync state");
  }
}

/** Remembers a failed request next to the last good one. The message is shown in the UI. */
export async function recordPlayniteSyncError(
  userId: string,
  kind: PlayniteSyncKind,
  message: string
): Promise<void> {
  try {
    const previous = await read(kind, userId);
    await write(kind, userId, {
      ...previous,
      error: { at: new Date().toISOString(), message },
    });
  } catch (error) {
    logger.warn({ error, kind }, "Could not record the Playnite sync failure");
  }
}

export async function getPlayniteSyncState(userId: string): Promise<PlayniteSyncState> {
  const [playStatus, libraryImport, playTime] = await Promise.all(
    PLAYNITE_SYNC_KINDS.map((kind) => read(kind, userId))
  );
  return { playStatus: playStatus!, libraryImport: libraryImport!, playTime: playTime! };
}
