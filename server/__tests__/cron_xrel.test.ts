import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkXrelReleases } from "../cron.js";
import { storage } from "../storage.js";
import { xrelClient, type XrelReleaseListItem } from "../xrel.js";
import { notifyUser } from "../socket.js";
import type { Game, UserSettings } from "../../shared/schema.js";

// Mock dependencies
vi.mock("../storage.js");
vi.mock("../xrel.js");
vi.mock("../socket.js");
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

describe("checkXrelReleases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should find and notify matching xREL releases using optimized matching", async () => {
    // Mock data
    const mockGames: Partial<Game>[] = [
      { id: "game-1", title: "Cyberpunk 2077", userId: "user-1", status: "wanted", hidden: false },
      { id: "game-2", title: "Elden Ring", userId: "user-1", status: "wanted", hidden: false },
    ];

    const mockReleases: XrelReleaseListItem[] = [
      {
        id: "rel-1",
        dirname: "Cyberpunk.2077.v2.1-DOGE",
        source: "scene",
        ext_info: { title: "Cyberpunk 2077", type: "master_game", id: "1", link_href: "" },
        link_href: "",
        time: Date.now() / 1000,
        group_name: "DOGE",
      },
      {
        id: "rel-2",
        dirname: "Elden.Ring.Shadow.of.the.Erdtree-FLT",
        source: "scene",
        ext_info: {
          title: "Elden Ring: Shadow of the Erdtree",
          type: "master_game",
          id: "2",
          link_href: "",
        },
        link_href: "",
        time: Date.now() / 1000,
        group_name: "FLT",
      },
      {
        id: "rel-3",
        dirname: "Unrelated.Game.v1.0-RELOADED",
        source: "scene",
        ext_info: { title: "Unrelated Game", type: "master_game", id: "3", link_href: "" },
        link_href: "",
        time: Date.now() / 1000,
        group_name: "RELOADED",
      },
    ];

    vi.mocked(storage.getAllGames).mockResolvedValue(mockGames as Game[]);
    vi.mocked(xrelClient.getLatestReleases).mockResolvedValue({
      list: mockReleases,
      pagination: { current_page: 1, per_page: 50, total_pages: 1 },
      total_count: 3,
    });
    vi.mocked(storage.getUserSettings).mockResolvedValue({
      xrelSceneReleases: true,
      xrelP2pReleases: false,
    } as unknown as UserSettings);
    vi.mocked(storage.hasXrelNotifiedRelease).mockResolvedValue(false);

    // Execute
    await checkXrelReleases();

    // Verify
    expect(storage.addXrelNotifiedRelease).toHaveBeenCalledWith(
      expect.objectContaining({ gameId: "game-1", xrelReleaseId: "rel-1" })
    );
    expect(storage.addXrelNotifiedRelease).toHaveBeenCalledWith(
      expect.objectContaining({ gameId: "game-2", xrelReleaseId: "rel-2" })
    );
    expect(storage.addNotification).toHaveBeenCalledTimes(2);
    expect(notifyUser).toHaveBeenCalledTimes(2);
  });

  it("should respect user preferences for scene/p2p releases", async () => {
    const mockGames: Partial<Game>[] = [
      { id: "game-1", title: "Cyberpunk 2077", userId: "user-1", status: "wanted", hidden: false },
    ];

    const mockReleases: XrelReleaseListItem[] = [
      {
        id: "rel-p2p",
        dirname: "Cyberpunk.2077.P2P.Release",
        source: "p2p",
        ext_info: { title: "Cyberpunk 2077", type: "master_game", id: "4", link_href: "" },
        link_href: "",
        time: Date.now() / 1000,
        group_name: "P2P",
      },
    ];

    vi.mocked(storage.getAllGames).mockResolvedValue(mockGames as Game[]);
    vi.mocked(xrelClient.getLatestReleases).mockResolvedValue({
      list: mockReleases,
      pagination: { current_page: 1, per_page: 50, total_pages: 1 },
      total_count: 1,
    });

    // User only wants scene
    vi.mocked(storage.getUserSettings).mockResolvedValue({
      xrelSceneReleases: true,
      xrelP2pReleases: false,
    } as unknown as UserSettings);

    await checkXrelReleases();

    expect(storage.addXrelNotifiedRelease).not.toHaveBeenCalled();
  });

  it("should not notify if already notified", async () => {
    const mockGames: Partial<Game>[] = [
      { id: "game-1", title: "Cyberpunk 2077", userId: "user-1", status: "wanted", hidden: false },
    ];

    const mockReleases: XrelReleaseListItem[] = [
      {
        id: "rel-1",
        dirname: "Cyberpunk.2077-DOGE",
        source: "scene",
        link_href: "",
        time: Date.now() / 1000,
        group_name: "DOGE",
        ext_info: { title: "Cyberpunk 2077", type: "master_game", id: "1", link_href: "" },
      },
    ];

    vi.mocked(storage.getAllGames).mockResolvedValue(mockGames as Game[]);
    vi.mocked(xrelClient.getLatestReleases).mockResolvedValue({
      list: mockReleases,
      pagination: { current_page: 1, per_page: 50, total_pages: 1 },
      total_count: 1,
    });
    vi.mocked(storage.getUserSettings).mockResolvedValue({
      xrelSceneReleases: true,
      xrelP2pReleases: true,
    } as unknown as UserSettings);
    vi.mocked(storage.hasXrelNotifiedRelease).mockResolvedValue(true); // Already notified

    await checkXrelReleases();

    expect(storage.addXrelNotifiedRelease).not.toHaveBeenCalled();
  });
});
