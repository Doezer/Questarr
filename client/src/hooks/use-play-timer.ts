import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, ApiError } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { GamePlaySession } from "@shared/schema";

const ACTIVE_KEY = "/api/play-sessions/active";

interface ActiveResponse {
  session: GamePlaySession | null;
}

/**
 * The user's play timer: which game (if any) is being timed, plus start and stop. A user has at
 * most one running timer, so every card and the game page share this one query.
 */
export function usePlayTimer() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data } = useQuery<ActiveResponse>({ queryKey: [ACTIVE_KEY] });
  const active = data?.session ?? null;

  const refresh = (gameId: string) => {
    void queryClient.invalidateQueries({ queryKey: [ACTIVE_KEY] });
    void queryClient.invalidateQueries({ queryKey: [`/api/games/${gameId}/play-sessions`] });
    void queryClient.invalidateQueries({ queryKey: ["/api/stats/play-time"] });
  };

  const start = useMutation({
    mutationFn: async (gameId: string) => {
      const res = await apiRequest("POST", `/api/games/${gameId}/play-sessions/start`);
      return (await res.json()) as GamePlaySession;
    },
    onSuccess: (_session, gameId) => refresh(gameId),
    onError: (error) => {
      toast({
        description:
          error instanceof ApiError && error.status === 409
            ? "Another game's timer is already running. Stop it first."
            : "Failed to start the timer",
        variant: "destructive",
      });
      void queryClient.invalidateQueries({ queryKey: [ACTIVE_KEY] });
    },
  });

  const stop = useMutation({
    mutationFn: async (session: GamePlaySession) => {
      const res = await apiRequest("POST", `/api/play-sessions/${session.id}/stop`);
      return (await res.json()) as { session: GamePlaySession; capped: boolean };
    },
    onSuccess: (result, session) => {
      refresh(session.gameId);
      if (result.capped) {
        toast({
          description: "The timer was left running, so the session was cut off at 24 hours.",
        });
      }
    },
    onError: () => {
      toast({ description: "Failed to stop the timer", variant: "destructive" });
      void queryClient.invalidateQueries({ queryKey: [ACTIVE_KEY] });
    },
  });

  return { active, start, stop };
}
