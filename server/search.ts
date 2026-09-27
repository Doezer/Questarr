import { storage } from "./storage.js";
import { torznabClient } from "./torznab.js";
import { newznabClient } from "./newznab.js";
import { searchLogger } from "./logger.js";
import { parseReleaseMetadata } from "../shared/title-utils.js";
import { typesafeClient, type ReleaseType } from "./typesafe.js";

// Cap how many top results get AI-enriched per search so an optional, user-supplied
// TypeSafe key never turns a single search into dozens of outbound API calls.
const AI_ENRICHMENT_MAX_ITEMS = 15;

export interface CustomFormatRule {
  name: string;
  field: "title" | "group" | "uploader" | "category" | "protocol";
  pattern: string; // regex pattern string
  score: number;
}

export interface ReleaseProfile {
  minScore?: number;
  requiredTerms?: string[];
  ignoredTerms?: string[];
  minSeeders?: number;
  maxSizeBytes?: number;
  preferredProtocol?: "torrent" | "usenet";
  protocolScoreBonus?: number;
  customFormats?: CustomFormatRule[];
}

export interface SearchItem {
  title: string;
  link: string;
  pubDate: string;
  size?: number;
  indexerId: string;
  indexerName: string;
  indexerUrl?: string;
  category: string[];
  guid: string;
  downloadType: "torrent" | "usenet";
  // Protocol-specific fields
  seeders?: number;
  leechers?: number;
  downloadVolumeFactor?: number;
  uploadVolumeFactor?: number;
  grabs?: number;
  age?: number;
  files?: number;
  poster?: string;
  group?: string;
  comments?: string;
  // Scoring & classification
  score?: number;
  scoreReasons?: string[];
  isGameCategory?: boolean;
  titleMatchType?: "exact" | "contains" | "ambiguous_sequel" | "mismatch";
  // Optional AI-assisted enrichment via TypeSafe's Jev model (BYOK, best-effort).
  // Absent entirely when TypeSafe isn't configured or the call failed/timed out.
  aiReleaseType?: ReleaseType;
  aiReleaseTypeConfidence?: number;
  aiLegitimacyScore?: number;
}

export interface AggregatedSearchOptions {
  query: string;
  category?: string[] | undefined;
  limit?: number;
  offset?: number;
  profile?: ReleaseProfile;
}

export interface AggregatedSearchResults {
  items: SearchItem[];
  total: number;
  offset: number;
  errors: string[];
}

/**
 * Normalizes title strings for comparison by lowering case and stripping non-alphanumeric chars.
 */
function normalizeForComparison(str: string): string {
  return str
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Distinguishes exact match, contains match, and rejects ambiguous sequels/spin-offs.
 * E.g., searching for "Dishonored" should reject "Dishonored 2",
 * but searching for "Dishonored 2" can accept "Dishonored 2: Death of the Outsider".
 */
export function classifyTitleMatch(
  query: string,
  releaseTitle: string
): "exact" | "contains" | "ambiguous_sequel" | "mismatch" {
  if (!query) return "exact";

  const normQuery = normalizeForComparison(query);
  const metadata = parseReleaseMetadata(releaseTitle);
  const normCleanTitle = normalizeForComparison(metadata.cleanedTitle || releaseTitle);

  if (normCleanTitle === normQuery) {
    return "exact";
  }

  // Check if query is contained as a whole word prefix or substring
  const regexQueryWord = new RegExp(`\\b${normQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  if (!regexQueryWord.test(normCleanTitle)) {
    return "mismatch";
  }

  // Check for ambiguous sequel/numbering right after the query:
  // e.g. Query "Dishonored", cleanTitle "Dishonored 2" or "Dishonored II" or "Dishonored 3"
  const sequelPattern = new RegExp(
    `\\b${normQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+(?:(?:\\d+|[ivx]+)\\b)`,
    "i"
  );

  const queryHasSequel = /\b(?:\d+|[ivx]+)$/i.test(normQuery);

  if (!queryHasSequel && sequelPattern.test(normCleanTitle)) {
    return "ambiguous_sequel";
  }

  return "contains";
}

// Common Torznab/Newznab PC/Console game category IDs
const GAME_CATEGORY_IDS = new Set([
  "1000", // Games
  "1010", // Games/NDS
  "1020", // Games/PSP
  "1030", // Games/Wii
  "1040", // Games/Xbox
  "1050", // Games/Xbox 360
  "1060", // Games/Wiiware/VC
  "1070", // Games/XBLA
  "1080", // Games/PS3
  "1090", // Games/Other
  "4000", // PC
  "4010", // PC/0day
  "4020", // PC/ISO
  "4030", // PC/Mac
  "4040", // PC/Phone-Other
  "4050", // PC/Games
]);

/**
 * Checks whether category indicates a game release.
 */
export function isGameCategory(categories: string[]): boolean {
  if (!categories || categories.length === 0) return true; // optimistic default
  return categories.some((cat) => {
    const trimmed = cat.trim().toLowerCase();
    if (GAME_CATEGORY_IDS.has(trimmed)) return true;
    if (trimmed.includes("game") || trimmed.includes("jeux") || trimmed.includes("spiel")) return true;
    return false;
  });
}

/**
 * Built-in scoring rules and release profile evaluation.
 */
export function scoreSearchItem(
  item: SearchItem,
  query: string,
  profile?: ReleaseProfile
): { score: number; reasons: string[]; isEligible: boolean } {
  let score = 0;
  const reasons: string[] = [];

  const titleMatch = classifyTitleMatch(query, item.title);
  item.titleMatchType = titleMatch;

  if (titleMatch === "exact") {
    score += 100;
    reasons.push("Exact title match (+100)");
  } else if (titleMatch === "contains") {
    score += 50;
    reasons.push("Contains title match (+50)");
  } else if (titleMatch === "ambiguous_sequel") {
    score -= 150;
    reasons.push("Ambiguous sequel/spin-off match (-150)");
  } else {
    score -= 200;
    reasons.push("Title mismatch (-200)");
  }

  const isGame = isGameCategory(item.category);
  item.isGameCategory = isGame;
  if (isGame) {
    score += 20;
    reasons.push("Valid game category (+20)");
  } else {
    score -= 50;
    reasons.push("Non-game or unrecognized category (-50)");
  }

  // Built-in title metadata heuristics
  const meta = parseReleaseMetadata(item.title);
  const lowerTitle = item.title.toLowerCase();

  // Trusted/recognized scene release groups
  const trustedGroups = [
    "codex", "skidrow", "cpiy", "flt", "fairlight", "reloaded", "rune",
    "razor1911", "plaza", "empress", "tenoke", "dino"
  ];
  if (meta.group && trustedGroups.includes(meta.group.toLowerCase())) {
    score += 30;
    reasons.push(`Scene release group: ${meta.group} (+30)`);
  }

  // Penalize repacks / DLC-only bundles if standard release sought
  if (/\b(repack|fitgirl|dodi)\b/i.test(item.title)) {
    score -= 15;
    reasons.push("Repack release (-15)");
  }
  if (/\b(dlc|addon|update|patch)\b/i.test(item.title) && !/\b(dlc|addon|update|patch)\b/i.test(query)) {
    score -= 40;
    reasons.push("DLC/Update only release (-40)");
  }

  // Seeder bonus / penalty for torrents
  if (item.downloadType === "torrent") {
    if (typeof item.seeders === "number") {
      if (item.seeders >= 20) {
        score += 25;
        reasons.push(`Healthy seeders: ${item.seeders} (+25)`);
      } else if (item.seeders >= 5) {
        score += 10;
        reasons.push(`Moderate seeders: ${item.seeders} (+10)`);
      } else if (item.seeders === 0) {
        score -= 50;
        reasons.push("Dead torrent (0 seeders) (-50)");
      }
    }
  }

  // AI-assisted scoring if available
  if (item.aiLegitimacyScore !== undefined) {
    if (item.aiLegitimacyScore >= 80) {
      score += 20;
      reasons.push(`AI legitimacy score high: ${item.aiLegitimacyScore} (+20)`);
    } else if (item.aiLegitimacyScore < 50) {
      score -= 30;
      reasons.push(`AI legitimacy score low: ${item.aiLegitimacyScore} (-30)`);
    }
  }

  // Profile preferences & constraints
  if (profile) {
    if (profile.preferredProtocol && item.downloadType === profile.preferredProtocol) {
      const bonus = profile.protocolScoreBonus ?? 20;
      score += bonus;
      reasons.push(`Preferred protocol: ${item.downloadType} (+${bonus})`);
    }

    // Custom format rules
    if (profile.customFormats && profile.customFormats.length > 0) {
      for (const rule of profile.customFormats) {
        try {
          const re = new RegExp(rule.pattern, "i");
          let matchValue = "";
          if (rule.field === "title") matchValue = item.title;
          else if (rule.field === "group") matchValue = item.group || meta.group || "";
          else if (rule.field === "category") matchValue = item.category.join(" ");
          else if (rule.field === "protocol") matchValue = item.downloadType;

          if (re.test(matchValue)) {
            score += rule.score;
            reasons.push(`Custom format '${rule.name}': ${rule.score >= 0 ? `+${rule.score}` : rule.score}`);
          }
        } catch {
          // Ignore invalid regex patterns
        }
      }
    }

    // Check hard filtering criteria
    if (profile.minSeeders !== undefined && item.downloadType === "torrent") {
      if ((item.seeders ?? 0) < profile.minSeeders) {
        return { score, reasons, isEligible: false };
      }
    }

    if (profile.maxSizeBytes !== undefined && item.size !== undefined) {
      if (item.size > profile.maxSizeBytes) {
        return { score, reasons, isEligible: false };
      }
    }

    if (profile.requiredTerms && profile.requiredTerms.length > 0) {
      const missing = profile.requiredTerms.some((term) => !lowerTitle.includes(term.toLowerCase()));
      if (missing) {
        return { score, reasons, isEligible: false };
      }
    }

    if (profile.ignoredTerms && profile.ignoredTerms.length > 0) {
      const containsIgnored = profile.ignoredTerms.some((term) => lowerTitle.includes(term.toLowerCase()));
      if (containsIgnored) {
        return { score, reasons, isEligible: false };
      }
    }

    if (profile.minScore !== undefined && score < profile.minScore) {
      return { score, reasons, isEligible: false };
    }
  }

  // Reject ambiguous sequels by default if score drops heavily into negatives
  if (titleMatch === "ambiguous_sequel" && score < 0) {
    return { score, reasons, isEligible: false };
  }

  return { score, reasons, isEligible: true };
}

export async function searchAllIndexers(
  options: AggregatedSearchOptions
): Promise<AggregatedSearchResults> {
  const enabledIndexers = await storage.getEnabledIndexers();

  if (enabledIndexers.length === 0) {
    return { items: [], total: 0, offset: options.offset || 0, errors: ["No indexers configured"] };
  }

  const torznabIndexers = enabledIndexers.filter(
    (i) => i.protocol !== "newznab" && i.protocol !== "g4u"
  );
  const newznabIndexers = enabledIndexers.filter((i) => i.protocol === "newznab");
  // g4u.to uses the Newznab protocol but requires Scene-style dot-separated queries
  const g4uIndexers = enabledIndexers.filter((i) => i.protocol === "g4u");

  const searchParams = {
    query: options.query,
    category: options.category,
    limit: options.limit || 50,
    offset: options.offset || 0,
  };

  // g4u.to uses Scene-style dot-separated names (e.g. "Game.Name.v1.0")
  const g4uSearchParams = {
    ...searchParams,
    query: options.query ? options.query.replace(/ /g, ".") : options.query,
  };

  const promises = [];

  if (torznabIndexers.length > 0) {
    promises.push(
      torznabClient
        .searchMultipleIndexers(torznabIndexers, searchParams)
        .then((res) => ({ type: "torznab" as const, ...res }))
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          searchLogger.error({ error: message }, "torznab client failed");
          return {
            type: "torznab" as const,
            results: { items: [], total: 0, offset: 0 },
            errors: [message],
          };
        })
    );
  }

  const makeNewznabPromise = (
    indexers: typeof newznabIndexers,
    params: typeof searchParams,
    label: string
  ) =>
    newznabClient
      .searchMultipleIndexers(indexers, params)
      .then((res) => ({ type: "newznab" as const, ...res }))
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        searchLogger.error({ error: message }, `${label} client failed`);
        return {
          type: "newznab" as const,
          results: { items: [], total: 0, offset: 0 },
          errors: [{ indexer: label, error: message }],
        };
      });

  if (newznabIndexers.length > 0) {
    promises.push(makeNewznabPromise(newznabIndexers, searchParams, "newznab"));
  }

  if (g4uIndexers.length > 0) {
    promises.push(makeNewznabPromise(g4uIndexers, g4uSearchParams, "g4u"));
  }

  const results = await Promise.all(promises);

  const combinedItems: SearchItem[] = [];
  const combinedErrors: string[] = [];
  let totalCount = 0;

  for (const result of results) {
    if (result.type === "torznab") {
      const items = result.results.items.map((item) => {
        // Construct comments URL if not provided by the indexer.
        // This is a best-effort fallback based on common torrent indexer URL patterns.
        // Indexers should ideally provide the comments field directly in their Torznab responses
        // for more reliable links to the torrent page. The '/details/{guid}' pattern is a heuristic
        // that works for many popular indexers but may not work for all.
        let comments = item.comments;
        if (!comments && item.indexerUrl && item.guid) {
          try {
            const baseUrl = new URL(item.indexerUrl);
            const guid = item.guid.split("/").pop() || item.guid;
            comments = `${baseUrl.protocol}//${baseUrl.host}/details/${guid}`;
          } catch (error) {
            // If URL construction fails, log the error for debugging but continue
            searchLogger.warn(
              { error, indexerUrl: item.indexerUrl, guid: item.guid },
              "Failed to construct comments URL from indexer URL and GUID"
            );
          }
        }

        return {
          title: item.title,
          link: item.link,
          pubDate: item.pubDate,
          size: item.size,
          indexerId: item.indexerId || "unknown",
          indexerName: item.indexerName || "unknown",
          indexerUrl: item.indexerUrl,
          category: item.category ? item.category.split(",") : [],
          guid: item.guid || item.link,
          downloadType: "torrent" as const,
          seeders: item.seeders,
          leechers: item.leechers,
          downloadVolumeFactor: item.downloadVolumeFactor,
          uploadVolumeFactor: item.uploadVolumeFactor,
          group: parseReleaseMetadata(item.title).group,
          comments,
        } as SearchItem;
      });
      combinedItems.push(...items);
      totalCount += result.results.total || 0;
      if (result.errors) combinedErrors.push(...result.errors);
    } else if (result.type === "newznab") {
      const items = result.results.items.map(
        (item) =>
          ({
            title: item.title,
            link: item.link,
            pubDate: item.publishDate,
            size: item.size,
            indexerId: item.indexerId,
            indexerName: item.indexerName,
            category: item.category,
            guid: item.guid,
            downloadType: "usenet" as const,
            grabs: item.grabs,
            age: item.age,
            files: item.files,
            poster: item.poster,
            group: item.group,
          }) as SearchItem
      );
      combinedItems.push(...items);
      totalCount += result.results.total || 0;
      if (result.errors) {
        combinedErrors.push(...result.errors.map((e) => `${e.indexer}: ${e.error}`));
      }
    }
  }

  // Score and filter items
  const scoredItems: SearchItem[] = [];
  for (const item of combinedItems) {
    const evaluation = scoreSearchItem(item, options.query, options.profile);
    item.score = evaluation.score;
    item.scoreReasons = evaluation.reasons;
    if (evaluation.isEligible) {
      scoredItems.push(item);
    }
  }

  // Sort by score (descending), then by pubDate (newest first)
  scoredItems.sort((a, b) => {
    if ((b.score ?? 0) !== (a.score ?? 0)) {
      return (b.score ?? 0) - (a.score ?? 0);
    }
    const dateA = new Date(a.pubDate).getTime();
    const dateB = new Date(b.pubDate).getTime();
    return dateB - dateA;
  });

  return {
    items: scoredItems,
    total: totalCount,
    offset: options.offset || 0,
    errors: combinedErrors,
  };
}

/**
 * Filters search items by removing any whose title appears in the blacklist set.
 */
export function filterBlacklistedReleases(
  items: SearchItem[],
  blacklisted: Set<string>
): SearchItem[] {
  return blacklisted.size > 0 ? items.filter((item) => !blacklisted.has(item.title)) : items;
}

/**
 * Best-effort AI enrichment of search results via TypeSafe's Jev model: classifies each
 * release's type and flags whether its file size looks plausible. No-op when the user
 * hasn't configured a TypeSafe key/URL. Only the top `AI_ENRICHMENT_MAX_ITEMS` items are
 * analyzed to bound the number of outbound API calls per search; items beyond that (and
 * any whose call fails) are returned unchanged.
 */
export async function enrichWithAiAnalysis(items: SearchItem[]): Promise<SearchItem[]> {
  if (items.length === 0) {
    return items;
  }

  // Defensive: a broken TypeSafe config (unreachable storage, decrypt failure) must never
  // turn an otherwise-successful search into a 500 -- fall back to the unmodified results.
  try {
    if (!(await typesafeClient.isConfigured())) {
      return items;
    }

    const toAnalyze = items.slice(0, AI_ENRICHMENT_MAX_ITEMS);
    const analyses = await Promise.all(
      toAnalyze.map((item) =>
        typesafeClient
          .analyzeRelease({
            releaseName: item.title,
            sizeBytes: item.size,
            platform: parseReleaseMetadata(item.title).platform,
          })
          .catch(() => null)
      )
    );

    return items.map((item, index) => {
      const analysis = index < analyses.length ? analyses[index] : null;
      if (!analysis) return item;
      return {
        ...item,
        ...(analysis.releaseType ? { aiReleaseType: analysis.releaseType } : {}),
        ...(analysis.releaseTypeConfidence !== null
          ? { aiReleaseTypeConfidence: analysis.releaseTypeConfidence }
          : {}),
        ...(analysis.legitimacyScore !== null
          ? { aiLegitimacyScore: analysis.legitimacyScore }
          : {}),
      };
    });
  } catch (error) {
    searchLogger.warn({ error }, "AI enrichment failed, returning unmodified search results");
    return items;
  }
}