import { Router, type Response } from "express";
import { z } from "zod";
import { storage } from "../storage.js";
import { routesLogger as logger } from "../logger.js";
import { sensitiveEndpointLimiter } from "../middleware.js";
import { RealDebridClient } from "../downloaders/realdebrid.js";
import { DDL_MAX_LINKS, extractHosterLinks } from "../../shared/ddl-links.js";
import type { Downloader } from "../../shared/schema.js";

// Mounted at /api/games/:gameId/ddl. Direct-download links the user supplies themselves: Questarr
// ships no source of links, it only hands them to a debrid service and imports the result.
export const ddlRouter = Router({ mergeParams: true });

const MAX_CONTAINER_BYTES = 1024 * 1024;

const linksBodySchema = z.object({
  // Free text: one link per line, or a whole forum post.
  links: z.string().max(500_000).default(""),
  // A DLC/CCF/RSDF container file, base64 encoded.
  containerBase64: z.string().max(2_000_000).optional(),
  downloaderId: z.string().min(1).optional(),
  title: z.string().trim().min(1).max(300).optional(),
  archivePassword: z.string().max(200).optional(),
});

async function resolveGame(req: { params: unknown; user?: { id: string } }, res: Response) {
  const { gameId } = req.params as { gameId: string };
  const game = await storage.getGame(gameId);
  if (!game) {
    res.status(404).json({ error: "Game not found" });
    return null;
  }
  if (game.userId !== req.user?.id) {
    res.status(403).json({ error: "Forbidden" });
    return null;
  }
  return game;
}

async function pickDownloader(id: string | undefined): Promise<Downloader | undefined> {
  if (id) {
    const downloader = await storage.getDownloader(id);
    return downloader?.type === "realdebrid" ? downloader : undefined;
  }
  const enabled = await storage.getEnabledDownloaders();
  return enabled.find((d) => d.type === "realdebrid");
}

function decodeContainer(base64: string | undefined): Buffer | undefined {
  if (!base64) return undefined;
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length === 0 || bytes.length > MAX_CONTAINER_BYTES) {
    throw new Error("The link container file is empty or larger than 1 MB");
  }
  return bytes;
}

/** Shared by both endpoints: the parsed body, the downloader and the final list of links. */
async function prepare(req: { body: unknown }, res: Response) {
  const parsed = linksBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return null;
  }
  const downloader = await pickDownloader(parsed.data.downloaderId);
  if (!downloader) {
    res.status(400).json({ error: "No enabled Real-Debrid downloader is configured" });
    return null;
  }
  let container: Buffer | undefined;
  try {
    container = decodeContainer(parsed.data.containerBase64);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Invalid container" });
    return null;
  }
  const pasted = extractHosterLinks(parsed.data.links);
  if (pasted.length === 0 && !container) {
    res.status(400).json({ error: "No links found" });
    return null;
  }
  const client = new RealDebridClient(downloader);
  const links = await client.expandLinks(pasted, container);
  if (links.length === 0) {
    res.status(400).json({ error: "No links found" });
    return null;
  }
  return { data: parsed.data, downloader, client, links };
}

// POST .../check - is each link supported and alive? Nothing is downloaded.
ddlRouter.post("/check", sensitiveEndpointLimiter, async (req, res) => {
  try {
    if (!(await resolveGame(req, res))) return;
    const prepared = await prepare(req, res);
    if (!prepared) return;
    return res.json({
      links: await prepared.client.checkLinks(prepared.links),
      limit: DDL_MAX_LINKS,
    });
  } catch (error) {
    logger.error({ error }, "error checking direct-download links");
    return res.status(502).json({ error: "Could not check the links with Real-Debrid" });
  }
});

// POST .../links - send the links to Real-Debrid and track them against the game
ddlRouter.post("/links", sensitiveEndpointLimiter, async (req, res) => {
  try {
    const game = await resolveGame(req, res);
    if (!game) return;
    const prepared = await prepare(req, res);
    if (!prepared) return;

    const title = prepared.data.title ?? game.title;
    const result = await prepared.client.addLinks({
      gameId: game.id,
      title,
      links: prepared.links,
      password: prepared.data.archivePassword,
    });
    if (!result.success || !result.id) {
      return res.status(502).json({ error: result.message });
    }
    await storage.addGameDownload({
      gameId: game.id,
      downloaderId: prepared.downloader.id,
      downloadHash: result.id,
      downloadTitle: title,
      status: "downloading",
      downloadType: "torrent",
    });
    await storage.updateGameStatus(game.id, { status: "downloading" }, { preserveCurated: true });
    await storage.updateGameSearchResultsAvailable(game.id, false);
    return res.json({ success: true, id: result.id, links: prepared.links.length });
  } catch (error) {
    logger.error({ error }, "error adding direct-download links");
    return res.status(502).json({ error: "Could not send the links to Real-Debrid" });
  }
});
