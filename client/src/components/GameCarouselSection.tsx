import { useState, useEffect, memo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  type CarouselApi,
} from "@/components/ui/carousel";
import { Skeleton } from "@/components/ui/skeleton";
import GameCard from "./GameCard";
import { type Game } from "@shared/schema";
import { type GameStatus } from "./StatusBadge";

interface GameCarouselSectionProps {
  title: string;
  queryKey: string[];
  queryFn: () => Promise<Game[]>;
  onStatusChange?: (gameId: string, newStatus: GameStatus) => void;
  onViewDetails?: (gameId: string) => void;
  onTrackGame?: (game: Game) => void;
  isDiscovery?: boolean;
}

// ⚡ Bolt: Using React.memo to prevent unnecessary re-renders of the carousel
// when the parent component (e.g., DiscoverPage) updates its state.
const GameCarouselSection = memo(({
  title,
  queryKey,
  queryFn,
  onStatusChange,
  onViewDetails,
  onTrackGame,
  isDiscovery = true,
}: GameCarouselSectionProps) => {
  const [api, setApi] = useState<CarouselApi>();
  const [canScrollPrev, setCanScrollPrev] = useState(false);
  const [canScrollNext, setCanScrollNext] = useState(false);

  const { data: games = [], isLoading, isError, error: _error } = useQuery<Game[]>({
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
      <div className="space-y-4" data-testid={`carousel-section-${title.toLowerCase().replace(/\s+/g, '-')}-loading`}>
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">{title}</h2>
        </div>
        <div className="flex gap-4">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="flex-shrink-0 w-[180px]">
              <Skeleton className="aspect-[3/4] w-full rounded-md" />
              <Skeleton className="h-4 mt-2 w-3/4" />
              <Skeleton className="h-3 mt-1 w-1/2" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-4" data-testid={`carousel-section-${title.toLowerCase().replace(/\s+/g, '-')}-error`}>
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
    return null;
  }

  return (
    <div className="space-y-4" data-testid={`carousel-section-${title.toLowerCase().replace(/\s+/g, '-')}`}>
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">{title}</h2>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8 disabled:opacity-50"
            onClick={scrollPrev}
            disabled={!canScrollPrev}
            aria-label="Previous"
            data-testid={`carousel-prev-${title.toLowerCase().replace(/\s+/g, '-')}`}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8 disabled:opacity-50"
            onClick={scrollNext}
            disabled={!canScrollNext}
            aria-label="Next"
            data-testid={`carousel-next-${title.toLowerCase().replace(/\s+/g, '-')}`}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <Carousel
        opts={{
          align: "start",
          loop: false,
        }}
        setApi={setApi}
        className="w-full"
      >
        <CarouselContent className="-ml-4">
          {games.map((game) => (
            <CarouselItem
              key={game.id}
              className="pl-4 basis-1/2 sm:basis-1/3 md:basis-1/4 lg:basis-1/5 xl:basis-1/6"
            >
              <GameCard
                game={game}
                onStatusChange={onStatusChange}
                onViewDetails={onViewDetails}
                onTrackGame={onTrackGame}
                isDiscovery={isDiscovery}
              />
            </CarouselItem>
          ))}
        </CarouselContent>
      </Carousel>
    </div>
  );
});

export default GameCarouselSection;
