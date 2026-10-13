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

  it("stops after the entry budget is spent", async () => {
    await touch("a.zip");
    await touch("b/c.zip");
    expect(await primaries({ maxEntries: 1 })).toEqual(["a.zip"]);
  });
});
