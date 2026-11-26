import { lazy, Suspense, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import type { Downloader, Game, RssFeedItem } from "@shared/schema";
import { Button } from "@/components/ui/button";

const AddDdlLinksDialog = lazy(() => import("./AddDdlLinksDialog"));

/**
 * Hands the hoster links found in a direct-download feed item to Real-Debrid, for the game the
 * item was matched to. That game must be in the library and Real-Debrid must be set up.
 */
export default function RssItemLinks({ item }: { item: RssFeedItem }) {
  const [open, setOpen] = useState(false);
  const links = item.links ?? [];

  const { data: games = [] } = useQuery<Game[]>({
    queryKey: ["/api/games"],
    enabled: links.length > 0,
  });
  const { data: downloaders = [] } = useQuery<Downloader[]>({
    queryKey: ["/api/downloaders/enabled"],
    enabled: links.length > 0,
  });

  if (links.length === 0) return null;

  const game = item.igdbGameId ? games.find((g) => g.igdbId === item.igdbGameId) : undefined;
  const hasRealDebrid = downloaders.some((d) => d.type === "realdebrid");
  const reason = !hasRealDebrid
    ? "Add a Real-Debrid downloader first"
    : !game
      ? "Add the matched game to your library first"
      : undefined;

  const reasonId = `rss-links-reason-${item.id}`;

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="h-8 gap-2 aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
        // aria-disabled (not disabled) keeps the button focusable so its reason can be read.
        aria-disabled={reason !== undefined}
        aria-describedby={reason ? reasonId : undefined}
        title={reason}
        onClick={() => {
          if (!reason) setOpen(true);
        }}
        aria-label={`Send ${links.length} download links for ${item.title} to Real-Debrid`}
        data-testid={`button-rss-links-${item.id}`}
      >
        <Download className="h-4 w-4" aria-hidden="true" />
        {links.length} link{links.length === 1 ? "" : "s"}
      </Button>
      {reason && (
        <span id={reasonId} className="sr-only">
          {reason}
        </span>
      )}
      {open && game && (
        <Suspense fallback={null}>
          <AddDdlLinksDialog game={game} open={open} onOpenChange={setOpen} initialLinks={links} />
        </Suspense>
      )}
    </>
  );
}
