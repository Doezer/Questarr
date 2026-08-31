import { Game, ImportConfig } from "../../shared/schema.js";
import { categorizeDownload, type DownloadCategory } from "../../shared/download-categorizer.js";
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
  fileCategories?: FileCategoryEntry[];
  importResult?: ImportResult;
}

export interface FileCategoryEntry {
  name: string;
  category: DownloadCategory;
}

export interface ImportStrategy {
  planImport(
    sourcePath: string,
    game: Game,
    targetRoot: string,
    config: ImportConfig,
    platformDir?: string
  ): Promise<ImportReview>;
  executeImport(review: ImportReview, transferMode: TransferMode): Promise<ImportResult>;
}

async function ensureParentDir(filePath: string): Promise<void> {
  await fs.ensureDir(path.dirname(filePath));
}

// Linux's link(2) always rejects a directory target with EPERM — hard links
// only ever point at a single inode (a file), never a directory tree. So a
// directory source has to be walked and linked file-by-file (mirroring what
// `cp -al` does on the CLI), rather than handed to fs.link() as one call,
// which would otherwise always fail for a multi-file torrent/release.
async function hardlinkTree(source: string, destination: string): Promise<void> {
  const stats = await fs.lstat(source);
  if (!stats.isDirectory()) {
    await fs.link(source, destination);
    return;
  }

  await fs.ensureDir(destination);
  const entries = await fs.readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    await hardlinkTree(path.join(source, entry.name), path.join(destination, entry.name));
  }
}

async function transferFile(
  source: string,
  destination: string,
  mode: "move" | "copy" | "hardlink" | "symlink"
): Promise<"move" | "copy" | "hardlink" | "symlink"> {
  if (path.resolve(source) === path.resolve(destination)) {
    return mode;
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

  if (await fs.pathExists(destination)) {
    await fs.remove(destination);
  }

  try {
    await hardlinkTree(source, destination);
    return "hardlink";
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (
      code === "EXDEV" ||
      code === "EPERM" ||
      code === "EACCES" ||
      code === "ENOTSUP" ||
      code === "EOPNOTSUPP"
    ) {
      logger.warn(
        { source, destination, code },
        "[ImportStrategies] Hardlink failed, falling back to copy"
      );
      // Clean up any partial tree hardlinkTree() managed to create before
      // the failure, so the copy fallback isn't merging into leftovers.
      await fs.remove(destination).catch(() => undefined);
      await fs.copy(source, destination, { overwrite: true });
      return "copy";
    }
    throw error;
  }
}

async function gatherFiles(rootPath: string): Promise<string[]> {
  const stats = await fs.stat(rootPath);
  if (!stats.isDirectory()) return [rootPath];

  const collected: string[] = [];
  const stack: string[] = [rootPath];

  while (stack.length > 0) {
    const current = stack.pop() as string;
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else {
        collected.push(fullPath);
      }
    }
  }

  return collected;
}

const CATEGORY_DIR_MAP: Record<DownloadCategory, string> = {
  main: "",
  dlc: "dlc",
  update: "update",
  extra: "extra",
  packs: "packs",
};

async function categorizeSourceFiles(sourcePath: string): Promise<FileCategoryEntry[]> {
  const files = await gatherFiles(sourcePath);
  return files.map((filePath) => {
    const name = path.relative(sourcePath, filePath);
    return { name, category: categorizeDownload(name).category };
  });
}

function resolveContainedPath(root: string, candidate: string): string {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  if (
    resolvedCandidate !== resolvedRoot &&
    !resolvedCandidate.startsWith(resolvedRoot + path.sep)
  ) {
    throw new Error(`Import path escapes review root: ${candidate}`);
  }
  return resolvedCandidate;
}

function destinationForFile(gameDir: string, entry: FileCategoryEntry): string {
  const firstSegment = entry.name.split(path.sep)[0]?.toLowerCase();
  if (["dlc", "update", "extra", "packs"].includes(firstSegment ?? "")) {
    return path.join(gameDir, entry.name);
  }

  const subdir = CATEGORY_DIR_MAP[entry.category];
  if (!subdir) return path.join(gameDir, entry.name);
  return path.join(gameDir, subdir, entry.name);
}

export class PCImportStrategy implements ImportStrategy {
  async planImport(
    sourcePath: string,
    game: Game,
    targetRoot: string,
    config: ImportConfig,
    platformDir?: string
  ): Promise<ImportReview> {
    if (isSensitivePath(sourcePath)) {
      throw new Error("Refusing to process a sensitive system path");
    }

    const stats = await fs.stat(sourcePath);
    const cleanTitle = sanitizeFsName(game.title);
    const ext = stats.isDirectory() ? "" : path.extname(sourcePath);
    const destination = path.join(targetRoot, platformDir ?? "PC", cleanTitle + ext);
    const fileCategories =
      stats.isDirectory() && config.sortExtras
        ? await categorizeSourceFiles(sourcePath)
        : undefined;

    const destinationExists = await fs.pathExists(destination);
    const needsReview = destinationExists && !config.overwriteExisting;

    return {
      needsReview,
      reviewReason: needsReview ? "Destination already exists" : undefined,
      originalPath: sourcePath,
      proposedPath: destination,
      strategy: "pc",
      fileCategories,
    };
  }

  async executeImport(
    review: ImportReview,
    transferMode: "move" | "copy" | "hardlink" | "symlink"
  ): Promise<ImportResult> {
    if (review.fileCategories && review.fileCategories.length > 0) {
      const filesPlaced: string[] = [];
      const conflictsResolved: string[] = [];
      // Keep modeUsed as the originally-requested batch mode: a per-file fallback
      // (e.g. hardlink -> copy for one file among many) is recorded per-entry in
      // conflictsResolved instead, so it isn't lost by being overwritten here.
      const modeUsed: TransferMode = transferMode;

      const plannedTransfers = review.fileCategories.map((entry) => ({
        entry,
        sourceFile: resolveContainedPath(
          review.originalPath,
          path.join(review.originalPath, entry.name)
        ),
        destinationFile: resolveContainedPath(
          review.proposedPath,
          destinationForFile(review.proposedPath, entry)
        ),
      }));
      const destinations = new Set<string>();
      for (const { destinationFile } of plannedTransfers) {
        const resolvedDestination = path.resolve(destinationFile);
        if (destinations.has(resolvedDestination)) {
          throw new Error(`Duplicate import destination: ${resolvedDestination}`);
        }
        destinations.add(resolvedDestination);
      }

      for (const { entry, sourceFile, destinationFile } of plannedTransfers) {
        const entryMode = await transferFile(sourceFile, destinationFile, transferMode);
        filesPlaced.push(destinationFile);
        if (entryMode !== transferMode) {
          conflictsResolved.push(`${entry.name} (mode fallback: ${entryMode})`);
        }
      }

      const resolvedSource = path.resolve(review.originalPath);
      const resolvedDestination = path.resolve(review.proposedPath);
      const destinationInsideSource = resolvedDestination.startsWith(resolvedSource + path.sep);
      if (
        transferMode === "move" &&
        resolvedSource !== resolvedDestination &&
        !destinationInsideSource
      ) {
        await fs.remove(review.originalPath);
      }

      return {
        destDir: review.proposedPath,
        filesPlaced,
        modeUsed,
        conflictsResolved,
      };
    }

    await fs.ensureDir(path.dirname(review.proposedPath));
    const modeUsed = await transferFile(review.originalPath, review.proposedPath, transferMode);
    const filesPlaced = await gatherFiles(review.proposedPath);
    return {
      destDir: review.proposedPath,
      filesPlaced,
      modeUsed,
      conflictsResolved: [],
    };
  }
}
