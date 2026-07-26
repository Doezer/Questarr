import { IStorage } from "../storage.js";
import { InsertPathMapping, PathMapping } from "../../shared/schema.js";
import { logger } from "../logger.js";
import path from "node:path";

export class PathMappingService {
  constructor(private readonly storage: IStorage) {}

  async getAllMappings(): Promise<PathMapping[]> {
    return this.storage.getPathMappings();
  }

  async addMapping(mapping: InsertPathMapping): Promise<PathMapping> {
    return this.storage.addPathMapping(mapping);
  }

  async updateMapping(
    id: string,
    updates: Partial<InsertPathMapping>
  ): Promise<PathMapping | undefined> {
    return this.storage.updatePathMapping(id, updates);
  }

  async removeMapping(id: string): Promise<boolean> {
    return this.storage.removePathMapping(id);
  }

  async translatePath(remotePath: string, remoteHost?: string | null): Promise<string> {
    const mappings = await this.storage.getPathMappings();
    // Find the mapping with the longest matching remotePath prefix (most specific match wins).
    // No path normalization is applied; mappings must use the exact path format reported by the downloader.
    let bestMatch: PathMapping | null = null;

    const candidates = mappings.filter((m) => {
      if (!m.remoteHost) return true; // Generic mapping applies to all
      if (remoteHost && m.remoteHost === remoteHost) return true; // Host matches
      return false; // Host defined but doesn't match
    });

    for (const mapping of candidates) {
      const prefix = mapping.remotePath.endsWith("/")
        ? mapping.remotePath
        : mapping.remotePath + "/";
      if (remotePath === mapping.remotePath || remotePath.startsWith(prefix)) {
        if (!bestMatch || mapping.remotePath.length > bestMatch.remotePath.length) {
          bestMatch = mapping;
        }
      }
    }

    if (bestMatch) {
      // Replace the matched remote prefix with the local path, using OS-native path separators.
      const relative = remotePath.substring(bestMatch.remotePath.length);
      const cleanRelative = relative.replace(/^[/\\]/, "");
      const localBasePath = path.resolve(bestMatch.localPath);
      const localPath = path.join(localBasePath, cleanRelative);

      // The remote path segment past the mapping prefix is reported by the download
      // client and can carry attacker-influenced "../" sequences (e.g. from a release
      // name); confine the joined result to the mapped base so it can't escape it.
      const isWithinBase =
        localPath === localBasePath || localPath.startsWith(localBasePath + path.sep);
      if (!isWithinBase) {
        logger.warn(
          { remotePath, remoteHost, localPath, localBasePath },
          "[PathMappingService] Translated path escaped mapping base — falling back to base path"
        );
        return localBasePath;
      }

      logger.debug(
        {
          remotePath,
          remoteHost,
          localPath,
          rule: `${bestMatch.remotePath} → ${bestMatch.localPath}`,
        },
        "[PathMappingService] Mapped path"
      );
      return localPath;
    }

    if (mappings.length > 0) {
      logger.warn(
        { remotePath, remoteHost, mappingCount: mappings.length },
        "[PathMappingService] No mapping matched — passing path through unchanged"
      );
    } else {
      logger.debug({ remotePath }, "[PathMappingService] No path mappings configured");
    }
    return remotePath;
  }
}
