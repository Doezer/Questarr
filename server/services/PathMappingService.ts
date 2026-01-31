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

  async updateMapping(id: string, updates: Partial<InsertPathMapping>): Promise<PathMapping | undefined> {
    return this.storage.updatePathMapping(id, updates);
  }

  async removeMapping(id: string): Promise<boolean> {
    return this.storage.removePathMapping(id);
  }

  async translatePath(remotePath: string, remoteHost?: string | null): Promise<string> {
    const mappings = await this.storage.getPathMappings();
    // Best match logic: longest matching remotePath
    let bestMatch: PathMapping | null = null;

    // Normalize paths for comparison (remove trailing slashes, consistent separators?)
    // Basic normalization: generic replacement of backslashes to forward slashes for matching?
    // Or assume users input correctly. Let's do simple string start match for now.
    
    // Filter by host if provided (and if mapping has a host defined)
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
      // Replace prefix
      // Use path.join to ensure correct separators for the OS?
      // But we are translating TO local path, so we should use local OS separators?
      // Questarr runs in Docker (Linux usually) or Windows.
      // If running in Docker, separators are /.
      // `path` module uses OS specific separators.
      
      const relative = remotePath.substring(bestMatch.remotePath.length);
      // Clean leading slash/backslash from relative part
      const cleanRelative = relative.replace(/^[/\\]/, "");
      
      return path.join(bestMatch.localPath, cleanRelative);
    }

    return remotePath; // No mapping found, return original
  }
}
