import { Router } from "express";
import { storage } from "../storage.js";
import { importManager, platformMappingService } from "../services/index.js";
import z from "zod";
import { insertPathMappingSchema, insertPlatformMappingSchema } from "../../shared/schema.js";

export const importRouter = Router();

// --- Mappings Management ---

// Platform Mappings
importRouter.get("/mappings/platforms", async (req, res) => {
    try {
        const mappings = await storage.getPlatformMappings();
        res.json(mappings);
    } catch {
        res.status(500).json({ error: "Failed to fetch platform mappings" });
    }
});

importRouter.post("/mappings/platforms", async (req, res) => {
    try {
        const mapping = insertPlatformMappingSchema.parse(req.body);
        const created = await storage.addPlatformMapping(mapping);
        res.json(created);
    } catch (error) {
        if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors });
        res.status(500).json({ error: "Failed to create platform mapping" });
    }
});

importRouter.delete("/mappings/platforms/:id", async (req, res) => {
    try {
        const success = await storage.removePlatformMapping(req.params.id);
        if (success) res.json({ success: true });
        else res.status(404).json({ error: "Mapping not found" });
    } catch {
        res.status(500).json({ error: "Failed to delete platform mapping" });
    }
});

importRouter.post("/mappings/platforms/init", async (req, res) => {
    try {
        await platformMappingService.initializeDefaults();
        const mappings = await storage.getPlatformMappings();
        res.json({ success: true, count: mappings.length, mappings });
    } catch {
         res.status(500).json({ error: "Failed to initialize defaults" });
    }
});

// Path Mappings
importRouter.get("/mappings/paths", async (req, res) => {
    try {
        const mappings = await storage.getPathMappings();
        res.json(mappings);
    } catch {
        res.status(500).json({ error: "Failed to fetch path mappings" });
    }
});

importRouter.post("/mappings/paths", async (req, res) => {
    try {
        const mapping = insertPathMappingSchema.parse(req.body);
        const created = await storage.addPathMapping(mapping);
        res.json(created);
    } catch (error) {
        if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors });
        res.status(500).json({ error: "Failed to create path mapping" });
    }
});

importRouter.delete("/mappings/paths/:id", async (req, res) => {
    try {
        const success = await storage.removePathMapping(req.params.id);
        if (success) res.json({ success: true });
        else res.status(404).json({ error: "Mapping not found" });
    } catch {
        res.status(500).json({ error: "Failed to delete path mapping" });
    }
});


// --- Configuration Management ---

importRouter.get("/config", async (req, res) => {
    try {
        const config = await storage.getImportConfig();
        res.json(config);
    } catch {
        res.status(500).json({ error: "Failed to fetch import config" });
    }
});

importRouter.patch("/config", async (req, res) => {
    try {
        // Validation schema? Using partial of ImportConfig
        // Ideally we use a schema
        const updates = req.body; // TODO: Validate
        const current = await storage.getImportConfig();
        const newConfig = { ...current, ...updates };
        
        // Update user settings
        // `getImportConfig` reads from `user_settings`.
        // We need to update `user_settings`.
        // We assume single user context for now or use session user?
        // `storage.updateUserSettings` requires ID.
        // We need the user ID from the request (authenticated).
        // importRouter should be authenticated? It is mounted under `/api` which is authenticated.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const userId = (req as any).user?.id;
        if (!userId) return res.status(401).json({ error: "Unauthorized" });

        const settings = await storage.getUserSettings(userId);
        if (settings) {
            await storage.updateUserSettings(settings.id, {
                enablePostProcessing: newConfig.enablePostProcessing,
                autoUnpack: newConfig.autoUnpack,
                renamePattern: newConfig.renamePattern,
                overwriteExisting: newConfig.overwriteExisting,
                deleteSource: newConfig.deleteSource,
                ignoredExtensions: newConfig.ignoredExtensions,
                minFileSize: newConfig.minFileSize
            });
            res.json(newConfig);
        } else {
            res.status(404).json({ error: "User settings not found" });
        }
    } catch {
        res.status(500).json({ error: "Failed to update import config" });
    }
});

importRouter.get("/romm", async (req, res) => {
    try {
        const config = await storage.getRomMConfig();
        res.json(config);
    } catch {
         res.status(500).json({ error: "Failed to fetch RomM config" });
    }
});

importRouter.patch("/romm", async (req, res) => {
    try {
        const updates = req.body; 
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const userId = (req as any).user?.id;
        if (!userId) return res.status(401).json({ error: "Unauthorized" });

        const settings = await storage.getUserSettings(userId);
        if (settings) {
             await storage.updateUserSettings(settings.id, {
                 rommEnabled: updates.enabled,
                 rommUrl: updates.url,
                 rommApiKey: updates.apiKey
             });
             // Return formatted config
             res.json({
                 enabled: updates.enabled ?? settings.rommEnabled,
                 url: updates.url ?? settings.rommUrl,
                 apiKey: updates.apiKey ?? settings.rommApiKey
             });
        } else {
            res.status(404).json({ error: "Settings not found" });
        }
    } catch {
        res.status(500).json({ error: "Failed to update RomM config" });
    }
});


// --- Operations ---
// Returns list of downloads that require manual review (status: manual_review_required)
// We might want to compute the plan on the fly if not persisted?
// Implementation decision: Just return the downloads. Frontend can request "plan" or we compute it here.
// Better: Return a simplified object.
importRouter.get("/pending", async (req, res) => {
  try {
    const downloads = await storage.getDownloadingGameDownloads();
    const pending = downloads.filter(d => d.status === "manual_review_required");
    
    // We should probably include the "Plan" or at least the reason.
    // Since we didn't persist the plan in a separate table, we might have to re-generate it?
    // Or we rely on the frontend to suggest the plan?
    // Let's re-generate the plan for the UI to display, so the user sees what WOULD happen.
    
    const results = await Promise.all(pending.map(async (d) => {
      // We need the original remote path to re-plan.
      // Problem: We don't distinctly store `remotePath` on the GameDownload unless it's the `downloadDir` from downloader?
      // `ImportManager` gets it from `cron` which gets it from `DownloaderManager`.
      // We can't easily get it here without querying the downloader again.
      // 
      // Workaround: We can't re-plan easily without the path.
      // BUT, maybe the user verifies the "Path" in the UI.
      // Let's return the Game info and the Download info.
      
      const game = await storage.getGame(d.gameId);
      return {
        id: d.id,
        gameTitle: game?.title || d.downloadTitle,
        downloadTitle: d.downloadTitle,
        status: d.status,
        downloaderId: d.downloaderId,
        createdAt: d.addedAt
      };
    }));

    res.json(results);
  } catch (error) {
    console.error("Error fetching pending imports:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/imports/:id/confirm
// Body: { method: "copy" | "move" | "link", targetPath: string, strategy: "pc" | "romm" }
importRouter.post("/:id/confirm", async (req, res) => {
    const { id } = req.params;
    try {
        const schema = z.object({
            strategy: z.enum(["pc", "romm"]),
            // We need originalPath if we are manually specifying? 
            // Or ImportManager finds it?
            // originalPath is optional, if not provided backend should try to resolve it or just use what it knows.
            originalPath: z.string().optional(),
            proposedPath: z.string(),
            deleteSource: z.boolean().optional(),
        });
        
        const body = schema.parse(req.body);

        await importManager.confirmImport(id, {
            strategy: body.strategy,
            originalPath: body.originalPath,
            proposedPath: body.proposedPath,
            games: [], // Not really needed for manual confirm execute
            needsReview: false,
            reviewReason: "Manual Confirmation",
            deleteSource: body.deleteSource
        });
        
        res.json({ success: true });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: error.errors });
        }
        console.error("Error confirming import:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
