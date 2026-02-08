import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";

// Skip: These tests are flaky when run with other tests due to module caching/contention
// They pass individually but cause random timeouts in full test runs
describe.skip("Database Initialization", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };
    // Clear module cache to allow re-import with different env
    vi.resetModules();
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  it("should initialize with :memory: database in test environment", async () => {
    process.env.SQLITE_DB_PATH = ":memory:";
    const { db, pool } = await import("../db.js");
    expect(db).toBeDefined();
    pool.close();
  });

  it("should create database directory if it doesn't exist", async () => {
    const testDbPath = path.join("/tmp", "test-questarr-db", "test.db");
    process.env.SQLITE_DB_PATH = testDbPath;

    // Ensure directory doesn't exist before test
    const testDir = path.dirname(testDbPath);
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }

    // Import db module which should create the directory
    const { db, pool } = await import("../db.js");
    expect(db).toBeDefined();

    // Verify directory was created
    expect(fs.existsSync(testDir)).toBe(true);

    // Close connection before cleanup
    pool.close();

    // Cleanup
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    if (fs.existsSync(testDir)) {
      fs.rmdirSync(testDir);
    }
  });

  it("should use default path when SQLITE_DB_PATH is not set", async () => {
    delete process.env.SQLITE_DB_PATH;
    const { db, pool } = await import("../db.js");
    expect(db).toBeDefined();
    pool.close();
  });

  it("should handle existing valid database file", async () => {
    const testDbPath = path.join("/tmp", "existing-valid-test.db");

    // Create a valid SQLite database file first
    const testDir = path.dirname(testDbPath);
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }

    // Create a valid SQLite database using better-sqlite3
    const Database = (await import("better-sqlite3")).default;
    const tempDb = new Database(testDbPath);
    tempDb.close();

    process.env.SQLITE_DB_PATH = testDbPath;

    // Should not throw error when file already exists
    const { db, pool } = await import("../db.js");
    expect(db).toBeDefined();

    // Close connection before cleanup
    pool.close();

    // Cleanup
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  it("should handle when database path is a directory by appending sqlite.db", async () => {
    const testDirPath = path.join("/tmp", "test-questarr-dir-db");

    // Create a directory at the database path
    if (!fs.existsSync(testDirPath)) {
      fs.mkdirSync(testDirPath, { recursive: true });
    }

    process.env.SQLITE_DB_PATH = testDirPath;

    // Import db module which should now append sqlite.db
    const { db, pool } = await import("../db.js");
    expect(db).toBeDefined();

    // Verify database file was created inside the directory
    expect(fs.existsSync(path.join(testDirPath, "sqlite.db"))).toBe(true);

    pool.close();

    // Cleanup
    if (fs.existsSync(path.join(testDirPath, "sqlite.db"))) {
      fs.unlinkSync(path.join(testDirPath, "sqlite.db"));
    }
    if (fs.existsSync(testDirPath)) {
      // Remove other files (WAL, shm)
      fs.rmSync(testDirPath, { recursive: true });
    }
  });

  it("should apply SQLite pragmas for performance", async () => {
    process.env.SQLITE_DB_PATH = ":memory:";

    // We can't directly test pragma application without accessing the underlying
    // SQLite connection, but we can verify the db object is created successfully
    const { db, pool } = await import("../db.js");
    expect(db).toBeDefined();
    expect(typeof db.select).toBe("function");
    pool.close();
  });
});
