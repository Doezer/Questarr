import { randomUUID } from "crypto";
import { count, eq } from "drizzle-orm";
import { db } from "../db.js";
import { apiKeys, games, indexers, platformMappings, users } from "../../shared/schema.js";
import { encryptCredentialSync } from "../credential-crypto.js";
import {
  validateIndexerInput,
  buildIndexerUpdate,
  buildNewIndexer,
  formatSyncFailure,
} from "./transactional-ops.shared.js";
import type {
  ApiKeyPublic,
  Game,
  Indexer,
  InsertPlatformMapping,
  InsertUser,
  User,
} from "../../shared/schema.js";
import type { SyncIndexersResult } from "./transactional-ops.js";

/**
 * SQLite implementations, moved verbatim from DatabaseStorage.
 *
 * better-sqlite3 transactions are synchronous: the callback returns a value
 * directly and statements are executed with .all()/.run(). See
 * ./transactional-ops.ts for why this is not shared with Postgres.
 */

export async function seedPlatformMappingsIfEmpty(
  mappings: InsertPlatformMapping[]
): Promise<{ seeded: boolean; count: number }> {
  return db.transaction((tx) => {
    const [existing] = tx.select({ count: count() }).from(platformMappings).all();
    if (existing.count > 0) {
      return { seeded: false, count: existing.count };
    }

    for (const mapping of mappings) {
      tx.insert(platformMappings)
        .values({ ...mapping, id: randomUUID() })
        .run();
    }

    const [seeded] = tx.select({ count: count() }).from(platformMappings).all();
    return { seeded: true, count: seeded.count };
  });
}

export async function registerSetupUser(insertUser: InsertUser): Promise<User> {
  return db.transaction((tx) => {
    const [result] = tx.select({ count: count() }).from(users).all();

    if (result.count > 0) {
      throw new Error("Setup already completed");
    }

    // Manually generate UUID for SQLite
    const id = randomUUID();
    const [user] = tx
      .insert(users)
      .values({ ...insertUser, id, steamId64: null })
      .returning()
      .all();
    return user;
  });
}

export async function updateGamesBatch(
  updates: { id: string; data: Partial<Game> }[]
): Promise<void> {
  db.transaction((tx) => {
    for (const update of updates) {
      tx.update(games).set(update.data).where(eq(games.id, update.id)).run();
    }
  });
}

export async function syncIndexers(
  indexersToSync: Partial<Indexer>[],
  encryptionKey: Buffer
): Promise<SyncIndexersResult> {
  const results: SyncIndexersResult = {
    added: 0,
    updated: 0,
    failed: 0,
    errors: [],
  };

  db.transaction((tx) => {
    // Fetch all existing indexers within the transaction to compare against
    const existingIndexers = tx.select().from(indexers).all();
    const existingMap = new Map(existingIndexers.map((i) => [i.url, i]));

    for (const idx of indexersToSync) {
      try {
        const invalid = validateIndexerInput(idx);
        if (invalid) {
          results.failed++;
          results.errors.push(invalid);
          continue;
        }

        const existing = existingMap.get(idx.url as string);
        const encryptedApiKey = encryptCredentialSync(idx.apiKey as string, encryptionKey);

        if (existing) {
          tx.update(indexers)
            .set(buildIndexerUpdate(idx, encryptedApiKey))
            .where(eq(indexers.id, existing.id))
            .run();
          results.updated++;
        } else {
          tx.insert(indexers)
            .values(buildNewIndexer(idx, encryptedApiKey, randomUUID()))
            .run();
          results.added++;
        }
      } catch (error) {
        results.failed++;
        results.errors.push(formatSyncFailure(idx, error));
      }
    }
  });

  return results;
}

export async function addApiKey(
  key: { userId: string; name: string; keyHash: string; prefix: string },
  maxKeys: number
): Promise<ApiKeyPublic> {
  // Counting and inserting inside one transaction closes the race two
  // concurrent requests would otherwise have around the cap: without it,
  // both could read the same under-limit count before either insert lands.
  return db.transaction((tx) => {
    const [{ count: existingKeys }] = tx
      .select({ count: count() })
      .from(apiKeys)
      .where(eq(apiKeys.userId, key.userId))
      .all();

    if (existingKeys >= maxKeys) {
      throw new Error("API key limit reached");
    }

    const [created] = tx
      .insert(apiKeys)
      .values({ ...key, id: randomUUID() })
      .returning({
        id: apiKeys.id,
        userId: apiKeys.userId,
        name: apiKeys.name,
        prefix: apiKeys.prefix,
        createdAt: apiKeys.createdAt,
        lastUsedAt: apiKeys.lastUsedAt,
      })
      .all();
    return created;
  });
}
