import { useQuery } from "@tanstack/react-query";
import { fetchLatestQuestarrVersion } from "@/lib/versionService";

export function useLatestQuestarrVersion(): string | null {
  const { data } = useQuery({
    queryKey: ["latestQuestarrVersion"],
    queryFn: fetchLatestQuestarrVersion,
    staleTime: 1000 * 60 * 60, // 1 hour
  });
  return data ?? null;
}
