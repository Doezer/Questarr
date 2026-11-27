import { Router } from "express";
import { z } from "zod";
import { storage } from "../storage.js";
import { readRommSettings } from "../romm.js";
import {
  applyPlatformFolderRenames,
  scanPlatformFolderRenames,
  type PlatformFolderRename,
} from "../library-migration.js";
import { routesLogger } from "../logger.js";
import { sensitiveEndpointLimiter } from "../middleware.js";
import { createDatabaseBackup } from "../database-backup.js";
import { dialect } from "../db.js";

export const libraryMigrationRouter = Router();

const renameSchema = z
  .object({
    oldName: z.string().trim().min(1).max(200),
    newName: z.string().trim().min(1).max(200),
    merge: z.boolean(),
  })
  .strict();

const applySchema = z.object({ renames: z.array(renameSchema).max(100) }).strict();

libraryMigrationRouter.use((req, res, next) => {
  if (!req.user?.id) return res.status(401).json({ error: "Unauthorized" });
  res.locals.userId = req.user.id;
  return next();
});

libraryMigrationRouter.get("/scan", async (_req, res) => {
  try {
    const settings = await readRommSettings();
    const config = await storage.getImportConfig(res.locals.userId as string);
    const libraryRoot = config.libraryRoot;
    if (!settings.platformFolders) {
      return res.json({
        enabled: false,
        libraryRoot,
        renames: [],
        backupSupported: dialect === "sqlite",
      });
    }
    const renames = await scanPlatformFolderRenames(libraryRoot);
    return res.json({
      enabled: true,
      libraryRoot,
      renames,
      backupSupported: dialect === "sqlite",
    });
  } catch (error) {
    routesLogger.error({ error }, "Failed to scan library platform folders");
    return res.status(500).json({ error: "Failed to scan library platform folders" });
  }
});

libraryMigrationRouter.post("/apply", sensitiveEndpointLimiter, async (req, res) => {
  try {
    const { renames } = applySchema.parse(req.body ?? {});
    const settings = await readRommSettings();
    if (!settings.platformFolders) {
      return res.status(400).json({ error: "Enable RomM platform folders before migrating" });
    }

    if (renames.length > 0 && dialect === "sqlite") {
      const backupPath = await createDatabaseBackup("sqlite-pre-migration");
      routesLogger.info({ backupPath }, "Database backed up before library migration");
    } else if (renames.length > 0) {
      routesLogger.warn(
        { dialect },
        "Skipping automatic database backup before library migration; create a database backup first"
      );
    }

    const config = await storage.getImportConfig(res.locals.userId as string);
    // The library root is shared by users, so every tracked path under a renamed
    // platform folder must be updated, not only the requesting user's games.
    const games = await storage.getAllGames();
    const results = await applyPlatformFolderRenames(
      config.libraryRoot,
      renames as PlatformFolderRename[],
      storage,
      games
    );
    return res.json({ results });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.issues.map((issue) => issue.message).join(", ") });
    }
    routesLogger.error({ error }, "Failed to apply library platform migration");
    return res.status(500).json({ error: "Failed to apply library platform migration" });
  }
});
