import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockStorage, testDownloader, testIndexer, getCategories } = vi.hoisted(() => ({
  mockStorage: {
    getImportConfig: vi.fn(),
    getAllRootFolders: vi.fn(),
    getPathMappings: vi.fn(),
    getAllIndexers: vi.fn(),
    getAllDownloaders: vi.fn(),
    getSystemConfig: vi.fn(),
  },
  testDownloader: vi.fn(),
  testIndexer: vi.fn(),
  getCategories: vi.fn(),
}));

vi.mock("../storage.js", () => ({ storage: mockStorage }));
vi.mock("../downloaders.js", () => ({ DownloaderManager: { testDownloader } }));
vi.mock("../torznab.js", () => ({
  torznabClient: { testConnection: testIndexer, getCategories },
}));
vi.mock("../newznab.js", () => ({
  newznabClient: { testConnection: testIndexer, getCategories },
}));
vi.mock("../services/ArchiveService.js", () => ({
  getArchiveToolPaths: () => ({ sevenZip: "/usr/bin/7zz", unrar: null }),
}));
vi.mock("../security-scan.js", () => ({
  readClamAvSettings: vi.fn().mockResolvedValue({ enabled: false, host: null, port: 3310 }),
  testClamAvConnectivity: vi.fn(),
}));
vi.mock("../apprise.js", () => ({
  readAppriseSettings: vi.fn().mockResolvedValue({}),
  isAppriseConfigured: () => false,
}));

import { runSetupChecks } from "../setup-checks.js";

describe("runSetupChecks", () => {
  let dir: string;
  beforeEach(() => {
    vi.clearAllMocks();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "setup-checks-"));
    mockStorage.getImportConfig.mockResolvedValue({ libraryRoot: dir, transferMode: "hardlink" });
    mockStorage.getAllRootFolders.mockResolvedValue([]);
    mockStorage.getPathMappings.mockResolvedValue([]);
    mockStorage.getAllIndexers.mockResolvedValue([]);
    mockStorage.getAllDownloaders.mockResolvedValue([]);
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("fails when the library root does not exist", async () => {
    mockStorage.getImportConfig.mockResolvedValue({
      libraryRoot: path.join(dir, "missing"),
      transferMode: "copy",
    });
    const report = await runSetupChecks();
    const check = report.checks.find((c) => c.id === "library-root");
    expect(check?.status).toBe("fail");
    expect(check?.fix).toBeTruthy();
    expect(report.summary.fail).toBeGreaterThan(0);
  });

  it("passes a writable library root and flags missing unrar", async () => {
    const report = await runSetupChecks();
    expect(report.checks.find((c) => c.id === "library-root")?.status).toBe("pass");
    expect(report.checks.find((c) => c.id === "tool-7z")?.status).toBe("pass");
    expect(report.checks.find((c) => c.id === "tool-unrar")?.status).toBe("warn");
  });

  it("reports unreachable indexers with a fix and skips disabled ones", async () => {
    mockStorage.getAllIndexers.mockResolvedValue([
      {
        id: "a",
        name: "Down",
        url: "https://idx.example/api",
        apiKey: "k",
        protocol: "torznab",
        enabled: true,
      },
      {
        id: "b",
        name: "Off",
        url: "https://off.example/api",
        apiKey: "k",
        protocol: "torznab",
        enabled: false,
      },
    ]);
    testIndexer.mockResolvedValue({ success: false, message: "HTTP 401 Unauthorized" });
    const report = await runSetupChecks();
    const down = report.checks.find((c) => c.id === "indexer-a");
    expect(down?.status).toBe("fail");
    expect(down?.fix).toMatch(/API key/);
    expect(report.checks.find((c) => c.id === "indexer-b")).toBeUndefined();
  });

  it("warns when the downloader path is not visible and no mapping applies", async () => {
    mockStorage.getAllDownloaders.mockResolvedValue([
      {
        id: "d",
        name: "qb",
        url: "http://qb.lan:8080",
        enabled: true,
        downloadPath: "/downloads/definitely-not-here",
        username: null,
      },
    ]);
    testDownloader.mockResolvedValue({ success: true, message: "Connected" });
    const report = await runSetupChecks();
    const check = report.checks.find((c) => c.id === "downloader-d");
    expect(check?.status).toBe("warn");
    expect(check?.fix).toMatch(/path mapping/);
  });

  it("fails a path mapping whose local path is missing", async () => {
    mockStorage.getPathMappings.mockResolvedValue([
      { id: "m", remotePath: "/downloads", localPath: path.join(dir, "nope"), remoteHost: null },
    ]);
    const report = await runSetupChecks();
    expect(report.checks.find((c) => c.id === "path-mapping-m")?.status).toBe("fail");
  });
});
