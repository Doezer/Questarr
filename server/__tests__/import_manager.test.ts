import { beforeEach, describe, expect, it, vi } from "vitest";

const { fsMock } = vi.hoisted(() => ({
  fsMock: {
    ensureDir: vi.fn().mockResolvedValue(undefined),
    move: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    pathExists: vi.fn().mockResolvedValue(true),
    stat: vi.fn().mockResolvedValue({ isDirectory: () => false }),
    readdir: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("fs-extra", () => ({
  default: fsMock,
}));

import { ImportManager } from "../services/ImportManager.js";
import { RomMImportStrategy } from "../services/ImportStrategies.js";
import { makeImportConfig, makeRommConfig } from "./helpers/import-test-helpers.js";

describe("ImportManager", () => {
  const storage = {
    getGameDownload: vi.fn(),
    getGame: vi.fn(),
    getImportConfig: vi.fn(),
    getRomMConfig: vi.fn(),
    getDownloader: vi.fn(),
    updateGameDownloadStatus: vi.fn(),
    updateGameStatus: vi.fn(),
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

  const baseConfig = makeImportConfig({ overwriteExisting: true });

  beforeEach(() => {
    vi.clearAllMocks();
    fsMock.pathExists.mockResolvedValue(true);
    pathService.translatePath.mockResolvedValue("/data/downloads/file.iso");
    archiveService.isArchive.mockReturnValue(false);
    platformService.getRomMPlatform.mockResolvedValue(null);
    storage.getImportConfig.mockResolvedValue(baseConfig);
    storage.getRomMConfig.mockResolvedValue(
      makeRommConfig({ enabled: false, moveMode: "hardlink" })
    );
  });

  it("returns early when download cannot be found", async () => {
    storage.getGameDownload.mockResolvedValue(undefined);
    const manager = new ImportManager(
      storage as never,
      pathService as never,
      platformService as never,
      archiveService as never
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
      archiveService as never
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
      archiveService as never
    );

    await manager.processImport("dl-1", "/remote/path");

    expect(storage.updateGameDownloadStatus).toHaveBeenCalledWith("dl-1", "completed");
  });

  it("flags manual review when download path is not accessible", async () => {
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
    storage.getDownloader.mockResolvedValue({ id: "d1", name: "qBit", url: "http://qbit:8080" });
    fsMock.pathExists.mockResolvedValue(false);

    const manager = new ImportManager(
      storage as never,
      pathService as never,
      platformService as never,
      archiveService as never
    );

    await manager.processImport("dl-1", "/remote/path");

    expect(storage.updateGameDownloadStatus).toHaveBeenCalledWith("dl-1", "manual_review_required");
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
      archiveService as never
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
      archiveService as never
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
      archiveService as never
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
      archiveService as never
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
      archiveService as never
    );

    await manager.confirmImport("dl-1", {
      strategy: "pc",
      originalPath: "/downloads/source-folder",
      proposedPath: "/safe/root/PC/My Game",
      needsReview: false,
      transferMode: "move",
    });

    expect(fsMock.ensureDir).toHaveBeenCalled();
    expect(fsMock.move).toHaveBeenCalledWith("/downloads/source-folder", "/safe/root/PC/My Game", {
      overwrite: true,
    });
    expect(storage.updateGameDownloadStatus).toHaveBeenCalledWith("dl-1", "imported");
    expect(storage.updateGameStatus).toHaveBeenCalledWith("g1", { status: "owned" });
  });

  it("detects platform from download title before game platform fallback", async () => {
    storage.getGameDownload.mockResolvedValue({
      id: "dl-1",
      gameId: "g1",
      downloaderId: "d1",
      downloadTitle: "Mega.Game.PS2-GROUP",
    });
    storage.getGame.mockResolvedValue({
      id: "g1",
      title: "Mega Game",
      userId: "u1",
      status: "wanted",
      platforms: [6],
    });

    const manager = new ImportManager(
      storage as never,
      pathService as never,
      platformService as never,
      archiveService as never
    );

    await manager.processImport("dl-1", "/remote/path");

    expect(platformService.getRomMPlatform).toHaveBeenCalledWith(8);
  });

  it("marks manual review when RomM is enabled but no slug can be resolved", async () => {
    storage.getGameDownload.mockResolvedValue({
      id: "dl-1",
      gameId: "g1",
      downloaderId: "d1",
      downloadTitle: "Unknown.Platform.Release",
    });
    storage.getGame.mockResolvedValue({
      id: "g1",
      title: "Mystery Game",
      userId: "u1",
      status: "wanted",
      platforms: [9999],
    });
    storage.getRomMConfig.mockResolvedValue(
      makeRommConfig({ url: "http://localhost:8080", moveMode: "hardlink" }) // NOSONAR
    );
    platformService.getRomMPlatform.mockResolvedValue(null);

    const manager = new ImportManager(
      storage as never,
      pathService as never,
      platformService as never,
      archiveService as never
    );

    await manager.processImport("dl-1", "/remote/path");

    expect(storage.updateGameDownloadStatus).toHaveBeenCalledWith("dl-1", "manual_review_required");
  });

  it("marks manual review when resolved RomM slug is not in allowed list", async () => {
    storage.getGameDownload.mockResolvedValue({
      id: "dl-1",
      gameId: "g1",
      downloaderId: "d1",
      downloadTitle: "Mega.Game.SNES-GROUP",
    });
    storage.getGame.mockResolvedValue({
      id: "g1",
      title: "Mega Game",
      userId: "u1",
      status: "wanted",
      platforms: [19],
    });
    storage.getRomMConfig.mockResolvedValue(
      makeRommConfig({ url: "http://localhost:8080", moveMode: "hardlink", allowedSlugs: ["gba"] }) // NOSONAR
    );
    platformService.getRomMPlatform.mockResolvedValue("snes");

    const manager = new ImportManager(
      storage as never,
      pathService as never,
      platformService as never,
      archiveService as never
    );

    await manager.processImport("dl-1", "/remote/path");

    expect(storage.updateGameDownloadStatus).toHaveBeenCalledWith("dl-1", "manual_review_required");
  });

  it("extracts archives before import when autoUnpack is enabled", async () => {
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
    storage.getImportConfig.mockResolvedValue({ ...baseConfig, autoUnpack: true });
    archiveService.isArchive.mockReturnValue(true);
    archiveService.extract.mockResolvedValue(["/data/downloads/file_extracted/game.rom"]);
    pathService.translatePath.mockResolvedValue("/data/downloads/file.zip");

    const manager = new ImportManager(
      storage as never,
      pathService as never,
      platformService as never,
      archiveService as never
    );

    await manager.processImport("dl-1", "/remote/path");

    expect(archiveService.extract).toHaveBeenCalledWith(
      "/data/downloads/file.zip",
      "/data/downloads/file.zip_extracted"
    );
  });

  it("processes RomM happy path end-to-end through manager orchestration", async () => {
    storage.getGameDownload.mockResolvedValue({
      id: "dl-1",
      gameId: "g1",
      downloaderId: "d1",
      downloadTitle: "Mega.Game.SNES-GROUP",
    });
    storage.getGame.mockResolvedValue({
      id: "g1",
      title: "Mega Game",
      userId: "u1",
      status: "wanted",
      platforms: [19],
    });
    storage.getRomMConfig.mockResolvedValue(
      makeRommConfig({ url: "http://localhost:8080", moveMode: "hardlink" }) // NOSONAR
    );
    platformService.getRomMPlatform.mockResolvedValue("snes");

    const planSpy = vi.spyOn(RomMImportStrategy.prototype, "planImport").mockResolvedValue({
      needsReview: false,
      originalPath: "/data/downloads/file.iso",
      proposedPath: "/data/romm/snes/Mega Game",
      strategy: "romm",
    });
    const execSpy = vi.spyOn(RomMImportStrategy.prototype, "executeImport").mockResolvedValue({
      platformSlug: "snes",
      platformDir: "/data/romm/snes",
      destDir: "/data/romm/snes/Mega Game",
      filesPlaced: ["/data/romm/snes/Mega Game/game.rom"],
      modeUsed: "hardlink",
      conflictsResolved: [],
    });

    const manager = new ImportManager(
      storage as never,
      pathService as never,
      platformService as never,
      archiveService as never
    );

    await manager.processImport("dl-1", "/remote/path");

    expect(planSpy).toHaveBeenCalled();
    expect(execSpy).toHaveBeenCalled();
    expect(storage.updateGameDownloadStatus).toHaveBeenCalledWith(
      "dl-1",
      "completed_pending_import"
    );
    expect(storage.updateGameDownloadStatus).toHaveBeenCalledWith("dl-1", "imported");
    expect(storage.updateGameStatus).toHaveBeenCalledWith("g1", { status: "owned" });

    planSpy.mockRestore();
    execSpy.mockRestore();
  });
});
