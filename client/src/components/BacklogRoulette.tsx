import React, { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { gameDetailsPath } from "@/lib/routes";
import { BellOff, Dices, Gamepad2, Loader2 } from "lucide-react";
import type { Game } from "@shared/schema";
import {
  ROULETTE_BIASES,
  ROULETTE_BIAS_LABELS,
  ROULETTE_MOODS,
  ROULETTE_MOOD_LABELS,
  distinctValues,
  filterRouletteGames,
  pickWeighted,
  rouletteWeight,
  type RouletteBias,
  type RouletteMood,
} from "@shared/backlog-roulette";
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
import { Checkbox } from "@/components/ui/checkbox";
import StatusBadge from "./StatusBadge";
import type { Tag } from "@/lib/tags";

interface DrawOverrides {
  bias?: RouletteBias;
  mood?: RouletteMood;
  genre?: string;
  platform?: string;
  installedOnly?: boolean;
  /** Fresh values for state that was just set and is not visible to this render yet. */
  snoozed?: Record<string, number>;
  skipped?: Set<string>;
}

type Pool = "owned" | "playing" | "all";

const POOL_LABELS: Record<Pool, string> = {
  owned: "Owned games",
  playing: "Currently playing",
  all: "All visible games",
};
const ALL_POOLS: Pool[] = ["owned", "playing", "all"];

const SNOOZE_STORAGE_KEY = "questarr:roulette-snoozed";
const SNOOZE_DAYS = 7;
const DAY_MS = 86_400_000;

/** Snoozed game ids with the time they come back, ignoring entries that already expired. */
function loadSnoozed(): Record<string, number> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(SNOOZE_STORAGE_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object") return {};
    const now = Date.now();
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, number] => typeof entry[1] === "number" && entry[1] > now
      )
    );
  } catch {
    return {};
  }
}

function saveSnoozed(snoozed: Record<string, number>) {
  try {
    localStorage.setItem(SNOOZE_STORAGE_KEY, JSON.stringify(snoozed));
  } catch {
    // Storage can be unavailable; the snooze then only lasts for this session.
  }
}

/** A uniform random integer in [0, limit); the remainder of the uint32 range is rejected so modulo is unbiased. */
function randomBelow(limit: number): number {
  const cap = Math.floor(2 ** 32 / limit) * limit;
  let draw: number;
  do {
    [draw = 0] = crypto.getRandomValues(new Uint32Array(1));
  } while (draw >= cap);
  return draw % limit;
}

/** Draw from a filtered game list and let users inspect or mark a game as Playing. */
export default function BacklogRoulette({
  games,
  loading,
  onStartPlaying,
  pools = ALL_POOLS,
  tags,
  tagId = "all",
  onTagChange,
  tagGameIds,
}: {
  games: Game[];
  loading: boolean;
  /** Omit to hide the "Mark as Playing" action (e.g. when every game is already playing). */
  onStartPlaying?: (gameId: string) => Promise<void>;
  /** Pools offered in the "Pick from" select; the first one is the default draw. */
  pools?: Pool[];
  /** The user's tags; with `onTagChange`, adds a "Tag" select to the draw. */
  tags?: Pick<Tag, "id" | "name">[];
  /** The tag the draw is limited to ("all" for no limit). */
  tagId?: string;
  onTagChange?: (tagId: string) => void;
  /** Ids of the games carrying `tagId`; null or undefined while they load or failed. */
  tagGameIds?: Set<string> | null;
}) {
  const [open, setOpen] = useState(false);
  const [pool, setPool] = useState<Pool>(pools[0] ?? "all");
  const [maxHours, setMaxHours] = useState("any");
  const [bias, setBias] = useState<RouletteBias>("random");
  const [mood, setMood] = useState<RouletteMood>("any");
  const [genre, setGenre] = useState("any");
  const [platform, setPlatform] = useState("any");
  const [installedOnly, setInstalledOnly] = useState(false);
  // Games rolled past in this session are not offered again until the draw runs dry.
  const [skippedIds, setSkippedIds] = useState<Set<string>>(() => new Set());
  const [snoozed, setSnoozed] = useState<Record<string, number>>({});
  const genreOptions = useMemo(() => distinctValues(games, "genres"), [games]);
  const platformOptions = useMemo(() => distinctValues(games, "platforms"), [games]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [, navigate] = useLocation();
  const [starting, setStarting] = useState(false);
  function eligibleGames(nextPool: Pool, nextMaxHours: string, overrides: DrawOverrides = {}) {
    const filters = {
      pool: nextPool,
      maxHours: nextMaxHours === "any" ? null : Number(nextMaxHours),
      genre: (overrides.genre ?? genre) === "any" ? null : (overrides.genre ?? genre),
      platform:
        (overrides.platform ?? platform) === "any" ? null : (overrides.platform ?? platform),
      mood: overrides.mood ?? mood,
      installedOnly: overrides.installedOnly ?? installedOnly,
    };
    const now = Date.now();
    return filterRouletteGames(games, filters).filter(
      (game) =>
        // While a tag's games are unavailable the draw is empty rather than unfiltered.
        (tagId === "all" || tagGameIds?.has(game.id) === true) &&
        !(((overrides.snoozed ?? snoozed)[game.id] ?? 0) > now)
    );
  }
  const candidates = eligibleGames(pool, maxHours);

  // The tag's games arrive after the choice is made, so draw again once they are known.
  useEffect(() => {
    if (open && (tagId === "all" || tagGameIds)) roll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tagId, tagGameIds]);
  const selected = candidates.find((game) => game.id === selectedId);

  /**
   * Draw from the chosen pool with the selected bias, never offering a game already skipped in
   * this session. Once every match was skipped the memory resets, keeping only the current game
   * out of the next draw.
   */
  function roll(
    nextPool = pool,
    nextMaxHours = maxHours,
    overrides: DrawOverrides = {},
    skipCurrent = true
  ) {
    const eligible = eligibleGames(nextPool, nextMaxHours, overrides);
    const skipped = new Set(overrides.skipped ?? skippedIds);
    if (skipCurrent && selectedId) skipped.add(selectedId);
    let choices = eligible.filter((game) => !skipped.has(game.id));
    if (!choices.length) {
      skipped.clear();
      if (skipCurrent && selectedId) skipped.add(selectedId);
      choices = eligible.length > 1 ? eligible.filter((game) => !skipped.has(game.id)) : eligible;
    }
    setSkippedIds(skipped);
    const biasToUse = overrides.bias ?? bias;
    const now = Date.now();
    const pick = pickWeighted(choices, (game) => rouletteWeight(game, biasToUse, now), randomBelow);
    setSelectedId(pick?.id ?? null);
  }

  /** Hide the current game from the roulette for a while and draw another one. */
  function snoozeSelected() {
    if (!selected) return;
    const next = { ...loadSnoozed(), [selected.id]: Date.now() + SNOOZE_DAYS * DAY_MS };
    saveSnoozed(next);
    setSnoozed(next);
    // The state update is not visible to roll() yet, so draw around the snoozed game explicitly.
    const eligible = eligibleGames(pool, maxHours).filter((game) => game.id !== selected.id);
    const fresh = eligible.filter((game) => !skippedIds.has(game.id));
    const choices = fresh.length ? fresh : eligible;
    const now = Date.now();
    const pick = pickWeighted(choices, (game) => rouletteWeight(game, bias, now), randomBelow);
    setSelectedId(pick?.id ?? null);
  }

  function clearSnoozed() {
    saveSnoozed({});
    setSnoozed({});
  }

  /** Save the selected game's status; keep the dialog open if the save fails. */
  async function startPlaying() {
    if (!selected || !onStartPlaying) return;
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
          if (value) {
            const freshSnoozed = loadSnoozed();
            setSnoozed(freshSnoozed);
            roll(pool, maxHours, { snoozed: freshSnoozed, skipped: new Set() }, false);
          }
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
                {pools.map((value) => (
                  <SelectItem key={value} value={value}>
                    {POOL_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Your current search and filters apply. Hidden games stay out of the draw.
            </p>
          </div>
          {tags && tags.length > 0 && onTagChange && (
            <div className="space-y-2">
              <Label htmlFor="roulette-tag">Tag</Label>
              <Select value={tagId} disabled={starting || loading} onValueChange={onTagChange}>
                <SelectTrigger id="roulette-tag">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any tag</SelectItem>
                  {tags.map((tag) => (
                    <SelectItem key={tag.id} value={tag.id}>
                      {tag.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="roulette-length">Game length</Label>
            <Select
              value={maxHours}
              disabled={starting || loading}
              onValueChange={(value) => {
                setMaxHours(value);
                roll(pool, value);
              }}
            >
              <SelectTrigger id="roulette-length">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any length</SelectItem>
                <SelectItem value="5">A short adventure · up to 5 hours</SelectItem>
                <SelectItem value="15">A weekend quest · up to 15 hours</SelectItem>
                <SelectItem value="40">A longer journey · up to 40 hours</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Estimated total time to finish, not a play session. Length filters exclude games
              without a known normal completion time.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="roulette-bias">Favour</Label>
              <Select
                value={bias}
                disabled={starting || loading}
                onValueChange={(value) => {
                  setBias(value as RouletteBias);
                  roll(pool, maxHours, { bias: value as RouletteBias }, false);
                }}
              >
                <SelectTrigger id="roulette-bias">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROULETTE_BIASES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {ROULETTE_BIAS_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="roulette-mood">Mood</Label>
              <Select
                value={mood}
                disabled={starting || loading}
                onValueChange={(value) => {
                  setMood(value as RouletteMood);
                  roll(pool, maxHours, { mood: value as RouletteMood }, false);
                }}
              >
                <SelectTrigger id="roulette-mood">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROULETTE_MOODS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {ROULETTE_MOOD_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="roulette-genre">Genre</Label>
              <Select
                value={genre}
                disabled={starting || loading}
                onValueChange={(value) => {
                  setGenre(value);
                  roll(pool, maxHours, { genre: value }, false);
                }}
              >
                <SelectTrigger id="roulette-genre">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any genre</SelectItem>
                  {genreOptions.map((value) => (
                    <SelectItem key={value} value={value}>
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="roulette-platform">Platform</Label>
              <Select
                value={platform}
                disabled={starting || loading}
                onValueChange={(value) => {
                  setPlatform(value);
                  roll(pool, maxHours, { platform: value }, false);
                }}
              >
                <SelectTrigger id="roulette-platform">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any platform</SelectItem>
                  {platformOptions.map((value) => (
                    <SelectItem key={value} value={value}>
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="roulette-installed"
              checked={installedOnly}
              disabled={starting || loading}
              onCheckedChange={(value) => {
                const next = value === true;
                setInstalledOnly(next);
                roll(pool, maxHours, { installedOnly: next }, false);
              }}
            />
            <Label htmlFor="roulette-installed">Only installed games</Label>
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
                    {Number.isFinite(selected.timeToBeatNormally) &&
                      (selected.timeToBeatNormally ?? 0) > 0 && (
                        <p className="text-sm text-muted-foreground">
                          About{" "}
                          {selected.timeToBeatNormally?.toLocaleString("en-US", {
                            maximumFractionDigits: 1,
                          })}{" "}
                          hours to finish
                        </p>
                      )}
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
                    ? "Roll again to pick from your updated list."
                    : "Loosen a filter, choose another pool or check your Library filters to find a game."}
                </p>
              </div>
            )}
          </div>
          {Object.keys(snoozed).length > 0 && (
            <p className="text-xs text-muted-foreground">
              {Object.keys(snoozed).length} snoozed{" "}
              {Object.keys(snoozed).length === 1 ? "game is" : "games are"} resting for up to{" "}
              {SNOOZE_DAYS} days.{" "}
              <button
                type="button"
                className="underline underline-offset-2 hover:text-foreground"
                onClick={() => {
                  clearSnoozed();
                  roll(pool, maxHours, { snoozed: {} }, false);
                }}
              >
                Bring them back
              </button>
            </p>
          )}
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
                    setOpen(false);
                    navigate(gameDetailsPath(selected.id));
                  }}
                >
                  View game
                </Button>
                <Button
                  variant="outline"
                  disabled={starting || loading}
                  onClick={snoozeSelected}
                  aria-label={`Not now: hide ${selected.title} for ${SNOOZE_DAYS} days`}
                >
                  <BellOff className="h-4 w-4 mr-2" />
                  Not now
                </Button>
                {selected.status === "owned" && onStartPlaying && (
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
    </>
  );
}
