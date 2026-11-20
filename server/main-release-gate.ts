import { categorizeDownload } from "../shared/download-categorizer.js";
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

type GateDownload = {
  id: string;
  gameId: string;
  category?: string | null;
  downloadTitle?: string | null;
};

/** The stored category, or the one the release name says when a client left it out. */
function resolvedCategory(download: Pick<GateDownload, "category" | "downloadTitle">): string {
  return download.category ?? categorizeDownload(download.downloadTitle ?? "").category;
}

export async function mainReleaseGate(
  storage: Pick<IStorage, "getDownloadsByGameId">,
  download: GateDownload
): Promise<MainReleaseGate> {
  if (resolvedCategory(download) === "main") return "none";
  const mains = (await storage.getDownloadsByGameId(download.gameId)).filter(
    (d) => d.id !== download.id && resolvedCategory(d) === "main"
  );
  // A main release still on its way comes first: an older delivered one does not make the
  // game complete while the newer one may yet fail.
  if (mains.some((d) => !DELIVERED.has(d.status) && !FAILED.has(d.status))) return "active";
  if (mains.length === 0 || mains.some((d) => DELIVERED.has(d.status))) return "none";
  return "failed";
}

/**
 * Game status once a download has been delivered: "owned" unless the user already moved the game
 * past that. A patch or extra only gets there once a main release was delivered; while one is on
 * its way the status stays, and when every main release failed the game goes back to "wanted"
 * so the base is searched for again.
 */
export async function applyDeliveredStatus(
  storage: Pick<IStorage, "getDownloadsByGameId" | "updateGameStatus">,
  download: GateDownload,
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
