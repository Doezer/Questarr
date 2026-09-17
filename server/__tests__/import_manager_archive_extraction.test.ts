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
import type { ImportConfig } from "../../shared/schema.js";

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

function makeStorage() {
  return {
    getGameDownload: vi.fn().mockResolvedValue({
      id: "dl-1",
      gameId: "g1",
      downloaderId: "d1",
      downloadTitle: "",
    }),
    getGame: vi
      .fn()
      .mockResolvedValue(makeGame({ id: "g1", userId: "u1", title: "My Game", platforms: [6] })),
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

function createManager(
  archiveService: ArchiveService,
  storage: ReturnType<typeof makeStorage>,
  configOverrides: Partial<ImportConfig>
): ImportManager {
  storage.getImportConfig.mockResolvedValue(
    makeImportConfig({ autoUnpack: true, overwriteExisting: true, ...configOverrides })
  );
  return new ImportManager(
    storage as never, // NOSONAR
    pathService as never, // NOSONAR
    platformService as never, // NOSONAR
    archiveService
  );
}

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

// A real ArchiveService with only `extract`/`isAlreadyExtracted` faked out (see the
// file-level comment on why: no 7z/unrar binary in CI). `extractResult` is the fake
// extracted-file set on success, or an Error to reject with; `alreadyExtracted`
// defaults to false since most tests are exercising the extraction path itself.
function makeArchiveService(options: {
  extractResult?: Record<string, string> | Error;
  alreadyExtracted?: boolean;
}) {
  const archiveService = new ArchiveService();
  const extractSpy = vi.spyOn(archiveService, "extract");
  if (options.extractResult instanceof Error) {
    extractSpy.mockRejectedValue(options.extractResult);
  } else if (options.extractResult) {
    extractSpy.mockImplementation(fakeExtractInto(options.extractResult));
  }
  vi.spyOn(archiveService, "isAlreadyExtracted").mockResolvedValue(
    options.alreadyExtracted ?? false
  );
  return { archiveService, extractSpy };
}

describe("ImportManager archive extraction (library-side)", () => {
  let libraryRoot: string;
  let downloadsRoot: string;

  beforeEach(() => {
    libraryRoot = tempDir();
    downloadsRoot = tempDir();
  });

  // Shared by the move-mode directory-source tests below: writes `files` into a fresh
  // source directory, runs processImport against it, and hands back everything an
  // individual test needs to assert against.
  async function importDirectorySource(
    files: Record<string, string>,
    archiveServiceOptions: Parameters<typeof makeArchiveService>[0],
    configOverrides: Partial<ImportConfig> = {}
  ) {
    const sourceDir = path.join(downloadsRoot, "Game-Release");
    await fs.ensureDir(sourceDir);
    for (const [name, content] of Object.entries(files)) {
      await fs.writeFile(path.join(sourceDir, name), content);
    }

    const { archiveService, extractSpy } = makeArchiveService(archiveServiceOptions);
    const storage = makeStorage();
    const manager = createManager(archiveService, storage, {
      transferMode: "move",
      libraryRoot,
      ...configOverrides,
    });

    await manager.processImport("dl-1", sourceDir);

    return {
      sourceDir,
      destDir: path.join(libraryRoot, "PC", "My Game"),
      archiveService,
      extractSpy,
      storage,
      manager,
    };
  }

  it("move mode: relocates a multi-volume RAR set into the library and extracts it there, leaving nothing behind", async () => {
    const { sourceDir, destDir, extractSpy, storage } = await importDirectorySource(
      {
        "game.part1.rar": "part1-bytes",
        "game.part2.rar": "part2-bytes",
        "readme.nfo": "release notes",
      },
      { extractResult: { "game.exe": "exe-bytes" } }
    );

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

  it("move mode: keeps other source files out of destDir until after extraction, so extract()'s own cleanup can't delete them", async () => {
    // Regression test: relocateArchiveToDest used to relocate the WHOLE source
    // directory (archive + any other loose files, like a readme) into destDir before
    // calling extract(). extract()'s own in-place cleanup then deletes anything in
    // destDir it doesn't recognize as part of the archive's volume family — in move
    // mode, with the source already emptied, that permanently destroyed those loose
    // files. Only the archive family should be relocated before extraction; other
    // files get transferred afterward.
    const sourceDir = path.join(downloadsRoot, "Game-Release");
    await fs.ensureDir(sourceDir);
    await fs.writeFile(path.join(sourceDir, "game.zip"), "zip-bytes");
    await fs.writeFile(path.join(sourceDir, "readme.nfo"), "release notes");

    const archiveService = new ArchiveService();
    const extractSpy = vi
      .spyOn(archiveService, "extract")
      .mockImplementation(async (_p, outputDir) => {
        // At the moment extraction runs, destDir must contain only the archive itself —
        // readme.nfo must still be sitting untouched in the source directory.
        expect(await fs.readdir(outputDir as string)).toEqual(["game.zip"]);
        const dest = path.join(outputDir as string, "game.exe");
        await fs.writeFile(dest, "exe-bytes");
        return [dest];
      });
    vi.spyOn(archiveService, "isAlreadyExtracted").mockResolvedValue(false);

    const storage = makeStorage();
    const manager = createManager(archiveService, storage, { transferMode: "move", libraryRoot });

    await manager.processImport("dl-1", sourceDir);

    const destDir = path.join(libraryRoot, "PC", "My Game");
    expect(extractSpy).toHaveBeenCalled();
    expect(await fs.pathExists(path.join(destDir, "game.exe"))).toBe(true);
    expect(await fs.pathExists(path.join(destDir, "readme.nfo"))).toBe(true);
  });

  it("move mode: picks the primary .rar volume over .rNN continuations as the extraction entry point", async () => {
    // Regression test: a plain lexicographic sort puts "game.r00" before "game.rar"
    // ('0' < 'a'), which would hand 7-Zip/unrar the continuation volume instead of the
    // primary one as the extraction entry point.
    const { destDir, extractSpy } = await importDirectorySource(
      { "game.r00": "r00-bytes", "game.rar": "rar-bytes" },
      { extractResult: { "game.exe": "exe-bytes" } }
    );

    expect(extractSpy).toHaveBeenCalledWith(path.join(destDir, "game.rar"), destDir, undefined);
  });

  it("move mode: does not let an unrelated .rar jump ahead of a correctly-ordered 7z set", async () => {
    // Regression test: the .rar-promotion fix above must only fire when the current
    // first entry is actually one of ITS OWN continuations — otherwise an unrelated
    // .rar belonging to a second, independent archive set could jump the queue.
    const { destDir, extractSpy } = await importDirectorySource(
      { "A.7z.001": "a1-bytes", "A.7z.002": "a2-bytes", "B.rar": "b-bytes" },
      { extractResult: { "game.exe": "exe-bytes" } }
    );

    expect(extractSpy).toHaveBeenCalledWith(path.join(destDir, "A.7z.001"), destDir, undefined);
  });

  it("does not mis-categorize the archive itself into a sortExtras subfolder before extraction", async () => {
    // Regression test: planImport pre-categorizes a directory source's files (including
    // the archive) when sortExtras is enabled. For an archive still pending extraction,
    // that would relocate it to e.g. destDir/update/game.zip while extract() is called
    // expecting it flat at destDir/game.zip, failing extraction outright.
    const { destDir, extractSpy, storage } = await importDirectorySource(
      { "Game Update v1.zip": "zip-bytes" },
      { extractResult: { "game.exe": "exe-bytes" } },
      { sortExtras: true }
    );

    expect(extractSpy).toHaveBeenCalledWith(
      path.join(destDir, "Game Update v1.zip"),
      destDir,
      undefined
    );
    expect(await fs.pathExists(path.join(destDir, "game.exe"))).toBe(true);
    expect(storage.updateGameDownloadStatus).toHaveBeenCalledWith("dl-1", "imported");
  });

  it("hardlink mode: extracts straight from the source archive to the destination and hardlinks the remaining loose file", async () => {
    const sourceDir = path.join(downloadsRoot, "Game-Release");
    await fs.ensureDir(sourceDir);
    const archivePath = path.join(sourceDir, "game.zip");
    const looseFile = path.join(sourceDir, "manual.pdf");
    await fs.writeFile(archivePath, "zip-bytes");
    await fs.writeFile(looseFile, "pdf-bytes");

    const { archiveService, extractSpy } = makeArchiveService({
      extractResult: { "game.exe": "exe-bytes" },
    });

    const storage = makeStorage();
    const manager = createManager(archiveService, storage, {
      transferMode: "hardlink",
      libraryRoot,
    });

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

  it("hardlink mode: categorizes the remaining loose file too, not just the extracted contents", async () => {
    // Regression test: reorganizeBySortExtras used to run before the remaining loose
    // file was transferred in, so it never saw that file and left it sitting
    // uncategorized at destDir's root.
    const sourceDir = path.join(downloadsRoot, "Game-Release");
    await fs.ensureDir(sourceDir);
    await fs.writeFile(path.join(sourceDir, "game.zip"), "zip-bytes");
    await fs.writeFile(path.join(sourceDir, "Game Update v1.nsp"), "update-bytes");

    const { archiveService } = makeArchiveService({
      extractResult: { "game.exe": "exe-bytes" },
    });

    const storage = makeStorage();
    const manager = createManager(archiveService, storage, {
      transferMode: "hardlink",
      libraryRoot,
      sortExtras: true,
    });

    await manager.processImport("dl-1", sourceDir);

    const destDir = path.join(libraryRoot, "PC", "My Game");
    expect(await fs.pathExists(path.join(destDir, "update", "Game Update v1.nsp"))).toBe(true);
    expect(await fs.pathExists(path.join(destDir, "Game Update v1.nsp"))).toBe(false);
  });

  it("skips extraction and excludes the archive when the downloader already extracted it", async () => {
    const { sourceDir, destDir, extractSpy } = await importDirectorySource(
      { "game.zip": "zip-bytes", "game.exe": "exe-bytes" },
      { alreadyExtracted: true }
    );

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

    const { archiveService } = makeArchiveService({
      extractResult: { "game.exe": "exe-bytes", "Game Update v1.nsp": "update-bytes" },
    });

    const storage = makeStorage();
    const manager = createManager(archiveService, storage, {
      transferMode: "move",
      libraryRoot,
      sortExtras: true,
    });

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

    const { archiveService } = makeArchiveService({ extractResult: new Error("corrupt archive") });

    const storage = makeStorage();
    const manager = createManager(archiveService, storage, { transferMode: "copy", libraryRoot });

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
