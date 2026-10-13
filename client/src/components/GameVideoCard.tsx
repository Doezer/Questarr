import { Play } from "lucide-react";

interface GameVideoCardProps {
  name: string;
  videoId: string;
  playing: boolean;
  onPlay: () => void;
}

/**
 * IGDB video (YouTube). Shows the YouTube thumbnail until the user clicks, then plays it in
 * the privacy-enhanced youtube-nocookie embed inside Questarr (no redirect to YouTube).
 */
export default function GameVideoCard({ name, videoId, playing, onPlay }: GameVideoCardProps) {
  return (
    <div className="aspect-video overflow-hidden rounded-xl border border-card-border bg-black">
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
          onClick={onPlay}
          className="group relative block h-full w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid={`video-play-${videoId}`}
        >
          <img
            src={`https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`}
            alt=""
            loading="lazy"
            draggable={false}
            className="h-full w-full object-cover"
          />
          <span className="absolute inset-0 flex items-center justify-center bg-black/30 group-hover:bg-black/20">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg">
              <Play className="h-6 w-6 fill-current" />
            </span>
          </span>
        </button>
      )}
    </div>
  );
}
