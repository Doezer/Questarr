import Parser from "rss-parser";
import { storage } from "./storage.js";
import { igdbClient } from "./igdb.js";
import { logger } from "./logger.js";
import { RssFeed, InsertRssFeedItem } from "../shared/schema.js";

const rssLogger = logger.child({ module: "rss" });

// Cache for IGDB lookups (Game Name -> IGDB Data)
// To satisfy the 24h cache requirement for IGDB requests
interface IgdbCacheEntry {
  id: number;
  name: string;
  coverUrl?: string;
  timestamp: number;
}

const igdbCache = new Map<string, IgdbCacheEntry>();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

export class RssService {
  private parser: Parser;

  constructor() {
    this.parser = new Parser();
  }

  async initialize() {
    const feeds = await storage.getAllRssFeeds();
    if (feeds.length === 0) {
      rssLogger.info("Seeding default RSS feeds...");
      await storage.addRssFeed({
        name: "Fitgirl Repacks",
        url: "https://fitgirl-repacks.site/feed/",
        type: "preset",
        enabled: true,
        mapping: { titleField: "title", linkField: "link" },
      });
    }
  }

  async refreshFeeds() {
    const feeds = await storage.getAllRssFeeds();
    const enabledFeeds = feeds.filter((f) => f.enabled);

    rssLogger.info(`Refreshing ${enabledFeeds.length} enabled RSS feeds...`);

    for (const feed of enabledFeeds) {
      try {
        await this.refreshFeed(feed);
      } catch (error) {
        rssLogger.error({ feedId: feed.id, error }, `Failed to refresh feed ${feed.name}`);
        await storage.updateRssFeed(feed.id, {
          status: "error",
          errorMessage: error instanceof Error ? error.message : String(error),
          lastCheck: new Date(),
        });
      }
    }
  }

  async refreshFeed(feed: RssFeed) {
    rssLogger.debug(`Fetching feed: ${feed.name} (${feed.url})`);

    // Set timeout for parsing
    const feedContent = await this.parser.parseURL(feed.url);

    rssLogger.debug(`Parsed ${feedContent.items.length} items from ${feed.name}`);

    const newIds: string[] = [];

    for (const item of feedContent.items) {
      // 1. Normalize
      const normalized = this.normalizeItem(feed, item);
      if (!normalized) continue;

      // 2. Check if exists
      const existing = await storage.getRssFeedItemByGuid(normalized.guid);
      if (existing) {
        // Optionally update fields if needed, but usually GUID implies identity
        continue;
      }

      // 3. Insert immediately without matching
      const newItem: InsertRssFeedItem = {
        feedId: feed.id,
        guid: normalized.guid,
        title: normalized.title,
        link: normalized.link,
        pubDate: normalized.pubDate,
        sourceName: feed.name,
        // Match asynchronously later
        igdbGameId: null,
        igdbGameName: null,
        coverUrl: null,
      };

      const created = await storage.addRssFeedItem(newItem);
      newIds.push(String(created.id)); // Convert number ID to string
    }

    await storage.updateRssFeed(feed.id, {
      lastCheck: new Date(),
      status: "ok",
      errorMessage: null,
    });

    // 4. Trigger background matching
    if (newIds.length > 0) {
      this.processPendingItems(newIds).catch((err) => {
        rssLogger.error({ err }, "Error in background item processing");
      });
    }
  }

  private async processPendingItems(itemIds: string[]) {
    rssLogger.info(`Starting background match for ${itemIds.length} items`);

    for (const id of itemIds) {
      try {
        // Assuming storage methods can handle string IDs or convert internally
        const item = await storage.getRssFeedItem(id);
        if (!item || item.igdbGameId) continue; // Already matched or gone

        const match = await this.matchGame(item.title);
        if (match) {
          await storage.updateRssFeedItem(id, {
            igdbGameId: match.id,
            igdbGameName: match.name,
            coverUrl: match.coverUrl,
          });
          rssLogger.debug(`Matched item ${id} to game ${match.name}`);
        }
      } catch (error) {
        rssLogger.warn({ itemId: id, error }, "Failed to process item match");
      }
    }

    rssLogger.info(`Completed background match for ${itemIds.length} items`);
  }

  private normalizeItem(
    feed: RssFeed,
    item: Record<string, unknown>
  ): { title: string; link: string; pubDate: Date; guid: string } | null {
    const titleField = feed.mapping?.titleField || "title";
    const linkField = feed.mapping?.linkField || "link";

    const title = item[titleField] || item.title;
    const link = item[linkField] || item.link;
    const guid = item.guid || item.id || link || title; // Fallback for GUID
    const pubDateStr = item.pubDate || item.isoDate;

    if (!title || !link) {
      rssLogger.warn(
        {
          feedId: feed.id,
          titleField,
          linkField,
          hasTitle: !!item[titleField],
          hasLink: !!item[linkField],
          hasStandardTitle: !!item.title,
          hasStandardLink: !!item.link,
        },
        "Skipping item missing title or link"
      );
      return null;
    }

    return {
      title: String(title).trim(),
      link: String(link).trim(),
      pubDate: pubDateStr ? new Date(String(pubDateStr)) : new Date(),
      guid: String(guid).trim(),
    };
  }

  private async matchGame(releaseTitle: string): Promise<IgdbCacheEntry | null> {
    // Extract potential game name
    const cleanName = this.extractGameName(releaseTitle);

    // Check cache
    const cached = igdbCache.get(cleanName.toLowerCase());
    if (cached) {
      if (Date.now() - cached.timestamp < CACHE_TTL) {
        return cached;
      }
      igdbCache.delete(cleanName.toLowerCase());
    }

    // Search IGDB
    try {
      const results = await igdbClient.searchGames(cleanName, 1);
      if (results && results.length > 0) {
        const game = results[0];
        const entry: IgdbCacheEntry = {
          id: game.id,
          name: game.name,
          coverUrl: game.cover?.url?.replace("t_thumb", "t_cover_big"), // Better quality
          timestamp: Date.now(),
        };
        igdbCache.set(cleanName.toLowerCase(), entry);
        return entry;
      }
    } catch (error) {
      rssLogger.warn({ releaseTitle, cleanName, error }, "IGDB match failed");
    }

    return null;
  }

  private extractGameName(releaseTitle: string): string {
    // Heuristics for common release formats
    let name = releaseTitle;

    // Remove "FitGirl Repack" etc.
    name = name.replace(/FitGirl Repack/i, "");

    // Split by common separators like " v1.0", " - ", " (2024)"
    const separators = [
      "[vV][0-9]", // Matches v1.0, V2, etc. - Check this first
      " - ",
      " \\(",
      " \\[",
    ];

    for (const sep of separators) {
      const regex = new RegExp(sep);
      const parts = name.split(regex);
      if (parts.length > 1 && parts[0].length > 2) {
        name = parts[0];
        break; // Stop at first split match
      }
    }

    return name.trim();
  }
}

export const rssService = new RssService();
