import { Router } from "express";
import { authenticateToken } from "./auth.js";
import { safeFetch } from "./ssrf.js";
import { routesLogger } from "./logger.js";

interface CargoQueryResult {
  cargoquery: Array<{ title: { _pageName: string } }>;
}

const PCGW_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

const pcgwCache = new Map<number, { url: string | null; expires: number }>();

async function lookupPcgwUrl(steamAppId: number): Promise<string | null> {
  const cached = pcgwCache.get(steamAppId);
  if (cached && Date.now() < cached.expires) {
    return cached.url;
  }

  const where = `Infobox_game.Steam_AppID HOLDS "${steamAppId}"`;
  const apiUrl =
    `https://www.pcgamingwiki.com/w/api.php?action=cargoquery` +
    `&tables=Infobox_game&fields=Infobox_game._pageName` +
    `&where=${encodeURIComponent(where)}&format=json`;

  let url: string | null = null;
  try {
    const response = await safeFetch(apiUrl);
    const data = (await response.json()) as CargoQueryResult;
    const pageName = data?.cargoquery?.[0]?.title?._pageName;
    if (pageName) {
      url = `https://www.pcgamingwiki.com/wiki/${encodeURIComponent(pageName).replace(/%20/g, "_")}`;
    }
  } catch (err) {
    routesLogger.warn({ err, steamAppId }, "PCGamingWiki lookup failed");
  }

  pcgwCache.set(steamAppId, { url, expires: Date.now() + PCGW_CACHE_TTL_MS });
  return url;
}

const router = Router();

router.get("/api/external/pcgamingwiki", authenticateToken, async (req, res) => {
  const raw = req.query.steamAppId;
  const steamAppId = Number(raw);

  if (!raw || !Number.isInteger(steamAppId) || steamAppId <= 0) {
    return res.status(400).json({ error: "steamAppId must be a positive integer" });
  }

  const url = await lookupPcgwUrl(steamAppId);
  return res.json({ url });
});

export { pcgwCache, lookupPcgwUrl };
export const pcgamingwikiRouter = router;
