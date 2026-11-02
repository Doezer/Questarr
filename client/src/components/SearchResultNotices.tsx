import { Info } from "lucide-react";

interface SearchFallbackNoticeProps {
  /** The simpler query that produced the results, when the full one returned nothing. */
  queryUsed: string | undefined;
  /** What the user searched for. */
  originalQuery: string;
}

/** Tells which simplified query the results come from. */
export function SearchFallbackNotice({ queryUsed, originalQuery }: SearchFallbackNoticeProps) {
  if (!queryUsed) return null;
  return (
    <div
      className="flex items-start gap-3 rounded-md border border-blue-500/40 bg-blue-500/10 px-4 py-3 text-sm text-blue-300"
      role="status"
      data-testid="notice-search-fallback"
    >
      <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>
        No results for <strong>{originalQuery}</strong>. Showing results for{" "}
        <strong>{queryUsed}</strong> instead.
      </span>
    </div>
  );
}

interface UnsupportedReleasesNoticeProps {
  counts: { torrent: number; usenet: number };
}

/** Warns about releases that no configured downloader can take (their download is disabled). */
export function UnsupportedReleasesNotice({ counts }: UnsupportedReleasesNoticeProps) {
  const parts: string[] = [];
  if (counts.usenet > 0) {
    parts.push(`${counts.usenet} Usenet release(s) need a SABnzbd or NZBGet downloader`);
  }
  if (counts.torrent > 0) {
    parts.push(`${counts.torrent} torrent release(s) need a torrent downloader`);
  }
  if (parts.length === 0) return null;
  return (
    <div
      className="flex items-start gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-300"
      role="status"
      data-testid="notice-unsupported-releases"
    >
      <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>
        {parts.join(" and ")}, and none is configured. Those downloads are disabled: add one under
        Downloaders, or check the protocol of the indexer they come from.
      </span>
    </div>
  );
}

export const UNSUPPORTED_RELEASE_TITLE =
  "No configured downloader can take this release (wrong protocol for your downloaders)";
