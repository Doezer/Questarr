import { type IStorage } from "../storage.js";
import { PathMappingService } from "./PathMappingService.js";
import { PlatformMappingService } from "./PlatformMappingService.js";
import { ArchiveService, ArchivePasswordRequiredError } from "./ArchiveService.js";
import {
  ImportStrategy,
  ImportReview,
  ImportResult,
  PCImportStrategy,
  TransferMode,
  sanitizeFsName,
  gatherFiles,
  reorganizeBySortExtras,
} from "./ImportStrategies.js";
import { DownloaderManager } from "../downloaders.js";
import { resolveDownloadRelativePath, buildRemoteImportPath } from "../downloaders/utils.js";
import fs from "fs-extra";
import path from "node:path";
import { parseReleaseMetadata } from "../../shared/title-utils.js";
import { GAME_LINK_REQUIRED_STATUS } from "../../shared/schema.js";
import { logger } from "../logger.js";
import { extractHostnameFromUrl } from "../url-utils.js";
import { isSensitivePath, assertWithinRoots } from "../path-security.js";
import { notifyUser } from "../socket.js";

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

// Prefixes a game_downloads.error_message value to mark it as an ArchivePasswordRequiredError
// rather than a generic failure, without a dedicated schema column. GET /api/imports/pending
// strips this prefix and turns its presence into a `passwordRequired` flag so the manual-review
// UI can show a password field instead of the normal path-review form.
export const ARCHIVE_PASSWORD_REQUIRED_PREFIX = "ARCHIVE_PASSWORD_REQUIRED:";

interface ArchiveResolution {
  archivePath: string;
  isDirectorySource: boolean;
  alreadyExtracted: boolean;
  excludePaths: Set<string>;
  hasRemainingFiles: boolean;
}

export class ImportManager {
  private readonly pathRetryCount = new Map<string, number>();

  constructor(
    private readonly storage: IStorage,
    private readonly pathService: PathMappingService,
    _platformService: PlatformMappingService,
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

  // Renders a caught error for storage in game_downloads.error_message, tagging an
  // ArchivePasswordRequiredError with ARCHIVE_PASSWORD_REQUIRED_PREFIX so the pending-imports
  // API can turn it into a `passwordRequired` flag instead of a generic failure message.
  private formatErrorMessage(err: unknown): string {
    const message = err instanceof Error ? err.message : String(err);
    return err instanceof ArchivePasswordRequiredError
      ? `${ARCHIVE_PASSWORD_REQUIRED_PREFIX}${message}`
      : message;
  }

  /**
   * Resolves the archive (if any) relevant to a source path, without
   * extracting or moving anything. Directory sources are scanned for the
   * first archive entry (7zip/unrar handle multi-part volumes given the
   * first part); already-extracted detection and volume-sibling exclusion
   * are only meaningful for directory sources, since a lone file has no
   * reliable sibling scope to check against.
   */
  private async resolveArchive(sourcePath: string): Promise<ArchiveResolution | null> {
    if (isSensitivePath(sourcePath)) {
      throw new Error("Refusing to process a sensitive system path");
    }

    await assertWithinRoots(
      sourcePath,
      await this.pathService.getConfiguredRoots(),
      "Refusing to process a path outside the configured downloader roots"
    );

    const stats = await fs.stat(sourcePath);

    if (!stats.isDirectory()) {
      if (!this.archiveService.isArchive(sourcePath)) return null;
      return {
        archivePath: sourcePath,
        isDirectorySource: false,
        alreadyExtracted: false,
        excludePaths: new Set(),
        hasRemainingFiles: false,
      };
    }

    const entries = await fs.readdir(sourcePath);
    const archiveEntries = entries.filter((name) => this.archiveService.isArchive(name)).sort();
    if (archiveEntries.length === 0) return null;

    // Lexicographic sort puts "Game.r00" before "Game.rar" (since '0' < 'a'), but
    // 7-Zip/unrar expect the plain .rar file as the entry point for classic RAR
    // multi-volume sets — .r00/.r01/... are continuations, not the first volume. Only
    // promote a .rar when the current first entry is actually one of ITS continuations
    // (same stem) — otherwise an unrelated .rar elsewhere in the directory (a second,
    // independent archive set) could jump the queue ahead of a correctly-ordered one.
    const continuationMatch = /^(.*)\.r\d{2,3}$/i.exec(archiveEntries[0]);
    if (continuationMatch) {
      const stem = continuationMatch[1].toLowerCase();
      const primaryRarIndex = archiveEntries.findIndex(
        (name) => /\.rar$/i.test(name) && name.slice(0, -".rar".length).toLowerCase() === stem
      );
      if (primaryRarIndex > 0) {
        const [primaryRar] = archiveEntries.splice(primaryRarIndex, 1);
        archiveEntries.unshift(primaryRar);
      }
    }

    // 7zip/unrar handle multi-part archives when given the first part.
    const mainArchive = path.join(sourcePath, archiveEntries[0]);
    const allAbsolutePaths = entries.map((name) => path.join(sourcePath, name));
    const volumeSiblings = this.archiveService.findVolumeSiblings(mainArchive, allAbsolutePaths);
    const excludePaths = new Set(volumeSiblings.map((p) => path.resolve(p)));
    const alreadyExtracted = await this.archiveService.isAlreadyExtracted(mainArchive, sourcePath);
    const hasRemainingFiles = allAbsolutePaths.some((p) => !excludePaths.has(path.resolve(p)));

    return {
      archivePath: mainArchive,
      isDirectorySource: true,
      alreadyExtracted,
      excludePaths,
      hasRemainingFiles,
    };
  }

  /**
   * Transfers a plan into the library, unpacking an archive in place at the
   * destination rather than in the downloader's own directory. move/copy
   * relocate the raw source into the library first, then extract in place
   * (a failed extraction strands the raw archive in the library — there is
   * no retry-import path to recover it, which is an accepted trade-off).
   * hardlink/symlink never relocate the raw archive: extraction reads
   * directly from the downloader-side path into the destination.
   */
  private async transferWithUnpack(
    plan: ImportReview,
    transferMode: TransferMode,
    resolution: ArchiveResolution | null,
    game: NonNullable<Awaited<ReturnType<IStorage["getGame"]>>>,
    password: string | undefined,
    sortExtras: boolean
  ): Promise<ImportResult> {
    const strategy = new PCImportStrategy(await this.pathService.getConfiguredRoots());

    if (!resolution || resolution.alreadyExtracted) {
      return strategy.executeImport(plan, transferMode, resolution?.excludePaths);
    }

    if (transferMode === "hardlink" || transferMode === "symlink") {
      return this.unpackViaLinkedExtraction(
        plan,
        transferMode,
        resolution,
        strategy,
        password,
        sortExtras
      );
    }

    return this.unpackViaRelocatedExtraction(
      plan,
      transferMode,
      resolution,
      strategy,
      game,
      password,
      sortExtras
    );
  }

  // hardlink/symlink never relocate the raw archive: extraction reads directly from the
  // downloader-side path into the destination.
  private async unpackViaLinkedExtraction(
    plan: ImportReview,
    transferMode: TransferMode,
    resolution: ArchiveResolution,
    strategy: PCImportStrategy,
    password: string | undefined,
    sortExtras: boolean
  ): Promise<ImportResult> {
    const destDir = plan.proposedPath;
    await fs.ensureDir(destDir);
    await this.archiveService.extract(resolution.archivePath, destDir, password);

    let modeUsed = transferMode;
    if (resolution.isDirectorySource && resolution.hasRemainingFiles) {
      modeUsed = (await strategy.executeImport(plan, transferMode, resolution.excludePaths))
        .modeUsed;
    }

    // Sorting after the remaining-files transfer (not before) so a categorized loose
    // file doesn't land at destDir's root, outside this pass's reach.
    if (sortExtras) await reorganizeBySortExtras(destDir);

    return {
      destDir,
      filesPlaced: await gatherFiles(destDir),
      modeUsed,
      conflictsResolved: [],
    };
  }

  // move/copy: relocate the raw source into the library first, then extract in place. A
  // failed extraction strands the raw archive in the library — there is no retry-import
  // path to recover it, which is an accepted trade-off.
  private async unpackViaRelocatedExtraction(
    plan: ImportReview,
    transferMode: TransferMode,
    resolution: ArchiveResolution,
    strategy: PCImportStrategy,
    game: NonNullable<Awaited<ReturnType<IStorage["getGame"]>>>,
    password: string | undefined,
    sortExtras: boolean
  ): Promise<ImportResult> {
    const destDir = plan.proposedPath;
    const { archiveInDest, siblingsInDest } = await this.relocateArchiveToDest(
      transferMode,
      resolution,
      destDir
    );

    try {
      await this.archiveService.extract(archiveInDest, destDir, password);
    } catch (err) {
      await this.notifyStrandedImport(game, archiveInDest, err);
      throw err;
    }
    await fs.remove(archiveInDest).catch(() => undefined);
    for (const sibling of siblingsInDest) {
      await fs.remove(sibling).catch(() => undefined);
    }

    let modeUsed = transferMode;
    if (resolution.isDirectorySource) {
      if (resolution.hasRemainingFiles) {
        modeUsed = (await strategy.executeImport(plan, transferMode, resolution.excludePaths))
          .modeUsed;
      } else if (transferMode === "move") {
        // Only archive-family files were relocated above, leaving an empty source
        // directory behind — the plain-directory transfer path would normally remove
        // it as part of moving everything out, so replicate that here.
        await fs.remove(plan.originalPath).catch(() => undefined);
      }
    }

    if (sortExtras) await reorganizeBySortExtras(destDir);

    return {
      destDir,
      filesPlaced: await gatherFiles(destDir),
      modeUsed,
      conflictsResolved: [],
    };
  }

  // Relocates only the archive's own volume family into destDir — never the whole
  // source directory. A directory source can hold other legitimate files alongside
  // the archive (a readme, bonus content); extract()'s own in-place cleanup treats
  // anything in destDir it doesn't recognize as an archive volume as a stale leftover
  // and deletes it, so those files must stay put in the source until after extraction
  // runs, then get transferred separately (see unpackViaRelocatedExtraction above).
  private async relocateArchiveToDest(
    transferMode: TransferMode,
    resolution: ArchiveResolution,
    destDir: string
  ): Promise<{ archiveInDest: string; siblingsInDest: string[] }> {
    await fs.ensureDir(destDir);
    const resolvedArchive = path.resolve(resolution.archivePath);
    const archiveInDest = path.join(destDir, path.basename(resolution.archivePath));
    const siblingsInDest: string[] = [];

    const volumePaths = resolution.isDirectorySource
      ? [...resolution.excludePaths]
      : [resolution.archivePath];

    // Copy the whole family first — never move a volume directly — so a mid-family
    // failure (e.g. volume 2 of 3 hits a full disk) can't split the set across source
    // and destination with no way back. If any copy fails, everything copied so far
    // is rolled back and every source volume is still intact, untouched. Only once
    // every volume has copied successfully do move-mode sources get removed.
    const copiedInDest: string[] = [];
    try {
      for (const volumePath of volumePaths) {
        const volumeInDest = path.join(destDir, path.basename(volumePath));
        await fs.copy(volumePath, volumeInDest, { overwrite: true });
        copiedInDest.push(volumeInDest);
        if (path.resolve(volumePath) !== resolvedArchive) siblingsInDest.push(volumeInDest);
      }
    } catch (err) {
      for (const partial of copiedInDest) {
        await fs.remove(partial).catch(() => undefined);
      }
      throw err;
    }

    if (transferMode === "move") {
      for (const volumePath of volumePaths) {
        await fs.remove(volumePath).catch(() => undefined);
      }
    }

    return { archiveInDest, siblingsInDest };
  }

  private async notifyStrandedImport(
    game: NonNullable<Awaited<ReturnType<IStorage["getGame"]>>>,
    archiveInDest: string,
    err: unknown
  ): Promise<void> {
    await this.storage
      .addNotification({
        userId: game.userId ?? "",
        type: "error",
        title: "Import extraction failed",
        message: `"${game.title}" was moved into your library, but extracting the archive failed: ${err instanceof Error ? err.message : String(err)}. The archive is left at ${archiveInDest} — extract or delete it manually to finish the import.`,
      })
      .catch((notifErr) =>
        logger.error(
          { notifErr, archiveInDest },
          "[ImportManager] Failed to create stranded-import notification"
        )
      );
  }

  private async readSourceFiles(sourcePath: string): Promise<{
    files: Array<{ name: string; isArchive: boolean }>;
    hasArchive: boolean;
    totalCount: number;
  }> {
    const empty = { files: [], hasArchive: false, totalCount: 0 };
    if (isSensitivePath(sourcePath)) return empty;
    try {
      // Rejecting here (rather than only inside planImport/executeImport later) stops
      // an out-of-root path from having its directory contents disclosed through this
      // preview listing before the import flow ever gets to reject it.
      await assertWithinRoots(
        sourcePath,
        await this.pathService.getConfiguredRoots(),
        "Refusing to process a path outside the configured downloader roots"
      );
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
    meta: {
      downloaderName: string;
      remoteDownloadPath: string;
      gameTitle?: string;
      userId?: string;
    }
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
    if (meta.gameTitle && meta.userId) {
      try {
        const notification = await this.storage.addNotification({
          userId: meta.userId,
          type: "warning",
          title: "Import needs attention",
          message: `"${meta.gameTitle}" finished downloading but its local path could not be accessed. Check Settings → Path Mappings or trigger the import manually.`,
          link: "/library",
        });
        notifyUser("notification", notification);
      } catch (err) {
        logger.error(
          { err, downloadId },
          "[ImportManager] Failed to create path-inaccessible notification"
        );
      }
    }
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

  private async flagNeedsReview(
    downloadId: string,
    game: { title: string },
    plan: ImportReview
  ): Promise<void> {
    logger.info(
      { gameTitle: game.title, reviewReason: plan.reviewReason },
      "[ImportManager] Manual review required"
    );
    await this.storage.updateGameDownloadStatus(downloadId, "manual_review_required");
  }

  private async autoDeleteIfConfigured(
    downloadId: string,
    download: NonNullable<Awaited<ReturnType<IStorage["getGameDownload"]>>>,
    game: NonNullable<Awaited<ReturnType<IStorage["getGame"]>>>,
    config: Awaited<ReturnType<IStorage["getImportConfig"]>>
  ): Promise<void> {
    if (
      !config.autoDeleteAfterImport ||
      (config.transferMode !== "copy" && config.transferMode !== "move")
    ) {
      return;
    }
    try {
      await this.performAutoDelete(downloadId, download, game);
    } catch (autoDeleteErr) {
      // The import itself already succeeded and was finalized (status "imported", library
      // path set) — a failure here must not fall through to the outer catch, which would
      // demote the download back to manual_review_required and risk a duplicate transfer
      // on retry.
      logger.error(
        { err: autoDeleteErr, downloadId },
        "[ImportManager] Auto-delete after import failed unexpectedly"
      );
    }
  }

  async processImport(
    downloadId: string,
    remoteDownloadPath: string,
    password?: string
  ): Promise<void> {
    const download = await this.storage.getGameDownload(downloadId);
    if (!download) {
      logger.warn({ downloadId }, "[ImportManager] Download not found");
      return;
    }

    const game = await this.storage.getGame(download.gameId);
    if (!game) {
      logger.error({ downloadId }, "[ImportManager] Game not found for download");
      // "error" is a dead end: unlike "manual_review_required", nothing ever
      // re-polls or surfaces it in the UI (getDownloadingGameDownloads only
      // selects status="downloading", and getPendingImportReviews only
      // selects "manual_review_required") - a download that lands here would
      // sit invisibly forever even if the underlying issue (e.g. a
      // transiently missing game row) was momentary.
      //
      // This is deliberately its own status rather than "manual_review_required":
      // that review flow (ImportReviewModal) only ever asks the user to confirm
      // source/destination paths for an *existing* game — it has no way to
      // recover from there being no game to import into at all. "game_link_required"
      // is surfaced separately so the user is prompted to pick the right game first;
      // relinking (POST /api/imports/:id/link) then drops the download back into the
      // normal "manual_review_required" path-review flow once a game is attached.
      await this.storage.updateGameDownloadStatus(
        downloadId,
        GAME_LINK_REQUIRED_STATUS,
        "This download's linked game could not be found — select a game to continue importing it."
      );
      return;
    }

    const config = await this.storage.getImportConfig(game.userId ?? undefined);
    if (!config.enablePostProcessing) {
      logger.info({ downloadId }, "[ImportManager] Post-processing disabled, skipping");
      await this.storage.updateGameDownloadStatus(downloadId, "completed");
      return;
    }

    try {
      await this.storage.updateGameDownloadStatus(downloadId, "unpacking");

      const resolved = await this.resolveLocalPath(remoteDownloadPath, download.downloaderId);
      const localPath = resolved.localPath;
      const downloaderName = resolved.downloaderName;

      // Before even probing for existence: verifyLocalPath's fs.pathExists() call
      // below would otherwise leak whether an out-of-root path exists on disk to
      // an import flow that should never have been allowed to look at it at all.
      await assertWithinRoots(
        localPath,
        await this.pathService.getConfiguredRoots(),
        "Refusing to process a path outside the configured downloader roots"
      );

      logger.debug({ localPath }, "[ImportManager] Checking path accessibility");
      if (
        !(await this.verifyLocalPath(downloadId, localPath, {
          downloaderName,
          remoteDownloadPath,
          gameTitle: game.title,
          userId: game.userId ?? undefined,
        }))
      ) {
        return;
      }

      const archiveResolution = config.autoUnpack ? await this.resolveArchive(localPath) : null;
      const needsExtraction = !!archiveResolution && !archiveResolution.alreadyExtracted;

      const strategy = new PCImportStrategy(await this.pathService.getConfiguredRoots());
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
        localPath,
        game,
        libraryRoot,
        config,
        platformDir,
        needsExtraction && !archiveResolution!.isDirectorySource
          ? { treatAsDirectory: true }
          : undefined
      );

      if (plan.needsReview) {
        await this.flagNeedsReview(downloadId, game, plan);
        return;
      }

      // planImport pre-categorizes a directory source's files into sortExtras
      // subfolders, including the archive itself. When extraction is still pending,
      // that categorization is both wrong (the archive gets relocated expecting a
      // flat destDir, not a category subfolder) and redundant — the post-extraction
      // reorganizeBySortExtras pass in transferWithUnpack re-categorizes everything,
      // extracted contents included, once the real files exist.
      if (needsExtraction) {
        plan.fileCategories = undefined;
      }

      await this.storage.updateGameDownloadStatus(downloadId, "completed_pending_import");
      const result = await this.transferWithUnpack(
        plan,
        config.transferMode,
        archiveResolution,
        game,
        password,
        config.sortExtras
      );

      await this.finalizeImport(downloadId, game, result.destDir);
      await this.autoDeleteIfConfigured(downloadId, download, game, config);
    } catch (err) {
      logger.error({ err, downloadId }, "[ImportManager] Import failed");
      try {
        // Route to manual review instead of a terminal "error" status so the
        // download stays actionable — it surfaces under Pending Manual Imports
        // where the user can adjust settings and re-attempt the import.
        await this.storage.updateGameDownloadStatus(
          downloadId,
          "manual_review_required",
          this.formatErrorMessage(err)
        );
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

    const remotePath = buildRemoteImportPath(
      details.downloadDir,
      resolveDownloadRelativePath(details)
    );
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
        const strategy = new PCImportStrategy(await this.pathService.getConfiguredRoots());
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
      password?: string;
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

    // Before the existence probe below: overridePlan.originalPath can come from a
    // manually-typed path in the review UI, not just a translated downloader path.
    await assertWithinRoots(
      resolvedOriginalPath,
      await this.pathService.getConfiguredRoots(),
      "Refusing to process a path outside the configured downloader roots"
    );

    if (!(await fs.pathExists(resolvedOriginalPath))) {
      throw new Error(`Source path not found: ${resolvedOriginalPath}`);
    }

    const game = await this.storage.getGame(download.gameId);
    if (!game) {
      throw new Error(`Game not found for download ${downloadId}`);
    }

    const config = await this.storage.getImportConfig(game.userId ?? undefined);

    if (!overridePlan.proposedPath) {
      throw new Error("Proposed path is required for import validation");
    }

    const archiveResolution = overridePlan.unpack
      ? await this.resolveArchive(resolvedOriginalPath)
      : null;
    const needsExtraction = !!archiveResolution && !archiveResolution.alreadyExtracted;

    // The client always echoes back an extension-bearing proposedPath regardless of the
    // unpack toggle (it can't know in advance whether unpack will be requested), so a
    // single-file archive that will be unpacked has its extension stripped here — the one
    // place that knows both the resolved archive and the confirmed unpack intent.
    let proposedPath = overridePlan.proposedPath;
    if (needsExtraction && !archiveResolution!.isDirectorySource) {
      const ext = path.extname(resolvedOriginalPath);
      if (ext && proposedPath.toLowerCase().endsWith(ext.toLowerCase())) {
        proposedPath = proposedPath.slice(0, -ext.length);
      }
    }

    const resolvedRoot = path.resolve(config.libraryRoot);
    const resolvedTarget = path.resolve(proposedPath);
    const insideRoot =
      resolvedTarget === resolvedRoot || resolvedTarget.startsWith(resolvedRoot + path.sep);
    if (!insideRoot) {
      throw new Error("Proposed path is outside configured library root");
    }

    const transferMode = overridePlan.transferMode ?? config.transferMode;

    const planToExecute: ImportReview = {
      ...overridePlan,
      // Recomputed just below when sorting is enabled and no extraction is happening —
      // never trust client-supplied categories. An archive being unpacked gets its
      // categories applied afterward instead, via transferWithUnpack's post-extraction
      // reorganizeBySortExtras pass, since there's nothing to categorize here yet.
      fileCategories: undefined,
      originalPath: resolvedOriginalPath,
      proposedPath,
    };

    const strategy = new PCImportStrategy(await this.pathService.getConfiguredRoots());
    if (config.sortExtras && !needsExtraction) {
      const categorizedPlan = await strategy.planImport(
        resolvedOriginalPath,
        game,
        config.libraryRoot,
        config
      );
      planToExecute.fileCategories = categorizedPlan.fileCategories;
    }

    try {
      const result = await this.transferWithUnpack(
        planToExecute,
        transferMode,
        archiveResolution,
        game,
        overridePlan.password,
        config.sortExtras
      );

      await this.finalizeImport(downloadId, game, result.destDir);
    } catch (err) {
      logger.error({ err, downloadId }, "[ImportManager] confirmImport failed");
      try {
        // Keep the download in manual review rather than a terminal "error"
        // status, so a failed retry attempt can itself be re-attempted.
        await this.storage.updateGameDownloadStatus(
          downloadId,
          "manual_review_required",
          this.formatErrorMessage(err)
        );
      } catch (statusErr) {
        logger.error({ statusErr, downloadId }, "[ImportManager] Failed to set error status");
      }
      throw err;
    }
  }
}
