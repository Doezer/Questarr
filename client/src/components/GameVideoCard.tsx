import { useState } from "react";
import { Play } from "lucide-react";

interface GameVideoCardProps {
  name: string;
  videoId: string;
}

/**
 * IGDB video (YouTube). Nothing is requested from YouTube until the user clicks,
 * then it plays in the privacy-enhanced youtube-nocookie embed.
 */
export default function GameVideoCard({ name, videoId }: GameVideoCardProps) {
  const [playing, setPlaying] = useState(false);

  return (
    <div className="overflow-hidden rounded-xl border bg-card border-card-border text-card-foreground shadow-sm">
      <div className="aspect-video bg-black">
        {playing ? (
          <iframe
            className="h-full w-full"
            src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?autoplay=1&rel=0`}
            title={name}
            allow="autoplay; encrypted-media; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        ) : (
          <button
            type="button"
            aria-label={`Play video: ${name}`}
            onClick={() => setPlaying(true)}
            className="flex h-full w-full flex-col items-center justify-center gap-2 bg-muted/40 text-muted-foreground hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid={`video-play-${videoId}`}
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <Play className="h-5 w-5 fill-current" />
            </span>
            <span className="text-xs">Click to load from YouTube</span>
          </button>
        )}
      </div>
      <p className="truncate px-3 py-2 text-sm" title={name}>
        {name}
      </p>
    </div>
  );
}
