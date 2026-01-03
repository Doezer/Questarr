import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { igdbClient } from "../igdb";
import { config } from "../config";

// Mock the config module
vi.mock("../config", () => ({
  config: {
    igdb: {
      clientId: undefined,
      clientSecret: undefined,
      isConfigured: false,
    },
  },
}));

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
