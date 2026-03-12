import { afterEach, describe, expect, it } from "vitest";
import fs from "fs-extra";
import os from "os";
import path from "path";
import { PCImportStrategy, RomMImportStrategy } from "../services/ImportStrategies.js";
import type { Game, ImportConfig, RomMConfig } from "../../shared/schema.js";

const cleanup: string[] = [];

function tempDir(): string {
  const dir = path.join(
    os.tmpdir(),
    `questarr-import-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
  cleanup.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of cleanup.splice(0, cleanup.length)) {
    await fs.remove(dir);
  }
});

function makeGame(platforms: unknown): Game {
  return {
    id: "g1",
    title: "Test Game",
    status: "wanted",
    userId: null,
    igdbId: null,
    steamAppid: null,
    summary: null,
    coverUrl: null,
    releaseDate: null,
    rating: null,
    platforms: platforms as Game["platforms"],
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
  ignoredExtensions: [],
  minFileSize: 0,
  libraryRoot: "/data",
};

const rommConfig: RomMConfig = {
  enabled: true,
  libraryRoot: "/data/romm",
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

describe("ImportStrategies", () => {
  it("PCImportStrategy.canHandle detects IGDB platform id 6 across shapes", () => {
    const strategy = new PCImportStrategy();

    expect(strategy.canHandle(makeGame([6]))).toBe(true);
    expect(strategy.canHandle(makeGame(["6"]))).toBe(true);
    expect(strategy.canHandle(makeGame([{ id: 6 }]))).toBe(true);
    expect(strategy.canHandle(makeGame(["Nintendo Switch"]))).toBe(false);
  });

  it("RomMImportStrategy can place a single file under routed platform directory", async () => {
    const root = tempDir();
    const source = path.join(root, "downloads", "My.Game.rom");
    await fs.ensureDir(path.dirname(source));
    await fs.writeFile(source, "rom-bytes");

    const strategy = new RomMImportStrategy("snes");
    const localRomm: RomMConfig = { ...rommConfig, libraryRoot: path.join(root, "library") };

    const plan = await strategy.planImport(
      source,
      makeGame([19]),
      localRomm.libraryRoot,
      importConfig,
      localRomm
    );
    const result = await strategy.executeImport(plan, "copy", localRomm);

    expect(result.destDir).toContain(path.join("library", "snes"));
    expect(result.filesPlaced.some((p) => p.endsWith(path.join("My.Game.rom")))).toBe(true);
  });
});
