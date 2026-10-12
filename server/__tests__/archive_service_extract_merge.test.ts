// ArchiveService.extract() against a real filesystem, with only the archive tool calls
// faked out (CI has no 7z/unrar binary). Covers how extraction lands in a destination
// that already holds files — in production, the game's own folder in the library.
import { afterEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import fs from "fs-extra";
import os from "node:os";
import path from "node:path";
import { ArchiveService } from "../services/ArchiveService.js";
import { logger } from "../logger.js";

const cleanup: string[] = [];

async function tempDir(): Promise<string> {
  const dir = path.join(
    os.tmpdir(),
    `questarr-extract-merge-${Date.now()}-${randomBytes(8).toString("hex")}`
  );
  cleanup.push(dir);
  await fs.ensureDir(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of cleanup.splice(0, cleanup.length)) {
    await fs.remove(dir);
  }
  vi.restoreAllMocks();
});

interface ArchiveServiceInternals {
  listEntriesForExtraction: (filePath: string, password?: string) => Promise<unknown[]>;
  testArchive: (...args: unknown[]) => Promise<void>;
  extractWith7zip: (filePath: string, outputDir: string, password?: string) => Promise<void>;
}

// Fakes the 7-Zip run by writing `files` into whatever directory extract() asks the tool
// to unpack into, or by writing some of them then failing when `failAfterWriting` is set.
function makeService(files: Record<string, string>, options: { failAfterWriting?: boolean } = {}) {
  const service = new ArchiveService();
  const internals = service as unknown as ArchiveServiceInternals;
  vi.spyOn(internals, "listEntriesForExtraction").mockResolvedValue([]);
  vi.spyOn(internals, "testArchive").mockResolvedValue(undefined);
  const toolSpy = vi
    .spyOn(internals, "extractWith7zip")
    .mockImplementation(async (_filePath: string, outputDir: string) => {
      for (const [rel, content] of Object.entries(files)) {
        const dest = path.join(outputDir, rel);
        await fs.ensureDir(path.dirname(dest));
        await fs.writeFile(dest, content);
      }
      if (options.failAfterWriting) throw new Error("exit code 2: CRC failed");
    });
  return { service, toolSpy };
}

describe("ArchiveService.extract into a non-empty destination", () => {
  it("keeps an installed game's files when extracting an update into its folder", async () => {
    // Regression test: extract() used to empty outputDir before unpacking. Confirming an
    // import of a patch into the existing game folder (/data/PC/Foo) wiped the installed
    // game and left only the patch's files.
    const gameDir = await tempDir();
    await fs.outputFile(path.join(gameDir, "game.exe"), "installed-exe");
    await fs.outputFile(path.join(gameDir, "Data", "level1.pak"), "level1");
    await fs.outputFile(path.join(gameDir, "Data", "level2.pak"), "level2-old");
    await fs.outputFile(path.join(gameDir, "saves", "slot1.sav"), "my-save");
    const downloads = await tempDir();
    const archive = path.join(downloads, "Foo.Update.v1.1.zip");
    await fs.writeFile(archive, "zip-bytes");

    const { service } = makeService({
      "Data/level2.pak": "level2-new",
      "Data/level3.pak": "level3",
      "patch-notes.txt": "notes",
    });

    const files = await service.extract(archive, gameDir);

    // Untouched files survive.
    expect(await fs.readFile(path.join(gameDir, "game.exe"), "utf8")).toBe("installed-exe");
    expect(await fs.readFile(path.join(gameDir, "Data", "level1.pak"), "utf8")).toBe("level1");
    expect(await fs.readFile(path.join(gameDir, "saves", "slot1.sav"), "utf8")).toBe("my-save");
    // The update's files are added or replace their older versions.
    expect(await fs.readFile(path.join(gameDir, "Data", "level2.pak"), "utf8")).toBe("level2-new");
    expect(await fs.readFile(path.join(gameDir, "Data", "level3.pak"), "utf8")).toBe("level3");
    // Only what the archive shipped is reported, at its final path.
    expect(files.sort()).toEqual(
      [
        path.join(gameDir, "Data", "level2.pak"),
        path.join(gameDir, "Data", "level3.pak"),
        path.join(gameDir, "patch-notes.txt"),
      ].sort()
    );
    // No staging directory is left behind.
    expect((await fs.readdir(gameDir)).filter((name) => name.startsWith("."))).toEqual([]);
  });

  it("keeps sibling games when the destination is a whole platform folder", async () => {
    const platformDir = await tempDir();
    await fs.outputFile(path.join(platformDir, "Other Game", "other.exe"), "other");
    const archive = path.join(await tempDir(), "foo.zip");
    await fs.writeFile(archive, "zip-bytes");

    const { service } = makeService({ "Foo/foo.exe": "foo" });
    await service.extract(archive, platformDir);

    expect(await fs.readFile(path.join(platformDir, "Other Game", "other.exe"), "utf8")).toBe(
      "other"
    );
    expect(await fs.readFile(path.join(platformDir, "Foo", "foo.exe"), "utf8")).toBe("foo");
  });

  it("leaves the installed game untouched when extraction fails part-way", async () => {
    const gameDir = await tempDir();
    await fs.outputFile(path.join(gameDir, "Data", "level2.pak"), "level2-old");
    const archive = path.join(await tempDir(), "update.zip");
    await fs.writeFile(archive, "zip-bytes");

    const { service } = makeService(
      { "Data/level2.pak": "level2-truncated" },
      { failAfterWriting: true }
    );

    await expect(service.extract(archive, gameDir)).rejects.toThrow("CRC failed");
    expect(await fs.readFile(path.join(gameDir, "Data", "level2.pak"), "utf8")).toBe("level2-old");
    expect(await fs.readdir(gameDir)).toEqual(["Data"]);
  });

  it("keeps the archive and its volumes when they were relocated into the destination", async () => {
    // move/copy import modes put the archive family in outputDir before extracting.
    const gameDir = await tempDir();
    await fs.writeFile(path.join(gameDir, "game.7z.001"), "vol1");
    await fs.writeFile(path.join(gameDir, "game.7z.002"), "vol2");
    await fs.writeFile(path.join(gameDir, "readme.nfo"), "nfo");

    const { service, toolSpy } = makeService({ "game.exe": "exe" });
    await service.extract(path.join(gameDir, "game.7z.001"), gameDir);

    expect((await fs.readdir(gameDir)).sort()).toEqual(
      ["game.7z.001", "game.7z.002", "game.exe", "readme.nfo"].sort()
    );
    // The tool unpacked into a staging directory, not over the volumes it was reading.
    expect(toolSpy.mock.calls[0]?.[1]).not.toBe(gameDir);
  });

  it("gives concurrent extractions into the same folder separate staging directories", async () => {
    const gameDir = await tempDir();
    const archive = path.join(await tempDir(), "game.zip");
    await fs.writeFile(archive, "zip-bytes");

    const first = makeService({ "a.txt": "a" });
    const second = makeService({ "b.txt": "b" });
    await Promise.all([
      first.service.extract(archive, gameDir),
      second.service.extract(archive, gameDir),
    ]);

    expect(first.toolSpy.mock.calls[0]?.[1]).not.toBe(second.toolSpy.mock.calls[0]?.[1]);
    expect((await fs.readdir(gameDir)).sort()).toEqual(["a.txt", "b.txt"]);
  });

  it("refuses to replace an existing directory with a file of the same name", async () => {
    const gameDir = await tempDir();
    await fs.outputFile(path.join(gameDir, "Data", "level1.pak"), "level1");
    const archive = path.join(await tempDir(), "odd.zip");
    await fs.writeFile(archive, "zip-bytes");

    const { service } = makeService({ Data: "not-a-directory" });

    await expect(service.extract(archive, gameDir)).rejects.toThrow("existing directory");
    expect(await fs.readFile(path.join(gameDir, "Data", "level1.pak"), "utf8")).toBe("level1");
  });
});

describe("ArchiveService.extract conflict checks", () => {
  it("checks every conflict before replacing any file", async () => {
    const gameDir = await tempDir();
    await fs.outputFile(path.join(gameDir, "a.pak"), "a-old");
    await fs.outputFile(path.join(gameDir, "z", "keep.txt"), "keep");
    const archive = path.join(await tempDir(), "update.zip");
    await fs.writeFile(archive, "zip-bytes");

    // a.pak would merge fine, but "z" clashes with an existing directory.
    const { service } = makeService({ "a.pak": "a-new", z: "file" });

    await expect(service.extract(archive, gameDir)).rejects.toThrow("existing directory");
    expect(await fs.readFile(path.join(gameDir, "a.pak"), "utf8")).toBe("a-old");
  });

  it("refuses to descend into a symlinked directory in the destination", async () => {
    const gameDir = await tempDir();
    const outside = await tempDir();
    await fs.outputFile(path.join(outside, "victim.txt"), "untouched");
    await fs.symlink(outside, path.join(gameDir, "Data"), "dir");
    const archive = path.join(await tempDir(), "update.zip");
    await fs.writeFile(archive, "zip-bytes");

    const { service } = makeService({ "Data/victim.txt": "overwritten" });

    await expect(service.extract(archive, gameDir)).rejects.toThrow("symbolic link");
    expect(await fs.readFile(path.join(outside, "victim.txt"), "utf8")).toBe("untouched");
  });

  it("rejects an archive entry named like the staging directory", async () => {
    const gameDir = await tempDir();
    const archive = path.join(await tempDir(), "foo.zip");
    await fs.writeFile(archive, "zip-bytes");

    const { service } = makeService({ ".questarr-extract-foo.zip/game.exe": "exe" });

    // The archive's own folder lands inside the real staging dir, so its top-level
    // entry is the reserved name.
    await expect(service.extract(archive, gameDir)).rejects.toThrow("reserved");
    expect(await fs.readdir(gameDir)).toEqual([]);
  });
});

describe("ArchiveService.extract rollback", () => {
  it("restores replaced files and removes added ones when a move fails part-way", async () => {
    const gameDir = await tempDir();
    await fs.outputFile(path.join(gameDir, "a.pak"), "a-old");
    await fs.outputFile(path.join(gameDir, "b.pak"), "b-old");
    const archive = path.join(await tempDir(), "update.zip");
    await fs.writeFile(archive, "zip-bytes");

    const { service } = makeService({
      "a.pak": "a-new",
      "new/added.txt": "added",
      "b.pak": "b-new",
    });
    const realRename = fs.rename.bind(fs);
    vi.spyOn(fs, "rename").mockImplementation((async (src: string, dest: string) => {
      // The staged b.pak can't land; the rollback's own renames must still work.
      if (dest === path.join(gameDir, "b.pak") && !src.includes(".bak")) {
        throw new Error("EIO: i/o error");
      }
      return realRename(src, dest);
    }) as never);

    await expect(service.extract(archive, gameDir)).rejects.toThrow("EIO");

    expect(await fs.readFile(path.join(gameDir, "a.pak"), "utf8")).toBe("a-old");
    expect(await fs.readFile(path.join(gameDir, "b.pak"), "utf8")).toBe("b-old");
    expect((await fs.readdir(gameDir)).sort()).toEqual(["a.pak", "b.pak"]);
  });

  it("never removes a file another import put at a new path when its own move fails", async () => {
    const gameDir = await tempDir();
    const archive = path.join(await tempDir(), "update.zip");
    await fs.writeFile(archive, "zip-bytes");

    const { service } = makeService({ "new.txt": "ours" });
    const realMove = fs.move.bind(fs);
    vi.spyOn(fs, "move").mockImplementation((async (src: string, dest: string, opts?: object) => {
      if (dest === path.join(gameDir, "new.txt")) {
        // A concurrent import lands the same path first.
        await fs.writeFile(dest, "theirs");
        throw new Error("EEXIST: file already exists");
      }
      return realMove(src, dest, opts);
    }) as never);

    await expect(service.extract(archive, gameDir)).rejects.toThrow("EEXIST");
    expect(await fs.readFile(path.join(gameDir, "new.txt"), "utf8")).toBe("theirs");
  });

  it("uses a short staging name so long archive names still extract", async () => {
    const gameDir = await tempDir();
    const archive = path.join(await tempDir(), `${"A".repeat(240)}.zip`);
    await fs.writeFile(archive, "zip-bytes");

    const { service } = makeService({ "game.exe": "exe" });
    await service.extract(archive, gameDir);

    expect(await fs.readdir(gameDir)).toEqual(["game.exe"]);
  });

  it("keeps the backup of an original it could not restore and says where", async () => {
    const gameDir = await tempDir();
    await fs.outputFile(path.join(gameDir, "a.pak"), "a-old");
    await fs.outputFile(path.join(gameDir, "b.pak"), "b-old");
    const archive = path.join(await tempDir(), "update.zip");
    await fs.writeFile(archive, "zip-bytes");

    const { service } = makeService({ "a.pak": "a-new", "b.pak": "b-new" });
    const realRename = fs.rename.bind(fs);
    vi.spyOn(fs, "rename").mockImplementation((async (src: string, dest: string) => {
      // The staged b.pak can't land, and neither can a.pak's original going back.
      if (dest === path.join(gameDir, "b.pak") && !src.includes(".bak")) {
        throw new Error("EIO: i/o error");
      }
      if (dest === path.join(gameDir, "a.pak") && src.includes(".bak")) {
        throw new Error("EACCES: permission denied");
      }
      return realRename(src, dest);
    }) as never);

    const error = await service.extract(archive, gameDir).catch((err: Error) => err);

    expect(String(error)).toMatch(/rollback incomplete/);
    const kept = (await fs.readdir(gameDir)).find((name) => name.endsWith(".bak"));
    expect(kept).toBeDefined();
    const keptFiles = await fs.readdir(path.join(gameDir, kept as string));
    const contents = await Promise.all(
      keptFiles.map((name) => fs.readFile(path.join(gameDir, kept as string, name), "utf8"))
    );
    expect(contents).toContain("a-old");
    // b.pak's original was never moved away.
    expect(await fs.readFile(path.join(gameDir, "b.pak"), "utf8")).toBe("b-old");
  });

  it("never leaves an installed file missing between backup and replacement", async () => {
    const gameDir = await tempDir();
    await fs.outputFile(path.join(gameDir, "a.pak"), "a-old");
    const archive = path.join(await tempDir(), "update.zip");
    await fs.writeFile(archive, "zip-bytes");

    const { service } = makeService({ "a.pak": "a-new" });
    const seen: string[] = [];
    const realRename = fs.rename.bind(fs);
    vi.spyOn(fs, "rename").mockImplementation((async (src: string, dest: string) => {
      // Just before the replacement lands (where a crash would hit), the original is there.
      if (dest === path.join(gameDir, "a.pak")) seen.push(await fs.readFile(dest, "utf8"));
      return realRename(src, dest);
    }) as never);

    await service.extract(archive, gameDir);

    expect(seen).toEqual(["a-old"]);
    expect(await fs.readFile(path.join(gameDir, "a.pak"), "utf8")).toBe("a-new");
    expect(await fs.readdir(gameDir)).toEqual(["a.pak"]);
  });

  it("leaves no partial backup behind when the backup copy fails", async () => {
    const gameDir = await tempDir();
    await fs.outputFile(path.join(gameDir, "a.pak"), "a-old");
    const archive = path.join(await tempDir(), "update.zip");
    await fs.writeFile(archive, "zip-bytes");

    const { service } = makeService({ "a.pak": "a-new" });
    // Linking is impossible (e.g. a filesystem without hard links) and the copy fallback
    // dies after writing part of the file.
    vi.spyOn(fs, "link").mockRejectedValue(new Error("EPERM: operation not permitted"));
    vi.spyOn(fs, "copy").mockImplementation((async (_src: string, dest: string) => {
      await fs.outputFile(dest, "a-o");
      throw new Error("ENOSPC: no space left on device");
    }) as never);

    await expect(service.extract(archive, gameDir)).rejects.toThrow(/ENOSPC/);

    expect(await fs.readdir(gameDir)).toEqual(["a.pak"]);
    expect(await fs.readFile(path.join(gameDir, "a.pak"), "utf8")).toBe("a-old");
  });

  it("reports a backup directory it could not clean up after a successful merge", async () => {
    const gameDir = await tempDir();
    await fs.outputFile(path.join(gameDir, "a.pak"), "a-old");
    const archive = path.join(await tempDir(), "update.zip");
    await fs.writeFile(archive, "zip-bytes");

    const { service } = makeService({ "a.pak": "a-new" });
    const warn = vi.spyOn(logger, "warn");
    const realRemove = fs.remove.bind(fs);
    vi.spyOn(fs, "remove").mockImplementation((async (dir: string) => {
      if (dir.endsWith(".bak")) throw new Error("EBUSY: resource busy");
      return realRemove(dir);
    }) as never);

    await service.extract(archive, gameDir);

    const kept = (await fs.readdir(gameDir)).find((name) => name.endsWith(".bak"));
    expect(kept).toBeDefined();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ dir: path.join(gameDir, kept as string) }),
      expect.stringContaining("backup directory")
    );
  });

  it("names the extracted files it could not remove when rolling back", async () => {
    const gameDir = await tempDir();
    await fs.outputFile(path.join(gameDir, "b.pak"), "b-old");
    const archive = path.join(await tempDir(), "update.zip");
    await fs.writeFile(archive, "zip-bytes");

    const { service } = makeService({ "a.pak": "a-new", "b.pak": "b-new" });
    const added = path.join(gameDir, "a.pak");
    vi.spyOn(fs, "rename").mockRejectedValue(new Error("EIO: i/o error"));
    const realRemove = fs.remove.bind(fs);
    vi.spyOn(fs, "remove").mockImplementation((async (target: string) => {
      if (target === added) throw new Error("EACCES: permission denied");
      return realRemove(target);
    }) as never);

    const error = await service.extract(archive, gameDir).catch((err: Error) => err);

    expect(String(error)).toMatch(/rollback incomplete/);
    expect(String(error)).toContain(added);
    expect(String(error)).not.toMatch(/kept in/);
    expect(await fs.readFile(path.join(gameDir, "b.pak"), "utf8")).toBe("b-old");
  });

  it("reports a backup it could not drop after a failed replacement", async () => {
    const gameDir = await tempDir();
    await fs.outputFile(path.join(gameDir, "a.pak"), "a-old");
    const archive = path.join(await tempDir(), "update.zip");
    await fs.writeFile(archive, "zip-bytes");

    const { service } = makeService({ "a.pak": "a-new" });
    const warn = vi.spyOn(logger, "warn");
    vi.spyOn(fs, "rename").mockRejectedValue(new Error("EIO: i/o error"));
    const realRemove = fs.remove.bind(fs);
    vi.spyOn(fs, "remove").mockImplementation((async (target: string) => {
      if (target.includes(".bak")) throw new Error("EACCES: permission denied");
      return realRemove(target);
    }) as never);

    await expect(service.extract(archive, gameDir)).rejects.toThrow(/EIO/);

    const kept = (await fs.readdir(gameDir)).find((name) => name.endsWith(".bak"));
    expect(kept).toBeDefined();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ dir: path.join(gameDir, kept as string) }),
      expect.stringContaining("backup directory")
    );
    expect(await fs.readFile(path.join(gameDir, "a.pak"), "utf8")).toBe("a-old");
  });
});
