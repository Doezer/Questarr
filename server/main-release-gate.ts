import { categorizeDownload } from "../shared/download-categorizer.js";
import { isUserCuratedGameStatus } from "../shared/schema.js";
import { recordVersionFromCompletedDownload } from "./game-version.js";
import type { IStorage } from "./storage.js";

/**
 * Whether the base release of a game stands in the way of a patch or extra turning the game
 * "owned": "active" while another main release of the game is still on its way; "none" when this is a
 * main release itself or one was delivered; "failed" when every other main release failed.
 * A game must not be owned with only a patch on disk: a failed base would never be searched for
 * again, since owned games keep their status.
 */
export type MainReleaseGate = "none" | "active" | "failed";

const DELIVERED = new Set(["completed", "imported", "seeding"]);
// Only releases still on their way count as active: a main parked for review or quarantined is
// not coming by itself and must not keep another delivered main from owning the game.
const IN_FLIGHT = new Set([
  "downloading",
  "paused",
  "repairing",
  "unpacking",
  "completed_pending_import",
]);

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
  const mains = (await storage.getDownloadsByGameId(download.gameId)).filter(
    (d) => d.id !== download.id && resolvedCategory(d) === "main"
  );
  // Another main release still on its way comes first, whether this download is a patch or a
  // main itself: an older delivered main does not make the game complete while a newer one may
  // yet fail.
  if (mains.some((d) => IN_FLIGHT.has(d.status))) return "active";
  if (resolvedCategory(download) === "main") return "none";
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

/**
 * Game status once a download failed and no other download of the game is in flight: "owned"
 * when a main release of it was delivered meanwhile (the install on disk must not be searched
 * for again), otherwise "wanted". Statuses the user chose and "owned" are left alone.
 */
export async function applyFailureStatus(
  storage: Pick<IStorage, "getDownloadsByGameId" | "updateGameStatus">,
  download: GateDownload,
  game: { status: string | null } | null | undefined
): Promise<void> {
  if (isUserCuratedGameStatus(game?.status)) return;
  const deliveredMain = (await storage.getDownloadsByGameId(download.gameId)).some(
    (d) => d.id !== download.id && DELIVERED.has(d.status) && resolvedCategory(d) === "main"
  );
  await storage.updateGameStatus(
    download.gameId,
    { status: deliveredMain ? "owned" : "wanted" },
    { preserveCurated: true }
  );
}

/** Whether another main release of the download's game is still on its way. */
export async function hasMainReleaseInFlight(
  storage: Pick<IStorage, "getDownloadsByGameId">,
  download: GateDownload
): Promise<boolean> {
  return (await storage.getDownloadsByGameId(download.gameId)).some(
    (d) => d.id !== download.id && resolvedCategory(d) === "main" && IN_FLIGHT.has(d.status)
  );
}

/**
 * Records the version a delivered download carries. A patch does not move the installed version
 * until a main release of the game was delivered: its base may still fail, and the version
 * would then describe files that are not there. A main release records its own version and
 * then the versions of the patches that were delivered before it (the version only ever moves
 * forward). Returns false when the patch had to wait.
 */
export async function recordDeliveredVersion(
  storage: Pick<IStorage, "getGame" | "replaceGameInstalledVersion" | "getDownloadsByGameId">,
  download: GateDownload & { downloadTitle: string }
): Promise<boolean> {
  if (resolvedCategory(download) !== "main") {
    if ((await mainReleaseGate(storage, download)) !== "none") return false;
    await recordVersionFromCompletedDownload(
      storage,
      download.gameId,
      download.downloadTitle,
      download.category ?? null
    );
    return true;
  }
  await recordVersionFromCompletedDownload(
    storage,
    download.gameId,
    download.downloadTitle,
    download.category ?? null
  );
  const waiting = (await storage.getDownloadsByGameId(download.gameId)).filter(
    (d) => d.id !== download.id && DELIVERED.has(d.status) && resolvedCategory(d) !== "main"
  );
  for (const patch of waiting) {
    await recordVersionFromCompletedDownload(
      storage,
      download.gameId,
      patch.downloadTitle,
      patch.category ?? null
    );
  }
  return true;
}
