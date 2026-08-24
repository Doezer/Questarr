// Root folders: additional directories scanned for games already present on
// disk outside the configured library root (e.g. an older library, a
// secondary drive). Health-probing is kept separate from the scanner itself
// so both the HTTP handlers and a future cron job can share the same logic.

import fs from "fs";
import path from "path";
import { promisify } from "util";
import { storage } from "./storage.js";
import { routesLogger } from "./logger.js";

const statfsAsync = (fs as unknown as { statfs?: typeof fs.statfs }).statfs
  ? promisify((fs as unknown as { statfs: typeof fs.statfs }).statfs.bind(fs))
  : null;

export interface RootFolderHealth {
  accessible: boolean;
  diskFreeBytes: number | null;
  diskTotalBytes: number | null;
  error?: string;
}

/**
 * Inspect a path on disk.
 * - `accessible` is true iff the path exists, is a directory, and is readable.
 * - Disk stats are best-effort: uses fs.statfs when available (Node 18.15+),
 *   otherwise returns nulls rather than blocking on unsupported platforms.
 */
export async function probeRootFolder(folderPath: string): Promise<RootFolderHealth> {
  try {
    const resolved = path.resolve(folderPath);
    const stat = await fs.promises.stat(resolved);
    if (!stat.isDirectory()) {
      return {
        accessible: false,
        diskFreeBytes: null,
        diskTotalBytes: null,
        error: "Path exists but is not a directory",
      };
    }

    // Readability probe — root folders are scan-only, so unlike the library
    // root we don't require write access.
    await fs.promises.access(resolved, fs.constants.R_OK);

    let diskFreeBytes: number | null = null;
    let diskTotalBytes: number | null = null;
    if (statfsAsync) {
      try {
        const s = (await statfsAsync(resolved)) as {
          bsize: number;
          bavail: number;
          blocks: number;
        };
        diskFreeBytes = Number(s.bavail) * Number(s.bsize);
        diskTotalBytes = Number(s.blocks) * Number(s.bsize);
      } catch (err) {
        routesLogger.debug({ err, folderPath }, "statfs failed, returning null disk stats");
      }
    }

    return { accessible: true, diskFreeBytes, diskTotalBytes };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      accessible: false,
      diskFreeBytes: null,
      diskTotalBytes: null,
      error: message,
    };
  }
}

/** Refresh health stats for every configured root folder. */
export async function refreshAllRootFoldersHealth(): Promise<void> {
  const folders = await storage.getAllRootFolders();
  for (const folder of folders) {
    const health = await probeRootFolder(folder.path);
    await storage.updateRootFolderHealth(folder.id, {
      accessible: health.accessible,
      diskFreeBytes: health.diskFreeBytes,
      diskTotalBytes: health.diskTotalBytes,
    });
  }
}

/**
 * Whether `resolvedTarget` (an already `path.resolve`d path) sits inside a
 * root folder the user has explicitly opted in to deletion for
 * (`allowDelete: true`). Used by the game-delete flow to extend its
 * "inside the configured library root" safety check to cover discovered
 * folders too, but only for folders the user deliberately authorized —
 * discovery itself never grants delete access.
 */
export async function isWithinDeletableRootFolder(resolvedTarget: string): Promise<boolean> {
  const folders = await storage.getAllRootFolders();
  return folders.some((folder) => {
    if (!folder.allowDelete) return false;
    const resolvedFolder = path.resolve(folder.path);
    return (
      resolvedTarget === resolvedFolder || resolvedTarget.startsWith(resolvedFolder + path.sep)
    );
  });
}
