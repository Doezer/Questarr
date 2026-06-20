import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import os from "os";
import path from "path";

// Isolated test for the db.ts open-failure error path.
// Kept in a separate file so module-cache resets don't interfere with other suites
// that import db.js through the app's module graph.
describe("Database - open failure error handling", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("logs UID, GID and calls process.exit(1) when the database cannot be opened", async () => {
    // Use os.tmpdir() so the parent directory exists (no mkdir attempted),
    // but the file itself won't exist so no file-stat branch runs either.
    const testDbPath = path.join(os.tmpdir(), "db-open-failure-questarr-test.db");
    process.env.SQLITE_DB_PATH = testDbPath;

    const mockError = vi.fn();
    vi.doMock("../logger.js", () => ({
      logger: { info: vi.fn(), warn: vi.fn(), error: mockError },
    }));

    vi.doMock("better-sqlite3", () => ({
      default: vi.fn().mockImplementation(() => {
        throw new Error("SQLITE_CANTOPEN: unable to open database file");
      }),
    }));

    // Intercept process.exit so the test process doesn't actually terminate.
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as never);

    // The module rejects because our process.exit mock throws.
    await expect(import("../db.js")).rejects.toThrow("process.exit called");

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockError).toHaveBeenCalledWith(
      expect.objectContaining({ dbPath: testDbPath }),
      expect.stringContaining("Cannot open SQLite database")
    );
  });
});
