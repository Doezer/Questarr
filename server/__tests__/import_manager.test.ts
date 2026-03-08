import { beforeEach, describe, expect, it, vi } from "vitest";

const { fsMock } = vi.hoisted(() => ({
  fsMock: {
    ensureDir: vi.fn().mockResolvedValue(undefined),
    move: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("fs-extra", () => ({
  default: fsMock,
}));

import { ImportManager } from "../services/ImportManager.js";

describe("ImportManager", () => {
  const storage = {
    getGameDownload: vi.fn(),
    getGame: vi.fn(),
    getImportConfig: vi.fn(),
    getDownloader: vi.fn(),
    updateGameDownloadStatus: vi.fn(),
    updateGameStatus: vi.fn(),
    getRomMConfig: vi.fn(),
  };

  const pathService = {
    translatePath: vi.fn(),
  };

  const platformService = {
    getRomMPlatform: vi.fn(),
  };

  const archiveService = {
    isArchive: vi.fn(),
    extract: vi.fn(),
  };

  const rommService = {
    isAvailable: vi.fn(),
    scanLibrary: vi.fn(),
  };

  const baseConfig = {
    enablePostProcessing: true,
    autoUnpack: false,
    renamePattern: "{Title}",
    overwriteExisting: true,
    deleteSource: false,
    ignoredExtensions: [],
    minFileSize: 0,
    libraryRoot: "/data",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    pathService.translatePath.mockResolvedValue("/data/downloads/file.iso");
    archiveService.isArchive.mockReturnValue(false);
    platformService.getRomMPlatform.mockResolvedValue(null);
    rommService.isAvailable.mockResolvedValue(true);
    rommService.scanLibrary.mockResolvedValue(true);
    storage.getImportConfig.mockResolvedValue(baseConfig);
    storage.getRomMConfig.mockResolvedValue({ enabled: false });
  });

  it("returns early when download cannot be found", async () => {
    storage.getGameDownload.mockResolvedValue(undefined);
    const manager = new ImportManager(
      storage as never,
      pathService as never,
      platformService as never,
      archiveService as never,
      rommService as never
    );

    await manager.processImport("dl-1", "/remote/path");

    expect(storage.updateGameDownloadStatus).not.toHaveBeenCalled();
  });

  it("marks download as error when game is missing", async () => {
    storage.getGameDownload.mockResolvedValue({
      id: "dl-1",
      gameId: "g1",
    });
    storage.getGame.mockResolvedValue(undefined);

    const manager = new ImportManager(
      storage as never,
      pathService as never,
      platformService as never,
      archiveService as never,
      rommService as never
    );

    await manager.processImport("dl-1", "/remote/path");

    expect(storage.updateGameDownloadStatus).toHaveBeenCalledWith("dl-1", "error");
  });

  it("marks download completed when post-processing is disabled", async () => {
    storage.getGameDownload.mockResolvedValue({
      id: "dl-1",
      gameId: "g1",
      downloaderId: "d1",
    });
    storage.getGame.mockResolvedValue({
      id: "g1",
      title: "Game",
      userId: "u1",
      status: "wanted",
      platforms: [6],
    });
    storage.getImportConfig.mockResolvedValue({ ...baseConfig, enablePostProcessing: false });

    const manager = new ImportManager(
      storage as never,
      pathService as never,
      platformService as never,
      archiveService as never,
      rommService as never
    );

    await manager.processImport("dl-1", "/remote/path");

    expect(storage.updateGameDownloadStatus).toHaveBeenCalledWith("dl-1", "completed");
  });

  it("marks download as error when processing throws", async () => {
    storage.getGameDownload.mockResolvedValue({
      id: "dl-1",
      gameId: "g1",
      downloaderId: "d1",
    });
    storage.getGame.mockResolvedValue({
      id: "g1",
      title: "Game",
      userId: "u1",
      status: "wanted",
      platforms: [6],
    });
    pathService.translatePath.mockRejectedValue(new Error("translate failure"));

    const manager = new ImportManager(
      storage as never,
      pathService as never,
      platformService as never,
      archiveService as never,
      rommService as never
    );

    await manager.processImport("dl-1", "/remote/path");

    expect(storage.updateGameDownloadStatus).toHaveBeenCalledWith("dl-1", "unpacking");
    expect(storage.updateGameDownloadStatus).toHaveBeenCalledWith("dl-1", "error");
  });

  it("throws when confirmImport download is missing", async () => {
    storage.getGameDownload.mockResolvedValue(undefined);
    const manager = new ImportManager(
      storage as never,
      pathService as never,
      platformService as never,
      archiveService as never,
      rommService as never
    );

    await expect(manager.confirmImport("dl-1", { strategy: "pc" } as never)).rejects.toThrow(
      "Download dl-1 not found"
    );
  });

  it("throws when confirmImport is called without a plan", async () => {
    storage.getGameDownload.mockResolvedValue({ id: "dl-1", gameId: "g1" });
    const manager = new ImportManager(
      storage as never,
      pathService as never,
      platformService as never,
      archiveService as never,
      rommService as never
    );

    await expect(manager.confirmImport("dl-1")).rejects.toThrow("Confirmation requires a plan");
  });

  it("blocks confirmImport when proposed path is outside library root", async () => {
    storage.getGameDownload.mockResolvedValue({ id: "dl-1", gameId: "g1", downloaderId: "d1" });
    storage.getGame.mockResolvedValue({
      id: "g1",
      title: "Game",
      userId: "u1",
      status: "wanted",
      platforms: [6],
    });
    storage.getImportConfig.mockResolvedValue({ ...baseConfig, libraryRoot: "/safe/root" });

    const manager = new ImportManager(
      storage as never,
      pathService as never,
      platformService as never,
      archiveService as never,
      rommService as never
    );

    await expect(
      manager.confirmImport("dl-1", {
        strategy: "pc",
        originalPath: "/src/game",
        proposedPath: "/other/root/game",
        needsReview: false,
      })
    ).rejects.toThrow("Proposed path is outside configured library root");
  });

  it("executes confirmImport for pc strategy and updates statuses", async () => {
    storage.getGameDownload.mockResolvedValue({ id: "dl-1", gameId: "g1", downloaderId: "d1" });
    storage.getGame.mockResolvedValue({
      id: "g1",
      title: "My Game",
      userId: "u1",
      status: "wanted",
      platforms: [6],
    });
    storage.getImportConfig.mockResolvedValue({ ...baseConfig, libraryRoot: "/safe/root" });

    const manager = new ImportManager(
      storage as never,
      pathService as never,
      platformService as never,
      archiveService as never,
      rommService as never
    );

    await manager.confirmImport("dl-1", {
      strategy: "pc",
      originalPath: "/downloads/source-folder",
      proposedPath: "/safe/root/PC/My Game",
      needsReview: false,
      deleteSource: false,
    });

    expect(fsMock.ensureDir).toHaveBeenCalled();
    expect(fsMock.move).toHaveBeenCalledWith("/downloads/source-folder", "/safe/root/PC/My Game", {
      overwrite: true,
    });
    expect(storage.updateGameDownloadStatus).toHaveBeenCalledWith("dl-1", "imported");
    expect(storage.updateGameStatus).toHaveBeenCalledWith("g1", { status: "owned" });
  });
});
