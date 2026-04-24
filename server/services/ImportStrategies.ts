import { Game, ImportConfig } from "../../shared/schema.js";
import fs from "fs-extra";
import path from "node:path";
function sanitizeFsName(name: string | null | undefined): string {
  // eslint-disable-next-line no-control-regex
  return (name ?? "").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim();
}

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
  strategy: "pc";
  ignoredExtensions?: string[];
  importResult?: ImportResult;
}

export interface ImportStrategy {
  planImport(
    sourcePath: string,
    game: Game,
    targetRoot: string,
    config: ImportConfig
  ): Promise<ImportReview>;
  executeImport(
    review: ImportReview,
    transferMode: "move" | "copy" | "hardlink" | "symlink"
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
    const filesPlaced = await gatherFiles(review.proposedPath);
    return {
      destDir: review.proposedPath,
      filesPlaced,
      modeUsed,
      conflictsResolved: [],
    };
  }
}
