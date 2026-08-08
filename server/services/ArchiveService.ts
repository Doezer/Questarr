import { execFile } from "node:child_process";
import { accessSync, constants as fsConstants } from "node:fs";
import path from "node:path";
import node7z from "node-7z";
const { extractFull, test: run7zTest } = node7z;
import pathTo7zip from "7zip-bin";
import fs from "fs-extra";
import { logger } from "../logger.js";

const sevenZipPath = pathTo7zip.path7za;

type ArchiveTool = "7za" | "bsdtar";
type ExecFileResult = { stdout: string; stderr: string };

const BSDTAR_TIMEOUT_MS = 30 * 60_000;
const BSDTAR_MAX_BUFFER = 10 * 1024 * 1024;

// Known absolute install locations for the bsdtar CLI (Alpine's `libarchive-tools` package).
// libarchive's RAR reader (archive_read_support_format_rar / _rar5) covers both legacy and
// RAR5 archives, including multi-volume sets, without needing the non-free RARLAB `unrar`
// binary — which is no longer available as an Alpine package at all. Resolving to a fixed,
// unwriteable path — rather than letting execFile search $PATH for a bare "bsdtar" command —
// avoids executing an attacker-controlled binary that could be placed earlier on the PATH.
// Mirrors server/apprise.ts's resolveAppriseBinary.
const BSDTAR_BINARY_CANDIDATES = ["/usr/bin/bsdtar", "/usr/local/bin/bsdtar"];

let cachedBsdtarBinary: string | null | undefined;

function resolveBsdtarBinary(): string | null {
  if (cachedBsdtarBinary !== undefined) {
    return cachedBsdtarBinary;
  }

  const candidates = process.env.BSDTAR_PATH
    ? [process.env.BSDTAR_PATH, ...BSDTAR_BINARY_CANDIDATES]
    : BSDTAR_BINARY_CANDIDATES;

  cachedBsdtarBinary =
    candidates.find((candidate) => {
      try {
        accessSync(candidate, fsConstants.X_OK);
        return true;
      } catch {
        return false;
      }
    }) ?? null;

  return cachedBsdtarBinary;
}

function resolveTool(filePath: string): ArchiveTool {
  return path.extname(filePath).toLowerCase() === ".rar" ? "bsdtar" : "7za";
}

function runBsdtar(args: string[]): Promise<ExecFileResult> {
  const binary = resolveBsdtarBinary();
  if (!binary) {
    return Promise.reject(
      new Error(
        "RAR archive detected but no bsdtar binary was found. Install libarchive-tools or set BSDTAR_PATH."
      )
    );
  }

  return new Promise((resolve, reject) => {
    execFile(
      binary,
      args,
      {
        encoding: "utf8",
        timeout: BSDTAR_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: BSDTAR_MAX_BUFFER,
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = (stderr || stdout || error.message).trim().slice(0, 500);
          reject(new Error(`bsdtar failed: ${detail}`));
          return;
        }
        resolve({ stdout, stderr });
      }
    );
  });
}

export class ArchiveService {
  private testWith7z(filePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const stream = run7zTest(filePath, { $bin: sevenZipPath });
      stream.on("end", () => resolve());
      stream.on("error", (err: Error) => reject(err));
    });
  }

  private async testArchive(filePath: string, tool: ArchiveTool): Promise<void> {
    logger.debug({ filePath, tool }, "Testing archive before extraction");
    try {
      if (tool === "bsdtar") {
        await runBsdtar(["-tf", filePath]);
      } else {
        await this.testWith7z(filePath);
      }
    } catch (err) {
      logger.error({ err, filePath, tool }, "Archive test failed — archive will not be extracted");
      throw err;
    }
  }

  private async listExtractedFiles(outputDir: string): Promise<string[]> {
    const results: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const entryPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(entryPath);
        } else {
          results.push(entryPath);
        }
      }
    };
    await walk(outputDir);
    return results;
  }

  private async extractWithBsdtar(filePath: string, outputDir: string): Promise<string[]> {
    await runBsdtar(["-xf", filePath, "-C", outputDir]);
    return this.listExtractedFiles(outputDir);
  }

  private extractWith7z(filePath: string, outputDir: string): Promise<string[]> {
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

      stream.on("end", () => resolve(extractedFiles));
      stream.on("error", (err: Error) => reject(err));
    });
  }

  /**
   * Extracts an archive to a specified output directory.
   * @param filePath Full path to the archive file.
   * @param outputDir Directory where contents should be extracted.
   * @returns Paths of files reported as extracted.
   */
  async extract(filePath: string, outputDir: string): Promise<string[]> {
    const tool = resolveTool(filePath);
    logger.debug({ filePath, outputDir, tool }, "Extracting archive");

    // Validate before touching the filesystem, so a failing/unsupported archive never
    // leaves behind an empty output directory.
    await this.testArchive(filePath, tool);

    await fs.ensureDir(outputDir);

    let extractedFiles: string[];
    try {
      extractedFiles =
        tool === "bsdtar"
          ? await this.extractWithBsdtar(filePath, outputDir)
          : await this.extractWith7z(filePath, outputDir);
    } catch (err) {
      logger.error({ err, filePath, tool }, "Extraction failed");
      throw err;
    }

    if (extractedFiles.length === 0) {
      logger.warn(
        { filePath, outputDir, tool },
        "Extraction reported success but produced no files — the archive format or contents may not be fully supported"
      );
    } else {
      logger.debug({ count: extractedFiles.length, tool }, "Extraction complete");
    }

    return extractedFiles;
  }

  isArchive(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return [".zip", ".7z", ".rar", ".gz", ".tar", ".iso", ".bz2"].includes(ext);
  }
}
