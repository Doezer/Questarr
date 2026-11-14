import fs from "fs";
import path from "path";
import { extractVersionFromReleaseName, parseVersion } from "../shared/version-utils.js";

/**
 * Reads the installed version of a game from the files in its install folder. Only files at the
 * top of the folder are looked at (plus the Steam manifest next to a Steam library's
 * `common/<game>` folder), each capped in size and never followed through a symlink, so a scan of
 * a large library stays cheap.
 *
 * Sources, in order: `version.txt`, a GOG `goggame-*.info`, a Steam `appmanifest_*.acf`, an `.nfo`.
 * Versions come back in the display form `compareVersions` reads ("v1.2.3", "Build 12345").
 */

const MAX_FILE_BYTES = 64 * 1024;
const VERSION_FILE_NAMES = new Set(["version.txt", "version", "game_version.txt"]);
// The capture sits in a lookahead plus a backreference so it is atomic: a long digit run can't
// make the engine retry every shorter capture. A qualifier (-beta.1, +build) is not a stable
// version, so those tokens are refused rather than cut down to their numeric prefix.
const NFO_VERSION = /^[ \t]*version\b[\s:.=-]*v?\s?(?=(\d+(?:\.\d+)+))\1(?![\w.]*\d)(?![-+]\w)/im;

async function readSmallText(file: string): Promise<string | null> {
  let handle: fs.promises.FileHandle | undefined;
  try {
    // O_NOFOLLOW: a symlink (also one swapped in after a check) is never opened. The size is
    // checked on the opened file and the read itself is bounded, so a file that grows or is
    // replaced meanwhile can't allocate more than the limit.
    // O_NONBLOCK keeps opening a FIFO from hanging; the isFile() check then rejects it.
    handle = await fs.promises.open(
      file,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK
    );
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return null;
    const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > MAX_FILE_BYTES) return null;
    return buffer.toString("utf8", 0, bytesRead);
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/** "1.2.3" / "v1.2.3" / "Build 123" -> display form, or null when it isn't a clean version. */
function normalizeVersion(raw: string): string | null {
  const parsed = parseVersion(raw);
  if (!parsed) return null;
  if (parsed.kind === "build") return `Build ${parsed.parts[0]}`;
  return `v${raw.trim().replace(/^v\s?/i, "")}`;
}

export function parseVersionTxt(content: string): string | null {
  const line = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find(Boolean);
  if (!line) return null;
  return (
    normalizeVersion(line) ??
    extractVersionFromReleaseName(line) ??
    nfoVersion(line.replace(/^.*?version/i, "version"))
  );
}

function nfoVersion(content: string): string | null {
  const match = NFO_VERSION.exec(content);
  return match?.[1] ? `v${match[1]}` : null;
}

export function parseNfoVersion(content: string): string | null {
  return nfoVersion(content);
}

/** GOG writes the build id of the install in `goggame-<id>.info`. */
export function parseGogInfo(content: string): string | null {
  try {
    const data = JSON.parse(content) as { buildId?: unknown };
    const build =
      typeof data.buildId === "string" || typeof data.buildId === "number"
        ? String(data.buildId).trim()
        : "";
    return /^\d+$/.test(build) ? `Build ${build}` : null;
  } catch {
    return null;
  }
}

/** The `buildid` of a Steam `appmanifest_<appid>.acf`, and its `installdir`. */
export function parseSteamManifest(
  content: string
): { buildId: string; installDir: string } | null {
  const buildId = /"buildid"\s+"(\d+)"/i.exec(content)?.[1];
  const installDir = /"installdir"\s+"([^"]+)"/i.exec(content)?.[1];
  return buildId && installDir ? { buildId, installDir } : null;
}

async function steamBuildForFolder(folder: string): Promise<string | null> {
  const resolved = path.resolve(folder);
  const commonDir = path.dirname(resolved);
  if (path.basename(commonDir).toLowerCase() !== "common") return null;
  const steamapps = path.dirname(commonDir);
  if (path.basename(steamapps).toLowerCase() !== "steamapps") return null;
  let names: string[];
  try {
    names = await fs.promises.readdir(steamapps);
  } catch {
    return null;
  }
  for (const name of names) {
    if (!/^appmanifest_\d+\.acf$/i.test(name)) continue;
    const content = await readSmallText(path.join(steamapps, name));
    const manifest = content ? parseSteamManifest(content) : null;
    if (manifest && manifest.installDir.toLowerCase() === path.basename(resolved).toLowerCase()) {
      return `Build ${manifest.buildId}`;
    }
  }
  return null;
}

/**
 * The version found in an install folder, or null. A path that is a file or doesn't exist
 * yields null.
 */
export async function detectVersionFromInstallFolder(folder: string): Promise<string | null> {
  let names: string[];
  try {
    const stat = await fs.promises.stat(folder);
    if (!stat.isDirectory()) return null;
    names = await fs.promises.readdir(folder);
  } catch {
    return null;
  }
  const byLower = (pred: (lower: string) => boolean) =>
    names.filter((n) => pred(n.toLowerCase())).sort((a, b) => a.localeCompare(b));

  for (const name of byLower((n) => VERSION_FILE_NAMES.has(n))) {
    const content = await readSmallText(path.join(folder, name));
    const version = content ? parseVersionTxt(content) : null;
    if (version) return version;
  }
  for (const name of byLower((n) => /^goggame-\d+\.info$/.test(n))) {
    const content = await readSmallText(path.join(folder, name));
    const version = content ? parseGogInfo(content) : null;
    if (version) return version;
  }
  const steam = await steamBuildForFolder(folder);
  if (steam) return steam;
  for (const name of byLower((n) => n.endsWith(".nfo"))) {
    const content = await readSmallText(path.join(folder, name));
    const version = content ? parseNfoVersion(content) : null;
    if (version) return version;
  }
  return null;
}
