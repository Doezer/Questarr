import { storage } from "../storage.js";
import { PathMappingService } from "./PathMappingService.js";
import { PlatformMappingService } from "./PlatformMappingService.js";
import { ArchiveService } from "./ArchiveService.js";
import { ImportManager } from "./ImportManager.js";

// Instantiate services
export const pathMappingService = new PathMappingService(storage);
export const platformMappingService = new PlatformMappingService(storage);
export const archiveService = new ArchiveService();

export const importManager = new ImportManager(
  storage,
  pathMappingService,
  platformMappingService,
  archiveService
);
