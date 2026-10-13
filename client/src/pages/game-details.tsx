import { lazy, Suspense, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { AlertCircle, ChevronLeft } from "lucide-react";
import type { Game } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, apiRequest } from "@/lib/queryClient";
import { isDiscoveryId } from "@/lib/utils";
import { routePaths } from "@/lib/routes";
import { canGoBackInApp } from "@/lib/in-app-history";

/** The game a card passed along when navigating here, if any (absent on a direct visit). */
function gameFromNavigationState(id: string): Game | undefined {
  const state = window.history.state as { game?: Game } | null;
  return state?.game?.id === id ? state.game : undefined;
}

const GameDetails = lazy(() => import("@/components/GameDetails"));

function DetailsSkeleton() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 pt-6 sm:px-6" aria-busy="true">
      <Skeleton className="h-9 w-20" />
      <Skeleton className="h-64 w-full rounded-2xl" />
      <Skeleton className="h-10 w-full" />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    </div>
  );
}

/** One game on its own page: a library game by id, or a Discover game by `igdb-<id>`. */
export default function GameDetailsPage() {
  const { id = "" } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const isDiscovery = isDiscoveryId(id);

  const {
    data: game,
    isLoading,
    error,
  } = useQuery<Game>({
    // Under the ["/api/games"] prefix so every status/rating/hidden mutation refreshes the page.
    queryKey: isDiscovery ? ["/api/igdb/game", id] : ["/api/games", id],
    queryFn: async () => {
      const url = isDiscovery
        ? `/api/igdb/game/${encodeURIComponent(id.slice("igdb-".length))}`
        : `/api/games/${encodeURIComponent(id)}`;
      const res = await apiRequest("GET", url);
      return res.json();
    },
    // Shown at once when a card passed the game along; the fetch then refreshes it.
    initialData: () => gameFromNavigationState(id),
    initialDataUpdatedAt: 0,
    enabled: id.length > 0,
    retry: (failureCount, err) =>
      !(err instanceof ApiError && err.status >= 400 && err.status < 500) && failureCount < 2,
  });

  // The tab name is the game's name: with a dozen tabs open that is what you scan.
  useEffect(() => {
    if (!game?.title) return;
    const previous = document.title;
    document.title = `${game.title} · Questarr`;
    return () => {
      document.title = previous;
    };
  }, [game?.title]);

  // A game opened in a fresh tab (or from a bookmark) has no in-app history: fall back to the library.
  const handleClose = useCallback(() => {
    if (canGoBackInApp()) window.history.back();
    else navigate(routePaths.library);
  }, [navigate]);

  if (isLoading) return <DetailsSkeleton />;

  if (!game) {
    const notFound = error instanceof ApiError && (error.status === 404 || error.status === 403);
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-24 text-center">
        <AlertCircle className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
        <h1 className="text-xl font-semibold">
          {notFound ? "Game not found" : "Couldn't load this game"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {notFound
            ? "It may have been removed from your library, or the link is wrong."
            : "Try again in a moment."}
        </p>
        <Button variant="outline" onClick={handleClose} className="gap-1.5">
          <ChevronLeft className="h-4 w-4" />
          Back
        </Button>
      </div>
    );
  }

  return (
    <Suspense fallback={<DetailsSkeleton />}>
      <GameDetails key={game.id} game={game} onClose={handleClose} />
    </Suspense>
  );
}
