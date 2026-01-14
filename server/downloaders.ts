import type {
  Downloader,
  DownloadStatus,
  DownloadFile,
  DownloadTracker,
  DownloadDetails,
} from "../shared/schema.js";
import { downloadersLogger } from "./logger.js";
import crypto from "crypto";
import parseTorrent from "parse-torrent";
import { XMLParser } from "fast-xml-parser";

// Type definitions for API responses
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
  [key: string]: unknown;
}

// RTorrentTorrent is not directly used, but serves as documentation for the rTorrent API response structure

interface QBittorrentTorrent {
  hash: string;
  name: string;
  state: string;
  progress: number;
  dlspeed: number;
  upspeed: number;
  eta: number;
  size: number;
  downloaded: number;
  uploaded: number;
  ratio: number;
  num_seeds: number;
  num_leechs: number;
  num_complete: number;
  num_incomplete: number;
  category?: string;
  save_path?: string;
  [key: string]: unknown;
}

// XML response value can be primitive, array, or object
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type XMLValue = any;

/**
 * Extract torrent info hash from a magnet URI.
 * Standardizes to lowercase as per BitTorrent specification (case-insensitive hex encoding).
 *
 * @param url - The magnet URI or torrent URL
 * @returns The info hash in lowercase, or null if not found
 */
function extractHashFromUrl(url: string): string | null {
  // Extract hash from magnet link - supports both hex (40 chars) and base32 (32 chars) formats
  const magnetMatch = url.match(/xt=urn:btih:([a-fA-F0-9]{40}|[a-zA-Z2-7]{32})/i);
  if (magnetMatch) {
    return magnetMatch[1].toLowerCase();
  }
  return null;
}

interface DownloadRequest {
  url: string;
  title: string;
  category?: string;
  downloadPath?: string;
  priority?: number;
  downloadType?: "torrent" | "usenet";
}

interface DownloaderClient {
  testConnection(): Promise<{ success: boolean; message: string }>;
  addDownload(
    request: DownloadRequest
  ): Promise<{ success: boolean; id?: string; message: string }>;
  getDownloadStatus(id: string): Promise<DownloadStatus | null>;
  getDownloadDetails(id: string): Promise<DownloadDetails | null>;
  getAllDownloads(): Promise<DownloadStatus[]>;
  pauseDownload(id: string): Promise<{ success: boolean; message: string }>;
  resumeDownload(id: string): Promise<{ success: boolean; message: string }>;
  removeDownload(id: string, deleteFiles?: boolean): Promise<{ success: boolean; message: string }>;
  getFreeSpace(): Promise<number>;
}

class TransmissionClient implements DownloaderClient {
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
      return urlObj.toString().replace(/\/$/, "");
    } catch {
      return baseUrl.replace(/\/$/, "");
    }
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      await this.makeRequest("session-get", {});
      downloadersLogger.info(
        { url: this.downloader.url },
        "Transmission connection test successful"
      );
      return { success: true, message: "Connected successfully to Transmission" };
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

  async addDownload(
    request: DownloadRequest
  ): Promise<{ success: boolean; id?: string; message: string }> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const args: any = {};

      // Check if it's a magnet link or a URL that needs downloading
      const isMagnet = request.url.startsWith("magnet:");

      if (isMagnet) {
        args.filename = request.url;
      } else {
        // Download the file locally first
        // This is necessary because Transmission might not have access to the indexer (e.g. private trackers)
        try {
          downloadersLogger.debug(
            { url: request.url },
            "Downloading file locally for Transmission"
          );

          const fetchTorrent = async (url: string) => {
            return fetch(url, {
              headers: {
                "User-Agent":
                  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
                Accept: "application/x-bittorrent, */*",
              },
            });
          };

          let response = await fetchTorrent(request.url);

          if (!response.ok) {
            // Retry logic similar to rTorrent client
            if (response.status === 400 && request.url.includes("+")) {
              const fixedUrl = request.url.replace(/\+/g, "%20");
              response = await fetchTorrent(fixedUrl);

              if (!response.ok && request.url.includes("&file=")) {
                const urlNoFile = request.url.split("&file=")[0];
                response = await fetchTorrent(urlNoFile);
              }
            }
          }

          if (response.ok) {
            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);

            // Try to parse hash for immediate return
            try {
              const parsed = await parseTorrent(buffer);
              if (parsed && parsed.infoHash) {
                // We can't set ID on the return object directly here as Transmission returns it
                // but we can verify it matches later if needed
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
          downloadersLogger.error({ error }, "Error downloading file, passing URL to Transmission");
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
        return {
          success: false,
          message: "Failed to add download",
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
        ids: [parseInt(id)],
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
        ids: [parseInt(id)],
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
      console.error("Error getting download details:", error);
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
        "uploadRatio",
        "errorString",
        "hashString", // Required for matching downloads by hash
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
      await this.makeRequest("torrent-stop", { ids: [parseInt(id)] });
      return { success: true, message: "Download paused successfully" };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return { success: false, message: `Failed to pause download: ${errorMessage}` };
    }
  }

  async resumeDownload(id: string): Promise<{ success: boolean; message: string }> {
    try {
      await this.makeRequest("torrent-start", { ids: [parseInt(id)] });
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
        ids: [parseInt(id)],
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
      seeders: torrent.peersSendingToUs,
      leechers: torrent.peersGettingFromUs,
      ratio: torrent.uploadRatio,
      error: torrent.errorString || undefined,
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
      trackers,
      totalPeers: torrent.peersConnected,
      connectedPeers: torrent.peersConnected,
    };
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
        "latin1"
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

/**
 * rTorrent/ruTorrent client implementation using XML-RPC protocol.
 *
 * @remarks
 * - Communicates via XML-RPC to the /RPC2 endpoint
 * - Uses d.multicall2 for efficient batch operations
 * - Status mapping: state (0=stopped, 1=started) + complete (0/1)
 * - Supports Basic Authentication via username/password
 */
class RTorrentClient implements DownloaderClient {
  private downloader: Downloader;

  constructor(downloader: Downloader) {
    this.downloader = downloader;
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      // Test connection by getting rTorrent version
      const version = await this.makeXMLRPCRequest("system.client_version", []);
      downloadersLogger.info(
        {
          url: this.downloader.url,
          version,
        },
        "rTorrent connection test successful"
      );
      return { success: true, message: "Connected successfully to rTorrent" };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      downloadersLogger.error(
        {
          error: errorMessage,
          url: this.downloader.url,
          username: this.downloader.username,
          urlPath: this.downloader.urlPath || "RPC2",
        },
        "rTorrent connection test failed"
      );

      if (errorMessage.includes("Authentication failed")) {
        return { success: false, message: errorMessage };
      }
      return { success: false, message: `Failed to connect to rTorrent: ${errorMessage}` };
    }
  }

  async addDownload(
    request: DownloadRequest
  ): Promise<{ success: boolean; id?: string; message: string }> {
    try {
      if (!request.url) {
        return {
          success: false,
          message: "Download URL is required",
        };
      }

      // Helper to fetch with standard headers
      const fetchTorrent = async (url: string) => {
        downloadersLogger.debug({ url }, "Downloading file locally");
        return fetch(url, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
            Accept: "application/x-bittorrent, */*",
          },
        });
      };

      let response = await fetchTorrent(request.url);

      if (!response.ok) {
        const errorText = await response.text().catch(() => "No body");
        downloadersLogger.error(
          {
            status: response.status,
            statusText: response.statusText,
            url: request.url,
            headers: Object.fromEntries(response.headers.entries()),
            errorBody: errorText,
          },
          "Failed to download file from indexer"
        );

        // Retry with %20 replacement for + if 400 Bad Request
        if (response.status === 400 && request.url.includes("+")) {
          const fixedUrl = request.url.replace(/\+/g, "%20");
          downloadersLogger.warn(
            { original: request.url, fixed: fixedUrl },
            "Retrying download with %20 instead of +"
          );
          response = await fetchTorrent(fixedUrl);

          if (!response.ok) {
            const retryErrorText = await response.text().catch(() => "No body");
            downloadersLogger.error(
              {
                status: response.status,
                url: fixedUrl,
                errorBody: retryErrorText,
              },
              "Retry with %20 failed"
            );

            // Retry 2: Remove 'file' parameter entirely (it's often just for naming)
            if (request.url.includes("&file=")) {
              const urlNoFile = request.url.split("&file=")[0];
              downloadersLogger.warn(
                { original: request.url, fixed: urlNoFile },
                "Retrying download without file parameter"
              );
              response = await fetchTorrent(urlNoFile);

              if (!response.ok) {
                return {
                  success: false,
                  message: `Failed to download file (retry without file param failed): ${response.statusText}`,
                };
              }
            } else {
              return {
                success: false,
                message: `Failed to download file (retry failed): ${response.statusText}`,
              };
            }
          }
        } else {
          // Also try removing file param if we didn't try %20 (e.g. no + in URL but still 400)
          if (response.status === 400 && request.url.includes("&file=")) {
            const urlNoFile = request.url.split("&file=")[0];
            downloadersLogger.warn(
              { original: request.url, fixed: urlNoFile },
              "Retrying download without file parameter"
            );
            response = await fetchTorrent(urlNoFile);

            if (!response.ok) {
              return {
                success: false,
                message: `Failed to download file (retry without file param failed): ${response.statusText}`,
              };
            }
          } else {
            return {
              success: false,
              message: `Failed to download file from indexer: ${response.statusText}`,
            };
          }
        }
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // 2. Parse it to get the hash
      let infoHash = "unknown";
      try {
        // parse-torrent can handle buffer input
        const parsed = await parseTorrent(buffer);
        if (parsed && parsed.infoHash) {
          infoHash = parsed.infoHash.toLowerCase();
        }
      } catch (error) {
        downloadersLogger.warn({ error }, "Failed to parse file for hash");
      }

      // 3. Send raw file to rTorrent
      // Determine which method to use based on addStopped setting
      const addMethod = this.downloader.addStopped ? "load.raw" : "load.raw_start";

      downloadersLogger.debug(
        { method: addMethod, size: buffer.length, hash: infoHash },
        "Uploading raw file to rTorrent"
      );

      // rTorrent expects the raw data as the first argument (after empty target)
      // load.raw_start("", buffer)
      const result = await this.makeXMLRPCRequest(addMethod, ["", buffer]);

      // Result is usually 0 on success
      if (result === 0) {
        // Set category/label if specified
        const category = request.category || this.downloader.category;
        if (category && infoHash !== "unknown") {
          try {
            // Give rTorrent a moment to register the download before setting properties
            // though with XML-RPC it should be sequential
            await this.makeXMLRPCRequest("d.custom1.set", [infoHash, category]);
          } catch (error) {
            downloadersLogger.warn(
              { error, hash: infoHash, category },
              "Failed to set category on download"
            );
          }
        }

        return {
          success: true,
          id: infoHash,
          message: `Download added successfully${this.downloader.addStopped ? " (stopped)" : ""}`,
        };
      } else {
        // Check if result is 0 (success) even if type check failed or something else
        // Some rTorrent versions might return empty string or other success indicators
        // But standard XML-RPC returns 0 for success on load commands
        return {
          success: false,
          message: `Failed to add download (rTorrent returned code: ${result})`,
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      downloadersLogger.error({ error, url: request.url }, "Failed to add download");
      return { success: false, message: `Failed to add download: ${errorMessage}` };
    }
  }

  async getDownloadStatus(id: string): Promise<DownloadStatus | null> {
    try {
      // Get detailed information about a specific download using multicall
      const result = await this.makeXMLRPCRequest("d.multicall2", [
        "",
        "main", // Added view parameter which is required for d.multicall2
        "d.hash=",
        "d.name=",
        "d.state=",
        "d.complete=",
        "d.size_bytes=",
        "d.completed_bytes=",
        "d.down.rate=",
        "d.up.rate=",
        "d.ratio=",
        "d.peers_connected=",
        "d.peers_complete=",
        "d.message=",
        "d.custom1=",
      ]);

      // Filter for the specific ID since d.multicall2 returns all downloads in the view
      if (result && result.length > 0) {
        const download = result.find(
          (t: unknown[]) => (t as string[])[0].toLowerCase() === id.toLowerCase()
        );
        if (download) {
          return this.mapRTorrentStatus(download);
        }
      }

      return null;
    } catch (error) {
      downloadersLogger.error({ error }, "error getting download status (rtorrent)");
      return null;
    }
  }

  async getDownloadDetails(id: string): Promise<DownloadDetails | null> {
    try {
      // Get basic download info
      const basicInfo = await Promise.all([
        this.makeXMLRPCRequest("d.hash", [id]),
        this.makeXMLRPCRequest("d.name", [id]),
        this.makeXMLRPCRequest("d.state", [id]),
        this.makeXMLRPCRequest("d.complete", [id]),
        this.makeXMLRPCRequest("d.size_bytes", [id]),
        this.makeXMLRPCRequest("d.completed_bytes", [id]),
        this.makeXMLRPCRequest("d.down.rate", [id]),
        this.makeXMLRPCRequest("d.up.rate", [id]),
        this.makeXMLRPCRequest("d.ratio", [id]),
        this.makeXMLRPCRequest("d.peers_connected", [id]),
        this.makeXMLRPCRequest("d.peers_complete", [id]),
        this.makeXMLRPCRequest("d.message", [id]),
        this.makeXMLRPCRequest("d.directory", [id]),
        this.makeXMLRPCRequest("d.creation_date", [id]),
      ]);

      const [
        hash,
        name,
        state,
        complete,
        sizeBytes,
        completedBytes,
        downRate,
        upRate,
        ratio,
        peersConnected,
        peersComplete,
        message,
        directory,
        creationDate,
      ] = basicInfo;

      // Get files using f.multicall
      const filesResult = await this.makeXMLRPCRequest("f.multicall", [
        id,
        "",
        "f.path=",
        "f.size_bytes=",
        "f.completed_chunks=",
        "f.size_chunks=",
        "f.priority=",
      ]);

      // Get trackers using t.multicall
      const trackersResult = await this.makeXMLRPCRequest("t.multicall", [
        id,
        "",
        "t.url=",
        "t.group=",
        "t.is_enabled=",
        "t.scrape_complete=",
        "t.scrape_incomplete=",
      ]);

      // Map status
      let status: DownloadStatus["status"];
      if (state === 1) {
        status = complete === 1 ? "seeding" : "downloading";
      } else {
        status = complete === 1 ? "completed" : "paused";
      }
      if (message && message.length > 0) {
        status = "error";
      }

      const progress = sizeBytes > 0 ? Math.round((completedBytes / sizeBytes) * 100) : 0;

      // Map files
      // rTorrent priority: 0 = don't download (off), 1 = normal, 2 = high
      const files: DownloadFile[] = (filesResult || []).map((file: unknown[]) => {
        const [path, size, completedChunks, totalChunks, priority] = file;
        const fileProgress =
          (totalChunks as number) > 0
            ? Math.round(((completedChunks as number) / (totalChunks as number)) * 100)
            : 0;
        let filePriority: DownloadFile["priority"] = "normal";
        if ((priority as number) === 0) filePriority = "off";
        else if ((priority as number) === 1) filePriority = "normal";
        else if ((priority as number) === 2) filePriority = "high";

        return {
          name: path as string,
          size: size as number,
          progress: fileProgress,
          priority: filePriority,
          wanted: (priority as number) !== 0,
        };
      });

      // Map trackers
      const trackers: DownloadTracker[] = (trackersResult || []).map((tracker: unknown[]) => {
        // rTorrent tracker tuple: [url, group, isEnabled, seeders, leechers, ...optional fields]
        const [url, group, isEnabled, seeders, leechers, lastScrape, lastAnnounce, lastError] =
          tracker;
        let trackerStatus: DownloadTracker["status"] = "inactive";
        if (isEnabled) {
          if (lastError && typeof lastError === "string" && lastError.length > 0) {
            trackerStatus = "error";
          } else if (lastScrape === 0 || lastAnnounce === 0) {
            trackerStatus = "updating";
          } else {
            trackerStatus = "working";
          }
        }
        return {
          url: url as string,
          tier: group as number,
          status: trackerStatus,
          seeders: (seeders as number) >= 0 ? (seeders as number) : undefined,
          leechers: (leechers as number) >= 0 ? (leechers as number) : undefined,
          error:
            lastError && typeof lastError === "string" && lastError.length > 0
              ? lastError
              : undefined,
        };
      });

      return {
        id: hash,
        name,
        status,
        progress,
        downloadSpeed: downRate,
        uploadSpeed: upRate,
        size: sizeBytes,
        downloaded: completedBytes,
        seeders: peersComplete,
        leechers: Math.max(0, peersConnected - peersComplete),
        ratio: ratio / 1000,
        error: message || undefined,
        hash,
        downloadDir: directory,
        addedDate: creationDate > 0 ? new Date(creationDate * 1000).toISOString() : undefined,
        files,
        trackers,
        totalPeers: peersConnected,
        connectedPeers: peersConnected,
      };
    } catch (error) {
      console.error("Error getting download details:", error);
      return null;
    }
  }

  async getAllDownloads(): Promise<DownloadStatus[]> {
    // Get all downloads using multicall
    // Note: d.multicall2 requires a view (usually "main" or "default") as the second argument
    const result = await this.makeXMLRPCRequest("d.multicall2", [
      "",
      "main",
      "d.hash=",
      "d.name=",
      "d.state=",
      "d.complete=",
      "d.size_bytes=",
      "d.completed_bytes=",
      "d.down.rate=",
      "d.up.rate=",
      "d.ratio=",
      "d.peers_connected=",
      "d.peers_complete=",
      "d.message=",
      "d.custom1=",
    ]);

    if (result) {
      return result.map((torrent: unknown[]) => this.mapRTorrentStatus(torrent));
    }

    return [];
  }

  async pauseDownload(id: string): Promise<{ success: boolean; message: string }> {
    try {
      await this.makeXMLRPCRequest("d.stop", [id]);
      return { success: true, message: "Download paused successfully" };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return { success: false, message: `Failed to pause download: ${errorMessage}` };
    }
  }

  async resumeDownload(id: string): Promise<{ success: boolean; message: string }> {
    try {
      await this.makeXMLRPCRequest("d.start", [id]);
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
      if (deleteFiles) {
        // Stop download, delete data, and remove from client
        await this.makeXMLRPCRequest("d.stop", [id]);
        await this.makeXMLRPCRequest("d.delete_tied", [id]); // Delete files
        await this.makeXMLRPCRequest("d.erase", [id]);
      } else {
        // Just remove from client without deleting files
        await this.makeXMLRPCRequest("d.erase", [id]);
      }
      return { success: true, message: "Download removed successfully" };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return { success: false, message: `Failed to remove download: ${errorMessage}` };
    }
  }

  async getFreeSpace(): Promise<number> {
    try {
      // In rTorrent, get the free disk space for the default download directory
      // Use directory.default to get the default download directory
      const directory = await this.makeXMLRPCRequest("directory.default", []);
      downloadersLogger.debug({ directory }, "Got default directory from rTorrent");

      // Use df with --output=avail to get just the available space
      // This is more portable and explicit than parsing columns
      const dfOutput = await this.makeXMLRPCRequest("execute.capture", [
        "",
        "sh",
        "-c",
        `df --output=avail -B1 "${directory}" | tail -1`,
      ]);
      downloadersLogger.debug({ dfOutput }, "Got df output from rTorrent");

      // The output should be just the available bytes
      const availableBytes = parseInt(dfOutput.toString().trim(), 10);
      if (!isNaN(availableBytes) && availableBytes > 0) {
        return availableBytes;
      }

      downloadersLogger.warn({ dfOutput, availableBytes }, "Failed to parse df output");
      return 0;
    } catch (error) {
      downloadersLogger.error({ error }, "Error getting free space from rTorrent");
      return 0;
    }
  }

  private mapRTorrentStatus(torrent: unknown[]): DownloadStatus {
    // download is an array: [hash, name, state, complete, size, completed, down_rate, up_rate, ratio, peers_connected, peers_complete, message, custom1]
    const [
      hash,
      name,
      state,
      complete,
      sizeBytes,
      completedBytes,
      downRate,
      upRate,
      ratio,
      peersConnected,
      peersComplete,
      message,
      custom1,
    ] = torrent;

    // rTorrent state: 0=stopped, 1=started
    // complete: 0=incomplete, 1=complete
    let status: DownloadStatus["status"];

    // Check for error message first
    if (message && (message as string).length > 0) {
      status = "error";
    } else if ((state as number) === 1) {
      // Started
      if ((complete as number) === 1) {
        status = "seeding";
      } else {
        status = "downloading";
      }
    } else {
      // Stopped/Paused
      if ((complete as number) === 1) {
        status = "completed";
      } else {
        status = "paused";
      }
    }

    const progress =
      (sizeBytes as number) > 0
        ? Math.round(((completedBytes as number) / (sizeBytes as number)) * 100)
        : 0;

    // Force completed status if progress is 100% even if rTorrent says otherwise
    // This handles cases where rTorrent might be in a weird state or checking
    if (progress >= 100 && status !== "seeding" && status !== "completed") {
      // If it's stopped and 100%, it's completed.
      // If it's started and 100%, it's seeding (or should be).
      status = (state as number) === 1 ? "seeding" : "completed";
    }

    // Fix for 0% progress and 0 ratio when data is missing or not yet loaded
    // If size is 0, it might be a magnet link resolving metadata
    if ((sizeBytes as number) === 0) {
      // Keep existing status but ensure we don't divide by zero
    }

    return {
      id: hash as string,
      name: name as string,
      status,
      progress,
      downloadSpeed: downRate as number,
      uploadSpeed: upRate as number,
      size: sizeBytes as number,
      downloaded: completedBytes as number,
      seeders: peersComplete as number,
      leechers: Math.max(0, (peersConnected as number) - (peersComplete as number)),
      ratio: (ratio as number) / 1000, // rTorrent returns ratio * 1000
      error: (message as string) || undefined,
      category: (custom1 as string) || undefined,
    };
  }

  private computeDigestHeader(
    method: string,
    uri: string,
    authHeader: string,
    username: string,
    password: string
  ): string {
    // Parse challenge
    const challenge: Record<string, string> = {};
    const regex = /([a-z0-9_-]+)=(?:"([^"]+)"|([a-z0-9_-]+))/gi;
    let match;
    while ((match = regex.exec(authHeader)) !== null) {
      const key = match[1].toLowerCase();
      const value = match[2] || match[3]; // Group 2 is quoted, Group 3 is unquoted
      challenge[key] = value;
    }

    const realm = challenge.realm;
    const nonce = challenge.nonce;
    const algorithm = challenge.algorithm || "MD5";
    const qop = challenge.qop;
    const opaque = challenge.opaque;

    // A1 = username:realm:password
    const ha1 = crypto.createHash("md5").update(`${username}:${realm}:${password}`).digest("hex");

    // A2 = method:uri
    const ha2 = crypto.createHash("md5").update(`${method}:${uri}`).digest("hex");

    // Response
    const nc = "00000001";
    const cnonce = crypto.randomBytes(8).toString("hex");

    let response: string;
    if (qop === "auth" || qop === "auth-int") {
      response = crypto
        .createHash("md5")
        .update(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
        .digest("hex");
    } else {
      response = crypto.createHash("md5").update(`${ha1}:${nonce}:${ha2}`).digest("hex");
    }

    let auth = `Digest username="${username}", realm="${realm}", nonce="${nonce}", uri="${uri}", algorithm="${algorithm}", response="${response}"`;

    if (opaque) {
      auth += `, opaque="${opaque}"`;
    }
    if (qop) {
      auth += `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"`;
    }

    return auth;
  }

  private async makeXMLRPCRequest(method: string, params: unknown[]): Promise<XMLValue> {
    // Build the complete URL with protocol, host, port, and path
    let baseUrl = this.downloader.url;

    // Add protocol if not present
    if (!baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) {
      const protocol = this.downloader.useSsl ? "https://" : "http://";
      baseUrl = protocol + baseUrl;
    }

    // Parse URL to handle port and path correctly
    let urlObj: URL;
    try {
      urlObj = new URL(baseUrl);
    } catch {
      // Fallback for invalid URLs, though they should be validated before
      urlObj = new URL(`http://${baseUrl}`);
    }

    // Add/Update port if specified
    if (this.downloader.port) {
      urlObj.port = this.downloader.port.toString();
    }

    // Get the base path from the URL (e.g., /rutorrent from https://host/rutorrent)
    // Remove trailing slash if present
    let basePath = urlObj.pathname;
    if (basePath.endsWith("/")) {
      basePath = basePath.slice(0, -1);
    }

    // Add URL path (defaults to RPC2 if not specified)
    // Ensure urlPath doesn't start with / to avoid double slashes when joining
    let urlPath = this.downloader.urlPath || "RPC2";
    if (urlPath.startsWith("/")) {
      urlPath = urlPath.substring(1);
    }

    // Construct final URL
    // Format: protocol://host:port/basePath/urlPath
    urlObj.pathname = `${basePath}/${urlPath}`;
    const url = urlObj.toString();

    // Build XML-RPC request
    const xmlParams = params
      .map((param) => {
        if (Buffer.isBuffer(param)) {
          return `<param><value><base64>${param.toString("base64")}</base64></value></param>`;
        } else if (typeof param === "string") {
          return `<param><value><string>${this.escapeXml(param)}</string></value></param>`;
        } else if (typeof param === "number") {
          return `<param><value><int>${param}</int></value></param>`;
        }
        return `<param><value><string>${this.escapeXml(String(param))}</string></value></param>`;
      })
      .join("");

    const xmlBody = `<?xml version="1.0"?>
<methodCall>
  <methodName>${this.escapeXml(method)}</methodName>
  <params>
    ${xmlParams}
  </params>
</methodCall>`;

    const headers: Record<string, string> = {
      "Content-Type": "text/xml",
      "User-Agent": "Questarr/1.0",
    };

    if (this.downloader.username && this.downloader.password) {
      const auth = Buffer.from(
        `${this.downloader.username}:${this.downloader.password}`,
        "latin1"
      ).toString("base64");
      headers["Authorization"] = `Basic ${auth}`;
    }

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: xmlBody,
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "No error details available");
      if (response.status === 401) {
        const authHeader = response.headers.get("www-authenticate");

        // Handle Digest Authentication
        if (
          authHeader &&
          authHeader.toLowerCase().startsWith("digest") &&
          this.downloader.username &&
          this.downloader.password
        ) {
          try {
            const uri = urlObj.pathname + urlObj.search;
            const digestAuth = this.computeDigestHeader(
              "POST",
              uri,
              authHeader,
              this.downloader.username,
              this.downloader.password
            );

            headers["Authorization"] = digestAuth;

            downloadersLogger.debug({ url }, "Retrying rTorrent request with Digest Auth");

            const retryResponse = await fetch(url, {
              method: "POST",
              headers,
              body: xmlBody,
              signal: AbortSignal.timeout(30000),
            });

            if (retryResponse.ok) {
              const retryResponseText = await retryResponse.text();
              return this.parseXMLRPCResponse(retryResponseText);
            } else {
              const retryErrorText = await retryResponse.text().catch(() => "No error details");
              downloadersLogger.error(
                {
                  status: retryResponse.status,
                  url,
                  username: this.downloader.username,
                  method,
                  errorText: retryErrorText,
                },
                "rTorrent Digest Authentication failed"
              );
              throw new Error(
                `Digest Authentication failed: ${retryResponse.status} ${retryResponse.statusText}`
              );
            }
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Unknown error";
            downloadersLogger.error({ error: errorMessage }, "Error processing Digest Auth");
            throw new Error(`Digest Auth Error: ${errorMessage}`);
          }
        }

        downloadersLogger.error(
          {
            status: response.status,
            url,
            username: this.downloader.username,
            method,
            errorText,
            authHeader,
          },
          "rTorrent authentication failed - verify username, password, and web server authentication configuration"
        );
        throw new Error(
          `Authentication failed: Invalid credentials or web server authentication not configured for rTorrent - ${errorText}`
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
        "rTorrent XML-RPC request failed"
      );
      throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText}`);
    }

    const responseText = await response.text();
    return this.parseXMLRPCResponse(responseText);
  }

  private parseXMLRPCResponse(xml: string): XMLValue {
    // Simple XML-RPC response parser
    // Extract the value from <methodResponse><params><param><value>...</value></param></params></methodResponse>

    // Check for fault
    if (xml.includes("<fault>")) {
      const faultStringMatch = xml.match(
        /<name>faultString<\/name>\s*<value><string>([^<]+)<\/string>/
      );
      if (faultStringMatch) {
        throw new Error(`XML-RPC Fault: ${faultStringMatch[1]}`);
      }
      throw new Error("XML-RPC Fault occurred");
    }

    // Find the main response value
    const paramValueMatch = xml.match(
      /<methodResponse>\s*<params>\s*<param>\s*<value>([\s\S]*?)<\/value>\s*<\/param>\s*<\/params>\s*<\/methodResponse>/
    );
    if (!paramValueMatch) {
      return null;
    }

    const valueContent = paramValueMatch[1].trim();

    // Parse array responses (for multicall)
    if (valueContent.startsWith("<array>")) {
      return this.parseXMLArray(valueContent);
    }

    // Parse string response
    const stringMatch = valueContent.match(/<string>([^<]*)<\/string>/);
    if (stringMatch) {
      return this.unescapeXml(stringMatch[1]);
    }

    // Parse int response
    const intMatch =
      valueContent.match(/<int>([^<]+)<\/int>/) || valueContent.match(/<i4>([^<]+)<\/i4>/);
    if (intMatch) {
      return parseInt(intMatch[1]);
    }

    // Parse double response
    const doubleMatch = valueContent.match(/<double>([^<]+)<\/double>/);
    if (doubleMatch) {
      return parseFloat(doubleMatch[1]);
    }

    return null;
  }

  private parseXMLArray(arrayXml: string): XMLValue[] {
    const result: XMLValue[] = [];

    // Extract the data section from <array><data>...</data></array>
    const dataMatch = arrayXml.match(/<array>\s*<data>([\s\S]*)<\/data>\s*<\/array>/);
    if (!dataMatch) {
      return result;
    }

    const dataContent = dataMatch[1];

    // Parse each value in the array
    // We need to be careful with nested structures
    let depth = 0;
    let currentValue = "";
    let inValue = false;

    for (let i = 0; i < dataContent.length; i++) {
      const char = dataContent[i];

      if (dataContent.substring(i, i + 7) === "<value>") {
        if (!inValue) {
          inValue = true;
          currentValue = "<value>";
          i += 6;
          depth = 1;
          continue;
        } else {
          depth++;
        }
      } else if (dataContent.substring(i, i + 8) === "</value>") {
        depth--;
        if (depth === 0 && inValue) {
          currentValue += "</value>";
          // Parse this value
          result.push(this.parseXMLValue(currentValue));
          currentValue = "";
          inValue = false;
          i += 7;
          continue;
        }
      }

      if (inValue) {
        currentValue += char;
      }
    }

    return result;
  }

  private parseXMLValue(valueXml: string): XMLValue {
    // Extract content between <value> and </value>
    const contentMatch = valueXml.match(/<value>([\s\S]*)<\/value>/);
    if (!contentMatch) {
      return "";
    }

    const content = contentMatch[1].trim();

    // Check if this is a nested array
    if (content.startsWith("<array>")) {
      return this.parseXMLArray(content);
    }

    // Parse string
    const stringMatch = content.match(/<string>([^<]*)<\/string>/);
    if (stringMatch) {
      return this.unescapeXml(stringMatch[1]);
    }

    // Parse int
    const intMatch = content.match(/<int>([^<]+)<\/int>/) || content.match(/<i4>([^<]+)<\/i4>/);
    if (intMatch) {
      return parseInt(intMatch[1]);
    }

    // Parse i8 (64-bit integer) - rTorrent uses this for file sizes
    const i8Match = content.match(/<i8>([^<]+)<\/i8>/);
    if (i8Match) {
      return parseInt(i8Match[1]);
    }

    // Parse double
    const doubleMatch = content.match(/<double>([^<]+)<\/double>/);
    if (doubleMatch) {
      return parseFloat(doubleMatch[1]);
    }

    return "";
  }

  private escapeXml(str: string): string {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  private unescapeXml(str: string): string {
    return str
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, "&"); // Must be last
  }
}

/**
 * qBittorrent client implementation using Web API v2.
 *
 * @remarks
 * - Uses cookie-based authentication via /api/v2/auth/login
 * - All torrent operations use /api/v2/torrents/* endpoints
 * - Status mapping: state field from API response
 * - Supports username/password authentication
 */
class QBittorrentClient implements DownloaderClient {
  private downloader: Downloader;
  private cookie: string | null = null;

  // Maximum ETA value to consider valid (100 days in seconds)
  // qBittorrent returns very large values when ETA is essentially infinite
  private static readonly MAX_VALID_ETA_SECONDS = 8640000;

  constructor(downloader: Downloader) {
    this.downloader = downloader;
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      await this.authenticate();
      // Test by getting app version
      const response = await this.makeRequest("GET", "/api/v2/app/version");
      const version = await response.text();
      return { success: true, message: `Connected successfully to qBittorrent ${version}` };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return { success: false, message: `Failed to connect to qBittorrent: ${errorMessage}` };
    }
  }

  async addDownload(
    request: DownloadRequest
  ): Promise<{ success: boolean; id?: string; message: string }> {
    try {
      if (!request.url) {
        return {
          success: false,
          message: "Download URL is required",
        };
      }

      await this.authenticate();

      const isMagnet = request.url.startsWith("magnet:");

      // Parse qBittorrent-specific settings
      let qbSettings: {
        initialState?: string;
        sequential?: boolean;
        firstLastPriority?: boolean;
      } = {};

      try {
        if (this.downloader.settings) {
          qbSettings = JSON.parse(this.downloader.settings);
        }
      } catch (error) {
        downloadersLogger.warn({ error }, "Failed to parse qBittorrent settings");
      }

      const savepath = request.downloadPath || this.downloader.downloadPath || undefined;
      const category = request.category || this.downloader.category || undefined;
      const pausedValue =
        qbSettings.initialState === "stopped" || this.downloader.addStopped ? "true" : "false";

      const maybeSetForceStarted = async (hash: string) => {
        if (qbSettings.initialState !== "force-started") return;
        try {
          await this.makeRequest(
            "POST",
            "/api/v2/torrents/setForceStart",
            `hashes=${hash}&value=true`,
            {
              "Content-Type": "application/x-www-form-urlencoded",
            }
          );
          downloadersLogger.info({ hash }, "Set download to force-started mode");
        } catch (error) {
          downloadersLogger.warn({ hash, error }, "Failed to set force-started mode");
        }
      };

      const findRecentlyAddedDownload = async (): Promise<{ hash: string; name?: string } | null> => {
        // Wait a bit for qBittorrent to process the add (URL add or torrent upload)
        await new Promise((resolve) => setTimeout(resolve, 2000));

        const allTorrentsResponse = await this.makeRequest(
          "GET",
          "/api/v2/torrents/info?sort=added_on&reverse=true"
        );
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const allDownloads = (await allTorrentsResponse.json()) as any[];

        downloadersLogger.debug(
          {
            requestTitle: request.title,
            downloadCount: allDownloads.length,
            recentDownloads: allDownloads.slice(0, 3).map((t: any) => ({ name: t.name, hash: t.hash })),
          },
          "Looking for newly added download"
        );

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let matchingDownload: any = null;
        if (request.title) {
          const normalizedTitle = request.title
            .toLowerCase()
            .replace(/[._-]/g, " ")
            .replace(/\s+/g, " ")
            .trim();

          matchingDownload = allDownloads.find((t: any) => {
            if (!t.name) return false;
            const normalizedName = t.name
              .toLowerCase()
              .replace(/[._-]/g, " ")
              .replace(/\s+/g, " ")
              .trim();
            return normalizedName.includes(normalizedTitle) || normalizedTitle.includes(normalizedName);
          });
        }

        if (!matchingDownload && allDownloads.length > 0) {
          const mostRecent = allDownloads[0];
          const now = Date.now() / 1000;
          if (mostRecent.added_on && now - mostRecent.added_on < 5) {
            downloadersLogger.info(
              { hash: mostRecent.hash, name: mostRecent.name, addedOn: mostRecent.added_on },
              "Using most recent download as match"
            );
            matchingDownload = mostRecent;
          }
        }

        if (matchingDownload && matchingDownload.hash) {
          return { hash: matchingDownload.hash, name: matchingDownload.name };
        }

        return null;
      };

      // 1) Try URL-based add first.
      //    - Required for magnet links.
      //    - Also supports "normal" torrent URLs when qBittorrent can reach the URL.
      try {
        const params = new URLSearchParams();
        params.set("urls", request.url);
        if (savepath) params.set("savepath", savepath);
        if (category) params.set("category", category);
        params.set("paused", pausedValue);

        downloadersLogger.info(
          { url: request.url, isMagnet, savepath, category, paused: pausedValue },
          "Adding download to qBittorrent via URL"
        );

        const urlAddResponse = await this.makeRequest(
          "POST",
          "/api/v2/torrents/add",
          params.toString(),
          {
            "Content-Type": "application/x-www-form-urlencoded",
          }
        );

        const urlAddResponseText = await urlAddResponse.text();
        downloadersLogger.info(
          {
            responseText: urlAddResponseText,
            responseStatus: urlAddResponse.status,
            responseOk: urlAddResponse.ok,
            responseHeaders: Object.fromEntries(urlAddResponse.headers.entries()),
          },
          "qBittorrent URL add response"
        );

        const urlAddOk = urlAddResponseText === "Ok." || urlAddResponseText === "";
        const urlAddFails = urlAddResponseText === "Fails.";

        if (urlAddOk || urlAddFails) {
          const hashFromUrl = extractHashFromUrl(request.url);

          if (hashFromUrl) {
            // For magnet links (or any URL containing xt=urn:btih), verify by hash.
            await new Promise((resolve) => setTimeout(resolve, 500));
            const verifyResponse = await this.makeRequest(
              "GET",
              `/api/v2/torrents/info?hashes=${hashFromUrl}`
            );
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const downloads = (await verifyResponse.json()) as any[];

            if (downloads && downloads.length > 0) {
              if (urlAddFails) {
                return {
                  success: true,
                  id: hashFromUrl,
                  message: "Download already exists (qBittorrent)",
                };
              }

              await maybeSetForceStarted(hashFromUrl);
              return {
                success: true,
                id: hashFromUrl,
                message: "Download added successfully",
              };
            }

            // Magnet links cannot fall back to torrent-file upload.
            if (isMagnet) {
              return {
                success: false,
                message:
                  "Magnet link was accepted by qBittorrent but the torrent was not found afterwards",
              };
            }
          } else {
            // For non-magnets, we can't verify by hash. Try to find the newly added item.
            const recent = await findRecentlyAddedDownload();
            if (recent) {
              if (urlAddFails) {
                return {
                  success: true,
                  id: recent.hash,
                  message: "Download already exists (qBittorrent)",
                };
              }

              await maybeSetForceStarted(recent.hash);
              return {
                success: true,
                id: recent.hash,
                message: "Download added successfully",
              };
            }

            if (isMagnet) {
              return {
                success: false,
                message: "Failed to add magnet link to qBittorrent",
              };
            }
          }

          // If we reach here for a non-magnet, qBittorrent either couldn't reach the URL
          // or didn't add anything we can observe. We'll fall back to torrent-file upload.
          downloadersLogger.warn(
            { url: request.url, responseText: urlAddResponseText },
            "URL-based add did not result in an added torrent; falling back to torrent-file upload"
          );
        } else {
          if (isMagnet) {
            return {
              success: false,
              message: `Failed to add magnet link: ${urlAddResponseText}`,
            };
          }

          downloadersLogger.warn(
            { url: request.url, responseText: urlAddResponseText },
            "Unexpected URL-add response; falling back to torrent-file upload"
          );
        }
      } catch (error) {
        if (isMagnet) {
          const errorMessage = error instanceof Error ? error.message : "Unknown error";
          return {
            success: false,
            message: `Failed to add magnet link: ${errorMessage}`,
          };
        }

        downloadersLogger.warn({ error, url: request.url }, "URL-based add failed; falling back to torrent-file upload");
      }

      // 2) Fallback: download .torrent and upload it (useful when qBittorrent can't reach the indexer URL).
      downloadersLogger.info({ url: request.url }, "Downloading torrent file from indexer (fallback)");
      let torrentFileBuffer: Buffer;
      let torrentFileName = "torrent.torrent";
      let parsedInfoHash: string | null = null;

      try {
        const torrentResponse = await fetch(request.url, {
          headers: {
            "User-Agent": "Questarr/1.0",
          },
          signal: AbortSignal.timeout(30000),
        });

        if (!torrentResponse.ok) {
          throw new Error(
            `Failed to download torrent: ${torrentResponse.status} ${torrentResponse.statusText}`
          );
        }

        const contentDisposition = torrentResponse.headers.get("content-disposition");
        if (contentDisposition) {
          const filenameMatch = contentDisposition.match(
            /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/
          );
          if (filenameMatch && filenameMatch[1]) {
            torrentFileName = this.sanitizeMultipartFilename(filenameMatch[1].replace(/['"]/g, ""));
          }
        }

        const arrayBuffer = await torrentResponse.arrayBuffer();
        torrentFileBuffer = Buffer.from(arrayBuffer);

        try {
          const parsed = await parseTorrent(torrentFileBuffer);
          if (parsed?.infoHash) {
            parsedInfoHash = String(parsed.infoHash).toLowerCase();
          }
        } catch {
          // Ignore parsing failures; we can still try to locate it by name/recency.
        }

        downloadersLogger.info(
          { size: torrentFileBuffer.length, filename: torrentFileName, parsedInfoHash },
          "Successfully downloaded torrent file"
        );
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        downloadersLogger.error(
          { error: errorMessage, url: request.url },
          "Failed to download torrent file"
        );
        return {
          success: false,
          message: `Failed to download torrent file: ${errorMessage}`,
        };
      }

      // Build multipart form data for uploading torrent file
      const boundary = `----QuestarboundaryFormData${Date.now()}`;

      const bodyParts: Array<string | Buffer> = [];

      // Add torrents file part
      const safeTorrentFileName = this.sanitizeMultipartFilename(torrentFileName);
      bodyParts.push(`--${boundary}\r\n`);
      bodyParts.push(
        `Content-Disposition: form-data; name="torrents"; filename="${safeTorrentFileName}"\r\n`
      );
      bodyParts.push(`Content-Type: application/x-bittorrent\r\n\r\n`);
      bodyParts.push(torrentFileBuffer);
      bodyParts.push(`\r\n`);

      // Add other form parameters
      const fields: Record<string, string> = {};

      if (savepath) {
        fields.savepath = savepath;
      }

      if (category) {
        fields.category = category;
      }

      fields.paused = pausedValue;

      for (const [key, value] of Object.entries(fields)) {
        bodyParts.push(`--${boundary}\r\n`);
        bodyParts.push(`Content-Disposition: form-data; name="${key}"\r\n\r\n`);
        bodyParts.push(value);
        bodyParts.push(`\r\n`);
      }

      // Final boundary
      bodyParts.push(`--${boundary}--\r\n`);

      // Combine all parts
      const body = Buffer.concat(
        bodyParts.map((p) => (Buffer.isBuffer(p) ? p : Buffer.from(p, "utf-8")))
      );

      downloadersLogger.info(
        {
          filename: torrentFileName,
          fileSize: torrentFileBuffer.length,
          savepath,
          category,
          paused: pausedValue,
          totalBodySize: body.length,
        },
        "Uploading torrent file to qBittorrent"
      );

      const response = await this.makeRequest("POST", "/api/v2/torrents/add", body, {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      });

      const responseText = await response.text();
      downloadersLogger.info(
        {
          responseText,
          responseStatus: response.status,
          responseOk: response.ok,
          responseHeaders: Object.fromEntries(response.headers.entries()),
        },
        "qBittorrent add response"
      );

      if (response.ok && (responseText === "Ok." || responseText === "")) {
        // Prefer hash from the uploaded torrent file, otherwise fall back to hash from URL if present.
        const hash = parsedInfoHash || extractHashFromUrl(request.url);

        if (!hash) {
          const recent = await findRecentlyAddedDownload();
          if (recent) {
            downloadersLogger.info(
              { hash: recent.hash, name: recent.name },
              "Found download hash after adding"
            );
            await maybeSetForceStarted(recent.hash);
            return {
              success: true,
              id: recent.hash,
              message: "Download added successfully",
            };
          }

          downloadersLogger.warn(
            { title: request.title },
            "Could not find matching download after adding"
          );
          return {
            success: true,
            id: request.title || "added",
            message: "Download added but hash could not be verified",
          };
        }

        // For magnet links, we can verify by hash
        // Wait a moment for qBittorrent to register the download
        await new Promise((resolve) => setTimeout(resolve, 500));

        // Verify the download was actually added
        const verifyResponse = await this.makeRequest(
          "GET",
          `/api/v2/torrents/info?hashes=${hash}`
        );
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const downloads = (await verifyResponse.json()) as any[];

        if (downloads && downloads.length > 0) {
          downloadersLogger.info(
            { hash, name: downloads[0].name },
            "Download verified in qBittorrent"
          );

          await maybeSetForceStarted(hash);

          return {
            success: true,
            id: hash,
            message: "Download added successfully",
          };
        } else {
          downloadersLogger.error({ hash }, "Download not found in qBittorrent after adding");
          return {
            success: false,
            message: "Download was not added to qBittorrent (not found after adding)",
          };
        }
      } else if (responseText === "Fails.") {
        downloadersLogger.warn(
          { url: request.url },
          "qBittorrent rejected download (already exists or invalid)"
        );
        // Return success: true for duplicates/failures to prevent fallback mechanism from trying other downloaders
        // "Fails." usually means it's already in the list or invalid metadata
        return {
          success: true,
          message: "Download already exists or invalid download (qBittorrent)",
        };
      } else {
        downloadersLogger.error({ responseText }, "Unexpected response from qBittorrent");
        return {
          success: false,
          message: `Failed to add download: ${responseText}`,
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      downloadersLogger.error({ error: errorMessage }, "Error adding download to qBittorrent");
      return { success: false, message: `Failed to add download: ${errorMessage}` };
    }
  }

  async getDownloadStatus(id: string): Promise<DownloadStatus | null> {
    try {
      await this.authenticate();

      const response = await this.makeRequest("GET", `/api/v2/torrents/info?hashes=${id}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const downloads = (await response.json()) as any[];

      if (downloads && downloads.length > 0) {
        return this.mapQBittorrentStatus(downloads[0]);
      }

      return null;
    } catch (error) {
      console.error("Error getting download status:", error);
      return null;
    }
  }

  async getDownloadDetails(id: string): Promise<DownloadDetails | null> {
    try {
      await this.authenticate();

      // Get torrent info
      const response = await this.makeRequest("GET", `/api/v2/torrents/info?hashes=${id}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const downloads = (await response.json()) as any[];

      if (!downloads || downloads.length === 0) {
        downloadersLogger.warn({ id }, "Download not found in qBittorrent");
        return null;
      }

      const torrent = downloads[0];

      // Get torrent properties for additional details
      const propsResponse = await this.makeRequest(
        "GET",
        `/api/v2/torrents/properties?hash=${id}`
      );
      const props = await propsResponse.json();

      // Get torrent files
      const filesResponse = await this.makeRequest("GET", `/api/v2/torrents/files?hash=${id}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const filesData = (await filesResponse.json()) as any[];

      // Get torrent trackers
      const trackersResponse = await this.makeRequest(
        "GET",
        `/api/v2/torrents/trackers?hash=${id}`
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const trackersData = (await trackersResponse.json()) as any[];

      // Map base status
      const baseStatus = this.mapQBittorrentStatus(torrent);

      // Map files
      const files: DownloadFile[] = filesData.map((file) => {
        let priority: DownloadFile["priority"];
        switch (file.priority) {
          case 0:
            priority = "off";
            break;
          case 6:
          case 7:
            priority = "high";
            break;
          case 1:
          default:
            priority = "normal";
            break;
        }

        return {
          name: file.name,
          size: file.size,
          progress: Math.round(file.progress * 100),
          priority,
          wanted: file.priority > 0,
        };
      });

      // Map trackers
      const trackers: DownloadTracker[] = trackersData
        .filter((t) => t.url && t.url !== "** [DHT] **" && t.url !== "** [PeX] **" && t.url !== "** [LSD] **")
        .map((tracker) => {
          let status: DownloadTracker["status"] = "inactive";
          if (tracker.status === 2) {
            status = "working";
          } else if (tracker.status === 3 || tracker.status === 4) {
            status = "error";
          } else if (tracker.status === 1) {
            status = "updating";
          }

          return {
            url: tracker.url,
            tier: tracker.tier,
            status,
            seeders: tracker.num_seeds >= 0 ? tracker.num_seeds : undefined,
            leechers: tracker.num_leeches >= 0 ? tracker.num_leeches : undefined,
            error: tracker.msg ? tracker.msg : undefined,
          };
        });

      return {
        ...baseStatus,
        hash: torrent.hash,
        downloadDir: torrent.save_path,
        addedDate: props.addition_date > 0 ? new Date(props.addition_date * 1000).toISOString() : undefined,
        completedDate: props.completion_date > 0 ? new Date(props.completion_date * 1000).toISOString() : undefined,
        files,
        trackers,
        totalPeers: props.peers_total || torrent.num_complete + torrent.num_incomplete,
        connectedPeers: props.peers || torrent.num_seeds + torrent.num_leechs,
      };
    } catch (error) {
      downloadersLogger.error({ error, id }, "Error getting download details from qBittorrent");
      return null;
    }
  }

  async getAllDownloads(): Promise<DownloadStatus[]> {
    try {
      await this.authenticate();

      const response = await this.makeRequest("GET", "/api/v2/torrents/info");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const downloads = (await response.json()) as any[];

      if (downloads) {
        return downloads.map((torrent: QBittorrentTorrent) => this.mapQBittorrentStatus(torrent));
      }

      return [];
    } catch (error) {
      console.error("Error getting all downloads:", error);
      return [];
    }
  }

  async pauseDownload(id: string): Promise<{ success: boolean; message: string }> {
    try {
      await this.authenticate();

      const formData = new URLSearchParams();
      formData.append("hashes", id);

      await this.makeRequest("POST", "/api/v2/torrents/pause", formData.toString(), {
        "Content-Type": "application/x-www-form-urlencoded",
      });

      return { success: true, message: "Download paused successfully" };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return { success: false, message: `Failed to pause download: ${errorMessage}` };
    }
  }

  async resumeDownload(id: string): Promise<{ success: boolean; message: string }> {
    try {
      await this.authenticate();

      const formData = new URLSearchParams();
      formData.append("hashes", id);

      await this.makeRequest("POST", "/api/v2/torrents/resume", formData.toString(), {
        "Content-Type": "application/x-www-form-urlencoded",
      });

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

      const formData = new URLSearchParams();
      formData.append("hashes", id);
      formData.append("deleteFiles", deleteFiles.toString());

      await this.makeRequest("POST", "/api/v2/torrents/delete", formData.toString(), {
        "Content-Type": "application/x-www-form-urlencoded",
      });

      return { success: true, message: "Download removed successfully" };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return { success: false, message: `Failed to remove download: ${errorMessage}` };
    }
  }

  async getFreeSpace(): Promise<number> {
    try {
      await this.authenticate();

      const coerceBytes = (value: unknown): number | null => {
        if (value == null) return null;
        const bytes = typeof value === "number" ? value : Number(value);
        if (!Number.isFinite(bytes) || bytes < 0) return null;
        return bytes;
      };

      // Get main preferences to find the default save path.
      // Note: qBittorrent's free space reporting is version-dependent; prefer endpoints designed for disk space.
      let savePath: string | undefined;
      try {
        const prefResponse = await this.makeRequest("GET", "/api/v2/app/preferences");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const prefs = (await prefResponse.json()) as any;
        if (typeof prefs?.save_path === "string") {
          savePath = prefs.save_path;
        }
      } catch (error) {
        downloadersLogger.debug({ error }, "qBittorrent: failed to read preferences for save_path");
      }

      // 1) Newer qBittorrent versions: /api/v2/app/free_space?path=...
      if (savePath) {
        try {
          const freeSpaceResponse = await this.makeRequest(
            "GET",
            `/api/v2/app/free_space?path=${encodeURIComponent(savePath)}`
          );
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const json = (await freeSpaceResponse.json()) as any;
          const bytes = coerceBytes(json?.free_space_on_disk);

          downloadersLogger.debug(
            { savePath, bytes, keys: Object.keys(json ?? {}) },
            "qBittorrent free space (app/free_space)"
          );

          if (bytes !== null) {
            return bytes;
          }
        } catch (error) {
          // If this endpoint isn't supported, fall back.
          downloadersLogger.debug({ error, savePath }, "qBittorrent: app/free_space failed");
        }
      }

      // 2) Common endpoint: /api/v2/sync/maindata?rid=0 -> server_state.free_space_on_disk
      try {
        const maindataResponse = await this.makeRequest("GET", "/api/v2/sync/maindata?rid=0");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const maindata = (await maindataResponse.json()) as any;
        const bytes = coerceBytes(maindata?.server_state?.free_space_on_disk);

        downloadersLogger.debug(
          {
            savePath,
            bytes,
            serverStateKeys: Object.keys(maindata?.server_state ?? {}),
          },
          "qBittorrent free space (sync/maindata)"
        );

        if (bytes !== null) {
          return bytes;
        }
      } catch (error) {
        downloadersLogger.debug({ error }, "qBittorrent: sync/maindata failed");
      }

      // 3) Last resort: some versions include it on /api/v2/transfer/info
      try {
        const transferResponse = await this.makeRequest("GET", "/api/v2/transfer/info");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const transferInfo = (await transferResponse.json()) as any;
        const bytes = coerceBytes(transferInfo?.free_space_on_disk);

        downloadersLogger.debug(
          {
            savePath,
            bytes,
            transferInfoKeys: Object.keys(transferInfo ?? {}),
          },
          "qBittorrent free space (transfer/info fallback)"
        );

        if (bytes !== null) {
          return bytes;
        }
      } catch (error) {
        downloadersLogger.debug({ error }, "qBittorrent: transfer/info failed");
      }

      return 0;
    } catch (error) {
      downloadersLogger.error({ error }, "Error getting free space from qBittorrent");
      return 0;
    }
  }

  private mapQBittorrentStatus(torrent: QBittorrentTorrent): DownloadStatus {
    // qBittorrent state values:
    // uploading, stalledUP, checkingUP, pausedUP, queuedUP, forcedUP - seeding states
    // downloading, stalledDL, checkingDL, pausedDL, queuedDL, forcedDL - downloading states
    // allocating, metaDL, checkingResumeData - downloading states
    // error, missingFiles, unknown - error states
    let status: DownloadStatus["status"];

    switch (torrent.state) {
      case "uploading":
      case "stalledUP":
      case "checkingUP":
      case "forcedUP":
      case "queuedUP":
        status = "seeding";
        break;
      case "pausedUP":
      case "stoppedUP": // Stopped after completing
        status = "completed";
        break;
      case "downloading":
      case "stalledDL":
      case "checkingDL":
      case "forcedDL":
      case "queuedDL":
      case "allocating":
      case "metaDL":
      case "checkingResumeData":
        status = "downloading";
        break;
      case "pausedDL":
        status = "paused";
        break;
      case "error":
      case "missingFiles":
        status = "error";
        break;
      case "unknown":
      default:
        // Unknown state - log it and treat as paused to avoid false errors
        if (torrent.state !== "unknown") {
          downloadersLogger.warn(
            { state: torrent.state, hash: torrent.hash, name: torrent.name },
            "Unknown qBittorrent state encountered"
          );
        }
        status = "paused";
        break;
    }

    // Check if completed based on progress
    if (torrent.progress === 1) {
      if (status === "downloading") {
        status = "seeding"; // It's done downloading, so it must be seeding or completed
      } else if (status === "paused") {
        status = "completed";
      }
    }

    return {
      id: torrent.hash,
      name: torrent.name,
      status,
      progress: Math.round(torrent.progress * 100),
      downloadSpeed: torrent.dlspeed,
      uploadSpeed: torrent.upspeed,
      eta:
        torrent.eta > 0 && torrent.eta < QBittorrentClient.MAX_VALID_ETA_SECONDS
          ? torrent.eta
          : undefined,
      size: torrent.size,
      downloaded: torrent.downloaded,
      seeders: torrent.num_seeds,
      leechers: torrent.num_leechs,
      ratio: torrent.ratio,
      error: torrent.state === "error" ? "Torrent error" : undefined,
      category: torrent.category,
    };
  }

  private sanitizeMultipartFilename(filename: string): string {
    const normalized = filename.replace(/[\r\n]/g, " ");

    const cleaned = Array.from(normalized)
      .filter((char) => {
        const code = char.codePointAt(0);
        return code !== undefined && code >= 0x20 && code !== 0x7f;
      })
      .join("")
      .replace(/["\\]/g, "_")
      .trim();

    return cleaned.length > 0 ? cleaned : "torrent.torrent";
  }

  private async authenticate(force = false): Promise<void> {
    if (this.cookie && !force) {
      return; // Already authenticated
    }

    if (!this.downloader.username || !this.downloader.password) {
      // Try without authentication
      this.cookie = null;
      return;
    }

    const url = this.getBaseUrl() + "/api/v2/auth/login";

    downloadersLogger.debug(
      { url, username: this.downloader.username, force },
      "Attempting qBittorrent authentication"
    );

    const formData = new URLSearchParams();
    formData.append("username", this.downloader.username);
    formData.append("password", this.downloader.password);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "Questarr/1.0",
        },
        body: formData.toString(),
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "No error details available");
        throw new Error(
          `Authentication failed: ${response.status} ${response.statusText} - ${errorText}`
        );
      }

      const responseText = await response.text();
      downloadersLogger.debug({ responseText }, "qBittorrent auth response");

      if (responseText && responseText !== "Ok." && responseText !== "") {
        throw new Error(`Authentication failed: ${responseText}`);
      }

      // Extract ALL cookies from response
      // In Node.js fetch, set-cookie can be retrieved differently
      const setCookieHeaders = response.headers.getSetCookie?.() || [];
      let sidCookie = null;

      // Try the newer getSetCookie() method first (Node 19.7+)
      if (setCookieHeaders.length > 0) {
        for (const cookie of setCookieHeaders) {
          const match = cookie.match(/SID=([^;]+)/);
          if (match) {
            sidCookie = match[1];
            break;
          }
        }
      }

      // Fallback to get("set-cookie") for older Node versions
      if (!sidCookie) {
        const setCookie = response.headers.get("set-cookie");
        if (setCookie) {
          const match = setCookie.match(/SID=([^;]+)/);
          if (match) {
            sidCookie = match[1];
          }
        }
      }

      if (sidCookie) {
        this.cookie = `SID=${sidCookie}`;
        downloadersLogger.debug(
          { cookieLength: this.cookie.length },
          "qBittorrent authentication successful with cookie"
        );
      } else {
        downloadersLogger.warn(
          "qBittorrent authentication returned Ok but no SID cookie found"
        );
        // Some qBittorrent configs don't require cookies, so this might be okay
        this.cookie = null;
      }
    } catch (error) {
      downloadersLogger.error(
        {
          error: error instanceof Error ? { message: error.message, cause: error.cause } : error,
          url,
        },
        "qBittorrent authentication error"
      );
      this.cookie = null;
      throw error;
    }
  }

  private getBaseUrl(): string {
    // Build the complete URL with protocol, host, and port
    let baseUrl = this.downloader.url;

    // Add protocol if not present
    if (!baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) {
      const protocol = this.downloader.useSsl ? "https://" : "http://";
      baseUrl = protocol + baseUrl;
    }

    // Parse URL to handle port correctly
    let urlObj: URL;
    try {
      urlObj = new URL(baseUrl);
    } catch {
      // Fallback for invalid URLs
      urlObj = new URL(`http://${baseUrl}`);
    }

    // Add/Update port if specified
    if (this.downloader.port) {
      urlObj.port = this.downloader.port.toString();
    }

    // Remove trailing slash
    let url = urlObj.toString();
    if (url.endsWith("/")) {
      url = url.slice(0, -1);
    }

    return url;
  }

  private async makeRequest(
    method: string,
    path: string,
    body?: string | Buffer,
    additionalHeaders?: Record<string, string>
  ): Promise<Response> {
    const url = this.getBaseUrl() + path;

    let requestBody: BodyInit | undefined;
    if (method !== "GET" && body !== undefined) {
      requestBody = typeof body === "string" ? body : new Uint8Array(body);
    }

    const headers: Record<string, string> = {
      "User-Agent": "Questarr/1.0",
      ...additionalHeaders,
    };

    if (this.cookie) {
      headers["Cookie"] = this.cookie;
    }

    downloadersLogger.debug(
      { method, path, hasCookie: !!this.cookie, hasAuth: !!(this.downloader.username && this.downloader.password) },
      "Making qBittorrent request"
    );

    let response = await fetch(url, {
      method,
      headers,
      body: requestBody,
      signal: AbortSignal.timeout(30000),
    });

    if (response.status === 403 || response.status === 401) {
      // Session expired or unauthorized, re-authenticate
      downloadersLogger.debug(
        { status: response.status, path },
        "Got 403/401, re-authenticating"
      );
      this.cookie = null;
      await this.authenticate(true);

      // Retry with new cookie
      const retryHeaders = { ...headers };
      if (this.cookie) {
        retryHeaders["Cookie"] = this.cookie;
      }

      response = await fetch(url, {
        method,
        headers: retryHeaders,
        body: requestBody,
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "No error details available");
        downloadersLogger.error(
          { status: response.status, statusText: response.statusText, errorText, path },
          "qBittorrent request failed after re-authentication"
        );
        throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText}`);
      }
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => "No error details available");
      throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText}`);
    }

    return response;
  }
}

export class DownloaderManager {
  static createClient(downloader: Downloader): DownloaderClient {
    switch (downloader.type) {
      case "transmission":
        return new TransmissionClient(downloader);
      case "rtorrent":
        return new RTorrentClient(downloader);
      case "qbittorrent":
        return new QBittorrentClient(downloader);
      case "sabnzbd":
        return new SABnzbdClient(downloader);
      case "nzbget":
        return new NZBGetClient(downloader);
      default:
        throw new Error(`Unsupported downloader type: ${downloader.type}`);
    }
  }

  static async testDownloader(
    downloader: Downloader
  ): Promise<{ success: boolean; message: string }> {
    try {
      const client = this.createClient(downloader);
      return await client.testConnection();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return { success: false, message: errorMessage };
    }
  }

  static async addDownload(
    downloader: Downloader,
    request: DownloadRequest
  ): Promise<{ success: boolean; id?: string; message: string }> {
    try {
      const client = this.createClient(downloader);
      return await client.addDownload(request);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return { success: false, message: errorMessage };
    }
  }

  static async getAllDownloads(downloader: Downloader): Promise<DownloadStatus[]> {
    const client = this.createClient(downloader);
    const downloads = await client.getAllDownloads();

    // Filter by configured category if set
    if (downloader.category) {
      const filterCategory = downloader.category.toLowerCase();
      return downloads.filter((t) => {
        // Strict category match if available
        if (t.category) {
          return t.category.toLowerCase() === filterCategory;
        }

        // If category is missing in the download status:
        // For clients that support categories (rTorrent, qBittorrent, Usenet), missing category means "Uncategorized",
        // so we exclude it if a filter is active.
        // For Transmission, we haven't implemented category mapping yet, so we include everything to avoid hiding all downloads.
        if (downloader.type === "transmission") {
          return true;
        }

        return false;
      });
    }

    return downloads;
  }

  static async getDownloadStatus(
    downloader: Downloader,
    id: string
  ): Promise<DownloadStatus | null> {
    try {
      const client = this.createClient(downloader);
      return await client.getDownloadStatus(id);
    } catch (error) {
      downloadersLogger.error({ error }, "error getting download status");
      return null;
    }
  }

  static async getDownloadDetails(
    downloader: Downloader,
    id: string
  ): Promise<DownloadDetails | null> {
    try {
      const client = this.createClient(downloader);
      return await client.getDownloadDetails(id);
    } catch (error) {
      console.error("Error getting download details:", error);
      return null;
    }
  }

  static async pauseDownload(
    downloader: Downloader,
    id: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      const client = this.createClient(downloader);
      return await client.pauseDownload(id);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return { success: false, message: errorMessage };
    }
  }

  static async resumeDownload(
    downloader: Downloader,
    id: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      const client = this.createClient(downloader);
      return await client.resumeDownload(id);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return { success: false, message: errorMessage };
    }
  }

  static async removeDownload(
    downloader: Downloader,
    id: string,
    deleteFiles = false
  ): Promise<{ success: boolean; message: string }> {
    try {
      const client = this.createClient(downloader);
      return await client.removeDownload(id, deleteFiles);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return { success: false, message: errorMessage };
    }
  }

  static async getFreeSpace(downloader: Downloader): Promise<number> {
    try {
      const client = this.createClient(downloader);
      return await client.getFreeSpace();
    } catch (error) {
      downloadersLogger.error({ error, downloaderId: downloader.id }, "Error getting free space");
      return 0;
    }
  }

  static async addDownloadWithFallback(
    downloaders: Downloader[],
    request: DownloadRequest
  ): Promise<{
    success: boolean;
    id?: string;
    message?: string;
    downloaderId?: string;
    downloaderName?: string;
    attemptedDownloaders: string[];
  }> {
    if (downloaders.length === 0) {
      return {
        success: false,
        message: "No downloaders available",
        attemptedDownloaders: [],
      };
    }

    const attemptedDownloaders: string[] = [];
    const errors: string[] = [];

    // Filter downloaders by compatibility if downloadType is specified
    let compatibleDownloaders = downloaders;
    if (request.downloadType === "usenet") {
      compatibleDownloaders = downloaders.filter((d) => ["sabnzbd", "nzbget"].includes(d.type));
    } else if (request.downloadType === "torrent") {
      compatibleDownloaders = downloaders.filter((d) =>
        ["transmission", "rtorrent", "qbittorrent"].includes(d.type)
      );
    }

    if (compatibleDownloaders.length === 0) {
      return {
        success: false,
        message: `No compatible downloaders found for type: ${request.downloadType || "unknown"}`,
        attemptedDownloaders: [],
      };
    }

    for (const downloader of compatibleDownloaders) {
      attemptedDownloaders.push(downloader.name);

      try {
        const result = await this.addDownload(downloader, request);

        if (result.success) {
          return {
            ...result,
            downloaderId: downloader.id,
            downloaderName: downloader.name,
            attemptedDownloaders,
          };
        } else {
          errors.push(`${downloader.name}: ${result.message}`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        errors.push(`${downloader.name}: ${errorMessage}`);
      }
    }

    // All downloaders failed
    return {
      success: false,
      message: `All downloaders failed. Errors: ${errors.join("; ")}`,
      attemptedDownloaders,
    };
  }
}

// ==================== SABnzbd Client ====================

interface SABnzbdQueue {
  slots: Array<{
    nzo_id: string;
    filename: string;
    status: string;
    percentage: string;
    mb: string;
    mbleft: string;
    mbmissing: string;
    size: string;
    sizeleft: string;
    timeleft: string;
    eta: string;
    cat: string;
    priority: string;
    script: string;
    avg_age: string;
  }>;
  speed: string;
  size: string;
  sizeleft: string;
  mb: string;
  mbleft: string;
  noofslots: number;
  status: string;
  timeleft: string;
}

interface SABnzbdHistory {
  slots: Array<{
    nzo_id: string;
    name: string;
    status: string;
    fail_message: string;
    path: string;
    size: string;
    bytes: number;
    category: string;
    download_time: number;
    completed: number;
    action_line: string;
    stage_log: Array<{
      name: string;
      actions: string[];
    }>;
  }>;
}

class SABnzbdClient implements DownloaderClient {
  private downloader: Downloader;

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
      return urlObj.toString().replace(/\/$/, "");
    } catch {
      return baseUrl.replace(/\/$/, "");
    }
  }

  private getApiUrl(mode: string, params: Record<string, string> = {}): string {
    const baseUrl = this.getBaseUrl();
    const url = new URL(`${baseUrl}/api`);
    url.searchParams.set("apikey", this.downloader.username || "");
    url.searchParams.set("mode", mode);
    url.searchParams.set("output", "json");

    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    return url.toString();
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    const url = this.getApiUrl("version");
    try {
      downloadersLogger.debug({ url }, "Testing SABnzbd connection");
      const response = await fetch(url, { signal: AbortSignal.timeout(10000) });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "No error details");
        return {
          success: false,
          message: `HTTP ${response.status}: ${response.statusText} - ${errorText}`,
        };
      }

      const data = await response.json();
      if (data.version) {
        return { success: true, message: `Connected to SABnzbd v${data.version}` };
      }

      return { success: false, message: "Invalid SABnzbd response - missing version field" };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      downloadersLogger.error({ error, url }, "SABnzbd connection test failed");
      return {
        success: false,
        message: `Failed to connect to SABnzbd at ${url}: ${errorMessage}`,
      };
    }
  }

  async addDownload(
    request: DownloadRequest
  ): Promise<{ success: boolean; id?: string; message: string }> {
    const url = this.getApiUrl("addurl", {
      name: request.url,
      nzbname: request.title,
      cat: request.category || "games",
      priority: (request.priority || 0).toString(),
    });

    try {
      const response = await fetch(url, { method: "GET", signal: AbortSignal.timeout(30000) });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "No error details");
        return { success: false, message: `HTTP ${response.status}: ${errorText}` };
      }

      const data = await response.json();

      if (data.status === true) {
        if (data.nzo_ids && data.nzo_ids.length > 0) {
          return {
            success: true,
            id: data.nzo_ids[0],
            message: "NZB added successfully",
          };
        } else {
          // Status true but no ID usually means duplicate in SABnzbd (or merged)
          return {
            success: true,
            message: "NZB added successfully (likely duplicate or merged)",
          };
        }
      }

      // Check for specific duplicate error
      if (
        data.error &&
        typeof data.error === "string" &&
        data.error.toLowerCase().includes("duplicate")
      ) {
        return {
          success: true,
          message: `NZB already exists: ${data.error}`,
        };
      }

      return {
        success: false,
        message: data.error || "Failed to add NZB - SABnzbd returned success:false",
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        message: `Failed to add NZB to SABnzbd: ${errorMessage}`,
      };
    }
  }

  async getDownloadStatus(id: string): Promise<DownloadStatus | null> {
    try {
      const url = this.getApiUrl("queue");
      const response = await fetch(url);
      const data = await response.json();
      const queue: SABnzbdQueue = data.queue;

      const item = queue.slots.find((slot) => slot.nzo_id === id);
      if (!item) {
        // Check history if not in queue
        return await this.getFromHistory(id);
      }

      const progress = parseFloat(item.percentage) || 0;
      const totalMB = parseFloat(item.mb) || 0;
      const leftMB = parseFloat(item.mbleft) || 0;
      const downloadedMB = totalMB - leftMB;

      // Parse ETA (format: "HH:MM:SS" or "00:00:00" or "unknown")
      let eta: number | undefined;
      if (item.timeleft && item.timeleft !== "0:00:00" && item.timeleft !== "unknown") {
        const [hours, minutes, seconds] = item.timeleft.split(":").map(Number);
        eta = hours * 3600 + minutes * 60 + seconds;
      }

      // Map SABnzbd status to our status
      let status: DownloadStatus["status"];
      let repairStatus: DownloadStatus["repairStatus"];
      let unpackStatus: DownloadStatus["unpackStatus"];

      switch (item.status.toLowerCase()) {
        case "downloading":
        case "fetching":
          status = "downloading";
          break;
        case "paused":
          status = "paused";
          break;
        case "repairing":
          status = "repairing";
          repairStatus = "repairing";
          break;
        case "extracting":
        case "unpacking":
          status = "unpacking";
          unpackStatus = "unpacking";
          break;
        case "completed":
          status = "completed";
          repairStatus = "good";
          unpackStatus = "completed";
          break;
        case "failed":
          status = "error";
          repairStatus = "failed";
          break;
        default:
          status = "downloading";
      }

      return {
        id: item.nzo_id,
        name: item.filename,
        downloadType: "usenet",
        status,
        progress,
        downloadSpeed: (parseFloat(queue.speed) || 0) * 1024 * 1024, // Convert MB/s to bytes/s
        eta,
        size: totalMB * 1024 * 1024, // Convert MB to bytes
        downloaded: downloadedMB * 1024 * 1024,
        category: item.cat,
        repairStatus,
        unpackStatus,
        age: parseFloat(item.avg_age) || undefined,
      };
    } catch (error) {
      downloadersLogger.error({ error }, "Failed to get SABnzbd status");
      return null;
    }
  }

  private async getFromHistory(id: string): Promise<DownloadStatus | null> {
    try {
      const url = this.getApiUrl("history");
      const response = await fetch(url);
      const data = await response.json();
      const history: SABnzbdHistory = data.history;

      const item = history.slots.find((slot) => slot.nzo_id === id);
      if (!item) {
        return null;
      }

      let status: DownloadStatus["status"];
      let repairStatus: DownloadStatus["repairStatus"];
      let unpackStatus: DownloadStatus["unpackStatus"];

      if (item.status === "Completed") {
        status = "completed";
        repairStatus = "good";
        unpackStatus = "completed";
      } else if (item.status === "Failed") {
        status = "error";
        repairStatus = "failed";
      } else {
        status = "paused";
      }

      return {
        id: item.nzo_id,
        name: item.name,
        downloadType: "usenet",
        status,
        progress: status === "completed" ? 100 : 0,
        size: item.bytes,
        downloaded: item.bytes,
        category: item.category,
        error: status === "error" ? item.fail_message : undefined,
        repairStatus,
        unpackStatus,
      };
    } catch (error) {
      downloadersLogger.error({ error }, "Failed to get SABnzbd history");
      return null;
    }
  }

  async getDownloadDetails(id: string): Promise<DownloadDetails | null> {
    const status = await this.getDownloadStatus(id);
    if (!status) return null;

    // SABnzbd doesn't provide detailed file information in the same way
    // Return minimal details based on status
    return {
      ...status,
      files: [],
      trackers: [],
    };
  }

  async getAllDownloads(): Promise<DownloadStatus[]> {
    try {
      const url = this.getApiUrl("queue");
      const response = await fetch(url);
      const data = await response.json();
      const queue: SABnzbdQueue = data.queue;

      const results: DownloadStatus[] = [];

      for (const item of queue.slots) {
        const status = await this.getDownloadStatus(item.nzo_id);
        if (status) {
          results.push(status);
        }
      }

      return results;
    } catch (error) {
      downloadersLogger.error({ error }, "Failed to get SABnzbd queue");
      return [];
    }
  }

  async pauseDownload(id: string): Promise<{ success: boolean; message: string }> {
    try {
      const url = this.getApiUrl("pause", { value: id });
      const response = await fetch(url);
      const data = await response.json();

      if (data.status === true) {
        return { success: true, message: "NZB paused" };
      }

      return { success: false, message: "Failed to pause NZB" };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async resumeDownload(id: string): Promise<{ success: boolean; message: string }> {
    try {
      const url = this.getApiUrl("resume", { value: id });
      const response = await fetch(url);
      const data = await response.json();

      if (data.status === true) {
        return { success: true, message: "NZB resumed" };
      }

      return { success: false, message: "Failed to resume NZB" };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async removeDownload(
    id: string,
    _deleteFiles?: boolean
  ): Promise<{ success: boolean; message: string }> {
    try {
      const url = this.getApiUrl("queue", { name: "delete", value: id });
      const response = await fetch(url);
      const data = await response.json();

      if (data.status === true) {
        return { success: true, message: "NZB removed" };
      }

      return { success: false, message: "Failed to remove NZB" };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async getFreeSpace(): Promise<number> {
    try {
      const url = this.getApiUrl("queue");
      const response = await fetch(url);
      const data = await response.json();

      if (data.queue?.diskspace1_norm) {
        // Parse disk space (format: "123.45 GB")
        const match = data.queue.diskspace1_norm.match(/([0-9.]+)\s*([KMGT]?B)/i);
        if (match) {
          const value = parseFloat(match[1]);
          const unit = match[2].toUpperCase();

          const multipliers: Record<string, number> = {
            B: 1,
            KB: 1024,
            MB: 1024 * 1024,
            GB: 1024 * 1024 * 1024,
            TB: 1024 * 1024 * 1024 * 1024,
          };

          return value * (multipliers[unit] || 1);
        }
      }

      return 0;
    } catch (error) {
      downloadersLogger.error({ error }, "Failed to get SABnzbd free space");
      return 0;
    }
  }
}

// ==================== NZBGet Client ====================

interface NZBGetListResult {
  NZBID: number;
  NZBName: string;
  Status: string;
  FileSizeMB: number;
  RemainingSizeMB: number;
  DownloadedSizeMB: number;
  Category: string;
  DownloadRate: number;
  PostInfoText: string;
  PostStageProgress: number;
  PostStageTimeSec: number;
}

interface NZBGetHistoryResult {
  NZBID: number;
  Name: string;
  Status: string;
  FileSizeMB: number;
  Category: string;
  DownloadTimeSec: number;
  ParStatus: string; // "SUCCESS", "FAILURE", "REPAIR_POSSIBLE", "MANUAL", "NONE"
  UnpackStatus: string; // "SUCCESS", "FAILURE", "NONE"
  FailedArticles: number;
  DeleteStatus: string;
  DestDir: string;
}

class NZBGetClient implements DownloaderClient {
  private downloader: Downloader;

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
      return urlObj.toString().replace(/\/$/, "");
    } catch {
      return baseUrl.replace(/\/$/, "");
    }
  }

  private escapeXml(str: string): string {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  private buildXMLValue(param: unknown): string {
    if (typeof param === "boolean") {
      return `<boolean>${param ? 1 : 0}</boolean>`;
    } else if (typeof param === "number") {
      if (Number.isInteger(param)) {
        return `<int>${param}</int>`;
      }
      return `<double>${param}</double>`;
    } else if (typeof param === "string") {
      return `<string>${this.escapeXml(param)}</string>`;
    } else if (Array.isArray(param)) {
      const data = param.map((p) => `<value>${this.buildXMLValue(p)}</value>`).join("");
      return `<array><data>${data}</data></array>`;
    } else if (typeof param === "object" && param !== null) {
      const members = Object.entries(param)
        .map(
          ([k, v]) =>
            `<member><name>${this.escapeXml(k)}</name><value>${this.buildXMLValue(v)}</value></member>`
        )
        .join("");
      return `<struct>${members}</struct>`;
    }
    return "";
  }

  private parseValueObj(valueObj: unknown): unknown {
    if (typeof valueObj !== "object" || valueObj === null) {
      return valueObj;
    }

    // Unwrap array if it's a value array from fast-xml-parser (due to isArray config)
    let obj = valueObj;
    if (Array.isArray(obj)) {
      obj = obj[0];
      if (typeof obj !== "object" || obj === null) {
        return obj;
      }
    }

    const rec = obj as Record<string, unknown>;

    // With parseTagValue: false and textNodeName: "_text", values might be wrapped
    const getValue = (v: unknown) =>
      v && typeof v === "object" && "_text" in v ? (v as Record<string, unknown>)._text : v;

    if ("string" in rec) return getValue(rec.string);
    if ("int" in rec) return parseInt(getValue(rec.int) as string);
    if ("i4" in rec) return parseInt(getValue(rec.i4) as string);
    if ("boolean" in rec) {
      const boolVal = getValue(rec.boolean);
      return boolVal == 1 || boolVal === "1";
    }
    if ("double" in rec) return parseFloat(getValue(rec.double) as string);
    if ("base64" in rec) return getValue(rec.base64);

    if ("array" in rec) {
      const arrayObj = rec["array"] as Record<string, unknown>;
      const data = arrayObj["data"];
      if (!data) return [];

      const dataBlock = Array.isArray(data) ? data[0] : data;

      if (!dataBlock || typeof dataBlock !== "object" || !("value" in dataBlock)) return [];

      const values = Array.isArray((dataBlock as Record<string, unknown>).value)
        ? (dataBlock as Record<string, unknown>).value
        : [(dataBlock as Record<string, unknown>).value];
      return (values as unknown[]).map((v: unknown) => this.parseValueObj(v));
    }

    if ("struct" in rec) {
      const structObj = rec["struct"] as Record<string, unknown>;
      const members = structObj["member"] as Record<string, unknown>[];
      if (!members) return {};

      const result: Record<string, unknown> = {};
      for (const m of members) {
        if (m["name"] && m["value"]) {
          result[getValue(m["name"]) as string] = this.parseValueObj(m["value"]);
        }
      }
      return result;
    }

    // Handle direct value text if none of the above matched (e.g. <value>string</value> without <string> tag?)
    // XML-RPC spec says <value> without type is string.
    if ("_text" in rec) return rec._text;

    // Fallback
    return String(Object.values(rec)[0]);
  }

  private async makeXMLRPCRequest(method: string, params: unknown[] = []): Promise<unknown> {
    const baseUrl = this.getBaseUrl();
    const path = this.downloader.urlPath || "xmlrpc";
    const url = `${baseUrl}/${path.replace(/^\//, "")}`;

    const xmlParams = params
      .map((param) => `<param><value>${this.buildXMLValue(param)}</value></param>`)
      .join("");

    const xmlBody = `<?xml version="1.0"?>
<methodCall>
  <methodName>${this.escapeXml(method)}</methodName>
  <params>
    ${xmlParams}
  </params>
</methodCall>`;

    const headers: Record<string, string> = {
      "Content-Type": "text/xml",
      "User-Agent": "Questarr/1.0",
    };

    if (this.downloader.username && this.downloader.password) {
      const auth = Buffer.from(
        `${this.downloader.username}:${this.downloader.password}`,
        "latin1"
      ).toString("base64");
      headers["Authorization"] = `Basic ${auth}`;
    }

    const logParams =
      method === "append" && params.length > 1
        ? [params[0], "<base64_content_truncated>", ...params.slice(2)]
        : params;

    downloadersLogger.debug({ url, method, params: logParams }, "Making NZBGet XML-RPC request");

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: xmlBody,
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "No error details");
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const responseText = await response.text();

    const parser = new XMLParser({
      ignoreAttributes: true,
      parseTagValue: false,
      textNodeName: "_text",
      isArray: (name) => {
        return ["member", "data", "value", "param"].includes(name);
      },
    });

    const parsed = parser.parse(responseText);

    if (parsed.methodResponse?.fault) {
      const fault = this.parseValueObj(parsed.methodResponse.fault.value) as Record<string, unknown>;
      throw new Error(`NZBGet Fault: ${fault["faultString"] as string} (${fault["faultCode"] as number})`);
    }

    if (parsed.methodResponse?.params?.param) {
      const params = parsed.methodResponse.params.param;
      const param = Array.isArray(params) ? params[0] : params;

      if (param && param.value) {
        return this.parseValueObj(param.value);
      }
    }

    return null;
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      const version = await this.makeXMLRPCRequest("version");
      return { success: true, message: `Connected to NZBGet v${version}` };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      const baseUrl = this.getBaseUrl();
      downloadersLogger.error({ error, url: baseUrl }, "NZBGet connection test failed");
      return {
        success: false,
        message: `Failed to connect to NZBGet at ${baseUrl}: ${errorMessage}`,
      };
    }
  }

  async addDownload(
    request: DownloadRequest
  ): Promise<{ success: boolean; id?: string; message: string }> {
    try {
      const nzbResponse = await fetch(request.url);
      if (!nzbResponse.ok) {
        return { success: false, message: `Failed to fetch NZB: ${nzbResponse.statusText}` };
      }

      const nzbContent = await nzbResponse.text();
      const base64Content = Buffer.from(nzbContent).toString("base64");

      const nzbId = (await this.makeXMLRPCRequest("append", [
        request.title || "download.nzb",
        base64Content,
        request.category || "",
        request.priority || 0,
        false, // AddToTop
        false, // AddPaused
        "", // DupeKey
        0, // DupeScore
        "SCORE", // DupeMode
        [], // PPParameters
      ])) as number;

      if (nzbId > 0) {
        return {
          success: true,
          id: nzbId.toString(),
          message: "NZB added successfully",
        };
      }

      return { success: false, message: "Failed to add NZB (ID is 0 or negative)" };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async getDownloadStatus(id: string): Promise<DownloadStatus | null> {
    try {
      const queue = (await this.makeXMLRPCRequest("listgroups")) as NZBGetListResult[];
      const item = queue.find((q) => q.NZBID.toString() === id);

      if (!item) {
        // Check history
        return await this.getFromHistory(id);
      }

      const progress =
        item.FileSizeMB > 0
          ? ((item.FileSizeMB - item.RemainingSizeMB) / item.FileSizeMB) * 100
          : 0;

      // Calculate ETA
      let eta: number | undefined;
      if (item.DownloadRate > 0 && item.RemainingSizeMB > 0) {
        eta = (item.RemainingSizeMB * 1024 * 1024) / item.DownloadRate;
      }

      // Map NZBGet status
      let status: DownloadStatus["status"];
      let repairStatus: DownloadStatus["repairStatus"];
      let unpackStatus: DownloadStatus["unpackStatus"];

      switch (item.Status) {
        case "DOWNLOADING":
        case "FETCHING":
          status = "downloading";
          break;
        case "PAUSED":
          status = "paused";
          break;
        case "POST_PROCESSING":
          if (item.PostInfoText.includes("Repairing")) {
            status = "repairing";
            repairStatus = "repairing";
          } else if (
            item.PostInfoText.includes("Unpacking") ||
            item.PostInfoText.includes("Extracting")
          ) {
            status = "unpacking";
            unpackStatus = "unpacking";
          } else {
            status = "downloading";
          }
          break;
        default:
          status = "downloading";
      }

      return {
        id: item.NZBID.toString(),
        name: item.NZBName,
        downloadType: "usenet",
        status,
        progress,
        downloadSpeed: item.DownloadRate,
        eta,
        size: item.FileSizeMB * 1024 * 1024,
        downloaded: item.DownloadedSizeMB * 1024 * 1024,
        category: item.Category,
        repairStatus,
        unpackStatus,
      };
    } catch (error) {
      downloadersLogger.error({ error }, "Failed to get NZBGet status");
      return null;
    }
  }

  private async getFromHistory(id: string): Promise<DownloadStatus | null> {
    try {
      const history = (await this.makeXMLRPCRequest("history")) as NZBGetHistoryResult[];
      const item = history.find((h) => h.NZBID.toString() === id);

      if (!item) {
        return null;
      }

      let status: DownloadStatus["status"];
      let repairStatus: DownloadStatus["repairStatus"];
      let unpackStatus: DownloadStatus["unpackStatus"];

      if (item.Status === "SUCCESS/ALL") {
        status = "completed";
        repairStatus =
          item.ParStatus === "SUCCESS" || item.ParStatus === "NONE" ? "good" : "failed";
        unpackStatus =
          item.UnpackStatus === "SUCCESS" || item.UnpackStatus === "NONE" ? "completed" : "failed";
      } else {
        status = "error";
        repairStatus = item.ParStatus === "FAILURE" ? "failed" : "good";
        unpackStatus = item.UnpackStatus === "FAILURE" ? "failed" : "completed";
      }

      return {
        id: item.NZBID.toString(),
        name: item.Name,
        downloadType: "usenet",
        status,
        progress: status === "completed" ? 100 : 0,
        size: item.FileSizeMB * 1024 * 1024,
        downloaded: item.FileSizeMB * 1024 * 1024,
        category: item.Category,
        repairStatus,
        unpackStatus,
      };
    } catch (error) {
      downloadersLogger.error({ error }, "Failed to get NZBGet history");
      return null;
    }
  }

  async getDownloadDetails(id: string): Promise<DownloadDetails | null> {
    const status = await this.getDownloadStatus(id);
    if (!status) return null;

    // NZBGet doesn't provide detailed file information easily
    return {
      ...status,
      files: [],
      trackers: [],
    };
  }

  async getAllDownloads(): Promise<DownloadStatus[]> {
    try {
      const queue = (await this.makeXMLRPCRequest("listgroups")) as NZBGetListResult[];
      const results: DownloadStatus[] = [];

      for (const item of queue) {
        const status = await this.getDownloadStatus(item.NZBID.toString());
        if (status) {
          results.push(status);
        }
      }

      return results;
    } catch (error) {
      downloadersLogger.error({ error }, "Failed to get NZBGet queue");
      return [];
    }
  }

  async pauseDownload(id: string): Promise<{ success: boolean; message: string }> {
    try {
      await this.makeXMLRPCRequest("editqueue", ["GroupPause", 0, "", [parseInt(id)]]);
      return { success: true, message: "NZB paused" };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async resumeDownload(id: string): Promise<{ success: boolean; message: string }> {
    try {
      await this.makeXMLRPCRequest("editqueue", ["GroupResume", 0, "", [parseInt(id)]]);
      return { success: true, message: "NZB resumed" };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async removeDownload(
    id: string,
    _deleteFiles?: boolean
  ): Promise<{ success: boolean; message: string }> {
    try {
      await this.makeXMLRPCRequest("editqueue", ["GroupDelete", 0, "", [parseInt(id)]]);
      return { success: true, message: "NZB removed" };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async getFreeSpace(): Promise<number> {
    try {
      const status = (await this.makeXMLRPCRequest("status")) as { FreeDiskSpaceMB: number };
      return status.FreeDiskSpaceMB * 1024 * 1024; // Convert MB to bytes
    } catch (error) {
      downloadersLogger.error({ error }, "Failed to get NZBGet free space");
      return 0;
    }
  }
}

export { DownloadRequest, DownloaderClient };
