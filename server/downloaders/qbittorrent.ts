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
import { fetchWithMagnetDetection, extractHashFromUrl, fixNzbUrlEncoding } from "./utils.js";

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

/**
 * qBittorrent client implementation using Web API v2.
 *
 * @remarks
 * - Uses cookie-based authentication via /api/v2/auth/login
 * - All torrent operations use /api/v2/torrents/* endpoints
 * - Status mapping: state field from API response
 * - Supports username/password authentication
 */
export class QBittorrentClient implements DownloaderClient {
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
      const version = await this.getAppVersion();
      return { success: true, message: `Connected successfully to qBittorrent ${version}` };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return { success: false, message: `Failed to connect to qBittorrent: ${errorMessage}` };
    }
  }

  async logVersionInfo(): Promise<void> {
    await this.authenticate();
    const version = await this.getAppVersion();
    downloadersLogger.info(
      {
        downloaderId: this.downloader.id,
        downloaderType: this.downloader.type,
        version,
      },
      "Downloader version probe completed"
    );
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

      if (!(await isSafeUrl(request.url))) {
        return { success: false, message: `Unsafe URL blocked: ${request.url}` };
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

      interface QBittorrentTorrent {
        name: string;
        hash: string;
        added_on: number;
      }

      const findRecentlyAddedDownload = async (): Promise<{
        hash: string;
        name?: string;
      } | null> => {
        // Wait a bit for qBittorrent to process the add (URL add or torrent upload)
        await new Promise((resolve) => setTimeout(resolve, 2000));

        const allTorrentsResponse = await this.makeRequest(
          "GET",
          "/api/v2/torrents/info?sort=added_on&reverse=true"
        );
        const allDownloads = (await allTorrentsResponse.json()) as QBittorrentTorrent[];

        downloadersLogger.debug(
          {
            requestTitle: request.title,
            downloadCount: allDownloads.length,
            recentDownloads: allDownloads.slice(0, 3).map((t) => ({ name: t.name, hash: t.hash })),
          },
          "Looking for newly added download"
        );

        let matchingDownload: QBittorrentTorrent | undefined;
        if (request.title) {
          const normalizedTitle = request.title
            .toLowerCase()
            .replace(/[._-]/g, " ")
            .replace(/\s+/g, " ")
            .trim();

          matchingDownload = allDownloads.find((t) => {
            if (!t.name) return false;
            const normalizedName = t.name
              .toLowerCase()
              .replace(/[._-]/g, " ")
              .replace(/\s+/g, " ")
              .trim();
            return (
              normalizedName.includes(normalizedTitle) || normalizedTitle.includes(normalizedName)
            );
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
        // Fix Prowlarr/indexer URL encoding before handing the URL to qBittorrent.
        // Prowlarr wraps external torrent URLs in a proxy URL whose `link` parameter
        // is base64-encoded. Literal `+` in that base64 is decoded as space by
        // ASP.NET Core (Prowlarr's backend), corrupting the value and causing
        // Prowlarr to redirect to a wrong or broken torrent/magnet.
        // For magnet links this is a no-op.
        const urlToAdd = isMagnet ? request.url : fixNzbUrlEncoding(request.url);
        const params = new URLSearchParams();
        params.set("urls", urlToAdd);
        if (savepath) params.set("savepath", savepath);
        if (category) params.set("category", category);
        params.set("paused", pausedValue);

        downloadersLogger.info(
          { url: urlToAdd, isMagnet, savepath, category, paused: pausedValue },
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

        // qBittorrent v5+ returns JSON on the /api/v2/torrents/add endpoint (HTTP 202).
        // Older versions return plain text "Ok." / "Fails.".
        try {
          const contentType = urlAddResponse.headers.get("content-type") ?? "";
          if (contentType.includes("application/json")) {
            const parsed = JSON.parse(urlAddResponseText) as {
              failure_count?: number;
              pending_count?: number;
              success_count?: number;
            };
            const isPending = (parsed.pending_count ?? 0) >= 1 && (parsed.failure_count ?? 0) === 0;
            const isSuccess = (parsed.success_count ?? 0) >= 1;
            if (isPending || isSuccess) {
              downloadersLogger.info(
                { url: request.url, parsed },
                isPending
                  ? "qBittorrent accepted URL for async processing"
                  : "qBittorrent added torrent immediately via URL"
              );
              return {
                success: true,
                message: isPending
                  ? "Download queued in qBittorrent"
                  : "Download added successfully",
              };
            }
            // failure_count >= 1 with no pending/success → fall through to file-upload fallback
          }
        } catch {
          // Not JSON — fall through to plain-text checks below
        }

        const urlAddOk = urlAddResponseText === "Ok." || urlAddResponseText === "";
        const urlAddFails = urlAddResponseText === "Fails.";
        // 409 Conflict = torrent already exists in qBittorrent; treat as success
        const urlAddDuplicate = urlAddResponse.status === 409;

        if (urlAddOk || urlAddFails || urlAddDuplicate) {
          if (urlAddDuplicate) {
            return {
              success: true,
              message: "Download already exists (qBittorrent)",
            };
          }

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

        downloadersLogger.warn(
          { error, url: request.url },
          "URL-based add failed; falling back to torrent-file upload"
        );
      }

      // 2) Fallback: download .torrent and upload it (useful when qBittorrent can't reach the indexer URL).
      downloadersLogger.info(
        { url: request.url },
        "Downloading torrent file from indexer (fallback)"
      );

      let torrentFileBuffer: Buffer;
      let torrentFileName = "torrent.torrent";
      let parsedInfoHash: string | null = null;

      try {
        const { response: torrentResponse, magnetLink } = await fetchWithMagnetDetection(
          request.url
        );

        if (magnetLink) {
          const magnetHash = extractHashFromUrl(magnetLink);
          if (!magnetHash) {
            // Should technically not happen if fetchWithMagnetDetection returns a magnet link that starts with magnet:
            // but extractHashFromUrl does stricter checking
            throw new Error("Could not extract hash from redirected magnet link");
          }

          downloadersLogger.info({ magnetHash }, "Adding redirected magnet link to qBittorrent");

          // Recursively add the magnet link
          // We construct a new request but preserve the original intent (category, path, etc.)
          return this.addDownload({
            ...request,
            url: magnetLink,
          });
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
        const errorCause =
          error instanceof Error && "cause" in error
            ? (error.cause as { code?: string; message?: string; errno?: number } | undefined)
            : undefined;

        // Detailed logging to diagnose "fetch failed"
        downloadersLogger.error(
          {
            error: errorMessage,
            cause: errorCause,
            code: errorCause?.code,
            errno: errorCause?.errno,
            url: request.url,
          },
          "Failed to download torrent file"
        );

        let userFriendlyError = errorMessage;
        if (errorMessage === "fetch failed" && errorCause) {
          userFriendlyError += ` (${errorCause.code || errorCause.message || "Unknown cause"})`;

          if (errorCause.code === "ECONNREFUSED") {
            userFriendlyError +=
              " - The indexer refused the connection. Check if Prowlarr/Jackett is running and the port is correct.";
          }
        }

        return {
          success: false,
          message: `Failed to download torrent file: ${userFriendlyError}`,
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
      } else if (response.status === 409) {
        downloadersLogger.warn(
          { url: request.url },
          "qBittorrent reports torrent already exists (409 Conflict)"
        );
        return {
          success: true,
          message: "Download already exists (qBittorrent)",
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
      downloadersLogger.error({ error, id }, "Error getting download status");
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
      const propsResponse = await this.makeRequest("GET", `/api/v2/torrents/properties?hash=${id}`);
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
        .filter(
          (t) =>
            t.url && t.url !== "** [DHT] **" && t.url !== "** [PeX] **" && t.url !== "** [LSD] **"
        )
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
        addedDate:
          props.addition_date > 0 ? new Date(props.addition_date * 1000).toISOString() : undefined,
        completedDate:
          props.completion_date > 0
            ? new Date(props.completion_date * 1000).toISOString()
            : undefined,
        files,
        filesSupport: "supported",
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
      downloadersLogger.error({ error }, "Error getting all downloads");
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
      case "stoppedDL": // qBittorrent v5+ equivalent of pausedDL
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

    const swarmSeeders = this.normalizePeerCount(torrent.num_complete);
    const swarmLeechers = this.normalizePeerCount(torrent.num_incomplete);
    const connectedSeeders = this.normalizePeerCount(torrent.num_seeds);
    const connectedLeechers = this.normalizePeerCount(torrent.num_leechs);

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
      // Prefer swarm totals from tracker; fallback to connected peers when unavailable.
      seeders: swarmSeeders ?? connectedSeeders,
      leechers: swarmLeechers ?? connectedLeechers,
      ratio: torrent.ratio,
      error: torrent.state === "error" ? "Torrent error" : undefined,
      category: torrent.category,
    };
  }

  private normalizePeerCount(count: number | undefined): number | undefined {
    return typeof count === "number" && Number.isFinite(count) && count >= 0 ? count : undefined;
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

  private async getAppVersion(): Promise<string> {
    const response = await this.makeRequest("GET", "/api/v2/app/version");
    return (await response.text()).trim();
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
      let sessionCookie: string | null = null;

      // Try the newer getSetCookie() method first (Node 19.7+)
      if (setCookieHeaders.length > 0) {
        for (const cookie of setCookieHeaders) {
          const match = cookie.match(/((?:QBT_)?SID(?:_[^=;]+)?)=([^;]+)/);
          if (match) {
            sessionCookie = `${match[1]}=${match[2]}`;
            break;
          }
        }
      }

      // Fallback to get("set-cookie") for older Node versions
      if (!sessionCookie) {
        const setCookie = response.headers.get("set-cookie");
        if (setCookie) {
          const match = setCookie.match(/((?:QBT_)?SID(?:_[^=;]+)?)=([^;]+)/);
          if (match) {
            sessionCookie = `${match[1]}=${match[2]}`;
          }
        }
      }

      if (sessionCookie) {
        this.cookie = sessionCookie;
        downloadersLogger.debug(
          { cookieLength: this.cookie.length },
          "qBittorrent authentication successful with cookie"
        );
      } else {
        downloadersLogger.warn(
          "qBittorrent authentication returned Ok but no SID-compatible cookie found"
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

    // Add urlPath if present
    if (this.downloader.urlPath) {
      let path = this.downloader.urlPath;
      if (!path.startsWith("/")) path = `/${path}`;
      if (path.endsWith("/")) path = path.slice(0, -1);
      urlObj.pathname = `${urlObj.pathname.replace(/\/$/, "")}${path}`;
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
      {
        method,
        path,
        hasCookie: !!this.cookie,
        hasAuth: !!(this.downloader.username && this.downloader.password),
      },
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
      downloadersLogger.debug({ status: response.status, path }, "Got 403/401, re-authenticating");
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

      if (!response.ok && response.status !== 409) {
        const errorText = await response.text().catch(() => "No error details available");
        downloadersLogger.error(
          { status: response.status, statusText: response.statusText, errorText, path },
          "qBittorrent request failed after re-authentication"
        );
        throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText}`);
      }
    }

    if (!response.ok && response.status !== 409) {
      const errorText = await response.text().catch(() => "No error details available");
      throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText}`);
    }

    return response;
  }
}
