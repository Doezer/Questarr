// Replacing the version a game already has in the library when a new one is imported
// (Questarr-mgmt#98). Real filesystem: the point is what is left on disk.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import fs from "fs-extra";
import os from "node:os";
import path from "node:path";
import { ImportManager } from "../services/ImportManager.js";
import { ArchiveService } from "../services/ArchiveService.js";
import {
  REPLACED_ARCHIVE_DIR,
  disposeOldVersion,
  planUpgradeReplacement,
  restoreOldVersion,
  setOldVersionAside,
} from "../services/upgrade-replace.js";
import { makeGame, makeImportConfig } from "./helpers/import-test-helpers.js";
import type { ImportConfig } from "../../shared/schema.js";

vi.mock("../socket.js", () => ({ notifyUser: vi.fn() }));
vi.mock("../romm.js", () => ({
  isRommPlatformFoldersEnabled: vi.fn().mockResolvedValue(false),
  requestRommScanAfterImport: vi.fn(),
}));
vi.mock("../webhooks.js", () => ({ emitWebhookEvent: vi.fn() }));

let base: string;
let libraryRoot: string;
let downloads: string;

beforeEach(async () => {
  base = path.join(os.tmpdir(), `questarr-replace-${Date.now()}-${randomBytes(8).toString("hex")}`);
  libraryRoot = path.join(base, "library");
  downloads = path.join(base, "downloads");
  await fs.ensureDir(libraryRoot);
  await fs.ensureDir(downloads);
});

afterEach(async () => {
  await fs.remove(base);
  vi.restoreAllMocks();
});

async function writeTree(dir: string, files: Record<string, string>): Promise<string> {
  for (const [rel, content] of Object.entries(files)) {
    await fs.outputFile(path.join(dir, rel), content);
  }
  return dir;
}

const read = (file: string) => fs.readFile(file, "utf8");

describe("planUpgradeReplacement", () => {
  const plan = (overrides: Partial<Parameters<typeof planUpgradeReplacement>[0]> = {}) =>
    planUpgradeReplacement({
      mode: "archive",
      libraryRoot,
      oldLibraryPath: path.join(libraryRoot, "PC", "My Game"),
      newPath: path.join(libraryRoot, "PC", "My Game"),
      sourcePath: path.join(downloads, "My.Game.v2-GRP"),
      ...overrides,
    });

  beforeEach(async () => {
    await writeTree(path.join(libraryRoot, "PC", "My Game"), { "game.exe": "v1" });
  });

  it("replaces a game folder of the library, in place or side by side", async () => {
    expect(await plan()).toMatchObject({ samePath: true, mode: "archive" });
    expect(await plan({ newPath: path.join(libraryRoot, "PC", "My Game v2") })).toMatchObject({
      samePath: false,
    });
  });

  it("does nothing when the mode is off or the game has no files in the library", async () => {
    expect(await plan({ mode: "off" })).toBeNull();
    expect(await plan({ oldLibraryPath: null })).toBeNull();
    expect(await plan({ oldLibraryPath: path.join(libraryRoot, "PC", "Gone") })).toBeNull();
  });

  it("never touches the library root, a platform folder or a path outside the library", async () => {
    expect(await plan({ oldLibraryPath: libraryRoot })).toBeNull();
    expect(await plan({ oldLibraryPath: path.join(libraryRoot, "PC") })).toBeNull();
    await writeTree(path.join(base, "elsewhere", "PC", "My Game"), { "game.exe": "v1" });
    expect(
      await plan({ oldLibraryPath: path.join(base, "elsewhere", "PC", "My Game") })
    ).toBeNull();
    expect(
      await plan({ oldLibraryPath: path.join(libraryRoot, "..", "library", "..", "x", "y") })
    ).toBeNull();
  });

  it("is not fooled by a folder whose name starts like the library root", async () => {
    const lookalike = path.join(base, "library-backup", "PC", "My Game");
    await writeTree(lookalike, { "game.exe": "v1" });
    expect(await plan({ oldLibraryPath: lookalike })).toBeNull();
  });

  it("does nothing when a symlink makes the old and the new folder one directory", async () => {
    const alias = path.join(libraryRoot, "PC", "My Game 2.0");
    await fs.symlink(path.join(libraryRoot, "PC", "My Game"), alias, "dir");

    expect(await plan({ mode: "delete", newPath: alias })).toBeNull();
    expect(await plan({ mode: "delete", newPath: path.join(alias, "sub") })).toBeNull();
  });

  it("stops when only the set-aside copy of an interrupted replacement is left", async () => {
    const old = path.join(libraryRoot, "PC", "My Game");
    await fs.rename(old, path.join(libraryRoot, "PC", ".questarr-old-My Game"));
    await expect(plan()).rejects.toThrow(/earlier replacement was interrupted/);
  });

  it("does nothing when the old version overlaps the import", async () => {
    const old = path.join(libraryRoot, "PC", "My Game");
    // Imported in place: the download is the library folder.
    expect(await plan({ sourcePath: old })).toBeNull();
    expect(await plan({ sourcePath: path.join(old, "sub") })).toBeNull();
    // New version nested in the old one, and the reverse.
    expect(await plan({ newPath: path.join(old, "v2") })).toBeNull();
    // A child whose name merely starts with two dots is still inside.
    expect(await plan({ newPath: path.join(old, "..v2") })).toBeNull();
    expect(await plan({ newPath: path.join(libraryRoot, "PC") })).toBeNull();
  });
});

describe("old version lifecycle", () => {
  const old = () => path.join(libraryRoot, "PC", "My Game");

  beforeEach(async () => {
    await writeTree(old(), { "game.exe": "v1", "saves/slot1": "save" });
  });

  const samePlace = async (mode: "archive" | "delete") => {
    const replacement = await planUpgradeReplacement({
      mode,
      libraryRoot,
      oldLibraryPath: old(),
      newPath: old(),
      sourcePath: path.join(downloads, "x"),
    });
    if (!replacement) throw new Error("expected a replacement");
    return replacement;
  };

  it("archives the old version under .questarr-replaced once the new one is in", async () => {
    const replacement = await samePlace("archive");
    await setOldVersionAside(replacement);
    expect(await fs.pathExists(old())).toBe(false);
    await writeTree(old(), { "game.exe": "v2" });

    const archived = await disposeOldVersion(replacement, new Date("2026-11-16T06:30:00.000Z"));

    expect(archived).toBe(
      path.join(libraryRoot, REPLACED_ARCHIVE_DIR, "My Game (2026-11-16T06-30-00-000Z)")
    );
    expect(await read(path.join(archived as string, "saves", "slot1"))).toBe("save");
    expect(await read(path.join(old(), "game.exe"))).toBe("v2");
    expect(await fs.readdir(path.join(libraryRoot, "PC"))).toEqual(["My Game"]);
  });

  it("deletes the old version in delete mode", async () => {
    const replacement = await samePlace("delete");
    await setOldVersionAside(replacement);
    await writeTree(old(), { "game.exe": "v2" });

    expect(await disposeOldVersion(replacement)).toBeNull();

    expect(await fs.readdir(path.join(libraryRoot, "PC"))).toEqual(["My Game"]);
    expect(await fs.pathExists(path.join(libraryRoot, REPLACED_ARCHIVE_DIR))).toBe(false);
  });

  it("restores the old version and drops a partial import", async () => {
    const replacement = await samePlace("delete");
    await setOldVersionAside(replacement);
    await writeTree(old(), { "half.bin": "partial" });

    expect(await restoreOldVersion(replacement, { keepPartial: false })).toBeNull();

    expect(await read(path.join(old(), "game.exe"))).toBe("v1");
    expect(await fs.pathExists(path.join(old(), "half.bin"))).toBe(false);
    expect(await fs.readdir(path.join(libraryRoot, "PC"))).toEqual(["My Game"]);
  });

  it("keeps a partial import next to the game when it is the only copy", async () => {
    const replacement = await samePlace("delete");
    await setOldVersionAside(replacement);
    await writeTree(old(), { "half.bin": "partial" });

    const keptAt = await restoreOldVersion(replacement, { keepPartial: true });

    expect(await read(path.join(old(), "game.exe"))).toBe("v1");
    expect(await read(path.join(keptAt as string, "half.bin"))).toBe("partial");
  });

  it("refuses to start when an interrupted replacement is still on disk", async () => {
    const first = await samePlace("archive");
    await setOldVersionAside(first);
    await writeTree(old(), { "game.exe": "v2" });

    const second = await samePlace("archive");
    await expect(setOldVersionAside(second)).rejects.toThrow(/earlier replacement was interrupted/);
    expect(await read(path.join(old(), "game.exe"))).toBe("v2");
  });
});

describe("ImportManager: replacing the installed version", () => {
  const RELEASE = "My.Game.v2.0-GRP";

  function setup(configOverrides: Partial<ImportConfig>, downloadOverrides = {}) {
    const game = makeGame({
      id: "g1",
      userId: "u1",
      title: "My Game",
      status: "owned",
      platforms: [6],
      libraryPath: path.join(libraryRoot, "PC", "My Game"),
      installedVersion: "1.0",
    });
    const storage = {
      getGameDownload: vi.fn().mockResolvedValue({
        id: "dl-1",
        gameId: "g1",
        downloaderId: "d1",
        downloadTitle: RELEASE,
        category: "main",
        ...downloadOverrides,
      }),
      getGame: vi.fn().mockResolvedValue(game),
      getImportConfig: vi.fn().mockResolvedValue(
        makeImportConfig({
          libraryRoot,
          transferMode: "copy",
          renamePattern: "{Title}",
          ...configOverrides,
        })
      ),
      getDownloader: vi.fn().mockResolvedValue(undefined),
      updateGameDownloadStatus: vi.fn().mockResolvedValue(undefined),
      updateGameStatus: vi.fn().mockResolvedValue(undefined),
      updateGame: vi.fn().mockResolvedValue(undefined),
      replaceGameInstalledVersion: vi.fn().mockResolvedValue(undefined),
      addNotification: vi.fn().mockImplementation(async (n) => ({ id: "n1", ...n })),
      addDownloadEvent: vi.fn().mockResolvedValue(undefined),
      getUserSettings: vi.fn().mockResolvedValue(undefined),
    };
    const pathService = {
      translatePath: vi.fn(async (p: string) => p),
      getConfiguredRoots: vi.fn().mockResolvedValue([]),
    };
    const manager = new ImportManager(
      storage as never, // NOSONAR
      pathService as never, // NOSONAR
      {} as never, // NOSONAR
      new ArchiveService()
    );
    return { manager, storage };
  }

  const oldDir = () => path.join(libraryRoot, "PC", "My Game");
  const statuses = (storage: ReturnType<typeof setup>["storage"]) =>
    storage.updateGameDownloadStatus.mock.calls.map((call) => call[1]);

  beforeEach(async () => {
    await writeTree(oldDir(), { "game.exe": "v1", "old-only.dll": "v1" });
    await writeTree(path.join(downloads, RELEASE), { "game.exe": "v2" });
  });

  it("off: an import to the folder of the installed version still waits for review", async () => {
    const { manager, storage } = setup({ upgradeReplaceMode: "off" });

    await manager.processImport("dl-1", path.join(downloads, RELEASE));

    expect(statuses(storage)).toContain("manual_review_required");
    expect(await read(path.join(oldDir(), "game.exe"))).toBe("v1");
    expect(storage.addDownloadEvent).not.toHaveBeenCalled();
  });

  it("archive: swaps the folder and moves the old version to .questarr-replaced", async () => {
    const { manager, storage } = setup({ upgradeReplaceMode: "archive" });

    await manager.processImport("dl-1", path.join(downloads, RELEASE));

    expect(statuses(storage).at(-1)).toBe("imported");
    expect(await read(path.join(oldDir(), "game.exe"))).toBe("v2");
    // A clean swap, not a merge: nothing of the old version is left in the game folder.
    expect(await fs.pathExists(path.join(oldDir(), "old-only.dll"))).toBe(false);
    expect(await fs.readdir(path.join(libraryRoot, "PC"))).toEqual(["My Game"]);
    const [archived] = await fs.readdir(path.join(libraryRoot, REPLACED_ARCHIVE_DIR));
    expect(archived).toMatch(/^My Game \(/);
    expect(
      await read(path.join(libraryRoot, REPLACED_ARCHIVE_DIR, archived as string, "old-only.dll"))
    ).toBe("v1");

    expect(storage.addDownloadEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "upgrade",
        gameId: "g1",
        releaseTitle: RELEASE,
        message: expect.stringContaining("the previous version was moved to"),
      })
    );
    expect(storage.addNotification).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Version replaced", type: "success" })
    );
  });

  it("delete: removes the old version once the new one is imported", async () => {
    const { manager, storage } = setup({ upgradeReplaceMode: "delete" });

    await manager.processImport("dl-1", path.join(downloads, RELEASE));

    expect(statuses(storage).at(-1)).toBe("imported");
    expect(await fs.readdir(oldDir())).toEqual(["game.exe"]);
    expect(await fs.readdir(libraryRoot)).toEqual(["PC"]);
    expect(storage.addDownloadEvent).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("was deleted") })
    );
  });

  it("side by side: cleans up the old folder after importing to a versioned one", async () => {
    const { manager, storage } = setup({
      upgradeReplaceMode: "delete",
      renamePattern: "{Title} {Version}",
    });

    await manager.processImport("dl-1", path.join(downloads, RELEASE));

    expect(statuses(storage).at(-1)).toBe("imported");
    const [imported] = await fs.readdir(path.join(libraryRoot, "PC"));
    expect(await fs.readdir(path.join(libraryRoot, "PC"))).toHaveLength(1);
    expect(imported).not.toBe("My Game");
    expect(await read(path.join(libraryRoot, "PC", imported as string, "game.exe"))).toBe("v2");
    expect(storage.updateGame).toHaveBeenCalledWith("g1", {
      libraryPath: path.join(libraryRoot, "PC", imported as string),
    });
  });

  it("puts the old version back when the import fails", async () => {
    const { manager, storage } = setup({ upgradeReplaceMode: "delete" });
    vi.spyOn(
      manager as unknown as { transferWithUnpack: () => Promise<never> },
      "transferWithUnpack"
    ).mockImplementation(async () => {
      await writeTree(oldDir(), { "half.bin": "partial" });
      throw new Error("disk full");
    });

    await manager.processImport("dl-1", path.join(downloads, RELEASE));

    expect(statuses(storage).at(-1)).toBe("manual_review_required");
    expect((await fs.readdir(oldDir())).sort()).toEqual(["game.exe", "old-only.dll"]);
    expect(await read(path.join(oldDir(), "game.exe"))).toBe("v1");
    expect(await fs.readdir(path.join(libraryRoot, "PC"))).toEqual(["My Game"]);
    expect(storage.addDownloadEvent).not.toHaveBeenCalled();
  });

  it("move mode: keeps the partial import and says where it is", async () => {
    const { manager, storage } = setup({ upgradeReplaceMode: "delete", transferMode: "move" });
    vi.spyOn(
      manager as unknown as { transferWithUnpack: () => Promise<never> },
      "transferWithUnpack"
    ).mockImplementation(async () => {
      await writeTree(oldDir(), { "game.part1.rar": "only copy" });
      throw new Error("extraction failed");
    });

    await manager.processImport("dl-1", path.join(downloads, RELEASE));

    expect(await read(path.join(oldDir(), "game.exe"))).toBe("v1");
    const kept = (await fs.readdir(path.join(libraryRoot, "PC"))).find((name) =>
      name.startsWith(".questarr-failed-My Game-")
    );
    expect(kept).toBeDefined();
    const keptPath = path.join(libraryRoot, "PC", kept as string);
    expect(await read(path.join(keptPath, "game.part1.rar"))).toBe("only copy");
    const [, status, reason] = storage.updateGameDownloadStatus.mock.calls.at(-1) ?? [];
    expect(status).toBe("manual_review_required");
    expect(reason).toContain("extraction failed");
    expect(reason).toContain(`kept at ${keptPath}`);
  });

  it("puts the old version back when recording the import fails after the transfer", async () => {
    const { manager, storage } = setup({ upgradeReplaceMode: "delete" });
    const game = await storage.getGame("g1");
    storage.getGame.mockResolvedValue({ ...game, status: "wanted" });
    storage.updateGameStatus.mockRejectedValue(new Error("database is locked"));

    await manager.processImport("dl-1", path.join(downloads, RELEASE));

    const [, status, reason] = storage.updateGameDownloadStatus.mock.calls.at(-1) ?? [];
    expect(status).toBe("manual_review_required");
    expect(reason).toContain("database is locked");
    expect((await fs.readdir(oldDir())).sort()).toEqual(["game.exe", "old-only.dll"]);
    expect(await read(path.join(oldDir(), "game.exe"))).toBe("v1");
    expect(await fs.readdir(path.join(libraryRoot, "PC"))).toEqual(["My Game"]);
    // Copy mode: the download itself is untouched and can be imported again.
    expect(await read(path.join(downloads, RELEASE, "game.exe"))).toBe("v2");
  });

  it("keeps the game on its previous folder when recording a side by side import fails", async () => {
    const { manager, storage } = setup({
      upgradeReplaceMode: "delete",
      renamePattern: "{Title} {Version}",
    });
    storage.getGame.mockResolvedValue({ ...(await storage.getGame("g1")), status: "wanted" });
    storage.updateGameStatus.mockRejectedValue(new Error("database is locked"));

    await manager.processImport("dl-1", path.join(downloads, RELEASE));

    expect(statuses(storage).at(-1)).toBe("manual_review_required");
    expect(storage.updateGame.mock.calls.at(-1)).toEqual(["g1", { libraryPath: oldDir() }]);
    expect(await read(path.join(oldDir(), "game.exe"))).toBe("v1");
  });

  it("applies the replacement to a manually confirmed import", async () => {
    const { manager, storage } = setup({ upgradeReplaceMode: "archive" });
    storage.getGameDownload.mockResolvedValue({
      id: "dl-1",
      gameId: "g1",
      downloaderId: "d1",
      downloadTitle: RELEASE,
      category: "main",
      status: "manual_review_required",
    });

    await manager.confirmImport("dl-1", {
      needsReview: false,
      strategy: "pc",
      originalPath: path.join(downloads, RELEASE),
      proposedPath: oldDir(),
    });

    expect(statuses(storage).at(-1)).toBe("imported");
    expect(await fs.readdir(oldDir())).toEqual(["game.exe"]);
    expect(await read(path.join(oldDir(), "game.exe"))).toBe("v2");
    const [archived] = await fs.readdir(path.join(libraryRoot, REPLACED_ARCHIVE_DIR));
    expect(
      await read(path.join(libraryRoot, REPLACED_ARCHIVE_DIR, archived as string, "old-only.dll"))
    ).toBe("v1");
    expect(storage.addDownloadEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "upgrade" })
    );
  });

  it("runs two imports of the same game one after the other", async () => {
    const { manager, storage } = setup({ upgradeReplaceMode: "delete" });
    const OTHER = "My.Game.v3.0-GRP";
    await writeTree(path.join(downloads, OTHER), { "game.exe": "v3" });
    storage.getGameDownload.mockImplementation(async (id: string) => ({
      id,
      gameId: "g1",
      downloaderId: "d1",
      downloadTitle: id === "dl-1" ? RELEASE : OTHER,
      category: "main",
    }));

    const order: string[] = [];
    const original = (
      manager as unknown as { transferWithUnpack: (...args: unknown[]) => Promise<unknown> }
    ).transferWithUnpack.bind(manager);
    vi.spyOn(
      manager as unknown as { transferWithUnpack: (...args: unknown[]) => Promise<unknown> },
      "transferWithUnpack"
    ).mockImplementation(async (...args: unknown[]) => {
      const source = (args[0] as { originalPath: string }).originalPath;
      order.push(`start ${path.basename(source)}`);
      // Leave time for the other import to barge in if nothing holds it back.
      await new Promise((resolve) => setTimeout(resolve, 40));
      const result = await original(...args);
      order.push(`end ${path.basename(source)}`);
      return result;
    });

    await Promise.all([
      manager.processImport("dl-1", path.join(downloads, RELEASE)),
      manager.processImport("dl-2", path.join(downloads, OTHER)),
    ]);

    expect(order).toEqual([`start ${RELEASE}`, `end ${RELEASE}`, `start ${OTHER}`, `end ${OTHER}`]);
    expect(await read(path.join(oldDir(), "game.exe"))).toBe("v3");
    expect(await fs.readdir(path.join(libraryRoot, "PC"))).toEqual(["My Game"]);
  });

  it("plans a queued import on the folder the previous import left", async () => {
    const { manager, storage } = setup({
      upgradeReplaceMode: "delete",
      renamePattern: "{Title} {Version}",
    });
    const OTHER = "My.Game.v3.0-GRP";
    await writeTree(path.join(downloads, OTHER), { "game.exe": "v3" });
    storage.getGameDownload.mockImplementation(async (id: string) => ({
      id,
      gameId: "g1",
      downloaderId: "d1",
      downloadTitle: id === "dl-1" ? RELEASE : OTHER,
      category: "main",
    }));
    // The game row follows what each import records, as the database would.
    let current = await storage.getGame("g1");
    storage.getGame.mockImplementation(async () => current);
    storage.updateGame.mockImplementation(async (_id: string, updates: object) => {
      current = { ...current, ...updates };
    });

    await Promise.all([
      manager.processImport("dl-1", path.join(downloads, RELEASE)),
      manager.processImport("dl-2", path.join(downloads, OTHER)),
    ]);

    const folders = await fs.readdir(path.join(libraryRoot, "PC"));
    expect(folders).toHaveLength(1);
    expect(await read(path.join(libraryRoot, "PC", folders[0] as string, "game.exe"))).toBe("v3");
  });

  it("leaves the installed version alone for a DLC or an update", async () => {
    const { manager, storage } = setup(
      { upgradeReplaceMode: "delete" },
      { downloadTitle: "My.Game.Update.v2.0-GRP", category: "update" }
    );

    await manager.processImport("dl-1", path.join(downloads, RELEASE));

    expect(statuses(storage)).toContain("manual_review_required");
    expect((await fs.readdir(oldDir())).sort()).toEqual(["game.exe", "old-only.dll"]);
    expect(storage.addDownloadEvent).not.toHaveBeenCalled();
  });

  it("still reports the import as done when the cleanup fails", async () => {
    const { manager, storage } = setup({ upgradeReplaceMode: "archive" });
    // A file where the archive folder should be makes the move fail.
    await fs.writeFile(path.join(libraryRoot, REPLACED_ARCHIVE_DIR), "not a folder");

    await manager.processImport("dl-1", path.join(downloads, RELEASE));

    expect(statuses(storage).at(-1)).toBe("imported");
    expect(await read(path.join(oldDir(), "game.exe"))).toBe("v2");
    expect(await read(path.join(libraryRoot, "PC", ".questarr-old-My Game", "game.exe"))).toBe(
      "v1"
    );
    expect(storage.addNotification).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Version replaced, cleanup failed", type: "warning" })
    );
  });
});
