import { beforeEach, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { pcgamingwikiRouter, pcgwCache, lookupPcgwUrl } from "../pcgamingwiki-router.js";

vi.mock("../ssrf.js", () => ({
  safeFetch: vi.fn(),
  isSafeUrl: vi.fn().mockResolvedValue(true),
}));

vi.mock("../auth.js", () => ({
  authenticateToken: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

vi.mock("../logger.js", () => ({
  routesLogger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

import { safeFetch } from "../ssrf.js";

function makeCargoResponse(pageName: string | null) {
  const cargoquery = pageName ? [{ title: { _pageName: pageName } }] : [];
  return {
    ok: true,
    json: vi.fn().mockResolvedValue({ cargoquery }),
  };
}

describe("GET /api/external/pcgamingwiki", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    pcgwCache.clear();
    app = express();
    app.use(express.json());
    app.use(pcgamingwikiRouter);
  });

  it("returns direct wiki URL when page is found", async () => {
    vi.mocked(safeFetch).mockResolvedValue(makeCargoResponse("Phantom Fury") as never);

    const res = await request(app).get("/api/external/pcgamingwiki?steamAppId=1733240");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ url: "https://www.pcgamingwiki.com/wiki/Phantom_Fury" });
    expect(safeFetch).toHaveBeenCalledOnce();
  });

  it("returns null url when cargoquery is empty", async () => {
    vi.mocked(safeFetch).mockResolvedValue(makeCargoResponse(null) as never);

    const res = await request(app).get("/api/external/pcgamingwiki?steamAppId=9999999");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ url: null });
  });

  it("returns 400 when steamAppId is missing", async () => {
    const res = await request(app).get("/api/external/pcgamingwiki");

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/steamAppId/);
    expect(safeFetch).not.toHaveBeenCalled();
  });

  it("returns 400 when steamAppId is not a positive integer", async () => {
    const [resZero, resNeg, resFloat, resStr] = await Promise.all([
      request(app).get("/api/external/pcgamingwiki?steamAppId=0"),
      request(app).get("/api/external/pcgamingwiki?steamAppId=-1"),
      request(app).get("/api/external/pcgamingwiki?steamAppId=1.5"),
      request(app).get("/api/external/pcgamingwiki?steamAppId=abc"),
    ]);

    expect(resZero.status).toBe(400);
    expect(resNeg.status).toBe(400);
    expect(resFloat.status).toBe(400);
    expect(resStr.status).toBe(400);
    expect(safeFetch).not.toHaveBeenCalled();
  });

  it("returns null url gracefully when safeFetch throws", async () => {
    vi.mocked(safeFetch).mockRejectedValue(new Error("network error"));

    const res = await request(app).get("/api/external/pcgamingwiki?steamAppId=1733240");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ url: null });
  });

  it("uses cache on second request — safeFetch called only once", async () => {
    vi.mocked(safeFetch).mockResolvedValue(makeCargoResponse("Phantom Fury") as never);

    await request(app).get("/api/external/pcgamingwiki?steamAppId=1733240");
    const res = await request(app).get("/api/external/pcgamingwiki?steamAppId=1733240");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ url: "https://www.pcgamingwiki.com/wiki/Phantom_Fury" });
    expect(safeFetch).toHaveBeenCalledOnce();
  });
});

describe("lookupPcgwUrl (unit)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pcgwCache.clear();
  });

  it("encodes page names with spaces using underscores", async () => {
    vi.mocked(safeFetch).mockResolvedValue(makeCargoResponse("Red Dead Redemption 2") as never);

    const url = await lookupPcgwUrl(1174180);

    expect(url).toBe("https://www.pcgamingwiki.com/wiki/Red_Dead_Redemption_2");
  });

  it("caches failures with a short TTL so transient errors are retried sooner", async () => {
    vi.mocked(safeFetch).mockRejectedValue(new Error("network error"));
    const before = Date.now();

    await lookupPcgwUrl(1733240);

    const entry = pcgwCache.get(1733240);
    expect(entry).toBeDefined();
    expect(entry!.url).toBeNull();
    // Failure TTL should be ≤ 5 minutes, well below the 24-hour success TTL
    expect(entry!.expires).toBeLessThan(before + 6 * 60 * 1000);
  });

  it("caches successful results with the full 24-hour TTL", async () => {
    vi.mocked(safeFetch).mockResolvedValue(makeCargoResponse("Phantom Fury") as never);
    const before = Date.now();

    await lookupPcgwUrl(1733240);

    const entry = pcgwCache.get(1733240);
    expect(entry).toBeDefined();
    expect(entry!.url).not.toBeNull();
    // Success TTL should be close to 24 hours
    expect(entry!.expires).toBeGreaterThan(before + 23 * 60 * 60 * 1000);
  });
});
