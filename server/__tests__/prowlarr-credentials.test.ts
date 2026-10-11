import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetch as undiciFetch } from "undici";
import { prowlarrClient } from "../prowlarr.js";

// Keep the real safeFetch policy; replace only the network transport.
vi.mock("undici", async () => {
  const actual = await vi.importActual<typeof import("undici")>("undici");
  return { ...actual, fetch: vi.fn(), Agent: vi.fn() };
});
vi.mock("../logger.js", () => ({
  torznabLogger: { info: vi.fn(), error: vi.fn() },
}));

describe("Prowlarr sync credential transport", () => {
  const key = "test-sync-key";
  const httpsFetch = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", httpsFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([undefined, false])(
    "blocks HTTP before sending a key when opt-in is %s",
    async (optIn) => {
      await expect(
        prowlarrClient.getIndexers("http://192.168.1.2:9696", key, { allowInsecureLan: optIn })
      ).rejects.toThrow("Refusing to send a credential-bearing request");
      expect(undiciFetch).not.toHaveBeenCalled();
      expect(httpsFetch).not.toHaveBeenCalled();
    }
  );

  it("allows an explicitly opted-in LAN HTTP request", async () => {
    vi.mocked(undiciFetch).mockResolvedValueOnce(new Response("[]"));
    await expect(
      prowlarrClient.getIndexers("http://192.168.1.2:9696", key, { allowInsecureLan: true })
    ).resolves.toEqual([]);
    expect(undiciFetch).toHaveBeenCalledWith(
      "http://192.168.1.2:9696/api/v1/indexer",
      expect.objectContaining({ headers: expect.objectContaining({ "X-Api-Key": key }) })
    );
  });

  it("sends the key over HTTPS without an insecure opt-in", async () => {
    httpsFetch.mockResolvedValueOnce(new Response("[]"));
    await expect(prowlarrClient.getIndexers("https://192.168.1.2:9696", key)).resolves.toEqual([]);
    expect(httpsFetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ headers: expect.objectContaining({ "X-Api-Key": key }) })
    );
    expect(undiciFetch).not.toHaveBeenCalled();
  });

  it("blocks an HTTPS-to-HTTP redirect before forwarding the key", async () => {
    httpsFetch.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { Location: "http://192.168.1.2:9696/indexers" } })
    );
    await expect(prowlarrClient.getIndexers("https://192.168.1.2:9696", key)).rejects.toThrow(
      "Refusing to send a credential-bearing request over a non-HTTPS connection"
    );
    expect(httpsFetch).toHaveBeenCalledTimes(1);
    expect(undiciFetch).not.toHaveBeenCalled();
  });
});
