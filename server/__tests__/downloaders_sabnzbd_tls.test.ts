import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Downloader } from "../../shared/schema.js";

const fetchMock = vi.fn();
const safeFetchMock = vi.fn();
const httpsRequestMock = vi.fn();

vi.mock("https", () => ({
  default: {
    request: httpsRequestMock,
  },
}));

const loggerWarnMock = vi.fn();
vi.mock("../logger.js", () => ({
  downloadersLogger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: loggerWarnMock,
  },
}));

vi.mock("../ssrf.js", () => ({
  isSafeUrl: vi.fn().mockResolvedValue(true),
  safeFetch: safeFetchMock,
  resolveSafeAddress: vi.fn().mockResolvedValue({ address: "127.0.0.1", family: 4 }),
}));

global.fetch = fetchMock as unknown as typeof fetch;

const { SABnzbdClient } = await import("../downloaders/sabnzbd.js");

const createDownloader = (overrides: Partial<Downloader> = {}): Downloader => {
  const now = new Date("2024-01-01T00:00:00.000Z");
  return {
    id: "sab-tls",
    name: "SABnzbd",
    type: "sabnzbd",
    url: "sab.local",
    enabled: true,
    priority: 1,
    port: null,
    useSsl: true,
    urlPath: null,
    username: "api-key",
    password: null,
    downloadPath: null,
    category: null,
    label: null,
    addStopped: false,
    removeCompleted: false,
    postImportCategory: null,
    settings: null,
    allowSelfSignedCertificate: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
};

class MockRequest extends EventEmitter {
  public writes: Array<Buffer | string> = [];
  destroy = vi.fn();
  write = vi.fn((chunk: Buffer | string) => {
    this.writes.push(chunk);
  });
  end = vi.fn();
}

const selfSignedError = () => {
  const err = new Error("self-signed certificate") as Error & { cause?: { code: string } };
  err.cause = { code: "DEPTH_ZERO_SELF_SIGNED_CERT" };
  return err;
};

describe("SABnzbd TLS self-signed-certificate opt-in", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    safeFetchMock.mockReset();
    httpsRequestMock.mockReset();
  });

  it("throws the original SSL error and never retries insecurely when allowSelfSignedCertificate is false/unset", async () => {
    safeFetchMock.mockRejectedValue(selfSignedError());

    const client = new SABnzbdClient(createDownloader({ allowSelfSignedCertificate: false }));

    const result = await client.testConnection();
    expect(result.success).toBe(false);
    expect(httpsRequestMock).not.toHaveBeenCalled();
    expect(loggerWarnMock).toHaveBeenCalledWith(
      expect.objectContaining({ downloaderId: "sab-tls", url: expect.any(String) }),
      expect.stringContaining("not retrying insecurely")
    );
    // The downloader's SABnzbd API key (its `username`) must never reach the
    // logger unredacted -- it's embedded in the request URL's `apikey` param.
    const [loggedFields] = loggerWarnMock.mock.calls[0];
    expect(loggedFields.url).not.toContain("api-key");
    expect(loggedFields.url).toContain("apikey=%5Bredacted%5D");
  });

  it("falls back to an insecure connection when allowSelfSignedCertificate is true", async () => {
    safeFetchMock.mockRejectedValue(selfSignedError());

    const mockReq = new MockRequest();
    httpsRequestMock.mockImplementation((_urlOrOptions, optionsOrCallback, maybeCallback) => {
      const callback = typeof optionsOrCallback === "function" ? optionsOrCallback : maybeCallback;
      const res = new EventEmitter() as EventEmitter & {
        headers: Record<string, string>;
        statusCode: number;
        statusMessage: string;
      };
      res.headers = { "content-type": "application/json" };
      res.statusCode = 200;
      res.statusMessage = "OK";
      queueMicrotask(() => {
        callback(res);
        res.emit("data", Buffer.from(JSON.stringify({ version: "4.0.0" })));
        res.emit("end");
      });
      return mockReq;
    });

    const client = new SABnzbdClient(createDownloader({ allowSelfSignedCertificate: true }));
    const result = await client.testConnection();

    expect(httpsRequestMock).toHaveBeenCalled();
    const [, requestOptions] = httpsRequestMock.mock.calls[0];
    expect(requestOptions.rejectUnauthorized).toBe(false);
    expect(result.success).toBe(true);
  });
});
