/**
 * Release scoring
 *
 * Pure, I/O-free evaluation of an indexer result against the wanted game: how well its title
 * matches, built-in quality rules, the user's release profile and custom formats. It produces
 * a score, the lines that make up that score, and typed rejections. Importable by the server
 * (auto-search) and the client (search dialog, "test a release name" preview).
 *
 * Design adapted from the release-profile work in the Jessomadic/Questarr fork (GPL-3.0) and
 * from Radarr/Sonarr custom formats: built-in rules are code constants whose weight a profile
 * can override, so default weights can change without a data migration.
 */

import { categorizeDownload, type DownloadCategory } from "./download-categorizer.js";
import {
  isSequelOf,
  matchesPlatformFilter,
  normalizeTitle,
  parseReleaseMetadata,
  TITLE_STOP_WORDS,
  withoutStopWords,
  type ReleaseMetadata,
} from "./title-utils.js";
import type { ReleaseType } from "./typesafe-types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * How a release title relates to the wanted game:
 * - exact: the game title plus release metadata only ("Dishonored.Definitive.Edition-GOG")
 * - contains: the game title plus other words, for a title that is already numbered or has a
 *   prefix ("The.Witcher.3.Wild.Hunt" for "The Witcher 3")
 * - spinoff: the game title followed by other words ("DOOM.Eternal" for "DOOM")
 * - sequel: the game title followed by a sequel number ("Dishonored.2" for "Dishonored")
 * - mismatch: the game title is not in the release name
 */
export type TitleMatch = "exact" | "contains" | "spinoff" | "sequel" | "mismatch";

/** Indexer category family: Newznab 1xxx/4000/4050 are games, 2xxx/3xxx/5xxx-7xxx are not. */
export type IndexerCategoryClass = "game" | "non_game" | "unknown";

export type RejectionCode =
  | "title_mismatch"
  | "title_sequel"
  | "non_game_category"
  | "non_game_media"
  | "wrong_platform"
  | "required_term_missing"
  | "ignored_term"
  | "min_seeders"
  | "max_size"
  | "below_min_score"
  | "custom_format_reject";

export interface Rejection {
  code: RejectionCode;
  detail?: string;
}

export interface ScoreLine {
  /** A built-in rule id, or `cf:<custom format id>`. */
  ruleId: string;
  label: string;
  points: number;
}

export type FormatField = "title" | "group" | "uploader" | "category" | "protocol" | "indexer";
export type FormatMatchMode = "contains" | "exact" | "regex";

/** One condition of a custom format. `negate` inverts it ("group is not X"). */
export interface FormatSpec {
  field: FormatField;
  mode: FormatMatchMode;
  value: string;
  negate?: boolean;
}

/**
 * A user-defined rule. It matches when every spec matches, then adds `score`; with
 * `hardReject` a match also rejects the release.
 */
export interface CustomFormat {
  id: string;
  name: string;
  specs: FormatSpec[];
  score: number;
  hardReject: boolean;
  enabled: boolean;
}

export type ProtocolPreference = "torrent" | "usenet" | "either";

export interface BuiltInOverride {
  points?: number;
  enabled?: boolean;
}

export interface ReleaseProfile {
  /** Releases scoring below this are rejected. */
  minScore: number;
  protocolPreference: ProtocolPreference;
  /** Every term must appear in the release name (case-insensitive). */
  requiredTerms: string[];
  /** No term may appear in the release name (case-insensitive). */
  ignoredTerms: string[];
  /** Torrents with fewer seeders are rejected. 0 disables the check. */
  minSeeders: number;
  maxSizeBytes: number | null;
  builtInOverrides: Partial<Record<BuiltInRuleId, BuiltInOverride>>;
}

export const DEFAULT_RELEASE_PROFILE: ReleaseProfile = {
  minScore: 0,
  protocolPreference: "either",
  requiredTerms: [],
  ignoredTerms: [],
  minSeeders: 0,
  maxSizeBytes: null,
  builtInOverrides: {},
};

/** What the evaluation knows about the wanted game. */
export interface ReleaseContext {
  gameTitle: string;
  /** Other known names of the game (IGDB alternative names); the best match wins. */
  alternativeTitles?: string[];
  /** Preferred platform label (see resolveGamePlatformPreference), or null for any. */
  platform?: string | null;
  /** Typical size of the game, when known; releases far from it lose points. */
  expectedSizeBytes?: number;
}

/** The subset of an indexer result the evaluation reads (SearchItem satisfies it). */
export interface ReleaseInput {
  title: string;
  downloadType: "torrent" | "usenet";
  size?: number | undefined;
  seeders?: number | undefined;
  category?: string[] | undefined;
  indexerName?: string | undefined;
  poster?: string | undefined;
  aiReleaseType?: ReleaseType | undefined;
  aiReleaseTypeConfidence?: number | undefined;
}

export interface ReleaseEvaluation {
  accepted: boolean;
  score: number;
  lines: ScoreLine[];
  rejections: Rejection[];
  titleMatch: TitleMatch;
  indexerCategory: IndexerCategoryClass;
  category: DownloadCategory;
  /** Ids of the custom formats that matched. */
  matchedFormats: string[];
}

// ---------------------------------------------------------------------------
// Title classification
// ---------------------------------------------------------------------------

/**
 * Words that describe a release rather than name a game: editions, sources, platforms,
 * languages, scene and repack tags. Leftover words outside this list make a title a
 * spinoff or a longer title rather than the game itself.
 */
const METADATA_TOKENS = new Set([
  // editions
  "edition",
  "goty",
  "game",
  "year",
  "deluxe",
  "complete",
  "gold",
  "ultimate",
  "collectors",
  "collector",
  "definitive",
  "remastered",
  "remaster",
  "enhanced",
  "anniversary",
  "directors",
  "director",
  "cut",
  "special",
  "standard",
  "premium",
  "digital",
  "legendary",
  "royal",
  "platinum",
  "limited",
  "classic",
  "hd",
  "redux",
  "final",
  "extended",
  // content
  "dlc",
  "dlcs",
  "incl",
  "including",
  "plus",
  "bonus",
  "ost",
  "soundtrack",
  "artbook",
  "content",
  "season",
  "pass",
  "expansion",
  "expansions",
  "addon",
  "addons",
  "update",
  "updates",
  "patch",
  "hotfix",
  "fix",
  "crackfix",
  "crack",
  "cracked",
  "unlocker",
  "build",
  // sources and stores
  "gog",
  "steam",
  "steamrip",
  "epic",
  "uplay",
  "origin",
  "drm",
  "free",
  "rip",
  "iso",
  // platforms
  "pc",
  "win",
  "windows",
  "linux",
  "mac",
  "macos",
  "osx",
  "switch",
  "nsw",
  "nsp",
  "xci",
  "ps3",
  "ps4",
  "ps5",
  "xbox",
  "x360",
  "xbox360",
  "wii",
  "wiiu",
  "3ds",
  "nds",
  "vita",
  "psvita",
  "psp",
  // languages
  "multi",
  "multilingual",
  "english",
  "french",
  "german",
  "spanish",
  "italian",
  "russian",
  "japanese",
  "polish",
  "portuguese",
  "chinese",
  "korean",
  "nordic",
  "eng",
  "fr",
  "de",
  // scene and repack tags
  "repack",
  "rerepack",
  "proper",
  "internal",
  "readnfo",
  "nfo",
  "setup",
  "portable",
  "preinstalled",
  "selective",
  "download",
  "lossless",
  "compressed",
  "repacks",
  "fitgirl",
  "dodi",
  "elamigos",
  "kaos",
  "xatab",
  "tinyrepacks",
  "masquerade",
  "empress",
  "codex",
  "rune",
  "flt",
  "tenoke",
  "skidrow",
  "reloaded",
  "plaza",
  "razor1911",
  "cpy",
  "hoodlum",
  "darksiders",
  "p2p",
  "gls",
  "scene",
]);

const METADATA_TOKEN_PATTERNS = [
  /^\d+$/, // versions, years, build and update numbers
  /^v\d+$/, // v1, v2 (normalizeTitle splits v1.0 into "v1" "0")
  /^b\d+$/, // build numbers
  /^multi\d+$/,
  /^x(64|86)$/,
  /^win(32|64)$/,
];

function isMetadataToken(token: string): boolean {
  return (
    METADATA_TOKENS.has(token) ||
    TITLE_STOP_WORDS.has(token) ||
    METADATA_TOKEN_PATTERNS.some((pattern) => pattern.test(token))
  );
}

/**
 * normalizeTitle, plus two fixes for how release names spell titles: apostrophes are dropped
 * ("Tom Clancy's" -> "tom clancys") and runs of single letters are joined
 * ("S.T.A.L.K.E.R." -> "stalker").
 */
function normalizeForMatch(title: string): string {
  const words = normalizeTitle(title.replaceAll(/['’`]/g, "")).split(" ");
  const joined: string[] = [];
  let letters = "";
  for (const word of words) {
    if (/^[a-z]$/.test(word)) {
      letters += word;
      continue;
    }
    if (letters) joined.push(letters);
    letters = "";
    joined.push(word);
  }
  if (letters) joined.push(letters);
  return joined.filter(Boolean).join(" ");
}

function findSequence(haystack: string[], needle: string[]): number {
  if (needle.length === 0) return -1;
  for (let i = 0; i + needle.length <= haystack.length; i++) {
    if (needle.every((word, j) => haystack[i + j] === word)) return i;
  }
  return -1;
}

const TITLE_MATCH_RANK: Record<TitleMatch, number> = {
  exact: 4,
  contains: 3,
  spinoff: 2,
  sequel: 1,
  mismatch: 0,
};

function classifyAgainstTitle(
  releaseName: string,
  gameTitle: string,
  group: string | undefined
): TitleMatch {
  const release = normalizeForMatch(releaseName);
  const game = normalizeForMatch(gameTitle);
  if (!release || !game) return "mismatch";
  if (release === game) return "exact";

  if (isSequelOf(release, game) || isSequelOf(withoutStopWords(release), withoutStopWords(game))) {
    return "sequel";
  }

  let releaseWords = release.split(" ");
  let gameWords = game.split(" ");
  let start = findSequence(releaseWords, gameWords);
  if (start === -1) {
    // Indexers often drop "The", or write "And" where the title has "&"
    releaseWords = withoutStopWords(release).split(" ");
    gameWords = withoutStopWords(game).split(" ");
    start = findSequence(releaseWords, gameWords);
  }
  if (start === -1) return "mismatch";

  const groupWord = group ? normalizeForMatch(group) : undefined;
  const isExtraWord = (word: string) => word !== groupWord && !isMetadataToken(word);
  const before = releaseWords.slice(0, start).filter(isExtraWord);
  const after = releaseWords.slice(start + gameWords.length).filter(isExtraWord);

  if (before.length === 0 && after.length === 0) return "exact";
  // A title that already carries a number is usually followed by its official subtitle
  // ("The Witcher 3" -> "Wild Hunt"); an unnumbered one by another game ("DOOM Eternal").
  if (after.length > 0 && !gameWords.some((word) => /\d/.test(word))) return "spinoff";
  return "contains";
}

/**
 * Classifies how a release name relates to the wanted game, trying the main title and any
 * alternative titles and keeping the best result.
 */
export function classifyTitleMatch(
  releaseName: string,
  gameTitle: string,
  alternativeTitles: readonly string[] = []
): TitleMatch {
  const { group } = parseReleaseMetadata(releaseName);
  let best: TitleMatch = "mismatch";
  for (const title of [gameTitle, ...alternativeTitles]) {
    if (!title) continue;
    const match = classifyAgainstTitle(releaseName, title, group);
    if (TITLE_MATCH_RANK[match] > TITLE_MATCH_RANK[best]) best = match;
    if (best === "exact") break;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Indexer categories
// ---------------------------------------------------------------------------

/**
 * Classifies Newznab/Torznab category ids. Any game category wins; the release is only
 * "non_game" when every category is a known non-game family. Unknown, custom (100000+) or
 * missing categories never count against a release.
 */
export function classifyIndexerCategories(
  categories: readonly string[] | undefined
): IndexerCategoryClass {
  if (!categories || categories.length === 0) return "unknown";
  let allNonGame = true;
  for (const raw of categories) {
    const id = Number.parseInt(raw, 10);
    if (!Number.isFinite(id)) {
      allNonGame = false;
      continue;
    }
    if ((id >= 1000 && id < 2000) || id === 4000 || id === 4050) return "game";
    const family = Math.floor(id / 1000);
    const isNonGame = id < 100000 && [2, 3, 5, 6, 7].includes(family);
    if (!isNonGame) allNonGame = false;
  }
  return allNonGame ? "non_game" : "unknown";
}

// ---------------------------------------------------------------------------
// Built-in rules
// ---------------------------------------------------------------------------

/** What the rules read about one release, computed once. */
interface ReleaseFacts {
  input: ReleaseInput;
  metadata: ReleaseMetadata;
  titleMatch: TitleMatch;
  indexerCategory: IndexerCategoryClass;
}

const NON_GAME_MEDIA_PATTERN =
  /\b(480p|720p|1080p|2160p|x264|x265|h264|h265|hevc|bluray|bdrip|brrip|webrip|web-dl|hdtv|dvdrip|mkv|avi|mp4|flac|mp3|epub|mobi|pdf|cbr|cbz|s\d{2}e\d{2})\b/i;
const REPACK_PATTERN = /\b(repack|fitgirl|dodi|elamigos|kaos|xatab|tinyrepacks)\b/i;
// Suffixes that parseReleaseMetadata reads as a group but that name a store or a repacker
const NON_SCENE_GROUPS = new Set(["gog", "steam", "epic", "fitgirl", "dodi", "elamigos", "kaos"]);
const SIZE_MISMATCH_RATIO = 0.5;

export const BUILT_IN_RULE_IDS = [
  "title_exact",
  "title_contains",
  "title_spinoff",
  "title_sequel",
  "title_mismatch",
  "category_game",
  "category_non_game",
  "non_game_media",
  "platform_match",
  "platform_mismatch",
  "scene_release",
  "repack",
  "storefront_source",
  "protocol_preference",
  "size_mismatch",
] as const;

export type BuiltInRuleId = (typeof BUILT_IN_RULE_IDS)[number];

export interface BuiltInRule {
  id: BuiltInRuleId;
  label: string;
  /** Default points; a profile can override them. */
  points: number;
  /** When set, a matching release is also rejected with this code. */
  rejection?: RejectionCode;
  /** Locked rules cannot be disabled by a profile (their points can still change). */
  locked?: boolean;
  applies(facts: ReleaseFacts, ctx: ReleaseContext, profile: ReleaseProfile): boolean;
}

export const BUILT_IN_RULES: readonly BuiltInRule[] = [
  {
    id: "title_exact",
    label: "Title matches the game",
    points: 100,
    applies: (f) => f.titleMatch === "exact",
  },
  {
    id: "title_contains",
    label: "Title contains the game",
    points: 70,
    applies: (f) => f.titleMatch === "contains",
  },
  {
    id: "title_spinoff",
    label: "Title continues past the game name (possible spinoff)",
    points: -60,
    applies: (f) => f.titleMatch === "spinoff",
  },
  {
    id: "title_sequel",
    label: "Title is a sequel of the game",
    points: -1000,
    rejection: "title_sequel",
    locked: true,
    applies: (f) => f.titleMatch === "sequel",
  },
  {
    id: "title_mismatch",
    label: "Title does not match the game",
    points: -1000,
    rejection: "title_mismatch",
    locked: true,
    applies: (f) => f.titleMatch === "mismatch",
  },
  {
    id: "category_game",
    label: "Indexer category is games",
    points: 35,
    applies: (f) => f.indexerCategory === "game",
  },
  {
    id: "category_non_game",
    label: "Indexer category is not games",
    points: -60,
    rejection: "non_game_category",
    applies: (f) => f.indexerCategory === "non_game",
  },
  {
    id: "non_game_media",
    label: "Looks like video, music or a book",
    points: -120,
    rejection: "non_game_media",
    applies: (f) => NON_GAME_MEDIA_PATTERN.test(f.input.title),
  },
  {
    id: "platform_match",
    label: "Platform marker matches",
    points: 25,
    applies: (f, ctx) =>
      !!ctx.platform &&
      !!f.metadata.platform &&
      matchesPlatformFilter(f.metadata.platform, ctx.platform),
  },
  {
    id: "platform_mismatch",
    label: "Wrong platform",
    points: -80,
    rejection: "wrong_platform",
    applies: (f, ctx) =>
      !!ctx.platform && !matchesPlatformFilter(f.metadata.platform, ctx.platform),
  },
  {
    id: "scene_release",
    label: "Scene release",
    points: 20,
    applies: (f) =>
      f.metadata.isScene && !NON_SCENE_GROUPS.has(f.metadata.group?.toLowerCase() ?? ""),
  },
  {
    id: "repack",
    label: "Repack",
    points: 8,
    applies: (f) => REPACK_PATTERN.test(f.input.title),
  },
  {
    id: "storefront_source",
    label: "Storefront or DRM-free source",
    points: 15,
    applies: (f) => !!f.metadata.drm,
  },
  {
    id: "protocol_preference",
    label: "Not the preferred protocol",
    points: -35,
    applies: (f, _ctx, profile) =>
      profile.protocolPreference !== "either" &&
      f.input.downloadType !== profile.protocolPreference,
  },
  {
    id: "size_mismatch",
    label: "Size far from the expected size",
    points: -50,
    applies: (f, ctx) => {
      const expected = ctx.expectedSizeBytes;
      const size = f.input.size;
      if (!expected || !size) return false;
      return Math.abs(size - expected) / expected > SIZE_MISMATCH_RATIO;
    },
  },
];

// ---------------------------------------------------------------------------
// Custom formats
// ---------------------------------------------------------------------------

/** User regexes are capped to keep catastrophic backtracking out of reach. */
export const MAX_FORMAT_REGEX_LENGTH = 200;

/** Returns why a spec is invalid, or null when it can be used. */
export function validateFormatSpec(spec: FormatSpec): string | null {
  if (!spec.value.trim()) return "Value is empty";
  if (spec.mode !== "regex") return null;
  if (spec.value.length > MAX_FORMAT_REGEX_LENGTH) {
    return `Regex is longer than ${MAX_FORMAT_REGEX_LENGTH} characters`;
  }
  try {
    new RegExp(spec.value, "i");
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "Invalid regex";
  }
}

interface CompiledSpec {
  field: FormatField;
  negate: boolean;
  test: (value: string) => boolean;
}

export interface CompiledCustomFormat {
  format: CustomFormat;
  specs: CompiledSpec[];
}

export interface CompiledCustomFormats {
  formats: CompiledCustomFormat[];
  /** Formats left out because a spec is invalid. */
  errors: { formatId: string; message: string }[];
}

function compileSpec(spec: FormatSpec): CompiledSpec {
  const needle = spec.value.trim().toLowerCase();
  let test: (value: string) => boolean;
  if (spec.mode === "regex") {
    const regex = new RegExp(spec.value, "i");
    test = (value) => regex.test(value);
  } else if (spec.mode === "exact") {
    test = (value) => value.toLowerCase() === needle;
  } else {
    test = (value) => value.toLowerCase().includes(needle);
  }
  return { field: spec.field, negate: spec.negate === true, test };
}

/**
 * Compiles enabled custom formats once per batch. A format with an invalid spec, or with no
 * spec at all, is left out rather than half-applied.
 */
export function compileCustomFormats(formats: readonly CustomFormat[]): CompiledCustomFormats {
  const compiled: CompiledCustomFormat[] = [];
  const errors: CompiledCustomFormats["errors"] = [];
  for (const format of formats) {
    if (!format.enabled) continue;
    if (format.specs.length === 0) {
      errors.push({ formatId: format.id, message: "Format has no conditions" });
      continue;
    }
    const invalid = format.specs.map(validateFormatSpec).find((message) => message !== null);
    if (invalid) {
      errors.push({ formatId: format.id, message: invalid });
      continue;
    }
    compiled.push({ format, specs: format.specs.map(compileSpec) });
  }
  return { formats: compiled, errors };
}

function fieldValues(field: FormatField, facts: ReleaseFacts): string[] {
  const { input, metadata } = facts;
  switch (field) {
    case "title":
      return [input.title];
    case "group":
      return metadata.group ? [metadata.group] : [];
    case "uploader":
      return input.poster ? [input.poster] : [];
    case "category":
      return input.category ?? [];
    case "protocol":
      return [input.downloadType];
    case "indexer":
      return input.indexerName ? [input.indexerName] : [];
  }
}

function formatMatches(compiled: CompiledCustomFormat, facts: ReleaseFacts): boolean {
  return compiled.specs.every((spec) => {
    const matched = fieldValues(spec.field, facts).some((value) => spec.test(value));
    return spec.negate ? !matched : matched;
  });
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

function normalizeTerm(value: string): string {
  return value
    .toLowerCase()
    .replaceAll(/[._\s-]+/g, " ")
    .trim();
}

/**
 * Scores one release. Pass formats compiled with compileCustomFormats (once per batch), or
 * use evaluateReleases for a whole result list.
 */
export function evaluateRelease(
  input: ReleaseInput,
  ctx: ReleaseContext,
  profile: ReleaseProfile = DEFAULT_RELEASE_PROFILE,
  formats: CompiledCustomFormats = { formats: [], errors: [] }
): ReleaseEvaluation {
  const facts: ReleaseFacts = {
    input,
    metadata: parseReleaseMetadata(input.title),
    titleMatch: classifyTitleMatch(input.title, ctx.gameTitle, ctx.alternativeTitles),
    indexerCategory: classifyIndexerCategories(input.category),
  };

  const lines: ScoreLine[] = [];
  const rejections: Rejection[] = [];

  for (const rule of BUILT_IN_RULES) {
    const override = profile.builtInOverrides[rule.id];
    if (override?.enabled === false && !rule.locked) continue;
    if (!rule.applies(facts, ctx, profile)) continue;
    lines.push({ ruleId: rule.id, label: rule.label, points: override?.points ?? rule.points });
    if (rule.rejection) rejections.push({ code: rule.rejection });
  }

  const matchedFormats: string[] = [];
  for (const compiled of formats.formats) {
    if (!formatMatches(compiled, facts)) continue;
    const { format } = compiled;
    matchedFormats.push(format.id);
    lines.push({ ruleId: `cf:${format.id}`, label: format.name, points: format.score });
    if (format.hardReject) {
      rejections.push({ code: "custom_format_reject", detail: format.name });
    }
  }

  const title = normalizeTerm(input.title);
  for (const term of profile.requiredTerms) {
    const normalized = normalizeTerm(term);
    if (normalized && !title.includes(normalized)) {
      rejections.push({ code: "required_term_missing", detail: term });
    }
  }
  for (const term of profile.ignoredTerms) {
    const normalized = normalizeTerm(term);
    if (normalized && title.includes(normalized)) {
      rejections.push({ code: "ignored_term", detail: term });
    }
  }

  if (
    profile.minSeeders > 0 &&
    input.downloadType === "torrent" &&
    (input.seeders ?? 0) < profile.minSeeders
  ) {
    rejections.push({ code: "min_seeders", detail: String(input.seeders ?? 0) });
  }
  if (profile.maxSizeBytes != null && input.size != null && input.size > profile.maxSizeBytes) {
    rejections.push({ code: "max_size", detail: String(input.size) });
  }

  const score = lines.reduce((total, line) => total + line.points, 0);
  if (score < profile.minScore) {
    rejections.push({ code: "below_min_score", detail: String(score) });
  }

  const { category } = categorizeDownload(
    input.title,
    input.aiReleaseType,
    input.aiReleaseTypeConfidence
  );

  return {
    accepted: rejections.length === 0,
    score,
    lines,
    rejections,
    titleMatch: facts.titleMatch,
    indexerCategory: facts.indexerCategory,
    category,
    matchedFormats,
  };
}

export interface EvaluatedRelease<T extends ReleaseInput> {
  item: T;
  evaluation: ReleaseEvaluation;
}

/** Orders accepted releases first, then by score. Ties keep their order (stable sort). */
export function compareEvaluations(a: ReleaseEvaluation, b: ReleaseEvaluation): number {
  if (a.accepted !== b.accepted) return a.accepted ? -1 : 1;
  return b.score - a.score;
}

/**
 * Scores a result list with one compilation of the custom formats and returns it sorted:
 * accepted first, then by score. Rejected releases stay in the list so a manual search can
 * show why they were rejected.
 */
export function evaluateReleases<T extends ReleaseInput>(
  items: readonly T[],
  ctx: ReleaseContext,
  profile: ReleaseProfile = DEFAULT_RELEASE_PROFILE,
  formats: readonly CustomFormat[] = []
): EvaluatedRelease<T>[] {
  const compiled = compileCustomFormats(formats);
  return items
    .map((item) => ({ item, evaluation: evaluateRelease(item, ctx, profile, compiled) }))
    .sort((a, b) => compareEvaluations(a.evaluation, b.evaluation));
}
