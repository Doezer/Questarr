import type {
  Downloader,
  DownloadStatus,
  TorrentFile,
  TorrentTracker,
  TorrentDetails,
} from "../shared/schema.js";
import { downloadersLogger } from "./logger.js";
import crypto from "crypto";
import parseTorrent from "parse-torrent";

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
}

interface DownloaderClient {
  testConnection(): Promise<{ success: boolean; message: string }>;
  addTorrent(request: DownloadRequest): Promise<{ success: boolean; id?: string; message: string }>;
  getTorrentStatus(id: string): Promise<DownloadStatus | null>;
  getTorrentDetails(id: string): Promise<TorrentDetails | null>;
  getAllTorrents(): Promise<DownloadStatus[]>;
  pauseTorrent(id: string): Promise<{ success: boolean; message: string }>;
  resumeTorrent(id: string): Promise<{ success: boolean; message: string }>;
  removeTorrent(id: string, deleteFiles?: boolean): Promise<{ success: boolean; message: string }>;
  getFreeSpace(): Promise<number>;
}

class TransmissionClient implements DownloaderClient {
  private downloader: Downloader;
  private sessionId: string | null = null;

  constructor(downloader: Downloader) {
    this.downloader = downloader;
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      const _response = await this.makeRequest("session-get", {});
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

  async addTorrent(
    request: DownloadRequest
  ): Promise<{ success: boolean; id?: string; message: string }> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const args: any = {
        filename: request.url,
      };

      if (request.downloadPath || this.downloader.downloadPath) {
        args["download-dir"] = request.downloadPath || this.downloader.downloadPath;
      }

      if (request.priority) {
        args["priority-high"] = request.priority > 3;
        args["priority-low"] = request.priority < 2;
      }

      const response = await this.makeRequest("torrent-add", args);

      if (response.arguments["torrent-added"]) {
        const torrent = response.arguments["torrent-added"];
        return {
          success: true,
          id: torrent.id?.toString(),
          message: "Torrent added successfully",
        };
      } else if (response.arguments["torrent-duplicate"]) {
        return {
          success: false,
          message: "Torrent already exists",
        };
      } else {
        return {
          success: false,
          message: "Failed to add torrent",
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return { success: false, message: `Failed to add torrent: ${errorMessage}` };
    }
  }

  async getTorrentStatus(id: string): Promise<DownloadStatus | null> {
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
      downloadersLogger.error({ error }, "error getting torrent status (transmission)");
      return null;
    }
  }

  async getTorrentDetails(id: string): Promise<TorrentDetails | null> {
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
      console.error("Error getting torrent details:", error);
      return null;
    }
  }

  async getAllTorrents(): Promise<DownloadStatus[]> {
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
        "hashString", // Required for matching torrents by hash
      ],
    });

    if (response.arguments.torrents) {
      return response.arguments.torrents.map((torrent: TransmissionTorrent) =>
        this.mapTransmissionStatus(torrent)
      );
    }

    return [];
  }

  async pauseTorrent(id: string): Promise<{ success: boolean; message: string }> {
    try {
      await this.makeRequest("torrent-stop", { ids: [parseInt(id)] });
      return { success: true, message: "Torrent paused successfully" };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return { success: false, message: `Failed to pause torrent: ${errorMessage}` };
    }
  }

  async resumeTorrent(id: string): Promise<{ success: boolean; message: string }> {
    try {
      await this.makeRequest("torrent-start", { ids: [parseInt(id)] });
      return { success: true, message: "Torrent resumed successfully" };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return { success: false, message: `Failed to resume torrent: ${errorMessage}` };
    }
  }

  async removeTorrent(
    id: string,
    deleteFiles = false
  ): Promise<{ success: boolean; message: string }> {
    try {
      await this.makeRequest("torrent-remove", {
        ids: [parseInt(id)],
        "delete-local-data": deleteFiles,
      });
      return { success: true, message: "Torrent removed successfully" };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return { success: false, message: `Failed to remove torrent: ${errorMessage}` };
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

    switch (torrent.status) {
      case 0:
        status = "paused";
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

    if (torrent.percentDone === 1) {
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
      progress: Math.round(torrent.percentDone * 100),
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

  private mapTransmissionDetails(torrent: TransmissionTorrent): TorrentDetails {
    // Get base status first
    const baseStatus = this.mapTransmissionStatus(torrent);

    // Map files
    const files: TorrentFile[] = [];
    if (torrent.files && torrent.fileStats) {
      for (let i = 0; i < torrent.files.length; i++) {
        const file = torrent.files[i];
        const stats = torrent.fileStats[i];

        // Transmission priority: -1=low, 0=normal, 1=high
        // If file is not wanted, mark as 'off'
        let priority: TorrentFile["priority"] = "normal";
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
    const trackers: TorrentTracker[] = [];
    if (torrent.trackerStats) {
      for (const tracker of torrent.trackerStats) {
        // Transmission tracker status: 0=inactive, 1=waiting, 2=queued, 3=active
        let trackerStatus: TorrentTracker["status"] = "inactive";
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
    const url = this.downloader.url.endsWith("/") ? this.downloader.url : this.downloader.url + "/";

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

  async addTorrent(
    request: DownloadRequest
  ): Promise<{ success: boolean; id?: string; message: string }> {
    try {
      if (!request.url) {
        return {
          success: false,
          message: "Torrent URL is required",
        };
      }

      // Helper to fetch with standard headers
      const fetchTorrent = async (url: string) => {
        downloadersLogger.debug({ url }, "Downloading torrent file locally");
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
          "Failed to download torrent file from indexer"
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
                  message: `Failed to download torrent file (retry without file param failed): ${response.statusText}`,
                };
              }
            } else {
              return {
                success: false,
                message: `Failed to download torrent file (retry failed): ${response.statusText}`,
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
                message: `Failed to download torrent file (retry without file param failed): ${response.statusText}`,
              };
            }
          } else {
            return {
              success: false,
              message: `Failed to download torrent file from indexer: ${response.statusText}`,
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
      } catch (_e) {
        downloadersLogger.warn({ error: _e }, "Failed to parse torrent file for hash");
      }

      // 3. Send raw file to rTorrent
      // Determine which method to use based on addStopped setting
      const addMethod = this.downloader.addStopped ? "load.raw" : "load.raw_start";

      downloadersLogger.debug(
        { method: addMethod, size: buffer.length, hash: infoHash },
        "Uploading raw torrent to rTorrent"
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
            // Give rTorrent a moment to register the torrent before setting properties
            // though with XML-RPC it should be sequential
            await this.makeXMLRPCRequest("d.custom1.set", [infoHash, category]);
          } catch (error) {
            downloadersLogger.warn(
              { error, hash: infoHash, category },
              "Failed to set category on torrent"
            );
          }
        }

        return {
          success: true,
          id: infoHash,
          message: `Torrent added successfully${this.downloader.addStopped ? " (stopped)" : ""}`,
        };
      } else {
        // Check if result is 0 (success) even if type check failed or something else
        // Some rTorrent versions might return empty string or other success indicators
        // But standard XML-RPC returns 0 for success on load commands
        return {
          success: false,
          message: `Failed to add torrent (rTorrent returned code: ${result})`,
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      downloadersLogger.error({ error, url: request.url }, "Failed to add torrent");
      return { success: false, message: `Failed to add torrent: ${errorMessage}` };
    }
  }

  async getTorrentStatus(id: string): Promise<DownloadStatus | null> {
    try {
      // Get detailed information about a specific torrent using multicall
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

      // Filter for the specific ID since d.multicall2 returns all torrents in the view
      if (result && result.length > 0) {
        const torrent = result.find((t: unknown[]) => (t as string[])[0].toLowerCase() === id.toLowerCase());
        if (torrent) {
          return this.mapRTorrentStatus(torrent);
        }
      }

      return null;
    } catch (error) {
      downloadersLogger.error({ error }, "error getting torrent status (rtorrent)");
      return null;
    }
  }

  async getTorrentDetails(id: string): Promise<TorrentDetails | null> {
    try {
      // Get basic torrent info
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
      const files: TorrentFile[] = (filesResult || []).map((file: unknown[]) => {
        const [path, size, completedChunks, totalChunks, priority] = file;
        const fileProgress =
          (totalChunks as number) > 0
            ? Math.round(((completedChunks as number) / (totalChunks as number)) * 100)
            : 0;
        let filePriority: TorrentFile["priority"] = "normal";
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
      const trackers: TorrentTracker[] = (trackersResult || []).map((tracker: unknown[]) => {
        // rTorrent tracker tuple: [url, group, isEnabled, seeders, leechers, ...optional fields]
        const [url, group, isEnabled, seeders, leechers, lastScrape, lastAnnounce, lastError] =
          tracker;
        let trackerStatus: TorrentTracker["status"] = "inactive";
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
      console.error("Error getting torrent details:", error);
      return null;
    }
  }

  async getAllTorrents(): Promise<DownloadStatus[]> {
    // Get all torrents using multicall
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

  async pauseTorrent(id: string): Promise<{ success: boolean; message: string }> {
    try {
      await this.makeXMLRPCRequest("d.stop", [id]);
      return { success: true, message: "Torrent paused successfully" };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return { success: false, message: `Failed to pause torrent: ${errorMessage}` };
    }
  }

  async resumeTorrent(id: string): Promise<{ success: boolean; message: string }> {
    try {
      await this.makeXMLRPCRequest("d.start", [id]);
      return { success: true, message: "Torrent resumed successfully" };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return { success: false, message: `Failed to resume torrent: ${errorMessage}` };
    }
  }

  async removeTorrent(
    id: string,
    deleteFiles = false
  ): Promise<{ success: boolean; message: string }> {
    try {
      if (deleteFiles) {
        // Stop torrent, delete data, and remove from client
        await this.makeXMLRPCRequest("d.stop", [id]);
        await this.makeXMLRPCRequest("d.delete_tied", [id]); // Delete files
        await this.makeXMLRPCRequest("d.erase", [id]);
      } else {
        // Just remove from client without deleting files
        await this.makeXMLRPCRequest("d.erase", [id]);
      }
      return { success: true, message: "Torrent removed successfully" };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return { success: false, message: `Failed to remove torrent: ${errorMessage}` };
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
    // torrent is an array: [hash, name, state, complete, size, completed, down_rate, up_rate, ratio, peers_connected, peers_complete, message, custom1]
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

  async addTorrent(
    request: DownloadRequest
  ): Promise<{ success: boolean; id?: string; message: string }> {
    try {
      if (!request.url) {
        return {
          success: false,
          message: "Torrent URL is required",
        };
      }

      await this.authenticate();

      // Build form data for adding torrent
      const formData = new URLSearchParams();
      formData.append("urls", request.url);

      if (request.downloadPath || this.downloader.downloadPath) {
        formData.append("savepath", request.downloadPath || this.downloader.downloadPath || "");
      }

      if (request.category || this.downloader.category) {
        formData.append("category", request.category || this.downloader.category || "");
      }

      const response = await this.makeRequest("POST", "/api/v2/torrents/add", formData.toString(), {
        "Content-Type": "application/x-www-form-urlencoded",
      });

      const responseText = await response.text();

      if (response.ok && (responseText === "Ok." || responseText === "")) {
        // Extract hash from magnet or generate a placeholder
        const hash = extractHashFromUrl(request.url);
        return {
          success: true,
          id: hash || "added",
          message: "Torrent added successfully",
        };
      } else if (responseText === "Fails.") {
        return {
          success: false,
          message: "Torrent already exists or invalid torrent",
        };
      } else {
        return {
          success: false,
          message: `Failed to add torrent: ${responseText}`,
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return { success: false, message: `Failed to add torrent: ${errorMessage}` };
    }
  }

  async getTorrentStatus(id: string): Promise<DownloadStatus | null> {
    try {
      await this.authenticate();

      const response = await this.makeRequest("GET", `/api/v2/torrents/info?hashes=${id}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const torrents = (await response.json()) as any[];

      if (torrents && torrents.length > 0) {
        return this.mapQBittorrentStatus(torrents[0]);
      }

      return null;
    } catch (error) {
      console.error("Error getting torrent status:", error);
      return null;
    }
  }

  async getTorrentDetails(_id: string): Promise<TorrentDetails | null> {
    return null;
  }

  async getAllTorrents(): Promise<DownloadStatus[]> {
    try {
      await this.authenticate();

      const response = await this.makeRequest("GET", "/api/v2/torrents/info");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const torrents = (await response.json()) as any[];

      if (torrents) {
        return torrents.map((torrent: QBittorrentTorrent) => this.mapQBittorrentStatus(torrent));
      }

      return [];
    } catch (error) {
      console.error("Error getting all torrents:", error);
      return [];
    }
  }

  async pauseTorrent(id: string): Promise<{ success: boolean; message: string }> {
    try {
      await this.authenticate();

      const formData = new URLSearchParams();
      formData.append("hashes", id);

      await this.makeRequest("POST", "/api/v2/torrents/pause", formData.toString(), {
        "Content-Type": "application/x-www-form-urlencoded",
      });

      return { success: true, message: "Torrent paused successfully" };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return { success: false, message: `Failed to pause torrent: ${errorMessage}` };
    }
  }

  async resumeTorrent(id: string): Promise<{ success: boolean; message: string }> {
    try {
      await this.authenticate();

      const formData = new URLSearchParams();
      formData.append("hashes", id);

      await this.makeRequest("POST", "/api/v2/torrents/resume", formData.toString(), {
        "Content-Type": "application/x-www-form-urlencoded",
      });

      return { success: true, message: "Torrent resumed successfully" };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return { success: false, message: `Failed to resume torrent: ${errorMessage}` };
    }
  }

  async removeTorrent(
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

      return { success: true, message: "Torrent removed successfully" };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return { success: false, message: `Failed to remove torrent: ${errorMessage}` };
    }
  }

  async getFreeSpace(): Promise<number> {
    try {
      await this.authenticate();

      // Get main preferences to find save path
      const prefResponse = await this.makeRequest("GET", "/api/v2/app/preferences");
      const prefs = await prefResponse.json();
      const _savePath = prefs.save_path;

      // Get free space for save path
      // qBittorrent doesn't have a direct free space API for a specific path in older versions,
      // but in newer ones it does. As a fallback, we can use transfer info.
      const transferResponse = await this.makeRequest("GET", "/api/v2/transfer/info");
      const transferInfo = await transferResponse.json();

      // transferInfo.free_space_on_disk
      return transferInfo.free_space_on_disk || 0;
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
      case "unknown":
      default:
        status = "error";
        break;
    }

    // Check if completed based on progress
    if (torrent.progress === 1) {
      if (status === "downloading" || status === "stalledDL") {
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

  private async authenticate(): Promise<void> {
    if (this.cookie) {
      return; // Already authenticated
    }

    if (!this.downloader.username || !this.downloader.password) {
      // Try without authentication
      return;
    }

    const url = this.getBaseUrl() + "/api/v2/auth/login";

    const formData = new URLSearchParams();
    formData.append("username", this.downloader.username);
    formData.append("password", this.downloader.password);

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
    if (responseText !== "Ok.") {
      throw new Error("Authentication failed: Invalid credentials");
    }

    // Extract session cookie
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) {
      const match = setCookie.match(/SID=([^;]+)/);
      if (match) {
        this.cookie = `SID=${match[1]}`;
      }
    }
  }

  private getBaseUrl(): string {
    let url = this.downloader.url;
    // Remove trailing slash
    if (url.endsWith("/")) {
      url = url.slice(0, -1);
    }
    return url;
  }

  private async makeRequest(
    method: string,
    path: string,
    body?: string,
    additionalHeaders?: Record<string, string>
  ): Promise<Response> {
    const url = this.getBaseUrl() + path;

    const headers: Record<string, string> = {
      "User-Agent": "Questarr/1.0",
      ...additionalHeaders,
    };

    if (this.cookie) {
      headers["Cookie"] = this.cookie;
    }

    const response = await fetch(url, {
      method,
      headers,
      body: method !== "GET" ? body : undefined,
      signal: AbortSignal.timeout(30000),
    });

    if (response.status === 403) {
      // Session expired, re-authenticate
      this.cookie = null;
      await this.authenticate();

      // Retry with new cookie
      if (this.cookie) {
        headers["Cookie"] = this.cookie;
      }

      return fetch(url, {
        method,
        headers,
        body: method !== "GET" ? body : undefined,
        signal: AbortSignal.timeout(30000),
      });
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

  static async addTorrent(
    downloader: Downloader,
    request: DownloadRequest
  ): Promise<{ success: boolean; id?: string; message: string }> {
    try {
      const client = this.createClient(downloader);
      return await client.addTorrent(request);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return { success: false, message: errorMessage };
    }
  }

  static async getAllTorrents(downloader: Downloader): Promise<DownloadStatus[]> {
    const client = this.createClient(downloader);
    const torrents = await client.getAllTorrents();

    // Filter by configured category if set
    if (downloader.category) {
      const filterCategory = downloader.category.toLowerCase();
      return torrents.filter((t) => {
        // Strict category match if available
        if (t.category) {
          return t.category.toLowerCase() === filterCategory;
        }

        // If category is missing in the torrent status:
        // For clients that support categories (rTorrent, qBittorrent), missing category means "Uncategorized",
        // so we exclude it if a filter is active.
        // For Transmission, we haven't implemented category mapping yet, so we include everything to avoid hiding all downloads.
        if (downloader.type === "transmission") {
          return true;
        }

        return false;
      });
    }

    return torrents;
  }

  static async getTorrentStatus(
    downloader: Downloader,
    id: string
  ): Promise<DownloadStatus | null> {
    try {
      const client = this.createClient(downloader);
      return await client.getTorrentStatus(id);
    } catch (error) {
      downloadersLogger.error({ error }, "error getting torrent status");
      return null;
    }
  }

  static async getTorrentDetails(
    downloader: Downloader,
    id: string
  ): Promise<TorrentDetails | null> {
    try {
      const client = this.createClient(downloader);
      return await client.getTorrentDetails(id);
    } catch (error) {
      console.error("Error getting torrent details:", error);
      return null;
    }
  }

  static async pauseTorrent(
    downloader: Downloader,
    id: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      const client = this.createClient(downloader);
      return await client.pauseTorrent(id);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return { success: false, message: errorMessage };
    }
  }

  static async resumeTorrent(
    downloader: Downloader,
    id: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      const client = this.createClient(downloader);
      return await client.resumeTorrent(id);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return { success: false, message: errorMessage };
    }
  }

  static async removeTorrent(
    downloader: Downloader,
    id: string,
    deleteFiles = false
  ): Promise<{ success: boolean; message: string }> {
    try {
      const client = this.createClient(downloader);
      return await client.removeTorrent(id, deleteFiles);
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

  static async addTorrentWithFallback(
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

    for (const downloader of downloaders) {
      attemptedDownloaders.push(downloader.name);

      try {
        const result = await this.addTorrent(downloader, request);

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

export { DownloadRequest, DownloaderClient };
