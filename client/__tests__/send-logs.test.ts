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
  scrubLogLines,
  scrubPii,
  sendLogs,
} from "../src/lib/send-logs";

describe("send-logs utilities", () => {
  const originalFetch = global.fetch;
  const originalUserAgent = window.navigator.userAgent;

  beforeEach(() => {
    vi.restoreAllMocks();
    supportConfigState.workerUrl = "https://support.example/workers/logs";
    supportConfigState.issuesUrl = "https://github.com/Doezer/Questarr/issues/new";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    Object.defineProperty(window.navigator, "userAgent", {
      configurable: true,
      value: originalUserAgent,
    });
  });

  it("scrubs common PII patterns from log text", () => {
    const input = [
      "email=user@example.com",
      "ipv4=192.168.1.12",
      "ipv6=2001:0db8:85a3:0000:0000:8a2e:0370:7334",
      "uuid=123e4567-e89b-12d3-a456-426614174000",
      "token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature",
      "unix=/home/alice/questarr/logs/app.log",
      String.raw`win=C:\Users\alice\Questarr\logs\app.log`,
    ].join(" ");

    expect(scrubPii(input)).toBe(
      "email=[email] ipv4=[ip] ipv6=[ip] uuid=[uuid] token=[jwt] unix=/home/[user]/questarr/logs/app.log win=C:\\Users\\[user]\\Questarr\\logs\\app.log"
    );
  });

  it("scrubs each line before joining them", () => {
    expect(scrubLogLines(["user@example.com", "10.0.0.1"])).toBe("[email]\n[ip]");
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
      json: async () => ({ code: "ABCD", gistId: "gist-123" }),
    } satisfies Partial<Response>);
    global.fetch = fetchMock as typeof fetch;

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
      gistId: "gist-123",
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

  it("prefers the worker error payload when the upload fails", async () => {
    global.fetch = vi.fn().mockResolvedValue({
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
    global.fetch = vi.fn().mockRejectedValue(new Error("offline")) as typeof fetch;

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
    const issueUrl = buildGitHubIssueUrl("ABCD", "1.4.0");

    expect(issueUrl).toContain("https://github.com/Doezer/Questarr/issues/new?");
    expect(decodeURIComponent(issueUrl)).toContain("[Support] Log code ABCD");
    expect(decodeURIComponent(issueUrl)).toContain("**App version:** 1.4.0");
  });

  it("detects the current platform from the browser user agent", () => {
    Object.defineProperty(window.navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    });
    expect(detectPlatform()).toBe("Windows");

    Object.defineProperty(window.navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 (X11; Linux x86_64)",
    });
    expect(detectPlatform()).toBe("Linux");

    Object.defineProperty(window.navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
    });
    expect(detectPlatform()).toBe("iOS");
  });
});
