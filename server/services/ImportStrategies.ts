import { Game, ImportConfig } from "../../shared/schema.js";
import fs from "fs-extra";
import path from "path";

export interface ImportReview {
  needsReview: boolean;
  reviewReason?: string;
  originalPath: string;
  proposedPath: string; // The final destination including filename
  strategy: "pc" | "romm";
}

export interface ImportStrategy {
  canHandle(game: Game): boolean;
  /**
   * Generates a plan for the import. Does NOT move files yet.
   */
  planImport(
    sourcePath: string,
    game: Game,
    targetRoot: string,
    config: ImportConfig
  ): Promise<ImportReview>;
  /**
   * Executes the import based on the review.
   */
  executeImport(review: ImportReview, deleteSource: boolean): Promise<void>;
}

export class PCImportStrategy implements ImportStrategy {
  canHandle(game: Game): boolean {
    // Basic logic: if platforms include PC (id 6) or if it's not a known console platform?
    // For now, let's assume if it has "PC (Microsoft Windows)" (IGDB ID 6) it's a PC game.
    // Or we can rely on download category.
    // Let's check platforms JSON.
    return (
      !!game.platforms?.includes("PC (Microsoft Windows)") || !!game.platforms?.includes("Win")
    );
  }

  async planImport(
    sourcePath: string,
    game: Game,
    targetRoot: string,
    _config: ImportConfig
  ): Promise<ImportReview> {
    // For PC games, we usually move the whole folder or authorized installer files.
    // Assumption: sourcePath is a directory containing the game.
    // Destination: targetRoot/PC/{Game Title}

    // Clean title for folder name
    const cleanTitle = game.title.replace(/[\\/:*?"<>|]/g, "");
    const destination = path.join(targetRoot, "PC", cleanTitle);

    return {
      needsReview: false, // PC imports usually straightforward if we trust the folder
      originalPath: sourcePath,
      proposedPath: destination,
      strategy: "pc",
    };
  }

  async executeImport(review: ImportReview, _deleteSource: boolean): Promise<void> {
    console.log(`[PCImportStrategy] Moving ${review.originalPath} to ${review.proposedPath}`);
    await fs.ensureDir(path.dirname(review.proposedPath));

    // Use fs-extra move which handles cross-device
    await fs.move(review.originalPath, review.proposedPath, { overwrite: true });

    // Ensure permissions?
  }
}

export class RomMImportStrategy implements ImportStrategy {
  // Mapping of RomM folder names (slugs) provided by PlatformMappingService
  constructor(private platformSlug: string) {}

  canHandle(_game: Game): boolean {
    return true; // Use as fallback or explicitly selected by Manager
  }

  async planImport(
    sourcePath: string,
    game: Game,
    targetRoot: string,
    config: ImportConfig
  ): Promise<ImportReview> {
    // 1. Identify valid ROM file in sourcePath (if it's a folder)
    // If sourcePath is a file, use it.
    let fileToImport = sourcePath;

    if ((await fs.stat(sourcePath)).isDirectory()) {
      // Find largest file with valid extension
      const files = await fs.readdir(sourcePath);
      // Filter by ignored extensions
      const candidates = files.filter(
        (f: string) => !config.ignoredExtensions.includes(path.extname(f).toLowerCase())
      );
      // TODO: Recursive search or shallow? Shallow for now.
      // Sort by size
      let largestFile = "";
      let maxSize = 0;

      for (const f of candidates) {
        const fullPath = path.join(sourcePath, f);
        const stats = await fs.stat(fullPath);
        if (stats.size > maxSize) {
          maxSize = stats.size;
          largestFile = fullPath;
        }
      }

      if (!largestFile) {
        return {
          needsReview: true,
          reviewReason: "No valid ROM file found in directory",
          originalPath: sourcePath,
          proposedPath: "",
          strategy: "romm",
        };
      }
      fileToImport = largestFile;
    }

    // 2. Generate Clean Name
    // Pattern: {Title} ({Region})
    let filename = config.renamePattern.replace("{Title}", game.title).replace("{Region}", "World"); // Placeholder for region, hard to extract from metadata without Indexer info.
    // TODO: Pass explicit Region if available from Download/Indexer info.

    // Sanitize filename
    filename = filename.replace(/[\\/:*?"<>|]/g, "");

    // Add extension
    const ext = path.extname(fileToImport);
    filename += ext;

    // 3. Construct Path
    // targetRoot/{platformSlug}/{filename}
    const destination = path.join(targetRoot, "roms", this.platformSlug, filename);

    // 4. Check collisions
    let reviewRequired = false;
    let reason = undefined;
    if (await fs.pathExists(destination)) {
      if (!config.overwriteExisting) {
        reviewRequired = true;
        reason = "File already exists at destination";
      }
    }

    return {
      needsReview: reviewRequired,
      reviewReason: reason,
      originalPath: fileToImport,
      proposedPath: destination,
      strategy: "romm",
    };
  }

  async executeImport(review: ImportReview, _deleteSource: boolean): Promise<void> {
    console.log(`[RomMImportStrategy] Moving ${review.originalPath} to ${review.proposedPath}`);

    // Ensure parent dir
    await fs.ensureDir(path.dirname(review.proposedPath));

    // Atomic Move Logic:
    // 1. Move to .tmp file
    const tempDest = review.proposedPath + ".tmp";
    await fs.move(review.originalPath, tempDest, { overwrite: true });

    // 2. Rename to final
    await fs.move(tempDest, review.proposedPath, { overwrite: true });

    // 3. Delete Source folder if we imported a file from a folder and deleteSource is true
    // If originalPath was a file inside a folder, and we want to clean up the folder...
    // The ImportManager usually handles cleaning the ROOT download folder.
    // This executeImport handles moving the FILE.
    // The Manager should handle deleting the residual folder if it was a folder download.
  }
}
