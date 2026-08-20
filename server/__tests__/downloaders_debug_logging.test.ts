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
import { safeFetch } from "../ssrf.js";
import { QBittorrentClient } from "../downloaders/qbittorrent.js";
import type { Downloader } from "../../shared/schema.js";

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

  it("handles a response with no body", async () => {
    setCachedDownloaderDebugLogging(true);
    const response = new Response(null, { status: 204 });

    await logDownloaderDebugResponse("nzbget", "DELETE", "http://host/api", response);

    const [payload] = (downloadersLogger.debug as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(payload.responseBody).toBe("");
    expect(payload.responseStatus).toBe(204);
  });

  it("logs a warning instead of throwing when reading the response fails", async () => {
    setCachedDownloaderDebugLogging(true);
    const response = new Response("body", { status: 200 });
    vi.spyOn(response, "clone").mockImplementation(() => {
      throw new Error("clone boom");
    });

    await expect(
      logDownloaderDebugResponse("rTorrent", "POST", "http://host/api?apikey=secret", response)
    ).resolves.toBeUndefined();

    expect(downloadersLogger.debug).not.toHaveBeenCalled();
    expect(downloadersLogger.warn).toHaveBeenCalledTimes(1);
    const [payload, message] = (downloadersLogger.warn as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(message).toBe("Failed to log downloader debug response");
    expect(payload.client).toBe("rTorrent");
    expect(payload.url).not.toContain("secret");
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

  it("leaves the original body readable after a truncated (large) response", async () => {
    setCachedDownloaderDebugLogging(true);
    const hugeBody = "x".repeat(20_000);
    const response = new Response(hugeBody, { status: 200 });

    await logDownloaderDebugResponse("Transmission", "POST", "http://host/rpc", response);

    await expect(response.text()).resolves.toBe(hugeBody);
  });

  it("does not hang reading a response whose stream never ends past the cap", async () => {
    setCachedDownloaderDebugLogging(true);
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        // First chunk alone already reaches the 10KB cap.
        controller.enqueue(encoder.encode("x".repeat(10_000)));
      },
      pull() {
        // Every subsequent pull hangs forever - simulates an unbounded/never-ending response.
        return new Promise(() => {});
      },
    });
    const response = new Response(stream);

    await expect(
      logDownloaderDebugResponse("qBittorrent", "GET", "http://host/api", response)
    ).resolves.toBeUndefined();

    const [payload] = (downloadersLogger.debug as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(payload.responseBody).toContain("truncated");
  });

  it("redacts credential-bearing response headers", async () => {
    setCachedDownloaderDebugLogging(true);
    const response = new Response("{}", {
      status: 200,
      headers: {
        "set-cookie": "_session_id=supersecretcookie",
        "x-transmission-session-id": "abc123session",
        "content-type": "application/json",
      },
    });

    await logDownloaderDebugResponse("Deluge", "POST", "http://host/json", response);

    const [payload] = (downloadersLogger.debug as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(payload.responseHeaders["set-cookie"]).toBe("***");
    expect(payload.responseHeaders["x-transmission-session-id"]).toBe("***");
    expect(payload.responseHeaders["content-type"]).toBe("application/json");
  });

  it("redacts credential-bearing fields in a JSON response body", async () => {
    setCachedDownloaderDebugLogging(true);
    const response = new Response(
      JSON.stringify({ sid: "abc123", success: true, data: { _sid: "def456" } }),
      { status: 200 }
    );

    await logDownloaderDebugResponse("Synology", "POST", "http://host/webapi", response);

    const [payload] = (downloadersLogger.debug as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(payload.responseBody).not.toContain("abc123");
    expect(payload.responseBody).not.toContain("def456");
    expect(payload.responseBody).toContain('"sid":"***"');
    expect(payload.responseBody).toContain("success");
  });
});

describe("qBittorrent authenticate() debug logging", () => {
  const createDownloader = (overrides: Partial<Downloader> = {}): Downloader => {
    const now = new Date("2024-01-01T00:00:00.000Z");
    return {
      id: "qb-debug",
      name: "qBittorrent",
      type: "qbittorrent",
      url: "http://localhost:8080",
      enabled: true,
      priority: 1,
      port: null,
      useSsl: false,
      urlPath: null,
      username: "admin",
      password: "password",
      downloadPath: null,
      category: null,
      label: null,
      addStopped: false,
      removeCompleted: false,
      postImportCategory: null,
      settings: null,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
  };

  beforeEach(() => {
    setCachedDownloaderDebugLogging(false);
    vi.clearAllMocks();
  });

  it("logs the login response, including on a failed login", async () => {
    setCachedDownloaderDebugLogging(true);
    const client = new QBittorrentClient(createDownloader()) as unknown as {
      authenticate(force?: boolean): Promise<void>;
    };

    vi.mocked(safeFetch).mockResolvedValueOnce(
      new Response("Fails.", { status: 200, headers: { "set-cookie": "SID=abc123" } })
    );

    await expect(client.authenticate(true)).rejects.toThrow("Authentication failed");

    expect(downloadersLogger.debug).toHaveBeenCalledWith(
      expect.objectContaining({
        client: "qBittorrent",
        responseHeaders: expect.objectContaining({ "set-cookie": "***" }),
      }),
      "Downloader debug: full response"
    );
  });
});
