import { beforeEach, describe, expect, it, vi } from "vitest";

const { fsMock, downloadersMock } = vi.hoisted(() => ({
  fsMock: {
    ensureDir: vi.fn().mockResolvedValue(undefined),
    move: vi.fn().mockResolvedValue(undefined),
    copy: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    pathExists: vi.fn().mockResolvedValue(true),
    stat: vi.fn().mockResolvedValue({ isDirectory: () => false }),
    readdir: vi.fn().mockResolvedValue([]),
  },
  downloadersMock: {
    removeDownload: vi.fn().mockResolvedValue({ success: true, message: "ok" }),
    getDownloadDetails: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock("fs-extra", () => ({ default: fsMock }));
vi.mock("../downloaders.js", () => ({ DownloaderManager: downloadersMock }));

import { ImportManager } from "../services/ImportManager.js";
import { PCImportStrategy } from "../services/ImportStrategies.js";
import { makeImportConfig } from "./helpers/import-test-helpers.js";

function makeStorage() {
  return {
    getGameDownload: vi.fn(),
    getGame: vi.fn(),
    getImportConfig: vi.fn(),
    getDownloader: vi.fn(),
    updateGameDownloadStatus: vi.fn(),
    updateGameStatus: vi.fn(),
    addNotification: vi.fn().mockResolvedValue(undefined),
  };
}

function makeManager(
  storage: ReturnType<typeof makeStorage>,
  overrides: {
    pathService?: { translatePath: ReturnType<typeof vi.fn> };
    archiveService?: {
      isArchive: ReturnType<typeof vi.fn>;
      extract: ReturnType<typeof vi.fn>;
    };
  } = {}
) {
  const pathService = overrides.pathService ?? {
    translatePath: vi.fn().mockResolvedValue("/local/file.iso"),
  };
  const platformService = { getSourcePlatform: vi.fn() };
  const archiveService = overrides.archiveService ?? {
    isArchive: vi.fn().mockReturnValue(false),
    extract: vi.fn().mockResolvedValue([]),
  };
  return new ImportManager(
    storage as never, // NOSONAR
    pathService as never, // NOSONAR
    platformService as never, // NOSONAR
    archiveService as never // NOSONAR
  );
}

// ─── planConfirmImport ────────────────────────────────────────────────────────

describe("ImportManager - planConfirmImport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    downloadersMock.getDownloadDetails.mockResolvedValue(null);
  });

  it("throws when download not found", async () => {
    const storage = makeStorage();
    storage.getGameDownload.mockResolvedValue(undefined);

    const manager = makeManager(storage);
    await expect(manager.planConfirmImport("dl-missing")).rejects.toThrow(
      "Download dl-missing not found"
    );
  });

  it("throws when game not found", async () => {
    const storage = makeStorage();
    storage.getGameDownload.mockResolvedValue({ id: "dl-1", gameId: "g-x", downloaderId: "d1" });
    storage.getGame.mockResolvedValue(undefined);

    const manager = makeManager(storage);
    await expect(manager.planConfirmImport("dl-1")).rejects.toThrow(
      "Game not found for download dl-1"
    );
  });

  it("returns resolved path and planned proposedPath when overrideSourcePath is provided", async () => {
    const storage = makeStorage();
    storage.getGameDownload.mockResolvedValue({
      id: "dl-1",
      gameId: "g1",
      downloaderId: "d1",
      downloadHash: "abc",
    });
    storage.getGame.mockResolvedValue({
      id: "g1",
      title: "My Game",
      userId: "u1",
      status: "wanted",
      platforms: [],
    });
    storage.getImportConfig.mockResolvedValue(makeImportConfig({ libraryRoot: "/games" }));

    const planSpy = vi.spyOn(PCImportStrategy.prototype, "planImport").mockResolvedValue({
      needsReview: false,
      strategy: "pc",
      originalPath: "/local/path/game.iso",
      proposedPath: "/games/PC/My Game",
    });

    const pathService = { translatePath: vi.fn().mockResolvedValue("/local/path/game.iso") };
    const manager = makeManager(storage, { pathService });

    const result = await manager.planConfirmImport("dl-1", "/local/path/game.iso");

    expect(result.originalPath).toBe("/local/path/game.iso");
    expect(result.proposedPath).toBe("/games/PC/My Game");

    planSpy.mockRestore();
  });

  it("returns null originalPath when downloader not found (no overrideSourcePath)", async () => {
    const storage = makeStorage();
    storage.getGameDownload.mockResolvedValue({
      id: "dl-1",
      gameId: "g1",
      downloaderId: "d1",
      downloadHash: "abc",
    });
    storage.getGame.mockResolvedValue({
      id: "g1",
      title: "Fallback Game",
      userId: "u1",
      status: "wanted",
      platforms: [],
    });
    storage.getImportConfig.mockResolvedValue(makeImportConfig({ libraryRoot: "/games" }));
    storage.getDownloader.mockResolvedValue(undefined);

    const manager = makeManager(storage);
    const result = await manager.planConfirmImport("dl-1");

    expect(result.originalPath).toBeNull();
    expect(result.proposedPath).toContain("Fallback Game");
  });

  it("resolves originalPath via getDownloadDetails when no override", async () => {
    const storage = makeStorage();
    storage.getGameDownload.mockResolvedValue({
      id: "dl-1",
      gameId: "g1",
      downloaderId: "d1",
      downloadHash: "abc123",
    });
    storage.getGame.mockResolvedValue({
      id: "g1",
      title: "NAS Game",
      userId: "u1",
      status: "wanted",
      platforms: [],
    });
    storage.getImportConfig.mockResolvedValue(makeImportConfig({ libraryRoot: "/games" }));
    storage.getDownloader.mockResolvedValue({
      id: "d1",
      name: "qBit",
      url: "http://nas.local:8080",
    });
    downloadersMock.getDownloadDetails.mockResolvedValue({
      downloadDir: "/remote/downloads",
      name: "game.iso",
    });

    const pathService = { translatePath: vi.fn().mockResolvedValue("/local/downloads/game.iso") };
    const planSpy = vi.spyOn(PCImportStrategy.prototype, "planImport").mockResolvedValue({
      needsReview: false,
      strategy: "pc",
      originalPath: "/local/downloads/game.iso",
      proposedPath: "/games/PC/NAS Game",
    });

    const manager = makeManager(storage, { pathService });
    const result = await manager.planConfirmImport("dl-1");

    expect(result.originalPath).toBe("/local/downloads/game.iso");
    expect(pathService.translatePath).toHaveBeenCalledWith(
      "/remote/downloads/game.iso",
      "nas.local"
    );

    planSpy.mockRestore();
  });

  it("returns null originalPath when getDownloadDetails returns no downloadDir", async () => {
    const storage = makeStorage();
    storage.getGameDownload.mockResolvedValue({
      id: "dl-1",
      gameId: "g1",
      downloaderId: "d1",
      downloadHash: "abc123",
    });
    storage.getGame.mockResolvedValue({
      id: "g1",
      title: "My Game",
      userId: "u1",
      status: "wanted",
      platforms: [],
    });
    storage.getImportConfig.mockResolvedValue(makeImportConfig({ libraryRoot: "/games" }));
    storage.getDownloader.mockResolvedValue({ id: "d1", name: "qBit", url: "http://localhost" });
    downloadersMock.getDownloadDetails.mockResolvedValue({ downloadDir: null, name: "game.iso" });

    const manager = makeManager(storage);
    const result = await manager.planConfirmImport("dl-1");

    expect(result.originalPath).toBeNull();
  });

  it("returns fallback proposedPath when planImport throws (source not accessible)", async () => {
    const storage = makeStorage();
    storage.getGameDownload.mockResolvedValue({
      id: "dl-1",
      gameId: "g1",
      downloaderId: "d1",
      downloadHash: "abc",
    });
    storage.getGame.mockResolvedValue({
      id: "g1",
      title: "My Game",
      userId: "u1",
      status: "wanted",
      platforms: [],
    });
    storage.getImportConfig.mockResolvedValue(makeImportConfig({ libraryRoot: "/games" }));

    const planSpy = vi
      .spyOn(PCImportStrategy.prototype, "planImport")
      .mockRejectedValue(new Error("ENOENT: no such file"));

    const pathService = { translatePath: vi.fn().mockResolvedValue("/local/path/game.iso") };
    const manager = makeManager(storage, { pathService });

    const result = await manager.planConfirmImport("dl-1", "/local/path/game.iso");

    expect(result.originalPath).toBe("/local/path/game.iso");
    expect(result.proposedPath).toMatch(/My Game/);

    planSpy.mockRestore();
  });

  it("handles source resolution failure gracefully → null originalPath", async () => {
    const storage = makeStorage();
    storage.getGameDownload.mockResolvedValue({
      id: "dl-1",
      gameId: "g1",
      downloaderId: "d1",
      downloadHash: "abc",
    });
    storage.getGame.mockResolvedValue({
      id: "g1",
      title: "Graceful Game",
      userId: "u1",
      status: "wanted",
      platforms: [],
    });
    storage.getImportConfig.mockResolvedValue(makeImportConfig({ libraryRoot: "/games" }));
    storage.getDownloader.mockRejectedValue(new Error("DB error"));

    const manager = makeManager(storage);
    const result = await manager.planConfirmImport("dl-1");

    expect(result.originalPath).toBeNull();
    expect(result.proposedPath).toContain("Graceful Game");
  });
});

// ─── performAutoDelete edge cases ────────────────────────────────────────────

describe("ImportManager - performAutoDelete skips", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fsMock.pathExists.mockResolvedValue(true);
    downloadersMock.removeDownload.mockResolvedValue({ success: true, message: "ok" });
  });

  it("skips auto-delete when downloader is not found during cleanup", async () => {
    const storage = makeStorage();
    storage.getGameDownload.mockResolvedValue({
      id: "dl-1",
      gameId: "g1",
      downloaderId: "d1",
      downloadHash: "abc",
      downloadTitle: "My Game",
    });
    storage.getGame.mockResolvedValue({
      id: "g1",
      title: "My Game",
      userId: "u1",
      status: "wanted",
      platforms: [6],
    });
    storage.getImportConfig.mockResolvedValue(
      makeImportConfig({ transferMode: "copy", autoDeleteAfterImport: true })
    );
    // First getDownloader (resolveLocalPath) returns the downloader;
    // second (performAutoDelete) returns undefined
    storage.getDownloader
      .mockResolvedValueOnce({ id: "d1", name: "qBit", url: "http://localhost" })
      .mockResolvedValueOnce(undefined);

    const manager = makeManager(storage);
    await manager.processImport("dl-1", "/remote/path");

    expect(downloadersMock.removeDownload).not.toHaveBeenCalled();
  });

  it("skips auto-delete when download has no hash", async () => {
    const storage = makeStorage();
    storage.getGameDownload.mockResolvedValue({
      id: "dl-1",
      gameId: "g1",
      downloaderId: "d1",
      downloadHash: null,
      downloadTitle: "My Game",
    });
    storage.getGame.mockResolvedValue({
      id: "g1",
      title: "My Game",
      userId: "u1",
      status: "wanted",
      platforms: [6],
    });
    storage.getImportConfig.mockResolvedValue(
      makeImportConfig({ transferMode: "copy", autoDeleteAfterImport: true })
    );
    storage.getDownloader.mockResolvedValue({ id: "d1", name: "qBit", url: "http://localhost" });

    const manager = makeManager(storage);
    await manager.processImport("dl-1", "/remote/path");

    expect(downloadersMock.removeDownload).not.toHaveBeenCalled();
  });
});

// ─── platform filter ──────────────────────────────────────────────────────────

describe("ImportManager - shouldSkipPCPlatform", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fsMock.pathExists.mockResolvedValue(true);
  });

  it("marks completed when game platform is excluded by importPlatformIds filter", async () => {
    const storage = makeStorage();
    storage.getGameDownload.mockResolvedValue({
      id: "dl-1",
      gameId: "g1",
      downloaderId: "d1",
      downloadTitle: "",
    });
    storage.getGame.mockResolvedValue({
      id: "g1",
      title: "PS3 Game",
      userId: "u1",
      status: "wanted",
      platforms: [9], // PS3
    });
    storage.getImportConfig.mockResolvedValue(
      makeImportConfig({ importPlatformIds: [6] }) // PC only
    );
    storage.getDownloader.mockResolvedValue({ id: "d1", name: "qBit", url: "http://localhost" });

    const manager = makeManager(storage);
    await manager.processImport("dl-1", "/remote/path");

    expect(storage.updateGameDownloadStatus).toHaveBeenCalledWith("dl-1", "completed");
    expect(fsMock.ensureDir).not.toHaveBeenCalled();
  });

  it("does not skip when game platform matches importPlatformIds", async () => {
    const storage = makeStorage();
    storage.getGameDownload.mockResolvedValue({
      id: "dl-1",
      gameId: "g1",
      downloaderId: "d1",
      downloadTitle: "",
    });
    storage.getGame.mockResolvedValue({
      id: "g1",
      title: "PC Game",
      userId: "u1",
      status: "wanted",
      platforms: [6], // PC
    });
    storage.getImportConfig.mockResolvedValue(
      makeImportConfig({ importPlatformIds: [6], libraryRoot: "/games" })
    );
    storage.getDownloader.mockResolvedValue({ id: "d1", name: "qBit", url: "http://localhost" });

    const manager = makeManager(storage);
    await manager.processImport("dl-1", "/remote/path");

    expect(fsMock.ensureDir).toHaveBeenCalledWith("/games");
  });
});

// ─── archive cleanup in processImport ────────────────────────────────────────

describe("ImportManager - processImport archive cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fsMock.pathExists.mockResolvedValue(true);
    fsMock.remove.mockResolvedValue(undefined);
  });

  it("removes extracted directory after successful import when autoUnpack is enabled", async () => {
    const storage = makeStorage();
    storage.getGameDownload.mockResolvedValue({
      id: "dl-1",
      gameId: "g1",
      downloaderId: "d1",
      downloadTitle: "Game.zip",
    });
    storage.getGame.mockResolvedValue({
      id: "g1",
      title: "Archive Game",
      userId: "u1",
      status: "wanted",
      platforms: [6],
    });
    storage.getImportConfig.mockResolvedValue(
      makeImportConfig({ autoUnpack: true, transferMode: "copy", libraryRoot: "/games" })
    );
    storage.getDownloader.mockResolvedValue({ id: "d1", name: "qBit", url: "http://localhost" });

    const pathService = { translatePath: vi.fn().mockResolvedValue("/local/Game.zip") };
    const archiveService = {
      isArchive: vi.fn().mockReturnValue(true),
      extract: vi.fn().mockResolvedValue(["/local/Game.zip_extracted/game.exe"]),
    };

    const planSpy = vi.spyOn(PCImportStrategy.prototype, "planImport").mockResolvedValue({
      needsReview: false,
      strategy: "pc",
      originalPath: "/local/Game.zip_extracted",
      proposedPath: "/games/PC/Archive Game",
    });
    const execSpy = vi.spyOn(PCImportStrategy.prototype, "executeImport").mockResolvedValue({
      destDir: "/games/PC/Archive Game",
      filesPlaced: ["/games/PC/Archive Game/game.exe"],
      modeUsed: "copy",
      conflictsResolved: [],
    });

    const manager = makeManager(storage, { pathService, archiveService });
    await manager.processImport("dl-1", "/remote/path");

    expect(fsMock.remove).toHaveBeenCalledWith("/local/Game.zip_extracted");

    planSpy.mockRestore();
    execSpy.mockRestore();
  });

  it("does not call remove when autoUnpack is false (no extraction)", async () => {
    const storage = makeStorage();
    storage.getGameDownload.mockResolvedValue({
      id: "dl-1",
      gameId: "g1",
      downloaderId: "d1",
      downloadTitle: "Game.iso",
    });
    storage.getGame.mockResolvedValue({
      id: "g1",
      title: "ISO Game",
      userId: "u1",
      status: "wanted",
      platforms: [6],
    });
    storage.getImportConfig.mockResolvedValue(
      makeImportConfig({ autoUnpack: false, transferMode: "copy", libraryRoot: "/games" })
    );
    storage.getDownloader.mockResolvedValue({ id: "d1", name: "qBit", url: "http://localhost" });

    const pathService = { translatePath: vi.fn().mockResolvedValue("/local/Game.iso") };

    const planSpy = vi.spyOn(PCImportStrategy.prototype, "planImport").mockResolvedValue({
      needsReview: false,
      strategy: "pc",
      originalPath: "/local/Game.iso",
      proposedPath: "/games/PC/ISO Game",
    });
    const execSpy = vi.spyOn(PCImportStrategy.prototype, "executeImport").mockResolvedValue({
      destDir: "/games/PC/ISO Game",
      filesPlaced: ["/games/PC/ISO Game/game.iso"],
      modeUsed: "copy",
      conflictsResolved: [],
    });

    const manager = makeManager(storage, { pathService });
    await manager.processImport("dl-1", "/remote/path");

    expect(fsMock.remove).not.toHaveBeenCalled();

    planSpy.mockRestore();
    execSpy.mockRestore();
  });
});

// ─── confirmImport missing path / unresolvable source ────────────────────────

describe("ImportManager - confirmImport path resolution failures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fsMock.pathExists.mockResolvedValue(true);
    fsMock.remove.mockResolvedValue(undefined);
    downloadersMock.getDownloadDetails.mockResolvedValue(null);
  });

  it("throws when source path cannot be resolved (no downloader, empty originalPath)", async () => {
    const storage = makeStorage();
    storage.getGameDownload.mockResolvedValue({ id: "dl-1", gameId: "g1", downloaderId: "d1" });
    storage.getDownloader.mockResolvedValue(undefined);

    const manager = makeManager(storage);

    await expect(
      manager.confirmImport("dl-1", {
        strategy: "pc",
        originalPath: "", // falsy → falls through to downloader lookup
        proposedPath: "/data/PC/game",
        needsReview: false,
      })
    ).rejects.toThrow("Source path could not be resolved");
  });

  it("throws when proposedPath is missing", async () => {
    const storage = makeStorage();
    storage.getGameDownload.mockResolvedValue({ id: "dl-1", gameId: "g1", downloaderId: "d1" });
    storage.getGame.mockResolvedValue({
      id: "g1",
      title: "My Game",
      userId: "u1",
      status: "wanted",
      platforms: [6],
    });
    storage.getImportConfig.mockResolvedValue(makeImportConfig({ libraryRoot: "/data" }));

    const manager = makeManager(storage);

    await expect(
      manager.confirmImport("dl-1", {
        strategy: "pc",
        originalPath: "/local/source", // truthy → returned directly
        proposedPath: "" as unknown as string, // falsy
        needsReview: false,
      })
    ).rejects.toThrow("Proposed path is required for import validation");
  });

  it("removes extracted archive in finally block when executeImport throws", async () => {
    const storage = makeStorage();
    storage.getGameDownload.mockResolvedValue({ id: "dl-1", gameId: "g1", downloaderId: "d1" });
    storage.getGame.mockResolvedValue({
      id: "g1",
      title: "My Game",
      userId: "u1",
      status: "wanted",
      platforms: [6],
    });
    storage.getImportConfig.mockResolvedValue(makeImportConfig({ libraryRoot: "/safe/root" }));

    const archiveService = {
      isArchive: vi.fn().mockReturnValue(true),
      extract: vi.fn().mockResolvedValue(["/downloads/game.zip_extracted/game.exe"]),
    };

    const execSpy = vi
      .spyOn(PCImportStrategy.prototype, "executeImport")
      .mockRejectedValue(new Error("disk full"));

    const manager = makeManager(storage, { archiveService });

    await expect(
      manager.confirmImport("dl-1", {
        strategy: "pc",
        originalPath: "/downloads/game.zip",
        proposedPath: "/safe/root/PC/My Game",
        needsReview: false,
        unpack: true,
      })
    ).rejects.toThrow("disk full");

    expect(fsMock.remove).toHaveBeenCalledWith("/downloads/game.zip_extracted");
    expect(storage.updateGameDownloadStatus).toHaveBeenCalledWith("dl-1", "error");

    execSpy.mockRestore();
  });
});
