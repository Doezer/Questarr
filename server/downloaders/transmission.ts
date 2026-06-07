import type {
  Downloader,
  DownloadStatus,
  DownloadFile,
  DownloadTracker,
  DownloadDetails,
} from "../../shared/schema.js";
import { downloadersLogger } from "../logger.js";
import parseTorrent from "parse-torrent";
import { isSafeUrl } from "../ssrf.js";
import type { DownloadRequest, DownloaderClient } from "./types.js";
import { fetchWithMagnetDetection } from "./utils.js";

interface TransmissionTorrent {
  id: number;
  name: string;
  status: number;
  percentDone: number;
  rateDownload: number;
  rateUpload: number;
  eta: number;
  totalSize: number;
  downloadedEver: number;
  uploadedEver: number;
  uploadRatio: number;
  error: number;
  errorString: string;
  peersConnected: number;
  downloadDir: string;
  isFinished: boolean;
  peersSendingToUs?: number;
  peersGettingFromUs?: number;
  hashString?: string;
  addedDate?: number;
  doneDate?: number;
  comment?: string;
  creator?: string;
  files?: Array<{
    name: string;
    length: number;
    bytesCompleted: number;
  }>;
  fileStats?: Array<{
    bytesCompleted: number;
    wanted: boolean;
    priority: number;
  }>;
  trackers?: Array<{
    announce: string;
    tier: number;
  }>;
  trackerStats?: Array<{
    announce: string;
    tier: number;
    lastAnnounceSucceeded: boolean;
    isBackup: boolean;
    lastAnnounceResult: string;
    announceState: number;
    seederCount: number;
    leecherCount: number;
    lastAnnounceTime: number;
    nextAnnounceTime?: number;
  }>;
  labels?: string[];
  [key: string]: unknown;
}

export class TransmissionClient implements DownloaderClient {
  private downloader: Downloader;
  private sessionId: string | null = null;

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

      // Add urlPath logic here
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

  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      const response = await this.makeRequest("session-get", {});
      const version = response.arguments?.version;
      downloadersLogger.info(
        { url: this.downloader.url },
        "Transmission connection test successful"
      );
      return {
        success: true,
        message:
          typeof version === "string"
            ? `Connected successfully to Transmission ${version}`
            : "Connected successfully to Transmission",
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      downloadersLogger.error(
        {
          error: errorMessage,
          url: this.downloader.url,
          username: this.downloader.username,
        },
        "Transmission connection test failed"
      );

      if (errorMessage.includes("Authentication failed")) {
        return { success: false, message: errorMessage };
      }
      return { success: false, message: `Failed to connect to Transmission: ${errorMessage}` };
    }
  }

  async logVersionInfo(): Promise<void> {
    const response = await this.makeRequest("session-get", {});
    const version = response.arguments?.version;
    const rpcVersion = response.arguments?.["rpc-version"];
    const rpcVersionMinimum = response.arguments?.["rpc-version-minimum"];

    if (typeof version !== "string" && typeof rpcVersion !== "number") {
      downloadersLogger.debug(
        { downloaderId: this.downloader.id, downloaderType: this.downloader.type },
        "Transmission session-get did not expose version info"
      );
      return;
    }

    downloadersLogger.info(
      {
        downloaderId: this.downloader.id,
        downloaderType: this.downloader.type,
        version,
        rpcVersion,
        rpcVersionMinimum,
      },
      "Downloader version probe completed"
    );
  }

  async addDownload(
    request: DownloadRequest
  ): Promise<{ success: boolean; id?: string; message: string }> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const args: any = {};

      // Check if it's a magnet link or a URL that needs downloading
      const isMagnet = request.url.startsWith("magnet:");

      if (isMagnet) {
        // Magnet URIs have no hostname — isSafeUrl would always fail on them.
        // The BitTorrent client handles tracker URL validation internally.
        args.filename = request.url;
      } else {
        // Check URL safety before attempting download or fallback
        if (!(await isSafeUrl(request.url))) {
          return { success: false, message: `Unsafe URL blocked: ${request.url}` };
        }

        // Download the torrent file locally; uses manual redirect-following to detect
        // magnet link redirects that standard fetch cannot handle (HTTP → magnet: protocol change).
        try {
          downloadersLogger.debug(
            { url: request.url },
            "Downloading file locally for Transmission"
          );

          let fetchResult = await fetchWithMagnetDetection(request.url);

          // Some indexers reject the request when a &file= param is present — retry without it
          if (
            !fetchResult.magnetLink &&
            !fetchResult.response?.ok &&
            request.url.includes("&file=")
          ) {
            const urlNoFile = request.url.split("&file=")[0];
            downloadersLogger.warn(
              { original: request.url, fixed: urlNoFile },
              "Retrying download without &file= parameter"
            );
            fetchResult = await fetchWithMagnetDetection(urlNoFile);
          }

          if (fetchResult.magnetLink) {
            // Indexer redirected to a magnet URI — pass it directly to Transmission
            downloadersLogger.info(
              { magnetLink: fetchResult.magnetLink },
              "Detected magnet redirect, passing to Transmission"
            );
            args.filename = fetchResult.magnetLink;
          } else if (fetchResult.response?.ok) {
            const arrayBuffer = await fetchResult.response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);

            try {
              const parsed = await parseTorrent(buffer);
              if (parsed && parsed.infoHash) {
                downloadersLogger.debug({ hash: parsed.infoHash }, "Parsed download hash locally");
              }
            } catch {
              // Ignore parse errors, Transmission might still accept it
            }

            // Transmission expects base64 encoded torrent file content in 'metainfo'
            args.metainfo = buffer.toString("base64");
          } else {
            // Fallback to passing URL directly if download fails
            downloadersLogger.warn("Failed to download file locally, passing URL to Transmission");
            args.filename = request.url;
          }
        } catch (error) {
          downloadersLogger.error(
            { err: error },
            "Error downloading file, passing URL to Transmission"
          );
          args.filename = request.url;
        }
      }

      // Handle download path with category subdirectory
      let downloadPath = request.downloadPath || this.downloader.downloadPath;
      const category = request.category || this.downloader.category;

      if (downloadPath && category) {
        // Transmission doesn't have native category support, but we can create subdirectories
        downloadPath = `${downloadPath}/${category}`;
      }

      if (downloadPath) {
        args["download-dir"] = downloadPath;
      }

      // Add label/category if supported (Transmission 2.8+)
      if (category) {
        args["labels"] = [category];
      }

      if (request.priority) {
        args["priority-high"] = request.priority > 3;
        args["priority-low"] = request.priority < 2;
      }

      const response = await this.makeRequest("torrent-add", args);

      if (response.arguments["torrent-added"]) {
        const torrent = response.arguments["torrent-added"];
        let id = torrent.hashString;

        // If hashString is missing (older Transmission versions), try to fetch it
        if (!id && torrent.id) {
          try {
            const details = await this.makeRequest("torrent-get", {
              ids: [torrent.id],
              fields: ["hashString"],
            });
            if (details.arguments.torrents && details.arguments.torrents.length > 0) {
              id = details.arguments.torrents[0].hashString;
            }
          } catch (error) {
            downloadersLogger.warn(
              { error, torrentId: torrent.id },
              "Failed to fetch hashString for new download"
            );
          }
        }

        return {
          success: true,
          id: id || torrent.id?.toString(),
          message: "Download added successfully",
        };
      } else if (response.arguments["torrent-duplicate"]) {
        const torrent = response.arguments["torrent-duplicate"];
        // Return success: true for duplicates to prevent fallback mechanism from trying other downloaders
        // as the user likely intends for this specific downloader to handle it (or it's already there)
        return {
          success: true,
          id: torrent.hashString || torrent.id?.toString(),
          message: "Download already exists (Transmission)",
        };
      } else {
        const transmissionError =
          response.result && typeof response.result === "string" && response.result !== "success"
            ? response.result
            : null;
        return {
          success: false,
          message: transmissionError
            ? `Failed to add download: ${transmissionError}`
            : "Failed to add download",
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return { success: false, message: `Failed to add download: ${errorMessage}` };
    }
  }

  async getDownloadStatus(id: string): Promise<DownloadStatus | null> {
    try {
      const response = await this.makeRequest("torrent-get", {
        ids: this.toTransmissionIds(id),
        fields: [
          "id",
          "name",
          "status",
          "percentDone",
          "rateDownload",
          "rateUpload",
          "eta",
          "totalSize",
          "downloadedEver",
          "peersSendingToUs",
          "peersGettingFromUs",
          "trackerStats",
          "uploadRatio",
          "errorString",
        ],
      });

      if (response.arguments.torrents && response.arguments.torrents.length > 0) {
        const torrent = response.arguments.torrents[0];
        return this.mapTransmissionStatus(torrent);
      }

      return null;
    } catch (error) {
      downloadersLogger.error({ error }, "error getting download status (transmission)");
      return null;
    }
  }

  async getDownloadDetails(id: string): Promise<DownloadDetails | null> {
    try {
      const response = await this.makeRequest("torrent-get", {
        ids: this.toTransmissionIds(id),
        fields: [
          "id",
          "name",
          "status",
          "percentDone",
          "rateDownload",
          "rateUpload",
          "eta",
          "totalSize",
          "downloadedEver",
          "peersSendingToUs",
          "peersGettingFromUs",
          "uploadRatio",
          "errorString",
          "hashString",
          "addedDate",
          "doneDate",
          "downloadDir",
          "comment",
          "creator",
          "files",
          "fileStats",
          "trackers",
          "trackerStats",
          "peersConnected",
        ],
      });

      if (response.arguments.torrents && response.arguments.torrents.length > 0) {
        const torrent = response.arguments.torrents[0];
        return this.mapTransmissionDetails(torrent);
      }

      return null;
    } catch (error) {
      downloadersLogger.error({ error, id }, "Error getting download details");
      return null;
    }
  }

  async getAllDownloads(): Promise<DownloadStatus[]> {
    const response = await this.makeRequest("torrent-get", {
      fields: [
        "id",
        "name",
        "status",
        "percentDone",
        "rateDownload",
        "rateUpload",
        "eta",
        "totalSize",
        "downloadedEver",
        "peersSendingToUs",
        "peersGettingFromUs",
        "trackerStats",
        "uploadRatio",
        "errorString",
        "hashString", // Required for matching downloads by hash
        "labels", // Transmission 2.8+: used as category identifier
      ],
    });

    if (response.arguments.torrents) {
      return response.arguments.torrents.map((torrent: TransmissionTorrent) =>
        this.mapTransmissionStatus(torrent)
      );
    }

    return [];
  }

  async pauseDownload(id: string): Promise<{ success: boolean; message: string }> {
    try {
      await this.makeRequest("torrent-stop", { ids: this.toTransmissionIds(id) });
      return { success: true, message: "Download paused successfully" };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return { success: false, message: `Failed to pause download: ${errorMessage}` };
    }
  }

  async resumeDownload(id: string): Promise<{ success: boolean; message: string }> {
    try {
      await this.makeRequest("torrent-start", { ids: this.toTransmissionIds(id) });
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
      await this.makeRequest("torrent-remove", {
        ids: this.toTransmissionIds(id),
        "delete-local-data": deleteFiles,
      });
      return { success: true, message: "Download removed successfully" };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return { success: false, message: `Failed to remove download: ${errorMessage}` };
    }
  }

  async getFreeSpace(): Promise<number> {
    try {
      const response = await this.makeRequest("session-get", {
        fields: ["download-dir"],
      });
      const downloadDir = response.arguments["download-dir"];

      const freeSpaceResponse = await this.makeRequest("free-space", {
        path: downloadDir,
      });

      return freeSpaceResponse.arguments["size-bytes"] || 0;
    } catch (error) {
      downloadersLogger.error({ error }, "Error getting free space from Transmission");
      return 0;
    }
  }

  private mapTransmissionStatus(torrent: TransmissionTorrent): DownloadStatus {
    // Transmission status codes: 0=stopped, 1=check pending, 2=checking, 3=download pending, 4=downloading, 5=seed pending, 6=seeding
    let status: DownloadStatus["status"] = "paused";
    const progress = Math.round(torrent.percentDone * 100);

    switch (torrent.status) {
      case 0:
        // If stopped and 100% done, it's completed
        status = progress >= 100 ? "completed" : "paused";
        break;
      case 4:
        status = "downloading";
        break;
      case 6:
        status = "seeding";
        break;
      case 1:
      case 2:
      case 3:
      case 5:
        status = "downloading";
        break;
      default:
        status = "error";
        break;
    }

    if (progress >= 100) {
      // If 100% done, mark as completed or seeding depending on status
      if (status === "downloading") {
        status = "seeding"; // Or completed, but seeding is safer if it's running
      }
    }

    if (torrent.errorString) {
      status = "error";
    }

    const trackerSwarmCounts = this.getTrackerSwarmCounts(torrent.trackerStats);
    const connectedSeeders = this.normalizePeerCount(torrent.peersSendingToUs);
    const connectedLeechers = this.normalizePeerCount(torrent.peersGettingFromUs);

    return {
      id: torrent.hashString || torrent.id.toString(), // Use hash for consistency, fallback to numeric id
      name: torrent.name,
      status,
      progress,
      downloadSpeed: torrent.rateDownload,
      uploadSpeed: torrent.rateUpload,
      eta: torrent.eta > 0 ? torrent.eta : undefined,
      size: torrent.totalSize,
      downloaded: torrent.downloadedEver,
      // Prefer tracker swarm counts; fallback to currently connected peer counts when unavailable.
      seeders: trackerSwarmCounts.seeders ?? connectedSeeders,
      leechers: trackerSwarmCounts.leechers ?? connectedLeechers,
      ratio: torrent.uploadRatio,
      error: torrent.errorString || undefined,
      category: torrent.labels?.[0],
    };
  }

  private mapTransmissionDetails(torrent: TransmissionTorrent): DownloadDetails {
    // Get base status first
    const baseStatus = this.mapTransmissionStatus(torrent);

    // Map files
    const files: DownloadFile[] = [];
    if (torrent.files && torrent.fileStats) {
      for (let i = 0; i < torrent.files.length; i++) {
        const file = torrent.files[i];
        const stats = torrent.fileStats[i];

        // Transmission priority: -1=low, 0=normal, 1=high
        // If file is not wanted, mark as 'off'
        let priority: DownloadFile["priority"] = "normal";
        if (!stats.wanted) {
          priority = "off";
        } else if (stats.priority === -1) {
          priority = "low";
        } else if (stats.priority === 1) {
          priority = "high";
        }

        const fileProgress =
          file.length > 0 ? Math.round((stats.bytesCompleted / file.length) * 100) : 0;

        files.push({
          name: file.name,
          size: file.length,
          progress: fileProgress,
          priority,
          wanted: stats.wanted,
        });
      }
    }

    // Map trackers
    const trackers: DownloadTracker[] = [];
    if (torrent.trackerStats) {
      for (const tracker of torrent.trackerStats) {
        // Transmission tracker status: 0=inactive, 1=waiting, 2=queued, 3=active
        let trackerStatus: DownloadTracker["status"] = "inactive";
        if (tracker.lastAnnounceSucceeded) {
          trackerStatus = "working";
        } else if (tracker.isBackup) {
          trackerStatus = "inactive";
        } else if (tracker.lastAnnounceResult && tracker.lastAnnounceResult !== "Success") {
          trackerStatus = "error";
        } else if (tracker.announceState === 1 || tracker.announceState === 2) {
          trackerStatus = "updating";
        }

        trackers.push({
          url: tracker.announce,
          tier: tracker.tier,
          status: trackerStatus,
          seeders: tracker.seederCount >= 0 ? tracker.seederCount : undefined,
          leechers: tracker.leecherCount >= 0 ? tracker.leecherCount : undefined,
          lastAnnounce:
            tracker.lastAnnounceTime > 0
              ? new Date(tracker.lastAnnounceTime * 1000).toISOString()
              : undefined,
          nextAnnounce:
            tracker.nextAnnounceTime && tracker.nextAnnounceTime > 0
              ? new Date(tracker.nextAnnounceTime * 1000).toISOString()
              : undefined,
          error:
            tracker.lastAnnounceResult && tracker.lastAnnounceResult !== "Success"
              ? tracker.lastAnnounceResult
              : undefined,
        });
      }
    }

    return {
      ...baseStatus,
      hash: torrent.hashString ?? "",
      addedDate:
        torrent.addedDate && torrent.addedDate > 0
          ? new Date(torrent.addedDate * 1000).toISOString()
          : undefined,
      completedDate:
        torrent.doneDate && torrent.doneDate > 0
          ? new Date(torrent.doneDate * 1000).toISOString()
          : undefined,
      downloadDir: torrent.downloadDir,
      comment: torrent.comment || undefined,
      creator: torrent.creator || undefined,
      files,
      filesSupport: "supported",
      trackers,
      totalPeers: torrent.peersConnected,
      connectedPeers: torrent.peersConnected,
    };
  }

  private normalizePeerCount(count: number | undefined): number | undefined {
    return typeof count === "number" && Number.isFinite(count) && count >= 0 ? count : undefined;
  }

  private toTransmissionIds(id: string): Array<string | number> {
    return /^\d+$/.test(id) ? [Number.parseInt(id, 10)] : [id];
  }

  private getTrackerSwarmCounts(trackerStats: TransmissionTorrent["trackerStats"]): {
    seeders?: number;
    leechers?: number;
  } {
    let seeders: number | undefined;
    let leechers: number | undefined;

    for (const tracker of trackerStats ?? []) {
      const trackerSeeders = this.normalizePeerCount(tracker.seederCount);
      const trackerLeechers = this.normalizePeerCount(tracker.leecherCount);

      if (trackerSeeders !== undefined) {
        seeders = seeders === undefined ? trackerSeeders : Math.max(seeders, trackerSeeders);
      }
      if (trackerLeechers !== undefined) {
        leechers = leechers === undefined ? trackerLeechers : Math.max(leechers, trackerLeechers);
      }
    }

    return { seeders, leechers };
  }

  // Transmission API response structure
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async makeRequest(method: string, arguments_: any): Promise<any> {
    const baseUrl = this.getBaseUrl();

    // If the base URL doesn't already contain /transmission/rpc, append it
    let url = baseUrl;
    if (!url.includes("/transmission/rpc")) {
      url += "/transmission/rpc";
    }

    const body = {
      method,
      arguments: arguments_,
    };
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": "Questarr/1.0",
    };

    if (this.sessionId) {
      headers["X-Transmission-Session-Id"] = this.sessionId;
    }

    if (this.downloader.username && this.downloader.password) {
      const auth = Buffer.from(
        `${this.downloader.username}:${this.downloader.password}`,
        "utf-8"
      ).toString("base64");
      headers["Authorization"] = `Basic ${auth}`;
    }

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });

    // Handle session ID requirement for Transmission
    if (response.status === 409) {
      const sessionId = response.headers.get("X-Transmission-Session-Id");
      if (sessionId) {
        this.sessionId = sessionId;
        headers["X-Transmission-Session-Id"] = sessionId;

        downloadersLogger.debug({ method, url }, "Retrying Transmission request with session ID");

        // Retry with session ID
        const retryResponse = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(30000),
        });

        if (!retryResponse.ok) {
          const errorText = await retryResponse.text().catch(() => "No error details available");
          if (retryResponse.status === 401) {
            downloadersLogger.error(
              {
                status: retryResponse.status,
                url,
                username: this.downloader.username,
                method,
                errorText,
              },
              "Transmission authentication failed - check username and password"
            );
            throw new Error(
              `Authentication failed: Invalid username or password for Transmission - ${errorText}`
            );
          }
          downloadersLogger.error(
            {
              status: retryResponse.status,
              statusText: retryResponse.statusText,
              url,
              method,
              errorText,
            },
            "Transmission request failed after session ID retry"
          );
          throw new Error(
            `HTTP ${retryResponse.status}: ${retryResponse.statusText} - ${errorText}`
          );
        }

        return retryResponse.json();
      }
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => "No error details available");
      if (response.status === 401) {
        const authHeader = response.headers.get("www-authenticate");
        downloadersLogger.error(
          {
            status: response.status,
            url,
            username: this.downloader.username,
            method,
            errorText,
            authHeader,
          },
          "Transmission authentication failed - check username and password"
        );
        throw new Error(
          `Authentication failed: Invalid username or password for Transmission - ${errorText}`
        );
      }
      downloadersLogger.error(
        {
          status: response.status,
          statusText: response.statusText,
          url,
          method,
          errorText,
        },
        "Transmission request failed"
      );
      throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText}`);
    }

    return response.json();
  }
}
