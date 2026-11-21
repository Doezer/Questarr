import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const client = {
  expandLinks: vi.fn(),
  checkLinks: vi.fn(),
  addLinks: vi.fn(),
};

vi.mock("../storage.js", () => ({
  storage: {
    getGame: vi.fn(),
    getDownloader: vi.fn(),
    getEnabledDownloaders: vi.fn(),
    addGameDownload: vi.fn(),
    updateGameStatus: vi.fn(),
    updateGameSearchResultsAvailable: vi.fn(),
  },
}));
vi.mock("../middleware.js", () => ({
  sensitiveEndpointLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../downloaders/realdebrid.js", () => ({
  RealDebridClient: class {
    expandLinks = client.expandLinks;
    checkLinks = client.checkLinks;
    addLinks = client.addLinks;
  },
}));
vi.mock("../logger.js", () => {
  const l = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { logger: l, routesLogger: l };
});

import { ddlRouter } from "../routes/ddl.js";
import { storage } from "../storage.js";

const RD = { id: "rd-1", type: "realdebrid", enabled: true };

function makeApp(userId = "u1") {
  const app = express();
  app.use(express.json({ limit: "5mb" }));
  app.use((req, _res, next) => {
    req.user = { id: userId } as never;
    next();
  });
  app.use("/api/games/:gameId/ddl", ddlRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(storage.getGame).mockResolvedValue({
    id: "g1",
    title: "Some Game",
    userId: "u1",
  } as never);
  vi.mocked(storage.getEnabledDownloaders).mockResolvedValue([
    { id: "qb", type: "qbittorrent" },
    RD,
  ] as never);
  vi.mocked(storage.getDownloader).mockResolvedValue(RD as never);
  client.expandLinks.mockImplementation(async (links: string[]) => links);
});

describe("direct-download routes", () => {
  it("returns 404 for an unknown game and 403 for another user's game", async () => {
    vi.mocked(storage.getGame).mockResolvedValueOnce(undefined);
    await request(makeApp())
      .post("/api/games/g1/ddl/check")
      .send({ links: "https://a.example/x" })
      .expect(404);
    await request(makeApp("other"))
      .post("/api/games/g1/ddl/check")
      .send({ links: "https://a.example/x" })
      .expect(403);
  });

  it("rejects a request with no usable links, a bad body or no Real-Debrid downloader", async () => {
    await request(makeApp())
      .post("/api/games/g1/ddl/links")
      .send({ links: "no links here" })
      .expect(400);
    await request(makeApp()).post("/api/games/g1/ddl/links").send({ links: 12 }).expect(400);
    vi.mocked(storage.getEnabledDownloaders).mockResolvedValue([
      { id: "qb", type: "qbittorrent" },
    ] as never);
    await request(makeApp())
      .post("/api/games/g1/ddl/links")
      .send({ links: "https://a.example/x" })
      .expect(400);
    vi.mocked(storage.getDownloader).mockResolvedValue({ id: "qb", type: "qbittorrent" } as never);
    await request(makeApp())
      .post("/api/games/g1/ddl/links")
      .send({ links: "https://a.example/x", downloaderId: "qb" })
      .expect(400);
  });

  it("rejects an empty or oversized container file", async () => {
    await request(makeApp())
      .post("/api/games/g1/ddl/check")
      .send({ containerBase64: "" })
      .expect(400);
    const big = Buffer.alloc(1024 * 1024 + 1).toString("base64");
    await request(makeApp())
      .post("/api/games/g1/ddl/check")
      .send({ containerBase64: big })
      .expect(400);
  });

  it("checks the pasted links and returns their health", async () => {
    client.checkLinks.mockResolvedValue([{ link: "https://a.example/x", supported: true }]);
    const res = await request(makeApp())
      .post("/api/games/g1/ddl/check")
      .send({ links: "see https://a.example/x and https://a.example/x" })
      .expect(200);
    expect(client.expandLinks).toHaveBeenCalledWith(["https://a.example/x"], undefined);
    expect(res.body.links).toEqual([{ link: "https://a.example/x", supported: true }]);
  });

  it("passes a container file to the client", async () => {
    client.checkLinks.mockResolvedValue([]);
    client.expandLinks.mockResolvedValueOnce(["https://a.example/from-dlc"]);
    await request(makeApp())
      .post("/api/games/g1/ddl/check")
      .send({ containerBase64: Buffer.from("DLC").toString("base64") })
      .expect(200);
    expect(client.expandLinks).toHaveBeenCalledWith([], Buffer.from("DLC"));
  });

  it("sends the links and tracks the download against the game", async () => {
    client.addLinks.mockResolvedValue({ success: true, id: "ddlabc", message: "ok" });
    const res = await request(makeApp())
      .post("/api/games/g1/ddl/links")
      .send({
        links: "https://a.example/x\nhttps://a.example/y",
        archivePassword: "pw",
        title: "Custom",
      })
      .expect(200);
    expect(res.body).toEqual({ success: true, id: "ddlabc", links: 2 });
    expect(client.addLinks).toHaveBeenCalledWith({
      gameId: "g1",
      title: "Custom",
      links: ["https://a.example/x", "https://a.example/y"],
      password: "pw",
    });
    expect(storage.addGameDownload).toHaveBeenCalledWith(
      expect.objectContaining({
        gameId: "g1",
        downloaderId: "rd-1",
        downloadHash: "ddlabc",
        status: "downloading",
      })
    );
    expect(storage.updateGameStatus).toHaveBeenCalledWith(
      "g1",
      { status: "downloading" },
      { preserveCurated: true }
    );
  });

  it("reports a Real-Debrid failure without tracking anything", async () => {
    client.addLinks.mockResolvedValue({ success: false, message: "boom" });
    await request(makeApp())
      .post("/api/games/g1/ddl/links")
      .send({ links: "https://a.example/x" })
      .expect(502);
    expect(storage.addGameDownload).not.toHaveBeenCalled();

    client.expandLinks.mockRejectedValueOnce(new Error("rd down"));
    await request(makeApp())
      .post("/api/games/g1/ddl/check")
      .send({ links: "https://a.example/x" })
      .expect(502);
  });
});
