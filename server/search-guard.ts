/**
 * Protection of the indexers shared with other apps (Prowlarr, Sonarr, Radarr): a burst of
 * searches must not open dozens of parallel requests, repeat the same request, or keep
 * querying an indexer after nobody waits for the answer.
 *
 * - identical in-flight requests (same indexer, same query) share one request;
 * - each indexer serves a few searches at a time, the others wait in line;
 * - a request nobody waits for any more (the browser went away) is aborted, and a request
 *   still waiting in line is dropped without ever being sent;
 * - background searches (auto-search) have their own lines, so a burst of interactive
 *   searches cannot starve them and the other way round.
 */

export type SearchPriority = "interactive" | "background";

export interface SearchGuardOptions {
  /** Aborted when the caller no longer waits for the answer. */
  signal?: AbortSignal | undefined;
  priority?: SearchPriority | undefined;
}

export const DEFAULT_INDEXER_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_CONCURRENT_PER_INDEXER = 2;

function readIntEnv(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

/**
 * Timeout of one indexer request: the indexer's own `timeoutSeconds` when set (1 s to 5 min),
 * otherwise `SEARCH_INDEXER_TIMEOUT_MS` (1 s to 5 min, default 30 s).
 */
export function getIndexerTimeoutMs(indexer?: { timeoutSeconds?: number | null }): number {
  const own = indexer?.timeoutSeconds;
  if (typeof own === "number" && Number.isFinite(own) && own > 0) {
    return Math.min(300_000, Math.max(1_000, Math.round(own * 1000)));
  }
  return readIntEnv("SEARCH_INDEXER_TIMEOUT_MS", DEFAULT_INDEXER_TIMEOUT_MS, 1_000, 300_000);
}

/** Thrown by the HTTP clients when an indexer answers 429 Too Many Requests. */
export class IndexerRateLimitedError extends Error {
  readonly retryAfterMs: number | null;
  constructor(message: string, retryAfterMs: number | null) {
    super(message);
    this.name = "IndexerRateLimitedError";
    this.retryAfterMs = retryAfterMs;
  }
}

/** Parses a `Retry-After` header (delay in seconds or an HTTP date) into milliseconds. */
export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number.parseInt(trimmed, 10) * 1000;
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return null;
  return Math.max(0, date - now);
}

export const BACKOFF_BASE_MS = 30_000;
export const BACKOFF_MAX_MS = 15 * 60_000;
/** A `Retry-After` is honoured up to this long; beyond it the indexer is retried anyway. */
export const RETRY_AFTER_MAX_MS = 60 * 60_000;

interface Cooldown {
  /** Order in which the 429 was registered, relative to request starts (see `tick`). */
  seq: number;
  until: number;
  failures: number;
}

const cooldowns = new Map<string, Cooldown>();
let sequence = 0;
/** A monotonic counter: orders request starts and 429s even within the same millisecond. */
function tick(): number {
  return ++sequence;
}

/** Milliseconds left before the indexer may be queried again (0 = free). */
export function getIndexerCooldownMs(indexerId: string, now = Date.now()): number {
  const cooldown = cooldowns.get(indexerId);
  if (!cooldown) return 0;
  return Math.max(0, cooldown.until - now);
}

/**
 * Registers a 429: the indexer is left alone for `Retry-After` when it gave one, otherwise for an
 * exponential delay (30 s, 1 min, 2 min ... capped at 15 min). Returns the delay applied.
 */
export function noteIndexerRateLimited(
  indexerId: string,
  retryAfterMs: number | null,
  now = Date.now()
): number {
  const failures = (cooldowns.get(indexerId)?.failures ?? 0) + 1;
  const exponential = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (failures - 1));
  const delay =
    retryAfterMs !== null
      ? Math.min(RETRY_AFTER_MAX_MS, Math.max(retryAfterMs, 1_000))
      : exponential;
  cooldowns.set(indexerId, { seq: tick(), until: now + delay, failures });
  return delay;
}

/**
 * A successful answer ends the backoff, unless a 429 was registered after that request started
 * (a concurrent search): its wait must run its course.
 */
export function noteIndexerSuccess(indexerId: string, startedAt: number = tick()): void {
  const cooldown = cooldowns.get(indexerId);
  if (cooldown && cooldown.seq < startedAt) cooldowns.delete(indexerId);
}

/** Thrown without sending anything while an indexer is backing off after a 429. */
export class IndexerCoolingDownError extends Error {
  readonly remainingMs: number;
  constructor(remainingMs: number) {
    super(
      `Indexer is rate limited (429); not queried for another ${Math.ceil(remainingMs / 1000)} s`
    );
    this.name = "IndexerCoolingDownError";
    this.remainingMs = remainingMs;
  }
}

function findRateLimited(error: unknown): IndexerRateLimitedError | null {
  if (error instanceof IndexerRateLimitedError) return error;
  const cause = error instanceof Error ? error.cause : undefined;
  return cause instanceof IndexerRateLimitedError ? cause : null;
}

/** Searches one indexer serves at once (`SEARCH_MAX_CONCURRENT_PER_INDEXER`, 1 to 10, default 2). */
export function getMaxConcurrentPerIndexer(): number {
  return readIntEnv("SEARCH_MAX_CONCURRENT_PER_INDEXER", DEFAULT_MAX_CONCURRENT_PER_INDEXER, 1, 10);
}

function abortError(): Error {
  const error = new Error("Search aborted");
  error.name = "AbortError";
  return error;
}

interface Line {
  running: number;
  waiting: Array<() => void>;
}

const lines = new Map<string, Line>();

/** Waits for a free slot on the indexer's line; the returned function frees it. */
function acquireSlot(lineKey: string, signal: AbortSignal): Promise<() => void> {
  if (signal.aborted) return Promise.reject(abortError());
  let line = lines.get(lineKey);
  if (!line) {
    line = { running: 0, waiting: [] };
    lines.set(lineKey, line);
  }
  const current = line;

  const release = () => {
    current.running--;
    const next = current.waiting.shift();
    if (next) next();
    else if (current.running === 0 && lines.get(lineKey) === current) lines.delete(lineKey);
  };

  if (current.running < getMaxConcurrentPerIndexer()) {
    current.running++;
    return Promise.resolve(release);
  }

  return new Promise<() => void>((resolve, reject) => {
    const grant = () => {
      signal.removeEventListener("abort", onAbort);
      current.running++;
      resolve(release);
    };
    const onAbort = () => {
      const at = current.waiting.indexOf(grant);
      if (at >= 0) current.waiting.splice(at, 1);
      reject(abortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    current.waiting.push(grant);
  });
}

interface InFlight<T> {
  promise: Promise<T>;
  controller: AbortController;
  subscribers: number;
}

const inFlight = new Map<string, InFlight<unknown>>();

/**
 * Runs `run` for one indexer, once for every identical request in flight (`requestKey`),
 * within the indexer's line. `run` receives the signal to pass to the HTTP request.
 */
export function guardedIndexerSearch<T>(
  indexerId: string,
  requestKey: string,
  options: SearchGuardOptions,
  run: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const priority = options.priority ?? "interactive";
  const callerSignal = options.signal;
  if (callerSignal?.aborted) return Promise.reject(abortError());

  const key = `${priority}\u0000${indexerId}\u0000${requestKey}`;
  let entry = inFlight.get(key) as InFlight<T> | undefined;
  if (!entry) {
    const controller = new AbortController();
    const created: InFlight<T> = {
      controller,
      subscribers: 0,
      promise: acquireSlot(`${priority}\u0000${indexerId}`, controller.signal).then(
        async (release) => {
          try {
            const remaining = getIndexerCooldownMs(indexerId);
            if (remaining > 0) throw new IndexerCoolingDownError(remaining);
            const startedAt = tick();
            const value = await run(controller.signal);
            noteIndexerSuccess(indexerId, startedAt);
            return value;
          } catch (error) {
            const limited = findRateLimited(error);
            if (limited) noteIndexerRateLimited(indexerId, limited.retryAfterMs);
            throw error;
          } finally {
            release();
          }
        }
      ),
    };
    const forget = () => {
      if (inFlight.get(key) === created) inFlight.delete(key);
    };
    created.promise.then(forget, forget);
    inFlight.set(key, created as InFlight<unknown>);
    entry = created;
  }

  const shared = entry;
  shared.subscribers++;
  if (!callerSignal) return shared.promise;

  // Each caller leaves on its own abort; the request itself is aborted only once nobody is left.
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      shared.subscribers--;
      if (shared.subscribers <= 0) {
        shared.controller.abort();
        if (inFlight.get(key) === shared) inFlight.delete(key);
      }
      reject(abortError());
    };
    callerSignal.addEventListener("abort", onAbort, { once: true });
    shared.promise.then(
      (value) => {
        callerSignal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        callerSignal.removeEventListener("abort", onAbort);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    );
  });
}

/** For tests. */
export function resetSearchGuard(): void {
  lines.clear();
  inFlight.clear();
  cooldowns.clear();
}
