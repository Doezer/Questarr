// Library scanner: walks configured root folders looking for games that are
// already on disk but not yet tracked in Questarr (an older library, a
// secondary drive, a GameVault-style flat folder of installers). This is a
// discovery source only — it never touches the configured library root or
// the normal download-import pipeline.
//
// Design:
// - Every immediate child of a root folder (directory or standalone file) is
//   treated as one game candidate. We do not recurse looking for nested
//   games, so DLC/extras subfolders don't get mistaken for separate titles.
// - Matching against IGDB is deliberately conservative: only a strong match
//   is auto-linked. Everything else is queued as "unmatched" for the user to
//   resolve manually.
// - A matched game is created with `libraryPath` pointing at the discovered
//   folder, outside the configured library root. The existing delete-game
//   safety check (routes.ts) already refuses to delete files outside the
//   library root, so these discovered files are never touched by that flow.

import fs from "fs";
import path from "path";
import { storage } from "./storage.js";
import { igdbClient, type IGDBGame } from "./igdb.js";
import { normalizeTitle, cleanReleaseName } from "../shared/title-utils.js";
import { categorizeDownload } from "../shared/download-categorizer.js";
import { igdbLogger, routesLogger } from "./logger.js";
import { notifyUser } from "./socket.js";
import type { InsertGame, InsertGameFile, GameFileCategory } from "../shared/schema.js";

// ---------- Types ----------

export interface ScanProgress {
  rootFolderId: string;
  rootFolderPath: string;
  startedAt: string;
  finishedAt?: string;
  status: "running" | "completed" | "failed";
  totalCandidates: number;
  processedCandidates: number;
  matched: number;
  unmatched: number;
  errors: number;
  currentCandidate?: string;
  errorMessage?: string;
}

export interface UnmatchedEntry {
  rootFolderId: string;
  rootFolderPath: string;
  folderName: string; // relative to the root folder (the leaf)
  absolutePath: string;
  candidates: Array<{ igdbId: number; name: string; releaseYear: number | null }>;
}

interface FolderCandidate {
  folderName: string;
  absolutePath: string;
  // A standalone file (e.g. `/games/Witcher 3.iso`) is treated as the game
  // itself rather than recursed into.
  isFile?: boolean;
  fileSize?: number;
}

// Extensions we never index as game assets (nfo/checksums/artwork/etc).
const IGNORED_EXTS = new Set([
  ".nfo",
  ".txt",
  ".md5",
  ".sha1",
  ".sfv",
  ".url",
  ".html",
  ".htm",
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".bmp",
  ".webp",
]);

function isIgnoredFile(filename: string): boolean {
  return IGNORED_EXTS.has(path.extname(filename).toLowerCase());
}

// ---------- Progress store (in-memory; scans are a foreground, single-instance operation) ----------

const progressByFolder = new Map<string, ScanProgress>();
const unmatchedByFolder = new Map<string, UnmatchedEntry[]>();
const activeScans = new Set<string>();

export function getAllScanProgress(): ScanProgress[] {
  return Array.from(progressByFolder.values());
}

export function getScanProgress(rootFolderId: string): ScanProgress | undefined {
  return progressByFolder.get(rootFolderId);
}

export function getAllUnmatched(): UnmatchedEntry[] {
  return Array.from(unmatchedByFolder.values()).flat();
}

export function clearUnmatched(rootFolderId: string, folderName: string): void {
  const list = unmatchedByFolder.get(rootFolderId);
  if (!list) return;
  const filtered = list.filter((e) => e.folderName !== folderName);
  if (filtered.length === 0) {
    unmatchedByFolder.delete(rootFolderId);
  } else {
    unmatchedByFolder.set(rootFolderId, filtered);
  }
}

/**
 * Look up a specific queued unmatched entry. Used to resolve a client-supplied
 * `folderName` to a server-trusted `absolutePath` without ever joining
 * client input onto a filesystem path (see `matchUnmatchedFolder`).
 */
function getUnmatchedEntry(rootFolderId: string, folderName: string): UnmatchedEntry | undefined {
  return unmatchedByFolder.get(rootFolderId)?.find((e) => e.folderName === folderName);
}

function emitProgress(p: ScanProgress) {
  notifyUser("library-scan-progress", p);
}

// ---------- Folder listing ----------

async function listCandidates(rootPath: string): Promise<FolderCandidate[]> {
  const entries = await fs.promises.readdir(rootPath, { withFileTypes: true });
  const candidates: FolderCandidate[] = [];
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const abs = path.join(rootPath, e.name);
    if (e.isDirectory()) {
      candidates.push({ folderName: e.name, absolutePath: abs });
    } else if (e.isFile()) {
      if (isIgnoredFile(e.name)) continue;
      let size = 0;
      try {
        const stat = await fs.promises.stat(abs);
        size = stat.size;
      } catch {
        continue; // Unreadable
      }
      candidates.push({
        // Keep the extension in the identity: two standalone files that
        // only differ by extension (e.g. "Game.iso" and "Game.zip") must
        // not collapse to the same folderName — that key is also what
        // getUnmatchedEntry/clearUnmatched use to disambiguate entries.
        folderName: e.name,
        absolutePath: abs,
        isFile: true,
        fileSize: size,
      });
    }
  }
  return candidates;
}

async function listFiles(
  folderAbsPath: string,
  maxDepth = 2
): Promise<Array<{ absolutePath: string; size: number }>> {
  const results: Array<{ absolutePath: string; size: number }> = [];
  async function walk(dir: string, depth: number) {
    if (depth > maxDepth) return;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith(".")) {
        await walk(abs, depth + 1);
      } else if (entry.isFile() && !isIgnoredFile(entry.name)) {
        try {
          const stat = await fs.promises.stat(abs);
          results.push({ absolutePath: abs, size: stat.size });
        } catch {
          // Unreadable file — skip
        }
      }
    }
  }
  await walk(folderAbsPath, 0);
  return results;
}

// ---------- IGDB matching ----------

/** Score how well an IGDB name matches the folder's cleaned title. 0..1, >= 0.85 auto-matches. */
function scoreMatch(folderClean: string, igdbName: string): number {
  const a = normalizeTitle(folderClean);
  const b = normalizeTitle(igdbName);
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const aArr = a.split(" ").filter(Boolean);
  const bArr = b.split(" ").filter(Boolean);
  const aWords = new Set(aArr);
  const bWords = new Set(bArr);
  let inter = 0;
  aWords.forEach((w) => {
    if (bWords.has(w)) inter += 1;
  });
  const unionSet = new Set<string>([...aArr, ...bArr]);
  if (unionSet.size === 0) return 0;
  const jaccard = inter / unionSet.size;

  const prefixBonus = a.startsWith(b) || b.startsWith(a) ? 0.1 : 0;
  return Math.min(1, jaccard + prefixBonus);
}

async function bestIgdbMatch(folderName: string): Promise<{
  best: IGDBGame | null;
  candidates: IGDBGame[];
  cleaned: string;
  score: number;
}> {
  const cleaned = cleanReleaseName(folderName) || folderName;
  let candidates: IGDBGame[] = [];
  try {
    candidates = await igdbClient.searchGames(cleaned, 5);
  } catch (err) {
    igdbLogger.warn({ err, query: cleaned }, "IGDB search failed during library scan");
    return { best: null, candidates: [], cleaned, score: 0 };
  }
  if (candidates.length === 0) {
    return { best: null, candidates: [], cleaned, score: 0 };
  }

  let best = candidates[0];
  let bestScore = scoreMatch(cleaned, best.name);
  for (let i = 1; i < candidates.length; i += 1) {
    const s = scoreMatch(cleaned, candidates[i].name);
    if (s > bestScore) {
      best = candidates[i];
      bestScore = s;
    }
  }
  return { best, candidates, cleaned, score: bestScore };
}

// ---------- Ingestion ----------

function igdbToInsertGame(igdb: IGDBGame, userId: string): InsertGame {
  const releaseDate = igdb.first_release_date
    ? new Date(igdb.first_release_date * 1000).toISOString().slice(0, 10)
    : null;
  return {
    userId,
    igdbId: igdb.id,
    title: igdb.name,
    summary: igdb.summary ?? null,
    coverUrl: igdb.cover?.url ? `https:${igdb.cover.url.replace("t_thumb", "t_cover_big")}` : null,
    releaseDate,
    rating: igdb.rating ?? null,
    platforms: igdb.platforms?.map((p) => p.name) ?? [],
    genres: igdb.genres?.map((g) => g.name) ?? [],
    publishers:
      igdb.involved_companies?.filter((c) => c.publisher).map((c) => c.company.name) ?? [],
    developers:
      igdb.involved_companies?.filter((c) => c.developer).map((c) => c.company.name) ?? [],
    screenshots:
      igdb.screenshots?.map((s) => `https:${s.url.replace("t_thumb", "t_screenshot_big")}`) ?? [],
    status: "owned",
    releaseStatus: "released",
    source: "scan",
  } as InsertGame;
}

function normalizeCategory(category: string): GameFileCategory {
  // game_files only persists main | dlc | update | extra — "packs" folds into "extra".
  return category === "packs" ? "extra" : (category as GameFileCategory);
}

/**
 * Record scanned files against a game, skipping ones already tracked
 * (matched by absolute path) so re-scans don't create duplicates.
 */
async function assignFilesToGame(
  gameId: string,
  files: Array<{ absolutePath: string; size: number }>
): Promise<number> {
  const existing = await storage.getGameFiles(gameId);
  const existingPaths = new Set(existing.map((f) => f.filePath));

  let added = 0;
  for (const f of files) {
    if (existingPaths.has(f.absolutePath)) continue;
    const name = path.basename(f.absolutePath);
    const parentDir = path.basename(path.dirname(f.absolutePath)).toLowerCase();
    const category = ["dlc", "update", "extra", "packs"].includes(parentDir)
      ? normalizeCategory(parentDir)
      : normalizeCategory(categorizeDownload(path.parse(name).name).category);
    const insert: InsertGameFile = {
      gameId,
      downloadId: null,
      originalName: name,
      storedName: name,
      category,
      filePath: f.absolutePath,
      fileSize: f.size,
    };
    await storage.addGameFile(insert);
    added += 1;
  }
  return added;
}

// ---------- Public API ----------

/** Force-assign an unmatched folder to a specific IGDB game (user override). */
export async function matchUnmatchedFolder(
  rootFolderId: string,
  folderName: string,
  igdbId: number,
  userId: string
): Promise<{ gameId: string; filesAdded: number }> {
  const rootFolder = await storage.getRootFolder(rootFolderId);
  if (!rootFolder) throw new Error("Root folder not found");

  // Never join client-supplied `folderName` onto a filesystem path — resolve
  // it against the server-trusted list of folders/files this root folder's
  // own scan already discovered and queued for review.
  const entry = getUnmatchedEntry(rootFolderId, folderName);
  if (!entry) throw new Error("No matching unmatched entry for this root folder");
  const absolutePath = entry.absolutePath;

  const stat = await fs.promises.stat(absolutePath);
  if (!stat.isFile() && !stat.isDirectory()) {
    throw new Error("Path is neither a directory nor a file");
  }
  const isFile = stat.isFile();
  const standaloneSize = isFile ? stat.size : 0;

  const candidates = await igdbClient.searchGames(folderName, 10);
  const igdb = candidates.find((c) => c.id === igdbId);
  if (!igdb) throw new Error("Selected IGDB game not found in top candidates");

  let game = await storage.getGameByIgdbId(igdbId);
  if (!game) {
    game = await storage.addGame(igdbToInsertGame(igdb, userId));
    await storage.updateGame(game.id, { libraryPath: absolutePath });
  } else if (game.status !== "owned") {
    await storage.updateGameStatus(game.id, { status: "owned" });
  }

  const files = isFile ? [{ absolutePath, size: standaloneSize }] : await listFiles(absolutePath);
  const filesAdded = await assignFilesToGame(game.id, files);

  clearUnmatched(rootFolderId, folderName);
  return { gameId: game.id, filesAdded };
}

/**
 * Scan a single root folder. Runs to completion; progress/unmatched state is
 * available via `getScanProgress` / `getAllUnmatched` while it runs.
 */
export async function scanRootFolderById(rootFolderId: string, userId: string): Promise<void> {
  // Guard before the first await so two near-simultaneous requests for the
  // same root folder can't both pass this check and race on shared
  // progress/unmatched state or duplicate filesystem/IGDB work.
  if (activeScans.has(rootFolderId)) {
    igdbLogger.info({ rootFolderId }, "Skipping scan: already in progress for this root folder");
    return;
  }
  activeScans.add(rootFolderId);

  try {
    const rootFolder = await storage.getRootFolder(rootFolderId);
    if (!rootFolder) throw new Error("Root folder not found");
    if (!rootFolder.enabled) {
      igdbLogger.info({ rootFolderId }, "Skipping scan: root folder is disabled");
      return;
    }

    const progress: ScanProgress = {
      rootFolderId,
      rootFolderPath: rootFolder.path,
      startedAt: new Date().toISOString(),
      status: "running",
      totalCandidates: 0,
      processedCandidates: 0,
      matched: 0,
      unmatched: 0,
      errors: 0,
    };
    progressByFolder.set(rootFolderId, progress);
    unmatchedByFolder.set(rootFolderId, []);
    emitProgress(progress);

    await runScan(rootFolder, progress, userId);
  } finally {
    activeScans.delete(rootFolderId);
  }
}

type RootFolderRow = NonNullable<Awaited<ReturnType<typeof storage.getRootFolder>>>;

/** Auto-link a strongly matched candidate to a game and record its files. */
async function recordMatchedCandidate(
  cand: FolderCandidate,
  best: IGDBGame,
  userId: string,
  files: Array<{ absolutePath: string; size: number }>
): Promise<void> {
  let game = await storage.getGameByIgdbId(best.id);
  if (!game) {
    game = await storage.addGame(igdbToInsertGame(best, userId));
    await storage.updateGame(game.id, { libraryPath: cand.absolutePath });
  } else if (game.status !== "owned") {
    await storage.updateGameStatus(game.id, { status: "owned" });
  }
  await assignFilesToGame(game.id, files);
}

/** Queue a weakly matched (or unmatched) candidate for manual review. */
function recordUnmatchedCandidate(
  rootFolder: RootFolderRow,
  cand: FolderCandidate,
  igdbCandidates: IGDBGame[]
): void {
  const rootFolderId = rootFolder.id;
  const list = unmatchedByFolder.get(rootFolderId) ?? [];
  list.push({
    rootFolderId,
    rootFolderPath: rootFolder.path,
    folderName: cand.folderName,
    absolutePath: cand.absolutePath,
    candidates: igdbCandidates.slice(0, 5).map((c) => ({
      igdbId: c.id,
      name: c.name,
      releaseYear: c.first_release_date
        ? new Date(c.first_release_date * 1000).getUTCFullYear()
        : null,
    })),
  });
  unmatchedByFolder.set(rootFolderId, list);
}

const AUTO_MATCH_THRESHOLD = 0.85;

/** Classify and (auto-)resolve a single scan candidate, updating `progress` in place. */
async function processCandidate(
  rootFolder: RootFolderRow,
  cand: FolderCandidate,
  userId: string,
  progress: ScanProgress
): Promise<void> {
  const files = cand.isFile
    ? [{ absolutePath: cand.absolutePath, size: cand.fileSize ?? 0 }]
    : await listFiles(cand.absolutePath);
  if (files.length === 0) return;

  const { best, candidates: igdbCandidates, score } = await bestIgdbMatch(cand.folderName);

  if (best && score >= AUTO_MATCH_THRESHOLD) {
    await recordMatchedCandidate(cand, best, userId, files);
    progress.matched += 1;
  } else {
    recordUnmatchedCandidate(rootFolder, cand, igdbCandidates);
    progress.unmatched += 1;
  }
}

async function runScan(
  rootFolder: RootFolderRow,
  progress: ScanProgress,
  userId: string
): Promise<void> {
  const rootFolderId = rootFolder.id;
  try {
    const candidates = await listCandidates(rootFolder.path);
    progress.totalCandidates = candidates.length;
    emitProgress(progress);

    for (const cand of candidates) {
      progress.currentCandidate = cand.folderName;
      emitProgress(progress);
      try {
        await processCandidate(rootFolder, cand, userId, progress);
      } catch (err) {
        progress.errors += 1;
        routesLogger.error({ err, folder: cand.folderName }, "scan: error processing folder");
      }
      progress.processedCandidates += 1;
      emitProgress(progress);
    }

    progress.status = "completed";
    progress.finishedAt = new Date().toISOString();
    progress.currentCandidate = undefined;
    emitProgress(progress);
    await storage.touchRootFolderScanned(rootFolderId);
  } catch (err) {
    progress.status = "failed";
    progress.finishedAt = new Date().toISOString();
    progress.errorMessage = err instanceof Error ? err.message : String(err);
    emitProgress(progress);
    routesLogger.error({ err, rootFolderId }, "library scan failed");
  }
}

export async function scanAllEnabledRootFolders(userId: string): Promise<void> {
  const folders = await storage.getEnabledRootFolders();
  for (const folder of folders) {
    await scanRootFolderById(folder.id, userId);
  }
}

// Expose internals for testing.
export const __testing = { scoreMatch, isIgnoredFile };
