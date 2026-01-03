import { XMLParser } from "fast-xml-parser";
import { type Indexer } from "@shared/schema";
import { routesLogger } from "./logger.js";
import { isSafeUrl } from "./ssrf.js";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
});

/**
 * Format bytes to human-readable string with dynamic units
 */
function formatBytes(bytes: number, decimals = 2): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

export interface NewznabSearchParams {
  query: string;
  category?: string[];
  limit?: number;
  offset?: number;
}

export interface NewznabResult {
  title: string;
  link: string; // NZB download URL
  size: string;
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
      url.pathname = url.pathname.endsWith("/") ? `${url.pathname}api` : `${url.pathname}/api`;

      // Build Newznab search parameters
      url.searchParams.set("apikey", indexer.apiKey);
      url.searchParams.set("t", "search"); // Newznab search function
      url.searchParams.set("q", params.query);

      if (params.category && params.category.length > 0) {
        url.searchParams.set("cat", params.category.join(","));
      }

      if (params.limit) {
        url.searchParams.set("limit", params.limit.toString());
      }

      if (params.offset) {
        url.searchParams.set("offset", params.offset.toString());
      }

      // Extended attributes for more metadata
      url.searchParams.set("extended", "1");

      routesLogger.debug({ indexer: indexer.name, url: url.toString() }, "searching newznab indexer");

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
      const data = parser.parse(xmlText);

      const results: NewznabResult[] = [];

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
          const size = !isNaN(sizeBytesNum) ? formatBytes(sizeBytesNum) : "Unknown";

          // Calculate age in days
          const pubDate = new Date(item.pubDate || Date.now());
          const age = Math.floor((Date.now() - pubDate.getTime()) / (1000 * 60 * 60 * 24));

          // Get categories
          const categories: string[] = [];
          if (item.category) {
            const cats = Array.isArray(item.category) ? item.category : [item.category];
            categories.push(...cats.filter(Boolean));
          }

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

      routesLogger.debug({ indexer: indexer.name, count: results.length }, "newznab search results");

      return results;
    } catch (error) {
      routesLogger.error({ indexer: indexer.name, error }, "newznab search error");
      throw new Error(`Newznab search failed for ${indexer.name}: ${error}`);
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
