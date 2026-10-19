import { classifyTitleMatch } from "./release-scoring.js";

/**
 * Deterministic release classification (Questarr-mgmt #1, ADR-001 Decision A).
 *
 * Answers "what kind of package is this release?" from its name alone, and says "unknown"
 * whenever the name does not carry decisive evidence. An uncertain release is never a full
 * game: `full_game` needs either an explicit bundle statement ("Incl. all DLC") or the game
 * title as context with nothing but release descriptors around it. The result is a
 * classification only; whether a release may be downloaded is decided elsewhere.
 */
export const RELEASE_CLASSES = ["full_game", "expansion", "patch", "dlc", "unknown"] as const;
export type ReleaseClass = (typeof RELEASE_CLASSES)[number];

/** Things the label set does not cover, kept so the existing auto-download holds can use them. */
export type ClassificationFlag = "repack" | "demo" | "soundtrack" | "crack_only" | "other_artifact";

export interface Classification {
  class: ReleaseClass;
  /** Calibrated probability; null for rule hits, which are not probabilistic. */
  confidence: number | null;
  source: "rules" | "local" | "cloud";
  /** Stable ids of the rules that fired, to explain the result. */
  ruleIds?: string[];
  modelVersion?: string;
  flags?: ClassificationFlag[];
}

export interface ReleaseClassificationInput {
  title: string;
  /** The game being searched for. Without it a plain name cannot be called a full game. */
  gameTitle?: string;
  alternativeTitles?: readonly string[];
}

interface Rule {
  id: string;
  pattern: RegExp;
}

const BUNDLE_ITEM =
  "(?:\\d+\\s+)?(?:dlcs?|updates?|patch(?:es)?|hotfix(?:es)?|bonus(?:es)?|soundtrack|ost|expansions?|extras?|season pass)(?:\\s+v?\\d+(?:\\.\\d+)*)?";
// "Incl. all DLC", "+ Update 3", "with DLC and Soundtrack": content shipped inside the release
const BUNDLE_PATTERN = new RegExp(
  String.raw`(?<!\w)(?:incl(?:uding|uded)?\.?|with|plus|\+)\s*(?:all\s+)?(?:the\s+)?${BUNDLE_ITEM}` +
    String.raw`(?:\s*(?:,|and|&|\+)\s*(?:all\s+)?${BUNDLE_ITEM})*`,
  "gi"
);

// Release names that are not a game package at all. They map to unknown plus a flag.
const FLAG_RULES: readonly (Rule & { flag: ClassificationFlag })[] = [
  { id: "flag.soundtrack", flag: "soundtrack", pattern: /\b(?:ost|soundtrack)\b/i },
  {
    id: "flag.other-artifact",
    flag: "other_artifact",
    pattern: /\b(?:artbook|wallpapers?|manual|comics?|digital content|making of)\b/i,
  },
  { id: "flag.demo", flag: "demo", pattern: /\bdemo\b/i },
  {
    id: "flag.crack-only",
    flag: "crack_only",
    pattern: /\b(?:crack(?:ed)? only|crack ?fix|no ?cd|fix|crack)\b/i,
  },
];

const PATCH_RULES: readonly Rule[] = [
  { id: "patch.update-word", pattern: /\bupdates?\b/i },
  { id: "patch.patch-word", pattern: /\bpatch(?:es)?\d*\b/i },
  { id: "patch.hotfix", pattern: /\b(?:hotfix(?:es)?|hf\d+)\b/i },
  { id: "patch.version-range", pattern: /\bv?\d+(?:\.\d+)+\s*(?:to|->)\s*v?\d+(?:\.\d+)*\b/i },
];

const DLC_RULES: readonly Rule[] = [
  { id: "dlc.dlc-word", pattern: /\bdlcs?\b/i },
  { id: "dlc.downloadable-content", pattern: /\bdownloadable content\b/i },
  { id: "dlc.season-pass", pattern: /\bseason pass\b/i },
  {
    id: "dlc.content-pack",
    pattern: /\b(?:costume|skin|character|map|weapon|item|booster|starter|bonus|content) pack\b/i,
  },
  { id: "dlc.upgrade", pattern: /\bupgrade\b/i },
  { id: "dlc.addon", pattern: /\badd ?ons?\b/i },
  { id: "dlc.unlocker", pattern: /\bunlocker\b/i },
];

const EXPANSION_RULES: readonly Rule[] = [
  { id: "expansion.expansion-word", pattern: /\bexpansions?\b/i },
];

/** Lower-cased words with separators opened up, without the scene group or indexer tag. */
function normalizeName(title: string): string {
  let name = title.trim().replace(/\s*\[[^\]]*\]\s*$/, "");
  const dash = name.lastIndexOf("-");
  // a scene group sits right after the dash ("Game-GROUP"); "Game - Soundtrack" is part of the title
  if (dash > 0 && !/\s/.test(name.charAt(dash - 1))) {
    const suffix = name.slice(dash + 1).trim();
    if (suffix.length > 0 && suffix.length <= 24 && !/\s/.test(suffix)) {
      name = name.slice(0, dash);
    }
  }
  return (
    name
      // dots stay between digits so versions ("v1.0.2") survive
      .replaceAll(/[_-]+/g, " ")
      .replaceAll(/(?<!\d)\.|\.(?!\d)/g, " ")
      .replaceAll(/\s+/g, " ")
      .trim()
  );
}

/** A game title's words with separators opened up; no group stripping, "Half-Life" keeps its dash. */
function titleWords(title: string): string {
  return title
    .replaceAll(/[_-]+/g, " ")
    .replaceAll(/(?<!\d)\.|\.(?!\d)/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * The release name without the known game title it starts with, so a marker word that is part
 * of the title ("DLC Quest", "Patch Quest") is not read as content kind.
 */
function withoutLeadingTitle(text: string, input: ReleaseClassificationInput): string {
  const lower = text.toLowerCase();
  const titles = [input.gameTitle, ...(input.alternativeTitles ?? [])]
    .filter((title): title is string => !!title)
    .map(titleWords)
    .filter((title) => title.length > 0)
    .sort((a, b) => b.length - a.length);
  const lead = titles.find((title) => lower === title || lower.startsWith(`${title} `));
  return lead ? text.slice(lead.length).trim() : text;
}

function matching(rules: readonly Rule[], text: string): string[] {
  return rules.filter((rule) => rule.pattern.test(text)).map((rule) => rule.id);
}

export function classifyReleaseByRules(input: ReleaseClassificationInput): Classification {
  const name = normalizeName(input.title);
  const bundled = BUNDLE_PATTERN.test(name);
  BUNDLE_PATTERN.lastIndex = 0;
  // content named inside a bundle statement is shipped with the game, not the release itself
  const text = withoutLeadingTitle(
    bundled ? name.replaceAll(BUNDLE_PATTERN, " ").trim() : name,
    input
  );

  const flagHits = FLAG_RULES.filter((rule) => rule.pattern.test(text));
  const patch = matching(PATCH_RULES, text);
  const dlc = matching(DLC_RULES, text);
  const expansion = matching(EXPANSION_RULES, text);
  const classes: ReleaseClass[] = [];
  if (patch.length > 0) classes.push("patch");
  if (dlc.length > 0) classes.push("dlc");
  if (expansion.length > 0) classes.push("expansion");
  const contentIds = [...patch, ...dlc, ...expansion];

  if (flagHits.length > 0) {
    return {
      class: "unknown",
      confidence: null,
      source: "rules",
      ruleIds: [...flagHits.map((rule) => rule.id), ...contentIds],
      flags: flagHits.map((rule) => rule.flag),
    };
  }
  if (classes.length === 1) {
    return {
      class: classes[0] as ReleaseClass,
      confidence: null,
      source: "rules",
      ruleIds: contentIds,
    };
  }
  if (classes.length > 1) {
    return {
      class: "unknown",
      confidence: null,
      source: "rules",
      ruleIds: ["unknown.conflict", ...contentIds],
    };
  }

  const repack = /\brepack\b/i.test(input.title.replaceAll(/[._-]+/g, " "))
    ? (["repack"] as ClassificationFlag[])
    : undefined;
  const withFlags = (classification: Classification): Classification =>
    repack ? { ...classification, flags: repack } : classification;

  if (bundled) {
    return withFlags({
      class: "full_game",
      confidence: null,
      source: "rules",
      ruleIds: ["full-game.bundle"],
    });
  }
  if (
    input.gameTitle &&
    classifyTitleMatch(input.title, input.gameTitle, input.alternativeTitles) === "exact"
  ) {
    return withFlags({
      class: "full_game",
      confidence: null,
      source: "rules",
      ruleIds: ["full-game.bare-title"],
    });
  }
  return withFlags({
    class: "unknown",
    confidence: null,
    source: "rules",
    ruleIds: ["unknown.no-evidence"],
  });
}
