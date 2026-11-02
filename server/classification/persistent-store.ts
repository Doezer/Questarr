import { storage } from "../storage.js";
import { clearAllMemoryCaches, type PersistentCacheStore } from "./cache.js";

/** The `classification_cache` table (SQLite or Postgres) as the second cache level. */
export const classificationCacheStore: PersistentCacheStore = {
  get: (id) => storage.getClassificationCacheEntry(id),
  put: (row) => storage.putClassificationCacheEntry(row),
  prune: (olderThan, maxRows) => storage.pruneClassificationCache(olderThan, maxRows),
};

/** Forgets every cached verdict, in memory and in the table. Returns how many rows the table held. */
export async function clearClassificationCache(): Promise<number> {
  clearAllMemoryCaches();
  return storage.clearClassificationCache();
}

export function classificationCacheSize(): Promise<number> {
  return storage.countClassificationCache();
}
