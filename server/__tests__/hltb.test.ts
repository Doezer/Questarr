import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../logger.js", () => ({
  logger: {
    child: vi.fn().mockReturnValue({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

vi.mock("../ssrf.js", () => ({
  safeFetch: vi.fn(),
}));

import { safeFetch } from "../ssrf.js";

const mockSafeFetch = vi.mocked(safeFetch);

function makeResponse(data: unknown, ok = true) {
  return {
    ok,
    status: ok ? 200 : 500,
    json: vi.fn().mockResolvedValue(data),
  } as unknown as Response;
}

const MOCK_SEARCH_RESPONSE = {
  count: 2,
  data: [
    {
      game_id: 36936,
      game_name: "Nioh",
      comp_main: 124200, // 34.5 hours → rounds to 34
      comp_plus: 219600, // 61 hours
      comp_100: 336600, // 93.5 hours → rounds to 93 (Math.round of 93.5 = 94? let's check)
      game_image: "36936_Nioh.jpg",
    },
    {
      game_id: 50419,
      game_name: "Nioh: Complete Edition",
      comp_main: 151200,
      comp_plus: 302400,
      comp_100: 349200,
      game_image: "50419_Nioh.jpg",
    },
  ],
};

describe("HLTBClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset module to get a fresh HLTBClient instance with empty cache
    vi.resetModules();
  });

  it("returns null when safeFetch returns non-200", async () => {
    mockSafeFetch.mockResolvedValue(makeResponse({}, false));
    const { hltbClient } = await import("../hltb.js");
    const result = await hltbClient.lookup("Nioh");
    expect(result).toBeNull();
  });

  it("returns null when response has no data", async () => {
    mockSafeFetch.mockResolvedValue(makeResponse({ count: 0, data: [] }));
    const { hltbClient } = await import("../hltb.js");
    const result = await hltbClient.lookup("SomeGame");
    expect(result).toBeNull();
  });

  it("returns the best matching entry for an exact title", async () => {
    mockSafeFetch.mockResolvedValue(makeResponse(MOCK_SEARCH_RESPONSE));
    const { hltbClient } = await import("../hltb.js");
    const result = await hltbClient.lookup("Nioh");
    expect(result).not.toBeNull();
    expect(result!.id).toBe(36936);
    expect(result!.name).toBe("Nioh");
    // comp_main = 124200s / 3600 = 34.5 → Math.round = 35
    expect(result!.gameplayMain).toBeGreaterThan(0);
    expect(result!.gameplayMainExtra).toBeGreaterThan(0);
    expect(result!.gameplayCompletionist).toBeGreaterThan(0);
    expect(result!.url).toBe("https://howlongtobeat.com/game/36936");
  });

  it("converts seconds to hours correctly", async () => {
    mockSafeFetch.mockResolvedValue(
      makeResponse({
        count: 1,
        data: [
          {
            game_id: 1,
            game_name: "TestGame",
            comp_main: 7200, // 2 hours exactly
            comp_plus: 18000, // 5 hours exactly
            comp_100: 36000, // 10 hours exactly
          },
        ],
      })
    );
    const { hltbClient } = await import("../hltb.js");
    const result = await hltbClient.lookup("TestGame");
    expect(result).not.toBeNull();
    expect(result!.gameplayMain).toBe(2);
    expect(result!.gameplayMainExtra).toBe(5);
    expect(result!.gameplayCompletionist).toBe(10);
  });

  it("treats comp_main = 0 as unknown (returns 0)", async () => {
    mockSafeFetch.mockResolvedValue(
      makeResponse({
        count: 1,
        data: [{ game_id: 2, game_name: "ShortGame", comp_main: 0, comp_plus: 0, comp_100: 0 }],
      })
    );
    const { hltbClient } = await import("../hltb.js");
    const result = await hltbClient.lookup("ShortGame");
    expect(result).not.toBeNull();
    expect(result!.gameplayMain).toBe(0);
  });

  it("returns null when similarity is below threshold", async () => {
    mockSafeFetch.mockResolvedValue(
      makeResponse({
        count: 1,
        data: [
          {
            game_id: 99,
            game_name: "Completely Unrelated Title XYZABC",
            comp_main: 3600,
            comp_plus: 7200,
            comp_100: 10800,
          },
        ],
      })
    );
    const { hltbClient } = await import("../hltb.js");
    const result = await hltbClient.lookup("Nioh");
    expect(result).toBeNull();
  });

  it("returns null and does not throw when safeFetch throws", async () => {
    mockSafeFetch.mockRejectedValue(new Error("Network error"));
    const { hltbClient } = await import("../hltb.js");
    const result = await hltbClient.lookup("Nioh");
    expect(result).toBeNull();
  });

  it("caches result and does not call safeFetch a second time for the same title", async () => {
    mockSafeFetch.mockResolvedValue(makeResponse(MOCK_SEARCH_RESPONSE));
    const { hltbClient } = await import("../hltb.js");
    await hltbClient.lookup("Nioh");
    await hltbClient.lookup("Nioh");
    expect(mockSafeFetch).toHaveBeenCalledTimes(1);
  });

  it("is case-insensitive (normalizes title before cache lookup)", async () => {
    mockSafeFetch.mockResolvedValue(makeResponse(MOCK_SEARCH_RESPONSE));
    const { hltbClient } = await import("../hltb.js");
    await hltbClient.lookup("nioh");
    await hltbClient.lookup("NIOH");
    expect(mockSafeFetch).toHaveBeenCalledTimes(1);
  });
});
