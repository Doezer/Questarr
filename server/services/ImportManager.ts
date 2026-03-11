import { type IStorage } from "../storage.js";
import { PathMappingService } from "./PathMappingService.js";
import { PlatformMappingService } from "./PlatformMappingService.js";
import { ArchiveService } from "./ArchiveService.js";
import {
  ImportStrategy,
  ImportReview,
  ImportResult,
  PCImportStrategy,
  RomMImportStrategy,
} from "./ImportStrategies.js";
import { DownloaderManager } from "../downloaders.js";
import fs from "fs-extra";
import path from "path";
import { parseReleaseMetadata } from "../../shared/title-utils.js";

const RELEASE_PLATFORM_TO_IGDB_ID: Record<string, number> = {
  nes: 18,
  snes: 19,
  n64: 4,
  gamecube: 21,
  wii: 5,
  gb: 33,
  gbc: 22,
  gba: 24,
  nds: 20,
  "3ds": 37,
  switch: 130,
  ps1: 7,
  ps2: 8,
  ps3: 9,
  psp: 38,
  "master system": 35,
  "mega drive": 29,
  dreamcast: 23,
  "atari 2600": 59,
  "neo geo": 80,
  pc: 6,
};

const RELEASE_PLATFORM_TO_FALLBACK_SLUG: Record<string, string> = {
  nes: "nes",
  snes: "snes",
  n64: "n64",
  gamecube: "gc",
  wii: "wii",
  gb: "gb",
  gbc: "gbc",
  gba: "gba",
  nds: "nds",
  "3ds": "3ds",
  switch: "switch",
  ps1: "psx",
  ps2: "ps2",
  ps3: "ps3",
  psp: "psp",
  "master system": "sms",
  "mega drive": "megadrive",
  dreamcast: "dc",
  "atari 2600": "a2600",
  "neo geo": "neogeo",
  pc: "pc",
};

export class ImportManager {
  constructor(
    private storage: IStorage,
    private pathService: PathMappingService,
    private platformService: PlatformMappingService,
    private archiveService: ArchiveService
  ) {}

  private getPrimaryPlatformId(game: { platforms?: unknown }): number | undefined {
    if (!Array.isArray(game.platforms)) return undefined;
    for (const p of game.platforms) {
      if (typeof p === "number") return p;
      if (typeof p === "string" && /^\d+$/.test(p)) return Number(p);
      if (p && typeof p === "object" && "id" in p) {
        const id = (p as { id?: unknown }).id;
        if (typeof id === "number") return id;
        if (typeof id === "string" && /^\d+$/.test(id)) return Number(id);
      }
    }
    return undefined;
  }

  private isPlatformEnabled(platformId: number | undefined, allowed: number[]): boolean {
    if (!platformId) return allowed.length === 0;
    return allowed.length === 0 || allowed.includes(platformId);
  }

  private getReleasePlatformKey(downloadTitle: string): string | null {
    const parsed = parseReleaseMetadata(downloadTitle);
    if (!parsed.platform) return null;
    return parsed.platform.trim().toLowerCase();
  }

  private getReleasePlatformIgdbId(releasePlatformKey: string | null): number | undefined {
    if (!releasePlatformKey) return undefined;
    return RELEASE_PLATFORM_TO_IGDB_ID[releasePlatformKey];
  }

  private getReleasePlatformFallbackSlug(releasePlatformKey: string | null): string | null {
    if (!releasePlatformKey) return null;
    return RELEASE_PLATFORM_TO_FALLBACK_SLUG[releasePlatformKey] ?? null;
  }

  private resolveRommSlug(baseSlug: string | null, aliases: Record<string, string>): string | null {
    if (!baseSlug) return null;
    const key = baseSlug.trim().toLowerCase();
    const alias = aliases[key] ?? aliases[baseSlug] ?? null;
    return (alias ?? baseSlug).trim().toLowerCase();
  }

  /**
   * Main entry point when a download triggers "Completed" or "Processing" state.
   */
  async processImport(downloadId: string, remoteDownloadPath: string): Promise<void> {
    const download = await this.storage.getGameDownload(downloadId);
    if (!download) {
      console.warn(`[ImportManager] Download ${downloadId} not found.`);
      return;
    }

    const game = await this.storage.getGame(download.gameId);
    if (!game) {
      console.error(`[ImportManager] Game not found for download ${downloadId}`);
      await this.storage.updateGameDownloadStatus(downloadId, "error");
      return;
    }

    const config = await this.storage.getImportConfig(game.userId ?? undefined);
    if (!config.enablePostProcessing) {
      console.log(
        `[ImportManager] Post-processing disabled. Skipping import for download ${downloadId}.`
      );
      await this.storage.updateGameDownloadStatus(downloadId, "completed");
      return;
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
      const rommConfig = await this.storage.getRomMConfig(game.userId ?? undefined);
      const gamePrimaryPlatformId = this.getPrimaryPlatformId(game);
      const releasePlatformKey = this.getReleasePlatformKey(download.downloadTitle || "");
      const releasePlatformId = this.getReleasePlatformIgdbId(releasePlatformKey);
      const effectivePlatformId = releasePlatformId ?? gamePrimaryPlatformId;
      const rommPlatform = effectivePlatformId
        ? await this.platformService.getRomMPlatform(effectivePlatformId)
        : null;

      const fallbackSlugFromRelease = this.getReleasePlatformFallbackSlug(releasePlatformKey);
      const baseRommSlug = rommPlatform ?? fallbackSlugFromRelease;
      const resolvedRommSlug = this.resolveRommSlug(baseRommSlug, rommConfig.platformAliases);
      const slugAllowed =
        !rommConfig.allowedSlugs || rommConfig.allowedSlugs.length === 0
          ? true
          : !!resolvedRommSlug && rommConfig.allowedSlugs.includes(resolvedRommSlug);
      const integrationEnabledForPlatform =
        rommConfig.enabled &&
        config.integrationProvider === "romm" &&
        this.isPlatformEnabled(effectivePlatformId, config.integrationPlatformIds);

      if (integrationEnabledForPlatform && !resolvedRommSlug) {
        console.log(
          `[ImportManager] Manual review required for ${game.title}: missing RomM fs_slug mapping for platform ${effectivePlatformId ?? "unknown"}.`
        );
        await this.storage.updateGameDownloadStatus(downloadId, "manual_review_required");
        return;
      }

      if (integrationEnabledForPlatform && !slugAllowed) {
        console.log(
          `[ImportManager] Manual review required for ${game.title}: slug ${resolvedRommSlug} is not in allowedSlugs.`
        );
        await this.storage.updateGameDownloadStatus(downloadId, "manual_review_required");
        return;
      }

      const shouldUseIntegration =
        integrationEnabledForPlatform && !!resolvedRommSlug && slugAllowed;

      if (shouldUseIntegration) {
        strategy = new RomMImportStrategy(resolvedRommSlug as string, (result: ImportResult) => {
          console.log(
            `[ImportManager] onRommImportComplete slug=${result.platformSlug} dest=${result.destDir} files=${result.filesPlaced.length}`
          );
        });
      } else {
        // Fallback for PC or Unknown
        strategy = new PCImportStrategy();
      }

      const libraryRoot =
        strategy instanceof RomMImportStrategy
          ? rommConfig.libraryRoot || config.integrationLibraryRoot || "/data"
          : config.libraryRoot || "/data";

      if (strategy instanceof PCImportStrategy) {
        const platformAllowed = this.isPlatformEnabled(
          effectivePlatformId,
          config.importPlatformIds
        );
        if (!platformAllowed) {
          console.log(
            `[ImportManager] Skipping import for ${game.title} because platform ${effectivePlatformId ?? "unknown"} is not enabled in general import platform filter.`
          );
          await this.storage.updateGameDownloadStatus(downloadId, "completed");
          return;
        }
      }

      const plan = await strategy.planImport(processingPath, game, libraryRoot, config, rommConfig);

      if (plan.needsReview) {
        console.log(
          `[ImportManager] Manual review required for ${game.title}: ${plan.reviewReason}`
        );
        await this.storage.updateGameDownloadStatus(downloadId, "manual_review_required");
        return;
      }

      // 5. Execute Import
      await this.storage.updateGameDownloadStatus(downloadId, "completed_pending_import");

      // Execute
      const transferMode =
        strategy instanceof RomMImportStrategy ? rommConfig.moveMode : config.transferMode;
      await strategy.executeImport(plan, transferMode, rommConfig);

      // 6. Cleanup & Finalize
      if (transferMode === "move" && processingPath !== localPath) {
        await fs.remove(processingPath);
      }

      await this.storage.updateGameDownloadStatus(downloadId, "imported");
      if (game.status !== "completed") {
        await this.storage.updateGameStatus(game.id, { status: "owned" });
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
    overridePlan?: ImportReview & { transferMode?: "move" | "copy" | "hardlink" | "symlink" }
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

    const config = await this.storage.getImportConfig(game.userId ?? undefined);
    const rommConfig = await this.storage.getRomMConfig(game.userId ?? undefined);

    // Execute via the proper strategy
    let strategy: ImportStrategy;
    if (overridePlan.strategy === "romm") {
      const releasePlatformKey = this.getReleasePlatformKey(download.downloadTitle || "");
      const releasePlatformId = this.getReleasePlatformIgdbId(releasePlatformKey);
      const gamePrimaryPlatformId = this.getPrimaryPlatformId(game);
      const effectivePlatformId = releasePlatformId ?? gamePrimaryPlatformId;
      const rommPlatform = effectivePlatformId
        ? await this.platformService.getRomMPlatform(effectivePlatformId)
        : null;
      const fallbackSlugFromRelease = this.getReleasePlatformFallbackSlug(releasePlatformKey);
      strategy = new RomMImportStrategy(rommPlatform || fallbackSlugFromRelease || "unknown");
    } else {
      strategy = new PCImportStrategy();
    }

    if (overridePlan.proposedPath) {
      const root =
        overridePlan.strategy === "romm"
          ? rommConfig.libraryRoot || config.integrationLibraryRoot
          : config.libraryRoot;
      const resolvedRoot = path.resolve(root);
      const resolvedTarget = path.resolve(overridePlan.proposedPath);
      const insideRoot =
        resolvedTarget === resolvedRoot || resolvedTarget.startsWith(resolvedRoot + path.sep);
      if (!insideRoot) {
        throw new Error("Proposed path is outside configured library root");
      }
    }

    const planToExecute: ImportReview = {
      ...overridePlan,
      originalPath: resolvedOriginalPath,
    };

    const transferMode =
      overridePlan.transferMode ??
      (overridePlan.strategy === "romm" ? rommConfig.moveMode : config.transferMode);
    await strategy.executeImport(planToExecute, transferMode, rommConfig);

    const downloadStatus = "imported";
    await this.storage.updateGameDownloadStatus(downloadId, downloadStatus);

    if (game.status !== "completed") {
      await this.storage.updateGameStatus(game.id, { status: "owned" });
    }
  }
}
