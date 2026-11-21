import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Downloader, DownloadStatus, DownloadDetails, DdlJob } from "../../shared/schema.js";
import { DDL_MAX_LINKS, safeDdlFileName } from "../../shared/ddl-links.js";
import { downloadersLogger } from "../logger.js";
import { safeFetch } from "../ssrf.js";
import {
  parseRealDebridCredentials,
  refreshRealDebridToken,
  serializeRealDebridCredentials,
  REAL_DEBRID_API_BASE,
  type RealDebridCredentials,
} from "./realdebrid-auth.js";
import type {
  DownloadRequest,
  DownloadResult,
  DownloaderActionResult,
  DownloaderClient,
} from "./types.js";
import {
  DOWNLOAD_CLIENT_USER_AGENT,
  fetchWithMagnetDetection,
  findTorrentByTagNull,
  getErrorMessage,
} from "./utils.js";

import {
  MAX_STAGING_ATTEMPTS,
  STAGING_MARKER,
  TEMP_DIR,
  beginStagingJob,
  copyRemoteFile,
  jobKey,
  resolveStagedPaths,
  stagingJobs,
  type StagingJob,
} from "./debrid-staging.js";

// Existing importers (and tests) read the marker from here.
export { STAGING_MARKER };

const REFRESH_MARGIN_MS = 60_000;

interface RealDebridTorrent {
  id: string;
  filename: string;
  original_filename?: string;
  hash?: string;
  bytes: number;
  original_bytes?: number;
  progress: number;
  status: string;
  added?: string;
  ended?: string;
  speed?: number;
  seeders?: number;
  files?: Array<{ id: number; path: string; bytes: number; selected: number }>;
  links?: string[];
}

interface UnrestrictedLink {
  filename: string;
  filesize: number;
  download: string;
}

/** Direct-link (DDL) jobs get an id of "ddl" + 32 hex chars, so they never clash with torrent ids. */
const DDL_ID = /^ddl[a-f0-9]{32}$/;
export const isDdlJobId = (id: string): boolean => DDL_ID.test(id);

const IS_TEST = process.env.NODE_ENV === "test";
// Real-Debrid allows 250 requests a minute; one unrestrict call per part stays well below that.
const UNRESTRICT_SPACING_MS = IS_TEST ? 0 : 300;
const RATE_LIMIT_BACKOFF_MS = IS_TEST ? 1 : 2_000;
const MAX_RATE_LIMIT_RETRIES = 3;
const HOST_PATTERNS_TTL_MS = 60 * 60 * 1000;

const nextUnrestrictSlot = new Map<string, number>();
let folderPatterns: { at: number; patterns: RegExp[] } | null = null;

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true }
    );
  });

/** Real-Debrid sends host patterns as "/regex/flags" strings. */
function toRegExp(source: string): RegExp | null {
  const match = /^\/(.*)\/([a-z]*)$/s.exec(source);
  try {
    return match ? new RegExp(match[1] ?? "", match[2]) : new RegExp(source);
  } catch {
    return null;
  }
}

export interface DdlLinkCheck {
  link: string;
  supported: boolean;
  host?: string | undefined;
  filename?: string | undefined;
  filesize?: number | undefined;
  error?: string | undefined;
}

function selectedFiles(torrent: RealDebridTorrent) {
  return (torrent.files ?? []).filter((file) => file.selected === 1);
}

/**
 * Real-Debrid downloader. The torrent is fetched by Real-Debrid's servers; once it reports
 * "downloaded", the files are copied over HTTPS into `<downloadPath>/<torrent id>/` and only
 * then reported as completed, so the regular import pipeline sees ordinary local files.
 */
export class RealDebridClient implements DownloaderClient {
  private credentials: RealDebridCredentials | null;

  constructor(private readonly downloader: Downloader) {
    this.credentials = parseRealDebridCredentials(downloader.password);
  }

  // -- HTTP ---------------------------------------------------------------

  private async persistCredentials(
    previous: RealDebridCredentials,
    credentials: RealDebridCredentials
  ): Promise<void> {
    this.credentials = credentials;
    try {
      // Imported lazily: storage pulls in the whole database layer.
      const { storage } = await import("../storage.js");
      // A reconnect may have stored new credentials while this refresh was in flight:
      // never overwrite those with a token derived from the old connection.
      const stored = parseRealDebridCredentials(
        (await storage.getDownloader(this.downloader.id))?.password
      );
      if (stored && stored.accessToken !== previous.accessToken) {
        this.credentials = stored;
        return;
      }
      await storage.updateDownloader(this.downloader.id, {
        password: serializeRealDebridCredentials(credentials),
      });
    } catch (error) {
      downloadersLogger.warn(
        { error, downloaderId: this.downloader.id },
        "Could not save the refreshed Real-Debrid token"
      );
    }
  }

  private async refresh(): Promise<void> {
    if (!this.credentials) throw new Error("Real-Debrid is not connected");
    const previous = this.credentials;
    await this.persistCredentials(previous, await refreshRealDebridToken(previous));
  }

  private async api(
    pathname: string,
    init: RequestInit = {},
    options: { allowStatus?: number[]; paced?: boolean } = {}
  ): Promise<Response> {
    if (!this.credentials) {
      throw new Error("Real-Debrid is not connected. Authorize the account first.");
    }
    if (
      this.credentials.expiresAt !== undefined &&
      this.credentials.expiresAt - REFRESH_MARGIN_MS < Date.now() &&
      this.credentials.refreshToken
    ) {
      await this.refresh();
    }

    const send = () =>
      safeFetch(`${REAL_DEBRID_API_BASE}${pathname}`, {
        ...init,
        headers: {
          "User-Agent": DOWNLOAD_CLIENT_USER_AGENT,
          Authorization: `Bearer ${this.credentials?.accessToken ?? ""}`,
          ...init.headers,
        },
        requireHttps: true,
        timeoutMs: 30_000,
      });

    const pace = async () => {
      if (!options.paced) return;
      const id = this.downloader.id;
      const slot = Math.max(Date.now(), nextUnrestrictSlot.get(id) ?? 0);
      nextUnrestrictSlot.set(id, slot + UNRESTRICT_SPACING_MS);
      if (slot > Date.now()) await sleep(slot - Date.now(), init.signal ?? undefined);
    };
    await pace();
    let response = await send();
    // Refused calls count against the 250/min budget: back off instead of hammering.
    for (let retry = 1; response.status === 429 && retry <= MAX_RATE_LIMIT_RETRIES; retry++) {
      const retryAfter = Number(response.headers.get("retry-after"));
      const wait =
        Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(retryAfter * 1000, 30_000)
          : RATE_LIMIT_BACKOFF_MS * 2 ** (retry - 1);
      await response.body?.cancel().catch(() => undefined);
      await sleep(wait, init.signal ?? undefined);
      await pace();
      response = await send();
    }
    if (response.status === 401 && this.credentials.refreshToken) {
      await this.refresh();
      response = await send();
    }
    if (response.status === 401 || response.status === 403) {
      if (!options.allowStatus?.includes(response.status)) {
        throw new Error("Real-Debrid rejected the credentials. Reconnect the account.");
      }
    }
    if (!response.ok && !options.allowStatus?.includes(response.status)) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `Real-Debrid request failed (HTTP ${response.status}): ${body.slice(0, 200)}`
      );
    }
    return response;
  }

  private async json<T>(
    pathname: string,
    init?: RequestInit,
    signal?: AbortSignal,
    options?: { paced?: boolean }
  ): Promise<T> {
    const response = await this.api(pathname, signal ? { ...init, signal } : init, options);
    return (await response.json()) as T;
  }

  private form(values: Record<string, string>): RequestInit {
    return {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(values).toString(),
    };
  }

  // -- Staging ------------------------------------------------------------

  private stagingRoot(): string {
    const root = this.downloader.downloadPath?.trim();
    if (!root) {
      throw new Error(
        "Real-Debrid needs a staging path (the downloader's download path) to copy files into."
      );
    }
    return root;
  }

  private stagingDir(torrentId: string): string {
    // Real-Debrid ids are plain alphanumerics; anything else is never a staging folder.
    if (!/^[A-Za-z0-9]+$/.test(torrentId)) {
      throw new Error("Invalid Real-Debrid torrent id");
    }
    const root = path.resolve(this.stagingRoot());
    const dir = path.resolve(root, torrentId);
    if (!dir.startsWith(root + path.sep)) {
      throw new Error("Staging folder escapes the staging path");
    }
    return dir;
  }

  private async isStaged(torrentId: string): Promise<boolean> {
    try {
      await fs.access(path.join(this.stagingDir(torrentId), STAGING_MARKER));
      return true;
    } catch {
      return false;
    }
  }

  private startStaging(torrent: RealDebridTorrent): StagingJob {
    return this.startJob(torrent.id, torrent.bytes, (job) => this.stageFiles(torrent, job));
  }

  private startJob(
    id: string,
    bytesTotal: number,
    run: (job: StagingJob) => Promise<void>
  ): StagingJob {
    return beginStagingJob({
      downloaderId: this.downloader.id,
      id,
      bytesTotal,
      run,
      label: "Real-Debrid",
    });
  }

  private async stageFiles(torrent: RealDebridTorrent, job: StagingJob): Promise<void> {
    const dir = this.stagingDir(torrent.id);
    await fs.mkdir(dir, { recursive: true });

    const links = torrent.links ?? [];
    if (links.length === 0) throw new Error("Real-Debrid returned no download links");
    const files = selectedFiles(torrent);
    // Links come back in the order of the selected files. If the counts differ that mapping
    // cannot be trusted, and completion must never be published for a partial copy.
    if (files.length !== links.length) {
      throw new Error(
        `Real-Debrid returned ${links.length} links for ${files.length} selected files`
      );
    }
    const resolved = resolveStagedPaths(files.map((file) => file.path));

    for (const [index, link] of links.entries()) {
      job.abort.signal.throwIfAborted();
      const unrestricted = await this.json<UnrestrictedLink>(
        "/unrestrict/link",
        this.form({ link }),
        job.abort.signal
      );
      const target = path.join(dir, ...(resolved[index] ?? []));
      if (!target.startsWith(dir + path.sep)) {
        throw new Error(`Refusing to write outside the staging folder: ${target}`);
      }
      await this.downloadFile(unrestricted, target, dir, job);
    }

    job.abort.signal.throwIfAborted();
    await fs.rm(path.join(dir, TEMP_DIR), { recursive: true, force: true });
    await fs.writeFile(
      path.join(dir, STAGING_MARKER),
      JSON.stringify({ torrentId: torrent.id, stagedAt: new Date().toISOString() })
    );
    stagingJobs.delete(jobKey(this.downloader.id, torrent.id));
  }

  private downloadFile(
    file: UnrestrictedLink,
    target: string,
    dir: string,
    job: StagingJob
  ): Promise<void> {
    return copyRemoteFile(
      { url: file.download, size: file.filesize, label: "Real-Debrid" },
      target,
      dir,
      job
    );
  }

  // -- Status mapping -----------------------------------------------------

  private async toStatus(torrent: RealDebridTorrent, tracked = true): Promise<DownloadStatus> {
    const base = {
      id: torrent.id,
      name: torrent.original_filename || torrent.filename,
      downloadType: "torrent" as const,
      size: torrent.bytes,
      category: this.downloader.category ?? undefined,
      seeders: torrent.seeders,
    };

    switch (torrent.status) {
      case "magnet_error":
      case "error":
      case "virus":
      case "dead":
        return {
          ...base,
          status: "error",
          progress: torrent.progress,
          error: `Real-Debrid reported status "${torrent.status}"`,
        };
      case "waiting_files_selection":
        if (tracked) await this.selectAllFiles(torrent.id);
        return { ...base, status: "downloading", progress: 0 };
      case "downloaded":
        return this.stagingStatus(torrent, base, tracked);
      default:
        return {
          ...base,
          status: "downloading",
          // Real-Debrid's own phase fills the first half of the bar, local staging the rest.
          progress: Math.min(50, Math.round(torrent.progress / 2)),
          downloadSpeed: torrent.speed,
          downloaded: Math.round((torrent.bytes * torrent.progress) / 100),
        };
    }
  }

  private async stagingStatus(
    torrent: RealDebridTorrent,
    base: Omit<DownloadStatus, "status" | "progress">,
    tracked: boolean
  ): Promise<DownloadStatus> {
    if (await this.isStaged(torrent.id)) {
      return { ...base, status: "completed", progress: 100, downloaded: torrent.bytes };
    }
    // The account may hold torrents Questarr never added: never copy those on its own.
    if (!tracked) return { ...base, status: "paused", progress: 50 };
    const job = this.startStaging(torrent);
    // A failed copy is retried with a backoff, so a transient error stays "downloading".
    if (job.state === "failed" && job.attempts >= MAX_STAGING_ATTEMPTS) {
      return { ...base, status: "error", progress: 50, error: job.error ?? "Staging failed" };
    }
    const fraction = job.bytesTotal > 0 ? Math.min(1, job.bytesDone / job.bytesTotal) : 0;
    const elapsed = Math.max(1, (Date.now() - job.startedAt) / 1000);
    const speed = job.bytesDone / elapsed;
    return {
      ...base,
      status: "downloading",
      progress: Math.min(99, 50 + Math.round(fraction * 50)),
      downloaded: job.bytesDone,
      downloadSpeed: Math.round(speed),
      eta: speed > 0 ? Math.round((job.bytesTotal - job.bytesDone) / speed) : undefined,
    };
  }

  private async selectAllFiles(id: string): Promise<void> {
    await this.api(`/torrents/selectFiles/${encodeURIComponent(id)}`, this.form({ files: "all" }));
  }

  // -- Direct links (DDL) --------------------------------------------------

  /** Link patterns of hoster folders, cached: the list rarely changes. */
  private async folderPatterns(): Promise<RegExp[]> {
    if (folderPatterns && Date.now() - folderPatterns.at < HOST_PATTERNS_TTL_MS) {
      return folderPatterns.patterns;
    }
    const sources = await this.json<string[]>("/hosts/regexFolder");
    const patterns = sources.map(toRegExp).filter((p): p is RegExp => p !== null);
    folderPatterns = { at: Date.now(), patterns };
    return patterns;
  }

  /**
   * Turns what the user supplied into the final list of hoster links: hoster folders are replaced
   * by the links they contain and a DLC/CCF/RSDF container file is decrypted. Order is kept and
   * duplicates removed.
   */
  async expandLinks(links: string[], containerFile?: Buffer): Promise<string[]> {
    const result: string[] = [];
    const add = (link: string) => {
      if (!result.includes(link)) result.push(link);
    };
    const patterns = links.length > 0 ? await this.folderPatterns().catch(() => []) : [];
    for (const link of links) {
      if (patterns.some((pattern) => pattern.test(link))) {
        const inner = await this.json<string[]>(
          "/unrestrict/folder",
          this.form({ link }),
          undefined,
          { paced: true }
        );
        inner.forEach(add);
      } else {
        add(link);
      }
    }
    if (containerFile) {
      const response = await this.api(
        "/unrestrict/containerFile",
        {
          method: "PUT",
          headers: { "Content-Type": "application/octet-stream" },
          body: new Uint8Array(containerFile),
        },
        { paced: true }
      );
      ((await response.json()) as string[]).forEach(add);
    }
    if (result.length > DDL_MAX_LINKS) {
      throw new Error(`Too many links (${result.length}); the limit is ${DDL_MAX_LINKS}`);
    }
    return result;
  }

  /** Cheap health check: is each link supported and alive, and what is it called. */
  async checkLinks(links: string[]): Promise<DdlLinkCheck[]> {
    const results: DdlLinkCheck[] = [];
    for (const link of links.slice(0, DDL_MAX_LINKS)) {
      try {
        const info = await this.json<{
          host?: string;
          filename?: string;
          filesize?: number;
          supported?: number;
        }>("/unrestrict/check", this.form({ link }), undefined, { paced: true });
        results.push({
          link,
          supported: info.supported !== 0,
          host: info.host,
          filename: info.filename,
          filesize: info.filesize,
          error: info.supported === 0 ? "Host not supported by Real-Debrid" : undefined,
        });
      } catch (error) {
        results.push({ link, supported: false, error: getErrorMessage(error) });
      }
    }
    return results;
  }

  /** Registers a job for these links and starts fetching them. */
  async addLinks(input: {
    gameId: string;
    title: string;
    links: string[];
    password?: string | null | undefined;
  }): Promise<DownloadResult> {
    try {
      this.stagingRoot();
      if (input.links.length === 0) return { success: false, message: "No links to download" };
      if (input.links.length > DDL_MAX_LINKS) {
        return { success: false, message: `Too many links; the limit is ${DDL_MAX_LINKS}` };
      }
      const { storage } = await import("../storage.js");
      const id = `ddl${randomUUID().replace(/-/g, "")}`;
      const job = await storage.addDdlJob({
        id,
        downloaderId: this.downloader.id,
        gameId: input.gameId,
        title: input.title,
        links: input.links,
        password: input.password || null,
      });
      this.startJob(id, 0, (staging) => this.stageLinks(job, staging));
      return { success: true, message: "Links sent to Real-Debrid", id };
    } catch (error) {
      return { success: false, message: getErrorMessage(error) };
    }
  }

  private async stageLinks(ddl: DdlJob, job: StagingJob): Promise<void> {
    const dir = this.stagingDir(ddl.id);
    await fs.mkdir(dir, { recursive: true });
    const names: string[] = [];
    let totalBytes = 0;
    job.partsDone = 0;

    for (const [index, link] of ddl.links.entries()) {
      job.abort.signal.throwIfAborted();
      let unrestricted: UnrestrictedLink;
      try {
        unrestricted = await this.json<UnrestrictedLink>(
          "/unrestrict/link",
          this.form({ link }),
          job.abort.signal,
          { paced: true }
        );
      } catch (error) {
        if (job.abort.signal.aborted) throw error;
        throw new Error(`Part ${index + 1}/${ddl.links.length}: ${getErrorMessage(error)}`, {
          cause: error,
        });
      }
      names.push(safeDdlFileName(unrestricted.filename, `part-${index + 1}`));
      const segments = resolveStagedPaths(names).at(-1) ?? [];
      const target = path.join(dir, ...segments);
      if (!target.startsWith(dir + path.sep)) {
        throw new Error(`Refusing to write outside the staging folder: ${target}`);
      }
      job.partBase = job.bytesDone;
      job.partSize = unrestricted.filesize;
      job.bytesTotal = Math.max(job.bytesTotal, job.bytesDone + unrestricted.filesize);
      await this.downloadFile(unrestricted, target, dir, job);
      job.partsDone = index + 1;
      totalBytes += unrestricted.filesize;
    }

    job.abort.signal.throwIfAborted();
    await fs.rm(path.join(dir, TEMP_DIR), { recursive: true, force: true });
    await fs.writeFile(
      path.join(dir, STAGING_MARKER),
      JSON.stringify({
        jobId: ddl.id,
        stagedAt: new Date().toISOString(),
        bytes: totalBytes,
        parts: ddl.links.length,
        // Kept for the extraction step: multi-part archives are often passworded.
        archivePassword: ddl.password ?? undefined,
      })
    );
    stagingJobs.delete(jobKey(this.downloader.id, ddl.id));
  }

  private async readMarker(id: string): Promise<{ bytes?: number } | null> {
    try {
      const raw = await fs.readFile(path.join(this.stagingDir(id), STAGING_MARKER), "utf8");
      return JSON.parse(raw) as { bytes?: number };
    } catch {
      return null;
    }
  }

  private async ddlStatus(ddl: DdlJob, tracked = true): Promise<DownloadStatus> {
    const base = {
      id: ddl.id,
      name: ddl.title,
      downloadType: "torrent" as const,
      category: this.downloader.category ?? undefined,
    };
    const marker = await this.readMarker(ddl.id);
    if (marker) {
      return {
        ...base,
        status: "completed",
        progress: 100,
        size: marker.bytes,
        downloaded: marker.bytes,
      };
    }
    // As for torrents, a job nothing tracks any more (its game download was removed, or an import
    // moved the staged folder away) is never fetched again by a mere status poll.
    if (!tracked && !stagingJobs.has(jobKey(this.downloader.id, ddl.id))) {
      return { ...base, status: "paused", progress: 0 };
    }
    const job = this.startJob(ddl.id, 0, (staging) => this.stageLinks(ddl, staging));
    if (job.state === "failed" && job.attempts >= MAX_STAGING_ATTEMPTS) {
      return { ...base, status: "error", progress: 0, error: job.error ?? "Download failed" };
    }
    const total = ddl.links.length;
    const partFraction =
      job.partSize && job.partSize > 0
        ? Math.min(1, (job.bytesDone - (job.partBase ?? 0)) / job.partSize)
        : 0;
    const elapsed = Math.max(1, (Date.now() - job.startedAt) / 1000);
    const speed = job.bytesDone / elapsed;
    return {
      ...base,
      status: "downloading",
      progress: Math.min(99, Math.floor((((job.partsDone ?? 0) + partFraction) / total) * 100)),
      size: job.bytesTotal || undefined,
      downloaded: job.bytesDone,
      downloadSpeed: Math.round(speed),
    };
  }

  private async ddlDetails(ddl: DdlJob, tracked = true): Promise<DownloadDetails> {
    const status = await this.ddlStatus(ddl, tracked);
    const staged = status.status === "completed";
    const dir = this.stagingDir(ddl.id);
    const entries = staged ? await fs.readdir(dir, { withFileTypes: true }).catch(() => []) : [];
    const files = [];
    for (const entry of entries) {
      if (!entry.isFile() || entry.name.startsWith(".questarr-")) continue;
      const stat = await fs.stat(path.join(dir, entry.name)).catch(() => null);
      files.push({
        name: entry.name,
        size: stat?.size ?? 0,
        progress: 100,
        priority: "normal" as const,
        wanted: true,
      });
    }
    return {
      ...status,
      addedDate: ddl.createdAt?.toISOString(),
      downloadDir: staged ? dir : undefined,
      files,
      filesSupport: "supported",
      trackers: [],
    };
  }

  // -- DownloaderClient ---------------------------------------------------

  async testConnection(): Promise<DownloaderActionResult> {
    try {
      this.stagingRoot();
      const user = await this.json<{ username?: string; type?: string; premium?: number }>("/user");
      if (user.type !== "premium") {
        return {
          success: false,
          message: `Connected as ${user.username ?? "unknown"}, but the account is not premium`,
        };
      }
      return { success: true, message: `Connected to Real-Debrid as ${user.username ?? "user"}` };
    } catch (error) {
      return { success: false, message: getErrorMessage(error) };
    }
  }

  async logVersionInfo(): Promise<void> {
    const result = await this.testConnection();
    downloadersLogger.info(
      { downloaderId: this.downloader.id, success: result.success },
      `Real-Debrid: ${result.message}`
    );
  }

  async addDownload(request: DownloadRequest): Promise<DownloadResult> {
    try {
      this.stagingRoot();
      let id: string;
      let magnet: string | undefined = request.url.startsWith("magnet:") ? request.url : undefined;
      let torrentBytes: ArrayBuffer | undefined;

      if (!magnet) {
        const fetched = await fetchWithMagnetDetection(request.url);
        if (fetched.magnetLink) {
          magnet = fetched.magnetLink;
        } else if (fetched.response?.ok) {
          torrentBytes = await fetched.response.arrayBuffer();
        } else {
          return {
            success: false,
            message: `Could not fetch the torrent file (HTTP ${fetched.response?.status ?? "?"})`,
          };
        }
      }

      if (magnet) {
        const added = await this.json<{ id: string }>("/torrents/addMagnet", this.form({ magnet }));
        id = added.id;
      } else {
        const response = await this.api("/torrents/addTorrent", {
          method: "PUT",
          headers: { "Content-Type": "application/x-bittorrent" },
          body: torrentBytes as ArrayBuffer,
        });
        id = ((await response.json()) as { id: string }).id;
      }

      // A magnet is usually not ready to be selected yet; the status poll retries.
      await this.selectAllFiles(id).catch(() => undefined);
      return { success: true, message: "Added to Real-Debrid", id };
    } catch (error) {
      return { success: false, message: getErrorMessage(error) };
    }
  }

  async getDownloadStatus(
    id: string,
    options?: { throwOnError?: boolean }
  ): Promise<DownloadStatus | null> {
    try {
      if (isDdlJobId(id)) {
        const { storage } = await import("../storage.js");
        const ddl = await storage.getDdlJob(id);
        return ddl && ddl.downloaderId === this.downloader.id
          ? await this.ddlStatus(ddl, await this.isTracked(id))
          : null;
      }
      const response = await this.api(
        `/torrents/info/${encodeURIComponent(id)}`,
        {},
        { allowStatus: [404] }
      );
      if (response.status === 404) return null;
      const torrent = (await response.json()) as RealDebridTorrent;
      return await this.toStatus(torrent, await this.isTracked(torrent.id));
    } catch (error) {
      if (options?.throwOnError) throw error;
      downloadersLogger.warn({ error, id }, "Real-Debrid status lookup failed");
      return null;
    }
  }

  async getDownloadDetails(id: string): Promise<DownloadDetails | null> {
    if (isDdlJobId(id)) {
      const { storage } = await import("../storage.js");
      const ddl = await storage.getDdlJob(id);
      return ddl && ddl.downloaderId === this.downloader.id
        ? this.ddlDetails(ddl, await this.isTracked(id))
        : null;
    }
    const response = await this.api(
      `/torrents/info/${encodeURIComponent(id)}`,
      {},
      { allowStatus: [404] }
    );
    if (response.status === 404) return null;
    const torrent = (await response.json()) as RealDebridTorrent;
    const status = await this.toStatus(torrent, await this.isTracked(torrent.id));
    const staged = status.status === "completed";
    const resolvedPaths = resolveStagedPaths(selectedFiles(torrent).map((file) => file.path));
    return {
      ...status,
      hash: torrent.hash,
      addedDate: torrent.added,
      completedDate: torrent.ended,
      // Only set once the files are really on disk, so nothing is imported half-copied.
      downloadDir: staged ? this.stagingDir(torrent.id) : undefined,
      files: selectedFiles(torrent).map((file, index) => ({
        name: (resolvedPaths[index] ?? []).join("/"),
        size: file.bytes,
        progress: staged ? 100 : 0,
        priority: "normal" as const,
        wanted: true,
      })),
      filesSupport: "supported",
      trackers: [],
    };
  }

  async getAllDownloads(options?: { throwOnError?: boolean }): Promise<DownloadStatus[]> {
    try {
      const torrents = await this.listTorrents();
      const tracked = await this.trackedTorrentIds();
      const statuses = await Promise.all(
        torrents.map((torrent) => this.hydrate(torrent, tracked.has(torrent.id)))
      );
      const { storage } = await import("../storage.js");
      const ddlJobs = await storage.getDdlJobsByDownloader(this.downloader.id);
      return [
        ...statuses,
        ...(await Promise.all(ddlJobs.map((ddl) => this.ddlStatus(ddl, tracked.has(ddl.id))))),
      ];
    } catch (error) {
      if (options?.throwOnError) throw error;
      downloadersLogger.warn({ error }, "Real-Debrid download list failed");
      return [];
    }
  }

  /** The list endpoint omits `files` and `links`; staging needs them, so fetch full info. */
  private async hydrate(torrent: RealDebridTorrent, tracked: boolean): Promise<DownloadStatus> {
    // Untracked or already-staged torrents never use files/links: skip the per-torrent call so a
    // large account cannot trigger a burst of requests (and 429s) on every poll.
    if (torrent.status !== "downloaded" || !tracked || (await this.isStaged(torrent.id))) {
      return this.toStatus(torrent, tracked);
    }
    const full = await this.json<RealDebridTorrent>(
      `/torrents/info/${encodeURIComponent(torrent.id)}`
    );
    return this.toStatus(full, tracked);
  }

  private async isTracked(id: string): Promise<boolean> {
    return (await this.trackedTorrentIds()).has(id);
  }

  /** Every torrent in the account, page by page (the API caps a page at 100). */
  private async listTorrents(): Promise<RealDebridTorrent[]> {
    const pageSize = 100;
    const all: RealDebridTorrent[] = [];
    for (let page = 0; page < 50; page++) {
      const response = await this.api(`/torrents?limit=${pageSize}&offset=${page * pageSize}`);
      // 204 means an empty page.
      const batch = response.status === 204 ? [] : ((await response.json()) as RealDebridTorrent[]);
      all.push(...batch);
      if (batch.length < pageSize) break;
    }
    return all;
  }

  /** Torrent ids Questarr itself is tracking on this downloader. */
  private async trackedTorrentIds(): Promise<Set<string>> {
    const { storage } = await import("../storage.js");
    const rows = await storage.getDownloadingGameDownloads();
    return new Set(
      rows.filter((row) => row.downloaderId === this.downloader.id).map((row) => row.downloadHash)
    );
  }

  async pauseDownload(_id: string): Promise<DownloaderActionResult> {
    return { success: false, message: "Real-Debrid does not support pausing downloads" };
  }

  async resumeDownload(_id: string): Promise<DownloaderActionResult> {
    return { success: false, message: "Real-Debrid does not support resuming downloads" };
  }

  async removeDownload(id: string, deleteFiles = false): Promise<DownloaderActionResult> {
    const key = jobKey(this.downloader.id, id);
    // Reserve the key before the first await, even when nothing is running, so an overlapping
    // status poll can't start a copy while the torrent and its folder are being removed.
    const job: StagingJob = stagingJobs.get(key) ?? {
      state: "running",
      bytesDone: 0,
      bytesTotal: 0,
      startedAt: Date.now(),
      attempts: 0,
      cancelled: true,
      abort: new AbortController(),
      done: Promise.resolve(),
    };
    stagingJobs.set(key, job);
    try {
      // Stop an active copy first, and keep the job registered until cleanup is done.
      job.cancelled = true;
      job.abort.abort();
      await job.done;
      if (isDdlJobId(id)) {
        const { storage } = await import("../storage.js");
        await storage.deleteDdlJob(id);
      } else {
        await this.api(
          `/torrents/delete/${encodeURIComponent(id)}`,
          { method: "DELETE" },
          { allowStatus: [404] }
        );
      }
      if (deleteFiles) {
        await fs.rm(this.stagingDir(id), { recursive: true, force: true });
      }
      return { success: true, message: "Download removed" };
    } catch (error) {
      return { success: false, message: `Failed to remove download: ${getErrorMessage(error)}` };
    } finally {
      stagingJobs.delete(key);
    }
  }

  async getFreeSpace(): Promise<number> {
    try {
      const stats = await fs.statfs(this.stagingRoot());
      return Number(stats.bavail) * Number(stats.bsize);
    } catch {
      return 0;
    }
  }

  findTorrentByTag = findTorrentByTagNull;
}
