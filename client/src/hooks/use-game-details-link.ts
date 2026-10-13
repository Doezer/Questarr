import { useCallback } from "react";
import { useLocation } from "wouter";
import { withBasePath } from "@/lib/app-path";
import type { Game } from "@shared/schema";
import { gameDetailsPath } from "@/lib/routes";

type ClickLike = { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean };

/**
 * Link behaviour for a game card. `path` is for wouter's <Link> (a real anchor: right-click and
 * middle-click work); `href` includes the app base path; `openDetails` is the click handler for the rest of the card surface,
 * which also opens a new tab on ctrl/cmd/shift-click.
 */
export function useGameDetailsLink(game: Game) {
  const gameId = game.id;
  const [, navigate] = useLocation();
  const path = gameDetailsPath(gameId);
  const href = withBasePath(path);

  const openInNewTab = useCallback(() => {
    window.open(href, "_blank", "noopener,noreferrer");
  }, [href]);

  const openDetails = useCallback(
    (event?: ClickLike) => {
      if (event && (event.metaKey || event.ctrlKey || event.shiftKey)) {
        openInNewTab();
        return;
      }
      // The card already holds the game: hand it over so the page paints without a round trip.
      navigate(path, { state: { game } });
    },
    [game, navigate, openInNewTab, path]
  );

  /** Middle-click on the card surface; anchors keep the browser's own behaviour. */
  const onAuxClick = useCallback(
    (event: React.MouseEvent) => {
      if (event.button !== 1 || (event.target as HTMLElement).closest("a")) return;
      event.preventDefault();
      openInNewTab();
    },
    [openInNewTab]
  );

  return { path, href, openDetails, onAuxClick };
}
