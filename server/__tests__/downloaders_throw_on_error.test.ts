import { describe, expect, it, vi } from "vitest";
import type { Downloader } from "../../shared/schema.js";

vi.mock("parse-torrent", () => ({
  default: vi.fn(),
}));

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

const { QBittorrentClient } = await import("../downloaders/qbittorrent.js");
const { DelugeClient } = await import("../downloaders/deluge.js");
const { SynologyDownloadStationClient } = await import("../downloaders/synology.js");
const { NZBGetClient } = await import("../downloaders/nzbget.js");
const { SABnzbdClient } = await import("../downloaders/sabnzbd.js");
const { RTorrentClient } = await import("../downloaders/rtorrent.js");
const { TransmissionClient } = await import("../downloaders/transmission.js");

const createDownloader = (type: Downloader["type"]): Downloader => {
  const now = new Date("2024-01-01T00:00:00.000Z");
  return {
    id: `dl-${type}`,
    name: type,
    type,
    url: "http://localhost:8080",
    enabled: true,
    priority: 1,
    port: null,
    useSsl: false,
    urlPath: null,
    username: "user",
    password: "password",
    downloadPath: null,
    category: null,
    label: null,
    addStopped: false,
    removeCompleted: false,
    postImportCategory: null,
    settings: null,
    allowSelfSignedCertificate: false,
    allowInsecureLan: true,
    createdAt: now,
    updatedAt: now,
  };
};

// Each client's lowest-level request helper, made to fail like an unreachable host.
const outage = () => vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED"));

function stub(client: object, methods: Record<string, unknown>): void {
  for (const [name, impl] of Object.entries(methods)) {
    (client as Record<string, unknown>)[name] = impl;
  }
}

const clients = [
  {
    name: "qBittorrent",
    make: () => {
      const client = new QBittorrentClient(createDownloader("qbittorrent"));
      stub(client, { authenticate: vi.fn().mockResolvedValue(undefined), makeRequest: outage() });
      return client;
    },
  },
  {
    name: "Deluge",
    make: () => {
      const client = new DelugeClient(createDownloader("deluge"));
      stub(client, {
        authenticate: vi.fn().mockResolvedValue(undefined),
        ensureConnected: vi.fn().mockResolvedValue(undefined),
        makeRequest: outage(),
      });
      return client;
    },
  },
  {
    name: "Synology",
    make: () => {
      const client = new SynologyDownloadStationClient(createDownloader("synology"));
      stub(client, { requestTaskApi: outage() });
      return client;
    },
  },
  {
    name: "NZBGet",
    make: () => {
      const client = new NZBGetClient(createDownloader("nzbget"));
      stub(client, { makeXMLRPCRequest: outage() });
      return client;
    },
  },
  {
    name: "SABnzbd",
    make: () => {
      const client = new SABnzbdClient(createDownloader("sabnzbd"));
      stub(client, { fetchWithFallback: outage() });
      return client;
    },
  },
  {
    name: "rTorrent",
    make: () => {
      const client = new RTorrentClient(createDownloader("rtorrent"));
      stub(client, { makeXMLRPCRequest: outage() });
      return client;
    },
  },
  {
    name: "Transmission",
    make: () => {
      const client = new TransmissionClient(createDownloader("transmission"));
      stub(client, { makeRequest: outage() });
      return client;
    },
  },
];

describe("download clients with throwOnError", () => {
  describe.each(clients)("$name", ({ make }) => {
    it("throws from getAllDownloads when the client is unreachable", async () => {
      await expect(make().getAllDownloads({ throwOnError: true })).rejects.toThrow("ECONNREFUSED");
    });

    it("throws from getDownloadStatus when the client is unreachable", async () => {
      await expect(make().getDownloadStatus("abc", { throwOnError: true })).rejects.toThrow(
        "ECONNREFUSED"
      );
    });

    it("still returns null from getDownloadStatus without the option", async () => {
      await expect(make().getDownloadStatus("abc")).resolves.toBeNull();
    });
  });

  it.each(clients.filter((c) => !["rTorrent", "Transmission"].includes(c.name)))(
    "$name still returns an empty list from getAllDownloads without the option",
    async ({ make }) => {
      await expect(make().getAllDownloads()).resolves.toEqual([]);
    }
  );

  it("treats Deluge's empty answer for an unknown hash as not found", async () => {
    const client = new DelugeClient(createDownloader("deluge"));
    stub(client, {
      authenticate: vi.fn().mockResolvedValue(undefined),
      ensureConnected: vi.fn().mockResolvedValue(undefined),
      makeRequest: vi.fn().mockResolvedValue({ result: {}, error: null, id: 1 }),
    });

    await expect(client.getDownloadStatus("unknown", { throwOnError: true })).resolves.toBeNull();
  });

  it("treats a Synology API rejection as not found rather than unreachable", async () => {
    const client = new SynologyDownloadStationClient(createDownloader("synology"));
    // A NAS that answers `success: false` (e.g. unknown task id) is reachable.
    stub(client, {
      ensureApiInfo: vi.fn().mockResolvedValue(undefined),
      getTaskApiDescriptor: vi.fn().mockReturnValue({
        apiName: "SYNO.DownloadStation.Task",
        descriptor: { path: "DownloadStation/task.cgi", minVersion: 1, maxVersion: 3 },
      }),
      authenticate: vi.fn().mockResolvedValue("sid"),
      fetchJson: vi.fn().mockResolvedValue({ success: false, error: { code: 544 } }),
    });

    await expect(client.getDownloadStatus("missing", { throwOnError: true })).resolves.toBeNull();
  });
});
