import { z } from "zod";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { storage } from "../storage.js";
import { reloadLocalModel } from "./index.js";

const settingsLogger = logger.child({ module: "classification-settings" });

const CONFIG_KEY = "classification.settings";

export const CLASSIFICATION_MODES = ["hybrid", "local", "cloud"] as const;

/** What the Settings page can change. Everything is optional: an absent key keeps its default. */
export const classificationSettingsSchema = z
  .object({
    mode: z.enum(CLASSIFICATION_MODES),
    localThreshold: z.number().gt(0).lte(1),
    holdUnknown: z.boolean(),
    collect: z.boolean(),
    cloudSuggest: z.boolean(),
    lowConfidence: z.number().gt(0).lte(1),
    maxCandidates: z.number().int().min(100).max(50_000),
  })
  .partial()
  .strict();

export type ClassificationSettings = Required<z.infer<typeof classificationSettingsSchema>>;
export type SettingKey = keyof ClassificationSettings;

/** Environment variable behind each setting, when there is one. A set variable wins. */
const ENV_VARS: Partial<Record<SettingKey, string>> = {
  mode: "CLASSIFICATION_MODE",
  localThreshold: "CLASSIFIER_LOCAL_THRESHOLD",
  holdUnknown: "CLASSIFICATION_HOLD_UNKNOWN",
  collect: "ACTIVE_LEARNING_COLLECT",
  cloudSuggest: "ACTIVE_LEARNING_CLOUD_SUGGEST",
};

/** Settings fixed by an environment variable, with the variable's name. */
export function lockedSettings(): Partial<Record<SettingKey, string>> {
  const locked: Partial<Record<SettingKey, string>> = {};
  for (const [key, name] of Object.entries(ENV_VARS) as [SettingKey, string][]) {
    if (process.env[name] !== undefined && process.env[name] !== "") locked[key] = name;
  }
  return locked;
}

/** The values in force right now (environment, saved setting or default). */
export function currentSettings(): ClassificationSettings {
  const { mode, localThreshold, holdUnknown, activeLearning } = config.classification;
  return {
    mode,
    localThreshold,
    holdUnknown,
    collect: activeLearning.collect,
    cloudSuggest: activeLearning.cloudSuggest,
    lowConfidence: activeLearning.lowConfidence,
    maxCandidates: activeLearning.maxCandidates,
  };
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] extends object ? Mutable<T[K]> : T[K] };

function apply(values: z.infer<typeof classificationSettingsSchema>): void {
  const locked = lockedSettings();
  // `config` is read-only for the rest of the server; this module is the one place that updates it
  const live = config.classification as Mutable<typeof config.classification>;
  const free = (key: SettingKey) => values[key] !== undefined && !(key in locked);
  if (free("mode")) live.mode = values.mode!;
  if (free("localThreshold")) live.localThreshold = values.localThreshold!;
  if (free("holdUnknown")) live.holdUnknown = values.holdUnknown!;
  if (free("collect")) live.activeLearning.collect = values.collect!;
  if (free("cloudSuggest")) live.activeLearning.cloudSuggest = values.cloudSuggest!;
  if (free("lowConfidence")) live.activeLearning.lowConfidence = values.lowConfidence!;
  if (free("maxCandidates")) live.activeLearning.maxCandidates = values.maxCandidates!;
}

async function readSaved(): Promise<z.infer<typeof classificationSettingsSchema>> {
  const raw = await storage.getSystemConfig(CONFIG_KEY);
  if (!raw) return {};
  try {
    const parsed = classificationSettingsSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
  } catch {
    // fall through to the warning
  }
  settingsLogger.warn("Ignoring unreadable saved classification settings");
  return {};
}

/** Applies the saved settings at startup. Environment variables keep winning. */
export async function loadClassificationSettings(): Promise<void> {
  apply(await readSaved());
}

/**
 * Saves a change and applies it at once. A setting fixed by an environment variable is refused,
 * since it would silently have no effect.
 */
export async function updateClassificationSettings(
  patch: z.infer<typeof classificationSettingsSchema>
): Promise<{ rejected: SettingKey[] }> {
  const locked = lockedSettings();
  const rejected = (Object.keys(patch) as SettingKey[]).filter((key) => key in locked);
  if (rejected.length > 0) return { rejected };
  const before = currentSettings();
  await storage.setSystemConfig(CONFIG_KEY, JSON.stringify({ ...(await readSaved()), ...patch }));
  apply(patch);
  const after = currentSettings();
  // The pipeline caches answers and the local layer keeps its threshold: both must be rebuilt
  if (before.mode !== after.mode || before.localThreshold !== after.localThreshold) {
    reloadLocalModel();
  }
  return { rejected: [] };
}
