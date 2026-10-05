import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getSocket } from "@/lib/socket";

/**
 * Refreshes the games query when the server changes a game in the background (e.g. a finished
 * download recording a newer installed version). Mounted app-wide: the games query never goes
 * stale on its own, so an event missed while no details modal is open would otherwise leave the
 * library showing old data until a reload.
 */
export function useGameUpdatedSocket(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    const socket = getSocket();
    const handler = () => {
      queryClient.invalidateQueries({ queryKey: ["/api/games"] });
    };
    socket.on("gameUpdated", handler);
    return () => {
      socket.off("gameUpdated", handler);
    };
  }, [queryClient]);
}
