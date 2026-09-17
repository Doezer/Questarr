// Integration-style tests for the library-side archive extraction flow
// (ImportManager.resolveArchive / transferWithUnpack), using a real filesystem and a
// real ArchiveService with only `extract`/`isAlreadyExtracted` faked out — CI has no
// 7z/unrar binary available (only the production Docker image installs one; see
// Dockerfile), so real extraction can't run here, but findVolumeSiblings/isArchive are
// pure and safe to exercise for real.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import fs from "fs-extra";
import os from "node:os";
import path from "node:path";
import { ImportManager } from "../services/ImportManager.js";
import { ArchiveService } from "../services/ArchiveService.js";
import { makeGame, makeImportConfig } from "./helpers/import-test-helpers.js";

const cleanup: string[] = [];

function tempDir(): string {
  const dir = path.join(
    os.tmpdir(),
    `questarr-import-archive-${Date.now()}-${randomBytes(8).toString("hex")}`
  );
  cleanup.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of cleanup.splice(0, cleanup.length)) {
    await fs.remove(dir);
  }
  vi.restoreAllMocks();
});

function makeStorage(userId: string, gameTitle: string) {
  return {
    getGameDownload: vi.fn().mockResolvedValue({
      id: "dl-1",
      gameId: "g1",
      downloaderId: "d1",
      downloadTitle: "",
    }),
    getGame: vi
      .fn()
      .mockResolvedValue(makeGame({ id: "g1", userId, title: gameTitle, platforms: [6] })),
    getImportConfig: vi.fn(),
    getDownloader: vi.fn().mockResolvedValue(undefined),
    updateGameDownloadStatus: vi.fn().mockResolvedValue(undefined),
    updateGameStatus: vi.fn().mockResolvedValue(undefined),
    updateGame: vi.fn().mockResolvedValue(undefined),
    addNotification: vi.fn().mockResolvedValue(undefined),
  };
}

const pathService = { translatePath: vi.fn(async (p: string) => p) };
const platformService = {};

// Simulates extraction by writing a fixed set of files into outputDir, mirroring what
// a real archive tool would leave behind — without needing one installed.
function fakeExtractInto(files: Record<string, string>) {
  return async (_archivePath: string, outputDir: string): Promise<string[]> => {
    const written: string[] = [];
    for (const [rel, content] of Object.entries(files)) {
      const dest = path.join(outputDir, rel);
      await fs.ensureDir(path.dirname(dest));
      await fs.writeFile(dest, content);
      written.push(dest);
    }
    return written;
  };
}

describe("ImportManager archive extraction (library-side)", () => {
  let libraryRoot: string;
  let downloadsRoot: string;

  beforeEach(() => {
    libraryRoot = tempDir();
    downloadsRoot = tempDir();
  });

  it("move mode: relocates a multi-volume RAR set into the library and extracts it there, leaving nothing behind", async () => {
    const sourceDir = path.join(downloadsRoot, "Game-Release");
    await fs.ensureDir(sourceDir);
    await fs.writeFile(path.join(sourceDir, "game.part1.rar"), "part1-bytes");
    await fs.writeFile(path.join(sourceDir, "game.part2.rar"), "part2-bytes");
    await fs.writeFile(path.join(sourceDir, "readme.nfo"), "release notes");

    const archiveService = new ArchiveService();
    const extractSpy = vi
      .spyOn(archiveService, "extract")
      .mockImplementation(fakeExtractInto({ "game.exe": "exe-bytes" }));
    vi.spyOn(archiveService, "isAlreadyExtracted").mockResolvedValue(false);

    const storage = makeStorage("u1", "My Game");
    storage.getImportConfig.mockResolvedValue(
      makeImportConfig({
        autoUnpack: true,
        transferMode: "move",
        libraryRoot,
        overwriteExisting: true,
      })
    );

    const manager = new ImportManager(
      storage as never, // NOSONAR
      pathService as never, // NOSONAR
      platformService as never, // NOSONAR
      archiveService
    );

    await manager.processImport("dl-1", sourceDir);

    const destDir = path.join(libraryRoot, "PC", "My Game");
    expect(await fs.pathExists(path.join(destDir, "game.exe"))).toBe(true);
    expect(await fs.pathExists(path.join(destDir, "readme.nfo"))).toBe(true);
    // Neither RAR volume survives: both were relocated into the library then deleted
    // once extraction succeeded, and the emptied source directory is gone too.
    expect(await fs.pathExists(path.join(destDir, "game.part1.rar"))).toBe(false);
    expect(await fs.pathExists(path.join(destDir, "game.part2.rar"))).toBe(false);
    expect(await fs.pathExists(sourceDir)).toBe(false);
    // Extraction ran against the volumes after they landed in the library, not in the
    // downloader's own directory.
    expect(extractSpy).toHaveBeenCalledWith(
      path.join(destDir, "game.part1.rar"),
      destDir,
      undefined
    );
    expect(storage.updateGameDownloadStatus).toHaveBeenCalledWith("dl-1", "imported");
  });

  it("hardlink mode: extracts straight from the source archive to the destination and hardlinks the remaining loose file", async () => {
    const sourceDir = path.join(downloadsRoot, "Game-Release");
    await fs.ensureDir(sourceDir);
    const archivePath = path.join(sourceDir, "game.zip");
    const looseFile = path.join(sourceDir, "manual.pdf");
    await fs.writeFile(archivePath, "zip-bytes");
    await fs.writeFile(looseFile, "pdf-bytes");

    const archiveService = new ArchiveService();
    const extractSpy = vi
      .spyOn(archiveService, "extract")
      .mockImplementation(fakeExtractInto({ "game.exe": "exe-bytes" }));
    vi.spyOn(archiveService, "isAlreadyExtracted").mockResolvedValue(false);

    const storage = makeStorage("u1", "My Game");
    storage.getImportConfig.mockResolvedValue(
      makeImportConfig({
        autoUnpack: true,
        transferMode: "hardlink",
        libraryRoot,
        overwriteExisting: true,
      })
    );

    const manager = new ImportManager(
      storage as never, // NOSONAR
      pathService as never, // NOSONAR
      platformService as never, // NOSONAR
      archiveService
    );

    await manager.processImport("dl-1", sourceDir);

    const destDir = path.join(libraryRoot, "PC", "My Game");
    // Extraction read directly from the archive's original downloader-side path — the
    // raw archive was never relocated.
    expect(extractSpy).toHaveBeenCalledWith(archivePath, destDir, undefined);
    expect(await fs.pathExists(archivePath)).toBe(true);
    expect(await fs.pathExists(path.join(destDir, "game.exe"))).toBe(true);

    // The remaining loose file (not part of the archive/its volumes) is hardlinked in,
    // not extracted or copied.
    const looseSource = await fs.stat(looseFile);
    const looseDest = await fs.stat(path.join(destDir, "manual.pdf"));
    expect(looseDest.ino).toBe(looseSource.ino);
    expect(looseDest.dev).toBe(looseSource.dev);
  });

  it("skips extraction and excludes the archive when the downloader already extracted it", async () => {
    const sourceDir = path.join(downloadsRoot, "Game-Release");
    await fs.ensureDir(sourceDir);
    const archivePath = path.join(sourceDir, "game.zip");
    await fs.writeFile(archivePath, "zip-bytes");
    await fs.writeFile(path.join(sourceDir, "game.exe"), "exe-bytes");

    const archiveService = new ArchiveService();
    const extractSpy = vi.spyOn(archiveService, "extract");
    vi.spyOn(archiveService, "isAlreadyExtracted").mockResolvedValue(true);

    const storage = makeStorage("u1", "My Game");
    storage.getImportConfig.mockResolvedValue(
      makeImportConfig({
        autoUnpack: true,
        transferMode: "move",
        libraryRoot,
        overwriteExisting: true,
      })
    );

    const manager = new ImportManager(
      storage as never, // NOSONAR
      pathService as never, // NOSONAR
      platformService as never, // NOSONAR
      archiveService
    );

    await manager.processImport("dl-1", sourceDir);

    const destDir = path.join(libraryRoot, "PC", "My Game");
    expect(extractSpy).not.toHaveBeenCalled();
    expect(await fs.pathExists(path.join(destDir, "game.exe"))).toBe(true);
    // The redundant archive is excluded from transfer and never lands in the library —
    // it's discarded along with the rest of the now-emptied source directory.
    expect(await fs.pathExists(path.join(destDir, "game.zip"))).toBe(false);
    expect(await fs.pathExists(sourceDir)).toBe(false);
  });

  it("reorganizes extracted files by category in place when sortExtras is enabled", async () => {
    const sourcePath = path.join(downloadsRoot, "game.zip");
    await fs.ensureDir(downloadsRoot);
    await fs.writeFile(sourcePath, "zip-bytes");

    const archiveService = new ArchiveService();
    vi.spyOn(archiveService, "extract").mockImplementation(
      fakeExtractInto({
        "game.exe": "exe-bytes",
        "Game Update v1.nsp": "update-bytes",
      })
    );

    const storage = makeStorage("u1", "My Game");
    storage.getImportConfig.mockResolvedValue(
      makeImportConfig({
        autoUnpack: true,
        transferMode: "move",
        libraryRoot,
        overwriteExisting: true,
        sortExtras: true,
      })
    );

    const manager = new ImportManager(
      storage as never, // NOSONAR
      pathService as never, // NOSONAR
      platformService as never, // NOSONAR
      archiveService
    );

    await manager.processImport("dl-1", sourcePath);

    const destDir = path.join(libraryRoot, "PC", "My Game");
    expect(await fs.pathExists(path.join(destDir, "game.exe"))).toBe(true);
    expect(await fs.pathExists(path.join(destDir, "update", "Game Update v1.nsp"))).toBe(true);
    expect(await fs.pathExists(path.join(destDir, "Game Update v1.nsp"))).toBe(false);
  });

  it("leaves the raw archive stranded and notifies when extraction fails after a copy", async () => {
    const sourcePath = path.join(downloadsRoot, "game.zip");
    await fs.ensureDir(downloadsRoot);
    await fs.writeFile(sourcePath, "zip-bytes");

    const archiveService = new ArchiveService();
    vi.spyOn(archiveService, "extract").mockRejectedValue(new Error("corrupt archive"));

    const storage = makeStorage("u1", "My Game");
    storage.getImportConfig.mockResolvedValue(
      makeImportConfig({
        autoUnpack: true,
        transferMode: "copy",
        libraryRoot,
        overwriteExisting: true,
      })
    );

    const manager = new ImportManager(
      storage as never, // NOSONAR
      pathService as never, // NOSONAR
      platformService as never, // NOSONAR
      archiveService
    );

    await manager.processImport("dl-1", sourcePath);

    const destDir = path.join(libraryRoot, "PC", "My Game");
    // The archive was copied into the library before extraction was attempted, and is
    // deliberately left there (not cleaned up) once extraction fails.
    expect(await fs.pathExists(path.join(destDir, "game.zip"))).toBe(true);
    expect(await fs.pathExists(sourcePath)).toBe(true);
    expect(storage.addNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: "error", title: "Import extraction failed" })
    );
    expect(storage.updateGameDownloadStatus).toHaveBeenCalledWith(
      "dl-1",
      "manual_review_required",
      expect.stringContaining("corrupt archive")
    );
  });
});
