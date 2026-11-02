import type { Downloader, DownloadStatus, DownloadDetails } from "../../shared/schema.js";
import { downloadersLogger } from "../logger.js";
import { isSafeUrl, safeFetch } from "../ssrf.js";
import type {
  DownloadRequest,
  DownloadResult,
  DownloaderClient,
  DownloaderActionResult,
} from "./types.js";
import { assertCredentialsAllowed, isHttpsUrl, logDownloaderDebugResponse } from "./utils.js";

// Real-Debrid API base URL
const REALDEBRID_API_URL = "https://api.real-debrid.com/rest/1.0";

// Real-Debrid API endpoints
const REALDEBRID_ENDPOINTS = {
  TORRENTS: "${apiUrl}/torrents",
  TORRENT: "${apiUrl}/torrents/{id}",
  TORRENT_ADD_MAGNET: "${apiUrl}/torrents/addMagnet",
  TORRENT_ADD_TORRENT: "${apiUrl}/torrents/addTorrent",
  TORRENT_SELECT_FILES: "${apiUrl}/torrents/selectFiles/{id}",
  DOWNLOADS: "${apiUrl}/downloads",
  DOWNLOAD: "${apiUrl}/downloads/{id}",
  USER: "${apiUrl}/user",
} as const;

interface RealDebridTorrent {
  id: string;
  filename: string;
  hash: string;
  bytes: number;
  original_bytes: number;
  status:
    | "downloaded"
    | "waiting"
    | "downloading"
    | "error"
    | "virus"
    | "compressing"
    | "uploading"
    | "dead"
    | "waiting_files_selection";
  status_code: number;
  progress: number;
  speed: number;
  seeders: number;
  added: string;
}

interface RealDebridDownload {
  id: string;
  filename: string;
  mimeType: string;
  filesize: number;
  link: string;
  host: string;
  chunks: number;
  download_id: string;
  status: "ready" | "waiting" | "downloading" | "error" | "virus";
  speed: number;
  progress: number;
  bytes: number;
}

interface RealDebridUser {
  id: number;
  username: string;
  email: string;
  points: number;
  tier: number;
  locale: string;
  premium: number;
  expiration: string;
}

interface RealDebridAddTorrentResponse {
  id: string;
  uri: string;
}

/**
 * Real-Debrid client implementation.
 *
 * Real-Debrid is a debrid service that allows downloading torrents through
 * their infrastructure. Unlike traditional torrent clients, Real-Debrid:
 * - Handles the torrent downloading on their servers
 * - Provides direct HTTP download links for completed files
 * - Supports both torrent files and magnet links
 * - Requires an API key for authentication
 *
 * @remarks
 * - Uses API key authentication via Authorization header
 * - All operations use the Real-Debrid REST API v1.0
 * - Status mapping: status field from API response
 * - Supports magnet links and torrent files
 * - Downloads are managed through the Real-Debrid infrastructure
 */
export class RealDebridClient implements DownloaderClient {
  private downloader: Downloader;

  constructor(downloader: Downloader) {
    this.downloader = downloader;
  }

  /**
   * Builds the Real-Debrid API URL for a given endpoint.
   */
  private getApiUrl(endpoint: string): string {
    // Replace the placeholder with the actual API URL
    const url = endpoint.replace("${apiUrl}", REALDEBRID_API_URL);
    return url;
  }

  /**
   * Makes a request to the Real-Debrid API.
   */
  private async makeApiRequest(endpoint: string, options: RequestInit = {}): Promise<Response> {
    const url = this.getApiUrl(endpoint);

    // Ensure we're using HTTPS for Real-Debrid API
    if (!isHttpsUrl(url)) {
      throw new Error(`Real-Debrid API requires HTTPS: ${url}`);
    }

    // Check if credentials are allowed
    if (this.downloader.password) {
      assertCredentialsAllowed(this.downloader, url, "Real-Debrid", "API key");
    }

    const headers = new Headers(options.headers as Record<string, string>);
    headers.set("User-Agent", "Questarr/1.0");
    headers.set("Accept", "application/json");

    // Add API key if available
    if (this.downloader.password) {
      headers.set("Authorization", `Bearer ${this.downloader.password}`);
    }

    const response = await safeFetch(url, {
      ...options,
      headers,
      allowPrivate: true,
      requireHttps: true,
    });

    await logDownloaderDebugResponse("realdebrid", options.method ?? "GET", url, response);

    return response;
  }

  async testConnection(): Promise<DownloaderActionResult> {
    try {
      const response = await this.makeApiRequest(REALDEBRID_ENDPOINTS.USER);

      if (!response.ok) {
        const error = await this.getErrorMessage(response);
        return {
          success: false,
          message: `Failed to connect to Real-Debrid: ${error}`,
        };
      }

      const user = (await response.json()) as RealDebridUser;
      return {
        success: true,
        message: `Connected successfully to Real-Debrid as ${user.username} (${user.tier > 0 ? "Premium" : "Free"} tier)`,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        message: `Failed to connect to Real-Debrid: ${errorMessage}`,
      };
    }
  }

  async logVersionInfo(): Promise<void> {
    try {
      const response = await this.makeApiRequest(REALDEBRID_ENDPOINTS.USER);
      if (!response.ok) return;

      const user = (await response.json()) as RealDebridUser;
      downloadersLogger.info(
        {
          downloaderId: this.downloader.id,
          downloaderType: this.downloader.type,
          username: user.username,
          tier: user.tier,
          premium: user.premium,
        },
        "Real-Debrid downloader version probe completed"
      );
    } catch (error) {
      downloadersLogger.warn(
        { downloaderId: this.downloader.id, error },
        "Real-Debrid version probe failed"
      );
    }
  }

  async addDownload(request: DownloadRequest): Promise<DownloadResult> {
    try {
      if (!request.url) {
        return {
          success: false,
          message: "Download URL is required",
        };
      }

      if (!(await isSafeUrl(request.url))) {
        return { success: false, message: `Unsafe URL blocked: ${request.url}` };
      }

      // Real-Debrid supports magnet links and torrent files
      const isMagnet = request.url.startsWith("magnet:");
      const isTorrentFile = this.isTorrentFileUrl(request.url);

      if (!isMagnet && !isTorrentFile) {
        return {
          success: false,
          message: "Real-Debrid only supports magnet links and .torrent files",
        };
      }

      // Add torrent to Real-Debrid
      const addResult = await this.addTorrent(request.url, isMagnet);
      if (!addResult.success || !addResult.id) {
        return { success: false, message: addResult.message || "Failed to add torrent" };
      }

      // For magnet links, we need to wait for the torrent to be resolved
      // For torrent files, it should be immediate
      if (isMagnet) {
        // Return the torrent ID as correlation tag for tracking
        return {
          success: true,
          message: `Magnet link added to Real-Debrid, waiting for resolution`,
          correlationTag: addResult.id,
        };
      }

      // For torrent files, try to get the download link immediately
      const download = await this.getDownloadFromTorrent(addResult.id);
      if (download) {
        return {
          success: true,
          message: `Torrent added and download started`,
          id: download.download_id || download.id,
        };
      }

      // If download not ready yet, return with correlation tag
      return {
        success: true,
        message: `Torrent added to Real-Debrid`,
        correlationTag: addResult.id,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        message: `Failed to add download to Real-Debrid: ${errorMessage}`,
      };
    }
  }

  /**
   * Checks if a URL is a torrent file (handles query strings).
   */
  private isTorrentFileUrl(url: string): boolean {
    try {
      const urlObj = new URL(url);
      const path = urlObj.pathname.toLowerCase();
      return path.endsWith(".torrent");
    } catch {
      return url.toLowerCase().endsWith(".torrent");
    }
  }

  /**
   * Adds a torrent (magnet or torrent file URL) to Real-Debrid.
   */
  private async addTorrent(
    url: string,
    isMagnet: boolean
  ): Promise<{ success: boolean; id?: string; message?: string }> {
    try {
      let result: RealDebridAddTorrentResponse | null = null;

      if (isMagnet) {
        // For magnet links, use addMagnet endpoint with form-encoded body
        const response = await this.makeApiRequest(REALDEBRID_ENDPOINTS.TORRENT_ADD_MAGNET, {
          method: "POST",
          body: new URLSearchParams({ magnet: url }),
        });

        if (!response.ok) {
          const error = await this.getErrorMessage(response);
          return { success: false, message: error };
        }

        result = (await response.json()) as RealDebridAddTorrentResponse;
      } else {
        // For torrent files, we need to fetch the file and upload it
        // First, fetch the torrent file
        const torrentResponse = await safeFetch(url, {
          allowPrivate: true,
          requireHttps: false,
        });

        if (!torrentResponse.ok) {
          return {
            success: false,
            message: `Failed to fetch torrent file: HTTP ${torrentResponse.status}`,
          };
        }

        const torrentBytes = await torrentResponse.arrayBuffer();

        // Upload the torrent file
        const response = await this.makeApiRequest(REALDEBRID_ENDPOINTS.TORRENT_ADD_TORRENT, {
          method: "PUT",
          body: Buffer.from(torrentBytes),
          headers: new Headers({
            "Content-Type": "application/x-bittorrent",
          }),
        });

        if (!response.ok) {
          const error = await this.getErrorMessage(response);
          return { success: false, message: error };
        }

        result = (await response.json()) as RealDebridAddTorrentResponse;
      }

      // Select all files for the torrent
      await this.selectAllFiles(result.id);

      return { success: true, id: result.id };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return { success: false, message: errorMessage };
    }
  }

  /**
   * Selects all files for a torrent in Real-Debrid.
   * This is required after adding a torrent to start the download.
   */
  private async selectAllFiles(torrentId: string): Promise<void> {
    try {
      await this.makeApiRequest(
        REALDEBRID_ENDPOINTS.TORRENT_SELECT_FILES.replace("{id}", torrentId),
        {
          method: "POST",
          body: new URLSearchParams({ files: "all" }),
        }
      );
    } catch (error) {
      downloadersLogger.warn({ torrentId, error }, "Failed to select all files for torrent");
      throw error;
    }
  }

  /**
   * Gets a download from a torrent ID if available.
   */
  private async getDownloadFromTorrent(torrentId: string): Promise<RealDebridDownload | null> {
    try {
      // First, check the torrent status
      const torrentResponse = await this.makeApiRequest(
        REALDEBRID_ENDPOINTS.TORRENT.replace("{id}", torrentId)
      );

      if (!torrentResponse.ok) {
        return null;
      }

      const torrent = (await torrentResponse.json()) as RealDebridTorrent;

      // If torrent is ready, get the download
      if (torrent.status === "downloaded") {
        // Get downloads for this torrent
        const downloadsResponse = await this.makeApiRequest(
          `${REALDEBRID_ENDPOINTS.DOWNLOADS}?torrents=${torrentId}`
        );

        if (downloadsResponse.ok) {
          const downloads = (await downloadsResponse.json()) as RealDebridDownload[];
          if (downloads.length > 0) {
            return downloads[0] as RealDebridDownload | null;
          }
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  async getDownloadStatus(id: string): Promise<DownloadStatus | null> {
    try {
      // Try to find the download by ID
      const download = await this.getDownloadById(id);
      if (download) {
        return this.mapDownloadToStatus(download);
      }

      // If not found as download, try as torrent
      const torrent = await this.getTorrentById(id);
      if (torrent) {
        return this.mapTorrentToStatus(torrent);
      }

      return null;
    } catch (error) {
      downloadersLogger.warn(
        { downloaderId: this.downloader.id, downloadId: id, error },
        "Failed to get download status from Real-Debrid"
      );
      return null;
    }
  }

  /**
   * Gets a download by its ID.
   */
  private async getDownloadById(id: string): Promise<RealDebridDownload | null> {
    try {
      const response = await this.makeApiRequest(REALDEBRID_ENDPOINTS.DOWNLOAD.replace("{id}", id));

      if (response.ok) {
        return (await response.json()) as RealDebridDownload | null;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Gets a torrent by its ID.
   */
  private async getTorrentById(id: string): Promise<RealDebridTorrent | null> {
    try {
      const response = await this.makeApiRequest(REALDEBRID_ENDPOINTS.TORRENT.replace("{id}", id));

      if (response.ok) {
        return (await response.json()) as RealDebridTorrent;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Maps a Real-Debrid download to Questarr's DownloadStatus format.
   */
  private mapDownloadToStatus(download: RealDebridDownload): DownloadStatus {
    const status = this.mapRealDebridStatus(download.status);

    return {
      id: download.download_id || download.id,
      name: download.filename,
      status,
      progress: download.progress * 100,
      size: download.bytes,
      downloaded: download.bytes,
      downloadSpeed: download.speed * 1024, // Convert to bytes/sec
      eta: -1, // Real-Debrid doesn't provide ETA
      uploadSpeed: 0,
      ratio: 0,
    };
  }

  /**
   * Maps a Real-Debrid torrent to Questarr's DownloadStatus format.
   */
  private mapTorrentToStatus(torrent: RealDebridTorrent): DownloadStatus {
    const status = this.mapRealDebridTorrentStatus(torrent.status);

    return {
      id: torrent.id,
      name: torrent.filename,
      status,
      progress: torrent.progress * 100,
      size: torrent.bytes,
      downloaded: torrent.bytes,
      downloadSpeed: torrent.speed * 1024, // Convert to bytes/sec
      eta: -1, // Real-Debrid doesn't provide ETA
      uploadSpeed: 0,
      ratio: 0,
    };
  }

  /**
   * Maps Real-Debrid download status to Questarr's status format.
   */
  private mapRealDebridStatus(status: string): DownloadStatus["status"] {
    switch (status) {
      case "ready":
        return "completed";
      case "downloading":
        return "downloading";
      case "waiting":
      case "error":
      case "virus":
      default:
        return "downloading";
    }
  }

  /**
   * Maps Real-Debrid torrent status to Questarr's status format.
   */
  private mapRealDebridTorrentStatus(status: string): DownloadStatus["status"] {
    switch (status) {
      case "downloaded":
        return "completed";
      case "downloading":
      case "compressing":
      case "uploading":
      case "waiting":
      case "waiting_files_selection":
      case "error":
      case "virus":
      case "dead":
      default:
        return "downloading";
    }
  }

  async getDownloadDetails(id: string): Promise<DownloadDetails | null> {
    try {
      // Try to find the download by ID
      const download = await this.getDownloadById(id);
      if (download) {
        return this.mapDownloadToDetails(download);
      }

      // If not found as download, try as torrent
      const torrent = await this.getTorrentById(id);
      if (torrent) {
        return this.mapTorrentToDetails(torrent);
      }

      return null;
    } catch (error) {
      downloadersLogger.warn(
        { downloaderId: this.downloader.id, downloadId: id, error },
        "Failed to get download details from Real-Debrid"
      );
      return null;
    }
  }

  /**
   * Maps a Real-Debrid download to Questarr's DownloadDetails format.
   */
  private mapDownloadToDetails(download: RealDebridDownload): DownloadDetails {
    return {
      id: download.download_id || download.id,
      name: download.filename,
      status: this.mapRealDebridStatus(download.status),
      progress: download.progress * 100,
      size: download.bytes,
      downloaded: download.bytes,
      downloadSpeed: download.speed * 1024,
      uploadSpeed: 0,
      eta: -1,
      ratio: 0,
      files: [
        {
          name: download.filename,
          size: download.bytes,
          progress: 100,
          priority: "normal",
          wanted: true,
        },
      ],
      trackers: [],
      filesSupport: "unsupported",
      filesSupportReason: "Real-Debrid does not expose individual file details",
    };
  }

  /**
   * Maps a Real-Debrid torrent to Questarr's DownloadDetails format.
   */
  private mapTorrentToDetails(torrent: RealDebridTorrent): DownloadDetails {
    return {
      id: torrent.id,
      name: torrent.filename,
      status: this.mapRealDebridTorrentStatus(torrent.status),
      progress: torrent.progress * 100,
      size: torrent.bytes,
      downloaded: torrent.bytes,
      downloadSpeed: torrent.speed * 1024,
      uploadSpeed: 0,
      eta: -1,
      ratio: 0,
      hash: torrent.hash,
      files: [
        {
          name: torrent.filename,
          size: torrent.bytes,
          progress: 100,
          priority: "normal",
          wanted: true,
        },
      ],
      trackers: [],
      filesSupport: "unsupported",
      filesSupportReason: "Real-Debrid does not expose individual file details",
    };
  }

  async getAllDownloads(): Promise<DownloadStatus[]> {
    try {
      const downloads = await this.getAllDownloadsFromApi();
      const torrents = await this.getAllTorrentsFromApi();

      // Combine downloads and torrents
      const allStatuses: DownloadStatus[] = [];

      // Add downloads
      for (const download of downloads) {
        allStatuses.push(this.mapDownloadToStatus(download));
      }

      // Add torrents that aren't already represented as downloads
      for (const torrent of torrents) {
        const alreadyAdded = allStatuses.some((status) => status.id === torrent.id);
        if (!alreadyAdded) {
          allStatuses.push(this.mapTorrentToStatus(torrent));
        }
      }

      return allStatuses;
    } catch (error) {
      downloadersLogger.warn(
        { downloaderId: this.downloader.id, error },
        "Failed to get all downloads from Real-Debrid"
      );
      return [];
    }
  }

  /**
   * Gets all downloads from the Real-Debrid API.
   */
  private async getAllDownloadsFromApi(): Promise<RealDebridDownload[]> {
    try {
      const response = await this.makeApiRequest(REALDEBRID_ENDPOINTS.DOWNLOADS);
      if (response.ok) {
        return (await response.json()) as RealDebridDownload[];
      }
      return [];
    } catch {
      return [];
    }
  }

  /**
   * Gets all torrents from the Real-Debrid API.
   */
  private async getAllTorrentsFromApi(): Promise<RealDebridTorrent[]> {
    try {
      const response = await this.makeApiRequest(REALDEBRID_ENDPOINTS.TORRENTS);
      if (response.ok) {
        return (await response.json()) as RealDebridTorrent[];
      }
      return [];
    } catch {
      return [];
    }
  }

  async pauseDownload(id: string): Promise<DownloaderActionResult> {
    try {
      // Real-Debrid doesn't have a direct pause API
      // We can try to delete the torrent to stop it
      const result = await this.deleteTorrent(id);
      if (result.success) {
        return {
          success: true,
          message: `Torrent removed from Real-Debrid`,
        };
      }
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        message: `Failed to pause download: ${errorMessage}`,
      };
    }
  }

  async resumeDownload(id: string): Promise<DownloaderActionResult> {
    try {
      // Real-Debrid automatically resumes downloads when they're added
      // We can't manually resume, but we can check the status
      const download = await this.getDownloadById(id);
      if (download) {
        return {
          success: true,
          message: `Download is ${download.status}`,
        };
      }

      const torrent = await this.getTorrentById(id);
      if (torrent) {
        return {
          success: true,
          message: `Torrent is ${torrent.status}`,
        };
      }

      return {
        success: false,
        message: `Download or torrent not found`,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        message: `Failed to resume download: ${errorMessage}`,
      };
    }
  }

  async removeDownload(id: string, _deleteFiles?: boolean): Promise<DownloaderActionResult> {
    try {
      // Try to delete as download first
      const downloadResult = await this.deleteDownload(id);
      if (downloadResult.success) {
        return downloadResult;
      }

      // Try to delete as torrent
      const torrentResult = await this.deleteTorrent(id);
      return torrentResult;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        message: `Failed to remove download: ${errorMessage}`,
      };
    }
  }

  /**
   * Deletes a download from Real-Debrid.
   */
  private async deleteDownload(id: string): Promise<DownloaderActionResult> {
    try {
      const response = await this.makeApiRequest(
        REALDEBRID_ENDPOINTS.DOWNLOAD.replace("{id}", id),
        { method: "DELETE" }
      );

      if (response.ok) {
        return { success: true, message: "Download deleted from Real-Debrid" };
      }

      const error = await this.getErrorMessage(response);
      return { success: false, message: error };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return { success: false, message: errorMessage };
    }
  }

  /**
   * Deletes a torrent from Real-Debrid.
   */
  private async deleteTorrent(id: string): Promise<DownloaderActionResult> {
    try {
      const response = await this.makeApiRequest(REALDEBRID_ENDPOINTS.TORRENT.replace("{id}", id), {
        method: "DELETE",
      });

      if (response.ok) {
        return { success: true, message: "Torrent deleted from Real-Debrid" };
      }

      const error = await this.getErrorMessage(response);
      return { success: false, message: error };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return { success: false, message: errorMessage };
    }
  }

  async getFreeSpace(): Promise<number> {
    try {
      const response = await this.makeApiRequest(REALDEBRID_ENDPOINTS.USER);
      if (response.ok) {
        const user = (await response.json()) as RealDebridUser;
        // Real-Debrid doesn't provide free space directly
        // Return a large value as the service handles storage
        // Premium users have unlimited storage
        if (user.premium > 0) {
          return 1000 * 1024 * 1024 * 1024; // 1 TB for premium
        }
        return 10 * 1024 * 1024 * 1024; // 10 GB for free
      }
      return 0;
    } catch {
      return 0;
    }
  }

  async findTorrentByTag(_tag: string): Promise<string | null> {
    // Real-Debrid doesn't support tags in the same way as qBittorrent
    // We can't find torrents by tag, so return null
    return null;
  }

  /**
   * Extracts error message from a Real-Debrid API response.
   */
  private async getErrorMessage(response: Response): Promise<string> {
    try {
      const data = await response.json();
      if (data && typeof data === "object" && "error" in data) {
        return (data as { error: string }).error;
      }
      if (data && typeof data === "object" && "error_code" in data) {
        return `Error ${(data as { error_code: number }).error_code}`;
      }
      return `HTTP ${response.status}: ${response.statusText}`;
    } catch {
      return `HTTP ${response.status}: ${response.statusText}`;
    }
  }
}
