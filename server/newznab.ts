import { XMLParser } from "fast-xml-parser";
import { type Indexer } from "@shared/schema";
import { routesLogger } from "./logger.js";
import { isSafeUrl } from "./ssrf.js";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
});

export interface NewznabSearchParams {
  query: string;
  category?: string[];
  limit?: number;
  offset?: number;
}

export interface NewznabResult {
  title: string;
  link: string; // NZB download URL
  size?: number;
  publishDate: string;
  indexerId: string;
  indexerName: string;
  category: string[];
  guid: string; // Unique identifier
  // Usenet-specific fields
  grabs?: number; // Number of downloads
  age?: number; // Age in days
  files?: number; // Number of files in NZB
  poster?: string; // Usenet poster
  group?: string; // Usenet newsgroup
}

export interface NewznabSearchResults {
  items: NewznabResult[];
  total: number;
  offset: number;
}

export interface NewznabCategory {
  id: string;
  name: string;
}

class NewznabClient {
  /**
   * Search a single Newznab indexer
   */
  async search(indexer: Indexer, params: NewznabSearchParams): Promise<NewznabResult[]> {
    try {
      // Validate URL before making request
      if (!(await isSafeUrl(indexer.url))) {
        throw new Error(`Unsafe URL detected: ${indexer.url}`);
      }

      const url = new URL(indexer.url);
      // Don't modify pathname if it already contains 'api'
      if (!url.pathname.includes("/api")) {
        url.pathname = url.pathname.endsWith("/") ? `${url.pathname}api` : `${url.pathname}/api`;
      }

      // Build Newznab search parameters
      url.searchParams.set("apikey", indexer.apiKey);
      url.searchParams.set("t", "search"); // Newznab search function
      url.searchParams.set("q", params.query);

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
          } else {
            // If configured categories exist but none match games, use them anyway
            // (user might know what they are doing, e.g. custom category ID)
            url.searchParams.set("cat", configuredCategories.join(","));
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

      // Extended attributes for more metadata
      url.searchParams.set("extended", "1");

      routesLogger.info(
        { indexer: indexer.name, url: url.toString(), params },
        "searching newznab indexer"
      );

      const response = await fetch(url.toString(), {
        headers: {
          "User-Agent": "Questarr/1.0",
        },
        signal: AbortSignal.timeout(30000), // 30 second timeout
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const xmlText = await response.text();
      routesLogger.debug(
        { indexer: indexer.name, responseLength: xmlText.length },
        "received newznab response"
      );

      const data = parser.parse(xmlText);

      let results: NewznabResult[] = [];

      // Parse RSS feed structure
      if (data.rss?.channel?.item) {
        const items = Array.isArray(data.rss.channel.item)
          ? data.rss.channel.item
          : [data.rss.channel.item];

        for (const item of items) {
          // Extract Newznab attributes
          const attrs = item["newznab:attr"] || [];
          const attrMap = new Map<string, string>();

          if (Array.isArray(attrs)) {
            for (const attr of attrs) {
              if (attr["@_name"] && attr["@_value"]) {
                attrMap.set(attr["@_name"], attr["@_value"]);
              }
            }
          }

          // Get size - try multiple sources
          const sizeBytes = attrMap.get("size") || item.enclosure?.["@_length"];
          const sizeBytesNum = sizeBytes ? parseInt(sizeBytes, 10) : NaN;
          const size = !isNaN(sizeBytesNum) ? sizeBytesNum : undefined;

          // Calculate age in days
          const pubDate = new Date(item.pubDate || Date.now());
          const age = Math.floor((Date.now() - pubDate.getTime()) / (1000 * 60 * 60 * 24));

          // Get categories
          const categories: string[] = [];
          if (item.category) {
            const cats = Array.isArray(item.category) ? item.category : [item.category];
            categories.push(...cats.filter(Boolean));
          }

          routesLogger.debug(
            { title: item.title, categories, indexer: indexer.name },
            "parsed newznab item category"
          );

          results.push({
            title: item.title,
            link: item.link || item.enclosure?.["@_url"],
            size,
            publishDate: item.pubDate,
            indexerId: indexer.id,
            indexerName: indexer.name,
            category: categories,
            guid: item.guid?.["#text"] || item.guid,
            // Usenet-specific
            grabs: (() => {
              const val = attrMap.get("grabs");
              if (!val) return undefined;
              const num = parseInt(val, 10);
              return !isNaN(num) ? num : undefined;
            })(),
            age,
            files: (() => {
              const val = attrMap.get("files");
              if (!val) return undefined;
              const num = parseInt(val, 10);
              return !isNaN(num) ? num : undefined;
            })(),
            poster: attrMap.get("poster"),
            group: attrMap.get("group"),
          });
        }
      }

      routesLogger.info(
        { indexer: indexer.name, count: results.length },
        "newznab search results processed"
      );

      // Filter results by category if specific categories were requested
      if (params.category && params.category.length > 0) {
        const requestedCats = params.category;
        const initialCount = results.length;

        results = results.filter((item) => {
          // If item has no category info, we keep it (conservative approach)
          if (!item.category || item.category.length === 0) return true;

          // Check if any of the item's categories match any of the requested categories
          return item.category.some((itemCat) =>
            requestedCats.some((reqCat) => {
              if (itemCat === reqCat) return true;

              // Handle parent categories (e.g. 4000 matches 4050)
              // If request is X000 (e.g. 4000), it matches 4xxx
              if (reqCat.endsWith("000") && itemCat.startsWith(reqCat.substring(0, 1))) {
                return true;
              }
              // If request is XX00 (e.g. 4000), it matches 40xx?
              // Actually 4000 usually means the whole 4xxx block in Torznab/Newznab.

              return false;
            })
          );
        });

        if (results.length < initialCount) {
          routesLogger.info(
            {
              indexer: indexer.name,
              filtered: initialCount - results.length,
              remaining: results.length,
            },
            "filtered newznab results by category"
          );
        }
      }

      return results;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorDetails = {
        indexer: indexer.name,
        indexerUrl: indexer.url,
        error: errorMessage,
        errorType: error instanceof Error ? error.constructor.name : typeof error,
        stack: error instanceof Error ? error.stack : undefined,
      };
      routesLogger.error(errorDetails, "newznab search error");
      throw new Error(`Newznab search failed for ${indexer.name}: ${errorMessage}`);
    }
  }

  /**
   * Search multiple Newznab indexers in parallel
   */
  async searchMultipleIndexers(
    indexers: Indexer[],
    params: NewznabSearchParams
  ): Promise<{ results: NewznabSearchResults; errors: Array<{ indexer: string; error: string }> }> {
    const promises = indexers.map((indexer) =>
      this.search(indexer, params)
        .then((results) => ({ indexer: indexer.name, results, error: null }))
        .catch((error) => ({ indexer: indexer.name, results: [], error: error.message }))
    );

    const settled = await Promise.all(promises);

    const allResults: NewznabResult[] = [];
    const errors: Array<{ indexer: string; error: string }> = [];

    for (const result of settled) {
      if (result.error) {
        errors.push({ indexer: result.indexer, error: result.error });
      } else {
        allResults.push(...result.results);
      }
    }

    // Sort by publish date (newest first)
    allResults.sort((a, b) => {
      const dateA = new Date(a.publishDate).getTime();
      const dateB = new Date(b.publishDate).getTime();
      return dateB - dateA;
    });

    return {
      results: {
        items: allResults.slice(params.offset || 0, (params.offset || 0) + (params.limit || 50)),
        total: allResults.length,
        offset: params.offset || 0,
      },
      errors,
    };
  }

  /**
   * Get available categories from a Newznab indexer
   */
  async getCategories(indexer: Indexer): Promise<NewznabCategory[]> {
    try {
      if (!(await isSafeUrl(indexer.url))) {
        throw new Error(`Unsafe URL detected: ${indexer.url}`);
      }

      const url = new URL(indexer.url);
      url.pathname = url.pathname.endsWith("/") ? `${url.pathname}api` : `${url.pathname}/api`;
      url.searchParams.set("apikey", indexer.apiKey);
      url.searchParams.set("t", "caps"); // Get capabilities

      const response = await fetch(url.toString(), {
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const xmlText = await response.text();
      const data = parser.parse(xmlText);

      const categories: NewznabCategory[] = [];

      if (data.caps?.categories?.category) {
        const cats = Array.isArray(data.caps.categories.category)
          ? data.caps.categories.category
          : [data.caps.categories.category];

        for (const cat of cats) {
          if (cat["@_id"] && cat["@_name"]) {
            categories.push({
              id: cat["@_id"],
              name: cat["@_name"],
            });

            // Add subcategories
            if (cat.subcat) {
              const subcats = Array.isArray(cat.subcat) ? cat.subcat : [cat.subcat];
              for (const subcat of subcats) {
                if (subcat["@_id"] && subcat["@_name"]) {
                  categories.push({
                    id: subcat["@_id"],
                    name: `${cat["@_name"]} > ${subcat["@_name"]}`,
                  });
                }
              }
            }
          }
        }
      }

      return categories;
    } catch (error) {
      routesLogger.error({ indexer: indexer.name, error }, "failed to get newznab categories");
      throw error;
    }
  }

  /**
   * Test connection to a Newznab indexer
   */
  async testConnection(indexer: Indexer): Promise<{ success: boolean; message: string }> {
    try {
      if (!(await isSafeUrl(indexer.url))) {
        return { success: false, message: "Unsafe URL detected" };
      }

      const url = new URL(indexer.url);
      url.pathname = url.pathname.endsWith("/") ? `${url.pathname}api` : `${url.pathname}/api`;
      url.searchParams.set("apikey", indexer.apiKey);
      url.searchParams.set("t", "caps");

      const response = await fetch(url.toString(), {
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        return {
          success: false,
          message: `Connection failed: HTTP ${response.status}`,
        };
      }

      const xmlText = await response.text();
      const data = parser.parse(xmlText);

      if (data.error) {
        return {
          success: false,
          message: data.error.description || "Unknown error",
        };
      }

      // Check if it's a valid Newznab response
      if (data.caps) {
        return {
          success: true,
          message: "Connection successful",
        };
      }

      return {
        success: false,
        message: "Invalid Newznab response",
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }
}

export const newznabClient = new NewznabClient();
