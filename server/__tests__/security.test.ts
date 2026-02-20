import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import express from "express";

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
    getSystemConfig: vi.fn(),
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

// Import registerRoutes AFTER mocking config
import { registerRoutes } from "../routes.js";

describe("Security Headers", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset config to dev default
    mockConfig.server.isProduction = false;
  });

  afterEach(() => {
    vi.resetModules();
  });

  const createApp = async () => {
    app = express();
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

  it("should set X-Frame-Options header", async () => {
    const app = await createApp();
    const response = await request(app).get("/api/auth/status");
    expect(response.headers["x-frame-options"]).toBe("SAMEORIGIN");
  });

  it("should set X-Content-Type-Options header", async () => {
    const app = await createApp();
    const response = await request(app).get("/api/auth/status");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
  });
});
