import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

// We import after mocks are set up
import { safeFetch } from "../ssrf.js";

const mockSafeFetch = vi.mocked(safeFetch);

function makeResponse(data: unknown, headers: Record<string, string> = {}, ok = true) {
  return {
    ok,
    status: ok ? 200 : 500,
    json: vi.fn().mockResolvedValue(data),
    headers: {
      get: (key: string) => headers[key] ?? null,
    },
  };
}

const MOCK_GAMES = [
  { id: 1, name: "The Witcher 3: Wild Hunt", domain_name: "witcher3" },
  { id: 2, name: "Skyrim Special Edition", domain_name: "skyrimspecialedition" },
  { id: 3, name: "Fallout 4", domain_name: "fallout4" },
];

const MOCK_MODS = [
  {
    mod_id: 100,
    name: "Top Mod",
    summary: "A great mod",
    picture_url: "https://example.com/img.jpg",
    mod_downloads: 50000,
    mod_unique_downloads: 30000,
    endorsement_count: 2000,
    version: "1.0",
    updated_timestamp: 1700000000,
    domain_name: "witcher3",
    user: { name: "ModAuthor" },
  },
];

describe("NexusModsClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    // Clear env variable that the module reads at load time
    delete process.env.NEXUSMODS_API_KEY;
  });

  afterEach(() => {
    delete process.env.NEXUSMODS_API_KEY;
  });

  async function getClient() {
    const mod = await import("../nexusmods.js");
    return mod.nexusmodsClient;
  }

  it("isConfigured() returns false when no key is set", async () => {
    const client = await getClient();
    client.configure(null);
    expect(client.isConfigured()).toBe(false);
  });

  it("isConfigured() returns true after configure() is called with a key", async () => {
    const client = await getClient();
    client.configure("my-api-key");
    expect(client.isConfigured()).toBe(true);
  });

  it("isConfigured() returns false when empty string is passed", async () => {
    const client = await getClient();
    client.configure("   ");
    expect(client.isConfigured()).toBe(false);
  });

  describe("getGames()", () => {
    it("returns empty array when not configured", async () => {
      const client = await getClient();
      client.configure(null);
      const games = await client.getGames();
      expect(games).toEqual([]);
      expect(mockSafeFetch).not.toHaveBeenCalled();
    });

    it("fetches and returns games when configured", async () => {
      mockSafeFetch.mockResolvedValue(makeResponse(MOCK_GAMES) as unknown as Response);
      const client = await getClient();
      client.configure("valid-key");
      const games = await client.getGames();
      expect(games).toHaveLength(3);
      expect(games[0].domain_name).toBe("witcher3");
    });

    it("uses cache on second call — only one fetch", async () => {
      mockSafeFetch.mockResolvedValue(makeResponse(MOCK_GAMES) as unknown as Response);
      const client = await getClient();
      client.configure("valid-key");
      await client.getGames();
      await client.getGames();
      expect(mockSafeFetch).toHaveBeenCalledTimes(1);
    });

    it("returns empty array on fetch failure", async () => {
      mockSafeFetch.mockResolvedValue(makeResponse(null, {}, false) as unknown as Response);
      const client = await getClient();
      client.configure("valid-key");
      const games = await client.getGames();
      expect(games).toEqual([]);
    });
  });

  describe("findGameDomain()", () => {
    beforeEach(() => {
      mockSafeFetch.mockResolvedValue(makeResponse(MOCK_GAMES) as unknown as Response);
    });

    it("returns null when not configured", async () => {
      const client = await getClient();
      client.configure(null);
      expect(await client.findGameDomain("The Witcher 3")).toBeNull();
    });

    it("matches exact normalized title", async () => {
      const client = await getClient();
      client.configure("key");
      const domain = await client.findGameDomain("The Witcher 3: Wild Hunt");
      expect(domain).toBe("witcher3");
    });

    it("matches by substring (partial title)", async () => {
      const client = await getClient();
      client.configure("key");
      const domain = await client.findGameDomain("Witcher 3");
      expect(domain).toBe("witcher3");
    });

    it("returns null when no match found", async () => {
      const client = await getClient();
      client.configure("key");
      const domain = await client.findGameDomain("Minecraft");
      expect(domain).toBeNull();
    });

    it("does not match short game names that appear as substrings inside unrelated words", async () => {
      // "Oni" must not match "Pioneers of Pagonia" (pagONIa contains 'oni' as a substring)
      const gamesWithOni = [
        ...MOCK_GAMES,
        { id: 99, name: "Oni", domain_name: "oni" },
        { id: 100, name: "Pioneers of Pagonia", domain_name: "pioneersofpagonia" },
      ];
      mockSafeFetch.mockResolvedValue(makeResponse(gamesWithOni) as unknown as Response);
      const client = await getClient();
      client.configure("key");
      const domain = await client.findGameDomain("Pioneers of Pagonia");
      expect(domain).toBe("pioneersofpagonia");
    });
  });

  describe("getTrendingMods()", () => {
    it("returns empty array when not configured", async () => {
      const client = await getClient();
      client.configure(null);
      const mods = await client.getTrendingMods("witcher3");
      expect(mods).toEqual([]);
      expect(mockSafeFetch).not.toHaveBeenCalled();
    });

    it("fetches trending mods and returns them", async () => {
      mockSafeFetch.mockResolvedValue(makeResponse(MOCK_MODS) as unknown as Response);
      const client = await getClient();
      client.configure("key");
      const mods = await client.getTrendingMods("witcher3");
      expect(mods).toHaveLength(1);
      expect(mods[0].mod_id).toBe(100);
    });

    it("respects the limit parameter", async () => {
      const manyMods = Array.from({ length: 15 }, (_, i) => ({ ...MOCK_MODS[0], mod_id: i }));
      mockSafeFetch.mockResolvedValue(makeResponse(manyMods) as unknown as Response);
      const client = await getClient();
      client.configure("key");
      const mods = await client.getTrendingMods("witcher3", 5);
      expect(mods).toHaveLength(5);
    });

    it("uses cache on second call for same domain", async () => {
      mockSafeFetch.mockResolvedValue(makeResponse(MOCK_MODS) as unknown as Response);
      const client = await getClient();
      client.configure("key");
      await client.getTrendingMods("witcher3");
      await client.getTrendingMods("witcher3");
      expect(mockSafeFetch).toHaveBeenCalledTimes(1);
    });

    it("returns empty array on fetch failure", async () => {
      mockSafeFetch.mockResolvedValue(makeResponse(null, {}, false) as unknown as Response);
      const client = await getClient();
      client.configure("key");
      const mods = await client.getTrendingMods("witcher3");
      expect(mods).toEqual([]);
    });
  });

  describe("rate limit tracking", () => {
    it("logs warning when hourly remaining is low", async () => {
      const { logger } = await import("../logger.js");
      const warnSpy = vi.mocked(logger.child({} as never)).warn;
      mockSafeFetch.mockResolvedValue(
        makeResponse(MOCK_GAMES, {
          "X-RL-Hourly-Remaining": "10",
          "X-RL-Daily-Remaining": "5000",
        }) as unknown as Response
      );
      const client = await getClient();
      client.configure("key");
      await client.getGames();
      expect(warnSpy).toHaveBeenCalled();
    });
  });
});
