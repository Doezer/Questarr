import { Game, ImportConfig } from "../../shared/schema.js";
import { categorizeDownload, type DownloadCategory } from "../../shared/download-categorizer.js";
import fs from "fs-extra";
import path from "node:path";
import { logger } from "../logger.js";
import { isSensitivePath, assertWithinRoots } from "../path-security.js";
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
  reviewReason?: string | undefined;
  originalPath: string;
  proposedPath: string;
  strategy: "pc";
  ignoredExtensions?: string[];
  fileCategories?: FileCategoryEntry[] | undefined;
  importResult?: ImportResult;
}

export interface FileCategoryEntry {
  name: string;
  category: DownloadCategory;
}

export interface PlanImportOptions {
  // Force the destination to be treated as a directory (no extension), used
  // when a single-file archive source will be unpacked before landing in
  // the library — the destination is a directory of extracted files, not a
  // file sharing the archive's own extension.
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

// Walks from root down to filePath's parent one segment at a time, using lstat (which
// reports a symlink's own type rather than following it) rather than fs.ensureDir's
// plain mkdir -p semantics. An archive can extract a symlinked directory into a
// transfer's destination root before this runs; fs.ensureDir would silently follow
// that symlink for any later loose-file transfer sharing its name, writing outside
// root. Refusing to proceed through anything that isn't a genuine directory closes
// that path, whether the symlink is planted at root's immediate child or several
// segments down.
async function ensureParentDir(filePath: string, root: string): Promise<void> {
  const resolvedRoot = path.resolve(root);
  const parentDir = path.dirname(path.resolve(filePath));
  const relativeToRoot = path.relative(resolvedRoot, parentDir);
  const segments =
    relativeToRoot === "" || relativeToRoot === "." ? [] : relativeToRoot.split(path.sep);

  let current = resolvedRoot;
  await fs.ensureDir(current);
  for (const segment of segments) {
    current = path.join(current, segment);
    let stats;
    try {
      stats = await fs.lstat(current);
    } catch {
      await fs.mkdir(current);
      continue;
    }
    if (!stats.isDirectory()) {
      throw new Error(`Refusing to transfer through a non-directory or symlinked path: ${current}`);
    }
  }
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

function isHardlinkFallbackErrno(code: string | undefined): boolean {
  return (
    code === "EXDEV" ||
    code === "EPERM" ||
    code === "EACCES" ||
    code === "ENOTSUP" ||
    code === "EOPNOTSUPP"
  );
}

// Shared by both hardlink paths below: try the hardlink, and on a fallback-eligible
// errno (EXDEV/EPERM/EACCES/ENOTSUP/EOPNOTSUPP), log once and copy instead. `cleanup`
// runs before the copy — needed for the whole-tree path, where a failure can leave a
// partial tree behind that would otherwise merge into the copy fallback's output.
async function withHardlinkFallback(
  source: string,
  destination: string,
  attemptHardlink: () => Promise<void>,
  cleanup?: () => Promise<void>
): Promise<"hardlink" | "copy"> {
  if (await fs.pathExists(destination)) {
    await fs.remove(destination);
  }
  try {
    await attemptHardlink();
    return "hardlink";
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (!isHardlinkFallbackErrno(code)) throw error;
    logger.warn(
      { source, destination, code },
      "[ImportStrategies] Hardlink failed, falling back to copy"
    );
    if (cleanup) await cleanup();
    await fs.copy(source, destination, { overwrite: true });
    return "copy";
  }
}

async function linkOrCopyFallback(
  source: string,
  destination: string
): Promise<"hardlink" | "copy"> {
  return withHardlinkFallback(source, destination, () => fs.link(source, destination));
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

function isPathContainedIn(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative))
  );
}

async function transferDirectoryHardlink(
  source: string,
  destination: string
): Promise<TransferMode> {
  // withHardlinkFallback removes destination before linking — if destination is an
  // ancestor of source, that removal deletes source (and anything else already under
  // destination) before the hardlink is even attempted. And if destination is nested
  // inside source, hardlinkTree's own ensureDir(destination) plus its walk of source
  // would recurse into the very directory it just created. Reject both directions
  // before going anywhere near the filesystem.
  const resolvedSource = path.resolve(source);
  const resolvedDestination = path.resolve(destination);
  if (
    isPathContainedIn(resolvedDestination, resolvedSource) ||
    isPathContainedIn(resolvedSource, resolvedDestination)
  ) {
    throw new Error(
      `Source and destination directories must not overlap for a hardlink transfer: ${source} -> ${destination}`
    );
  }

  return withHardlinkFallback(
    source,
    destination,
    () => hardlinkTree(source, destination),
    () => fs.remove(destination).catch(() => undefined)
  );
}

async function transferSingleFile(
  source: string,
  destination: string,
  mode: TransferMode,
  root: string
): Promise<TransferMode> {
  await ensureParentDir(destination, root);

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

// Hardlinks can't target a directory as one call, and excluding specific
// files (e.g. a raw archive whose contents were already extracted straight
// to the destination) requires acting per-file rather than on the
// directory as a whole.
async function transferDirectoryPerFile(
  source: string,
  destination: string,
  mode: TransferMode,
  excludePaths: Set<string>
): Promise<TransferMode> {
  const relFiles = await walkRelative(source);
  const plannedTransfers = relFiles
    .map((rel) => ({
      rel,
      srcFile: path.join(source, rel),
      destFile: path.join(destination, rel),
    }))
    .filter(({ srcFile }) => !excludePaths.has(path.resolve(srcFile)));

  // destination can already hold files by the time this runs — e.g. an archive's
  // volumes are excluded here because they were already extracted straight into
  // destination, and transferSingleFile's unconditional overwrite would otherwise
  // silently replace an extracted file with an unrelated loose one of the same name.
  for (const { destFile } of plannedTransfers) {
    if (await fs.pathExists(destFile)) {
      throw new Error(`Destination already exists, refusing to overwrite: ${destFile}`);
    }
  }

  let usedCopyFallback = false;
  let transferredAny = false;

  for (const { srcFile, destFile } of plannedTransfers) {
    const entryMode = await transferSingleFile(srcFile, destFile, mode, destination);
    if (mode === "hardlink" && entryMode === "copy") usedCopyFallback = true;
    transferredAny = true;
  }

  if (!transferredAny) {
    throw new Error("No files to transfer after applying exclusions");
  }

  if (mode === "move") {
    const resolvedSource = path.resolve(source);
    const resolvedDestination = path.resolve(destination);
    const destinationInsideSource = resolvedDestination.startsWith(resolvedSource + path.sep);
    // A destination nested inside its own source (e.g. hardlink/symlink extraction
    // landing inside the source directory) must not have that source removed out from
    // under it — the per-entry loop above already transferred everything worth keeping.
    if (resolvedSource !== resolvedDestination && !destinationInsideSource) {
      await fs.remove(source).catch(() => undefined);
    }
  }

  return mode === "hardlink" && usedCopyFallback ? "copy" : mode;
}

async function transferFile(
  source: string,
  destination: string,
  mode: TransferMode,
  excludePaths?: Set<string>
): Promise<TransferMode> {
  if (path.resolve(source) === path.resolve(destination)) {
    return mode;
  }

  const stats = await fs.stat(source);
  const hasExcludes = !!excludePaths && excludePaths.size > 0;

  if (stats.isDirectory() && hasExcludes) {
    return transferDirectoryPerFile(source, destination, mode, excludePaths);
  }

  if (mode === "hardlink" && stats.isDirectory()) {
    return transferDirectoryHardlink(source, destination);
  }

  return transferSingleFile(source, destination, mode, path.dirname(destination));
}

export async function gatherFiles(rootPath: string): Promise<string[]> {
  if (isSensitivePath(rootPath)) {
    throw new Error("Refusing to process a sensitive system path");
  }

  const stats = await fs.stat(rootPath);
  if (!stats.isDirectory()) return [rootPath];

  const relFiles = await walkRelative(rootPath);
  return relFiles.map((rel) => path.join(rootPath, rel));
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

// An archive's final layout only exists once it's been extracted, so sortExtras
// categorization for an unpacked archive can't happen up front the way it does for a
// plain directory source (planImport/executeImport's fileCategories path, which reads
// the source before any transfer). Instead this runs as a cheap same-filesystem
// reorganization pass over the destination directory after extraction has already
// placed everything there.
export async function reorganizeBySortExtras(destDir: string): Promise<void> {
  const entries = await categorizeSourceFiles(destDir);
  const moves = entries.map((entry) => ({
    currentPath: path.resolve(path.join(destDir, entry.name)),
    desiredPath: path.resolve(destinationForFile(destDir, entry)),
  }));

  // Resolve every destination before moving anything: two entries landing on the same
  // categorized path (e.g. a root-level file and an identically-named one already
  // sitting in that category's subfolder) would otherwise have the second `fs.move`
  // silently overwrite the first with `overwrite: true`.
  const desiredPaths = new Set<string>();
  for (const { desiredPath } of moves) {
    if (desiredPaths.has(desiredPath)) {
      throw new Error(`Duplicate sortExtras destination: ${desiredPath}`);
    }
    desiredPaths.add(desiredPath);
  }

  for (const { currentPath, desiredPath } of moves) {
    if (currentPath === desiredPath) continue;
    await fs.ensureDir(path.dirname(desiredPath));
    await fs.move(currentPath, desiredPath, { overwrite: true });
  }
}

export class PCImportStrategy implements ImportStrategy {
  // Local filesystem roots a source path is allowed to live under, derived from
  // configured path mappings (see PathMappingService.getConfiguredRoots). Left empty
  // by default: with no mappings configured, translatePath() already passes remote
  // paths through unchanged and trusts the local filesystem wholesale, so there is no
  // meaningful root set to restrict against — the checks below are a no-op in that
  // case rather than fighting that existing trust model.
  constructor(private readonly sourceRoots: string[] = []) {}

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

    await assertWithinRoots(
      sourcePath,
      this.sourceRoots,
      "Refusing to process a path outside the configured downloader roots"
    );

    const stats = await fs.stat(sourcePath);
    const cleanTitle = sanitizeFsName(game.title);
    const ext = options?.treatAsDirectory || stats.isDirectory() ? "" : path.extname(sourcePath);
    const destination = path.join(targetRoot, platformDir ?? "PC", cleanTitle + ext);

    // sanitizeFsName strips filesystem-illegal characters but not ".." segments, so a
    // game title alone doesn't guarantee destination stays under targetRoot. Verify
    // containment the same way resolveContainedPath does below, rather than trusting
    // the title never contains a traversal sequence.
    const relativeToRoot = path.relative(targetRoot, destination);
    if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
      throw new Error("Computed destination escapes the configured library root");
    }

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
    transferMode: TransferMode,
    excludePaths?: Set<string>
  ): Promise<ImportResult> {
    // Checked once here rather than in transferFile/gatherFiles individually: the
    // categorized branch below calls transferSingleFile directly (bypassing
    // transferFile's own checks), so a single guard at this shared entry point is what
    // actually covers every branch, including that one.
    if (isSensitivePath(review.originalPath) || isSensitivePath(review.proposedPath)) {
      throw new Error("Refusing to process a sensitive system path");
    }

    // Same containment check as planImport, applied here too since executeImport is a
    // second, independent entry point: a confirmImport call can supply review.originalPath
    // directly, without ever going through planImport first.
    await assertWithinRoots(
      review.originalPath,
      this.sourceRoots,
      "Refusing to process a path outside the configured downloader roots"
    );

    if (review.fileCategories && review.fileCategories.length > 0) {
      const filesPlaced: string[] = [];
      const conflictsResolved: string[] = [];
      // Keep modeUsed as the originally-requested batch mode: a per-file fallback
      // (e.g. hardlink -> copy for one file among many) is recorded per-entry in
      // conflictsResolved instead, so it isn't lost by being overwritten here.
      const modeUsed: TransferMode = transferMode;

      const plannedTransfers = review.fileCategories
        .map((entry) => ({
          entry,
          sourceFile: resolveContainedPath(
            review.originalPath,
            path.join(review.originalPath, entry.name)
          ),
          destinationFile: resolveContainedPath(
            review.proposedPath,
            destinationForFile(review.proposedPath, entry)
          ),
        }))
        // Excluded entries (e.g. a raw archive already extracted straight to the
        // destination) stay untransferred — same as the plain-directory path below.
        .filter(({ sourceFile }) => !excludePaths?.has(path.resolve(sourceFile)));

      // If exclusions consumed the entire plan (isAlreadyExtracted's match doesn't
      // guarantee any file survives outside the excluded volume set), fail loudly the
      // same way transferDirectoryPerFile does — silently "succeeding" with an empty
      // filesPlaced would still finalize the import and, in move mode, remove
      // originalPath below despite having transferred nothing.
      if (plannedTransfers.length === 0) {
        throw new Error("No files to transfer after applying exclusions");
      }

      const destinations = new Set<string>();
      for (const { destinationFile } of plannedTransfers) {
        const resolvedDestination = path.resolve(destinationFile);
        if (destinations.has(resolvedDestination)) {
          throw new Error(`Duplicate import destination: ${resolvedDestination}`);
        }
        destinations.add(resolvedDestination);
      }

      // The check above only catches planned destinations colliding with each other.
      // For this transfer mode (unpackViaLinkedExtraction), destination can already
      // hold files an archive extracted straight into it before this runs, and
      // transferSingleFile's unconditional overwrite would otherwise silently replace
      // an extracted file with an unrelated loose one of the same name — the same
      // failure mode transferDirectoryPerFile guards against above.
      for (const { destinationFile } of plannedTransfers) {
        if (await fs.pathExists(destinationFile)) {
          throw new Error(`Destination already exists, refusing to overwrite: ${destinationFile}`);
        }
      }

      for (const { entry, sourceFile, destinationFile } of plannedTransfers) {
        const entryMode = await transferSingleFile(
          sourceFile,
          destinationFile,
          transferMode,
          review.proposedPath
        );
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
