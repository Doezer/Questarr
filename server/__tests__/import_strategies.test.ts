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
});
