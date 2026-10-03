import { storage } from "../storage.js";
import { PathMappingService } from "./PathMappingService.js";
import { ArchiveService } from "./ArchiveService.js";
import { ImportManager } from "./ImportManager.js";
import { SecurityScanService } from "../security-scan.js";

// Instantiate services
export const pathMappingService = new PathMappingService(storage);
export const archiveService = new ArchiveService();
export const securityScanService = new SecurityScanService(storage);

export const importManager = new ImportManager(
  storage,
  pathMappingService,
  archiveService,
  securityScanService
);
