import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getSocket } from "@/lib/socket";

/** True for the per-game play-session lists (`/api/games/<id>/play-sessions`). */
function isPlaySessionsQuery(queryKey: readonly unknown[]): boolean {
  const first = queryKey[0];
  return (
    typeof first === "string" && first.startsWith("/api/games/") && first.endsWith("/play-sessions")
  );
}

/**
 * Refreshes play-time data when the server adds sessions in the background (scheduled Steam sync,
 * a Playnite push). Mounted app-wide so stats, journals and the Steam sync card never show stale
 * numbers until a reload. Also reconciles on reconnect, since an event can be missed while offline.
 */
export function usePlaySessionsSocket(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    const socket = getSocket();
    const handler = () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/stats/play-time"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/steam/playtime"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/play-sessions/active"] });
      void queryClient.invalidateQueries({
        predicate: (query) => isPlaySessionsQuery(query.queryKey),
      });
    };
    socket.on("playSessionsUpdated", handler);
    return () => {
      socket.off("playSessionsUpdated", handler);
    };
  }, [queryClient]);
}
