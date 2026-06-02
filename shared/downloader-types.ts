export const USENET_DOWNLOADER_TYPES = ["sabnzbd", "nzbget"] as const;

export const TORRENT_DOWNLOADER_TYPES = [
  "transmission",
  "rtorrent",
  "qbittorrent",
  "synology",
  "deluge",
] as const;

export function isUsenetDownloaderType(type: string): boolean {
  return (USENET_DOWNLOADER_TYPES as readonly string[]).includes(type);
}

export function isTorrentDownloaderType(type: string): boolean {
  return (TORRENT_DOWNLOADER_TYPES as readonly string[]).includes(type);
}
