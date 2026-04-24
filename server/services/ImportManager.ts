import { type IStorage } from "../storage.js";
import { PathMappingService } from "./PathMappingService.js";
import { PlatformMappingService } from "./PlatformMappingService.js";
import { ArchiveService } from "./ArchiveService.js";
import { ImportStrategy, ImportReview, PCImportStrategy } from "./ImportStrategies.js";
import { DownloaderManager } from "../downloaders.js";
import fs from "fs-extra";
import path from "node:path";
import { parseReleaseMetadata } from "../../shared/title-utils.js";
import { logger } from "../logger.js";

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

export class ImportManager {
  constructor(
    private readonly storage: IStorage,
    private readonly pathService: PathMappingService,
    private readonly _platformService: PlatformMappingService,
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

  private async extractIfArchive(sourcePath: string): Promise<string> {
    if (!this.archiveService.isArchive(sourcePath)) return sourcePath;
    const extractDir = sourcePath + "_extracted";
    await this.archiveService.extract(sourcePath, extractDir);
    return extractDir;
  }

  private extractRemoteHost(downloaderUrl: string): string | undefined {
    try {
      const url = new URL(downloaderUrl);
      return url.hostname;
    } catch {
      console.warn(`[ImportManager] Invalid downloader URL: ${downloaderUrl}`);
      return undefined;
    }
  }

  private async resolveLocalPath(
    remoteDownloadPath: string,
    downloaderId: string
  ): Promise<{ localPath: string; downloaderName: string }> {
    const downloader = await this.storage.getDownloader(downloaderId);
    const remoteHost = downloader ? this.extractRemoteHost(downloader.url) : undefined;
    const downloaderName = downloader?.name ?? downloaderId;
    console.log(
      `[ImportManager] Resolving path "${remoteDownloadPath}" from downloader "${downloaderName}" (host: ${remoteHost ?? "none"})`
    );
    const localPath = await this.pathService.translatePath(remoteDownloadPath, remoteHost);
    return { localPath, downloaderName };
  }

  private shouldSkipPCPlatform(
    _strategy: ImportStrategy,
    downloadTitle: string,
    game: NonNullable<Awaited<ReturnType<IStorage["getGame"]>>>,
    importPlatformIds: number[]
  ): boolean {
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

  private async finalizeImport(
    downloadId: string,
    game: NonNullable<Awaited<ReturnType<IStorage["getGame"]>>>
  ): Promise<void> {
    await this.storage.updateGameDownloadStatus(downloadId, "imported");
    if (game.status !== "completed") {
      await this.storage.updateGameStatus(game.id, { status: "owned" });
    }
  }

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
      await this.storage.updateGameDownloadStatus(downloadId, "unpacking");

      const { localPath, downloaderName } = await this.resolveLocalPath(
        remoteDownloadPath,
        download.downloaderId
      );

      console.log(`[ImportManager] Checking path accessibility: "${localPath}"`);
      if (!(await fs.pathExists(localPath))) {
        console.warn(
          `[ImportManager] Path not accessible: "${localPath}" (reported by downloader "${downloaderName}" as "${remoteDownloadPath}"). ` +
            `If Questarr and ${downloaderName} use different volume mounts, configure path mappings under Settings → Path Mappings.`
        );
        await this.storage.updateGameDownloadStatus(downloadId, "manual_review_required");
        return;
      }

      const processingPath = config.autoUnpack ? await this.extractIfArchive(localPath) : localPath;

      const strategy = new PCImportStrategy();
      const libraryRoot = config.libraryRoot || "/data";

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

      const plan = await strategy.planImport(processingPath, game, libraryRoot, config);

      if (plan.needsReview) {
        console.log(
          `[ImportManager] Manual review required for ${game.title}: ${plan.reviewReason}`
        );
        await this.storage.updateGameDownloadStatus(downloadId, "manual_review_required");
        return;
      }

      await this.storage.updateGameDownloadStatus(downloadId, "completed_pending_import");
      await strategy.executeImport(plan, config.transferMode);

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

  private async resolveConfirmOriginalPath(
    overridePath: string | undefined,
    download: NonNullable<Awaited<ReturnType<IStorage["getGameDownload"]>>>
  ): Promise<string | undefined> {
    if (overridePath) return overridePath;

    const downloader = await this.storage.getDownloader(download.downloaderId);
    if (!downloader) return undefined;

    const details = await DownloaderManager.getDownloadDetails(downloader, download.downloadHash);
    if (!details || !details.downloadDir) return undefined;

    const remotePath = `${details.downloadDir}/${details.name}`;
    const remoteHost = this.extractRemoteHost(downloader.url);
    return this.pathService.translatePath(remotePath, remoteHost);
  }

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

    if (!overridePlan.proposedPath) {
      throw new Error("Proposed path is required for import validation");
    }

    const resolvedRoot = path.resolve(config.libraryRoot);
    const resolvedTarget = path.resolve(overridePlan.proposedPath);
    const insideRoot =
      resolvedTarget === resolvedRoot || resolvedTarget.startsWith(resolvedRoot + path.sep);
    if (!insideRoot) {
      throw new Error("Proposed path is outside configured library root");
    }

    const processPath = overridePlan.unpack
      ? await this.extractIfArchive(resolvedOriginalPath)
      : resolvedOriginalPath;

    const planToExecute: ImportReview = {
      ...overridePlan,
      originalPath: processPath,
    };

    const transferMode = overridePlan.transferMode ?? config.transferMode;

    try {
      const strategy = new PCImportStrategy();
      await strategy.executeImport(planToExecute, transferMode);

      await this.finalizeImport(downloadId, game);
    } catch (err) {
      logger.error({ err, downloadId }, "[ImportManager] confirmImport failed");
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
