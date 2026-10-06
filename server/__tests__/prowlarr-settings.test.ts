import { describe, it, expect, vi, beforeEach } from "vitest";

const config = new Map<string, string>();

vi.mock("../storage.js", () => ({
  storage: {
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

import { loadProwlarrSyncSettings, saveProwlarrSyncSettings } from "../prowlarr-settings.js";

describe("Prowlarr sync settings", () => {
  beforeEach(() => config.clear());

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
