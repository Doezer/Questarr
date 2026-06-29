import { Router } from "express";
import { storage } from "../storage.js";
import type { User } from "../../shared/schema.js";

export const importTasksRouter = Router();

importTasksRouter.get("/", async (req, res) => {
  const user = req.user as User;
  const limit = Math.min(Math.max(1, parseInt(String(req.query.limit ?? "50"), 10) || 50), 100);
  const offset = Math.max(0, parseInt(String(req.query.offset ?? "0"), 10) || 0);
  const tasks = await storage.getImportTasks(user.id, limit, offset);
  res.json(tasks);
});

importTasksRouter.get("/:id", async (req, res) => {
  const user = req.user as User;
  const task = await storage.getImportTask(req.params.id);
  if (!task || task.userId !== user.id) {
    return res.status(404).json({ error: "Task not found" });
  }
  const items = await storage.getImportTaskItems(task.id);
  res.json({ ...task, items });
});
