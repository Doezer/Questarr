import { createHash } from "node:crypto";
import { logger } from "../logger.js";

const cacheLogger = logger.child({ module: "classification-cache" });

/** How long a verdict stays in memory; the table keeps it longer so a restart does not lose it. */
export const MEMORY_TTL_MS = 24 * 60 * 60 * 1000;
export const MEMORY_MAX_ENTRIES = 2000;
export const PERSISTENT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const PERSISTENT_MAX_ROWS = 20_000;
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;

export type CacheNamespace = "pipeline" | "analysis";

export interface StoredVerdict {
  verdict: string;
  storedAt: Date;
}

/** The table behind the memory level (`classification_cache`), kept abstract for the tests. */
export interface PersistentCacheStore {
  get(id: string): Promise<StoredVerdict | undefined>;
  put(row: {
    id: string;
    namespace: CacheNamespace;
    verdict: string;
    storedAt: Date;
  }): Promise<void>;
  prune(olderThan: Date, maxRows: number): Promise<number>;
}

export interface TieredCacheOptions<T> {
  namespace: CacheNamespace;
  /** Returns the value when the stored JSON still has the expected shape, null otherwise. */
  parse: (raw: unknown) => T | null;
  store?: PersistentCacheStore | undefined;
  now?: (() => number) | undefined;
}

const registry = new Set<TieredCache<unknown>>();

/** Empties the memory level of every cache; the table is cleared by the caller. */
export function clearAllMemoryCaches(): void {
  for (const cache of registry) cache.clearMemory();
}

/**
 * A verdict cache with the in-memory map as first level and the `classification_cache` table
 * behind it. The key must carry everything that changes the answer (pipeline version, mode, model
 * versions, provider, release), so a changed version never matches and its rows simply age out.
 * A table failure is logged and ignored: the cache is an optimisation, never a dependency.
 */
export class TieredCache<T> {
  private readonly memory = new Map<string, { at: number; value: T }>();
  private generation_ = 0;
  private lastPrune = 0;
  private readonly now: () => number;

  constructor(private readonly options: TieredCacheOptions<T>) {
    this.now = options.now ?? (() => Date.now());
    registry.add(this as TieredCache<unknown>);
  }

  /** Changes on every clear, so a call that started before it cannot write a stale result back. */
  get generation(): number {
    return this.generation_;
  }

  clearMemory(): void {
    this.generation_++;
    this.memory.clear();
  }

  private id(key: string): string {
    return `${this.options.namespace}:${createHash("sha256").update(key).digest("hex")}`;
  }

  async get(key: string): Promise<T | null> {
    const hit = this.memory.get(key);
    if (hit) {
      if (this.now() - hit.at < MEMORY_TTL_MS) return hit.value;
      this.memory.delete(key);
    }
    const store = this.options.store;
    if (!store) return null;
    const generation = this.generation_;
    try {
      const row = await store.get(this.id(key));
      if (!row || this.now() - row.storedAt.getTime() >= PERSISTENT_TTL_MS) return null;
      const value = this.options.parse(JSON.parse(row.verdict));
      if (value === null) return null;
      if (generation === this.generation_) this.remember(key, value);
      return value;
    } catch (error) {
      cacheLogger.warn({ error }, "Could not read the persistent classification cache");
      return null;
    }
  }

  private remember(key: string, value: T): void {
    if (this.memory.size >= MEMORY_MAX_ENTRIES) {
      const oldest = this.memory.keys().next().value;
      if (oldest !== undefined) this.memory.delete(oldest);
    }
    this.memory.set(key, { at: this.now(), value });
  }

  /** `generation` is the value read before the work began; a clear since then drops the write. */
  async set(key: string, value: T, generation: number = this.generation_): Promise<void> {
    if (generation !== this.generation_) return;
    this.remember(key, value);
    const store = this.options.store;
    if (!store) return;
    try {
      await store.put({
        id: this.id(key),
        namespace: this.options.namespace,
        verdict: JSON.stringify(value),
        storedAt: new Date(this.now()),
      });
      await this.pruneIfDue(store);
    } catch (error) {
      cacheLogger.warn({ error }, "Could not write the persistent classification cache");
    }
  }

  private async pruneIfDue(store: PersistentCacheStore): Promise<void> {
    const now = this.now();
    if (now - this.lastPrune < PRUNE_INTERVAL_MS) return;
    this.lastPrune = now;
    const removed = await store.prune(new Date(now - PERSISTENT_TTL_MS), PERSISTENT_MAX_ROWS);
    if (removed > 0) cacheLogger.debug({ removed }, "Pruned the persistent classification cache");
  }
}
