import { storage } from "./storage.js";
import { logger } from "./logger.js";
import { safeFetch } from "./ssrf.js";

/**
 * RomM (https://romm.app) integration: connection settings, HTTP client and the
 * post-import rescan. Everything lives in system_config (no schema change); the API token
 * is encrypted at rest like the other credentials.
 *
 * Built from the RomM integration branch of Questarr (Doezer) and the API sync of the retro
 * fork by Jeremy Stover (Kadajett/Questarr), rewritten for this codebase.
 */

export const ROMM_CONFIG_KEYS = {
  enabled: "romm.enabled",
  url: "romm.url",
  apiToken: "romm.apiToken",
  platformFolders: "romm.platformFolders",
  syncEnabled: "romm.syncEnabled",
  scanAfterImport: "romm.scanAfterImport",
  lastSync: "romm.lastSync",
} as const;

export interface RommSettings {
  enabled: boolean;
  url: string;
  apiToken: string | null;
  /** Place imports in `<libraryRoot>/<RomM platform slug>/` instead of readable folder names. */
  platformFolders: boolean;
  /** Mark games found in RomM as owned, every 6 hours. */
  syncEnabled: boolean;
  /** Ask RomM to rescan its library after an import. */
  scanAfterImport: boolean;
}

export interface RommRom {
  id: number;
  name: string;
  platform_slug?: string;
  igdb_id?: number | null;
}

export async function readRommSettings(): Promise<RommSettings> {
  const [enabled, url, token, platformFolders, syncEnabled, scanAfterImport] = await Promise.all([
    storage.getSystemConfig(ROMM_CONFIG_KEYS.enabled),
    storage.getSystemConfig(ROMM_CONFIG_KEYS.url),
    storage.getSystemConfig(ROMM_CONFIG_KEYS.apiToken),
    storage.getSystemConfig(ROMM_CONFIG_KEYS.platformFolders),
    storage.getSystemConfig(ROMM_CONFIG_KEYS.syncEnabled),
    storage.getSystemConfig(ROMM_CONFIG_KEYS.scanAfterImport),
  ]);
  let apiToken: string | null = null;
  if (token) {
    try {
      // Loaded on demand: the crypto module opens the database when imported.
      const { decryptCredential } = await import("./credential-crypto.js");
      apiToken = (await decryptCredential(token)) || null;
    } catch (error) {
      logger.warn({ error }, "Could not decrypt the saved RomM API token");
    }
  }
  return {
    enabled: enabled === "true",
    url: (url ?? "").replace(/\/+$/, ""),
    apiToken,
    // Folder layout is independent of the API connection: it only needs RomM's folder names.
    platformFolders: platformFolders === "true",
    syncEnabled: syncEnabled === "true",
    scanAfterImport: scanAfterImport !== "false",
  };
}

export interface RommSettingsUpdate {
  enabled?: boolean | undefined;
  url?: string | undefined;
  /** Plain token; stored encrypted. Omit to keep the stored one. */
  apiToken?: string | undefined;
  platformFolders?: boolean | undefined;
  syncEnabled?: boolean | undefined;
  scanAfterImport?: boolean | undefined;
}

export async function writeRommSettings(update: RommSettingsUpdate): Promise<void> {
  const entries: { key: string; value: string }[] = [];
  const bool = (key: string, value: boolean | undefined) => {
    if (value !== undefined) entries.push({ key, value: String(value) });
  };
  bool(ROMM_CONFIG_KEYS.enabled, update.enabled);
  bool(ROMM_CONFIG_KEYS.platformFolders, update.platformFolders);
  bool(ROMM_CONFIG_KEYS.syncEnabled, update.syncEnabled);
  bool(ROMM_CONFIG_KEYS.scanAfterImport, update.scanAfterImport);
  if (update.url !== undefined) {
    entries.push({ key: ROMM_CONFIG_KEYS.url, value: update.url.trim().replace(/\/+$/, "") });
  }
  if (update.apiToken !== undefined) {
    const { encryptCredential } = await import("./credential-crypto.js");
    entries.push({
      key: ROMM_CONFIG_KEYS.apiToken,
      value: update.apiToken ? await encryptCredential(update.apiToken) : "",
    });
  }
  if (entries.length > 0) await storage.setSystemConfigBatch(entries);
}

export class RommError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
  }
}

/** Whether imports should use RomM platform folders; never throws. */
export async function isRommPlatformFoldersEnabled(): Promise<boolean> {
  try {
    return (await storage.getSystemConfig(ROMM_CONFIG_KEYS.platformFolders)) === "true";
  } catch {
    return false;
  }
}

async function rommRequest<T>(
  settings: Pick<RommSettings, "url" | "apiToken">,
  method: "GET" | "POST",
  path: string,
  body?: unknown
): Promise<T | null> {
  if (!settings.url || !settings.apiToken)
    throw new RommError("RomM URL and API token are required");
  let response: Response;
  try {
    response = await safeFetch(`${settings.url}${path}`, {
      method,
      allowPrivate: true,
      // The bearer token must not travel in plaintext or follow a redirect to another host.
      redirect: "error",
      headers: {
        Authorization: `Bearer ${settings.apiToken}`,
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (error) {
    throw new RommError(
      `Could not reach RomM: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (response.status === 401 || response.status === 403) {
    throw new RommError("RomM rejected the API token");
  }
  if (!response.ok) throw new RommError(`RomM answered HTTP ${response.status}`, response.status);
  if (response.status === 204) return null;
  return (await response.json()) as T;
}

export const rommClient = {
  async testConnection(settings: Pick<RommSettings, "url" | "apiToken">): Promise<number> {
    const platforms = await rommRequest<unknown[]>(settings, "GET", "/api/platforms");
    return Array.isArray(platforms) ? platforms.length : 0;
  },

  async listAllRoms(settings: RommSettings): Promise<RommRom[]> {
    const roms: RommRom[] = [];
    const pageSize = 250;
    for (let offset = 0; ; offset += pageSize) {
      const page = await rommRequest<{ items?: RommRom[]; total?: number }>(
        settings,
        "GET",
        `/api/roms?limit=${pageSize}&offset=${offset}`
      );
      const items = page?.items ?? [];
      roms.push(...items);
      if (items.length < pageSize || roms.length >= (page?.total ?? 0)) break;
    }
    return roms;
  },

  /**
   * Queues a quick scan of the whole library. Recent RomM versions have a dedicated
   * `POST /api/tasks/scan`; older ones only run the `scan_library` task. A scan that is already
   * running (409) is as good as one just queued.
   */
  async triggerScan(settings: Pick<RommSettings, "url" | "apiToken">): Promise<void> {
    try {
      await rommRequest(settings, "POST", "/api/tasks/scan", {});
    } catch (error) {
      if (error instanceof RommError && error.status === 409) return;
      if (!(error instanceof RommError) || ![404, 405, 422].includes(error.status ?? 0))
        throw error;
      try {
        await rommRequest(settings, "POST", "/api/tasks/run/scan_library", {});
      } catch (fallback) {
        if (fallback instanceof RommError && fallback.status === 409) return;
        throw fallback;
      }
    }
  },
};

/**
 * Asks RomM to rescan after an import. Detached on purpose: a RomM outage or a missing token
 * must never fail or delay the download that was just imported.
 */
export function requestRommScanAfterImport(): void {
  void (async () => {
    try {
      const settings = await readRommSettings();
      if (!settings.enabled || !settings.scanAfterImport || !settings.apiToken) return;
      await rommClient.triggerScan(settings);
      logger.info("Asked RomM to rescan its library after an import");
    } catch (error) {
      logger.warn({ error }, "Could not ask RomM to rescan after an import");
    }
  })();
}
