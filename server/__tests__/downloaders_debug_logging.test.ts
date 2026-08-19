import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../logger.js", () => ({
  downloadersLogger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock("../ssrf.js", () => ({
  isSafeUrl: vi.fn().mockResolvedValue(true),
  safeFetch: vi.fn(),
}));

import { downloadersLogger } from "../logger.js";
import {
  isDownloaderDebugLoggingEnabled,
  setCachedDownloaderDebugLogging,
} from "../downloaders/debug-logging.js";
import { logDownloaderDebugResponse, redactSensitiveUrl } from "../downloaders/utils.js";

describe("downloader debug-logging toggle", () => {
  beforeEach(() => {
    setCachedDownloaderDebugLogging(false);
    vi.clearAllMocks();
  });

  it("defaults to disabled", () => {
    expect(isDownloaderDebugLoggingEnabled()).toBe(false);
  });

  it("reflects the cached value after being set", () => {
    setCachedDownloaderDebugLogging(true);
    expect(isDownloaderDebugLoggingEnabled()).toBe(true);

    setCachedDownloaderDebugLogging(false);
    expect(isDownloaderDebugLoggingEnabled()).toBe(false);
  });
});

describe("redactSensitiveUrl", () => {
  it("masks known secret-bearing query params", () => {
    const redacted = redactSensitiveUrl(
      "http://prowlarr.local/4/download?apikey=supersecret&file=game.torrent"
    );
    expect(redacted).toContain("apikey=***");
    expect(redacted).not.toContain("supersecret");
    expect(redacted).toContain("file=game.torrent");
  });

  it("masks Synology-style passwd/_sid params", () => {
    const redacted = redactSensitiveUrl(
      "http://nas.local/webapi/auth.cgi?account=admin&passwd=hunter2&_sid=abc123"
    );
    expect(redacted).not.toContain("hunter2");
    expect(redacted).not.toContain("abc123");
    expect(redacted).toContain("account=admin");
  });

  it("returns the original string when the URL can't be parsed", () => {
    expect(redactSensitiveUrl("not a url")).toBe("not a url");
  });

  it("leaves non-sensitive query params untouched", () => {
    const redacted = redactSensitiveUrl("http://host/api?mode=queue&output=json");
    expect(redacted).toBe("http://host/api?mode=queue&output=json");
  });
});

describe("logDownloaderDebugResponse", () => {
  beforeEach(() => {
    setCachedDownloaderDebugLogging(false);
    vi.clearAllMocks();
  });

  it("does nothing when the toggle is disabled", async () => {
    const response = new Response("body", { status: 200 });
    const cloneSpy = vi.spyOn(response, "clone");

    await logDownloaderDebugResponse("qBittorrent", "GET", "http://host/api", response);

    expect(cloneSpy).not.toHaveBeenCalled();
    expect(downloadersLogger.debug).not.toHaveBeenCalled();
  });

  it("logs the full response body and redacted URL when enabled", async () => {
    setCachedDownloaderDebugLogging(true);
    const response = new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

    await logDownloaderDebugResponse(
      "sabnzbd",
      "GET",
      "http://sab.local/api?apikey=secret123&mode=queue",
      response
    );

    expect(downloadersLogger.debug).toHaveBeenCalledTimes(1);
    const [payload, message] = (downloadersLogger.debug as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(message).toBe("Downloader debug: full response");
    expect(payload.client).toBe("sabnzbd");
    expect(payload.responseStatus).toBe(200);
    expect(payload.responseBody).toBe(JSON.stringify({ ok: true }));
    expect(payload.url).not.toContain("secret123");
  });

  it("truncates very large response bodies", async () => {
    setCachedDownloaderDebugLogging(true);
    const hugeBody = "x".repeat(20_000);
    const response = new Response(hugeBody, { status: 200 });

    await logDownloaderDebugResponse("Transmission", "POST", "http://host/rpc", response);

    const [payload] = (downloadersLogger.debug as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(payload.responseBody.length).toBeLessThan(hugeBody.length);
    expect(payload.responseBody).toContain("truncated");
  });

  it("still leaves the response body readable by the caller afterwards", async () => {
    setCachedDownloaderDebugLogging(true);
    const response = new Response("hello world", { status: 200 });

    await logDownloaderDebugResponse("Deluge", "POST", "http://host/json", response);

    await expect(response.text()).resolves.toBe("hello world");
  });
});
