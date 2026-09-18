import type { Indexer } from "../../shared/schema.js";

/**
 * Dialect-independent pieces of the transactional operations.
 *
 * The two implementations in ./transactional-ops.sqlite.ts and
 * ./transactional-ops.pg.ts must differ in how they run a transaction -- that is
 * the whole reason they are separate. Everything that is merely shaping a row,
 * though, is identical on both dialects and belongs here rather than being
 * written out twice and left to drift.
 */

/** Fields a sync is allowed to overwrite, kept explicit to prevent mass assignment. */
export interface IndexerUpdateFields {
  name: string;
  url: string;
  apiKey: string;
  protocol: Indexer["protocol"];
  enabled: Indexer["enabled"];
  priority: Indexer["priority"];
  categories: Indexer["categories"];
  rssEnabled: Indexer["rssEnabled"];
  autoSearchEnabled: Indexer["autoSearchEnabled"];
  updatedAt: Date;
}

export interface NewIndexerRow extends IndexerUpdateFields {
  id: string;
  createdAt: Date;
}

/**
 * Check the fields a sync cannot proceed without.
 *
 * Returns the reason to record against the indexer, or null when it is usable.
 */
export function validateIndexerInput(idx: Partial<Indexer>): string | null {
  if (!idx.name || !idx.url || !idx.apiKey) {
    return `Skipping ${idx.name || "unknown"} - missing required fields`;
  }
  return null;
}

/**
 * The set of fields applied when an indexer with this URL already exists.
 *
 * Listed explicitly rather than spreading the caller's object so that a new
 * column cannot become remotely settable just by existing.
 */
export function buildIndexerUpdate(
  idx: Partial<Indexer>,
  encryptedApiKey: string,
  now: Date = new Date()
): IndexerUpdateFields {
  return {
    name: idx.name as string,
    url: idx.url as string,
    apiKey: encryptedApiKey,
    protocol: idx.protocol,
    enabled: idx.enabled,
    priority: idx.priority,
    categories: idx.categories,
    rssEnabled: idx.rssEnabled,
    autoSearchEnabled: idx.autoSearchEnabled,
    updatedAt: now,
  } as IndexerUpdateFields;
}

/** A complete new indexer row, with defaults filled in for optional fields. */
export function buildNewIndexer(
  idx: Partial<Indexer>,
  encryptedApiKey: string,
  id: string,
  now: Date = new Date()
): NewIndexerRow {
  return {
    id,
    name: idx.name as string,
    url: idx.url as string,
    apiKey: encryptedApiKey,
    protocol: idx.protocol ?? "torznab",
    enabled: idx.enabled ?? true,
    priority: idx.priority ?? 1,
    categories: idx.categories ?? [],
    rssEnabled: idx.rssEnabled ?? true,
    autoSearchEnabled: idx.autoSearchEnabled ?? true,
    createdAt: now,
    updatedAt: now,
  } as NewIndexerRow;
}

/** Message recorded when syncing one indexer throws. */
export function formatSyncFailure(idx: Partial<Indexer>, error: unknown): string {
  return `Failed to sync ${idx.name}: ${error instanceof Error ? error.message : "Unknown error"}`;
}
