/**
 * Download Categorization Utility
 *
 * Categorizes game downloads (torrents/NZBs) into main game, updates, DLC, and extras
 * based on common naming patterns in titles. When an AI release-type classification
 * (see shared/typesafe-types.ts) is available and more confident than the regex-based
 * guess, it's used instead.
 */

import type { ReleaseType } from "./typesafe-types.js";

export type DownloadCategory = "main" | "update" | "dlc" | "extra" | "packs";

// Maps the AI's release-type classification onto the categories this app displays.
// "other" has no reliable mapping, so it's left out -- the regex-based guess wins.
const AI_RELEASE_TYPE_TO_CATEGORY: Partial<Record<ReleaseType, DownloadCategory>> = {
  full_game: "main",
  repack: "main",
  dlc: "dlc",
  update: "update",
  demo: "extra",
  soundtrack: "extra",
  crack_only: "extra",
};

export interface CategorizedDownload {
  category: DownloadCategory;
  confidence: number; // 0-1, how confident we are in the categorization
}

// Patterns for different download types
const UPDATE_PATTERNS = [/\bupdate\b/i, /\bpatch\b/i, /\bhotfix\b/i, /\bcrackfix\b/i, /\bfix\b/i];

const PACKS_PATTERNS = [/\bpack\b/i, /\badd-?on\b/i];

const DLC_PATTERNS = [
  /\bDLC\b/i,
  /\bdownloadable content\b/i,
  /\bexpansion\b/i,
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

function categorizeByTitle(title: string): CategorizedDownload {
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

  // Specific DLC/expansion keywords take priority over the more general pack/add-on terms.
  for (const pattern of PACKS_PATTERNS) {
    if (pattern.test(title)) {
      return { category: "packs", confidence: 0.85 };
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
 * Categorizes a download based on its title, and its AI release-type classification
 * when one is available (see server/typesafe.ts) and more confident than the
 * regex-based guess from the title alone.
 */
export function categorizeDownload(
  title: string,
  aiReleaseType?: ReleaseType | null,
  aiReleaseTypeConfidence?: number | null
): CategorizedDownload {
  const byTitle = categorizeByTitle(title);

  const aiCategory = aiReleaseType ? AI_RELEASE_TYPE_TO_CATEGORY[aiReleaseType] : undefined;
  if (
    aiCategory &&
    aiReleaseTypeConfidence != null &&
    aiReleaseTypeConfidence > byTitle.confidence
  ) {
    return { category: aiCategory, confidence: aiReleaseTypeConfidence };
  }

  return byTitle;
}

/**
 * Groups downloads by category
 */
export function groupDownloadsByCategory<
  T extends {
    title: string;
    aiReleaseType?: ReleaseType | null;
    aiReleaseTypeConfidence?: number | null;
  },
>(downloads: T[]): Record<DownloadCategory, T[]> {
  const groups: Record<DownloadCategory, T[]> = {
    main: [],
    update: [],
    dlc: [],
    extra: [],
    packs: [],
  };

  downloads.forEach((download) => {
    const { category } = categorizeDownload(
      download.title,
      download.aiReleaseType,
      download.aiReleaseTypeConfidence
    );
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
    case "packs":
      return "Packs/Addons";
  }
}
