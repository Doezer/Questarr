import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import fs from "fs-extra";
import os from "node:os";
import path from "node:path";
import { ArchiveService } from "../services/ArchiveService.js";

describe("ArchiveService.findArchiveSets", () => {
  let root: string;
  const service = new ArchiveService();

  const touch = async (rel: string) => {
    const full = path.join(root, rel);
    await fs.ensureDir(path.dirname(full));
    await fs.writeFile(full, "x");
  };
  const primaries = async (options?: Parameters<ArchiveService["findArchiveSets"]>[1]) =>
    (await service.findArchiveSets(root, options))
      .map((s) => path.relative(root, s.primary))
      .sort();

  beforeEach(() => {
    root = path.join(os.tmpdir(), `questarr-sets-${Date.now()}-${randomBytes(6).toString("hex")}`);
  });
  afterEach(async () => {
    await fs.remove(root);
  });

  it("returns one set per multi-volume release, entered through its plain .rar", async () => {
    await touch("Game.rar");
    await touch("Game.r00");
    await touch("Game.r01");
    expect(await primaries()).toEqual(["Game.rar"]);
    const [set] = await service.findArchiveSets(root);
    expect(set?.volumes).toHaveLength(3);
  });

  it("keeps independent archive sets in the same folder apart", async () => {
    await touch("Game.7z.001");
    await touch("Game.7z.002");
    await touch("Extras.zip");
    expect(await primaries()).toEqual(["Extras.zip", "Game.7z.001"]);
  });

  it("finds archives in sub-folders and reports their folder", async () => {
    await touch("Disc1/data.zip");
    const [set] = await service.findArchiveSets(root);
    expect(set?.relDir).toBe("Disc1");
  });

  it("stops at the depth limit and ignores plain files and disc images", async () => {
    await touch("readme.txt");
    await touch("game.iso");
    await touch("a/b/c/d/deep.zip");
    expect(await primaries({ maxDepth: 3 })).toEqual([]);
    expect(await primaries({ maxDepth: 4 })).toEqual([path.join("a", "b", "c", "d", "deep.zip")]);
    expect(await primaries({ includeDiscImages: true, maxDepth: 0 })).toEqual(["game.iso"]);
  });

  it("does not follow symlinks and skips extraction staging folders", async () => {
    const outside = `${root}-outside`;
    await fs.ensureDir(outside);
    await fs.writeFile(path.join(outside, "hidden.zip"), "x");
    await fs.ensureDir(root);
    await fs.symlink(outside, path.join(root, "link"));
    await touch(".questarr-extract-abc/inner.zip");
    try {
      expect(await primaries()).toEqual([]);
    } finally {
      await fs.remove(outside);
    }
  });

  it("never looks at more entries than the budget in a single large folder", async () => {
    await touch("a.zip");
    await touch("b.zip");
    await touch("c.zip");
    expect((await primaries({ maxEntries: 2 })).length).toBe(2);
  });

  it("stops after the entry budget is spent", async () => {
    await touch("a.zip");
    await touch("b/c.zip");
    // Only one entry of the root directory is read, so at most one of its names is looked at.
    expect((await primaries({ maxEntries: 1 })).length).toBeLessThanOrEqual(1);
  });

  it("reads inside a huge directory only up to the budget", async () => {
    for (let i = 0; i < 20; i++) await touch(`f${i}.zip`);
    expect((await primaries({ maxEntries: 5 })).length).toBe(5);
  });

  it("does not follow a symlinked root and handles a single archive file", async () => {
    await touch("real/a.zip");
    await fs.symlink(path.join(root, "real"), path.join(root, "link"));
    const svc = new ArchiveService();
    expect(await svc.findArchiveSets(path.join(root, "link"))).toEqual([]);
    const single = await svc.findArchiveSets(path.join(root, "real", "a.zip"));
    expect(single.map((s) => path.basename(s.primary))).toEqual(["a.zip"]);
  });
});
