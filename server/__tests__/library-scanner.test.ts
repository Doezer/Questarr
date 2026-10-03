import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  __testing,
  matchUnmatchedFolder,
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
    getGameByRawgId: vi.fn(),
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

vi.mock("../rawg.js", () => {
  const rawgClient = {
    searchGames: vi.fn().mockResolvedValue([]),
    // Identity mapping keeps the scanner's field access simple; storage is
    // mocked, so only shapes the tests assert on matter.
    formatGame: vi.fn((game: unknown) => game),
  };
  return { rawgClient };
});

vi.mock("../logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  },
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

    // "Existing Game": auto-matches a RAWG id that storage already has a
    // (non-owned) game for — exercises the "update status" branch.
    await fs.promises.mkdir(path.join(tmpDir, "Existing Game"));
    await fs.promises.writeFile(path.join(tmpDir, "Existing Game", "install.exe"), "x");

    // Standalone file with no strong RAWG match — exercises the unmatched
    // branch, including an empty candidates list.
    await fs.promises.writeFile(path.join(tmpDir, "Mystery Game.iso"), "x");

    // Folder with only ignored files (nfo) — exercises the "skip candidate
    // with no usable files" branch; RAWG is never queried for it.
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
      async (g) => ({ id: `game-${g.rawgId}`, ...g }) as unknown as Game
    );
    vi.mocked(storage.getGameByRawgId).mockImplementation(async (rawgId: number) => {
      if (rawgId === 2) {
        return { id: "existing-game", status: "wanted", rawgId: 2 } as unknown as Game;
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

    const { rawgClient } = await import("../rawg.js");
    vi.mocked(rawgClient.searchGames).mockImplementation(async (query: string) => {
      if (query === "Halo Infinite") {
        // Full RAWG metadata so rawgToInsertGame's optional-field mapping
        // branches (cover/date/platforms/genres/companies) run too.
        return [
          {
            id: 1,
            name: "Halo Infinite",
            slug: "halo-infinite",
            background_image: "https://media.rawg.io/media/games/halo.jpg",
            released: "2021-09-28",
            metacritic: 87,
            platforms: [{ id: 1, name: "PC" }],
            genres: [{ id: 4, name: "Action" }],
            developers: [{ name: "343 Industries" }],
            publishers: [{ name: "Xbox Game Studios" }],
          },
        ] as never;
      }
      if (query === "Existing Game") return [{ id: 2, name: "Existing Game" }] as never;
      return [];
    });
  });

  it("auto-matches strong candidates, queues weak ones as unmatched, and skips empty folders", async () => {
    const { storage } = await import("../storage.js");
    const { rawgClient } = await import("../rawg.js");

    await scanRootFolderById("rf-1", "user-1");

    const progress = getScanProgress("rf-1");
    expect(progress?.status).toBe("completed");
    expect(progress?.matched).toBe(2);
    expect(progress?.unmatched).toBe(1);
    expect(progress?.errors).toBe(0);
    // The ignored-only folder never reaches file classification / RAWG.
    expect(progress?.processedCandidates).toBe(4);

    // New game created for the never-seen RAWG id, with a dlc-categorized file.
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

    // The RAWG-less ignored folder was never queried.
    expect(rawgClient.searchGames).not.toHaveBeenCalledWith("IgnoredOnly", 5);
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
    vi.mocked(storage.getGameByRawgId).mockResolvedValue(undefined);
    vi.mocked(storage.addGame).mockImplementation(
      async (g) => ({ id: `game-${g.rawgId}`, ...g }) as unknown as Game
    );

    const { rawgClient } = await import("../rawg.js");
    // No strong match for either — both land in the unmatched queue.
    vi.mocked(rawgClient.searchGames).mockResolvedValue([]);

    await scanRootFolderById("rf-basename", "user-1");

    const beforeMatch = getAllUnmatched().filter((e) => e.rootFolderId === "rf-basename");
    expect(beforeMatch.map((e) => e.folderName).sort()).toEqual(["Game.iso", "Game.zip"]);
    expect(new Set(beforeMatch.map((e) => e.absolutePath)).size).toBe(2);

    // Resolving Game.iso must not clear Game.zip's queued entry too.
    vi.mocked(rawgClient.searchGames).mockResolvedValueOnce([
      { id: 99, name: "Some Game" },
    ] as never);
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
    vi.mocked(storage.getGameByRawgId).mockResolvedValue({
      id: "managed-game",
      status: "owned",
      rawgId: 7,
      libraryPath: "/data/library/Portal 2",
    } as unknown as Game);

    const { rawgClient } = await import("../rawg.js");
    vi.mocked(rawgClient.searchGames).mockResolvedValue([{ id: 7, name: "Portal 2" }] as never);

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
    vi.mocked(storage.getGameByRawgId).mockResolvedValue({
      id: "playing-game",
      status: "playing",
      rawgId: 7,
      libraryPath: null,
    } as unknown as Game);

    const { rawgClient } = await import("../rawg.js");
    vi.mocked(rawgClient.searchGames).mockResolvedValue([{ id: 7, name: "Portal 2" }] as never);

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
