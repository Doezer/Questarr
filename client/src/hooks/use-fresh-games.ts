import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Game } from "@shared/schema";

/**
 * The library list for a dialog. Content-filter settings change what /api/games returns and
 * staleTime is Infinity app-wide, so the cached list is refetched on every open and withheld
 * until that refetch succeeds: games a filter now hides are never shown from a stale cache.
 */
export function useFreshGames(open: boolean): Game[] {
  const { data, refetch } = useQuery<Game[]>({ queryKey: ["/api/games"], enabled: open });
  const [fresh, setFresh] = useState(false);

  useEffect(() => {
    if (!open) {
      setFresh(false);
      return;
    }
    let cancelled = false;
    void refetch().then((result) => {
      if (!cancelled && result.isSuccess) setFresh(true);
    });
    return () => {
      cancelled = true;
    };
  }, [open, refetch]);

  return fresh ? (data ?? EMPTY) : EMPTY;
}

const EMPTY: Game[] = [];
