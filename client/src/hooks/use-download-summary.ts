import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";
import type { DownloadSummary } from "@shared/schema";

export function useDownloadSummary(): Record<string, DownloadSummary> {
  const { data } = useQuery<Record<string, DownloadSummary>>({
    queryKey: ["/api/downloads/summary"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  return data ?? {};
}
