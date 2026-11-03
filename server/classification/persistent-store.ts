import { storage } from "../storage.js";
import { clearAllMemoryCaches, settlePendingWrites, type PersistentCacheStore } from "./cache.js";

/** The `classification_cache` table (SQLite or Postgres) as the second cache level. */
export const classificationCacheStore: PersistentCacheStore = {
  get: (id) => storage.getClassificationCacheEntry(id),
  put: (row) => storage.putClassificationCacheEntry(row),
  prune: (olderThan, maxRows) => storage.pruneClassificationCache(olderThan, maxRows),
};

/** Forgets every cached verdict, in memory and in the table. Returns how many rows the table held. */
export async function clearClassificationCache(): Promise<number> {
  // The generation change stops new writes; the ones already under way must land before the
  // deletion, or a row could outlive it
  clearAllMemoryCaches();
  await settlePendingWrites();
  const removed = await storage.clearClassificationCache();
  // A lookup that began during the deletion may have read a row the table still held
  clearAllMemoryCaches();
  return removed;
}

export function classificationCacheSize(): Promise<number> {
  return storage.countClassificationCache();
}
