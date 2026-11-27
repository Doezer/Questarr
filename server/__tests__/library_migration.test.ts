import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import fsExtra from "fs-extra";
import type { Game } from "../../shared/schema.js";
import { applyPlatformFolderRenames, findPlatformFolderRenames } from "../library-migration.js";

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
    updateLibraryPathsBatch: vi.fn(
      async (
        changes: Array<{ kind: "game" | "file"; id: string; oldPath: string; newPath: string }>
      ) => {
        for (const change of changes) {
          const current =
            change.kind === "game" ? storedGame.libraryPath : storedFiles.get(change.id)?.filePath;
          if (current !== change.oldPath) throw new Error("library path changed concurrently");
        }
        for (const change of changes) {
          if (change.kind === "game") storedGame.libraryPath = change.newPath;
          else storedFiles.get(change.id)!.filePath = change.newPath;
        }
      }
    ),
  };
}

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))
  );
});

describe("library migration", () => {
  it("plans aliases for the same platform as a rename followed by a merge", () => {
    expect(findPlatformFolderRenames(["PS Vita", "PSVita"])).toEqual([
      { oldName: "PS Vita", newName: "psvita", merge: false },
      { oldName: "PSVita", newName: "psvita", merge: true },
    ]);
  });

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
    expect(storage.updateLibraryPathsBatch).toHaveBeenCalledWith([
      {
        kind: "game",
        id: "game-1",
        oldPath: oldGamePath,
        newPath: path.join(root, "win", "Game"),
      },
      {
        kind: "file",
        id: "file-1",
        oldPath: oldFilePath,
        newPath: path.join(root, "win", "Game", "game.nsp"),
      },
    ]);
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
    storage.updateLibraryPathsBatch.mockRejectedValueOnce(new Error("database write failed"));

    const results = await applyPlatformFolderRenames(
      root,
      [{ oldName: "PC", newName: "win", merge: false }],
      storage as never,
      [game]
    );

    expect(results[0]).toMatchObject({ success: false, error: "database write failed" });
    expect(await exists(oldFilePath)).toBe(true);
    expect(await exists(path.join(root, "win"))).toBe(false);
    expect(storage.updateLibraryPathsBatch).toHaveBeenCalledTimes(1);
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
    storage.updateLibraryPathsBatch.mockRejectedValueOnce(new Error("database write failed"));

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

  it("preserves a destination created after merge preflight and restores earlier moves", async () => {
    const root = await makeRoot();
    const oldPath = path.join(root, "PC");
    const targetPath = path.join(root, "win");
    const oldGamePath = path.join(oldPath, "Game");
    const firstSource = path.join(oldGamePath, "a.nsp");
    const secondSource = path.join(oldGamePath, "z.nsp");
    await fs.mkdir(oldGamePath, { recursive: true });
    await fs.mkdir(targetPath, { recursive: true });
    await fs.writeFile(firstSource, "first source");
    await fs.writeFile(secondSource, "second source");

    let preflightChecks = 0;
    let collisionPath = "";
    const realPathExists = fsExtra.pathExists.bind(fsExtra);
    const pathExistsSpy = vi.spyOn(fsExtra, "pathExists").mockImplementation(async (target) => {
      const existsBeforeCheck = await realPathExists(target);
      const targetPathString = String(target);
      if (
        !existsBeforeCheck &&
        path.resolve(targetPathString).startsWith(path.resolve(targetPath) + path.sep) &&
        path.extname(targetPathString) === ".nsp"
      ) {
        preflightChecks += 1;
        if (preflightChecks === 2) {
          collisionPath = targetPathString;
          await fs.mkdir(path.dirname(collisionPath), { recursive: true });
          await fs.writeFile(collisionPath, "concurrent file");
        }
      }
      return existsBeforeCheck;
    });

    try {
      const storage = makeStorage({ id: "game-1", libraryPath: oldGamePath } as Game, []);
      const results = await applyPlatformFolderRenames(
        root,
        [{ oldName: "PC", newName: "win", merge: true }],
        storage as never,
        [{ id: "game-1", libraryPath: oldGamePath } as Game]
      );

      expect(results[0]).toMatchObject({ success: false });
      expect(results[0]?.error).toMatch(/target already contains/i);
      expect(await fs.readFile(firstSource, "utf8")).toBe("first source");
      expect(await fs.readFile(secondSource, "utf8")).toBe("second source");
      expect(await fs.readFile(collisionPath, "utf8")).toBe("concurrent file");
    } finally {
      pathExistsSpy.mockRestore();
    }
  });

  it.skipIf(process.platform === "win32")(
    "restores a dangling symlink when merge rollback restores its target first",
    async () => {
      const root = await makeRoot();
      const oldPath = path.join(root, "PC");
      const targetPath = path.join(root, "win");
      const oldGamePath = path.join(oldPath, "Game");
      const linkPath = path.join(oldGamePath, "a-link");
      const payloadPath = path.join(oldGamePath, "z-payload");
      await fs.mkdir(oldGamePath, { recursive: true });
      await fs.symlink("z-payload", linkPath);
      await fs.writeFile(payloadPath, "payload");

      const game = { id: "game-1", libraryPath: oldGamePath } as Game;
      const storage = makeStorage(game, []);
      storage.updateLibraryPathsBatch.mockRejectedValueOnce(new Error("database write failed"));

      const results = await applyPlatformFolderRenames(
        root,
        [{ oldName: "PC", newName: "win", merge: true }],
        storage as never,
        [game]
      );

      expect(results[0]).toMatchObject({ success: false, error: "database write failed" });
      expect(await fs.readFile(payloadPath, "utf8")).toBe("payload");
      const linkStats = await fs.lstat(linkPath);
      expect(linkStats.isSymbolicLink()).toBe(true);
      expect(await fs.readlink(linkPath)).toBe("z-payload");
      expect(await fs.lstat(path.join(targetPath, "Game", "a-link")).catch(() => null)).toBeNull();
    }
  );

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
