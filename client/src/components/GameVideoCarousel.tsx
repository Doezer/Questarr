import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  type CarouselApi,
} from "@/components/ui/carousel";
import GameVideoCard from "./GameVideoCard";

interface GameVideoCarouselProps {
  videos: Array<{ name: string; videoId: string }>;
}

/** One video at a time; swipe or use the arrows to move between them. */
export default function GameVideoCarousel({ videos }: GameVideoCarouselProps) {
  const [api, setApi] = useState<CarouselApi>();
  const [current, setCurrent] = useState(0);
  const [playingId, setPlayingId] = useState<string | null>(null);

  useEffect(() => {
    if (!api) return;
    const onSelect = () => {
      setCurrent(api.selectedScrollSnap());
      // Stop the video we just left so it doesn't keep playing off-screen
      setPlayingId(null);
    };
    api.on("select", onSelect);
    return () => {
      api.off("select", onSelect);
    };
  }, [api]);

  const prev = useCallback(() => api?.scrollPrev(), [api]);
  const next = useCallback(() => api?.scrollNext(), [api]);
  const multiple = videos.length > 1;

  return (
    <section aria-label="Videos" className="mb-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-medium">Videos</h3>
        {multiple && (
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label="Previous video"
              onClick={prev}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="min-w-10 text-center text-xs text-muted-foreground" aria-live="polite">
              {current + 1} / {videos.length}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label="Next video"
              onClick={next}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
      <Carousel setApi={setApi} opts={{ loop: multiple, watchDrag: multiple }} className="w-full">
        <CarouselContent>
          {videos.map((video) => (
            <CarouselItem key={video.videoId}>
              <GameVideoCard
                name={video.name}
                videoId={video.videoId}
                playing={playingId === video.videoId}
                onPlay={() => setPlayingId(video.videoId)}
              />
              <p className="truncate pt-2 text-sm" title={video.name}>
                {video.name}
              </p>
            </CarouselItem>
          ))}
        </CarouselContent>
      </Carousel>
    </section>
  );
}
