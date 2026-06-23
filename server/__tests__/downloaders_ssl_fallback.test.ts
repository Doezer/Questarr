import { EventEmitter } from "node:events";
import type { IncomingMessage } from "http";
import https, { type RequestOptions } from "https";
import dns from "dns/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Downloader } from "../../shared/schema";
import { SABnzbdClient } from "../downloaders.js";
import * as ssrf from "../ssrf.js";

vi.mock("../logger.js", () => ({
  downloadersLogger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("dns/promises", () => ({
  default: {
    lookup: vi.fn(),
  },
}));

function createMockDownloader(overrides: Partial<Downloader> = {}): Downloader {
  const timestamp = new Date("2024-01-01T00:00:00.000Z");

  return {
    id: "sab-ssl",
    name: "Test SAB",
    type: "sabnzbd",
    url: "sab.local",
    enabled: true,
    priority: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    port: 8080,
    useSsl: true,
    urlPath: null,
    username: "api-key",
    password: "secret",
    category: null,
    downloadPath: "/downloads",
    label: "test",
    addStopped: false,
    removeCompleted: false,
    postImportCategory: null,
    settings: null,
    ...overrides,
  };
}

describe("SABnzbdClient SSL fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("pins the resolved IP when retrying an insecure SABnzbd request", async () => {
    vi.spyOn(ssrf, "safeFetch").mockRejectedValueOnce(
      Object.assign(new Error("self-signed certificate"), {
        cause: { code: "DEPTH_ZERO_SELF_SIGNED_CERT" },
      })
    );

    vi.mocked(dns.lookup as unknown as import("node:dns").LookupAddress[]).mockResolvedValueOnce([
      { address: "127.0.0.1", family: 4 },
    ]);

    vi.spyOn(https, "request").mockImplementation(((...args: unknown[]) => {
      const [requestUrl, requestOptions, requestCallback] = args as [
        string,
        RequestOptions,
        (response: IncomingMessage) => void,
      ];

      expect(requestUrl).toBe("https://127.0.0.1:8080/api?apikey=api-key&mode=version&output=json");
      expect(requestOptions.rejectUnauthorized).toBe(false);
      expect(requestOptions.headers).toMatchObject({
        host: "sab.local",
      });

      const request = new EventEmitter() as EventEmitter & {
        destroy: () => void;
        end: () => void;
        on: EventEmitter["on"];
        write: (chunk: Buffer | string) => void;
      };

      request.destroy = vi.fn();
      request.write = vi.fn();
      request.end = () => {
        const response = new EventEmitter() as IncomingMessage;
        Object.assign(response, {
          headers: { "content-type": "application/json" },
          statusCode: 200,
          statusMessage: "OK",
        });

        requestCallback(response);
        response.emit("data", Buffer.from(JSON.stringify({ version: "4.5.0" })));
        response.emit("end");
      };

      return request as unknown as ReturnType<typeof https.request>;
    }) as typeof https.request);

    const client = new SABnzbdClient(createMockDownloader());
    const result = await client.testConnection();

    expect(result).toEqual({
      success: true,
      message: "Connected to SABnzbd v4.5.0",
    });
  });
});
