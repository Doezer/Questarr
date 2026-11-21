/**
 * Setup checks ("Diagnostics" page).
 *
 * Read-only checks that explain *why* a setup does not work: paths and
 * permissions, hardlink feasibility, indexer / downloader reachability, archive
 * tools and optional services. Each check ends in pass / warn / fail plus a
 * plain-language fix. Nothing is repaired automatically.
 *
 * Network probes reuse the existing client `testConnection` calls, which go
 * through the SSRF-protected fetch; the ClamAV probe resolves its host through
 * `resolveSafeAddress` first. Apprise is only reported as configured or not: its
 * own test sends a real notification, which a read-only page must not do.
 */
import fs from "node:fs";
import path from "node:path";
import { storage } from "./storage.js";
import { probeRootFolder } from "./root-folders.js";
import { DownloaderManager } from "./downloaders.js";
import { torznabClient } from "./torznab.js";
import { newznabClient } from "./newznab.js";
import { indexerAllowsApiKey } from "./indexer-caps.js";
import { PathMappingService } from "./services/PathMappingService.js";
import { getArchiveToolPaths } from "./services/ArchiveService.js";
import { readClamAvSettings, testClamAvConnectivity } from "./security-scan.js";
import { readAppriseSettings, isAppriseConfigured } from "./apprise.js";
import { resolveSafeAddress, normalizeHostname } from "./ssrf.js";
import type { Downloader, Indexer } from "../shared/schema.js";

export type CheckStatus = "pass" | "warn" | "fail" | "skip";
export type CheckGroup = "paths" | "indexers" | "downloaders" | "tools";

export interface SetupCheck {
  id: string;
  group: CheckGroup;
  title: string;
  status: CheckStatus;
  message: string;
  /** Plain-language next step, present on warn / fail. */
  fix?: string;
}

export interface SetupCheckReport {
  generatedAt: string;
  summary: Record<CheckStatus, number>;
  checks: SetupCheck[];
}

const PROBE_TIMEOUT_MS = 20_000;
const CONCURRENCY = 4;
const LOW_DISK_BYTES = 5 * 1024 ** 3;

const isUsenetProtocol = (protocol: string): boolean =>
  protocol === "newznab" || protocol === "g4u";

const GB = (bytes: number): string => `${(bytes / 1024 ** 3).toFixed(1)} GB`;

/** Reject after `ms` so one hung endpoint cannot stall the whole report. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${ms / 1000} s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** One shared pool so indexer, downloader and ClamAV probes never exceed CONCURRENCY together. */
type Limiter = <T>(task: () => Promise<T>) => Promise<T>;

function createLimiter(limit: number): Limiter {
  let active = 0;
  const waiting: Array<() => void> = [];
  // A finishing task hands its slot straight to the next waiter, so `active` never dips
  // below what is really running and a late caller cannot slip past the limit.
  const release = (): void => {
    const next = waiting.shift();
    if (next) next();
    else active--;
  };
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= limit) {
      await new Promise<void>((resolve) => waiting.push(resolve));
    } else {
      active++;
    }
    try {
      return await task();
    } finally {
      release();
    }
  };
}

const errText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

async function dirDevice(dir: string): Promise<number | null> {
  try {
    const stat = await fs.promises.stat(dir);
    return stat.isDirectory() ? stat.dev : null;
  } catch {
    return null;
  }
}

async function checkWritable(dir: string): Promise<string | null> {
  try {
    await fs.promises.access(dir, fs.constants.W_OK);
    return null;
  } catch (error) {
    return errText(error);
  }
}

export async function checkPaths(): Promise<SetupCheck[]> {
  const checks: SetupCheck[] = [];
  const config = await storage.getImportConfig();
  const libraryRoot = config.libraryRoot?.trim();

  if (!libraryRoot) {
    checks.push({
      id: "library-root",
      group: "paths",
      title: "Library root",
      status: "fail",
      message: "No library root is configured.",
      fix: "Set the library root in Settings > Import so imported games have a destination.",
    });
  } else {
    const health = await probeRootFolder(libraryRoot);
    if (!health.accessible) {
      checks.push({
        id: "library-root",
        group: "paths",
        title: "Library root",
        status: "fail",
        message: `${libraryRoot} is not accessible: ${health.error ?? "unknown error"}.`,
        fix: "Check that the folder exists and is mounted into the container (Docker: add a volume for it), then fix its permissions for the user Questarr runs as.",
      });
    } else {
      const writeError = await checkWritable(libraryRoot);
      if (writeError) {
        checks.push({
          id: "library-root",
          group: "paths",
          title: "Library root",
          status: "fail",
          message: `${libraryRoot} exists but is not writable: ${writeError}.`,
          fix: "Imports need write access. Fix ownership or permissions (PUID/PGID in Docker) and make sure the volume is not mounted read-only.",
        });
      } else if (health.diskFreeBytes !== null && health.diskFreeBytes < LOW_DISK_BYTES) {
        checks.push({
          id: "library-root",
          group: "paths",
          title: "Library root",
          status: "warn",
          message: `${libraryRoot} is writable but only ${GB(health.diskFreeBytes)} is free.`,
          fix: "Free up disk space before importing large games.",
        });
      } else {
        const free = health.diskFreeBytes === null ? "" : `, ${GB(health.diskFreeBytes)} free`;
        checks.push({
          id: "library-root",
          group: "paths",
          title: "Library root",
          status: "pass",
          message: `${libraryRoot} exists and is writable${free}.`,
        });
      }
    }
  }

  const rootFolders = await storage.getAllRootFolders();
  for (const folder of rootFolders) {
    const health = await probeRootFolder(folder.path);
    const base = {
      id: `root-folder-${folder.id}`,
      group: "paths" as const,
      title: `Root folder ${folder.path}`,
    };
    if (!health.accessible) {
      checks.push({
        ...base,
        status: "fail",
        message: `Not accessible: ${health.error ?? "unknown error"}.`,
        fix: "Check that the folder exists, is mounted into the container and is readable by the Questarr user.",
      });
    } else if (health.diskFreeBytes !== null && health.diskFreeBytes < LOW_DISK_BYTES) {
      checks.push({
        ...base,
        status: "warn",
        message: `Readable, but only ${GB(health.diskFreeBytes)} is free.`,
        fix: "Free up disk space on this volume.",
      });
    } else {
      checks.push({ ...base, status: "pass", message: "Readable." });
    }
  }

  const mappings = await storage.getPathMappings();
  const libraryDev = libraryRoot ? await dirDevice(path.resolve(libraryRoot)) : null;
  for (const mapping of mappings) {
    const base = {
      id: `path-mapping-${mapping.id}`,
      group: "paths" as const,
      title: `Path mapping ${mapping.remotePath} → ${mapping.localPath}`,
    };
    const localDev = await dirDevice(path.resolve(mapping.localPath));
    if (localDev === null) {
      checks.push({
        ...base,
        status: "fail",
        message: `The local path ${mapping.localPath} does not exist or is not a folder inside Questarr.`,
        fix: "The local path is as Questarr sees it. In Docker, mount the downloader's download folder into the Questarr container and use that container path here.",
      });
      continue;
    }
    try {
      await fs.promises.access(mapping.localPath, fs.constants.R_OK);
    } catch (error) {
      checks.push({
        ...base,
        status: "fail",
        message: `The local path is not readable: ${errText(error)}.`,
        fix: "Give the Questarr user read access to the download folder.",
      });
      continue;
    }
    if (config.transferMode === "hardlink" && libraryDev !== null && libraryDev !== localDev) {
      checks.push({
        ...base,
        status: "warn",
        message:
          "Downloads and the library root are on different filesystems, so hardlinks are impossible.",
        fix: "Mount one parent folder (for example /data) that contains both the downloads and the library, or switch the transfer mode to copy or move in Settings > Import.",
      });
    } else if (config.transferMode === "hardlink" && libraryDev !== null) {
      checks.push({
        ...base,
        status: "pass",
        message: "Readable, same filesystem as the library root (hardlinks possible).",
      });
    } else {
      checks.push({ ...base, status: "pass", message: "Readable." });
    }
  }
  if (mappings.length === 0) {
    checks.push({
      id: "path-mappings-none",
      group: "paths",
      title: "Path mappings",
      status: "skip",
      message: "No path mappings configured.",
    });
  }
  return checks;
}

function indexerHints(
  indexer: Indexer
): { status: CheckStatus; message: string; fix?: string } | null {
  let url: URL;
  try {
    url = new URL(indexer.url);
  } catch {
    return {
      status: "fail",
      message: "The indexer URL is not a valid URL.",
      fix: "Edit the indexer and enter a full URL such as https://indexer.example/api.",
    };
  }
  const usenet = isUsenetProtocol(indexer.protocol);
  const lower = indexer.url.toLowerCase();
  if (usenet && lower.includes("torznab")) {
    return {
      status: "warn",
      message: "Protocol is Newznab but the URL looks like a Torznab feed.",
      fix: "Set the indexer protocol to Torznab, or use the matching URL.",
    };
  }
  if (!usenet && lower.includes("newznab")) {
    return {
      status: "warn",
      message: "Protocol is Torznab but the URL looks like a Newznab feed.",
      fix: "Set the indexer protocol to Newznab, or use the matching URL.",
    };
  }
  if (url.protocol === "http:" && !indexerAllowsApiKey(indexer)) {
    return {
      status: "warn",
      message: "The URL uses plain HTTP, so the API key is withheld from requests.",
      fix: "Use HTTPS (for example via your reverse proxy), or enable the insecure LAN option on a trusted network.",
    };
  }
  return null;
}

async function checkIndexer(indexer: Indexer): Promise<SetupCheck> {
  const base = { id: `indexer-${indexer.id}`, group: "indexers" as const, title: indexer.name };
  const hint = indexerHints(indexer);
  if (hint?.status === "fail") return { ...base, ...hint };
  const client = isUsenetProtocol(indexer.protocol) ? newznabClient : torznabClient;
  try {
    const result = await withTimeout(client.testConnection(indexer), PROBE_TIMEOUT_MS);
    if (!result.success) {
      return {
        ...base,
        status: "fail",
        message: result.message,
        fix:
          hint?.fix && !indexerAllowsApiKey(indexer)
            ? hint.fix
            : /40[13]|api key|unauthor/i.test(result.message)
              ? "The indexer rejected the API key. Re-copy it without spaces or quotes."
              : "Check the URL, that the indexer is up, and that Questarr can reach it (Docker network, TLS certificate, Prowlarr base URL).",
      };
    }
  } catch (error) {
    return {
      ...base,
      status: "fail",
      message: errText(error),
      fix: "Check the URL and that the indexer responds in time.",
    };
  }
  try {
    const categories = await withTimeout(client.getCategories(indexer), PROBE_TIMEOUT_MS);
    if (categories.length === 0) {
      return {
        ...base,
        status: "warn",
        message: "Reachable, but the indexer returned no categories.",
        fix: "The indexer may not support game categories; searches may come back empty.",
      };
    }
  } catch {
    // Reachable but caps unavailable: still usable, searches use default categories.
  }
  if (hint) return { ...base, ...hint };
  return { ...base, status: "pass", message: "Reachable, API key accepted." };
}

async function checkDownloader(
  downloader: Downloader,
  pathService: PathMappingService
): Promise<SetupCheck> {
  const base = {
    id: `downloader-${downloader.id}`,
    group: "downloaders" as const,
    title: downloader.name,
  };
  try {
    const result = await withTimeout(
      DownloaderManager.testDownloader(downloader),
      PROBE_TIMEOUT_MS
    );
    if (!result.success) {
      return {
        ...base,
        status: "fail",
        message: result.message,
        fix: "Check the URL and port, the credentials, and that the client's web interface is enabled and reachable from the Questarr container.",
      };
    }
    let host: string | null = null;
    try {
      host = new URL(downloader.url).hostname;
    } catch {
      host = null;
    }
    if (downloader.downloadPath) {
      const local = await pathService.translatePath(downloader.downloadPath, host);
      const dev = await dirDevice(path.resolve(local));
      if (dev === null) {
        return {
          ...base,
          status: "warn",
          message: `Connected, but the download path ${downloader.downloadPath} is not visible from Questarr${
            local === downloader.downloadPath
              ? " and no path mapping applies"
              : ` (mapped to ${local})`
          }.`,
          fix: "Add a path mapping in Settings > Import from the downloader's path to the same folder as mounted inside Questarr.",
        };
      }
    }
    if (
      downloader.url.toLowerCase().startsWith("http://") &&
      !downloader.allowInsecureLan &&
      downloader.username
    ) {
      return {
        ...base,
        status: "warn",
        message: "Connected, but credentials travel over plain HTTP.",
        fix: "Use HTTPS, or enable the insecure LAN option if the client is on a trusted network.",
      };
    }
    return {
      ...base,
      status: "pass",
      message: `Connected${result.message ? `: ${result.message}` : "."}`,
    };
  } catch (error) {
    return {
      ...base,
      status: "fail",
      message: errText(error),
      fix: "Check the downloader settings.",
    };
  }
}

export async function checkTools(
  limit: Limiter = createLimiter(CONCURRENCY)
): Promise<SetupCheck[]> {
  const checks: SetupCheck[] = [];
  const tools = getArchiveToolPaths();
  checks.push(
    tools.sevenZip
      ? { id: "tool-7z", group: "tools", title: "7-Zip", status: "pass", message: "Found." }
      : {
          id: "tool-7z",
          group: "tools",
          title: "7-Zip",
          status: "warn",
          message: "Not found; zip, 7z and similar archives cannot be extracted.",
          fix: "Install 7-Zip (the official Docker image includes it) or set SEVENZIP_PATH.",
        },
    tools.unrar
      ? { id: "tool-unrar", group: "tools", title: "unrar", status: "pass", message: "Found." }
      : {
          id: "tool-unrar",
          group: "tools",
          title: "unrar",
          status: "warn",
          message: "Not found; RAR archives cannot be extracted.",
          fix: "Install unrar or set UNRAR_PATH.",
        }
  );

  try {
    const clamav = await readClamAvSettings(storage);
    if (!clamav.enabled) {
      checks.push({
        id: "service-clamav",
        group: "tools",
        title: "ClamAV",
        status: "skip",
        message: "Not enabled.",
      });
    } else if (!clamav.host) {
      checks.push({
        id: "service-clamav",
        group: "tools",
        title: "ClamAV",
        status: "fail",
        message: "ClamAV scanning is enabled but no host is configured.",
        fix: "Set the ClamAV host and port in Settings > Security, or turn ClamAV off.",
      });
    } else {
      try {
        const { address } = await resolveSafeAddress(normalizeHostname(clamav.host), true);
        const ping = await limit(() => testClamAvConnectivity(address, clamav.port));
        checks.push(
          ping.success
            ? {
                id: "service-clamav",
                group: "tools",
                title: "ClamAV",
                status: "pass",
                message: "clamd answered PONG.",
              }
            : {
                id: "service-clamav",
                group: "tools",
                title: "ClamAV",
                status: "fail",
                message: ping.error ?? "No reply from clamd.",
                fix: "Check the host and port in Settings > Security and that clamd listens on TCP.",
              }
        );
      } catch (error) {
        checks.push({
          id: "service-clamav",
          group: "tools",
          title: "ClamAV",
          status: "fail",
          message: errText(error),
          fix: "The ClamAV host could not be resolved or is not allowed.",
        });
      }
    }
  } catch (error) {
    checks.push({
      id: "service-clamav",
      group: "tools",
      title: "ClamAV",
      status: "skip",
      message: errText(error),
    });
  }

  try {
    const apprise = await readAppriseSettings(storage);
    checks.push({
      id: "service-apprise",
      group: "tools",
      title: "Apprise",
      status: "skip",
      message: isAppriseConfigured(apprise)
        ? "Configured. Use the Test button in Settings > Notifications to send a test notification."
        : "Not configured.",
    });
  } catch {
    // Settings unavailable: nothing useful to report.
  }
  return checks;
}

export async function runSetupChecks(): Promise<SetupCheckReport> {
  const [indexers, downloaders] = await Promise.all([
    storage.getAllIndexers(),
    storage.getAllDownloaders(),
  ]);
  const pathService = new PathMappingService(storage);

  const limit = createLimiter(CONCURRENCY);
  const [paths, indexerChecks, downloaderChecks, tools] = await Promise.all([
    checkPaths(),
    Promise.all(indexers.filter((i) => i.enabled).map((i) => limit(() => checkIndexer(i)))),
    Promise.all(
      downloaders.filter((d) => d.enabled).map((d) => limit(() => checkDownloader(d, pathService)))
    ),
    checkTools(limit),
  ]);

  const checks = [...paths, ...indexerChecks, ...downloaderChecks, ...tools];
  if (indexerChecks.length === 0) {
    checks.push({
      id: "indexers-none",
      group: "indexers",
      title: "Indexers",
      status: "warn",
      message: "No enabled indexer.",
      fix: "Add an indexer on the Indexers page so Questarr can search for releases.",
    });
  }
  if (downloaderChecks.length === 0) {
    checks.push({
      id: "downloaders-none",
      group: "downloaders",
      title: "Downloaders",
      status: "warn",
      message: "No enabled download client.",
      fix: "Add a download client on the Downloaders page.",
    });
  }
  const summary: Record<CheckStatus, number> = { pass: 0, warn: 0, fail: 0, skip: 0 };
  for (const check of checks) summary[check.status]++;
  return { generatedAt: new Date().toISOString(), summary, checks };
}
