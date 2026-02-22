import { describe, it, expect, vi, beforeEach } from "vitest";
import { syncUserSteamWishlist } from "../cron.js";
import { storage } from "../storage.js";
import { steamService } from "../steam.js";
import { igdbClient } from "../igdb.js";
import type { Game } from "../../shared/schema.js";

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

  it("should return failure if user has no Steam ID", async () => {
    vi.mocked(storage.getUser).mockResolvedValue({ id: "user-1", steamId64: null } as any);

    const result = await syncUserSteamWishlist("user-1");
    expect(result).toBeUndefined(); // It returns early with return; (void)
  });

  it("should fetch wishlist games and add them in batches", async () => {
    vi.mocked(storage.getUser).mockResolvedValue({
      id: "user-1",
      steamId64: "76561198000000000",
    } as any);
    vi.mocked(storage.getUserSettings).mockResolvedValue({ steamSyncFailures: 0 } as any);

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
    ] as any);

    // Mock formatGameData
    vi.mocked(igdbClient.formatGameData).mockImplementation((game: any) => ({
      title: game.name,
      igdbId: game.id,
      coverUrl: "url",
      summary: "summary",
      releaseDate: "2023-01-01",
      rating: 80,
      platforms: ["PC"],
      genres: ["Action"],
      developers: ["Dev"],
      publishers: ["Pub"],
      screenshots: ["s1"],
    }));

    const result = await syncUserSteamWishlist("user-1");

    expect(result).toBeDefined();
    expect(result?.success).toBe(true);
    expect(result?.addedCount).toBe(2);
    expect(igdbClient.getGameIdsBySteamAppIds).toHaveBeenCalledWith([101, 102]);
    expect(storage.addGame).toHaveBeenCalledTimes(2);
  });

  it("should avoid adding games already in collection", async () => {
    vi.mocked(storage.getUser).mockResolvedValue({
      id: "user-1",
      steamId64: "76561198000000000",
    } as any);
    vi.mocked(storage.getUserSettings).mockResolvedValue({ steamSyncFailures: 0 } as any);

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
});
