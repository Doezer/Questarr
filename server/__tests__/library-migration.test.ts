import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyPlatformFolderRenames,
  findPlatformFolderRenames,
  replacePathPrefix,
  scanPlatformFolderRenames,
} from "../library-migration.js";
import type { IStorage } from "../storage.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))
  );
});

describe("findPlatformFolderRenames", () => {
  it("matches legacy names case-insensitively and reports merge targets", () => {
    expect(findPlatformFolderRenames(["sNeS", "snes", "Unrelated"])).toEqual([
      { oldName: "sNeS", newName: "snes", merge: true },
    ]);
  });

  it("does not propose a folder that already has the target name", () => {
    expect(findPlatformFolderRenames(["snes", "Other"])).toEqual([]);
  });
});

describe("replacePathPrefix", () => {
  it("rewrites descendants but not prefix-sharing siblings", () => {
    expect(
      replacePathPrefix("/library/SNES/Hades/game.sfc", "/library/SNES", "/library/snes")
    ).toBe(path.resolve("/library/snes/Hades/game.sfc"));
    expect(
      replacePathPrefix("/library/SNES-archive/Hades", "/library/SNES", "/library/snes")
    ).toBeNull();
  });
});

describe("scan and apply", () => {
  it("scans the root and updates stored game/file paths after a rename", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "questarr-library-migration-"));
    tempRoots.push(root);
    await fs.mkdir(path.join(root, "SNES", "Hades"), { recursive: true });
    await fs.writeFile(path.join(root, "SNES", "Hades", "game.sfc"), "rom");

    const renames = await scanPlatformFolderRenames(root);
    expect(renames).toEqual([{ oldName: "SNES", newName: "snes", merge: false }]);

    const storage = {
      getGameFiles: vi
        .fn()
        .mockResolvedValue([
          { id: "file-1", filePath: path.join(root, "SNES", "Hades", "game.sfc") },
        ]),
      updateGame: vi.fn().mockResolvedValue(undefined),
      updateGameFilePath: vi.fn().mockResolvedValue(undefined),
    } as unknown as IStorage;
    const games = [{ id: "game-1", libraryPath: path.join(root, "SNES", "Hades") }] as never[];

    const results = await applyPlatformFolderRenames(root, renames, storage, games as never);
    expect(results).toEqual([
      expect.objectContaining({
        oldName: "SNES",
        newName: "snes",
        action: "rename",
        success: true,
        gamesUpdated: 1,
        filesUpdated: 1,
      }),
    ]);
    expect(await fs.stat(path.join(root, "snes", "Hades", "game.sfc"))).toBeTruthy();
    expect(storage.updateGame).toHaveBeenCalledWith("game-1", {
      libraryPath: path.join(root, "snes", "Hades"),
    });
    expect(storage.updateGameFilePath).toHaveBeenCalledWith(
      "file-1",
      path.join(root, "snes", "Hades", "game.sfc")
    );
  });

  it("rejects stale requests instead of trusting arbitrary folder names", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "questarr-library-migration-"));
    tempRoots.push(root);
    await fs.mkdir(path.join(root, "SNES"));
    const storage = {
      getGameFiles: vi.fn().mockResolvedValue([]),
      updateGame: vi.fn(),
      updateGameFilePath: vi.fn(),
    } as unknown as IStorage;

    const results = await applyPlatformFolderRenames(
      root,
      [{ oldName: "../outside", newName: "snes", merge: false }],
      storage,
      []
    );
    expect(results[0]).toMatchObject({ success: false });
    expect(storage.updateGame).not.toHaveBeenCalled();
  });

  it("refuses merge conflicts without deleting the source", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "questarr-library-migration-"));
    tempRoots.push(root);
    await fs.mkdir(path.join(root, "PlayStation"), { recursive: true });
    await fs.mkdir(path.join(root, "psx"), { recursive: true });
    await fs.writeFile(path.join(root, "PlayStation", "same.bin"), "old");
    await fs.writeFile(path.join(root, "psx", "same.bin"), "new");
    const storage = {
      getGameFiles: vi.fn().mockResolvedValue([]),
      updateGame: vi.fn(),
      updateGameFilePath: vi.fn(),
    } as unknown as IStorage;

    const results = await applyPlatformFolderRenames(
      root,
      [{ oldName: "PlayStation", newName: "psx", merge: true }],
      storage,
      []
    );
    expect(results[0]).toMatchObject({ success: false, action: "merge" });
    expect(await fs.readFile(path.join(root, "PlayStation", "same.bin"), "utf8")).toBe("old");
  });
});
