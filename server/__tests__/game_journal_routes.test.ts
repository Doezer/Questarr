import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import os from "os";
import path from "path";
import fs from "fs/promises";
import {
  mockConfig,
  createStorageMock,
  createRawgMock,
  createAuthMock,
  createDbModuleMock,
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
import { configLoader } from "../config-loader.js";
import { fileTypeFromBuffer } from "file-type";
import type { Game, GameJournalEntry, GameMilestone, GameScreenshot } from "../../shared/schema.js";

vi.mock("../storage.js", () => ({ storage: createStorageMock() }));
vi.mock("../rawg.js", () => ({ rawgClient: createRawgMock() }));
vi.mock("../auth.js", () => createAuthMock());
vi.mock("../db.js", () => createDbModuleMock());
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
    scanRateLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  };
});

vi.mock("../config.js", () => ({ config: mockConfig }));
vi.mock("../config-loader.js", () => ({ configLoader: createConfigLoaderMock() }));
vi.mock("../socket.js", () => createSocketMock());
vi.mock("file-type", () => ({ fileTypeFromBuffer: vi.fn() }));

const OWNER_ID = "user-1";
const gameId = "123e4567-e89b-12d3-a456-426614174000";
const entryId = "223e4567-e89b-12d3-a456-426614174000";
const milestoneId = "323e4567-e89b-12d3-a456-426614174000";
const screenshotId = "423e4567-e89b-12d3-a456-426614174000";

function makeGame(overrides: Partial<Game> = {}): Game {
  return { id: gameId, userId: OWNER_ID, title: "Test Game", ...overrides } as Game;
}

// 1x1 PNG (valid magic bytes) and a 1x1 JPEG, for real file-type sniffing.
const PNG_BYTES = Buffer.from(
  "89504e470d0a1a0a0000000d494844520000000100000001080600000" +
    "01f15c4890000000a49444154789c6360000002000100ffff03000006000557bfabd40000000049454e44ae426082",
  "hex"
);
const NOT_AN_IMAGE = Buffer.from("this is definitely not an image", "utf-8");

describe("Game journal routes", () => {
  let app: express.Express;
  let tempRoot: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "questarr-journal-"));
    vi.mocked(configLoader.getConfigDir).mockReturnValue(tempRoot);

    app = express();
    app.set("trust proxy", 1);
    app.use(express.json());
    await registerRoutes(app);

    vi.mocked(storage.getGame).mockResolvedValue(
      makeGame() as unknown as Awaited<ReturnType<typeof storage.getGame>>
    );
    vi.mocked(fileTypeFromBuffer).mockResolvedValue({ ext: "png", mime: "image/png" });
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  describe("GET /api/games/:id/journal", () => {
    it("returns 404 when the game does not belong to the requester", async () => {
      vi.mocked(storage.getGame).mockResolvedValue(
        makeGame({ userId: "someone-else" }) as unknown as Awaited<
          ReturnType<typeof storage.getGame>
        >
      );

      const response = await request(app).get(`/api/games/${gameId}/journal`);

      expect(response.status).toBe(404);
    });

    it("returns the game's journal entries", async () => {
      vi.mocked(storage.getGameJournalEntries).mockResolvedValue([
        { id: entryId, gameId, userId: OWNER_ID, note: "hi", createdAt: new Date() },
      ] as GameJournalEntry[]);

      const response = await request(app).get(`/api/games/${gameId}/journal`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(storage.getGameJournalEntries).toHaveBeenCalledWith(gameId, OWNER_ID);
    });

    it("returns 500 when storage throws", async () => {
      vi.mocked(storage.getGameJournalEntries).mockRejectedValue(new Error("db down"));

      const response = await request(app).get(`/api/games/${gameId}/journal`);

      expect(response.status).toBe(500);
    });
  });

  describe("POST /api/games/:id/journal", () => {
    it("creates a journal entry", async () => {
      vi.mocked(storage.addGameJournalEntry).mockResolvedValue({
        id: entryId,
        gameId,
        userId: OWNER_ID,
        note: "played for 2 hours",
        createdAt: new Date(),
      } as GameJournalEntry);

      const response = await request(app)
        .post(`/api/games/${gameId}/journal`)
        .send({ note: "played for 2 hours" });

      expect(response.status).toBe(201);
      expect(storage.addGameJournalEntry).toHaveBeenCalledWith({
        gameId,
        userId: OWNER_ID,
        note: "played for 2 hours",
      });
    });

    it("rejects an empty note", async () => {
      const response = await request(app).post(`/api/games/${gameId}/journal`).send({ note: "" });

      expect(response.status).toBe(400);
      expect(storage.addGameJournalEntry).not.toHaveBeenCalled();
    });
  });

  describe("DELETE /api/games/:id/journal/:entryId", () => {
    it("deletes an owned journal entry", async () => {
      vi.mocked(storage.deleteGameJournalEntry).mockResolvedValue(true);

      const response = await request(app).delete(`/api/games/${gameId}/journal/${entryId}`);

      expect(response.status).toBe(204);
      expect(storage.deleteGameJournalEntry).toHaveBeenCalledWith(entryId, gameId, OWNER_ID);
    });

    it("returns 404 when the entry does not exist", async () => {
      vi.mocked(storage.deleteGameJournalEntry).mockResolvedValue(false);

      const response = await request(app).delete(`/api/games/${gameId}/journal/${entryId}`);

      expect(response.status).toBe(404);
    });
  });

  describe("Milestones", () => {
    it("lists milestones for the game", async () => {
      vi.mocked(storage.getGameMilestones).mockResolvedValue([
        {
          id: milestoneId,
          gameId,
          userId: OWNER_ID,
          label: "Beat the final boss",
          completedAt: null,
          createdAt: new Date(),
        },
      ] as GameMilestone[]);

      const response = await request(app).get(`/api/games/${gameId}/milestones`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
    });

    it("creates a milestone", async () => {
      vi.mocked(storage.addGameMilestone).mockResolvedValue({
        id: milestoneId,
        gameId,
        userId: OWNER_ID,
        label: "100% completion",
        completedAt: null,
        createdAt: new Date(),
      } as GameMilestone);

      const response = await request(app)
        .post(`/api/games/${gameId}/milestones`)
        .send({ label: "100% completion" });

      expect(response.status).toBe(201);
      expect(storage.addGameMilestone).toHaveBeenCalledWith({
        gameId,
        userId: OWNER_ID,
        label: "100% completion",
      });
    });

    it("rejects a missing label", async () => {
      const response = await request(app).post(`/api/games/${gameId}/milestones`).send({});

      expect(response.status).toBe(400);
    });

    it("toggles a milestone's completed state", async () => {
      vi.mocked(storage.updateGameMilestone).mockResolvedValue({
        id: milestoneId,
        gameId,
        userId: OWNER_ID,
        label: "Beat the final boss",
        completedAt: new Date(),
        createdAt: new Date(),
      } as GameMilestone);

      const response = await request(app)
        .patch(`/api/games/${gameId}/milestones/${milestoneId}`)
        .send({ completed: true });

      expect(response.status).toBe(200);
      expect(storage.updateGameMilestone).toHaveBeenCalledWith(milestoneId, gameId, OWNER_ID, true);
    });

    it("returns 404 when updating a milestone that doesn't exist", async () => {
      vi.mocked(storage.updateGameMilestone).mockResolvedValue(undefined);

      const response = await request(app)
        .patch(`/api/games/${gameId}/milestones/${milestoneId}`)
        .send({ completed: true });

      expect(response.status).toBe(404);
    });

    it("rejects a non-boolean completed value", async () => {
      const response = await request(app)
        .patch(`/api/games/${gameId}/milestones/${milestoneId}`)
        .send({ completed: "yes" });

      expect(response.status).toBe(400);
    });

    it("deletes a milestone", async () => {
      vi.mocked(storage.deleteGameMilestone).mockResolvedValue(true);

      const response = await request(app).delete(`/api/games/${gameId}/milestones/${milestoneId}`);

      expect(response.status).toBe(204);
    });

    it("returns 404 deleting a milestone that doesn't exist", async () => {
      vi.mocked(storage.deleteGameMilestone).mockResolvedValue(false);

      const response = await request(app).delete(`/api/games/${gameId}/milestones/${milestoneId}`);

      expect(response.status).toBe(404);
    });
  });

  describe("Screenshots", () => {
    it("lists screenshots with a served-file URL attached", async () => {
      vi.mocked(storage.getGameScreenshots).mockResolvedValue([
        {
          id: screenshotId,
          gameId,
          userId: OWNER_ID,
          filePath: "/tmp/config/screenshots/x.png",
          caption: null,
          createdAt: new Date(),
        },
      ] as GameScreenshot[]);

      const response = await request(app).get(`/api/games/${gameId}/screenshots`);

      expect(response.status).toBe(200);
      expect(response.body[0].url).toBe(`/api/games/${gameId}/screenshots/${screenshotId}/file`);
    });

    it("uploads a valid PNG screenshot", async () => {
      vi.mocked(storage.addGameScreenshot).mockImplementation(async (input) => ({
        id: screenshotId,
        gameId: input.gameId,
        userId: input.userId,
        filePath: input.filePath,
        caption: input.caption ?? null,
        createdAt: new Date(),
      }));

      const response = await request(app)
        .post(`/api/games/${gameId}/screenshots`)
        .field("caption", "nice view")
        .attach("file", PNG_BYTES, "screenshot.png");

      expect(response.status).toBe(201);
      expect(storage.addGameScreenshot).toHaveBeenCalledWith(
        expect.objectContaining({ gameId, userId: OWNER_ID, caption: "nice view" })
      );
      expect(response.body.url).toBe(`/api/games/${gameId}/screenshots/${screenshotId}/file`);
    });

    it("rejects a file whose magic bytes aren't an allowed image type", async () => {
      vi.mocked(fileTypeFromBuffer).mockResolvedValue(undefined);

      const response = await request(app)
        .post(`/api/games/${gameId}/screenshots`)
        .attach("file", NOT_AN_IMAGE, "screenshot.png");

      expect(response.status).toBe(400);
      expect(storage.addGameScreenshot).not.toHaveBeenCalled();
    });

    it("requires a file", async () => {
      const response = await request(app).post(`/api/games/${gameId}/screenshots`);

      expect(response.status).toBe(400);
    });

    it("maps an oversized upload to a JSON 400 instead of a raw multer error", async () => {
      const tooBig = Buffer.concat([PNG_BYTES, Buffer.alloc(9_000_000)]);

      const response = await request(app)
        .post(`/api/games/${gameId}/screenshots`)
        .attach("file", tooBig, "screenshot.png");

      expect(response.status).toBe(400);
      expect(response.body.error).toBeTruthy();
    });

    it("cleans up the written file when metadata insertion fails", async () => {
      vi.mocked(storage.addGameScreenshot).mockRejectedValue(new Error("insert failed"));

      const response = await request(app)
        .post(`/api/games/${gameId}/screenshots`)
        .attach("file", PNG_BYTES, "screenshot.png");

      expect(response.status).toBe(500);
      const screenshotDir = path.join(tempRoot, "screenshots", gameId);
      const remaining = await fs.readdir(screenshotDir).catch(() => []);
      expect(remaining).toHaveLength(0);
    });

    it("serves an existing screenshot file", async () => {
      const screenshotDir = path.join(tempRoot, "screenshots", gameId);
      await fs.mkdir(screenshotDir, { recursive: true });
      const filePath = path.join(screenshotDir, "existing.png");
      await fs.writeFile(filePath, PNG_BYTES);

      vi.mocked(storage.getGameScreenshots).mockResolvedValue([
        {
          id: screenshotId,
          gameId,
          userId: OWNER_ID,
          filePath,
          caption: null,
          createdAt: new Date(),
        },
      ] as GameScreenshot[]);

      const response = await request(app).get(
        `/api/games/${gameId}/screenshots/${screenshotId}/file`
      );

      expect(response.status).toBe(200);
    });

    it("returns 404 when the screenshot record doesn't exist", async () => {
      vi.mocked(storage.getGameScreenshots).mockResolvedValue([]);

      const response = await request(app).get(
        `/api/games/${gameId}/screenshots/${screenshotId}/file`
      );

      expect(response.status).toBe(404);
    });

    it("updates a screenshot's caption", async () => {
      vi.mocked(storage.updateGameScreenshotCaption).mockResolvedValue({
        id: screenshotId,
        gameId,
        userId: OWNER_ID,
        filePath: "/x.png",
        caption: "updated",
        createdAt: new Date(),
      } as GameScreenshot);

      const response = await request(app)
        .patch(`/api/games/${gameId}/screenshots/${screenshotId}`)
        .send({ caption: "updated" });

      expect(response.status).toBe(200);
      expect(storage.updateGameScreenshotCaption).toHaveBeenCalledWith(
        screenshotId,
        gameId,
        OWNER_ID,
        "updated"
      );
    });

    it("returns 404 updating a caption for a screenshot that doesn't exist", async () => {
      vi.mocked(storage.updateGameScreenshotCaption).mockResolvedValue(undefined);

      const response = await request(app)
        .patch(`/api/games/${gameId}/screenshots/${screenshotId}`)
        .send({ caption: "updated" });

      expect(response.status).toBe(404);
    });

    it("deletes a screenshot and its file", async () => {
      const screenshotDir = path.join(tempRoot, "screenshots", gameId);
      await fs.mkdir(screenshotDir, { recursive: true });
      const filePath = path.join(screenshotDir, "to-delete.png");
      await fs.writeFile(filePath, PNG_BYTES);

      const screenshot = {
        id: screenshotId,
        gameId,
        userId: OWNER_ID,
        filePath,
        caption: null,
        createdAt: new Date(),
      } as GameScreenshot;
      vi.mocked(storage.getGameScreenshots).mockResolvedValue([screenshot]);
      vi.mocked(storage.deleteGameScreenshot).mockResolvedValue(screenshot);

      const response = await request(app).delete(
        `/api/games/${gameId}/screenshots/${screenshotId}`
      );

      expect(response.status).toBe(204);
      await expect(fs.access(filePath)).rejects.toThrow();
    });

    it("returns 404 deleting a screenshot that belongs to a different game", async () => {
      vi.mocked(storage.getGameScreenshots).mockResolvedValue([]);

      const response = await request(app).delete(
        `/api/games/${gameId}/screenshots/${screenshotId}`
      );

      expect(response.status).toBe(404);
      expect(storage.deleteGameScreenshot).not.toHaveBeenCalled();
    });

    it("returns 404 deleting a screenshot that doesn't exist", async () => {
      vi.mocked(storage.getGameScreenshots).mockResolvedValue([
        {
          id: screenshotId,
          gameId,
          userId: OWNER_ID,
          filePath: "/x.png",
          caption: null,
          createdAt: new Date(),
        } as GameScreenshot,
      ]);
      vi.mocked(storage.deleteGameScreenshot).mockResolvedValue(undefined);

      const response = await request(app).delete(
        `/api/games/${gameId}/screenshots/${screenshotId}`
      );

      expect(response.status).toBe(404);
    });
  });
});
