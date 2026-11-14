import { dialect } from "../db.js";
import type {
  GamePlaySession,
  ApiKeyPublic,
  NewApiKeyInput,
  Game,
  Indexer,
  InsertPlatformMapping,
  InsertUser,
  User,
} from "../../shared/schema.js";
import * as sqliteOps from "./transactional-ops.sqlite.js";
import * as pgOps from "./transactional-ops.pg.js";

/** A finished play session that takes the place of the ones being merged or split. */
export interface PlaySessionReplacement {
  startedAt: Date;
  endedAt: Date;
  source: string;
}

export interface SyncIndexersResult {
  added: number;
  updated: number;
  failed: number;
  errors: string[];
}

/**
 * The handful of operations that genuinely need a per-dialect implementation.
 *
 * Everything else in storage.ts is written with Drizzle's dialect-neutral query
 * builder and runs unchanged on both backends. These cannot be, because
 * the two drivers disagree about what a transaction *is*: drizzle's
 * better-sqlite3 transaction takes a synchronous callback and exposes
 * .all()/.run(), while node-postgres takes an async one and has neither. No
 * single body satisfies both.
 *
 * Hand-rolling SQLite transactions as BEGIN IMMEDIATE/COMMIT so that one async
 * body could serve both was considered and rejected: every await point between
 * those statements yields to the microtask queue, so an already-queued
 * continuation from a concurrent request would run its statements inside our
 * transaction and be committed or rolled back with it. These transactions exist
 * precisely to close concurrency races -- the API key cap check and the setup
 * guard below -- so silently widening their boundaries is not a trade worth
 * making to save a hundred lines.
 */
export interface TransactionalOps {
  /** Seed platform mappings only if the table is empty. */
  seedPlatformMappingsIfEmpty(
    mappings: InsertPlatformMapping[]
  ): Promise<{ seeded: boolean; count: number }>;

  /** Create the first user, refusing if setup already ran. */
  registerSetupUser(insertUser: InsertUser): Promise<User>;

  /** Apply many game updates as one unit. */
  updateGamesBatch(updates: { id: string; data: Partial<Game> }[]): Promise<void>;

  /**
   * Upsert indexers by URL.
   *
   * The encryption key is resolved by the caller and passed in: the SQLite
   * transaction callback is synchronous and so cannot await a key lookup.
   */
  syncIndexers(
    indexersToSync: Partial<Indexer>[],
    encryptionKey: Buffer
  ): Promise<SyncIndexersResult>;

  /** Create an API key, enforcing the per-user cap inside the transaction. */
  addApiKey(key: NewApiKeyInput, maxKeys: number): Promise<ApiKeyPublic>;

  /** Upsert many config entries as one unit. */
  setSystemConfigBatch(entries: { key: string; value: string }[]): Promise<void>;

  /**
   * Swap finished, editable (manual or timer) sessions of one game for new ones, all or nothing.
   * Resolves to `undefined`, changing nothing, when any of `ids` is missing, running or imported.
   */
  replaceGamePlaySessions(
    userId: string,
    gameId: string,
    ids: string[],
    replacements: PlaySessionReplacement[]
  ): Promise<GamePlaySession[] | undefined>;
}

export const transactionalOps: TransactionalOps = dialect === "postgres" ? pgOps : sqliteOps;
