import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the config module
vi.mock("../config.js", () => ({
  config: {
    database: {
      url: "postgresql://test:test@localhost/test",
    },
    igdb: {
      clientId: undefined,
      clientSecret: undefined,
      isConfigured: false,
    },
    server: {
      port: 5000,
      host: "localhost",
      nodeEnv: "test",
    },
  },
}));

// Mock the storage module to prevent DB calls
vi.mock("../storage.js", () => ({
  storage: {
    getSystemConfig: vi.fn().mockResolvedValue(undefined),
  },
}));

import { igdbClient } from "../igdb";

describe("IGDB Client Error Handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return empty array when credentials are missing", async () => {
    // We expect the promise to resolve with empty array instead of throwing
    const result = await igdbClient.searchGames("test");
    expect(result).toEqual([]);
  });
});
