// src/lib/versionService.ts
import { useQuery } from "@tanstack/react-query";

export async function fetchLatestQuestarrVersion(): Promise<string | null> {
  try {
    const res = await fetch("https://raw.githubusercontent.com/Doezer/Questarr/main/package.json");
    if (!res.ok) return null;
    const data = await res.json();
    return data.version || null;
  } catch (error) {
    console.error("Failed to fetch latest Questarr version:", error);
    return null;
  }
}

export function useLatestQuestarrVersion(): string | null {
  const { data } = useQuery({
    queryKey: ["latestQuestarrVersion"],
    queryFn: fetchLatestQuestarrVersion,
    staleTime: 1000 * 60 * 60, // 1 hour
  });
  return data ?? null;
}
