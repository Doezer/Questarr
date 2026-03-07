import { type Game } from "@shared/schema";
import { mapGameToInsertGame } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";

interface HiddenMutationResponse {
  hidden: boolean;
}

export async function hideDiscoveryGame(
  game: Game,
  localId?: string
): Promise<HiddenMutationResponse> {
  if (localId) {
    await apiRequest("PATCH", `/api/games/${localId}/hidden`, {
      hidden: true,
    });
    return { hidden: true };
  }

  const gameData = mapGameToInsertGame(game);
  await apiRequest("POST", "/api/games", {
    ...gameData,
    status: "wanted",
    hidden: true,
  });
  return { hidden: true };
}
