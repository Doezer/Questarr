/**
 * Download status type for torrent clients
 */
export type DownloadStatusType = "downloading" | "seeding" | "completed" | "paused" | "error";

/**
 * Download data interface
 */
export interface DownloadData {
  id: string;
  name: string;
  status: DownloadStatusType;
  progress: number;
  downloadSpeed?: number;
  uploadSpeed?: number;
  eta?: number;
  size?: number;
  downloaded?: number;
  seeders?: number;
  leechers?: number;
  ratio?: number;
  error?: string;
  downloaderId: string;
  downloaderName: string;
}

/**
 * Format bytes to human-readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

/**
 * Format download/upload speed
 */
export function formatSpeed(bytesPerSecond: number): string {
  return formatBytes(bytesPerSecond) + "/s";
}

/**
 * Format ETA (estimated time of arrival)
 */
export function formatETA(seconds: number): string {
  if (seconds <= 0) return "∞";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

/**
 * Get CSS class for status color
 */
export function getStatusColor(status: DownloadStatusType): string {
  switch (status) {
    case "downloading":
      return "bg-blue-500";
    case "seeding":
      return "bg-green-500";
    case "completed":
      return "bg-green-600";
    case "paused":
      return "bg-yellow-500";
    case "error":
      return "bg-red-500";
    default:
      return "bg-gray-500";
  }
}

/**
 * Get badge variant for status
 */
export function getStatusBadgeVariant(
  status: DownloadStatusType
): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "downloading":
    case "seeding":
      return "default";
    case "completed":
      return "outline";
    case "paused":
      return "secondary";
    case "error":
      return "destructive";
    default:
      return "outline";
  }
}

/**
 * Filter downloads by status
 */
export function filterDownloadsByStatus(
  downloads: DownloadData[],
  filter: DownloadStatusType | "all"
): DownloadData[] {
  if (filter === "all") {
    return downloads;
  }
  return downloads.filter((d) => d.status === filter);
}

/**
 * Check if download speed badge should be shown
 * Speed badge is shown when speed is defined and greater than 0
 */
export function shouldShowSpeedBadge(speed: number | undefined): boolean {
  return speed !== undefined && speed > 0;
}

/**
 * Check if ETA badge should be shown
 * ETA badge is shown when ETA is defined and greater than 0
 */
export function shouldShowETABadge(eta: number | undefined): boolean {
  return eta !== undefined && eta > 0;
}

/**
 * Check if ratio badge should be shown
 * Ratio badge is shown when ratio is defined and >= 0
 */
export function shouldShowRatioBadge(ratio: number | undefined): boolean {
  return ratio !== undefined && ratio >= 0;
}

/**
 * Check if size badge should be shown
 * Size badge is shown when size is defined and greater than 0
 */
export function shouldShowSizeBadge(size: number | undefined): boolean {
  return size !== undefined && size > 0;
}

/**
 * Check if peers badge should be shown
 * Peers badge is shown when seeders count is defined
 */
export function shouldShowPeersBadge(seeders: number | undefined): boolean {
  return seeders !== undefined;
}
