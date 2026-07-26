import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import express from "express";
import { createApp as createServerApp } from "../app.js";

// Use vi.hoisted to create the mock object before hoisting occurs
const { mockConfig } = vi.hoisted(() => {
  return {
    mockConfig: {
      server: {
        isProduction: false,
        allowedOrigins: [],
      },
      igdb: {
        isConfigured: true,
        clientId: "test-id",
        clientSecret: "test-secret",
      },
      nexusmods: {
        apiKey: undefined,
      },
      auth: {
        jwtSecret: "test-secret",
      },
      database: {
        url: "test.db",
      },
      ssl: {
        enabled: false,
        port: 5000,
        certPath: "",
        keyPath: "",
        redirectHttp: false,
      },
    },
  };
});

// Mock dependencies
vi.mock("../db.js", () => ({
  db: {
    get: vi.fn(),
  },
  pool: {
    query: vi.fn(),
  },
}));

vi.mock("../storage.js", () => ({
  storage: {
    countUsers: vi.fn().mockResolvedValue(0),
    getSystemConfig: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock("../igdb.js", () => ({
  igdbClient: {
    getPopularGames: vi.fn(),
  },
}));

vi.mock("../torznab.js", () => ({
  torznabClient: {},
}));

vi.mock("../prowlarr.js", () => ({
  prowlarrClient: {},
}));

vi.mock("../config.js", () => ({
  config: mockConfig,
}));

vi.mock("../steam-routes.js", () => ({
  steamRoutes: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// Import registerRoutes AFTER mocking config
import { registerRoutes } from "../routes.js";

describe("Security Headers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset config to dev default
    mockConfig.server.isProduction = false;
  });

  afterEach(() => {
    vi.resetModules();
  });

  const createApp = async () => {
    const app = createServerApp();
    await registerRoutes(app);
    return app;
  };

  it("should set permissive CSP in development (non-production)", async () => {
    mockConfig.server.isProduction = false;
    const app = await createApp();
    const response = await request(app).get("/api/auth/status");

    expect(response.headers["content-security-policy"]).toBeDefined();
    const csp = response.headers["content-security-policy"];

    // Dev mode needs unsafe-inline/eval for Vite
    expect(csp).toContain("'unsafe-inline'");
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).toContain("https://images.igdb.com");
  });

  it("should set strict CSP in production", async () => {
    mockConfig.server.isProduction = true;
    const app = await createApp();
    const response = await request(app).get("/api/auth/status");

    expect(response.headers["content-security-policy"]).toBeDefined();
    const csp = response.headers["content-security-policy"] as string;

    // Prod mode should NOT have unsafe directives in script-src
    const scriptSrc = csp.split(";").find((d) => d.trim().startsWith("script-src"));
    expect(scriptSrc).toBeDefined();
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
    expect(csp).toContain("https://images.igdb.com");
  });

  // ZAP's baseline scan flags a bare scheme (e.g. "https:") in any directive as a
  // wildcard-directive alert (rule 10055) -- it permits loading from *any* host on that
  // scheme. This was fixed once already (font-src/style-src inherited it from helmet's
  // defaults); .zap/rules.tsv now also IGNOREs a *different* alert under the same plugin
  // ID (style-src unsafe-inline, kept deliberately -- see docs/SECURITY_ASSESSMENT.md),
  // and ZAP's IGNORE granularity is per-plugin, not per-alert, so a regression of the
  // wildcard-directive issue specifically would no longer fail the DAST scan. This test
  // is the compensating control for that gap.
  it("should not reintroduce a bare scheme wildcard into any CSP directive", async () => {
    // Production mode is what dast.yml actually scans; dev mode legitimately adds "ws:"/
    // "wss:" to connect-src for Vite HMR, which isn't the wildcard pattern being guarded
    // against here.
    mockConfig.server.isProduction = true;
    const app = await createApp();
    const response = await request(app).get("/api/auth/status");

    expect(response.status).toBe(200);
    expect(response.headers["content-security-policy"]).toBeDefined();
    const csp = response.headers["content-security-policy"] as string;

    for (const directive of csp.split(";")) {
      const values = directive.trim().split(/\s+/).slice(1);
      for (const value of values) {
        expect(value).not.toMatch(/^(https?|ftp):$/);
      }
    }
  });

  it.each([
    ["x-frame-options", "SAMEORIGIN"],
    ["x-content-type-options", "nosniff"],
    ["x-powered-by", undefined],
    [
      "permissions-policy",
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
    ],
  ])("should set %s header to %j", async (headerName, expectedValue) => {
    const app = await createApp();
    const response = await request(app).get("/api/auth/status");
    expect(response.headers[headerName]).toBe(expectedValue);
  });
});

describe("Credential Exposure Prevention", () => {
  afterEach(() => {
    vi.resetModules();
  });

  const createApp = async () => {
    const app = express();
    app.use(express.json());
    await registerRoutes(app);
    return app;
  };

  it("should not expose IGDB clientId in the unauthenticated /api/config response", async () => {
    const app = await createApp();
    const response = await request(app).get("/api/config");

    expect(response.status).toBe(200);
    expect(response.body).not.toHaveProperty("igdb.clientId");
    // The public endpoint should only return whether IGDB is configured
    expect(response.body.igdb).toHaveProperty("configured");
  });

  it("should not expose IGDB clientSecret in the unauthenticated /api/config response", async () => {
    const app = await createApp();
    const response = await request(app).get("/api/config");

    expect(response.status).toBe(200);
    expect(response.body).not.toHaveProperty("igdb.clientSecret");
  });
});
