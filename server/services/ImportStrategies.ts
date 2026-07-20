import { Game, ImportConfig } from "../../shared/schema.js";
import fs from "fs-extra";
import path from "node:path";
import { logger } from "../logger.js";
import { isSensitivePath } from "../path-security.js";
export type TransferMode = "copy" | "move" | "hardlink" | "symlink";

export function sanitizeFsName(name: string | null | undefined): string {
  // eslint-disable-next-line no-control-regex
  return (name ?? "").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim();
}

export interface ImportResult {
  platformSlug?: string;
  platformDir?: string;
  destDir: string;
  filesPlaced: string[];
  modeUsed: TransferMode;
  conflictsResolved: string[];
}

export interface ImportReview {
  needsReview: boolean;
  reviewReason?: string;
  originalPath: string;
  proposedPath: string;
  strategy: "pc";
  ignoredExtensions?: string[];
  importResult?: ImportResult;
}

export interface PlanImportOptions {
  // Force the destination to be treated as a directory (no extension),
  // used when the source will be unpacked before landing in the library.
  treatAsDirectory?: boolean;
}

export interface ImportStrategy {
  planImport(
    sourcePath: string,
    game: Game,
    targetRoot: string,
    config: ImportConfig,
    platformDir?: string,
    options?: PlanImportOptions
  ): Promise<ImportReview>;
  executeImport(
    review: ImportReview,
    transferMode: TransferMode,
    excludePaths?: Set<string>
  ): Promise<ImportResult>;
}

async function ensureParentDir(filePath: string): Promise<void> {
  await fs.ensureDir(path.dirname(filePath));
}

async function walkRelative(rootPath: string): Promise<string[]> {
  const stats = await fs.stat(rootPath);
  if (!stats.isDirectory()) return [path.basename(rootPath)];

  const collected: string[] = [];
  const stack: string[] = [""];

  while (stack.length > 0) {
    const rel = stack.pop() as string;
    const current = rel ? path.join(rootPath, rel) : rootPath;
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const entryRel = rel ? path.join(rel, entry.name) : entry.name;
      if (entry.isDirectory()) {
        stack.push(entryRel);
      } else {
        collected.push(entryRel);
      }
    }
  }

  return collected;
}

async function linkOrCopyFallback(
  source: string,
  destination: string
): Promise<"hardlink" | "copy"> {
  if (await fs.pathExists(destination)) {
    await fs.remove(destination);
  }
  try {
    await fs.link(source, destination);
    return "hardlink";
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EXDEV") {
      logger.warn(
        { source, destination },
        "[ImportStrategies] Hardlink not supported across devices, falling back to copy"
      );
      await fs.copy(source, destination, { overwrite: true });
      return "copy";
    }
    throw error;
  }
}

// Hardlinks can't target a directory, and excluding specific files (e.g. a
// leftover raw archive already extracted by the downloader) requires acting
// per-file rather than on the directory as a whole.
async function transferDirectoryPerFile(
  source: string,
  destination: string,
  mode: TransferMode,
  excludePaths: Set<string>
): Promise<TransferMode> {
  const relFiles = await walkRelative(source);
  let usedCopyFallback = false;
  let transferredAny = false;

  for (const rel of relFiles) {
    const srcFile = path.join(source, rel);
    if (excludePaths.has(path.resolve(srcFile))) continue;

    const destFile = path.join(destination, rel);
    await ensureParentDir(destFile);

    if (mode === "move") {
      await fs.move(srcFile, destFile, { overwrite: true });
    } else if (mode === "copy") {
      await fs.copy(srcFile, destFile, { overwrite: true });
    } else if (mode === "symlink") {
      if (await fs.pathExists(destFile)) await fs.remove(destFile);
      await fs.symlink(srcFile, destFile);
    } else {
      const outcome = await linkOrCopyFallback(srcFile, destFile);
      if (outcome === "copy") usedCopyFallback = true;
    }
    transferredAny = true;
  }

  if (!transferredAny) {
    throw new Error("No files to transfer after applying exclusions");
  }

  if (mode === "move") {
    await fs.remove(source).catch(() => undefined);
  }

  return mode === "hardlink" && usedCopyFallback ? "copy" : mode;
}

async function transferFile(
  source: string,
  destination: string,
  mode: TransferMode,
  excludePaths?: Set<string>
): Promise<TransferMode> {
  const stats = await fs.stat(source);
  const hasExcludes = !!excludePaths && excludePaths.size > 0;

  if (stats.isDirectory() && (mode === "hardlink" || hasExcludes)) {
    return transferDirectoryPerFile(source, destination, mode, excludePaths ?? new Set());
  }

  await ensureParentDir(destination);

  if (mode === "move") {
    await fs.move(source, destination, { overwrite: true });
    return "move";
  }

  if (mode === "copy") {
    await fs.copy(source, destination, { overwrite: true });
    return "copy";
  }

  if (mode === "symlink") {
    if (await fs.pathExists(destination)) await fs.remove(destination);
    await fs.symlink(source, destination);
    return "symlink";
  }

  return linkOrCopyFallback(source, destination);
}

export async function gatherFiles(rootPath: string): Promise<string[]> {
  const stats = await fs.stat(rootPath);
  if (!stats.isDirectory()) return [rootPath];

  const relFiles = await walkRelative(rootPath);
  return relFiles.map((rel) => path.join(rootPath, rel));
}

export class PCImportStrategy implements ImportStrategy {
  async planImport(
    sourcePath: string,
    game: Game,
    targetRoot: string,
    config: ImportConfig,
    platformDir?: string,
    options?: PlanImportOptions
  ): Promise<ImportReview> {
    if (isSensitivePath(sourcePath)) {
      throw new Error("Refusing to process a sensitive system path");
    }

    const stats = await fs.stat(sourcePath);
    const cleanTitle = sanitizeFsName(game.title);
    const ext = options?.treatAsDirectory || stats.isDirectory() ? "" : path.extname(sourcePath);
    const destination = path.join(targetRoot, platformDir ?? "PC", cleanTitle + ext);

    const destinationExists = await fs.pathExists(destination);
    const needsReview = destinationExists && !config.overwriteExisting;

    return {
      needsReview,
      reviewReason: needsReview ? "Destination already exists" : undefined,
      originalPath: sourcePath,
      proposedPath: destination,
      strategy: "pc",
    };
  }

  async executeImport(
    review: ImportReview,
    transferMode: TransferMode,
    excludePaths?: Set<string>
  ): Promise<ImportResult> {
    await fs.ensureDir(path.dirname(review.proposedPath));
    const modeUsed = await transferFile(
      review.originalPath,
      review.proposedPath,
      transferMode,
      excludePaths
    );
    const filesPlaced = await gatherFiles(review.proposedPath);
    return {
      destDir: review.proposedPath,
      filesPlaced,
      modeUsed,
      conflictsResolved: [],
    };
  }
}
