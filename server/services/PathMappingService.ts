import { IStorage } from "../storage.js";
import { InsertPathMapping, PathMapping } from "../../shared/schema.js";
import path from "path";

export class PathMappingService {
  constructor(private storage: IStorage) {}

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
      if (remotePath.startsWith(mapping.remotePath)) {
        if (!bestMatch || mapping.remotePath.length > bestMatch.remotePath.length) {
          bestMatch = mapping;
        }
      }
    }

    if (bestMatch) {
      // Replace the matched remote prefix with the local path, using OS-native path separators.
      const relative = remotePath.substring(bestMatch.remotePath.length);
      const cleanRelative = relative.replace(/^[/\\]/, "");

      return path.join(bestMatch.localPath, cleanRelative);
    }

    console.warn(
      `[PathMappingService] No path mapping matched for "${remotePath}" (host: ${remoteHost ?? "none"}). Using original path.`
    );
    return remotePath;
  }
}
