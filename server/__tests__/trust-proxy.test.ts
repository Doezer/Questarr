import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import type { TrustProxySetting } from "../trust-proxy.js";

const mockServerConfig = vi.hoisted(() => ({
  trustProxy: false as TrustProxySetting,
  allowedOrigins: ["http://localhost:5000"],
  isProduction: true,
}));

vi.mock("../config.js", () => ({
  config: { server: mockServerConfig },
}));

vi.mock("../storage.js", () => ({ storage: {} }));

import { parseTrustProxy } from "../trust-proxy.js";
import { createApp } from "../app.js";
import { authRateLimiter } from "../middleware.js";
import { setAuthCookies } from "../security.js";

function buildApp() {
  const app = createApp();
  app.get("/ip", (req, res) => res.json({ ip: req.ip }));
  app.get("/login-cookie", (req, res) => {
    setAuthCookies(req, res, "token");
    res.send("ok");
  });
  return app;
}

describe("parseTrustProxy", () => {
  it("is off when unset or explicitly disabled", () => {
    for (const value of [undefined, "", " ", "false", "FALSE", "0", "no", "off"]) {
      expect(parseTrustProxy(value)).toBe(false);
    }
  });

  it('maps "true" to a single hop, never to trusting the whole chain', () => {
    expect(parseTrustProxy("true")).toBe(1);
    expect(parseTrustProxy("on")).toBe(1);
  });

  it("accepts a hop count", () => {
    expect(parseTrustProxy("1")).toBe(1);
    expect(parseTrustProxy("2")).toBe(2);
  });

  it("accepts addresses, subnets and Express's named subnets", () => {
    expect(parseTrustProxy("172.16.0.0/12")).toBe("172.16.0.0/12");
    expect(parseTrustProxy("::ffff:10.0.0.0/104")).toBe("::ffff:10.0.0.0/104");
    expect(parseTrustProxy("loopback, 10.0.0.5 ,fd00::/8")).toBe("loopback,10.0.0.5,fd00::/8");
  });

  it("rejects anything else", () => {
    for (const value of [
      "maybe",
      "11",
      "99999999999999999999",
      "10.0.0.0/33",
      "fd00::/129",
      "0.0.0.0/0",
      "::/0",
      "::ffff:10.0.0.0/96",
      "fe80::1%eth0/128",
      "fe80::1%eth0",
      "0:0:0:0:0:ffff:a00:0/90",
      "1.2.3",
      "loopback,",
      "a/b/c",
    ]) {
      expect(parseTrustProxy(value)).toBeNull();
    }
  });
});

describe("createApp trust proxy", () => {
  beforeEach(() => {
    mockServerConfig.trustProxy = false;
  });

  it("ignores X-Forwarded-For by default, even in production", async () => {
    const res = await request(buildApp()).get("/ip").set("X-Forwarded-For", "203.0.113.7");
    expect(res.body.ip).not.toBe("203.0.113.7");
  });

  it("takes the client IP from the trusted proxy hop when TRUST_PROXY is set", async () => {
    mockServerConfig.trustProxy = 1;
    const res = await request(buildApp())
      .get("/ip")
      .set("X-Forwarded-For", "198.51.100.1, 203.0.113.7");
    // The left-most entry is whatever the client sent; only the hop the
    // proxy appended counts.
    expect(res.body.ip).toBe("203.0.113.7");
  });

  it("does not let a spoofed X-Forwarded-For dodge the login limiter", async () => {
    const app = createApp();
    app.post("/login", authRateLimiter, (_req, res) => res.send("ok"));

    let last = 0;
    for (let i = 0; i < 21; i++) {
      const res = await request(app).post("/login").set("X-Forwarded-For", `198.51.100.${i}`);
      last = res.status;
    }
    expect(last).toBe(429);
  });

  it("only marks auth cookies Secure from X-Forwarded-Proto behind a trusted proxy", async () => {
    const untrusted = await request(buildApp())
      .get("/login-cookie")
      .set("X-Forwarded-Proto", "https");
    expect(untrusted.headers["set-cookie"]?.[0]).not.toMatch(/;\s*Secure/i);

    mockServerConfig.trustProxy = 1;
    const trusted = await request(buildApp())
      .get("/login-cookie")
      .set("X-Forwarded-Proto", "https");
    expect(trusted.headers["set-cookie"]?.[0]).toMatch(/;\s*Secure/i);
  });
});
