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
import { makeImportConfig } from "./helpers/import-test-helpers.js";

describe("ImportManager", () => {
  const storage = {
    getGameDownload: vi.fn(),
    getGame: vi.fn(),
    getImportConfig: vi.fn(),
    getDownloader: vi.fn(),
    updateGameDownloadStatus: vi.fn(),
    updateGameStatus: vi.fn(),
  };

  const pathService = {
    translatePath: vi.fn(),
  };

  const platformService = {
    getSourcePlatform: vi.fn(),
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
    storage.getImportConfig.mockResolvedValue(baseConfig);
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

  it("import config libraryRoot is used as the library root for PC imports", async () => {
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
      platforms: [6],
    });
    storage.getImportConfig.mockResolvedValue(makeImportConfig({ libraryRoot: "/games/pc" }));

    const manager = new ImportManager(
      storage as never,
      pathService as never,
      platformService as never,
      archiveService as never
    );

    await manager.processImport("dl-1", "/remote/path");

    expect(fsMock.ensureDir).toHaveBeenCalledWith("/games/pc");
  });

  // ─── confirmImport error paths ───────────────────────────────────────────────

  it("confirmImport: originalPath provided but executeImport throws → sets error and re-throws", async () => {
    storage.getGameDownload.mockResolvedValue({
      id: "dl-1",
      gameId: "g1",
      downloaderId: "d1",
    });
    storage.getGame.mockResolvedValue({
      id: "g1",
      title: "My Game",
      userId: "u1",
      status: "wanted",
      platforms: [6],
    });
    storage.getImportConfig.mockResolvedValue(makeImportConfig({ libraryRoot: "/safe/root" }));

    const { PCImportStrategy } = await import("../services/ImportStrategies.js");
    vi.spyOn(PCImportStrategy.prototype, "executeImport").mockRejectedValue(
      new Error("Source file not found")
    );

    const manager = new ImportManager(
      storage as never,
      pathService as never,
      platformService as never,
      archiveService as never
    );

    await expect(
      manager.confirmImport("dl-1", {
        strategy: "pc",
        originalPath: "/downloads/source-folder",
        proposedPath: "/safe/root/PC/My Game",
        needsReview: false,
        transferMode: "move",
      })
    ).rejects.toThrow("Source file not found");

    expect(storage.updateGameDownloadStatus).toHaveBeenCalledWith("dl-1", "error");
  });

  it("confirmImport: game not found for download → throws with descriptive message", async () => {
    storage.getGameDownload.mockResolvedValue({
      id: "dl-1",
      gameId: "g-missing",
      downloaderId: "d1",
    });
    storage.getGame.mockResolvedValue(undefined);

    const manager = new ImportManager(
      storage as never,
      pathService as never,
      platformService as never,
      archiveService as never
    );

    await expect(
      manager.confirmImport("dl-1", {
        strategy: "pc",
        originalPath: "/downloads/source",
        proposedPath: "/data/PC/My Game",
        needsReview: false,
      })
    ).rejects.toThrow("Game not found for download dl-1");
  });

  // ─── processImport additional paths ─────────────────────────────────────────

  it("processImport: archive extracted but folder empty → import proceeds without crash", async () => {
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
    storage.getImportConfig.mockResolvedValue(makeImportConfig({ autoUnpack: true }));
    archiveService.isArchive.mockReturnValue(true);
    archiveService.extract.mockResolvedValue([]);
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
    expect(storage.updateGameDownloadStatus).toHaveBeenCalled();
  });

  // ─── confirmImport override plan paths ──────────────────────────────────────

  it("confirmImport: overridePlan.originalPath provided → strategy receives the override path", async () => {
    storage.getGameDownload.mockResolvedValue({
      id: "dl-1",
      gameId: "g1",
      downloaderId: "d1",
      downloadTitle: "",
    });
    storage.getGame.mockResolvedValue({
      id: "g1",
      title: "My Game",
      userId: "u1",
      status: "wanted",
      platforms: [6],
    });
    storage.getImportConfig.mockResolvedValue(makeImportConfig({ libraryRoot: "/safe/root" }));
    fsMock.pathExists.mockResolvedValue(true);

    const { PCImportStrategy } = await import("../services/ImportStrategies.js");
    const execSpy = vi.spyOn(PCImportStrategy.prototype, "executeImport").mockResolvedValue({
      destDir: "/safe/root/PC/My Game",
      filesPlaced: ["/safe/root/PC/My Game/game.exe"],
      modeUsed: "move",
      conflictsResolved: [],
    });

    const manager = new ImportManager(
      storage as never,
      pathService as never,
      platformService as never,
      archiveService as never
    );

    await manager.confirmImport("dl-1", {
      strategy: "pc",
      originalPath: "/override/source/path",
      proposedPath: "/safe/root/PC/My Game",
      needsReview: false,
      transferMode: "move",
    });

    expect(execSpy).toHaveBeenCalledWith(
      expect.objectContaining({ originalPath: "/override/source/path" }),
      "move"
    );

    execSpy.mockRestore();
  });

  it("confirmImport: overridePlan.proposedPath provided → strategy receives the override proposedPath", async () => {
    storage.getGameDownload.mockResolvedValue({
      id: "dl-1",
      gameId: "g1",
      downloaderId: "d1",
      downloadTitle: "",
    });
    storage.getGame.mockResolvedValue({
      id: "g1",
      title: "My Game",
      userId: "u1",
      status: "wanted",
      platforms: [6],
    });
    storage.getImportConfig.mockResolvedValue(makeImportConfig({ libraryRoot: "/safe/root" }));

    const { PCImportStrategy } = await import("../services/ImportStrategies.js");
    const execSpy = vi.spyOn(PCImportStrategy.prototype, "executeImport").mockResolvedValue({
      destDir: "/safe/root/PC/Custom Folder",
      filesPlaced: ["/safe/root/PC/Custom Folder/game.exe"],
      modeUsed: "move",
      conflictsResolved: [],
    });

    const manager = new ImportManager(
      storage as never,
      pathService as never,
      platformService as never,
      archiveService as never
    );

    await manager.confirmImport("dl-1", {
      strategy: "pc",
      originalPath: "/downloads/game",
      proposedPath: "/safe/root/PC/Custom Folder",
      needsReview: false,
      transferMode: "move",
    });

    expect(execSpy).toHaveBeenCalledWith(
      expect.objectContaining({ proposedPath: "/safe/root/PC/Custom Folder" }),
      "move"
    );

    execSpy.mockRestore();
  });

  it("confirmImport: overridePlan.unpack = true → archiveService.extract is called", async () => {
    storage.getGameDownload.mockResolvedValue({
      id: "dl-1",
      gameId: "g1",
      downloaderId: "d1",
      downloadTitle: "",
    });
    storage.getGame.mockResolvedValue({
      id: "g1",
      title: "My Game",
      userId: "u1",
      status: "wanted",
      platforms: [6],
    });
    storage.getImportConfig.mockResolvedValue(makeImportConfig({ libraryRoot: "/safe/root" }));
    archiveService.isArchive.mockReturnValue(true);
    archiveService.extract.mockResolvedValue(["/safe/root/PC/My Game/game.exe"]);

    const { PCImportStrategy } = await import("../services/ImportStrategies.js");
    const execSpy = vi.spyOn(PCImportStrategy.prototype, "executeImport").mockResolvedValue({
      destDir: "/safe/root/PC/My Game",
      filesPlaced: ["/safe/root/PC/My Game/game.exe"],
      modeUsed: "move",
      conflictsResolved: [],
    });

    const manager = new ImportManager(
      storage as never,
      pathService as never,
      platformService as never,
      archiveService as never
    );

    await manager.confirmImport("dl-1", {
      strategy: "pc",
      originalPath: "/downloads/game.zip",
      proposedPath: "/safe/root/PC/My Game",
      needsReview: false,
      transferMode: "move",
      unpack: true,
    });

    expect(archiveService.extract).toHaveBeenCalledWith(
      "/downloads/game.zip",
      "/downloads/game.zip_extracted"
    );

    execSpy.mockRestore();
  });

  it("confirmImport: overridePlan.unpack = false → archiveService.extract is NOT called", async () => {
    storage.getGameDownload.mockResolvedValue({
      id: "dl-1",
      gameId: "g1",
      downloaderId: "d1",
      downloadTitle: "",
    });
    storage.getGame.mockResolvedValue({
      id: "g1",
      title: "My Game",
      userId: "u1",
      status: "wanted",
      platforms: [6],
    });
    storage.getImportConfig.mockResolvedValue(makeImportConfig({ libraryRoot: "/safe/root" }));
    archiveService.isArchive.mockReturnValue(true);

    const { PCImportStrategy } = await import("../services/ImportStrategies.js");
    const execSpy = vi.spyOn(PCImportStrategy.prototype, "executeImport").mockResolvedValue({
      destDir: "/safe/root/PC/My Game",
      filesPlaced: ["/safe/root/PC/My Game/game.exe"],
      modeUsed: "move",
      conflictsResolved: [],
    });

    const manager = new ImportManager(
      storage as never,
      pathService as never,
      platformService as never,
      archiveService as never
    );

    await manager.confirmImport("dl-1", {
      strategy: "pc",
      originalPath: "/downloads/game.zip",
      proposedPath: "/safe/root/PC/My Game",
      needsReview: false,
      transferMode: "move",
      unpack: false,
    });

    expect(archiveService.extract).not.toHaveBeenCalled();

    execSpy.mockRestore();
  });

  // ─── extractRemoteHost edge cases (via resolveLocalPath → processImport) ────

  it("extractRemoteHost: URL with port → hostname extracted without port", async () => {
    storage.getGameDownload.mockResolvedValue({
      id: "dl-1",
      gameId: "g1",
      downloaderId: "d1",
      downloadTitle: "",
    });
    storage.getGame.mockResolvedValue({
      id: "g1",
      title: "Game",
      userId: "u1",
      status: "wanted",
      platforms: [6],
    });
    storage.getDownloader.mockResolvedValue({
      id: "d1",
      name: "NAS",
      url: "http://nas.local:8080",
    });

    const manager = new ImportManager(
      storage as never,
      pathService as never,
      platformService as never,
      archiveService as never
    );

    await manager.processImport("dl-1", "/downloads/game.zip");

    expect(pathService.translatePath).toHaveBeenCalledWith("/downloads/game.zip", "nas.local");
  });

  it("extractRemoteHost: malformed URL (no scheme) → falls back gracefully (host is undefined)", async () => {
    storage.getGameDownload.mockResolvedValue({
      id: "dl-1",
      gameId: "g1",
      downloaderId: "d1",
      downloadTitle: "",
    });
    storage.getGame.mockResolvedValue({
      id: "g1",
      title: "Game",
      userId: "u1",
      status: "wanted",
      platforms: [6],
    });
    storage.getDownloader.mockResolvedValue({
      id: "d1",
      name: "NAS",
      url: "nas.local/downloads",
    });

    const manager = new ImportManager(
      storage as never,
      pathService as never,
      platformService as never,
      archiveService as never
    );

    await manager.processImport("dl-1", "/downloads/game.zip");

    expect(pathService.translatePath).toHaveBeenCalledWith("/downloads/game.zip", undefined);
  });

  // ─── processImport: path goes through path mapping ──────────────────────────

  it("processImport: remote path is translated via PathMappingService before strategy receives it", async () => {
    storage.getGameDownload.mockResolvedValue({
      id: "dl-1",
      gameId: "g1",
      downloaderId: "d1",
      downloadTitle: "",
    });
    storage.getGame.mockResolvedValue({
      id: "g1",
      title: "Game",
      userId: "u1",
      status: "wanted",
      platforms: [6],
    });
    storage.getDownloader.mockResolvedValue({
      id: "d1",
      name: "Downloader",
      url: "http://remote:9091",
    });
    pathService.translatePath.mockResolvedValue("/local/downloads/game.zip");

    const { PCImportStrategy } = await import("../services/ImportStrategies.js");
    const planSpy = vi.spyOn(PCImportStrategy.prototype, "planImport").mockResolvedValue({
      needsReview: false,
      originalPath: "/local/downloads/game.zip",
      proposedPath: "/data/PC/Game",
      strategy: "pc",
    });
    const execSpy = vi.spyOn(PCImportStrategy.prototype, "executeImport").mockResolvedValue({
      destDir: "/data/PC/Game",
      filesPlaced: ["/data/PC/Game/game.exe"],
      modeUsed: "move",
      conflictsResolved: [],
    });

    const manager = new ImportManager(
      storage as never,
      pathService as never,
      platformService as never,
      archiveService as never
    );

    await manager.processImport("dl-1", "/remote/downloads/game.zip");

    expect(planSpy).toHaveBeenCalledWith(
      "/local/downloads/game.zip",
      expect.anything(),
      expect.anything(),
      expect.anything()
    );

    planSpy.mockRestore();
    execSpy.mockRestore();
  });

  // ─── processImport: needsReview → manual_review_required ────────────────────

  it("processImport: strategy returns needsReview true → status set to manual_review_required", async () => {
    storage.getGameDownload.mockResolvedValue({
      id: "dl-1",
      gameId: "g1",
      downloaderId: "d1",
      downloadTitle: "",
    });
    storage.getGame.mockResolvedValue({
      id: "g1",
      title: "Game",
      userId: "u1",
      status: "wanted",
      platforms: [6],
    });

    const { PCImportStrategy } = await import("../services/ImportStrategies.js");
    const planSpy = vi.spyOn(PCImportStrategy.prototype, "planImport").mockResolvedValue({
      needsReview: true,
      reviewReason: "Multiple files found, cannot determine primary",
      originalPath: "/data/downloads/file.iso",
      proposedPath: undefined,
      strategy: "pc",
    });

    const manager = new ImportManager(
      storage as never,
      pathService as never,
      platformService as never,
      archiveService as never
    );

    await manager.processImport("dl-1", "/remote/path");

    expect(storage.updateGameDownloadStatus).toHaveBeenCalledWith("dl-1", "manual_review_required");

    planSpy.mockRestore();
  });
});
