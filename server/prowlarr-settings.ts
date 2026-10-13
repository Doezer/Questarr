import { storage } from "./storage.js";
import { normalizeProwlarrUrl } from "./url-utils.js";
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

/** Revokes saved HTTP consent locally, before any credential-bearing sync request. */
export async function revokeProwlarrHttpOptIn(url: string): Promise<void> {
  const saved = await loadProwlarrSyncSettings();
  if (!saved) return;

  let base: URL;
  let requested: URL;
  try {
    base = new URL(normalizeProwlarrUrl(saved.url));
    requested = new URL(normalizeProwlarrUrl(url));
  } catch {
    // No valid identity to revoke. Let the route's URL validator reject a
    // malformed request without turning it into a storage/server error.
    return;
  }
  // Explicit opt-out also revokes the old HTTP connection when replacing it
  // with HTTPS, before a successful sync replaces the sole saved settings row.
  const replacesHttpWithHttps = base.protocol === "http:" && requested.protocol === "https:";
  if (base.href !== requested.href && !replacesHttpWithHttps) return;
  const prefix = base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`;
  for (const indexer of await storage.getAllIndexers()) {
    if (!indexer.allowInsecureLan || indexer.apiKey !== saved.apiKey) continue;
    let target: URL;
    try {
      target = new URL(indexer.url);
    } catch {
      continue;
    }
    if (
      target.origin === base.origin &&
      target.pathname.startsWith(prefix) &&
      /^\d+\/api\/?$/.test(target.pathname.slice(prefix.length))
    ) {
      await storage.updateIndexer(indexer.id, { allowInsecureLan: false });
    }
  }
  // Publish the saved opt-out only after every matching indexer was revoked.
  // On failure the refreshed dialog keeps consent enabled, so users can retry
  // by unticking it again rather than mistaking a partial update for success.
  await saveProwlarrSyncSettings({ ...saved, allowInsecureLan: false });
}
