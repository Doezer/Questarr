/**
 * Toggle for verbose downloader debug logging.
 *
 * When enabled, every downloader client (qBittorrent, Transmission, rTorrent,
 * Deluge, Synology Download Station, sabnzbd, nzbget) logs the full raw
 * response it receives from the download client at `debug` level, in
 * addition to the normal request-level logging that already exists. This is
 * meant to be turned on only while diagnosing a downloader integration
 * issue - it can be noisy and slightly slower (responses are cloned so both
 * the caller and the logger can read the body), so it defaults to off.
 *
 * The flag is persisted in `system_config` (via the Settings page). This
 * module only holds the in-memory cache so the hot request path never has to
 * await a DB read; reading/writing the persisted value is the caller's job
 * (see `initDownloaderDebugLogging` in server/index.ts and the
 * `/api/downloaders/debug-logging` route in server/routes.ts). Deliberately
 * has no dependency on storage.js/db.js: several downloader client unit
 * tests mock ../logger.js down to just `downloadersLogger`, and pulling in
 * the DB layer here would drag that whole chain into every downloader test.
 */
export const DOWNLOADER_DEBUG_LOGGING_CONFIG_KEY = "downloaders.debugLogging";

let cachedEnabled = false;

/** Synchronous check used on the request/response hot path. */
export function isDownloaderDebugLoggingEnabled(): boolean {
  return cachedEnabled;
}

/** Updates the in-memory cache. Callers are responsible for persisting the value. */
export function setCachedDownloaderDebugLogging(enabled: boolean): void {
  cachedEnabled = enabled;
}
