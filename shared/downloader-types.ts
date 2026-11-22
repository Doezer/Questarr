export const USENET_DOWNLOADER_TYPES = ["sabnzbd", "nzbget"] as const;

export const TORRENT_DOWNLOADER_TYPES = [
  "transmission",
  "rtorrent",
  "qbittorrent",
  "synology",
  "deluge",
  "realdebrid",
  "torbox",
] as const;

export function isUsenetDownloaderType(type: string): boolean {
  return (USENET_DOWNLOADER_TYPES as readonly string[]).includes(type);
}

export function isTorrentDownloaderType(type: string): boolean {
  return (TORRENT_DOWNLOADER_TYPES as readonly string[]).includes(type);
}

export type TorBoxFetchMode = "local" | "linkOnly";

/**
 * How a TorBox downloader delivers finished files, from its free-form `settings` JSON:
 * `local` copies them to the staging folder and imports them, `linkOnly` just exposes a
 * download link. A downloader saved before the setting existed keeps copying locally.
 */
export function getTorBoxFetchMode(settingsJson: string | null | undefined): TorBoxFetchMode {
  if (!settingsJson) return "local";
  try {
    const parsed: unknown = JSON.parse(settingsJson);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return (parsed as { fetchMode?: unknown }).fetchMode === "linkOnly" ? "linkOnly" : "local";
    }
  } catch {
    // Malformed settings fall back to the default.
  }
  return "local";
}

/** Whether a downloader only exposes links: nothing is fetched to this server or imported. */
export function isLinkOnlyDownloader(downloader: {
  type: string;
  settings?: string | null | undefined;
}): boolean {
  return downloader.type === "torbox" && getTorBoxFetchMode(downloader.settings) === "linkOnly";
}
