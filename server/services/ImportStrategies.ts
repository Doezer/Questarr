import { Game, ImportConfig, RomMConfig } from "../../shared/schema.js";
import fs from "fs-extra";
import path from "path";
import { randomUUID } from "crypto";
import { resolveRommPlatformDir, sanitizeFsName } from "./RommRouting.js";

export interface ImportResult {
  platformSlug?: string;
  platformDir?: string;
  destDir: string;
  filesPlaced: string[];
  modeUsed: "copy" | "move" | "hardlink" | "symlink";
  conflictsResolved: string[];
}

export interface ImportReview {
  needsReview: boolean;
  reviewReason?: string;
  originalPath: string;
  proposedPath: string;
  strategy: "pc" | "romm";
  ignoredExtensions?: string[];
  importResult?: ImportResult;
}

export interface ImportStrategy {
  planImport(
    sourcePath: string,
    game: Game,
    targetRoot: string,
    config: ImportConfig,
    rommConfig?: RomMConfig
  ): Promise<ImportReview>;
  executeImport(
    review: ImportReview,
    transferMode: "move" | "copy" | "hardlink" | "symlink",
    rommConfig?: RomMConfig
  ): Promise<ImportResult>;
}

async function ensureParentDir(filePath: string): Promise<void> {
  await fs.ensureDir(path.dirname(filePath));
}

async function transferFile(
  source: string,
  destination: string,
  mode: "move" | "copy" | "hardlink" | "symlink"
): Promise<"move" | "copy" | "hardlink" | "symlink"> {
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
    await fs.link(source, destination);
    return "hardlink";
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EXDEV") {
      console.warn(
        `[transferFile] Hardlink failed across devices (EXDEV), falling back to copy: ${source} -> ${destination}`
      );
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
    const entries = await fs.readdir(current);
    for (const entry of entries) {
      const fullPath = path.join(current, entry);
      const entryStats = await fs.stat(fullPath);
      if (entryStats.isDirectory()) {
        stack.push(fullPath);
      } else {
        collected.push(fullPath);
      }
    }
  }

  return collected;
}

async function findAvailablePath(basePath: string): Promise<string> {
  if (!(await fs.pathExists(basePath))) return basePath;

  for (let i = 1; i <= 5000; i += 1) {
    const candidate = `${basePath} (${i})`;
    if (!(await fs.pathExists(candidate))) return candidate;
  }

  return `${basePath}-${randomUUID().slice(0, 8)}`;
}

function applyTemplate(template: string, game: Game, platformSlug: string): string {
  const filled = template
    .replaceAll("{title}", game.title ?? "")
    .replaceAll("{Title}", game.title ?? "")
    .replaceAll("{platformSlug}", platformSlug)
    .replaceAll("{releaseId}", String(game.igdbId ?? game.id ?? ""));
  return sanitizeFsName(filled) || sanitizeFsName(game.title) || `game-${game.id}`;
}

function isIgnored(filePath: string, ignoredExtensions: string[]): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ignoredExtensions.includes(ext);
}

export class PCImportStrategy implements ImportStrategy {
  async planImport(
    sourcePath: string,
    game: Game,
    targetRoot: string,
    config: ImportConfig
  ): Promise<ImportReview> {
    const cleanTitle = sanitizeFsName(game.title);
    const destination = path.join(targetRoot, "PC", cleanTitle);

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
    transferMode: "move" | "copy" | "hardlink" | "symlink"
  ): Promise<ImportResult> {
    await fs.ensureDir(path.dirname(review.proposedPath));
    const modeUsed = await transferFile(review.originalPath, review.proposedPath, transferMode);
    return {
      destDir: review.proposedPath,
      filesPlaced: [review.proposedPath],
      modeUsed,
      conflictsResolved: [],
    };
  }
}

export class RomMImportStrategy implements ImportStrategy {
  constructor(
    private platformSlug: string,
    private onImportComplete?: (result: ImportResult) => void
  ) {}

  async planImport(
    sourcePath: string,
    game: Game,
    targetRoot: string,
    config: ImportConfig,
    rommConfig?: RomMConfig
  ): Promise<ImportReview> {
    if (!rommConfig) {
      return {
        needsReview: true,
        reviewReason: "RomM config is required for RomM imports",
        originalPath: sourcePath,
        proposedPath: "",
        strategy: "romm",
      };
    }

    const files = (await gatherFiles(sourcePath)).filter(
      (f) => !isIgnored(f, config.ignoredExtensions ?? [])
    );

    if (files.length === 0) {
      return {
        needsReview: true,
        reviewReason: "No valid ROM files found",
        originalPath: sourcePath,
        proposedPath: "",
        strategy: "romm",
      };
    }

    const platformDir = resolveRommPlatformDir({
      libraryRoot: rommConfig.libraryRoot || targetRoot,
      fsSlug: this.platformSlug,
      routingMode: rommConfig.platformRoutingMode,
      bindings: rommConfig.platformBindings,
      bindingMissingBehavior: rommConfig.bindingMissingBehavior,
    });

    const folderName = applyTemplate(
      rommConfig.folderNamingTemplate || "{title}",
      game,
      this.platformSlug
    );

    const isMultiFileGame = files.length > 1;
    let destDir = platformDir;

    if (isMultiFileGame) {
      destDir = path.join(platformDir, folderName);
    } else if (rommConfig.singleFilePlacement === "subfolder") {
      destDir = path.join(platformDir, folderName);
    }

    return {
      needsReview: false,
      originalPath: sourcePath,
      proposedPath: destDir,
      strategy: "romm",
      ignoredExtensions: config.ignoredExtensions ?? [],
      importResult: {
        platformSlug: this.platformSlug,
        platformDir,
        destDir,
        filesPlaced: [],
        modeUsed: rommConfig.moveMode,
        conflictsResolved: [],
      },
    };
  }

  async executeImport(
    review: ImportReview,
    transferMode: "move" | "copy" | "hardlink" | "symlink",
    rommConfig?: RomMConfig
  ): Promise<ImportResult> {
    if (!rommConfig) throw new Error("RomM config is required for RomM imports");

    const sourceStats = await fs.stat(review.originalPath);
    const sourceRoot = sourceStats.isDirectory()
      ? review.originalPath
      : path.dirname(review.originalPath);
    const sourceFiles = (await gatherFiles(review.originalPath)).filter(
      (f) => !isIgnored(f, review.ignoredExtensions ?? [])
    );

    const conflictsResolved: string[] = [];
    let destinationPath = review.proposedPath;

    if (await fs.pathExists(destinationPath)) {
      if (rommConfig.conflictPolicy === "skip") {
        return {
          ...(review.importResult ?? {
            platformSlug: this.platformSlug,
            platformDir: path.dirname(destinationPath),
            destDir: destinationPath,
            filesPlaced: [],
            modeUsed: transferMode,
            conflictsResolved: [],
          }),
          filesPlaced: [],
          modeUsed: transferMode,
          conflictsResolved: ["skip"],
        };
      }

      if (rommConfig.conflictPolicy === "fail") {
        throw new Error(`Destination already exists: ${destinationPath}`);
      }

      if (rommConfig.conflictPolicy === "rename") {
        const renamed = await findAvailablePath(destinationPath);
        conflictsResolved.push(
          `rename:${path.basename(destinationPath)}=>${path.basename(renamed)}`
        );
        destinationPath = renamed;
      }

      if (rommConfig.conflictPolicy === "overwrite") {
        await fs.remove(destinationPath);
        conflictsResolved.push("overwrite");
      }
    }

    await fs.ensureDir(path.dirname(destinationPath));
    const stagingPath = path.join(
      path.dirname(destinationPath),
      `.questarr-staging-${randomUUID().slice(0, 8)}`
    );
    await fs.ensureDir(stagingPath);

    const filesPlaced: string[] = [];
    let modeUsed: "copy" | "move" | "hardlink" | "symlink" = transferMode;

    try {
      for (const file of sourceFiles) {
        const relative = path.relative(sourceRoot, file);
        const stageFile = path.join(stagingPath, relative);
        const used = await transferFile(file, stageFile, transferMode);
        modeUsed = used;
      }

      if (sourceStats.isDirectory() || sourceFiles.length > 1) {
        await fs.move(stagingPath, destinationPath, { overwrite: false });
        const placed = await gatherFiles(destinationPath);
        filesPlaced.push(...placed);
      } else {
        const onlyFile = sourceFiles[0];
        const stageFile = path.join(stagingPath, path.basename(onlyFile));
        const singleTarget =
          path.extname(destinationPath) === ""
            ? path.join(destinationPath, path.basename(onlyFile))
            : destinationPath;
        await ensureParentDir(singleTarget);
        await fs.move(stageFile, singleTarget, {
          overwrite: rommConfig.conflictPolicy === "overwrite",
        });
        filesPlaced.push(singleTarget);
        await fs.remove(stagingPath);
      }
    } catch (error) {
      await fs.remove(stagingPath).catch(() => undefined);
      throw error;
    }

    const result: ImportResult = {
      platformSlug: review.importResult?.platformSlug ?? this.platformSlug,
      platformDir: review.importResult?.platformDir,
      destDir: destinationPath,
      filesPlaced,
      modeUsed,
      conflictsResolved,
    };

    this.onImportComplete?.(result);
    return result;
  }
}
