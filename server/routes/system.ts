import { Router } from "express";
import fs from "fs-extra";
import path from "path";

export const systemRouter = Router();

// GET /api/system/browse?path=/data
systemRouter.get("/browse", async (req, res) => {
  try {
    const rawPath = (req.query.path as string) || "/";
    const root = process.env.MEDIA_ROOT || "/data";

    // Normalize and remove leading slash to prevent absolute path override
    const userPath = path.normalize(rawPath).replace(/^[/\\]+/, "");
    const validPath = path.join(root, userPath);

    if (!validPath.startsWith(root)) {
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

    // Format output
    const items = files.map((f: import("fs").Dirent) => ({
      name: f.name,
      path: path.join(validPath, f.name),
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
      path: validPath,
      parent: path.dirname(validPath),
      items,
    });
  } catch (error) {
    console.error("File browser error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
