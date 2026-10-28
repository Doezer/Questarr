import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";

interface PreviewGame {
  steamAppId: number;
  title: string;
  alreadyTracked: boolean;
}
interface ImportResult {
  steamAppId: number;
  title: string;
  outcome: "added" | "duplicate" | "not_found" | "failed";
}
const RESULT_LABELS = {
  added: "Added as Owned",
  duplicate: "Already tracked — kept unchanged",
  not_found: "No eligible IGDB match — skipped",
  failed: "Import failed — retry this game",
};

function errorText(error: Error): string {
  return error instanceof ApiError
    ? error.message
    : "Could not complete the Steam library request. Try again.";
}

export function SteamLibraryImport() {
  const queryClient = useQueryClient();
  const [games, setGames] = useState<PreviewGame[] | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<ImportResult[]>([]);
  const preview = useMutation({
    mutationFn: async () =>
      (await apiRequest("GET", "/api/steam/library")).json() as Promise<{ games: PreviewGame[] }>,
    onSuccess: (data) => {
      setGames(data.games);
      setSelected([]);
      setResults([]);
    },
  });
  const importGames = useMutation({
    mutationFn: async () =>
      (
        await apiRequest("POST", "/api/steam/library/import", { appIds: selected })
      ).json() as Promise<{ results: ImportResult[] }>,
    onSuccess: (data) => {
      setResults(data.results);
      const done = new Set(
        data.results
          .filter((row) => row.outcome === "added" || row.outcome === "duplicate")
          .map((row) => row.steamAppId)
      );
      setGames(
        (current) =>
          current?.map((game) => ({
            ...game,
            alreadyTracked: game.alreadyTracked || done.has(game.steamAppId),
          })) ?? null
      );
      setSelected([]);
      queryClient.invalidateQueries({ queryKey: ["/api/games"] });
    },
  });
  const pending = preview.isPending || importGames.isPending;
  const error = preview.error || importGames.error;
  const visible =
    games?.filter((game) => game.title.toLowerCase().includes(search.toLowerCase())) ?? [];
  return (
    <section className="space-y-3 border-t pt-4" aria-labelledby="steam-library-title">
      <h3 id="steam-library-title" className="font-medium">
        Import owned Steam games
      </h3>
      <p className="text-sm text-muted-foreground">
        Preview your Steam library and select up to 50 games. New games are added as Owned; existing
        entries, progress and files stay unchanged. This action does not start downloads.
      </p>
      <p className="text-xs text-muted-foreground">
        Requires a saved Steam ID, STEAM_API_KEY on the server, configured IGDB, and public Steam
        Game details. Only exact Steam-to-IGDB matches are imported. This is a manual import,
        separate from wishlist sync.
      </p>
      <Button
        variant="outline"
        disabled={pending}
        onClick={() => {
          importGames.reset();
          preview.mutate();
        }}
      >
        {preview.isPending ? "Reading Steam library…" : "Preview owned games"}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {errorText(error)}
        </p>
      )}
      {games && (
        <>
          <p className="text-sm">
            {games.length} games in Steam · {selected.length} selected
          </p>
          <Input
            aria-label="Filter owned Steam games"
            placeholder="Filter owned Steam games…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <div className="max-h-64 overflow-y-auto rounded-md border p-3 space-y-3">
            {!visible.length && <p className="text-sm text-muted-foreground">No games match.</p>}
            {visible.map((game) => (
              <label key={game.steamAppId} className="flex items-start gap-3 text-sm">
                <Checkbox
                  aria-label={`Import ${game.title}`}
                  disabled={
                    pending ||
                    game.alreadyTracked ||
                    (!selected.includes(game.steamAppId) && selected.length >= 50)
                  }
                  checked={selected.includes(game.steamAppId)}
                  onCheckedChange={(checked) =>
                    setSelected((current) =>
                      checked === true
                        ? [...current, game.steamAppId]
                        : current.filter((id) => id !== game.steamAppId)
                    )
                  }
                />
                <span className="min-w-0 break-words">
                  {game.title}
                  {game.alreadyTracked && (
                    <span className="text-muted-foreground"> · Already tracked</span>
                  )}
                </span>
              </label>
            ))}
          </div>
          <Button
            disabled={pending || selected.length === 0}
            onClick={() => {
              preview.reset();
              importGames.mutate();
            }}
          >
            {importGames.isPending ? "Importing…" : `Import selected (${selected.length})`}
          </Button>
        </>
      )}
      {results.length > 0 && (
        <div role="status" className="space-y-2 text-sm">
          {results.map((row) => (
            <p key={row.steamAppId}>
              {row.title}: {RESULT_LABELS[row.outcome]}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}
