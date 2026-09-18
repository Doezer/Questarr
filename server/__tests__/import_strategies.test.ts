import { afterEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import fs from "fs-extra";
import os from "node:os";
import path from "node:path";
import {
  PCImportStrategy,
  reorganizeBySortExtras,
  gatherFiles,
} from "../services/ImportStrategies.js";
import { makeGame, makeImportConfig } from "./helpers/import-test-helpers.js";

const cleanup: string[] = [];

function tempDir(): string {
  const dir = path.join(
    os.tmpdir(),
    `questarr-import-${Date.now()}-${randomBytes(8).toString("hex")}`
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

describe("ImportStrategies", () => {
  it.each(["EXDEV", "EPERM", "EACCES", "ENOTSUP", "EOPNOTSUPP"])(
    "falls back to copy when hardlink fails with %s",
    async (code) => {
      const root = tempDir();
      const source = path.join(root, "downloads", "cross-device.rom");
      const destination = path.join(root, "library", "PC", "cross-device.rom");
      await fs.ensureDir(path.dirname(source));
      await fs.writeFile(source, "rom-bytes");

      const linkSpy = vi.spyOn(fs, "link").mockRejectedValueOnce({ code } as NodeJS.ErrnoException);
      const copySpy = vi.spyOn(fs, "copy");

      const strategy = new PCImportStrategy();
      const result = await strategy.executeImport(
        {
          needsReview: false,
          originalPath: source,
          proposedPath: destination,
          strategy: "pc",
        },
        "hardlink"
      );

      expect(result.modeUsed).toBe("copy");
      expect(copySpy).toHaveBeenCalled();
      expect(await fs.pathExists(destination)).toBe(true);
    }
  );

  // ---------------------------------------------------------------------------
  // PCImportStrategy.executeImport() — single file vs directory source
  // ---------------------------------------------------------------------------

  describe("PCImportStrategy.executeImport()", () => {
    it("source is a single FILE: filesPlaced contains exactly that file path", async () => {
      const root = tempDir();
      const source = path.join(root, "downloads", "single-game.exe");
      const destination = path.join(root, "library", "PC", "single-game.exe");
      await fs.ensureDir(path.dirname(source));
      await fs.writeFile(source, "exe-bytes");

      const strategy = new PCImportStrategy();
      const result = await strategy.executeImport(
        {
          needsReview: false,
          originalPath: source,
          proposedPath: destination,
          strategy: "pc",
        },
        "copy"
      );

      expect(result.filesPlaced).toHaveLength(1);
      expect(result.filesPlaced[0]).toBe(destination);
    });

    it("source is a DIRECTORY: filesPlaced contains all files inside destination", async () => {
      const root = tempDir();
      const sourceDir = path.join(root, "downloads", "game-folder");
      const destination = path.join(root, "library", "PC", "game-folder");
      await fs.ensureDir(sourceDir);
      await fs.writeFile(path.join(sourceDir, "game.exe"), "exe-bytes");
      await fs.writeFile(path.join(sourceDir, "data.pak"), "pak-bytes");

      const strategy = new PCImportStrategy();
      const result = await strategy.executeImport(
        {
          needsReview: false,
          originalPath: sourceDir,
          proposedPath: destination,
          strategy: "pc",
        },
        "copy"
      );

      expect(result.filesPlaced.length).toBe(2);
      expect(result.filesPlaced.some((p) => p.endsWith("game.exe"))).toBe(true);
      expect(result.filesPlaced.some((p) => p.endsWith("data.pak"))).toBe(true);
    });

    it("source is a DIRECTORY: hardlink mode links every file instead of falling back to copy", async () => {
      // Regression test for a directory-wide hardlink attempt: fs.link()
      // always rejects a directory with EPERM on Linux, so the multi-file
      // (no sortExtras) path used to hand the whole source folder to
      // fs.link() and silently fall back to a full copy every time. Each
      // file inside the directory should now be its own hardlink, matching
      // what `cp -al` does on the CLI.
      const root = tempDir();
      const sourceDir = path.join(root, "downloads", "game-folder");
      const destination = path.join(root, "library", "PC", "game-folder");
      await fs.ensureDir(path.join(sourceDir, "nested"));
      await fs.writeFile(path.join(sourceDir, "game.exe"), "exe-bytes");
      await fs.writeFile(path.join(sourceDir, "nested", "data.pak"), "pak-bytes");

      const strategy = new PCImportStrategy();
      const result = await strategy.executeImport(
        {
          needsReview: false,
          originalPath: sourceDir,
          proposedPath: destination,
          strategy: "pc",
        },
        "hardlink"
      );

      expect(result.modeUsed).toBe("hardlink");

      const exeSource = await fs.stat(path.join(sourceDir, "game.exe"));
      const exeDest = await fs.stat(path.join(destination, "game.exe"));
      expect(exeDest.ino).toBe(exeSource.ino);
      expect(exeDest.dev).toBe(exeSource.dev);

      const pakSource = await fs.stat(path.join(sourceDir, "nested", "data.pak"));
      const pakDest = await fs.stat(path.join(destination, "nested", "data.pak"));
      expect(pakDest.ino).toBe(pakSource.ino);
      expect(pakDest.dev).toBe(pakSource.dev);
    });

    it("refuses a directory hardlink when the destination is nested inside the source", async () => {
      // Regression test: withHardlinkFallback removes an existing destination before
      // linking. If destination were inside source, that removal would delete source
      // (and anything else under it) before the hardlink was even attempted.
      const root = tempDir();
      const sourceDir = path.join(root, "downloads", "game-folder");
      const destination = path.join(sourceDir, "nested", "game-folder");
      await fs.ensureDir(sourceDir);
      await fs.writeFile(path.join(sourceDir, "game.exe"), "exe-bytes");

      const strategy = new PCImportStrategy();
      await expect(
        strategy.executeImport(
          {
            needsReview: false,
            originalPath: sourceDir,
            proposedPath: destination,
            strategy: "pc",
          },
          "hardlink"
        )
      ).rejects.toThrow("must not overlap for a hardlink transfer");

      // Source survives untouched.
      expect(await fs.pathExists(path.join(sourceDir, "game.exe"))).toBe(true);
    });

    it("refuses a directory hardlink when the source is nested inside the destination", async () => {
      // Regression test: hardlinkTree's own ensureDir(destination) plus its walk of
      // source would otherwise recurse into the very directory it just created.
      const root = tempDir();
      const destination = path.join(root, "library", "PC", "My Game");
      const sourceDir = path.join(destination, "nested", "game-folder");
      await fs.ensureDir(sourceDir);
      await fs.writeFile(path.join(sourceDir, "game.exe"), "exe-bytes");

      const strategy = new PCImportStrategy();
      await expect(
        strategy.executeImport(
          {
            needsReview: false,
            originalPath: sourceDir,
            proposedPath: destination,
            strategy: "pc",
          },
          "hardlink"
        )
      ).rejects.toThrow("must not overlap for a hardlink transfer");
    });

    it("sorts detected add-on files while preserving main and existing category paths", async () => {
      const root = tempDir();
      const sourceDir = path.join(root, "downloads", "game-folder");
      const destination = path.join(root, "library", "PC", "My Game");
      await fs.ensureDir(path.join(sourceDir, "dlc"));
      await fs.ensureDir(path.join(sourceDir, "update"));
      await fs.writeFile(path.join(sourceDir, "base.nsp"), "base");
      await fs.writeFile(path.join(sourceDir, "Game Update v1.nsp"), "update");
      await fs.writeFile(path.join(sourceDir, "Game Expansion Pack.nsp"), "dlc");
      await fs.writeFile(path.join(sourceDir, "Game OST.zip"), "extra");
      await fs.writeFile(path.join(sourceDir, "dlc", "Game DLC Pack.nsp"), "nested-dlc");
      await fs.writeFile(path.join(sourceDir, "update", "Game DLC Patch.nsp"), "nested-update");

      const strategy = new PCImportStrategy();
      const plan = await strategy.planImport(
        sourceDir,
        makeGame({ title: "My Game" }),
        path.join(root, "library"),
        makeImportConfig({ sortExtras: true, overwriteExisting: true })
      );
      const result = await strategy.executeImport(plan, "copy");

      expect(result.filesPlaced).toEqual(
        expect.arrayContaining([
          path.join(destination, "base.nsp"),
          path.join(destination, "update", "Game Update v1.nsp"),
          path.join(destination, "dlc", "Game Expansion Pack.nsp"),
          path.join(destination, "extra", "Game OST.zip"),
          path.join(destination, "dlc", "Game DLC Pack.nsp"),
          path.join(destination, "update", "Game DLC Patch.nsp"),
        ])
      );
      expect(await fs.pathExists(path.join(destination, "dlc", "dlc"))).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // PCImportStrategy.executeImport() — transfer failure propagates
  // ---------------------------------------------------------------------------

  describe("PCImportStrategy.executeImport() transfer failure", () => {
    it("propagates error when underlying file transfer throws", async () => {
      const root = tempDir();
      const source = path.join(root, "downloads", "game.exe");
      const destination = path.join(root, "library", "PC", "game.exe");
      await fs.ensureDir(path.dirname(source));
      await fs.writeFile(source, "exe-bytes");

      const copySpy = vi.spyOn(fs, "copy").mockRejectedValueOnce(new Error("write error"));

      const strategy = new PCImportStrategy();
      await expect(
        strategy.executeImport(
          {
            needsReview: false,
            originalPath: source,
            proposedPath: destination,
            strategy: "pc",
          },
          "copy"
        )
      ).rejects.toThrow("write error");
    });
  });

  // ---------------------------------------------------------------------------
  // PCImportStrategy.planImport() — destination conflict detection
  // ---------------------------------------------------------------------------

  describe("PCImportStrategy.planImport()", () => {
    it("needsReview false when destination does not exist", async () => {
      const root = tempDir();
      const source = path.join(root, "downloads", "game.exe");
      await fs.ensureDir(path.dirname(source));
      await fs.writeFile(source, "exe-bytes");

      const strategy = new PCImportStrategy();
      const plan = await strategy.planImport(
        source,
        makeGame({ title: "My Game" }),
        path.join(root, "library"),
        makeImportConfig()
      );

      expect(plan.needsReview).toBe(false);
      expect(plan.strategy).toBe("pc");
      expect(plan.proposedPath).toContain("My Game");
      expect(plan.proposedPath).toMatch(/My Game\.exe$/);
    });

    it("rejects a computed destination that would escape targetRoot", async () => {
      const root = tempDir();
      const source = path.join(root, "downloads", "game.exe");
      await fs.ensureDir(path.dirname(source));
      await fs.writeFile(source, "exe-bytes");

      const strategy = new PCImportStrategy();
      await expect(
        strategy.planImport(
          source,
          makeGame({ title: "My Game" }),
          path.join(root, "library"),
          makeImportConfig(),
          // platformDir is always a fixed, code-controlled value in production
          // (resolvePlatformFolderName's lookup table or "PC"), never user input —
          // this exercises the containment guard as a defensive invariant, the same
          // way sourcePath's traversal would be caught if that ever changed.
          "../../outside"
        )
      ).rejects.toThrow("Computed destination escapes the configured library root");
    });

    it("sanitizeFsName strips path separators, so a title alone can never escape targetRoot", async () => {
      const root = tempDir();
      const source = path.join(root, "downloads", "game.exe");
      await fs.ensureDir(path.dirname(source));
      await fs.writeFile(source, "exe-bytes");

      const strategy = new PCImportStrategy();
      const plan = await strategy.planImport(
        source,
        makeGame({ title: "../../../etc" }),
        path.join(root, "library"),
        makeImportConfig()
      );

      const libraryRoot = path.join(root, "library");
      const relativeToLibrary = path.relative(libraryRoot, plan.proposedPath);
      expect(
        relativeToLibrary === "" ||
          (!relativeToLibrary.startsWith("..") && !path.isAbsolute(relativeToLibrary))
      ).toBe(true);
    });

    it("needsReview true when destination exists and overwriteExisting is false", async () => {
      const root = tempDir();
      const source = path.join(root, "downloads", "game.exe");
      const existing = path.join(root, "library", "PC", "My Game.exe");
      await fs.ensureDir(path.dirname(source));
      await fs.writeFile(source, "exe-bytes");
      await fs.ensureFile(existing);

      const strategy = new PCImportStrategy();
      const plan = await strategy.planImport(
        source,
        makeGame({ title: "My Game" }),
        path.join(root, "library"),
        makeImportConfig({ overwriteExisting: false })
      );

      expect(plan.needsReview).toBe(true);
      expect(plan.reviewReason).toMatch(/Destination already exists/);
    });

    it("rejects duplicate resolved destinations before transferring", async () => {
      const root = tempDir();
      const sourceDir = path.join(root, "downloads", "game-folder");
      const destination = path.join(root, "library", "PC", "My Game");
      await fs.ensureDir(path.join(sourceDir, "dlc"));
      await fs.writeFile(path.join(sourceDir, "Game DLC Pack.nsp"), "root");
      await fs.writeFile(path.join(sourceDir, "dlc", "Game DLC Pack.nsp"), "nested");

      const strategy = new PCImportStrategy();
      await expect(
        strategy.executeImport(
          {
            needsReview: false,
            originalPath: sourceDir,
            proposedPath: destination,
            strategy: "pc",
            fileCategories: [
              { name: "Game DLC Pack.nsp", category: "dlc" },
              { name: path.join("dlc", "Game DLC Pack.nsp"), category: "dlc" },
            ],
          },
          "copy"
        )
      ).rejects.toThrow("Duplicate import destination");
      expect(await fs.pathExists(path.join(destination, "dlc", "Game DLC Pack.nsp"))).toBe(false);
    });

    it("reports the requested batch mode even when a single file falls back", async () => {
      const root = tempDir();
      const sourceDir = path.join(root, "downloads", "game-folder");
      const destination = path.join(root, "library", "PC", "My Game");
      await fs.ensureDir(sourceDir);
      await fs.writeFile(path.join(sourceDir, "game.exe"), "main");
      await fs.writeFile(path.join(sourceDir, "Game DLC Pack.nsp"), "dlc");

      // Only the DLC file's hardlink fails; the base game file hardlinks fine.
      const originalLink = fs.link.bind(fs);
      vi.spyOn(fs, "link").mockImplementation(async (src, dest) => {
        if (String(src).endsWith("Game DLC Pack.nsp")) {
          const err: NodeJS.ErrnoException = new Error("cross-device");
          err.code = "EXDEV";
          throw err;
        }
        return originalLink(src, dest);
      });

      const strategy = new PCImportStrategy();
      const result = await strategy.executeImport(
        {
          needsReview: false,
          originalPath: sourceDir,
          proposedPath: destination,
          strategy: "pc",
          fileCategories: [
            { name: "game.exe", category: "main" },
            { name: "Game DLC Pack.nsp", category: "dlc" },
          ],
        },
        "hardlink"
      );

      // modeUsed reflects the requested batch mode, not just the last file's
      // fallback; the per-file fallback is still visible in conflictsResolved.
      expect(result.modeUsed).toBe("hardlink");
      expect(result.conflictsResolved).toEqual(["Game DLC Pack.nsp (mode fallback: copy)"]);
      expect(await fs.pathExists(path.join(destination, "dlc", "Game DLC Pack.nsp"))).toBe(true);

      // Confirm the base game file is an actual hardlink (same inode), not
      // merely a file that happens to exist at the destination.
      const sourceStat = await fs.stat(path.join(sourceDir, "game.exe"));
      const destStat = await fs.stat(path.join(destination, "game.exe"));
      expect(destStat.ino).toBe(sourceStat.ino);
      expect(destStat.dev).toBe(sourceStat.dev);
    });

    it("preserves the packs parent directory for neutral filenames", async () => {
      const root = tempDir();
      const sourceDir = path.join(root, "downloads", "game-folder");
      const destination = path.join(root, "library", "PC", "My Game");
      await fs.ensureDir(path.join(sourceDir, "packs"));
      await fs.writeFile(path.join(sourceDir, "packs", "content.bin"), "pack");

      const strategy = new PCImportStrategy();
      const plan = await strategy.planImport(
        sourceDir,
        makeGame({ title: "My Game" }),
        path.join(root, "library"),
        makeImportConfig({ sortExtras: true, overwriteExisting: true })
      );
      const result = await strategy.executeImport(plan, "copy");

      expect(result.filesPlaced).toContain(path.join(destination, "packs", "content.bin"));
    });

    it("keeps the existing flat destination for a single file when sorting is enabled", async () => {
      const root = tempDir();
      const source = path.join(root, "downloads", "game.exe");
      await fs.ensureDir(path.dirname(source));
      await fs.writeFile(source, "exe-bytes");

      const strategy = new PCImportStrategy();
      const plan = await strategy.planImport(
        source,
        makeGame({ title: "My Game" }),
        path.join(root, "library"),
        makeImportConfig({ sortExtras: true })
      );

      expect(plan.proposedPath).toMatch(/My Game\.exe$/);
      expect(plan.fileCategories).toBeUndefined();
    });

    it("treatAsDirectory strips the extension even for a single-file source", async () => {
      const root = tempDir();
      const source = path.join(root, "downloads", "game.zip");
      await fs.ensureDir(path.dirname(source));
      await fs.writeFile(source, "zip-bytes");

      const strategy = new PCImportStrategy();
      const plan = await strategy.planImport(
        source,
        makeGame({ title: "My Game" }),
        path.join(root, "library"),
        makeImportConfig(),
        undefined,
        { treatAsDirectory: true }
      );

      expect(plan.proposedPath).toMatch(/My Game$/);
      expect(plan.proposedPath.endsWith(".zip")).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // PCImportStrategy.executeImport() — excludePaths
  // ---------------------------------------------------------------------------

  describe("PCImportStrategy.executeImport() with excludePaths", () => {
    // Shared by every test below: a source directory holding an archive plus whatever
    // extra content the test itself writes, and the destination it'll import into.
    async function makeExcludeFixture(
      extraFiles: Record<string, string> = { "game.rom": "rom-bytes" }
    ) {
      const root = tempDir();
      const sourceDir = path.join(root, "downloads", "release");
      const destination = path.join(root, "library", "PC", "My Game");
      const archivePath = path.join(sourceDir, "game.zip");
      await fs.ensureDir(sourceDir);
      await fs.writeFile(archivePath, "zip-bytes");
      for (const [name, content] of Object.entries(extraFiles)) {
        await fs.writeFile(path.join(sourceDir, name), content);
      }
      return {
        sourceDir,
        destination,
        archivePath,
        excludePaths: new Set([path.resolve(archivePath)]),
      };
    }

    it("skips excluded files during a directory move, but still moves the rest", async () => {
      const { sourceDir, destination, excludePaths } = await makeExcludeFixture();

      const strategy = new PCImportStrategy();
      const result = await strategy.executeImport(
        { needsReview: false, originalPath: sourceDir, proposedPath: destination, strategy: "pc" },
        "move",
        excludePaths
      );

      expect(result.filesPlaced).toEqual([path.join(destination, "game.rom")]);
      expect(await fs.pathExists(path.join(destination, "game.zip"))).toBe(false);
      expect(await fs.pathExists(path.join(destination, "game.rom"))).toBe(true);
      // Excluded files are left behind when the rest of the directory is moved out —
      // the whole source directory (including what wasn't transferred) is removed at
      // the end of a move, same as if nothing had been excluded.
      expect(await fs.pathExists(sourceDir)).toBe(false);
    });

    it("skips excluded files during a directory hardlink", async () => {
      const { sourceDir, destination, archivePath, excludePaths } = await makeExcludeFixture();
      const looseFile = path.join(sourceDir, "game.rom");

      const strategy = new PCImportStrategy();
      const result = await strategy.executeImport(
        { needsReview: false, originalPath: sourceDir, proposedPath: destination, strategy: "pc" },
        "hardlink",
        excludePaths
      );

      expect(result.modeUsed).toBe("hardlink");
      expect(await fs.pathExists(path.join(destination, "game.zip"))).toBe(false);
      const romSource = await fs.stat(looseFile);
      const romDest = await fs.stat(path.join(destination, "game.rom"));
      expect(romDest.ino).toBe(romSource.ino);
      // The excluded archive is untouched at the source — hardlink mode never removes
      // the source directory the way move does.
      expect(await fs.pathExists(archivePath)).toBe(true);
    });

    it("throws when every file in the directory is excluded", async () => {
      const { sourceDir, destination, excludePaths } = await makeExcludeFixture({});

      const strategy = new PCImportStrategy();
      await expect(
        strategy.executeImport(
          {
            needsReview: false,
            originalPath: sourceDir,
            proposedPath: destination,
            strategy: "pc",
          },
          "copy",
          excludePaths
        )
      ).rejects.toThrow("No files to transfer after applying exclusions");
    });

    it("throws when exclusions consume the entire categorized (fileCategories) plan too", async () => {
      // Same regression as "throws when every file in the directory is excluded", but for
      // the categorized branch: isAlreadyExtracted matching doesn't guarantee any
      // category entry survives outside the excluded volume set, so this branch needs
      // the same empty-plan guard rather than silently reporting success.
      const { sourceDir, destination, excludePaths } = await makeExcludeFixture({});

      const strategy = new PCImportStrategy();
      await expect(
        strategy.executeImport(
          {
            needsReview: false,
            originalPath: sourceDir,
            proposedPath: destination,
            strategy: "pc",
            fileCategories: [{ name: "game.zip", category: "main" }],
          },
          "copy",
          excludePaths
        )
      ).rejects.toThrow("No files to transfer after applying exclusions");
    });

    it("refuses to overwrite a destination file that already exists (e.g. from a prior extraction)", async () => {
      // Regression test: transferDirectoryPerFile is how ImportManager transfers a
      // directory source's remaining loose files after extracting the archive straight
      // into destination (hardlink/symlink mode). transferSingleFile always overwrites,
      // so a loose file sharing a name with something extraction just produced would
      // silently replace it instead of failing loudly.
      const { sourceDir, destination, excludePaths } = await makeExcludeFixture({
        "game.rom": "loose-rom-bytes",
      });
      await fs.ensureDir(destination);
      await fs.writeFile(path.join(destination, "game.rom"), "extracted-rom-bytes");

      const strategy = new PCImportStrategy();
      await expect(
        strategy.executeImport(
          {
            needsReview: false,
            originalPath: sourceDir,
            proposedPath: destination,
            strategy: "pc",
          },
          "copy",
          excludePaths
        )
      ).rejects.toThrow("Destination already exists, refusing to overwrite");

      // The pre-existing (extracted) file survives untouched.
      expect(await fs.readFile(path.join(destination, "game.rom"), "utf8")).toBe(
        "extracted-rom-bytes"
      );
    });

    it("skips excluded entries in the sortExtras per-file path too", async () => {
      const { sourceDir, destination, excludePaths } = await makeExcludeFixture({
        "Game Update v1.nsp": "update",
      });

      const strategy = new PCImportStrategy();
      const result = await strategy.executeImport(
        {
          needsReview: false,
          originalPath: sourceDir,
          proposedPath: destination,
          strategy: "pc",
          fileCategories: [
            { name: "game.zip", category: "main" },
            { name: "Game Update v1.nsp", category: "update" },
          ],
        },
        "copy",
        excludePaths
      );

      expect(result.filesPlaced).toEqual([path.join(destination, "update", "Game Update v1.nsp")]);
      expect(await fs.pathExists(path.join(destination, "game.zip"))).toBe(false);
    });

    it("refuses to overwrite a destination file that already exists in the categorized (fileCategories) branch too", async () => {
      // Same regression as the transferDirectoryPerFile version above, but for the
      // categorized branch: unpackViaLinkedExtraction extracts an archive straight into
      // destination before calling executeImport for the remaining loose files, so a
      // categorized entry sharing a name with something extraction just produced needs
      // the same guard — the duplicate-destination check above only compares planned
      // entries against each other, not against what's already on disk.
      const { sourceDir, destination, excludePaths } = await makeExcludeFixture({
        "game.rom": "loose-rom-bytes",
      });
      await fs.ensureDir(destination);
      await fs.writeFile(path.join(destination, "game.rom"), "extracted-rom-bytes");

      const strategy = new PCImportStrategy();
      await expect(
        strategy.executeImport(
          {
            needsReview: false,
            originalPath: sourceDir,
            proposedPath: destination,
            strategy: "pc",
            fileCategories: [{ name: "game.rom", category: "main" }],
          },
          "copy",
          excludePaths
        )
      ).rejects.toThrow("Destination already exists, refusing to overwrite");

      // The pre-existing (extracted) file survives untouched.
      expect(await fs.readFile(path.join(destination, "game.rom"), "utf8")).toBe(
        "extracted-rom-bytes"
      );
    });

    it("refuses to transfer through a symlinked destination ancestor from a planted archive entry", async () => {
      // Regression test: unpackViaLinkedExtraction extracts an archive into destination
      // before this runs. A malicious archive entry could plant a symlinked directory
      // there — if the source also has a loose file nested under that same name,
      // ensureParentDir's old fs.ensureDir(path.dirname(...)) would follow the symlink
      // and write the file outside destination entirely.
      const { sourceDir, destination, excludePaths } = await makeExcludeFixture({});
      await fs.ensureDir(path.join(sourceDir, "subfolder"));
      await fs.writeFile(path.join(sourceDir, "subfolder", "game.rom"), "loose-rom-bytes");

      const outsideDir = tempDir();
      await fs.ensureDir(outsideDir);
      await fs.ensureDir(destination);
      await fs.symlink(outsideDir, path.join(destination, "subfolder"));

      const strategy = new PCImportStrategy();
      await expect(
        strategy.executeImport(
          {
            needsReview: false,
            originalPath: sourceDir,
            proposedPath: destination,
            strategy: "pc",
          },
          "copy",
          excludePaths
        )
      ).rejects.toThrow("Refusing to transfer through a non-directory or symlinked path");

      // Nothing was written through the symlink into the outside directory.
      expect(await fs.pathExists(path.join(outsideDir, "game.rom"))).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Sensitive-path guards — transferFile/gatherFiles walk the filesystem
  // independently of the planImport-time isSensitivePath check, so they carry
  // their own guard rather than trusting every future caller to check first.
  // ---------------------------------------------------------------------------

  describe("sensitive-path guards", () => {
    it("executeImport refuses a source under a sensitive system path", async () => {
      const root = tempDir();
      const destination = path.join(root, "library", "PC", "My Game");

      const strategy = new PCImportStrategy();
      await expect(
        strategy.executeImport(
          {
            needsReview: false,
            originalPath: "/etc/passwd",
            proposedPath: destination,
            strategy: "pc",
          },
          "copy"
        )
      ).rejects.toThrow("Refusing to process a sensitive system path");
    });

    it("gatherFiles refuses a sensitive system path", async () => {
      await expect(gatherFiles("/etc")).rejects.toThrow(
        "Refusing to process a sensitive system path"
      );
    });

    it("executeImport refuses a sensitive path in the categorized (fileCategories) branch too", async () => {
      // Regression test: the categorized branch calls transferSingleFile directly,
      // bypassing transferFile's own guard — the check has to live at executeImport's
      // shared entry point to actually cover this branch.
      const root = tempDir();
      const destination = path.join(root, "library", "PC", "My Game");

      const strategy = new PCImportStrategy();
      await expect(
        strategy.executeImport(
          {
            needsReview: false,
            originalPath: "/etc",
            proposedPath: destination,
            strategy: "pc",
            fileCategories: [{ name: "passwd", category: "main" }],
          },
          "copy"
        )
      ).rejects.toThrow("Refusing to process a sensitive system path");
    });
  });

  // ---------------------------------------------------------------------------
  // Source-root containment — configured downloader roots
  // ---------------------------------------------------------------------------

  describe("source-root containment", () => {
    it("planImport allows a source under a configured root", async () => {
      const root = tempDir();
      const downloadsRoot = path.join(root, "downloads");
      const source = path.join(downloadsRoot, "game.exe");
      await fs.ensureDir(downloadsRoot);
      await fs.writeFile(source, "exe-bytes");

      const strategy = new PCImportStrategy([downloadsRoot]);
      await expect(
        strategy.planImport(
          source,
          makeGame({ title: "My Game" }),
          path.join(root, "library"),
          makeImportConfig()
        )
      ).resolves.toMatchObject({ originalPath: source });
    });

    it("planImport refuses a source outside every configured root", async () => {
      const root = tempDir();
      const downloadsRoot = path.join(root, "downloads");
      const outsideDir = path.join(root, "elsewhere");
      const source = path.join(outsideDir, "game.exe");
      await fs.ensureDir(outsideDir);
      await fs.writeFile(source, "exe-bytes");

      const strategy = new PCImportStrategy([downloadsRoot]);
      await expect(
        strategy.planImport(
          source,
          makeGame({ title: "My Game" }),
          path.join(root, "library"),
          makeImportConfig()
        )
      ).rejects.toThrow("Refusing to process a path outside the configured downloader roots");
    });

    it("planImport applies no restriction when no roots are configured", async () => {
      const root = tempDir();
      const source = path.join(root, "anywhere", "game.exe");
      await fs.ensureDir(path.dirname(source));
      await fs.writeFile(source, "exe-bytes");

      const strategy = new PCImportStrategy();
      await expect(
        strategy.planImport(
          source,
          makeGame({ title: "My Game" }),
          path.join(root, "library"),
          makeImportConfig()
        )
      ).resolves.toMatchObject({ originalPath: source });
    });

    it("executeImport refuses review.originalPath outside every configured root, even without going through planImport first", async () => {
      // Regression test: confirmImport can supply review.originalPath directly, so
      // the containment check has to be enforced here too, independently of planImport.
      const root = tempDir();
      const downloadsRoot = path.join(root, "downloads");
      const destination = path.join(root, "library", "PC", "My Game");

      const strategy = new PCImportStrategy([downloadsRoot]);
      await expect(
        strategy.executeImport(
          {
            needsReview: false,
            originalPath: path.join(root, "elsewhere", "game.exe"),
            proposedPath: destination,
            strategy: "pc",
          },
          "copy"
        )
      ).rejects.toThrow("Refusing to process a path outside the configured downloader roots");
    });
  });

  // ---------------------------------------------------------------------------
  // reorganizeBySortExtras() — post-extraction categorization pass
  // ---------------------------------------------------------------------------

  describe("reorganizeBySortExtras()", () => {
    it("moves categorized files into subdirectories in place, leaving main files alone", async () => {
      const root = tempDir();
      const destDir = path.join(root, "library", "PC", "My Game");
      await fs.ensureDir(destDir);
      await fs.writeFile(path.join(destDir, "game.exe"), "main");
      await fs.writeFile(path.join(destDir, "Game Update v1.nsp"), "update");
      await fs.writeFile(path.join(destDir, "Game Expansion Pack.nsp"), "dlc");

      await reorganizeBySortExtras(destDir);

      expect(await fs.pathExists(path.join(destDir, "game.exe"))).toBe(true);
      expect(await fs.pathExists(path.join(destDir, "update", "Game Update v1.nsp"))).toBe(true);
      expect(await fs.pathExists(path.join(destDir, "dlc", "Game Expansion Pack.nsp"))).toBe(true);
      expect(await fs.pathExists(path.join(destDir, "Game Update v1.nsp"))).toBe(false);
    });

    it("is a no-op for files that already sit in their correct category directory", async () => {
      const root = tempDir();
      const destDir = path.join(root, "library", "PC", "My Game");
      await fs.ensureDir(path.join(destDir, "dlc"));
      await fs.writeFile(path.join(destDir, "dlc", "Game DLC Pack.nsp"), "dlc");

      const moveSpy = vi.spyOn(fs, "move");
      await reorganizeBySortExtras(destDir);

      expect(moveSpy).not.toHaveBeenCalled();
    });

    it("rejects a collision instead of silently overwriting one file with another", async () => {
      // A root-level update file and an identically-named file already sitting in
      // "update/" both categorize to the same destination — without a collision check,
      // whichever fs.move runs second overwrites the first (overwrite: true) rather than
      // surfacing the conflict.
      const root = tempDir();
      const destDir = path.join(root, "library", "PC", "My Game");
      await fs.ensureDir(path.join(destDir, "update"));
      await fs.writeFile(path.join(destDir, "Game Update v1.nsp"), "root-copy");
      await fs.writeFile(path.join(destDir, "update", "Game Update v1.nsp"), "existing-copy");

      const moveSpy = vi.spyOn(fs, "move");
      await expect(reorganizeBySortExtras(destDir)).rejects.toThrow(
        "Duplicate sortExtras destination"
      );
      expect(moveSpy).not.toHaveBeenCalled();
    });
  });
});
