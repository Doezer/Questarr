import { afterEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import fs from "fs-extra";
import os from "node:os";
import path from "node:path";
import { PCImportStrategy } from "../services/ImportStrategies.js";
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
});

describe("ImportStrategies", () => {
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

    it("sorts detected add-on files while preserving main and existing category paths", async () => {
      const root = tempDir();
      const sourceDir = path.join(root, "downloads", "game-folder");
      const destination = path.join(root, "library", "PC", "My Game");
      await fs.ensureDir(path.join(sourceDir, "dlc"));
      await fs.writeFile(path.join(sourceDir, "base.nsp"), "base");
      await fs.writeFile(path.join(sourceDir, "Game Update v1.nsp"), "update");
      await fs.writeFile(path.join(sourceDir, "Game Expansion Pack.nsp"), "dlc");
      await fs.writeFile(path.join(sourceDir, "Game OST.zip"), "extra");
      await fs.writeFile(path.join(sourceDir, "dlc", "Game DLC Pack.nsp"), "nested-dlc");

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

      copySpy.mockRestore();
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
  });
});
