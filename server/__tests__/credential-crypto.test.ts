import { describe, it, expect, beforeEach, vi } from "vitest";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import { systemConfig } from "../../shared/schema.js";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

describe("credential-crypto", () => {
  let db: BetterSQLite3Database<Record<string, unknown>>;
  let cryptoModule: typeof import("../credential-crypto.js");

  beforeEach(async () => {
    process.env.SQLITE_DB_PATH = ":memory:";
    delete process.env.CREDENTIALS_ENCRYPTION_KEY;

    // Fresh module registry so the in-memory encryption key cache resets per test.
    vi.resetModules();

    const dbModule = await import("../db.js");
    db = dbModule.db;
    await migrate(db, { migrationsFolder: "migrations" });

    cryptoModule = await import("../credential-crypto.js");
  });

  it("round-trips a plaintext value through encrypt/decrypt", async () => {
    const { encryptCredential, decryptCredential } = cryptoModule;

    const ciphertext = await encryptCredential("my-secret-api-key");
    expect(ciphertext).not.toBe("my-secret-api-key");
    expect(ciphertext?.startsWith("enc:v1:")).toBe(true);

    const plaintext = await decryptCredential(ciphertext);
    expect(plaintext).toBe("my-secret-api-key");
  });

  it("produces different ciphertext for the same plaintext on each call (random IV)", async () => {
    const { encryptCredential } = cryptoModule;

    const first = await encryptCredential("same-value");
    const second = await encryptCredential("same-value");
    expect(first).not.toBe(second);
  });

  it("passes through null/undefined/empty values unchanged", async () => {
    const { encryptCredential, decryptCredential } = cryptoModule;

    expect(await encryptCredential(null)).toBeNull();
    expect(await encryptCredential(undefined)).toBeUndefined();
    expect(await encryptCredential("")).toBe("");
    expect(await decryptCredential(null)).toBeNull();
    expect(await decryptCredential(undefined)).toBeUndefined();
    expect(await decryptCredential("")).toBe("");
  });

  it("treats a value without the encrypted prefix as legacy plaintext", async () => {
    const { decryptCredential } = cryptoModule;

    const legacyPlaintextRow = "an-old-plaintext-api-key";
    expect(await decryptCredential(legacyPlaintextRow)).toBe(legacyPlaintextRow);
  });

  it("auto-generates and persists an encryption key to system_config on first use", async () => {
    const { encryptCredential } = cryptoModule;

    const [before] = await db
      .select()
      .from(systemConfig)
      .where(eq(systemConfig.key, "credentials_encryption_key"));
    expect(before).toBeUndefined();

    await encryptCredential("anything");

    const [after] = await db
      .select()
      .from(systemConfig)
      .where(eq(systemConfig.key, "credentials_encryption_key"));
    expect(after?.value).toMatch(/^[0-9a-f]{64}$/);
  });

  it("reuses the key already persisted in system_config instead of generating a new one", async () => {
    const { encryptCredential, decryptCredential } = cryptoModule;

    // First call generates and persists the key.
    const ciphertext = await encryptCredential("stored-key-value");
    const [row] = await db
      .select()
      .from(systemConfig)
      .where(eq(systemConfig.key, "credentials_encryption_key"));
    const persistedKeyHex = row?.value;

    // A value encrypted before the in-memory cache existed should still
    // decrypt correctly using the key read back from the DB.
    expect(persistedKeyHex).toMatch(/^[0-9a-f]{64}$/);
    expect(await decryptCredential(ciphertext)).toBe("stored-key-value");
  });

  it("reads a pre-existing key from system_config on first use instead of generating one", async () => {
    const preExistingKeyHex = "b".repeat(64);
    await db
      .insert(systemConfig)
      .values({ key: "credentials_encryption_key", value: preExistingKeyHex });

    const { encryptCredential, decryptCredential } = cryptoModule;
    const ciphertext = await encryptCredential("value-under-preexisting-key");

    const [row] = await db
      .select()
      .from(systemConfig)
      .where(eq(systemConfig.key, "credentials_encryption_key"));
    expect(row?.value).toBe(preExistingKeyHex);
    expect(await decryptCredential(ciphertext)).toBe("value-under-preexisting-key");
  });

  it("prefers the CREDENTIALS_ENCRYPTION_KEY env var over the database", async () => {
    process.env.CREDENTIALS_ENCRYPTION_KEY = "a".repeat(64);
    vi.resetModules();
    const envDbModule = await import("../db.js");
    await migrate(envDbModule.db, { migrationsFolder: "migrations" });
    const envCryptoModule = await import("../credential-crypto.js");

    const ciphertext = await envCryptoModule.encryptCredential("env-key-value");
    const plaintext = await envCryptoModule.decryptCredential(ciphertext);
    expect(plaintext).toBe("env-key-value");

    const [row] = await envDbModule.db
      .select()
      .from(systemConfig)
      .where(eq(systemConfig.key, "credentials_encryption_key"));
    expect(row).toBeUndefined();

    delete process.env.CREDENTIALS_ENCRYPTION_KEY;
  });
});
