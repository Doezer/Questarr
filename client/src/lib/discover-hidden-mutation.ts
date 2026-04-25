import { type Game } from "@shared/schema";
import { mapGameToInsertGame } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";

interface HiddenMutationResponse {
  hidden: boolean;
}

interface ApiErrorLike {
  status?: number;
  data?: unknown;
}

// Helper function to extract existing game ID from a 409 Conflict error response (game already exists)
const getExistingGameIdFromError = (error: unknown): string | undefined => {
  const apiError = error as ApiErrorLike;
  if (apiError?.status !== 409) return undefined;

  const data = apiError.data as { game?: { id?: unknown } } | undefined;
  return typeof data?.game?.id === "string" ? data.game.id : undefined;
};

export async function hideDiscoveryGame(
  game: Game,
  localId?: string
): Promise<HiddenMutationResponse> {
  // If localId is provided (game exists), we PATCH to update hidden status
  if (localId) {
    await apiRequest("PATCH", `/api/games/${localId}/hidden`, {
      hidden: true,
    });
    return { hidden: true };
  }

  // If no localId, we attempt to POST a new hidden game.
  // If it already exists and the local cache wasn't updated, we PATCH it.
  const gameData = mapGameToInsertGame(game);
  try {
    await apiRequest("POST", "/api/games", {
      ...gameData,
      status: "wanted",
      hidden: true,
    });
  } catch (error) {
    const existingGameId = getExistingGameIdFromError(error);
    if (!existingGameId) throw error;

    await apiRequest("PATCH", `/api/games/${existingGameId}/hidden`, {
      hidden: true,
    });
  }

  return { hidden: true };
}
