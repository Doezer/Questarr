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

// Writes for one (user, kind) run one after the other, so a failure never overwrites a success
// recorded at the same moment (read-modify-write on a single document).
const queues = new Map<string, Promise<unknown>>();
function serialized<T>(id: string, task: () => Promise<T>): Promise<T> {
  const run = (queues.get(id) ?? Promise.resolve()).then(task, task);
  const tail = run.catch(() => undefined);
  queues.set(id, tail);
  void tail.then(() => {
    if (queues.get(id) === tail) queues.delete(id);
  });
  return run;
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
    await serialized(key(kind, userId), () =>
      write(kind, userId, { at: new Date().toISOString(), counts, error: null })
    );
  } catch (error) {
    logger.warn({ error, kind }, "Could not record the Playnite sync state");
  }
}

const FAILURE_MESSAGES: Record<PlayniteSyncKind, string> = {
  playStatus: "The server could not apply the statuses.",
  libraryImport: "The server could not import the library.",
  playTime: "The server could not import the play time.",
};

/** Remembers a failed request next to the last good one; its message is shown in the UI. */
export async function recordPlayniteSyncError(
  userId: string,
  kind: PlayniteSyncKind
): Promise<void> {
  try {
    await serialized(key(kind, userId), async () => {
      const previous = await read(kind, userId);
      await write(kind, userId, {
        ...previous,
        error: { at: new Date().toISOString(), message: FAILURE_MESSAGES[kind] },
      });
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
