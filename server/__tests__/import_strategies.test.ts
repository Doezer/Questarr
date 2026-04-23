import { afterEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import fs from "fs-extra";
import os from "node:os";
import path from "node:path";
import { PCImportStrategy, RomMImportStrategy } from "../services/ImportStrategies.js";
import { makeGame, makeImportConfig, makeRommConfig } from "./helpers/import-test-helpers.js";

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
});

const importConfig = makeImportConfig();
const rommConfig = makeRommConfig({ url: "http://localhost:8080" }); // NOSONAR

describe("ImportStrategies", () => {
  it("RomMImportStrategy can place a single file under routed platform directory", async () => {
    const root = tempDir();
    const source = path.join(root, "downloads", "My.Game.rom");
    await fs.ensureDir(path.dirname(source));
    await fs.writeFile(source, "rom-bytes");

    const strategy = new RomMImportStrategy("snes");
    const localRomm: RomMConfig = { ...rommConfig, libraryRoot: path.join(root, "library") };

    const plan = await strategy.planImport(
      source,
      makeGame({ platforms: [19] }),
      localRomm.libraryRoot,
      importConfig,
      localRomm
    );
    const result = await strategy.executeImport(plan, "copy", localRomm);

    expect(result.destDir).toContain(path.join("library", "snes"));
    expect(result.filesPlaced.some((p) => p.endsWith(path.join("My.Game.rom")))).toBe(true);
  });

  it("RomMImportStrategy conflict policy skip returns without placing files", async () => {
    const root = tempDir();
    const source = path.join(root, "downloads", "skip.rom");
    const destination = path.join(root, "library", "snes", "skip.rom");
    await fs.ensureDir(path.dirname(source));
    await fs.ensureDir(path.dirname(destination));
    await fs.writeFile(source, "new-bytes");
    await fs.writeFile(destination, "existing-bytes");

    const strategy = new RomMImportStrategy("snes");
    const result = await strategy.executeImport(
      {
        needsReview: false,
        originalPath: source,
        proposedPath: destination,
        strategy: "romm",
      },
      "copy",
      { ...rommConfig, conflictPolicy: "skip" }
    );

    expect(result.conflictsResolved).toContain("skip");
    expect(result.filesPlaced).toEqual([]);
  });

  it("RomMImportStrategy conflict policy fail throws on existing destination", async () => {
    const root = tempDir();
    const source = path.join(root, "downloads", "fail.rom");
    const destination = path.join(root, "library", "snes", "fail.rom");
    await fs.ensureDir(path.dirname(source));
    await fs.ensureDir(path.dirname(destination));
    await fs.writeFile(source, "new-bytes");
    await fs.writeFile(destination, "existing-bytes");

    const strategy = new RomMImportStrategy("snes");
    await expect(
      strategy.executeImport(
        {
          needsReview: false,
          originalPath: source,
          proposedPath: destination,
          strategy: "romm",
        },
        "copy",
        { ...rommConfig, conflictPolicy: "fail" }
      )
    ).rejects.toThrow(/Destination already exists/);
  });

  it("RomMImportStrategy conflict policy overwrite replaces existing destination", async () => {
    const root = tempDir();
    const sourceDir = path.join(root, "downloads", "folder");
    const sourceFile = path.join(sourceDir, "game.rom");
    const destinationDir = path.join(root, "library", "snes", "Mega Game");
    const destinationOld = path.join(destinationDir, "old.rom");

    await fs.ensureDir(sourceDir);
    await fs.ensureDir(destinationDir);
    await fs.writeFile(sourceFile, "new-bytes");
    await fs.writeFile(destinationOld, "old-bytes");

    const strategy = new RomMImportStrategy("snes");
    const result = await strategy.executeImport(
      {
        needsReview: false,
        originalPath: sourceDir,
        proposedPath: destinationDir,
        strategy: "romm",
      },
      "copy",
      { ...rommConfig, conflictPolicy: "overwrite" }
    );

    expect(result.conflictsResolved).toContain("overwrite");
    expect(await fs.pathExists(path.join(destinationDir, "game.rom"))).toBe(true);
    expect(await fs.pathExists(destinationOld)).toBe(false);
  });

  it("falls back to copy when hardlink fails with EXDEV", async () => {
    const root = tempDir();
    const source = path.join(root, "downloads", "cross-device.rom");
    const destination = path.join(root, "library", "PC", "cross-device.rom");
    await fs.ensureDir(path.dirname(source));
    await fs.writeFile(source, "rom-bytes");

    const linkSpy = vi
      .spyOn(fs, "link")
      .mockRejectedValueOnce({ code: "EXDEV" } as NodeJS.ErrnoException);
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

    linkSpy.mockRestore();
    copySpy.mockRestore();
  });

  // ---------------------------------------------------------------------------
  // applyTemplate() — tested indirectly via RomMImportStrategy.planImport
  // ---------------------------------------------------------------------------

  describe("applyTemplate() via planImport folderNamingTemplate", () => {
    it("template with {title} where game.title is empty string renders as empty and falls back to game id", async () => {
      const root = tempDir();
      const source = path.join(root, "downloads", "game.rom");
      await fs.ensureDir(path.dirname(source));
      await fs.writeFile(source, "bytes");

      const strategy = new RomMImportStrategy("snes");
      const localRomm = makeRommConfig({
        libraryRoot: path.join(root, "library"),
        folderNamingTemplate: "{title}",
        singleFilePlacement: "subfolder",
      });

      // game.title is empty string; applyTemplate falls back to `game-${game.id}`
      const game = makeGame({ title: "", id: "abc123" });
      const plan = await strategy.planImport(
        source,
        game,
        localRomm.libraryRoot,
        makeImportConfig(),
        localRomm
      );

      expect(plan.needsReview).toBe(false);
      // proposedPath should end with the fallback folder name containing the id
      expect(plan.proposedPath).toContain("abc123");
    });

    it("template with {id} where game.igdbId and game.id are both present uses igdbId", async () => {
      const root = tempDir();
      const source = path.join(root, "downloads", "game.rom");
      await fs.ensureDir(path.dirname(source));
      await fs.writeFile(source, "bytes");

      const strategy = new RomMImportStrategy("snes");
      const localRomm = makeRommConfig({
        libraryRoot: path.join(root, "library"),
        folderNamingTemplate: "{releaseId}",
        singleFilePlacement: "subfolder",
      });

      const game = makeGame({ igdbId: 9999, id: "g1" });
      const plan = await strategy.planImport(
        source,
        game,
        localRomm.libraryRoot,
        makeImportConfig(),
        localRomm
      );

      expect(plan.needsReview).toBe(false);
      expect(plan.proposedPath).toContain("9999");
    });

    it("template with multiple occurrences of {title} replaces all of them", async () => {
      const root = tempDir();
      const source = path.join(root, "downloads", "game.rom");
      await fs.ensureDir(path.dirname(source));
      await fs.writeFile(source, "bytes");

      const strategy = new RomMImportStrategy("snes");
      const localRomm = makeRommConfig({
        libraryRoot: path.join(root, "library"),
        folderNamingTemplate: "{title} - {title}",
        singleFilePlacement: "subfolder",
      });

      const game = makeGame({ title: "Hero" });
      const plan = await strategy.planImport(
        source,
        game,
        localRomm.libraryRoot,
        makeImportConfig(),
        localRomm
      );

      expect(plan.needsReview).toBe(false);
      // Both placeholders replaced → folder name is "Hero - Hero"
      expect(path.basename(plan.proposedPath)).toBe("Hero - Hero");
    });

    it("template string with no placeholders is returned as-is", async () => {
      const root = tempDir();
      const source = path.join(root, "downloads", "game.rom");
      await fs.ensureDir(path.dirname(source));
      await fs.writeFile(source, "bytes");

      const strategy = new RomMImportStrategy("snes");
      const localRomm = makeRommConfig({
        libraryRoot: path.join(root, "library"),
        folderNamingTemplate: "static-folder-name",
        singleFilePlacement: "subfolder",
      });

      const plan = await strategy.planImport(
        source,
        makeGame(),
        localRomm.libraryRoot,
        makeImportConfig(),
        localRomm
      );

      expect(plan.needsReview).toBe(false);
      expect(path.basename(plan.proposedPath)).toBe("static-folder-name");
    });
  });

  // ---------------------------------------------------------------------------
  // isIgnored() — tested indirectly via planImport ignoredExtensions filtering
  // ---------------------------------------------------------------------------

  describe("isIgnored() via planImport ignoredExtensions", () => {
    it(".nfo lowercase extension is ignored and causes needsReview when it is the only file", async () => {
      const root = tempDir();
      const source = path.join(root, "downloads", "game.nfo");
      await fs.ensureDir(path.dirname(source));
      await fs.writeFile(source, "nfo-content");

      const strategy = new RomMImportStrategy("snes");
      const localRomm = makeRommConfig({ libraryRoot: path.join(root, "library") });

      const plan = await strategy.planImport(
        source,
        makeGame(),
        localRomm.libraryRoot,
        makeImportConfig({ ignoredExtensions: [".nfo"] }),
        localRomm
      );

      expect(plan.needsReview).toBe(true);
      expect(plan.reviewReason).toMatch(/No valid ROM files found/);
    });

    it(".NFO uppercase extension is also ignored (case-insensitive check)", async () => {
      const root = tempDir();
      const source = path.join(root, "downloads", "game.NFO");
      await fs.ensureDir(path.dirname(source));
      await fs.writeFile(source, "nfo-content");

      const strategy = new RomMImportStrategy("snes");
      const localRomm = makeRommConfig({ libraryRoot: path.join(root, "library") });

      const plan = await strategy.planImport(
        source,
        makeGame(),
        localRomm.libraryRoot,
        makeImportConfig({ ignoredExtensions: [".nfo"] }),
        localRomm
      );

      expect(plan.needsReview).toBe(true);
      expect(plan.reviewReason).toMatch(/No valid ROM files found/);
    });

    it("file without extension is not ignored even when .nfo is in ignoredExtensions", async () => {
      const root = tempDir();
      const source = path.join(root, "downloads", "game-no-ext");
      await fs.ensureDir(path.dirname(source));
      await fs.writeFile(source, "rom-bytes");

      const strategy = new RomMImportStrategy("snes");
      const localRomm = makeRommConfig({ libraryRoot: path.join(root, "library") });

      const plan = await strategy.planImport(
        source,
        makeGame(),
        localRomm.libraryRoot,
        makeImportConfig({ ignoredExtensions: [".nfo"] }),
        localRomm
      );

      expect(plan.needsReview).toBe(false);
    });

    it("non-ignored file in directory survives even when a sibling has an ignored extension", async () => {
      const root = tempDir();
      const sourceDir = path.join(root, "downloads", "mygame");
      await fs.ensureDir(sourceDir);
      await fs.writeFile(path.join(sourceDir, "game.rom"), "rom-bytes");
      await fs.writeFile(path.join(sourceDir, "game.nfo"), "nfo-content");

      const strategy = new RomMImportStrategy("snes");
      const localRomm = makeRommConfig({ libraryRoot: path.join(root, "library") });

      const plan = await strategy.planImport(
        sourceDir,
        makeGame(),
        localRomm.libraryRoot,
        makeImportConfig({ ignoredExtensions: [".nfo"] }),
        localRomm
      );

      // One valid file remains, so no needsReview
      expect(plan.needsReview).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // findAvailablePath() — tested indirectly via conflictPolicy "rename"
  // ---------------------------------------------------------------------------

  describe("findAvailablePath() via conflictPolicy rename", () => {
    it("when destination exists, rename policy produces a path with a (1) suffix", async () => {
      const root = tempDir();
      const source = path.join(root, "downloads", "game.rom");
      const destination = path.join(root, "library", "snes", "game.rom");
      await fs.ensureDir(path.dirname(source));
      await fs.ensureDir(path.dirname(destination));
      await fs.writeFile(source, "new-bytes");
      await fs.writeFile(destination, "existing-bytes");

      const strategy = new RomMImportStrategy("snes");
      const result = await strategy.executeImport(
        {
          needsReview: false,
          originalPath: source,
          proposedPath: destination,
          strategy: "romm",
          ignoredExtensions: [],
        },
        "copy",
        { ...makeRommConfig({ libraryRoot: path.join(root, "library") }), conflictPolicy: "rename" }
      );

      expect(result.filesPlaced.length).toBeGreaterThan(0);
      const placedPath = result.filesPlaced[0];
      // The destination was occupied, so the placed file should be in a "(1)" path
      expect(placedPath).toContain("(1)");
    });
  });

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

      // gatherFiles recurses destination, so both files should be present
      expect(result.filesPlaced.length).toBe(2);
      expect(result.filesPlaced.some((p) => p.endsWith("game.exe"))).toBe(true);
      expect(result.filesPlaced.some((p) => p.endsWith("data.pak"))).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // RomMImportStrategy.executeImport() — error handling
  // ---------------------------------------------------------------------------

  describe("RomMImportStrategy.executeImport() error handling", () => {
    it("staging directory is cleaned up when the final move fails", async () => {
      const root = tempDir();
      const source = path.join(root, "downloads", "game.rom");
      await fs.ensureDir(path.dirname(source));
      await fs.writeFile(source, "rom-bytes");

      const destination = path.join(root, "library", "snes", "game.rom");
      await fs.ensureDir(path.dirname(destination));

      // fs.move is called twice inside placeFiles: once to move staging→dest (single file path).
      // We let the first call (copy into staging via transferFile which uses fs.copy, not move)
      // succeed, then throw on the fs.move that promotes staging to destination.
      const moveSpy = vi.spyOn(fs, "move").mockRejectedValueOnce(new Error("disk full"));

      const strategy = new RomMImportStrategy("snes");
      await expect(
        strategy.executeImport(
          {
            needsReview: false,
            originalPath: source,
            proposedPath: destination,
            strategy: "romm",
          },
          "copy",
          makeRommConfig({ libraryRoot: path.join(root, "library"), conflictPolicy: "rename" })
        )
      ).rejects.toThrow("disk full");

      // Staging dirs live alongside the destination directory; verify none remain
      const parentDir = path.dirname(destination);
      const entries = await fs.readdir(parentDir);
      const stagingEntries = entries.filter((e) => e.startsWith(".questarr-staging-"));
      expect(stagingEntries).toHaveLength(0);

      moveSpy.mockRestore();
    });

    it("error from placeFiles propagates — not swallowed", async () => {
      const root = tempDir();
      const source = path.join(root, "downloads", "game.rom");
      await fs.ensureDir(path.dirname(source));
      await fs.writeFile(source, "rom-bytes");

      const destination = path.join(root, "library", "snes", "game.rom");

      const moveSpy = vi.spyOn(fs, "move").mockRejectedValueOnce(new Error("permission denied"));

      const strategy = new RomMImportStrategy("snes");
      await expect(
        strategy.executeImport(
          {
            needsReview: false,
            originalPath: source,
            proposedPath: destination,
            strategy: "romm",
          },
          "copy",
          makeRommConfig({ libraryRoot: path.join(root, "library"), conflictPolicy: "rename" })
        )
      ).rejects.toThrow("permission denied");

      moveSpy.mockRestore();
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

      copySpy.mockRestore();
    });
  });

  // ---------------------------------------------------------------------------
  // RomMImportStrategy.planImport() — missing rommConfig
  // ---------------------------------------------------------------------------

  describe("RomMImportStrategy.planImport() missing rommConfig", () => {
    it("returns needsReview true when rommConfig is undefined", async () => {
      const root = tempDir();
      const source = path.join(root, "downloads", "game.rom");
      await fs.ensureDir(path.dirname(source));
      await fs.writeFile(source, "rom-bytes");

      const strategy = new RomMImportStrategy("snes");
      const plan = await strategy.planImport(
        source,
        makeGame(),
        path.join(root, "library"),
        makeImportConfig(),
        undefined
      );

      expect(plan.needsReview).toBe(true);
      expect(plan.reviewReason).toMatch(/RomM config is required/);
      expect(plan.proposedPath).toBe("");
    });
  });

  // ---------------------------------------------------------------------------
  // RomMImportStrategy.planImport() — additional edge cases
  // ---------------------------------------------------------------------------

  describe("RomMImportStrategy.planImport() edge cases", () => {
    it("game.title is empty string still produces a valid proposed path", async () => {
      const root = tempDir();
      const source = path.join(root, "downloads", "game.rom");
      await fs.ensureDir(path.dirname(source));
      await fs.writeFile(source, "bytes");

      const strategy = new RomMImportStrategy("snes");
      const localRomm = makeRommConfig({
        libraryRoot: path.join(root, "library"),
        singleFilePlacement: "subfolder",
      });

      const plan = await strategy.planImport(
        source,
        makeGame({ title: "", id: "myid" }),
        localRomm.libraryRoot,
        makeImportConfig(),
        localRomm
      );

      expect(plan.needsReview).toBe(false);
      expect(plan.proposedPath.length).toBeGreaterThan(0);
      // Falls back to game-<id>
      expect(plan.proposedPath).toContain("myid");
    });

    it("singleFilePlacement root: single file goes directly in platform dir, not a subfolder", async () => {
      const root = tempDir();
      const source = path.join(root, "downloads", "game.rom");
      await fs.ensureDir(path.dirname(source));
      await fs.writeFile(source, "bytes");

      const strategy = new RomMImportStrategy("snes");
      const localRomm = makeRommConfig({
        libraryRoot: path.join(root, "library"),
        singleFilePlacement: "root",
      });

      const plan = await strategy.planImport(
        source,
        makeGame({ title: "My Game" }),
        localRomm.libraryRoot,
        makeImportConfig(),
        localRomm
      );

      expect(plan.needsReview).toBe(false);
      // proposedPath should be the platform dir itself, not a subfolder of it
      const expectedPlatformDir = path.join(root, "library", "snes");
      expect(plan.proposedPath).toBe(expectedPlatformDir);
    });

    it("all source files are ignored: plan returns needsReview true", async () => {
      const root = tempDir();
      const sourceDir = path.join(root, "downloads", "junk");
      await fs.ensureDir(sourceDir);
      await fs.writeFile(path.join(sourceDir, "readme.nfo"), "nfo");
      await fs.writeFile(path.join(sourceDir, "cover.jpg"), "jpg");

      const strategy = new RomMImportStrategy("snes");
      const localRomm = makeRommConfig({ libraryRoot: path.join(root, "library") });

      const plan = await strategy.planImport(
        sourceDir,
        makeGame(),
        localRomm.libraryRoot,
        makeImportConfig({ ignoredExtensions: [".nfo", ".jpg"] }),
        localRomm
      );

      expect(plan.needsReview).toBe(true);
      expect(plan.reviewReason).toMatch(/No valid ROM files found/);
    });
  });
});
