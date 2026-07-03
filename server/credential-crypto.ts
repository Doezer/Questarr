import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "./db.js";
import { systemConfig } from "../shared/schema.js";
import { config } from "./config.js";
import { logger } from "./logger.js";

const cryptoLogger = logger.child({ module: "credential-crypto" });

const ALGORITHM = "aes-256-gcm";
const ENCRYPTED_PREFIX = "enc:v1:";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
// Name of the system_config row holding the cipher material used below.
// This is just a lookup identifier for the DB row, not the key itself --
// the actual key material is always generated via crypto.randomBytes(32).
const ENCRYPTION_MATERIAL_ENTRY_NAME = "app_encryption_material";

// Cache the resolved key in memory to avoid a DB round-trip on every call.
let cachedKey: Buffer | null = null;

/**
 * Resolve the AES-256 key used to encrypt indexer/downloader credentials at
 * rest. Priority mirrors getJwtSecret() in auth.ts: env var, then DB, then
 * auto-generate and persist to the DB for future restarts.
 */
export async function getCredentialsEncryptionKey(): Promise<Buffer> {
  if (cachedKey) {
    return cachedKey;
  }

  if (config.credentials.encryptionKey) {
    cachedKey = Buffer.from(config.credentials.encryptionKey, "hex");
    return cachedKey;
  }

  try {
    const [row] = await db
      .select()
      .from(systemConfig)
      .where(eq(systemConfig.key, ENCRYPTION_MATERIAL_ENTRY_NAME));
    if (row?.value) {
      cachedKey = Buffer.from(row.value, "hex");
      return cachedKey;
    }
  } catch (error) {
    cryptoLogger.warn(
      { error },
      "Failed to load credentials encryption key from database, generating new one"
    );
  }

  const newKeyHex = crypto.randomBytes(32).toString("hex");
  try {
    await db
      .insert(systemConfig)
      .values({ key: ENCRYPTION_MATERIAL_ENTRY_NAME, value: newKeyHex })
      .onConflictDoUpdate({
        target: systemConfig.key,
        set: { value: newKeyHex, updatedAt: new Date() },
      });
    cryptoLogger.info("Generated and stored new credentials encryption key in database");
  } catch (error) {
    cryptoLogger.error({ error }, "Failed to store credentials encryption key in database");
  }

  cachedKey = Buffer.from(newKeyHex, "hex");
  return cachedKey;
}

function encryptWithKey(plaintext: string, key: Buffer): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return ENCRYPTED_PREFIX + Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

function decryptWithKey(value: string, key: Buffer): string {
  const raw = Buffer.from(value.slice(ENCRYPTED_PREFIX.length), "base64");
  const iv = raw.subarray(0, IV_LENGTH);
  const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = raw.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/** Encrypt a credential value for storage. Nullish/empty values pass through unchanged. */
export async function encryptCredential<T extends string | null | undefined>(
  plaintext: T
): Promise<T> {
  if (!plaintext) return plaintext;
  const key = await getCredentialsEncryptionKey();
  return encryptWithKey(plaintext, key) as T;
}

/**
 * Decrypt a credential value read from storage. Values without the encrypted
 * prefix are legacy plaintext rows written before this feature existed --
 * they're returned unchanged (no migration required) and get encrypted the
 * next time they're written.
 */
export async function decryptCredential<T extends string | null | undefined>(value: T): Promise<T> {
  if (!value || !value.startsWith(ENCRYPTED_PREFIX)) return value;
  const key = await getCredentialsEncryptionKey();
  return decryptWithKey(value, key) as T;
}

/**
 * Synchronous variant for use inside better-sqlite3's synchronous
 * db.transaction() callbacks (see syncIndexers in storage.ts). The caller
 * must resolve the key beforehand via getCredentialsEncryptionKey() since
 * that may need an async DB read.
 */
export function encryptCredentialSync<T extends string | null | undefined>(
  plaintext: T,
  key: Buffer
): T {
  if (!plaintext) return plaintext;
  return encryptWithKey(plaintext, key) as T;
}
