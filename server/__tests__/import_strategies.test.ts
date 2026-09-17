import { afterEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import fs from "fs-extra";
import os from "node:os";
import path from "node:path";
import { PCImportStrategy, reorganizeBySortExtras } from "../services/ImportStrategies.js";
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
    it("skips excluded files during a directory move, but still moves the rest", async () => {
      const root = tempDir();
      const sourceDir = path.join(root, "downloads", "release");
      const destination = path.join(root, "library", "PC", "My Game");
      await fs.ensureDir(sourceDir);
      const archivePath = path.join(sourceDir, "game.zip");
      const looseFile = path.join(sourceDir, "game.rom");
      await fs.writeFile(archivePath, "zip-bytes");
      await fs.writeFile(looseFile, "rom-bytes");

      const strategy = new PCImportStrategy();
      const result = await strategy.executeImport(
        {
          needsReview: false,
          originalPath: sourceDir,
          proposedPath: destination,
          strategy: "pc",
        },
        "move",
        new Set([path.resolve(archivePath)])
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
      const root = tempDir();
      const sourceDir = path.join(root, "downloads", "release");
      const destination = path.join(root, "library", "PC", "My Game");
      await fs.ensureDir(sourceDir);
      const archivePath = path.join(sourceDir, "game.zip");
      const looseFile = path.join(sourceDir, "game.rom");
      await fs.writeFile(archivePath, "zip-bytes");
      await fs.writeFile(looseFile, "rom-bytes");

      const strategy = new PCImportStrategy();
      const result = await strategy.executeImport(
        {
          needsReview: false,
          originalPath: sourceDir,
          proposedPath: destination,
          strategy: "pc",
        },
        "hardlink",
        new Set([path.resolve(archivePath)])
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
      const root = tempDir();
      const sourceDir = path.join(root, "downloads", "release");
      const destination = path.join(root, "library", "PC", "My Game");
      await fs.ensureDir(sourceDir);
      const archivePath = path.join(sourceDir, "game.zip");
      await fs.writeFile(archivePath, "zip-bytes");

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
          new Set([path.resolve(archivePath)])
        )
      ).rejects.toThrow("No files to transfer after applying exclusions");
    });

    it("skips excluded entries in the sortExtras per-file path too", async () => {
      const root = tempDir();
      const sourceDir = path.join(root, "downloads", "release");
      const destination = path.join(root, "library", "PC", "My Game");
      await fs.ensureDir(sourceDir);
      const archivePath = path.join(sourceDir, "game.zip");
      await fs.writeFile(archivePath, "zip-bytes");
      await fs.writeFile(path.join(sourceDir, "Game Update v1.nsp"), "update");

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
        new Set([path.resolve(archivePath)])
      );

      expect(result.filesPlaced).toEqual([path.join(destination, "update", "Game Update v1.nsp")]);
      expect(await fs.pathExists(path.join(destination, "game.zip"))).toBe(false);
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
  });
});
