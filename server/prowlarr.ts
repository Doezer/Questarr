import { type Indexer } from "../shared/schema.js";
import { torznabLogger } from "./logger.js";
import { safeFetch } from "./ssrf.js";

interface ProwlarrIndexer {
  id: number;
  name: string;
  fields: Array<{ name: string; value?: string }>;
  implementationName: string;
  implementation: string;
  configContract: string;
  infoLink: string;
  message: {
    title: string;
    text: string;
    link: string;
  };
  tags: number[];
  added: string;
  appProfileId: number;
  protocol: string;
  priority: number;
  enable: boolean;
  indexerUrls: string[];
  apiKey?: string; // Sometimes exposed
}

export class ProwlarrClient {
  /**
   * Fetch all indexers from Prowlarr and convert them to Questarr Indexer format
   */
  async getIndexers(prowlarrUrl: string, apiKey: string): Promise<Partial<Indexer>[]> {
    // Normalize URL
    let baseUrl = prowlarrUrl.replace(/\/+$/, "");
    if (!baseUrl.startsWith("http")) {
      baseUrl = `http://${baseUrl}`;
    }

    const apiUrl = `${baseUrl}/api/v1/indexer`;

    try {
      const response = await safeFetch(apiUrl, {
        headers: {
          "X-Api-Key": apiKey,
          "User-Agent": "Questarr/1.0",
        },
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch indexers from Prowlarr: ${response.statusText}`);
      }

      const prowlarrIndexers = (await response.json()) as ProwlarrIndexer[];

      torznabLogger.info(
        {
          count: prowlarrIndexers.length,
          details: prowlarrIndexers.map((i) => ({
            name: i.name,
            protocol: i.protocol,
            appProfileId: i.appProfileId,
          })),
        },
        "Fetched indexers from Prowlarr"
      );

      // Filter for Torznab (torrent) and Newznab (usenet) compatible indexers
      // We accept both torrent and usenet protocol indexers.
      // appProfileId check removed as it might filter out valid indexers assigned to profiles.
      const compatibleIndexers = prowlarrIndexers.filter(
        (idx) => idx.protocol === "torrent" || idx.protocol === "usenet"
      );

      torznabLogger.info(
        {
          count: compatibleIndexers.length,
          torrent: compatibleIndexers.filter((i) => i.protocol === "torrent").length,
          usenet: compatibleIndexers.filter((i) => i.protocol === "usenet").length,
        },
        "Filtered compatible Torznab and Newznab indexers"
      );

      return compatibleIndexers.map((idx) => {
        // Construct Torznab/Newznab URL
        // Prowlarr exposes Torznab feed at /<indexerId>/api for torrents
        // and Newznab feed at /<indexerId>/api for usenet
        const indexerUrl = `${baseUrl}/${idx.id}/api`;

        // Determine protocol: torrent -> torznab, usenet -> newznab
        const protocol = idx.protocol === "usenet" ? "newznab" : "torznab";

        return {
          name: idx.name,
          url: indexerUrl,
          apiKey: apiKey, // Prowlarr uses the main API key for all indexer feeds by default
          protocol: protocol as "torznab" | "newznab",
          enabled: idx.enable,
          priority: idx.priority,
          rssEnabled: true,
          autoSearchEnabled: true,
          // We don't sync categories automatically as they differ per indexer
          categories: [],
        };
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      torznabLogger.error(
        { error: errorMessage, url: prowlarrUrl },
        "Failed to sync from Prowlarr"
      );
      throw error;
    }
  }
}

export const prowlarrClient = new ProwlarrClient();
