import { XMLParser } from "fast-xml-parser";
import type { Indexer } from "../shared/schema.js";
import { torznabLogger } from "./logger.js";

interface TorznabItem {
  title: string;
  link: string;
  pubDate: string;
  description?: string;
  category?: string;
  size?: number;
  seeders?: number;
  leechers?: number;
  downloadVolumeFactor?: number;
  uploadVolumeFactor?: number;
  guid?: string;
  comments?: string;
  attributes?: { [key: string]: string };
  indexerId?: string;
  indexerName?: string;
  indexerUrl?: string;
}

interface TorznabSearchParams {
  query?: string;
  category?: string[];
  limit?: number;
  offset?: number;
  imdbid?: string;
  season?: number;
  episode?: number;
}

interface TorznabResponse {
  items: TorznabItem[];
  total?: number;
  offset?: number;
}

export class TorznabClient {
  private parser: XMLParser;

  constructor() {
    this.parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      textNodeName: "#text",
      isArray: (name: string) => ["item", "category"].includes(name),
    });
  }

  /**
   * Search for games using a Torznab indexer
   */
  async searchGames(indexer: Indexer, params: TorznabSearchParams): Promise<TorznabResponse> {
    if (!indexer.enabled) {
      throw new Error(`Indexer ${indexer.name} is disabled`);
    }

    const searchUrl = this.buildSearchUrl(indexer, params);

    torznabLogger.info({ indexer: indexer.name, url: searchUrl, params }, "searching torznab indexer");

    try {
      const response = await fetch(searchUrl, {
        headers: {
          "User-Agent": "Questarr/1.0",
        },
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "No error details available");
        throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText}`);
      }

      const xmlData = await response.text();
      torznabLogger.debug({ indexer: indexer.name, responseLength: xmlData.length }, "received torznab response");
      const result = this.parseResponse(xmlData, indexer.url, indexer);

      if (params.category && params.category.length > 0) {
        const requestedCats = params.category;
        const initialCount = result.items.length;

        result.items = result.items.filter((item) => {
          if (!item.category) return true;
          // Note: TorznabItem.category is a string (single category?)
          // or did I define it as string[]? Interface says string | undefined.
          // But parsing might put a single value.

          return requestedCats.some((reqCat) => {
            if (item.category === reqCat) return true;
            if (reqCat.endsWith("000") && item.category!.startsWith(reqCat.substring(0, 1))) {
              return true;
            }
            return false;
          });
        });

        if (result.items.length < initialCount) {
          torznabLogger.info(
            {
              indexer: indexer.name,
              filtered: initialCount - result.items.length,
              remaining: result.items.length
            },
            "filtered torznab results by category"
          );
          result.total = result.items.length;
        }
      }

      return result;
    } catch (error) {
      torznabLogger.error({ indexerName: indexer.name, error }, `error searching indexer`);
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      throw new Error(`Failed to search indexer ${indexer.name}: ${errorMessage}`);
    }
  }

  /**
   * Search multiple indexers and aggregate results
   */
  async searchMultipleIndexers(
    indexers: Indexer[],
    params: TorznabSearchParams
  ): Promise<{ results: TorznabResponse; errors: string[] }> {
    const enabledIndexers = indexers.filter((indexer) => indexer.enabled);

    if (enabledIndexers.length === 0) {
      throw new Error("No enabled indexers available");
    }

    const promises = enabledIndexers.map(async (indexer) => {
      try {
        const result = await this.searchGames(indexer, params);
        return { indexer: indexer.name, result, error: null };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        return { indexer: indexer.name, result: null, error: errorMessage };
      }
    });

    const results = await Promise.allSettled(promises);
    const aggregatedItems: TorznabItem[] = [];
    const errors: string[] = [];

    results.forEach((result) => {
      if (result.status === "fulfilled") {
        const { indexer, result: searchResult, error } = result.value;
        if (error) {
          errors.push(`${indexer}: ${error}`);
        } else if (searchResult) {
          aggregatedItems.push(...searchResult.items);
        }
      } else {
        errors.push(`Unknown error: ${result.reason}`);
      }
    });

    // Sort by seeders (descending) and then by title
    aggregatedItems.sort((a, b) => {
      const seedersA = a.seeders || 0;
      const seedersB = b.seeders || 0;
      if (seedersA !== seedersB) {
        return seedersB - seedersA;
      }
      return a.title.localeCompare(b.title);
    });

    return {
      results: {
        items: aggregatedItems,
        total: aggregatedItems.length,
        offset: params.offset || 0,
      },
      errors,
    };
  }

  /**
   * Build the search URL for a Torznab indexer
   */
  private buildSearchUrl(indexer: Indexer, params: TorznabSearchParams): string {
    const url = new URL(indexer.url);

    // Ensure the URL ends with a slash and has the correct path
    if (!url.pathname.endsWith("/")) {
      url.pathname += "/";
    }
    if (!url.pathname.includes("/api")) {
      url.pathname += "api/";
    }

    // Set common Torznab parameters
    url.searchParams.set("t", "search");
    url.searchParams.set("apikey", indexer.apiKey);

    if (params.query) {
      url.searchParams.set("q", params.query);
    }

    if (params.category && params.category.length > 0) {
      url.searchParams.set("cat", params.category.join(","));
    } else {
      // Default to game categories
      const configuredCategories = indexer.categories || [];

      if (configuredCategories.length > 0) {
        // If categories are configured, use only the game-related ones
        // 40xx: PC Games, 10xx: Console Games
        const gameCategories = configuredCategories.filter(
          (cat) =>
            cat.startsWith("40") ||
            cat.startsWith("10") ||
            cat.toLowerCase().includes("game") ||
            cat.toLowerCase().includes("pc")
        );
        if (gameCategories.length > 0) {
          url.searchParams.set("cat", gameCategories.join(","));
        }
      } else {
        // If NO categories are configured, default to standard Game categories
        // 4000: PC Games, 1000: Console Games
        url.searchParams.set("cat", "4000,1000");
      }
    }

    if (params.limit) {
      url.searchParams.set("limit", params.limit.toString());
    }

    if (params.offset) {
      url.searchParams.set("offset", params.offset.toString());
    }

    return url.toString();
  }

  /**
   * Parse Torznab XML response
   */
  private parseResponse(xmlData: string, indexerUrl: string, indexer?: Indexer): TorznabResponse {
    try {
      const parsed = this.parser.parse(xmlData);

      if (!parsed.rss || !parsed.rss.channel) {
        throw new Error("Invalid Torznab response format");
      }

      const channel = parsed.rss.channel;
      const items = Array.isArray(channel.item) ? channel.item : channel.item ? [channel.item] : [];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const torznabItems: TorznabItem[] = items.map((item: any) =>
        this.parseItem(item, indexerUrl, indexer)
      );

      const finalItems = torznabItems;

      // Filter results by category if specific categories were requested
      // We do this here because we have access to the params via closure if we move this logic up,
      // but parseResponse doesn't have params.
      // Wait, parseResponse doesn't accept params.
      // I need to filter in searchGames instead.

      return {
        items: finalItems,
        total: finalItems.length,
        offset: 0,
      };
    } catch (error) {
      torznabLogger.error({ error }, "error parsing Torznab response");
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      throw new Error(`Failed to parse response: ${errorMessage}`);
    }
  }

  /**
   * Parse individual Torznab item
   */
  // XML parsing requires any due to dynamic structure
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private parseItem(item: any, indexerUrl: string, indexer?: Indexer): TorznabItem {
    const torznabItem: TorznabItem = {
      title: item.title || "Unknown",
      link: item.link || item.guid || "",
      pubDate: item.pubDate || new Date().toISOString(),
      description: item.description,
      comments: item.comments,
      guid: item.guid,
      indexerId: indexer?.id,
      indexerName: indexer?.name,
      indexerUrl: indexer?.url,
    };

    // Parse enclosure for download link and size
    if (item.enclosure) {
      torznabItem.link = item.enclosure["@_url"] || torznabItem.link;
      torznabItem.size = parseInt(item.enclosure["@_length"]) || undefined;
    }

    // Rewrite link to use indexer's configured URL (fix for proxies/seedboxes)
    if (torznabItem.link && indexerUrl) {
      try {
        const linkUrl = new URL(torznabItem.link);
        // Only rewrite HTTP/HTTPS links
        if (linkUrl.protocol === "http:" || linkUrl.protocol === "https:") {
          const indexerUrlObj = new URL(indexerUrl);

          // If the link uses a different port or host than the configured indexer,
          // but shares the same path structure (heuristic), we force the configured URL.
          // We assume that the path part returned by the indexer is correct relative to the base.

          linkUrl.protocol = indexerUrlObj.protocol;
          linkUrl.host = indexerUrlObj.host; // overrides port too

          // Use the modified URL
          torznabItem.link = linkUrl.toString();
        }
      } catch {
        // Ignore invalid URLs or parsing errors
      }
    }

    // Parse Torznab attributes
    if (item["torznab:attr"]) {
      const attributes = Array.isArray(item["torznab:attr"])
        ? item["torznab:attr"]
        : [item["torznab:attr"]];

      const parsedAttributes: { [key: string]: string } = {};

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      attributes.forEach((attr: any) => {
        const name = attr["@_name"];
        const value = attr["@_value"];
        if (name && value) {
          parsedAttributes[name] = value;

          // Map common attributes
          switch (name) {
            case "size":
              torznabItem.size = parseInt(value);
              break;
            case "seeders":
              torznabItem.seeders = parseInt(value);
              break;
            case "peers":
            case "leechers":
              torznabItem.leechers = parseInt(value);
              break;
            case "downloadvolumefactor":
              torznabItem.downloadVolumeFactor = parseFloat(value);
              break;
            case "uploadvolumefactor":
              torznabItem.uploadVolumeFactor = parseFloat(value);
              break;
            case "category":
              torznabItem.category = value;
              break;
            case "comments":
              torznabItem.comments = value;
              break;
          }
        }
      });

      torznabItem.attributes = parsedAttributes;
    }

    if (torznabItem.category) {
       torznabLogger.debug({ title: torznabItem.title, category: torznabItem.category, indexer: indexer?.name }, "parsed torznab item category");
    }

    return torznabItem;
  }

  /**
   * Test connection to an indexer
   */
  async testConnection(indexer: Indexer): Promise<{ success: boolean; message: string }> {
    try {
      const testParams: TorznabSearchParams = {
        query: "test",
        limit: 1,
      };

      await this.searchGames(indexer, testParams);
      return { success: true, message: `Successfully connected to ${indexer.name}` };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return { success: false, message: errorMessage };
    }
  }

  /**
   * Get available categories from an indexer
   */
  async getCategories(indexer: Indexer): Promise<{ id: string; name: string }[]> {
    if (!indexer.enabled) {
      throw new Error(`Indexer ${indexer.name} is disabled`);
    }

    const url = new URL(indexer.url);
    url.searchParams.set("t", "caps");
    url.searchParams.set("apikey", indexer.apiKey);

    try {
      const response = await fetch(url.toString(), {
        headers: { "User-Agent": "Questarr/1.0" },
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "No error details available");
        throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText}`);
      }

      const xmlData = await response.text();
      const parsed = this.parser.parse(xmlData);

      const categories: { id: string; name: string }[] = [];

      if (parsed.caps?.categories?.category) {
        const cats = Array.isArray(parsed.caps.categories.category)
          ? parsed.caps.categories.category
          : [parsed.caps.categories.category];

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        cats.forEach((cat: any) => {
          const id = cat["@_id"];
          const name = cat["@_name"] || cat["#text"] || `Category ${id}`;
          if (id) {
            categories.push({ id, name });
          }
        });
      }

      return categories;
    } catch (error) {
      torznabLogger.error({ indexerName: indexer.name, error }, `error getting categories`);
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      throw new Error(`Failed to get categories: ${errorMessage}`);
    }
  }
}

export const torznabClient = new TorznabClient();
