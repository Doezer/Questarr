import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Game } from "@shared/schema";

export interface FreshGames {
  games: Game[];
  /** The open-time refetch is still running. */
  isLoading: boolean;
  /** The open-time refetch failed: `games` stays empty until `retry` succeeds. */
  isError: boolean;
  retry: () => void;
}

/**
 * The library list for a dialog. Content-filter settings change what /api/games returns and
 * staleTime is Infinity app-wide, so the cached list is refetched on every open and withheld
 * until that refetch succeeds: games a filter now hides are never shown from a stale cache.
 */
export function useFreshGames(open: boolean): FreshGames {
  const { data, refetch } = useQuery<Game[]>({ queryKey: ["/api/games"], enabled: open });
  const [state, setState] = useState<"loading" | "fresh" | "error">("loading");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!open) {
      setState("loading");
      return;
    }
    let cancelled = false;
    setState("loading");
    void refetch().then((result) => {
      if (!cancelled) setState(result.isSuccess ? "fresh" : "error");
    });
    return () => {
      cancelled = true;
    };
  }, [open, refetch, attempt]);

  return {
    games: state === "fresh" ? (data ?? EMPTY) : EMPTY,
    isLoading: state === "loading",
    isError: state === "error",
    retry: () => setAttempt((n) => n + 1),
  };
}

const EMPTY: Game[] = [];
