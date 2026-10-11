// ArchiveService.extract() against a real filesystem, with only the archive tool calls
// faked out (CI has no 7z/unrar binary). Covers how extraction lands in a destination
// that already holds files — in production, the game's own folder in the library.
import { afterEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import fs from "fs-extra";
import os from "node:os";
import path from "node:path";
import { ArchiveService } from "../services/ArchiveService.js";

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

  it("clears a staging directory left behind by an interrupted extraction", async () => {
    const gameDir = await tempDir();
    const archive = path.join(await tempDir(), "game.zip");
    await fs.writeFile(archive, "zip-bytes");
    await fs.outputFile(path.join(gameDir, ".questarr-extract-game.zip", "stale.tmp"), "stale");

    const { service } = makeService({ "game.exe": "exe" });
    const files = await service.extract(archive, gameDir);

    expect(files).toEqual([path.join(gameDir, "game.exe")]);
    expect(await fs.readdir(gameDir)).toEqual(["game.exe"]);
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
