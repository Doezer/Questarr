import { describe, it, expect, vi, beforeEach } from "vitest";

const config = new Map<string, string>();

vi.mock("../storage.js", () => ({
  storage: {
    getAllIndexers: vi.fn(async () => []),
    updateIndexer: vi.fn(),
    getSystemConfig: vi.fn(async (key: string) => config.get(key)),
    setSystemConfigBatch: vi.fn(async (entries: { key: string; value: string }[]) => {
      for (const { key, value } of entries) config.set(key, value);
    }),
  },
}));

vi.mock("../credential-crypto.js", () => ({
  encryptCredential: vi.fn(async (value: string) => `enc:v1:${value}`),
  decryptCredential: vi.fn(async (value: string) => value.replace(/^enc:v1:/, "")),
}));

import {
  loadProwlarrSyncSettings,
  saveProwlarrSyncSettings,
  revokeProwlarrHttpOptIn,
} from "../prowlarr-settings.js";
import { storage } from "../storage.js";
import type { Indexer } from "../../shared/schema.js";

describe("Prowlarr sync settings", () => {
  beforeEach(() => {
    config.clear();
    vi.clearAllMocks();
    vi.mocked(storage.getAllIndexers).mockResolvedValue([]);
  });

  it("returns null before any sync was saved", async () => {
    expect(await loadProwlarrSyncSettings()).toBeNull();
  });

  it("round-trips the dialog values and stores the key encrypted", async () => {
    const settings = {
      url: "http://192.168.1.10:9696",
      apiKey: "prowlarr-key",
      allowInsecureLan: true,
      priority: 10,
      categories: ["4000", "4050"],
    };

    await saveProwlarrSyncSettings(settings);

    expect(config.get("prowlarr.apiKey")).toBe("enc:v1:prowlarr-key");
    expect(await loadProwlarrSyncSettings()).toEqual(settings);
  });

  it("falls back to defaults when the stored options are unreadable", async () => {
    config.set("prowlarr.url", "http://prowlarr:9696");
    config.set("prowlarr.apiKey", "enc:v1:k");
    config.set("prowlarr.syncDefaults", "{not json");

    expect(await loadProwlarrSyncSettings()).toEqual({
      url: "http://prowlarr:9696",
      apiKey: "k",
      allowInsecureLan: false,
      priority: undefined,
      categories: [],
    });
  });
});

describe("Prowlarr HTTP consent revocation", () => {
  const saved = {
    url: "http://prowlarr:9696/base",
    apiKey: "saved-key",
    allowInsecureLan: true,
    priority: 4,
    categories: ["4050"],
  };
  const rows = [
    { id: "matching", url: `${saved.url}/1/api`, apiKey: saved.apiKey, allowInsecureLan: true },
    {
      id: "other-host",
      url: "http://another:9696/base/1/api",
      apiKey: saved.apiKey,
      allowInsecureLan: true,
    },
    {
      id: "other-base",
      url: "http://prowlarr:9696/elsewhere/1/api",
      apiKey: saved.apiKey,
      allowInsecureLan: true,
    },
    { id: "other-key", url: `${saved.url}/2/api`, apiKey: "another-key", allowInsecureLan: true },
    { id: "invalid", url: "not-a-url", apiKey: saved.apiKey, allowInsecureLan: true },
  ] as Indexer[];

  beforeEach(async () => {
    config.clear();
    vi.clearAllMocks();
    await saveProwlarrSyncSettings(saved);
    vi.mocked(storage.getAllIndexers).mockResolvedValue(rows);
  });

  it("persists revocation without changing credentials/defaults or unrelated indexers", async () => {
    await revokeProwlarrHttpOptIn(saved.url);
    expect(await loadProwlarrSyncSettings()).toEqual({ ...saved, allowInsecureLan: false });
    expect(storage.updateIndexer).toHaveBeenCalledExactlyOnceWith("matching", {
      allowInsecureLan: false,
    });
  });

  it.each(["prowlarr:9696/base", "prowlarr:9696/base/", "prowlarr:9696/base///"])(
    "revokes the generated indexers for scheme-less URL %s",
    async (url) => {
      await saveProwlarrSyncSettings({ ...saved, url });
      await revokeProwlarrHttpOptIn(url);
      expect((await loadProwlarrSyncSettings())?.allowInsecureLan).toBe(false);
      expect(storage.updateIndexer).toHaveBeenCalledExactlyOnceWith("matching", {
        allowInsecureLan: false,
      });
    }
  );

  it.each(["http://prowlarr:9696/base/", "http://PROWLARR:9696/base///", "prowlarr:9696/base"])(
    "revokes an equivalent spelling of the saved URL: %s",
    async (url) => {
      await revokeProwlarrHttpOptIn(url);
      expect((await loadProwlarrSyncSettings())?.allowInsecureLan).toBe(false);
      expect(storage.updateIndexer).toHaveBeenCalledExactlyOnceWith("matching", {
        allowInsecureLan: false,
      });
    }
  );

  it.each(["http://prowlarr:9696/other", "http://another:9696/base"])(
    "does not revoke a different connection identity: %s",
    async (url) => {
      await revokeProwlarrHttpOptIn(url);
      expect(await loadProwlarrSyncSettings()).toEqual(saved);
      expect(storage.updateIndexer).not.toHaveBeenCalled();
    }
  );

  it.each(["https://prowlarr:9696/base", "https://replacement.example/new-base"])(
    "revokes the saved HTTP connection when replacing it with %s",
    async (url) => {
      await revokeProwlarrHttpOptIn(url);
      expect(await loadProwlarrSyncSettings()).toEqual({ ...saved, allowInsecureLan: false });
      expect(storage.updateIndexer).toHaveBeenCalledExactlyOnceWith("matching", {
        allowInsecureLan: false,
      });
    }
  );

  it("leaves another connection untouched", async () => {
    await revokeProwlarrHttpOptIn("http://another:9696");
    expect(await loadProwlarrSyncSettings()).toEqual(saved);
    expect(storage.updateIndexer).not.toHaveBeenCalled();
  });

  it.each(["http://[", "http://:9696", "http://prowlarr:bad"])(
    "leaves saved consent untouched for malformed requested URL %s",
    async (url) => {
      await expect(revokeProwlarrHttpOptIn(url)).resolves.toBeUndefined();
      expect(await loadProwlarrSyncSettings()).toEqual(saved);
      expect(storage.getAllIndexers).not.toHaveBeenCalled();
      expect(storage.updateIndexer).not.toHaveBeenCalled();
    }
  );

  it("leaves malformed saved connection data untouched", async () => {
    await saveProwlarrSyncSettings({ ...saved, url: "http://[" });
    await expect(revokeProwlarrHttpOptIn(saved.url)).resolves.toBeUndefined();
    expect(await loadProwlarrSyncSettings()).toEqual({ ...saved, url: "http://[" });
    expect(storage.getAllIndexers).not.toHaveBeenCalled();
    expect(storage.updateIndexer).not.toHaveBeenCalled();
  });

  it("can retry indexer revocation after a storage failure", async () => {
    vi.mocked(storage.updateIndexer).mockRejectedValueOnce(new Error("Storage failure"));
    await expect(revokeProwlarrHttpOptIn(saved.url)).rejects.toThrow("Storage failure");
    expect(await loadProwlarrSyncSettings()).toEqual(saved);
    await revokeProwlarrHttpOptIn(saved.url);
    expect((await loadProwlarrSyncSettings())?.allowInsecureLan).toBe(false);
    expect(storage.updateIndexer).toHaveBeenCalledTimes(2);
  });

  it("keeps saved consent enabled after a partial failure and retries the remaining indexer", async () => {
    const matching = [{ ...rows[0]! }, { ...rows[0]!, id: "second", url: `${saved.url}/2/api` }];
    vi.mocked(storage.getAllIndexers).mockResolvedValue(matching);
    vi.mocked(storage.updateIndexer)
      .mockImplementationOnce(async (id, update) => {
        const indexer = matching.find((row) => row.id === id)!;
        Object.assign(indexer, update);
        return indexer;
      })
      .mockRejectedValueOnce(new Error("Storage failure"));

    await expect(revokeProwlarrHttpOptIn(saved.url)).rejects.toThrow("Storage failure");
    expect(await loadProwlarrSyncSettings()).toEqual(saved);
    expect(matching.map((row) => row.allowInsecureLan)).toEqual([false, true]);

    vi.mocked(storage.updateIndexer).mockImplementationOnce(async (id, update) => {
      const indexer = matching.find((row) => row.id === id)!;
      Object.assign(indexer, update);
      return indexer;
    });
    await revokeProwlarrHttpOptIn(saved.url);
    expect(matching.map((row) => row.allowInsecureLan)).toEqual([false, false]);
    expect(await loadProwlarrSyncSettings()).toEqual({ ...saved, allowInsecureLan: false });
    expect(vi.mocked(storage.updateIndexer).mock.calls.map(([id]) => id)).toEqual([
      "matching",
      "second",
      "second",
    ]);
  });

  it("does not report saved consent as revoked when reading indexers fails", async () => {
    vi.mocked(storage.getAllIndexers).mockRejectedValueOnce(new Error("Storage failure"));
    await expect(revokeProwlarrHttpOptIn(saved.url)).rejects.toThrow("Storage failure");
    expect(await loadProwlarrSyncSettings()).toEqual(saved);
    expect(storage.updateIndexer).not.toHaveBeenCalled();
  });
});
