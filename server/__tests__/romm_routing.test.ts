import { afterEach, describe, expect, it } from "vitest";
import fs from "fs-extra";
import os from "os";
import path from "path";
import { resolveRommPlatformDir, validateRommSlug } from "../services/RommRouting.js";
import { RomMImportStrategy } from "../services/ImportStrategies.js";
import type { Game, ImportConfig, RomMConfig } from "../../shared/schema.js";

const tempRoots: string[] = [];

function makeTempRoot(): string {
  const dir = path.join(
    os.tmpdir(),
    `questarr-romm-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
  tempRoots.push(dir);
  return dir;
}

afterEach(async () => {
  for (const root of tempRoots.splice(0, tempRoots.length)) {
    await fs.remove(root);
  }
});

function makeGame(title: string): Game {
  return {
    id: "g1",
    title,
    status: "wanted",
    userId: "u1",
    igdbId: 8,
    steamAppid: null,
    summary: null,
    coverUrl: null,
    releaseDate: null,
    rating: null,
    platforms: [8],
    genres: null,
    publishers: null,
    developers: null,
    screenshots: null,
    hidden: false,
    originalReleaseDate: null,
    releaseStatus: null,
    addedAt: null,
    completedAt: null,
  };
}

const importConfig: ImportConfig = {
  enablePostProcessing: true,
  autoUnpack: false,
  renamePattern: "{Title}",
  overwriteExisting: false,
  transferMode: "move",
  importPlatformIds: [],
  ignoredExtensions: [".nfo"],
  minFileSize: 0,
  libraryRoot: "/data",
};

function makeRommConfig(root: string): RomMConfig {
  return {
    enabled: true,
    libraryRoot: root,
    platformRoutingMode: "slug-subfolder",
    platformBindings: {},
    platformAliases: {},
    moveMode: "copy",
    conflictPolicy: "rename",
    folderNamingTemplate: "{title}",
    singleFilePlacement: "root",
    multiFilePlacement: "subfolder",
    includeRegionLanguageTags: false,
    allowAbsoluteBindings: false,
    bindingMissingBehavior: "fallback",
  };
}

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

    const absolute = resolveRommPlatformDir({
      libraryRoot: root,
      fsSlug: "ps2",
      routingMode: "binding-map",
      bindings: { ps2: "/custom/ps2" },
      allowAbsoluteBindings: true,
    });
    expect(absolute).toBe(path.resolve("/custom/ps2"));
  });

  it("imports multi-file sets together and resolves rename conflicts", async () => {
    const root = makeTempRoot();
    const source = path.join(root, "downloads", "game-folder");
    await fs.ensureDir(source);
    await fs.writeFile(path.join(source, "Game.cue"), "cue");
    await fs.writeFile(path.join(source, "Game.bin"), "bin");

    const romm = makeRommConfig(path.join(root, "library"));
    const strategy = new RomMImportStrategy("ps2");
    const plan = await strategy.planImport(
      source,
      makeGame("Mega Game"),
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
});
