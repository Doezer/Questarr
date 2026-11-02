import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs-extra";
import os from "node:os";
import path from "node:path";

const storageMock = vi.hoisted(() => ({
  getAllRootFolders: vi.fn(),
  getUserGames: vi.fn(),
  getGame: vi.fn(),
  getImportConfig: vi.fn(),
  updateGame: vi.fn(),
  updateGameStatus: vi.fn(),
  createImportTask: vi.fn(),
  startImportTask: vi.fn(),
  updateImportTask: vi.fn(),
  addImportTaskItem: vi.fn(),
}));
const replaceFiles = vi.hoisted(() => vi.fn());

vi.mock("../storage.js", () => ({ storage: storageMock }));
vi.mock("../services/index.js", () => ({
  importManager: { resolveLibraryPlatformFolder: vi.fn(async () => "PC") },
}));
// Temp dirs may live under a prefix the guard treats as sensitive (e.g. a home under /root on CI).
vi.mock("../path-security.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../path-security.js")>()),
  isSensitivePath: vi.fn(async () => false),
}));
vi.mock("../library-scanner.js", () => ({ replaceGameFilesFromPath: replaceFiles }));
vi.mock("../logger.js", () => ({
  routesLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { PCImportStrategy } from "../services/ImportStrategies.js";
import {
  listExternalGames,
  previewLibraryTransfer,
  transferExternalGame,
  LibraryTransferError,
} from "../library-transfer.js";

describe("library transfer", () => {
  let tmp: string;
  let external: string;
  let library: string;
  let gameDir: string;
  const game = { id: "g1", userId: "u1", title: "Hades", status: "wishlist", libraryPath: "" };

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "questarr-transfer-"));
    external = path.join(tmp, "external");
    library = path.join(tmp, "library");
    gameDir = path.join(external, "Hades");
    await fs.ensureDir(path.join(gameDir, "data"));
    await fs.writeFile(path.join(gameDir, "game.bin"), "12345");
    await fs.writeFile(path.join(gameDir, "data", "a.pak"), "abc");
    game.libraryPath = gameDir;

    vi.clearAllMocks();
    storageMock.getAllRootFolders.mockResolvedValue([{ id: "rf1", path: external }]);
    storageMock.getUserGames.mockResolvedValue([game]);
    storageMock.getGame.mockResolvedValue(game);
    storageMock.getImportConfig.mockResolvedValue({
      libraryRoot: library,
      renamePattern: "{Title}",
      overwriteExisting: false,
      sortExtras: false,
    });
    storageMock.createImportTask.mockResolvedValue({ id: "t1" });
    replaceFiles.mockResolvedValue(2);
    storageMock.updateImportTask.mockResolvedValue(undefined);
    storageMock.addImportTaskItem.mockResolvedValue({});
  });

  afterEach(async () => {
    await fs.remove(tmp);
  });

  it("lists games stored inside a root folder", async () => {
    storageMock.getUserGames.mockResolvedValue([
      game,
      { id: "g2", title: "Inside", libraryPath: path.join(library, "PC", "Inside") },
      { id: "g3", title: "No path", libraryPath: null },
    ]);
    const list = await listExternalGames("u1");
    expect(list.map((g) => g.gameId)).toEqual(["g1"]);
    expect(list[0]?.rootFolderId).toBe("rf1");
  });

  it("leaves out games already inside a library root nested in the root folder", async () => {
    storageMock.getAllRootFolders.mockResolvedValue([{ id: "rf1", path: tmp }]);
    storageMock.getUserGames.mockResolvedValue([
      game,
      { id: "g2", title: "Inside", libraryPath: path.join(library, "PC", "Inside") },
    ]);
    const list = await listExternalGames("u1");
    expect(list.map((g) => g.gameId)).toEqual(["g1"]);
  });

  it("refuses a library root that is a symlink into the source", async () => {
    const link = path.join(tmp, "library-link");
    await fs.symlink(gameDir, link);
    storageMock.getImportConfig.mockResolvedValue({
      libraryRoot: link,
      renamePattern: "{Title}",
      overwriteExisting: false,
      sortExtras: true,
    });
    await expect(transferExternalGame("g1", "move", "u1")).rejects.toMatchObject({ status: 409 });
    expect(await fs.pathExists(path.join(gameDir, "game.bin"))).toBe(true);
  });

  it("previews destination and size", async () => {
    const preview = await previewLibraryTransfer("g1", "u1");
    expect(preview.sizeBytes).toBe(8);
    expect(preview.destinationPath.startsWith(library)).toBe(true);
    expect(preview.destinationExists).toBe(false);
  });

  it("copies into the library, keeps the source and updates the game", async () => {
    const outcome = await transferExternalGame("g1", "copy", "u1");
    expect(await fs.pathExists(path.join(outcome.destinationPath, "game.bin"))).toBe(true);
    expect(await fs.pathExists(path.join(gameDir, "game.bin"))).toBe(true);
    expect(storageMock.updateGame).toHaveBeenCalledWith("g1", {
      libraryPath: outcome.destinationPath,
    });
    expect(replaceFiles).toHaveBeenCalledWith("g1", outcome.destinationPath, gameDir);
    expect(storageMock.updateImportTask).toHaveBeenLastCalledWith(
      "t1",
      expect.objectContaining({ status: "completed", addedItems: 1 })
    );
  });

  it("moves the files out of the external folder", async () => {
    const outcome = await transferExternalGame("g1", "move", "u1");
    expect(await fs.pathExists(path.join(outcome.destinationPath, "data", "a.pak"))).toBe(true);
    expect(await fs.pathExists(gameDir)).toBe(false);
  });

  it("refuses when the destination already exists", async () => {
    const preview = await previewLibraryTransfer("g1", "u1");
    await fs.ensureDir(preview.destinationPath);
    await expect(transferExternalGame("g1", "copy", "u1")).rejects.toMatchObject({ status: 409 });
    expect(await fs.pathExists(path.join(gameDir, "game.bin"))).toBe(true);
    expect(storageMock.updateGame).not.toHaveBeenCalled();
  });

  it("refuses to overwrite an existing destination even with overwriteExisting on", async () => {
    storageMock.getImportConfig.mockResolvedValue({
      libraryRoot: library,
      renamePattern: "{Title}",
      overwriteExisting: true,
      sortExtras: false,
    });
    const preview = await previewLibraryTransfer("g1", "u1");
    await fs.ensureDir(preview.destinationPath);
    await fs.writeFile(path.join(preview.destinationPath, "keep.txt"), "mine");
    await expect(transferExternalGame("g1", "move", "u1")).rejects.toMatchObject({ status: 409 });
    expect(await fs.readFile(path.join(preview.destinationPath, "keep.txt"), "utf8")).toBe("mine");
  });

  it("never writes the same destination from two concurrent transfers", async () => {
    const other = { ...game, id: "g2" };
    storageMock.getGame.mockImplementation(async (id: string) => (id === "g2" ? other : game));
    const results = await Promise.allSettled([
      transferExternalGame("g1", "copy", "u1"),
      transferExternalGame("g2", "copy", "u1"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  });

  it("removes a half-written copy when the transfer fails", async () => {
    const preview = await previewLibraryTransfer("g1", "u1");
    vi.spyOn(PCImportStrategy.prototype, "executeImport").mockImplementationOnce(async () => {
      await fs.ensureDir(preview.destinationPath);
      await fs.writeFile(path.join(preview.destinationPath, "partial.bin"), "x");
      throw new Error("disk full");
    });
    await expect(transferExternalGame("g1", "copy", "u1")).rejects.toThrow("disk full");
    expect(await fs.pathExists(preview.destinationPath)).toBe(false);
    expect(await fs.pathExists(path.join(gameDir, "game.bin"))).toBe(true);
    expect(storageMock.updateGame).not.toHaveBeenCalled();
  });

  it("does not expose another user's game", async () => {
    storageMock.getGame.mockResolvedValue({ ...game, userId: "someone-else" });
    await expect(transferExternalGame("g1", "copy", "u1")).rejects.toMatchObject({ status: 404 });
    await expect(previewLibraryTransfer("g1", "u1")).rejects.toMatchObject({ status: 404 });
  });

  it("refuses a game that is not in a root folder", async () => {
    storageMock.getGame.mockResolvedValue({ ...game, libraryPath: path.join(tmp, "elsewhere") });
    await expect(transferExternalGame("g1", "copy", "u1")).rejects.toBeInstanceOf(
      LibraryTransferError
    );
  });

  it("refuses when the source already is inside the library root", async () => {
    storageMock.getAllRootFolders.mockResolvedValue([{ id: "rf1", path: tmp }]);
    storageMock.getImportConfig.mockResolvedValue({
      libraryRoot: external,
      renamePattern: "{Title}",
      overwriteExisting: false,
      sortExtras: false,
    });
    await expect(transferExternalGame("g1", "copy", "u1")).rejects.toMatchObject({ status: 409 });
  });

  it("records a failed task when the transfer throws", async () => {
    replaceFiles.mockRejectedValue(new Error("db down"));
    await expect(transferExternalGame("g1", "copy", "u1")).rejects.toThrow("db down");
    expect(storageMock.updateImportTask).toHaveBeenLastCalledWith(
      "t1",
      expect.objectContaining({ status: "failed", failedItems: 1 })
    );
  });
});
