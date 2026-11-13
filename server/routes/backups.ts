import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import { z } from "zod";
import {
  createBackup,
  deleteBackup,
  getBackupSettings,
  getBackupState,
  getKeySources,
  listBackups,
  resolveBackupPath,
  saveBackupSettings,
} from "../backup/backup-service.js";
import { getBackupDir } from "../backup/paths.js";
import { RestoreError, stageRestore } from "../backup/restore.js";
import { dialect } from "../db.js";
import { routesLogger as logger } from "../logger.js";
import { sensitiveEndpointLimiter } from "../middleware.js";
import { notifyUser } from "../socket.js";

export const backupsRouter = Router();

const MAX_UPLOAD_BYTES =
  (Number(process.env.BACKUP_UPLOAD_MAX_MB) > 0 ? Number(process.env.BACKUP_UPLOAD_MAX_MB) : 1024) *
  1024 *
  1024;

const UPLOAD_NAME_RE = /^upload-\d+-\d+\.zip$/;

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      const dir = path.join(getBackupDir(), ".uploads");
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      cb(null, dir);
    },
    // Never the client's file name.
    filename: (_req, _file, cb) => cb(null, `upload-${Date.now()}-${process.pid}.zip`),
  }),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    cb(null, file.originalname.toLowerCase().endsWith(".zip"));
  },
});

const settingsSchema = z.object({
  intervalDays: z.number().int().min(0).max(365),
  retentionDays: z.number().int().min(1).max(3650),
  includeScreenshots: z.boolean(),
});

/** The process exits after a restore only where something will bring it back. */
function willRestartAutomatically(): boolean {
  const override = process.env.QUESTARR_RESTORE_RESTART?.trim().toLowerCase();
  if (override === "true") return true;
  if (override === "false") return false;
  return fs.existsSync("/.dockerenv");
}

function scheduleRestart(): boolean {
  if (!willRestartAutomatically()) return false;
  // Leave time for the response to reach the browser.
  setTimeout(() => {
    logger.info("Exiting to apply the staged restore");
    process.exit(0);
  }, 1500).unref();
  return true;
}

function describeRestoreFailure(res: import("express").Response, err: unknown) {
  if (err instanceof RestoreError) return res.status(400).json({ error: err.message });
  logger.error({ err }, "Restore failed");
  return res.status(500).json({ error: "Restore failed" });
}

backupsRouter.use((req, res, next) => {
  if (!req.user?.id) return res.status(401).json({ error: "Unauthorized" });
  // The archive holds the encryption key and every secret: never cache a response.
  res.setHeader("Cache-Control", "no-store");
  return next();
});

// GET /api/system/backups
backupsRouter.get("/", async (_req, res) => {
  try {
    res.json({
      backups: await listBackups(),
      settings: await getBackupSettings(),
      state: getBackupState(),
      environment: {
        dialect,
        ...getKeySources(),
        restartsAutomatically: willRestartAutomatically(),
      },
    });
  } catch (err) {
    logger.error({ err }, "Failed to list backups");
    res.status(500).json({ error: "Failed to list backups" });
  }
});

// PUT /api/system/backups/settings
backupsRouter.put("/settings", sensitiveEndpointLimiter, async (req, res) => {
  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid backup settings" });
  try {
    await saveBackupSettings(parsed.data);
    return res.json({ settings: parsed.data });
  } catch (err) {
    logger.error({ err }, "Failed to save backup settings");
    return res.status(500).json({ error: "Failed to save backup settings" });
  }
});

// POST /api/system/backups - start a manual backup; returns at once, the list shows the result
backupsRouter.post("/", sensitiveEndpointLimiter, (_req, res) => {
  if (getBackupState().running) {
    return res.status(409).json({ error: "A backup is already running" });
  }
  void createBackup("manual")
    .then((created) => notifyUser("backup:finished", { name: created.name, ok: true }))
    .catch((err) => {
      logger.error({ err }, "Manual backup failed");
      notifyUser("backup:finished", { ok: false });
    });
  return res.status(202).json({ state: { ...getBackupState(), running: true } });
});

// POST /api/system/backups/restore - restore from an uploaded archive
backupsRouter.post("/restore", sensitiveEndpointLimiter, (req, res) => {
  upload.single("file")(req, res, async (uploadErr) => {
    if (uploadErr) {
      const tooBig = (uploadErr as { code?: string }).code === "LIMIT_FILE_SIZE";
      return res
        .status(tooBig ? 413 : 400)
        .json({ error: tooBig ? "The backup file is too large" : "Upload failed" });
    }
    const uploaded = req.file;
    if (!uploaded) return res.status(400).json({ error: "Upload a .zip backup file" });
    // Rebuild the path from the server-chosen name instead of trusting the request object.
    if (!UPLOAD_NAME_RE.test(uploaded.filename)) {
      return res.status(400).json({ error: "Upload failed" });
    }
    const file = { path: path.join(getBackupDir(), ".uploads", uploaded.filename) };
    try {
      const manifest = await stageRestore(file.path, "upload");
      return res.status(202).json({
        staged: true,
        appVersion: manifest.appVersion,
        restarting: scheduleRestart(),
      });
    } catch (err) {
      return describeRestoreFailure(res, err);
    } finally {
      await fs.promises.rm(file.path, { force: true }).catch(() => {});
    }
  });
});

// POST /api/system/backups/:name/restore - restore from a backup kept on the server
backupsRouter.post("/:name/restore", sensitiveEndpointLimiter, async (req, res) => {
  const file = resolveBackupPath(String(req.params.name ?? ""));
  if (!file || !fs.existsSync(file)) return res.status(404).json({ error: "Backup not found" });
  if (req.body?.confirm !== true) {
    return res.status(400).json({ error: "Confirmation required" });
  }
  try {
    const manifest = await stageRestore(file, path.basename(file));
    return res
      .status(202)
      .json({ staged: true, appVersion: manifest.appVersion, restarting: scheduleRestart() });
  } catch (err) {
    return describeRestoreFailure(res, err);
  }
});

// GET /api/system/backups/:name/download
backupsRouter.get("/:name/download", sensitiveEndpointLimiter, (req, res) => {
  const file = resolveBackupPath(String(req.params.name ?? ""));
  if (!file || !fs.existsSync(file)) return res.status(404).json({ error: "Backup not found" });
  return res.download(file, path.basename(file));
});

// DELETE /api/system/backups/:name
backupsRouter.delete("/:name", sensitiveEndpointLimiter, async (req, res) => {
  try {
    const removed = await deleteBackup(String(req.params.name ?? ""));
    return removed ? res.status(204).end() : res.status(404).json({ error: "Backup not found" });
  } catch (err) {
    logger.error({ err }, "Failed to delete backup");
    return res.status(500).json({ error: "Failed to delete backup" });
  }
});
