/**
 * Title Utilities
 * 
 * Shared logic for normalizing, cleaning, and matching game titles 
 * and release names (from xREL, Indexers, etc.)
 */

/**
 * Normalizes a title by removing special characters, multiple spaces, and converting to lowercase.
 */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ") // Replace non-alphanumeric with space
    .replace(/\s+/g, " ")        // Multiple spaces to single space
    .trim();
}

/**
 * Common scene release tags and patterns to remove from release names.
 */
const RELEASE_TAGS = [
  /\b(1080p|720p|2160p|4k|uhd|bluray|h264|x264|h265|x265|hevc)\b/i,
  /\b(multi\d*|multilingual|german|english|french|italian|spanish|nordic|pal|ntsc|russian|japanese)\b/i,
  /\b(iso|rip|repack|re-repack|proper|internal|readnfo|nfo|re-nfo|crackfix|fix)\b/i,
  /\b(ps3|ps4|ps5|xbox|xbox360|x360|switch|nsw|wii|wiiu|nds|3ds|gba|psp|psvita|vita)\b/i,
  /\b(mac|linux|osx|os\.x|macos)\b/i,
  /\b(gog|steam|epic|uplay|origin|drm[ -]?free)\b/i,
  /\b(goty|deluxe|complete|gold|ultimate|collectors|definitive|remastered|remake|remaster)\b/i,
];

const VERSION_REGEX = /\b(v\d+([\.\s-]\d+)*|build[\.\s-]\d+)\b/i;

/**
 * Cleans a release name (e.g. from a torrent or NZB) to attempt to extract the base game title.
 */
export function cleanReleaseName(releaseName: string): string {
  // First, handle content in brackets or parentheses that often contains metadata
  let cleaned = releaseName.replace(/[\[\({][^\]\)}]*[\]\)}]/g, (match) => {
    // If the bracketed content contains known tags or is mostly numeric (like a build ID), remove it
    const inner = match.slice(1, -1).toLowerCase();
    const hasTag = RELEASE_TAGS.some(tag => tag.test(inner)) || VERSION_REGEX.test(inner);
    const isNumeric = /^\d+$/.test(inner.replace(/\s/g, ""));
    if (hasTag || isNumeric) return " ";
    return match; // Keep it if it might be part of the title (e.g. "Game (Special Edition)")
  });

  cleaned = cleaned.replace(/[._\-]/g, " "); // Replace dots, underscores, dashes with space
  
  // Remove common release group suffixes (usually -GROUP at the end)
  cleaned = cleaned.replace(/\s-\s?\w+$/g, "");
  cleaned = cleaned.replace(/-(\w+)$/g, " ");

  // Remove all known release tags
  for (const tag of RELEASE_TAGS) {
    cleaned = cleaned.replace(tag, " ");
  }

  // Remove years (only if they are between 1975 and 2040 to avoid removing titles like Cyberpunk 2077)
  cleaned = cleaned.replace(/\b\d{4}\b/g, (match) => {
    const year = parseInt(match);
    if (year >= 1975 && year <= 2040) {
      return " ";
    }
    return match;
  });

  // Final cleanup of extra symbols and spaces
  return cleaned.replace(/[\[\]\(\)]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Checks if two titles match loosely.
 * Can be used to match a known game title against an xREL title or a cleaned release name.
 */
export function titleMatches(a: string, b: string): boolean {
  const normA = normalizeTitle(a);
  const normB = normalizeTitle(b);

  if (!normA || !normB) return false;
  if (normA === normB) return true;

  // For very short titles, require exact match after normalization
  if (normA.length < 5 || normB.length < 5) return normA === normB;

  // Check if one contains the other (e.g. "The Witcher 3" vs "The Witcher 3: Wild Hunt")
  // We check for word boundaries to avoid matching "Fable" with "Fabletown"
  const escapedA = normA.replace(/[.*+?^${}()|[\\]/g, "\\$& ");
  const escapedB = normB.replace(/[.*+?^${}()|[\\]/g, "\\$& ");
  
  const regexA = new RegExp(`\\b${escapedA}\\b`, "i");
  const regexB = new RegExp(`\\b${escapedB}\\b`, "i");

  return regexA.test(normB) || regexB.test(normA);
}

/**
 * Checks if a release name (dirty) matches a specific game title.
 */
export function releaseMatchesGame(releaseName: string, gameTitle: string): boolean {
  // First try matching against the cleaned release name
  const cleaned = cleanReleaseName(releaseName);
  if (titleMatches(cleaned, gameTitle)) return true;

  // Fallback: Check if the normalized game title words are all present in the release name
  const gameWords = normalizeTitle(gameTitle).split(" ").filter(w => w.length > 2);
  if (gameWords.length === 0) return false;

  const normalizedRelease = releaseName.toLowerCase().replace(/[._\-]/g, " ");
  return gameWords.every(word => normalizedRelease.includes(word));
}

export interface ReleaseMetadata {
  gameTitle: string;
  version?: string;
  languages?: string[];
  group?: string;
  platform?: string;
  drm?: string;
  isScene: boolean;
}

/**
 * Parses a release name to extract as much metadata as possible.
 */
export function parseReleaseMetadata(releaseName: string): ReleaseMetadata {
  const cleaned = releaseName.replace(/[._]/g, " ");
  
  // 1. Extract Group (usually after the last dash)
  // More robust group detection: some releases use [Group] at start or end, or -Group at end
  let group: string | undefined;
  const dashGroupMatch = releaseName.match(/-(\w+)(?:\[\w+\])?$/);
  if (dashGroupMatch) {
    group = dashGroupMatch[1];
  } else {
    const bracketMatch = releaseName.match(/^\[(\w+)\]/);
    if (bracketMatch) group = bracketMatch[1];
  }
  
  // 2. Extract Version
  // Handles v1.0, v1 0, v1-0, build.123, etc.
  const versionMatch = cleaned.match(/\b(v\d+([\.\s-]\d+)*|build[\.\s-]\d+)\b/i);
  const version = versionMatch ? versionMatch[0].replace(/[\s-]/g, ".") : undefined;

  // 3. Extract Languages
  const languages: string[] = [];
  if (/\b(multi\d*|multilingual)\b/i.test(cleaned)) languages.push("Multi");
  if (/\bgerman\b/i.test(cleaned)) languages.push("German");
  if (/\bfrench\b/i.test(cleaned)) languages.push("French");
  if (/\bspanish\b/i.test(cleaned)) languages.push("Spanish");
  if (/\bitalian\b/i.test(cleaned)) languages.push("Italian");
  if (/\brussian\b/i.test(cleaned)) languages.push("Russian");
  if (/\bjapanese\b/i.test(cleaned)) languages.push("Japanese");
  if (/\benglish\b/i.test(cleaned)) languages.push("English");

  // 4. Extract Platform
  let platform: string | undefined;
  if (/\b(ps5|playstation\s*5)\b/i.test(cleaned)) platform = "PS5";
  else if (/\b(ps4|playstation\s*4)\b/i.test(cleaned)) platform = "PS4";
  else if (/\b(xbox\s*series|xbsx|xss)\b/i.test(cleaned)) platform = "Xbox Series";
  else if (/\b(xbox|x360|xbox360)\b/i.test(cleaned)) platform = "Xbox";
  else if (/\b(switch|nsw)\b/i.test(cleaned)) platform = "Switch";
  else if (/\b(pc|windows|win64|win32)\b/i.test(cleaned)) platform = "PC";
  else if (/\b(linux)\b/i.test(cleaned)) platform = "Linux";
  else if (/\b(mac|macos|osx)\b/i.test(cleaned)) platform = "Mac";

  // 5. DRM / Source
  let drm: string | undefined;
  if (/\bgog\b/i.test(cleaned)) drm = "GOG";
  else if (/\bsteam\b/i.test(cleaned)) drm = "Steam";
  else if (/\bepic\b/i.test(cleaned)) drm = "Epic";
  else if (/\bdrm[ -]?free\b/i.test(cleaned)) drm = "DRM-Free";

  // 6. Base Game Title (using existing cleanReleaseName logic)
  const gameTitle = cleanReleaseName(releaseName);

  return {
    gameTitle,
    version,
    languages: languages.length > 0 ? languages : undefined,
    group,
    platform,
    drm,
    isScene: !!group && !["p2p", "gls", "initial", "rarbg", "crack"].includes(group.toLowerCase()),
  };
}

