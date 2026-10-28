import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import type { SteamLibraryJobView } from "@shared/steam-library";

interface PreviewGame {
  steamAppId: number;
  title: string;
  alreadyTracked: boolean;
}
interface JobResponse {
  job: SteamLibraryJobView | null;
}
const JOB_KEY = ["/api/steam/library/import/jobs/current"];
const PAGE_SIZE = 50;
const count = (value: number) => value.toLocaleString("en-US");
const active = (job?: SteamLibraryJobView | null) =>
  job?.state === "queued" || job?.state === "running";
const RESULT_LABELS = {
  added: "Added as Owned",
  duplicate: "Already tracked — progress preserved",
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
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const progress = useQuery<JobResponse>({
    queryKey: JOB_KEY,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    queryFn: async () => (await apiRequest("GET", JOB_KEY[0]!)).json(),
    refetchInterval: (query) => (active(query.state.data?.job) ? 2000 : false),
    retry: false,
  });
  const job = progress.data?.job;
  const jobId = job?.id;
  const jobState = job?.state;
  useEffect(() => {
    if (jobId && jobState !== "queued" && jobState !== "running") {
      queryClient.invalidateQueries({ queryKey: ["/api/games"] });
    }
  }, [jobId, jobState, queryClient]);

  const preview = useMutation({
    mutationFn: async () =>
      (await apiRequest("GET", "/api/steam/library")).json() as Promise<{ games: PreviewGame[] }>,
    onSuccess: (data) => {
      setGames(data.games);
      setSelected(
        new Set(data.games.filter((game) => !game.alreadyTracked).map((game) => game.steamAppId))
      );
      setPage(0);
    },
  });
  function followJob(data: JobResponse) {
    queryClient.setQueryData(JOB_KEY, data);
    queryClient.invalidateQueries({ queryKey: JOB_KEY });
    setSelected(new Set());
  }
  const importGames = useMutation({
    mutationFn: async (appIds: number[]) =>
      (
        await apiRequest("POST", "/api/steam/library/import/jobs", { appIds })
      ).json() as Promise<JobResponse>,
    onSuccess: followJob,
    onError: () => queryClient.invalidateQueries({ queryKey: JOB_KEY }),
  });
  const retry = useMutation({
    mutationFn: async () =>
      (
        await apiRequest("POST", "/api/steam/library/import/jobs/retry")
      ).json() as Promise<JobResponse>,
    onSuccess: followJob,
    onError: () => queryClient.invalidateQueries({ queryKey: JOB_KEY }),
  });
  const pending = preview.isPending || importGames.isPending || retry.isPending || active(job);
  const error = preview.error || importGames.error || retry.error || progress.error;
  const tracked = useMemo(
    () =>
      new Set([
        ...(games?.filter((game) => game.alreadyTracked).map((game) => game.steamAppId) ?? []),
        ...(job?.completedAppIds ?? []),
      ]),
    [games, job?.completedAppIds]
  );
  const selectedIds = [...selected].filter((id) => !tracked.has(id));
  const visible =
    games?.filter((game) => game.title.toLowerCase().includes(search.toLowerCase())) ?? [];
  const eligible = visible.filter((game) => !tracked.has(game.steamAppId));
  const pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);
  const pageGames = visible.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  return (
    <section className="space-y-3 border-t pt-4" aria-labelledby="steam-library-title">
      <h3 id="steam-library-title" className="font-medium">
        Import owned Steam games
      </h3>
      <p className="text-sm text-muted-foreground">
        Import your whole library in one go. New games are added as Owned; existing progress,
        statuses and files stay unchanged. This action does not start downloads.
      </p>
      <p className="text-xs text-muted-foreground">
        Requires a saved Steam ID, STEAM_API_KEY on the server, configured IGDB, and public Steam
        Game details. Only exact Steam-to-IGDB matches are imported. Separate from wishlist sync.
      </p>
      <Button
        variant="outline"
        disabled={pending}
        onClick={() => {
          importGames.reset();
          retry.reset();
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
      {job && (
        <div
          className="rounded-md border bg-muted/30 p-4 space-y-3"
          role="status"
          aria-label="Steam import status"
        >
          <p className="font-medium">
            {active(job)
              ? "Import in progress"
              : job.state === "failed"
                ? "Import needs attention"
                : "Import complete"}
          </p>
          <progress
            aria-label="Steam import progress"
            className="w-full h-2 accent-primary"
            value={job.processed}
            max={job.total}
          />
          <p className="text-sm">
            Processed {count(job.processed)} of {count(job.total)} games
          </p>
          <p className="text-xs text-muted-foreground">
            Added {count(job.added)} · Already tracked {count(job.duplicates)} · Skipped{" "}
            {count(job.skipped)} · Failed {count(job.failed)}
          </p>
          {active(job) && (
            <p className="text-xs text-muted-foreground">
              You can leave this page. Progress is saved and unfinished imports resume after a
              server restart.
            </p>
          )}
          {job.message && <p className="text-sm">{job.message}</p>}
          {job.canRetry && (
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => {
                preview.reset();
                importGames.reset();
                retry.mutate();
              }}
            >
              Retry unfinished games
            </Button>
          )}
          {job.recentResults.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer">Recent results</summary>
              <div className="mt-2 space-y-1">
                {job.recentResults.map((row) => (
                  <p key={row.steamAppId}>
                    {row.title}: {RESULT_LABELS[row.outcome]}
                  </p>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
      {games && (
        <>
          <p className="text-sm">
            {count(games.length)} games in Steam · {count(selectedIds.length)} selected
          </p>
          <Input
            aria-label="Filter owned Steam games"
            placeholder="Filter owned Steam games…"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(0);
            }}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={pending || !eligible.length}
              onClick={() =>
                setSelected(
                  (current) => new Set([...current, ...eligible.map((game) => game.steamAppId)])
                )
              }
            >
              Select all matching ({count(eligible.length)})
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={pending || !selectedIds.length}
              onClick={() => setSelected(new Set())}
            >
              Clear selection
            </Button>
          </div>
          <Button
            className="w-full sm:w-auto"
            disabled={pending || !selectedIds.length}
            onClick={() => {
              preview.reset();
              retry.reset();
              importGames.mutate(selectedIds);
            }}
          >
            {importGames.isPending
              ? "Starting import…"
              : `Import selected (${count(selectedIds.length)})`}
          </Button>
          <div className="max-h-64 overflow-y-auto rounded-md border p-3 space-y-3">
            {!visible.length && <p className="text-sm text-muted-foreground">No games match.</p>}
            {pageGames.map((game) => (
              <label key={game.steamAppId} className="flex items-start gap-3 text-sm">
                <Checkbox
                  aria-label={`Import ${game.title}`}
                  disabled={pending || tracked.has(game.steamAppId)}
                  checked={selected.has(game.steamAppId) && !tracked.has(game.steamAppId)}
                  onCheckedChange={(checked) =>
                    setSelected((current) => {
                      const next = new Set(current);
                      if (checked === true) next.add(game.steamAppId);
                      else next.delete(game.steamAppId);
                      return next;
                    })
                  }
                />
                <span className="min-w-0 break-words">
                  {game.title}
                  {tracked.has(game.steamAppId) && (
                    <span className="text-muted-foreground"> · Already tracked</span>
                  )}
                </span>
              </label>
            ))}
          </div>
          <div className="flex items-center justify-between gap-2 text-xs">
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage === 0}
              onClick={() => setPage(currentPage - 1)}
            >
              Previous
            </Button>
            <span>
              Page {count(currentPage + 1)} of {count(pages)}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage >= pages - 1}
              onClick={() => setPage(currentPage + 1)}
            >
              Next
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
