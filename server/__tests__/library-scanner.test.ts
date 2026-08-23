import { describe, it, expect, vi, beforeEach } from "vitest";
import { __testing, matchUnmatchedFolder, scanRootFolderById } from "../library-scanner.js";
import type { RootFolder } from "../../shared/schema.js";

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
    expect(vi.mocked(storage.getRootFolder).mock.calls.length).toBe(callCountBeforeSecond);

    // Unblock the first scan so it can finish and release the guard.
    resolveGetRootFolder(mockRootFolder);
    await first;
  });
});
