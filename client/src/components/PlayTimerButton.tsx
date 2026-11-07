import { useEffect, useState } from "react";
import { Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePlayTimer } from "@/hooks/use-play-timer";
import { formatElapsed } from "@/lib/play-time";
import { cn } from "@/lib/utils";

/** Seconds-accurate elapsed time since `startedAt`, re-rendered once a second. */
export function RunningElapsed({ startedAt }: Readonly<{ startedAt: string | Date }>) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return <span className="tabular-nums">{formatElapsed(now - new Date(startedAt).getTime())}</span>;
}

interface PlayTimerButtonProps {
  gameId: string;
  gameTitle: string;
  /** `full` is a labelled, touch-sized button; `icon` is a small round one for list rows. */
  variant?: "full" | "icon";
  className?: string;
}

/** Starts or stops the play timer for one game. */
export default function PlayTimerButton({
  gameId,
  gameTitle,
  variant = "full",
  className,
}: Readonly<PlayTimerButtonProps>) {
  const { active, start, stop } = usePlayTimer();
  const timingThisGame = active?.gameId === gameId;
  const timingAnotherGame = Boolean(active) && !timingThisGame;
  const busy = start.isPending || stop.isPending;

  const onClick = (event: React.MouseEvent) => {
    event.stopPropagation();
    if (timingThisGame && active) stop.mutate(active);
    else start.mutate(gameId);
  };

  if (variant === "icon") {
    return (
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className={cn(
          "h-7 w-7 text-muted-foreground hover:text-foreground",
          timingThisGame && "text-emerald-500 hover:text-emerald-400",
          className
        )}
        onClick={onClick}
        disabled={busy || timingAnotherGame}
        aria-label={timingThisGame ? `Stop timer for ${gameTitle}` : `Start timer for ${gameTitle}`}
        title={timingAnotherGame ? "Another game's timer is running" : undefined}
        data-testid={`button-play-timer-${gameId}`}
      >
        {timingThisGame ? <Square className="h-3 w-3" /> : <Play className="h-3 w-3" />}
      </Button>
    );
  }

  return (
    <Button
      type="button"
      size="sm"
      variant={timingThisGame ? "default" : "outline"}
      className={cn("h-10 w-full gap-2 sm:h-9", className)}
      onClick={onClick}
      disabled={busy || timingAnotherGame}
      aria-label={timingThisGame ? `Stop timer for ${gameTitle}` : `Start timer for ${gameTitle}`}
      title={timingAnotherGame ? "Another game's timer is running" : undefined}
      data-testid={`button-play-timer-${gameId}`}
    >
      {timingThisGame && active ? (
        <>
          <Square className="h-3.5 w-3.5" />
          <RunningElapsed startedAt={active.startedAt} />
        </>
      ) : (
        <>
          <Play className="h-3.5 w-3.5" />
          Start timer
        </>
      )}
    </Button>
  );
}
