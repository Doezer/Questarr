import { describe, it, expect, vi, beforeEach } from "vitest";
import { syncUserSteamWishlist } from "../cron.js";
import { storage } from "../storage.js";
import { steamService } from "../steam.js";
import { igdbClient, type IGDBGame } from "../igdb.js";
import type { Game, User, UserSettings } from "../../shared/schema.js";

// Mock dependencies
vi.mock("../storage.js");
vi.mock("../steam.js");
vi.mock("../igdb.js");
vi.mock("../logger.js", () => {
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };
  return {
    logger: mockLogger,
    igdbLogger: mockLogger,
    routesLogger: mockLogger,
    expressLogger: mockLogger,
    downloadersLogger: mockLogger,
    torznabLogger: mockLogger,
    searchLogger: mockLogger,
  };
});

describe("syncUserSteamWishlist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return failure and skip sync when steamSyncFailures >= MAX_STEAM_SYNC_FAILURES", async () => {
    vi.mocked(storage.getUser).mockResolvedValue({
      id: "user-1",
      steamId64: "76561198000000000",
    } as unknown as User);
    vi.mocked(storage.getUserSettings).mockResolvedValue({
      steamSyncFailures: 3,
    } as unknown as UserSettings);

    const result = await syncUserSteamWishlist("user-1");

    expect(result?.success).toBe(false);
    expect(result?.message).toContain("temporarily disabled");
    expect(steamService.getWishlist).not.toHaveBeenCalled();
  });

  it("should increment steamSyncFailures and return failure when wishlist fetch throws", async () => {
    vi.mocked(storage.getUser).mockResolvedValue({
      id: "user-1",
      steamId64: "76561198000000000",
    } as unknown as User);
    vi.mocked(storage.getUserSettings).mockResolvedValue({
      steamSyncFailures: 1,
    } as unknown as UserSettings);
    vi.mocked(steamService.getWishlist).mockRejectedValue(new Error("Steam API down"));

    const result = await syncUserSteamWishlist("user-1");

    expect(result?.success).toBe(false);
    expect(result?.message).toBe("Steam API down");
    expect(storage.updateUserSettings).toHaveBeenCalledWith("user-1", { steamSyncFailures: 2 });
  });

  it("should reset steamSyncFailures to 0 on a successful sync after prior failures", async () => {
    vi.mocked(storage.getUser).mockResolvedValue({
      id: "user-1",
      steamId64: "76561198000000000",
    } as unknown as User);
    vi.mocked(storage.getUserSettings).mockResolvedValue({
      steamSyncFailures: 2,
    } as unknown as UserSettings);
    vi.mocked(steamService.getWishlist).mockResolvedValue([]);
    vi.mocked(storage.getUserGames).mockResolvedValue([]);

    const result = await syncUserSteamWishlist("user-1");

    expect(result?.success).toBe(true);
    expect(storage.updateUserSettings).toHaveBeenCalledWith("user-1", { steamSyncFailures: 0 });
  });

  it("should skip IGDB lookup when all wishlist games are already owned by steamAppId", async () => {
    vi.mocked(storage.getUser).mockResolvedValue({
      id: "user-1",
      steamId64: "76561198000000000",
    } as unknown as User);
    vi.mocked(storage.getUserSettings).mockResolvedValue({
      steamSyncFailures: 0,
    } as unknown as UserSettings);
    vi.mocked(steamService.getWishlist).mockResolvedValue([
      { title: "Already Owned", steamAppId: 101, addedAt: 0, priority: 0 },
    ]);
    vi.mocked(storage.getUserGames).mockResolvedValue([
      { id: "g1", igdbId: 1001, steamAppId: 101 } as unknown as Game,
    ]);

    const result = await syncUserSteamWishlist("user-1");

    expect(result?.success).toBe(true);
    expect(result?.addedCount).toBe(0);
    expect(igdbClient.getGameIdsBySteamAppIds).not.toHaveBeenCalled();
  });

  it("should not overwrite steamAppId when existing game already has one set for that igdbId", async () => {
    vi.mocked(storage.getUser).mockResolvedValue({
      id: "user-1",
      steamId64: "76561198000000000",
    } as unknown as User);
    vi.mocked(storage.getUserSettings).mockResolvedValue({
      steamSyncFailures: 0,
    } as unknown as UserSettings);

    // Wishlist has steamAppId 201; collection has same igdbId but different steamAppId (999)
    vi.mocked(steamService.getWishlist).mockResolvedValue([
      { title: "Game", steamAppId: 201, addedAt: 0, priority: 0 },
    ]);
    vi.mocked(storage.getUserGames).mockResolvedValue([
      { id: "g1", igdbId: 2001, steamAppId: 999 } as unknown as Game,
    ]);

    const mockMap = new Map<number, number>([[201, 2001]]);
    vi.mocked(igdbClient.getGameIdsBySteamAppIds).mockResolvedValue(mockMap);

    await syncUserSteamWishlist("user-1");

    expect(storage.updateGame).not.toHaveBeenCalled();
    expect(storage.addGame).not.toHaveBeenCalled();
  });

  it("should return failure if user has no Steam ID", async () => {
    vi.mocked(storage.getUser).mockResolvedValue({
      id: "user-1",
      steamId64: null,
    } as unknown as User);

    const result = await syncUserSteamWishlist("user-1");
    expect(result).toBeUndefined(); // It returns early with return; (void)
  });

  it("should fetch wishlist games and add them in batches", async () => {
    vi.mocked(storage.getUser).mockResolvedValue({
      id: "user-1",
      steamId64: "76561198000000000",
    } as unknown as User);
    vi.mocked(storage.getUserSettings).mockResolvedValue({
      steamSyncFailures: 0,
    } as unknown as UserSettings);

    const mockWishlist = [
      { title: "Game 1", steamAppId: 101, addedAt: 0, priority: 0 },
      { title: "Game 2", steamAppId: 102, addedAt: 0, priority: 0 },
    ];
    vi.mocked(steamService.getWishlist).mockResolvedValue(mockWishlist);

    // Mock IGDB search
    const mockMap = new Map<number, number>();
    mockMap.set(101, 1001);
    mockMap.set(102, 1002);
    vi.mocked(igdbClient.getGameIdsBySteamAppIds).mockResolvedValue(mockMap);

    // Mock existing games (empty)
    vi.mocked(storage.getUserGames).mockResolvedValue([]);

    // Mock igdbClient.getGamesByIds
    vi.mocked(igdbClient.getGamesByIds).mockResolvedValue([
      { id: 1001, name: "Game 1" },
      { id: 1002, name: "Game 2" },
    ] as unknown as IGDBGame[]);

    // Mock formatGameData
    vi.mocked(igdbClient.formatGameData).mockImplementation((game: unknown) => {
      const g = game as { id: number; name: string };
      return {
        title: g.name,
        igdbId: g.id,
        coverUrl: "url",
        summary: "summary",
        releaseDate: "2023-01-01",
        rating: 80,
        platforms: ["PC"],
        genres: ["Action"],
        developers: ["Dev"],
        publishers: ["Pub"],
        screenshots: ["s1"],
      };
    });

    const result = await syncUserSteamWishlist("user-1");

    expect(result).toBeDefined();
    expect(result?.success).toBe(true);
    expect(result?.addedCount).toBe(2);
    expect(igdbClient.getGameIdsBySteamAppIds).toHaveBeenCalledWith([101, 102]);
    expect(storage.addGame).toHaveBeenCalledTimes(2);
  });

  it("should skip Steam App IDs with no matching IGDB ID", async () => {
    vi.mocked(storage.getUser).mockResolvedValue({
      id: "user-1",
      steamId64: "76561198000000000",
    } as unknown as User);
    vi.mocked(storage.getUserSettings).mockResolvedValue({
      steamSyncFailures: 0,
    } as unknown as UserSettings);

    // steamAppId 301 has no IGDB match
    const mockWishlist = [{ title: "Unknown Game", steamAppId: 301, addedAt: 0, priority: 0 }];
    vi.mocked(steamService.getWishlist).mockResolvedValue(mockWishlist);

    // Empty map — no IGDB ID for steamAppId 301
    vi.mocked(igdbClient.getGameIdsBySteamAppIds).mockResolvedValue(new Map());
    vi.mocked(storage.getUserGames).mockResolvedValue([]);

    const result = await syncUserSteamWishlist("user-1");

    expect(result?.addedCount).toBe(0);
    expect(storage.addGame).not.toHaveBeenCalled();
  });

  it("should NOT skip a Steam App ID whose IGDB mapping is 0 (falsy but valid)", async () => {
    vi.mocked(storage.getUser).mockResolvedValue({
      id: "user-1",
      steamId64: "76561198000000000",
    } as unknown as User);
    vi.mocked(storage.getUserSettings).mockResolvedValue({
      steamSyncFailures: 0,
    } as unknown as UserSettings);

    const mockWishlist = [{ title: "Zero Game", steamAppId: 301, addedAt: 0, priority: 0 }];
    vi.mocked(steamService.getWishlist).mockResolvedValue(mockWishlist);
    vi.mocked(storage.getUserGames).mockResolvedValue([]);

    // IGDB ID 0 is falsy — old `!igdbId` check would incorrectly skip this
    const mockMap = new Map<number, number>();
    mockMap.set(301, 0);
    vi.mocked(igdbClient.getGameIdsBySteamAppIds).mockResolvedValue(mockMap);
    vi.mocked(igdbClient.getGamesByIds).mockResolvedValue([
      { id: 0, name: "Zero Game" },
    ] as unknown as IGDBGame[]);
    vi.mocked(igdbClient.formatGameData).mockReturnValue({
      title: "Zero Game",
      igdbId: 0,
      coverUrl: "",
      summary: "",
      releaseDate: "",
      rating: 0,
      platforms: [],
      genres: [],
      developers: [],
      publishers: [],
      screenshots: [],
    });

    const result = await syncUserSteamWishlist("user-1");

    expect(result?.addedCount).toBe(1);
    expect(storage.addGame).toHaveBeenCalledOnce();
  });

  it("should link an existing game that has igdbId but no steamAppId", async () => {
    vi.mocked(storage.getUser).mockResolvedValue({
      id: "user-1",
      steamId64: "76561198000000000",
    } as unknown as User);
    vi.mocked(storage.getUserSettings).mockResolvedValue({
      steamSyncFailures: 0,
    } as unknown as UserSettings);

    const mockWishlist = [{ title: "Linked Game", steamAppId: 201, addedAt: 0, priority: 0 }];
    vi.mocked(steamService.getWishlist).mockResolvedValue(mockWishlist);

    // Game exists with matching igdbId but steamAppId not yet set
    vi.mocked(storage.getUserGames).mockResolvedValue([
      { id: "game-1", igdbId: 2001, steamAppId: null } as unknown as Game,
    ]);

    const mockMap = new Map<number, number>();
    mockMap.set(201, 2001);
    vi.mocked(igdbClient.getGameIdsBySteamAppIds).mockResolvedValue(mockMap);

    const result = await syncUserSteamWishlist("user-1");

    expect(result?.addedCount).toBe(0);
    expect(storage.addGame).not.toHaveBeenCalled();
    expect(storage.updateGame).toHaveBeenCalledWith("game-1", { steamAppId: 201 });
  });

  it("should link multiple existing games via precomputed map and add truly new ones", async () => {
    vi.mocked(storage.getUser).mockResolvedValue({
      id: "user-1",
      steamId64: "76561198000000000",
    } as unknown as User);
    vi.mocked(storage.getUserSettings).mockResolvedValue({
      steamSyncFailures: 0,
    } as unknown as UserSettings);

    const mockWishlist = [
      { title: "Link Me 1", steamAppId: 201, addedAt: 0, priority: 0 },
      { title: "Link Me 2", steamAppId: 202, addedAt: 0, priority: 0 },
      { title: "New Game", steamAppId: 203, addedAt: 0, priority: 0 },
    ];
    vi.mocked(steamService.getWishlist).mockResolvedValue(mockWishlist);

    // Two existing games with igdbId but no steamAppId; one is truly new
    vi.mocked(storage.getUserGames).mockResolvedValue([
      { id: "g1", igdbId: 2001, steamAppId: null } as unknown as Game,
      { id: "g2", igdbId: 2002, steamAppId: null } as unknown as Game,
    ]);

    const mockMap = new Map<number, number>([
      [201, 2001],
      [202, 2002],
      [203, 2003],
    ]);
    vi.mocked(igdbClient.getGameIdsBySteamAppIds).mockResolvedValue(mockMap);
    vi.mocked(igdbClient.getGamesByIds).mockResolvedValue([
      { id: 2003, name: "New Game" },
    ] as unknown as IGDBGame[]);
    vi.mocked(igdbClient.formatGameData).mockReturnValue({
      title: "New Game",
      igdbId: 2003,
      coverUrl: "",
      summary: "",
      releaseDate: "",
      rating: 0,
      platforms: [],
      genres: [],
      developers: [],
      publishers: [],
      screenshots: [],
    });

    const result = await syncUserSteamWishlist("user-1");

    expect(storage.updateGame).toHaveBeenCalledTimes(2);
    expect(storage.updateGame).toHaveBeenCalledWith("g1", { steamAppId: 201 });
    expect(storage.updateGame).toHaveBeenCalledWith("g2", { steamAppId: 202 });
    expect(storage.addGame).toHaveBeenCalledOnce();
    expect(result?.addedCount).toBe(1);
  });

  it("should avoid adding games already in collection", async () => {
    vi.mocked(storage.getUser).mockResolvedValue({
      id: "user-1",
      steamId64: "76561198000000000",
    } as unknown as User);
    vi.mocked(storage.getUserSettings).mockResolvedValue({
      steamSyncFailures: 0,
    } as unknown as UserSettings);

    const mockWishlist = [{ title: "Existing Game", steamAppId: 201, addedAt: 0, priority: 0 }];
    vi.mocked(steamService.getWishlist).mockResolvedValue(mockWishlist);

    const mockMap = new Map<number, number>();
    mockMap.set(201, 2001);
    vi.mocked(igdbClient.getGameIdsBySteamAppIds).mockResolvedValue(mockMap);

    // Existing game in storage
    vi.mocked(storage.getUserGames).mockResolvedValue([{ igdbId: 2001 }] as Game[]);

    const result = await syncUserSteamWishlist("user-1");

    expect(result?.addedCount).toBe(0);
    expect(storage.addGame).not.toHaveBeenCalled();
  });

  it("should return success with addedCount 0 when wishlist is empty", async () => {
    vi.mocked(storage.getUser).mockResolvedValue({
      id: "user-1",
      steamId64: "76561198000000000",
    } as unknown as User);
    vi.mocked(storage.getUserSettings).mockResolvedValue({
      steamSyncFailures: 0,
    } as unknown as UserSettings);
    vi.mocked(steamService.getWishlist).mockResolvedValue([]);
    vi.mocked(storage.getUserGames).mockResolvedValue([]);

    const result = await syncUserSteamWishlist("user-1");

    expect(result?.success).toBe(true);
    expect(result?.addedCount).toBe(0);
    expect(igdbClient.getGameIdsBySteamAppIds).not.toHaveBeenCalled();
  });

  it("should skip a new game when IGDB returns no details for its igdbId", async () => {
    vi.mocked(storage.getUser).mockResolvedValue({
      id: "user-1",
      steamId64: "76561198000000000",
    } as unknown as User);
    vi.mocked(storage.getUserSettings).mockResolvedValue({
      steamSyncFailures: 0,
    } as unknown as UserSettings);
    vi.mocked(steamService.getWishlist).mockResolvedValue([
      { title: "Mystery Game", steamAppId: 101, addedAt: 0, priority: 0 },
    ]);
    vi.mocked(storage.getUserGames).mockResolvedValue([]);

    const mockMap = new Map<number, number>([[101, 1001]]);
    vi.mocked(igdbClient.getGameIdsBySteamAppIds).mockResolvedValue(mockMap);
    // IGDB returns empty — no details for igdbId 1001
    vi.mocked(igdbClient.getGamesByIds).mockResolvedValue([]);

    const result = await syncUserSteamWishlist("user-1");

    expect(result?.addedCount).toBe(0);
    expect(storage.addGame).not.toHaveBeenCalled();
  });

  it("should add only games for which IGDB returns details when response is partial", async () => {
    vi.mocked(storage.getUser).mockResolvedValue({
      id: "user-1",
      steamId64: "76561198000000000",
    } as unknown as User);
    vi.mocked(storage.getUserSettings).mockResolvedValue({
      steamSyncFailures: 0,
    } as unknown as UserSettings);
    vi.mocked(steamService.getWishlist).mockResolvedValue([
      { title: "Game A", steamAppId: 101, addedAt: 0, priority: 0 },
      { title: "Game B", steamAppId: 102, addedAt: 0, priority: 0 },
    ]);
    vi.mocked(storage.getUserGames).mockResolvedValue([]);

    const mockMap = new Map<number, number>([
      [101, 1001],
      [102, 1002],
    ]);
    vi.mocked(igdbClient.getGameIdsBySteamAppIds).mockResolvedValue(mockMap);
    // Only igdbId 1001 has details; 1002 is missing from IGDB response
    vi.mocked(igdbClient.getGamesByIds).mockResolvedValue([
      { id: 1001, name: "Game A" },
    ] as unknown as IGDBGame[]);
    vi.mocked(igdbClient.formatGameData).mockReturnValue({
      title: "Game A",
      igdbId: 1001,
      coverUrl: "",
      summary: "",
      releaseDate: "",
      rating: 0,
      platforms: [],
      genres: [],
      developers: [],
      publishers: [],
      screenshots: [],
    });

    const result = await syncUserSteamWishlist("user-1");

    expect(result?.addedCount).toBe(1);
    expect(storage.addGame).toHaveBeenCalledOnce();
  });
});
