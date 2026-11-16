import fs from "fs-extra";
import path from "node:path";
import { isSensitivePath } from "../path-security.js";
import type { UpgradeReplaceMode } from "../../shared/schema.js";

/** Folder under the library root that holds versions set aside by the "archive" mode. */
export const REPLACED_ARCHIVE_DIR = ".questarr-replaced";
const ASIDE_PREFIX = ".questarr-old-";
const FAILED_PREFIX = ".questarr-failed-";

/** What happens to the version a game already has in the library when a new one is imported. */
export interface UpgradeReplacement {
  mode: Exclude<UpgradeReplaceMode, "off">;
  libraryRoot: string;
  /** The version in the library before the import. */
  oldPath: string;
  /** The new version is imported to the same place, so the old one is moved aside first. */
  samePath: boolean;
  /** Where the old version waits while the new one is imported; set by setOldVersionAside. */
  asidePath: string | null;
}

function isInside(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function overlaps(a: string, b: string): boolean {
  return a === b || isInside(a, b) || isInside(b, a);
}

function asidePathFor(oldPath: string): string {
  return path.join(path.dirname(oldPath), ASIDE_PREFIX + path.basename(oldPath));
}

function interruptedMessage(aside: string): string {
  return `An earlier replacement was interrupted: ${aside} still holds the previous version. Restore or delete it, then retry the import.`;
}

/**
 * Decides whether importing to `newPath` replaces the version at `oldLibraryPath`. Null when
 * there is nothing safe to replace: the mode is off, the old version is not on disk, it is not
 * a game folder of this library, or it overlaps the files being imported.
 */
export async function planUpgradeReplacement(input: {
  mode: UpgradeReplaceMode;
  libraryRoot: string;
  oldLibraryPath: string | null | undefined;
  newPath: string;
  sourcePath: string;
}): Promise<UpgradeReplacement | null> {
  if (input.mode === "off" || !input.oldLibraryPath) return null;

  const libraryRoot = path.resolve(input.libraryRoot);
  const oldPath = path.resolve(input.oldLibraryPath);
  const newPath = path.resolve(input.newPath);
  const sourcePath = path.resolve(input.sourcePath);

  // Only a game's own entry is ever touched: inside the library root and below a platform
  // folder, never the root or a platform folder that holds other games.
  if (!isInside(oldPath, libraryRoot)) return null;
  if (path.relative(libraryRoot, oldPath).split(path.sep).length < 2) return null;
  if (path.relative(libraryRoot, oldPath).split(path.sep)[0] === REPLACED_ARCHIVE_DIR) return null;
  if (await isSensitivePath(oldPath)) return null;

  // An import in place (the download already sits in the library) has no old version apart
  // from the files being imported.
  if (overlaps(oldPath, sourcePath)) return null;

  const samePath = oldPath === newPath;
  // One nested in the other: removing the old version would take part of the new one with it.
  if (!samePath && overlaps(oldPath, newPath)) return null;

  if (!(await fs.pathExists(oldPath))) {
    // The old version is gone but its set-aside copy is still there: an earlier replacement
    // was cut short. Importing now would leave that copy behind without a word.
    const aside = asidePathFor(oldPath);
    if (await fs.pathExists(aside)) throw new Error(interruptedMessage(aside));
    return null;
  }

  return { mode: input.mode, libraryRoot, oldPath, samePath, asidePath: null };
}

/**
 * Frees the destination when the new version goes where the old one is. The old version is
 * renamed next to it, so it survives until the import has succeeded.
 */
export async function setOldVersionAside(replacement: UpgradeReplacement): Promise<void> {
  if (!replacement.samePath) return;
  const aside = asidePathFor(replacement.oldPath);
  if (await fs.pathExists(aside)) throw new Error(interruptedMessage(aside));
  await fs.rename(replacement.oldPath, aside);
  replacement.asidePath = aside;
}

/**
 * Puts the old version back after a failed import. Whatever the failed import left at the
 * destination is removed, except in move mode where it is the only copy of the download: it
 * is then kept next to the game. Returns where it was kept, if it was.
 */
export async function restoreOldVersion(
  replacement: UpgradeReplacement,
  options: { keepPartial: boolean }
): Promise<string | null> {
  if (!replacement.asidePath) return null;
  let keptAt: string | null = null;
  if (await fs.pathExists(replacement.oldPath)) {
    if (options.keepPartial) {
      keptAt = path.join(
        path.dirname(replacement.oldPath),
        `${FAILED_PREFIX}${path.basename(replacement.oldPath)}-${Date.now()}`
      );
      await fs.rename(replacement.oldPath, keptAt);
    } else {
      await fs.remove(replacement.oldPath);
    }
  }
  await fs.rename(replacement.asidePath, replacement.oldPath);
  replacement.asidePath = null;
  return keptAt;
}

/**
 * Cleans up the old version once the new one is imported. Returns where it was archived, or
 * null when it was deleted.
 */
export async function disposeOldVersion(
  replacement: UpgradeReplacement,
  now: Date = new Date()
): Promise<string | null> {
  const current = replacement.asidePath ?? replacement.oldPath;
  if (replacement.mode === "delete") {
    await fs.remove(current);
    replacement.asidePath = null;
    return null;
  }

  const archiveRoot = path.join(replacement.libraryRoot, REPLACED_ARCHIVE_DIR);
  await fs.ensureDir(archiveRoot);
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const archived = path.join(archiveRoot, `${path.basename(replacement.oldPath)} (${stamp})`);
  await fs.move(current, archived, { overwrite: false });
  replacement.asidePath = null;
  return archived;
}
