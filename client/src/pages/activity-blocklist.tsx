import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Search, Trash2 } from "lucide-react";
import { Link } from "wouter";
import PageHeader from "@/components/PageHeader";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { routePaths } from "@/lib/routes";
import type { ReleaseBlacklist } from "@shared/schema";

type BlocklistEntry = ReleaseBlacklist & { gameTitle: string };

function formatDate(value: Date | string | null): string {
  return value ? new Date(value).toLocaleDateString() : "—";
}

export default function ActivityBlocklistPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState("");

  const { data, isLoading, isError, refetch } = useQuery<BlocklistEntry[]>({
    queryKey: ["/api/blacklist"],
  });

  const removeMutation = useMutation({
    mutationFn: async ({ gameId, id }: { gameId: string; id: string }) => {
      await apiRequest("DELETE", `/api/games/${gameId}/blacklist/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/blacklist"] });
      toast({ description: "Release removed from the blocklist" });
    },
    onError: () => toast({ variant: "destructive", description: "Failed to remove the release" }),
  });

  const clearMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", "/api/activity/blocklist");
      return (await res.json()) as { removed: number };
    },
    onSuccess: ({ removed }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/blacklist"] });
      toast({ description: `${removed} release${removed === 1 ? "" : "s"} unblocked` });
    },
    onError: () => toast({ variant: "destructive", description: "Failed to clear the blocklist" }),
  });

  const entries = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const all = data ?? [];
    if (!needle) return all;
    return all.filter(
      (e) =>
        e.releaseTitle.toLowerCase().includes(needle) ||
        e.gameTitle.toLowerCase().includes(needle) ||
        (e.indexerName ?? "").toLowerCase().includes(needle)
    );
  }, [data, filter]);

  const remove = (entry: BlocklistEntry) =>
    removeMutation.mutate({ gameId: entry.gameId, id: entry.id });

  let body;
  if (isLoading) {
    body = <p className="text-sm text-muted-foreground">Loading...</p>;
  } else if (isError) {
    body = (
      <div className="flex items-center gap-3 text-sm text-destructive">
        <span>Could not load the blocklist.</span>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          Retry
        </Button>
      </div>
    );
  } else if (entries.length === 0) {
    body = (
      <div className="flex h-48 flex-col items-center justify-center text-slate-500">
        <Ban className="mb-3 h-10 w-10 opacity-30" aria-hidden="true" />
        <p className="text-sm">
          {data?.length ? "No release matches the filter" : "Nothing blocked"}
        </p>
      </div>
    );
  } else {
    body = (
      <>
        <ul className="flex flex-col gap-3 md:hidden" aria-label="Blocked releases">
          {entries.map((entry) => (
            <li key={entry.id} className="rounded-lg border border-[#374151]/40 bg-card p-4">
              <p className="break-words text-sm font-medium text-white">{entry.releaseTitle}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {entry.gameTitle} · {entry.indexerName ?? "unknown indexer"} ·{" "}
                {formatDate(entry.createdAt)}
              </p>
              <Button
                variant="secondary"
                className="mt-3 h-11 w-full"
                disabled={removeMutation.isPending}
                onClick={() => remove(entry)}
                aria-label={`Remove ${entry.releaseTitle} from the blocklist`}
              >
                <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
                Unblock
              </Button>
            </li>
          ))}
        </ul>
        <div className="hidden overflow-hidden rounded-lg border border-[#374151]/40 md:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#374151]/40 bg-[#111827] text-left text-slate-400">
                <th className="px-4 py-3 font-medium">Release</th>
                <th className="px-4 py-3 font-medium">Game</th>
                <th className="px-4 py-3 font-medium">Indexer</th>
                <th className="px-4 py-3 font-medium">Blocked on</th>
                <th className="px-4 py-3 text-right font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className="border-b border-[#374151]/30 last:border-0">
                  <td className="break-all px-4 py-3 text-white">{entry.releaseTitle}</td>
                  <td className="px-4 py-3 text-slate-300">{entry.gameTitle}</td>
                  <td className="px-4 py-3 text-slate-300">{entry.indexerName ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-300">{formatDate(entry.createdAt)}</td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={removeMutation.isPending}
                      onClick={() => remove(entry)}
                      aria-label={`Remove ${entry.releaseTitle} from the blocklist`}
                    >
                      <Trash2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                      Unblock
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <PageHeader
        title="Blocklist"
        description="Releases you blocked from a game's download results. They are skipped by search and auto-download."
        actions={
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                className="h-11 justify-center sm:h-9"
                disabled={!data?.length || clearMutation.isPending}
              >
                <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
                Unblock all
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Unblock all releases?</AlertDialogTitle>
                <AlertDialogDescription>
                  {data?.length ?? 0} blocked release{data?.length === 1 ? "" : "s"} will show up in
                  search results and can be auto-downloaded again.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => clearMutation.mutate()}>
                  Unblock all
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        }
      />
      <p className="mb-4 text-sm text-muted-foreground">
        Release name terms that hide matching releases everywhere live in{" "}
        <Link href={routePaths.settings} className="text-primary underline underline-offset-2">
          Settings
        </Link>{" "}
        under Discovery &amp; Downloads.
      </p>
      <div className="relative mb-4 max-w-md">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by release, game or indexer"
          aria-label="Filter the blocklist"
          className="h-11 pl-9 sm:h-10"
        />
      </div>
      {body}
    </div>
  );
}
