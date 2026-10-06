import { storage } from "./storage.js";
import { decryptCredential, encryptCredential } from "./credential-crypto.js";

/**
 * Last-used Prowlarr sync dialog values, kept in system_config so the dialog
 * does not have to be refilled on every sync. The API key is stored encrypted
 * and is never sent back to the browser.
 */
export interface ProwlarrSyncSettings {
  url: string;
  apiKey: string;
  allowInsecureLan: boolean;
  priority?: number | undefined;
  categories: string[];
}

const URL_KEY = "prowlarr.url";
const API_KEY_KEY = "prowlarr.apiKey";
const DEFAULTS_KEY = "prowlarr.syncDefaults";

interface StoredDefaults {
  allowInsecureLan?: unknown;
  priority?: unknown;
  categories?: unknown;
}

function parseDefaults(raw: string | undefined): StoredDefaults {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as StoredDefaults) : {};
  } catch {
    return {};
  }
}

/** Loads the saved sync settings, or null when no sync has been saved yet. */
export async function loadProwlarrSyncSettings(): Promise<ProwlarrSyncSettings | null> {
  const [url, encryptedKey, rawDefaults] = await Promise.all([
    storage.getSystemConfig(URL_KEY),
    storage.getSystemConfig(API_KEY_KEY),
    storage.getSystemConfig(DEFAULTS_KEY),
  ]);
  if (!url || !encryptedKey) return null;

  const defaults = parseDefaults(rawDefaults);
  return {
    url,
    apiKey: (await decryptCredential(encryptedKey)) ?? "",
    allowInsecureLan: defaults.allowInsecureLan === true,
    priority: typeof defaults.priority === "number" ? defaults.priority : undefined,
    categories: Array.isArray(defaults.categories)
      ? defaults.categories.filter((c): c is string => typeof c === "string")
      : [],
  };
}

/** Saves the values of a successful sync so the next one starts from them. */
export async function saveProwlarrSyncSettings(settings: ProwlarrSyncSettings): Promise<void> {
  await storage.setSystemConfigBatch([
    { key: URL_KEY, value: settings.url },
    { key: API_KEY_KEY, value: await encryptCredential(settings.apiKey) },
    {
      key: DEFAULTS_KEY,
      value: JSON.stringify({
        allowInsecureLan: settings.allowInsecureLan,
        priority: settings.priority,
        categories: settings.categories,
      }),
    },
  ]);
}
