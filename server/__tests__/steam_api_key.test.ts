import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();

vi.mock("../storage.js", () => ({
  storage: {
    getSystemConfig: vi.fn(async (key: string) => store.get(key)),
    setSystemConfig: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
  },
}));

vi.mock("../credential-crypto.js", () => ({
  encryptCredential: vi.fn(async (v: string) => `enc:${v}`),
  decryptCredential: vi.fn(async (v: string) => {
    if (!v.startsWith("enc:")) throw new Error("bad ciphertext");
    return v.slice(4);
  }),
}));

vi.mock("../logger.js", () => ({
  routesLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../config.js", () => ({
  config: { steam: { apiKey: "env-key", isConfigured: true } },
}));

const { config } = await import("../config.js");
const keys = await import("../steam-api-key.js");

describe("steam API key settings", () => {
  beforeEach(() => {
    store.clear();
    config.steam.apiKey = "env-key";
    config.steam.isConfigured = true;
  });

  it("uses the environment key when nothing is saved", async () => {
    await keys.loadSteamApiKey();
    expect(config.steam.apiKey).toBe("env-key");
    expect(await keys.getSteamApiKeySource()).toBe("env");
  });

  it("saves a key encrypted and lets it override the environment", async () => {
    await keys.saveSteamApiKey("  abcdef0123456789abcdef0123456789  ");
    expect(store.get(keys.STEAM_API_KEY_CONFIG_KEY)).toBe("enc:abcdef0123456789abcdef0123456789");
    expect(config.steam.apiKey).toBe("abcdef0123456789abcdef0123456789");
    expect(config.steam.isConfigured).toBe(true);
    expect(await keys.getSteamApiKeySource()).toBe("database");
  });

  it("loads the saved key at startup", async () => {
    store.set(keys.STEAM_API_KEY_CONFIG_KEY, "enc:saved-key-0123456789");
    await keys.loadSteamApiKey();
    expect(config.steam.apiKey).toBe("saved-key-0123456789");
  });

  it("falls back to the environment key when the saved one is removed", async () => {
    await keys.saveSteamApiKey("abcdef0123456789abcdef0123456789");
    await keys.saveSteamApiKey(null);
    expect(config.steam.apiKey).toBe("env-key");
    expect(await keys.getSteamApiKeySource()).toBe("env");
  });

  it("ignores a saved key that no longer decrypts", async () => {
    store.set(keys.STEAM_API_KEY_CONFIG_KEY, "garbage");
    await keys.loadSteamApiKey();
    expect(config.steam.apiKey).toBe("env-key");
    expect(await keys.getSteamApiKeySource()).toBe("env");
  });

  it("does not mistake a saved key for the environment one when it is removed after a restart", async () => {
    vi.resetModules();
    config.steam.apiKey = undefined;
    config.steam.isConfigured = false;
    store.set("steam.apiKey", "enc:saved-key-0123456789");
    const fresh = await import("../steam-api-key.js");
    await fresh.loadSteamApiKey();
    expect(config.steam.apiKey).toBe("saved-key-0123456789");
    await fresh.saveSteamApiKey(null);
    expect(config.steam.apiKey).toBeUndefined();
    expect(config.steam.isConfigured).toBe(false);
    expect(await fresh.getSteamApiKeySource()).toBeNull();
  });
});
