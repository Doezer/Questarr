import { XMLParser } from "fast-xml-parser";
import type { Indexer } from "@shared/schema";

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
  async searchGames(
    indexer: Indexer,
    params: TorznabSearchParams
  ): Promise<TorznabResponse> {
    if (!indexer.enabled) {
      throw new Error(`Indexer ${indexer.name} is disabled`);
    }

    const searchUrl = this.buildSearchUrl(indexer, params);

    try {
      const response = await fetch(searchUrl, {
        headers: {
          'User-Agent': 'GameRadarr/1.0',
        },
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const xmlData = await response.text();
      return this.parseResponse(xmlData);
    } catch (error) {
      console.error(`Error searching ${indexer.name}:`, error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
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
    const enabledIndexers = indexers.filter(indexer => indexer.enabled);
    
    if (enabledIndexers.length === 0) {
      throw new Error("No enabled indexers available");
    }

    const promises = enabledIndexers.map(async (indexer) => {
      try {
        const result = await this.searchGames(indexer, params);
        return { indexer: indexer.name, result, error: null };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return { indexer: indexer.name, result: null, error: errorMessage };
      }
    });

    const results = await Promise.allSettled(promises);
    const aggregatedItems: TorznabItem[] = [];
    const errors: string[] = [];

    results.forEach((result) => {
      if (result.status === 'fulfilled') {
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
    if (!url.pathname.endsWith('/')) {
      url.pathname += '/';
    }
    if (!url.pathname.includes('/api')) {
      url.pathname += 'api/';
    }

    // Set common Torznab parameters
    url.searchParams.set('t', 'search');
    url.searchParams.set('apikey', indexer.apiKey);
    
    if (params.query) {
      url.searchParams.set('q', params.query);
    }

    if (params.category && params.category.length > 0) {
      url.searchParams.set('cat', params.category.join(','));
    } else {
      // Default to game categories if available
      // Common game category IDs: 4000 (PC Games), 4070 (Mac Games), etc.
      const gameCategories = indexer.categories?.filter(cat => 
        cat.startsWith('40') || cat.includes('game') || cat.includes('pc')
      );
      if (gameCategories && gameCategories.length > 0) {
        url.searchParams.set('cat', gameCategories.join(','));
      }
    }

    if (params.limit) {
      url.searchParams.set('limit', params.limit.toString());
    }

    if (params.offset) {
      url.searchParams.set('offset', params.offset.toString());
    }

    return url.toString();
  }

  /**
   * Parse Torznab XML response
   */
  private parseResponse(xmlData: string): TorznabResponse {
    try {
      const parsed = this.parser.parse(xmlData);
      
      if (!parsed.rss || !parsed.rss.channel) {
        throw new Error('Invalid Torznab response format');
      }

      const channel = parsed.rss.channel;
      const items = Array.isArray(channel.item) ? channel.item : (channel.item ? [channel.item] : []);

      const torznabItems: TorznabItem[] = items.map((item: any) => this.parseItem(item));

      return {
        items: torznabItems,
        total: torznabItems.length,
        offset: 0,
      };
    } catch (error) {
      console.error('Error parsing Torznab response:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to parse response: ${errorMessage}`);
    }
  }

  /**
   * Parse individual Torznab item
   */
  private parseItem(item: any): TorznabItem {
    const torznabItem: TorznabItem = {
      title: item.title || 'Unknown',
      link: item.link || item.guid || '',
      pubDate: item.pubDate || new Date().toISOString(),
      description: item.description,
    };

    // Parse enclosure for download link and size
    if (item.enclosure) {
      torznabItem.link = item.enclosure['@_url'] || torznabItem.link;
      torznabItem.size = parseInt(item.enclosure['@_length']) || undefined;
    }

    // Parse Torznab attributes
    if (item['torznab:attr']) {
      const attributes = Array.isArray(item['torznab:attr']) 
        ? item['torznab:attr'] 
        : [item['torznab:attr']];

      const parsedAttributes: { [key: string]: string } = {};
      
      attributes.forEach((attr: any) => {
        const name = attr['@_name'];
        const value = attr['@_value'];
        if (name && value) {
          parsedAttributes[name] = value;
          
          // Map common attributes
          switch (name) {
            case 'size':
              torznabItem.size = parseInt(value);
              break;
            case 'seeders':
              torznabItem.seeders = parseInt(value);
              break;
            case 'peers':
            case 'leechers':
              torznabItem.leechers = parseInt(value);
              break;
            case 'downloadvolumefactor':
              torznabItem.downloadVolumeFactor = parseFloat(value);
              break;
            case 'uploadvolumefactor':
              torznabItem.uploadVolumeFactor = parseFloat(value);
              break;
            case 'category':
              torznabItem.category = value;
              break;
            case 'comments':
              torznabItem.comments = value;
              break;
          }
        }
      });

      torznabItem.attributes = parsedAttributes;
    }

    return torznabItem;
  }

  /**
   * Test connection to an indexer
   */
  async testConnection(indexer: Indexer): Promise<{ success: boolean; message: string }> {
    try {
      const testParams: TorznabSearchParams = {
        query: 'test',
        limit: 1,
      };

      await this.searchGames(indexer, testParams);
      return { success: true, message: `Successfully connected to ${indexer.name}` };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
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
    url.searchParams.set('t', 'caps');
    url.searchParams.set('apikey', indexer.apiKey);

    try {
      const response = await fetch(url.toString(), {
        headers: { 'User-Agent': 'GameRadarr/1.0' },
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const xmlData = await response.text();
      const parsed = this.parser.parse(xmlData);

      const categories: { id: string; name: string }[] = [];
      
      if (parsed.caps?.categories?.category) {
        const cats = Array.isArray(parsed.caps.categories.category)
          ? parsed.caps.categories.category
          : [parsed.caps.categories.category];

        cats.forEach((cat: any) => {
          const id = cat['@_id'];
          const name = cat['@_name'] || cat['#text'] || `Category ${id}`;
          if (id) {
            categories.push({ id, name });
          }
        });
      }

      return categories;
    } catch (error) {
      console.error(`Error getting categories from ${indexer.name}:`, error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to get categories: ${errorMessage}`);
    }
  }
}

export const torznabClient = new TorznabClient();