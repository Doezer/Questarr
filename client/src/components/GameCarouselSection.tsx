import React, { useState, useEffect, memo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, AlertCircle, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  type CarouselApi,
} from "@/components/ui/carousel";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import GameCard from "./GameCard";
import { type Game } from "@shared/schema";
import { type GameStatus } from "./StatusBadge";

interface GameCarouselSectionProps {
  title: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  queryKey: any[];
  queryFn: () => Promise<Game[]>;
  onStatusChange?: (gameId: string, newStatus: GameStatus) => void;
  onViewDetails?: (gameId: string) => void;
  onTrackGame?: (game: Game) => void;
  onToggleHidden?: (gameId: string, hidden: boolean) => void;
  isDiscovery?: boolean;
}

// ⚡ Bolt: Using React.memo to prevent this component from re-rendering if its props
// have not changed. This is effective because parent components now pass memoized
// functions (via useCallback), preventing unnecessary re-renders for the entire section.
const GameCarouselSection = ({
  title,
  queryKey,
  queryFn,
  onStatusChange,
  onViewDetails,
  onTrackGame,
  onToggleHidden,
  isDiscovery = true,
}: GameCarouselSectionProps) => {
  const [api, setApi] = useState<CarouselApi>();
  const [canScrollPrev, setCanScrollPrev] = useState(false);
  const [canScrollNext, setCanScrollNext] = useState(false);

  const {
    data: games = [],
    isLoading,
    isFetching,
    isError,
    error: _error,
    refetch,
  } = useQuery<Game[]>({
    queryKey,
    queryFn,
  });

  // Update scroll states when API changes or when carousel slides
  useEffect(() => {
    if (!api) return;

    const updateScrollState = () => {
      setCanScrollPrev(api.canScrollPrev());
      setCanScrollNext(api.canScrollNext());
    };

    updateScrollState();
    api.on("reInit", updateScrollState);
    api.on("select", updateScrollState);

    return () => {
      api.off("reInit", updateScrollState);
      api.off("select", updateScrollState);
    };
  }, [api]);

  const scrollPrev = () => api?.scrollPrev();
  const scrollNext = () => api?.scrollNext();

  if (isLoading) {
    return (
      <div
        className="space-y-4"
        data-testid={`carousel-section-${title.toLowerCase().replace(/\s+/g, "-")}-loading`}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">{title}</h2>
        </div>
        <div className="flex gap-4 overflow-hidden">
          {Array.from({ length: 10 }).map((_, index) => (
            <div key={index} className="flex-shrink-0 min-w-[150px] min-h-[200px]">
              <Skeleton className="aspect-[3/4] w-full max-w-[225px] max-h-[300px] mx-auto rounded-md" />
              <Skeleton className="h-4 mt-2 w-3/4 mx-auto" />
              <Skeleton className="h-3 mt-1 w-1/2 mx-auto" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div
        className="space-y-4"
        data-testid={`carousel-section-${title.toLowerCase().replace(/\s+/g, "-")}-error`}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">{title}</h2>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground p-4 border rounded-md">
          <AlertCircle className="h-5 w-5" />
          <span>Failed to load games. Please try again later.</span>
        </div>
      </div>
    );
  }

  if (games.length === 0) {
    return (
      <div
        className="space-y-4"
        data-testid={`carousel-section-${title.toLowerCase().replace(/\s+/g, "-")}-empty`}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">{title}</h2>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground p-4 border rounded-md">
          <AlertCircle className="h-5 w-5" />
          <span>No games found.</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className="space-y-3 w-full max-w-full overflow-hidden"
      data-testid={`carousel-section-${title.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">{title}</h2>
        <div className="flex gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => refetch()}
                disabled={isFetching}
                className="h-8 w-8"
                aria-label="Refresh games"
              >
                <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Refresh</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="inline-block" tabIndex={!canScrollPrev ? 0 : -1}>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 disabled:opacity-50"
                  onClick={scrollPrev}
                  disabled={!canScrollPrev}
                  aria-label="Previous"
                  data-testid={`carousel-prev-${title.toLowerCase().replace(/\s+/g, "-")}`}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <p>{!canScrollPrev ? "First page reached" : "Previous page"}</p>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="inline-block" tabIndex={!canScrollNext ? 0 : -1}>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 disabled:opacity-50"
                  onClick={scrollNext}
                  disabled={!canScrollNext}
                  aria-label="Next"
                  data-testid={`carousel-next-${title.toLowerCase().replace(/\s+/g, "-")}`}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <p>{!canScrollNext ? "Last page reached" : "Next page"}</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
      <div className="relative w-full overflow-hidden" aria-busy={isFetching && !isLoading}>
        {isFetching && !isLoading && (
          <div className="absolute inset-0 bg-background/50 backdrop-blur-[2px] z-10 flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        )}
        <Carousel
          opts={{
            align: "start",
            loop: false,
          }}
          setApi={setApi}
          className={cn("w-full max-w-full transition-opacity", {
            "opacity-50": isFetching && !isLoading,
          })}
          aria-hidden={isFetching && !isLoading}
        >
          <CarouselContent className="-ml-4 max-w-full">
            {games.map((game) => (
              <CarouselItem
                key={game.id}
                className="pl-4 basis-1/3 sm:basis-1/5 md:basis-1/6 lg:basis-[12.5%] xl:basis-[10%]"
              >
                <GameCard
                  game={game}
                  onStatusChange={onStatusChange}
                  onViewDetails={onViewDetails}
                  onTrackGame={onTrackGame}
                  onToggleHidden={onToggleHidden}
                  isDiscovery={isDiscovery}
                />
              </CarouselItem>
            ))}
          </CarouselContent>
        </Carousel>
      </div>
    </div>
  );
};

export default memo(GameCarouselSection);
