import { Router } from "express";
import { z } from "zod";
import { authenticateToken } from "./auth.js";
import { sensitiveEndpointLimiter } from "./middleware.js";
import { storage } from "./storage.js";
import { excludeFilteredContent, getContentFilterFlags } from "./content-filter.js";
import {
  getSteamAchievementsStatus,
  setSteamAchievementsEnabled,
  syncSteamAchievements,
  SteamAchievementsBusyError,
  SteamAchievementsUnavailableError,
} from "./steam-achievements.js";
import type { User } from "../shared/schema.js";

export const steamAchievementsRoutes = Router();

const bodySchema = z.object({ enabled: z.boolean() }).strict();

steamAchievementsRoutes.get("/api/steam/achievements", authenticateToken, async (req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    return res.json(await getSteamAchievementsStatus((req.user as User).id));
  } catch {
    return res.status(500).json({ error: "Could not load the Steam achievements status." });
  }
});

steamAchievementsRoutes.put(
  "/api/steam/achievements",
  authenticateToken,
  sensitiveEndpointLimiter,
  async (req, res) => {
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Expected { enabled: boolean }." });
    try {
      const userId = (req.user as User).id;
      await setSteamAchievementsEnabled(userId, parsed.data.enabled);
      return res.json(await getSteamAchievementsStatus(userId));
    } catch {
      return res.status(500).json({ error: "Could not save the Steam achievements setting." });
    }
  }
);

steamAchievementsRoutes.post(
  "/api/steam/achievements/sync",
  authenticateToken,
  sensitiveEndpointLimiter,
  async (req, res) => {
    const userId = (req.user as User).id;
    try {
      const status = await getSteamAchievementsStatus(userId);
      if (!status.enabled) {
        return res.status(400).json({ error: "Turn on the Steam achievements sync first." });
      }
      const result = await syncSteamAchievements(userId, { force: true });
      return res.json({ result, status: await getSteamAchievementsStatus(userId) });
    } catch (error) {
      if (error instanceof SteamAchievementsUnavailableError) {
        return res
          .status(400)
          .json({ error: "Add a Steam Web API key in Settings and save your Steam ID first." });
      }
      if (error instanceof SteamAchievementsBusyError) {
        return res.status(409).json({ error: "A Steam achievements sync is already running." });
      }
      return res.status(500).json({ error: "Could not sync your Steam achievements." });
    }
  }
);

/** Stored progress for every game of the user, plus library-wide totals for the Stats page. */
steamAchievementsRoutes.get("/api/achievements/progress", authenticateToken, async (req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    const userId = (req.user as User).id;
    const [rows, allGames, flags] = await Promise.all([
      storage.getUserAchievementProgress(userId),
      storage.getUserGames(userId, true),
      getContentFilterFlags(userId),
    ]);
    const games = excludeFilteredContent(allGames, flags);
    const titles = new Map(games.map((g) => [g.id, g.title]));
    const progress = rows
      .filter((r) => titles.has(r.gameId))
      .map((r) => ({
        gameId: r.gameId,
        title: titles.get(r.gameId)!,
        provider: r.provider,
        unlocked: r.unlocked,
        total: r.total,
        rarestName: r.rarestName,
        rarestPercent: r.rarestPercent,
        lastUnlockedAt: r.lastUnlockedAt ? r.lastUnlockedAt.toISOString() : null,
      }));
    const unlocked = progress.reduce((sum, p) => sum + p.unlocked, 0);
    const total = progress.reduce((sum, p) => sum + p.total, 0);
    let rarest: (typeof progress)[number] | null = null;
    for (const p of progress) {
      if (p.rarestPercent === null) continue;
      if (!rarest || p.rarestPercent < (rarest.rarestPercent ?? Infinity)) rarest = p;
    }
    return res.json({
      progress,
      summary: {
        games: progress.length,
        completedGames: progress.filter((p) => p.total > 0 && p.unlocked === p.total).length,
        unlocked,
        total,
        completionRate: total > 0 ? Math.round((unlocked / total) * 1000) / 10 : 0,
        rarest: rarest && {
          gameId: rarest.gameId,
          title: rarest.title,
          name: rarest.rarestName,
          percent: rarest.rarestPercent,
        },
      },
    });
  } catch {
    return res.status(500).json({ error: "Could not load the achievement progress." });
  }
});
