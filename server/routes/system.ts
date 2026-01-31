import { Router } from "express";
import fs from "fs-extra";
import path from "path";

export const systemRouter = Router();

// GET /api/system/browse?path=/data
systemRouter.get("/browse", async (req, res) => {
  try {
    const rawPath = req.query.path as string || "/";
    // Sanitize? We generally trust admin user but good to prevent escaping root of container if intended.
    // Docker container root access is usually implied for this feature.
    const validPath = path.resolve(rawPath);
    
    // Check if exists
    if (!await fs.pathExists(validPath)) {
        return res.status(404).json({ error: "Path not found" });
    }

    const stats = await fs.stat(validPath);
    if (!stats.isDirectory()) {
        return res.status(400).json({ error: "Path is not a directory" });
    }

    const files = await fs.readdir(validPath, { withFileTypes: true });
    
    // Format output
    const items = files.map(f => ({
        name: f.name,
        path: path.join(validPath, f.name),
        isDirectory: f.isDirectory(),
        size: f.isDirectory() ? 0 : 0, // Getting size for all files might be slow
    }));

    // Sort: Directories first, then files
    items.sort((a, b) => {
        if (a.isDirectory === b.isDirectory) {
            return a.name.localeCompare(b.name);
        }
        return a.isDirectory ? -1 : 1;
    });

    res.json({
        path: validPath,
        parent: path.dirname(validPath),
        items
    });

  } catch (error) {
    console.error("File browser error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
