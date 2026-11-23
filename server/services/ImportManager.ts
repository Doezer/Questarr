import { type IStorage } from "../storage.js";
import { applyDeliveredStatus, recordDeliveredVersion } from "../main-release-gate.js";
import { PathMappingService } from "./PathMappingService.js";
import { PlatformMappingService } from "./PlatformMappingService.js";
import { ArchiveService, ArchivePasswordRequiredError } from "./ArchiveService.js";
import {
  ImportStrategy,
  ImportReview,
  ImportResult,
  FileCategoryEntry,
  PCImportStrategy,
  TransferMode,
  resolveLibraryLeafName,
  gatherFiles,
  reorganizeBySortExtras,
} from "./ImportStrategies.js";
import { DownloaderManager } from "../downloaders.js";
import { resolveRemoteImportPath } from "../downloaders/utils.js";
import fs from "fs-extra";
import path from "node:path";
import { categorizeDownload } from "../../shared/download-categorizer.js";
import { parseReleaseMetadata, PLATFORM_CATALOG } from "../../shared/title-utils.js";
import {
  GAME_LINK_REQUIRED_STATUS,
  QUARANTINED_STATUS,
  type Game,
  type GameFileCategory,
} from "../../shared/schema.js";
import { logger } from "../logger.js";
import { extractHostnameFromUrl } from "../url-utils.js";
import { isSensitivePath, assertWithinRoots } from "../path-security.js";
import { configLoader } from "../config-loader.js";
import { resolveSqliteDbPath } from "../db/sqlite-path.js";
import { notifyUser } from "../socket.js";
import type { DownloadCategory } from "../../shared/download-categorizer.js";
import { carriesBaseGameVersion, inferReleaseCategory } from "../../shared/version-utils.js";
import { recordVersionFromInstallFolder } from "../game-version.js";
import { resolvePrefs } from "../notification-prefs.js";
import { appriseClient } from "../apprise.js";
import { isRommPlatformFoldersEnabled, requestRommScanAfterImport } from "../romm.js";
import { isValidRommSlug, rommSlugForPlatformId } from "../../shared/romm-platforms.js";
import { type SecurityScanService, type ScanResult } from "../security-scan.js";
import type { ImportProgress } from "./ImportOperations.js";
import { emitWebhookEvent } from "../webhooks.js";
import {
  planUpgradeReplacement,
  setOldVersionAside,
  restoreOldVersion,
  disposeOldVersion,
  type UpgradeReplacement,
} from "./upgrade-replace.js";
import { igdbClient, type IGDBContentRef } from "../igdb.js";

export type ImportContentSuggestion = {
  id: number;
  name: string;
  category: "dlc" | "update" | "packs" | "extra";
};

type ExtractionContentMetadata = Pick<FileCategoryEntry, "category" | "igdbContentId">;

const MANUAL_IMPORT_SUPPORTED_EXTENSIONS = new Set([
  ".7z",
  ".bin",
  ".chd",
  ".cue",
  ".gdi",
  ".gz",
  ".iso",
  ".nca",
  ".nsp",
  ".pkg",
  ".pup",
  ".rar",
  ".rvz",
  ".tar",
  ".wad",
  ".wbfs",
  ".xci",
  ".zip",
]);

export function isSupportedManualImportFile(filePath: string): boolean {
  return MANUAL_IMPORT_SUPPORTED_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

async function isWithinPath(candidatePath: string, rootPath: string): Promise<boolean> {
  const resolvedCandidate = path.resolve(candidatePath);
  const resolvedRoot = path.resolve(rootPath);
  const canonicalize = async (target: string): Promise<string> => {
    try {
      return typeof fs.realpath === "function" ? await fs.realpath(target) : target;
    } catch {
      return target;
    }
  };
  const canonicalCandidate = await canonicalize(resolvedCandidate);
  const canonicalRoot = await canonicalize(resolvedRoot);
  const relative = path.relative(canonicalRoot, canonicalCandidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function contentCategoryForIgdbCategory(
  igdbCategory?: number
): ImportContentSuggestion["category"] {
  if (igdbCategory === 14) return "update";
  if (igdbCategory === 13) return "packs";
  if ([1, 2, 4, 6, 7].includes(igdbCategory ?? -1)) return "dlc";
  return "extra";
}

function importedFileCategory(filePath: string): "main" | "dlc" | "update" | "extra" {
  const parent = path.basename(path.dirname(filePath)).toLowerCase();
  if (parent === "update") return "update";
  if (parent === "dlc") return "dlc";
  if (parent === "packs") return "extra";
  if (parent === "extra") return "extra";
  const inferred = categorizeDownload(path.basename(filePath)).category;
  return inferred === "packs" ? "extra" : inferred;
}

function contentSuggestionMatchesFile(
  contentCategory: ImportContentSuggestion["category"],
  fileCategory: "main" | "dlc" | "update" | "extra"
): boolean {
  if (contentCategory === "update") return fileCategory === "update";
  if (contentCategory === "dlc") return fileCategory === "dlc";
  return fileCategory === "extra";
}

function buildExtractionFileCategories(
  destDir: string,
  filesPlaced: string[],
  extractedFiles: string[],
  reorganizedPaths: ReadonlyMap<string, string>,
  extractedMetadata?: ExtractionContentMetadata,
  remainingResult?: ImportResult
): FileCategoryEntry[] {
  const byPath = new Map<string, FileCategoryEntry>();
  for (const extractedFile of extractedFiles) {
    const finalPath = reorganizedPaths.get(path.resolve(extractedFile)) ?? extractedFile;
    byPath.set(
      path.resolve(finalPath),
      extractedMetadata
        ? {
            name: path.relative(destDir, finalPath),
            category: extractedMetadata.category,
            ...(extractedMetadata.igdbContentId != null
              ? { igdbContentId: extractedMetadata.igdbContentId }
              : {}),
          }
        : { name: path.relative(destDir, finalPath), category: importedFileCategory(finalPath) }
    );
  }

  if (remainingResult?.placedFileCategories) {
    for (const [index, filePath] of remainingResult.filesPlaced.entries()) {
      const category = remainingResult.placedFileCategories[index];
      if (category) byPath.set(path.resolve(filePath), category);
    }
  }

  return filesPlaced.map((filePath) => {
    return (
      byPath.get(path.resolve(filePath)) ?? {
        name: path.relative(destDir, filePath),
        category: importedFileCategory(filePath),
      }
    );
  });
}

function normalizeContentMatchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Suggests an exact IGDB content item only when the release's inferred category
 * agrees with the IGDB item's category. This prevents a generic update from
 * being attached to an expansion just because the title happens to contain a
 * similar word.
 */
export function findImportContentMatch(
  downloadTitle: string,
  items: ImportContentSuggestion[]
): ImportContentSuggestion | null {
  const inferred = categorizeDownload(downloadTitle).category;
  const allowedCategories =
    inferred === "update"
      ? new Set<ImportContentSuggestion["category"]>(["update"])
      : inferred === "dlc" || inferred === "packs"
        ? new Set<ImportContentSuggestion["category"]>(["dlc", "packs"])
        : new Set<ImportContentSuggestion["category"]>();
  if (allowedCategories.size === 0) return null;

  const normalizedTitle = normalizeContentMatchText(downloadTitle);
  return (
    items
      .filter(
        (item) =>
          allowedCategories.has(item.category) &&
          normalizeContentMatchText(item.name).length >= 4 &&
          normalizedTitle.includes(normalizeContentMatchText(item.name))
      )
      .sort(
        (a, b) =>
          normalizeContentMatchText(b.name).length - normalizeContentMatchText(a.name).length
      )[0] ?? null
  );
}

const PLATFORM_FOLDER_NAMES: Record<string, string> = {
  ...Object.fromEntries(
    PLATFORM_CATALOG.map(({ canonical }) => [canonical.toLowerCase(), canonical])
  ),
  nes: "NES",
  snes: "SNES",
  n64: "N64",
  gamecube: "GameCube",
  wii: "Wii",
  "wii u": "Wii U",
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
  PLATFORM_CATALOG.flatMap(({ canonical, igdbIds }) =>
    igdbIds.map((id) => [id, canonical.toLowerCase()])
  )
);

const MAX_PATH_RETRY = 5;
const MAX_LISTED_FILES = 100;

// Prefixes a game_downloads.error_message value to mark it as an ArchivePasswordRequiredError
// rather than a generic failure, without a dedicated schema column. GET /api/imports/pending
// strips this prefix and turns its presence into a `passwordRequired` flag so the manual-review
// UI can show a password field instead of the normal path-review form.
export const ARCHIVE_PASSWORD_REQUIRED_PREFIX = "ARCHIVE_PASSWORD_REQUIRED:";

/** Thrown when a confirmation is the first to learn the security scan was incomplete. */
export class IncompleteScanError extends Error {}

type ConfirmPlan = ImportReview & {
  transferMode?: "move" | "copy" | "hardlink" | "symlink" | undefined;
  unpack?: boolean | undefined;
  password?: string | undefined;
};

/** Thrown when a confirmation arrives while another import of the same download is running. */
export class ImportInProgressError extends Error {}

interface ArchiveResolution {
  archivePath: string;
  isDirectorySource: boolean;
  alreadyExtracted: boolean;
  excludePaths: Set<string>;
  hasRemainingFiles: boolean;
}

// Upper bound on archive sets inspected when looking for leftovers after an import.
const MAX_LEFTOVER_SETS_CHECKED = 25;

export class ImportManager {
  private readonly pathRetryCount = new Map<string, number>();
  // Downloads whose processImport() is running in this process. The
  // "unpacking"/"completed_pending_import" statuses outlive a restart, so this
  // is the only way to tell an import that is still running from one that a
  // restart cut short.
  private readonly importsInFlight = new Set<string>();
  // Tail of each game's chain of imports; see acquireGameLock.
  private readonly gameImportQueues = new Map<string, Promise<void>>();

  // Optional and defaulted (rather than required) so existing call sites — and
  // the many unit tests that construct an ImportManager directly — don't all
  // need updating just because a new pre-import gate was added. A scan service
  // that always passes is a safe default: it matches the pre-existing behavior
  // of importing without any security scan.
  private readonly securityScanService: Pick<SecurityScanService, "scan">;

  constructor(
    private readonly storage: IStorage,
    private readonly pathService: PathMappingService,
    _platformService: PlatformMappingService,
    private readonly archiveService: ArchiveService,
    securityScanService?: Pick<SecurityScanService, "scan">
  ) {
    this.securityScanService = securityScanService ?? { scan: async () => ({ blocked: false }) };
  }

  private extractPlatformIdFromElement(p: unknown): number | undefined {
    if (typeof p === "number") return p;
    if (typeof p === "string") {
      if (/^\d+$/.test(p)) return Number(p);
      const normalizedName = p.trim().toLowerCase().replaceAll(/\s+/g, " ");
      return PLATFORM_CATALOG.find(({ igdbNames }) =>
        igdbNames.some((name) => name.toLowerCase() === normalizedName)
      )?.igdbIds[0];
    }
    if (p && typeof p === "object" && "id" in p) {
      const id = (p as { id?: unknown }).id;
      if (typeof id === "number") return id;
      if (typeof id === "string" && /^\d+$/.test(id)) return Number(id);
    }
    return undefined;
  }

  /** IGDB platform ids a game lists, whatever shape the stored platforms are in. */
  getGamePlatformIds(game: { platforms?: unknown }): number[] {
    if (!Array.isArray(game.platforms)) return [];
    return game.platforms
      .map((p) => this.extractPlatformIdFromElement(p))
      .filter((id): id is number => id !== undefined);
  }

  private getPrimaryPlatformId(
    game: { platforms?: unknown },
    allowed: number[] = []
  ): number | undefined {
    if (!Array.isArray(game.platforms)) return undefined;
    for (const p of game.platforms) {
      const platformId = this.extractPlatformIdFromElement(p);
      if (platformId !== undefined && this.isPlatformEnabled(platformId, allowed))
        return platformId;
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
    return PLATFORM_CATALOG.find(({ canonical }) => canonical.toLowerCase() === releasePlatformKey)
      ?.igdbIds[0];
  }

  /**
   * Platform folder for an import. With RomM platform folders on, it is the RomM platform slug
   * ("snes", "ps2", "win") so RomM finds the files where it looks; a platform without a known
   * slug keeps its readable folder name.
   */
  private async resolvePlatformFolder(
    downloadTitle: string,
    game: { platforms?: unknown; targetPlatformId?: number | null },
    allowed: number[]
  ): Promise<string> {
    if (await isRommPlatformFoldersEnabled()) {
      const releaseKey = this.getReleasePlatformKey(downloadTitle);
      const platformId =
        this.getReleasePlatformIgdbId(releaseKey) ??
        game.targetPlatformId ??
        this.getPrimaryPlatformId(game, allowed) ??
        // The game's own platform wins over the "allowed platforms" filter, otherwise a platform
        // the user has not enabled (e.g. Switch 2) is silently replaced by Windows.
        this.getPrimaryPlatformId(game) ??
        6;
      const slug = rommSlugForPlatformId(platformId);
      if (slug && isValidRommSlug(slug)) return slug;
    }
    return this.resolvePlatformFolderName(downloadTitle, game, allowed);
  }

  /** Platform folder a game lands in under the library root (same rule as a download import). */
  async resolveLibraryPlatformFolder(
    game: { platforms?: unknown; targetPlatformId?: number | null },
    allowedPlatformIds: number[]
  ): Promise<string> {
    return this.resolvePlatformFolder("", game, allowedPlatformIds);
  }

  /** Destination roots accepted by the standalone manual-import flow. */
  async getManualImportDestinationRoots(userId?: string): Promise<string[]> {
    const [config, rootFolders] = await Promise.all([
      this.storage.getImportConfig(userId),
      this.storage.getEnabledRootFolders(),
    ]);
    return [
      ...new Set([
        path.resolve(config.libraryRoot || "/data"),
        ...rootFolders.map((folder) => path.resolve(folder.path)),
      ]),
    ];
  }

  /** Source roots accepted by the manual-import picker. */
  async getManualImportSourceRoots(userId?: string): Promise<string[]> {
    const mappedRoots = await this.pathService.getConfiguredRoots();
    const [config, rootFolders] = await Promise.all([
      this.storage.getImportConfig(userId),
      this.storage.getEnabledRootFolders(),
    ]);
    return [
      ...new Set([
        ...mappedRoots.map((root) => path.resolve(root)),
        path.resolve(config.libraryRoot || "/data"),
        ...rootFolders.map((folder) => path.resolve(folder.path)),
      ]),
    ];
  }

  /** Validates a manually selected source path using Questarr's configured-root policy. */
  async validateManualImportSource(filePath: string, userId?: string): Promise<string> {
    if (await isSensitivePath(filePath)) {
      throw new Error("Refusing to process a sensitive system path");
    }

    const sourcePath = path.resolve(filePath);
    const appDataRoots = [path.dirname(resolveSqliteDbPath()), configLoader.getConfigDir()];
    const appDataChecks = await Promise.all(
      appDataRoots.map((root) => isWithinPath(sourcePath, root))
    );
    if (appDataChecks.some(Boolean)) {
      throw new Error("Refusing to process Questarr app data");
    }
    await assertWithinRoots(
      sourcePath,
      await this.getManualImportSourceRoots(userId),
      "Manual import source must be inside a configured source root"
    );
    return sourcePath;
  }

  /**
   * Import one user-selected file into a game's existing folder, or create a
   * new game folder under the configured library root when the game has no
   * library path yet.
   */
  async manualImportFile(
    filePath: string,
    game: NonNullable<Awaited<ReturnType<IStorage["getGame"]>>>,
    options: {
      category?: GameFileCategory | "packs" | undefined;
      platformDir?: string | undefined;
      targetDir?: string | undefined;
      transferMode?: TransferMode | undefined;
      scanDisk?: boolean | undefined;
    } = {}
  ): Promise<{ destDir: string; newPath: string; fileSize: number; modeUsed: TransferMode }> {
    const allowedRoots = await this.getManualImportDestinationRoots(game.userId ?? undefined);
    const sourcePath = await this.validateManualImportSource(filePath, game.userId ?? undefined);
    const sourceStats = await fs.stat(sourcePath);
    if (!sourceStats.isFile()) throw new Error("filePath must point to a file");
    if (!isSupportedManualImportFile(sourcePath)) {
      throw new Error("Unsupported manual import file type");
    }

    const config = await this.storage.getImportConfig(game.userId ?? undefined);
    const libraryRoot = path.resolve(config.libraryRoot || "/data");
    const currentLibraryPath = game.libraryPath ? path.resolve(game.libraryPath) : null;
    if (options.scanDisk) {
      if (!currentLibraryPath) {
        throw new Error("Scan Disk imports require an existing game library path");
      }
      await assertWithinRoots(
        sourcePath,
        [currentLibraryPath],
        "Scan Disk source must be inside the game's library path"
      );
    }
    let destDir: string;
    let forceMove = false;

    if (options.targetDir) {
      // Scan Disk relocation is always move-only: the source is already inside
      // the game's tree and must not be duplicated.
      destDir = path.resolve(options.targetDir);
      forceMove = Boolean(options.scanDisk);
    } else if (currentLibraryPath) {
      const currentStats = await fs.stat(currentLibraryPath).catch(() => null);
      if (!currentStats) throw new Error("Game library path does not exist");
      destDir = currentStats.isDirectory() ? currentLibraryPath : path.dirname(currentLibraryPath);
    } else {
      const platformDir = options.platformDir
        ? await this.resolveManualPlatformFolder(options.platformDir)
        : await this.resolveLibraryPlatformFolder(game, config.importPlatformIds);
      const leafName = resolveLibraryLeafName(game, config, platformDir);
      destDir = path.join(libraryRoot, platformDir, leafName);
    }

    const gameRoot = path.resolve(destDir);
    const categoryDir =
      options.category && options.category !== "main" ? options.category : undefined;
    const resolvedDestDir = categoryDir ? path.join(gameRoot, categoryDir) : gameRoot;
    await assertWithinRoots(
      resolvedDestDir,
      allowedRoots,
      "Manual import destination must be inside a configured import root"
    );

    const newPath = path.join(resolvedDestDir, path.basename(sourcePath));
    if (path.resolve(newPath) === sourcePath) {
      return {
        destDir: gameRoot,
        newPath: sourcePath,
        fileSize: sourceStats.size,
        modeUsed: "move",
      };
    }
    if (await fs.pathExists(newPath)) {
      throw new Error(`Destination already exists: ${newPath}`);
    }

    const strategy = new PCImportStrategy([]);
    const result = await strategy.executeImport(
      {
        needsReview: false,
        originalPath: sourcePath,
        proposedPath: newPath,
        strategy: "pc",
      },
      forceMove || options.scanDisk ? "move" : (options.transferMode ?? config.transferMode)
    );
    requestRommScanAfterImport();

    return {
      destDir: gameRoot,
      newPath,
      fileSize: sourceStats.size,
      modeUsed: result.modeUsed,
    };
  }

  /** Undo a completed manual-import transfer when recording its game-file row fails. */
  async rollbackManualImport(
    sourcePath: string,
    destinationPath: string,
    modeUsed: TransferMode
  ): Promise<void> {
    const source = path.resolve(sourcePath);
    const destination = path.resolve(destinationPath);
    if (source === destination) return;
    if (modeUsed === "move") {
      await fs.move(destination, source);
    } else {
      await fs.remove(destination);
    }
  }

  private validateManualPlatformDir(platformDir: string): string {
    const trimmed = platformDir.trim();
    if (
      !trimmed ||
      trimmed === "." ||
      trimmed === ".." ||
      path.basename(trimmed) !== trimmed ||
      path.isAbsolute(trimmed) ||
      trimmed.includes("\0")
    ) {
      throw new Error("Invalid platform directory");
    }
    return trimmed;
  }

  private async resolveManualPlatformFolder(platformDir: string): Promise<string> {
    const validated = this.validateManualPlatformDir(platformDir);
    if (!(await isRommPlatformFoldersEnabled())) return validated;

    const normalized = validated.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const platform = PLATFORM_CATALOG.find(({ canonical, igdbNames }) =>
      [canonical, ...igdbNames].some(
        (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "") === normalized
      )
    );
    const slug = platform && rommSlugForPlatformId(platform.igdbIds[0]);
    return slug && isValidRommSlug(slug) ? slug : validated;
  }

  private resolvePlatformFolderName(
    downloadTitle: string,
    game: { platforms?: unknown },
    allowed: number[]
  ): string {
    const key = this.getReleasePlatformKey(downloadTitle);
    if (key && PLATFORM_FOLDER_NAMES[key]) return PLATFORM_FOLDER_NAMES[key];

    const igdbId = this.getPrimaryPlatformId(game, allowed) ?? this.getPrimaryPlatformId(game);
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
  private async resolveArchive(
    sourcePath: string,
    options?: { includeDiscImages?: boolean }
  ): Promise<ArchiveResolution | null> {
    if (await isSensitivePath(sourcePath)) {
      throw new Error("Refusing to process a sensitive system path");
    }

    await assertWithinRoots(
      sourcePath,
      await this.pathService.getConfiguredRoots(),
      "Refusing to process a path outside the configured downloader roots"
    );

    const stats = await fs.stat(sourcePath);

    if (!stats.isDirectory()) {
      if (!this.archiveService.isArchive(sourcePath, options)) return null;
      return {
        archivePath: sourcePath,
        isDirectorySource: false,
        alreadyExtracted: false,
        excludePaths: new Set(),
        hasRemainingFiles: false,
      };
    }

    const entries = await fs.readdir(sourcePath);
    const archiveEntries = entries
      .filter((name) => this.archiveService.isArchive(name, options))
      .sort();
    if (archiveEntries.length === 0) return null;

    // Lexicographic sort puts "Game.r00" before "Game.rar" (since '0' < 'a'), but
    // 7-Zip/unrar expect the plain .rar file as the entry point for classic RAR
    // multi-volume sets — .r00/.r01/... are continuations, not the first volume. Only
    // promote a .rar when the current first entry is actually one of ITS continuations
    // (same stem) — otherwise an unrelated .rar elsewhere in the directory (a second,
    // independent archive set) could jump the queue ahead of a correctly-ordered one.
    const continuationMatch = /^(.*)\.r\d{2,3}$/i.exec(archiveEntries[0]!);
    if (continuationMatch?.[1]) {
      const stem = continuationMatch[1].toLowerCase();
      const primaryRarIndex = archiveEntries.findIndex(
        (name) => /\.rar$/i.test(name) && name.slice(0, -".rar".length).toLowerCase() === stem
      );
      if (primaryRarIndex > 0) {
        const [primaryRar] = archiveEntries.splice(primaryRarIndex, 1);
        if (primaryRar) archiveEntries.unshift(primaryRar);
      }
    }

    // 7zip/unrar handle multi-part archives when given the first part.
    const mainArchive = path.join(sourcePath, archiveEntries[0]!);
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
    sortExtras: boolean,
    progress?: ImportProgress,
    extractionMetadata?: ExtractionContentMetadata
  ): Promise<ImportResult> {
    const strategy = new PCImportStrategy(await this.pathService.getConfiguredRoots());

    if (!resolution || resolution.alreadyExtracted) {
      progress?.setPhase("transferring");
      return strategy.executeImport(plan, transferMode, resolution?.excludePaths);
    }

    if (transferMode === "hardlink" || transferMode === "symlink") {
      return this.unpackViaLinkedExtraction(
        plan,
        transferMode,
        resolution,
        strategy,
        password,
        sortExtras,
        progress,
        extractionMetadata
      );
    }

    return this.unpackViaRelocatedExtraction(
      plan,
      transferMode,
      resolution,
      strategy,
      game,
      password,
      sortExtras,
      progress,
      extractionMetadata
    );
  }

  // An add-on is extracted below its game folder: when any folder on the way is a link, or the
  // destination is a file, extraction would write through it, outside the game folder.
  private async assertAddonDestinationIsFolder(plan: ImportReview): Promise<void> {
    if (!plan.addonGameFolder) return;
    const gameFolder = path.resolve(plan.addonGameFolder);
    let current = path.resolve(plan.proposedPath);
    const chain: string[] = [];
    while (current !== gameFolder && current !== path.dirname(current)) {
      chain.push(current);
      current = path.dirname(current);
    }
    for (const folder of chain.reverse()) {
      let stats: { isDirectory(): boolean } | undefined;
      try {
        stats = await fs.lstat(folder);
      } catch {
        return; // not created yet: extraction creates it, and nothing below it exists either
      }
      if (!stats.isDirectory()) {
        throw new Error("Refusing to extract into a link or a file in the add-on location");
      }
    }
  }

  // hardlink/symlink never relocate the raw archive: extraction reads directly from the
  // downloader-side path into the destination.
  private async unpackViaLinkedExtraction(
    plan: ImportReview,
    transferMode: TransferMode,
    resolution: ArchiveResolution,
    strategy: PCImportStrategy,
    password: string | undefined,
    sortExtras: boolean,
    progress?: ImportProgress,
    extractionMetadata?: ExtractionContentMetadata
  ): Promise<ImportResult> {
    const destDir = plan.proposedPath;
    await this.assertAddonDestinationIsFolder(plan);
    await fs.ensureDir(destDir);
    progress?.setPhase("extracting");
    const extractedFiles = await this.archiveService.extract(
      resolution.archivePath,
      destDir,
      password
    );

    let modeUsed = transferMode;
    let remainingResult: ImportResult | undefined;
    if (resolution.isDirectorySource && resolution.hasRemainingFiles) {
      progress?.setPhase("transferring");
      remainingResult = await strategy.executeImport(plan, transferMode, resolution.excludePaths);
      modeUsed = remainingResult.modeUsed;
    }

    // Sorting after the remaining-files transfer (not before) so a categorized loose
    // file doesn't land at destDir's root, outside this pass's reach.
    const reorganizedPaths = sortExtras ? await reorganizeBySortExtras(destDir) : new Map();
    const filesPlaced = await gatherFiles(destDir, { skipExtractStaging: true });

    return {
      destDir,
      filesPlaced,
      ...(extractionMetadata
        ? {
            placedFileCategories: buildExtractionFileCategories(
              destDir,
              filesPlaced,
              extractedFiles,
              reorganizedPaths,
              extractionMetadata,
              remainingResult
            ),
          }
        : remainingResult?.placedFileCategories
          ? {
              placedFileCategories: buildExtractionFileCategories(
                destDir,
                filesPlaced,
                extractedFiles,
                reorganizedPaths,
                undefined,
                remainingResult
              ),
            }
          : {}),
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
    sortExtras: boolean,
    progress?: ImportProgress,
    extractionMetadata?: ExtractionContentMetadata
  ): Promise<ImportResult> {
    const destDir = plan.proposedPath;
    await this.assertAddonDestinationIsFolder(plan);
    progress?.setPhase("transferring");
    const { archiveInDest, siblingsInDest } = await this.relocateArchiveToDest(
      transferMode,
      resolution,
      destDir
    );

    let extractedFiles: string[];
    try {
      progress?.setPhase("extracting");
      extractedFiles = await this.archiveService.extract(archiveInDest, destDir, password);
    } catch (err) {
      await this.notifyStrandedImport(game, archiveInDest, err);
      throw err;
    }
    await fs.remove(archiveInDest).catch(() => undefined);
    for (const sibling of siblingsInDest) {
      await fs.remove(sibling).catch(() => undefined);
    }

    let modeUsed = transferMode;
    let remainingResult: ImportResult | undefined;
    if (resolution.isDirectorySource) {
      if (resolution.hasRemainingFiles) {
        progress?.setPhase("transferring");
        remainingResult = await strategy.executeImport(plan, transferMode, resolution.excludePaths);
        modeUsed = remainingResult.modeUsed;
      } else if (transferMode === "move") {
        // Only archive-family files were relocated above, leaving an empty source
        // directory behind — the plain-directory transfer path would normally remove
        // it as part of moving everything out, so replicate that here.
        await fs.remove(plan.originalPath).catch(() => undefined);
      }
    }

    const reorganizedPaths = sortExtras ? await reorganizeBySortExtras(destDir) : new Map();
    const filesPlaced = await gatherFiles(destDir, { skipExtractStaging: true });

    return {
      destDir,
      filesPlaced,
      ...(extractionMetadata
        ? {
            placedFileCategories: buildExtractionFileCategories(
              destDir,
              filesPlaced,
              extractedFiles,
              reorganizedPaths,
              extractionMetadata,
              remainingResult
            ),
          }
        : remainingResult?.placedFileCategories
          ? {
              placedFileCategories: buildExtractionFileCategories(
                destDir,
                filesPlaced,
                extractedFiles,
                reorganizedPaths,
                undefined,
                remainingResult
              ),
            }
          : {}),
      modeUsed,
      conflictsResolved: [],
    };
  }

  // Relocates only the archive's own volume family into destDir — never the whole
  // source directory. A directory source can hold other legitimate files alongside
  // the archive (a readme, bonus content); those stay put in the source until after
  // extraction runs, then get transferred separately (see unpackViaRelocatedExtraction
  // above), so the archive family is the only thing deleted from destDir afterward.
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

  /**
   * Archive sets below `dir` that still hold packed content. A set whose contents are already
   * sitting next to it (the client unpacked but kept the archive) does not count.
   */
  private async findUnextractedArchiveSets(dir: string): Promise<string[]> {
    const sets = await this.archiveService.findArchiveSets(dir);
    const unextracted: string[] = [];
    // Each check may spawn 7z/unrar; this is a best-effort warning, so bound the work.
    for (const set of sets.slice(0, MAX_LEFTOVER_SETS_CHECKED)) {
      if (!(await this.archiveService.isAlreadyExtracted(set.primary, path.dirname(set.primary)))) {
        unextracted.push(path.relative(dir, set.primary));
      }
    }
    return unextracted;
  }

  /**
   * Tells the user when a finished download still contains archives nothing unpacked: the
   * download client marks a job complete even when it left archives behind, and Questarr's
   * own import only unpacks when auto-unpack is on. Informational and best effort: it never
   * changes the download or the import.
   */
  async reportLeftoverArchives(
    game: NonNullable<Awaited<ReturnType<IStorage["getGame"]>>>,
    dir: string,
    options: { checkRoots?: boolean; extractionAttempted?: boolean } = {}
  ): Promise<void> {
    try {
      if (await isSensitivePath(dir)) return;
      if (options.checkRoots) {
        await assertWithinRoots(dir, await this.pathService.getConfiguredRoots(), "outside roots");
      }
      const leftovers = await this.findUnextractedArchiveSets(dir);
      if (leftovers.length === 0) return;
      const shown = leftovers.slice(0, 3).join(", ");
      const more = leftovers.length > 3 ? ` and ${leftovers.length - 3} more` : "";
      const hint = options.extractionAttempted
        ? "Questarr already tried to extract this import; check for nested archives or extract them yourself."
        : "Turn on Auto-unpack in the import settings, or extract them yourself.";
      const notification = await this.storage.addNotification({
        userId: game.userId ?? "",
        type: "warning",
        title: "Archives were not extracted",
        message: `"${game.title}" still contains ${leftovers.length} archive${leftovers.length === 1 ? "" : "s"} that nothing unpacked (${shown}${more}). ${hint}`,
        link: "/downloads",
      });
      notifyUser("notification", notification, notification.userId);
    } catch (err) {
      logger.debug({ err, dir }, "[ImportManager] Leftover archive check skipped");
    }
  }

  /** Publishes `import.failed` for a download; best effort, never throws. */
  private async emitImportFailed(downloadId: string, err: unknown): Promise<void> {
    try {
      const download = await this.storage.getGameDownload(downloadId);
      const game = download ? await this.storage.getGame(download.gameId) : undefined;
      emitWebhookEvent(
        "import.failed",
        {
          downloadId,
          gameId: game?.id ?? download?.gameId ?? null,
          gameTitle: game?.title ?? download?.downloadTitle ?? null,
          reason: err instanceof Error ? err.message : String(err),
        },
        game?.userId
      );
    } catch (emitErr) {
      logger.debug({ emitErr, downloadId }, "[ImportManager] import.failed webhook skipped");
    }
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
        link: `/games/${encodeURIComponent(game.id)}`,
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
    if (await isSensitivePath(sourcePath)) return empty;
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
    const releasePlatformKey = this.getReleasePlatformKey(downloadTitle);
    const releasePlatformId = this.getReleasePlatformIgdbId(releasePlatformKey);
    // A detected release identifies the downloaded version, then the platform the user chose for
    // the game. Otherwise the game can list several platforms, stored as IGDB names, and any
    // selected one fits.
    const identifiedPlatformId = releasePlatformId ?? game.targetPlatformId ?? undefined;
    const enabled =
      identifiedPlatformId !== undefined
        ? this.isPlatformEnabled(identifiedPlatformId, importPlatformIds)
        : this.isPlatformEnabled(
            this.getPrimaryPlatformId(game, importPlatformIds),
            importPlatformIds
          );

    if (!enabled) {
      logger.info(
        { gameTitle: game.title, releasePlatformId, gamePlatforms: game.platforms },
        "[ImportManager] Skipping import: platform not in filter"
      );
      return true;
    }
    return false;
  }

  private async finalizeImport(
    download: {
      id: string;
      gameId: string;
      category?: string | null;
      downloadTitle?: string | null;
    },
    game: NonNullable<Awaited<ReturnType<IStorage["getGame"]>>>,
    libraryPath: string,
    filesPlaced: string[] = [],
    downloadTitle = "",
    placedFileCategories?: FileCategoryEntry[],
    replacement: UpgradeReplacement | null = null
  ): Promise<void> {
    // null clears an error left by an earlier failed attempt.
    await this.storage.updateGameDownloadStatus(download.id, "imported", null);
    if (replacement && !replacement.samePath) {
      const resolvedLibraryPath = path.resolve(libraryPath);
      await this.storage.updateGame(game.id, { libraryPath: resolvedLibraryPath });
      game.libraryPath = resolvedLibraryPath;
    } else {
      await this.setLibraryPathOnce(game, libraryPath);
    }
    // The import is marked above, so it no longer counts as unfinished for a patch's gate.
    if (game.status !== "owned") await applyDeliveredStatus(this.storage, download, game);
    try {
      await this.recordImportedFiles(
        download.id,
        game,
        filesPlaced,
        downloadTitle,
        placedFileCategories
      );
    } catch (error) {
      // A successful disk import must not be demoted because recording its file
      // metadata failed; the next library scan can safely backfill the records.
      logger.warn({ error, downloadId: download.id }, "Could not record imported game files");
    }
    // Last, and it never throws: a write that fails above puts the previous version back, and
    // the new version must not stay recorded for it.
    await this.recordInstalledVersion(download.id, game, libraryPath);
    requestRommScanAfterImport();
  }

  /** Waits for the game's running import, if any; the returned function lets the next one in. */
  async acquireGameLock(gameId: string): Promise<() => void> {
    const previous = this.gameImportQueues.get(gameId) ?? Promise.resolve();
    let open!: () => void;
    const held = new Promise<void>((resolve) => {
      open = resolve;
    });
    const tail = previous.then(() => held);
    this.gameImportQueues.set(gameId, tail);
    await previous;
    return () => {
      open();
      if (this.gameImportQueues.get(gameId) === tail) this.gameImportQueues.delete(gameId);
    };
  }

  /**
   * The replacement a new full release of an owned game triggers when the user turned it on.
   * Add-ons (DLC, updates, extras) never replace anything.
   */
  private async planReplacement(
    download: NonNullable<Awaited<ReturnType<IStorage["getGameDownload"]>>>,
    game: NonNullable<Awaited<ReturnType<IStorage["getGame"]>>>,
    config: Awaited<ReturnType<IStorage["getImportConfig"]>>,
    newPath: string,
    sourcePath: string
  ): Promise<UpgradeReplacement | null> {
    const mode = config.upgradeReplaceMode ?? "off";
    if (mode === "off") return null;
    const category = download.category || inferReleaseCategory(download.downloadTitle || "");
    if (category !== "main") return null;
    return planUpgradeReplacement({
      mode,
      libraryRoot: config.libraryRoot || "/data",
      oldLibraryPath: game.libraryPath,
      newPath,
      sourcePath,
    });
  }

  /**
   * Where a new version goes, for replacing the old one. A wrapped single file replaces the
   * whole game folder only when the game's entry is that folder (an earlier folder release);
   * when it is a file, only that file is replaced and the rest of the folder (add-ons) stays.
   */
  private replacementTarget(
    game: NonNullable<Awaited<ReturnType<IStorage["getGame"]>>>,
    wrapperFolder: string | undefined,
    proposedPath: string
  ): string {
    if (wrapperFolder && game.libraryPath) {
      if (path.resolve(game.libraryPath) === path.resolve(wrapperFolder)) return wrapperFolder;
    }
    return proposedPath;
  }

  /**
   * The game folder a single file was placed in when "folder for single-file releases" is on,
   * for a path the user confirmed (the plan's own wrapperFolder is not echoed back by the client).
   */
  private async wrappedSingleFileFolder(
    config: Awaited<ReturnType<IStorage["getImportConfig"]>>,
    originalPath: string,
    proposedPath: string
  ): Promise<string | undefined> {
    if (!config.folderForSingleFiles) return undefined;
    const folder = path.dirname(proposedPath);
    // the leaf without the source's own extension: a dotted title ("Game.v1") keeps its dots
    const sourceExt = path.extname(originalPath);
    const leaf = path.basename(proposedPath);
    const name =
      sourceExt && leaf.toLowerCase().endsWith(sourceExt.toLowerCase())
        ? leaf.slice(0, -sourceExt.length)
        : leaf;
    if (path.basename(folder) !== name) return undefined;
    const stats = await fs.stat(originalPath).catch(() => undefined);
    return stats?.isFile() ? folder : undefined;
  }

  /**
   * Transfers and finalizes an import around a replacement: the old version is moved aside
   * first when it is in the way, put back if the transfer or the finalization fails, and
   * only cleaned up once the new version is recorded.
   */
  private async importWithReplacement(
    replacement: UpgradeReplacement | null,
    transferMode: TransferMode,
    download: NonNullable<Awaited<ReturnType<IStorage["getGameDownload"]>>>,
    game: NonNullable<Awaited<ReturnType<IStorage["getGame"]>>>,
    transfer: () => Promise<ImportResult>,
    downloadTitle = download.downloadTitle,
    placedFileCategories?: FileCategoryEntry[]
  ): Promise<ImportResult> {
    if (replacement) await setOldVersionAside(replacement);
    const previousLibraryPath = game.libraryPath;
    let result: ImportResult;
    let transferred = false;
    try {
      result = await transfer();
      transferred = true;
      await this.finalizeImport(
        download,
        game,
        result.libraryEntry ?? result.destDir,
        result.filesPlaced,
        downloadTitle,
        result.placedFileCategories ?? placedFileCategories,
        replacement
      );
    } catch (err) {
      if (replacement) {
        // Recording the import may have stopped halfway: the game must keep pointing at the
        // version that is still in place, not at the import that failed.
        if (transferred) {
          await this.storage
            .updateGame(game.id, { libraryPath: previousLibraryPath })
            .catch((restoreErr) =>
              logger.error(
                { err: restoreErr, gameId: game.id },
                "[ImportManager] Could not point the game back at its previous version"
              )
            );
          game.libraryPath = previousLibraryPath;
        }
        const keptAt = await this.restoreReplacedVersion(replacement, transferMode, download.id);
        // The files are no longer where the transfer left them: say where they went, on
        // the error the user sees in Pending Manual Imports (its type is kept).
        if (keptAt && err instanceof Error) {
          err.message = `${err.message}. The previous version was restored; the partially imported files were kept at ${keptAt}`;
        }
      }
      throw err;
    }
    if (replacement) await this.completeReplacement(replacement, download, game);
    return result;
  }

  /**
   * Puts the old version back after a failed import; never throws over the import error.
   * Returns where a partial import was kept, if it was.
   */
  private async restoreReplacedVersion(
    replacement: UpgradeReplacement,
    transferMode: TransferMode,
    downloadId: string
  ): Promise<string | null> {
    try {
      // In move mode a partial import is the only copy of the download: keep it.
      const keptAt = await restoreOldVersion(replacement, { keepPartial: transferMode === "move" });
      logger.warn(
        { downloadId, restored: replacement.oldPath, partialImportKeptAt: keptAt },
        "[ImportManager] Import failed, previous version restored"
      );
      return keptAt;
    } catch (restoreErr) {
      logger.error(
        { restoreErr, downloadId, asidePath: replacement.asidePath },
        "[ImportManager] Could not restore the previous version after a failed import"
      );
      return null;
    }
  }

  /**
   * Cleans up the version the import replaced, then records it in history and notifies.
   * Best effort: the new version is already imported, so nothing here may fail the import.
   */
  private async completeReplacement(
    replacement: UpgradeReplacement,
    download: NonNullable<Awaited<ReturnType<IStorage["getGameDownload"]>>>,
    game: NonNullable<Awaited<ReturnType<IStorage["getGame"]>>>
  ): Promise<void> {
    const userId = game.userId ?? "";
    let outcome: string;
    let failed = false;
    try {
      const archivedTo = await disposeOldVersion(replacement);
      outcome = archivedTo
        ? `the previous version was moved to ${archivedTo}`
        : "the previous version was deleted";
    } catch (error) {
      failed = true;
      const leftAt = replacement.asidePath ?? replacement.oldPath;
      outcome = `the previous version could not be cleaned up and is still at ${leftAt}`;
      logger.error(
        { error, downloadId: download.id, leftAt },
        "[ImportManager] Could not clean up the replaced version"
      );
    }

    let versions = "";
    try {
      const after = await this.storage.getGame(game.id);
      const from = game.installedVersion;
      const to = after?.installedVersion;
      if (from && to && from !== to) versions = ` (${from} to ${to})`;
    } catch (error) {
      logger.debug({ error }, "[ImportManager] Could not read the new installed version");
    }
    const message = `Replaced the installed version${versions}: ${outcome}.`;

    try {
      await this.storage.addDownloadEvent({
        userId,
        gameId: game.id,
        gameTitle: game.title,
        eventType: "upgrade",
        releaseTitle: download.downloadTitle,
        downloaderName: null,
        message,
      });
    } catch (error) {
      logger.warn({ error, downloadId: download.id }, "[ImportManager] Replacement not recorded");
    }

    try {
      const prefs = resolvePrefs(await this.storage.getUserSettings(userId));
      if (prefs.downloadCompleted.inApp) {
        const notification = await this.storage.addNotification({
          userId: game.userId ?? undefined,
          type: failed ? "warning" : "success",
          title: failed ? "Version replaced, cleanup failed" : "Version replaced",
          message: `${game.title}: ${message.charAt(0).toLowerCase()}${message.slice(1)}`,
          link: `/games/${encodeURIComponent(game.id)}`,
        });
        notifyUser("notification", notification, notification.userId);
        if (prefs.downloadCompleted.apprise) void appriseClient.send(notification);
      }
    } catch (error) {
      logger.warn({ error, downloadId: download.id }, "[ImportManager] Replacement not notified");
    }
  }
  /**
   * Persist the first library target only. A later import may land in a
   * category subfolder or a different file, but it must not move the game's
   * root away from the location established by the first successful import.
   * The storage operation is conditional so concurrent imports cannot replace
   * one another's target.
   */
  async setLibraryPathOnce(
    game: NonNullable<Awaited<ReturnType<IStorage["getGame"]>>>,
    candidatePath: string
  ): Promise<void> {
    if (game.libraryPath) return;

    const libraryPath = path.resolve(candidatePath);
    const updated = await this.storage.setGameLibraryPathIfUnset(game.id, libraryPath);
    if (updated?.libraryPath) {
      game.libraryPath = updated.libraryPath;
      return;
    }

    // A concurrent import may have won the conditional write while this game
    // object was still stale. Refresh it so callers in the same workflow use
    // the persisted first target from this point onward.
    const persistedGame = await this.storage.getGame(game.id);
    if (persistedGame?.libraryPath) game.libraryPath = persistedGame.libraryPath;
  }

  private async recordImportedFiles(
    downloadId: string,
    game: NonNullable<Awaited<ReturnType<IStorage["getGame"]>>>,
    filesPlaced: string[],
    downloadTitle: string,
    placedFileCategories?: FileCategoryEntry[]
  ): Promise<void> {
    if (filesPlaced.length === 0) return;

    const suggestion = await this.suggestImportContent(game, downloadTitle);
    const existing = await this.storage.getGameFiles(game.id);
    const existingByPath = new Map(existing.map((file) => [path.resolve(file.filePath), file]));
    for (const [index, filePath] of filesPlaced.entries()) {
      const resolvedPath = path.resolve(filePath);
      const stats = await fs.stat(resolvedPath).catch(() => undefined);
      if (!stats || (typeof stats.isFile === "function" && !stats.isFile())) continue;

      const selected = placedFileCategories?.[index];
      const category = selected
        ? selected.category === "packs"
          ? "extra"
          : selected.category
        : importedFileCategory(resolvedPath);
      const suggestionMatchesSelected =
        suggestion != null && contentSuggestionMatchesFile(suggestion.category, category);
      const explicitContentMatches =
        selected?.igdbContentId != null &&
        contentSuggestionMatchesFile(
          selected.category === "update"
            ? "update"
            : selected.category === "dlc"
              ? "dlc"
              : selected.category === "packs"
                ? "packs"
                : "extra",
          category
        );
      const existingFile = existingByPath.get(resolvedPath);
      if (existingFile) {
        const contentId =
          (explicitContentMatches ? selected?.igdbContentId : undefined) ??
          (suggestion && suggestionMatchesSelected ? suggestion.id : undefined);
        if (contentId != null && existingFile.igdbContentId == null) {
          await this.storage.updateGameFileContentId(existingFile.id, contentId);
        }
        continue;
      }

      const created = await this.storage.addGameFile({
        gameId: game.id,
        downloadId,
        originalName: path.basename(resolvedPath),
        storedName: path.basename(resolvedPath),
        category,
        filePath: resolvedPath,
        fileSize: typeof stats.size === "number" ? stats.size : null,
        ...(explicitContentMatches
          ? { igdbContentId: selected.igdbContentId }
          : suggestion && suggestionMatchesSelected
            ? { igdbContentId: suggestion.id }
            : {}),
      });
      existingByPath.set(resolvedPath, created);
    }
  }

  /** Best-effort: a version that can't be recorded must not fail an import that succeeded. */
  private async recordInstalledVersion(
    downloadId: string,
    game: NonNullable<Awaited<ReturnType<IStorage["getGame"]>>>,
    libraryPath: string
  ): Promise<void> {
    try {
      const download = await this.storage.getGameDownload(downloadId);
      if (download) {
        // A patch waits for its base release: the files of a patch alone say nothing yet.
        const recorded = await recordDeliveredVersion(this.storage, download);
        // The files now in the library are the better source: they replace the release's
        // version. A DLC or extras pack's version.txt says nothing about the base game.
        if (recorded && carriesBaseGameVersion(download.downloadTitle, download.category)) {
          await recordVersionFromInstallFolder(this.storage, game.id, libraryPath);
        }
      }
    } catch (error) {
      logger.warn({ error, downloadId }, "[ImportManager] Could not record the installed version");
    }
  }

  private async verifyLocalPath(
    downloadId: string,
    localPath: string,
    meta: {
      downloaderName: string;
      remoteDownloadPath: string;
      gameTitle?: string;
      userId?: string | undefined;
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
    emitWebhookEvent(
      "import.failed",
      {
        downloadId,
        gameTitle: meta.gameTitle ?? null,
        reason: "The downloaded files could not be accessed. Check the path mappings.",
      },
      meta.userId
    );
    if (meta.gameTitle && meta.userId) {
      try {
        const notification = await this.storage.addNotification({
          userId: meta.userId,
          type: "warning",
          title: "Import needs attention",
          message: `"${meta.gameTitle}" finished downloading but its local path could not be accessed. Check Settings → Path Mappings or trigger the import manually.`,
          link: "/settings/import",
        });
        notifyUser("notification", notification, notification.userId);
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
          link: "/downloads",
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

  /**
   * Moves a scan-flagged download out of the downloader's directory and into an
   * isolated quarantine folder (a sibling of the library root, never inside it),
   * marks the download "quarantined" instead of importing it, and raises a
   * Security Alert notification. A failed move is rethrown rather than swallowed —
   * QUARANTINED_STATUS is a contract that the file was actually relocated, and both
   * callers already treat a thrown error as "leave this for manual review", which is
   * the right outcome when the file is still sitting at its original, unquarantined path.
   */
  private async quarantineDownload(
    downloadId: string,
    game: { title: string; userId?: string | null },
    localPath: string,
    scanResult: ScanResult,
    libraryRoot: string
  ): Promise<void> {
    const quarantineRoot = path.join(path.dirname(libraryRoot), ".questarr-quarantine");
    const quarantineDest = path.join(quarantineRoot, downloadId, path.basename(localPath));

    // downloadId is a server-generated UUID and path.basename() can only ever
    // contribute a single path segment, so quarantineDest can't actually escape
    // quarantineRoot — but the guard is spelled out inline (matching
    // assertWithinRoots's shape, condition and all) directly gating the
    // fs.ensureDir/fs.move sinks below, so CodeQL's path-injection query
    // recognizes it as sanitizing them in this same function.
    const resolvedQuarantineRoot = path.resolve(quarantineRoot);
    const resolvedQuarantineDest = path.resolve(quarantineDest);
    const relativeToQuarantineRoot = path.relative(resolvedQuarantineRoot, resolvedQuarantineDest);

    let quarantinedPath = localPath;
    if (
      relativeToQuarantineRoot !== ".." &&
      !relativeToQuarantineRoot.startsWith(".." + path.sep) &&
      !path.isAbsolute(relativeToQuarantineRoot)
    ) {
      try {
        await fs.ensureDir(path.dirname(resolvedQuarantineDest));
        await fs.move(localPath, resolvedQuarantineDest, { overwrite: true });
        quarantinedPath = resolvedQuarantineDest;
      } catch (moveErr) {
        logger.error(
          { moveErr, downloadId, localPath },
          "[ImportManager] Failed to move flagged download to quarantine — leaving it in place"
        );
        throw moveErr;
      }
    } else {
      logger.error(
        { downloadId, localPath, quarantineDest },
        "[ImportManager] Computed quarantine path escaped the quarantine root — leaving the download in place"
      );
    }

    logger.warn(
      { downloadId, gameTitle: game.title, reason: scanResult.reason, quarantinedPath },
      "[ImportManager] Download flagged by security scan and quarantined"
    );

    await this.storage.updateGameDownloadStatus(
      downloadId,
      QUARANTINED_STATUS,
      scanResult.reason ?? "Flagged by security scan"
    );

    try {
      const userSettings = await this.storage.getUserSettings(game.userId ?? "");
      const prefs = resolvePrefs(userSettings);

      // Matches the gating convention used throughout cron.ts (e.g. the
      // downloadCompleted notification): the in-app preference guards
      // creating the notification at all, and apprise dispatch is a nested
      // check on top of that.
      if (prefs.securityAlert.inApp) {
        const providerLabel = scanResult.source === "virustotal" ? "VirusTotal" : "ClamAV";
        const notification = await this.storage.addNotification({
          userId: game.userId ?? undefined,
          type: "error",
          title: `Security Alert: Download Flagged by ${providerLabel}`,
          message: `"${game.title}" was flagged and quarantined. ${scanResult.reason ?? ""}`.trim(),
          link: "/downloads",
        });
        notifyUser("notification", notification, notification.userId);

        if (prefs.securityAlert.apprise) {
          await appriseClient.send(notification);
        }
      }
    } catch (notifyErr) {
      logger.error(
        { notifyErr, downloadId },
        "[ImportManager] Failed to create security alert notification"
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

  isImportInFlight(downloadId: string): boolean {
    return this.importsInFlight.has(downloadId);
  }

  async processImport(
    downloadId: string,
    remoteDownloadPath: string,
    password?: string
  ): Promise<void> {
    if (this.importsInFlight.has(downloadId)) {
      logger.warn(
        { downloadId },
        "[ImportManager] Import already running, ignoring a second start"
      );
      return;
    }
    this.importsInFlight.add(downloadId);
    try {
      await this.runImport(downloadId, remoteDownloadPath, password);
    } finally {
      this.importsInFlight.delete(downloadId);
    }
  }

  private async runImport(
    downloadId: string,
    remoteDownloadPath: string,
    password?: string
  ): Promise<void> {
    const download = await this.storage.getGameDownload(downloadId);
    if (!download) {
      logger.warn({ downloadId }, "[ImportManager] Download not found");
      return;
    }

    const queuedGame = await this.storage.getGame(download.gameId);
    if (!queuedGame) {
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

    const queuedConfig = await this.storage.getImportConfig(queuedGame.userId ?? undefined);
    if (!queuedConfig.enablePostProcessing) {
      logger.info({ downloadId }, "[ImportManager] Post-processing disabled, skipping");
      await this.storage.updateGameDownloadStatus(downloadId, "completed");
      return;
    }

    // One import at a time per game: a second one must not land in a folder the first is
    // still replacing, or be swept away when the first rolls back.
    const release = await this.acquireGameLock(queuedGame.id);
    try {
      // An import that ran while this one waited may have moved the game's files or changed
      // its version, so the game and the settings are read again now that the lock is held.
      const game = (await this.storage.getGame(queuedGame.id)) ?? queuedGame;
      const config = await this.storage.getImportConfig(game.userId ?? undefined);
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

      const scanResult = await this.securityScanService.scan(localPath);
      if (scanResult.blocked) {
        await this.quarantineDownload(
          downloadId,
          game,
          localPath,
          scanResult,
          config.libraryRoot || "/data"
        );
        return;
      }
      if (scanResult.incomplete) {
        // Not a detection, so the files stay where the client put them (seeding
        // keeps working); the user decides from Pending Manual Imports.
        logger.warn(
          { downloadId, gameTitle: game.title, reason: scanResult.reason },
          "[ImportManager] Security scan incomplete, holding the import for manual review"
        );
        await this.storage.updateGameDownloadStatus(
          downloadId,
          "manual_review_required",
          scanResult.reason ?? "Security scan could not examine every file"
        );
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

      const platformDir = await this.resolvePlatformFolder(
        download.downloadTitle || "",
        game,
        config.importPlatformIds
      );
      const plan = await strategy.planImport(localPath, game, libraryRoot, config, platformDir, {
        ...(needsExtraction && !archiveResolution!.isDirectorySource
          ? { treatAsDirectory: true }
          : {}),
        downloadTitle: download.downloadTitle,
        releaseCategory: (download.category ||
          inferReleaseCategory(download.downloadTitle || "")) as DownloadCategory,
      });

      // A new full release of a game that already has files in the library replaces them
      // when the user turned that on. Add-ons (DLC, updates, extras) never do.
      const replacement = await this.planReplacement(
        download,
        game,
        config,
        this.replacementTarget(game, plan.wrapperFolder, plan.proposedPath),
        localPath
      );

      // "Destination already exists" is the old version itself when the new one goes to the
      // same place: it is moved aside below instead of sending the import to review.
      if (plan.needsReview && !replacement?.samePath) {
        await this.flagNeedsReview(downloadId, game, plan);
        return;
      }

      // planImport pre-categorizes a directory source's files into sortExtras
      // subfolders, including the archive itself. When extraction is still pending,
      // that categorization is both wrong (the archive gets relocated expecting a
      // flat destDir, not a category subfolder) and redundant — the post-extraction
      // reorganizeBySortExtras pass in transferWithUnpack re-categorizes everything,
      // extracted contents included, once the real files exist.
      const extractionMetadata = needsExtraction
        ? this.extractionContentMetadata(plan, archiveResolution!)
        : undefined;
      if (needsExtraction) {
        plan.fileCategories = undefined;
      }

      await this.storage.updateGameDownloadStatus(downloadId, "completed_pending_import");
      const result = await this.importWithReplacement(
        replacement,
        config.transferMode,
        download,
        game,
        async () => {
          const transferred = await this.transferWithUnpack(
            plan,
            config.transferMode,
            archiveResolution,
            game,
            password,
            // Already inside update/ or dlc/: nothing left to sort.
            config.sortExtras && !plan.addonGameFolder,
            undefined,
            extractionMetadata
          );
          // An update or DLC in a subfolder does not move the game's own entry.
          return plan.addonGameFolder
            ? { ...transferred, libraryEntry: game.libraryPath ?? plan.addonGameFolder }
            : transferred;
        },
        download.downloadTitle,
        plan.fileCategories
      );
      await this.reportLeftoverArchives(game, result.destDir, {
        extractionAttempted: needsExtraction,
      });
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
      await this.emitImportFailed(downloadId, err);
    } finally {
      release();
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

    const remotePath = resolveRemoteImportPath({ ...details, downloadDir: details.downloadDir });
    const remoteHost = this.extractRemoteHost(downloader.url);
    return this.pathService.translatePath(remotePath, remoteHost);
  }

  /**
   * Renders a naming pattern on a few of the user's own games, plus one synthetic release so
   * the release-derived tokens (Version, Group, Source) show up too. Nothing touches the disk.
   */
  async previewNaming(
    pattern: string,
    userId: string
  ): Promise<Array<{ title: string; leafName: string; fullPath: string }>> {
    const config = await this.storage.getImportConfig(userId);
    const libraryRoot = config.libraryRoot || "/data";
    const games = (await this.storage.getUserGames(userId)).slice(0, 5);
    const samples: Array<{ game: Game; releaseTitle: string }> = games.map((game) => ({
      game,
      releaseTitle: "",
    }));
    samples.push({
      game: {
        title: "The Example Quest: Remastered",
        releaseDate: "2021-06-15",
        igdbId: 12345,
        steamAppId: 67890,
        platforms: ["PC (Microsoft Windows)"],
      } as unknown as Game,
      releaseTitle: "The.Example.Quest.Remastered.v1.2.3-GROUP",
    });
    return Promise.all(
      samples.map(async ({ game, releaseTitle }) => {
        const platformDir = await this.resolvePlatformFolder(
          releaseTitle,
          game,
          config.importPlatformIds
        );
        const leafName = resolveLibraryLeafName(
          game,
          { renamePattern: pattern },
          platformDir,
          releaseTitle
        );
        return {
          title: game.title,
          leafName,
          fullPath: path.join(libraryRoot, platformDir, leafName),
        };
      })
    );
  }

  private async getImportContentItems(
    game: NonNullable<Awaited<ReturnType<IStorage["getGame"]>>>
  ): Promise<ImportContentSuggestion[]> {
    const items = new Map<number, ImportContentSuggestion>();
    for (const item of game.expansions ?? []) {
      if (Number.isInteger(item.id) && item.id > 0) {
        const cachedIgdbCategory =
          item.igdbCategory ??
          item.gameType ??
          (item.category === "update" ? 14 : item.category === "packs" ? 13 : 2);
        items.set(item.id, {
          id: item.id,
          name: item.name,
          category: contentCategoryForIgdbCategory(cachedIgdbCategory),
        });
      }
    }

    if (game.igdbId) {
      try {
        const { base, editions, expandedGames, parentGames } = await igdbClient.getGameEditions(
          game.igdbId,
          { includeLegacyContent: true }
        );
        const liveItems: Array<{ item: IGDBContentRef; fallbackCategory: number }> = [
          ...(base?.expansions ?? []).map((item) => ({ item, fallbackCategory: 2 })),
          ...(base?.dlcs ?? []).map((item) => ({ item, fallbackCategory: 1 })),
          ...(base?.standalone_expansions ?? []).map((item) => ({ item, fallbackCategory: 4 })),
          ...(expandedGames ?? base?.expanded_games ?? [])
            .filter((item) => item.category !== 10 && item.category !== 11)
            .map((item) => ({ item, fallbackCategory: 10 })),
          ...(parentGames ?? []).map((item) => ({ item, fallbackCategory: 10 })),
          ...editions.map((item) => ({ item, fallbackCategory: 10 })),
        ];
        for (const { item, fallbackCategory } of liveItems) {
          if (Number.isInteger(item.id) && item.id > 0 && !items.has(item.id)) {
            const igdbCategory = item.category ?? item.game_type ?? fallbackCategory;
            items.set(item.id, {
              id: item.id,
              name: item.name,
              category: contentCategoryForIgdbCategory(igdbCategory),
            });
          }
        }
      } catch (error) {
        logger.warn(
          { error, igdbId: game.igdbId },
          "Could not load IGDB content for import review"
        );
      }
    }

    return Array.from(items.values());
  }

  private async suggestImportContent(
    game: NonNullable<Awaited<ReturnType<IStorage["getGame"]>>>,
    downloadTitle: string
  ): Promise<ImportContentSuggestion | null> {
    const inferred = categorizeDownload(downloadTitle).category;
    if (
      !game.igdbId ||
      !downloadTitle.trim() ||
      (inferred !== "update" && inferred !== "dlc" && inferred !== "packs")
    ) {
      return null;
    }
    return findImportContentMatch(downloadTitle, await this.getImportContentItems(game));
  }

  private extractionContentMetadata(
    plan: ImportReview,
    resolution: ArchiveResolution
  ): ExtractionContentMetadata | undefined {
    const archiveName = path.basename(resolution.archivePath);
    const relativeArchiveName = resolution.isDirectorySource
      ? path.relative(plan.originalPath, resolution.archivePath)
      : archiveName;
    const matches = (plan.fileCategories ?? []).filter(
      (entry) =>
        path.normalize(entry.name) === path.normalize(relativeArchiveName) ||
        path.basename(entry.name) === archiveName
    );
    const selected = matches.length === 1 ? matches[0] : undefined;
    return selected?.igdbContentId != null
      ? { category: selected.category, igdbContentId: selected.igdbContentId }
      : undefined;
  }

  async planConfirmImport(
    downloadId: string,
    overrideSourcePath?: string,
    callerUserId?: string
  ): Promise<{
    originalPath: string | null;
    proposedPath: string;
    files: Array<{
      name: string;
      isArchive: boolean;
      category?: FileCategoryEntry["category"];
      suggestedContentId?: number;
      suggestedContentName?: string;
    }>;
    hasArchive: boolean;
    totalCount: number;
    suggestedContent: ImportContentSuggestion | null;
  }> {
    const download = await this.storage.getGameDownload(downloadId, callerUserId);
    if (!download) throw new Error(`Download ${downloadId} not found`);

    const game = await this.storage.getGame(download.gameId);
    if (!game) throw new Error(`Game not found for download ${downloadId}`);

    const suggestedContent = await this.suggestImportContent(game, download.downloadTitle);

    const config = await this.storage.getImportConfig(game.userId ?? undefined);
    const libraryRoot = config.libraryRoot || "/data";

    let resolvedOriginalPath: string | null = null;
    try {
      resolvedOriginalPath =
        (await this.resolveConfirmOriginalPath(overrideSourcePath, download)) ?? null;
    } catch {
      // Source resolution failed — still return a proposed path based on game title
    }

    const platformDir = await this.resolvePlatformFolder(
      download.downloadTitle || "",
      game,
      config.importPlatformIds
    );
    const fallbackProposedPath = path.join(
      libraryRoot,
      platformDir,
      resolveLibraryLeafName(game, config, platformDir, download.downloadTitle)
    );

    if (resolvedOriginalPath) {
      const { files, hasArchive, totalCount } = await this.readSourceFiles(resolvedOriginalPath);
      try {
        const strategy = new PCImportStrategy(await this.pathService.getConfiguredRoots());
        const plan = await strategy.planImport(
          resolvedOriginalPath,
          game,
          libraryRoot,
          config,
          platformDir,
          {
            downloadTitle: download.downloadTitle,
            releaseCategory: (download.category ||
              inferReleaseCategory(download.downloadTitle || "")) as DownloadCategory,
          }
        );
        const filesWithCategories = files.map((file) => {
          const category = plan.fileCategories?.find((entry) => entry.name === file.name)?.category;
          return {
            ...file,
            ...(category ? { category } : {}),
            ...(suggestedContent
              ? {
                  suggestedContentId: suggestedContent.id,
                  suggestedContentName: suggestedContent.name,
                }
              : {}),
          };
        });
        return {
          originalPath: resolvedOriginalPath,
          proposedPath: plan.proposedPath,
          files: filesWithCategories,
          hasArchive,
          totalCount,
          suggestedContent,
        };
      } catch {
        // Source not yet accessible (e.g. still in incomplete folder) — path is known but can't be stat'd
        return {
          originalPath: resolvedOriginalPath,
          proposedPath: fallbackProposedPath,
          files,
          hasArchive,
          totalCount,
          suggestedContent,
        };
      }
    }

    return {
      originalPath: null,
      proposedPath: fallbackProposedPath,
      files: [],
      hasArchive: false,
      totalCount: 0,
      suggestedContent,
    };
  }

  async confirmImport(
    downloadId: string,
    overridePlan?: ConfirmPlan,
    callerUserId?: string,
    progress?: ImportProgress
  ): Promise<void> {
    if (this.importsInFlight.has(downloadId)) {
      throw new ImportInProgressError("An import of this download is already running");
    }
    this.importsInFlight.add(downloadId);
    try {
      await this.runConfirmImport(downloadId, overridePlan, callerUserId, progress);
    } finally {
      this.importsInFlight.delete(downloadId);
    }
  }

  private async runConfirmImport(
    downloadId: string,
    overridePlan?: ConfirmPlan,
    callerUserId?: string,
    progress?: ImportProgress
  ): Promise<void> {
    const download = await this.storage.getGameDownload(downloadId, callerUserId);

    if (!download) {
      throw new Error(`Download ${downloadId} not found`);
    }

    // Defense in depth: the client hides the Review action for a quarantined
    // download, but that's a UI convenience, not the security boundary — this
    // endpoint must independently refuse to transfer a file the scan already
    // flagged, regardless of what the caller submits as a plan.
    if (download.status === QUARANTINED_STATUS) {
      throw new Error("This download was flagged by the security scan and cannot be imported.");
    }

    // A completed import is final: reconfirming it must neither re-transfer files nor
    // demote the download back to manual review.
    if (download.status === "imported") {
      logger.info({ downloadId }, "[ImportManager] Import already completed, nothing to do");
      return;
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

    if (overridePlan.fileCategories?.some((entry) => entry.igdbContentId != null)) {
      const contentItems = await this.getImportContentItems(game);
      for (const entry of overridePlan.fileCategories) {
        if (entry.igdbContentId == null) continue;
        const selectedContent = contentItems.find((item) => item.id === entry.igdbContentId);
        const categoryMatches =
          selectedContent != null &&
          ((selectedContent.category === "update" && entry.category === "update") ||
            (selectedContent.category !== "update" &&
              (entry.category === "dlc" || entry.category === "packs")));
        if (!categoryMatches) {
          throw new Error("File category does not match the selected IGDB content");
        }
      }
    }

    // The same gate processImport runs before any automatic transfer — a manual
    // confirmation is still a transfer, so it must not be a way to route a
    // flagged file into the library without ever being scanned.
    const scanResult = progress
      ? await this.securityScanService.scan(resolvedOriginalPath, {
          onPhase: (phase) => progress.setPhase(phase),
          onBytes: (processed, total) => progress.setBytes(processed, total),
        })
      : await this.securityScanService.scan(resolvedOriginalPath);
    if (scanResult.blocked) {
      await this.quarantineDownload(
        downloadId,
        game,
        resolvedOriginalPath,
        scanResult,
        config.libraryRoot || "/data"
      );
      throw new Error(scanResult.reason ?? "Flagged by security scan");
    }
    if (scanResult.incomplete) {
      const reason = scanResult.reason ?? "Security scan could not examine every file";
      // Importing an incompletely scanned download needs the user to have seen why.
      // processImport records the reason on the pending import; when this
      // confirmation is the first scan (e.g. right after linking a game), record it
      // now and stop, so the next confirmation is an informed one.
      if (download.status !== "manual_review_required" || download.errorMessage !== reason) {
        await this.storage.updateGameDownloadStatus(downloadId, "manual_review_required", reason);
        throw new IncompleteScanError(`${reason} Confirm again to import it anyway.`);
      }
      logger.warn(
        { downloadId, reason: scanResult.reason },
        "[ImportManager] Importing a download the security scan could not fully examine, as confirmed by the user"
      );
    }

    if (!overridePlan.proposedPath) {
      throw new Error("Proposed path is required for import validation");
    }

    const archiveResolution = overridePlan.unpack
      ? // An explicit unpack request may extract a disc image; auto-unpack never does.
        await this.resolveArchive(resolvedOriginalPath, { includeDiscImages: true })
      : null;
    const needsExtraction = !!archiveResolution && !archiveResolution.alreadyExtracted;
    const extractionMetadata = needsExtraction
      ? this.extractionContentMetadata(
          { ...overridePlan, originalPath: resolvedOriginalPath },
          archiveResolution!
        )
      : undefined;

    // The client always echoes back an extension-bearing proposedPath regardless of the
    // unpack toggle (it can't know in advance whether unpack will be requested), so a
    // single-file archive that will be unpacked has its extension stripped here — the one
    // place that knows both the resolved archive and the confirmed unpack intent.
    let proposedPath = overridePlan.proposedPath;
    if (needsExtraction && !archiveResolution!.isDirectorySource) {
      const ext = path.extname(resolvedOriginalPath);
      if (ext && proposedPath.toLowerCase().endsWith(ext.toLowerCase())) {
        proposedPath = proposedPath.slice(0, -ext.length);
        // a wrapper folder around the archive is the folder it unpacks into; only when the
        // setting made one, or a game named like its platform folder would lose a level
        if (
          config.folderForSingleFiles &&
          path.basename(path.dirname(proposedPath)) === path.basename(proposedPath)
        ) {
          proposedPath = path.dirname(proposedPath);
        }
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
      // Derived here, never taken from the client: it ends up as the game's library entry
      // and what a later upgrade replaces.
      wrapperFolder: await this.wrappedSingleFileFolder(config, resolvedOriginalPath, proposedPath),
    };

    const strategy = new PCImportStrategy(await this.pathService.getConfiguredRoots());
    // An update or DLC goes in its game's subfolder only when the server's own plan says so
    // and the confirmed path is inside that folder: never taken from the client.
    let addonPlan: ImportReview | undefined;
    if (config.addonSubfolders) {
      const addonPlatformDir = await this.resolvePlatformFolder(
        download.downloadTitle || "",
        game,
        config.importPlatformIds
      );
      addonPlan = await strategy
        .planImport(resolvedOriginalPath, game, config.libraryRoot, config, addonPlatformDir, {
          // A single-file archive that is being unpacked becomes a folder
          ...(needsExtraction && !archiveResolution?.isDirectorySource
            ? { treatAsDirectory: true }
            : {}),
          downloadTitle: download.downloadTitle,
          releaseCategory: (download.category ||
            inferReleaseCategory(download.downloadTitle || "")) as DownloadCategory,
        })
        .catch(() => undefined);
      if (addonPlan?.addonGameFolder) {
        const rel = path.relative(path.resolve(addonPlan.addonGameFolder), resolvedTarget);
        if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) {
          planToExecute.addonGameFolder = addonPlan.addonGameFolder;
          if (needsExtraction && !archiveResolution?.isDirectorySource) {
            // The default archive-name destination (update/<name>) collapses into update/ or
            // dlc/, as in an automatic import; a destination the user chose is kept.
            const archiveName = path.basename(
              resolvedOriginalPath,
              path.extname(resolvedOriginalPath)
            );
            const defaultTarget = path.join(path.resolve(addonPlan.proposedPath), archiveName);
            if (resolvedTarget === defaultTarget) {
              planToExecute.proposedPath = addonPlan.proposedPath;
            }
          }
        }
      }
    }
    if ((config.sortExtras || overridePlan.fileCategories?.length) && !needsExtraction) {
      const categorizedPlan = await strategy.planImport(
        resolvedOriginalPath,
        game,
        config.libraryRoot,
        overridePlan.fileCategories?.length ? { ...config, sortExtras: true } : config
      );
      const requestedByName = new Map(
        (overridePlan.fileCategories ?? []).map((entry) => [entry.name, entry])
      );
      const sourceStats = await fs.stat(resolvedOriginalPath);
      const baseline =
        (addonPlan && !addonPlan.addonGameFolder ? addonPlan.fileCategories : undefined) ??
        categorizedPlan.fileCategories ??
        (!sourceStats.isDirectory()
          ? [{ name: path.basename(resolvedOriginalPath), category: "main" as const }]
          : []);
      for (const requested of requestedByName.values()) {
        if (!baseline.some((entry) => entry.name === requested.name)) {
          throw new Error(`Import category references an unknown source file: ${requested.name}`);
        }
      }
      planToExecute.fileCategories = baseline.map((entry) => ({
        ...entry,
        ...(requestedByName.get(entry.name) ?? {}),
      }));
    }

    const release = await this.acquireGameLock(game.id);
    try {
      // An import that ran while this one waited may have moved the game's files or changed
      // its version: plan the replacement on the game as it is now that the lock is held.
      const current = (await this.storage.getGame(game.id)) ?? game;
      // The add-on folder was planned on the game as it was before the lock: if a base import
      // moved the game meanwhile, it must be confirmed again rather than land beside the old one.
      if (planToExecute.addonGameFolder && current.libraryPath !== game.libraryPath) {
        throw new Error(
          "The game's library folder changed while this import was waiting: confirm it again"
        );
      }
      // A confirmed import replaces the previous version the same way an automatic one does.
      const importConfig = await this.storage.getImportConfig(current.userId ?? undefined);
      const replacement = await this.planReplacement(
        download,
        current,
        importConfig,
        // A single file wrapped in its game folder replaces the old version as that folder
        this.replacementTarget(current, planToExecute.wrapperFolder, proposedPath),
        resolvedOriginalPath
      );
      const result = await this.importWithReplacement(
        replacement,
        transferMode,
        download,
        current,
        async () => {
          const transferred = await this.transferWithUnpack(
            planToExecute,
            transferMode,
            archiveResolution,
            current,
            overridePlan.password,
            config.sortExtras && !planToExecute.addonGameFolder,
            progress,
            extractionMetadata
          );
          // An update or DLC in a subfolder does not move the game's own entry.
          return planToExecute.addonGameFolder
            ? { ...transferred, libraryEntry: current.libraryPath ?? planToExecute.addonGameFolder }
            : transferred;
        },
        download.downloadTitle,
        planToExecute.fileCategories
      );
      await this.reportLeftoverArchives(current, result.destDir, {
        extractionAttempted: needsExtraction,
      });
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
      await this.emitImportFailed(downloadId, err);
      throw err;
    } finally {
      release();
    }
  }
}
