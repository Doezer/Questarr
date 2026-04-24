import { Router } from "express";
import { storage } from "../storage.js";
import { importManager, platformMappingService } from "../services/index.js";
import { routesLogger as logger } from "../logger.js";

import z from "zod";
import {
  insertPathMappingSchema,
  insertPlatformMappingSchema,
  importTransferModeSchema,
  IMPORT_TRANSFER_MODES,
} from "../../shared/schema.js";
import path from "path";
import fs from "fs-extra";
import { randomUUID } from "crypto";
import type { Stats } from "fs";

export const importRouter = Router();

importRouter.use((req, res, next) => {
  if (!req.user?.id) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  res.locals.userId = req.user.id;
  next();
});

const importConfigPatchSchema = z
  .object({
    enablePostProcessing: z.boolean().optional(),
    autoUnpack: z.boolean().optional(),
    renamePattern: z.string().min(1).max(200).optional(),
    overwriteExisting: z.boolean().optional(),
    transferMode: importTransferModeSchema.optional(),
    importPlatformIds: z.array(z.number().int().min(1)).optional(),
    ignoredExtensions: z.array(z.string().min(1)).optional(),
    minFileSize: z.number().int().min(0).optional(),
    libraryRoot: z.string().min(1).max(1024).optional(),
  })
  .strict();

const platformMappingPatchSchema = z
  .object({ sourcePlatformName: z.string().min(1).max(100) })
  .strict();

function isPathInside(root: string, candidate: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  return (
    resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(resolvedRoot + path.sep)
  );
}

function resolveProposedPathWithinRoot(libraryRoot: string, rawPath: string): string {
  if (rawPath.startsWith("\\\\") || /^[a-zA-Z]:[\\/]/.test(rawPath)) {
    throw new Error("Invalid proposed path");
  }

  const resolvedRoot = path.resolve(libraryRoot);
  const resolvedTarget = path.isAbsolute(rawPath)
    ? path.resolve(rawPath)
    : path.resolve(resolvedRoot, path.normalize(rawPath).replace(/^[/\\]+/, ""));

  if (!isPathInside(resolvedRoot, resolvedTarget)) {
    throw new Error("Invalid proposed path");
  }

  return resolvedTarget;
}

function parseHostFromUrl(url?: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function translatePathWithMappings(
  remotePath: string,
  mappings: Array<{ remotePath: string; localPath: string; remoteHost?: string | null }>,
  remoteHost?: string | null
): string {
  let bestMatch: { remotePath: string; localPath: string; remoteHost?: string | null } | null =
    null;

  const candidates = mappings.filter((mapping) => {
    if (!mapping.remoteHost) return true;
    return !!remoteHost && mapping.remoteHost === remoteHost;
  });

  for (const mapping of candidates) {
    const prefix = mapping.remotePath.endsWith("/") ? mapping.remotePath : mapping.remotePath + "/";
    if (remotePath === mapping.remotePath || remotePath.startsWith(prefix)) {
      if (!bestMatch || mapping.remotePath.length > bestMatch.remotePath.length) {
        bestMatch = mapping;
      }
    }
  }

  if (!bestMatch) return remotePath;

  const relative = remotePath.substring(bestMatch.remotePath.length).replace(/^[/\\]+/, "");
  return path.join(bestMatch.localPath, relative);
}

async function checkHardlinkPair(
  sourcePath: string,
  targetPath: string
): Promise<{
  sourcePath: string;
  targetPath: string;
  supported: boolean;
  sameDevice: boolean;
  reason?: string;
}> {
  const resolvedSource = path.resolve(sourcePath);
  const resolvedTarget = path.resolve(targetPath);

  let sourceStats: Stats;
  let targetStats: Stats;

  try {
    sourceStats = await fs.stat(resolvedSource);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? "UNKNOWN";
    return {
      sourcePath: resolvedSource,
      targetPath: resolvedTarget,
      supported: false,
      sameDevice: false,
      reason: `Source path is not accessible (${code})`,
    };
  }

  try {
    targetStats = await fs.stat(resolvedTarget);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? "UNKNOWN";
    return {
      sourcePath: resolvedSource,
      targetPath: resolvedTarget,
      supported: false,
      sameDevice: false,
      reason: `Target path is not accessible (${code})`,
    };
  }

  const sourceDir = sourceStats.isDirectory() ? resolvedSource : path.dirname(resolvedSource);
  const targetDir = targetStats.isDirectory() ? resolvedTarget : path.dirname(resolvedTarget);

  const sameDevice = sourceStats.dev === targetStats.dev;
  if (!sameDevice) {
    return {
      sourcePath: sourceDir,
      targetPath: targetDir,
      supported: false,
      sameDevice,
      reason: "Source and target are on different filesystems/devices",
    };
  }

  const probeSource = path.join(targetDir, `.questarr-hardlink-check-src-${randomUUID()}`);
  const probeLink = path.join(targetDir, `.questarr-hardlink-check-link-${randomUUID()}`);

  try {
    await fs.writeFile(probeSource, "questarr-hardlink-check");
    await fs.link(probeSource, probeLink);
    return {
      sourcePath: sourceDir,
      targetPath: targetDir,
      supported: true,
      sameDevice,
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? "UNKNOWN";
    return {
      sourcePath: sourceDir,
      targetPath: targetDir,
      supported: false,
      sameDevice,
      reason: `Hardlink probe failed (${code})`,
    };
  } finally {
    await fs.remove(probeLink).catch(() => undefined);
    await fs.remove(probeSource).catch(() => undefined);
  }
}

// --- Mappings Management ---

// Platform Mappings
importRouter.get("/mappings/platforms", async (req, res) => {
  try {
    const mappings = await storage.getPlatformMappings();
    res.json(mappings);
  } catch (error) {
    logger.error({ error }, "Error fetching platform mappings");
    res.status(500).json({ error: "Failed to fetch platform mappings" });
  }
});

importRouter.post("/mappings/platforms", async (req, res) => {
  try {
    const mapping = insertPlatformMappingSchema.parse(req.body);
    const created = await storage.addPlatformMapping(mapping);
    res.json(created);
  } catch (error) {
    if (error instanceof z.ZodError)
      return res.status(400).json({ error: error.errors.map((e) => e.message).join(", ") });
    res.status(500).json({ error: "Failed to create platform mapping" });
  }
});

importRouter.patch("/mappings/platforms/:id", async (req, res) => {
  try {
    const updates = platformMappingPatchSchema.parse(req.body);
    const updated = await platformMappingService.updateMapping(req.params.id, updates);
    if (updated) res.json(updated);
    else res.status(404).json({ error: "Mapping not found" });
  } catch (error) {
    if (error instanceof z.ZodError)
      return res.status(400).json({ error: error.errors.map((e) => e.message).join(", ") });
    res.status(500).json({ error: "Failed to update platform mapping" });
  }
});

importRouter.delete("/mappings/platforms/:id", async (req, res) => {
  try {
    const success = await storage.removePlatformMapping(req.params.id);
    if (success) res.json({ success: true });
    else res.status(404).json({ error: "Mapping not found" });
  } catch (error) {
    logger.error({ error }, "Error deleting platform mapping");
    res.status(500).json({ error: "Failed to delete platform mapping" });
  }
});

importRouter.post("/mappings/platforms/init", async (req, res) => {
  try {
    await platformMappingService.initializeDefaults();
    const mappings = await storage.getPlatformMappings();
    res.json({ success: true, count: mappings.length, mappings });
  } catch (error) {
    logger.error({ error }, "Error initializing platform mapping defaults");
    res.status(500).json({ error: "Failed to initialize defaults" });
  }
});

// Path Mappings
importRouter.get("/mappings/paths", async (req, res) => {
  try {
    const mappings = await storage.getPathMappings();
    res.json(mappings);
  } catch (error) {
    logger.error({ error }, "Error fetching path mappings");
    res.status(500).json({ error: "Failed to fetch path mappings" });
  }
});

importRouter.post("/mappings/paths", async (req, res) => {
  try {
    const mapping = insertPathMappingSchema.parse(req.body);
    const created = await storage.addPathMapping(mapping);
    res.json(created);
  } catch (error) {
    if (error instanceof z.ZodError)
      return res.status(400).json({ error: error.errors.map((e) => e.message).join(", ") });
    res.status(500).json({ error: "Failed to create path mapping" });
  }
});

importRouter.delete("/mappings/paths/:id", async (req, res) => {
  try {
    const success = await storage.removePathMapping(req.params.id);
    if (success) res.json({ success: true });
    else res.status(404).json({ error: "Mapping not found" });
  } catch (error) {
    logger.error({ error }, "Error deleting path mapping");
    res.status(500).json({ error: "Failed to delete path mapping" });
  }
});

// --- Configuration Management ---

importRouter.get("/config", async (req, res) => {
  try {
    const userId = res.locals.userId as string;
    const config = await storage.getImportConfig(userId);
    res.json(config);
  } catch (error) {
    logger.error({ error }, "Error fetching import config");
    res.status(500).json({ error: "Failed to fetch import config" });
  }
});

importRouter.patch("/config", async (req, res) => {
  try {
    const userId = res.locals.userId as string;

    const updates = importConfigPatchSchema.parse(req.body);
    const current = await storage.getImportConfig(userId);
    const newConfig = { ...current, ...updates };

    const settings = await storage.getUserSettings(userId);
    if (settings) {
      const updated = await storage.updateUserSettings(userId, {
        enablePostProcessing: newConfig.enablePostProcessing,
        autoUnpack: newConfig.autoUnpack,
        renamePattern: newConfig.renamePattern,
        overwriteExisting: newConfig.overwriteExisting,
        transferMode: newConfig.transferMode,
        importPlatformIds: newConfig.importPlatformIds,
        ignoredExtensions: newConfig.ignoredExtensions,
        minFileSize: newConfig.minFileSize,
        libraryRoot: newConfig.libraryRoot,
      });
      if (!updated) return res.status(404).json({ error: "User settings not found" });
      res.json(newConfig);
    } else {
      res.status(404).json({ error: "User settings not found" });
    }
  } catch (error) {
    if (error instanceof z.ZodError)
      return res.status(400).json({ error: error.errors.map((e) => e.message).join(", ") });
    res.status(500).json({ error: "Failed to update import config" });
  }
});

importRouter.get("/hardlink/check", async (req, res) => {
  try {
    const userId = res.locals.userId as string;

    const [config, downloaders, mappings] = await Promise.all([
      storage.getImportConfig(userId),
      storage.getEnabledDownloaders(),
      storage.getPathMappings(),
    ]);

    const sourceRoots = Array.from(
      new Set(
        downloaders
          .map((downloader) => {
            if (!downloader.downloadPath) return null;
            const remoteHost = parseHostFromUrl(downloader.url);
            return translatePathWithMappings(downloader.downloadPath, mappings, remoteHost);
          })
          .filter((value): value is string => !!value)
          .map((value) => path.resolve(value))
      )
    );

    if (sourceRoots.length === 0) {
      return res.json({
        generic: {
          targetRoot: config.libraryRoot,
          supportedForAll: null,
          checkedSources: [],
          reason: "No downloader download paths are configured.",
        },
      });
    }

    const genericChecks = await Promise.all(
      sourceRoots.map((sourcePath) => checkHardlinkPair(sourcePath, config.libraryRoot))
    );

    const summarize = (
      checks: Array<{
        sourcePath: string;
        targetPath: string;
        supported: boolean;
        sameDevice: boolean;
        reason?: string;
      }>
    ) => {
      const unsupported = checks.filter((check) => !check.supported);
      return {
        supportedForAll: unsupported.length === 0,
        checkedSources: checks,
        reason:
          unsupported.length === 0
            ? undefined
            : unsupported.map((check) => `${check.sourcePath}: ${check.reason}`).join("; "),
      };
    };

    res.json({
      generic: {
        targetRoot: config.libraryRoot,
        ...summarize(genericChecks),
      },
    });
  } catch (error) {
    logger.error({ error }, "Error checking hardlink capability");
    res.status(500).json({ error: "Failed to check hardlink capability" });
  }
});

// --- Operations ---
importRouter.get("/pending", async (req, res) => {
  try {
    const userId = res.locals.userId as string;
    const pending = await storage.getPendingImportReviews(userId);

    const results = await Promise.all(
      pending.map(async (d) => {
        const game = await storage.getGame(d.gameId);
        return {
          id: d.id,
          gameTitle: game?.title || d.downloadTitle,
          downloadTitle: d.downloadTitle,
          status: d.status,
          downloaderId: d.downloaderId,
          createdAt: d.addedAt,
        };
      })
    );

    res.json(results);
  } catch (error) {
    logger.error({ error }, "Error fetching pending imports");
    res.status(500).json({ error: "Internal server error" });
  }
});

importRouter.post("/:id/confirm", async (req, res) => {
  const { id } = req.params;
  try {
    const userId = res.locals.userId as string;

    const schema = z.object({
      strategy: z.enum(["pc"] as const),
      proposedPath: z.string(),
      transferMode: z.enum(IMPORT_TRANSFER_MODES).optional(),
      unpack: z.boolean().optional(),
    });

    const body = schema.parse(req.body);
    const config = await storage.getImportConfig(userId);
    const targetRoot = config.libraryRoot;
    const safeProposedPath = resolveProposedPathWithinRoot(targetRoot, body.proposedPath);

    await importManager.confirmImport(
      id,
      {
        strategy: body.strategy,
        originalPath: "",
        proposedPath: safeProposedPath,
        needsReview: false,
        reviewReason: "Manual Confirmation",
        transferMode: body.transferMode,
        unpack: body.unpack,
      },
      userId
    );

    res.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    if (error instanceof Error) {
      if (
        error.message === "Invalid proposed path" ||
        error.message === "Confirmation requires a plan" ||
        error.message === "Could not resolve original path for import"
      ) {
        return res.status(400).json({ error: error.message });
      }
      if (error.message.includes("not found")) {
        return res.status(404).json({ error: error.message });
      }
    }
    logger.error({ error }, "Error confirming import");
    res.status(500).json({ error: "Internal server error" });
  }
});
