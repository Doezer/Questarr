import type { DownloadStatus, DownloadDetails } from "../../shared/schema.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type XMLValue = any;

export interface DownloadRequest {
  url: string;
  title: string;
  category?: string;
  downloadPath?: string;
  priority?: number;
  downloadType?: "torrent" | "usenet";
  // Archive/unpack password for the release (e.g. NZB archives that ship password-protected).
  // Currently only consumed by SABnzbd; other clients ignore it.
  password?: string;
}

export interface DownloaderActionResult {
  success: boolean;
  message: string;
}

export interface DownloadResult extends DownloaderActionResult {
  id?: string;
}

export interface DownloaderClient {
  testConnection(): Promise<DownloaderActionResult>;
  logVersionInfo(): Promise<void>;
  addDownload(request: DownloadRequest): Promise<DownloadResult>;
  getDownloadStatus(id: string): Promise<DownloadStatus | null>;
  getDownloadDetails(id: string): Promise<DownloadDetails | null>;
  getAllDownloads(): Promise<DownloadStatus[]>;
  pauseDownload(id: string): Promise<DownloaderActionResult>;
  resumeDownload(id: string): Promise<DownloaderActionResult>;
  removeDownload(id: string, deleteFiles?: boolean): Promise<DownloaderActionResult>;
  getFreeSpace(): Promise<number>;
}
