/**
 * Download Categorization Utility
 *
 * Categorizes game downloads (torrents/NZBs) into main game, updates, DLC, and extras
 * based on common naming patterns in titles.
 */

export type DownloadCategory = "main" | "update" | "dlc" | "extra";

export interface CategorizedDownload {
  category: DownloadCategory;
  confidence: number; // 0-1, how confident we are in the categorization
}

// Patterns for different download types
const UPDATE_PATTERNS = [
  /\bupdate\b/i,
  /\bpatch\b/i,
  /\bhotfix\b/i,
  /\bv?\d+\.\d+(\.\d+)?\.?\d*\b/i, // Version numbers like v1.2, 1.2.3, etc.
  /\bcrackfix\b/i,
  /\bfix\b/i,
];

const DLC_PATTERNS = [
  /\bDLC\b/i,
  /\bdownloadable content\b/i,
  /\bexpansion\b/i,
  /\badd-?on\b/i,
  /\bseason pass\b/i,
  /\bdeluxe\b/i,
  /\bgoty\b/i, // Game of the Year editions often include DLC
  /\bcomplete\b/i,
];

const EXTRA_PATTERNS = [
  /\bOST\b/i,
  /\bsoundtrack\b/i,
  /\bartbook\b/i,
  /\bmanual\b/i,
  /\bwallpaper\b/i,
  /\bbonus\b/i,
  /\bextra\b/i,
  /\bdigital content\b/i,
];

/**
 * Categorizes a download based on its title
 */
export function categorizeDownload(title: string): CategorizedDownload {
  const category: DownloadCategory = "main";
  let confidence = 0.5; // Default confidence for main game

  // Check for extras (highest priority - most specific)
  for (const pattern of EXTRA_PATTERNS) {
    if (pattern.test(title)) {
      return { category: "extra", confidence: 0.9 };
    }
  }

  // Check for DLC
  for (const pattern of DLC_PATTERNS) {
    if (pattern.test(title)) {
      return { category: "dlc", confidence: 0.85 };
    }
  }

  // Check for updates
  for (const pattern of UPDATE_PATTERNS) {
    if (pattern.test(title)) {
      return { category: "update", confidence: 0.8 };
    }
  }

  // If it has "Repack" or base game indicators, it's likely the main game
  if (/\brepack\b/i.test(title) || /\bfull\b/i.test(title)) {
    confidence = 0.9;
  }

  return { category, confidence };
}

/**
 * Groups downloads by category
 */
export function groupDownloadsByCategory<T extends { title: string }>(
  downloads: T[]
): Record<DownloadCategory, T[]> {
  const groups: Record<DownloadCategory, T[]> = {
    main: [],
    update: [],
    dlc: [],
    extra: [],
  };

  downloads.forEach((download) => {
    const { category } = categorizeDownload(download.title);
    groups[category].push(download);
  });

  return groups;
}

/**
 * Gets a human-readable label for a category
 */
export function getCategoryLabel(category: DownloadCategory): string {
  switch (category) {
    case "main":
      return "Main Game";
    case "update":
      return "Updates & Patches";
    case "dlc":
      return "DLC & Expansions";
    case "extra":
      return "Extras";
  }
}

/**
 * Gets a description for a category
 */
export function getCategoryDescription(category: DownloadCategory): string {
  switch (category) {
    case "main":
      return "Full game downloads";
    case "update":
      return "Game updates, patches, hotfixes, and crackfixes";
    case "dlc":
      return "Downloadable content, expansions, and season passes";
    case "extra":
      return "Soundtracks, artbooks, and other bonus content";
  }
}
