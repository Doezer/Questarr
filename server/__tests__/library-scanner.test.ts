import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  __testing,
  matchUnmatchedFolder,
  searchUnmatchedFolder,
  rescanRootFolderById,
  rescanAllEnabledRootFolders,
  scanRootFolderById,
  scanAllEnabledRootFolders,
  getScanProgress,
  getAllUnmatched,
} from "../library-scanner.js";
import type { RootFolder, Game } from "../../shared/schema.js";

const { scoreMatch, isIgnoredFile } = __testing;

const mockRootFolder: RootFolder = {
  id: "rf-1",
  path: "/mnt/old-library",
  name: null,
  enabled: true,
  accessible: true,
  diskFreeBytes: null,
  diskTotalBytes: null,
  lastScannedAt: null,
  createdAt: new Date(),
};

vi.mock("../storage.js", () => ({
  storage: {
    getRootFolder: vi.fn(),
    getEnabledRootFolders: vi.fn().mockResolvedValue([]),
    touchRootFolderScanned: vi.fn().mockResolvedValue(undefined),
    getGameByIgdbId: vi.fn(),
    addGame: vi.fn(),
    updateGame: vi.fn(),
    updateGameStatus: vi.fn(),
    getGameFiles: vi.fn().mockResolvedValue([]),
    addGameFile: vi.fn(),
  },
}));

vi.mock("../socket.js", () => ({
  notifyUser: vi.fn(),
}));

vi.mock("../igdb.js", () => ({
  igdbClient: {
    searchGames: vi.fn().mockResolvedValue([]),
    getGameById: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock("../logger.js", () => ({
  igdbLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  routesLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe("library-scanner scoreMatch", () => {
  it("scores an exact title match as 1", () => {
    expect(scoreMatch("The Witcher 3", "The Witcher 3")).toBe(1);
  });

  it("scores a close but not identical title highly", () => {
    const score = scoreMatch("Witcher 3 Wild Hunt", "The Witcher 3: Wild Hunt");
    expect(score).toBeGreaterThan(0.5);
  });

  it("scores unrelated titles low", () => {
    const score = scoreMatch("Stardew Valley", "Doom Eternal");
    expect(score).toBeLessThan(0.3);
  });

  it("returns 0 for empty input", () => {
    expect(scoreMatch("", "Doom Eternal")).toBe(0);
    expect(scoreMatch("Doom Eternal", "")).toBe(0);
  });
});

describe("library-scanner isIgnoredFile", () => {
  it("ignores nfo/checksum/artwork files", () => {
    expect(isIgnoredFile("readme.nfo")).toBe(true);
    expect(isIgnoredFile("game.sfv")).toBe(true);
    expect(isIgnoredFile("cover.jpg")).toBe(true);
  });

  it("does not ignore installers or archives", () => {
    expect(isIgnoredFile("setup.exe")).toBe(false);
    expect(isIgnoredFile("game.iso")).toBe(false);
    expect(isIgnoredFile("game.zip")).toBe(false);
  });
});

describe("matchUnmatchedFolder", () => {
  beforeEach(async () => {
    const { storage } = await import("../storage.js");
    vi.mocked(storage.getRootFolder).mockResolvedValue(mockRootFolder);
  });

  it("rejects a folderName that was never queued as unmatched (path traversal attempt)", async () => {
    // No scan has run, so nothing is queued — this must never fall back to
    // joining the client-supplied folderName onto the filesystem path.
    await expect(matchUnmatchedFolder("rf-1", "../../../etc", 123, "user-1")).rejects.toThrow(
      /no matching unmatched entry/i
    );
  });

  it("rejects when the root folder itself does not exist", async () => {
    const { storage } = await import("../storage.js");
    vi.mocked(storage.getRootFolder).mockResolvedValue(undefined);
    await expect(matchUnmatchedFolder("missing", "Some Game", 123, "user-1")).rejects.toThrow(
      /root folder not found/i
    );
  });
});

describe("scanRootFolderById concurrency guard", () => {
  it("skips a second scan of the same root folder while one is already running", async () => {
    const { storage } = await import("../storage.js");
    let resolveGetRootFolder!: (v: RootFolder) => void;
    vi.mocked(storage.getRootFolder).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveGetRootFolder = resolve;
        })
    );

    const first = scanRootFolderById("rf-1", "user-1");
    // The second call should see the guard is already held and return
    // immediately without ever calling storage.getRootFolder again.
    const callCountBeforeSecond = vi.mocked(storage.getRootFolder).mock.calls.length;
    await scanRootFolderById("rf-1", "user-1");
    expect(vi.mocked(storage.getRootFolder).mock.calls).toHaveLength(callCountBeforeSecond);

    // Unblock the first scan so it can finish and release the guard.
    resolveGetRootFolder(mockRootFolder);
    await first;
  });

  it("queues one more scan when a rescan is requested while one is running", async () => {
    const { storage } = await import("../storage.js");
    const disabled: RootFolder = { ...mockRootFolder, id: "rf-queue", enabled: false };
    let resolveGetRootFolder!: (v: RootFolder) => void;
    vi.mocked(storage.getRootFolder).mockReset();
    vi.mocked(storage.getRootFolder)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveGetRootFolder = resolve;
          })
      )
      .mockResolvedValue(disabled);

    const first = scanRootFolderById("rf-queue", "user-1");
    // Two requests while the first scan runs collapse into a single follow-up.
    await rescanRootFolderById("rf-queue", "user-1");
    await rescanRootFolderById("rf-queue", "user-1");
    expect(storage.getRootFolder).toHaveBeenCalledTimes(1);

    resolveGetRootFolder(disabled);
    await first;
    expect(storage.getRootFolder).toHaveBeenCalledTimes(2);
  });
});

describe("scanRootFolderById full scan", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "questarr-scan-"));

    // "Halo Infinite": a directory candidate with a main file and a nested
    // dlc/ folder — exercises the auto-match (new game) and category-by-
    // parent-folder branches.
    await fs.promises.mkdir(path.join(tmpDir, "Halo Infinite", "dlc"), { recursive: true });
    await fs.promises.writeFile(path.join(tmpDir, "Halo Infinite", "setup.exe"), "x");
    await fs.promises.writeFile(path.join(tmpDir, "Halo Infinite", "dlc", "bonus.zip"), "x");

    // "Existing Game": auto-matches an IGDB id that storage already has a
    // (non-owned) game for — exercises the "update status" branch.
    await fs.promises.mkdir(path.join(tmpDir, "Existing Game"));
    await fs.promises.writeFile(path.join(tmpDir, "Existing Game", "install.exe"), "x");

    // Standalone file with no strong IGDB match — exercises the unmatched
    // branch, including an empty candidates list.
    await fs.promises.writeFile(path.join(tmpDir, "Mystery Game.iso"), "x");

    // Folder with only ignored files (nfo) — exercises the "skip candidate
    // with no usable files" branch; IGDB is never queried for it.
    await fs.promises.mkdir(path.join(tmpDir, "IgnoredOnly"));
    await fs.promises.writeFile(path.join(tmpDir, "IgnoredOnly", "readme.nfo"), "x");

    const rootFolder: RootFolder = { ...mockRootFolder, id: "rf-1", path: tmpDir };

    const { storage } = await import("../storage.js");
    vi.mocked(storage.getRootFolder).mockResolvedValue(rootFolder);
    vi.mocked(storage.addGameFile).mockResolvedValue(undefined as never);
    vi.mocked(storage.updateGame).mockResolvedValue(undefined as never);
    vi.mocked(storage.updateGameStatus).mockResolvedValue(undefined as never);
    vi.mocked(storage.touchRootFolderScanned).mockResolvedValue(undefined);
    vi.mocked(storage.addGame).mockImplementation(
      async (g) => ({ id: `game-${g.igdbId}`, ...g }) as unknown as Game
    );
    vi.mocked(storage.getGameByIgdbId).mockImplementation(async (igdbId: number) => {
      if (igdbId === 2) {
        return { id: "existing-game", status: "wanted", igdbId: 2 } as unknown as Game;
      }
      return undefined;
    });
    // "Existing Game"'s install.exe is already tracked — exercises the
    // "skip already-tracked file" branch in assignFilesToGame.
    vi.mocked(storage.getGameFiles).mockImplementation(async (gameId: string) =>
      gameId === "existing-game"
        ? ([{ filePath: path.join(tmpDir, "Existing Game", "install.exe") }] as unknown as Awaited<
            ReturnType<typeof storage.getGameFiles>
          >)
        : []
    );

    const { igdbClient } = await import("../igdb.js");
    vi.mocked(igdbClient.searchGames).mockImplementation(async (query: string) => {
      if (query === "Halo Infinite") {
        // Full metadata so igdbToInsertGame's optional-field mapping branches
        // (cover/screenshots/platforms/genres/involved_companies) run too.
        return [
          {
            id: 1,
            name: "Halo Infinite",
            summary: "A Spartan's journey.",
            first_release_date: 1638835200,
            rating: 87.5,
            cover: { url: "//images.igdb.com/t_thumb/cover.jpg" },
            screenshots: [{ url: "//images.igdb.com/t_thumb/shot1.jpg" }],
            platforms: [{ name: "PC" }],
            genres: [{ name: "Shooter" }],
            involved_companies: [
              { publisher: true, developer: false, company: { name: "Xbox Game Studios" } },
              { publisher: false, developer: true, company: { name: "343 Industries" } },
            ],
          },
        ] as never;
      }
      if (query === "Existing Game") return [{ id: 2, name: "Existing Game" }] as never;
      return [];
    });
  });

  it("auto-matches strong candidates, queues weak ones as unmatched, and skips empty folders", async () => {
    const { storage } = await import("../storage.js");
    const { igdbClient } = await import("../igdb.js");

    await scanRootFolderById("rf-1", "user-1");

    const progress = getScanProgress("rf-1");
    expect(progress?.status).toBe("completed");
    expect(progress?.matched).toBe(2);
    expect(progress?.unmatched).toBe(1);
    expect(progress?.errors).toBe(0);
    // The ignored-only folder never reaches file classification / IGDB.
    expect(progress?.processedCandidates).toBe(4);

    // New game created for the never-seen IGDB id, with a dlc-categorized file.
    expect(storage.addGame).toHaveBeenCalledTimes(1);
    expect(storage.updateGame).toHaveBeenCalledWith(
      "game-1",
      expect.objectContaining({ libraryPath: path.join(tmpDir, "Halo Infinite") })
    );
    expect(storage.addGameFile).toHaveBeenCalledWith(
      expect.objectContaining({ category: "dlc", originalName: "bonus.zip" })
    );

    // Existing, not-yet-owned game gets promoted to owned rather than re-created,
    // and since it had no libraryPath yet, the discovered folder is set on it too.
    expect(storage.updateGameStatus).toHaveBeenCalledWith(
      "existing-game",
      { status: "owned" },
      { preserveCurated: true }
    );
    expect(storage.updateGame).toHaveBeenCalledWith("existing-game", {
      libraryPath: path.join(tmpDir, "Existing Game"),
    });

    // Weak match queued for manual review with no candidates.
    const unmatched = getAllUnmatched();
    expect(unmatched).toHaveLength(1);
    expect(unmatched[0].folderName).toBe("Mystery Game.iso");
    expect(unmatched[0].candidates).toEqual([]);

    // The IGDB-less ignored folder was never queried.
    expect(igdbClient.searchGames).not.toHaveBeenCalledWith("IgnoredOnly", 5);

    // Clients refresh their games list once the scan has added games.
    const { notifyUser } = await import("../socket.js");
    expect(notifyUser).toHaveBeenCalledWith("gameUpdated", "rf-1");
  });

  it("scanAllEnabledRootFolders scans every enabled folder", async () => {
    const tmpDir2 = await fs.promises.mkdtemp(path.join(os.tmpdir(), "questarr-scan-2-"));
    const folderA: RootFolder = { ...mockRootFolder, id: "rf-1", path: tmpDir };
    const folderB: RootFolder = { ...mockRootFolder, id: "rf-2", path: tmpDir2 };

    const { storage } = await import("../storage.js");
    vi.mocked(storage.getEnabledRootFolders).mockResolvedValue([folderA, folderB]);
    vi.mocked(storage.getRootFolder).mockImplementation(async (id: string) =>
      id === "rf-2" ? folderB : folderA
    );

    await scanAllEnabledRootFolders("user-1");

    // An implementation that only scans folders[0] would leave rf-2 untouched.
    expect(getScanProgress("rf-1")?.status).toBe("completed");
    expect(getScanProgress("rf-2")?.status).toBe("completed");
  });

  it("shows the rest of a batch as queued so status never looks idle between folders", async () => {
    const tmpDir2 = await fs.promises.mkdtemp(path.join(os.tmpdir(), "questarr-scan-2-"));
    const folderA: RootFolder = { ...mockRootFolder, id: "rf-1", path: tmpDir };
    const folderB: RootFolder = { ...mockRootFolder, id: "rf-batch-b", path: tmpDir2 };

    const { storage } = await import("../storage.js");
    vi.mocked(storage.getEnabledRootFolders).mockResolvedValue([folderA, folderB]);
    vi.mocked(storage.getRootFolder).mockImplementation(async (id: string) =>
      id === "rf-batch-b" ? folderB : folderA
    );
    // Snapshot folder B's status each time folder A reports progress.
    const statusesOfB: Array<string | undefined> = [];
    const { notifyUser } = await import("../socket.js");
    vi.mocked(notifyUser).mockImplementation(() => {
      if (getScanProgress("rf-1")?.status === "completed") {
        statusesOfB.push(getScanProgress("rf-batch-b")?.status);
      }
    });

    await scanAllEnabledRootFolders("user-1");
    vi.mocked(notifyUser).mockReset();

    // When folder A completes, folder B is already waiting, not missing.
    expect(statusesOfB[0]).toBe("queued");
    expect(getScanProgress("rf-batch-b")?.status).toBe("completed");
  });

  it("keeps scanning the rest of a batch when one folder is gone", async () => {
    const { storage } = await import("../storage.js");
    const gone: RootFolder = { ...mockRootFolder, id: "rf-gone", path: "/mnt/gone" };
    const kept: RootFolder = { ...mockRootFolder, id: "rf-1", path: tmpDir };
    vi.mocked(storage.getEnabledRootFolders).mockResolvedValue([gone, kept]);
    // The first folder was deleted after the batch listed it.
    vi.mocked(storage.getRootFolder).mockImplementation(async (id: string) =>
      id === "rf-gone" ? undefined : kept
    );

    await rescanAllEnabledRootFolders("user-1");

    expect(getScanProgress("rf-1")?.status).toBe("completed");
  });

  it("restores a folder's previous status when its queued scan does not run", async () => {
    const disabled: RootFolder = { ...mockRootFolder, id: "rf-off", enabled: false };
    const { storage } = await import("../storage.js");
    vi.mocked(storage.getEnabledRootFolders).mockResolvedValue([disabled]);
    vi.mocked(storage.getRootFolder).mockResolvedValue(disabled);

    await scanAllEnabledRootFolders("user-1");

    expect(getScanProgress("rf-off")).toBeUndefined();
  });
});

describe("same-basename standalone files stay independently resolvable", () => {
  it("keeps Game.iso and Game.zip as distinct unmatched entries", async () => {
    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "questarr-basename-"));
    await fs.promises.writeFile(path.join(tmpDir, "Game.iso"), "x");
    await fs.promises.writeFile(path.join(tmpDir, "Game.zip"), "x");
    const rootFolder: RootFolder = { ...mockRootFolder, id: "rf-basename", path: tmpDir };

    const { storage } = await import("../storage.js");
    vi.mocked(storage.getRootFolder).mockResolvedValue(rootFolder);
    vi.mocked(storage.getGameFiles).mockResolvedValue([]);
    vi.mocked(storage.addGameFile).mockResolvedValue(undefined as never);
    vi.mocked(storage.updateGame).mockResolvedValue(undefined as never);
    vi.mocked(storage.touchRootFolderScanned).mockResolvedValue(undefined);
    vi.mocked(storage.getGameByIgdbId).mockResolvedValue(undefined);
    vi.mocked(storage.addGame).mockImplementation(
      async (g) => ({ id: `game-${g.igdbId}`, ...g }) as unknown as Game
    );

    const { igdbClient } = await import("../igdb.js");
    // Only a weak match for either — both land in the unmatched queue with id 99 offered.
    vi.mocked(igdbClient.searchGames).mockResolvedValue([
      { id: 99, name: "Totally Unrelated Title" },
    ] as never);

    await scanRootFolderById("rf-basename", "user-1");

    const beforeMatch = getAllUnmatched().filter((e) => e.rootFolderId === "rf-basename");
    expect(beforeMatch.map((e) => e.folderName).sort()).toEqual(["Game.iso", "Game.zip"]);
    expect(new Set(beforeMatch.map((e) => e.absolutePath)).size).toBe(2);

    // Resolving Game.iso must not clear Game.zip's queued entry too.
    vi.mocked(igdbClient.getGameById).mockResolvedValueOnce({
      id: 99,
      name: "Totally Unrelated Title",
    } as never);
    await matchUnmatchedFolder("rf-basename", "Game.iso", 99, "user-1");

    const afterMatch = getAllUnmatched().filter((e) => e.rootFolderId === "rf-basename");
    expect(afterMatch.map((e) => e.folderName)).toEqual(["Game.zip"]);
  });
});

describe("existing game libraryPath handling", () => {
  it("preserves an already-managed libraryPath instead of overwriting it", async () => {
    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "questarr-libpath-"));
    await fs.promises.mkdir(path.join(tmpDir, "Portal 2"));
    await fs.promises.writeFile(path.join(tmpDir, "Portal 2", "setup.exe"), "x");
    const rootFolder: RootFolder = { ...mockRootFolder, id: "rf-libpath", path: tmpDir };

    const { storage } = await import("../storage.js");
    vi.mocked(storage.getRootFolder).mockResolvedValue(rootFolder);
    vi.mocked(storage.getGameFiles).mockResolvedValue([]);
    vi.mocked(storage.addGameFile).mockResolvedValue(undefined as never);
    vi.mocked(storage.updateGame).mockResolvedValue(undefined as never);
    vi.mocked(storage.updateGameStatus).mockResolvedValue(undefined as never);
    vi.mocked(storage.touchRootFolderScanned).mockResolvedValue(undefined);
    // Already owned AND already has a managed libraryPath from a prior import.
    vi.mocked(storage.getGameByIgdbId).mockResolvedValue({
      id: "managed-game",
      status: "owned",
      igdbId: 7,
      libraryPath: "/data/library/Portal 2",
    } as unknown as Game);

    const { igdbClient } = await import("../igdb.js");
    vi.mocked(igdbClient.searchGames).mockResolvedValue([{ id: 7, name: "Portal 2" }] as never);

    // Other tests in this file reuse these same mocks — reset call history
    // so this test only sees calls made by its own scan below.
    vi.mocked(storage.updateGameStatus).mockClear();
    vi.mocked(storage.updateGame).mockClear();

    await scanRootFolderById("rf-libpath", "user-1");

    // Status is already "owned" and libraryPath is already set — neither
    // update call should fire, let alone overwrite the managed path.
    expect(storage.updateGameStatus).not.toHaveBeenCalled();
    expect(storage.updateGame).not.toHaveBeenCalled();
  });

  it("keeps a playing game's status when a scan finds its folder", async () => {
    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "questarr-playing-"));
    await fs.promises.mkdir(path.join(tmpDir, "Portal 2"));
    await fs.promises.writeFile(path.join(tmpDir, "Portal 2", "setup.exe"), "x");
    const rootFolder: RootFolder = { ...mockRootFolder, id: "rf-playing", path: tmpDir };

    const { storage } = await import("../storage.js");
    vi.mocked(storage.getRootFolder).mockResolvedValue(rootFolder);
    vi.mocked(storage.getGameFiles).mockResolvedValue([]);
    vi.mocked(storage.addGameFile).mockResolvedValue(undefined as never);
    vi.mocked(storage.updateGame).mockResolvedValue(undefined as never);
    vi.mocked(storage.updateGameStatus).mockResolvedValue(undefined as never);
    vi.mocked(storage.touchRootFolderScanned).mockResolvedValue(undefined);
    vi.mocked(storage.getGameByIgdbId).mockResolvedValue({
      id: "playing-game",
      status: "playing",
      igdbId: 7,
      libraryPath: null,
    } as unknown as Game);

    const { igdbClient } = await import("../igdb.js");
    vi.mocked(igdbClient.searchGames).mockResolvedValue([{ id: 7, name: "Portal 2" }] as never);

    vi.mocked(storage.updateGameStatus).mockClear();
    vi.mocked(storage.updateGame).mockClear();

    await scanRootFolderById("rf-playing", "user-1");

    expect(storage.updateGameStatus).not.toHaveBeenCalled();
    // The discovered folder is still recorded on the game.
    expect(storage.updateGame).toHaveBeenCalledWith("playing-game", {
      libraryPath: path.join(tmpDir, "Portal 2"),
    });
  });
});

describe("matchUnmatchedFolder with release-style folder names", () => {
  const folderName = "Absolum v1.01 [CUSA53342] [EUR]";

  async function scanReleaseFolder(rootFolderId: string) {
    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "questarr-release-"));
    await fs.promises.mkdir(path.join(tmpDir, folderName));
    await fs.promises.writeFile(path.join(tmpDir, folderName, "game.pkg"), "x");
    const rootFolder: RootFolder = { ...mockRootFolder, id: rootFolderId, path: tmpDir };

    const { storage } = await import("../storage.js");
    vi.mocked(storage.getRootFolder).mockResolvedValue(rootFolder);
    vi.mocked(storage.getGameFiles).mockResolvedValue([]);
    vi.mocked(storage.addGameFile).mockResolvedValue(undefined as never);
    vi.mocked(storage.updateGame).mockResolvedValue(undefined as never);
    vi.mocked(storage.touchRootFolderScanned).mockResolvedValue(undefined);
    vi.mocked(storage.getGameByIgdbId).mockResolvedValue(undefined);
    vi.mocked(storage.addGame).mockImplementation(
      async (g) => ({ id: `game-${g.igdbId}`, ...g }) as unknown as Game
    );

    const { igdbClient } = await import("../igdb.js");
    // IGDB only knows the game under its cleaned title; the raw release name
    // finds nothing, which is what happened in production.
    vi.mocked(igdbClient.searchGames).mockImplementation(async (query: string) =>
      query === folderName ? [] : ([{ id: 314, name: "Absolum Deluxe Something" }] as never)
    );
    vi.mocked(igdbClient.getGameById).mockResolvedValue({
      id: 314,
      name: "Absolum Deluxe Something",
    } as never);

    await scanRootFolderById(rootFolderId, "user-1");
    const entry = getAllUnmatched().find(
      (e) => e.rootFolderId === rootFolderId && e.folderName === folderName
    );
    expect(entry?.candidates.map((c) => c.igdbId)).toEqual([314]);
    return igdbClient;
  }

  it("accepts a candidate the scan offered even when the raw name finds nothing", async () => {
    await scanReleaseFolder("rf-release-ok");

    const result = await matchUnmatchedFolder("rf-release-ok", folderName, 314, "user-1");

    expect(result.gameId).toBe("game-314");
    expect(getAllUnmatched().some((e) => e.rootFolderId === "rf-release-ok")).toBe(false);
  });

  it("rejects an IGDB id the scan did not offer for that folder", async () => {
    const igdbClient = await scanReleaseFolder("rf-release-bad");
    vi.mocked(igdbClient.getGameById).mockClear();

    await expect(matchUnmatchedFolder("rf-release-bad", folderName, 999, "user-1")).rejects.toThrow(
      /not found in top candidates/i
    );
    expect(igdbClient.getGameById).not.toHaveBeenCalled();
  });

  it("matches a game the user found by searching a name of their own", async () => {
    const igdbClient = await scanReleaseFolder("rf-release-search");
    vi.mocked(igdbClient.searchGames).mockResolvedValue([
      { id: 777, name: "Absolum", first_release_date: 1735689600 },
    ] as never);
    vi.mocked(igdbClient.getGameById).mockResolvedValue({ id: 777, name: "Absolum" } as never);

    const candidates = await searchUnmatchedFolder("rf-release-search", folderName, "Absolum");

    expect(igdbClient.searchGames).toHaveBeenLastCalledWith("Absolum", 5);
    expect(candidates).toEqual([{ igdbId: 777, name: "Absolum", releaseYear: 2025 }]);
    // The searched result replaces the scan's guesses, so it can now be matched.
    const result = await matchUnmatchedFolder("rf-release-search", folderName, 777, "user-1");
    expect(result.gameId).toBe("game-777");
  });

  it("refuses to search for a folder that is not awaiting review", async () => {
    await expect(searchUnmatchedFolder("rf-unknown", "Nope", "Absolum")).rejects.toThrow(
      /no matching unmatched entry/i
    );
  });
});
