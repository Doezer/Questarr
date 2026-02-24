import { type IStorage } from "../storage.js";
import { PathMappingService } from "./PathMappingService.js";
import { PlatformMappingService } from "./PlatformMappingService.js";
import { ArchiveService } from "./ArchiveService.js";
import { RomMService } from "./RomMService.js";
import {
  ImportStrategy,
  ImportReview,
  PCImportStrategy,
  RomMImportStrategy,
} from "./ImportStrategies.js";
import { DownloaderManager } from "../downloaders.js";
import fs from "fs-extra";

export class ImportManager {
  constructor(
    private storage: IStorage,
    private pathService: PathMappingService,
    private platformService: PlatformMappingService,
    private archiveService: ArchiveService,
    private rommService: RomMService
  ) {}

  /**
   * Main entry point when a download triggers "Completed" or "Processing" state.
   */
  async processImport(downloadId: string, remoteDownloadPath: string): Promise<void> {
    const config = await this.storage.getImportConfig();
    if (!config.enablePostProcessing) {
      console.log(
        `[ImportManager] Post-processing disabled. Skipping import for download ${downloadId}.`
      );
      await this.storage.updateGameDownloadStatus(downloadId, "completed");
      return;
    }

    const download = await this.storage.getGameDownload(downloadId);

    if (!download) {
      console.warn(`[ImportManager] Download ${downloadId} not found.`);
      return;
    }

    const game = await this.storage.getGame(download.gameId);
    if (!game) {
      console.error(`[ImportManager] Game not found for download ${downloadId}`);
      await this.storage.updateGameDownloadStatus(downloadId, "error");
      return; // Error
    }

    try {
      await this.storage.updateGameDownloadStatus(downloadId, "unpacking"); // Transitional status

      // 1. Path Translation
      // We need the downloader host to properly map paths
      const downloader = await this.storage.getDownloader(download.downloaderId);
      let remoteHost: string | undefined;

      if (downloader) {
        try {
          // Extract hostname from URL
          const url = new URL(downloader.url);
          remoteHost = url.hostname;
        } catch {
          console.warn(`[ImportManager] Invalid downloader URL: ${downloader.url}`);
        }
      }

      const localPath = await this.pathService.translatePath(remoteDownloadPath, remoteHost);

      // 2. Archive Extraction (if enabled and applicable)
      let processingPath = localPath;
      if (config.autoUnpack && this.archiveService.isArchive(localPath)) {
        // Extract to same dir or subdir?
        // Usually extract to a subdir to avoid clutter
        const extractDir = localPath + "_extracted";
        await this.archiveService.extract(localPath, extractDir);
        processingPath = extractDir;
      }

      // 3. Strategy Selection
      let strategy: ImportStrategy;
      const rommPlatform = game.igdbId
        ? await this.platformService.getRomMPlatform(game.igdbId)
        : null;

      if (rommPlatform) {
        strategy = new RomMImportStrategy(rommPlatform);
      } else {
        // Fallback for PC or Unknown
        strategy = new PCImportStrategy();
      }

      const libraryRoot = config.libraryRoot || "/data";

      const plan = await strategy.planImport(processingPath, game, libraryRoot, config);

      if (plan.needsReview) {
        console.log(
          `[ImportManager] Manual review required for ${game.title}: ${plan.reviewReason}`
        );
        await this.storage.updateGameDownloadStatus(downloadId, "manual_review_required");
        return;
      }

      // 5. Execute Import
      await this.storage.updateGameDownloadStatus(downloadId, "completed_pending_import");

      // Check RomM Availability if using RomM strategy
      if (plan.strategy === "romm") {
        const isRommAvailable = await this.rommService.isAvailable();
        if (!isRommAvailable) {
          console.warn(
            "[ImportManager] RomM API not available. Proceeding with import, but scan will fail."
          );
        }
      }

      // Execute
      await strategy.executeImport(plan, config.deleteSource);

      // 6. Cleanup & Finalize
      if (config.deleteSource && processingPath !== localPath) {
        await fs.remove(processingPath);
      }

      await this.storage.updateGameDownloadStatus(downloadId, "imported");
      await this.storage.updateGameStatus(game.id, { status: "completed" }); // Mark game as completed

      // 7. Post-Import Actions (Scan)
      const rommConfig = await this.storage.getRomMConfig();
      if (rommConfig.enabled && plan.strategy === "romm") {
        await this.rommService.scanLibrary(rommPlatform || undefined);
      }
    } catch (err) {
      console.error(`[ImportManager] Import failed for ${downloadId}`, err);
      await this.storage.updateGameDownloadStatus(downloadId, "error");
    }
  }

  /*
   * Method to handle manual confirmation
   */
  async confirmImport(
    downloadId: string,
    overridePlan?: ImportReview & { deleteSource?: boolean }
  ): Promise<void> {
    const download = await this.storage.getGameDownload(downloadId);

    if (!download) {
      throw new Error(`Download ${downloadId} not found`);
    }

    if (!overridePlan) {
      throw new Error("Confirmation requires a plan");
    }

    let resolvedOriginalPath = overridePlan.originalPath;

    if (!resolvedOriginalPath) {
      // Attempt to find the original path via the downloader if not provided by the frontend
      const downloader = await this.storage.getDownloader(download.downloaderId);
      if (downloader) {
        const details = await DownloaderManager.getDownloadDetails(
          downloader,
          download.downloadHash
        );
        if (details && details.downloadDir) {
          const remotePath = `${details.downloadDir}/${details.name}`;
          let remoteHost: string | undefined;
          try {
            const url = new URL(downloader.url);
            remoteHost = url.hostname;
          } catch {
            // ignore
          }
          resolvedOriginalPath = await this.pathService.translatePath(remotePath, remoteHost);
        }
      }
    }

    if (!resolvedOriginalPath) {
      throw new Error("Could not resolve original path for import");
    }

    const game = await this.storage.getGame(download.gameId);
    if (!game) {
      throw new Error(`Game not found for download ${downloadId}`);
    }

    // Execute via the proper strategy
    let strategy: ImportStrategy;
    if (overridePlan.strategy === "romm") {
      const rommPlatform = game.igdbId
        ? await this.platformService.getRomMPlatform(game.igdbId)
        : null;
      strategy = new RomMImportStrategy(rommPlatform || "unknown");
    } else {
      strategy = new PCImportStrategy();
    }

    const planToExecute: ImportReview = {
      ...overridePlan,
      originalPath: resolvedOriginalPath,
    };

    await strategy.executeImport(planToExecute, !!overridePlan.deleteSource);

    const downloadStatus = "imported";
    await this.storage.updateGameDownloadStatus(downloadId, downloadStatus);

    await this.storage.updateGameStatus(game.id, { status: "completed" });

    // Post-Import Actions (Scan RomM library)
    if (overridePlan.strategy === "romm") {
      const rommConfig = await this.storage.getRomMConfig();
      if (rommConfig.enabled) {
        const rommPlatform = game.igdbId
          ? await this.platformService.getRomMPlatform(game.igdbId)
          : null;
        await this.rommService.scanLibrary(rommPlatform || undefined);
      }
    }
  }
}
