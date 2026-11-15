import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Downloader, Indexer, UserSettings } from "../../shared/schema.js";

const { storageMock, loadProwlarrMock } = vi.hoisted(() => ({
  storageMock: {
    getAllIndexers: vi.fn(),
    getAllDownloaders: vi.fn(),
    getAllUsers: vi.fn(),
    getUserSettings: vi.fn(),
  },
  loadProwlarrMock: vi.fn(),
}));

vi.mock("../storage.js", () => ({ storage: storageMock }));
vi.mock("../db.js", () => ({ dialect: "sqlite" }));
vi.mock("../prowlarr-settings.js", () => ({ loadProwlarrSyncSettings: loadProwlarrMock }));

import {
  buildDiagnosticsSnapshot,
  describeEndpoint,
  describeSecret,
  formatDiagnosticsBlock,
  summarizeErrors,
} from "../diagnostics.js";

const SECRET_KEY = "0123456789abcdef0123456789abcdef";

function indexer(overrides: Partial<Indexer> = {}): Indexer {
  return {
    id: "6f1c2f0e-1111-4222-8333-444455556666",
    name: "NZBgeek",
    url: "http://192.168.1.20:9696/1/api",
    apiKey: SECRET_KEY,
    protocol: "newznab",
    enabled: true,
    priority: 1,
    categories: ["4000"],
    rssEnabled: true,
    autoSearchEnabled: true,
    allowInsecureLan: false,
    timeoutSeconds: null,
    ...overrides,
  } as Indexer;
}

describe("describeEndpoint", () => {
  it("classifies hosts without exposing them", () => {
    expect(describeEndpoint("http://192.168.1.20:9696/1/api")).toEqual({
      scheme: "http",
      hostKind: "private-ip",
      port: 9696,
    });
    expect(describeEndpoint("https://indexer.example.com/api").hostKind).toBe("fqdn");
    expect(describeEndpoint("http://prowlarr:9696").hostKind).toBe("single-label-hostname");
    expect(describeEndpoint("localhost", 8080)).toEqual({
      scheme: "http",
      hostKind: "loopback",
      port: 8080,
    });
    expect(describeEndpoint("8.8.8.8").hostKind).toBe("public-ip");
    expect(describeEndpoint("").hostKind).toBe("invalid");
  });
});

describe("strict endpoint parsing", () => {
  it("does not invent a scheme for indexer URLs", () => {
    expect(describeEndpoint("192.168.1.20:9696/1/api", null, { strict: true }).hostKind).toBe(
      "invalid"
    );
    expect(describeEndpoint("192.168.1.20:9696/1/api").scheme).toBe("http");
  });
});

describe("describeSecret", () => {
  it("reports shape only and flags padding", () => {
    expect(describeSecret(SECRET_KEY)).toEqual({
      set: true,
      length: 32,
      charset: "hex",
      suspiciousPadding: false,
    });
    expect(describeSecret(` ${SECRET_KEY}\n`).suspiciousPadding).toBe(true);
    expect(describeSecret(`"${SECRET_KEY}"`).suspiciousPadding).toBe(true);
    expect(describeSecret("")).toMatchObject({ set: false, charset: "none" });
  });
});

describe("summarizeErrors", () => {
  it("groups repeated warnings and errors and ignores info lines", () => {
    const line = (time: string, msg: string, error: string) =>
      JSON.stringify({ level: 50, time, module: "torznab", msg, error: { message: error } });
    const result = summarizeErrors([
      line("t1", "error searching indexer", "HTTP 401: Unauthorized"),
      JSON.stringify({ level: 30, module: "express", msg: "GET /api 200" }),
      line("t2", "error searching indexer", "HTTP 401: Unauthorized"),
      "not json",
      line("t3", "other", "boom from 10.0.0.5"),
    ]);

    expect(result[0]).toMatchObject({
      count: 2,
      module: "torznab",
      message: "error searching indexer: HTTP 401: Unauthorized",
      firstSeen: "t1",
      lastSeen: "t2",
    });
    expect(result[1]?.message).toBe("other: boom from [ip]");
    expect(result).toHaveLength(2);
  });
});

describe("buildDiagnosticsSnapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getAllUsers.mockResolvedValue([{ id: "u1" }]);
    storageMock.getUserSettings.mockResolvedValue({
      autoSearchEnabled: true,
      upgradePolicy: "notify",
      libraryRoot: "/home/alice/games",
      preferredReleaseGroups: "SECRETGROUP",
    } as unknown as UserSettings);
    storageMock.getAllIndexers.mockResolvedValue([indexer()]);
    storageMock.getAllDownloaders.mockResolvedValue([
      {
        name: "NZBget",
        type: "nzbget",
        url: "nas",
        port: 6789,
        useSsl: false,
        username: "nzbget",
        password: "tegbzn6789",
        enabled: true,
        priority: 1,
        allowInsecureLan: false,
        allowSelfSignedCertificate: false,
        category: "games",
      } as unknown as Downloader,
    ]);
    loadProwlarrMock.mockResolvedValue({
      url: "http://192.168.1.20:9696",
      apiKey: SECRET_KEY,
      allowInsecureLan: true,
      categories: [],
    });
  });

  it("describes configuration without leaking hosts, keys or credentials", async () => {
    const snapshot = await buildDiagnosticsSnapshot({ logLines: [] });
    const text = formatDiagnosticsBlock(snapshot);

    expect(() => JSON.parse(text.split("\n").slice(1, -1).join("\n"))).not.toThrow();
    expect(snapshot.app.database).toBe("sqlite");
    expect(snapshot.indexers[0]).toMatchObject({
      name: "NZBgeek",
      hostKind: "private-ip",
      port: 9696,
      prowlarrProxyPath: true,
      apiKeyWithheld: true,
      keyMatchesProwlarrKey: true,
      apiKeyShape: { set: true, length: 32, charset: "hex" },
    });
    expect(snapshot.downloaders[0]).toMatchObject({
      type: "nzbget",
      hostKind: "single-label-hostname",
      port: 6789,
      username: true,
      passwordShape: { set: true },
    });
    expect(snapshot.settings).toEqual({ autoSearchEnabled: true, upgradePolicy: "notify" });

    for (const secret of [
      SECRET_KEY,
      "tegbzn6789",
      "192.168.1.20",
      "nas.example",
      "alice",
      "SECRETGROUP",
    ]) {
      expect(text).not.toContain(secret);
    }
  });

  it("keeps going when a section fails", async () => {
    storageMock.getAllIndexers.mockRejectedValue(new Error("db down"));
    loadProwlarrMock.mockRejectedValue(new Error("no config"));

    const snapshot = await buildDiagnosticsSnapshot();

    expect(snapshot.indexers).toEqual([]);
    expect(snapshot.prowlarr).toBeNull();
    expect(snapshot.downloaders).toHaveLength(1);
  });
});
