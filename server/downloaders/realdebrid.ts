import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Downloader, DownloadStatus, DownloadDetails } from "../../shared/schema.js";
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

/** Written into a staged torrent's folder once every file has been fetched. */
export const STAGING_MARKER = ".questarr-staged";
const REFRESH_MARGIN_MS = 60_000;
const STAGING_TIMEOUT_MS = 6 * 60 * 60 * 1000;

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

interface StagingJob {
  state: "running" | "failed";
  bytesDone: number;
  bytesTotal: number;
  startedAt: number;
  error?: string;
}

// Staging outlives any one client instance (the manager builds a fresh client per call),
// so progress is tracked per process, keyed by downloader and torrent.
const stagingJobs = new Map<string, StagingJob>();

const jobKey = (downloaderId: string, torrentId: string) => `${downloaderId}:${torrentId}`;

/** Makes one path segment safe to create on disk. */
function sanitizeSegment(segment: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = segment.replace(/[<>:"|?*\u0000-\u001f]/g, "_").trim();
  return cleaned === "." || cleaned === ".." ? "_" : cleaned;
}

/** Splits a Real-Debrid path ("/Folder/file.bin") into safe relative segments. */
function toSafeSegments(rawPath: string): string[] {
  return rawPath
    .split(/[\\/]+/)
    .filter((part) => part.length > 0)
    .map(sanitizeSegment);
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

  private async persistCredentials(credentials: RealDebridCredentials): Promise<void> {
    this.credentials = credentials;
    try {
      // Imported lazily: storage pulls in the whole database layer.
      const { storage } = await import("../storage.js");
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
    await this.persistCredentials(await refreshRealDebridToken(this.credentials));
  }

  private async api(
    pathname: string,
    init: RequestInit = {},
    options: { allowStatus?: number[] } = {}
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

    let response = await send();
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

  private async json<T>(pathname: string, init?: RequestInit): Promise<T> {
    return (await (await this.api(pathname, init)).json()) as T;
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
    return path.join(this.stagingRoot(), sanitizeSegment(torrentId));
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
    const key = jobKey(this.downloader.id, torrent.id);
    const existing = stagingJobs.get(key);
    if (existing) return existing;

    const job: StagingJob = {
      state: "running",
      bytesDone: 0,
      bytesTotal: torrent.bytes,
      startedAt: Date.now(),
    };
    stagingJobs.set(key, job);
    this.stageFiles(torrent, job).catch((error) => {
      job.state = "failed";
      job.error = getErrorMessage(error);
      downloadersLogger.error(
        { error, downloaderId: this.downloader.id, torrentId: torrent.id },
        "Real-Debrid staging failed"
      );
    });
    return job;
  }

  private async stageFiles(torrent: RealDebridTorrent, job: StagingJob): Promise<void> {
    const dir = this.stagingDir(torrent.id);
    await fs.mkdir(dir, { recursive: true });

    const links = torrent.links ?? [];
    if (links.length === 0) throw new Error("Real-Debrid returned no download links");
    const files = selectedFiles(torrent);
    // Links come back in the order of the selected files, so their paths can be restored.
    const paths = files.length === links.length ? files.map((file) => file.path) : null;

    for (const [index, link] of links.entries()) {
      const unrestricted = await this.json<UnrestrictedLink>(
        "/unrestrict/link",
        this.form({ link })
      );
      const segments = toSafeSegments(paths?.[index] ?? unrestricted.filename);
      if (segments.length === 0) throw new Error("Real-Debrid returned an empty file name");
      const target = path.join(dir, ...segments);
      if (!target.startsWith(dir + path.sep)) {
        throw new Error(`Refusing to write outside the staging folder: ${target}`);
      }
      await this.downloadFile(unrestricted, target, job);
    }

    await fs.writeFile(
      path.join(dir, STAGING_MARKER),
      JSON.stringify({ torrentId: torrent.id, stagedAt: new Date().toISOString() })
    );
    stagingJobs.delete(jobKey(this.downloader.id, torrent.id));
  }

  private async downloadFile(
    file: UnrestrictedLink,
    target: string,
    job: StagingJob
  ): Promise<void> {
    await fs.mkdir(path.dirname(target), { recursive: true });
    const existing = await fs.stat(target).catch(() => null);
    if (existing && existing.size === file.filesize) {
      job.bytesDone += existing.size;
      return;
    }

    const response = await safeFetch(file.download, {
      headers: { "User-Agent": DOWNLOAD_CLIENT_USER_AGENT },
      requireHttps: true,
      timeoutMs: STAGING_TIMEOUT_MS,
    });
    if (!response.ok || !response.body) {
      throw new Error(`Real-Debrid file download failed (HTTP ${response.status})`);
    }

    const partial = `${target}.part`;
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        job.bytesDone += chunk.length;
        callback(null, chunk);
      },
    });
    try {
      await pipeline(
        Readable.fromWeb(response.body as import("node:stream/web").ReadableStream),
        counter,
        createWriteStream(partial)
      );
      await fs.rename(partial, target);
    } catch (error) {
      await fs.rm(partial, { force: true });
      throw error;
    }
  }

  // -- Status mapping -----------------------------------------------------

  private async toStatus(torrent: RealDebridTorrent): Promise<DownloadStatus> {
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
        await this.selectAllFiles(torrent.id);
        return { ...base, status: "downloading", progress: 0 };
      case "downloaded":
        return this.stagingStatus(torrent, base);
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
    base: Omit<DownloadStatus, "status" | "progress">
  ): Promise<DownloadStatus> {
    if (await this.isStaged(torrent.id)) {
      return { ...base, status: "completed", progress: 100, downloaded: torrent.bytes };
    }
    const job = this.startStaging(torrent);
    if (job.state === "failed") {
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
      const response = await this.api(
        `/torrents/info/${encodeURIComponent(id)}`,
        {},
        { allowStatus: [404] }
      );
      if (response.status === 404) return null;
      return await this.toStatus((await response.json()) as RealDebridTorrent);
    } catch (error) {
      if (options?.throwOnError) throw error;
      downloadersLogger.warn({ error, id }, "Real-Debrid status lookup failed");
      return null;
    }
  }

  async getDownloadDetails(id: string): Promise<DownloadDetails | null> {
    const response = await this.api(
      `/torrents/info/${encodeURIComponent(id)}`,
      {},
      { allowStatus: [404] }
    );
    if (response.status === 404) return null;
    const torrent = (await response.json()) as RealDebridTorrent;
    const status = await this.toStatus(torrent);
    const staged = status.status === "completed";
    return {
      ...status,
      hash: torrent.hash,
      addedDate: torrent.added,
      completedDate: torrent.ended,
      // Only set once the files are really on disk, so nothing is imported half-copied.
      downloadDir: staged ? this.stagingDir(torrent.id) : undefined,
      files: selectedFiles(torrent).map((file) => ({
        name: file.path.replace(/^[\\/]+/, ""),
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
      const torrents = await this.json<RealDebridTorrent[]>("/torrents?limit=100");
      return await Promise.all(torrents.map((torrent) => this.hydrate(torrent)));
    } catch (error) {
      if (options?.throwOnError) throw error;
      downloadersLogger.warn({ error }, "Real-Debrid download list failed");
      return [];
    }
  }

  /** The list endpoint omits `files` and `links`; staging needs them, so fetch full info. */
  private async hydrate(torrent: RealDebridTorrent): Promise<DownloadStatus> {
    if (torrent.status !== "downloaded") return this.toStatus(torrent);
    const full = await this.json<RealDebridTorrent>(
      `/torrents/info/${encodeURIComponent(torrent.id)}`
    );
    return this.toStatus(full);
  }

  async pauseDownload(_id: string): Promise<DownloaderActionResult> {
    return { success: false, message: "Real-Debrid does not support pausing downloads" };
  }

  async resumeDownload(_id: string): Promise<DownloaderActionResult> {
    return { success: false, message: "Real-Debrid does not support resuming downloads" };
  }

  async removeDownload(id: string, deleteFiles = false): Promise<DownloaderActionResult> {
    try {
      stagingJobs.delete(jobKey(this.downloader.id, id));
      await this.api(
        `/torrents/delete/${encodeURIComponent(id)}`,
        { method: "DELETE" },
        { allowStatus: [404] }
      );
      if (deleteFiles) {
        await fs.rm(this.stagingDir(id), { recursive: true, force: true });
      }
      return { success: true, message: "Download removed" };
    } catch (error) {
      return { success: false, message: `Failed to remove download: ${getErrorMessage(error)}` };
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
