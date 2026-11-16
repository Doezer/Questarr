import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import fsExtra from "fs-extra";
import type { Game } from "../shared/schema.js";
import type { IStorage } from "./storage.js";
import { rommSlugForPlatformId, isValidRommSlug } from "../shared/romm-platforms.js";

/**
 * Folder names used by older Questarr/RomM layouts. These are deliberately
 * explicit: a migration must never infer a platform from an arbitrary folder
 * name or rename user-created directories.
 */
const LEGACY_PLATFORM_IDS: Readonly<Record<string, number>> = {
  NES: 18,
  SNES: 19,
  N64: 4,
  GameCube: 21,
  Wii: 5,
  "Wii U": 41,
  "Game Boy": 33,
  "Game Boy Color": 22,
  "Game Boy Advance": 24,
  "Nintendo DS": 20,
  "Nintendo 3DS": 37,
  Switch: 130,
  PlayStation: 7,
  PS2: 8,
  PS3: 9,
  PS4: 48,
  PS5: 167,
  PSP: 38,
  "PS Vita": 46,
  PSVita: 46,
  Xbox: 11,
  "Xbox 360": 12,
  "Xbox One": 49,
  "Xbox Series": 169,
  "Xbox Series X|S": 169,
  "Game Gear": 35,
  "Master System": 64,
  "Mega Drive": 29,
  Dreamcast: 23,
  "Atari 2600": 59,
  "Neo Geo": 80,
  PC: 6,
  Linux: 3,
  Mac: 14,
};

export interface PlatformFolderRename {
  oldName: string;
  newName: string;
  merge: boolean;
}

export interface PlatformMigrationResult {
  oldName: string;
  newName: string;
  action: "rename" | "merge";
  success: boolean;
  error?: string;
  gamesUpdated?: number;
  filesUpdated?: number;
}

function targetForLegacyName(name: string): string | undefined {
  const platformId = Object.entries(LEGACY_PLATFORM_IDS).find(
    ([legacy]) => legacy.toLowerCase() === name.toLowerCase()
  )?.[1];
  const slug = rommSlugForPlatformId(platformId);
  return slug && isValidRommSlug(slug) ? slug : undefined;
}

function isSafeChildName(name: string): boolean {
  return name.length > 0 && name === path.basename(name) && name !== "." && name !== "..";
}

/**
 * Builds migration proposals from the immediate children of a library root.
 * Matching is case-insensitive for Windows libraries, while the returned
 * oldName preserves the actual on-disk casing.
 */
export function findPlatformFolderRenames(
  directoryNames: readonly string[]
): PlatformFolderRename[] {
  const seenOld = new Set<string>();
  const proposals: PlatformFolderRename[] = [];

  for (const legacyName of Object.keys(LEGACY_PLATFORM_IDS)) {
    const candidates = directoryNames.filter(
      (name) => name.toLowerCase() === legacyName.toLowerCase()
    );
    // Prefer the exact legacy spelling when both the legacy and target spelling
    // are present (possible on case-sensitive filesystems).
    const actualOldName =
      candidates.find((name) => name === legacyName) ??
      candidates.find((name) => name !== legacyName);
    if (!actualOldName || seenOld.has(actualOldName.toLowerCase())) continue;

    const newName = targetForLegacyName(actualOldName);
    if (!newName || actualOldName === newName) continue;

    // An exact target means a real merge. A case-only difference is a rename;
    // this matters for Linux libraries and is handled with a temporary name on
    // Windows where both paths otherwise resolve to the same directory.
    const target = directoryNames.find((name) => name === newName);
    proposals.push({
      oldName: actualOldName,
      newName,
      merge: target !== undefined && target !== actualOldName,
    });
    seenOld.add(actualOldName.toLowerCase());
  }

  return proposals;
}

export async function scanPlatformFolderRenames(
  libraryRoot: string
): Promise<PlatformFolderRename[]> {
  const resolvedRoot = path.resolve(libraryRoot);
  let entries: import("node:fs").Dirent<string>[];
  try {
    entries = await fs.readdir(resolvedRoot, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return findPlatformFolderRenames(
    entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  );
}

/** Returns a rewritten path when value is inside oldPrefix, otherwise null. */
export function replacePathPrefix(
  value: string,
  oldPrefix: string,
  newPrefix: string
): string | null {
  const oldPath = path.resolve(oldPrefix);
  const candidate = path.resolve(value);
  const relative = path.relative(oldPath, candidate);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return null;
  }
  return path.join(path.resolve(newPrefix), relative);
}

async function assertMergeHasNoConflicts(source: string, target: string): Promise<void> {
  const sourceFiles: string[] = [];
  const walk = async (current: string): Promise<void> => {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(entryPath);
      else sourceFiles.push(path.relative(source, entryPath));
    }
  };
  await walk(source);

  for (const relative of sourceFiles) {
    if (await fsExtra.pathExists(path.join(target, relative))) {
      throw new Error(`Target already contains ${relative}`);
    }
  }
}

async function renameFolder(oldPath: string, newPath: string): Promise<void> {
  if (oldPath.toLowerCase() !== newPath.toLowerCase()) {
    await fs.rename(oldPath, newPath);
    return;
  }
  // Windows cannot rename a directory to a case-only variant in one step.
  const temporary = `${oldPath}.questarr-migration-${randomUUID()}`;
  await fs.rename(oldPath, temporary);
  try {
    await fs.rename(temporary, newPath);
  } catch (error) {
    await fs.rename(temporary, oldPath).catch(() => undefined);
    throw error;
  }
}

async function updateStoredPaths(
  storage: IStorage,
  games: Game[],
  oldPath: string,
  newPath: string
): Promise<{ gamesUpdated: number; filesUpdated: number }> {
  let gamesUpdated = 0;
  let filesUpdated = 0;
  for (const game of games) {
    const updatedLibraryPath = game.libraryPath
      ? replacePathPrefix(game.libraryPath, oldPath, newPath)
      : null;
    if (updatedLibraryPath) {
      await storage.updateGame(game.id, { libraryPath: updatedLibraryPath });
      gamesUpdated++;
    }

    for (const file of await storage.getGameFiles(game.id)) {
      const updatedFilePath = replacePathPrefix(file.filePath, oldPath, newPath);
      if (updatedFilePath) {
        await storage.updateGameFilePath(file.id, updatedFilePath);
        filesUpdated++;
      }
    }
  }
  return { gamesUpdated, filesUpdated };
}

export async function applyPlatformFolderRenames(
  libraryRoot: string,
  requested: readonly PlatformFolderRename[],
  storage: IStorage,
  games: Game[]
): Promise<PlatformMigrationResult[]> {
  const resolvedRoot = path.resolve(libraryRoot);
  const current = await scanPlatformFolderRenames(resolvedRoot);
  const byOld = new Map(current.map((rename) => [rename.oldName.toLowerCase(), rename]));
  const results: PlatformMigrationResult[] = [];

  for (const item of requested) {
    const action = item.merge ? "merge" : "rename";
    try {
      if (!isSafeChildName(item.oldName) || !isSafeChildName(item.newName)) {
        throw new Error("Folder names must be immediate children of the library root");
      }
      const proposal = byOld.get(item.oldName.toLowerCase());
      if (
        !proposal ||
        proposal.newName.toLowerCase() !== item.newName.toLowerCase() ||
        proposal.merge !== item.merge
      ) {
        throw new Error("Migration proposal is stale; scan the library again");
      }

      const oldPath = path.join(resolvedRoot, proposal.oldName);
      const newPath = path.join(resolvedRoot, proposal.newName);
      if (proposal.merge) {
        await assertMergeHasNoConflicts(oldPath, newPath);
        await fsExtra.copy(oldPath, newPath, { overwrite: false, errorOnExist: true });
        await fsExtra.remove(oldPath);
      } else {
        await renameFolder(oldPath, newPath);
      }

      const counts = await updateStoredPaths(storage, games, oldPath, newPath);
      results.push({
        oldName: proposal.oldName,
        newName: proposal.newName,
        action: proposal.merge ? "merge" : "rename",
        success: true,
        ...counts,
      });
    } catch (error) {
      results.push({
        oldName: item.oldName,
        newName: item.newName,
        action,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}
