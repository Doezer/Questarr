import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import {
  mockConfig,
  createStorageMock,
  createIgdbMock,
  createAuthMock,
  createDbMock,
  createLoggerMocks,
  createRssMock,
  createTorznabMock,
  createNewznabMock,
  createProwlarrMock,
  createXrelMock,
  createAppriseMock,
  createDownloaderManagerMock,
  createSteamRoutesMock,
  createSearchMock,
  createConfigLoaderMock,
  createSocketMock,
} from "./fixtures/common-route-mocks.js";
import { registerRoutes } from "../routes.js";
import { storage } from "../storage.js";
import { igdbClient } from "../igdb.js";
import { torznabClient } from "../torznab.js";
import { newznabClient } from "../newznab.js";
import { DownloaderManager } from "../downloaders.js";
import { xrelClient } from "../xrel.js";
import type { Downloader, Indexer, Game } from "../../shared/schema.js";

vi.mock("../storage.js", () => ({ storage: createStorageMock() }));
vi.mock("../igdb.js", () => ({ igdbClient: createIgdbMock() }));
vi.mock("../auth.js", () => createAuthMock());
vi.mock("../db.js", () => ({ db: createDbMock() }));
vi.mock("../logger.js", () => createLoggerMocks());
vi.mock("../rss.js", () => ({ rssService: createRssMock() }));
vi.mock("../torznab.js", () => ({ torznabClient: createTorznabMock() }));
vi.mock("../newznab.js", () => ({ newznabClient: createNewznabMock() }));
vi.mock("../prowlarr.js", () => ({ prowlarrClient: createProwlarrMock() }));
vi.mock("../xrel.js", () => createXrelMock());
vi.mock("../apprise.js", async () => createAppriseMock());
vi.mock("../downloaders.js", () => ({ DownloaderManager: createDownloaderManagerMock() }));
vi.mock("../steam-routes.js", () => ({ steamRoutes: createSteamRoutesMock() }));
vi.mock("../search.js", () => createSearchMock());

vi.mock("../middleware.js", async () => {
  const actual = await vi.importActual<typeof import("../middleware.js")>("../middleware.js");
  return {
    ...actual,
    sensitiveEndpointLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
    authRateLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  };
});

vi.mock("../config.js", () => ({ config: mockConfig }));
vi.mock("../config-loader.js", () => ({ configLoader: createConfigLoaderMock() }));
vi.mock("../socket.js", () => createSocketMock());

const testDownloader: Downloader = {
  id: "dl-1",
  name: "qBit",
  type: "qbittorrent",
  url: "http://localhost:8080",
  username: "user",
  password: "pass",
  enabled: true,
  priority: 1,
  categories: [],
  createdAt: new Date("2024-01-01T00:00:00.000Z"),
  updatedAt: new Date("2024-01-01T00:00:00.000Z"),
} as unknown as Downloader;

const testIndexer: Indexer = {
  id: "idx-1",
  name: "Test Indexer",
  url: "http://indexer.example.com",
  apiKey: "key",
  protocol: "torznab",
  enabled: true,
  priority: 1,
  categories: [],
  rssEnabled: true,
  autoSearchEnabled: true,
  createdAt: new Date("2024-01-01T00:00:00.000Z"),
  updatedAt: new Date("2024-01-01T00:00:00.000Z"),
} as unknown as Indexer;

describe("API Routes - Additional Coverage", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    await registerRoutes(app);
  });

  describe("GET /api/downloaders/:id", () => {
    it("returns a masked downloader", async () => {
      vi.mocked(storage.getDownloader).mockResolvedValue(testDownloader);
      const res = await request(app).get("/api/downloaders/dl-1");
      expect(res.status).toBe(200);
      expect(res.body.id).toBe("dl-1");
    });

    it("returns 404 when the downloader is missing", async () => {
      vi.mocked(storage.getDownloader).mockResolvedValue(undefined);
      const res = await request(app).get("/api/downloaders/missing");
      expect(res.status).toBe(404);
    });

    it("returns 500 on storage error", async () => {
      vi.mocked(storage.getDownloader).mockRejectedValue(new Error("db down"));
      const res = await request(app).get("/api/downloaders/dl-1");
      expect(res.status).toBe(500);
    });
  });

  describe("POST /api/downloaders/:id/test", () => {
    it("tests an existing downloader", async () => {
      vi.mocked(storage.getDownloader).mockResolvedValue(testDownloader);
      const res = await request(app).post("/api/downloaders/dl-1/test");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("returns 404 when downloader does not exist", async () => {
      vi.mocked(storage.getDownloader).mockResolvedValue(undefined);
      const res = await request(app).post("/api/downloaders/missing/test");
      expect(res.status).toBe(404);
    });
  });

  describe("Downloader downloads endpoints", () => {
    beforeEach(() => {
      vi.mocked(storage.getDownloader).mockResolvedValue(testDownloader);
    });

    it("GET /api/downloaders/:id/downloads lists downloads", async () => {
      vi.mocked(DownloaderManager.getAllDownloads).mockResolvedValue([{ id: "d1" }] as never);
      const res = await request(app).get("/api/downloaders/dl-1/downloads");
      expect(res.status).toBe(200);
      expect(res.body).toEqual([{ id: "d1" }]);
    });

    it("GET /api/downloaders/:id/downloads returns 404 for unknown downloader", async () => {
      vi.mocked(storage.getDownloader).mockResolvedValue(undefined);
      const res = await request(app).get("/api/downloaders/missing/downloads");
      expect(res.status).toBe(404);
    });

    it("GET /api/downloaders/:id/downloads/:downloadId returns status", async () => {
      vi.mocked(DownloaderManager.getDownloadStatus).mockResolvedValue({
        status: "downloading",
      } as never);
      const res = await request(app).get("/api/downloaders/dl-1/downloads/hash-1");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("downloading");
    });

    it("GET /api/downloaders/:id/downloads/:downloadId returns 404 when download missing", async () => {
      vi.mocked(DownloaderManager.getDownloadStatus).mockResolvedValue(undefined as never);
      const res = await request(app).get("/api/downloaders/dl-1/downloads/missing-hash");
      expect(res.status).toBe(404);
    });

    it("GET /api/downloaders/:id/downloads/:downloadId/details returns details", async () => {
      vi.mocked(DownloaderManager.getDownloadDetails).mockResolvedValue({ files: [] } as never);
      const res = await request(app).get("/api/downloaders/dl-1/downloads/hash-1/details");
      expect(res.status).toBe(200);
      expect(res.body.files).toEqual([]);
    });

    it("GET /api/downloaders/:id/downloads/:downloadId/details returns 404 when missing", async () => {
      vi.mocked(DownloaderManager.getDownloadDetails).mockResolvedValue(undefined as never);
      const res = await request(app).get("/api/downloaders/dl-1/downloads/missing/details");
      expect(res.status).toBe(404);
    });

    it("POST .../pause pauses a download", async () => {
      vi.mocked(DownloaderManager.pauseDownload).mockResolvedValue({ success: true } as never);
      const res = await request(app).post("/api/downloaders/dl-1/downloads/hash-1/pause");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("POST .../resume resumes a download", async () => {
      vi.mocked(DownloaderManager.resumeDownload).mockResolvedValue({ success: true } as never);
      const res = await request(app).post("/api/downloaders/dl-1/downloads/hash-1/resume");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe("GET /api/indexers/:id", () => {
    it("returns a masked indexer", async () => {
      vi.mocked(storage.getIndexer).mockResolvedValue(testIndexer);
      const res = await request(app).get("/api/indexers/idx-1");
      expect(res.status).toBe(200);
      expect(res.body.id).toBe("idx-1");
    });

    it("returns 404 for a missing indexer", async () => {
      vi.mocked(storage.getIndexer).mockResolvedValue(undefined);
      const res = await request(app).get("/api/indexers/missing");
      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/indexers/:id/test", () => {
    it("tests a torznab indexer using torznabClient", async () => {
      vi.mocked(storage.getIndexer).mockResolvedValue(testIndexer);
      const res = await request(app).post("/api/indexers/idx-1/test");
      expect(res.status).toBe(200);
      expect(torznabClient.testConnection).toHaveBeenCalled();
    });

    it("tests a usenet indexer using newznabClient", async () => {
      vi.mocked(storage.getIndexer).mockResolvedValue({
        ...testIndexer,
        protocol: "newznab",
      });
      const res = await request(app).post("/api/indexers/idx-1/test");
      expect(res.status).toBe(200);
      expect(newznabClient.testConnection).toHaveBeenCalled();
    });

    it("returns 404 when the indexer is missing", async () => {
      vi.mocked(storage.getIndexer).mockResolvedValue(undefined);
      const res = await request(app).post("/api/indexers/missing/test");
      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/indexers/:id/categories", () => {
    it("returns categories for a torznab indexer", async () => {
      vi.mocked(storage.getIndexer).mockResolvedValue(testIndexer);
      vi.mocked(torznabClient.getCategories).mockResolvedValue([
        { id: "1000", name: "Games" },
      ] as never);
      const res = await request(app).get("/api/indexers/idx-1/categories");
      expect(res.status).toBe(200);
      expect(res.body).toEqual([{ id: "1000", name: "Games" }]);
    });

    it("returns 404 when the indexer is missing", async () => {
      vi.mocked(storage.getIndexer).mockResolvedValue(undefined);
      const res = await request(app).get("/api/indexers/missing/categories");
      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/indexers/:id/search", () => {
    it("requires a query string", async () => {
      vi.mocked(storage.getIndexer).mockResolvedValue(testIndexer);
      const res = await request(app).get("/api/indexers/idx-1/search");
      expect(res.status).toBe(400);
    });

    it("returns 404 when the indexer is missing", async () => {
      vi.mocked(storage.getIndexer).mockResolvedValue(undefined);
      const res = await request(app).get("/api/indexers/missing/search?query=zelda");
      expect(res.status).toBe(404);
    });

    it("searches a torznab indexer", async () => {
      vi.mocked(storage.getIndexer).mockResolvedValue(testIndexer);
      const res = await request(app).get("/api/indexers/idx-1/search?query=zelda");
      expect(res.status).toBe(200);
      expect(torznabClient.searchGames).toHaveBeenCalled();
    });

    it("searches a usenet indexer", async () => {
      vi.mocked(storage.getIndexer).mockResolvedValue({ ...testIndexer, protocol: "newznab" });
      const res = await request(app).get("/api/indexers/idx-1/search?query=zelda");
      expect(res.status).toBe(200);
      expect(newznabClient.search).toHaveBeenCalled();
    });
  });

  describe("GET /api/games/status/:status", () => {
    it("returns games filtered by status", async () => {
      vi.mocked(storage.getUserGamesByStatus).mockResolvedValue([
        { id: "g1" },
      ] as unknown as Game[]);
      const res = await request(app).get("/api/games/status/owned");
      expect(res.status).toBe(200);
      expect(res.body).toEqual([{ id: "g1" }]);
    });
  });

  describe("GET /api/games/discover", () => {
    it("returns formatted recommendations", async () => {
      vi.mocked(storage.getUserGames).mockResolvedValue([]);
      vi.mocked(igdbClient.getRecommendations).mockResolvedValue([{ id: 1, name: "Rec" }] as never);
      const res = await request(app).get("/api/games/discover");
      expect(res.status).toBe(200);
      expect(igdbClient.getRecommendations).toHaveBeenCalled();
    });
  });

  describe("GET /api/igdb/genre/:genre", () => {
    it("rejects an overly long genre parameter", async () => {
      const res = await request(app).get(`/api/igdb/genre/${"a".repeat(101)}`);
      expect(res.status).toBe(400);
    });

    it("returns formatted games for a genre", async () => {
      vi.mocked(igdbClient.getGamesByGenre).mockResolvedValue([
        { id: 1, name: "Action Game" },
      ] as never);
      const res = await request(app).get("/api/igdb/genre/Action");
      expect(res.status).toBe(200);
      expect(igdbClient.getGamesByGenre).toHaveBeenCalled();
    });
  });

  describe("GET /api/igdb/platform/:platform", () => {
    it("rejects an overly long platform parameter", async () => {
      const res = await request(app).get(`/api/igdb/platform/${"a".repeat(101)}`);
      expect(res.status).toBe(400);
    });

    it("returns formatted games for a platform", async () => {
      vi.mocked(igdbClient.getGamesByPlatform).mockResolvedValue([
        { id: 1, name: "PC Game" },
      ] as never);
      const res = await request(app).get("/api/igdb/platform/PC");
      expect(res.status).toBe(200);
      expect(igdbClient.getGamesByPlatform).toHaveBeenCalled();
    });
  });

  describe("PUT /api/notifications/:id/read", () => {
    it("marks a notification as read", async () => {
      vi.mocked(storage.markNotificationAsRead).mockResolvedValue({
        id: "n1",
        read: true,
      } as never);
      const res = await request(app).put("/api/notifications/n1/read");
      expect(res.status).toBe(200);
      expect(res.body.read).toBe(true);
    });

    it("returns 404 when the notification is missing", async () => {
      vi.mocked(storage.markNotificationAsRead).mockResolvedValue(undefined);
      const res = await request(app).put("/api/notifications/missing/read");
      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/logs", () => {
    it("returns a lines array", async () => {
      const res = await request(app).get("/api/logs");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.lines)).toBe(true);
    });

    it("clamps an out-of-range limit query param", async () => {
      const res = await request(app).get("/api/logs?limit=99999");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.lines)).toBe(true);
    });
  });

  describe("PUT/DELETE /api/rss/feeds/:id", () => {
    it("updates an RSS feed", async () => {
      vi.mocked(storage.updateRssFeed).mockResolvedValue({
        id: "f1",
        url: "https://example.com/feed",
      } as never);
      const res = await request(app)
        .put("/api/rss/feeds/f1")
        .send({ url: "https://example.com/feed" });
      expect(res.status).toBe(200);
    });

    it("returns 404 when updating a missing feed", async () => {
      vi.mocked(storage.updateRssFeed).mockResolvedValue(undefined);
      const res = await request(app).put("/api/rss/feeds/missing").send({});
      expect(res.status).toBe(404);
    });

    it("deletes an RSS feed", async () => {
      vi.mocked(storage.removeRssFeed).mockResolvedValue(true);
      const res = await request(app).delete("/api/rss/feeds/f1");
      expect(res.status).toBe(204);
    });

    it("returns 404 when deleting a missing feed", async () => {
      vi.mocked(storage.removeRssFeed).mockResolvedValue(false);
      const res = await request(app).delete("/api/rss/feeds/missing");
      expect(res.status).toBe(404);
    });
  });

  describe("xREL routes", () => {
    it("PATCH /api/settings/xrel updates scene/p2p preferences", async () => {
      vi.mocked(storage.getUserSettings).mockResolvedValue({
        xrelSceneReleases: true,
        xrelP2pReleases: false,
      } as never);
      const res = await request(app)
        .patch("/api/settings/xrel")
        .send({ xrelSceneReleases: false, xrelP2pReleases: true });
      expect(res.status).toBe(200);
      expect(storage.updateUserSettings).toHaveBeenCalled();
    });

    it("PATCH /api/settings/xrel rejects an invalid API base URL", async () => {
      const res = await request(app).patch("/api/settings/xrel").send({ apiBase: "not-a-url" });
      expect(res.status).toBe(400);
    });

    it("PATCH /api/settings/xrel rejects a domain not in the allow list", async () => {
      const res = await request(app)
        .patch("/api/settings/xrel")
        .send({ apiBase: "https://evil.example.com" });
      expect(res.status).toBe(400);
    });

    it("GET /api/xrel/latest returns releases with match annotations", async () => {
      vi.mocked(xrelClient.getLatestGames).mockResolvedValue({
        list: [{ dirname: "Some.Game-GROUP", ext_info: null }],
        total: 1,
      } as never);
      vi.mocked(storage.getUserGames).mockResolvedValue([]);
      const res = await request(app).get("/api/xrel/latest");
      expect(res.status).toBe(200);
      expect(res.body.list).toHaveLength(1);
    });

    it("GET /api/xrel/search requires a query", async () => {
      const res = await request(app).get("/api/xrel/search");
      expect(res.status).toBe(400);
    });

    it("GET /api/xrel/search returns results", async () => {
      vi.mocked(xrelClient.searchReleases).mockResolvedValue([{ dirname: "Found-Game" }] as never);
      const res = await request(app).get("/api/xrel/search?q=game");
      expect(res.status).toBe(200);
      expect(res.body.results).toHaveLength(1);
    });
  });

  describe("POST /api/games/match-and-add", () => {
    it("requires a title", async () => {
      const res = await request(app).post("/api/games/match-and-add").send({});
      expect(res.status).toBe(400);
    });

    it("returns 404 when IGDB has no results", async () => {
      vi.mocked(igdbClient.searchGames).mockResolvedValue([]);
      const res = await request(app).post("/api/games/match-and-add").send({ title: "Unknown" });
      expect(res.status).toBe(404);
    });

    it("adds a matched game to the collection", async () => {
      vi.mocked(igdbClient.searchGames).mockResolvedValue([
        { id: 42, name: "Matched Game" },
      ] as never);
      vi.mocked(igdbClient.formatGameData).mockReturnValue({
        title: "Matched Game",
        igdbId: 42,
        platforms: [],
        genres: [],
        coverUrl: "",
        releaseDate: "",
        summary: "",
        publishers: [],
        developers: [],
        screenshots: [],
        rating: null,
      });
      vi.mocked(storage.getUserGames).mockResolvedValue([]);
      vi.mocked(storage.addGame).mockResolvedValue({
        id: "new-game",
        title: "Matched Game",
      } as never);

      const res = await request(app)
        .post("/api/games/match-and-add")
        .send({ title: "Matched Game" });
      expect(res.status).toBe(201);
      expect(res.body.title).toBe("Matched Game");
    });

    it("returns 409 when the game already exists in the collection", async () => {
      vi.mocked(igdbClient.searchGames).mockResolvedValue([
        { id: 42, name: "Matched Game" },
      ] as never);
      vi.mocked(igdbClient.formatGameData).mockReturnValue({
        title: "Matched Game",
        igdbId: 42,
        platforms: [],
        genres: [],
        coverUrl: "",
        releaseDate: "",
        summary: "",
        publishers: [],
        developers: [],
        screenshots: [],
        rating: null,
      });
      vi.mocked(storage.getUserGames).mockResolvedValue([
        { id: "existing", igdbId: 42, title: "Matched Game" },
      ] as unknown as Game[]);

      const res = await request(app)
        .post("/api/games/match-and-add")
        .send({ title: "Matched Game" });
      expect(res.status).toBe(409);
    });
  });

  describe("POST /api/games/refresh-metadata", () => {
    it("refreshes metadata for the user's games", async () => {
      vi.mocked(storage.getUserGames).mockResolvedValue([
        { id: "g1", igdbId: 42, title: "Old Title" },
      ] as unknown as Game[]);
      vi.mocked(igdbClient.getGamesByIds).mockResolvedValue([
        { id: 42, name: "New Title" },
      ] as never);
      vi.mocked(igdbClient.formatGameData).mockReturnValue({
        publishers: [],
        developers: [],
        summary: "",
        rating: null,
        genres: [],
        platforms: [],
        coverUrl: "",
        screenshots: [],
        releaseDate: "",
        earlyAccess: false,
        igdbWebsites: [],
        aggregatedRating: undefined,
      });

      const res = await request(app).post("/api/games/refresh-metadata");
      expect(res.status).toBe(200);
      expect(storage.updateGamesBatch).toHaveBeenCalled();
    });

    it("handles users with no games gracefully", async () => {
      vi.mocked(storage.getUserGames).mockResolvedValue([]);
      const res = await request(app).post("/api/games/refresh-metadata");
      expect(res.status).toBe(200);
    });
  });

  describe("SSRF protection on downloader/indexer URLs", () => {
    it("rejects adding a downloader with an unsafe URL", async () => {
      const res = await request(app).post("/api/downloaders").send({
        name: "Evil",
        type: "qbittorrent",
        url: "http://169.254.169.254",
        username: "u",
        password: "p",
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Invalid or unsafe URL");
      expect(storage.addDownloader).not.toHaveBeenCalled();
    });

    it("rejects updating a downloader to an unsafe URL", async () => {
      vi.mocked(storage.getDownloader).mockResolvedValue(testDownloader);
      const res = await request(app)
        .patch("/api/downloaders/dl-1")
        .send({ url: "http://169.254.169.254" });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Invalid or unsafe URL");
    });

    it("keeps the existing password when the sentinel value is sent", async () => {
      vi.mocked(storage.getDownloader).mockResolvedValue(testDownloader);
      vi.mocked(storage.updateDownloader).mockResolvedValue(testDownloader);
      const res = await request(app).patch("/api/downloaders/dl-1").send({ password: "********" });
      expect(res.status).toBe(200);
      const updateCall = vi.mocked(storage.updateDownloader).mock.calls[0][1];
      expect(updateCall).not.toHaveProperty("password");
    });

    it("rejects adding an indexer with an unsafe URL", async () => {
      const res = await request(app).post("/api/indexers").send({
        name: "Evil",
        url: "http://169.254.169.254",
        apiKey: "key",
        protocol: "torznab",
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Invalid or unsafe URL");
    });

    it("rejects updating an indexer to an unsafe URL", async () => {
      vi.mocked(storage.getIndexer).mockResolvedValue(testIndexer);
      const res = await request(app)
        .patch("/api/indexers/idx-1")
        .send({ url: "http://169.254.169.254" });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Invalid or unsafe URL");
    });

    it("keeps the existing API key when the sentinel value is sent", async () => {
      vi.mocked(storage.getIndexer).mockResolvedValue(testIndexer);
      vi.mocked(storage.updateIndexer).mockResolvedValue(testIndexer);
      const res = await request(app).patch("/api/indexers/idx-1").send({ apiKey: "********" });
      expect(res.status).toBe(200);
      const updateCall = vi.mocked(storage.updateIndexer).mock.calls[0][1];
      expect(updateCall).not.toHaveProperty("apiKey");
    });
  });

  describe("Downloader and indexer 404s on update/delete", () => {
    it("PATCH /api/downloaders/:id returns 404 when missing", async () => {
      vi.mocked(storage.updateDownloader).mockResolvedValue(undefined);
      const res = await request(app).patch("/api/downloaders/missing").send({ name: "X" });
      expect(res.status).toBe(404);
    });

    it("DELETE /api/downloaders/:id returns 404 when missing", async () => {
      vi.mocked(storage.removeDownloader).mockResolvedValue(false);
      const res = await request(app).delete("/api/downloaders/missing");
      expect(res.status).toBe(404);
    });

    it("PATCH /api/indexers/:id returns 404 when missing", async () => {
      vi.mocked(storage.updateIndexer).mockResolvedValue(undefined);
      const res = await request(app).patch("/api/indexers/missing").send({ name: "X" });
      expect(res.status).toBe(404);
    });

    it("DELETE /api/indexers/:id returns 404 when missing", async () => {
      vi.mocked(storage.removeIndexer).mockResolvedValue(false);
      const res = await request(app).delete("/api/indexers/missing");
      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /api/downloaders/:id/downloads/:downloadId", () => {
    it("removes a download, defaulting deleteFiles to false", async () => {
      vi.mocked(storage.getDownloader).mockResolvedValue(testDownloader);
      const res = await request(app).delete("/api/downloaders/dl-1/downloads/hash-1");
      expect(res.status).toBe(200);
      expect(DownloaderManager.removeDownload).toHaveBeenCalledWith(
        testDownloader,
        "hash-1",
        false
      );
    });

    it("removes a download and its files when deleteFiles=true", async () => {
      vi.mocked(storage.getDownloader).mockResolvedValue(testDownloader);
      const res = await request(app).delete(
        "/api/downloaders/dl-1/downloads/hash-1?deleteFiles=true"
      );
      expect(res.status).toBe(200);
      expect(DownloaderManager.removeDownload).toHaveBeenCalledWith(testDownloader, "hash-1", true);
    });

    it("returns 404 when the downloader is missing", async () => {
      vi.mocked(storage.getDownloader).mockResolvedValue(undefined);
      const res = await request(app).delete("/api/downloaders/missing/downloads/hash-1");
      expect(res.status).toBe(404);
    });
  });

  describe("Validation errors on create", () => {
    it("POST /api/downloaders returns a Zod validation error for invalid data", async () => {
      const res = await request(app).post("/api/downloaders").send({ name: "" });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Validation failed");
    });

    it("POST /api/indexers returns a Zod validation error for invalid data", async () => {
      const res = await request(app).post("/api/indexers").send({ name: "" });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Validation failed");
    });
  });
});
