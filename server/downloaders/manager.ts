import type { Downloader, DownloadStatus, DownloadDetails } from "../../shared/schema.js";
import { isTorrentDownloaderType, isUsenetDownloaderType } from "../../shared/downloader-types.js";
import { downloadersLogger } from "../logger.js";
import type {
  DownloadRequest,
  DownloaderActionResult,
  DownloadResult,
  DownloaderClient,
} from "./types.js";
import { TransmissionClient } from "./transmission.js";
import { RTorrentClient } from "./rtorrent.js";
import { QBittorrentClient } from "./qbittorrent.js";
import { SABnzbdClient } from "./sabnzbd.js";
import { NZBGetClient } from "./nzbget.js";
import { SynologyDownloadStationClient } from "./synology.js";
import { DelugeClient } from "./deluge.js";

// To add a new downloader:
// 1. Create server/downloaders/mynewclient.ts — implement DownloaderClient from ./types.js
// 2. Register the type in shared/schema.ts (downloaders table enum)
// 3. Classify in shared/downloader-types.ts (TORRENT_DOWNLOADER_TYPES or USENET_DOWNLOADER_TYPES)
// 4. Add a case below in createClient()
// 5. Export from downloaders/index.ts

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
      case "synology":
        return new SynologyDownloadStationClient(downloader);
      case "deluge":
        return new DelugeClient(downloader);
      default:
        throw new Error(`Unsupported downloader type: ${downloader.type}`);
    }
  }

  static async testDownloader(downloader: Downloader): Promise<DownloaderActionResult> {
    try {
      const client = this.createClient(downloader);
      return await client.testConnection();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return { success: false, message: errorMessage };
    }
  }

  static async logVersionInfo(downloader: Downloader): Promise<void> {
    try {
      const client = this.createClient(downloader);
      await client.logVersionInfo();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      downloadersLogger.warn(
        { downloaderId: downloader.id, downloaderType: downloader.type, error: errorMessage },
        "Downloader version probe failed"
      );
    }
  }

  static async addDownload(
    downloader: Downloader,
    request: DownloadRequest
  ): Promise<DownloadResult> {
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
        if (t.category) {
          return t.category.toLowerCase() === filterCategory;
        }
        // No category on the download item means it is uncategorised — exclude when a filter is active.
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
      downloadersLogger.error(
        { error, downloaderId: downloader.id, id },
        "Error getting download details"
      );
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
      compatibleDownloaders = downloaders.filter((d) => isUsenetDownloaderType(d.type));
    } else if (request.downloadType === "torrent") {
      compatibleDownloaders = downloaders.filter((d) => isTorrentDownloaderType(d.type));
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
