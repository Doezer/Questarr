import { useEffect, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { History, Search } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { DownloadEvent, DownloadEventType } from "@shared/schema";

const PAGE_SIZE = 50;

const EVENT_LABELS: Record<DownloadEventType, { label: string; className: string }> = {
  grabbed: { label: "Grabbed", className: "border-blue-700/50 bg-blue-900/40 text-blue-400" },
  completed: {
    label: "Completed",
    className: "border-emerald-700/50 bg-emerald-900/40 text-emerald-400",
  },
  imported: { label: "Imported", className: "border-teal-700/50 bg-teal-900/40 text-teal-400" },
  failed: { label: "Failed", className: "border-red-700/50 bg-red-900/40 text-red-400" },
  needs_review: {
    label: "Needs review",
    className: "border-amber-700/50 bg-amber-900/40 text-amber-400",
  },
  removed: { label: "Removed", className: "border-slate-600/50 bg-slate-800/60 text-slate-300" },
  blocklisted: {
    label: "Blocklisted",
    className: "border-purple-700/50 bg-purple-900/40 text-purple-400",
  },
};

function EventBadge({ type }: Readonly<{ type: DownloadEventType }>) {
  const meta = EVENT_LABELS[type] ?? { label: type, className: "" };
  return <Badge className={meta.className}>{meta.label}</Badge>;
}

function formatDateTime(value: Date | string | null): string {
  return value ? new Date(value).toLocaleString() : "—";
}

export default function ActivityHistoryPage() {
  const [eventType, setEventType] = useState<DownloadEventType | "all">("all");
  const [page, setPage] = useState(0);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  // Query the server once the user pauses typing, always from the first page.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const params = new URLSearchParams({
    limit: String(PAGE_SIZE),
    offset: String(page * PAGE_SIZE),
  });
  if (eventType !== "all") params.set("eventType", eventType);
  if (search) params.set("search", search);
  const url = `/api/activity/history?${params.toString()}`;

  const { data, isLoading, isError, refetch } = useQuery<{
    events: DownloadEvent[];
    total: number;
  }>({
    queryKey: [url],
    placeholderData: keepPreviousData,
  });

  const events = data?.events ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  let body;
  if (isLoading) {
    body = <p className="text-sm text-muted-foreground">Loading...</p>;
  } else if (isError) {
    body = (
      <div className="flex items-center gap-3 text-sm text-destructive">
        <span>Could not load the history.</span>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          Retry
        </Button>
      </div>
    );
  } else if (events.length === 0) {
    body = (
      <div className="flex h-48 flex-col items-center justify-center text-slate-500">
        <History className="mb-3 h-10 w-10 opacity-30" aria-hidden="true" />
        <p className="text-sm">
          {search || eventType !== "all" ? "No event matches" : "No download activity yet"}
        </p>
      </div>
    );
  } else {
    body = (
      <>
        <ul className="flex flex-col gap-3 md:hidden" aria-label="Download history">
          {events.map((event) => (
            <li key={event.id} className="rounded-lg border border-[#374151]/40 bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <p className="break-words text-sm font-medium text-white">{event.releaseTitle}</p>
                <EventBadge type={event.eventType} />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {event.gameTitle}
                {event.downloaderName ? ` · ${event.downloaderName}` : ""} ·{" "}
                {formatDateTime(event.createdAt)}
              </p>
              {event.message && (
                <p className="mt-2 break-words text-xs text-red-400">{event.message}</p>
              )}
            </li>
          ))}
        </ul>
        <div className="hidden overflow-hidden rounded-lg border border-[#374151]/40 md:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#374151]/40 bg-[#111827] text-left text-slate-400">
                <th className="px-4 py-3 font-medium">Release</th>
                <th className="px-4 py-3 font-medium">Game</th>
                <th className="px-4 py-3 font-medium">Event</th>
                <th className="px-4 py-3 font-medium">Client / indexer</th>
                <th className="px-4 py-3 font-medium">When</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id} className="border-b border-[#374151]/30 last:border-0">
                  <td className="px-4 py-3">
                    <p className="break-all text-white">{event.releaseTitle}</p>
                    {event.message && (
                      <p className="mt-1 break-words text-xs text-red-400">{event.message}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-300">{event.gameTitle}</td>
                  <td className="px-4 py-3">
                    <EventBadge type={event.eventType} />
                  </td>
                  <td className="px-4 py-3 text-slate-300">{event.downloaderName ?? "—"}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-300">
                    {formatDateTime(event.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {pageCount > 1 && (
          <div className="mt-4 flex items-center justify-between">
            <Button
              variant="outline"
              className="h-11 sm:h-9"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </Button>
            <span className="text-sm text-muted-foreground">
              Page {page + 1} of {pageCount}
            </span>
            <Button
              variant="outline"
              className="h-11 sm:h-9"
              disabled={page + 1 >= pageCount}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        )}
      </>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <PageHeader
        title="History"
        description="What happened to your downloads: grabbed, completed, imported, failed, removed and blocklisted."
        actions={
          <Select
            value={eventType}
            onValueChange={(value) => {
              setEventType(value as DownloadEventType | "all");
              setPage(0);
            }}
          >
            <SelectTrigger className="h-11 w-full sm:h-9 sm:w-48" aria-label="Filter by event">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All events</SelectItem>
              {Object.entries(EVENT_LABELS).map(([value, meta]) => (
                <SelectItem key={value} value={value}>
                  {meta.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
      <div className="relative mb-4 max-w-md">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search by release or game"
          aria-label="Search the history"
          className="h-11 pl-9 sm:h-10"
        />
      </div>
      {body}
    </div>
  );
}
