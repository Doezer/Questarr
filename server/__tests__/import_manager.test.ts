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

  // ─── getPrimaryPlatformId (via processImport) ───────────────────────────────

  it("getPrimaryPlatformId: platforms undefined → no getRomMPlatform call", async () => {
    storage.getGameDownload.mockResolvedValue({
      id: "dl-1",
      gameId: "g1",
      downloaderId: "d1",
      downloadTitle: "",
    });
    storage.getGame.mockResolvedValue({
      id: "g1",
      title: "No Platform Game",
      userId: "u1",
      status: "wanted",
      platforms: undefined,
    });

    const manager = new ImportManager(
      storage as never,
      pathService as never,
      platformService as never,
      archiveService as never
    );

    await manager.processImport("dl-1", "/remote/path");

    // With no platforms and no download title platform, effectivePlatformId is undefined
    // → getRomMPlatform is never invoked
    expect(platformService.getRomMPlatform).not.toHaveBeenCalled();
  });

  it("getPrimaryPlatformId: empty platforms array → no getRomMPlatform call", async () => {
    storage.getGameDownload.mockResolvedValue({
      id: "dl-1",
      gameId: "g1",
      downloaderId: "d1",
      downloadTitle: "",
    });
    storage.getGame.mockResolvedValue({
      id: "g1",
      title: "No Platform Game",
      userId: "u1",
      status: "wanted",
      platforms: [],
    });

    const manager = new ImportManager(
      storage as never,
      pathService as never,
      platformService as never,
      archiveService as never
    );

    await manager.processImport("dl-1", "/remote/path");

    expect(platformService.getRomMPlatform).not.toHaveBeenCalled();
  });

  it("getPrimaryPlatformId: single valid integer platform id → getRomMPlatform called with it", async () => {
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
      platforms: [42],
    });

    const manager = new ImportManager(
      storage as never,
      pathService as never,
      platformService as never,
      archiveService as never
    );

    await manager.processImport("dl-1", "/remote/path");

    expect(platformService.getRomMPlatform).toHaveBeenCalledWith(42);
  });

  it("getPrimaryPlatformId: string platform id '123' is parsed as number 123", async () => {
    storage.getGameDownload.mockResolvedValue({
      id: "dl-1",
      gameId: "g1",
      downloaderId: "d1",
      downloadTitle: "",
    });
    storage.getGame.mockResolvedValue({
      id: "g1",
      title: "String ID Game",
      userId: "u1",
      status: "wanted",
      platforms: ["123"],
    });

    const manager = new ImportManager(
      storage as never,
      pathService as never,
      platformService as never,
      archiveService as never
    );

    await manager.processImport("dl-1", "/remote/path");

    expect(platformService.getRomMPlatform).toHaveBeenCalledWith(123);
  });

  // ─── getProviderLibraryRoot (via processImport → ensureDir) ─────────────────

  it("getProviderLibraryRoot: romm libraryRoot empty string defaults to /data", async () => {
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
      makeRommConfig({ url: "http://localhost:8080", moveMode: "hardlink", libraryRoot: "" }) // NOSONAR
    );
    platformService.getRomMPlatform.mockResolvedValue("snes");

    const planSpy = vi.spyOn(RomMImportStrategy.prototype, "planImport").mockResolvedValue({
      needsReview: false,
      originalPath: "/data/downloads/file.iso",
      proposedPath: "/data/snes/Mega Game",
      strategy: "romm",
    });
    vi.spyOn(RomMImportStrategy.prototype, "executeImport").mockResolvedValue({
      platformSlug: "snes",
      platformDir: "/data/snes",
      destDir: "/data/snes/Mega Game",
      filesPlaced: ["/data/snes/Mega Game/game.rom"],
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

    // Empty rommRoot → falls back to "/data"; ensureDir should be called with "/data"
    expect(fsMock.ensureDir).toHaveBeenCalledWith("/data");

    planSpy.mockRestore();
  });

  it("getProviderLibraryRoot: import config libraryRoot is returned for pc provider", async () => {
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

  // ─── selectProviderForImport (via processImport) ─────────────────────────────

  it("selectProviderForImport: romm disabled → always selects pc strategy", async () => {
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
    // romm is disabled (default from beforeEach)
    storage.getRomMConfig.mockResolvedValue(makeRommConfig({ enabled: false }));
    platformService.getRomMPlatform.mockResolvedValue("snes");

    const manager = new ImportManager(
      storage as never,
      pathService as never,
      platformService as never,
      archiveService as never
    );

    await manager.processImport("dl-1", "/remote/path");

    // PC strategy: ensureDir with configRoot, not romm root
    expect(fsMock.ensureDir).toHaveBeenCalledWith("/data");
    // Should NOT go to manual_review_required; PC import proceeds
    expect(storage.updateGameDownloadStatus).not.toHaveBeenCalledWith(
      "dl-1",
      "manual_review_required"
    );
  });

  it("selectProviderForImport: platforms empty and romm enabled → manual review (no slug)", async () => {
    storage.getGameDownload.mockResolvedValue({
      id: "dl-1",
      gameId: "g1",
      downloaderId: "d1",
      downloadTitle: "",
    });
    storage.getGame.mockResolvedValue({
      id: "g1",
      title: "No Platform Game",
      userId: "u1",
      status: "wanted",
      platforms: [],
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

  it("selectProviderForImport: platform slug in allowedSlugs → selects romm", async () => {
    storage.getGameDownload.mockResolvedValue({
      id: "dl-1",
      gameId: "g1",
      downloaderId: "d1",
      downloadTitle: "Mega.Game.GBA-GROUP",
    });
    storage.getGame.mockResolvedValue({
      id: "g1",
      title: "Mega Game",
      userId: "u1",
      status: "wanted",
      platforms: [24],
    });
    storage.getRomMConfig.mockResolvedValue(
      makeRommConfig({ url: "http://localhost:8080", moveMode: "hardlink", allowedSlugs: ["gba"] }) // NOSONAR
    );
    platformService.getRomMPlatform.mockResolvedValue("gba");

    const planSpy = vi.spyOn(RomMImportStrategy.prototype, "planImport").mockResolvedValue({
      needsReview: false,
      originalPath: "/data/downloads/file.iso",
      proposedPath: "/data/romm/gba/Mega Game",
      strategy: "romm",
    });
    const execSpy = vi.spyOn(RomMImportStrategy.prototype, "executeImport").mockResolvedValue({
      platformSlug: "gba",
      platformDir: "/data/romm/gba",
      destDir: "/data/romm/gba/Mega Game",
      filesPlaced: ["/data/romm/gba/Mega Game/game.gba"],
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
    expect(storage.updateGameDownloadStatus).toHaveBeenCalledWith("dl-1", "imported");

    planSpy.mockRestore();
    execSpy.mockRestore();
  });

  it("selectProviderForImport: allowedSlugs undefined → routing mode decides (romm selected)", async () => {
    storage.getGameDownload.mockResolvedValue({
      id: "dl-1",
      gameId: "g1",
      downloaderId: "d1",
      downloadTitle: "Mega.Game.GBA-GROUP",
    });
    storage.getGame.mockResolvedValue({
      id: "g1",
      title: "Mega Game",
      userId: "u1",
      status: "wanted",
      platforms: [24],
    });
    // allowedSlugs undefined → all slugs permitted
    storage.getRomMConfig.mockResolvedValue(
      makeRommConfig({
        url: "http://localhost:8080",
        moveMode: "hardlink",
        allowedSlugs: undefined,
      }) // NOSONAR
    );
    platformService.getRomMPlatform.mockResolvedValue("gba");

    const planSpy = vi.spyOn(RomMImportStrategy.prototype, "planImport").mockResolvedValue({
      needsReview: false,
      originalPath: "/data/downloads/file.iso",
      proposedPath: "/data/romm/gba/Mega Game",
      strategy: "romm",
    });
    const execSpy = vi.spyOn(RomMImportStrategy.prototype, "executeImport").mockResolvedValue({
      platformSlug: "gba",
      platformDir: "/data/romm/gba",
      destDir: "/data/romm/gba/Mega Game",
      filesPlaced: ["/data/romm/gba/Mega Game/game.gba"],
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

    // romm was selected because allowedSlugs is empty/undefined → all allowed
    expect(planSpy).toHaveBeenCalled();
    expect(execSpy).toHaveBeenCalled();
    expect(storage.updateGameDownloadStatus).toHaveBeenCalledWith("dl-1", "imported");

    planSpy.mockRestore();
    execSpy.mockRestore();
  });

  // ─── confirmImport error paths ───────────────────────────────────────────────

  it("confirmImport: originalPath provided but file missing → executeImport throws, sets error and re-throws", async () => {
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

    const execSpy = vi.spyOn(RomMImportStrategy.prototype, "executeImport");
    // Simulate executeImport failing because source doesn't exist
    const PCImportStrategy = (await import("../services/ImportStrategies.js")).PCImportStrategy;
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

    execSpy.mockRestore();
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

  it("processImport: downloadTitle null → platform detection falls back to game platforms", async () => {
    storage.getGameDownload.mockResolvedValue({
      id: "dl-1",
      gameId: "g1",
      downloaderId: "d1",
      downloadTitle: null,
    });
    storage.getGame.mockResolvedValue({
      id: "g1",
      title: "Game",
      userId: "u1",
      status: "wanted",
      platforms: [8],
    });

    const manager = new ImportManager(
      storage as never,
      pathService as never,
      platformService as never,
      archiveService as never
    );

    await manager.processImport("dl-1", "/remote/path");

    // null downloadTitle → no release platform detected → game primary platform (8=PS2) used
    expect(platformService.getRomMPlatform).toHaveBeenCalledWith(8);
  });

  it("processImport: archive extracted but folder empty → import proceeds to manual_review or completes", async () => {
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
    // extract succeeds but returns empty list (empty extracted folder)
    archiveService.extract.mockResolvedValue([]);
    pathService.translatePath.mockResolvedValue("/data/downloads/file.zip");

    const manager = new ImportManager(
      storage as never,
      pathService as never,
      platformService as never,
      archiveService as never
    );

    await manager.processImport("dl-1", "/remote/path");

    // extraction was attempted
    expect(archiveService.extract).toHaveBeenCalledWith(
      "/data/downloads/file.zip",
      "/data/downloads/file.zip_extracted"
    );
    // processing continues — no crash; final status is set
    expect(storage.updateGameDownloadStatus).toHaveBeenCalled();
  });

  // ─── confirmImport override plan paths ──────────────────────────────────────

  it("confirmImport: overridePlan.originalPath provided and exists → strategy receives the override path", async () => {
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

    // The override originalPath must be forwarded to the strategy, not resolved via downloader
    expect(execSpy).toHaveBeenCalledWith(
      expect.objectContaining({ originalPath: "/override/source/path" }),
      "move",
      expect.anything()
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
      "move",
      expect.anything()
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

  it("confirmImport: strategy = 'romm' → RomMImportStrategy.executeImport is called, not PCImportStrategy", async () => {
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
    storage.getImportConfig.mockResolvedValue(makeImportConfig({ libraryRoot: "/safe/root" }));
    storage.getRomMConfig.mockResolvedValue(
      makeRommConfig({
        url: "http://localhost:8080",
        moveMode: "hardlink",
        libraryRoot: "/data/romm",
      }) // NOSONAR
    );
    platformService.getRomMPlatform.mockResolvedValue("snes");

    const { PCImportStrategy } = await import("../services/ImportStrategies.js");
    const pcExecSpy = vi.spyOn(PCImportStrategy.prototype, "executeImport");
    const rommExecSpy = vi.spyOn(RomMImportStrategy.prototype, "executeImport").mockResolvedValue({
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

    await manager.confirmImport("dl-1", {
      strategy: "romm",
      originalPath: "/downloads/game.rom",
      proposedPath: "/data/romm/snes/Mega Game",
      needsReview: false,
    });

    expect(rommExecSpy).toHaveBeenCalled();
    expect(pcExecSpy).not.toHaveBeenCalled();

    pcExecSpy.mockRestore();
    rommExecSpy.mockRestore();
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
    // Downloader URL includes a port number
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

    // translatePath must be called with the hostname only (no port)
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
    // Malformed URL — new URL() will throw, so hostname should be undefined
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

    // translatePath called with undefined because URL parsing failed
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
    // PathMappingService maps /remote/downloads → /local/downloads
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

    // Strategy receives the translated local path, not the remote path
    expect(planSpy).toHaveBeenCalledWith(
      "/local/downloads/game.zip",
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything()
    );

    planSpy.mockRestore();
    execSpy.mockRestore();
  });

  // ─── processImport: downloadTitle used for platform detection ───────────────

  it("processImport: downloadTitle platform hint used when game has no platforms", async () => {
    storage.getGameDownload.mockResolvedValue({
      id: "dl-1",
      gameId: "g1",
      downloaderId: "d1",
      downloadTitle: "PS2 - Game Title",
    });
    storage.getGame.mockResolvedValue({
      id: "g1",
      title: "Game Title",
      userId: "u1",
      status: "wanted",
      platforms: [],
    });

    const manager = new ImportManager(
      storage as never,
      pathService as never,
      platformService as never,
      archiveService as never
    );

    await manager.processImport("dl-1", "/remote/path");

    // PS2 IGDB id = 8, extracted from downloadTitle when game has no platforms
    expect(platformService.getRomMPlatform).toHaveBeenCalledWith(8);
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
