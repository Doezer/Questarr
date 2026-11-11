import { storage } from "./storage.js";
import { config } from "./config.js";
import { decryptCredential, encryptCredential } from "./credential-crypto.js";
import { routesLogger } from "./logger.js";

/**
 * The Steam Web API key can come from the `STEAM_API_KEY` environment variable or from
 * Settings → Integrations. A key saved in Settings wins (as for IGDB and Nexus Mods) and is
 * stored encrypted in `systemConfig`; it is never returned by the API.
 */
export const STEAM_API_KEY_CONFIG_KEY = "steam.apiKey";

export type SteamApiKeySource = "env" | "database" | null;

// The environment key, read on first use and before the first runtime change to `config.steam`.
let envKeyCache: { value: string | undefined } | null = null;
function envApiKey(): string | undefined {
  envKeyCache ??= { value: config.steam.apiKey };
  return envKeyCache.value;
}

/** Make `config.steam` follow the given key (the environment one when the key is empty). */
export function applySteamApiKey(key: string | null | undefined): void {
  // Read the environment key first: it must be captured before this function changes `config.steam`.
  const env = envApiKey();
  const trimmed = key?.trim();
  const effective = trimmed || env;
  config.steam.apiKey = effective;
  config.steam.isConfigured = Boolean(effective);
}

async function readStoredKey(): Promise<string | null> {
  const stored = await storage.getSystemConfig(STEAM_API_KEY_CONFIG_KEY);
  if (!stored) return null;
  try {
    return (await decryptCredential(stored)) || null;
  } catch {
    // Do not log the value: a key that no longer decrypts is ignored and the environment one is used.
    routesLogger.warn("The saved Steam API key could not be decrypted; ignoring it");
    return null;
  }
}

/** Startup: apply the key saved in Settings, if any (the environment one is the fallback). */
export async function loadSteamApiKey(): Promise<void> {
  applySteamApiKey(await readStoredKey());
}

/** Where the key in use comes from, for the Settings badge. */
export async function getSteamApiKeySource(): Promise<SteamApiKeySource> {
  const env = envApiKey();
  if (await readStoredKey()) return "database";
  return env ? "env" : null;
}

/** Save a key from Settings, or remove it (empty) so the environment one applies again. */
export async function saveSteamApiKey(key: string | null): Promise<void> {
  const trimmed = key?.trim() ?? "";
  await storage.setSystemConfig(
    STEAM_API_KEY_CONFIG_KEY,
    trimmed ? await encryptCredential(trimmed) : ""
  );
  applySteamApiKey(trimmed || null);
}
