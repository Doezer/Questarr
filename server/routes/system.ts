import { Router } from "express";
import fs from "fs-extra";
import path from "node:path";
import { storage } from "../storage.js";
import { routesLogger as logger } from "../logger.js";

// Allow browsing the entire container filesystem
// Security is maintained by container isolation and explicit volume mounts
const FILE_BROWSER_ROOT = path.resolve("/");

export const systemRouter = Router();

systemRouter.use((req, res, next) => {
  if (!req.user?.id) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  res.locals.userId = req.user.id;
  next();
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
    if (validPath !== root && !validPath.startsWith(root + path.sep)) {
      return res.status(400).json({ error: "Invalid path: traversal detected" });
    }

    // Ensure the chosen root is within FILE_BROWSER_ROOT for security
    const fileBrowserPrefix = FILE_BROWSER_ROOT.endsWith(path.sep)
      ? FILE_BROWSER_ROOT
      : FILE_BROWSER_ROOT + path.sep;
    if (root !== FILE_BROWSER_ROOT && !root.startsWith(fileBrowserPrefix)) {
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

    const toVirtualPath = (absolutePath: string) => {
      const relative = path.relative(root, absolutePath);
      if (!relative || relative === ".") return "/";
      return `/${relative.split(path.sep).join("/")}`;
    };

    // Format output using root-relative virtual paths so subsequent requests
    // are consistent across platforms and do not expose host absolute paths.
    const items = files.map((f: import("fs").Dirent) => ({
      name: f.name,
      path: toVirtualPath(path.join(validPath, f.name)),
      isDirectory: f.isDirectory(),
      size: 0, // Getting size for all files might be slow
    }));

    // Sort: Directories first, then files
    items.sort(
      (a: { isDirectory: boolean; name: string }, b: { isDirectory: boolean; name: string }) => {
        if (a.isDirectory === b.isDirectory) {
          return a.name.localeCompare(b.name);
        }
        return a.isDirectory ? -1 : 1;
      }
    );

    res.json({
      path: toVirtualPath(validPath),
      parent: validPath === root ? null : toVirtualPath(path.dirname(validPath)),
      items,
    });
  } catch (error) {
    logger.error({ error }, "File browser error");
    res.status(500).json({ error: "Internal server error" });
  }
});
