import express from "express";
import type { Router } from "express";
import type { Game, ImportConfig, RomMConfig } from "../../../shared/schema.js";

export function makeGame(overrides: Partial<Game> = {}): Game {
  return {
    id: "g1",
    title: "Test Game",
    status: "wanted",
    userId: "u1",
    igdbId: null,
    steamAppId: null,
    summary: null,
    coverUrl: null,
    releaseDate: null,
    rating: null,
    platforms: [],
    genres: null,
    publishers: null,
    developers: null,
    screenshots: null,
    hidden: false,
    originalReleaseDate: null,
    releaseStatus: null,
    addedAt: null,
    completedAt: null,
    source: null,
    igdbWebsites: null,
    aggregatedRating: null,
    earlyAccess: false,
    userRating: null,
    searchResultsAvailable: false,
    ...overrides,
  };
}

export function makeImportConfig(overrides: Partial<ImportConfig> = {}): ImportConfig {
  return {
    enablePostProcessing: true,
    autoUnpack: false,
    renamePattern: "{Title}",
    overwriteExisting: false,
    transferMode: "move",
    importPlatformIds: [],
    ignoredExtensions: [],
    minFileSize: 0,
    libraryRoot: "/data",
    ...overrides,
  };
}

export function makeRommConfig(overrides: Partial<RomMConfig> = {}): RomMConfig {
  return {
    enabled: true,
    libraryRoot: "/data/romm",
    platformRoutingMode: "slug-subfolder",
    platformBindings: {},
    moveMode: "copy",
    conflictPolicy: "rename",
    folderNamingTemplate: "{title}",
    singleFilePlacement: "root",
    multiFilePlacement: "subfolder",
    includeRegionLanguageTags: false,
    bindingMissingBehavior: "fallback",
    ...overrides,
  };
}

export function createImportTestApp(router: Router, withUser = true) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (withUser) {
      (req as { user?: unknown }).user = { id: "user-1" };
    }
    next();
  });
  app.use("/api/imports", router);
  return app;
}
