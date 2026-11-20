import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

type SyncKind = "playStatus" | "libraryImport" | "playTime";

interface SyncEntry {
  at: string | null;
  counts: Record<string, number>;
  error: { at: string; message: string } | null;
}

export interface PlayniteSyncState extends Record<SyncKind, SyncEntry> {
  syncedStatuses: Record<string, number>;
}

export const PLAYNITE_SYNC_KEY = ["/api/playnite/sync"];

/** Human name of where a game status came from; `playnite` is a sync with no known store. */
export function syncSourceLabel(source: string): string {
  switch (source) {
    case "steam":
      return "Steam";
    case "gog":
      return "GOG";
    case "epic":
      return "Epic";
    case "playnite":
      return "Playnite";
    default:
      return source;
  }
}

const KINDS: { kind: SyncKind; label: string; summary: (c: Record<string, number>) => string }[] = [
  {
    kind: "playStatus",
    label: "Play status",
    summary: (c) =>
      `${c.updated ?? 0} updated, ${c.unchanged ?? 0} unchanged, ${c.skipped ?? 0} left alone, ${c.unmatched ?? 0} not in Questarr`,
  },
  {
    kind: "libraryImport",
    label: "Library import",
    summary: (c) =>
      `${c.added ?? 0} added, ${c.existing ?? 0} already there, ${c.notFound ?? 0} not matched`,
  },
  {
    kind: "playTime",
    label: "Play time",
    summary: (c) =>
      `${c.imported ?? 0} imported (${Math.round((c.minutesAdded ?? 0) / 6) / 10} h), ${c.unchanged ?? 0} unchanged, ${c.skipped ?? 0} skipped, ${c.unmatched ?? 0} not in Questarr`,
  },
];

function formatWhen(value: string): string {
  return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** When the Playnite extension last sent statuses, a library or play time, and what went wrong. */
export function PlayniteSyncStatus() {
  const { data, isError } = useQuery<PlayniteSyncState>({
    queryKey: PLAYNITE_SYNC_KEY,
    queryFn: async () => (await apiRequest("GET", "/api/playnite/sync")).json(),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const sources = Object.entries(data?.syncedStatuses ?? {}).sort(([a], [b]) => a.localeCompare(b));

  return (
    <section className="space-y-3 border-t pt-4" aria-labelledby="playnite-sync-title">
      <h3 id="playnite-sync-title" className="font-medium">
        Playnite sync
      </h3>
      <p className="text-sm text-muted-foreground">
        What the Playnite extension last sent. Statuses it wrote show their store on the game page;
        a playing, shelved or completed status you set yourself is never overwritten by a sync.
      </p>

      {isError && (
        <p role="alert" className="text-sm text-destructive">
          Could not load the Playnite sync state.
        </p>
      )}

      {data?.playStatus && (
        <>
          <ul className="space-y-2" data-testid="playnite-sync-list">
            {KINDS.map(({ kind, label, summary }) => {
              const entry = data[kind];
              return (
                <li key={kind} className="rounded-md border border-border p-3 text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="font-medium">{label}</span>
                    <span className="text-xs text-muted-foreground">
                      {entry.at ? `Last successful ${formatWhen(entry.at)}` : "Never succeeded"}
                    </span>
                  </div>
                  {entry.at && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {entry.counts.received ?? 0} {entry.counts.received === 1 ? "game" : "games"}{" "}
                      in that request: {summary(entry.counts)}
                    </p>
                  )}
                  {entry.error && (
                    <p role="alert" className="mt-1 text-xs text-destructive">
                      Failed {formatWhen(entry.error.at)}: {entry.error.message}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-muted-foreground" data-testid="playnite-sync-sources">
            {sources.length === 0
              ? "No game status comes from a sync yet."
              : `Statuses set by a sync: ${sources
                  .map(([source, count]) => `${syncSourceLabel(source)} ${count}`)
                  .join(", ")}.`}
          </p>
        </>
      )}
    </section>
  );
}
