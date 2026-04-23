import { afterEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import fs from "fs-extra";
import os from "node:os";
import path from "node:path";
import {
  resolveRommPlatformDir,
  sanitizeFsName,
  validateRommSlug,
} from "../services/RommRouting.js";
import { RomMImportStrategy } from "../services/ImportStrategies.js";
import { makeGame, makeImportConfig, makeRommConfig } from "./helpers/import-test-helpers.js";
import type { RomMConfig } from "../../shared/schema.js";

const tempRoots: string[] = [];

function makeTempRoot(): string {
  const dir = path.join(
    os.tmpdir(),
    `questarr-romm-${Date.now()}-${randomBytes(8).toString("hex")}`
  );
  tempRoots.push(dir);
  return dir;
}

afterEach(async () => {
  for (const root of tempRoots.splice(0, tempRoots.length)) {
    await fs.remove(root);
  }
});

const importConfig = makeImportConfig({ ignoredExtensions: [".nfo"] });

describe("RomM routing", () => {
  it("validates fs_slug and rejects traversal", () => {
    expect(validateRommSlug("ps2")).toBe("ps2");
    expect(() => validateRommSlug("../ps2")).toThrow(/separators|traversal/i);
    expect(() => validateRommSlug("ps2/evil")).toThrow(/separators/i);
    expect(() => validateRommSlug("PS 2")).toThrow(/invalid/i);
  });

  it("resolves slug-subfolder and binding-map paths", () => {
    const root = "/mnt/romm/library/roms";

    const slugPath = resolveRommPlatformDir({
      libraryRoot: root,
      fsSlug: "ps2",
      routingMode: "slug-subfolder",
    });
    expect(slugPath).toBe(path.resolve(root, "ps2"));

    const boundRelative = resolveRommPlatformDir({
      libraryRoot: root,
      fsSlug: "snes",
      routingMode: "binding-map",
      bindings: { snes: "Nintendo/SNES" },
    });
    expect(boundRelative).toBe(path.resolve(root, "Nintendo/SNES"));

    expect(() =>
      resolveRommPlatformDir({
        libraryRoot: root,
        fsSlug: "ps2",
        routingMode: "binding-map",
        bindings: { ps2: "/custom/ps2" },
      })
    ).toThrow(/escapes library root/i);
  });

  // --- sanitizeFsName ---

  describe("sanitizeFsName()", () => {
    it("returns empty string for empty input", () => {
      expect(sanitizeFsName("")).toBe("");
    });

    it("returns empty string for whitespace-only input", () => {
      expect(sanitizeFsName("   ")).toBe("");
    });

    it("removes forward slash", () => {
      expect(sanitizeFsName("a/b")).toBe("ab");
    });

    it("removes backslash", () => {
      expect(sanitizeFsName("a\\b")).toBe("ab");
    });

    it('removes all forbidden characters: * ? " < > |', () => {
      expect(sanitizeFsName('*?"<>|')).toBe("");
    });

    it("removes colon", () => {
      expect(sanitizeFsName("Game: Title")).toBe("Game Title");
    });

    it("collapses multiple consecutive spaces to a single space", () => {
      expect(sanitizeFsName("Game   Title")).toBe("Game Title");
    });

    it("trims leading and trailing spaces", () => {
      expect(sanitizeFsName("  Game Title  ")).toBe("Game Title");
    });

    it("handles a mix of forbidden chars and spaces", () => {
      expect(sanitizeFsName('  My/Game\\*?"<>|  Title  ')).toBe("MyGame Title");
    });
  });

  // --- validateRommSlug edge cases ---

  describe("validateRommSlug() whitespace edge cases", () => {
    it("throws when slug trims to empty string", () => {
      expect(() => validateRommSlug("   ")).toThrow("RomM fs_slug is required");
    });

    it("throws for pure whitespace (tabs)", () => {
      expect(() => validateRommSlug("\t\t")).toThrow("RomM fs_slug is required");
    });
  });

  // --- resolveRommPlatformDir additional cases ---

  describe("resolveRommPlatformDir() binding-map edge cases", () => {
    const root = "/mnt/romm/library/roms";

    it("falls through to slug-subfolder when bindings is empty object", () => {
      const result = resolveRommPlatformDir({
        libraryRoot: root,
        fsSlug: "ps2",
        routingMode: "binding-map",
        bindings: {},
        bindingMissingBehavior: "fallback",
      });
      expect(result).toBe(path.resolve(root, "ps2"));
    });

    it("falls through to slug-subfolder when binding is missing and behavior is fallback", () => {
      const result = resolveRommPlatformDir({
        libraryRoot: root,
        fsSlug: "ps2",
        routingMode: "binding-map",
        bindings: { snes: "Nintendo/SNES" },
        bindingMissingBehavior: "fallback",
      });
      expect(result).toBe(path.resolve(root, "ps2"));
    });

    it("falls through to slug-subfolder when binding value is empty string", () => {
      const result = resolveRommPlatformDir({
        libraryRoot: root,
        fsSlug: "ps2",
        routingMode: "binding-map",
        bindings: { ps2: "" },
        bindingMissingBehavior: "fallback",
      });
      expect(result).toBe(path.resolve(root, "ps2"));
    });

    it("falls through to slug-subfolder when binding value is whitespace-only", () => {
      const result = resolveRommPlatformDir({
        libraryRoot: root,
        fsSlug: "ps2",
        routingMode: "binding-map",
        bindings: { ps2: "   " },
        bindingMissingBehavior: "fallback",
      });
      expect(result).toBe(path.resolve(root, "ps2"));
    });

    it("throws when binding is missing and behavior is error", () => {
      expect(() =>
        resolveRommPlatformDir({
          libraryRoot: root,
          fsSlug: "ps2",
          routingMode: "binding-map",
          bindings: {},
          bindingMissingBehavior: "error",
        })
      ).toThrow(/No RomM binding configured for slug/i);
    });
  });

  // --- ensureInsideRoot tested indirectly via resolveRommPlatformDir ---

  describe("ensureInsideRoot() boundary cases (via resolveRommPlatformDir)", () => {
    it("accepts path exactly at the library root (slug equals '.')", () => {
      // Cannot reach root itself via slug-subfolder (slug '.' is invalid).
      // Test that a valid slug one level deep is accepted.
      const root = "/mnt/romm/library/roms";
      const result = resolveRommPlatformDir({
        libraryRoot: root,
        fsSlug: "ps2",
        routingMode: "slug-subfolder",
      });
      expect(result).toBe(path.resolve(root, "ps2"));
    });

    it("rejects an absolute binding that escapes the library root", () => {
      const root = "/mnt/romm/library/roms";
      expect(() =>
        resolveRommPlatformDir({
          libraryRoot: root,
          fsSlug: "ps2",
          routingMode: "binding-map",
          bindings: { ps2: "/etc/passwd" },
        })
      ).toThrow(/escapes library root/i);
    });

    it("rejects a relative binding that traverses above the library root", () => {
      const root = "/mnt/romm/library/roms";
      expect(() =>
        resolveRommPlatformDir({
          libraryRoot: root,
          fsSlug: "ps2",
          routingMode: "binding-map",
          bindings: { ps2: "../../outside" },
        })
      ).toThrow(/escapes library root/i);
    });
  });

  it("imports multi-file sets together and resolves rename conflicts", async () => {
    const root = makeTempRoot();
    const source = path.join(root, "downloads", "game-folder");
    await fs.ensureDir(source);
    await fs.writeFile(path.join(source, "Game.cue"), "cue");
    await fs.writeFile(path.join(source, "Game.bin"), "bin");

    const romm = makeRommConfig({ libraryRoot: path.join(root, "library") });
    const strategy = new RomMImportStrategy("ps2");
    const plan = await strategy.planImport(
      source,
      makeGame({ title: "Mega Game", igdbId: 8, platforms: [8] }),
      romm.libraryRoot,
      importConfig,
      romm
    );

    expect(plan.proposedPath).toContain(path.join("library", "ps2", "Mega Game"));

    await fs.ensureDir(plan.proposedPath);
    const result = await strategy.executeImport(plan, "copy", romm);

    expect(result.destDir).not.toBe(plan.proposedPath);
    expect(result.conflictsResolved.some((c) => c.startsWith("rename:"))).toBe(true);
    expect(result.filesPlaced.some((p) => p.endsWith(path.join("Game.cue")))).toBe(true);
    expect(result.filesPlaced.some((p) => p.endsWith(path.join("Game.bin")))).toBe(true);
  });

  // --- resolveRommPlatformDir() binding-map additional edge cases ---

  describe("resolveRommPlatformDir() binding-map: new edge cases", () => {
    const root = "/mnt/romm/library/roms";

    it("accepts a binding value that contains path separators (e.g. 'Sony/PlayStation 2')", () => {
      // The raw binding value is used directly as a path.resolve argument.
      // Path separators are intentional here — they create nested subdirectories
      // inside the library root, which is allowed.
      const result = resolveRommPlatformDir({
        libraryRoot: root,
        fsSlug: "ps2",
        routingMode: "binding-map",
        bindings: { ps2: "Sony/PlayStation 2" },
      });
      expect(result).toBe(path.resolve(root, "Sony/PlayStation 2"));
      // Must still be inside the root.
      expect(result.startsWith(path.resolve(root))).toBe(true);
    });

    it("looks up binding key using the lowercased slug (case-insensitive slug matching)", () => {
      // validateRommSlug() lowercases the slug before lookup, so bindings keyed
      // with lowercase are matched even when the caller passes a mixed-case slug.
      // Passing "PS2" as fsSlug → safeSlug becomes "ps2" → bindings["ps2"] is found.
      const result = resolveRommPlatformDir({
        libraryRoot: root,
        fsSlug: "PS2",
        routingMode: "binding-map",
        bindings: { ps2: "Sony/PS2" },
      });
      expect(result).toBe(path.resolve(root, "Sony/PS2"));
    });

    it("binding key stored in uppercase is NOT found (keys are case-sensitive in the map)", () => {
      // If a caller stored the binding key in uppercase ("PS2") but the slug
      // normalizes to lowercase ("ps2"), the lookup misses and falls back to
      // slug-subfolder (when bindingMissingBehavior is "fallback").
      const result = resolveRommPlatformDir({
        libraryRoot: root,
        fsSlug: "ps2",
        routingMode: "binding-map",
        bindings: { PS2: "Sony/PS2" },
        bindingMissingBehavior: "fallback",
      });
      // Fallback: uses the normalized slug as the directory name.
      expect(result).toBe(path.resolve(root, "ps2"));
    });

    it("throws with a descriptive message when bindingMissingBehavior is 'error' and binding is absent", () => {
      // The error message must mention the slug so callers can diagnose which
      // platform is missing its binding.
      expect(() =>
        resolveRommPlatformDir({
          libraryRoot: root,
          fsSlug: "gc",
          routingMode: "binding-map",
          bindings: { ps2: "Sony/PS2" },
          bindingMissingBehavior: "error",
        })
      ).toThrow(/gc/i);
    });

    it("throws for a slug containing unicode characters (outside allowed charset)", () => {
      // validateRommSlug enforces /^[a-z0-9._-]+$/ after lowercasing.
      // Unicode letters like 'é', '日', or emoji are not in that set.
      expect(() =>
        resolveRommPlatformDir({
          libraryRoot: root,
          fsSlug: "pláystation",
          routingMode: "binding-map",
          bindings: {},
        })
      ).toThrow(/invalid characters/i);
    });

    it("does not crash when slug is a single valid ascii character", () => {
      // Boundary: minimal valid slug.
      const result = resolveRommPlatformDir({
        libraryRoot: root,
        fsSlug: "x",
        routingMode: "binding-map",
        bindings: {},
        bindingMissingBehavior: "fallback",
      });
      expect(result).toBe(path.resolve(root, "x"));
    });
  });

  // --- resolveConflict() — tested via executeImport() ---

  describe("resolveConflict() policy: skip", () => {
    it("returns empty filesPlaced and 'skip' in conflictsResolved when destination exists", async () => {
      const root = makeTempRoot();
      const source = path.join(root, "downloads");
      await fs.ensureDir(source);
      await fs.writeFile(path.join(source, "game.rom"), "data");

      const libraryRoot = path.join(root, "library");
      const romm = makeRommConfig({ libraryRoot, conflictPolicy: "skip" });
      const strategy = new RomMImportStrategy("gba");

      const plan = await strategy.planImport(
        path.join(source, "game.rom"),
        makeGame({ title: "Skip Game" }),
        libraryRoot,
        importConfig,
        romm
      );

      // Pre-create a file at the destination so a conflict exists.
      // singleFilePlacement is "root" so the dest is platformDir/game.rom.
      const destFile = path.join(plan.proposedPath, "game.rom");
      await fs.ensureDir(plan.proposedPath);
      await fs.writeFile(destFile, "existing");

      const result = await strategy.executeImport(plan, "copy", romm);

      expect(result.filesPlaced).toHaveLength(0);
      expect(result.conflictsResolved).toContain("skip");
    });
  });

  describe("resolveConflict() policy: overwrite", () => {
    it("overwrites an existing destination and records 'overwrite' in conflictsResolved", async () => {
      const root = makeTempRoot();
      const source = path.join(root, "downloads", "game-folder");
      await fs.ensureDir(source);
      await fs.writeFile(path.join(source, "game.iso"), "new content");
      await fs.writeFile(path.join(source, "game.cue"), "new cue");

      const libraryRoot = path.join(root, "library");
      const romm = makeRommConfig({ libraryRoot, conflictPolicy: "overwrite" });
      const strategy = new RomMImportStrategy("ps2");

      const plan = await strategy.planImport(
        source,
        makeGame({ title: "Overwrite Game" }),
        libraryRoot,
        importConfig,
        romm
      );

      // Pre-create the destination directory so a conflict is detected.
      await fs.ensureDir(plan.proposedPath);
      await fs.writeFile(path.join(plan.proposedPath, "old.iso"), "old content");

      const result = await strategy.executeImport(plan, "copy", romm);

      expect(result.conflictsResolved).toContain("overwrite");
      expect(result.filesPlaced.length).toBeGreaterThan(0);
    });
  });

  describe("resolveConflict() policy: rename", () => {
    it("renames the destination directory when it already exists", async () => {
      const root = makeTempRoot();
      const source = path.join(root, "downloads", "game-folder");
      await fs.ensureDir(source);
      await fs.writeFile(path.join(source, "game.cue"), "cue");
      await fs.writeFile(path.join(source, "game.bin"), "bin");

      const libraryRoot = path.join(root, "library");
      const romm = makeRommConfig({ libraryRoot, conflictPolicy: "rename" });
      const strategy = new RomMImportStrategy("ps2");

      const plan = await strategy.planImport(
        source,
        makeGame({ title: "Rename Game" }),
        libraryRoot,
        importConfig,
        romm
      );

      // Pre-create proposed path to force a rename.
      await fs.ensureDir(plan.proposedPath);

      const result = await strategy.executeImport(plan, "copy", romm);

      expect(result.destDir).not.toBe(plan.proposedPath);
      // Renamed path gets a " (1)" suffix.
      expect(result.destDir).toBe(`${plan.proposedPath} (1)`);
      expect(result.conflictsResolved.some((c) => c.startsWith("rename:"))).toBe(true);
    });
  });

  // --- resolveRommDestPath() — destination logic inside planImport() ---

  describe("destination path logic (planImport)", () => {
    it("uses platform/game subfolder for a multi-file (directory) source", async () => {
      const root = makeTempRoot();
      const source = path.join(root, "downloads", "game-folder");
      await fs.ensureDir(source);
      await fs.writeFile(path.join(source, "disc1.iso"), "a");
      await fs.writeFile(path.join(source, "disc2.iso"), "b");

      const libraryRoot = path.join(root, "library");
      const romm = makeRommConfig({ libraryRoot });
      const strategy = new RomMImportStrategy("ps2");

      const plan = await strategy.planImport(
        source,
        makeGame({ title: "Multi Disc Game" }),
        libraryRoot,
        importConfig,
        romm
      );

      const expected = path.join(libraryRoot, "ps2", "Multi Disc Game");
      expect(plan.proposedPath).toBe(expected);
    });

    it("places single file directly into platform dir when singleFilePlacement is 'root'", async () => {
      const root = makeTempRoot();
      const source = path.join(root, "downloads");
      await fs.ensureDir(source);
      const romFile = path.join(source, "game.gba");
      await fs.writeFile(romFile, "rom");

      const libraryRoot = path.join(root, "library");
      const romm: RomMConfig = makeRommConfig({
        libraryRoot,
        singleFilePlacement: "root",
      });
      const strategy = new RomMImportStrategy("gba");

      const plan = await strategy.planImport(
        romFile,
        makeGame({ title: "Single Root Game" }),
        libraryRoot,
        importConfig,
        romm
      );

      // Should resolve to the platform dir itself (no game subfolder).
      const expected = path.join(libraryRoot, "gba");
      expect(plan.proposedPath).toBe(expected);
    });

    it("places single file into platform/game subfolder when singleFilePlacement is 'subfolder'", async () => {
      const root = makeTempRoot();
      const source = path.join(root, "downloads");
      await fs.ensureDir(source);
      const romFile = path.join(source, "game.gba");
      await fs.writeFile(romFile, "rom");

      const libraryRoot = path.join(root, "library");
      const romm: RomMConfig = makeRommConfig({
        libraryRoot,
        singleFilePlacement: "subfolder",
      });
      const strategy = new RomMImportStrategy("gba");

      const plan = await strategy.planImport(
        romFile,
        makeGame({ title: "Single Sub Game" }),
        libraryRoot,
        importConfig,
        romm
      );

      const expected = path.join(libraryRoot, "gba", "Single Sub Game");
      expect(plan.proposedPath).toBe(expected);
    });
  });
});
