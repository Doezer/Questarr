import node7z from "node-7z";
const { extractFull, list } = node7z;
import pathTo7zip from "7zip-bin";
import fs from "fs-extra";
import path from "node:path";
import { logger } from "../logger.js";

const sevenZipPath = pathTo7zip.path7za;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface ArchiveEntry {
  name: string;
  size: number;
}

export class ArchiveService {
  /**
   * Extracts an archive to a specified output directory.
   * @param filePath Full path to the archive file.
   * @param outputDir Directory where contents should be extracted.
   * @returns Paths of files reported as extracted by 7zip (constructed from event data).
   */
  async extract(filePath: string, outputDir: string): Promise<string[]> {
    logger.debug({ filePath, outputDir }, "Extracting archive");

    await fs.ensureDir(outputDir);

    return new Promise((resolve, reject) => {
      const extractedFiles: string[] = [];

      const stream = extractFull(filePath, outputDir, {
        $bin: sevenZipPath,
        $progress: true,
        recursive: true,
      });

      stream.on("data", (data: { status: string; file?: string }) => {
        // data.file is the relative path of the file being extracted
        if (data.status === "extracted" && data.file) {
          extractedFiles.push(path.join(outputDir, data.file));
        }
      });

      stream.on("end", () => {
        logger.debug({ count: extractedFiles.length }, "Extraction complete");
        resolve(extractedFiles);
      });

      stream.on("error", (err: Error) => {
        logger.error({ err }, "Extraction failed");
        reject(err);
      });
    });
  }

  isArchive(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return [".zip", ".7z", ".rar", ".gz", ".tar", ".iso", ".bz2"].includes(ext);
  }

  /**
   * Lists an archive's file entries without extracting it.
   * Directory entries are excluded — only leaf files are returned.
   */
  async listEntries(filePath: string): Promise<ArchiveEntry[]> {
    logger.debug({ filePath }, "Listing archive contents");

    return new Promise((resolve, reject) => {
      const entries: ArchiveEntry[] = [];

      const stream = list(filePath, { $bin: sevenZipPath, recursive: true });

      stream.on("data", (data: { file?: string; size?: number; attributes?: string }) => {
        const isDirectory = (data.attributes ?? "").trim().toUpperCase().startsWith("D");
        if (data.file && !isDirectory) {
          entries.push({ name: data.file, size: data.size ?? 0 });
        }
      });

      stream.on("end", () => resolve(entries));

      stream.on("error", (err: Error) => {
        logger.error({ err, filePath }, "Listing archive contents failed");
        reject(err);
      });
    });
  }

  /**
   * Checks whether every file inside the archive already exists as a loose
   * file (same relative path and size) under baseDir — i.e. the archive has
   * already been extracted alongside itself by something upstream (a
   * download client's own post-processing, for example).
   */
  async isAlreadyExtracted(archivePath: string, baseDir: string): Promise<boolean> {
    const entries = await this.listEntries(archivePath);
    if (entries.length === 0) return false;

    for (const entry of entries) {
      const normalizedName = entry.name.split(/[/\\]+/).join(path.sep);
      const candidatePath = path.join(baseDir, normalizedName);
      try {
        const stats = await fs.stat(candidatePath);
        if (stats.isDirectory() || stats.size !== entry.size) return false;
      } catch {
        return false;
      }
    }

    return true;
  }

  /**
   * Given a main archive path and the absolute paths of its siblings,
   * returns the subset that belongs to the same archive: the main archive
   * itself plus any split/multi-part volume companions (.r00, .part2.rar,
   * .7z.002, etc).
   */
  findVolumeSiblings(archivePath: string, siblingPaths: string[]): string[] {
    const resolvedArchive = path.resolve(archivePath);
    const stem = path
      .basename(archivePath)
      .replace(/\.part\d+\.rar$/i, "")
      .replace(/\.(rar|zip|7z|gz|tar|iso|bz2)$/i, "");
    const volumePattern = new RegExp(
      `^${escapeRegExp(stem)}\\.(r\\d{2,3}|part\\d+\\.rar|7z\\.\\d{3}|zip\\.\\d{3}|\\d{3})$`,
      "i"
    );

    return siblingPaths.filter((siblingPath) => {
      if (path.resolve(siblingPath) === resolvedArchive) return true;
      return volumePattern.test(path.basename(siblingPath));
    });
  }
}
