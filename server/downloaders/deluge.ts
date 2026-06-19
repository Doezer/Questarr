import type {
  Downloader,
  DownloadStatus,
  DownloadFile,
  DownloadTracker,
  DownloadDetails,
} from "../../shared/schema.js";
import { downloadersLogger } from "../logger.js";
import { isSafeUrl } from "../ssrf.js";
import type { DownloadRequest, DownloaderClient } from "./types.js";
import { fetchWithMagnetDetection, extractHashFromUrl } from "./utils.js";
import { z } from "zod";

interface DelugeTorrentStatus {
  name?: string;
  state?: string;
  progress?: number;
  download_payload_rate?: number;
  upload_payload_rate?: number;
  eta?: number;
  total_size?: number;
  all_time_download?: number;
  all_time_upload?: number;
  ratio?: number;
  num_peers?: number;
  num_seeds?: number;
  save_path?: string;
  time_added?: number;
  completed_time?: number;
  files?: Array<{
    path: string;
    size: number;
    progress: number;
    priority: number;
  }>;
  file_priorities?: number[];
  file_progress?: number[];
  trackers?: Array<{
    url: string;
    tier?: number;
    send_stats?: boolean;
    fails?: number;
    verified?: boolean;
    downloading?: boolean;
    announcing?: boolean;
    start_sent?: boolean;
    complete_sent?: boolean;
    last_error?: { category?: string; value?: string };
  }>;
  tracker_status?: string;
  message?: string;
  label?: string;
  [key: string]: unknown;
}

interface DelugeJSONRPCResponse {
  result?: unknown;
  error?: { message?: string; code?: number } | null;
  id?: number;
}

/**
 * Deluge client implementation using the Web UI JSON-RPC API.
 *
 * @remarks
 * - Communicates via JSON-RPC v1 to the /json endpoint
 * - Authenticates with auth.login (password-only) using cookie-based sessions
 * - Auto-connects to daemon hosts if not already connected
 * - Supports magnet links, torrent file upload, and URL-based adds
 * - Status mapping: Deluge state strings (Downloading, Seeding, Paused, etc.)
 */
export class DelugeClient implements DownloaderClient {
  private downloader: Downloader;
  private cookie: string | null = null;
  private requestId = 0;

  // Maximum ETA value to consider valid (100 days in seconds)
  private static readonly MAX_VALID_ETA_SECONDS = 8640000;

  constructor(downloader: Downloader) {
    this.downloader = downloader;
  }

  private getBaseUrl(): string {
    let baseUrl = this.downloader.url;
    if (!baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) {
      const protocol = this.downloader.useSsl ? "https://" : "http://";
      baseUrl = protocol + baseUrl;
    }

    try {
      const urlObj = new URL(baseUrl);
      if (this.downloader.port) {
        urlObj.port = this.downloader.port.toString();
      }

      if (this.downloader.urlPath) {
        let path = this.downloader.urlPath;
        if (!path.startsWith("/")) path = `/${path}`;
        if (path.endsWith("/")) path = path.slice(0, -1);
        urlObj.pathname = `${urlObj.pathname.replace(/\/$/, "")}${path}`;
      }

      return urlObj.toString().replace(/\/$/, "");
    } catch {
      return baseUrl.replace(/\/$/, "");
    }
  }

  private getRpcUrl(): string {
    const base = this.getBaseUrl();
    // Deluge WebUI JSON-RPC is at /json
    if (base.endsWith("/json")) return base;
    return `${base}/json`;
  }

  private async authenticate(): Promise<void> {
    if (this.cookie) return;

    const password = this.downloader.password || "";
    const response = await this.makeRequest("auth.login", [password]);

    if (response.result !== true) {
      throw new Error(
        `Deluge authentication failed: ${response.result === false ? "Invalid password" : "Unexpected response"}`
      );
    }
  }

  private async ensureConnected(): Promise<void> {
    const connectedResponse = await this.makeRequest("web.connected", []);
    if (connectedResponse.result === true) return;

    // Not connected — try to connect to the first available host
    downloadersLogger.info(
      { downloaderId: this.downloader.id },
      "Deluge web UI not connected to daemon, auto-connecting"
    );

    const hostsResponse = await this.makeRequest("web.get_hosts", []);
    const hosts = hostsResponse.result as
      | Array<[string, string, number, string, string]>
      | undefined;

    if (!hosts || hosts.length === 0) {
      throw new Error("No Deluge daemon hosts configured in Web UI");
    }

    const [hostId] = hosts[0];
    await this.makeRequest("web.connect", [hostId]);

    // Verify connection
    const verifyResponse = await this.makeRequest("web.connected", []);
    if (verifyResponse.result !== true) {
      throw new Error("Failed to connect Deluge Web UI to daemon");
    }

    downloadersLogger.info(
      { downloaderId: this.downloader.id, hostId },
      "Deluge auto-connected to daemon"
    );
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      await this.authenticate();
      await this.ensureConnected();

      // Get daemon version via core.get_libtorrent_version or just check a core call works
      const versionResponse = await this.makeRequest("daemon.get_version", []);
      const version =
        typeof versionResponse.result === "string" ? versionResponse.result : undefined;

      return {
        success: true,
        message: version
          ? `Connected successfully to Deluge ${version}`
          : "Connected successfully to Deluge",
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return { success: false, message: `Failed to connect to Deluge: ${errorMessage}` };
    }
  }

  async logVersionInfo(): Promise<void> {
    try {
      await this.authenticate();
      await this.ensureConnected();
      const versionResponse = await this.makeRequest("daemon.get_version", []);
      const version =
        typeof versionResponse.result === "string" ? versionResponse.result : undefined;

      downloadersLogger.info(
        {
          downloaderId: this.downloader.id,
          downloaderType: this.downloader.type,
          version,
        },
        "Downloader version probe completed"
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      downloadersLogger.warn(
        {
          downloaderId: this.downloader.id,
          downloaderType: this.downloader.type,
          error: errorMessage,
        },
        "Downloader version probe failed"
      );
    }
  }

  async addDownload(
    request: DownloadRequest
  ): Promise<{ success: boolean; id?: string; message: string }> {
    try {
      if (!request.url) {
        return { success: false, message: "Download URL is required" };
      }

      await this.authenticate();
      await this.ensureConnected();

      const isMagnet = request.url.startsWith("magnet:");
      const downloadPath = request.downloadPath || this.downloader.downloadPath;
      const category = request.category || this.downloader.category;
      const succeed = async (id: string, message: string) => {
        if (category) {
          try {
            await this.makeRequest("label.add", [category]);
          } catch {
            // Label may already exist
          }
          try {
            await this.makeRequest("label.set_torrent", [id, category]);
          } catch (err) {
            const msg = err instanceof Error ? err.message : "Unknown error";
            downloadersLogger.warn({ id, category, error: msg }, "Failed to apply Deluge label");
          }
        }
        return { success: true as const, id, message };
      };
      const addPaused = this.downloader.addStopped ?? false;

      const options: Record<string, unknown> = {};
      if (downloadPath) {
        options.download_location = downloadPath;
      }
      if (addPaused) {
        options.add_paused = addPaused;
      }

      if (isMagnet) {
        // Validate magnet hash for later verification
        const hashFromUrl = extractHashFromUrl(request.url);

        const response = await this.makeRequest("core.add_torrent_magnet", [request.url, options]);

        const result = response.result;
        if (typeof result === "string" && result.length > 0) {
          // result is the torrent ID (info hash)
          return succeed(result.toLowerCase(), "Download added successfully");
        }

        if (result === null && hashFromUrl) {
          // Could be a duplicate — verify by checking if torrent exists
          const verifyResponse = await this.makeRequest("core.get_torrent_status", [
            hashFromUrl,
            ["name"],
          ]);
          if (verifyResponse.result && typeof verifyResponse.result === "object") {
            return succeed(hashFromUrl, "Download already exists (Deluge)");
          }
        }

        return {
          success: false,
          message: "Failed to add magnet link to Deluge",
        };
      }

      // Non-magnet URL: download torrent file locally, then upload
      if (!(await isSafeUrl(request.url))) {
        return { success: false, message: `Unsafe URL blocked: ${request.url}` };
      }

      downloadersLogger.info({ url: request.url }, "Downloading torrent file for Deluge");

      let torrentFileBuffer: Buffer;
      let torrentFileName = "torrent.torrent";

      try {
        const { response: torrentResponse, magnetLink } = await fetchWithMagnetDetection(
          request.url
        );

        if (magnetLink) {
          // Redirected to magnet — recurse
          return this.addDownload({ ...request, url: magnetLink });
        }

        if (!torrentResponse || !torrentResponse.ok) {
          const status = torrentResponse?.status || "unknown";
          const statusText = torrentResponse?.statusText || "No response";
          throw new Error(`Failed to download torrent: ${status} ${statusText}`);
        }

        const contentDisposition = torrentResponse.headers.get("content-disposition");
        if (contentDisposition) {
          const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
          if (filenameMatch && filenameMatch[1]) {
            torrentFileName = filenameMatch[1].replace(/['"]/g, "").trim();
          }
        }

        const arrayBuffer = await torrentResponse.arrayBuffer();
        torrentFileBuffer = Buffer.from(arrayBuffer);

        downloadersLogger.info(
          { size: torrentFileBuffer.length, filename: torrentFileName },
          "Successfully downloaded torrent file for Deluge"
        );
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        downloadersLogger.error(
          { error: errorMessage, url: request.url },
          "Failed to download torrent file"
        );

        // Fallback: try core.add_torrent_url (Deluge downloads the URL itself)
        downloadersLogger.info({ url: request.url }, "Falling back to Deluge URL download");
        const fallbackResponse = await this.makeRequest("core.add_torrent_url", [
          request.url,
          options,
        ]);

        const fallbackResult = fallbackResponse.result;
        if (typeof fallbackResult === "string" && fallbackResult.length > 0) {
          return succeed(fallbackResult.toLowerCase(), "Download added successfully (via URL)");
        }
        if (fallbackResult === null) {
          // Could be duplicate or failure —Deluge returns null for existing torrents sometimes
          const hashFromUrl = extractHashFromUrl(request.url);
          if (hashFromUrl) {
            const verifyResponse = await this.makeRequest("core.get_torrent_status", [
              hashFromUrl,
              ["name"],
            ]);
            if (verifyResponse.result && typeof verifyResponse.result === "object") {
              return succeed(hashFromUrl, "Download already exists (Deluge)");
            }
          }
        }

        return {
          success: false,
          message: `Failed to add download: ${errorMessage}`,
        };
      }

      // Upload torrent file via core.add_torrent_file
      const fileDump = torrentFileBuffer.toString("base64");
      const response = await this.makeRequest("core.add_torrent_file", [
        torrentFileName,
        fileDump,
        options,
      ]);

      const result = response.result;
      if (typeof result === "string" && result.length > 0) {
        return succeed(result.toLowerCase(), "Download added successfully");
      }

      if (result === null) {
        // Could be duplicate or failure
        const hashFromUrl = extractHashFromUrl(request.url);
        if (hashFromUrl) {
          const verifyResponse = await this.makeRequest("core.get_torrent_status", [
            hashFromUrl,
            ["name"],
          ]);
          if (verifyResponse.result && typeof verifyResponse.result === "object") {
            return succeed(hashFromUrl, "Download already exists (Deluge)");
          }
        }

        // Try to find by the most recently added torrent
        const recent = await this.findRecentlyAddedDownload();
        if (recent) {
          return succeed(recent.hash, "Download added successfully");
        }
      }

      return {
        success: false,
        message: "Failed to add download to Deluge",
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      downloadersLogger.error({ error: errorMessage }, "Error adding download to Deluge");
      return { success: false, message: `Failed to add download: ${errorMessage}` };
    }
  }

  private async findRecentlyAddedDownload(): Promise<{ hash: string; name?: string } | null> {
    try {
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const response = await this.makeRequest("core.get_torrents_status", [
        {},
        ["name", "time_added"],
      ]);

      const torrents = response.result as
        | Record<string, { name?: string; time_added?: number }>
        | undefined;
      if (!torrents || Object.keys(torrents).length === 0) return null;

      const entries = Object.entries(torrents);
      // Sort by time_added descending
      entries.sort((a, b) => (b[1].time_added ?? 0) - (a[1].time_added ?? 0));

      const [mostRecentHash, mostRecentStatus] = entries[0];
      const now = Date.now() / 1000;
      if (mostRecentStatus.time_added && now - mostRecentStatus.time_added < 10) {
        return { hash: mostRecentHash.toLowerCase(), name: mostRecentStatus.name };
      }

      return null;
    } catch (error) {
      downloadersLogger.warn({ error }, "Failed to find recently added Deluge download");
      return null;
    }
  }

  async getDownloadStatus(id: string): Promise<DownloadStatus | null> {
    try {
      await this.authenticate();
      await this.ensureConnected();

      const response = await this.makeRequest("core.get_torrent_status", [
        id,
        [
          "name",
          "state",
          "progress",
          "download_payload_rate",
          "upload_payload_rate",
          "eta",
          "total_size",
          "all_time_download",
          "ratio",
          "num_peers",
          "num_seeds",
          "message",
          "label",
        ],
      ]);

      if (response.result && typeof response.result === "object") {
        return this.mapDelugeStatus(id, response.result as DelugeTorrentStatus);
      }

      return null;
    } catch (error) {
      downloadersLogger.error({ error, id }, "Error getting download status from Deluge");
      return null;
    }
  }

  async getDownloadDetails(id: string): Promise<DownloadDetails | null> {
    try {
      await this.authenticate();
      await this.ensureConnected();

      const response = await this.makeRequest("core.get_torrent_status", [
        id,
        [
          "name",
          "state",
          "progress",
          "download_payload_rate",
          "upload_payload_rate",
          "eta",
          "total_size",
          "all_time_download",
          "all_time_upload",
          "ratio",
          "num_peers",
          "num_seeds",
          "save_path",
          "time_added",
          "completed_time",
          "files",
          "file_priorities",
          "file_progress",
          "trackers",
          "tracker_status",
          "message",
          "label",
        ],
      ]);

      if (!response.result || typeof response.result !== "object") {
        return null;
      }

      const status = response.result as DelugeTorrentStatus;
      const baseStatus = this.mapDelugeStatus(id, status);

      // Map files
      const files: DownloadFile[] = [];
      if (status.files) {
        const filePriorities = status.file_priorities || [];
        const fileProgresses = status.file_progress || [];
        for (let i = 0; i < status.files.length; i++) {
          const file = status.files[i];
          const priority = filePriorities[i] ?? 1;
          const progress = fileProgresses[i] ?? 0;

          let filePriority: DownloadFile["priority"] = "normal";
          if (priority === 0) filePriority = "off";
          else if (priority === 2) filePriority = "high";

          files.push({
            name: file.path,
            size: file.size,
            progress: Math.round(progress * 100),
            priority: filePriority,
            wanted: priority !== 0,
          });
        }
      }

      // Map trackers
      const trackers: DownloadTracker[] = [];
      if (status.trackers) {
        for (const tracker of status.trackers) {
          let trackerStatus: DownloadTracker["status"] = "inactive";
          if (tracker.send_stats === false) {
            trackerStatus = "inactive";
          } else if (tracker.last_error && tracker.last_error.value) {
            trackerStatus = "error";
          } else if (tracker.fails && tracker.fails > 0) {
            trackerStatus = "error";
          } else if (tracker.verified) {
            trackerStatus = "working";
          } else {
            trackerStatus = "updating";
          }

          trackers.push({
            url: tracker.url,
            tier: tracker.tier ?? 0,
            status: trackerStatus,
          });
        }
      }

      return {
        ...baseStatus,
        hash: id,
        downloadDir: status.save_path,
        addedDate:
          status.time_added && status.time_added > 0
            ? new Date(status.time_added * 1000).toISOString()
            : undefined,
        completedDate:
          status.completed_time && status.completed_time > 0
            ? new Date(status.completed_time * 1000).toISOString()
            : undefined,
        files,
        trackers,
        totalPeers: status.num_peers,
        connectedPeers: status.num_peers,
      };
    } catch (error) {
      downloadersLogger.error({ error, id }, "Error getting download details from Deluge");
      return null;
    }
  }

  async getAllDownloads(): Promise<DownloadStatus[]> {
    try {
      await this.authenticate();
      await this.ensureConnected();

      const response = await this.makeRequest("core.get_torrents_status", [
        {},
        [
          "name",
          "state",
          "progress",
          "download_payload_rate",
          "upload_payload_rate",
          "eta",
          "total_size",
          "all_time_download",
          "ratio",
          "num_peers",
          "num_seeds",
          "message",
          "label",
        ],
      ]);

      const torrents = response.result as Record<string, DelugeTorrentStatus> | undefined;
      if (!torrents) return [];

      return Object.entries(torrents).map(([hash, status]) => this.mapDelugeStatus(hash, status));
    } catch (error) {
      downloadersLogger.error({ error }, "Error getting all downloads from Deluge");
      return [];
    }
  }

  async pauseDownload(id: string): Promise<{ success: boolean; message: string }> {
    try {
      await this.authenticate();
      await this.ensureConnected();
      await this.makeRequest("core.pause_torrent", [[id]]);
      return { success: true, message: "Download paused successfully" };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return { success: false, message: `Failed to pause download: ${errorMessage}` };
    }
  }

  async resumeDownload(id: string): Promise<{ success: boolean; message: string }> {
    try {
      await this.authenticate();
      await this.ensureConnected();
      await this.makeRequest("core.resume_torrent", [[id]]);
      return { success: true, message: "Download resumed successfully" };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return { success: false, message: `Failed to resume download: ${errorMessage}` };
    }
  }

  async removeDownload(
    id: string,
    deleteFiles = false
  ): Promise<{ success: boolean; message: string }> {
    try {
      await this.authenticate();
      await this.ensureConnected();
      await this.makeRequest("core.remove_torrent", [id, deleteFiles]);
      return { success: true, message: "Download removed successfully" };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return { success: false, message: `Failed to remove download: ${errorMessage}` };
    }
  }

  async getFreeSpace(): Promise<number> {
    try {
      await this.authenticate();
      await this.ensureConnected();

      const path = this.downloader.downloadPath || "";
      const response = await this.makeRequest("core.get_free_space", [path]);

      if (typeof response.result === "number" && response.result >= 0) {
        return response.result;
      }

      downloadersLogger.debug(
        { result: response.result, path },
        "Deluge free space returned unexpected value"
      );
      return 0;
    } catch (error) {
      downloadersLogger.error({ error }, "Error getting free space from Deluge");
      return 0;
    }
  }

  private mapDelugeStatus(hash: string, status: DelugeTorrentStatus): DownloadStatus {
    // Deluge states: Downloading, Seeding, Paused, Checking, Queued, Error, Allocating, Moving
    let downloadStatus: DownloadStatus["status"] = "paused";

    switch (status.state) {
      case "Downloading":
      case "Checking":
      case "Allocating":
        downloadStatus = "downloading";
        break;
      case "Seeding":
        downloadStatus = "seeding";
        break;
      case "Paused":
        downloadStatus = "paused";
        break;
      case "Queued":
        downloadStatus = "paused";
        break;
      case "Error":
        downloadStatus = "error";
        break;
      case "Moving":
        downloadStatus = "downloading";
        break;
      default:
        downloadStatus = "paused";
        if (status.state) {
          downloadersLogger.warn({ state: status.state, hash }, "Unknown Deluge state encountered");
        }
        break;
    }

    const progress = Math.round(status.progress ?? 0);

    // Force completed/seeding based on progress
    if (progress >= 100) {
      if (downloadStatus === "downloading") {
        downloadStatus = "seeding";
      } else if (downloadStatus === "paused") {
        downloadStatus = "completed";
      }
    }

    const eta = status.eta ?? undefined;

    // Only surface the tracker message as an error when Deluge itself reports an Error state.
    // The message field is also used for normal tracker responses (e.g. "OK") and must not
    // override the status — doing so caused every seeding torrent to appear as "Error: OK".
    const errorMessage = downloadStatus === "error" ? (status.message || undefined) : undefined;

    return {
      id: hash.toLowerCase(),
      name: status.name || "Unknown",
      status: downloadStatus,
      progress,
      downloadSpeed: status.download_payload_rate ?? 0,
      uploadSpeed: status.upload_payload_rate ?? 0,
      eta:
        typeof eta === "number" && eta > 0 && eta < DelugeClient.MAX_VALID_ETA_SECONDS
          ? eta
          : undefined,
      size: status.total_size ?? 0,
      downloaded: status.all_time_download ?? 0,
      seeders: status.num_seeds ?? 0,
      leechers: (status.num_peers ?? 0) - (status.num_seeds ?? 0),
      ratio: status.ratio ?? 0,
      error: errorMessage,
      category: status.label || undefined,
    };
  }

  private async makeRequest(method: string, params: unknown[]): Promise<DelugeJSONRPCResponse> {
    const url = this.getRpcUrl();
    this.requestId++;

    const body: { method: string; params: unknown[]; id: number } = {
      method,
      params,
      id: this.requestId,
    };

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": "Questarr/1.0",
    };

    if (this.cookie) {
      headers["Cookie"] = this.cookie;
    }

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });

    // Extract cookies from response for future requests
    const setCookieHeader = response.headers.get("set-cookie");
    if (setCookieHeader) {
      const cookieMatch =
        setCookieHeader.match(/(_session_id=[^;]+)/) ?? setCookieHeader.match(/([^;]+)/);
      if (cookieMatch) {
        this.cookie = cookieMatch[1];
      }
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => "No error details available");
      if (response.status === 401) {
        downloadersLogger.error(
          {
            status: response.status,
            url,
            method,
            errorText,
          },
          "Deluge authentication failed - check password"
        );
        throw new Error(`Authentication failed: Invalid password for Deluge - ${errorText}`);
      }
      throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText}`);
    }

    const delugeResponseSchema = z.object({
      result: z.unknown().optional(),
      error: z
        .object({ message: z.string().optional(), code: z.number().optional() })
        .nullable()
        .optional(),
      id: z.number().optional(),
    });

    let data: DelugeJSONRPCResponse;
    try {
      const raw = await response.json();
      data = delugeResponseSchema.parse(raw);
    } catch {
      throw new Error("Invalid JSON response from Deluge");
    }

    if (data.error) {
      const errorMessage =
        typeof data.error === "object" && data.error.message
          ? data.error.message
          : "Deluge RPC error";
      throw new Error(`Deluge RPC error: ${errorMessage}`);
    }

    return data;
  }
}
