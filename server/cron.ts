import { storage } from "./storage.js";
import { igdbClient } from "./igdb.js";
import { igdbLogger } from "./logger.js";
import { notifyUser } from "./socket.js";

const DELAY_THRESHOLD_DAYS = 7;
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
// const CHECK_INTERVAL_MS = 60 * 1000; // 1 minute for testing

export function startCronJobs() {
  igdbLogger.info("Starting cron jobs...");
  
  // Run immediately on startup (or after a slight delay to ensure DB is ready)
  setTimeout(() => {
    checkGameDelays().catch(err => igdbLogger.error({ err }, "Error in checkGameDelays"));
  }, 10000);

  // Schedule periodic checks
  setInterval(() => {
    checkGameDelays().catch(err => igdbLogger.error({ err }, "Error in checkGameDelays"));
  }, CHECK_INTERVAL_MS);
}

async function checkGameDelays() {
  igdbLogger.info("Checking for game delays...");

  const allGames = await storage.getAllGames();
  
  // Filter games that are tracked (have IGDB ID) and are not yet released
  // We check 'upcoming', 'delayed', 'tbd', and even 'wanted' if the status isn't set.
  // We probably don't need to check 'released' games unless we want to detect if they got un-released? Unlikely.
  // But wait, if I marked it as 'released' because the date passed, but IGDB says it's now next year, it IS delayed.
  // So maybe checking all games except those that are physically 'owned' and we don't care about release date anymore?
  // But 'owned' status in this app means "I have it in my collection".
  
  // Let's stick to games that are NOT status='completed' (user finished it) or maybe just check everything that has an IGDB ID.
  // Checking everything is safer for data consistency.
  
  const gamesToCheck = allGames.filter(g => g.igdbId !== null);
  
  if (gamesToCheck.length === 0) {
    igdbLogger.info("No games to check for delays.");
    return;
  }

  const igdbIds = gamesToCheck.map(g => g.igdbId as number);
  
  // Batch fetch from IGDB
  const igdbGames = await igdbClient.getGamesByIds(igdbIds);
  const igdbGameMap = new Map(igdbGames.map(g => [g.id, g]));

  let updatedCount = 0;

  for (const game of gamesToCheck) {
    const igdbGame = igdbGameMap.get(game.igdbId!);
    
    if (!igdbGame || !igdbGame.first_release_date) continue;

    const currentReleaseDate = new Date(igdbGame.first_release_date * 1000);
    const currentReleaseDateStr = currentReleaseDate.toISOString().split("T")[0];

    // Initialize originalReleaseDate if not set
    if (!game.originalReleaseDate) {
      // If we don't have an original date, we assume the current one is the original
      // But only if we have a release date in DB
      if (game.releaseDate) {
         await storage.updateGame(game.id, { originalReleaseDate: game.releaseDate });
         game.originalReleaseDate = game.releaseDate; // Update local object
      } else {
         // If we had no date at all, just set both
         await storage.updateGame(game.id, { 
             releaseDate: currentReleaseDateStr,
             originalReleaseDate: currentReleaseDateStr 
         });
         continue; 
      }
    }

    // Now compare
    const storedOriginalDate = new Date(game.originalReleaseDate!);
    const diffTime = currentReleaseDate.getTime() - storedOriginalDate.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 

    let newReleaseStatus: "released" | "upcoming" | "delayed" | "tbd" = "upcoming";
    const now = new Date();

    if (currentReleaseDate <= now) {
        newReleaseStatus = "released";
    } else if (diffDays > DELAY_THRESHOLD_DAYS) {
        newReleaseStatus = "delayed";
    } else {
        newReleaseStatus = "upcoming";
    }

    // If things changed, update DB
    if (
        game.releaseDate !== currentReleaseDateStr || 
        game.releaseStatus !== newReleaseStatus
    ) {
        igdbLogger.info(
            { 
                game: game.title, 
                oldDate: game.releaseDate, 
                newDate: currentReleaseDateStr,
                oldStatus: game.releaseStatus,
                newStatus: newReleaseStatus,
                diffDays
            }, 
            "Game release updated"
        );

        await storage.updateGame(game.id, {
            releaseDate: currentReleaseDateStr,
            releaseStatus: newReleaseStatus
        });
        updatedCount++;

        // Send notification if game is delayed
        if (newReleaseStatus === "delayed" && game.releaseStatus !== "delayed") {
          const message = `${game.title} has been delayed to ${currentReleaseDateStr}`;
          const notification = await storage.addNotification({
            type: "delayed",
            title: "Game Delayed",
            message,
          });
          notifyUser("notification", notification);
        }
    }
  }

  igdbLogger.info({ updatedCount, checkedCount: gamesToCheck.length }, "Finished checking for game delays.");
}
