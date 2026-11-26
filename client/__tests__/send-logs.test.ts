/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const supportConfigState = vi.hoisted(() => ({
  workerUrl: "https://support.example/workers/logs",
  issuesUrl: "https://github.com/Doezer/Questarr/issues/new",
}));

vi.mock("../src/lib/support-config", () => ({
  get SUPPORT_WORKER_URL() {
    return supportConfigState.workerUrl;
  },
  get GITHUB_ISSUES_URL() {
    return supportConfigState.issuesUrl;
  },
}));

import {
  buildGitHubIssueUrl,
  detectPlatform,
  findRecentDuplicate,
  loadSentReports,
  prepareReport,
  recordSentReport,
  scrubLogLines,
  scrubPii,
  sendLogs,
} from "../src/lib/send-logs";

describe("send-logs utilities", () => {
  const originalFetch = globalThis.fetch;
  const originalUserAgent = globalThis.navigator.userAgent;

  beforeEach(() => {
    vi.restoreAllMocks();
    supportConfigState.workerUrl = "https://support.example/workers/logs";
    supportConfigState.issuesUrl = "https://github.com/Doezer/Questarr/issues/new";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis.navigator, "userAgent", {
      configurable: true,
      value: originalUserAgent,
    });
  });

  it("scrubs common PII patterns from log text", () => {
    const ipv4 = ["192", "168", "1", "12"].join(".");
    const ipv6 = ["2001", "0db8", "85a3", "0000", "0000", "8a2e", "0370", "7334"].join(":");
    const input = [
      "email=user@example.com",
      `ipv4=${ipv4}`,
      `ipv6=${ipv6}`,
      "uuid=123e4567-e89b-12d3-a456-426614174000",
      "token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature",
      "unix=/home/alice/questarr/logs/app.log",
      String.raw`win=C:\Users\alice\Questarr\logs\app.log`,
    ].join(" ");

    // The `token=` prefix is itself secret-shaped, so it's caught (and
    // labeled) by the API-key/token redaction pass rather than the
    // JWT-specific one -- either way the token value never survives.
    expect(scrubPii(input)).toBe(
      "email=[email] ipv4=[ip:lan] ipv6=[ip:public] uuid=[uuid] token=[redacted] unix=/home/[user]/questarr/logs/app.log win=C:\\Users\\[user]\\Questarr\\logs\\app.log"
    );
  });

  it("redacts a bare JWT with no key= prefix using the JWT-specific label", () => {
    expect(scrubPii("Authorization: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature")).toBe(
      "Authorization: [jwt]"
    );
  });

  it("scrubs each line before joining them", () => {
    const privateIp = ["10", "0", "0", "1"].join(".");
    expect(scrubLogLines(["user@example.com", privateIp])).toBe("[email]\n[ip:lan]");
  });

  it("keeps clock timestamps while still scrubbing compressed IPv6 addresses", () => {
    expect(scrubPii("time=12:34:56 client=::1 local=fe80::")).toBe(
      "time=12:34:56 client=[ip:loopback] local=[ip:lan]"
    );
  });

  it("returns a configuration error when log upload is not configured", async () => {
    supportConfigState.workerUrl = "https://questarr-log-collector.REPLACE_ME.workers.dev";

    await expect(
      sendLogs({
        logs: "hello",
        appVersion: "1.4.0",
        platform: "Windows",
        timestamp: "2026-05-31T12:00:00.000Z",
      })
    ).resolves.toEqual({
      ok: false,
      status: 0,
      message: "Log upload is not configured for this build.",
    });
  });

  it("posts scrubbed logs and returns the support code on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: "ABCD", issueNumber: 123 }),
    } satisfies Partial<Response>);
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(
      sendLogs({
        logs: "hello",
        appVersion: "1.4.0",
        platform: "Windows",
        timestamp: "2026-05-31T12:00:00.000Z",
      })
    ).resolves.toEqual({
      ok: true,
      code: "ABCD",
      issueNumber: 123,
    });

    expect(fetchMock).toHaveBeenCalledWith("https://support.example/workers/logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        logs: "hello",
        appVersion: "1.4.0",
        platform: "Windows",
        timestamp: "2026-05-31T12:00:00.000Z",
      }),
    });
  });

  it("surfaces invalid success payloads as failures", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => {
        throw new SyntaxError("Unexpected end of JSON input");
      },
    }) as typeof fetch;

    await expect(
      sendLogs({
        logs: "hello",
        appVersion: "1.4.0",
        platform: "Windows",
        timestamp: "2026-05-31T12:00:00.000Z",
      })
    ).resolves.toEqual({
      ok: false,
      status: 0,
      message: "Unexpected end of JSON input",
    });
  });

  it("prefers the worker error payload when the upload fails", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({ error: "GitHub rejected the gist request." }),
    }) as typeof fetch;

    await expect(
      sendLogs({
        logs: "hello",
        appVersion: "1.4.0",
        platform: "Windows",
        timestamp: "2026-05-31T12:00:00.000Z",
      })
    ).resolves.toEqual({
      ok: false,
      status: 502,
      message: "GitHub rejected the gist request.",
    });
  });

  it("surfaces network failures", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("offline")) as typeof fetch;

    await expect(
      sendLogs({
        logs: "hello",
        appVersion: "1.4.0",
        platform: "Windows",
        timestamp: "2026-05-31T12:00:00.000Z",
      })
    ).resolves.toEqual({
      ok: false,
      status: 0,
      message: "offline",
    });
  });

  it("builds a prefilled GitHub issue URL", () => {
    const issueUrl = buildGitHubIssueUrl("ABCD", "1.4.0", 123);

    expect(issueUrl).toContain("https://github.com/Doezer/Questarr/issues/new?");
    expect(decodeURIComponent(issueUrl)).toContain("[Support] Issue with Questarr v1.4.0");
    expect(decodeURIComponent(issueUrl)).toContain("**App version:** 1.4.0");
    expect(decodeURIComponent(issueUrl)).toContain(
      "**Support log #:** `ABCD` (Doezer/Questarr-logs#123)"
    );
  });

  it("detects the current platform from the browser user agent", () => {
    Object.defineProperty(globalThis.navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    });
    expect(detectPlatform()).toBe("Windows");

    Object.defineProperty(globalThis.navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 (X11; Linux x86_64)",
    });
    expect(detectPlatform()).toBe("Linux");

    Object.defineProperty(globalThis.navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
    });
    expect(detectPlatform()).toBe("iOS");
  });
});

describe("prepareReport and duplicate detection", () => {
  const failing = JSON.stringify({
    level: 50,
    time: "2026-11-26T10:00:00.000Z",
    module: "downloaders",
    msg: "Download check failed",
    error: { name: "Error", code: "ECONNREFUSED", message: "connect refused" },
  });

  beforeEach(() => {
    localStorage.clear();
  });

  it("builds the summary header, title, labels and scrubbed note ahead of the logs", () => {
    const report = prepareReport({
      logLines: [failing, failing],
      diagnostics: "=== DIAG ===",
      note: "  tried a search from user@example.com  ",
      appVersion: "1.7.0",
      platform: "Linux",
    });

    expect(report.title).toBe(
      "Support log v1.7.0 - downloaders: Download check failed: Error ECONNREFUSED: connect refused"
    );
    expect(report.labels).toEqual([
      "trigger:manual",
      "version:1.7.0",
      "platform:linux",
      "module:downloaders",
    ]);
    expect(report.note).not.toContain("user@example.com");
    expect(report.logs.indexOf("=== ERROR SUMMARY")).toBeLessThan(report.logs.indexOf("=== DIAG"));
    expect(report.logs).toContain("2x [downloaders] Download check failed");
    expect(report.logs.indexOf("=== DIAG")).toBeLessThan(report.logs.indexOf('"msg"'));
  });

  it("flags an identical report sent within the hour and forgets it afterwards", () => {
    const now = Date.UTC(2026, 10, 26, 12, 0, 0);
    const { signature } = prepareReport({
      logLines: [failing],
      diagnostics: "",
      note: "",
      appVersion: "1.7.0",
      platform: "Linux",
    });

    expect(findRecentDuplicate([failing], now)).toBeUndefined();
    recordSentReport(signature, "ABCD", now);
    expect(findRecentDuplicate([failing], now + 60_000)?.code).toBe("ABCD");
    expect(findRecentDuplicate([failing], now + 2 * 60 * 60 * 1000)).toBeUndefined();
  });

  it("survives unavailable or corrupt storage", () => {
    localStorage.setItem("questarr.sentSupportReports", "not json");
    expect(loadSentReports()).toEqual([]);

    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(() => recordSentReport("sig", "ABCD", Date.now())).not.toThrow();
    spy.mockRestore();
  });
});
