import { type IStorage } from "../storage.js";
import { PathMappingService } from "./PathMappingService.js";
import { PlatformMappingService } from "./PlatformMappingService.js";
import { ArchiveService } from "./ArchiveService.js";
import {
  ImportStrategy,
  ImportReview,
  PCImportStrategy,
  sanitizeFsName,
} from "./ImportStrategies.js";
import { DownloaderManager } from "../downloaders.js";
import fs from "fs-extra";
import path from "node:path";
import { parseReleaseMetadata } from "../../shared/title-utils.js";
import { logger } from "../logger.js";
import { extractHostnameFromUrl } from "../url-utils.js";
import { isSensitivePath } from "../path-security.js";

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

const PLATFORM_FOLDER_NAMES: Record<string, string> = {
  nes: "NES",
  snes: "SNES",
  n64: "N64",
  gamecube: "GameCube",
  wii: "Wii",
  gb: "Game Boy",
  gbc: "Game Boy Color",
  gba: "Game Boy Advance",
  nds: "Nintendo DS",
  "3ds": "Nintendo 3DS",
  switch: "Switch",
  ps1: "PlayStation",
  ps2: "PS2",
  ps3: "PS3",
  psp: "PSP",
  "game gear": "Game Gear",
  "master system": "Master System",
  "mega drive": "Mega Drive",
  dreamcast: "Dreamcast",
  "atari 2600": "Atari 2600",
  "neo geo": "Neo Geo",
  pc: "PC",
};

const IGDB_ID_TO_PLATFORM_KEY: Record<number, string> = Object.fromEntries(
  Object.entries(RELEASE_PLATFORM_TO_IGDB_ID).map(([key, id]) => [id, key])
);

const MAX_PATH_RETRY = 5;
const MAX_LISTED_FILES = 100;

export class ImportManager {
  private readonly pathRetryCount = new Map<string, number>();

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

  private resolvePlatformFolderName(downloadTitle: string, game: { platforms?: unknown }): string {
    const key = this.getReleasePlatformKey(downloadTitle);
    if (key && PLATFORM_FOLDER_NAMES[key]) return PLATFORM_FOLDER_NAMES[key];

    const igdbId = this.getPrimaryPlatformId(game);
    if (igdbId !== undefined) {
      const igdbKey = IGDB_ID_TO_PLATFORM_KEY[igdbId];
      if (igdbKey && PLATFORM_FOLDER_NAMES[igdbKey]) return PLATFORM_FOLDER_NAMES[igdbKey];
    }

    return "PC";
  }

  private async extractIfArchive(sourcePath: string): Promise<string> {
    if (this.archiveService.isArchive(sourcePath)) {
      const extractDir = sourcePath + "_extracted";
      await this.archiveService.extract(sourcePath, extractDir);
      return extractDir;
    }

    // Directory: scan for archive files inside (handles torrent dirs containing .rar etc.)
    const stats = await fs.stat(sourcePath);
    if (!stats.isDirectory()) return sourcePath;

    const entries = await fs.readdir(sourcePath);
    const archiveEntries = entries
      .filter((name: string) => this.archiveService.isArchive(name))
      .sort();
    if (archiveEntries.length === 0) return sourcePath;

    // 7zip handles multi-part archives when given the first part
    const mainArchive = path.join(sourcePath, archiveEntries[0]);
    const extractDir = sourcePath + "_extracted";
    await this.archiveService.extract(mainArchive, extractDir);
    return extractDir;
  }

  private async readSourceFiles(sourcePath: string): Promise<{
    files: Array<{ name: string; isArchive: boolean }>;
    hasArchive: boolean;
    totalCount: number;
  }> {
    const empty = { files: [], hasArchive: false, totalCount: 0 };
    if (isSensitivePath(sourcePath)) return empty;
    try {
      const resolved = path.resolve(sourcePath);
      const stats = await fs.stat(resolved);
      let allNames: string[];
      if (stats.isDirectory()) {
        allNames = (await fs.readdir(resolved)).sort();
      } else {
        allNames = [path.basename(resolved)];
      }
      const totalCount = allNames.length;
      const capped = allNames.slice(0, MAX_LISTED_FILES);
      const files = capped.map((name) => ({
        name,
        isArchive: this.archiveService.isArchive(name),
      }));
      // Check hasArchive across all entries, not just the capped slice
      const hasArchive = allNames.some((name) => this.archiveService.isArchive(name));
      return { files, hasArchive, totalCount };
    } catch {
      return empty;
    }
  }

  private extractRemoteHost(downloaderUrl: string): string | undefined {
    const remoteHost = extractHostnameFromUrl(downloaderUrl);
    if (!remoteHost) {
      logger.warn({ downloaderUrl }, "Invalid downloader URL");
    }
    return remoteHost ?? undefined;
  }

  private async resolveLocalPath(
    remoteDownloadPath: string,
    downloaderId: string
  ): Promise<{ localPath: string; downloaderName: string }> {
    const downloader = await this.storage.getDownloader(downloaderId);
    const remoteHost = downloader ? this.extractRemoteHost(downloader.url) : undefined;
    const downloaderName = downloader?.name ?? downloaderId;
    logger.debug(
      { remoteDownloadPath, downloaderName, remoteHost },
      "[ImportManager] Resolving path"
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
      logger.info(
        { gameTitle: game.title, effectivePlatformId },
        "[ImportManager] Skipping import: platform not in filter"
      );
      return true;
    }
    return false;
  }

  private async finalizeImport(
    downloadId: string,
    game: NonNullable<Awaited<ReturnType<IStorage["getGame"]>>>,
    libraryPath: string
  ): Promise<void> {
    await this.storage.updateGameDownloadStatus(downloadId, "imported");
    await this.storage.updateGame(game.id, { libraryPath });
    if (game.status !== "owned") {
      await this.storage.updateGameStatus(game.id, { status: "owned" });
    }
  }

  private async verifyLocalPath(
    downloadId: string,
    localPath: string,
    meta: { downloaderName: string; remoteDownloadPath: string }
  ): Promise<boolean> {
    if (await fs.pathExists(localPath)) {
      this.pathRetryCount.delete(downloadId);
      return true;
    }
    const retries = (this.pathRetryCount.get(downloadId) ?? 0) + 1;
    if (retries < MAX_PATH_RETRY) {
      this.pathRetryCount.set(downloadId, retries);
      logger.warn(
        {
          localPath,
          downloaderName: meta.downloaderName,
          remoteDownloadPath: meta.remoteDownloadPath,
          retry: retries,
          maxRetry: MAX_PATH_RETRY,
        },
        "[ImportManager] Path not accessible — retrying next cycle"
      );
      await this.storage.updateGameDownloadStatus(downloadId, "downloading");
      return false;
    }
    this.pathRetryCount.delete(downloadId);
    logger.warn(
      {
        localPath,
        downloaderName: meta.downloaderName,
        remoteDownloadPath: meta.remoteDownloadPath,
      },
      "[ImportManager] Path not accessible after retries — check path mappings under Settings → Path Mappings"
    );
    await this.storage.updateGameDownloadStatus(downloadId, "manual_review_required");
    return false;
  }

  private async performAutoDelete(
    downloadId: string,
    download: NonNullable<Awaited<ReturnType<IStorage["getGameDownload"]>>>,
    game: NonNullable<Awaited<ReturnType<IStorage["getGame"]>>>
  ): Promise<void> {
    const downloader = await this.storage.getDownloader(download.downloaderId);
    if (!downloader) {
      logger.warn(
        { downloadId, downloaderId: download.downloaderId },
        "[ImportManager] Auto-delete skipped — downloader not found"
      );
      return;
    }
    if (!download.downloadHash) {
      logger.warn({ downloadId }, "[ImportManager] Auto-delete skipped — download has no hash");
      return;
    }
    const result = await DownloaderManager.removeDownload(downloader, download.downloadHash, true);
    if (!result.success) {
      logger.warn(
        { downloadId, downloadHash: download.downloadHash, reason: result.message },
        "[ImportManager] Auto-delete after import failed"
      );
      await this.storage
        .addNotification({
          userId: game.userId ?? "",
          type: "warning",
          title: "Auto-delete failed",
          message: `"${game.title}" was imported successfully, but removing it from the download client failed: ${result.message ?? "unknown error"}. Please remove it manually.`,
        })
        .catch((notifErr) =>
          logger.error(
            { notifErr, downloadId },
            "[ImportManager] Failed to create auto-delete notification"
          )
        );
    }
  }

  async processImport(downloadId: string, remoteDownloadPath: string): Promise<void> {
    const download = await this.storage.getGameDownload(downloadId);
    if (!download) {
      logger.warn({ downloadId }, "[ImportManager] Download not found");
      return;
    }

    const game = await this.storage.getGame(download.gameId);
    if (!game) {
      logger.error({ downloadId }, "[ImportManager] Game not found for download");
      await this.storage.updateGameDownloadStatus(downloadId, "error");
      return;
    }

    const config = await this.storage.getImportConfig(game.userId ?? undefined);
    if (!config.enablePostProcessing) {
      logger.info({ downloadId }, "[ImportManager] Post-processing disabled, skipping");
      await this.storage.updateGameDownloadStatus(downloadId, "completed");
      return;
    }

    let localPath: string | undefined;
    let processingPath: string | undefined;

    try {
      await this.storage.updateGameDownloadStatus(downloadId, "unpacking");

      const resolved = await this.resolveLocalPath(remoteDownloadPath, download.downloaderId);
      localPath = resolved.localPath;
      const downloaderName = resolved.downloaderName;

      logger.debug({ localPath }, "[ImportManager] Checking path accessibility");
      if (
        !(await this.verifyLocalPath(downloadId, localPath, { downloaderName, remoteDownloadPath }))
      ) {
        return;
      }

      processingPath = config.autoUnpack ? await this.extractIfArchive(localPath) : localPath;

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

      const platformDir = this.resolvePlatformFolderName(download.downloadTitle || "", game);
      const plan = await strategy.planImport(
        processingPath,
        game,
        libraryRoot,
        config,
        platformDir
      );

      if (plan.needsReview) {
        logger.info(
          { gameTitle: game.title, reviewReason: plan.reviewReason },
          "[ImportManager] Manual review required"
        );
        await this.storage.updateGameDownloadStatus(downloadId, "manual_review_required");
        return;
      }

      await this.storage.updateGameDownloadStatus(downloadId, "completed_pending_import");
      const result = await strategy.executeImport(plan, config.transferMode);

      if (processingPath !== localPath) {
        await fs.remove(processingPath);
      }

      await this.finalizeImport(downloadId, game, result.destDir);

      if (
        config.autoDeleteAfterImport &&
        (config.transferMode === "copy" || config.transferMode === "move")
      ) {
        await this.performAutoDelete(downloadId, download, game);
      }
    } catch (err) {
      logger.error({ err, downloadId }, "[ImportManager] Import failed");
      if (processingPath && localPath && processingPath !== localPath) {
        await fs.remove(processingPath).catch(() => undefined);
      }
      try {
        await this.storage.updateGameDownloadStatus(downloadId, "error");
      } catch (statusErr) {
        logger.error({ statusErr, downloadId }, "[ImportManager] Failed to set error status");
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
    if (!details?.downloadDir) return undefined;

    const remotePath = `${details.downloadDir}/${details.name}`;
    const remoteHost = this.extractRemoteHost(downloader.url);
    return this.pathService.translatePath(remotePath, remoteHost);
  }

  async planConfirmImport(
    downloadId: string,
    overrideSourcePath?: string,
    callerUserId?: string
  ): Promise<{
    originalPath: string | null;
    proposedPath: string;
    files: Array<{ name: string; isArchive: boolean }>;
    hasArchive: boolean;
    totalCount: number;
  }> {
    const download = await this.storage.getGameDownload(downloadId, callerUserId);
    if (!download) throw new Error(`Download ${downloadId} not found`);

    const game = await this.storage.getGame(download.gameId);
    if (!game) throw new Error(`Game not found for download ${downloadId}`);

    const config = await this.storage.getImportConfig(game.userId ?? undefined);
    const libraryRoot = config.libraryRoot || "/data";

    let resolvedOriginalPath: string | null = null;
    try {
      resolvedOriginalPath =
        (await this.resolveConfirmOriginalPath(overrideSourcePath, download)) ?? null;
    } catch {
      // Source resolution failed — still return a proposed path based on game title
    }

    const platformDir = this.resolvePlatformFolderName(download.downloadTitle || "", game);
    const fallbackProposedPath = path.join(libraryRoot, platformDir, sanitizeFsName(game.title));

    if (resolvedOriginalPath) {
      const { files, hasArchive, totalCount } = await this.readSourceFiles(resolvedOriginalPath);
      try {
        const strategy = new PCImportStrategy();
        const plan = await strategy.planImport(
          resolvedOriginalPath,
          game,
          libraryRoot,
          config,
          platformDir
        );
        return {
          originalPath: resolvedOriginalPath,
          proposedPath: plan.proposedPath,
          files,
          hasArchive,
          totalCount,
        };
      } catch {
        // Source not yet accessible (e.g. still in incomplete folder) — path is known but can't be stat'd
        return {
          originalPath: resolvedOriginalPath,
          proposedPath: fallbackProposedPath,
          files,
          hasArchive,
          totalCount,
        };
      }
    }

    return {
      originalPath: null,
      proposedPath: fallbackProposedPath,
      files: [],
      hasArchive: false,
      totalCount: 0,
    };
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
      throw new Error(
        "Source path could not be resolved — the download may no longer be tracked by the download client. Please specify the source path manually."
      );
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
      const result = await strategy.executeImport(planToExecute, transferMode);

      await this.finalizeImport(downloadId, game, result.destDir);
    } catch (err) {
      logger.error({ err, downloadId }, "[ImportManager] confirmImport failed");
      try {
        await this.storage.updateGameDownloadStatus(downloadId, "error");
      } catch (statusErr) {
        logger.error({ statusErr, downloadId }, "[ImportManager] Failed to set error status");
      }
      throw err;
    } finally {
      if (processPath !== resolvedOriginalPath) {
        await fs.remove(processPath);
      }
    }
  }
}
