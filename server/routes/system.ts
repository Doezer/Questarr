import { Router } from "express";
import fs from "fs-extra";
import path from "node:path";
import { storage } from "../storage.js";
import { routesLogger as logger } from "../logger.js";
import { isSensitivePath } from "../path-security.js";

// Allow browsing the entire container filesystem
// Security is maintained by container isolation and explicit volume mounts
const FILE_BROWSER_ROOT = path.resolve("/");

function isWithinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function toVirtualPath(root: string, absolutePath: string): string {
  const relative = path.relative(root, absolutePath);
  if (!relative || relative === ".") return "/";
  return `/${relative.split(path.sep).join("/")}`;
}

function sortDirents(
  a: { isDirectory: boolean; name: string },
  b: { isDirectory: boolean; name: string }
): number {
  if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
  return a.name.localeCompare(b.name);
}

export const systemRouter = Router();

// GET /api/system/languages
// Returns available UI languages for localization
systemRouter.get("/languages", async (_req, res) => {
  try {
    const localesDir = path.resolve(process.cwd(), "locales");
    if (!(await fs.pathExists(localesDir))) {
      return res.json([
        { code: "en", name: "English" },
      ]);
    }

    const entries = await fs.readdir(localesDir, { withFileTypes: true });
    const languages: { code: string; name: string }[] = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const langCode = entry.name;
        const metaPath = path.join(localesDir, langCode, "meta.json");
        let name = langCode;
        if (await fs.pathExists(metaPath)) {
          try {
            const meta = await fs.readJson(metaPath);
            if (meta?.name) {
              name = meta.name;
            }
          } catch {
            // Ignore parse errors, fallback to folder code
          }
        }
        languages.push({ code: langCode, name });
      } else if (entry.isFile() && entry.name.endsWith(".json")) {
        const langCode = path.basename(entry.name, ".json");
        languages.push({ code: langCode, name: langCode });
      }
    }

    if (languages.length === 0) {
      languages.push({ code: "en", name: "English" });
    }

    languages.sort((a, b) => a.name.localeCompare(b.name));
    return res.json(languages);
  } catch (error) {
    logger.error({ error }, "Error fetching available languages");
    return res.status(500).json({ error: "Internal server error" });
  }
});

systemRouter.use((req, res, next) => {
  if (!req.user?.id) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  res.locals.userId = req.user.id;
  return next();
});

// GET /api/system/browse?path=/data[&root=/]
// Optional `root` param overrides the library root, allowing browsing from an arbitrary base
// (e.g. "/" for path mapping configuration). Defaults to the user's configured library root.
systemRouter.get("/browse", async (req, res) => {
  try {
    const rawPath = (req.query.path as string) || "/";
    const rawRoot = req.query.root as string | undefined;
    const userId = res.locals.userId as string;

    let root: string;
    if (rawRoot === undefined) {
      const config = await storage.getImportConfig(userId);
      root = path.resolve(config.libraryRoot || "/data");
    } else {
      if (rawRoot.startsWith("\\\\") || /^[a-zA-Z]:[\\/]/.test(rawRoot)) {
        return res.status(400).json({ error: "Invalid root: absolute host paths are not allowed" });
      }
      if (rawRoot.split(/[\\/]+/).includes("..")) {
        return res.status(400).json({ error: "Invalid root: traversal detected" });
      }
      // Resolve against FILE_BROWSER_ROOT to constrain browsing
      root = path.resolve(FILE_BROWSER_ROOT, rawRoot === "/" ? "." : rawRoot.replace(/^\/+/, ""));
    }

    if (rawPath.startsWith("\\\\") || /^[a-zA-Z]:[\\/]/.test(rawPath)) {
      return res.status(400).json({ error: "Invalid path: absolute host paths are not allowed" });
    }

    const normalizedPath = path.normalize(rawPath);
    const userPath =
      normalizedPath === path.sep || normalizedPath === "."
        ? ""
        : normalizedPath.replace(/^[/\\]+/, "");
    if (userPath.split(/[\\/]+/).includes("..")) {
      return res.status(400).json({ error: "Invalid path: traversal detected" });
    }

    const validPath = path.resolve(root, userPath);
    if (!isWithinRoot(root, validPath)) {
      return res.status(400).json({ error: "Invalid path: traversal detected" });
    }

    if (isSensitivePath(validPath)) {
      return res.status(403).json({ error: "Access to this path is not allowed" });
    }

    // Ensure the chosen root is within FILE_BROWSER_ROOT for security
    if (!isWithinRoot(FILE_BROWSER_ROOT, root)) {
      return res.status(400).json({ error: "Invalid root: outside file browser scope" });
    }

    // Check if exists
    if (!(await fs.pathExists(validPath))) {
      return res.status(404).json({ error: "Path not found" });
    }

    const stats = await fs.stat(validPath);
    if (!stats.isDirectory()) {
      return res.status(400).json({ error: "Path is not a directory" });
    }

    const files = await fs.readdir(validPath, { withFileTypes: true });

    // Format output using root-relative virtual paths so subsequent requests
    // are consistent across platforms and do not expose host absolute paths.
    const items = files.map((f: import("node:fs").Dirent) => ({
      name: f.name,
      path: toVirtualPath(root, path.join(validPath, f.name)),
      isDirectory: f.isDirectory(),
      size: 0, // Getting size for all files might be slow
    }));

    // Sort: Directories first, then files
    items.sort(sortDirents);

    return res.json({
      path: toVirtualPath(root, validPath),
      parent: validPath === root ? null : toVirtualPath(root, path.dirname(validPath)),
      items,
    });
  } catch (error) {
    logger.error({ error }, "File browser error");
    return res.status(500).json({ error: "Internal server error" });
  }
});