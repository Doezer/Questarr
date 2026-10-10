import React, { lazy, Suspense, useState } from "react";
import { Dices, Gamepad2, Loader2 } from "lucide-react";
import type { Game } from "@shared/schema";
import { coverSrc } from "@/lib/cover";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import StatusBadge from "./StatusBadge";
import LazyModalFallback from "./LazyModalFallback";

const GameDetailsModal = lazy(() => import("./GameDetailsModal"));
type Pool = "owned" | "playing" | "all";

/** Draw from the filtered Library and let users inspect or mark a game as Playing. */
export default function BacklogRoulette({
  games,
  loading,
  onStartPlaying,
}: {
  games: Game[];
  loading: boolean;
  onStartPlaying: (gameId: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [pool, setPool] = useState<Pool>("owned");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailsGame, setDetailsGame] = useState<Game | null>(null);
  const [starting, setStarting] = useState(false);
  const candidates = games.filter(
    (game) => !game.hidden && (pool === "all" || game.status === pool)
  );
  const selected = candidates.find((game) => game.id === selectedId);

  /** Draw uniformly from the chosen pool, skipping the previous game when possible. */
  function roll(nextPool = pool) {
    const eligible = games.filter(
      (game) => !game.hidden && (nextPool === "all" || game.status === nextPool)
    );
    const choices =
      eligible.length > 1 ? eligible.filter((game) => game.id !== selectedId) : eligible;
    if (!choices.length) {
      setSelectedId(null);
      return;
    }
    // Reject the remainder of the uint32 range so modulo does not bias the draw.
    const limit = Math.floor(2 ** 32 / choices.length) * choices.length;
    let draw;
    do {
      [draw = 0] = crypto.getRandomValues(new Uint32Array(1));
    } while (draw >= limit);
    setSelectedId(choices[draw % choices.length]?.id ?? null);
  }

  /** Save the selected game's status; keep the dialog open if the save fails. */
  async function startPlaying() {
    if (!selected) return;
    setStarting(true);
    try {
      await onStartPlaying(selected.id);
      setOpen(false);
    } catch {
      // The Library mutation shows its error toast. Keep the selection open to retry.
    } finally {
      setStarting(false);
    }
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (starting) return;
          if (value) roll();
          setOpen(value);
        }}
      >
        <DialogTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5"
            disabled={loading}
            aria-label="Pick a game"
          >
            <Dices className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Pick a game</span>
          </Button>
        </DialogTrigger>
        <DialogContent className="max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Dices className="h-5 w-5 text-primary" />
              Backlog roulette
            </DialogTitle>
            <DialogDescription>
              Too many games, nothing to play? Let fate choose tonight’s quest.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="roulette-pool">Pick from</Label>
            <Select
              value={pool}
              disabled={starting || loading}
              onValueChange={(value) => {
                const nextPool = value as Pool;
                setPool(nextPool);
                roll(nextPool);
              }}
            >
              <SelectTrigger id="roulette-pool">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="owned">Owned games</SelectItem>
                <SelectItem value="playing">Currently playing</SelectItem>
                <SelectItem value="all">All visible games</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Your Library search and filters apply. Hidden games stay out of the draw.
            </p>
          </div>
          <div aria-live="polite" aria-atomic="true">
            {selected ? (
              <div className="rounded-lg border bg-muted/30 p-4 space-y-4">
                <p className="text-xs font-semibold uppercase tracking-widest text-primary">
                  Tonight’s quest
                </p>
                <div className="flex gap-4">
                  <img
                    key={selected.id}
                    src={coverSrc(selected.coverUrl)}
                    alt={`Cover for ${selected.title}`}
                    className="w-24 sm:w-28 aspect-[3/4] shrink-0 self-start rounded-md object-cover"
                  />
                  <div className="min-w-0 space-y-2">
                    <h2 className="text-xl font-bold break-words" data-testid="roulette-title">
                      {selected.title}
                    </h2>
                    <StatusBadge status={selected.status} />
                    <p className="text-sm text-muted-foreground break-words">
                      {selected.genres?.join(" · ")}
                    </p>
                    <p className="text-xs text-muted-foreground break-words">
                      {selected.platforms?.join(" · ")}
                    </p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Chosen from {candidates.length} matching{" "}
                  {candidates.length === 1 ? "game" : "games"}.
                </p>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed p-6 text-center space-y-2">
                <Gamepad2 className="h-8 w-8 mx-auto text-muted-foreground" />
                <p className="font-medium">
                  {candidates.length ? "Ready for another quest?" : "No games in this draw"}
                </p>
                <p className="text-sm text-muted-foreground">
                  {candidates.length
                    ? "Roll again to pick from your updated Library."
                    : "Choose another pool or adjust your Library filters to find a game."}
                </p>
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => roll()}
              disabled={
                loading || starting || !candidates.length || (candidates.length === 1 && !!selected)
              }
            >
              <Dices className="h-4 w-4 mr-2" />
              Roll again
            </Button>
            {selected && (
              <>
                <Button
                  variant="outline"
                  disabled={starting || loading}
                  onClick={() => {
                    setDetailsGame(selected);
                    setOpen(false);
                  }}
                >
                  View game
                </Button>
                {selected.status === "owned" && (
                  <Button
                    className="sm:ml-auto"
                    onClick={startPlaying}
                    disabled={starting || loading}
                  >
                    {starting ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Gamepad2 className="h-4 w-4 mr-2" />
                    )}
                    Mark as Playing
                  </Button>
                )}
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
      {detailsGame && (
        <Suspense fallback={<LazyModalFallback />}>
          <GameDetailsModal
            game={detailsGame}
            open
            onOpenChange={(value) => {
              if (!value) setDetailsGame(null);
            }}
          />
        </Suspense>
      )}
    </>
  );
}
