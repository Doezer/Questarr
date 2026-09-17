import { execFile } from "node:child_process";
import { accessSync, constants as fsConstants } from "node:fs";
import path from "node:path";
import fs from "fs-extra";
import { logger } from "../logger.js";

type ArchiveTool = "7zip" | "unrar";
type ExecFileResult = { stdout: string; stderr: string };

export interface ArchiveEntry {
  name: string;
  size: number;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const EXEC_TIMEOUT_MS = 30 * 60_000;
const EXEC_MAX_BUFFER = 10 * 1024 * 1024;

// A download client marking a transfer "complete" doesn't guarantee the file is fully
// synced/renamed into its final location yet — e.g. NFS/SMB write-back lag between the
// downloader's host and Questarr's, or a client doing a last move/rename right as the
// completion event fires. Reading the archive at that instant can see a truncated file,
// which surfaces as the exact same decode error a genuinely corrupt archive would produce.
// Retry the integrity test a couple of times with a short gap before concluding the archive
// itself is bad — cheap for a real failure (which fails fast, as seen in practice), and
// turns a spurious "corrupt" report into a successful import if it was just a timing race.
const ARCHIVE_TEST_MAX_ATTEMPTS = 3;
const ARCHIVE_TEST_RETRY_DELAYS_MS = [3_000, 8_000];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Marks errors that retrying can never fix (missing binary, unsupported format) so the
// integrity-test retry loop below can fail fast on them instead of burning several seconds
// re-running a check that will deterministically fail the same way every time.
class NonRetryableArchiveError extends Error {}

// A password-protected archive fails the exact same way every attempt — retrying it burns
// the same ~11s of delay as a genuinely corrupt archive for no benefit, and the generic
// "corrupt or incomplete, re-download" message this file's testArchive() throws afterward
// is actively wrong for this case (the archive is fine, it's just encrypted). Callers
// (ImportManager) catch this specifically to route the download to manual review with a
// password prompt instead of the generic failure message.
export class ArchivePasswordRequiredError extends Error {}

// Both unrar and 7-Zip mention "password" in every message they produce for an encrypted
// archive they can't read (unrar: e.g. a prompt-refusal or "wrong password" notice; 7-Zip:
// "Wrong password?"). Matching on the bare word "password" would also fire on a genuinely
// corrupt archive whose path/filename happens to contain it (e.g. "MyPasswordVault.rar"),
// since runTool's error text can include the file path — so this requires one of the actual
// diagnostic phrases both tools use for an encryption failure, not just the word appearing
// anywhere in the message.
function isPasswordProtectedError(message: string): boolean {
  return /wrong password|password protected|password is incorrect|password required|enter password/i.test(
    message
  );
}

// Resolves a CLI tool to a fixed, unwriteable absolute path — rather than letting execFile
// search $PATH for a bare command name — to avoid executing an attacker-controlled binary
// that could be placed earlier on the PATH. Mirrors server/apprise.ts's resolveAppriseBinary.
function makeBinaryResolver(envVar: string, candidates: string[]): () => string | null {
  let cached: string | null | undefined;
  return () => {
    if (cached !== undefined) {
      return cached;
    }
    // An explicit override replaces the built-in candidates entirely rather than adding to
    // them: if an operator points this at a specific binary, a typo'd or missing path should
    // fail loudly instead of silently falling back to a different tool they didn't ask for.
    const envPath = process.env[envVar];
    const searchList = envPath ? [envPath] : candidates;
    cached =
      searchList.find((candidate) => {
        try {
          accessSync(candidate, fsConstants.X_OK);
          return true;
        } catch {
          return false;
        }
      }) ?? null;
    return cached;
  };
}

// Alpine's `node:*-alpine` base is musl-libc only — it ships no
// /lib64/ld-linux-x86-64.so.2, so a glibc-linked binary (like the one the npm `7zip-bin`
// package bundles) can never execute there regardless of its permission bits; every attempt
// fails with ENOENT on the missing loader, not EACCES. Alpine's own `7zip` package (`apk add
// 7zip`) ships a musl-native build instead — command-line compatible with legacy 7za/7z — so
// resolve that on disk rather than depending on the npm package's binary.
const resolveSevenZipBinary = makeBinaryResolver("SEVENZIP_PATH", [
  "/usr/bin/7zz",
  "/usr/bin/7z",
  "/usr/lib/7zip/7zz",
]);

// Alpine dropped its own `unrar` package (RARLAB's license doesn't meet Alpine's packaging
// policy for main/community, even though it's free to use and redistribute), so this image
// bundles RARLAB's official Linux binary directly (see Dockerfile) rather than relying on an
// apk package. unrar reads legacy and RAR5 archives, including multi-volume sets — both
// classic `.rNN` and modern `.partN.rar` naming — automatically, as long as every volume
// sits alongside the base archive (which it does: they're all in the same download folder).
const resolveUnrarBinary = makeBinaryResolver("UNRAR_PATH", [
  "/usr/local/bin/unrar",
  "/usr/bin/unrar",
]);

function resolveTool(filePath: string): ArchiveTool {
  return path.extname(filePath).toLowerCase() === ".rar" ? "unrar" : "7zip";
}

function runTool(binary: string, args: string[], toolLabel: string): Promise<ExecFileResult> {
  return new Promise((resolve, reject) => {
    execFile(
      binary,
      args,
      {
        encoding: "utf8",
        timeout: EXEC_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: EXEC_MAX_BUFFER,
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = (stderr || stdout || error.message).trim().slice(0, 500);
          reject(new Error(`${toolLabel} failed: ${detail}`));
          return;
        }
        resolve({ stdout, stderr });
      }
    );
  });
}

function runSevenZip(args: string[]): Promise<ExecFileResult> {
  const binary = resolveSevenZipBinary();
  if (!binary) {
    return Promise.reject(
      new NonRetryableArchiveError(
        "Archive extraction requires 7-Zip but no binary was found. Install the `7zip` apk package or set SEVENZIP_PATH."
      )
    );
  }
  return runTool(binary, args, "7-Zip");
}

function runUnrar(args: string[]): Promise<ExecFileResult> {
  const binary = resolveUnrarBinary();
  if (!binary) {
    return Promise.reject(
      new NonRetryableArchiveError(
        "RAR archive detected but no unrar binary was found. Install it (see Dockerfile) or set UNRAR_PATH."
      )
    );
  }
  return runTool(binary, args, "unrar");
}

// Parses `7z l -slt` output: a blank-line-delimited series of "Key = Value" blocks. The
// first block describes the archive itself (no "Folder" field) and is skipped; each
// following block describes one entry, with "Folder = +" marking a directory (excluded —
// only leaf files are returned, matching listEntries' contract).
function parseSevenZipSltListing(stdout: string): ArchiveEntry[] {
  const entries: ArchiveEntry[] = [];
  for (const block of stdout.split(/\r?\n\r?\n/)) {
    const fields: Record<string, string> = {};
    for (const line of block.split(/\r?\n/)) {
      const separatorIndex = line.indexOf(" = ");
      if (separatorIndex === -1) continue;
      fields[line.slice(0, separatorIndex).trim()] = line.slice(separatorIndex + 3).trim();
    }
    if (!("Folder" in fields) || !fields.Path) continue;
    if (fields.Folder === "+") continue;
    const size = Number(fields.Size);
    entries.push({ name: fields.Path, size: Number.isFinite(size) ? size : 0 });
  }
  return entries;
}

export class ArchiveService {
  // -y: assume yes on any prompt; -p<password> supplies a password when one is given,
  // otherwise -p- refuses to prompt for one (fail instead of hanging on an encrypted
  // archive); --: end of switches, so a filename starting with "-" can't be parsed as a flag.
  private async runSingleTest(
    filePath: string,
    tool: ArchiveTool,
    password?: string
  ): Promise<void> {
    if (tool === "unrar") {
      await runUnrar(["t", "-y", password ? `-p${password}` : "-p-", "--", filePath]);
    } else {
      await runSevenZip(["t", "-y", ...(password ? [`-p${password}`] : []), "--", filePath]);
    }
  }

  // Some failures short-circuit the retry loop entirely because retrying can never change the
  // outcome: a missing binary won't appear, and a password-protected archive fails identically
  // every time. Both re-throw as a more specific error type for the caller; anything else
  // returns normally so testArchive's loop can retry it as a possible transient read.
  private classifyNonRetryableFailure(err: unknown, password?: string): void {
    if (err instanceof NonRetryableArchiveError) {
      throw err;
    }
    if (err instanceof Error && isPasswordProtectedError(err.message)) {
      throw new ArchivePasswordRequiredError(
        password
          ? "The provided password was rejected — it may be incorrect."
          : "This archive is password-protected — a password is required to extract it."
      );
    }
  }

  private async testArchive(filePath: string, tool: ArchiveTool, password?: string): Promise<void> {
    logger.debug({ filePath, tool, hasPassword: !!password }, "Testing archive before extraction");

    let lastErr: unknown;
    for (let attempt = 1; attempt <= ARCHIVE_TEST_MAX_ATTEMPTS; attempt++) {
      try {
        await this.runSingleTest(filePath, tool, password);
        if (attempt > 1) {
          logger.info({ filePath, tool, attempt }, "Archive test succeeded after retry");
        }
        return;
      } catch (err) {
        this.classifyNonRetryableFailure(err, password);
        lastErr = err;
        if (attempt < ARCHIVE_TEST_MAX_ATTEMPTS) {
          logger.warn(
            { err, filePath, tool, attempt },
            "Archive test failed — retrying in case the file is still settling on disk"
          );
          await delay(ARCHIVE_TEST_RETRY_DELAYS_MS[attempt - 1]);
          continue;
        }
        logger.error(
          { err, filePath, tool, attempts: attempt },
          "Archive test failed — archive will not be extracted"
        );
      }
    }

    // By this point retries are exhausted, so a transient "still settling on disk" read is
    // ruled out — whatever's left genuinely can't be extracted (corrupt, truncated, or an
    // unsupported variant). Surface that plainly instead of the bare tool error text.
    const detail = lastErr instanceof Error ? lastErr.message : String(lastErr);
    throw new Error(
      `${detail} (the archive is corrupt or incomplete — re-download the release, extraction cannot recover this file)`
    );
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

  private async extractWithUnrar(
    filePath: string,
    outputDir: string,
    password?: string
  ): Promise<string[]> {
    // Trailing separator tells unrar the operand is a destination directory. -idq suppresses
    // the per-file "Extracting..." progress output — without it, a large multi-file archive
    // can exceed execFile's maxBuffer and fail with ERR_CHILD_PROCESS_STDIO_MAXBUFFER after
    // extraction has already started.
    await runUnrar([
      "x",
      "-idq",
      "-y",
      password ? `-p${password}` : "-p-",
      "--",
      filePath,
      outputDir + path.sep,
    ]);
    return this.listExtractedFiles(outputDir);
  }

  private async extractWith7zip(
    filePath: string,
    outputDir: string,
    password?: string
  ): Promise<string[]> {
    // -bso0/-bsp0 silence 7-Zip's normal output and progress streams for the same
    // maxBuffer-overflow reason as unrar's -idq above.
    await runSevenZip([
      "x",
      "-bso0",
      "-bsp0",
      "-y",
      ...(password ? [`-p${password}`] : []),
      `-o${outputDir}`,
      "--",
      filePath,
    ]);
    return this.listExtractedFiles(outputDir);
  }

  /**
   * Extracts an archive to a specified output directory.
   * @param filePath Full path to the archive file.
   * @param outputDir Directory where contents should be extracted.
   * @param password Password to supply for an encrypted archive. Omit for an unencrypted
   *   one; if the archive turns out to require one, `extract` rejects with
   *   {@link ArchivePasswordRequiredError} rather than the generic corruption message.
   * @returns Paths of files reported as extracted.
   */
  async extract(filePath: string, outputDir: string, password?: string): Promise<string[]> {
    const tool = resolveTool(filePath);
    logger.debug({ filePath, outputDir, tool, hasPassword: !!password }, "Extracting archive");

    // Validate before touching the filesystem, so a failing/unsupported archive never
    // leaves behind an empty output directory.
    await this.testArchive(filePath, tool, password);

    // Always start from a clean output directory: a prior extraction attempt that was
    // killed before its own cleanup ran (e.g. a container restart) can leave stale files
    // behind at this same path, which would otherwise get reported alongside — or instead
    // of — the files this run actually extracts. Can't unconditionally fs.emptyDir() it
    // though: ImportManager's move/copy import modes relocate the raw archive into
    // outputDir before calling extract() (extracting in place at the library
    // destination), so wiping the directory here would delete the very file about to be
    // read, and every extraction attempt would fail with a "file not found" from the
    // archive tool. When the archive already lives in outputDir, clear everything else
    // and leave it in place instead.
    const resolvedFilePath = path.resolve(filePath);
    const resolvedOutputDir = path.resolve(outputDir);
    if (path.dirname(resolvedFilePath) === resolvedOutputDir) {
      const archiveBasename = path.basename(resolvedFilePath);
      const entries = await fs.readdir(outputDir, { withFileTypes: true });
      await Promise.all(
        entries
          .filter((entry) => entry.name !== archiveBasename)
          .map((entry) => fs.remove(path.join(outputDir, entry.name)))
      );
    } else {
      await fs.emptyDir(outputDir);
    }

    let extractedFiles: string[];
    try {
      extractedFiles =
        tool === "unrar"
          ? await this.extractWithUnrar(filePath, outputDir, password)
          : await this.extractWith7zip(filePath, outputDir, password);
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
    const name = path.basename(filePath).toLowerCase();
    const ext = path.extname(name);
    if ([".zip", ".7z", ".rar", ".gz", ".tar", ".iso", ".bz2"].includes(ext)) return true;
    // Numbered multi-volume continuations don't carry a recognized extname on their own
    // (path.extname("game.7z.001") is ".001") but are still archives: classic RAR .rNN,
    // 7-Zip/zip .NNN splits ("game.7z.001", "game.zip.002"), and a bare "game.001" with
    // no format tag. Without this, a directory containing only numbered volumes (no
    // plain .rar/.7z/.zip file) would never be recognized as containing an archive at
    // all, and resolveArchive would import the volumes as loose files unextracted.
    return /\.(r\d{2,3}|7z\.\d{3}|zip\.\d{3}|\d{3})$/i.test(name);
  }

  /**
   * Lists an archive's file entries without extracting it. Directory entries
   * are excluded — only leaf files are returned.
   *
   * Always shells out to 7-Zip, even for .rar (which extraction routes to
   * unrar instead): 7-Zip's `-slt` mode has a stable, unambiguous
   * block-per-entry format regardless of archive type, whereas unrar's own
   * listing commands (`l`/`v`/`lb`) are column-aligned text tables whose
   * exact layout isn't safe to assume across the unrar builds this may run
   * against. 7-Zip has read-only support for RAR (including RAR5) built in,
   * so this works without needing unrar at all for the listing case.
   */
  async listEntries(filePath: string): Promise<ArchiveEntry[]> {
    logger.debug({ filePath }, "Listing archive contents");
    const { stdout } = await runSevenZip(["l", "-slt", "-p-", "--", filePath]);
    return parseSevenZipSltListing(stdout);
  }

  /**
   * Checks whether every file inside the archive already exists as a loose
   * file (same relative path and size) under baseDir — i.e. the archive has
   * already been extracted alongside itself by something upstream (a
   * download client's own post-processing, for example). Listing failures
   * (unsupported/unreadable archive for 7-Zip's listing path) are treated as
   * "can't tell" rather than propagated — this check is purely an
   * optimization to skip redundant extraction, never load-bearing for
   * correctness, so a failure here should fall through to a normal
   * extraction rather than fail the import.
   */
  async isAlreadyExtracted(archivePath: string, baseDir: string): Promise<boolean> {
    let entries: ArchiveEntry[];
    try {
      entries = await this.listEntries(archivePath);
    } catch (err) {
      logger.debug(
        { err, archivePath },
        "[ArchiveService] Could not list archive contents to check for a prior extraction — assuming not extracted"
      );
      return false;
    }
    if (entries.length === 0) return false;

    const resolvedBaseDir = path.resolve(baseDir);
    for (const entry of entries) {
      const normalizedName = entry.name.split(/[/\\]+/).join(path.sep);
      const candidatePath = path.resolve(baseDir, normalizedName);
      // entry.name comes from the archive's own (attacker-controllable) listing, not from
      // baseDir's contents — a crafted entry like "../elsewhere/file" would otherwise let
      // an external file the archive doesn't actually contain satisfy the match below.
      if (
        candidatePath !== resolvedBaseDir &&
        !candidatePath.startsWith(resolvedBaseDir + path.sep)
      ) {
        return false;
      }
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
    const archiveBasename = path.basename(archivePath);

    // A volume-suffix pattern (.partN.rar, .rNN, .7z.NNN, .zip.NNN, bare .NNN) has to be
    // stripped as its own alternative before the plain single-extension fallback: the
    // "main" archive passed in is often itself a numbered volume (e.g. 7-Zip splits
    // produce "Game.7z.001"/"Game.7z.002" with no separate "Game.7z"), and stripping
    // only a plain extension would leave the stem as "Game.7z.001", which then never
    // matches sibling "Game.7z.002" (whose own stem, by the same logic, would be
    // "Game.7z.002" — never equal). Matching the whole numbered-volume tail first
    // reduces every volume to the same "Game" stem regardless of which one was passed in.
    const stem = archiveBasename.replace(
      /\.(part\d+\.rar|r\d{2,3}|7z\.\d{3}|zip\.\d{3}|\d{3}|rar|zip|7z|gz|tar|iso|bz2)$/i,
      ""
    );

    // Which multi-volume naming scheme applies is determined by the selected archive's
    // own suffix — these schemes are format-specific and never mixed within one release,
    // so matching any numbered-suffix pattern regardless of family (as a single shared
    // regex previously did) could pull in an unrelated archive's volumes that merely
    // share a filename prefix, e.g. "Game.rar" incorrectly matching "Game.7z.001".
    let volumeSuffix: string | null;
    if (/\.part\d+\.rar$/i.test(archiveBasename)) {
      volumeSuffix = "part\\d+\\.rar";
    } else if (/\.(rar|r\d{2,3})$/i.test(archiveBasename)) {
      volumeSuffix = "r\\d{2,3}";
    } else if (/\.7z(\.\d{3})?$/i.test(archiveBasename)) {
      volumeSuffix = "7z\\.\\d{3}";
    } else if (/\.zip(\.\d{3})?$/i.test(archiveBasename)) {
      volumeSuffix = "zip\\.\\d{3}";
    } else if (/\.\d{3}$/.test(archiveBasename)) {
      volumeSuffix = "\\d{3}";
    } else {
      volumeSuffix = null;
    }
    const volumePattern = volumeSuffix
      ? new RegExp(`^${escapeRegExp(stem)}\\.(${volumeSuffix})$`, "i")
      : null;

    return siblingPaths.filter((siblingPath) => {
      if (path.resolve(siblingPath) === resolvedArchive) return true;
      return volumePattern ? volumePattern.test(path.basename(siblingPath)) : false;
    });
  }
}
