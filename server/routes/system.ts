import { Router } from "express";
import fs from "fs-extra";
import path from "path";
import { storage } from "../storage.js";

export const systemRouter = Router();

type AuthedRequest = import("express").Request & { user?: { id: string } };

// GET /api/system/browse?path=/data
systemRouter.get("/browse", async (req, res) => {
  try {
    const rawPath = (req.query.path as string) || "/";
    const userId = (req as AuthedRequest).user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const config = await storage.getImportConfig(userId);
    const root = path.resolve(config.libraryRoot || "/data");

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
      size: f.isDirectory() ? 0 : 0, // Getting size for all files might be slow
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
    console.error("File browser error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
