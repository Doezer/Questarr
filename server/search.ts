import { storage } from "./storage.js";
import { torznabClient } from "./torznab.js";
import { newznabClient } from "./newznab.js";
import { searchLogger } from "./logger.js";
import { parseReleaseMetadata } from "../shared/title-utils.js";

export interface SearchItem {
  title: string;
  link: string;
  pubDate: string;
  size?: number;
  indexerId: string;
  indexerName: string;
  indexerUrl?: string;
  category: string[];
  guid: string;
  downloadType: "torrent" | "usenet";
  // Protocol-specific fields
  seeders?: number;
  leechers?: number;
  grabs?: number;
  age?: number;
  poster?: string;
  group?: string;
  comments?: string;
}

export interface AggregatedSearchOptions {
  query: string;
  category?: string[];
  limit?: number;
  offset?: number;
}

export interface AggregatedSearchResults {
  items: SearchItem[];
  total: number;
  offset: number;
  errors: string[];
}

export async function searchAllIndexers(
  options: AggregatedSearchOptions
): Promise<AggregatedSearchResults> {
  const enabledIndexers = await storage.getEnabledIndexers();

  if (enabledIndexers.length === 0) {
    return { items: [], total: 0, offset: options.offset || 0, errors: ["No indexers configured"] };
  }

  const torznabIndexers = enabledIndexers.filter((i) => i.protocol !== "newznab");
  const newznabIndexers = enabledIndexers.filter((i) => i.protocol === "newznab");

  const searchParams = {
    query: options.query,
    category: options.category,
    limit: options.limit || 50,
    offset: options.offset || 0,
  };

  const promises = [];

  if (torznabIndexers.length > 0) {
    promises.push(
      torznabClient
        .searchMultipleIndexers(torznabIndexers, searchParams)
        .then((res) => ({ type: "torznab" as const, ...res }))
    );
  }

  if (newznabIndexers.length > 0) {
    promises.push(
      newznabClient
        .searchMultipleIndexers(newznabIndexers, searchParams)
        .then((res) => ({ type: "newznab" as const, ...res }))
    );
  }

  const results = await Promise.all(promises);

  const combinedItems: SearchItem[] = [];
  const combinedErrors: string[] = [];
  let totalCount = 0;

  for (const result of results) {
    if (result.type === "torznab") {
      const items = result.results.items.map((item) => {
        // Construct comments URL if not provided by the indexer.
        // This is a best-effort fallback based on common torrent indexer URL patterns.
        // Indexers should ideally provide the comments field directly in their Torznab responses
        // for more reliable links to the torrent page. The '/details/{guid}' pattern is a heuristic
        // that works for many popular indexers but may not work for all.
        let comments = item.comments;
        if (!comments && item.indexerUrl && item.guid) {
          try {
            const baseUrl = new URL(item.indexerUrl);
            const guid = item.guid.split("/").pop() || item.guid;
            comments = `${baseUrl.protocol}//${baseUrl.host}/details/${guid}`;
          } catch (error) {
            // If URL construction fails, log the error for debugging but continue
            searchLogger.warn(
              { error, indexerUrl: item.indexerUrl, guid: item.guid },
              "Failed to construct comments URL from indexer URL and GUID"
            );
          }
        }

        return {
          title: item.title,
          link: item.link,
          pubDate: item.pubDate,
          size: item.size,
          indexerId: item.indexerId || "unknown",
          indexerName: item.indexerName || "unknown",
          indexerUrl: item.indexerUrl,
          category: item.category ? item.category.split(",") : [],
          guid: item.guid || item.link,
          downloadType: "torrent" as const,
          seeders: item.seeders,
          leechers: item.leechers,
          group: parseReleaseMetadata(item.title).group,
          comments,
        } as SearchItem;
      });
      combinedItems.push(...items);
      totalCount += result.results.total || 0;
      if (result.errors) combinedErrors.push(...result.errors);
    } else if (result.type === "newznab") {
      const items = result.results.items.map(
        (item) =>
          ({
            title: item.title,
            link: item.link,
            pubDate: item.publishDate,
            size: item.size,
            indexerId: item.indexerId,
            indexerName: item.indexerName,
            category: item.category,
            guid: item.guid,
            downloadType: "usenet" as const,
            grabs: item.grabs,
            age: item.age,
            poster: item.poster,
            group: item.group,
          }) as SearchItem
      );
      combinedItems.push(...items);
      totalCount += result.results.total || 0;
      if (result.errors) {
        combinedErrors.push(...result.errors.map((e) => `${e.indexer}: ${e.error}`));
      }
    }
  }

  // Default sort: Date (newest first)
  combinedItems.sort((a, b) => {
    const dateA = new Date(a.pubDate).getTime();
    const dateB = new Date(b.pubDate).getTime();
    return dateB - dateA;
  });

  return {
    items: combinedItems,
    total: totalCount,
    offset: options.offset || 0,
    errors: combinedErrors,
  };
}
