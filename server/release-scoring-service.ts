import type { IStorage } from "./storage.js";
import { storage as defaultStorage } from "./storage.js";
import { logger } from "./logger.js";
import { type CustomFormatRow, type ReleaseProfileRow } from "../shared/schema.js";
import {
  DEFAULT_RELEASE_PROFILE,
  MAX_FORMAT_REGEX_LENGTH,
  type CustomFormat,
  type FormatSpec,
  type ProtocolPreference,
  type ReleaseEvaluation,
  type ReleaseProfile,
} from "../shared/release-scoring.js";
import { parseJsonStringArray } from "../shared/title-utils.js";

/** Points a release from a preferred group gains; the old setting only reordered. */
export const PREFERRED_GROUP_SCORE = 50;
export const PREFERRED_GROUP_FORMAT_NAME = "Preferred release group";
export const NON_PREFERRED_GROUP_FORMAT_NAME = "Not a preferred release group";

export interface ScoringConfig {
  profile: ReleaseProfile;
  formats: CustomFormat[];
}

export function profileFromRow(row: ReleaseProfileRow): ReleaseProfile {
  const protocol: ProtocolPreference =
    row.protocolPreference === "torrent" || row.protocolPreference === "usenet"
      ? row.protocolPreference
      : "either";
  return {
    minScore: row.minScore,
    protocolPreference: protocol,
    requiredTerms: row.requiredTerms,
    ignoredTerms: row.ignoredTerms,
    minSeeders: row.minSeeders,
    maxSizeBytes: row.maxSizeBytes,
    builtInOverrides: row.builtInOverrides,
    formatScores: row.formatScores,
  };
}

export function formatFromRow(row: CustomFormatRow): CustomFormat {
  return {
    id: row.id,
    name: row.name,
    specs: row.specs,
    score: row.score,
    hardReject: row.hardReject,
    enabled: row.enabled,
  };
}

function escapeRegex(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

/** `^(?:a|b)$` patterns that each stay under the regex length limit. */
function groupAlternations(groups: string[]): string[] {
  const budget = MAX_FORMAT_REGEX_LENGTH - "^(?:)$".length;
  const patterns: string[][] = [[]];
  let length = 0;
  for (const group of groups) {
    const escaped = escapeRegex(group);
    const cost = escaped.length + 1;
    const current = patterns[patterns.length - 1] as string[];
    if (current.length > 0 && length + cost > budget) {
      patterns.push([escaped]);
      length = cost;
    } else {
      current.push(escaped);
      length += cost;
    }
  }
  return patterns.map((chunk) => `^(?:${chunk.join("|")})$`);
}

/**
 * The formats that stand in for the old preferred-groups setting. Preferred groups gain
 * points (any of them is enough); strict mode also rejects every other group, which is a
 * hard-reject format whose conditions are all required "group is not in this list" chunks.
 */
export function preferredGroupFormats(
  groups: string[],
  strict: boolean
): { name: string; specs: FormatSpec[]; score: number; hardReject: boolean }[] {
  const cleaned = Array.from(new Set(groups.map((g) => g.trim()).filter(Boolean)));
  if (cleaned.length === 0) return [];
  const patterns = groupAlternations(cleaned);
  const formats = [
    {
      name: PREFERRED_GROUP_FORMAT_NAME,
      specs: patterns.map((value): FormatSpec => ({ field: "group", mode: "regex", value })),
      score: PREFERRED_GROUP_SCORE,
      hardReject: false,
    },
  ];
  if (strict) {
    formats.push({
      name: NON_PREFERRED_GROUP_FORMAT_NAME,
      specs: patterns.map((value): FormatSpec => ({
        field: "group",
        mode: "regex",
        value,
        negate: true,
        required: true,
      })),
      score: 0,
      hardReject: true,
    });
  }
  return formats;
}

const inFlight = new Map<string, Promise<void>>();

/**
 * Creates the user's profile the first time it is needed, carrying over the old settings:
 * the preferred release groups (kept in
 * user_settings, which is left untouched so a downgrade still works). minScore starts at 0 so
 * nothing is rejected that the old filters let through, apart from the title checks.
 */
async function createInitialConfig(store: IStorage, userId: string): Promise<void> {
  const settings = await store.getUserSettings(userId);
  const { minScore, protocolPreference, requiredTerms, ignoredTerms, maxSizeBytes } =
    DEFAULT_RELEASE_PROFILE;
  const formats = preferredGroupFormats(
    parseJsonStringArray(settings?.preferredReleaseGroups),
    settings?.filterByPreferredGroups ?? false
  );
  for (const format of formats) {
    await store.createCustomFormat(userId, { ...format, enabled: true });
  }
  await store.saveReleaseProfile(userId, {
    minScore,
    protocolPreference,
    requiredTerms,
    ignoredTerms,
    // the seeder floor stays in the download rules, which apply on top of the profile
    minSeeders: 0,
    maxSizeBytes,
    builtInOverrides: {},
    formatScores: {},
  });
  logger.info({ userId, formats: formats.length }, "Created release scoring profile");
}

export async function ensureScoringConfig(
  userId: string,
  store: IStorage = defaultStorage
): Promise<void> {
  if (await store.getReleaseProfile(userId)) return;
  const pending = inFlight.get(userId);
  if (pending) return pending;
  const run = (async () => {
    // formats are created before the profile, so a crash in between retries cleanly: the
    // profile row is what marks the migration as done
    if (await store.getReleaseProfile(userId)) return;
    for (const row of await store.getCustomFormats(userId)) {
      await store.deleteCustomFormat(userId, row.id);
    }
    await createInitialConfig(store, userId);
  })().finally(() => inFlight.delete(userId));
  inFlight.set(userId, run);
  return run;
}

export async function loadScoringConfig(
  userId: string,
  store: IStorage = defaultStorage
): Promise<ScoringConfig> {
  await ensureScoringConfig(userId, store);
  const [profileRow, formatRows] = await Promise.all([
    store.getReleaseProfile(userId),
    store.getCustomFormats(userId),
  ]);
  return {
    profile: profileRow ? profileFromRow(profileRow) : DEFAULT_RELEASE_PROFILE,
    formats: formatRows.map(formatFromRow),
  };
}

/**
 * The name is editable and not unique, so the narrowing also checks that the format still has
 * the shape the migration gives it: only anchored "group matches" regex conditions, no reject.
 */
function hasMigratedGroupShape(format: { hardReject: boolean; specs: FormatSpec[] }): boolean {
  return (
    !format.hardReject &&
    format.specs.length > 0 &&
    format.specs.every(
      (spec) =>
        spec.field === "group" &&
        spec.mode === "regex" &&
        !spec.negate &&
        !spec.required &&
        spec.value.startsWith("^(?:") &&
        spec.value.endsWith(")$")
    )
  );
}

/**
 * The "Preferred release group" format created from the old setting, while the user still has
 * it with a positive score; undefined once it is edited into something else, disabled or
 * scored at zero or below.
 */
export function activePreferredGroupFormat(config: ScoringConfig): CustomFormat | undefined {
  const format = config.formats.find(
    (f) => f.enabled && f.name === PREFERRED_GROUP_FORMAT_NAME && hasMigratedGroupShape(f)
  );
  if (!format) return undefined;
  return (config.profile.formatScores[format.id] ?? format.score) > 0 ? format : undefined;
}

/**
 * Whether auto-search may take a release (and the "results available" badge counts it): it is
 * accepted and a clear title match. "Game-NEWGROUP" reads as ambiguous when the group is not a
 * known one; a group the user explicitly preferred is a verified suffix, as it was for the old
 * preferred-groups filter.
 */
export function isAutoEligible(evaluation: ReleaseEvaluation, config: ScoringConfig): boolean {
  if (!evaluation.accepted) return false;
  if (evaluation.titleMatch === "exact" || evaluation.titleMatch === "contains") return true;
  const preferredId = activePreferredGroupFormat(config)?.id;
  return (
    evaluation.titleMatch === "ambiguous" &&
    preferredId !== undefined &&
    evaluation.matchedFormats.includes(preferredId)
  );
}
