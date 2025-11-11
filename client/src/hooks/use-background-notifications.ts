import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";

interface DownloadStatus {
  id: string;
  name: string;
  status: 'downloading' | 'seeding' | 'completed' | 'paused' | 'error';
  progress: number;
  error?: string;
  downloaderId: string;
  downloaderName: string;
}

/**
 * Hook to monitor download progress and show toast notifications for background operations
 * Shows notifications when:
 * - Download completes
 * - Download encounters an error
 */
export function useBackgroundNotifications() {
  // Track previously seen downloads to detect state changes
  const previousDownloadsRef = useRef<Map<string, DownloadStatus>>(new Map());

  // Poll for downloads every 5 seconds (same as downloads page)
  const { data: downloads = [] } = useQuery<DownloadStatus[]>({
    queryKey: ["/api/downloads"],
    refetchInterval: 5000,
    retry: false, // Don't retry on error to avoid spam
  });

  useEffect(() => {
    if (downloads.length === 0) {
      return;
    }

    const previousDownloads = previousDownloadsRef.current;

    downloads.forEach((download) => {
      const previous = previousDownloads.get(download.id);

      // If this is a new download (not seen before), just track it
      if (!previous) {
        previousDownloadsRef.current.set(download.id, download);
        return;
      }

      // Check for completion (status changed to completed)
      if (previous.status !== 'completed' && download.status === 'completed') {
        toast({
          title: "Download completed",
          description: download.name,
        });
      }

      // Check for errors
      if (previous.status !== 'error' && download.status === 'error') {
        toast({
          title: "Download error",
          description: download.error || download.name,
          variant: "destructive",
        });
      }

      // Update tracked download
      previousDownloadsRef.current.set(download.id, download);
    });

    // Remove downloads that no longer exist
    const currentIds = new Set(downloads.map(d => d.id));
    Array.from(previousDownloads.keys()).forEach((id) => {
      if (!currentIds.has(id)) {
        previousDownloadsRef.current.delete(id);
      }
    });
  }, [downloads]);

  return null;
}
