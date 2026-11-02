// Library transfer: bring a game discovered in an external root folder into the
// configured library root, using the import pipeline's strategy (naming
// pattern, copy / move / hardlink). Root folders are discovery-only on their
// own; this is the explicit, per-game action that moves data.
//
// Safety rules (see Questarr-mgmt #49):
// - The source is always the stored `libraryPath` of the game, which must sit
//   strictly inside a configured root folder. No client input is ever joined
//   onto a path.
// - The source must not be inside the library root (and must not contain it).
// - An existing destination is never overwritten.
// - A copy (or a move across filesystems) needs enough free space first.
// - A move across filesystems is copy → verify → delete source.

import fs from "fs-extra";
import nodeFs from "node:fs";
import path from "node:path";
import { storage } from "./storage.js";
import { routesLogger } from "./logger.js";
import { isStrictlyInside } from "./root-folders.js";
import { isSensitivePath } from "./path-security.js";
import { replaceGameFilesFromPath } from "./library-scanner.js";
import { PCImportStrategy, gatherFiles, type TransferMode } from "./services/ImportStrategies.js";
import { isUserCuratedGameStatus, type Game, type RootFolder } from "../shared/schema.js";

export type LibraryTransferMode = Extract<TransferMode, "copy" | "move" | "hardlink">;
export const LIBRARY_TRANSFER_MODES: readonly LibraryTransferMode[] = ["copy", "move", "hardlink"];

export class LibraryTransferError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 507 = 400
  ) {
    super(message);
  }
}

export interface ExternalGame {
  gameId: string;
  title: string;
  libraryPath: string;
  rootFolderId: string;
  rootFolderPath: string;
}

export interface TransferPreview {
  gameId: string;
  title: string;
  sourcePath: string;
  destinationPath: string;
  sizeBytes: number;
  freeBytes: number | null;
  needsSpace: boolean;
  crossFilesystem: boolean;
  destinationExists: boolean;
  defaultMode: LibraryTransferMode;
}

const inFlight = new Set<string>();

/** Root folder strictly containing `resolvedPath`, preferring the deepest match. */
function findContainingRootFolder(folders: RootFolder[], resolvedPath: string): RootFolder | null {
  const matches = folders
    .filter((f) => isStrictlyInside(path.resolve(f.path), resolvedPath))
    .sort((a, b) => path.resolve(b.path).length - path.resolve(a.path).length);
  return matches[0] ?? null;
}

function overlaps(a: string, b: string): boolean {
  return a === b || isStrictlyInside(a, b) || isStrictlyInside(b, a);
}

/** Games whose files live in a root folder rather than in the library root. */
export async function listExternalGames(): Promise<ExternalGame[]> {
  const [folders, games] = await Promise.all([storage.getAllRootFolders(), storage.getAllGames()]);
  const result: ExternalGame[] = [];
  for (const game of games) {
    if (!game.libraryPath) continue;
    const folder = findContainingRootFolder(folders, path.resolve(game.libraryPath));
    if (!folder) continue;
    result.push({
      gameId: game.id,
      title: game.title,
      libraryPath: game.libraryPath,
      rootFolderId: folder.id,
      rootFolderPath: folder.path,
    });
  }
  return result.sort((a, b) => a.title.localeCompare(b.title));
}

async function directorySize(target: string): Promise<number> {
  const stat = await fs.stat(target);
  if (stat.isFile()) return stat.size;
  let total = 0;
  for (const file of await gatherFiles(target)) {
    try {
      total += (await fs.stat(file)).size;
    } catch {
      // vanished mid-walk: ignore, the transfer itself reports real problems
    }
  }
  return total;
}

interface ResolvedTransfer {
  game: Game;
  rootFolder: RootFolder;
  source: string;
  libraryRoot: string;
  strategy: PCImportStrategy;
  plan: Awaited<ReturnType<PCImportStrategy["planImport"]>>;
  config: Awaited<ReturnType<typeof storage.getImportConfig>>;
}

async function resolveTransfer(gameId: string, userId: string): Promise<ResolvedTransfer> {
  const game = await storage.getGame(gameId);
  if (!game) throw new LibraryTransferError("Game not found", 404);
  if (!game.libraryPath) throw new LibraryTransferError("This game has no files on disk", 400);

  const folders = await storage.getAllRootFolders();
  const source = path.resolve(game.libraryPath);
  const rootFolder = findContainingRootFolder(folders, source);
  if (!rootFolder) {
    throw new LibraryTransferError("This game is not stored in a root folder", 400);
  }
  if (isSensitivePath(source)) {
    throw new LibraryTransferError("Refusing to process a sensitive system path", 400);
  }
  if (!(await fs.pathExists(source))) {
    throw new LibraryTransferError("The game's folder no longer exists on disk", 404);
  }

  const config = await storage.getImportConfig(userId);
  const libraryRoot = path.resolve(config.libraryRoot || "/data");
  if (overlaps(libraryRoot, source)) {
    throw new LibraryTransferError("The game is already inside the library root", 409);
  }

  const strategy = new PCImportStrategy([rootFolder.path]);
  const plan = await strategy.planImport(source, game, libraryRoot, config);
  return { game, rootFolder, source, libraryRoot, strategy, plan, config };
}

async function freeBytesAt(dir: string): Promise<number | null> {
  // The library root may not exist yet: measure the closest existing parent.
  let probe = dir;
  while (!(await fs.pathExists(probe))) {
    const parent = path.dirname(probe);
    if (parent === probe) return null;
    probe = parent;
  }
  try {
    const s = await nodeFs.promises.statfs(probe);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return null;
  }
}

async function onDifferentDevices(source: string, libraryRoot: string): Promise<boolean> {
  let probe = libraryRoot;
  while (!(await fs.pathExists(probe))) {
    const parent = path.dirname(probe);
    if (parent === probe) return true;
    probe = parent;
  }
  return (await fs.stat(source)).dev !== (await fs.stat(probe)).dev;
}

export async function previewLibraryTransfer(
  gameId: string,
  userId: string
): Promise<TransferPreview> {
  const t = await resolveTransfer(gameId, userId);
  const sizeBytes = await directorySize(t.source);
  const freeBytes = await freeBytesAt(t.libraryRoot);
  const crossFilesystem = await onDifferentDevices(t.source, t.libraryRoot);
  return {
    gameId,
    title: t.game.title,
    sourcePath: t.source,
    destinationPath: t.plan.proposedPath,
    sizeBytes,
    freeBytes,
    needsSpace: freeBytes !== null && sizeBytes > freeBytes,
    crossFilesystem,
    destinationExists: t.plan.needsReview,
    defaultMode: "copy",
  };
}

/** Every file of `source` exists in `destination` with the same size. */
async function verifyCopy(source: string, destination: string): Promise<boolean> {
  const srcStat = await fs.stat(source);
  if (srcStat.isFile()) {
    return (await fs.stat(destination)).size === srcStat.size;
  }
  for (const file of await gatherFiles(source)) {
    try {
      const [a, b] = await Promise.all([
        fs.stat(file),
        fs.stat(path.join(destination, path.relative(source, file))),
      ]);
      if (a.size !== b.size) return false;
    } catch {
      return false;
    }
  }
  return true;
}

export interface TransferOutcome {
  gameId: string;
  taskId: string;
  destinationPath: string;
  modeUsed: TransferMode;
  filesPlaced: number;
}

/**
 * Transfer one external game into the library root. Recorded as an import
 * task so it shows up in Import History.
 */
export async function transferExternalGame(
  gameId: string,
  mode: LibraryTransferMode,
  userId: string
): Promise<TransferOutcome> {
  if (inFlight.has(gameId)) {
    throw new LibraryTransferError("This game is already being transferred", 409);
  }
  inFlight.add(gameId);
  let taskId: string | null = null;
  try {
    const t = await resolveTransfer(gameId, userId);
    if (t.plan.needsReview) {
      throw new LibraryTransferError(
        `Destination already exists in the library: ${t.plan.proposedPath}`,
        409
      );
    }

    const crossFilesystem = await onDifferentDevices(t.source, t.libraryRoot);
    // A hardlink across filesystems falls back to a copy, so it needs space too.
    const needsSpace = mode === "copy" || crossFilesystem;
    if (needsSpace) {
      const [size, free] = await Promise.all([directorySize(t.source), freeBytesAt(t.libraryRoot)]);
      if (free !== null && size > free) {
        throw new LibraryTransferError(
          `Not enough free space in the library root (${size} bytes needed, ${free} available)`,
          507
        );
      }
    }

    const task = await storage.createImportTask({
      userId,
      taskType: "library_transfer",
      triggeredBy: "manual",
    });
    taskId = task.id;
    await storage.startImportTask(task.id);
    await storage.updateImportTask(task.id, { totalItems: 1 });

    await fs.ensureDir(t.libraryRoot);

    // A move across filesystems is copy + verify + delete: never remove the
    // source until the destination is confirmed complete.
    const crossMove = mode === "move" && crossFilesystem;
    const result = await t.strategy.executeImport(t.plan, crossMove ? "copy" : mode);
    if (crossMove) {
      if (!(await verifyCopy(t.source, result.destDir))) {
        await fs.remove(result.destDir).catch(() => undefined);
        throw new Error("Copy verification failed; the source was left untouched");
      }
      await fs.remove(t.source);
    }

    await storage.updateGame(t.game.id, { libraryPath: result.destDir });
    if (t.game.status !== "owned" && !isUserCuratedGameStatus(t.game.status)) {
      await storage.updateGameStatus(t.game.id, { status: "owned" }, { preserveCurated: true });
    }
    const filesPlaced = await replaceGameFilesFromPath(t.game.id, result.destDir);

    await storage.addImportTaskItem({
      taskId: task.id,
      itemName: path.basename(t.source),
      result: "added",
      gameId: t.game.id,
      gameTitle: t.game.title,
      errorMessage: null,
    });
    await storage.updateImportTask(task.id, {
      status: "completed",
      completedAt: new Date(),
      addedItems: 1,
    });

    return {
      gameId: t.game.id,
      taskId: task.id,
      destinationPath: result.destDir,
      modeUsed: crossMove ? "move" : result.modeUsed,
      filesPlaced,
    };
  } catch (error) {
    if (taskId) {
      const message = error instanceof Error ? error.message : String(error);
      routesLogger.error({ error, gameId }, "library transfer failed");
      await storage
        .addImportTaskItem({
          taskId,
          itemName: gameId,
          result: "failed",
          gameId,
          gameTitle: null,
          errorMessage: message,
        })
        .catch(() => undefined);
      await storage
        .updateImportTask(taskId, {
          status: "failed",
          completedAt: new Date(),
          failedItems: 1,
          errorMessage: message,
        })
        .catch(() => undefined);
    }
    throw error;
  } finally {
    inFlight.delete(gameId);
  }
}
