import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

export interface AchievementProgress {
  gameId: string;
  title: string;
  provider: string;
  unlocked: number;
  total: number;
  rarestName: string | null;
  rarestPercent: number | null;
  lastUnlockedAt: string | null;
}

export interface AchievementSummary {
  games: number;
  completedGames: number;
  unlocked: number;
  total: number;
  completionRate: number;
  rarest: { gameId: string; title: string; name: string | null; percent: number | null } | null;
}

export interface AchievementProgressResponse {
  progress: AchievementProgress[];
  summary: AchievementSummary;
}

export const ACHIEVEMENT_PROGRESS_KEY = ["/api/achievements/progress"];

/** Stored achievement progress for the whole library; one shared request for every card. */
export function useAchievementProgress(enabled = true) {
  return useQuery<AchievementProgressResponse>({
    queryKey: ACHIEVEMENT_PROGRESS_KEY,
    queryFn: async () => (await apiRequest("GET", "/api/achievements/progress")).json(),
    enabled,
    staleTime: 60_000,
    retry: false,
  });
}
