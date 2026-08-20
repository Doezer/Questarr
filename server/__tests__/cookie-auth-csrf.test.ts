import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import {
  mockConfig,
  createStorageMock,
  createIgdbMock,
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

// This suite, like auth-boundary.test.ts, intentionally does NOT mock
// ../auth.js or ../security.js: it exercises the real cookie-issuing,
// cookie-authenticating, and CSRF-checking wiring end-to-end via the real
// registerRoutes app, since this is the highest-risk change in this PR.
vi.mock("../storage.js", () => ({ storage: createStorageMock() }));
vi.mock("../igdb.js", () => ({ igdbClient: createIgdbMock() }));
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
vi.mock("../config.js", () => ({ config: mockConfig }));
vi.mock("../config-loader.js", () => ({ configLoader: createConfigLoaderMock() }));
vi.mock("../socket.js", () => createSocketMock());

const JWT_SECRET = mockConfig.auth.jwtSecret;
const TEST_USER = { id: "user-1", username: "testuser" };
const TEST_PASSWORD = "correct horse battery staple";

function tokenFor(id: string) {
  return jwt.sign({ id, username: TEST_USER.username }, JWT_SECRET);
}

/** Parse `Set-Cookie` response headers into a name -> {value, attrs} map for assertions. */
function parseSetCookies(setCookieHeader: string[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of setCookieHeader ?? []) {
    const [pair] = line.split(";");
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    out[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  return out;
}

describe("cookie-based auth + CSRF", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    const { storage } = await import("../storage.js");
    const { hashPassword } = await import("../auth.js");
    const passwordHash = await hashPassword(TEST_PASSWORD);

    (storage.countUsers as ReturnType<typeof vi.fn>).mockResolvedValue(1);
    (storage.getSystemConfig as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (storage.getUser as ReturnType<typeof vi.fn>).mockResolvedValue(TEST_USER);
    (storage.getUserByUsername as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...TEST_USER,
      passwordHash,
    });
    (storage.assignOrphanGamesToUser as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (storage.markAllNotificationsAsRead as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const { db } = await import("../db.js");
    (db.get as ReturnType<typeof vi.fn>).mockResolvedValue({ result: 1 });

    const { igdbClient } = await import("../igdb.js");
    (igdbClient.getPopularGames as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const { registerRoutes } = await import("../routes.js");
    app = express();
    app.use(express.json());
    await registerRoutes(app);
  });

  async function login(agent: ReturnType<typeof request.agent>) {
    return agent
      .post("/api/auth/login")
      .send({ username: TEST_USER.username, password: TEST_PASSWORD });
  }

  it("sets an httpOnly auth cookie and a readable CSRF cookie on login", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ username: TEST_USER.username, password: TEST_PASSWORD });

    expect(res.status).toBe(200);
    // Still returned in the body for backward-compat bearer clients.
    expect(res.body.token).toEqual(expect.any(String));

    const setCookie = res.headers["set-cookie"] as unknown as string[] | undefined;
    expect(setCookie).toBeDefined();
    const raw = (setCookie ?? []).join("\n");

    expect(raw).toContain("questarr_auth=");
    expect(raw).toContain("questarr_csrf=");
    expect(raw.toLowerCase()).toMatch(/questarr_auth=[^;]+;[^\n]*httponly/i);
    // The CSRF cookie must NOT be httpOnly -- client JS needs to read it.
    const csrfLine = (setCookie ?? []).find((l) => l.startsWith("questarr_csrf="))!;
    expect(csrfLine.toLowerCase()).not.toContain("httponly");

    const cookies = parseSetCookies(setCookie);
    expect(cookies.questarr_auth).toBe(res.body.token);
    expect(cookies.questarr_csrf).toBe(res.body.token);
  });

  it("sets auth cookies on initial setup too", async () => {
    const { storage } = await import("../storage.js");
    (storage.countUsers as ReturnType<typeof vi.fn>).mockResolvedValue(0);
    (storage.registerSetupUser as ReturnType<typeof vi.fn>).mockResolvedValue(TEST_USER);

    const res = await request(app)
      .post("/api/auth/setup")
      .send({ username: "newadmin", password: "a-very-strong-password-123!" });

    expect(res.status).toBe(200);
    const setCookie = res.headers["set-cookie"] as unknown as string[] | undefined;
    expect((setCookie ?? []).join("\n")).toContain("questarr_auth=");
  });

  it("succeeds on a protected GET route using only the cookie, no bearer header", async () => {
    const agent = request.agent(app);
    const loginRes = await login(agent);
    expect(loginRes.status).toBe(200);

    // GET /api/auth/me requires authenticateToken; supertest's agent carries
    // the cookie jar automatically from the login response.
    const res = await agent.get("/api/auth/me");
    expect(res.status).toBe(200);
    expect(res.body.username).toBe(TEST_USER.username);
  });

  it("rejects a non-GET cookie-authenticated request with a missing CSRF header", async () => {
    const agent = request.agent(app);
    await login(agent);

    // No Origin/Referer and no X-CSRF-Token -- should be rejected.
    const res = await agent.put("/api/notifications/read-all");
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/csrf/i);
  });

  it("rejects a non-GET cookie-authenticated request with a mismatched CSRF header", async () => {
    const agent = request.agent(app);
    await login(agent);

    const res = await agent
      .put("/api/notifications/read-all")
      .set("X-CSRF-Token", "totally-wrong-token");
    expect(res.status).toBe(403);
  });

  it("succeeds on a non-GET cookie-authenticated request with a matching X-CSRF-Token header", async () => {
    const agent = request.agent(app);
    const loginRes = await login(agent);
    const csrfToken = loginRes.body.token as string;

    const res = await agent
      .put("/api/notifications/read-all")
      .set("X-CSRF-Token", csrfToken)
      .send();
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("bearer-token auth works end-to-end for a protected GET route", async () => {
    const res = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${tokenFor(TEST_USER.id)}`);
    expect(res.status).toBe(200);
    expect(res.body.username).toBe(TEST_USER.username);
  });

  it("bearer-token auth skips CSRF entirely on non-GET requests (no cookie, no CSRF header needed)", async () => {
    const res = await request(app)
      .put("/api/notifications/read-all")
      .set("Authorization", `Bearer ${tokenFor(TEST_USER.id)}`)
      .send();
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("rejects logout without a CSRF header (it's a non-GET cookie-authenticated request too)", async () => {
    const agent = request.agent(app);
    await login(agent);

    const res = await agent.post("/api/auth/logout").send();
    expect(res.status).toBe(403);
  });

  it("clears the auth cookies on logout when the CSRF header matches", async () => {
    const agent = request.agent(app);
    const loginRes = await login(agent);
    const csrfToken = loginRes.body.token as string;

    const res = await agent.post("/api/auth/logout").set("X-CSRF-Token", csrfToken).send();
    expect(res.status).toBe(200);

    const setCookie = res.headers["set-cookie"] as unknown as string[] | undefined;
    const raw = (setCookie ?? []).join("\n");
    // clearCookie sends an expired cookie with an empty value.
    expect(raw).toMatch(/questarr_auth=;/);
    expect(raw).toMatch(/questarr_csrf=;/);

    // The cookie session should no longer authenticate.
    const meRes = await agent.get("/api/auth/me");
    expect(meRes.status).toBe(401);
  });
});

describe("csrfProtection — Origin/Referer same-host fallback", () => {
  // Direct, deterministic unit coverage of the fallback path: a real
  // supertest server's Host header includes an ephemeral port that isn't
  // known ahead of time, so this is exercised directly against the
  // middleware rather than over the network.
  function fakeReqRes(overrides: {
    method?: string;
    authSource?: "cookie" | "bearer";
    cookieHeader?: string;
    csrfHeader?: string;
    origin?: string;
    referer?: string;
    host?: string;
  }) {
    const headers: Record<string, string> = { host: overrides.host ?? "questarr.example.com" };
    if (overrides.cookieHeader) headers.cookie = overrides.cookieHeader;
    if (overrides.origin) headers.origin = overrides.origin;
    if (overrides.referer) headers.referer = overrides.referer;

    const req = {
      method: overrides.method ?? "POST",
      authSource: overrides.authSource ?? "cookie",
      headers,
      header(name: string) {
        return headers[name.toLowerCase()];
      },
    } as unknown as import("express").Request;

    const res = {
      statusCode: 200,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json: vi.fn(),
    } as unknown as import("express").Response;

    return { req, res };
  }

  it("allows a same-host Origin even without a CSRF header", async () => {
    const { csrfProtection } = await import("../security.js");
    const next = vi.fn();
    const { req, res } = fakeReqRes({
      cookieHeader: "questarr_csrf=abc",
      origin: "https://questarr.example.com",
      host: "questarr.example.com",
    });

    csrfProtection(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.json).not.toHaveBeenCalled();
  });

  it("rejects a cross-site Origin (mismatched host) even with a cookie present", async () => {
    const { csrfProtection } = await import("../security.js");
    const next = vi.fn();
    const { req, res } = fakeReqRes({
      cookieHeader: "questarr_csrf=abc",
      origin: "https://evil.example.com",
      host: "questarr.example.com",
    });

    csrfProtection(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ error: "CSRF validation failed" });
  });

  it("falls back to Referer when Origin is absent", async () => {
    const { csrfProtection } = await import("../security.js");
    const next = vi.fn();
    const { req, res } = fakeReqRes({
      cookieHeader: "questarr_csrf=abc",
      referer: "https://questarr.example.com/settings",
      host: "questarr.example.com",
    });

    csrfProtection(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });
});
