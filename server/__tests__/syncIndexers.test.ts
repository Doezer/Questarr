import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Indexer } from "../../shared/schema";
// We need to access the class directly to test it, or test via interface if we mock db
import { DatabaseStorage } from "../storage";

// Mock db.ts
vi.mock("../db", () => ({
  db: {
    transaction: vi.fn((callback) =>
      callback({
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        all: vi.fn().mockReturnValue([]),
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockReturnThis(),
        run: vi.fn().mockReturnValue({ changes: 0 }),
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
      })
    ),
  },
  pool: {},
}));

describe("DatabaseStorage - syncIndexers", () => {
  let storage: DatabaseStorage;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockTx: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Setup mock transaction object
    mockTx = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      all: vi.fn().mockReturnValue([]),
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      run: vi.fn().mockReturnValue({ changes: 0 }),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
    };

    // Re-import to ensure fresh mock
    const { db } = await import("../db");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db.transaction as any).mockImplementation((cb: any) => cb(mockTx));

    storage = new DatabaseStorage();
  });

  it("should add new indexers", async () => {
    const indexersToSync: Partial<Indexer>[] = [
      {
        name: "New Indexer",
        url: "http://example.com",
        apiKey: "apikey123",
        protocol: "torznab",
      },
    ];

    mockTx.all.mockReturnValue([]); // No existing indexers

    const result = await storage.syncIndexers(indexersToSync);

    expect(result.added).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.failed).toBe(0);
    expect(mockTx.insert).toHaveBeenCalled();
  });

  it("should update existing indexers", async () => {
    const existingIndexer: Indexer = {
      id: "existing-id",
      name: "Old Name",
      url: "http://example.com",
      apiKey: "oldkey",
      protocol: "torznab",
      enabled: true,
      priority: 1,
      categories: [],
      rssEnabled: true,
      autoSearchEnabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const indexersToSync: Partial<Indexer>[] = [
      {
        name: "New Name",
        url: "http://example.com", // Matches existing URL
        apiKey: "newkey",
      },
    ];

    mockTx.all.mockReturnValue([existingIndexer]);

    const result = await storage.syncIndexers(indexersToSync);

    expect(result.added).toBe(0);
    expect(result.updated).toBe(1);
    expect(result.failed).toBe(0);
    expect(mockTx.update).toHaveBeenCalled();
  });

  it("should fail validation for missing fields", async () => {
    const invalidIndexer: Partial<Indexer> = {
      name: "Bad Indexer",
      // missing url and apiKey
    };

    const result = await storage.syncIndexers([invalidIndexer]);

    expect(result.failed).toBe(1);
    expect(result.errors.length).toBe(1);
    expect(mockTx.insert).not.toHaveBeenCalled();
    expect(mockTx.update).not.toHaveBeenCalled();
  });
});
