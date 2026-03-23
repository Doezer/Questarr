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
import path from "node:path";
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
  "game gear": 35,
  "master system": 64,
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
  gamecube: "ngc",
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
  "game gear": "gamegear",
  "master system": "sms",
  "mega drive": "genesis",
  dreamcast: "dc",
  "atari 2600": "atari2600",
  "neo geo": "neogeoaes",
  pc: "pc",
};

export class ImportManager {
  constructor(
    private readonly storage: IStorage,
    private readonly pathService: PathMappingService,
    private readonly platformService: PlatformMappingService,
    private readonly archiveService: ArchiveService
  ) {}

  private extractPlatformIdFromElement(p: unknown): number | undefined {
    if (typeof p === "number") return p;
    if (typeof p === "string" && /^\d+$/.test(p)) return Number(p);
    if (p && typeof p === "object" && "id" in p) {
      const id = (p as { id?: unknown }).id;
      if (typeof id === "number") return id;
      if (typeof id === "string" && /^\d+$/.test(id)) return Number(id);
    }
    return undefined;
  }

  private getPrimaryPlatformId(game: { platforms?: unknown }): number | undefined {
    if (!Array.isArray(game.platforms)) return undefined;
    for (const p of game.platforms) {
      const platformId = this.extractPlatformIdFromElement(p);
      if (platformId !== undefined) return platformId;
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

  private resolveRommSlug(baseSlug: string | null): string | null {
    if (!baseSlug) return null;
    return baseSlug.trim().toLowerCase();
  }

  private async extractIfArchive(sourcePath: string): Promise<string> {
    if (!this.archiveService.isArchive(sourcePath)) return sourcePath;
    // Extract to a sibling directory with "_extracted" suffix to avoid mixing with the original file.
    const extractDir = sourcePath + "_extracted";
    await this.archiveService.extract(sourcePath, extractDir);
    return extractDir;
  }

  private getProviderLibraryRoot(
    provider: "pc" | "romm",
    configRoot: string,
    rommRoot: string
  ): string {
    return provider === "romm" ? rommRoot || "/data" : configRoot || "/data";
  }

  private async selectProviderForImport(args: {
    game: Awaited<ReturnType<IStorage["getGame"]>>;
    downloadTitle: string;
    config: Awaited<ReturnType<IStorage["getImportConfig"]>>;
    rommConfig: Awaited<ReturnType<IStorage["getRomMConfig"]>>;
  }): Promise<
    | { strategy: PCImportStrategy; provider: "pc" }
    | { strategy: RomMImportStrategy; provider: "romm" }
    | { requiresReview: true; reason: string }
  > {
    const { game, downloadTitle, config: _config, rommConfig } = args;

    if (!game) {
      return { requiresReview: true, reason: "Game not found for import" };
    }

    const gamePrimaryPlatformId = this.getPrimaryPlatformId(game);
    const releasePlatformKey = this.getReleasePlatformKey(downloadTitle || "");
    const releasePlatformId = this.getReleasePlatformIgdbId(releasePlatformKey);
    const effectivePlatformId = releasePlatformId ?? gamePrimaryPlatformId;
    const rommPlatform = effectivePlatformId
      ? await this.platformService.getRomMPlatform(effectivePlatformId)
      : null;
    const fallbackSlugFromRelease = this.getReleasePlatformFallbackSlug(releasePlatformKey);
    const baseRommSlug = rommPlatform ?? fallbackSlugFromRelease;
    const resolvedRommSlug = this.resolveRommSlug(baseRommSlug);

    const slugAllowed =
      !rommConfig.allowedSlugs || rommConfig.allowedSlugs.length === 0
        ? true
        : !!resolvedRommSlug && rommConfig.allowedSlugs.includes(resolvedRommSlug);

    const rommEnabledForPlatform = rommConfig.enabled;

    if (rommEnabledForPlatform && !resolvedRommSlug) {
      return {
        requiresReview: true,
        reason: `missing RomM fs_slug mapping for platform ${effectivePlatformId ?? "unknown"}`,
      };
    }

    if (rommEnabledForPlatform && !slugAllowed) {
      return {
        requiresReview: true,
        reason: `slug ${resolvedRommSlug} is not in allowedSlugs`,
      };
    }

    if (rommEnabledForPlatform && resolvedRommSlug && slugAllowed) {
      return {
        provider: "romm",
        strategy: new RomMImportStrategy(resolvedRommSlug, (result: ImportResult) => {
          console.log(
            `[ImportManager] onRommImportComplete slug=${result.platformSlug} dest=${result.destDir} files=${result.filesPlaced.length}`
          );
        }),
      };
    }

    return { provider: "pc", strategy: new PCImportStrategy() };
  }

  /**
   * Extracts the remote host from a downloader's URL, if available.
   */
  private extractRemoteHost(downloaderUrl: string): string | undefined {
    try {
      const url = new URL(downloaderUrl);
      return url.hostname;
    } catch {
      console.warn(`[ImportManager] Invalid downloader URL: ${downloaderUrl}`);
      return undefined;
    }
  }

  /**
   * Translates a remote download path to a local path using the downloader's host.
   */
  private async resolveLocalPath(
    remoteDownloadPath: string,
    downloaderId: string
  ): Promise<string> {
    const downloader = await this.storage.getDownloader(downloaderId);
    const remoteHost = downloader ? this.extractRemoteHost(downloader.url) : undefined;
    return this.pathService.translatePath(remoteDownloadPath, remoteHost);
  }

  /**
   * Checks if a PC import should be skipped due to platform filtering.
   * Returns true if the import should be skipped.
   */
  private shouldSkipPCPlatform(
    strategy: ImportStrategy,
    downloadTitle: string,
    game: NonNullable<Awaited<ReturnType<IStorage["getGame"]>>>,
    importPlatformIds: number[]
  ): boolean {
    if (!(strategy instanceof PCImportStrategy)) return false;

    const gamePrimaryPlatformId = this.getPrimaryPlatformId(game);
    const releasePlatformKey = this.getReleasePlatformKey(downloadTitle);
    const releasePlatformId = this.getReleasePlatformIgdbId(releasePlatformKey);
    const effectivePlatformId = releasePlatformId ?? gamePrimaryPlatformId;

    if (!this.isPlatformEnabled(effectivePlatformId, importPlatformIds)) {
      console.log(
        `[ImportManager] Skipping import for ${game.title} because platform ${effectivePlatformId ?? "unknown"} is not enabled in general import platform filter.`
      );
      return true;
    }
    return false;
  }

  /**
   * Marks the download and game as imported/owned after a successful import.
   */
  private async finalizeImport(
    downloadId: string,
    game: NonNullable<Awaited<ReturnType<IStorage["getGame"]>>>
  ): Promise<void> {
    await this.storage.updateGameDownloadStatus(downloadId, "imported");
    if (game.status !== "completed") {
      await this.storage.updateGameStatus(game.id, { status: "owned" });
    }
  }

  /**
   * Main entry point for post-download import processing.
   * Called when a download reaches a state that requires file placement.
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
      // Mark as "unpacking" while archive extraction and file placement are in progress.
      await this.storage.updateGameDownloadStatus(downloadId, "unpacking");

      // 1. Path Translation
      const localPath = await this.resolveLocalPath(remoteDownloadPath, download.downloaderId);

      // 2. Archive Extraction (if enabled and applicable)
      const processingPath = config.autoUnpack ? await this.extractIfArchive(localPath) : localPath;

      // 3. Strategy Selection
      const rommConfig = await this.storage.getRomMConfig(game.userId ?? undefined);
      const providerSelection = await this.selectProviderForImport({
        game,
        downloadTitle: download.downloadTitle || "",
        config,
        rommConfig,
      });

      if ("requiresReview" in providerSelection) {
        console.log(
          `[ImportManager] Manual review required for ${game.title}: ${providerSelection.reason}.`
        );
        await this.storage.updateGameDownloadStatus(downloadId, "manual_review_required");
        return;
      }

      const strategy = providerSelection.strategy;
      const libraryRoot = this.getProviderLibraryRoot(
        providerSelection.provider,
        config.libraryRoot,
        rommConfig.libraryRoot
      );

      if (
        this.shouldSkipPCPlatform(
          strategy,
          download.downloadTitle || "",
          game,
          config.importPlatformIds
        )
      ) {
        await this.storage.updateGameDownloadStatus(downloadId, "completed");
        return;
      }

      await fs.ensureDir(libraryRoot);

      const plan = await strategy.planImport(processingPath, game, libraryRoot, config, rommConfig);

      if (plan.needsReview) {
        console.log(
          `[ImportManager] Manual review required for ${game.title}: ${plan.reviewReason}`
        );
        await this.storage.updateGameDownloadStatus(downloadId, "manual_review_required");
        return;
      }

      // 4. Execute Import
      await this.storage.updateGameDownloadStatus(downloadId, "completed_pending_import");
      const transferMode =
        strategy instanceof RomMImportStrategy ? rommConfig.moveMode : config.transferMode;
      await strategy.executeImport(plan, transferMode, rommConfig);

      // 5. Cleanup & Finalize
      if (processingPath !== localPath) {
        await fs.remove(processingPath);
      }

      await this.finalizeImport(downloadId, game);
    } catch (err) {
      console.error(`[ImportManager] Import failed for ${downloadId}`, err);
      try {
        await this.storage.updateGameDownloadStatus(downloadId, "error");
      } catch (statusErr) {
        console.error(`[ImportManager] Failed to set error status for ${downloadId}`, statusErr);
      }
    }
  }

  /**
   * Resolves the original path for an import confirmation, either from the override plan
   * or by querying the downloader for the download details.
   */
  private async resolveConfirmOriginalPath(
    overridePath: string | undefined,
    download: NonNullable<Awaited<ReturnType<IStorage["getGameDownload"]>>>
  ): Promise<string | undefined> {
    if (overridePath) return overridePath;

    // Attempt to find the original path via the downloader if not provided by the frontend
    const downloader = await this.storage.getDownloader(download.downloaderId);
    if (!downloader) return undefined;

    const details = await DownloaderManager.getDownloadDetails(downloader, download.downloadHash);
    if (!details || !details.downloadDir) return undefined;

    const remotePath = `${details.downloadDir}/${details.name}`;
    const remoteHost = this.extractRemoteHost(downloader.url);
    return this.pathService.translatePath(remotePath, remoteHost);
  }

  /**
   * Builds the appropriate import strategy for a confirm import based on the override plan's strategy type.
   */
  private async buildConfirmStrategy(
    strategyType: "pc" | "romm",
    downloadTitle: string,
    game: NonNullable<Awaited<ReturnType<IStorage["getGame"]>>>
  ): Promise<ImportStrategy> {
    if (strategyType !== "romm") {
      return new PCImportStrategy();
    }

    const releasePlatformKey = this.getReleasePlatformKey(downloadTitle);
    const releasePlatformId = this.getReleasePlatformIgdbId(releasePlatformKey);
    const gamePrimaryPlatformId = this.getPrimaryPlatformId(game);
    const effectivePlatformId = releasePlatformId ?? gamePrimaryPlatformId;
    const rommPlatform = effectivePlatformId
      ? await this.platformService.getRomMPlatform(effectivePlatformId)
      : null;
    const fallbackSlugFromRelease = this.getReleasePlatformFallbackSlug(releasePlatformKey);
    const baseSlug = rommPlatform || fallbackSlugFromRelease || "unknown";
    const resolvedSlug = this.resolveRommSlug(baseSlug) || baseSlug;
    return new RomMImportStrategy(resolvedSlug);
  }

  /**
   * Validates that a proposed import path is within the configured library root.
   */
  private validateProposedPath(
    proposedPath: string | undefined,
    strategyType: "pc" | "romm",
    configRoot: string,
    rommRoot: string
  ): void {
    if (!proposedPath) return;

    const root = strategyType === "romm" ? rommRoot : configRoot;
    const resolvedRoot = path.resolve(root);
    const resolvedTarget = path.resolve(proposedPath);
    const insideRoot =
      resolvedTarget === resolvedRoot || resolvedTarget.startsWith(resolvedRoot + path.sep);
    if (!insideRoot) {
      throw new Error("Proposed path is outside configured library root");
    }
  }

  /**
   * Handles manual confirmation of an import that was flagged for review.
   * The user provides an override plan specifying strategy, target path, and transfer mode.
   */
  async confirmImport(
    downloadId: string,
    overridePlan?: ImportReview & {
      transferMode?: "move" | "copy" | "hardlink" | "symlink";
      unpack?: boolean;
    },
    callerUserId?: string
  ): Promise<void> {
    const download = await this.storage.getGameDownload(downloadId, callerUserId);

    if (!download) {
      throw new Error(`Download ${downloadId} not found`);
    }

    if (!overridePlan) {
      throw new Error("Confirmation requires a plan");
    }

    const resolvedOriginalPath = await this.resolveConfirmOriginalPath(
      overridePlan.originalPath,
      download
    );

    if (!resolvedOriginalPath) {
      throw new Error("Could not resolve original path for import");
    }

    const game = await this.storage.getGame(download.gameId);
    if (!game) {
      throw new Error(`Game not found for download ${downloadId}`);
    }

    const config = await this.storage.getImportConfig(game.userId ?? undefined);
    const rommConfig = await this.storage.getRomMConfig(game.userId ?? undefined);

    const strategy = await this.buildConfirmStrategy(
      overridePlan.strategy,
      download.downloadTitle || "",
      game
    );

    this.validateProposedPath(
      overridePlan.proposedPath,
      overridePlan.strategy,
      config.libraryRoot,
      rommConfig.libraryRoot
    );

    const processPath = overridePlan.unpack
      ? await this.extractIfArchive(resolvedOriginalPath)
      : resolvedOriginalPath;

    const planToExecute: ImportReview = {
      ...overridePlan,
      originalPath: processPath,
    };

    const transferMode =
      overridePlan.transferMode ??
      (overridePlan.strategy === "romm" ? rommConfig.moveMode : config.transferMode);

    try {
      await strategy.executeImport(planToExecute, transferMode, rommConfig);

      await this.finalizeImport(downloadId, game);
    } catch (err) {
      console.error(`[ImportManager] confirmImport failed for ${downloadId}`, err);
      try {
        await this.storage.updateGameDownloadStatus(downloadId, "error");
      } catch (statusErr) {
        console.error(`[ImportManager] Failed to set error status for ${downloadId}`, statusErr);
      }
      throw err;
    } finally {
      if (processPath !== resolvedOriginalPath) {
        await fs.remove(processPath);
      }
    }
  }
}
