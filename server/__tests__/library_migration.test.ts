import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Game } from "../../shared/schema.js";
import { applyPlatformFolderRenames } from "../library-migration.js";

const tempRoots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "questarr-library-migration-test-"));
  tempRoots.push(root);
  return root;
}

async function exists(target: string): Promise<boolean> {
  return fs.stat(target).then(
    () => true,
    () => false
  );
}

function makeStorage(game: Game, files: Array<{ id: string; filePath: string }>) {
  const storedGame = { ...game };
  const storedFiles = new Map(files.map((file) => [file.id, { ...file }]));
  return {
    getGameFiles: vi.fn(async () => Array.from(storedFiles.values())),
    updateGame: vi.fn(async (_id: string, updates: Partial<Game>) => {
      Object.assign(storedGame, updates);
      return storedGame;
    }),
    updateGameFilePath: vi.fn(async (id: string, filePath: string) => {
      const file = storedFiles.get(id);
      if (!file) return undefined;
      file.filePath = filePath;
      return file;
    }),
  };
}

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))
  );
});

describe("library migration", () => {
  it("renames a platform folder and rewrites tracked paths", async () => {
    const root = await makeRoot();
    const oldPath = path.join(root, "PC");
    const oldGamePath = path.join(oldPath, "Game");
    const oldFilePath = path.join(oldGamePath, "game.nsp");
    await fs.mkdir(oldGamePath, { recursive: true });
    await fs.writeFile(oldFilePath, "game");

    const game = { id: "game-1", libraryPath: oldGamePath } as Game;
    const storage = makeStorage(game, [{ id: "file-1", filePath: oldFilePath }]);
    const results = await applyPlatformFolderRenames(
      root,
      [{ oldName: "PC", newName: "win", merge: false }],
      storage as never,
      [game]
    );

    expect(results).toEqual([
      expect.objectContaining({
        oldName: "PC",
        newName: "win",
        action: "rename",
        success: true,
        gamesUpdated: 1,
        filesUpdated: 1,
      }),
    ]);
    expect(await exists(oldPath)).toBe(false);
    expect(await exists(path.join(root, "win", "Game", "game.nsp"))).toBe(true);
    expect(storage.updateGame).toHaveBeenCalledWith("game-1", {
      libraryPath: path.join(root, "win", "Game"),
    });
    expect(storage.updateGameFilePath).toHaveBeenCalledWith(
      "file-1",
      path.join(root, "win", "Game", "game.nsp")
    );
  });

  it("restores the filesystem and database paths when persistence fails", async () => {
    const root = await makeRoot();
    const oldPath = path.join(root, "PC");
    const oldGamePath = path.join(oldPath, "Game");
    const oldFilePath = path.join(oldGamePath, "game.nsp");
    await fs.mkdir(oldGamePath, { recursive: true });
    await fs.writeFile(oldFilePath, "game");

    const game = { id: "game-1", libraryPath: oldGamePath } as Game;
    const storage = makeStorage(game, [{ id: "file-1", filePath: oldFilePath }]);
    storage.updateGameFilePath.mockImplementation(async (_id, filePath) => {
      if (filePath === path.join(root, "win", "Game", "game.nsp")) {
        throw new Error("database write failed");
      }
      return { id: "file-1", filePath };
    });

    const results = await applyPlatformFolderRenames(
      root,
      [{ oldName: "PC", newName: "win", merge: false }],
      storage as never,
      [game]
    );

    expect(results[0]).toMatchObject({ success: false, error: "database write failed" });
    expect(await exists(oldFilePath)).toBe(true);
    expect(await exists(path.join(root, "win"))).toBe(false);
    expect(storage.updateGame).toHaveBeenNthCalledWith(2, "game-1", {
      libraryPath: oldGamePath,
    });
  });

  it("rolls back a partial merge without deleting existing target files", async () => {
    const root = await makeRoot();
    const oldPath = path.join(root, "PC");
    const targetPath = path.join(root, "win");
    const oldGamePath = path.join(oldPath, "Game");
    const oldFilePath = path.join(oldGamePath, "game.nsp");
    const existingTargetFile = path.join(targetPath, "Existing", "keep.nsp");
    await fs.mkdir(oldGamePath, { recursive: true });
    await fs.mkdir(path.dirname(existingTargetFile), { recursive: true });
    await fs.writeFile(oldFilePath, "game");
    await fs.writeFile(existingTargetFile, "keep");

    const game = { id: "game-1", libraryPath: oldGamePath } as Game;
    const storage = makeStorage(game, [{ id: "file-1", filePath: oldFilePath }]);
    storage.updateGameFilePath.mockImplementation(async (_id, filePath) => {
      if (filePath === path.join(root, "win", "Game", "game.nsp")) {
        throw new Error("database write failed");
      }
      return { id: "file-1", filePath };
    });

    const results = await applyPlatformFolderRenames(
      root,
      [{ oldName: "PC", newName: "win", merge: true }],
      storage as never,
      [game]
    );

    expect(results[0]).toMatchObject({ success: false, error: "database write failed" });
    expect(await exists(oldFilePath)).toBe(true);
    expect(await exists(path.join(targetPath, "Game", "game.nsp"))).toBe(false);
    expect(await exists(existingTargetFile)).toBe(true);
  });

  it("rejects a stale proposal without changing disk or records", async () => {
    const root = await makeRoot();
    const oldPath = path.join(root, "PC");
    await fs.mkdir(oldPath, { recursive: true });
    const game = { id: "game-1", libraryPath: path.join(oldPath, "Game") } as Game;
    const storage = makeStorage(game, []);

    const results = await applyPlatformFolderRenames(
      root,
      [{ oldName: "PC", newName: "not-a-platform", merge: false }],
      storage as never,
      [game]
    );

    expect(results[0]).toMatchObject({
      success: false,
      error: "Migration proposal is stale; scan the library again",
    });
    expect(await exists(oldPath)).toBe(true);
    expect(storage.updateGame).not.toHaveBeenCalled();
    expect(storage.updateGameFilePath).not.toHaveBeenCalled();
  });
});
