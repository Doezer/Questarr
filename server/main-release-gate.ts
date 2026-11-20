import { isUserCuratedGameStatus } from "../shared/schema.js";
import type { IStorage } from "./storage.js";

/**
 * Whether the base release of a game stands in the way of a patch or extra turning the game
 * "owned": "none" when this is a main release itself, or a main release of the game was
 * delivered; "active" while one is still on its way; "failed" when every main release failed.
 * A game must not be owned with only a patch on disk: a failed base would never be searched for
 * again, since owned games keep their status.
 */
export type MainReleaseGate = "none" | "active" | "failed";

const DELIVERED = new Set(["completed", "imported"]);
const FAILED = new Set(["failed", "error"]);

export async function mainReleaseGate(
  storage: Pick<IStorage, "getDownloadsByGameId">,
  download: { id: string; gameId: string; category?: string | null }
): Promise<MainReleaseGate> {
  if (download.category === "main") return "none";
  const mains = (await storage.getDownloadsByGameId(download.gameId)).filter(
    (d) => d.id !== download.id && d.category === "main"
  );
  if (mains.length === 0 || mains.some((d) => DELIVERED.has(d.status))) return "none";
  return mains.some((d) => !FAILED.has(d.status)) ? "active" : "failed";
}

/**
 * Game status once a download has been delivered: "owned" unless the user already moved the game
 * past that. A patch or extra only gets there once a main release was delivered; while one is on
 * its way the status stays, and when every main release failed the game goes back to "wanted"
 * so the base is searched for again.
 */
export async function applyDeliveredStatus(
  storage: Pick<IStorage, "getDownloadsByGameId" | "updateGameStatus">,
  download: { id: string; gameId: string; category?: string | null },
  game: { status: string | null } | null | undefined
): Promise<void> {
  if (isUserCuratedGameStatus(game?.status)) return;
  const gate = await mainReleaseGate(storage, download);
  if (gate === "active") return;
  if (gate === "failed") {
    if (game?.status === "downloading") {
      await storage.updateGameStatus(
        download.gameId,
        { status: "wanted" },
        { preserveCurated: true }
      );
    }
    return;
  }
  await storage.updateGameStatus(download.gameId, { status: "owned" }, { preserveCurated: true });
}
