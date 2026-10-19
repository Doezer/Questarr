import crypto from "node:crypto";
import net from "node:net";
import path from "node:path";
import fs from "fs-extra";
import { logger } from "./logger.js";
import { safeFetch, resolveSafeAddress, normalizeHostname } from "./ssrf.js";

const securityScanLogger = logger.child({ module: "security-scan" });

const VT_LOOKUP_TIMEOUT_MS = 10_000;
// A single absolute deadline covering connect through the final verdict —
// deliberately not an idle timeout (like net.Socket's own setTimeout), which
// resets on every read/write and so never fires while a slow clamd keeps
// trickling bytes back and forth for an arbitrarily long time.
const CLAMAV_SCAN_TIMEOUT_MS = 5 * 60 * 1000;
const CLAMAV_CHUNK_SIZE = 64 * 1024;
// Budget for scanning every file of one download. A slow but responsive clamd never
// trips the per-file deadline, so without it a large download could hold the import
// for hours; past it the download is held for manual review as not fully scanned.
export const CLAMAV_TOTAL_SCAN_BUDGET_MS = 30 * 60 * 1000;
// Without a limit, a pathological download with an enormous number of loose files
// would serialize that many sequential ClamAV round-trips before an import could
// proceed. Set well above the file count of an extracted game install, so that a
// normal download is always scanned in full; past it, the import is held for
// manual review rather than quarantined.
export const MAX_CLAMAV_SCAN_FILES = 10_000;

export interface VirusTotalSettings {
  enabled: boolean;
  apiKey: string | null;
  threshold: number;
  blockUnknownHashes: boolean;
}

export interface ClamAvSettings {
  enabled: boolean;
  host: string | null;
  port: number;
}

export type ScanVerdictSource = "virustotal" | "clamav";

export interface ScanResult {
  blocked: boolean;
  /**
   * Set (with blocked false) when a scanner could not examine every file. Nothing
   * was detected, but the download isn't known to be clean either, so it needs
   * the user's review before it is imported.
   */
  incomplete?: boolean;
  source?: ScanVerdictSource;
  reason?: string;
  hash?: string;
}

interface SystemConfigReader {
  getSystemConfig(key: string): Promise<string | undefined>;
}

function toBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value === "true";
}

function toInt(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function readVirusTotalSettings(
  storage: SystemConfigReader
): Promise<VirusTotalSettings> {
  const [enabled, apiKey, threshold, blockUnknown] = await Promise.all([
    storage.getSystemConfig("security.vt.enabled"),
    storage.getSystemConfig("security.vt.apiKey"),
    storage.getSystemConfig("security.vt.threshold"),
    storage.getSystemConfig("security.vt.blockUnknownHashes"),
  ]);

  return {
    enabled: toBool(enabled, false),
    apiKey: apiKey?.trim() || null,
    threshold: toInt(threshold, 2),
    blockUnknownHashes: toBool(blockUnknown, false),
  };
}

export async function readClamAvSettings(storage: SystemConfigReader): Promise<ClamAvSettings> {
  const [enabled, host, port] = await Promise.all([
    storage.getSystemConfig("security.clamav.enabled"),
    storage.getSystemConfig("security.clamav.host"),
    storage.getSystemConfig("security.clamav.port"),
  ]);

  return {
    enabled: toBool(enabled, false),
    host: host?.trim() || null,
    port: toInt(port, 3310),
  };
}

/** Streaming SHA-256 of a single file's contents, without loading it into memory. */
export async function computeFileSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

/**
 * Picks the "primary" artifact to hash when the download is a directory rather
 * than a single file: the largest file, on the assumption that installers/archives
 * dwarf any accompanying readme/nfo/sample files. Matches the task's framing of
 * "the downloaded archive or primary installer executable".
 */
async function resolvePrimaryFile(localPath: string): Promise<string | null> {
  const stat = await fs.stat(localPath).catch(() => null);
  if (!stat) return null;
  if (stat.isFile()) return localPath;
  if (!stat.isDirectory()) return null;

  let largest: { file: string; size: number } | null = null;
  const walk = async (dir: string): Promise<void> => {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath);
      } else if (entry.isFile()) {
        const entryStat = await fs.stat(entryPath).catch(() => null);
        if (entryStat && (!largest || entryStat.size > largest.size)) {
          largest = { file: entryPath, size: entryStat.size };
        }
      }
    }
  };
  await walk(localPath);
  return largest ? (largest as { file: string; size: number }).file : null;
}

interface ListAllFilesResult {
  files: string[];
  truncated: boolean;
  // Set when a readdir/stat call failed for a reason other than the path simply
  // not existing (e.g. EACCES, ENOTDIR). Swallowing those as an empty directory
  // would let scan() report a clean verdict without ever examining files it
  // could not enumerate, so callers must treat this the same as `truncated`.
  incomplete: boolean;
}

function isMissingPathError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === "ENOENT";
}

// Enumerates one file beyond the scan cap so a directory with exactly
// MAX_CLAMAV_SCAN_FILES entries can be told apart from one that actually had
// more — the latter must be reported as truncated so the caller can refuse to
// treat a partially-scanned directory as clean.
async function listAllFiles(localPath: string): Promise<ListAllFilesResult> {
  let stat;
  try {
    stat = await fs.stat(localPath);
  } catch (error) {
    if (isMissingPathError(error)) return { files: [], truncated: false, incomplete: false };
    securityScanLogger.warn(
      { error, localPath },
      "Could not stat download path; treating scan as incomplete"
    );
    return { files: [], truncated: false, incomplete: true };
  }
  if (stat.isFile()) return { files: [localPath], truncated: false, incomplete: false };
  if (!stat.isDirectory()) return { files: [], truncated: false, incomplete: false };

  const enumerationLimit = MAX_CLAMAV_SCAN_FILES + 1;
  const files: string[] = [];
  let incomplete = false;
  const walk = async (dir: string): Promise<void> => {
    if (files.length >= enumerationLimit) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (isMissingPathError(error)) return;
      securityScanLogger.warn(
        { error, dir },
        "Could not enumerate directory; treating scan as incomplete"
      );
      incomplete = true;
      return;
    }
    for (const entry of entries) {
      if (files.length >= enumerationLimit) return;
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath);
      } else if (entry.isFile()) {
        files.push(entryPath);
      }
    }
  };
  await walk(localPath);
  return {
    files: files.slice(0, MAX_CLAMAV_SCAN_FILES),
    truncated: files.length > MAX_CLAMAV_SCAN_FILES,
    incomplete,
  };
}

export type VirusTotalVerdict =
  | { status: "clean"; positives: number }
  | { status: "flagged"; positives: number }
  | { status: "unknown" }
  | { status: "error"; error: string };

/** GET /files/{hash} against the VirusTotal v3 API, with a hard 10s timeout. */
export async function checkVirusTotalHash(
  hash: string,
  apiKey: string
): Promise<VirusTotalVerdict> {
  try {
    const res = await safeFetch(`https://www.virustotal.com/api/v3/files/${hash}`, {
      method: "GET",
      headers: { "x-apikey": apiKey },
      timeoutMs: VT_LOOKUP_TIMEOUT_MS,
      requireHttps: true,
    });

    if (res.status === 404) {
      return { status: "unknown" };
    }

    if (!res.ok) {
      return { status: "error", error: `VirusTotal responded with ${res.status}` };
    }

    const body = (await res.json()) as {
      data?: { attributes?: { last_analysis_stats?: { malicious?: number } } };
    };
    const positives = body.data?.attributes?.last_analysis_stats?.malicious ?? 0;
    return positives > 0 ? { status: "flagged", positives } : { status: "clean", positives };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: "error", error: message };
  }
}

export type ClamAvVerdict =
  | { status: "clean" }
  | { status: "infected"; signature: string }
  | {
      status: "error";
      error: string;
      /** True when clamd itself failed (connection error, timeout), not just this file. */
      outage?: boolean;
    };

/** Strips clamd's "stream: " prefix and trailing " FOUND" from an INSTREAM reply. */
function extractClamAvSignature(reply: string): string {
  let signature = reply.trim();
  const prefixEnd = signature.indexOf(":");
  if (signature.toLowerCase().startsWith("stream:") && prefixEnd !== -1) {
    signature = signature.slice(prefixEnd + 1).trimStart();
  }
  if (signature.endsWith("FOUND")) {
    signature = signature.slice(0, -"FOUND".length).trimEnd();
  }
  return signature;
}

/** Streams a single file to clamd over its INSTREAM protocol and parses the verdict. */
/** Reads clamd's INSTREAM reply; anything but OK or FOUND is a refusal that names its reason. */
function verdictFromReply(reply: string): ClamAvVerdict {
  if (reply.includes("FOUND")) {
    const signature = extractClamAvSignature(reply);
    return { status: "infected", signature: signature || "unknown signature" };
  }
  if (reply.includes("OK")) return { status: "clean" };
  return { status: "error", error: reply };
}

function scanFileWithClamAv(
  filePath: string,
  connectAddress: string,
  port: number
): Promise<ClamAvVerdict> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let responseBuf = "";
    let settled = false;
    // Referenced from `finish()` (not just the connect callback below) so a
    // timeout or socket error can tear it down too — otherwise it keeps
    // reading the file to EOF against an already-destroyed socket, leaking
    // the file descriptor for as long as that takes.
    let readStream: fs.ReadStream | null = null;

    const finish = (verdict: ClamAvVerdict) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      readStream?.destroy();
      socket.destroy();
      resolve(verdict);
    };

    const deadline = setTimeout(
      () => finish({ status: "error", error: "ClamAV scan exceeded the time limit", outage: true }),
      CLAMAV_SCAN_TIMEOUT_MS
    );

    socket.once("error", (err) => {
      // clamd answers a refused stream (e.g. one over its StreamMaxLength) and then
      // resets the connection while the file is still being sent, so the reset
      // arrives as an error after the reply. That reply is the real verdict.
      const reply = responseBuf.replaceAll("\0", "").trim();
      finish(
        reply ? verdictFromReply(reply) : { status: "error", error: err.message, outage: true }
      );
    });

    socket.connect(port, connectAddress, () => {
      socket.write("zINSTREAM\0");

      readStream = fs.createReadStream(filePath, { highWaterMark: CLAMAV_CHUNK_SIZE });
      readStream.on("error", (err) => finish({ status: "error", error: err.message }));
      readStream.on("data", (chunk) => {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        const sizeHeader = Buffer.alloc(4);
        sizeHeader.writeUInt32BE(buf.length, 0);
        socket.write(sizeHeader);
        // clamd can read slower than we produce chunks; without backpressure
        // a large file would buffer entirely in the socket's internal write
        // queue before clamd catches up.
        if (!socket.write(buf)) {
          readStream?.pause();
          socket.once("drain", () => readStream?.resume());
        }
      });
      readStream.on("end", () => {
        const zeroLength = Buffer.alloc(4);
        socket.write(zeroLength);
      });
    });

    socket.on("data", (chunk) => {
      responseBuf += chunk.toString("utf8");
    });

    socket.on("close", () => {
      if (settled) return;
      const reply = responseBuf.replaceAll("\0", "").trim();
      // A connection closed with no reply means clamd itself is broken or
      // restarting, which is an outage like a socket error.
      finish(
        reply
          ? verdictFromReply(reply)
          : { status: "error", error: "Empty response from ClamAV", outage: true }
      );
    });
  });
}

/** Validates the configured ClamAV host resolves to a permitted address before connecting. */
async function connectableClamAvAddress(host: string): Promise<string> {
  const { address } = await resolveSafeAddress(normalizeHostname(host), true);
  return address;
}

export interface SecurityScanServiceDeps {
  getSystemConfig(key: string): Promise<string | undefined>;
}

/**
 * Orchestrates the pre-import security scan: an optional VirusTotal hash lookup
 * followed by an optional local ClamAV deep scan. VirusTotal fails open on
 * network/timeout errors. Only an actual detection, or an unknown hash under a
 * strict "block unknown hashes" policy, blocks the import. When ClamAV cannot
 * scan every file (outage, refused file, file cap, time budget), the result is
 * incomplete: not blocked, but held for the user to review.
 */
export class SecurityScanService {
  constructor(private readonly storage: SecurityScanServiceDeps) {}

  async scan(localPath: string): Promise<ScanResult> {
    const vtResult = await this.runVirusTotalCheck(localPath);
    if (vtResult) return vtResult;

    const clamAvResult = await this.runClamAvCheck(localPath);
    if (clamAvResult) return clamAvResult;

    return { blocked: false };
  }

  /** Returns a blocking ScanResult, or null when VirusTotal is disabled or found nothing blocking. */
  private async runVirusTotalCheck(localPath: string): Promise<ScanResult | null> {
    const vtSettings = await readVirusTotalSettings(this.storage);
    if (!vtSettings.enabled || !vtSettings.apiKey) return null;

    const primaryFile = await resolvePrimaryFile(localPath);
    if (!primaryFile) return null;

    const hash = await computeFileSha256(primaryFile).catch((err) => {
      securityScanLogger.warn({ err, primaryFile }, "Failed to hash file for VirusTotal");
      return null;
    });
    if (!hash) return null;

    const verdict = await checkVirusTotalHash(hash, vtSettings.apiKey);
    if (verdict.status === "flagged" && verdict.positives > vtSettings.threshold) {
      return {
        blocked: true,
        source: "virustotal",
        hash,
        reason: `VirusTotal detected ${verdict.positives} engine(s) flagging this file (threshold: ${vtSettings.threshold})`,
      };
    }

    if (verdict.status === "unknown") {
      securityScanLogger.warn(
        { hash },
        "Hash not found on VirusTotal (Unknown File). Proceeding based on user security tolerance."
      );
      if (vtSettings.blockUnknownHashes) {
        return {
          blocked: true,
          source: "virustotal",
          hash,
          reason: "Hash not found on VirusTotal and 'Block unknown hashes' is enabled",
        };
      }
    }

    if (verdict.status === "error") {
      securityScanLogger.warn(
        { hash, error: verdict.error },
        "VirusTotal lookup failed, proceeding without a verdict"
      );
    }

    return null;
  }

  /**
   * Returns a blocking ScanResult, an incomplete (non-blocking) one when not every
   * file could be scanned, or null when ClamAV is disabled or every file scanned clean.
   */
  private async runClamAvCheck(localPath: string): Promise<ScanResult | null> {
    const clamAvSettings = await readClamAvSettings(this.storage);
    if (!clamAvSettings.enabled || !clamAvSettings.host) return null;

    try {
      const connectAddress = await connectableClamAvAddress(clamAvSettings.host);
      const { files, truncated, incomplete } = await listAllFiles(localPath);
      if (truncated || incomplete) {
        // A partially- or incompletely-scanned directory must never be treated
        // as clean — an infected file past the enumeration cap, or hidden behind
        // a directory ClamAV's scanner couldn't read, would otherwise bypass
        // scanning entirely and be imported along with everything else. It isn't
        // a detection either, so it must not be quarantined (which moves the
        // files out of the client and breaks seeding): the caller holds it for
        // the user to review instead.
        securityScanLogger.warn(
          { localPath, limit: MAX_CLAMAV_SCAN_FILES, truncated, incomplete },
          "ClamAV scan could not examine every file; holding the import for manual review"
        );
        return {
          blocked: false,
          incomplete: true,
          source: "clamav",
          reason: incomplete
            ? "ClamAV scan could not enumerate every file in this download. Review it before importing."
            : `ClamAV did not scan this download: it has more than ${MAX_CLAMAV_SCAN_FILES} files. Review it before importing.`,
        };
      }

      const scanStartedAt = Date.now();
      const refusedFiles: string[] = [];
      let refusal = "";
      for (const file of files) {
        if (Date.now() - scanStartedAt > CLAMAV_TOTAL_SCAN_BUDGET_MS) {
          securityScanLogger.warn(
            { localPath, budgetMs: CLAMAV_TOTAL_SCAN_BUDGET_MS },
            "ClamAV scan ran out of time; holding the import for manual review"
          );
          return {
            blocked: false,
            incomplete: true,
            source: "clamav",
            reason:
              "ClamAV ran out of time before scanning every file. Review it before importing.",
          };
        }
        const verdict = await scanFileWithClamAv(file, connectAddress, clamAvSettings.port);
        if (verdict.status === "infected") {
          return {
            blocked: true,
            source: "clamav",
            reason: `ClamAV detected ${verdict.signature} in ${path.basename(file)}`,
          };
        }
        if (verdict.status === "error") {
          securityScanLogger.warn(
            { file, error: verdict.error },
            /size limit exceeded/i.test(verdict.error)
              ? "ClamAV skipped a file over its size limit; raise StreamMaxLength, MaxFileSize and MaxScanSize in clamd.conf to scan it"
              : "ClamAV could not scan a file"
          );
          // Stop once clamd itself is down: with thousands of files, a clamd that
          // stopped answering would otherwise cost a full timeout for each of them.
          if (verdict.outage) {
            return {
              blocked: false,
              incomplete: true,
              source: "clamav",
              reason:
                "ClamAV stopped responding before scanning every file. Review it before importing.",
            };
          }
          // A file-level refusal (e.g. over clamd's stream size limit) only skips
          // that file: the remaining files are still scanned, so a detection in
          // one of them still blocks, and the download is held for review after.
          refusedFiles.push(file);
          refusal ||= verdict.error;
        }
      }
      if (refusedFiles.length > 0) {
        // The raw error (which can name server paths) stays in the log above; the
        // reason shown to the user only says which kind of failure it was.
        const cause = /size limit exceeded/i.test(refusal)
          ? " over clamd's size limit. Raise StreamMaxLength, MaxFileSize and MaxScanSize in clamd.conf to scan large files."
          : ".";
        return {
          blocked: false,
          incomplete: true,
          source: "clamav",
          reason: `ClamAV could not scan ${refusedFiles.length} file(s), including ${path.basename(refusedFiles[0] ?? "")}${cause} Review it before importing.`,
        };
      }
    } catch (error) {
      securityScanLogger.warn(
        { error, host: clamAvSettings.host },
        "Could not reach ClamAV; holding the import for manual review"
      );
      return {
        blocked: false,
        incomplete: true,
        source: "clamav",
        reason: "ClamAV could not be reached to scan this download. Review it before importing.",
      };
    }

    return null;
  }
}
