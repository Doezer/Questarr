// RomM folder repair: games imported under the wrong RomM platform folder (for example a
// Switch 2 game placed in `win/` before Questarr knew that platform, #1393) are moved to the
// folder RomM expects. Nothing moves without an explicit apply, and a proposal is only made
// when the game's own platforms prove the current folder is wrong.
//
// Safety rules:
// - Paths come from the stored `libraryPath` of the game, never from the client: the apply
//   call only receives game ids and recomputes every move.
// - Only games whose path is `<library root>/<RomM folder>/...` are considered, and only when
//   that folder is a RomM platform folder none of the game's platforms belongs to.
// - An existing destination is never overwritten.

import fs from "fs-extra";
import path from "node:path";
import { storage } from "./storage.js";
import { routesLogger as logger } from "./logger.js";
import { isStrictlyInside } from "./root-folders.js";
import { isSensitivePath } from "./path-security.js";
import { replaceGameFilesFromPath } from "./library-scanner.js";
import { importManager } from "./services/index.js";
import { isRommPlatformFoldersEnabled, requestRommScanAfterImport } from "./romm.js";
import { ROMM_SLUG_BY_IGDB_PLATFORM_ID } from "../shared/romm-platforms.js";

export class RommFolderRepairError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 409 = 409
  ) {
    super(message);
  }
}

export interface FolderRepairProposal {
  gameId: string;
  title: string;
  from: string;
  to: string;
  currentFolder: string;
  expectedFolder: string;
  destinationExists: boolean;
}

export interface FolderRepairOutcome {
  gameId: string;
  title: string;
  moved: boolean;
  to?: string;
  error?: string;
}

const KNOWN_FOLDERS: ReadonlySet<string> = new Set(Object.values(ROMM_SLUG_BY_IGDB_PLATFORM_ID));

function platformIdsOfFolder(folder: string): number[] {
  return Object.entries(ROMM_SLUG_BY_IGDB_PLATFORM_ID)
    .filter(([, slug]) => slug === folder)
    .map(([id]) => Number(id));
}

const inFlight = new Set<string>();

/** Real location of a path, resolving links through its nearest existing ancestor. */
async function realLocation(target: string): Promise<string> {
  const missing: string[] = [];
  let current = path.resolve(target);
  for (;;) {
    try {
      return path.join(await fs.realpath(current), ...missing.reverse());
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return path.resolve(target);
      missing.push(path.basename(current));
      current = parent;
    }
  }
}

/** A linked platform folder must not lead the move outside the library. */
async function staysInLibrary(libraryRoot: string, from: string, to: string): Promise<boolean> {
  const root = await realLocation(libraryRoot);
  return (
    isStrictlyInside(root, await realLocation(from)) &&
    isStrictlyInside(root, await realLocation(to))
  );
}

async function buildProposal(
  game: Awaited<ReturnType<typeof storage.getGame>>,
  libraryRoot: string,
  allowedPlatformIds: number[]
): Promise<FolderRepairProposal | null> {
  if (!game?.libraryPath) return null;
  const source = path.resolve(game.libraryPath);
  if (!isStrictlyInside(libraryRoot, source)) return null;
  const [currentFolder, ...rest] = path.relative(libraryRoot, source).split(path.sep);
  if (!currentFolder || rest.length === 0 || !KNOWN_FOLDERS.has(currentFolder)) return null;

  const platformIds = importManager.getGamePlatformIds(game);
  if (game.targetPlatformId) platformIds.push(game.targetPlatformId);
  // Without platforms there is no proof the folder is wrong.
  if (platformIds.length === 0) return null;
  // The folder belongs to one of the game's platforms: it is where the game should be.
  if (platformIdsOfFolder(currentFolder).some((id) => platformIds.includes(id))) return null;

  const expectedFolder = await importManager.resolveLibraryPlatformFolder(game, allowedPlatformIds);
  if (!KNOWN_FOLDERS.has(expectedFolder) || expectedFolder === currentFolder) return null;

  const destination = path.join(libraryRoot, expectedFolder, ...rest);
  return {
    gameId: game.id,
    title: game.title,
    from: source,
    to: destination,
    currentFolder,
    expectedFolder,
    destinationExists: await fs.pathExists(destination),
  };
}

async function context(userId: string) {
  if (!(await isRommPlatformFoldersEnabled())) {
    throw new RommFolderRepairError("Turn on RomM platform folders first");
  }
  const config = await storage.getImportConfig(userId);
  return {
    libraryRoot: path.resolve(config.libraryRoot || "/data"),
    allowed: config.importPlatformIds,
  };
}

export async function previewRommFolderRepair(userId: string): Promise<FolderRepairProposal[]> {
  const { libraryRoot, allowed } = await context(userId);
  const games = await storage.getUserGames(userId, true);
  const proposals: FolderRepairProposal[] = [];
  for (const game of games) {
    const proposal = await buildProposal(game, libraryRoot, allowed);
    if (proposal) proposals.push(proposal);
  }
  return proposals.sort((a, b) => a.title.localeCompare(b.title));
}

async function moveOne(
  userId: string,
  gameId: string,
  libraryRoot: string,
  allowed: number[]
): Promise<FolderRepairOutcome> {
  if (inFlight.has(gameId))
    return { gameId, title: gameId, moved: false, error: "Already being moved" };
  inFlight.add(gameId);
  let title = gameId;
  // The same lock an import of this game takes, so a move never runs under a running import.
  let release: (() => void) | undefined;
  try {
    release = await importManager.acquireGameLock(gameId);
    // Read after the lock: an import that just finished may have changed the game's path.
    const game = await storage.getGame(gameId);
    if (game?.userId !== userId) return { gameId, title, moved: false, error: "Game not found" };
    title = game.title;
    const fail = (error: string): FolderRepairOutcome => ({ gameId, title, moved: false, error });
    const proposal = await buildProposal(game, libraryRoot, allowed);
    if (!proposal) return fail("This game is no longer in a wrong folder");
    if ((await isSensitivePath(proposal.from)) || (await isSensitivePath(proposal.to))) {
      return fail("Refusing to process a sensitive system path");
    }
    if (!(await staysInLibrary(libraryRoot, proposal.from, proposal.to))) {
      return fail("The game's folder leads outside the library");
    }
    if (!(await fs.pathExists(proposal.from))) return fail("The game's files are missing");
    if (proposal.destinationExists) return fail(`Destination already exists: ${proposal.to}`);
    await fs.ensureDir(path.dirname(proposal.to));
    // fs-extra renames on one filesystem and copies then removes across filesystems.
    await fs.move(proposal.from, proposal.to, { overwrite: false });
    try {
      await storage.updateGame(game.id, { libraryPath: proposal.to });
      await replaceGameFilesFromPath(game.id, proposal.to, proposal.from);
    } catch (dbError) {
      // Keep files and database in agreement: put everything back where it was.
      await storage.updateGame(game.id, { libraryPath: proposal.from }).catch(() => undefined);
      await fs
        .move(proposal.to, proposal.from, { overwrite: false })
        .then(() => replaceGameFilesFromPath(game.id, proposal.from, proposal.to))
        .catch((rollbackError) =>
          logger.error({ error: rollbackError, gameId }, "Could not roll back a RomM folder move")
        );
      throw dbError;
    }
    return { gameId, title, moved: true, to: proposal.to };
  } catch (error) {
    logger.error({ error, gameId }, "RomM folder repair failed for a game");
    return {
      gameId,
      title,
      moved: false,
      error: error instanceof Error ? error.message : "Move failed",
    };
  } finally {
    release?.();
    inFlight.delete(gameId);
  }
}

// Games are moved one at a time on purpose: parallel moves would fight over the disk.
export async function applyRommFolderRepair(
  userId: string,
  gameIds: string[]
): Promise<FolderRepairOutcome[]> {
  const { libraryRoot, allowed } = await context(userId);
  const outcomes: FolderRepairOutcome[] = [];
  for (const gameId of new Set(gameIds)) {
    outcomes.push(await moveOne(userId, gameId, libraryRoot, allowed));
  }
  if (outcomes.some((o) => o.moved)) requestRommScanAfterImport();
  return outcomes;
}
